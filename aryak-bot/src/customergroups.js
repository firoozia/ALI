// THE FIXED LIST "customer name on the invoice -> WhatsApp group(s)". Kept on the VM in a versioned file (every change keeps the version before),
// keyed by the normalised customer name; the group JID is what counts (a renamed group keeps working), the group name is kept only to show.
// A customer may have more than one approved group (a branch, a team group); the send then asks the owner which one and never sends to two.
// Only the OWNER, only in his own chat, imports names, proposes and approves. Everything here is free code (no paid call), and approving a row
// sends nothing: the list only tells the owner-ordered invoice send (invoicesend.js) WHICH group, which still passes the customer-group rule
// and the owner's own yes at send time. The imported names (his accounting export, names only) live on the VM, never in the repository or a log.

import { typedFitsName } from './qboname.js';
import fs from 'node:fs';
import path from 'node:path';
import { editDistance, isTestCustomer } from './invoicesend.js';
import { groupAllowed, observedGroup, shadowGroup } from './guard.js';
import { normalizeLetters } from './text.js';

const PER_MESSAGE = 40;
const PENDING_MS = 10 * 60 * 1000;
const IMPORT_MS = 30 * 60 * 1000;
const MAX_NAMES = 400;
const MAX_OPTIONS = 4;

/** The key of a customer name: letters and digits only, lower case, single spaces ("IND . LLC" and "ind llc" are one customer). */
export const nameKey = (s) => normalizeLetters(String(s || '')).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const latinDigits = (s) => String(s).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const persianDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const plain = (s) => latinDigits(String(s || '')).replace(/[‌‎‏]/g, ' ').replace(/[أإ]/g, 'ا').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();

/** The groups of a row: the list kept (new rows) or the one jid of an older row. */
export const rowGroups = (row) => (row?.groups?.length ? row.groups : row ? [{ jid: row.jid, subject: row.subject }] : []);
const showGroups = (groups) => groups.map((g) => g.subject).join(' + ');

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

  /** One customer, one or more groups [{ jid, subject }]. The first group is also kept as jid/subject (the older row shape). */
  approveGroups(customer, groups, now = new Date()) {
    const list = groups.map((g) => ({ jid: g.jid, subject: String(g.subject || '') }));
    const row = { customer: String(customer).trim(), jid: list[0].jid, subject: list[0].subject, groups: list, status: 'approved', at: now.toISOString() };
    this.commit(() => { this.d.rows[nameKey(customer)] = row; }, now);
    return row;
  }

  approve(customer, jid, subject, now = new Date()) { return this.approveGroups(customer, [{ jid, subject }], now); }

  remove(customer, now = new Date()) {
    const key = nameKey(customer);
    if (!this.d.rows[key]) return false;
    this.commit(() => { delete this.d.rows[key]; }, now);
    return true;
  }

  decline(customer, jid) { if (!this.isDeclined(customer, jid)) { this.d.declined.push(`${nameKey(customer)}|${jid}`); this.persist(); } }
  isDeclined(customer, jid) { return this.d.declined.includes(`${nameKey(customer)}|${jid}`); }

  /** Short English lines for the next daily digest (a name printed on an invoice that matched a stored customer). */
  addNote(line) { (this.d.notes ||= []).push(line); this.d.notes = this.d.notes.slice(-40); this.persist(); }
  takeNotes() { const n = this.d.notes || []; if (n.length) { this.d.notes = []; this.persist(); } return n; }

  /** The customers named in a digest line as having no group (each is named once). */
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

/** The names the owner imported from his accounting export (names only), versioned; a new import replaces them and keeps the older version. */
export class NameBook {
  constructor(dir = '') {
    this.dir = dir;
    this.file = dir ? path.join(dir, 'customer-names.json') : '';
    this.d = { version: 0, updatedAt: '', names: [] };
    try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ }
  }

  names() { return this.d.names.slice(); }
  get size() { return this.d.names.length; }

  save(names, now = new Date()) {
    if (this.dir && this.d.version > 0) {
      try {
        fs.mkdirSync(path.join(this.dir, 'customer-names-history'), { recursive: true });
        fs.writeFileSync(path.join(this.dir, 'customer-names-history', `customer-names-v${this.d.version}.json`), JSON.stringify(this.d));
      } catch { /* best effort */ }
    }
    this.d = { version: this.d.version + 1, updatedAt: now.toISOString(), names: names.slice(0, MAX_NAMES) };
    if (this.file) { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d)); } catch { /* best effort */ } }
    return this.d;
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

/** The imported names first, then the names only the invoices have; and how many came from which source. */
export function mergeSources(bookNames, { customers = [], invoices = 0 } = {}) {
  const seen = new Set();
  const out = [];
  for (const n of bookNames) { const k = nameKey(n); if (k && !seen.has(k)) { seen.add(k); out.push(n); } }
  const fromBook = out.length;
  for (const n of customers) { const k = nameKey(n); if (k && !seen.has(k)) { seen.add(k); out.push(n); } }
  return { customers: out, invoices, fromBook, fromInvoices: out.length - fromBook };
}

/** The other names of a customer from the aliases (the main name, the others; never the name itself). */
export function altNames(aliasMap, name) {
  for (const [c, others] of Object.entries(aliasMap || {})) {
    const all = [c, ...others];
    if (all.some((x) => nameKey(x) === nameKey(name))) return all.filter((x) => nameKey(x) !== nameKey(name));
  }
  return [];
}

// ---------------------------------------------------------------------------------------------------------------- matching
/**
 * Words that say nothing about WHO the customer is: the company's own name and its spellings, company forms, trade words, place words.
 * A distinctive word is four letters or more and not in this list.
 */
const GENERIC_WORDS = new Set([
  // the company itself
  'aryak', 'aryaak', 'aryack', 'aryac', 'arayak', 'aryk', 'ariak', 'aryakk', 'aryaq', 'aryag', 'آریاک', 'اریاک',
  // groups, teams, orders, company forms
  'group', 'groups', 'order', 'orders', 'team', 'teams', 'company', 'companies', 'comp', 'llc', 'ltd', 'limited', 'fzco', 'fzc', 'fze', 'establishment', 'estb', 'corporation', 'corp', 'enterprise', 'enterprises', 'holding', 'holdings', 'project', 'projects', 'and', 'the', 'for',
  // what they do
  'kitchen', 'kitchens', 'wood', 'woods', 'woodwork', 'woodworks', 'woodworking', 'door', 'doors', 'furniture', 'furnitures', 'carpentry', 'carpenter', 'joinery', 'pvc', 'film', 'films',
  'design', 'designs', 'designer', 'designers', 'designing', 'decor', 'decors', 'decoration', 'decorations', 'interior', 'interiors', 'building', 'bulding', 'buildings', 'construction', 'contracting', 'contractor', 'contractors',
  'technical', 'work', 'works', 'factory', 'factories', 'industry', 'industries', 'industrial', 'international', 'intl', 'commercial', 'trading', 'general', 'services', 'service', 'maintenance', 'supply', 'supplies', 'material', 'materials', 'engineering', 'manufacturing', 'mfg',
  // streets and cities
  'street', 'road', 'dubai', 'sharjah', 'ajman', 'abudhabi', 'dhabi', 'emirates', 'uae', 'oman', 'muscat', 'khaimah', 'fujairah', 'city', 'area', 'zone', 'free',
]);

/** The words of a name with "al" handled (alsham = al sham): the starting "al" of a long word and a lone "al" are taken off. */
function nameTokens(s) {
  const out = [];
  for (let t of nameKey(s).split(' ').filter(Boolean)) {
    if (t === 'al' || t === 'el') continue;
    if (t.length > 4 && t.startsWith('al')) t = t.slice(2);
    out.push(t);
  }
  return out;
}

/** The words that tell customers apart: generic words out, "al" out, words under four letters out. */
export function distinctive(s) {
  return nameTokens(s).filter((t) => t.length >= 4 && !GENERIC_WORDS.has(t) && !/^\d+$/.test(t));
}

/** The company's own name and its forms: never a name's one remaining word. */
const FORM_WORDS = new Set(['aryak', 'aryaak', 'aryack', 'aryac', 'arayak', 'aryk', 'ariak', 'aryakk', 'aryaq', 'aryag', 'آریاک', 'اریاک', 'group', 'groups', 'team', 'teams', 'company', 'companies', 'comp', 'llc', 'ltd', 'limited', 'fzco', 'fzc', 'fze', 'establishment', 'estb', 'corporation', 'corp', 'enterprise', 'enterprises', 'holding', 'holdings', 'and', 'the', 'for']);

/**
 * The words used to compare two names: every non-generic word of two letters or more (short words count, so "golden sun" is not "golden"). When
 * a name is nothing but generic words ("designer wood"), its first word that is not a company form is kept, marked weak (offered, never confident).
 */
export function matchWords(s) {
  const t = nameTokens(s);
  const list = t.filter((x) => x.length >= 2 && !GENERIC_WORDS.has(x) && !/^\d+$/.test(x));
  if (list.length) return { list, weak: false };
  const first = t.find((x) => x.length >= 3 && !FORM_WORDS.has(x) && !/^\d+$/.test(x));
  return first ? { list: [first], weak: true } : { list: [], weak: false };
}

/** How alike two words are: 1 the same, 0.85 one letter off, 0.6 two off (not for short words); else 0. */
function wordMatch(a, b) {
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 4) return 0;
  const d = editDistance(a, b);
  if (d === 1) return 0.85;
  return d === 2 && (Math.max(a.length, b.length) >= 7 || (Math.max(a.length, b.length) >= 5 && a[0] === b[0])) ? 0.6 : 0;
}

/**
 * Customer words [a] against group words [b]. A word may also match two joined words of the other side (abduljabar = abdul jabbar). Each
 * shared word counts by how close it is; a word left over on either side costs a little. { score, shared, equal, groupLeft, exact, hasLong }.
 */
function pairScore(a, b) {
  const usedA = new Set(); const usedB = new Set();
  let score = 0; let shared = 0; let exact = true; let hasLong = false;
  for (let i = 0; i < a.length; i++) {
    if (usedA.has(i)) continue;
    let best = { w: 0 };
    for (let j = 0; j < b.length; j++) {
      if (usedB.has(j)) continue;
      const w1 = wordMatch(a[i], b[j]);
      if (w1 > best.w) best = { w: w1, ia: [i], ib: [j], joined: false };
      if (i + 1 < a.length && !usedA.has(i + 1)) { const w = wordMatch(a[i] + a[i + 1], b[j]); if (w > best.w) best = { w, ia: [i, i + 1], ib: [j], joined: true }; }
      if (j + 1 < b.length && !usedB.has(j + 1)) { const w = wordMatch(a[i], b[j] + b[j + 1]); if (w > best.w) best = { w, ia: [i], ib: [j, j + 1], joined: true }; }
    }
    if (!best.w) continue;
    best.ia.forEach((k) => usedA.add(k)); best.ib.forEach((k) => usedB.add(k));
    score += best.w; shared += 1;
    if (best.w < 1 || best.joined) exact = false;
    if (best.ia.some((k) => a[k].length >= 4) || best.ib.some((k) => b[k].length >= 4)) hasLong = true;
  }
  const leftA = a.length - usedA.size; const leftB = b.length - usedB.size;
  return { score: score - 0.25 * (leftA + leftB), shared, equal: shared > 0 && leftA === 0 && leftB === 0, groupLeft: leftB, exact, hasLong };
}

/** The customers that may own this group (every name of the customer tried), best first, each with its score. [customers]: { name, alts }. */
export function rankCustomers(subject, customers, skip = () => false) {
  const g = matchWords(subject);
  const out = [];
  if (!g.list.length) return out;
  const groupLong = g.list.some((x) => x.length >= 4);
  for (const c of customers) {
    if (skip(c.name)) continue;
    let best = null;
    for (const n of [c.name, ...(c.alts || [])]) {
      const w = matchWords(n);
      if (!w.list.length) continue;
      const p = pairScore(w.list, g.list);
      if (!p.shared || (groupLong && !p.hasLong)) continue; // a group with a real word must share a real word
      const weak = w.weak || g.weak;
      const cand = { ...p, weak, score: p.score - (weak ? 0.3 : 0) };
      if (!best || cand.score > best.score) best = cand;
    }
    if (best) out.push({ customer: c.name, ...best });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * A clear winner only, and strict: every word of the group matches a word of the customer EXACTLY (no near spelling, no joined words, no
 * word the customer lacks), and no other customer matches as well. Two customers that both fit the group are never confident, except that
 * the exact name beats a longer one (a main group goes to "Master Wood", the branch group to "Master Wood Branch"). Near spellings,
 * weak (generic-only) names and one-word wins with words left over are offered as options, never confident.
 */
export function clearWinner(ranked) {
  const [top, second] = ranked;
  if (!top || top.weak || !top.exact || top.groupLeft > 0) return false;
  if (top.equal) return !ranked.slice(1).some((r) => r.equal);
  return top.shared >= 2 && (!second || second.shared < top.shared);
}


// ---------------------------------------------------------------------------------------------------------------- the same customer written twice
/** Words that only make a company name longer ("Trading", "LLC", "Co"). */
const SUFFIX_WORDS = new Set(['trading', 'company', 'companies', 'co', 'llc', 'ltd', 'limited', 'est', 'estb', 'establishment', 'fzc', 'fze', 'fzco', 'general', 'group', 'enterprise', 'enterprises', 'industries', 'industry', 'international', 'intl', 'and', 'the', 'aryak', 'aryaak']);
const suffixless = (s) => nameTokens(s).filter((t) => t.length >= 2 && !SUFFIX_WORDS.has(t) && !/^\d+$/.test(t));

/**
 * Are these two names one customer written twice (a short and a long form, or two spellings)? Every word of the shorter is in the longer
 * (near spellings count), the longer adds only generic words, and the distinctive words are the same. "Atlas Kitchen" and "Atlas Commercial"
 * are NOT (each has a word the other lacks); "Master Wood" and "Master Wood Branch" are NOT (branch is a distinctive word).
 */
export function nearDuplicate(a, b) {
  const ma = matchWords(a); const mb = matchWords(b);
  if (ma.weak || mb.weak || !ma.list.length || !mb.list.length) return false;
  const ta = suffixless(a); const tb = suffixless(b);
  if (!ta.length || !tb.length) return false;
  const [s, l] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (pairScore(s, l).shared !== s.length) return false;
  const ss = matchWords(s.join(' ')).list; const sl = matchWords(l.join(' ')).list;
  return ss.length > 0 && ss.length === sl.length && pairScore(ss, sl).shared === ss.length;
}

/**
 * Near-duplicate names among [names], settled by the invoices: the name printed on an invoice is the main name and the other becomes its
 * alias without asking; only when neither (or both) was seen on an invoice is he asked. [seen]: names printed on invoices.
 * Returns { merges: [{ main, others }], ask: [[names]] }.
 */
export function settleDuplicates(names, seen = []) {
  const seenKeys = new Set(seen.map(nameKey));
  const parent = names.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (nameKey(names[i]) !== nameKey(names[j]) && nearDuplicate(names[i], names[j])) parent[find(j)] = find(i);
  const groups = new Map();
  names.forEach((n, i) => { const r = find(i); groups.set(r, [...(groups.get(r) || []), n]); });
  const merges = []; const ask = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const onInvoice = members.filter((m) => seenKeys.has(nameKey(m)));
    if (onInvoice.length === 1) merges.push({ main: onInvoice[0], others: members.filter((m) => m !== onInvoice[0]) });
    else if (!onInvoice.length) ask.push(members); // both printed on invoices: they are two names the customers use, left alone
  }
  return { merges, ask };
}

/** The approved row of a customer by any of his names: the name itself, his other names (aliases), or a near duplicate of a stored name. */
export function customerRowFor(name, { list, aliases }) {
  if (!name || !nameKey(name)) return null;
  return list.find(name, altNames(aliases.map, name)) || list.rows().find((r) => nearDuplicate(r.customer, name) && typedFitsName(name, r.customer)) || null;
}

/** The approved row that holds this group (by its id): an order in that group belongs to that row's customer. */
export const rowOfGroup = (list, jid) => list.rows().find((r) => rowGroups(r).some((g) => g.jid === jid)) || null;

/**
 * A name printed on a new invoice that is not in the list but clearly is a stored customer: the row and its groups are NOT touched (a row never
 * moves to another group on its own); the printed name becomes the main name (the stored one its alias). Returns the digest line, or null.
 */
export function learnPrintedName(printed, { list, aliases, config }) {
  if (!printed || !nameKey(printed) || isTestCustomer(printed, config.testCustomerName)) return null;
  if (list.find(printed, altNames(aliases.map, printed))) return null;
  const row = list.rows().find((r) => nearDuplicate(r.customer, printed));
  if (!row) return null;
  aliases.add(printed, row.customer);
  return `Invoice name "${printed}" is the stored customer "${row.customer}": same group kept, the invoice name is the main name now`;
}

// ---------------------------------------------------------------------------------------------------------------- the proposal
/**
 * GROUP-CENTRED: one row per customer group not yet in the list (never an internal or other group), so the owner reads about as many
 * lines as there are customer groups. A group with a clear winner is a confident pair (two groups with the same customer are ONE row with
 * two groups); a group with two or three real candidates is an options row; a group with none is listed at the end for him to name.
 * Customers with no group are a count and a list kept for "نام‌های بی‌گروه".
 */
export function buildProposal({ customers, groups, config, list, aliasMap = {}, invoices = 0, sources = null, now = Date.now() }) {
  const mapped = new Set(list.rows().flatMap((r) => rowGroups(r).map((g) => g.jid)));
  const custGroups = groups.filter((g) => shadowGroup(g.subject, config) && !mapped.has(g.id) && !list.isDeclined('*', g.id));
  const people = customers.filter((n) => nameKey(n) && !isTestCustomer(n, config.testCustomerName)).map((name) => ({ name, alts: altNames(aliasMap, name) }));
  const confident = new Map();
  const options = [];
  const none = [];
  const seen = new Set();
  for (const g of custGroups) {
    const ranked = rankCustomers(g.subject, people, (name) => list.isDeclined(name, g.id));
    ranked.slice(0, MAX_OPTIONS).forEach((r) => seen.add(nameKey(r.customer)));
    const entry = { jid: g.id, subject: g.subject };
    if (clearWinner(ranked)) {
      const k = nameKey(ranked[0].customer);
      if (!confident.has(k)) confident.set(k, { kind: 'confident', customer: ranked[0].customer, groups: [], status: 'open' });
      confident.get(k).groups.push(entry);
    } else if (ranked.length) options.push({ kind: 'options', group: entry, candidates: ranked.slice(0, 3).map((r) => r.customer), status: 'open' });
    else none.push({ kind: 'none', group: entry, status: 'open' });
  }
  const rows = [...confident.values(), ...options, ...none];
  const groupCount = rows.reduce((n, r) => n + (r.groups ? r.groups.length : 1), 0);
  rows.forEach((r, i) => { r.n = i + 1; });
  const withGroup = new Set([...confident.keys(), ...seen]);
  const noGroup = people.filter((p) => !withGroup.has(nameKey(p.name)) && !list.find(p.name, p.alts)).map((p) => p.name);
  // Watched groups that are NOT customer groups by the rule (an internal or excluded word in the name): never a row, but named so none is lost silently.
  const lowName = (x) => String(x).toLowerCase();
  const words = (config.shadowGroupNames || []).map(lowName).filter(Boolean);
  const others = groups.filter((g) => !shadowGroup(g.subject, config) && !['internal group', 'test group'].includes(groupAllowed(g.subject, config).why)
    && (observedGroup(g.subject, config) || words.some((w) => lowName(g.subject).includes(w)))).map((g) => g.subject);
  return { at: now, invoices, sources, rows, noGroup, groupCount, others, merged: [], dupAsk: [] };
}

/** The proposal (and then the current list) as messages of about 40 rows each, in Persian, names exactly as they are. */
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
  const s = proposal.sources;
  if (s?.fromBook) push(`فهرست مشتری و گروه — نام‌ها از ${persianDigits(s.fromBook)} نام فهرست حسابداری و ${persianDigits(s.fromInvoices)} نام تازه‌ای که فقط روی فاکتورها دیدم آمده است (فاکتورهای دیده‌شده: ${persianDigits(proposal.invoices)}).`);
  else push(`فهرست مشتری و گروه — این پیشنهاد از ${persianDigits(proposal.invoices)} فاکتور ساخته شده است${proposal.invoices < 20 ? ' (هنوز کوتاه است و با فاکتورهای بیشتر کامل‌تر می‌شود؛ با فرستادن فهرست نام مشتری‌ها کامل‌تر می‌شود)' : ''}.`);
  push(`${persianDigits(proposal.groupCount ?? proposal.rows.length)} گروه مشتری در ${persianDigits(proposal.rows.length)} ردیف (دو گروه یک مشتری در یک ردیف می‌آید).`);
  const section = (kind, title, show) => {
    const rows = proposal.rows.filter((r) => r.kind === kind && r.status === 'open');
    if (!rows.length) return;
    push('');
    push(title, false, title);
    for (const r of rows) { push(show(r), true); if (kind === 'options') r.candidates.forEach((c, i) => push(`    ${persianDigits(i + 1)}) ${c}`)); }
  };
  section('confident', '✅ جفت‌های مطمئن:', (r) => `${persianDigits(r.n)}. ${r.customer} — ${showGroups(r.groups)}`);
  section('options', '❓ چند مشتری ممکن برای این گروه (شمارهٔ مشتری درست را بنویسید):', (r) => `${persianDigits(r.n)}. ${r.group.subject}`);
  section('none', '⛔ گروه بی‌مشتری (نام مشتری را بنویسید):', (r) => `${persianDigits(r.n)}. ${r.group.subject}`);
  if (!proposal.rows.some((r) => r.status === 'open')) { push(''); push('گروه تازه‌ای بدون پاسخ نیست.'); }
  if (proposal.merged?.length) { push(''); push(`نام‌های تکراریِ فهرست حسابداری که خودم یکی کردم (${persianDigits(proposal.merged.length)}؛ نامِ چاپ‌شده روی فاکتور اصلی ماند):`); for (const m of proposal.merged.slice(0, 10)) push(`• ${m.main} ← ${m.others.join('، ')}`); }
  if (proposal.dupAsk?.length) { push(''); push(`نام‌های تقریباً تکراری که روی هیچ فاکتوری ندیده‌ام (${persianDigits(proposal.dupAsk.length)}): نام درست را با «نام اصلی <نام>» بگویید.`); for (const g of proposal.dupAsk.slice(0, 10)) push(`• ${g.join(' / ')}`); }
  if (proposal.noGroup.length) { push(''); push(`مشتریانی که گروهی زیر نظر برایشان نیست: ${persianDigits(proposal.noGroup.length)} نام (برای دیدن نام‌ها بنویسید «نام‌های بی‌گروه»).`); }
  if (proposal.others?.length) { push(''); push(`گروه‌های زیر نظر که گروه مشتری حساب نشدند و ردیفی ندارند (${persianDigits(proposal.others.length)}): ${proposal.others.slice(0, 12).join('، ')}${proposal.others.length > 12 ? ' …' : ''}`); }
  push('');
  push('پاسخ: «تأیید همه» (فقط جفت‌های مطمئن)، «تأیید ۱ ۳ ۵»، «۳ نه»، «۴ = ۲» (مشتری شمارهٔ ۲ برای گروه ردیف ۴)، «۷ = نام مشتری». تا پاسخ ندهید چیزی ذخیره نمی‌شود و هیچ فاکتوری فرستاده نمی‌شود.');
  const cur_ = list.rows();
  if (cur_.length) {
    push('');
    push(`فهرست تأییدشدهٔ فعلی (${persianDigits(cur_.length)} مشتری):`, false, 'فهرست تأییدشدهٔ فعلی:');
    for (const r of cur_) push(`• ${r.customer} — ${showGroups(rowGroups(r))}`, true);
  }
  out.push(cur.join('\n'));
  return out;
}

/** The names of the customers with no watched group, in messages of about 40. */
export function noGroupTexts(proposal) {
  const names = proposal.noGroup || [];
  if (!names.length) return ['همهٔ نام‌ها گروهی دارند یا در فهرست‌اند.'];
  const out = [];
  for (let i = 0; i < names.length; i += PER_MESSAGE) out.push([i ? 'نام‌های بی‌گروه (ادامه):' : `نام‌های بی‌گروه (${persianDigits(names.length)}):`, ...names.slice(i, i + PER_MESSAGE).map((n) => `• ${n}`)].join('\n'));
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

const IMPORT_HEAD = /^لیست\s*نام\s*مشتری\s*ها\s*[:：]?\s*$/u;

/** "لیست نام مشتری‌ها" then one name per line -> the names (numbers and bullets in front removed, each once); null when it is not that. */
export function parseNameImport(text) {
  const lines = String(text || '').replace(/[‌‎‏]/g, ' ').split(/\r?\n/);
  if (!IMPORT_HEAD.test(lines[0].trim().replace(/\s+/g, ' '))) return null;
  const seen = new Set();
  const names = [];
  for (const l of lines.slice(1)) {
    const n = l.replace(/^\s*(?:\d+\s*[.)\-–]\s*|[•*\-–]\s*)/u, '').replace(/\s+/g, ' ').trim();
    const k = nameKey(n);
    if (!k || n.length > 80 || seen.has(k)) continue;
    seen.add(k); names.push(n);
  }
  return { names };
}

const NUMS = '(\\d+(?:[\\s,،و+]+\\d+)*)';

/** What the owner wrote, as one of the forms; null when it is none of them. Persian, Arabic and Latin digits, with or without the hamza. */
export function parseListCommand(text) {
  const imp = parseNameImport(text);
  if (imp) return { type: 'import', names: imp.names };
  const s = plain(text).replace(/^آتوسا[ ,،:]*/u, '').replace(/[.!؟?]+$/u, '').trim();
  if (!s) return null;
  if (/^(?:فهرست|لیست)\s*مشتری(?:\s*و|\s*[/-])?\s*گروه(?:\s*ها)?$/u.test(s) || /^customer\s*(?:and\s*)?group\s*list$/i.test(s)) return { type: 'list' };
  if (/^نام\s*ها(?:ی)?\s*بی\s*گروه$/u.test(s)) return { type: 'nogroup' };
  let mm = /^نام\s*اصلی\s+(.+)$/u.exec(s);
  if (mm) return { type: 'mainname', name: mm[1].trim() };
  if (/^تایید\s*همه$/u.test(s) || /^approve\s*all$/i.test(s)) return { type: 'approveAll' };
  let m = /^(?:تایید|approve)\s+(\d+(?:[\s,،و]+\d+)*)$/iu.exec(s);
  if (m) return { type: 'approve', nums: m[1].split(/[\s,،و]+/).map(Number) };
  if ((m = /^(\d+)\s*(?:نه|no)$/iu.exec(s))) return { type: 'reject', n: Number(m[1]) };
  if ((m = new RegExp(`^(\\d+)\\s*=\\s*${NUMS}$`, 'u').exec(s))) return { type: 'pick', n: Number(m[1]), picks: m[2].split(/[\s,،و+]+/).map(Number) };
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
  constructor({ list, config, book = new NameBook(''), now = () => Date.now() }) {
    this.list = list;
    this.config = config;
    this.book = book;
    this.now = now;
  }

  /** A change waiting for his yes (or an import in progress) is kept in the list file, so a restart does not lose it. */
  get pending() { return this.list.d.pending || null; }
  set pending(v) { this.list.d.pending = v; this.list.persist(); }

  get proposal() { return this.list.d.proposal; }

  /** The parsed command when this desk should take the message (an answer needs an open proposal or a pending change), else null. */
  wants(text) {
    const p = parseListCommand(text);
    if (!p) return null;
    if (p.type === 'yes' || p.type === 'no') return this.livePending() ? p : null;
    if (['approveAll', 'approve', 'reject', 'pick', 'nogroup'].includes(p.type)) return this.proposal ? p : null;
    return p;
  }

  livePending() { if (this.pending && this.now() - this.pending.at > (this.pending.kind === 'import' ? IMPORT_MS : PENDING_MS)) this.pending = null; return this.pending; }

  /** One or more groups named by words joined with "+": { groups } or { error }. */
  groupsByWords(value, groups) {
    const found = [];
    for (const part of String(value).split('+')) {
      const r = resolveGroupWords(part, groups, this.config);
      const bad = this.badGroup(r);
      if (bad) return { error: bad };
      if (!found.some((g) => g.id === r.group.id)) found.push(r.group);
    }
    return { groups: found };
  }

  /** [groups]: { id, subject } of every group now; [known]: { customers, invoices, aliasMap }. Returns the messages to send back. */
  handle(p, { groups, known = {} }) {
    const live = (jid) => groups.find((g) => g.id === jid);
    const usable = (g) => g && shadowGroup(g.subject, this.config);
    const row = (n) => this.proposal.rows.find((r) => r.n === n);
    const done = (r) => `ردیف ${persianDigits(r.n)} قبلاً رسیدگی شده است.`;
    switch (p.type) {
      case 'import': {
        const staged = this.livePending()?.kind === 'import' ? this.pending.names : [];
        const seen = new Set(staged.map(nameKey));
        const names = [...staged];
        let dropped = 0;
        for (const n of p.names) { if (seen.has(nameKey(n))) continue; if (names.length >= MAX_NAMES) { dropped += 1; continue; } seen.add(nameKey(n)); names.push(n); }
        if (!names.length) return ['در این پیام نامی نبود. خط اول «لیست نام مشتری‌ها» و بعد هر نام در یک خط.'];
        this.pending = { kind: 'import', names, at: this.now() };
        return [`${persianDigits(names.length)} نام مشتری دریافت شد${dropped ? ` (${persianDigits(dropped)} نام اضافه بر ${persianDigits(MAX_NAMES)} نام نگرفتم)` : ''}. ${this.book.size ? `فهرست قبلی (${persianDigits(this.book.size)} نام) جایگزین می‌شود و نسخه‌اش می‌ماند؛ ` : ''}ردیف‌های تأییدشدهٔ مشتری و گروه دست نمی‌خورند.\nذخیره شود؟ بله / نه. اگر بخش بعدی فهرست را بفرستید به همین ادغام می‌شود (تا ${persianDigits(MAX_NAMES)} نام). چیزی فرستاده نمی‌شود.`];
      }
      case 'mainname': {
        const all = mergeSources(this.book.names(), known).customers;
        const main = all.find((n) => nameKey(n) === nameKey(p.name));
        if (!main) return [`نام «${p.name}» در فهرست نام‌ها نیست. چیزی تغییر نکرد.`];
        const others = all.filter((n) => nameKey(n) !== nameKey(main) && nearDuplicate(n, main));
        if (!others.length) return [`برای «${main}» نام تقریباً تکراری پیدا نکردم. چیزی تغییر نکرد.`];
        for (const o of others) known.addAlias?.(main, o);
        return [`ثبت شد: «${main}» نام اصلی است و ${others.map((o) => `«${o}»`).join('، ')} نام دیگر آن. ردیف تأییدشده‌ای تغییر نکرد.`];
      }
      case 'list': {
        const merged = mergeSources(this.book.names(), known);
        // the same customer written twice in the accounting list: the name printed on an invoice wins, the other becomes its alias (no question)
        const settled = settleDuplicates(merged.customers, known.customers || []);
        for (const m of settled.merges) for (const o of m.others) known.addAlias?.(m.main, o);
        const gone = new Set(settled.merges.flatMap((m) => m.others.map(nameKey)));
        merged.customers = merged.customers.filter((n) => !gone.has(nameKey(n)));
        const proposal = buildProposal({ customers: merged.customers, groups, config: this.config, list: this.list, aliasMap: known.aliasMap, invoices: known.invoices, sources: { fromBook: merged.fromBook, fromInvoices: merged.fromInvoices }, now: this.now() });
        proposal.merged = settled.merges;
        proposal.dupAsk = settled.ask;
        this.list.d.proposal = proposal; // a new proposal replaces the pending one; its row numbers stay until he answers
        this.list.persist();
        return proposalTexts(proposal, this.list);
      }
      case 'nogroup': return noGroupTexts(this.proposal);
      case 'approveAll': return this.save(this.proposal.rows.filter((r) => r.status === 'open' && r.kind === 'confident').map((r) => ({ row: r, customer: r.customer, groups: r.groups })), [], live, usable, 'همهٔ جفت‌های مطمئن');
      case 'approve': {
        const items = [];
        const notes = [];
        for (const n of p.nums) {
          const r = row(n);
          if (!r) { notes.push(this.wrong(n)); continue; }
          if (r.status !== 'open') { notes.push(done(r)); continue; }
          if (r.kind === 'options') { notes.push(`ردیف ${persianDigits(n)} (${r.group.subject}) چند مشتری ممکن دارد؛ بنویسید «${persianDigits(n)} = ۱» تا مشتری را برگزینید.`); continue; }
          if (r.kind === 'none') { notes.push(`ردیف ${persianDigits(n)} (${r.group.subject}) مشتری ندارد؛ بنویسید «${persianDigits(n)} = نام مشتری».`); continue; }
          items.push({ row: r, customer: r.customer, groups: r.groups });
        }
        return this.save(items, notes, live, usable, '');
      }
      case 'reject': {
        const r = row(p.n);
        if (!r) return [this.wrong(p.n)];
        if (r.status !== 'open') return [done(r)];
        r.status = 'declined';
        if (r.kind === 'confident') for (const g of r.groups) this.list.decline(r.customer, g.jid);
        else if (r.kind === 'options') for (const c of r.candidates) this.list.decline(c, r.group.jid);
        else this.list.decline('*', r.group.jid);
        this.list.persist();
        return [`ردیف ${persianDigits(p.n)} رد شد و دوباره پیشنهاد نمی‌شود. چیزی ذخیره نشد.`];
      }
      case 'pick': {
        const r = row(p.n);
        if (!r) return [this.wrong(p.n)];
        if (r.status !== 'open') return [done(r)];
        const groupsOf = r.kind === 'confident' ? r.groups : [r.group];
        if (p.picks) {
          if (r.kind !== 'options') return [`ردیف ${persianDigits(p.n)} گزینه‌ای ندارد؛ نام مشتری را بنویسید: «${persianDigits(p.n)} = نام مشتری».`];
          if (p.picks.length !== 1 || !r.candidates[p.picks[0] - 1]) return [`ردیف ${persianDigits(p.n)} یک مشتری از گزینه‌های ۱ تا ${persianDigits(r.candidates.length)} می‌خواهد.`];
          return this.save([{ row: r, customer: r.candidates[p.picks[0] - 1], groups: groupsOf }], [], live, usable, '');
        }
        const typed = mergeSources(this.book.names(), known).customers.find((c) => nameKey(c) === nameKey(p.value)) || p.value;
        return this.save([{ row: r, customer: typed, groups: groupsOf }], [], live, usable, '');
      }
      case 'set': {
        const r = this.groupsByWords(p.words, groups);
        if (r.error) return [r.error];
        const old = this.list.find(p.customer);
        this.pending = { kind: 'set', customer: p.customer, groups: r.groups.map((g) => ({ jid: g.id, subject: g.subject })), at: this.now() };
        return [`ذخیره شود؟ ${p.customer} — ${showGroups(this.pending.groups)}${old ? `\n(جایگزین گروه قبلی: ${showGroups(rowGroups(old))})` : ''}\nبله / نه (تا ۱۰ دقیقه معتبر است). چیزی فرستاده نمی‌شود.`];
      }
      case 'remove': {
        const old = this.list.find(p.customer);
        if (!old) return [`مشتری ${p.customer} در فهرست نیست.`];
        this.pending = { kind: 'remove', customer: old.customer, subject: showGroups(rowGroups(old)), at: this.now() };
        return [`از فهرست حذف شود؟ ${old.customer} — ${showGroups(rowGroups(old))}\nبله / نه (تا ۱۰ دقیقه معتبر است).`];
      }
      case 'yes': {
        const pend = this.livePending();
        this.pending = null;
        if (pend.kind === 'import') { this.book.save(pend.names, new Date(this.now())); return [`ذخیره شد: ${persianDigits(this.book.size)} نام مشتری (نسخهٔ ${persianDigits(this.book.d.version)}). ردیف‌های تأییدشده دست نخورد. برای پیشنهاد بنویسید: فهرست مشتری و گروه`]; }
        if (pend.kind === 'remove') { this.list.remove(pend.customer, new Date(this.now())); return [`حذف شد: ${pend.customer}. فهرست حالا ${persianDigits(this.list.size)} مشتری دارد.`]; }
        const gs = pend.groups.map((x) => live(x.jid));
        if (!gs.every(usable)) return [`یکی از گروه‌های «${showGroups(pend.groups)}» اکنون پیدا نمی‌شود یا گروه مشتری نیست. چیزی ذخیره نشد.`];
        const row_ = this.list.approveGroups(pend.customer, gs.map((g) => ({ jid: g.id, subject: g.subject })), new Date(this.now()));
        return [`ذخیره شد: ${row_.customer} — ${showGroups(rowGroups(row_))}. فهرست حالا ${persianDigits(this.list.size)} مشتری دارد. چیزی فرستاده نشد.`];
      }
      case 'no': this.pending = null; return ['انجام نشد. چیزی تغییر نکرد.'];
      default: return [];
    }
  }

  wrong(n) { return `فهرست مشتری‌ها و گروه‌ها: ردیف ${persianDigits(n)} در این پیشنهاد نیست. چیزی ذخیره نشد.`; }

  badGroup(r) {
    if (r.group) return '';
    if (r.ambiguous) return `چند گروه مشتری با این کلمات هست، دقیق‌تر بنویسید:\n${r.ambiguous.map((g) => `• ${g.subject}`).join('\n')}`;
    if (r.internal) return 'این گروه، گروه مشتری نیست (گروه داخلی یا دیگر). برای آن چیزی ذخیره نمی‌شود.';
    return 'گروه مشتری با این کلمات پیدا نشد. چیزی ذخیره نشد.';
  }

  /**
   * Saves each { row, customer, groups } whose groups are all still there and still customer groups. A customer who already has a row keeps
   * his groups and gains these (an approval never drops one). Says what was saved and what was not.
   */
  save(items, notes, live, usable, what) {
    const lines = [];
    for (const { row, customer, groups } of items) {
      const gs = groups.map((o) => live(o.jid));
      if (!gs.every(usable)) { notes.push(`ردیف ${persianDigits(row.n)}: گروه «${showGroups(groups)}» اکنون پیدا نمی‌شود یا گروه مشتری نیست؛ ذخیره نشد.`); continue; }
      const prev = this.list.find(customer);
      const all = [...rowGroups(prev), ...gs.map((g) => ({ jid: g.id, subject: g.subject }))].filter((g, i, a) => a.findIndex((x) => x.jid === g.jid) === i);
      const saved = this.list.approveGroups(customer, all, new Date(this.now()));
      row.status = 'saved';
      lines.push(`✅ ${persianDigits(row.n)}. ${saved.customer} — ${showGroups(rowGroups(saved))}`);
    }
    this.list.persist();
    const left = this.proposal.rows.filter((r) => r.status === 'open').length;
    const head = lines.length ? `${what ? `${what}: ` : ''}${persianDigits(lines.length)} ردیف ذخیره شد:` : 'چیزی ذخیره نشد.';
    return [[head, ...lines, ...notes, lines.length ? `فهرست حالا ${persianDigits(this.list.size)} مشتری دارد. ردیف باز: ${persianDigits(left)}. چیزی فرستاده نشد.` : ''].filter(Boolean).join('\n')];
  }
}
