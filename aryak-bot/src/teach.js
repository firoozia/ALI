// THE OWNER TEACHES IN WORDS. In his own chat (typed on this account, never one the program sent, never forwarded; ADMIN_NUMBERS does not widen it)
// he writes one plain sentence, in Persian, English or Arabic; ONE model call turns it into a strict list of changes of KNOWN kinds only:
//   alias  - another name of a known customer          row   - invoices of a known customer go to a known customer group
//   watch  - a group (by its exact name) joins the watched groups        rule - a rule in words        term - what a word or code means
// The model maps names only to known customers and groups (checked again here in code); an unknown name becomes a question, never a guess.
// Nothing is saved before his "yes" (valid ten minutes). Teaching can never change who may command, the guard, the one-shot send rule,
// ALLOW_CUSTOMER_GROUP_SENDS, or send anything, and prices keep their own flow: such a request is refused in words. Everything taught is
// kept on disk, versioned, numbered, listed ("چیزهایی که یاد گرفتی") and removable ("فراموش کن ۳"). Customers' words never reach this file.

import fs from 'node:fs';
import path from 'node:path';
import { groupAllowed, shadowGroup } from './guard.js';
import { nameKey, rowGroups } from './customergroups.js';
import { ruleFrom } from './rules.js';

const PENDING_MS = 10 * 60 * 1000;
const MAX_CHANGES = 8;
const fa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const latin = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const plain = (s) => latin(String(s || '')).replace(/[‌‎‏]/g, ' ').replace(/[أإ]/g, 'ا').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------------------------- the words
/** A message that starts like a teaching: "یاد بگیر", "یادت باشد", "از این به بعد", "remember", "from now on". */
export const isExplicitTeaching = (text) => /^(?:آتوسا[\s،,:]*|atossa[\s,:]*)?(?:یاد\s*بگیر|یادت\s*باش[دە]?|یادت\s*باشه|از\s+این\s+به\s+بعد|از\s+حالا\s+به\s+بعد|remember\b|learn\b|from\s+now\s+on|تذكر|تعلم|من\s+الآن)/iu.test(String(text || '').trim())
  || ruleFrom(text, []) !== ''; // and every old trigger of the rules path ("در نظر نگیر", "حساب نکن", "فراموش نکن", "do not take ...") anywhere in a statement

const INSTRUCTION = /یکی\s*(?:است|هست|هستند|می‌?باشد)|همان\s*(?:است|هست|مشتری)|یک\s+مشتری|نام\s+دیگر|اسم\s+دیگر|(?:نام|اسم)[^\n]{0,40}(?:عوض|تغییر|شد)|عوض\s+شد|تغییر\s+(?:کرد|نام)|گروه[^\n]{0,60}(?:برود|بره|برو|بفرست|بگذار|اضافه|زیر\s*نظر|بشود|بشه)|فاکتور[^\n]{0,60}گروه|یعنی|معنی|هم‌?معنی|مخفف|همیشه|هرگز|باید|نباید|\b(?:is|are)\s+(?:the\s+)?same|same\s+customer|renam|now\s+called|\bmeans\b|stands\s+for|go(?:es)?\s+to\s+(?:the\s+)?group|add\s+(?:the\s+)?group|\balways\b|\bnever\b|\bmust\b|\bshould\b|نفس\s+العميل|هو\s+نفسه|يعني|تذكر|دائما|أبدا/iu;

/** Does this message read like an instruction (and not a question)? Used only after every other command failed to match. */
export function looksLikeTeaching(text) {
  const s = String(text || '').trim();
  if (s.length < 8 || s.length > 700 || /[?؟]\s*$/.test(s) || s.startsWith('🤖')) return false;
  return isExplicitTeaching(s) || INSTRUCTION.test(s);
}

/** What teaching must never do: widen who may command, the guard, sending without his yes, the one-shot rule. */
const WIDENING_WORDS = /بدون\s*(?:تأیید|تایید|پرسیدن|پرسش|بله|اجازه)|خودکار\s*(?:بفرست|ارسال|می‌?فرست)|ارسال\s*خودکار|به\s*همه\s*(?:ی\s*)?گروه|همه\s*(?:ی\s*)?گروه‌?ها|ادمین|اجازهٔ?\s*(?:دستور|فرمان)|نپرس|ALLOW_|\bguard\b|one[- ]?shot|without\s+(?:asking|confirm\w*|my\s+(?:yes|ok|approval))|auto(?:matic(?:ally)?)?[- ]?send|send\s+(?:it\s+)?to\s+all|who\s+(?:can|may)\s+(?:command|order)|\badmins?\b|permission|بدون\s*إذن|تلقائي|أي\s+شخص\s+يأمر/iu;
export const PRICE = /قیمت|تخفیف|فهرست\s*قیمت|\bprices?\b|\bdiscounts?\b|سعر|أسعار|خصم/iu;

// "who may ..." in any wording: a word of permission together with a word of sending or commanding (Persian, English, Arabic), so "let the manager send
// invoices", "مدیر فروش هم بتواند فاکتور را به گروه مشتری بفرستد" and "يمكن لمدير المبيعات إرسال الفواتير" are all caught without naming one role.
const PERMIT = /بتوان(?:د|ند)|می‌?توان(?:د|ند)|مجاز|اجازه|اختیار|دسترسی|حق\s+دارد|\b(?:can|may|allow(?:ed|s)?|let|lets|permit(?:ted|s)?|authori[sz]e[ds]?|enable[ds]?|entitled)\b|يمكن|يسمح|السماح|يستطيع|مسموح|صلاحية|اسمح|دع\b/iu;
const ACT = /بفرست|بفرستد|بفرستند|ارسال|می‌?فرست|بده(?:د|ند)?\b|دستور|فرمان|تأیید\s*کن|\b(?:send|sends|sending|forward|post|command|commands|approve|approves)\b|يرسل|ارسال|إرسال|أرسل|يأمر|أمر|يوافق/iu;
// sending to every or all groups, or sending on its own
const EVERY_GROUP = /\bsend\w*[^.\n]{0,60}\b(?:every|all)\s+(?:customer\s+)?groups?\b|\bsend\w*[^.\n]{0,40}automatic|به\s+هر\s+گروه(?:ی)?\s+[^.\n]{0,30}(?:بفرست|ارسال)|إلى\s+كل\s+المجموعات/iu;
const TOKEN = /نگهبان|گارد|توکن|نشان\s*یک[‌\s]?بار|\btokens?\b|حفاظ|الحارس/iu;

/** Does this wording try to widen who commands, who sends to customers, the guard or the token? (checked before any model call, and again on what the model wrote) */
export function wideningIn(text) {
  const s = String(text || '');
  return WIDENING_WORDS.test(s) || TOKEN.test(s) || EVERY_GROUP.test(s) || (PERMIT.test(s) && ACT.test(s));
}
export const WIDENING = { test: wideningIn };

export const WIDENING_REPLY = 'این کار تغییر در کد می‌خواهد و از راه آموزش ممکن نیست (دستور دادن، نگهبان ارسال، ارسال بدون «بله» و فرستادن به گروه مشتری). چیزی ذخیره نشد.';
export const PRICE_REPLY = 'قیمت‌ها مسیر خودشان را دارند؛ فهرست قیمت را از همان مسیر قیمت وارد کنید، نه از راه آموزش. این مورد ذخیره نشد.';

/** "چیزهایی که یاد گرفتی", "فراموش کن ۳", and the answers to a pending confirmation: "بله", "نه", "۲ نه". */
export function parseTeachCommand(text) {
  const s = plain(text).replace(/^آتوسا[ ,،:]*/u, '').replace(/[.!؟?]+$/u, '').trim();
  if (!s) return null;
  if (/^چیز(?:ها)?ی{0,2}\s*که\s*یاد\s*گرفت(?:ی|ه\s*ای|ه)$/u.test(s) || /^(?:what\s+have\s+you\s+learned|taught\s+items)$/i.test(s)) return { type: 'learned' };
  let m = /^(?:فراموش\s*کن|forget)\s+(\d+)$/iu.exec(s);
  if (m) return { type: 'forget', id: Number(m[1]) };
  if ((m = /^(\d+)\s*(?:نه|no)$/iu.exec(s))) return { type: 'drop', n: Number(m[1]) };
  if (/^(?:بله|اره|آره|تایید|yes|y|ok)$/iu.test(s)) return { type: 'yes' };
  if (/^(?:نه|خیر|نخیر|لغو|no|n|cancel)$/iu.test(s)) return { type: 'no' };
  return null;
}

// ---------------------------------------------------------------------------------------------------------------- the stored items
/** Everything taught, numbered and versioned: { version, nextId, items: [{ id, kind, data, text, at, removedAt }], pending }. */
export class TaughtStore {
  constructor(dir = '') {
    this.dir = dir;
    this.file = dir ? path.join(dir, 'taught.json') : '';
    this.d = { version: 0, nextId: 1, items: [], pending: null };
    try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ }
  }

  persist() {
    if (!this.file) return;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d)); } catch { /* best effort */ }
  }

  /** A change of the items is a new version; the one before it is kept. */
  commit(change) {
    if (this.dir && this.d.version > 0) {
      try {
        fs.mkdirSync(path.join(this.dir, 'taught-history'), { recursive: true });
        fs.writeFileSync(path.join(this.dir, 'taught-history', `taught-v${this.d.version}.json`), JSON.stringify({ version: this.d.version, items: this.d.items }));
      } catch { /* best effort */ }
    }
    change();
    this.d.version += 1;
    this.persist();
  }

  active() { return this.d.items.filter((i) => !i.removedAt); }
  get(id) { return this.d.items.find((i) => i.id === id && !i.removedAt) || null; }
  add(kind, data, text, now = new Date()) { const item = { id: this.d.nextId, kind, data, text, at: now.toISOString() }; this.commit(() => { this.d.nextId += 1; this.d.items.push(item); }); return item; }
  setData(id, data) { const i = this.d.items.find((x) => x.id === id); if (i) { i.data = data; this.persist(); } }
  remove(id, now = new Date()) { const i = this.get(id); if (!i) return false; this.commit(() => { i.removedAt = now.toISOString(); }); return true; }
}

// ---------------------------------------------------------------------------------------------------------------- understanding (one model call)
const SYSTEM = `You turn ONE message from the owner of a company into a strict JSON list of changes to the assistant's memory. Reply with JSON only:
{"changes":[...],"questions":["..."]}
Kinds of change (no others exist):
 {"kind":"alias","customer":"<a customer name copied EXACTLY from KNOWN CUSTOMERS>","alias":"<the other name he used>"}   - two names are one customer
 {"kind":"row","customer":"<exact known customer>","groups":["<exact group name copied from GROUPS>"]}                  - invoices of this customer go to this group
 {"kind":"watch","subject":"<exact group name from GROUPS>"}                                                           - a group joins the watched customer groups (for example after he renamed it)
 {"kind":"rule","text":"<the rule in one short English or Persian sentence>"}                                          - a rule for how the assistant works
 {"kind":"term","term":"<word or code>","meaning":"<what it means>"}                                                   - a word or code and its meaning
Rules: Use ONLY names that appear in KNOWN CUSTOMERS and GROUPS, copied exactly. If a name he used is not there (or could be two), do NOT guess: put a short Persian question in "questions". Never invent a customer, group, price or number. If the message is only a question, a greeting or chat, return {"changes":[],"questions":[]}. One sentence may hold several changes (for example a renamed group is watched AND the customer's invoices go to it). Do not output anything about prices, discounts, who may give orders, sending without his yes, or permissions: leave those out.`;

/** One paid call (the owner's own message only): the changes the model understood, as parsed JSON, or null. */
export async function understandTeaching({ client, config, text, customers, groups }) {
  const user = `KNOWN CUSTOMERS:\n${customers.slice(0, 400).join('\n')}\n\nGROUPS:\n${groups.slice(0, 400).map((g) => g.subject).join('\n')}\n\nMESSAGE:\n${text}`;
  const res = await client.beta.messages.create({ model: config.model, max_tokens: 1200, system: SYSTEM, messages: [{ role: 'user', content: user }], output_config: { effort: 'low' } });
  const out = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const m = /\{[\s\S]*\}/.exec(out);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * The model's list checked in code: known customers and exact group names only, internal groups refused, widening and prices refused.
 * ctx: { customers: [names], groups: [{ id, subject }], config }. Returns { items: [{ kind, data, text }], questions: [], refused: [] }.
 */
export function validateChanges(raw, ctx, userText = '') {
  const items = []; const questions = []; const refused = [];
  const customer = (n) => ctx.customers.find((c) => nameKey(c) === nameKey(n));
  const group = (n) => ctx.groups.find((g) => nameKey(g.subject) === nameKey(n));
  const internal = (g) => ['internal group', 'test group'].includes(groupAllowed(g.subject, ctx.config).why);
  const list = Array.isArray(raw?.changes) ? raw.changes.slice(0, MAX_CHANGES) : [];
  for (const q of Array.isArray(raw?.questions) ? raw.questions : []) if (typeof q === 'string' && q.trim()) questions.push(q.trim().slice(0, 200));
  if (WIDENING.test(userText)) refused.push('widening');
  else if (PRICE.test(userText)) refused.push('price');
  if (refused.length) return { items, questions, refused };
  const watchKeys = new Set(list.filter((c) => c?.kind === 'watch' && group(c.subject) && !internal(group(c.subject))).map((c) => nameKey(c.subject)));
  const seen = new Set();
  const push = (kind, data, text) => { const k = `${kind}|${JSON.stringify(data)}`; if (!seen.has(k)) { seen.add(k); items.push({ kind, data, text }); } };
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    if (c.kind === 'watch') {
      const g = group(c.subject);
      if (!g) questions.push(`گروهی به نام «${String(c.subject).slice(0, 80)}» پیدا نکردم؛ نام دقیق گروه را بنویسید.`);
      else if (internal(g)) refused.push('internal');
      else push('watch', { jid: g.id, subject: g.subject }, `گروه «${g.subject}» زیر نظر گرفته می‌شود.`);
    } else if (c.kind === 'alias') {
      const cu = customer(c.customer); const al = String(c.alias || '').replace(/\s+/g, ' ').trim();
      if (!cu) questions.push(`مشتری «${String(c.customer).slice(0, 80)}» را در فهرست نمی‌شناسم؛ کدام مشتری است؟`);
      else if (!al || al.length > 80 || nameKey(al) === nameKey(cu)) continue;
      else push('alias', { customer: cu, alias: al }, `${al} = ${cu} (یک مشتری)`);
    } else if (c.kind === 'row') {
      const cu = customer(c.customer);
      if (!cu) { questions.push(`مشتری «${String(c.customer).slice(0, 80)}» را در فهرست نمی‌شناسم؛ کدام مشتری است؟`); continue; }
      const gs = [];
      for (const n of Array.isArray(c.groups) ? c.groups : []) {
        const g = group(n);
        if (!g) { questions.push(`گروهی به نام «${String(n).slice(0, 80)}» پیدا نکردم؛ نام دقیق گروه را بنویسید.`); continue; }
        if (internal(g)) { refused.push('internal'); continue; }
        if (!shadowGroup(g.subject, ctx.config) && !watchKeys.has(nameKey(g.subject))) { questions.push(`گروه «${g.subject}» گروه مشتریِ زیر نظر نیست؛ اگر باید زیر نظر برود بگویید.`); continue; }
        gs.push({ jid: g.id, subject: g.subject });
      }
      if (gs.length) push('row', { customer: cu, groups: gs }, `فاکتور ${cu} به گروه ${gs.map((g) => g.subject).join(' + ')} می‌رود.`);
    } else if (c.kind === 'rule') {
      const t = String(c.text || '').replace(/\s+/g, ' ').trim();
      if (t.length < 8) continue;
      if (WIDENING.test(t)) refused.push('widening'); else if (PRICE.test(t)) refused.push('price');
      else push('rule', { text: t.slice(0, 300) }, `قانون: ${t.slice(0, 300)}`);
    } else if (c.kind === 'term') {
      const term = String(c.term || '').trim().slice(0, 80); const meaning = String(c.meaning || '').trim().slice(0, 200);
      if (!term || !meaning) continue;
      if (WIDENING.test(`${term} ${meaning}`)) refused.push('widening'); else if (PRICE.test(`${term} ${meaning}`)) refused.push('price');
      else push('term', { term, meaning }, `«${term}» یعنی ${meaning}`);
    }
  }
  const order = { watch: 0, alias: 1, row: 2, rule: 3, term: 4 };
  items.sort((a, b) => order[a.kind] - order[b.kind]);
  return { items, questions, refused };
}

// ---------------------------------------------------------------------------------------------------------------- effects
/** Makes one taught item real. fx: { aliases, customerGroups, rules, watchList, config }. Returns what to remember for undoing it. */
export function applyItem(item, fx) {
  const d = item.data;
  if (item.kind === 'watch') { fx.watchList.addExtra({ id: d.jid, subject: d.subject }, fx.config); return d; }
  if (item.kind === 'alias') { fx.aliases.add(d.customer, d.alias); return d; }
  if (item.kind === 'row') {
    const prev = rowGroups(fx.customerGroups.find(d.customer));
    const added = d.groups.filter((g) => !prev.some((p) => p.jid === g.jid));
    fx.customerGroups.approveGroups(d.customer, [...prev, ...added]);
    return { ...d, added: added.map((g) => g.jid) };
  }
  if (item.kind === 'rule') { const r = fx.rules.add(d.text); return { ...d, ruleId: r?.id }; }
  if (item.kind === 'term') { const r = fx.rules.add(`Term: "${d.term}" means: ${d.meaning}`); return { ...d, ruleId: r?.id }; }
  return d;
}

/** Takes a taught item back out. */
export function undoItem(item, fx) {
  const d = item.data;
  if (item.kind === 'watch') fx.watchList.removeExtra(d.jid, fx.config);
  else if (item.kind === 'alias') fx.aliases.remove(d.customer, d.alias);
  else if (item.kind === 'row') {
    const row = fx.customerGroups.find(d.customer);
    if (!row) return;
    const left = rowGroups(row).filter((g) => !(d.added || []).includes(g.jid));
    if (left.length) fx.customerGroups.approveGroups(d.customer, left); else fx.customerGroups.remove(d.customer);
  } else if ((item.kind === 'rule' || item.kind === 'term') && d.ruleId) fx.rules.remove(d.ruleId);
}

// ---------------------------------------------------------------------------------------------------------------- the desk
/** The conversation: a proposal waiting for his yes, "۲ نه" to drop one, "چیزهایی که یاد گرفتی", "فراموش کن ۳". */
export class TeachDesk {
  constructor({ store, now = () => Date.now() }) { this.store = store; this.now = now; }

  get pending() {
    const p = this.store.d.pending;
    if (p && this.now() - p.at > PENDING_MS) { this.store.d.pending = null; this.store.persist(); return null; }
    return p || null;
  }

  set pending(v) { this.store.d.pending = v; this.store.persist(); }

  /**
   * The parsed command when this desk should take the message (an answer needs a live pending), else null. While a question of hers waits
   * ("which one?"), his next plain message is { type: 'answer' } unless another command takes it ([other]) or it starts a new teaching.
   */
  wants(text, { other = false } = {}) {
    const p = parseTeachCommand(text);
    if (p) { if (['yes', 'no', 'drop'].includes(p.type)) return this.pending ? p : null; return p; }
    const pend = this.pending;
    const s = String(text || '').trim();
    if (!other && pend?.kind === 'save' && pend.questions?.length && s && s.length <= 400 && !s.startsWith('🤖') && !isExplicitTeaching(s)) return { type: 'answer', text: s };
    return null;
  }

  /** What he said as numbered items to confirm (and the questions still open). Returns the message; nothing is saved. */
  propose(items, questions = [], meta = {}) {
    this.pending = { kind: 'save', items: items.map((i) => ({ ...i })), questions: questions.slice(), original: meta.original || '', round: meta.round || 1, at: this.now() };
    return this.confirmText(items, questions);
  }

  confirmText(items, questions = []) {
    return [
      items.length ? 'این را فهمیدم؛ بعد از «بله» ذخیره می‌شود:' : '',
      ...items.map((it, i) => `${fa(i + 1)}. ${it.text}`),
      ...questions.map((q) => `❓ ${q}`),
      questions.length ? `به پرسش‌ها پاسخ بدهید${items.length ? '؛ یا «بله» برای ذخیرهٔ همین موارد' : ''}، یا نه (تا ۱۰ دقیقه معتبر است). چیزی فرستاده نمی‌شود.` : '',
      items.length && !questions.length ? 'بله، یا «۲ نه» برای کنار گذاشتن یک مورد، یا نه (تا ۱۰ دقیقه معتبر است). چیزی فرستاده نمی‌شود.' : '',
    ].filter(Boolean).join('\n');
  }

  handle(p, fx) {
    switch (p.type) {
      case 'learned': {
        const items = this.store.active();
        const rows = fx.customerGroups?.size || 0;
        const al = Object.values(fx.aliases?.map || {});
        const counts = [
          rows ? `ردیف مشتری و گروه: ${fa(rows)} (برای دیدن: فهرست مشتری و گروه)` : '',
          al.length ? `نام دیگر برای مشتری: ${fa(al.reduce((n, o) => n + o.length, 0))} نام برای ${fa(al.length)} مشتری (برای دیدن: اسم‌های دیگر)` : '',
        ].filter(Boolean);
        if (!items.length && !counts.length) return ['هنوز چیزی یاد نگرفته‌ام. یک جمله بنویسید، مثلاً «اسم دیگر فلان مشتری بهمان است».'];
        return [[...(counts.length ? ['آنچه تا امروز دارم:', ...counts.map((c) => `• ${c}`)] : []), items.length ? 'یاد گرفته‌شده با جمله:' : 'با جمله چیزی یاد نگرفته‌ام.', ...items.map((i) => `${fa(i.id)}. ${i.text}`), items.length ? 'برای برداشتن: فراموش کن <شماره>' : ''].filter(Boolean).join('\n')];
      }
      case 'forget': {
        const it = this.store.get(p.id);
        if (!it) return [`مورد ${fa(p.id)} در چیزهای یادگرفته نیست.`];
        this.pending = { kind: 'forget', id: it.id, at: this.now() };
        return [`فراموش شود؟ ${fa(it.id)}. ${it.text}\nبله / نه (تا ۱۰ دقیقه معتبر است).`];
      }
      case 'drop': {
        const pend = this.pending;
        if (pend.kind !== 'save' || p.n < 1 || p.n > pend.items.length) return ['شمارهٔ این مورد در فهرست نیست. چیزی تغییر نکرد.'];
        pend.items.splice(p.n - 1, 1);
        if (!pend.items.length) { this.pending = null; return ['همه کنار گذاشته شد. چیزی ذخیره نشد.']; }
        this.pending = pend;
        return [`کنار گذاشته شد.\n${this.confirmText(pend.items, pend.questions || [])}`];
      }
      case 'no': this.pending = null; return ['انجام نشد. چیزی ذخیره یا برداشته نشد.'];
      case 'yes': {
        const pend = this.pending;
        if (pend.kind === 'save' && !pend.items.length) return ['هنوز چیزی برای ذخیره نیست؛ به پرسش‌ها پاسخ بدهید یا بنویسید نه.'];
        this.pending = null;
        if (pend.kind === 'forget') {
          const it = this.store.get(pend.id);
          if (!it) return ['این مورد دیگر نیست.'];
          undoItem(it, fx);
          this.store.remove(it.id);
          return [`فراموش شد: ${fa(it.id)}. ${it.text}\nنسخه‌های قبلی نگه داشته شده است.`];
        }
        const lines = [];
        for (const it of pend.items) {
          const data = applyItem(it, fx);
          const saved = this.store.add(it.kind, data, it.text);
          lines.push(`✅ ${fa(saved.id)}. ${saved.text}`);
        }
        return [['ذخیره شد:', ...lines, 'برای دیدن همه: چیزهایی که یاد گرفتی. چیزی فرستاده نشد.'].join('\n')];
      }
      default: return [];
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------- one teaching, start to proposal
const keyOf = (i) => `${i.kind}|${JSON.stringify(i.data)}`;

/**
 * The whole path of one message of teaching, without sending or saving anything. [previous] = the open proposal when he is answering her
 * questions ({ original, items, questions, round }): its items are KEPT and the answer is read together with his first sentence. A widening
 * or price wording is refused before any model call and again on what the model wrote; an explicit teaching the model found nothing in is
 * offered as a rule in his own words ([fallbackRule]) for his yes: nothing is ever stored at once.
 * Returns { kind: 'refuse', message } | { kind: 'none' } | { kind: 'propose', items, questions, original, round, note }.
 */
export async function runTeaching({ text, previous = null, explicit = false, client, config, customers, groups, fallbackRule = '' }) {
  const userText = previous ? `${previous.original}\n${text}` : text;
  if (wideningIn(userText)) return { kind: 'refuse', message: WIDENING_REPLY };
  if (PRICE.test(userText)) return { kind: 'refuse', message: PRICE_REPLY };
  const asked = previous
    ? `${previous.original}\n\nThe assistant asked: ${previous.questions.map((q, i) => `(${i + 1}) ${q}`).join(' ')}\nHis answer: ${text}`
    : text;
  let raw = null;
  try { raw = await understandTeaching({ client, config, text: asked, customers, groups }); } catch { raw = null; }
  const v = validateChanges(raw, { customers, groups, config }, userText);
  if (v.refused.includes('widening')) return { kind: 'refuse', message: WIDENING_REPLY };
  if (v.refused.includes('price')) return { kind: 'refuse', message: PRICE_REPLY };
  const note = v.refused.includes('internal') ? 'یک گروه داخلی بود و نمی‌شود آن را زیر نظر یا برای فاکتور مشتری گذاشت؛ کنار گذاشته شد.' : '';
  const items = [...(previous?.items || [])];
  for (const it of v.items) if (!items.some((x) => keyOf(x) === keyOf(it))) items.push(it);
  const round = (previous?.round || 0) + 1;
  const questions = round > 3 ? [] : v.questions;
  if (!items.length && !questions.length && explicit && fallbackRule) items.push({ kind: 'rule', data: { text: fallbackRule }, text: `قانون: ${fallbackRule}` });
  if (!items.length && !questions.length && !note) return { kind: 'none' };
  const order = { watch: 0, alias: 1, row: 2, rule: 3, term: 4 };
  items.sort((a, b) => order[a.kind] - order[b.kind]);
  return { kind: 'propose', items, questions, original: previous?.original || text, round, note };
}
