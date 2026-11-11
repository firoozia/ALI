// Stock check for the ARYAK assistant, against the Zinax Stock sheet.
//
// The model never sees a quantity: it calls the check_stock tool and is told only "available", "ask which
// product", "unknown code" or "a colleague will confirm". When stock is at or under the limit the bot stays silent
// in the group and the real figures go privately to the sales manager.

import { stripBrand } from './codes.js';

/** Tool given to Claude. */
export const checkStockTool = {
  name: 'check_stock',
  description:
    'Check whether a product code is available. Call it every time a customer asks if a code, colour or item is ' +
    'available or in stock, before answering. Use the code exactly as the customer wrote it. The result never ' +
    'contains quantities; never state or guess any quantity to the customer.',
  input_schema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Product code as written by the customer, e.g. "305" or "KG10-300".' },
      category: {
        type: 'string',
        description: 'Product group if the customer made it clear, e.g. "PVC film", "Edge banding", "Rail", "Hinge".',
      },
      size: { type: 'string', description: 'Ignored: availability is by product code, the size typed in the sheet is not reliable.' },
      quantity: { type: 'number', description: 'Quantity the customer asked for, if any.' },
      quantity_unit: { type: 'string', description: 'Unit of that quantity: "m", "roll", "pcs" or "carton".' },
    },
    required: ['code'],
  },
};

/**
 * Can the quantity asked come from ONE roll or open piece? true / false, or undefined when it cannot be told (no quantity,
 * a unit that could not be converted, or a sheet that does not give the rolls and pieces). Only this yes or no is passed on.
 */
export function sameRoll(result) {
  const asked = Number(result.askedInUnit) || 0;
  if (!asked || result.qtyChecked === false) return undefined;
  const sizes = result.sizes || [];
  if (!sizes.length || !sizes.every((s) => Array.isArray(s.packs) && Array.isArray(s.pieces))) return undefined;
  const biggest = Math.max(0, ...sizes.flatMap((s) => [...s.packs.filter((p) => p.count > 0).map((p) => p.qty), ...s.pieces]));
  return asked <= biggest + 1e-6;
}

/** The real cause of a failed fetch: undici hides it in err.cause (code and message). */
export function describeError(e) {
  const c = e?.cause;
  const bits = [e?.name === 'TimeoutError' ? 'timeout' : e?.message || String(e)];
  if (c) bits.push([c.code, c.message].filter(Boolean).join(' '));
  return bits.filter(Boolean).join(' | ');
}

/** True when the failure is a slow answer, for the short reason given to a colleague. */
export const isTimeout = (e) => e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timeout|timed out|ETIMEDOUT/i.test(`${e?.message} ${e?.cause?.code}`);

const REDIRECTS = [301, 302, 303, 307, 308];

/**
 * One request to the Apps Script web app. It answers a POST with a redirect to the result, which must be fetched
 * with GET and no body, so the redirect is followed here by hand (a string body can always be sent again, but a
 * redirect that keeps the body can fail inside fetch).
 */
async function requestOnce(config, body, fetchImpl, timeoutMs) {
  let url = config.sheetUrl;
  let init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, redirect: 'manual' };
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (REDIRECTS.includes(res.status)) {
      const where = res.headers?.get?.('location');
      if (!where) throw new Error(`Sheet redirected (${res.status}) without a Location`);
      url = new URL(where, url).href;
      init = { method: 'GET', redirect: 'manual' };
      continue;
    }
    return res;
  }
  throw new Error('Sheet redirected too many times');
}

/**
 * What the sheet last said about a lookup. A fresh answer (a minute or so old) is used again without asking; an older
 * one (up to a quarter of an hour) is only a fallback when the sheet does not answer.
 */
export class SheetCache {
  constructor({ freshMs = 75 * 1000, staleMs = 15 * 60 * 1000, now = Date.now } = {}) {
    Object.assign(this, { freshMs, staleMs, now });
    this.map = new Map();
  }

  key(input) {
    return [input.code, input.category, input.size, input.quantity, input.quantity_unit].map((x) => String(x ?? '').trim().toLowerCase()).join('|');
  }

  get(input) {
    const e = this.map.get(this.key(input));
    return e ? { data: e.data, ageMs: this.now() - e.at } : null;
  }

  set(input, data) {
    this.map.set(this.key(input), { data, at: this.now() });
    if (this.map.size > 500) this.map.delete(this.map.keys().next().value);
  }
}

const seconds = (ms) => (ms / 1000).toFixed(1);

/**
 * Asks the sheet. Up to [tries] tries, each with its own timeout ([timeoutMs], a number or a list: the first wait is
 * long because Apps Script sometimes needs a minute to wake up), a short pause between them. Every try is logged with
 * how long it took and, when it failed, its real cause and HTTP status. With a [cache]: a fresh answer is reused, and
 * when every try fails an answer up to a quarter of an hour old is returned with { stale: true, ageMinutes }.
 */
export async function fetchStock(config, input, fetchImpl = fetch, opts = {}) {
  const first = await fetchStockOnce(config, input, fetchImpl, opts);
  // "AR102": AR is ARYAK's own short prefix. When the exact code is not in the sheet, try it without the prefix.
  const bare = stripBrand(input.code);
  if (first && first.found === false && bare && bare.toUpperCase() !== String(input.code).toUpperCase().trim()) {
    const second = await fetchStockOnce(config, { ...input, code: bare }, fetchImpl, opts);
    if (second?.found) return second;
  }
  return first;
}

async function fetchStockOnce(config, input, fetchImpl = fetch, opts = {}) {
  const { cache = config.sheetCache, log = config.log || (() => {}) } = opts;
  const cached = cache?.get(input);
  if (cached && cached.ageMs <= cache.freshMs) return cached.data;
  const body = JSON.stringify({
    action: 'botStock',
    token: config.botToken,
    code: input.code,
    category: input.category || '',
    size: input.size || '',
    qty: input.quantity || 0,
    qtyUnit: input.quantity_unit || '',
  });
  const name = `stock lookup for "${String(input.code).slice(0, 30)}"`;
  try {
    const data = await askSheet(config, body, name, fetchImpl, opts);
    cache?.set(input, data);
    return data;
  } catch (lastError) {
    if (cached && cached.ageMs <= cache.staleMs && !lastError.final) {
      log(`${name}: the sheet did not answer, using the answer from ${Math.round(cached.ageMs / 60000)} minute(s) ago`);
      return { ...cached.data, stale: true, ageMinutes: Math.round(cached.ageMs / 60000) };
    }
    throw lastError;
  }
}

/** The report of goods sent out between two days (yyyy-MM-dd); [params]: { from, to, code, category, customer, detail }. */
export async function fetchReport(config, params, fetchImpl = fetch, opts = {}) {
  const body = JSON.stringify({
    action: 'botReport',
    token: config.botToken,
    from: params.from,
    to: params.to,
    code: params.code || '',
    category: params.category || '',
    customer: params.customer || '',
    detail: !!params.detail,
    returns: !!params.returns,
    limit: params.limit || 0,
  });
  return askSheet(config, body, `outgoing report ${params.from}..${params.to}`, fetchImpl, opts);
}

/** One question to the sheet with the tries, timeouts and logging described at fetchStock. */
export async function askSheet(config, body, name, fetchImpl, {
  log = config.log || (() => {}), info = config.logInfo || log, timeoutMs = [45000, 30000, 30000], retryDelayMs = 1500, tries = 3, now = Date.now,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const started = now();
    try {
      const res = await requestOnce(config, body, fetchImpl, Array.isArray(timeoutMs) ? timeoutMs[attempt - 1] ?? timeoutMs.at(-1) : timeoutMs);
      if (!res.ok) {
        const err = new Error(`Sheet answered ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      if (!data.ok) throw Object.assign(new Error(data.error || 'Sheet refused'), { final: true });
      info(`${name}: try ${attempt} of ${tries} ok in ${seconds(now() - started)} s`);
      return data;
    } catch (e) {
      lastError = e;
      log(`${name}: try ${attempt} of ${tries} failed in ${seconds(now() - started)} s: ${describeError(e)}${e.status ? ` | HTTP ${e.status}` : ''}`);
      // The sheet's own refusal (wrong token, no code) and a 4xx are not worth trying again.
      if (e.final || (e.status && e.status < 500) || attempt === tries) break;
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  throw lastError;
}

/** Keeps the Apps Script instance awake: a lookup of a code that does not exist, which still reads the sheet. */
export async function warmSheet(config, fetchImpl = fetch, opts = {}) {
  const started = Date.now();
  await fetchStock(config, { code: 'warmup' }, fetchImpl, { tries: 1, timeoutMs: 40000, cache: null, log: () => {}, ...opts });
  return Date.now() - started;
}

const fmt = (n) => (Math.round(Number(n) * 100) / 100).toString();

/** The private message to the sales manager when stock is at or under the limit. */
export function managerMessage(result, ctx, input) {
  const lines = [];
  lines.push('⚠️ موجودی کم — به مشتری جوابی داده نشد');
  lines.push(`مشتری: ${ctx.customer || ctx.groupName || '—'}`);
  if (ctx.groupName && ctx.groupName !== ctx.customer) lines.push(`گروه: ${ctx.groupName}`);
  lines.push(`کد: ${result.code} (${result.category})` + (result.size ? ` · سایز: ${result.size}` : ''));
  if (result.asked) {
    lines.push(`درخواست: ${fmt(result.asked)} ${result.askedUnit}` +
      (result.askedInUnit && result.askedUnit !== result.unit ? ` (= ${fmt(result.askedInUnit)} ${result.unit})` : ''));
  }
  if (!result.qtyChecked) lines.push('مقدار هر رول/کارتن در کاتالوگ نیست؛ مقدار درخواستی بررسی نشد.');
  lines.push(`موجودی آزاد: ${fmt(result.free)} ${result.unit}` +
    (result.reserved ? ` · رزرو: ${fmt(result.reserved)} ${result.unit}` : '') + ` · حد: ${fmt(result.limit)} ${result.unit}`);
  const sizes = [...new Set((result.sizes || []).map((s) => String(s.size || '').trim()).filter(Boolean))];
  if (sizes.length > 1) lines.push(`اندازه‌های ثبت‌شده: ${sizes.join(' و ')}`);
  if ((result.locations || []).length) lines.push(`محل: ${result.locations.join(', ')}`);
  if (ctx.messageText) lines.push(`پیام مشتری: «${ctx.messageText.slice(0, 300)}»`);
  void input;
  return lines.join('\n');
}

/**
 * Runs the check_stock tool for one customer message.
 * Returns what the model is told, whether the bot must stay silent in the group, and the manager message if any.
 * [ctx]: { groupId, groupName, customer, messageText }.
 * [recent]: a Map shared across calls so the manager is not told twice about the same code in a group within dedupeMinutes.
 */
export async function runCheckStock(input, ctx, config, { fetchImpl = fetch, recent = new Map(), now = Date.now() } = {}) {
  let result;
  try {
    // The code is the product: the size a customer writes is never sent, so a size that is not in the sheet cannot make
    // an available product look unavailable.
    result = await fetchStock(config, { ...input, size: '' }, fetchImpl, { log: config.log, retryDelayMs: config.retryDelayMs, timeoutMs: config.timeoutMs, tries: config.tries });
  } catch (e) {
    return { forModel: { status: 'error', instruction: 'Say a colleague will confirm availability and tag the team.' }, silent: false, error: String(e.message || e) };
  }
  if (!result.found) {
    return { forModel: { status: 'unknown_code', instruction: 'Do not guess. Ask the customer to confirm the code, or say a colleague will check and tag the team.' }, silent: false };
  }
  if (result.ambiguous) {
    return { forModel: { status: 'ask_category', options: result.categories, instruction: 'Ask which of these products the customer means.' }, silent: false };
  }
  if (result.available) {
    const one = sameRoll(result);
    return {
      forModel: {
        status: 'available',
        ...(one === undefined ? {} : { same_roll: one }),
        instruction: 'Tell the customer it is available. Never give a quantity. Price and delivery go to a colleague.'
          + (one === undefined ? '' : ' If the customer asks whether it comes from the same roll or from separate rolls, answer from same_roll (true: one roll or piece covers it; false: it comes from separate rolls or pieces) and say nothing more about the stock.'),
      },
      silent: false,
    };
  }
  // At or under the limit: say nothing in the group, tell the sales manager once.
  const key = `${ctx.groupId || ''}|${String(result.code).toLowerCase()}|${result.size || ''}`;
  const last = recent.get(key);
  const windowMs = (config.dedupeMinutes ?? 60) * 60 * 1000;
  const notify = !(last && now - last < windowMs);
  if (notify) recent.set(key, now);
  return {
    // The message is not answered when every code asked about is like this (see assistant.js); when other
    // codes are available the reply covers those and says a colleague will confirm this one.
    forModel: {
      status: 'team_will_confirm',
      instruction: 'Do not say it is unavailable and give no quantity. If this was the only thing asked, reply exactly NO_REPLY; otherwise say a colleague will confirm this code.',
    },
    silent: true,
    managerText: notify ? managerMessage(result, ctx, input) : null,
  };
}
