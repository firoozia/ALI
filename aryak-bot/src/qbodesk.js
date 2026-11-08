// THE OWNER'S QUICKBOOKS COMMANDS (his own chat, owner only): "وضعیت کوییک‌بوکس", "تطبیق کوییک‌بوکس" (the match table, with a question where it is unsure),
// "صورت‌حساب <customer>" and "صورت‌حساب همه" (at most 50, a gap between posts). READ ONLY: nothing is ever written to QuickBooks here. Every statement
// is posted ONLY to the test group, whatever is asked: the desk has no target to choose, it asks for "the test group" and nothing else.

import fs from 'node:fs';
import path from 'node:path';
import { clearWinner, customerRowFor, nameKey, rankCustomers, rowGroups } from './customergroups.js';
import { buildStatementData, loadCustomerData, money, statementPdf } from './qbostatement.js';
import { groupAllowed, shadowGroup } from './guard.js';
import { pickSpoken, rankNames } from './translit.js';
import { hasPeriod } from './period.js';
import { looseKey, looseWords } from './namekey.js';
import { qboEscape } from './qbo.js';

const fa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const latin = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const plain = (s) => latin(String(s || '')).replace(/[‌‎‏]/g, ' ').replace(/[أإ]/g, 'ا').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();
const QB = 'کو[ئی]*یک\\s*بوکس';
export const MAX_ALL = 50;

/** What the owner wrote, or null: { type: 'status' | 'match' | 'pick' | 'skip' | 'statement' | 'all', ... }. */
export function parseQboCommand(text) {
  const s = plain(text).replace(/^آتوسا[ ,،:]*/u, '').replace(/[.!؟?]+$/u, '').trim();
  if (!s) return null;
  if (new RegExp(`^وضعیت\\s*${QB}$`, 'u').test(s)) return { type: 'status' };
  if (new RegExp(`^تطبیق\\s*${QB}$`, 'u').test(s)) return { type: 'match' };
  if (new RegExp(`^اتصال\\s*${QB}$`, 'u').test(s)) return { type: 'connect' };
  if (new RegExp(`^قطع\\s*${QB}$`, 'u').test(s)) return { type: 'disconnect' };
  let m = /^تطبیق\s+(\d+)\s*=\s*(\d+)$/u.exec(s);
  if (m) return { type: 'pick', n: Number(m[1]), option: Number(m[2]) };
  if ((m = /^تطبیق\s+(\d+)\s*نه$/u.exec(s))) return { type: 'skip', n: Number(m[1]) };
  if ((m = /^صورت\s*حساب\s+(.+)$/u.exec(s))) {
    if (m[1].trim() !== 'همه' && hasPeriod(m[1])) return null; // with a period it is the free-form request (period.js), not a customer name
    // a verb at the END («AL بفرست», «Cedar رو بفرست», «برام بده», «کن») is free words too: that reader strips it and answers in the asker's own chat
    if (/\s(?:(?:رو|را|برام|برایم|برای\s+من|به\s+من|لطفا)\s+)*(?:بفرست|بفرستید|بفرستین|بده|بدید|بدهید|بزن|بزنید|کن|کنید)$/u.test(m[1].trim())) return null;
    return m[1].trim() === 'همه' ? { type: 'all' } : { type: 'statement', name: m[1].trim() };
  }
  return null;
}

/** The only group a statement may go to in this stage: one that holds a test-group word and is not a customer group. */
export function pickTestGroup(groups, config) {
  const words = (config.testGroupNames || []).map((w) => String(w).toLowerCase()).filter(Boolean);
  return groups.find((g) => words.some((w) => String(g.subject).toLowerCase().includes(w)) && groupAllowed(g.subject, config).why === 'test group' && !shadowGroup(g.subject, config)) || null;
}

/** Our customer against the QuickBooks customers: the QuickBooks names are ranked against our name by the same word rules as the customer-group list. */
export function matchOne(ourName, qboCustomers) {
  const people = qboCustomers.map((c) => ({ name: c.DisplayName || c.CompanyName || '', alts: [c.CompanyName, c.FullyQualifiedName].filter((x) => x && x !== c.DisplayName), id: String(c.Id) }));
  const ranked = rankCustomers(ourName, people);
  const exact = people.filter((p) => [p.name, ...p.alts].some((n) => nameKey(n) === nameKey(ourName) || (looseKey(n) && looseKey(n) === looseKey(ourName))));
  if (exact.length === 1) return { kind: 'confident', id: exact[0].id, name: exact[0].name };
  if (clearWinner(ranked)) { const p = people.find((x) => x.name === ranked[0].customer); return { kind: 'confident', id: p.id, name: p.name }; }
  const options = ranked.slice(0, 3).map((r) => { const p = people.find((x) => x.name === r.customer); return { id: p.id, name: p.name }; });
  return { kind: options.length ? 'options' : 'none', options };
}

/** Which QuickBooks customer each of our customers is: kept on disk (versioned), so a choice is made once. */
export class QboMap {
  constructor(dir = '') {
    this.dir = dir;
    this.file = dir ? path.join(dir, 'qbo-map.json') : '';
    this.d = { version: 0, map: {}, skipped: [], pending: null };
    try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ }
  }

  persist() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d)); } catch { /* best effort */ } }
  get(ours) { return this.d.map[nameKey(ours)] || null; }

  set(ours, id, name, how) {
    if (this.dir && this.d.version > 0) {
      try { fs.mkdirSync(path.join(this.dir, 'qbo-map-history'), { recursive: true }); fs.writeFileSync(path.join(this.dir, 'qbo-map-history', `qbo-map-v${this.d.version}.json`), JSON.stringify({ version: this.d.version, map: this.d.map })); } catch { /* best effort */ }
    }
    this.d.map[nameKey(ours)] = { ours, id: String(id), name, how };
    this.d.version += 1;
    this.persist();
  }
}

export class QboDesk {
  /**
   * [qbo]: the client; [list]: the approved customer-group list; [aliases]; [map]: QboMap; [config]; [groups]: async () => [{ id, subject }];
   * [post]: async (jid, buffer, fileName, caption) -> sends the document; [today]: () => yyyy-mm-dd; [sleep]; [log].
   */
  constructor({ qbo, list, aliases, map, config, groups, post, today, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = 6000, log = () => {} }) {
    Object.assign(this, { qbo, list, aliases, map, config, groups, post, today, sleep, gapMs, log });
    this.busy = false;
    this.cache = { at: 0, customers: [] };
  }

  async customers() {
    if (Date.now() - this.cache.at < 10 * 60 * 1000 && this.cache.customers.length) return this.cache.customers;
    const rows = await this.qbo.query('select Id, DisplayName, CompanyName, FullyQualifiedName, Balance, Active from Customer');
    this.cache = { at: Date.now(), customers: rows };
    return rows;
  }

  get rows() { return this.list.rows(); }

  /** The one line the public page put in his chat: check the state, exchange the code at once, say which company. Owner only (the caller checks). */
  async handleLine({ state, realmId, code }) {
    if (!this.qbo.configured) return [`کوییک‌بوکس هنوز تنظیم نشده است. تنظیم‌های کم: ${this.qbo.missing.join('، ')}`];
    if (!this.qbo.takeState(state)) return ['اتصال رد شد: نشانهٔ امنیتی نادرست یا کهنه (بیش از ۱۵ دقیقه) یا قبلاً مصرف شده است. دوباره بنویسید: اتصال کوییک‌بوکس'];
    try {
      await this.qbo.exchange({ code, realmId });
      this.cache = { at: 0, customers: [] };
      let name = '';
      try { name = (await this.qbo.companyInfo())?.CompanyName || ''; } catch { /* connected even if the name cannot be read */ }
      return [`کوییک‌بوکس وصل شد${name ? `: ${name}` : ''} (محیط ${this.qbo.env === 'production' ? 'اصلی' : 'آزمایشی'}). فقط خواندن؛ چیزی در کوییک‌بوکس نوشته نمی‌شود.`];
    } catch (e) {
      this.log(`QuickBooks connect failed: ${e.name} ${e.status || ''}`);
      return [`اتصال نشد: ${e.message}. دوباره بنویسید: اتصال کوییک‌بوکس`];
    }
  }

  async handle(c) {
    if (!this.qbo.configured && c.type !== 'status') return [`کوییک‌بوکس هنوز تنظیم نشده است. تنظیم‌های کم: ${this.qbo.missing.join('، ')}`];
    if (c.type === 'connect') {
      try {
        const { url } = await this.qbo.connectLink();
        return ['برای وصل کردن کوییک‌بوکس این پیوند را باز کنید، وارد شوید و اجازه بدهید (۱۵ دقیقه معتبر است). صفحهٔ بعد یک پیام آماده برای شما باز می‌کند؛ همان را در همین گفتگو بفرستید.', url];
      } catch (e) { return [`خطا: ${e.message}`]; }
    }
    if (c.type === 'disconnect') {
      const { revoked } = await this.qbo.disconnect();
      this.cache = { at: 0, customers: [] };
      return [`کوییک‌بوکس قطع شد: ${revoked ? 'دسترسی در اینتوییت لغو شد و' : 'لغو در اینتوییت انجام نشد (یا توکنی نبود)، ولی'} توکن‌های ذخیره‌شده پاک شدند. برای وصل دوباره: اتصال کوییک‌بوکس`];
    }
    if (c.type !== 'status' && this.qbo.paused) return ['کوییک‌بوکس با فرمان مالک متوقف است؛ بنویسید: ادامهٔ کوییک‌بوکس'];
    if (c.type !== 'status') {
      if (this.qbo.needsReconnect) return ['کوییک‌بوکس باید دوباره وصل شود؛ بنویسید: اتصال کوییک‌بوکس'];
      if (!this.qbo.connected) return ['کوییک‌بوکس وصل نیست؛ بنویسید: اتصال کوییک‌بوکس'];
    }
    try {
      switch (c.type) {
        case 'status': return [await this.status()];
        case 'match': return this.matchTable();
        case 'pick': return [this.pick(c)];
        case 'skip': return [this.skip(c)];
        case 'statement': return this.statement(c.name);
        case 'all': return this.all();
        default: return [];
      }
    } catch (e) {
      this.log(`QuickBooks command failed: ${e.name} ${e.status || ''}`);
      if (e.reconnect) return ['کوییک‌بوکس باید دوباره وصل شود؛ بنویسید: اتصال کوییک‌بوکس'];
      if (e.paused) return ['کوییک‌بوکس با فرمان مالک متوقف است؛ بنویسید: ادامهٔ کوییک‌بوکس'];
      return [`خطا در کوییک‌بوکس: ${e.message}. چیزی نوشته نشد.`];
    }
  }

  async status() {
    if (!this.qbo.configured) return `کوییک‌بوکس وصل نیست. تنظیم‌های کم: ${this.qbo.missing.join('، ')}\nمحیط: ${this.qbo.env === 'production' ? 'اصلی' : 'آزمایشی'}`;
    if (this.qbo.needsReconnect) return `کوییک‌بوکس باید دوباره وصل شود؛ بنویسید: اتصال کوییک‌بوکس\nمحیط: ${this.qbo.env === 'production' ? 'اصلی' : 'آزمایشی'}`;
    if (!this.qbo.connected) return `کوییک‌بوکس وصل نیست؛ بنویسید: اتصال کوییک‌بوکس\nمحیط: ${this.qbo.env === 'production' ? 'اصلی' : 'آزمایشی'}`;
    let name = '';
    let ok = false;
    try { name = (await this.qbo.companyInfo())?.CompanyName || ''; ok = true; } catch (e) { name = e.message; }
    const last = this.qbo.lastCall.at ? `${new Date(this.qbo.lastCall.at).toISOString().replace('T', ' ').slice(0, 19)} (وضعیت ${fa(this.qbo.lastCall.status)})` : 'هنوز نبوده';
    return [`کوییک‌بوکس: ${ok ? 'وصل است' : 'وصل نیست'}`, `محیط: ${this.qbo.env === 'production' ? 'اصلی' : 'آزمایشی'}`, ok ? `شرکت: ${name}` : `خطا: ${name}`, `آخرین تماس: ${last}`, `نوشتن در کوییک‌بوکس: ${this.qbo.writeOn ? 'روشن' : 'خاموش'}`, `کلید توقف: ${this.qbo.paused ? 'متوقف (ادامهٔ کوییک‌بوکس را بنویسید)' : 'روشن نیست'}`].join('\n');
  }

  /** The match table: our approved customers against QuickBooks. A sure match is saved; an unsure one is asked. */
  async matchTable() {
    const qbc = await this.customers();
    const rows = this.rows;
    if (!rows.length) return ['فهرست مشتری و گروه هنوز مشتری تأییدشده ندارد؛ جدول تطبیق خالی است.'];
    const okLines = []; const ask = []; const none = [];
    for (const r of rows) {
      const saved = this.map.get(r.customer);
      if (saved) { okLines.push(`• ${r.customer} — ${saved.name}`); continue; }
      const m = matchOne(r.customer, qbc);
      if (m.kind === 'confident') { this.map.set(r.customer, m.id, m.name, 'auto'); okLines.push(`• ${r.customer} — ${m.name}`); } else if (m.kind === 'options') ask.push({ ours: r.customer, options: m.options }); else none.push(r.customer);
    }
    this.map.d.pending = ask.map((a, i) => ({ n: i + 1, ...a }));
    this.map.persist();
    const out = [`تطبیق کوییک‌بوکس: ${fa(okLines.length)} مطمئن، ${fa(ask.length)} نامطمئن، ${fa(none.length)} بدون مشابه، از ${fa(rows.length)} مشتری.`];
    if (ask.length) out.push(['❓ این‌ها را خودتان بگویید («تطبیق ۱ = ۲» یا «تطبیق ۱ نه»):', ...this.map.d.pending.flatMap((p) => [`${fa(p.n)}. ${p.ours}`, ...p.options.map((o, i) => `    ${fa(i + 1)}) ${o.name}`)])].join('\n'));
    if (none.length) out.push(['در کوییک‌بوکس مشابهی پیدا نشد:', ...none.map((n) => `• ${n}`)].join('\n'));
    if (okLines.length) out.push(['جفت‌های مطمئن:', ...okLines.slice(0, 60)].join('\n'));
    return out;
  }

  pick({ n, option }) {
    const p = (this.map.d.pending || []).find((x) => x.n === n);
    if (!p) return `ردیف ${fa(n)} در جدول تطبیق نیست.`;
    const o = p.options[option - 1];
    if (!o) return `ردیف ${fa(n)} گزینهٔ ${fa(option)} ندارد.`;
    this.map.set(p.ours, o.id, o.name, 'owner');
    this.map.d.pending = this.map.d.pending.filter((x) => x.n !== n);
    this.map.persist();
    return `ثبت شد: ${p.ours} — ${o.name}. چیزی در کوییک‌بوکس نوشته نشد.`;
  }

  skip({ n }) {
    const p = (this.map.d.pending || []).find((x) => x.n === n);
    if (!p) return `ردیف ${fa(n)} در جدول تطبیق نیست.`;
    this.map.d.pending = this.map.d.pending.filter((x) => x.n !== n);
    this.map.persist();
    return `ردیف ${fa(n)} (${p.ours}) کنار گذاشته شد.`;
  }

  /** Our customer's QuickBooks id: saved, or a sure match (saved), or null with the options to ask about. */
  async resolve(typed) {
    const row = customerRowFor(typed, { list: this.list, aliases: this.aliases });
    const ours = row?.customer || typed;
    const saved = this.map.get(ours);
    if (saved) return { ours, id: saved.id };
    const m = matchOne(ours, await this.customers());
    if (m.kind === 'confident') { this.map.set(ours, m.id, m.name, 'auto'); return { ours, id: m.id }; }
    return { ours, options: m.options || [] };
  }

  /**
   * Our customer's QuickBooks id for an INVOICE: only an exact name (Display, Company or Fully qualified name) or a choice the owner confirmed.
   * Never a guess: an unsure one returns the candidates to ask about.
   */
  async resolveStrict(typed) {
    { // a customer whose own QuickBooks name equals the typed one (case, dots and L.L.C do not matter) is the answer before any alias or group name is looked at
      const all0 = await this.customers();
      const k0 = nameKey(typed); const lk0 = looseKey(typed);
      const direct = all0.filter((c) => [c.DisplayName, c.CompanyName, c.FullyQualifiedName].some((n) => n && (nameKey(n) === k0 || (lk0 && looseKey(n) === lk0))));
      if (direct.length === 1) { const name = direct[0].DisplayName || direct[0].CompanyName; return { ours: typed, id: String(direct[0].Id), name }; }
      if (direct.length > 1) return { ours: typed, ambiguous: direct };
    }
    const row = customerRowFor(typed, { list: this.list, aliases: this.aliases });
    const ours = row?.customer || typed;
    const saved = this.map.get(ours);
    if (saved && (saved.how === 'owner' || saved.how === 'exact')) return { ours, id: saved.id, name: saved.name };
    const all = await this.customers();
    const key = nameKey(ours);
    const lk = looseKey(ours);
    let exact = all.filter((c) => [c.DisplayName, c.CompanyName, c.FullyQualifiedName].some((n) => n && (nameKey(n) === key || (lk && looseKey(n) === lk))));
    if (!exact.length) { // not in the cache: ask QuickBooks itself (a customer the office made after the bot started)
      const live = await this.liveFind(ours);
      exact = live.filter((c) => [c.DisplayName, c.CompanyName, c.FullyQualifiedName].some((n) => n && (nameKey(n) === key || (lk && looseKey(n) === lk))));
    }
    if (exact.length === 1) { const name = exact[0].DisplayName || exact[0].CompanyName; this.map.set(ours, exact[0].Id, name, 'exact'); return { ours, id: String(exact[0].Id), name }; }
    if (exact.length > 1) return { ours, ambiguous: exact };
    return { ours, options: matchOne(ours, all).options || [] };
  }

  /**
   * A customer for an INVOICE from a short or partial name ("Ar-rad"). Exact or confirmed first (resolveStrict); then the owner's approved list
   * (a customer or group name that holds all the words as whole words), then the QuickBooks customers that hold all the words as whole words
   * (case, hyphen and space do not matter). Exactly one -> used, and the preview says "from «<typed>»" (his yes on the preview is the
   * confirmation); several -> { candidates } and the request stops. Never a choice between two.
   */
  async resolveLoose(typed) {
    const tk = looseWords(typed);
    const whole = (name, words = tk) => { const t = new Set(looseWords(name)); return words.length > 0 && words.every((x) => t.has(x)); };
    // QuickBooks' own names first: ONE customer whose name holds all the typed words is that customer, whatever an alias or a WhatsApp group name says
    // (the group teaching «A & B» only chooses the group an invoice goes to; it never decides which customer is meant).
    {
      const cached = await this.customers();
      const names0 = (c) => [c.DisplayName, c.CompanyName, c.FullyQualifiedName];
      let first = cached.filter((c) => names0(c).some((n) => n && whole(n)));
      if (!first.length) { const live = await this.liveFind(typed); first = live.filter((c) => names0(c).some((n) => n && whole(n))); }
      const seen0 = new Set();
      first = first.filter((c) => !seen0.has(String(c.Id)) && seen0.add(String(c.Id)));
      if (first.length === 1) {
        const name = first[0].DisplayName || first[0].CompanyName;
        const sameKey = looseKey(name) === looseKey(typed);
        return { ours: typed, id: String(first[0].Id), name, loose: !sameKey, typed };
      }
    }
    const strict = await this.resolveStrict(typed);
    if (strict.id) return { ...strict, loose: false };
    const rows = this.list.rows().filter((r) => whole(r.customer) || rowGroups(r).some((g) => whole(String(g.subject).replace(/aryak/gi, ' '))));
    if (rows.length > 1) return { ours: typed, candidates: rows.map((r) => r.customer).slice(0, 8) };
    if (rows.length === 1) {
      const s = await this.resolveStrict(rows[0].customer);
      if (s.id) return { ...s, loose: true, typed };
    }
    let all = await this.customers();
    const names = (c) => [c.DisplayName, c.CompanyName, c.FullyQualifiedName];
    let hits = all.filter((c) => names(c).some((n) => n && whole(n)));
    if (!hits.length) { // not in the cache: ask QuickBooks itself before saying "not found"
      const live = await this.liveFind(typed);
      if (live.length) { all = await this.customers(); hits = all.filter((c) => names(c).some((n) => n && whole(n))); }
    }
    if (!hits.length && rows.length === 1) { const rk = nameKey(rows[0].customer).split(' ').filter(Boolean); hits = all.filter((c) => names(c).some((n) => n && whole(n, rk))); }
    const seen = new Set();
    hits = hits.filter((c) => !seen.has(String(c.Id)) && seen.add(String(c.Id)));
    if (hits.length === 1) { const name = hits[0].DisplayName || hits[0].CompanyName; return { ours: typed, id: String(hits[0].Id), name, loose: true, typed }; }
    if (hits.length > 1) return { ours: typed, candidates: hits.map((c) => c.DisplayName || c.CompanyName).slice(0, 8) };
    const options = matchOne(typed, all).options || [];
    return { ours: typed, options: options.length ? options : await this.nearestCustomers(typed) };
  }

  /**
   * A customer the cache does not hold, looked up in QuickBooks by the longest word and by the first word of the name (DisplayName LIKE); what is found joins
   * the cache. Returns the rows found (empty when nothing, or when QuickBooks cannot be asked).
   */
  async liveFind(typed) {
    const words = looseWords(typed).filter((w) => w.length >= 3);
    if (!words.length) return [];
    const longest = [...words].sort((a, b) => b.length - a.length)[0];
    const asks = [...new Set([longest, words[0]])];
    const found = new Map();
    for (const w of asks) {
      try {
        const rows = await this.qbo.query(`select Id, DisplayName, CompanyName, FullyQualifiedName, Balance, Active from Customer where DisplayName like '%${qboEscape(w.toUpperCase())}%'`);
        for (const r of rows) found.set(String(r.Id), r);
      } catch { /* QuickBooks cannot be asked now: the cache decides */ }
    }
    if (found.size) {
      const have = new Set(this.cache.customers.map((c) => String(c.Id)));
      const add = [...found.values()].filter((r) => !have.has(String(r.Id)));
      if (add.length) this.cache = { at: this.cache.at || Date.now(), customers: [...this.cache.customers, ...add] };
    }
    return [...found.values()];
  }

  /**
   * A best guess for a customer that could not be settled: { best: { id, name }, alts: [{ id, name }], reason } or null when there is nothing to guess from.
   * [r]: the resolveLoose answer (several exact names, several word matches, or the nearest names). Used only for a PREVIEW; nothing is applied before the owner's yes.
   */
  async guessCustomer(typed, r) {
    const all = await this.customers();
    const rowOf = (name) => all.find((c) => (c.DisplayName || c.CompanyName) === name);
    let list = []; let reason = '';
    if (r.ambiguous?.length) { list = r.ambiguous.map((c) => ({ id: String(c.Id), name: c.DisplayName || c.CompanyName })); reason = 'چند مشتری با این نام'; }
    else if (r.candidates?.length) { list = r.candidates.map((n) => { const c = rowOf(n); return c ? { id: String(c.Id), name: n } : null; }).filter(Boolean); reason = 'چند مشتری با این واژه‌ها'; }
    else if (r.options?.length) { list = r.options.map((o) => ({ id: String(o.id), name: o.name, label: o.label })); reason = 'نزدیک‌ترین نام'; }
    if (!list.length) return null;
    const ranked = rankNames(typed, list.map((x) => ({ name: x.name, key: x })));
    if (!r.ambiguous?.length && !r.candidates?.length && !(ranked[0]?.score >= 0.5)) return null; // the nearest names are only SHOWN when none is near enough to be a guess
    const ordered = ranked.map((x) => x.key.key || x.key);
    const norm = (x) => ({ id: x.id, name: x.name, ...(x.label ? { label: x.label } : {}) });
    return { best: norm(ordered[0]), alts: ordered.slice(1, 4).map(norm), reason };
  }

  /** The three nearest names among ALL customers, inactive ones too, by token overlap and sound (case, LLC and L.L.C do not matter); even weak ones are listed. */
  async nearestCustomers(typed) {
    let rows = [];
    try { rows = await this.qbo.query('select Id, DisplayName, CompanyName, FullyQualifiedName, Active from Customer where Active in (true, false)'); } catch { rows = await this.customers(); }
    const people = rows.map((c) => ({ name: c.DisplayName || c.CompanyName || '', alts: [c.CompanyName, c.FullyQualifiedName].filter((x) => x && x !== c.DisplayName), id: String(c.Id), inactive: c.Active === false }));
    return rankNames(typed, people).filter((r) => r.score > 0.2).slice(0, 3).map((r) => ({ id: r.key.id, name: r.name, label: r.key.inactive ? `${r.name} (غیرفعال)` : r.name }));
  }

  /** One statement to the test group (or, for an authorized person, to that person's own private chat). Returns the lines to tell the asker. */
  /**
   * A customer from a name SPOKEN or typed loosely: the exact and loose rules first, then a sound-alike ranking of the QuickBooks names, the approved
   * list and the aliases (Persian "پالم برد" against "PALM BIRD TRADING LLC"). { id, name } for one clear match; { many: [names] } to ask; { nearest: [names] }.
   */
  async resolveSpoken(typed) {
    const r = await this.resolveLoose(typed);
    if (r.id) return { id: r.id, name: r.name || r.ours, via: r.loose ? 'words' : 'exact' };
    if (r.candidates?.length > 1) { // several names hold the typed words (a short «AL»): a numbered list of the best, never a guess between them
      const ranked = rankNames(typed, r.candidates).map((x) => x.name);
      return { many: [...new Set(ranked)].slice(0, 5) };
    }
    const all = await this.customers();
    const names = all.map((c) => ({ name: c.DisplayName || c.CompanyName || '', alts: [c.CompanyName, c.FullyQualifiedName].filter((x) => x && x !== c.DisplayName), id: String(c.Id) }));
    for (const row of this.list.rows()) names.push({ name: row.customer, alts: [], id: '', approved: true }); // the approved list (Persian names too)
    const picked = pickSpoken(typed, names, { strong: 0.7 });
    const pickName = (x) => { const hit = names.find((n) => n.name === x.name && n.id) || null; return hit; };
    if (picked.kind === 'one') {
      const hit = pickName(picked.best);
      if (hit) return { id: hit.id, name: hit.name, via: 'sound' };
      const viaRow = await this.resolveStrict(picked.best.name); // an approved-list name: its QuickBooks customer, if it has one
      if (viaRow.id) return { id: viaRow.id, name: viaRow.name || picked.best.name, via: 'sound' };
    }
    const cands = (picked.kind === 'many' ? picked.candidates : picked.kind === 'one' ? [picked.best] : []).map((c) => c.name);
    if (cands.length > 1) return { many: [...new Set(cands)].slice(0, 5) };
    return { nearest: [...new Set((picked.nearest || picked.ranked.slice(0, 3)).map((c) => c.name))].slice(0, 3) };
  }

  /**
   * A statement for a PERIOD of a customer named in any words, sent to [privateJid] (the asker's own chat). Returns { ok, text }; { ok: false, ask: true } when the
   * customer must be chosen first (a numbered list) or was not found (the three nearest).
   */
  async statementFor(typed, { privateJid, period = null, hold = false } = {}) {
    const found = await this.resolveSpoken(typed);
    if (!found.id) {
      if (found.many) return { ok: false, ask: true, text: `چند مشتری به «${typed}» می‌خورد؛ شمارهٔ درست را بنویسید:\n${found.many.map((n, i) => `${fa(i + 1)}. ${n}`).join('\n')}`, options: found.many };
      return { ok: false, ask: true, text: `مشتری‌ای به نام «${typed}» پیدا نشد. نزدیک‌ترین‌ها:\n${(found.nearest || []).map((n, i) => `${fa(i + 1)}. ${n}`).join('\n') || '—'}\nنام درست را بنویسید یا بگویید.`, options: found.nearest || [] };
    }
    if (!privateJid && !hold) return { ok: false, text: 'مقصد صورت‌حساب مشخص نیست؛ چیزی فرستاده نشد.' };
    const data = buildStatementData({ ...(await loadCustomerData(this.qbo, found.id)), today: this.today(), ...(period ? { from: period.from, to: period.to } : {}) });
    const pdf = statementPdf(data, { sandbox: this.qbo.env === 'sandbox' });
    const safe = (data.customer.name || found.name).replace(/[^\w.-]+/g, '_').slice(0, 40) || 'customer';
    const cur = data.currency ? `${data.currency} ` : '';
    const caption = `Statement - ${data.customer.name || found.name} - ${period ? `${period.from} to ${period.to}` : 'current'} - balance ${cur}${money(data.closing)}`;
    const fileName = `statement-${safe}${period ? `-${period.label}` : ''}.pdf`;
    if (hold) return { ok: true, held: { pdf, fileName, caption }, name: data.customer.name || found.name, closing: data.closing, currency: data.currency || '', guessed: found.via === 'sound', typed, text: '' }; // built, not sent: the caller keeps it for the owner's yes
    await this.post(privateJid, pdf, fileName, caption);
    // a read-only action with ONE clearly best candidate is done and said, not asked: «(حدس از …)»
    const guessed = found.via === 'sound' ? ` (حدس از «${typed}» — اگر مشتری دیگری بود بنویسید)` : '';
    return { ok: true, name: data.customer.name || found.name, guessed: !!guessed, text: `صورت‌حساب «${data.customer.name || found.name}»${guessed}${period ? ` از ${fa(period.from)} تا ${fa(period.to)}` : ''} فرستاده شد (مانده ${money(data.closing)}${data.currency ? ` ${data.currency}` : ''}${period ? '، مانده در پایان دوره' : ''}).` };
  }

  async statementOne(typed, privateJid = null) {
    const r = await this.resolve(typed);
    if (!r.id) {
      if (r.options.length) {
        const ask = (this.map.d.pending ||= []);
        const n = ask.reduce((m, x) => Math.max(m, x.n), 0) + 1;
        ask.push({ n, ours: r.ours, options: r.options });
        this.map.persist();
        return { ok: false, text: `برای «${r.ours}» چند مشتری در کوییک‌بوکس هست؛ خودتان بگویید («تطبیق ${fa(n)} = ۱» ...):\n${r.options.map((o, i) => `${fa(i + 1)}) ${o.name}`).join('\n')}` };
      }
      return { ok: false, text: `برای «${r.ours}» مشتری مشابهی در کوییک‌بوکس پیدا نشد.` };
    }
    let targetId = privateJid;
    if (!targetId) {
      const target = pickTestGroup(await this.groups(), this.config);
      if (!target) return { ok: false, text: 'گروه آزمایشی پیدا نشد؛ چیزی فرستاده نشد.' };
      targetId = target.id;
    }
    const data = buildStatementData({ ...(await loadCustomerData(this.qbo, r.id)), today: this.today() });
    const pdf = statementPdf(data, { sandbox: this.qbo.env === 'sandbox' });
    const safe = (data.customer.name || r.ours).replace(/[^\w.-]+/g, '_').slice(0, 40) || 'customer';
    const cur = data.currency ? `${data.currency} ` : '';
    const caption = `Statement - ${data.customer.name || r.ours} - balance ${cur}${money(data.closing)}${data.balanceCheck.matches === false ? ` (QuickBooks balance differs: ${cur}${money(data.balanceCheck.qbo)})` : ''}`;
    await this.post(targetId, pdf, `statement-${safe}.pdf`, caption);
    return { ok: true, text: `صورت‌حساب «${data.customer.name || r.ours}» به گروه آزمایشی رفت (مانده ${money(data.closing)}${data.currency ? ` ${data.currency}` : ''}${data.balanceCheck.matches === false ? '؛ با مانده کوییک‌بوکس نمی‌خواند' : ''}).` };
  }

  async statement(typed) {
    const r = await this.statementOne(typed);
    return [r.text];
  }

  /** One per approved customer, a gap between posts, at most 50; runs in the background and reports at the end. */
  async all() {
    if (this.busy) return ['صورت‌حساب همه در حال اجرا است؛ صبر کنید.'];
    const rows = this.rows.slice(0, MAX_ALL);
    if (!rows.length) return ['فهرست مشتری و گروه مشتری تأییدشده ندارد.'];
    this.busy = true;
    const head = `شروع شد: ${fa(rows.length)} صورت‌حساب${this.rows.length > MAX_ALL ? ` (حداکثر ${fa(MAX_ALL)}؛ ${fa(this.rows.length - MAX_ALL)} مشتری ماند)` : ''} فقط به گروه آزمایشی. بین هر دو ارسال فاصله هست.`;
    void (async () => {
      let sent = 0; const failed = [];
      try {
        for (const [i, r] of rows.entries()) {
          try { const x = await this.statementOne(r.customer); if (x.ok) sent += 1; else failed.push(r.customer); } catch (e) { failed.push(r.customer); this.log(`QuickBooks statement ${i + 1}/${rows.length} failed: ${e.name} ${e.status || ''}`); }
          if (i < rows.length - 1) await this.sleep(this.gapMs);
        }
      } finally { this.busy = false; }
      this.log(`QuickBooks statements done: ${sent} sent, ${failed.length} not`);
      await this.finish?.([`پایان: ${fa(sent)} صورت‌حساب رفت.${failed.length ? ` ${fa(failed.length)} مشتری نشد (بدون تطبیق قطعی یا خطا): ${failed.slice(0, 15).join('، ')}. برای رفع: «تطبیق کوییک‌بوکس».` : ''}`]);
    })();
    return [head];
  }
}
