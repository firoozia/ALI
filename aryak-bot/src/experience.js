// The assistant's experience: what she sees in the groups, kept as counters and short anonymous shapes, never as
// messages. Nothing here changes how she behaves by itself: candidate examples wait in a review list, and only what the
// owner approves ("بپذیر 3") enters the prompt, in a versioned list that can be rolled back.
//
// What is kept: language, kind of message, kind of answer, delays, counts, per group and per week (13 weeks), and
// "shapes": a message reduced to the few words that carry its pattern, every other word and every number replaced
// ("# available ?", "_ - # mtr also"). No name, number, price, phone, address, photo or voice ever reaches the store.

import fs from 'node:fs';
import path from 'node:path';
import { detectLang } from './lang.js';
import { parseCustomerText } from './orderlines.js';
import { normalizeDigits, normalizeLetters } from './text.js';

const DAY = 24 * 3600 * 1000;
const WEEKS_KEPT = 13; // about 90 days

// ---- shapes ----------------------------------------------------------------------------------------------------------------

const KEEP = new Set([
  'available', 'avail', 'stock', 'please', 'pls', 'kindly', 'add', 'also', 'mtr', 'mtrs', 'meter', 'meters', 'metre', 'metres', 'm', 'roll', 'rolls', 'pcs', 'carton', 'invoice',
  'send', 'code', 'yes', 'no', 'ok', 'sorry', 'limited', 'not', 'thanks', 'thank', 'you', 'the', 'is', 'are', 'in', 'do', 'have', 'need', 'what', 'how', 'many', 'same', 'separate',
  'price', 'deliver', 'delivery', 'pickup', 'paid', 'payment', 'cheque', 'transfer', 'damaged', 'wrong', 'problem', 'sure', 'color', 'colour',
  'هل', 'متوفر', 'موجود', 'متاح', 'كم', 'متر', 'رول', 'فاتورة', 'شكرا', 'لا', 'نعم', 'من', 'فضلك', 'اضافة', 'ايضا', 'كود', 'مشكلة', 'خطا', 'تسليم', 'دفع', 'سعر',
  'کیا', 'دستیاب', 'ہے', 'ہاں', 'نہیں', 'شکریہ', 'فاکتور', 'کوڈ', 'میٹر', 'قیمت',
  'آیا', 'موجوده', 'هست', 'نیست', 'ممنون', 'بله', 'نه', 'لطفا', 'کد', 'محدود', 'تحویل', 'پرداخت', 'چک', 'مشکل', 'خراب', 'قیمت', 'رنگ',
].map((w) => normalizeLetters(w)));

/** A message as a pattern. Max [max] characters; only words of the small vocabulary survive, numbers become "#", the rest "_". */
export function shape(text, max = 60) {
  const s = normalizeDigits(String(text || '')).replace(/https?:\/\/\S+|\S+@\S+/g, ' ');
  const tokens = normalizeLetters(s).split(/(\?|؟|[-–—,.!]|\s+)/u).filter((t) => t && !/^\s+$/.test(t));
  const out = [];
  for (const t of tokens) {
    let x;
    if (t === '؟') x = '?';
    else if (/^[?\-–—,.!]$/.test(t)) x = t === '–' || t === '—' ? '-' : t;
    else if (t === '#' || /\d/.test(t)) x = '#'; // a shape put through again stays the same
    else if (KEEP.has(t)) x = t;
    else x = '_';
    if (x === '_' && out.at(-1) === '_') continue;
    if (x === '#' && out.at(-1) === '#') continue;
    out.push(x);
  }
  return out.join(' ').replace(/ ([?,.!])/g, ' $1').slice(0, max).trim();
}

// ---- reading a message -----------------------------------------------------------------------------------------------------

// a whole word (or its plural "s"), so that "m" does not match every word that starts with m
const has = (text, words) => { const t = normalizeLetters(text); return words.some((w) => new RegExp(`(^|[^\\p{L}])${normalizeLetters(w)}s?($|[^\\p{L}])`, 'u').test(t)); };

/** What a customer's message is: availability, order, addon, invoice, delivery, payment, complaint, thanks, question, other. */
export function classifyIntent(text) {
  const p = parseCustomerText(text);
  if (p.kind === 'order') return p.lines.some((l) => l.addOn) ? 'addon' : 'order';
  if (p.kind === 'availability') return 'availability';
  if (has(text, ['damaged', 'wrong', 'complain', 'problem', 'defect', 'مشکل', 'خراب', 'شكوى', 'مشكلة', 'خطا', 'غلط'])) return 'complaint';
  if (has(text, ['invoice', 'فاتورة', 'فاکتور', 'فاکتور'])) return 'invoice';
  if (has(text, ['deliver', 'delivery', 'pickup', 'pick up', 'courier', 'تحویل', 'تسليم', 'توصيل'])) return 'delivery';
  if (has(text, ['cheque', 'transfer', 'paid', 'payment', 'receipt', 'دفع', 'پرداخت', 'واریز', 'حواله', 'چک'])) return 'payment';
  if (has(text, ['available', 'availble', 'avilable', 'avail', 'stock', 'متوفر', 'موجود', 'دستیاب', 'متاح'])) return 'availability';
  if (has(text, ['thanks', 'thank you', 'شكرا', 'ممنون', 'شکریہ', 'مرسی'])) return 'thanks';
  if (/[?؟]/.test(text)) return 'question';
  return 'other';
}

/** What kind of answer a colleague gave: yes, no, limited, quantity, ask, file, other. */
export function classifyAnswer(text, { media = false } = {}) {
  if (media && !String(text || '').trim()) return 'file';
  const t = String(text || '');
  if (has(t, ['limited', 'محدود', 'محدودة'])) return 'limited';
  if (has(t, ['not available', 'unavailable', 'sorry', 'no stock', 'نیست', 'غير متوفر', 'نہیں'])) return 'no';
  if (/\d/.test(normalizeDigits(t)) && has(t, ['m', 'mtr', 'meter', 'metre', 'متر', 'roll', 'رول', 'میٹر'])) return 'quantity';
  if (has(t, ['available', 'yes', 'sure', 'ok', 'موجود', 'متوفر', 'بله', 'نعم', 'ہاں', 'دستیاب'])) return 'yes';
  if (/[?؟]/.test(t) || has(t, ['kindly send', 'send the code', 'which', 'کدام', 'أي'])) return 'ask';
  return 'other';
}

const LEN = (t) => { const n = String(t || '').length; return n <= 12 ? 's' : n <= 60 ? 'm' : 'l'; };

// ---- the store -----------------------------------------------------------------------------------------------------------------

const weekStart = (ms) => { const d = new Date(ms); const day = (d.getUTCDay() + 6) % 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10); };

export class Experience {
  constructor({ dir = '', now = () => Date.now() } = {}) {
    this.dir = dir;
    this.now = now;
    this.on = true;
    this.weeks = {}; // week start -> { key: count }
    this.candidates = []; // review list
    this.nextId = 1;
    this.versions = []; // approved entries, one snapshot per approval or rollback
    this.version = 0; // index into versions (+1), 0 = nothing approved
    this.lastReport = '';
    this.open = new Map(); // group -> recent unanswered customer messages (memory only)
    this.dirty = false;
    this.load();
  }

  // -- counters
  bump(key, n = 1) {
    const wk = weekStart(this.now());
    const w = (this.weeks[wk] ||= {});
    w[key] = (w[key] || 0) + n;
    this.dirty = true;
    const keys = Object.keys(w);
    if (keys.length > 3000) { // drop the rarest
      for (const k of keys.sort((a, b) => w[a] - w[b]).slice(0, 300)) delete w[k];
    }
  }

  /** Sum of a counter over the last [weeks] weeks (this one included). */
  total(key, weeks = 1) {
    const cutoff = this.now() - (weeks - 1) * 7 * DAY;
    return Object.entries(this.weeks).filter(([wk]) => Date.parse(wk) >= Date.parse(weekStart(cutoff))).reduce((s, [, w]) => s + (w[key] || 0), 0);
  }

  keysOf(prefix, weeks = 1) {
    const cutoff = Date.parse(weekStart(this.now() - (weeks - 1) * 7 * DAY));
    const m = new Map();
    for (const [wk, w] of Object.entries(this.weeks)) if (Date.parse(wk) >= cutoff) for (const [k, v] of Object.entries(w)) if (k.startsWith(prefix)) m.set(k, (m.get(k) || 0) + v);
    return m;
  }

  // -- watching
  /** A customer's message in [group]. [media]: 'photo' | 'voice' | '' (the content itself is never looked at here). */
  customer(group, text, { media = '' } = {}) {
    if (!this.on) return;
    const t = String(text || '');
    const intent = media && !t.trim() ? media : classifyIntent(t);
    const lang = t.trim() ? detectLang(t, 'en') : 'media';
    this.bump(`i|${intent}|${lang}`);
    this.bump(`g|${group}|${lang}`);
    const parsed = parseCustomerText(t);
    for (const l of parsed.lines) { this.bump(`p|${group}|unit|${l.unit}`); this.bump(`p|${group}|code|${l.code}`); }
    for (const c of parsed.codes) this.bump(`p|${group}|code|${c}`);
    if (['availability', 'order', 'addon', 'invoice', 'delivery', 'complaint', 'question', 'other'].includes(intent) && t.trim().length > 2) {
      const list = this.open.get(group) || [];
      list.push({ at: this.now(), intent, lang, shape: shape(t), answered: false, bot: false });
      this.open.set(group, list.slice(-5));
    }
  }

  /** A colleague's message in [group]: it answers the oldest still-open question of the last hour. */
  staff(group, text, { media = false } = {}) {
    if (!this.on) return;
    const list = (this.open.get(group) || []).filter((q) => this.now() - q.at < 60 * 60 * 1000);
    this.open.set(group, list);
    const q = list.find((x) => !x.answered);
    if (!q) return;
    q.answered = true;
    const type = classifyAnswer(text, { media });
    const secs = Math.round((this.now() - q.at) / 1000);
    this.bump(`a|${q.intent}|${type}`);
    this.bump(`al|${q.intent}|${LEN(text)}`);
    this.bump(`mq|${group}|${q.lang}`);
    this.bump(q.bot ? `mb|${group}|${q.lang}` : `ms|${group}|${q.lang}`);
    this.bump(`ml|${group}|${q.lang}`, secs);
    this.bump(`mn|${group}|${q.lang}`);
    // A message she did not understand that a colleague answered with a real answer: worth looking at.
    if (q.intent === 'other' && !['other', 'file'].includes(type) && q.shape.replace(/[_\s?.,!-]/g, '')) this.candidate({ kind: 'phrasing', shape: q.shape, lang: q.lang, answerType: type });
  }

  /** She answered in [group] (the answer is not kept): the open questions of the last ten minutes were answered by her. */
  bot(group) {
    if (!this.on) return;
    for (const q of this.open.get(group) || []) if (!q.answered && this.now() - q.at < 10 * 60 * 1000) { q.answered = true; q.bot = true; this.bump(`mq|${group}|${q.lang}`); this.bump(`mb|${group}|${q.lang}`); }
  }

  /** A colleague corrected her answer in [group]. */
  corrected(group, lang = 'fa') { if (this.on) { this.bump(`mc|${group}|${lang}`); } }

  // -- the review list
  candidate(c) {
    const keyOf = (x) => [x.kind, x.shape, x.answerType, x.lang, x.wrong, x.right, x.to, x.intent, x.customer, x.alias].join('|');
    const same = this.candidates.find((x) => x.status === 'open' && keyOf(x) === keyOf(c));
    if (same) { same.count++; same.lastAt = this.now(); this.dirty = true; return same; }
    const entry = { id: this.nextId++, status: 'open', count: 1, priority: c.kind === 'correction' ? 2 : 1, firstAt: this.now(), lastAt: this.now(), ...c };
    this.candidates.push(entry);
    if (this.candidates.length > 500) this.candidates = this.candidates.filter((x) => x.status === 'open').slice(-400);
    this.dirty = true;
    return entry;
  }

  /** The open ones, corrections first, then by how often they were seen. */
  review(limit = 10) {
    return this.candidates.filter((c) => c.status === 'open').sort((a, b) => b.priority - a.priority || b.count - a.count).slice(0, limit);
  }

  decide(id, approve) {
    const c = this.candidates.find((x) => x.id === id && x.status === 'open');
    if (!c) return null;
    c.status = approve ? 'approved' : 'rejected';
    if (approve) {
      const current = this.approved();
      this.versions = [...this.versions.slice(0, this.version), [...current, { id: c.id, kind: c.kind, shape: c.shape, lang: c.lang, answerType: c.answerType, wrong: c.wrong, right: c.right, to: c.to, intent: c.intent, customer: c.customer, alias: c.alias }]];
      this.version = this.versions.length;
    }
    this.dirty = true;
    return c;
  }

  approved() { return this.version ? this.versions[this.version - 1] : []; }

  /** One step back to the version before the current one (the later versions stay for a step forward). */
  rollback() { if (this.version === 0) return false; this.version--; this.dirty = true; return true; }

  /** The approved entries as lines for the prompt. */
  promptText() {
    const lines = this.approved().map((e) => (e.kind === 'correction'
      ? `- When you answered "${String(e.wrong).replace(/\s+/g, ' ').slice(0, 160)}", a colleague corrected it: "${String(e.right).replace(/\s+/g, ' ').slice(0, 200)}".`
      : e.kind === 'routing' ? `- A request that looks like "${e.shape}" is usually posted in the group "${e.to}".`
        : e.kind === 'pattern' ? `- In ${e.lang}, a ${e.intent} message is usually answered with: ${e.answerType}.`
          : e.kind === 'alias' ? ''
            : `- Customers (${e.lang}) sometimes write like "${e.shape}"; colleagues answer with: ${e.answerType}.`)).filter(Boolean);
    return lines.length ? `# Learned from colleagues (approved by the owner)\n\n${lines.join('\n')}` : '';
  }

  // -- keeping it small and on disk
  purge() {
    const cutoff = Date.parse(weekStart(this.now() - (WEEKS_KEPT - 1) * 7 * DAY));
    for (const wk of Object.keys(this.weeks)) if (Date.parse(wk) < cutoff) delete this.weeks[wk];
    this.candidates = this.candidates.filter((c) => c.status !== 'open' || this.now() - c.lastAt < 90 * DAY);
    this.dirty = true;
  }

  save() {
    if (!this.dir || !this.dirty) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, 'experience.json'), JSON.stringify({ on: this.on, weeks: this.weeks, candidates: this.candidates, nextId: this.nextId, versions: this.versions, version: this.version, lastReport: this.lastReport }));
      this.dirty = false;
    } catch { /* best effort */ }
  }

  load() {
    if (!this.dir) return;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(this.dir, 'experience.json'), 'utf8'));
      Object.assign(this, { on: j.on !== false, weeks: j.weeks || {}, candidates: j.candidates || [], nextId: j.nextId || 1, versions: j.versions || [], version: j.version || 0, lastReport: j.lastReport || '' });
      this.purge();
    } catch { /* first start */ }
  }
}

// ---- what the owner reads ---------------------------------------------------------------------------------------------------------

const INTENT_FA = { availability: 'پرسش موجودی', order: 'سفارش', addon: 'افزودن به سفارش', invoice: 'فاکتور', delivery: 'تحویل', payment: 'پرداخت', complaint: 'شکایت', thanks: 'تشکر', question: 'پرسش دیگر', other: 'نامشخص', photo: 'عکس', voice: 'صوت' };
const ANSWER_FA = { yes: 'بله / موجود', no: 'نه / موجود نیست', limited: 'محدود', quantity: 'گفتن مقدار', ask: 'پرسش برگشتی', file: 'فایل', other: 'پاسخ دیگر' };
const LANG_FA = { fa: 'فارسی', ar: 'عربی', en: 'انگلیسی', ur: 'اردو', hi: 'هندی', media: 'بدون متن' };
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} درصد` : '—');
const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

/** Per group and language, this week: questions, share answered by her alone, by colleagues, corrected, average delay. */
export function metrics(exp, weeks = 1) {
  const rows = new Map();
  const get = (g, l) => { const k = `${g}|${l}`; if (!rows.has(k)) rows.set(k, { group: g, lang: l, q: 0, bot: 0, staff: 0, corrected: 0, lat: 0, n: 0 }); return rows.get(k); };
  const feed = (prefix, field) => { for (const [k, v] of exp.keysOf(prefix, weeks)) { const [, g, l] = k.split('|'); get(g, l)[field] += v; } };
  feed('mq|', 'q'); feed('mb|', 'bot'); feed('ms|', 'staff'); feed('mc|', 'corrected'); feed('ml|', 'lat'); feed('mn|', 'n');
  return [...rows.values()].map((r) => ({ ...r, avgSeconds: r.n ? Math.round(r.lat / r.n) : null })).sort((a, b) => b.q - a.q);
}

/** The weekly report. [errors]: invoice problem kinds seen this week ({ kind: count }), if any. */
export function learnedReport(exp, { errors = {} } = {}) {
  const lines = ['گزارش «چه یاد گرفتم» این هفته'];
  const intents = top(exp.keysOf('i|', 1), 20);
  const byIntent = new Map();
  for (const [k, v] of intents) { const [, intent] = k.split('|'); byIntent.set(intent, (byIntent.get(intent) || 0) + v); }
  const total = [...byIntent.values()].reduce((s, v) => s + v, 0);
  lines.push(`پیام‌های مشتری دیده‌شده: ${total}`);
  for (const [intent, n] of top(byIntent, 6)) lines.push(`- ${INTENT_FA[intent] || intent}: ${n}`);
  const langs = new Map();
  for (const [k, v] of exp.keysOf('i|', 1)) { const l = k.split('|')[2]; langs.set(l, (langs.get(l) || 0) + v); }
  if (langs.size) lines.push('', `زبان‌ها: ${top(langs, 5).map(([l, n]) => `${LANG_FA[l] || l} ${n}`).join('، ')}`);
  const answers = top(exp.keysOf('a|', 1), 6);
  if (answers.length) lines.push('', 'پاسخ همکاران:', ...answers.map(([k, v]) => { const [, i, a] = k.split('|'); return `- ${INTENT_FA[i] || i}: ${ANSWER_FA[a] || a} ${v} بار`; }));
  const ms = metrics(exp, 1);
  if (ms.length) {
    lines.push('', 'کیفیت (هر گروه و زبان):');
    for (const r of ms.slice(0, 8)) lines.push(`- ${r.group} (${LANG_FA[r.lang] || r.lang}): ${r.q} پرسش، بدون کمک همکار ${pct(r.bot, r.q)}، اصلاح‌شده ${pct(r.corrected, r.q)}${r.avgSeconds !== null ? `، میانگین زمان پاسخ ${Math.round(r.avgSeconds / 60)} دقیقه` : ''}`);
    const slow = ms.filter((r) => r.avgSeconds !== null && r.avgSeconds > 30 * 60 && r.n >= 3);
    if (slow.length) lines.push('', `جاهای کند: ${slow.map((r) => `${r.group} (${Math.round(r.avgSeconds / 60)} دقیقه)`).join('، ')}`);
  }
  const fresh = exp.review(5);
  if (fresh.length) lines.push('', 'پیشنهادهای در انتظار بررسی شما:', ...fresh.map((c) => describeCandidate(c)), 'پاسخ: «بپذیر ۳» یا «رد ۳»');
  const errs = Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (errs.length) lines.push('', `ایرادهای تکراری فاکتور: ${errs.map(([k, v]) => `${k} ${v}`).join('، ')}`);
  const prefs = groupPreferences(exp, 1);
  if (prefs.length) lines.push('', 'عادت هر گروه (فقط برای فهمیدن بهتر):', ...prefs.slice(0, 6));
  if (lines.length === 2 && !total) lines.push('این هفته چیزی دیده نشد.');
  return lines.join('\n');
}

/** Per group: the usual language, unit and the codes asked about most. */
export function groupPreferences(exp, weeks = 4) {
  const per = new Map();
  for (const [k, v] of exp.keysOf('p|', weeks)) { const [, g, kind, val] = k.split('|'); const e = per.get(g) || { unit: new Map(), code: new Map() }; if (kind === 'unit' || kind === 'code') e[kind].set(val, (e[kind].get(val) || 0) + v); per.set(g, e); }
  const lang = new Map();
  for (const [k, v] of exp.keysOf('g|', weeks)) { const [, g, l] = k.split('|'); const m = lang.get(g) || new Map(); m.set(l, (m.get(l) || 0) + v); lang.set(g, m); }
  return [...new Set([...per.keys(), ...lang.keys()])].map((g) => {
    const p = per.get(g);
    const l = lang.get(g) ? top(lang.get(g), 1)[0][0] : '';
    return `- ${g}: ${l ? `زبان ${LANG_FA[l] || l}` : ''}${p?.unit.size ? `، واحد ${top(p.unit, 1)[0][0]}` : ''}${p?.code.size ? `، کدهای رایج ${top(p.code, 3).map(([c]) => c).join(' و ')}` : ''}`;
  });
}

export function describeCandidate(c) {
  if (c.kind === 'routing') return `${c.id}. مسیر پیام (${c.count} بار)${c.imported ? '، از فایل بیرونی' : ''}: «${c.shape}» ⟵ گروه «${c.to}»`;
  if (c.kind === 'pattern') return `${c.id}. الگوی پاسخ (${LANG_FA[c.lang] || c.lang}، ${c.count} بار)${c.imported ? '، از فایل بیرونی' : ''}: ${INTENT_FA[c.intent] || c.intent} ⟵ ${ANSWER_FA[c.answerType] || c.answerType}`;
  if (c.kind === 'alias') return `${c.id}. نام دیگر مشتری${c.imported ? ' (از فایل بیرونی)' : ''}: ${c.customer} = ${c.alias}`;
  return c.kind === 'correction'
    ? `${c.id}. اصلاح همکار (اولویت بالا): «${String(c.wrong).replace(/\s+/g, ' ').slice(0, 70)}» ⟵ «${String(c.right || '').slice(0, 90)}»`
    : `${c.id}. عبارت تازه (${LANG_FA[c.lang] || c.lang}، ${c.count} بار): «${c.shape}» ⟵ پاسخ همکار: ${ANSWER_FA[c.answerType] || c.answerType}`;
}

/**
 * A file of patterns from outside (the owner's chats read by a person, shapes only): every entry goes to the review list,
 * none is applied. Strings are cut down to shapes again here, so a number or a name that slipped in cannot be kept.
 * Format: docs/LEARNING_IMPORT_FORMAT.md.
 */
export function importPatterns(exp, data) {
  const out = { phrasings: 0, routing: 0, patterns: 0, aliases: 0, skipped: 0 };
  if (!data || typeof data !== 'object' || data.version !== 1) return { ...out, error: 'unsupported file' };
  const LANGS = ['fa', 'ar', 'en', 'ur', 'hi'];
  const INTENTS = ['availability', 'order', 'addon', 'invoice', 'delivery', 'payment', 'complaint', 'thanks', 'question', 'other'];
  const ANSWERS = ['yes', 'no', 'limited', 'quantity', 'ask', 'file', 'other'];
  const cnt = (v) => Math.max(1, Math.min(10000, Number(v) || 1));
  const safe = (s) => { const x = shape(s); return x && x.replace(/[_\s#?.,!-]/g, '') ? x : ''; };
  const add = (entry, field) => { exp.candidate(entry); out[field]++; };
  for (const p of Array.isArray(data.phrasings) ? data.phrasings : []) {
    const sh = safe(p?.shape);
    if (!sh || !LANGS.includes(p.lang) || !ANSWERS.includes(p.answerType)) { out.skipped++; continue; }
    add({ kind: 'phrasing', shape: sh, lang: p.lang, answerType: p.answerType, count: cnt(p.count), imported: true }, 'phrasings');
  }
  for (const r of Array.isArray(data.routing) ? data.routing : []) {
    const sh = safe(r?.trigger);
    const to = String(r?.to || '').replace(/[^\p{L}\p{N} ]/gu, '').trim().slice(0, 40);
    if (!sh || !to) { out.skipped++; continue; }
    add({ kind: 'routing', shape: sh, to, count: cnt(r.count), imported: true }, 'routing');
  }
  for (const a of Array.isArray(data.answerShapes) ? data.answerShapes : []) {
    if (!INTENTS.includes(a?.intent) || !LANGS.includes(a?.lang) || !ANSWERS.includes(a?.answerType)) { out.skipped++; continue; }
    add({ kind: 'pattern', intent: a.intent, lang: a.lang, answerType: a.answerType, count: cnt(a.count), imported: true }, 'patterns');
  }
  for (const al of Array.isArray(data.aliasSuggestions) ? data.aliasSuggestions : []) {
    // names are business names only, and only when the owner approved them in the file
    if (al?.approvedByOwner !== true || !al.customer) { out.skipped++; continue; }
    for (const alias of (Array.isArray(al.aliases) ? al.aliases : []).slice(0, 5)) add({ kind: 'alias', customer: String(al.customer).slice(0, 60), alias: String(alias).slice(0, 60), imported: true }, 'aliases');
  }
  exp.dirty = true;
  return out;
}

export function formatStatus(exp) {
  const open = exp.candidates.filter((c) => c.status === 'open').length;
  const seen = [...exp.keysOf('i|', WEEKS_KEPT).values()].reduce((s, v) => s + v, 0);
  return [`یادگیری: ${exp.on ? 'روشن' : 'خاموش'}`, `پیام‌های مشتری دیده‌شده (تا ۹۰ روز): ${seen}`, `پیشنهادهای در انتظار: ${open}`, `نسخهٔ تأییدشده: ${exp.version} از ${exp.versions.length}`].join('\n');
}

/** "یادگیری", "یادگیری خاموش", "بپذیر 3", "رد 3", "پیشنهادهای یادگیری", "بازگشت یادگیری", "گزارش یادگیری" -> a command or null. */
export function parseLearnCommand(text) {
  const s = normalizeDigits(String(text || '')).trim();
  if (/^یادگیری$/.test(s)) return { type: 'status' };
  if (/^یادگیری\s+خاموش$/.test(s)) return { type: 'off' };
  if (/^یادگیری\s+روشن$/.test(s)) return { type: 'on' };
  if (/^(?:پیشنهادهای|پیشنهاد‌های)\s+یادگیری$/.test(s)) return { type: 'list' };
  if (/^بازگشت\s+یادگیری$/.test(s)) return { type: 'rollback' };
  if (/^گزارش\s+یادگیری$/.test(s)) return { type: 'report' };
  if (/^بارگذاری\s+الگوها$/.test(s)) return { type: 'import' };
  const m = /^(بپذیر|رد)\s+(\d+)$/.exec(s);
  if (m) return { type: m[1] === 'رد' ? 'reject' : 'approve', id: Number(m[2]) };
  return null;
}

/** The Monday report is due once a week, at the same hour as the daily summary. */
export function reportDue({ now = Date.now(), timeZone = 'Asia/Dubai', weekday = 1, hour = 18, last = '' }) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(now));
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(new Date(now))) % 24;
  const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  return idx === weekday && h >= hour && last !== f ? f : null;
}
