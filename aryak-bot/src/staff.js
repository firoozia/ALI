// The assistant for the ARYAK team: answers staff questions (stock with real figures, invoice checks, orders), and
// takes simple commands from the owner. Customers never get anything from here.

import fs from 'node:fs';
import path from 'node:path';

export const NO_REPLY = 'NO_REPLY';

export const STAFF_RULES = `You are ARYAK Assistant, the AI office assistant of ARYAK (PVC film, edge banding, glues, cabinet hardware; UAE, Oman, Iran). You are talking with a colleague of the ARYAK team, never with a customer, so you may state real stock figures.

How to write
- Reply in the language of the colleague's message (Persian, Arabic, English, Urdu). Short and professional, plain text, no headings, no emoji except a tick or warning sign when it helps. Keep codes, numbers and units as written.
- Answer only what was asked. If you are not sure, say so; never invent figures, prices, dates or customers.

What you can do
- Stock: call staff_stock for a product code (and group or size if given). Give free stock, reserved stock, the bot limit and the sizes as the tool returns them.
- Invoice checks: call recent_checks to say what was checked, for which customer and purchase order, and what was wrong.
- Purchase orders: call find_order to say whether the order of a customer or number was received.
- How you work: you read customers' purchase order PDFs in their groups, check each invoice in the invoice group against its order before it goes to the customer, and report problems in the information group. You only report; you never change the sheet, an invoice or a customer's chat.
- Prices, discounts, orders and decisions are for people: say so and suggest who should decide.

When to stay silent
- Reply exactly NO_REPLY when the message is not for you or needs no answer.`;

export const STAFF_TOOLS = [
  {
    name: 'staff_stock',
    description: 'Real stock of a product code from the Zinax sheet, with free and reserved quantities. For colleagues only.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Product code, e.g. "305" or "KG10-300".' },
        category: { type: 'string', description: 'Product group if known, e.g. "PVC film".' },
        size: { type: 'string', description: 'Thickness x width if known, e.g. "0.30*1400".' },
      },
      required: ['code'],
    },
  },
  {
    name: 'recent_checks',
    description: 'The latest invoice checks (customer, purchase order number, file, verdict and the problems found).',
    input_schema: { type: 'object', properties: { count: { type: 'number', description: 'How many, newest first; default 5, at most 20.' } } },
  },
  {
    name: 'find_order',
    description: 'Customer purchase orders received so far, found by PO number or customer name.',
    input_schema: { type: 'object', properties: { po: { type: 'string' }, customer: { type: 'string' } } },
  },
];

const words = (s) => String(s || '').toLowerCase().replace(/[‌‏]/g, ' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Is a group message for the bot? Yes when it mentions the bot, replies to a message of the bot, or says one of
 * the bot's names as a word. Everything else in a busy group is left alone.
 */
export function isAddressed({ text, mentioned = [], quotedFrom = '', ownIds = [], names = [] }) {
  const own = ownIds.filter(Boolean);
  if (mentioned.some((m) => own.includes(m))) return true;
  if (quotedFrom && own.includes(quotedFrom)) return true;
  const t = String(text || '').toLowerCase().replace(/[‌‏]/g, ' ');
  const w = new Set(words(text));
  return names.some((n) => (/\s/.test(n) ? t.includes(n) : w.has(n)));
}

const COMMANDS = {
  status: ['status', 'وضعیت'], last: ['last', 'آخرین', 'آخرین‌ها'], pause: ['pause', 'توقف'],
  resume: ['resume', 'ادامه'], staff: ['staff', 'کارکنان'], help: ['help', 'راهنما'],
};

/** "/status", "!وضعیت", or (where [bare]) just "وضعیت". Returns the command name or null. */
export function parseCommand(text, { bare = false } = {}) {
  const t = String(text || '').trim().replace(/[‌‏]/g, '').toLowerCase();
  const m = /^[/!]\s*(\S+)/.exec(t);
  const word = m ? m[1] : bare && /^\S+$/.test(t) ? t : '';
  if (!word) return null;
  return Object.keys(COMMANDS).find((k) => COMMANDS[k].some((a) => a.replace(/‌/g, '') === word)) || null;
}

/** Small switches that must survive a restart (pause). */
export class BotState {
  constructor(dir) {
    this.file = dir ? path.join(dir, 'state.json') : '';
    this.paused = false;
    try { this.paused = !!JSON.parse(fs.readFileSync(this.file, 'utf8')).paused; } catch { /* first start */ }
  }

  setPaused(v) {
    this.paused = !!v;
    if (!this.file) return;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify({ paused: this.paused })); } catch { /* best effort */ }
  }
}

const VERDICT = { match: 'درست', mismatch: 'ناهماهنگ', unreadable: 'ناخوانا', error: 'خطا', 'no-order': 'سفارش پیدا نشد' };

/** One line per recorded check, newest first. */
export function formatChecks(entries) {
  if (!entries.length) return 'هنوز بررسی‌ای ثبت نشده است.';
  return entries.map((e, i) => `${i + 1}. ${VERDICT[e.verdict] || e.verdict}، مشتری: ${e.customer || '—'}، سفارش: ${e.po || '—'}، فایل: ${e.file || '—'}` +
    (e.problems ? `، ${e.problems} مورد` : '')).join('\n');
}

/** Runs one command; [ctx]: { state, desk, staffNumbers, startedAt, now }. Returns the text to send. */
export function runCommand(cmd, ctx) {
  const { state, desk, staffNumbers = [], startedAt = Date.now(), now = Date.now() } = ctx;
  switch (cmd) {
    case 'status': {
      const last = desk.lastChecks(1)[0];
      return [
        `دستیار آریاک روشن است. ${state.paused ? '⏸ حالت توقف: به مشتری پاسخ نمی‌دهد و فاکتور بررسی نمی‌کند.' : '▶️ در حال کار.'}`,
        `مدت کار از آخرین راه‌اندازی: ${Math.round((now - startedAt) / 60000)} دقیقه`,
        `سفارش‌های نگهداری‌شده: ${desk.requests.length}`,
        `آخرین بررسی: ${last ? formatChecks([last]).replace(/^1\. /, '') : 'ندارد'}`,
      ].join('\n');
    }
    case 'last': return formatChecks(desk.lastChecks(5));
    case 'pause': state.setPaused(true); return '⏸ متوقف شد: به مشتری پاسخ نمی‌دهم و فاکتور بررسی نمی‌کنم. برای ادامه: ادامه';
    case 'resume': state.setPaused(false); return '▶️ ادامه یافت.';
    case 'staff': return staffNumbers.length ? `کارکنان شناخته‌شده:\n${staffNumbers.join('\n')}` : 'شماره‌ای ثبت نشده است.';
    default: return 'دستورها (با / یا بدون آن در گفتگوی خصوصی): وضعیت، آخرین، توقف، ادامه، کارکنان، راهنما';
  }
}

/**
 * One staff answer: Claude with the three staff tools. [handlers]: { staff_stock, recent_checks, find_order }, each
 * (input) -> object. Returns the text, or null for silence.
 */
export async function staffAnswer({ client, config, text, quoted = '', who = '', handlers }) {
  const lines = [];
  if (quoted) lines.push(`The colleague is replying to this message: "${quoted.slice(0, 600)}"`, '');
  lines.push(`Message from ${who || 'a colleague'}:`, text);
  const messages = [{ role: 'user', content: lines.join('\n') }];
  for (let round = 0; round < 6; round++) {
    const res = await client.beta.messages.create({
      model: config.model,
      max_tokens: 2000,
      system: STAFF_RULES,
      tools: STAFF_TOOLS,
      messages,
      output_config: { effort: config.effort || 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (res.stop_reason === 'refusal') return null;
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    const uses = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length) {
      const out = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return !out || out.includes(NO_REPLY) ? null : out;
    }
    messages.push({ role: 'assistant', content: res.content });
    const results = [];
    for (const use of uses) {
      let content;
      try { content = JSON.stringify(await (handlers[use.name] || (() => ({ error: 'Unknown tool' })))(use.input || {})); } catch (e) { content = JSON.stringify({ error: String(e.message || e) }); }
      results.push({ type: 'tool_result', tool_use_id: use.id, content });
    }
    messages.push({ role: 'user', content: results });
  }
  return null;
}
