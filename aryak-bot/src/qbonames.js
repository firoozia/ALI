// MAKING THE QUICKBOOKS CUSTOMER NAMES UPPER CASE (the owner's one-off command, "نام مشتری‌ها با حروف بزرگ"). It reads every active customer and computes
// DisplayName and CompanyName in upper case (locale-independent; nothing else changes: no trimming, no spaces or dots, no other field). The
// owner gets a PREVIEW (#N1): how many change, the first fifteen "old -> new", and every CLASH (two customers that would become the same name, or a name
// already used by a vendor or an employee: QuickBooks display names must be unique) which is listed and SKIPPED. Only the owner's "بله #N1" applies it.
// The apply is a sparse update of one customer at a time (Id + SyncToken + the changed names, read fresh just before), idempotent (a customer already in
// upper case is skipped), with a short pause, stopping at the first unexpected error; it respects the kill switch and QBO_WRITE; every change is audit
// logged (id, old, new). Qbo.write allows this update and nothing else on customers: no create, no delete, no other field.

import fs from 'node:fs';
import path from 'node:path';

const fa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const DAY = 86400000;
const SHOWN = 15;

/** The upper-case form of a name, only when it really changes (locale-independent). */
const upper = (s) => (typeof s === 'string' ? s.toUpperCase() : s);

/**
 * What would change and what clashes. [customers]: all active customers; [others]: the display names used by vendors and employees.
 * Returns { changes: [{ id, old, next, oldCompany, nextCompany }], clashes: [{ id, name, next, why }], unchanged }.
 */
export function planUpper(customers, others = []) {
  const taken = new Map(); // upper-case name -> how many customers/others will hold it
  const add = (n) => { const k = upper(String(n)); taken.set(k, (taken.get(k) || 0) + 1); };
  const next = customers.map((c) => ({ c, display: upper(c.DisplayName), company: c.CompanyName === undefined ? undefined : upper(c.CompanyName) }));
  for (const n of next) add(n.display);
  const otherSet = new Set(others.map((n) => upper(String(n))));
  const changes = []; const clashes = []; let unchanged = 0;
  for (const { c, display, company } of next) {
    const nameChanges = display !== c.DisplayName;
    const companyChanges = company !== undefined && company !== c.CompanyName;
    if (!nameChanges && !companyChanges) { unchanged += 1; continue; }
    if (nameChanges && taken.get(display) > 1) { clashes.push({ id: String(c.Id), name: c.DisplayName, next: display, why: 'دو مشتری با این نام یکی می‌شوند' }); continue; }
    if (nameChanges && otherSet.has(display)) { clashes.push({ id: String(c.Id), name: c.DisplayName, next: display, why: 'این نام برای تأمین‌کننده یا کارمند هست' }); continue; }
    changes.push({ id: String(c.Id), old: c.DisplayName, next: display, oldCompany: c.CompanyName, nextCompany: company, displayChanges: nameChanges, companyChanges });
  }
  return { changes, clashes, unchanged };
}

export class NamePreviews {
  constructor(dir = '') { this.file = dir ? path.join(dir, 'qbo-name-previews.json') : ''; this.d = { n: 0, previews: {} }; try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ } }
  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  add(p) { this.d.n += 1; const id = `N${this.d.n}`; this.d.previews[id] = { ...p, id }; this.save(); return this.d.previews[id]; }
  get(id) { return this.d.previews[String(id).toUpperCase()] || null; }
}

export class QboNameDesk {
  /** [qbo]; [desk]: the QboDesk (its cached customer list is refreshed after a change); [audit]; [store]: NamePreviews; [now]; [sleep]; [gapMs]. */
  constructor({ qbo, desk, audit, store, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = 400, log = () => {} }) {
    Object.assign(this, { qbo, desk, audit, store, now, sleep, gapMs, log });
    this.busy = false;
    this.finish = null;
  }

  guard() {
    if (this.qbo.paused) return 'کوییک‌بوکس با فرمان مالک متوقف است؛ بنویسید: ادامهٔ کوییک‌بوکس';
    if (!this.qbo.configured) return `کوییک‌بوکس هنوز تنظیم نشده است. تنظیم‌های کم: ${this.qbo.missing.join('، ')}`;
    if (this.qbo.needsReconnect) return 'کوییک‌بوکس باید دوباره وصل شود؛ بنویسید: اتصال کوییک‌بوکس';
    if (!this.qbo.connected) return 'کوییک‌بوکس وصل نیست؛ بنویسید: اتصال کوییک‌بوکس';
    return '';
  }

  /** The ids of the previews the owner can still say yes or no to. */
  openIds() { return Object.values(this.store.d.previews).filter((p) => p.status === 'pending' && this.now() - p.at <= DAY).map((p) => p.id); }

  /** The preview: reads everything, writes nothing. */
  async plan() {
    const blocked = this.guard();
    if (blocked) return [blocked];
    const customers = await this.qbo.query('select * from Customer');
    let unchecked = '';
    const names = [];
    for (const t of ['Vendor', 'Employee']) {
      try { names.push(...(await this.qbo.query(`select DisplayName from ${t}`)).map((r) => r.DisplayName).filter(Boolean)); } catch (e) { unchecked += ` ${t === 'Vendor' ? 'تأمین‌کننده‌ها' : 'کارمندها'}`; }
    }
    const r = planUpper(customers, names);
    if (!r.changes.length && !r.clashes.length) return [`همهٔ ${fa(customers.length)} مشتری از پیش با حروف بزرگ‌اند؛ چیزی برای تغییر نیست.`];
    const p = this.store.add({ at: this.now(), status: 'pending', total: customers.length, changes: r.changes, clashes: r.clashes, unchanged: r.unchanged });
    this.audit.add({ event: 'names-preview', previewId: p.id, total: r.changes.length });
    const lines = [
      `پیش‌نمایش تغییر نام مشتری‌ها #${p.id} — هنوز چیزی در کوییک‌بوکس تغییر نکرده`,
      `از ${fa(customers.length)} مشتری: ${fa(r.changes.length)} تغییر می‌کند، ${fa(r.unchanged)} از پیش درست است، ${fa(r.clashes.length)} به‌خاطر برخورد نام رد می‌شود.`,
      'فقط نام نمایشی و نام شرکت بزرگ می‌شود؛ هیچ حرف، فاصله یا نقطه‌ای عوض نمی‌شود.',
      ...(unchecked ? [`⚠️ برخورد با نام ${unchecked.trim()} بررسی نشد.`] : []),
      ...r.changes.slice(0, SHOWN).map((c, i) => `${fa(i + 1)}. ${c.old} → ${c.next}`),
      ...(r.changes.length > SHOWN ? [`… و ${fa(r.changes.length - SHOWN)} مورد دیگر`] : []),
      ...(r.clashes.length ? ['⚠️ برخوردها (رد می‌شوند):', ...r.clashes.slice(0, SHOWN).map((c) => `• ${c.name} → ${c.next} (${c.why})`), ...(r.clashes.length > SHOWN ? [`… و ${fa(r.clashes.length - SHOWN)} مورد دیگر`] : [])] : []),
      `برای اجرا: «بله #${p.id}» — برای لغو: «نه #${p.id}» (۲۴ ساعت اعتبار)`,
    ];
    return [lines.join('\n')];
  }

  /** The owner's yes or no in his own chat. The update runs in the background; the report comes at the end. */
  async decide({ verb, id }) {
    const p = this.store.get(id);
    if (!p) return [`پیش‌نمایش ${id} پیدا نشد.`];
    if (verb === 'no') {
      if (p.status === 'running' || p.status === 'done') return [`پیش‌نمایش ${p.id} پیش‌تر اجرا شده یا در حال اجراست؛ لغو آن ممکن نیست.`];
      p.status = 'cancelled'; this.store.save(); this.audit.add({ event: 'names-cancel', previewId: p.id, approver: 'owner' });
      return [`پیش‌نمایش ${p.id} لغو شد. چیزی تغییر نکرد.`];
    }
    if (p.status === 'done') return [`${p.id} پیش‌تر اجرا شده است: ${this.reportLine(p.result)}`];
    if (p.status === 'running' || this.busy) return [`${p.id} همین حالا در حال اجراست؛ صبر کنید.`];
    if (p.status === 'cancelled') return [`پیش‌نمایش ${p.id} لغو شده بود.`];
    if (p.status === 'expired' || this.now() - p.at > DAY) {
      if (p.status !== 'expired') { p.status = 'expired'; this.store.save(); this.audit.add({ event: 'names-expire', previewId: p.id }); }
      return [`پیش‌نمایش ${p.id} بیش از ۲۴ ساعت پیش است و منقضی شد. دوباره درخواست کنید.`];
    }
    const blocked = this.guard();
    if (blocked) return [blocked];
    if (!this.qbo.writeOn) { this.audit.add({ event: 'refuse', previewId: p.id, reason: 'write-off' }); return ['نوشتن در کوییک‌بوکس خاموش است؛ نامی تغییر نکرد. پیش‌نمایش می‌ماند.']; }
    p.status = 'running'; this.busy = true; this.store.save();
    void this.run(p);
    return [`اجرا شروع شد: ${fa(p.changes.length)} مشتری، یکی‌یکی با فاصله. نتیجه در پایان گفته می‌شود.`];
  }

  reportLine(r) { return `${fa(r.changed)} تغییر کرد، ${fa(r.skipped)} رد شد (برخورد یا از پیش درست)، ${fa(r.failed)} ناموفق${r.stoppedAt ? `؛ در مورد ${fa(r.stoppedAt)} ایستاد: ${r.why}` : ''}${r.remaining ? `؛ ${fa(r.remaining)} مورد انجام نشد` : ''}.`; }

  async run(p) {
    const r = { changed: 0, skipped: p.clashes.length, failed: 0, stoppedAt: 0, why: '', remaining: 0 };
    try {
      for (const [i, c] of p.changes.entries()) {
        let cur;
        try { cur = (await this.qbo.get(`customer/${encodeURIComponent(c.id)}`))?.Customer; } catch (e) { this.stop(r, p, i, e); break; }
        if (!cur) { r.failed += 1; continue; }
        // fresh from QuickBooks: a customer already in upper case is skipped (idempotent)
        const body = { Id: String(cur.Id), SyncToken: String(cur.SyncToken), sparse: true };
        const displayUp = upper(cur.DisplayName);
        const companyUp = typeof cur.CompanyName === 'string' ? upper(cur.CompanyName) : undefined;
        if (displayUp !== cur.DisplayName) body.DisplayName = displayUp;
        if (companyUp !== undefined && companyUp !== cur.CompanyName) body.CompanyName = companyUp;
        if (body.DisplayName === undefined && body.CompanyName === undefined) { r.skipped += 1; continue; }
        const oldDisplay = cur.DisplayName; const oldCompany = cur.CompanyName; // as read, before the update
        try {
          await this.qbo.write('POST', 'customer', body);
          r.changed += 1;
          this.audit.add({ event: 'customer-name', approver: 'owner', previewId: p.id, qboId: body.Id, old: oldDisplay, new: body.DisplayName ?? oldDisplay, ...(body.CompanyName !== undefined ? { oldCompany, newCompany: body.CompanyName } : {}) });
        } catch (e) { this.stop(r, p, i, e); break; }
        if (this.gapMs) await this.sleep(this.gapMs);
      }
    } finally {
      p.status = r.stoppedAt ? 'pending' : 'done'; // after a stop the preview can be run again: the done ones are skipped
      p.result = r;
      this.busy = false;
      this.store.save();
      this.desk.cache = { at: 0, customers: [] }; // the bot's customer list is read again
      this.audit.add({ event: r.stoppedAt ? 'names-stopped' : 'names-done', previewId: p.id, total: r.changed });
      const text = `تغییر نام مشتری‌ها (${p.id}): ${this.reportLine(r)}`;
      if (this.finish) { try { await this.finish([text]); } catch { /* the chat may be gone */ } }
    }
  }

  stop(r, p, index, e) {
    r.stoppedAt = index + 1;
    r.why = e.paused ? 'کلید توقف روشن است' : e.message;
    r.remaining = p.changes.length - index;
    r.failed += e.paused ? 0 : 1;
    this.log(`QuickBooks customer names stopped at ${index + 1}: ${e.name} ${e.status || ''}`);
  }
}
