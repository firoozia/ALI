// The good-morning message: every working day at a fixed local time, to an explicit list of groups only (never "all groups"),
// one by one with a random gap, a daily cap, nothing twice for the same day and group (remembered on disk, so a restart does
// not resend), a catch-up window after the time, and no message on the days off. The wording is in data/morning-phrases.json.

import { nameFallback } from './namelead.js';
import fs from 'node:fs';
import path from 'node:path';

const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
export const weekdayNumbers = (names) => (names || []).map((n) => WEEKDAYS[String(n).trim().toLowerCase()]).filter((n) => n !== undefined);

/** The local day (yyyy-mm-dd), weekday (0 = Sunday) and minutes since midnight at [now] in [timeZone]. */
export function localParts(now, timeZone = 'Asia/Dubai') {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { day: `${p.year}-${p.month}-${p.day}`, weekday, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

const toMinutes = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };

/**
 * { day, weekday, thursdayLike } when a run is due now: a working day, after [time] and before [catchUpUntil]; else null.
 * [weekendWishDays]: weekdays whose message adds the weekend wish.
 */
export function morningDue({ now, timeZone, time = '08:30', catchUpUntil = '10:00', offDays = [5], weekendWishDays = [4] }) {
  const p = localParts(now, timeZone);
  if (offDays.includes(p.weekday)) return null;
  if (p.minutes < toMinutes(time) || p.minutes >= toMinutes(catchUpUntil)) return null;
  return { day: p.day, weekday: p.weekday, weekend: weekendWishDays.includes(p.weekday) };
}

/** What was sent, per day and group, on disk. Also the on/off switch of the owner. */
export class MorningStore {
  constructor(dir = '') {
    this.file = dir ? path.join(dir, 'morning.json') : '';
    this.enabled = true;
    this.sent = {}; // day -> [group ids]
    this.failed = {}; // day -> { group id: count }
    this.completed = ''; // the last day a run went through every group
    try { if (this.file) Object.assign(this, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* first start */ }
  }

  save() {
    if (!this.file) return;
    const days = Object.keys(this.sent).sort().slice(-14);
    this.sent = Object.fromEntries(days.map((d) => [d, this.sent[d]]));
    this.failed = Object.fromEntries(Object.entries(this.failed).filter(([d]) => days.includes(d)));
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify({ enabled: this.enabled, sent: this.sent, failed: this.failed, completed: this.completed })); } catch { /* best effort */ }
  }

  has(day, id) { return (this.sent[day] || []).includes(id); }
  count(day) { return (this.sent[day] || []).length; }
  mark(day, id) { (this.sent[day] ||= []).push(id); this.save(); }
  fails(day, id) { return this.failed[day]?.[id] || 0; }
  fail(day, id) { ((this.failed[day] ||= {})[id] = this.fails(day, id) + 1); this.save(); }
  setEnabled(on) { this.enabled = !!on; this.save(); }
  complete(day) { this.completed = day; this.save(); }
}

/** The groups whose name holds one of the words; an empty list matches nothing. [groups]: { id, subject }. */
export function matchGroups(groups, words) {
  const list = (words || []).map((w) => String(w).trim().toLowerCase()).filter(Boolean);
  if (!list.length) return [];
  return groups.filter((g) => list.some((w) => String(g.subject || '').toLowerCase().includes(w)));
}

/** The language of a group's message: the learned one when known, Arabic for an Arabic name, else English. */
export function morningLang(learned, subject) {
  if (['ar', 'fa', 'ur', 'en'].includes(learned)) return learned;
  return /[؀-ۿ]/.test(String(subject || '')) ? 'ar' : 'en';
}

/** One phrase from the file, rotating by the day so it is not the same every morning, signed with the assistant's name. */
export function morningText({ phrases, lang, day, weekend, name }) {
  const set = phrases[lang] || phrases.en;
  const list = (weekend && set.weekend?.length ? set.weekend : set.daily) || [];
  if (!list.length) return '';
  const n = Math.abs(Number(day.replace(/-/g, '')) || 0);
  return `${list[n % list.length].replace('{name}', name)}`.trim();
}

/**
 * One run: the listed groups, one by one. Nothing is sent unless the group is in the list, was not sent today, the cap is not
 * reached and the catch-up window is still open. [send](id, text) -> truthy on success; [sleep](ms); [rng]() in 0..1;
 * [stillOpen]() is false once the window has closed. Returns { sent, skipped, failed, capped, closed }.
 */
export async function runMorning({ day, weekend, groups, words, phrases, name, store, send, sleep, rng = Math.random, stillOpen = () => true, cap = 40, gapMin = 20, gapMax = 60, learnedLang = () => '', log = () => {}, ignoreStore = false }) {
  const out = { sent: 0, skipped: 0, failed: 0, capped: false, closed: false };
  const targets = matchGroups(groups, words);
  let first = true;
  for (const g of targets) {
    if (!ignoreStore && store.has(day, g.id)) { out.skipped++; continue; }
    if (!ignoreStore && store.fails(day, g.id) >= 2) { out.skipped++; continue; }
    if (!ignoreStore && store.count(day) >= cap) { out.capped = true; break; }
    if (!stillOpen()) { out.closed = true; break; }
    if (!first) await sleep(Math.round((gapMin + rng() * (gapMax - gapMin)) * 1000));
    first = false;
    if (!stillOpen()) { out.closed = true; break; }
    const text = morningText({ phrases, lang: morningLang(learnedLang(g), g.subject), day, weekend, name });
    if (!text) { out.skipped++; continue; }
    try {
      const ok = await send(g.id, text);
      if (!ok) throw new Error('not sent');
      if (!ignoreStore) store.mark(day, g.id);
      out.sent++;
      log(`morning: "${g.subject}": sent`);
    } catch (e) {
      if (!ignoreStore) store.fail(day, g.id);
      out.failed++;
      log(`morning: "${g.subject}": failed`);
    }
  }
  if (!ignoreStore && !out.capped && !out.closed) store.complete(day);
  return out;
}

/** "صبح بخیر وضعیت" | "... خاموش" | "... روشن" | "... آزمایش" -> { type }; else null. */
function parseMorningCommandImpl(text) {
  const m = /^صبح\s+بخیر\s+(وضعیت|خاموش|روشن|آزمایش)$/u.exec(String(text || '').replace(/[\s‌]+/g, ' ').trim());
  return m ? { type: { وضعیت: 'status', خاموش: 'off', روشن: 'on', آزمایش: 'test' }[m[1]] } : null;
}

/** parseMorningCommand as written, and when it reads nothing, once more with a leading «Atossa» taken off. */
export const parseMorningCommand = nameFallback(parseMorningCommandImpl);
