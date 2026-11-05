// THE FIXED LIST "customer name on the invoice -> WhatsApp group". Kept on the VM in a versioned file (every change keeps the version before),
// keyed by the normalised customer name as printed on the invoice; the group JID is what counts (a renamed group keeps working), the group
// name is kept only to show. Only the OWNER, only in his own chat, proposes and approves. Building a proposal is free code (no paid call), and
// approving a row sends nothing: the list only tells the owner-ordered invoice send (invoicesend.js) WHICH group, which still passes the
// customer-group rule and the owner's own yes at send time. A group chosen here is never a new way to write to a customer.

import fs from 'node:fs';
import path from 'node:path';
import { looseName, isTestCustomer } from './invoicesend.js';
import { sameName } from './sheetcheck.js';
import { shadowGroup } from './guard.js';
import { normalizeLetters } from './text.js';

const PER_MESSAGE = 40;
const PENDING_MS = 10 * 60 * 1000;

/** The key of a customer name: letters and digits only, lower case, single spaces ("IND . LLC" and "ind llc" are one customer). */
export const nameKey = (s) => normalizeLetters(String(s || '')).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const latinDigits = (s) => String(s).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const persianDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const plain = (s) => latinDigits(String(s || '')).replace(/[‌‎‏]/g, ' ').replace(/[أإ]/g, 'ا').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------------------------- the stored list
export class CustomerGroups {
  constructor(dir = '') {
    this.dir = dir;
    this.file = dir ? path.join(dir, 'customer-groups.json') : '';
    this.d = { version: 0, updatedAt: '', rows: {}, declined: [], reported: [], proposal: null };
    try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* first start */ }
  }

  persist() {
    if (!this.file) return;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d)); } catch { /* best effort */ }
  }

  rows() { return Object.values(this.d.rows); }
  get size() { return Object.keys(this.d.rows).length; }

  /** The approved row of a customer: by the name as printed, or by one of his other names. */
  find(customer, alts = []) {
    for (const n of [customer, ...alts]) { const r = this.d.rows[nameKey(n)]; if (r) return r; }
    return null;
  }

  /** Every change of the rows is a new version; the one before it goes to customer-groups-history. */
  commit(change, now = new Date()) {
    if (this.dir && this.d.version > 0) {
      try {
        fs.mkdirSync(path.join(this.dir, 'customer-groups-history'), { recursive: true });
        fs.writeFileSync(path.join(this.dir, 'customer-groups-history', `customer-groups-v${this.d.version}.json`), JSON.stringify({ version: this.d.version, updatedAt: this.d.updatedAt, rows: this.d.rows }));
      } catch { /* best effort */ }
    }
    change();
    this.d.version += 1;
    this.d.updatedAt = now.toISOString();
    this.persist();
  }

  approve(customer, jid, subject, now = new Date()) {
    const row = { customer: String(customer).trim(), jid, subject: String(subject || ''), status: 'approved', at: now.toISOString() };
    this.commit(() => { this.d.rows[nameKey(customer)] = row; }, now);
    return row;
  }

  remove(customer, now = new Date()) {
    const key = nameKey(customer);
    if (!this.d.rows[key]) return false;
    this.commit(() => { delete this.d.rows[key]; }, now);
    return true;
  }

  decline(customer, jid) { if (!this.isDeclined(customer, jid)) { this.d.declined.push(`${nameKey(customer)}|${jid}`); this.persist(); } }
  isDeclined(customer, jid) { return this.d.declined.includes(`${nameKey(customer)}|${jid}`); }

  /** The customers already named in a digest line as having no group (each is named once). */
  newUnmapped(customers, config, { mark = true } = {}) {
    if (!this.size) return []; // no list yet: the proposal comes first, no line per customer
    const fresh = [];
    for (const c of customers) {
      const k = nameKey(c);
      if (!k || isTestCustomer(c, config.testCustomerName) || this.d.rows[k] || this.d.reported.includes(k) || fresh.some((f) => nameKey(f) === k)) continue;
      fresh.push(c);
    }
    if (mark && fresh.length) { this.d.reported.push(...fresh.map(nameKey)); this.d.reported = this.d.reported.slice(-500); this.persist(); }
    return fresh;
  }
}

// ---------------------------------------------------------------------------------------------------------------- what is known (free)
/**
 * The invoice customers she has, from the reads of the invoices she saw, the invoice steps of the tracker and the aliases, and how many
 * distinct invoices that is. [reads]: { messageId: { number, customer } }; [events]: tracker events; [aliasMap]: customer -> other names.
 */
export function collectCustomers({ reads = {}, events = [], aliasMap = {} } = {}) {
  const byKey = new Map();
  const numbers = new Set();
  const add = (name) => { const n = String(name || '').trim(); const k = nameKey(n); if (k && !byKey.has(k)) byKey.set(k, n); };
  for (const r of Object.values(reads)) { if (r?.customer) add(r.customer); if (r?.number && r?.customer) numbers.add(String(r.number).toLowerCase()); }
  for (const e of events) if (e?.type === 'invoice') { if (e.customer) add(e.customer); if (e.number) numbers.add(String(e.number).toLowerCase()); else if (e.ref) numbers.add(`ref:${e.ref}`); }
  for (const c of Object.keys(aliasMap)) add(c);
  return { customers: [...byKey.values()], invoices: numbers.size };
}

/** The other names of a customer from the aliases (the main name, the others; never the name itself). */
export function altNames(aliasMap, name) {
  for (const [c, others] of Object.entries(aliasMap || {})) {
    const all = [c, ...others];
    if (all.some((x) => nameKey(x) === nameKey(name))) return all.filter((x) => nameKey(x) !== nameKey(name));
  }
  return [];
}

const subjectCore = (subject) => String(subject).replace(/aryak/gi, ' ');

// ---------------------------------------------------------------------------------------------------------------- the proposal
/**
 * Customers against customer groups by the same rule that says what a customer group is (shadowGroup: never an internal or other group).
 * Confident = exactly one group and the same name; options = one or more groups that only look alike; none = no group.
 */
export function buildProposal({ customers, groups, config, list, aliasMap = {}, invoices = 0, now = Date.now() }) {
  const custGroups = groups.filter((g) => shadowGroup(g.subject, config));
  const rows = [];
  const claimed = new Set();
  for (const name of customers) {
    if (!nameKey(name) || isTestCustomer(name, config.testCustomerName)) continue;
    const alts = altNames(aliasMap, name);
    if (list.find(name, alts)) continue;
    const names = [name, ...alts];
    const found = custGroups.filter((g) => !list.isDeclined(name, g.id) && names.some((n) => looseName(n, subjectCore(g.subject))));
    for (const g of found) claimed.add(g.id);
    const strong = found.length === 1 && names.some((n) => sameName(n, subjectCore(found[0].subject)));
    rows.push({ customer: name, kind: strong ? 'confident' : found.length ? 'options' : 'none', options: found.map((g) => ({ jid: g.id, subject: g.subject })), status: 'open' });
  }
  const order = { confident: 0, options: 1, none: 2 };
  rows.sort((a, b) => order[a.kind] - order[b.kind]);
  rows.forEach((r, i) => { r.n = i + 1; });
  const mapped = new Set(list.rows().map((r) => r.jid));
  const orphans = custGroups.filter((g) => !claimed.has(g.id) && !mapped.has(g.id)).map((g) => g.subject);
  return { at: now, invoices, rows, orphans };
}

/** The proposal (and the current list) as messages of about 40 rows each, in Persian, names exactly as they are. */
export function proposalTexts(proposal, list) {
  const out = [];
  let cur = [];
  let count = 0;
  let head = '';
  const push = (line, isRow = false, header = '') => {
    if (isRow && count >= PER_MESSAGE) { out.push(cur.join('\n')); cur = head ? [`${head} (ادامه)`] : []; count = 0; }
    if (header) head = header;
    cur.push(line);
    if (isRow) count += 1;
  };
  push(`فهرست مشتری و گروه — این پیشنهاد از ${persianDigits(proposal.invoices)} فاکتور ساخته شده است${proposal.invoices < 20 ? ' (هنوز کوتاه است و با فاکتورهای بیشتر کامل‌تر می‌شود)' : ''}.`);
  const cur_ = list.rows();
  if (cur_.length) {
    push('');
    push(`فهرست تأییدشدهٔ فعلی (${persianDigits(cur_.length)} مشتری):`, false, 'فهرست تأییدشدهٔ فعلی:');
    for (const r of cur_) push(`• ${r.customer} — ${r.subject}`, true);
  }
  const section = (kind, title, show) => {
    const rows = proposal.rows.filter((r) => r.kind === kind && r.status === 'open');
    if (!rows.length) return;
    push('');
    push(title, false, title);
    for (const r of rows) { push(show(r), true); if (kind === 'options') r.options.forEach((o, i) => push(`    ${persianDigits(i + 1)}) ${o.subject}`)); }
  };
  section('confident', '✅ جفت‌های مطمئن:', (r) => `${persianDigits(r.n)}. ${r.customer} — ${r.options[0].subject}`);
  section('options', '❓ چند گروه ممکن (گزینه را بنویسید):', (r) => `${persianDigits(r.n)}. ${r.customer}`);
  section('none', '⛔ بدون گروه:', (r) => `${persianDigits(r.n)}. ${r.customer}`);
  if (!proposal.rows.some((r) => r.status === 'open')) { push(''); push('مشتری تازه‌ای بدون گروه نیست.'); }
  if (proposal.orphans.length) {
    push('');
    push(`گروه‌های مشتری که هنوز فاکتوری برایشان ندیده‌ام (${persianDigits(proposal.orphans.length)}):`, false, 'گروه‌های بدون فاکتور:');
    for (const s of proposal.orphans) push(`• ${s}`, true);
  }
  push('');
  push('پاسخ: «تأیید همه» (فقط جفت‌های مطمئن)، «تأیید ۱ ۳ ۵»، «۳ نه»، «۴ = ۲» (گزینهٔ ۲ برای ردیف ۴)، «۷ = کلمات نام گروه». تا پاسخ ندهید چیزی ذخیره نمی‌شود و هیچ فاکتوری فرستاده نمی‌شود.');
  out.push(cur.join('\n'));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the words of the owner
/** The group among [groups] named by some words of its name: { group } exactly one, { ambiguous: [...] }, { internal: true } or { none: true }. */
export function resolveGroupWords(words, groups, config) {
  const tokens = nameKey(words).split(' ').filter(Boolean);
  if (!tokens.length) return { none: true };
  const hits = groups.filter((g) => { const k = nameKey(g.subject); return tokens.every((t) => k.includes(t)); });
  const cust = hits.filter((g) => shadowGroup(g.subject, config));
  if (cust.length === 1) return { group: cust[0] };
  if (cust.length > 1) return { ambiguous: cust };
  return hits.length ? { internal: true } : { none: true };
}

/** What the owner wrote, as one of the forms; null when it is none of them. Persian, Arabic and Latin digits, with or without the hamza. */
export function parseListCommand(text) {
  const s = plain(text).replace(/^آتوسا[ ,،:]*/u, '').replace(/[.!؟?]+$/u, '').trim();
  if (!s) return null;
  if (/^(?:فهرست|لیست)\s*مشتری(?:\s*و|\s*[/-])?\s*گروه(?:\s*ها)?$/u.test(s) || /^customer\s*(?:and\s*)?group\s*list$/i.test(s)) return { type: 'list' };
  if (/^تایید\s*همه$/u.test(s) || /^approve\s*all$/i.test(s)) return { type: 'approveAll' };
  let m = /^(?:تایید|approve)\s+(\d+(?:[\s,،و]+\d+)*)$/iu.exec(s);
  if (m) return { type: 'approve', nums: m[1].split(/[\s,،و]+/).map(Number) };
  if ((m = /^(\d+)\s*(?:نه|no)$/iu.exec(s))) return { type: 'reject', n: Number(m[1]) };
  if ((m = /^(\d+)\s*=\s*(.+)$/u.exec(s))) return { type: 'pick', n: Number(m[1]), value: m[2].trim() };
  if ((m = /^مشتری\s+(.+?)\s+گروه\s+(.+)$/u.exec(s)) || (m = /^customer\s+(.+?)\s+group\s+(.+)$/iu.exec(s))) return { type: 'set', customer: m[1].trim(), words: m[2].trim() };
  if ((m = /^حذف\s+مشتری\s+(.+)$/u.exec(s)) || (m = /^remove\s+customer\s+(.+)$/iu.exec(s))) return { type: 'remove', customer: m[1].trim() };
  if (/^(?:بله|اره|آره|تایید|yes|y|ok)$/iu.test(s)) return { type: 'yes' };
  if (/^(?:نه|خیر|نخیر|لغو|no|n|cancel)$/iu.test(s)) return { type: 'no' };
  return null;
}

// ---------------------------------------------------------------------------------------------------------------- the desk
/** The owner's conversation about the list. Holds the open proposal (kept in the list file) and one pending change waiting for his yes. */
export class CustomerGroupDesk {
  constructor({ list, config, now = () => Date.now() }) {
    this.list = list;
    this.config = config;
    this.now = now;
    this.pending = null;
  }

  get proposal() { return this.list.d.proposal; }

  /** The parsed command when this desk should take the message (an answer needs an open proposal or a pending change), else null. */
  wants(text) {
    const p = parseListCommand(text);
    if (!p) return null;
    if (p.type === 'yes' || p.type === 'no') return this.livePending() ? p : null;
    if (['approveAll', 'approve', 'reject', 'pick'].includes(p.type)) return this.proposal ? p : null;
    return p;
  }

  livePending() { if (this.pending && this.now() - this.pending.at > PENDING_MS) this.pending = null; return this.pending; }

  /** [groups]: { id, subject } of every group now; [known]: { customers, invoices, aliasMap }. Returns the messages to send back. */
  handle(p, { groups, known }) {
    const live = (jid) => groups.find((g) => g.id === jid);
    const usable = (g) => g && shadowGroup(g.subject, this.config);
    switch (p.type) {
      case 'list': {
        const proposal = buildProposal({ customers: known.customers, groups, config: this.config, list: this.list, aliasMap: known.aliasMap, invoices: known.invoices, now: this.now() });
        this.list.d.proposal = proposal;
        this.list.persist();
        return proposalTexts(proposal, this.list);
      }
      case 'approveAll': return this.save(this.proposal.rows.filter((r) => r.status === 'open' && r.kind === 'confident').map((r) => ({ row: r, option: r.options[0] })), [], live, usable, 'همهٔ جفت‌های مطمئن');
      case 'approve': return this.approveNumbers(p.nums, live, usable);
      case 'reject': {
        const row = this.proposal.rows.find((r) => r.n === p.n);
        if (!row) return [this.wrong(p.n)];
        if (row.status !== 'open') return [`ردیف ${persianDigits(p.n)} قبلاً رسیدگی شده است.`];
        row.status = 'declined';
        for (const o of row.options) this.list.decline(row.customer, o.jid);
        this.list.persist();
        return [`ردیف ${persianDigits(p.n)} (${row.customer}) رد شد و دوباره پیشنهاد نمی‌شود. چیزی ذخیره نشد.`];
      }
      case 'pick': {
        const row = this.proposal.rows.find((r) => r.n === p.n);
        if (!row) return [this.wrong(p.n)];
        if (row.status !== 'open') return [`ردیف ${persianDigits(p.n)} قبلاً رسیدگی شده است. برای تغییر بنویسید: مشتری ${row.customer} گروه …`];
        if (/^\d+$/.test(p.value)) {
          const o = row.options[Number(p.value) - 1];
          if (!o) return [`ردیف ${persianDigits(p.n)} گزینهٔ ${persianDigits(p.value)} ندارد.${row.options.length ? '' : ' برایش گروهی پیدا نشده؛ بخشی از نام گروه را بنویسید.'}`];
          return this.save([{ row, option: o }], [], live, usable, '');
        }
        const r = resolveGroupWords(p.value, groups, this.config);
        const bad = this.badGroup(r);
        if (bad) return [bad];
        return this.save([{ row, option: { jid: r.group.id, subject: r.group.subject } }], [], live, usable, '');
      }
      case 'set': {
        const r = resolveGroupWords(p.words, groups, this.config);
        const bad = this.badGroup(r);
        if (bad) return [bad];
        const old = this.list.find(p.customer);
        this.pending = { kind: 'set', customer: p.customer, jid: r.group.id, subject: r.group.subject, at: this.now() };
        return [`ذخیره شود؟ ${p.customer} — ${r.group.subject}${old ? `\n(جایگزین گروه قبلی: ${old.subject})` : ''}\nبله / نه (تا ۱۰ دقیقه معتبر است). چیزی فرستاده نمی‌شود.`];
      }
      case 'remove': {
        const old = this.list.find(p.customer);
        if (!old) return [`مشتری ${p.customer} در فهرست نیست.`];
        this.pending = { kind: 'remove', customer: old.customer, subject: old.subject, at: this.now() };
        return [`از فهرست حذف شود؟ ${old.customer} — ${old.subject}\nبله / نه (تا ۱۰ دقیقه معتبر است).`];
      }
      case 'yes': {
        const pend = this.livePending();
        this.pending = null;
        if (pend.kind === 'remove') { this.list.remove(pend.customer, new Date(this.now())); return [`حذف شد: ${pend.customer}. فهرست حالا ${persianDigits(this.list.size)} مشتری دارد.`]; }
        const g = live(pend.jid);
        if (!usable(g)) return [`گروه «${pend.subject}» اکنون پیدا نمی‌شود یا گروه مشتری نیست. چیزی ذخیره نشد.`];
        const row = this.list.approve(pend.customer, g.id, g.subject, new Date(this.now()));
        return [`ذخیره شد: ${row.customer} — ${row.subject}. فهرست حالا ${persianDigits(this.list.size)} مشتری دارد. چیزی فرستاده نشد.`];
      }
      case 'no': this.pending = null; return ['انجام نشد. چیزی تغییر نکرد.'];
      default: return [];
    }
  }

  wrong(n) { return `ردیف ${persianDigits(n)} در این پیشنهاد نیست. چیزی ذخیره نشد.`; }

  badGroup(r) {
    if (r.group) return '';
    if (r.ambiguous) return `چند گروه مشتری با این کلمات هست، دقیق‌تر بنویسید:\n${r.ambiguous.map((g) => `• ${g.subject}`).join('\n')}`;
    if (r.internal) return 'این گروه، گروه مشتری نیست (گروه داخلی یا دیگر). برای آن چیزی ذخیره نمی‌شود.';
    return 'گروه مشتری با این کلمات پیدا نشد. چیزی ذخیره نشد.';
  }

  approveNumbers(nums, live, usable) {
    const todo = [];
    const notes = [];
    for (const n of nums) {
      const row = this.proposal.rows.find((r) => r.n === n);
      if (!row) { notes.push(this.wrong(n)); continue; }
      if (row.status !== 'open') { notes.push(`ردیف ${persianDigits(n)} قبلاً رسیدگی شده است.`); continue; }
      if (row.kind === 'none') { notes.push(`ردیف ${persianDigits(n)} (${row.customer}) گروهی ندارد؛ بنویسید «${persianDigits(n)} = کلمات نام گروه».`); continue; }
      if (row.options.length > 1) { notes.push(`ردیف ${persianDigits(n)} (${row.customer}) چند گروه دارد؛ بنویسید «${persianDigits(n)} = ۱» تا گزینه را برگزینید.`); continue; }
      todo.push({ row, option: row.options[0] });
    }
    return this.save(todo, notes, live, usable, '');
  }

  /** Saves each { row, option } whose group is still there and still a customer group; says what was saved and what was not. */
  save(items, notes, live, usable, what) {
    const lines = [];
    for (const { row, option } of items) {
      const g = live(option.jid);
      if (!usable(g)) { notes.push(`ردیف ${persianDigits(row.n)} (${row.customer}): گروه «${option.subject}» اکنون پیدا نمی‌شود یا گروه مشتری نیست؛ ذخیره نشد.`); continue; }
      this.list.approve(row.customer, g.id, g.subject, new Date(this.now()));
      row.status = 'saved';
      lines.push(`✅ ${persianDigits(row.n)}. ${row.customer} — ${g.subject}`);
    }
    this.list.persist();
    const left = this.proposal.rows.filter((r) => r.status === 'open').length;
    const head = lines.length ? `${what ? `${what}: ` : ''}${persianDigits(lines.length)} ردیف ذخیره شد:` : 'چیزی ذخیره نشد.';
    return [[head, ...lines, ...notes, lines.length ? `فهرست حالا ${persianDigits(this.list.size)} مشتری دارد. ردیف باز: ${persianDigits(left)}. چیزی فرستاده نشد.` : ''].filter(Boolean).join('\n')];
  }
}
