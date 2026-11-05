// SHADOW MODE: for a week she watches the customer groups and, for every real request, writes the answer she WOULD give as a
// numbered card in the test group (never to the customer). The card is made even when staff answered first (in real mode she
// answers first anyway), and then compared with what staff said: same, different or unknown; and whether she would have been
// faster. A question that depends on a photo or a voice note she did not read ("Available" under a picture) is a card "needs the
// photo (not read)" with no proposed reply, left out of the agree/differ counts and counted on its own.
// Everything that leaves this module goes through [post], which only ever writes to the test group: there is no other way out, so
// nothing can reach a customer, the sales manager or anyone else from here. The analysis itself (the real customer flow with its
// parsing, stock lookup, price and limit rules and the customer's language) is given in as [analyze] and has no side effects outside
// the shadow state.

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
  silent: 'would stay silent because staff already answered', media: 'not read', 'needs-media': 'needs the photo (not read)', budget: 'not analysed (daily budget reached)',
};
const ANSWERING = ['answer', 'ask-quantity', 'manager'];

// Short spoken forms the answer classifier does not know ("Yea", "yep", "nope", "201 yes"): the polarity is read from them first.
const NO_WORD = /^\W*(?:\d+\W+)?(?:no|nope|nah|na|not\b|never|لا|نه|نہیں)/iu;
const YES_WORD = /(?:^|\W)(?:yea|yeah|yep|yup|ya|yes|ok|okay|sure|available|موجود|نعم|بله|ہاں)(?:\W|$)/iu;
const polarity = (t) => {
  const s = String(t || '');
  if (NO_WORD.test(s) || /\bnot\s+available\b|\bno\s+stock\b|\bsold\s+out\b/i.test(s)) return 'no';
  if (YES_WORD.test(s)) return 'yes';
  const a = classifyAnswer(s);
  return a === 'limited' || a === 'quantity' ? 'yes' : a;
};

/** What she proposes and what staff said, compared by the kind of answer: same / different / unknown. */
export function compareAnswers(proposed, staffText) {
  const a = polarity(proposed); const b = polarity(staffText);
  if (['other', 'file'].includes(a) || ['other', 'file'].includes(b)) return 'unknown';
  return a === b ? 'same' : 'different';
}

/** The stock stance she would take ('yes' | 'no' | 'mixed') against what staff said: when she only asks for the quantity, the sheet decides. */
export function compareStance(stance, staffText) {
  const b = polarity(staffText);
  if (!['yes', 'no'].includes(stance) || !['yes', 'no'].includes(b)) return 'unknown';
  return stance === b ? 'same' : 'different';
}

/** The compact English card. [c]: a card of the store. */
export function cardText(c) {
  const lines = [`#${c.id} ${c.group}${c.customer && c.customer !== c.group ? ` (${c.customer})` : ''}`, `Customer: ${c.text || '—'}`, `Action: ${ACTIONS[c.action] || c.action}`];
  if (c.note) lines.push(c.note);
  if (c.reply) lines.push(`Reply${c.lang ? ` (${c.lang})` : ''}: ${mask(c.reply, 320)}`);
  if (c.staffText && c.staffFirst) lines.push(`Staff said: ${mask(c.staffText)}${c.verdict ? ` — ${c.verdict}` : ''}`);
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

  day(day) { return (this.d.days[day] ||= { cards: 0, questions: 0, answered: 0, silent: 0, agreed: 0, differed: 0, unknown: 0, needsMedia: 0, calls: 0, capHit: 0, fasterN: 0, fasterMs: 0, staffMs: 0, staffN: 0, by: {} }); }
  card(id) { return this.d.cards.find((c) => c.id === id); }
  next() { return ++this.d.n; }
}

export class ShadowDesk {
  /**
   * [post](text): the only way out (the test group). [analyze]({ groupId, subject, label, messages, transcript }) -> { action, reply,
   * lang, note, stance, calls } | { action: 'none' }. [setTimer]/[clearTimer] and [now] are replaceable for tests.
   */
  constructor({ store, post, analyze, config, setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now(), log = () => {} }) {
    Object.assign(this, { store, post, analyze, config, setTimer, clearTimer, now, log });
    this.pending = new Map(); // group id -> { messages, timer, subject }
    this.transcripts = new Map();
    this.work = Promise.resolve(); // analyses, one after the other
    this.queue = Promise.resolve(); // cards, numbered in the order they are posted
  }

  tz() { return this.config.timezone || 'Asia/Dubai'; }
  today() { return localParts(this.now(), this.tz()).day; }
  /** Resolves when every analysis and card started so far is finished (the tests wait on it). */
  idle() { return this.work.then(() => this.queue); }

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
    if (p) { this.clearTimer(p.timer); this.pending.delete(m.groupId); this.run(() => this.produce(p, { text: m.text || '', at: this.now() })); return 'staff-first'; }
    this.staffAfter(m);
    return 'staff-after';
  }

  fire(groupId) {
    const p = this.pending.get(groupId);
    if (!p) return Promise.resolve();
    this.pending.delete(groupId);
    return this.run(() => this.produce(p, null));
  }

  run(fn) {
    this.work = this.work.then(fn).catch((e) => this.log(`shadow analysis failed: ${e.message}`));
    return this.work;
  }

  /** One batch of customer messages -> at most one card. [staff]: what staff already said, if they were first. */
  async produce(p, staff) {
    const text = p.messages.map((x) => x.text).filter(Boolean).join(' / ');
    const mediaOnly = !text && p.messages.some((x) => x.hasImage || x.isVoice);
    if (!mediaOnly && !looksLikeRequest(text) && !p.messages.some((x) => (x.hasImage || x.isVoice) && x.text)) return; // chit-chat, thanks: no card, no cost
    const day = this.store.day(this.today());
    if (day.cards >= (this.config.shadowCardCap ?? 60)) { day.capHit++; this.store.save(); return; }
    let d;
    if (day.calls >= (this.config.shadowDailyCalls ?? 400)) d = { action: 'budget' };
    else d = await this.analyze({ groupId: p.messages[0].groupId, subject: p.subject, label: p.label, messages: p.messages, transcript: p.transcript });
    if (!d || d.action === 'none') return;
    day.calls += d.calls || 0;
    const at = this.now();
    const c = {
      groupId: p.messages[0].groupId, group: p.label || p.subject, customer: d.customer || '', at, customerAt: p.messages[0].at || at,
      text: mask(text || (p.messages.some((x) => x.isVoice) ? '(voice note)' : '(photo)')), action: d.action, reply: d.reply || '', lang: d.lang || '', note: d.note || '',
      stance: d.stance || '', staffAt: 0, staffText: '', verdict: '', staffFirst: false,
    };
    if (staff && staff.text) this.attachStaff(c, staff.text, staff.at, true);
    this.emit(c, day);
  }

  /** Records what staff said on a card and compares it (not for a card that needs a photo). */
  attachStaff(c, staffText, at, first) {
    c.staffAt = at; c.staffText = staffText; c.staffFirst = !!first;
    const day = this.store.day(localParts(c.at, this.tz()).day);
    day.staffN++; day.staffMs += Math.max(0, at - c.customerAt);
    if (!ANSWERING.includes(c.action)) return; // needs the photo, not analysed: no verdict, nothing to count
    c.verdict = c.stance ? compareStance(c.stance, staffText) : c.reply ? compareAnswers(c.reply, staffText) : 'unknown';
    day[c.verdict === 'same' ? 'agreed' : c.verdict === 'different' ? 'differed' : 'unknown']++;
    const g = day.by[`${c.group}|${c.lang || '-'}`]; if (g && c.verdict !== 'unknown') g[c.verdict === 'same' ? 'agreed' : 'differed']++;
    if (!first && at > c.at) { day.fasterN++; day.fasterMs += at - c.at; }
  }

  /** The card is numbered when it is posted, in order, so the numbers have no gaps; a failed post is tried once more. */
  emit(c, day) {
    this.queue = this.queue.then(async () => {
      c.id = this.store.next();
      this.store.d.cards.push(c);
      day.cards++;
      if (ANSWERING.includes(c.action)) { day.questions++; day.answered++; const g = (day.by[`${c.group}|${c.lang || '-'}`] ||= { q: 0, agreed: 0, differed: 0 }); g.q++; }
      else if (c.action === 'needs-media') day.needsMedia++;
      this.store.save();
      for (let attempt = 1; attempt <= 2; attempt++) {
        try { await this.post(cardText(c)); c.posted = true; break; } catch (e) { c.posted = false; this.log(`shadow card #${c.id} failed to post (try ${attempt}): ${e.message}`); }
      }
      this.store.save();
    }).catch((e) => this.log(`shadow card failed: ${e.message}`));
    return this.queue;
  }

  /** Staff answered after her card, inside the window: compare and say it once. */
  staffAfter(m) {
    const windowMs = (this.config.shadowCompareMinutes ?? 60) * 60000;
    const at = this.now();
    const c = [...this.store.d.cards].reverse().find((x) => x.groupId === m.groupId && !x.staffAt && ANSWERING.includes(x.action) && at - x.at <= windowMs);
    if (!c || !m.text) return;
    this.attachStaff(c, m.text, at, false);
    this.store.save();
    this.queue = this.queue.then(() => this.post(followUpText(c))).catch((e) => this.log(`shadow follow-up failed: ${e.message}`));
    return this.queue;
  }
}

const fmtMin = (ms, n) => (n ? `${Math.round(ms / n / 60000)} min` : '—');
const unanswered = (store, days, windowMinutes, now) => store.d.cards.filter((c) => days.includes(localParts(c.at, 'Asia/Dubai').day) && ANSWERING.includes(c.action) && !c.staffAt && now - c.at > windowMinutes * 60000).length;

/** The one line for a day: questions, agreed, differed, not answered by staff, staff's average time, and the ones that need a photo. */
export function dayLine(store, day, windowMinutes = 60, now = Date.now()) {
  const d = store.d.days[day];
  if (!d) return '';
  const capNote = d.capHit ? ', ' + d.capHit + ' not shown (card cap)' : '';
  const mediaNote = d.needsMedia ? ', ' + d.needsMedia + ' need a photo or voice note (counted apart)' : '';
  return `Shadow ${day}: ${d.questions} questions, ${d.agreed} agreed, ${d.differed} differed, ${d.unknown} unknown, ${unanswered(store, [day], windowMinutes, now)} not answered by staff, staff average ${fmtMin(d.staffMs, d.staffN)}${mediaNote}${capNote}`;
}

/** The summary of the last seven days, per group and language: the owner's decision data. */
export function weekSummary(store, today, now = Date.now()) {
  const days = Object.keys(store.d.days).filter((k) => k <= today).sort().slice(-7);
  const t = { questions: 0, agreed: 0, differed: 0, unknown: 0, needsMedia: 0, staffMs: 0, staffN: 0, fasterMs: 0, fasterN: 0, calls: 0 };
  const by = {};
  for (const k of days) {
    const d = store.d.days[k];
    for (const f of Object.keys(t)) t[f] += d[f] || 0;
    for (const [key, v] of Object.entries(d.by || {})) { const g = (by[key] ||= { q: 0, agreed: 0, differed: 0 }); g.q += v.q; g.agreed += v.agreed; g.differed += v.differed; }
  }
  const lines = [`Shadow week (${days.length} day${days.length === 1 ? '' : 's'}): ${t.questions} questions, ${t.agreed} agreed, ${t.differed} differed, ${t.unknown} unknown, ${unanswered(store, days, 60, now)} not answered by staff; staff average ${fmtMin(t.staffMs, t.staffN)}; she would have been faster in ${t.fasterN} cases${t.fasterN ? ` (by ${fmtMin(t.fasterMs, t.fasterN)} on average)` : ''}; ${t.needsMedia} requests depend on a photo or voice note (not read, counted apart); model calls ${t.calls}`];
  for (const [key, v] of Object.entries(by).sort((a, b) => b[1].q - a[1].q).slice(0, 12)) {
    const [group, lang] = key.split('|');
    lines.push(`- ${group} (${lang}): ${v.q} questions, ${v.agreed} agreed, ${v.differed} differed`);
  }
  return lines.join('\n');
}

/** Cards that were numbered but never reached the group, and gaps in the numbering (for the status command). */
export function postingProblems(store) {
  const cards = store.d.cards;
  const unposted = cards.filter((c) => c.posted === false).map((c) => c.id);
  const ids = cards.map((c) => c.id).filter(Boolean).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < ids.length; i++) for (let n = ids[i - 1] + 1; n < ids[i]; n++) gaps.push(n);
  return { unposted, gaps };
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
