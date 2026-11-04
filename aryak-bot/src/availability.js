// The customer availability flow. A customer who asks "is 408 available?" is first asked how many metres or rolls.
// With the quantity known: comfortably in stock -> "available" at once; otherwise NOTHING is said to the customer and
// the sales manager is asked in private. The customer is answered only after the manager's answer.
//
// This file holds the decisions and the memory; sending is done through functions given by the caller, so everything
// here can be tested without WhatsApp or the sheet.

import fs from 'node:fs';
import path from 'node:path';
import { detectLang } from './lang.js';
import { parseCustomerText } from './orderlines.js';
import { normalizeDigits } from './text.js';

// ---- the fixed sentences, in the customer's language ----------------------------------------------------------------
const T = {
  fa: { ask: (c) => `${c}: چند متر یا چند رول نیاز دارید؟`, askMany: 'لطفاً برای هر کد مقدار را بنویسید، مثلاً: 108 - 10 متر', ok: (c, all) => (c.length === 1 && !all ? 'موجود است.' : c.map((x) => `${x}: موجود است`).join('\n')), no: 'متأسفانه فعلاً موجود نیست.' },
  ar: { ask: (c) => `${c}: كم متر أو رول تحتاج؟`, askMany: 'يرجى كتابة الكمية لكل كود، مثال: 108 - 10 متر', ok: (c, all) => (c.length === 1 && !all ? 'متوفر.' : c.map((x) => `${x}: متوفر`).join('\n')), no: 'عذرًا، غير متوفر حاليًا.' },
  en: { ask: (c) => `${c}: how many metres or rolls do you need?`, askMany: 'Please send the quantity for each code, for example: 108 - 10 mtr', ok: (c, all) => (c.length === 1 && !all ? 'Available.' : c.map((x) => `${x}: available`).join('\n')), no: 'Sorry, not available at the moment.' },
  ur: { ask: (c) => `${c}: آپ کو کتنے میٹر یا رول چاہئیں؟`, askMany: 'براہِ کرم ہر کوڈ کی مقدار لکھیں، مثلاً: 108 - 10 میٹر', ok: (c, all) => (c.length === 1 && !all ? 'دستیاب ہے۔' : c.map((x) => `${x}: دستیاب ہے`).join('\n')), no: 'معذرت، فی الحال دستیاب نہیں۔' },
};
const words = (lang) => T[lang === 'hi' || !T[lang] ? 'en' : lang];
export const askQuantityText = (lang, codes) => (codes.length === 1 ? words(lang).ask(codes[0]) : words(lang).askMany);
/** [named]: say the code even for one (when the message had several lines, which one was meant must be clear). */
export const availableText = (lang, codes, named = false) => words(lang).ok(codes, named);
export const notAvailableText = (lang) => words(lang).no;

// ---- a quantity typed as the answer ----------------------------------------------------------------------------------
const UNITS = { m: 'm', mtr: 'm', mtrs: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm', متر: 'm', میٹر: 'm', roll: 'roll', rolls: 'roll', رول: 'roll', pcs: 'pcs', pc: 'pcs', piece: 'pcs', pieces: 'pcs', عدد: 'pcs', carton: 'carton', cartons: 'carton', کارتن: 'carton' };

/**
 * "15", "15 mtr", "2 rolls please", "10 متر" -> { quantity, unit }; null otherwise. A bare number counts only up to two
 * digits (metres); a longer bare number is more likely a product code and is read as a new question instead.
 */
export function parseQuantity(text) {
  const s = normalizeDigits(String(text || '')).toLowerCase().replace(/[،؟?!]+/g, ' ').replace(/\.+(\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 40) return null;
  const withUnit = /^(?:need\s+|i\s+need\s+|about\s+|around\s+|تقریباً\s+)?(\d+(?:\.\d+)?)\s*(m|mtrs?|meters?|metres?|rolls?|pcs?|pieces?|cartons?|متر|میٹر|رول|عدد|کارتن)(?:\s+(?:please|pls|only|فقط))?$/.exec(s);
  if (withUnit) return { quantity: Number(withUnit[1]), unit: UNITS[withUnit[2]] || withUnit[2] };
  const bare = /^(\d{1,2}(?:\.\d+)?)(?:\s+(?:please|pls))?$/.exec(s);
  return bare ? { quantity: Number(bare[1]), unit: 'm' } : null;
}

// ---- the decision on one order line ------------------------------------------------------------------------------------
/**
 * [res]: the sheet's answer for the code and the quantity asked. 'ok' when the request is within the free stock and
 * what remains is at least the minimum; 'manager' when not (or when the quantity could not be turned into metres);
 * 'unhandled' when the code is unknown or in several groups (the normal answer deals with that).
 */
export function classify(res) {
  if (!res?.found || res.ambiguous || res.sizeFound === false) return { kind: 'unhandled' };
  const asked = Number(res.askedInUnit) || 0;
  if (res.qtyChecked === false) return { kind: 'manager', res };
  if (!asked) return { kind: 'unhandled' };
  const free = Number(res.free) || 0;
  const min = Number(res.limit) || 0;
  return asked <= free + 1e-6 && free - asked >= min - 1e-6 ? { kind: 'ok', res } : { kind: 'manager', res };
}

// ---- what the sales manager reads ----------------------------------------------------------------------------------------
const n = (x) => String(Math.round(Number(x) * 100) / 100);

/** The private question to the sales manager (Persian). Numbers and codes exactly as in the sheet. */
export function managerQuestion(req) {
  const r = req.res;
  const lines = [
    `⚠️ درخواست #${req.id}: موجودی برای پاسخ به مشتری کافی نیست`,
    `مشتری: ${req.customer || req.groupName || '—'}${req.groupName && req.groupName !== req.customer ? `\nگروه: ${req.groupName}` : ''}`,
    `کد: ${r.code}${r.category ? ` (${r.category})` : ''}`,
    `مقدار درخواست: ${n(req.line.quantity)} ${req.line.unit}${r.askedUnit && r.askedUnit !== r.unit && r.askedInUnit ? ` (= ${n(r.askedInUnit)} ${r.unit})` : ''}`,
  ];
  if (r.qtyChecked === false) lines.push('واحد درخواست به متر تبدیل نشد؛ مقدار هر رول در برگه نیست.');
  lines.push(`موجودی آزاد: ${n(r.free)} ${r.unit}`, `رزرو: ${n(r.reserved || 0)} ${r.unit}`, `حداقل موجودی: ${n(r.limit)} ${r.unit}`, '',
    'آیا اجازه می‌دهید به مشتری «موجود است» بگویم، یا خودتان جواب می‌دهید؟',
    `پاسخ با «#${req.id} بله» یا «#${req.id} نه» یا «#${req.id} خودم»، یا متن پاسخ را بنویسید (روی همین پیام پاسخ بدهید یا شمارهٔ #${req.id} را اول بنویسید).`);
  return lines.join('\n');
}

const SELF = ['خودم', 'خودم جواب میدم', 'خودم جواب می دهم', 'self', 'me', 'i will answer', 'i answer', 'أنا', 'انا', 'میں خود'];

/**
 * The manager's answer: { id, action: 'yes'|'no'|'self'|'text', text }. [id] comes from "#12 ..." at the start; null
 * when absent (the caller may know it from the message that was replied to). [yesNo] decides "yes" and "no" words.
 */
export function parseManagerReply(text, yesNo) {
  const s = normalizeDigits(String(text || '')).trim();
  const m = /^#\s*(\d+)\s*[:\-,،]?\s*([\s\S]*)$/.exec(s);
  const id = m ? Number(m[1]) : null;
  const body = (m ? m[2] : s).trim();
  if (!body) return { id, action: 'none', text: '' };
  if (SELF.includes(body.toLowerCase().replace(/[.!؟?]+$/g, '').trim())) return { id, action: 'self', text: body };
  const kind = yesNo(body);
  if (kind === 'yes') return { id, action: 'yes', text: body };
  if (kind === 'no') return { id, action: 'no', text: body };
  return { id, action: 'text', text: body };
}

// ---- the memory ------------------------------------------------------------------------------------------------------------
export class AvailabilityDesk {
  constructor({ dir = '', qtyTtlMs = 30 * 60 * 1000, remindMs = 15 * 60 * 1000 } = {}) {
    Object.assign(this, { dir, qtyTtlMs, remindMs });
    this.qty = new Map(); // "group|sender" -> { code, lang, at }
    this.open = new Map(); // id -> request (see openRequest)
    this.byMessage = new Map(); // WhatsApp id of the question to the manager -> request id
    this.nextId = 1;
    this.load();
  }

  setQty(key, value, now = Date.now()) { this.qty.set(key, { ...value, at: now }); }

  pendingQty(key, now = Date.now()) {
    const p = this.qty.get(key);
    if (!p) return null;
    if (now - p.at > this.qtyTtlMs) { this.qty.delete(key); return null; }
    return p;
  }

  clearQty(key) { this.qty.delete(key); }

  /** A new question for the manager; the same group and code asked again while open reuses the open one. */
  openRequest({ groupId, groupName, customer, lang, line, res, quoted }, now = Date.now()) {
    for (const r of this.open.values()) {
      if (r.groupId === groupId && String(r.res.code).toLowerCase() === String(res.code).toLowerCase() && r.line.quantity === line.quantity) return { ...r, existing: true };
    }
    const req = { id: this.nextId++, groupId, groupName, customer, lang, line, res: slim(res), at: now, reminded: false, quoted };
    this.open.set(req.id, req);
    this.save();
    return req;
  }

  linkMessage(messageId, id) { if (messageId) this.byMessage.set(messageId, id); }

  /** The request a reply belongs to: the one it quotes, else the one it names, else the only open one (when [allowSingle]). */
  find({ quotedId, id, allowSingle }) {
    if (quotedId && this.byMessage.has(quotedId)) return this.open.get(this.byMessage.get(quotedId)) || null;
    if (id && this.open.get(id)) return this.open.get(id);
    if (allowSingle && this.open.size === 1) return [...this.open.values()][0];
    return null;
  }

  close(id) { this.open.delete(id); this.save(); }

  /** Open requests older than the reminder time that were not reminded yet (they are marked). */
  dueReminders(now = Date.now()) {
    const due = [...this.open.values()].filter((r) => !r.reminded && now - r.at >= this.remindMs);
    due.forEach((r) => { r.reminded = true; });
    if (due.length) this.save();
    return due;
  }

  save() {
    if (!this.dir) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, 'manager-requests.json'), JSON.stringify({ nextId: this.nextId, open: [...this.open.values()].map(({ quoted, ...r }) => r) }));
    } catch { /* best effort */ }
  }

  load() {
    if (!this.dir) return;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(this.dir, 'manager-requests.json'), 'utf8'));
      this.nextId = j.nextId || 1;
      for (const r of j.open || []) this.open.set(r.id, r);
    } catch { /* first start */ }
  }
}

/** Only what the question and the later answer need from the sheet's result. */
const slim = (r) => ({ code: r.code, category: r.category, unit: r.unit, free: r.free, reserved: r.reserved, limit: r.limit, qtyChecked: r.qtyChecked, askedUnit: r.askedUnit, askedInUnit: r.askedInUnit });

// ---- the customer's messages ---------------------------------------------------------------------------------------------
/**
 * Goes through a batch of customer messages. [decide](line) -> { kind, res } from classify(); [send](groupId, text, m)
 * answers the customer in the thread of message [m]; [notifyManager](req) sends the question and returns the id of the
 * message sent; [log](text) writes a decision (never the message text).
 * Returns { rest }: the messages this flow did not deal with, left to the normal answer.
 */
export async function runAvailability({ messages, groupId, groupName, customer, desk, decide, send, notifyManager, log = () => {}, now = Date.now() }) {
  const rest = [];
  for (const m of messages) {
    const key = `${groupId}|${m.sender || ''}`;
    const text = m.text || '';
    let lang = m.lang || detectLang(text, 'en');
    let lines = null;
    let asks = null;
    if (m.items) {
      lines = m.items.filter((i) => i.quantity).map((i) => ({ code: i.code, quantity: i.quantity, unit: i.unit || 'm' }));
      asks = m.items.filter((i) => !i.quantity).map((i) => i.code);
      if (lines.length) asks = null; // a list with quantities: the lines without one are left for the normal answer
      if (!lines.length) lines = null;
    } else {
      const pending = desk.pendingQty(key, now);
      const q = pending && parseQuantity(text);
      if (pending && q) {
        lines = [{ code: pending.code, quantity: q.quantity, unit: q.unit }];
        lang = pending.lang;
        desk.clearQty(key);
      } else {
        const parsed = parseCustomerText(text);
        if (parsed.kind === 'order') lines = parsed.lines;
        else if (parsed.kind === 'availability') asks = parsed.codes;
      }
    }
    if (!lines && !(asks && asks.length)) { rest.push(m); continue; }
    if (!lines) {
      if (asks.length === 1) desk.setQty(key, { code: asks[0], lang }, now);
      await send(groupId, askQuantityText(lang, asks), m);
      log(`asked the customer for the quantity (${asks.length} code(s)), language ${lang}`);
      continue;
    }
    const ok = [];
    const toManager = [];
    const unhandled = [];
    for (const line of lines) {
      const d = await decide(line);
      if (d.kind === 'ok') ok.push(line);
      else if (d.kind === 'manager') toManager.push({ line, res: d.res });
      else unhandled.push(line);
    }
    if (!ok.length && !toManager.length) { rest.push(m); continue; }
    if (ok.length) {
      await send(groupId, availableText(lang, ok.map((l) => l.code), lines.length > 1), m);
      log(`answered available for ${ok.length} line(s), language ${lang}`);
    }
    for (const { line, res } of toManager) {
      const req = desk.openRequest({ groupId, groupName, customer, lang, line, res, quoted: m }, now);
      if (req.existing) { log(`request #${req.id} already waits for the manager`); continue; }
      const messageId = await notifyManager(req);
      desk.linkMessage(messageId, req.id);
      log(`request #${req.id} sent to the sales manager; the customer is told nothing yet`);
    }
    // Lines the flow cannot judge (an unknown code, a code in two groups) go on to the normal answer, alone.
    if (unhandled.length) rest.push({ ...m, text: unhandled.map((l) => `${l.code} - ${l.quantity} ${l.unit}`).join('\n'), items: undefined });
  }
  return { rest };
}

/**
 * The manager's answer to a request. [translate](text, lang) -> text for the customer; [send](req, text) writes to the
 * customer's group. Returns a short Persian confirmation for the manager.
 */
export async function answerRequest({ req, reply, desk, send, translate, log = () => {} }) {
  if (reply.action === 'self') { desk.close(req.id); log(`request #${req.id}: the manager answers himself, silent in the group`); return `باشه، #${req.id} را خودتان جواب می‌دهید و در گروه چیزی نمی‌گویم.`; }
  if (reply.action === 'yes') { await send(req, availableText(req.lang, [req.res.code])); desk.close(req.id); log(`request #${req.id}: told the customer available`); return `به مشتری «موجود است» گفتم (#${req.id}).`; }
  if (reply.action === 'no') { await send(req, notAvailableText(req.lang)); desk.close(req.id); log(`request #${req.id}: told the customer not available`); return `به مشتری «فعلاً موجود نیست» گفتم (#${req.id}).`; }
  if (reply.action === 'text') {
    const out = await translate(reply.text, req.lang);
    await send(req, out);
    desk.close(req.id);
    log(`request #${req.id}: the manager's own words were passed on, language ${req.lang}`);
    return `متن شما را به مشتری رساندم (#${req.id}).`;
  }
  return `پاسخ #${req.id} را نفهمیدم؛ بنویسید بله، نه، خودم، یا متن پاسخ.`;
}

/** The reminder to the manager for a request that has waited. */
export const reminderText = (req) => `یادآوری: درخواست #${req.id} (کد ${req.res.code}، ${req.customer || req.groupName || '—'}) هنوز بی‌پاسخ است. به مشتری چیزی گفته نشده.`;
