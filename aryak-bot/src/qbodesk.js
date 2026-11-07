// THE OWNER'S QUICKBOOKS COMMANDS (his own chat, owner only): "وضعیت کوییک‌بوکس", "تطبیق کوییک‌بوکس" (the match table, with a question where it is unsure),
// "صورت‌حساب <customer>" and "صورت‌حساب همه" (at most 50, a gap between posts). READ ONLY: nothing is ever written to QuickBooks here. Every statement
// is posted ONLY to the test group, whatever is asked: the desk has no target to choose, it asks for "the test group" and nothing else.

import fs from 'node:fs';
import path from 'node:path';
import { clearWinner, customerRowFor, nameKey, rankCustomers } from './customergroups.js';
import { buildStatementData, loadCustomerData, money, statementPdf } from './qbostatement.js';
import { groupAllowed, shadowGroup } from './guard.js';

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
  if ((m = /^صورت\s*حساب\s+(.+)$/u.exec(s))) return m[1].trim() === 'همه' ? { type: 'all' } : { type: 'statement', name: m[1].trim() };
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
  const exact = people.filter((p) => [p.name, ...p.alts].some((n) => nameKey(n) === nameKey(ourName)));
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
    const row = customerRowFor(typed, { list: this.list, aliases: this.aliases });
    const ours = row?.customer || typed;
    const saved = this.map.get(ours);
    if (saved && (saved.how === 'owner' || saved.how === 'exact')) return { ours, id: saved.id, name: saved.name };
    const all = await this.customers();
    const key = nameKey(ours);
    const exact = all.filter((c) => [c.DisplayName, c.CompanyName, c.FullyQualifiedName].some((n) => n && nameKey(n) === key));
    if (exact.length === 1) { const name = exact[0].DisplayName || exact[0].CompanyName; this.map.set(ours, exact[0].Id, name, 'exact'); return { ours, id: String(exact[0].Id), name }; }
    if (exact.length > 1) return { ours, ambiguous: exact };
    return { ours, options: matchOne(ours, all).options || [] };
  }

  /** One statement to the test group (or, for an authorized person, to that person's own private chat). Returns the lines to tell the asker. */
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
