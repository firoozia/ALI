// Stock check for the ARYAK assistant, against the Zinax Stock sheet.
//
// The model never sees a quantity: it calls the check_stock tool and is told only "available", "ask which
// product", "unknown code" or "a colleague will confirm". When stock is at or under the limit the bot stays silent
// in the group and the real figures go privately to the sales manager.

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
      size: { type: 'string', description: 'Thickness × width if the customer gave it, e.g. "0.30*1400".' },
      quantity: { type: 'number', description: 'Quantity the customer asked for, if any.' },
      quantity_unit: { type: 'string', description: 'Unit of that quantity: "m", "roll", "pcs" or "carton".' },
    },
    required: ['code'],
  },
};

/** Asks the sheet. Apps Script answers a POST with a redirect to the result, which fetch follows. */
export async function fetchStock(config, input, fetchImpl = fetch) {
  const res = await fetchImpl(config.sheetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'botStock',
      token: config.botToken,
      code: input.code,
      category: input.category || '',
      size: input.size || '',
      qty: input.quantity || 0,
      qtyUnit: input.quantity_unit || '',
    }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Sheet answered ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Sheet refused');
  return data;
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
  for (const s of result.sizes || []) {
    lines.push(`  ${s.size || '—'}: ${fmt(s.free)} ${result.unit} (${s.packages} بسته` + (s.open ? `، ${s.open} باز` : '') + `) · حد ${fmt(s.limit)}`);
  }
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
    result = await fetchStock(config, input, fetchImpl);
  } catch (e) {
    return { forModel: { status: 'error', instruction: 'Say a colleague will confirm availability and tag the team.' }, silent: false, error: String(e.message || e) };
  }
  if (!result.found) {
    return { forModel: { status: 'unknown_code', instruction: 'Do not guess. Ask the customer to confirm the code, or say a colleague will check and tag the team.' }, silent: false };
  }
  if (result.ambiguous) {
    return { forModel: { status: 'ask_category', options: result.categories, instruction: 'Ask which of these products the customer means.' }, silent: false };
  }
  if (result.sizeFound === false) {
    return { forModel: { status: 'ask_size', sizes: result.sizes, instruction: 'That size is not in our range; ask which of these sizes they need. Do not mention quantities.' }, silent: false };
  }
  if (result.available) {
    return { forModel: { status: 'available', instruction: 'Tell the customer it is available. Never give a quantity. Price and delivery go to a colleague.' }, silent: false };
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
