// SHADOW MODE: for a week she watches the customer groups and, for every real request, writes the answer she WOULD give as a
// numbered card in the test group (never to the customer). When staff answer the same question later, the card gets a short
// follow-up: what staff said, whether it agrees, and whether she would have been faster. Everything that leaves this module goes
// through [post], which only ever writes to the test group: there is no other way out, so nothing can reach a customer, the sales
// manager or anyone else from here. The analysis itself (the real customer flow with its parsing, stock lookup, price and limit
// rules and the customer's language) is given in as [analyze] and must have no side effects outside the shadow state.

import fs from 'node:fs';
import path from 'node:path';
import { classifyAnswer, classifyIntent } from './experience.js';
import { localParts } from './morning.js';

const REQUEST_INTENTS = new Set(['availability', 'order', 'addon', 'delivery', 'question']);
/** Only real requests make a card: availability, an order, a quantity, a delivery question; never greetings, thanks or chit-chat. */
export const looksLikeRequest = (text) => REQUEST_INTENTS.has(classifyIntent(String(text || '')));

/** A text for a card: no phone numbers, no long digit strings (bank details), no prices; short. */
export function mask(text, max = 140) {
  const t = String(text || '')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, '[number]')
    .replace(/\b\d{7,}\b/g, '[number]')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:aed|dhs?|dirhams?|درهم)\b/gi, '[price]')
    .replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export const ACTIONS = {
  answer: 'would answer', 'ask-quantity': 'would ask for the quantity', manager: 'would refer to the sales manager (nothing sent)',
  silent: 'would stay silent because staff already answered', media: 'not read', budget: 'not analysed (daily budget reached)',
};

/** What she proposes and what staff said, compared by the kind of answer: same / different / unknown. */
export function compareAnswers(proposed, staffText) {
  const a = classifyAnswer(proposed);
  const b = classifyAnswer(staffText);
  if (['other', 'file'].includes(a) || ['other', 'file'].includes(b)) return 'unknown';
  // "limited" and a quantity are both a yes with a condition
  const norm = (x) => (x === 'limited' || x === 'quantity' ? 'yes' : x);
  return norm(a) === norm(b) ? 'same' : 'different';
}

/** The compact English card. [c]: a card of the store. */
export function cardText(c) {
  const lines = [`#${c.id} ${c.group}${c.customer && c.customer !== c.group ? ` (${c.customer})` : ''}`, `Customer: ${c.text || '—'}`, `Action: ${ACTIONS[c.action] || c.action}`];
  if (c.note) lines.push(c.note);
  if (c.reply) lines.push(`Reply${c.lang ? ` (${c.lang})` : ''}: ${mask(c.reply, 320)}`);
  if (c.staffText && c.action === 'silent') lines.push(`Staff said: ${mask(c.staffText)}`);
  return lines.join('\n');
}

/** The follow-up line when staff answered after the card. */
export function followUpText(c) {
  const minutes = Math.round((c.staffAt - c.at) / 60000);
  const faster = c.staffAt > c.at ? `she would have been faster by ${minutes < 1 ? 'less than a minute' : `${minutes} min`}` : 'staff were first';
  return `#${c.id} staff said: ${mask(c.staffText)} — ${c.verdict}; ${faster}`;
}

export class ShadowStore {
  constructor(dir = '') {
    this.file = dir ? path.join(dir, 'shadow.json') : '';
    this.d = { enabled: true, n: 0, cards: [], days: {}, started: 0, warned: '' };
    try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* first start */ }
  }

  save() {
    if (!this.file) return;
    this.d.cards = this.d.cards.slice(-600);
    const keep = Object.keys(this.d.days).sort().slice(-21);
    this.d.days = Object.fromEntries(keep.map((k) => [k, this.d.days[k]]));
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d)); } catch { /* best effort */ }
  }

  get enabled() { return this.d.enabled; }
  setEnabled(on) { this.d.enabled = !!on; this.save(); }

  day(day) { return (this.d.days[day] ||= { cards: 0, questions: 0, answered: 0, silent: 0, agreed: 0, differed: 0, unknown: 0, calls: 0, capHit: 0, fasterN: 0, fasterMs: 0, staffMs: 0, staffN: 0, by: {} }); }
  card(id) { return this.d.cards.find((c) => c.id === id); }
  next() { return ++this.d.n; }
}

export class ShadowDesk {
  /**
   * [post](text): the only way out (the test group). [analyze]({ groupId, subject, messages, transcript }) -> { action, reply, lang,
   * note, calls } | { action: 'none' }. [setTimer]/[clearTimer] and [now] are replaceable for tests.
   */
  constructor({ store, post, analyze, config, setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now(), log = () => {} }) {
    Object.assign(this, { store, post, analyze, config, setTimer, clearTimer, now, log });
    this.pending = new Map(); // group id -> { messages, timer, subject }
    this.transcripts = new Map();
  }

  tz() { return this.config.timezone || 'Asia/Dubai'; }
  today() { return localParts(this.now(), this.tz()).day; }

  /** [m]: { groupId, subject, label, staff: true|false|null, fromMe, text, hasImage, isVoice, at }. */
  onMessage(m) {
    if (!this.store.enabled) return 'off';
    const staff = m.fromMe ? true : m.staff;
    if (staff === null || staff === undefined) return 'unknown';
    const lines = this.transcripts.get(m.groupId) || [];
    const before = lines.slice();
    lines.push(`[${staff ? 'Staff' : 'Customer'}] ${m.text || ''}${m.hasImage ? ' (photo)' : ''}`.trim());
    this.transcripts.set(m.groupId, lines.slice(-20));
    if (!staff) {
      let p = this.pending.get(m.groupId);
      if (!p) { p = { messages: [], transcript: before, subject: m.subject, label: m.label, timer: null }; p.timer = this.setTimer(() => this.fire(m.groupId), this.config.shadowMergeMs ?? 120000); this.pending.set(m.groupId, p); }
      p.messages.push(m);
      return 'waiting';
    }
    const p = this.pending.get(m.groupId);
    if (p) { this.clearTimer(p.timer); this.pending.delete(m.groupId); this.staffFirst(p, m); return 'staff-first'; }
    this.staffAfter(m);
    return 'staff-after';
  }

  async fire(groupId) {
    const p = this.pending.get(groupId);
    if (!p) return;
    this.pending.delete(groupId);
    try {
      const text = p.messages.map((x) => x.text).filter(Boolean).join(' / ');
      const mediaOnly = !text && p.messages.some((x) => x.hasImage || x.isVoice);
      if (!mediaOnly && !looksLikeRequest(text)) return; // chit-chat, greetings, thanks: no card, no cost
      const day = this.store.day(this.today());
      if (this.store.day(this.today()).cards >= (this.config.shadowCardCap ?? 60)) { day.capHit++; this.store.save(); return; }
      let d;
      if (day.calls >= (this.config.shadowDailyCalls ?? 400)) d = { action: 'budget' };
      else d = await this.analyze({ groupId, subject: p.subject, label: p.label, messages: p.messages, transcript: p.transcript });
      if (!d || d.action === 'none') return;
      day.calls += d.calls || 0;
      await this.card(p, d, text || (p.messages.some((x) => x.isVoice) ? '(voice note)' : '(photo)'));
    } catch (e) { this.log(`shadow analysis failed: ${e.message}`); }
  }

  async card(p, d, text) {
    const day = this.store.day(this.today());
    const at = this.now();
    const c = {
      id: this.store.next(), groupId: p.messages[0].groupId, group: p.label || p.subject, customer: d.customer || '', at, customerAt: p.messages[0].at || at,
      text: mask(text), action: d.action, reply: d.reply || '', lang: d.lang || '', note: d.note || '', staffAt: 0, staffText: '', verdict: '',
    };
    this.store.d.cards.push(c);
    day.cards++;
    if (['answer', 'ask-quantity', 'manager'].includes(d.action)) { day.questions++; day.answered++; const g = (day.by[`${c.group}|${c.lang || '-'}`] ||= { q: 0, agreed: 0, differed: 0 }); g.q++; }
    this.store.save();
    await this.post(cardText(c));
    return c;
  }

  /** Staff answered before she did: a card "would stay silent". */
  staffFirst(p, m) {
    const text = p.messages.map((x) => x.text).filter(Boolean).join(' / ');
    if (!looksLikeRequest(text)) return;
    const day = this.store.day(this.today());
    if (day.cards >= (this.config.shadowCardCap ?? 60)) { day.capHit++; this.store.save(); return; }
    const at = this.now();
    const c = { id: this.store.next(), groupId: m.groupId, group: p.label || p.subject, customer: '', at, customerAt: p.messages[0].at || at, text: mask(text), action: 'silent', reply: '', lang: '', note: '', staffAt: at, staffText: m.text || '', verdict: 'unknown' };
    this.store.d.cards.push(c);
    day.cards++; day.silent++; day.questions++;
    day.staffN++; day.staffMs += Math.max(0, at - c.customerAt);
    this.store.save();
    return this.post(cardText(c));
  }

  /** Staff answered after her card, inside the window: compare and say it once. */
  staffAfter(m) {
    const windowMs = (this.config.shadowCompareMinutes ?? 60) * 60000;
    const at = this.now();
    const c = [...this.store.d.cards].reverse().find((x) => x.groupId === m.groupId && !x.staffAt && ['answer', 'ask-quantity', 'manager'].includes(x.action) && at - x.at <= windowMs);
    if (!c || !m.text) return;
    c.staffAt = at; c.staffText = m.text;
    c.verdict = c.reply ? compareAnswers(c.reply, m.text) : 'unknown';
    const day = this.store.day(localParts(c.at, this.tz()).day);
    day[c.verdict === 'same' ? 'agreed' : c.verdict === 'different' ? 'differed' : 'unknown']++;
    const g = day.by[`${c.group}|${c.lang || '-'}`]; if (g && c.verdict !== 'unknown') g[c.verdict === 'same' ? 'agreed' : 'differed']++;
    day.staffN++; day.staffMs += Math.max(0, at - c.customerAt);
    if (at > c.at) { day.fasterN++; day.fasterMs += at - c.at; }
    this.store.save();
    return this.post(followUpText(c));
  }
}

const fmtMin = (ms, n) => (n ? `${Math.round(ms / n / 60000)} min` : '—');

/** The one line for a day: questions, agreed, differed, not answered by staff, staff's average time. */
export function dayLine(store, day, windowMinutes = 60, now = Date.now()) {
  const d = store.d.days[day];
  if (!d) return '';
  const noStaff = store.d.cards.filter((c) => localParts(c.at, 'Asia/Dubai').day === day && ['answer', 'ask-quantity', 'manager'].includes(c.action) && !c.staffAt && now - c.at > windowMinutes * 60000).length;
  const capNote = d.capHit ? ', ' + d.capHit + ' not shown (card cap)' : '';
  return `Shadow ${day}: ${d.questions} questions, ${d.agreed} agreed, ${d.differed} differed, ${d.unknown + d.silent} unknown, ${noStaff} not answered by staff, staff average ${fmtMin(d.staffMs, d.staffN)}${capNote}`;
}

/** The summary of the last seven days, per group and language: the owner's decision data. */
export function weekSummary(store, today, now = Date.now()) {
  const days = Object.keys(store.d.days).filter((k) => k <= today).sort().slice(-7);
  const t = { questions: 0, agreed: 0, differed: 0, unknown: 0, silent: 0, staffMs: 0, staffN: 0, fasterMs: 0, fasterN: 0, calls: 0 };
  const by = {};
  for (const k of days) {
    const d = store.d.days[k];
    for (const f of Object.keys(t)) t[f] += d[f] || 0;
    for (const [key, v] of Object.entries(d.by || {})) { const g = (by[key] ||= { q: 0, agreed: 0, differed: 0 }); g.q += v.q; g.agreed += v.agreed; g.differed += v.differed; }
  }
  const noStaff = store.d.cards.filter((c) => days.includes(localParts(c.at, 'Asia/Dubai').day) && ['answer', 'ask-quantity', 'manager'].includes(c.action) && !c.staffAt && now - c.at > 3600000).length;
  const lines = [`Shadow week (${days.length} day${days.length === 1 ? '' : 's'}): ${t.questions} questions, ${t.agreed} agreed, ${t.differed} differed, ${t.unknown + t.silent} unknown, ${noStaff} not answered by staff; staff average ${fmtMin(t.staffMs, t.staffN)}; she would have been faster in ${t.fasterN} cases${t.fasterN ? ` (by ${fmtMin(t.fasterMs, t.fasterN)} on average)` : ''}; model calls ${t.calls}`];
  for (const [key, v] of Object.entries(by).sort((a, b) => b[1].q - a[1].q).slice(0, 12)) {
    const [group, lang] = key.split('|');
    lines.push(`- ${group} (${lang}): ${v.q} questions, ${v.agreed} agreed, ${v.differed} differed`);
  }
  return lines.join('\n');
}

/** "سایه وضعیت" | "سایه خاموش" | "سایه روشن" -> { type }; else null. */
export function parseShadowCommand(text) {
  const m = /^سایه\s+(وضعیت|خاموش|روشن)$/u.exec(String(text || '').replace(/[\s‌]+/g, ' ').trim());
  return m ? { type: { وضعیت: 'status', خاموش: 'off', روشن: 'on' }[m[1]] } : null;
}

/** "#12 wrong: the right answer" (or غلط) -> { id, right }; else null. */
export function parseCardCorrection(text) {
  const m = /^#\s*(\d+)\s+(?:wrong|غلط)\s*[:：-]\s*([\s\S]+)$/iu.exec(String(text || '').trim());
  return m ? { id: Number(m[1]), right: m[2].trim() } : null;
}
