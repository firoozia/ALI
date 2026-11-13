// EDIT an existing QuickBooks invoice by message (owner-approved feature), with a preview and the owner's yes:
//   edit invoice 10003
//   add <code> <m>         (a code not on the invoice: a NEW line at the system price, or the price given: add <code>=<m>m /<price>aed; a code on it: its quantity grows, its rate stays)
//   remove <code> <m>        (the quantity shrinks; at 0 the line is deleted; «remove <code>» alone takes the whole line)
// Nothing is applied until the WHOLE request is valid (a code that is not on the invoice, a removal larger than the quantity: that line is refused with the reason and nothing is applied).
// Everything else on the invoice (customer, date, number, notes, memo, form style, tax settings, every other field) stays: a SPARSE update with the current SyncToken, and the invoice is read
// again just before the apply: if it changed since the preview, the edit is refused. The result is the updated invoice PDF with its caption, as after a create.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { itemCodeKeys, pickItem } from './qboinvoice.js';
import { SEP } from './separator.js';

const DAY = 24 * 3600 * 1000;
export const EDIT_EXPIRY_MS = DAY;
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const money = (n) => { const v = Math.abs(r2(n)); const s = v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return n < 0 ? `-${s}` : s; };
const qty = (n) => String(Math.round(Number(n) * 1000) / 1000);
const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const key = (code) => (/^\d+$/.test(String(code).trim()) ? String(code).trim() : norm(code));

/** The pending edits (a file on the server): ids W1, W2 … */
export class EditStore {
  constructor(dir = '') {
    this.file = dir ? path.join(dir, 'qbo-invoice-edits.json') : '';
    this.d = { n: 0, edits: {} };
    try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* first start */ }
  }

  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  nextId() { this.d.n += 1; return `W${this.d.n}`; }
  add(e) { this.d.edits[e.id] = e; this.save(); return e; }
  get(id) { return this.d.edits[String(id).toUpperCase()] || null; }
  openIds(now = Date.now()) { return Object.values(this.d.edits).filter((e) => e.status === 'pending' && now - e.at <= EDIT_EXPIRY_MS).map((e) => e.id); }
}

/**
 * Works out the edit: the lines to send, the preview rows, the totals and what was refused. Pure: [inv] is the invoice as QuickBooks gave it, [items] the active items,
 * [taxRate] the percent of the invoice's tax code (or null), [ops] the parsed lines.
 * Returns { problems: [text], rows: [{ sign, text }], lines: [the full Line array to send], before, after, rate }.
 */
export function planEdit({ inv, items, taxRate = null, ops }) {
  const itemById = new Map(items.map((i) => [String(i.Id), i]));
  const lines = (inv.Line || []).filter((l) => l.DetailType !== 'SubTotalLine').map((l) => JSON.parse(JSON.stringify(l)));
  const salesLines = () => lines.filter((l) => l.DetailType === 'SalesItemLineDetail');
  const taxRefs = salesLines().map((l) => l.SalesItemLineDetail?.TaxCodeRef?.value).filter(Boolean);
  const taxRef = taxRefs.sort((a, b) => taxRefs.filter((x) => x === b).length - taxRefs.filter((x) => x === a).length)[0] || '';
  const problems = []; const rows = [];
  const onInvoice = (code) => {
    const k = key(code);
    return salesLines().filter((l) => { const it = itemById.get(String(l.SalesItemLineDetail?.ItemRef?.value)); return it && itemCodeKeys(it).has(k); });
  };
  const history = new Set(salesLines().map((l) => String(l.SalesItemLineDetail?.ItemRef?.value)));
  const subtotalOf = () => r2(salesLines().reduce((s, l) => s + Number(l.Amount || 0), 0) + lines.filter((l) => l.DetailType === 'DiscountLineDetail' || l.DetailType === 'DiscountLine').reduce((s, l) => s - Math.abs(Number(l.Amount || 0)), 0));
  const subtotalBefore = subtotalOf();
  for (const op of ops) {
    const head = `${op.kind === 'add' ? 'Add' : 'Remove'} ${op.code}`;
    const have = onInvoice(op.code);
    if (op.kind === 'remove') {
      if (!have.length) { problems.push(`${head}: that code is not on the invoice.`); continue; }
      const line = have[0]; const d = line.SalesItemLineDetail; const current = Number(d.Qty) || 0; const rate = Number(d.UnitPrice) || 0;
      const take = op.qty === null ? current : op.qty;
      if (take > current + 1e-9) { problems.push(`${head}: you asked to remove ${qty(take)} m but the invoice has only ${qty(current)} m of it.`); continue; }
      const rest = r2(current - take);
      if (rest <= 1e-9) { lines.splice(lines.indexOf(line), 1); rows.push({ sign: '🔴', text: `${head}: ${qty(current)} m → line removed (−${qty(current)} m × ${money(rate)} = *−${money(current * rate)}*)` }); } else {
        d.Qty = rest; line.Amount = r2(rest * rate);
        rows.push({ sign: '🔴', text: `${head}: ${qty(current)} m → ${qty(rest)} m (−${qty(take)} m × ${money(rate)} = *−${money(take * rate)}*)` });
      }
      continue;
    }
    // add
    if (have.length) {
      const line = have[0]; const d = line.SalesItemLineDetail; const current = Number(d.Qty) || 0; const rate = Number(d.UnitPrice) || 0;
      d.Qty = r2(current + op.qty); line.Amount = r2(d.Qty * rate);
      const priceNote = op.price !== null && Math.abs(op.price - rate) > 0.005 ? ' — the line keeps its rate ' + money(rate) + ', the price you gave (' + money(op.price) + ') is not used' : '';
      rows.push({ sign: '🟢', text: head + ': ' + qty(current) + ' m → ' + qty(d.Qty) + ' m (+' + qty(op.qty) + ' m × ' + money(rate) + ' = *' + money(op.qty * rate) + '*)' + priceNote });
      continue;
    }
    const picked = pickItem(op.code, { items, history });
    if (!picked.item) { problems.push(`${head}: no single QuickBooks item has that code${picked.stop ? ' (it is missing, or it fits several items: name it exactly)' : ''}.`); continue; }
    const item = picked.item; const listed = Number(item.UnitPrice) > 0 ? Number(item.UnitPrice) : null; const price = op.price ?? listed;
    if (price === null) { problems.push(`${head}: "${item.Name}" has no price in QuickBooks; write it: add ${op.code}=${qty(op.qty)}m /<price>aed`); continue; }
    if (!taxRef) { problems.push(`${head}: the invoice has no tax code to copy for the new line.`); continue; }
    lines.push({ DetailType: 'SalesItemLineDetail', Amount: r2(op.qty * price), ...(item.Description ? { Description: String(item.Description).slice(0, 4000) } : {}),
      SalesItemLineDetail: { ItemRef: { value: String(item.Id) }, Qty: op.qty, UnitPrice: price, TaxCodeRef: { value: taxRef } } });
    history.add(String(item.Id));
    rows.push({ sign: '🟢', text: `${head}: new line ${qty(op.qty)} m × ${money(price)} = *${money(op.qty * price)}*${op.price === null ? '' : ' (your price)'}` });
  }
  const subtotalAfter = subtotalOf();
  const taxOld = Number(inv.TxnTaxDetail?.TotalTax) || 0;
  const rate = subtotalBefore > 0 && taxOld > 0 ? taxOld / subtotalBefore : (taxRate !== null ? taxRate / 100 : 0);
  const before = Number(inv.TotalAmt) || 0;
  const after = r2(subtotalAfter * (1 + rate));
  return { problems, rows, lines, before, after, ratePct: Math.round(rate * 1000) / 10 };
}

export class InvoiceEdits {
  /** [invoices]: the QboInvoiceDesk (QuickBooks access, catalog, guard, audit, the PDF posting); [store]: EditStore. */
  constructor({ invoices, store, now = () => Date.now(), log = () => {} }) { Object.assign(this, { invoices, store, now, log }); this.inflight = new Set(); }

  async findInvoice(number) {
    const n = String(number).trim();
    for (const doc of [`inv-${n}`, n]) {
      const rows = await this.invoices.qbo.query(`select * from Invoice where DocNumber = '${doc.replace(/'/g, "\\'")}'`);
      if (rows.length === 1) return rows[0];
      if (rows.length > 1) return { ambiguous: rows.length };
    }
    return null;
  }

  /** A request «edit invoice N» + lines -> a PREVIEW (never applied here). Returns the text for the chat. */
  async request({ number, ops, bad = [], requester, origin = null }) {
    const blocked = this.invoices.guard(); if (blocked) return blocked;
    if (!ops.length && !bad.length) return 'Edit invoice: write the changes one per line after "edit invoice <number>", for example: add <code> <metres>m / remove <code> <metres>m';
    if (bad.length) return `I could not read these lines, so nothing was prepared:\n${bad.map((b) => `- ${b}`).join('\n')}\nUse: add <code> <metres>m, add <code>=<metres>m /<price>aed, remove <code> <metres>m, remove <code>`;
    const inv = await this.findInvoice(number);
    if (!inv) return `No invoice numbered ${number} (inv-${number}) was found in QuickBooks.`;
    if (inv.ambiguous) return `${inv.ambiguous} invoices carry the number ${number}; nothing was prepared.`;
    const cat = await this.invoices.catalog();
    const sample = (inv.Line || []).find((l) => l.SalesItemLineDetail?.TaxCodeRef?.value);
    const taxRate = sample ? (cat.codes.get(String(sample.SalesItemLineDetail.TaxCodeRef.value))?.rate ?? null) : null;
    const plan = planEdit({ inv, items: cat.items, taxRate, ops });
    if (plan.problems.length) return `Edit of ${inv.DocNumber} not prepared; nothing is applied until every line is valid:\n${plan.problems.map((p) => `- ${p}`).join('\n')}`;
    const warnings = [];
    if ((inv.LinkedTxn || []).some((t) => t.TxnType === 'Payment')) warnings.push('⚠ This invoice has a payment linked to it.');
    if (inv.EmailStatus === 'EmailSent') warnings.push('⚠ This invoice was already emailed to the customer.');
    const id = this.store.nextId();
    const customer = inv.CustomerRef?.name || '';
    const currency = inv.CurrencyRef?.value || cat.currency || 'AED';
    const edit = { id, nonce: randomBytes(5).toString('hex'), at: this.now(), status: 'pending', requester, origin, invoiceId: String(inv.Id), docNumber: inv.DocNumber, syncToken: String(inv.SyncToken), customer, currency, lines: plan.lines, before: plan.before, after: plan.after, ratePct: plan.ratePct, ops };
    this.store.add(edit); this.invoices.audit.add({ event: 'edit-preview', requester, previewId: id, docNumber: inv.DocNumber, before: plan.before, after: plan.after });
    return [`✏️ Edit invoice ${inv.DocNumber} — #${id}`, `Customer: *${customer}*`, ...plan.rows.map((r) => `${r.sign} ${r.text}`), SEP,
      `Total: ${money(plan.before)} → *${money(plan.after)} ${currency}*${plan.ratePct ? ` (VAT ${plan.ratePct}% included)` : ''}`, ...warnings, `Yes #${id} / No #${id}`].join('\n');
  }

  /** The owner's yes or no. */
  async decide({ verb, id, decidedIn = '' }) {
    const p = this.store.get(id);
    if (!p) return [`The edit ${id} was not found.`];
    if (verb === 'no') {
      if (p.status === 'applied') return [`${id} was already applied to ${p.docNumber}; it cannot be cancelled from here.`];
      p.status = 'cancelled'; this.store.save(); this.invoices.audit.add({ event: 'edit-cancel', previewId: p.id, approver: 'owner' });
      return [`The edit ${p.id} of ${p.docNumber} was cancelled. Nothing changed.`];
    }
    if (p.status === 'applied') return [`The edit ${p.id} was already applied to ${p.docNumber}. It was not applied again.`];
    if (p.status === 'cancelled') return [`The edit ${p.id} was cancelled before.`];
    if (p.status === 'stale') return [`The edit ${p.id} is out of date (the invoice changed). Ask again.`];
    if (this.now() - p.at > EDIT_EXPIRY_MS) { p.status = 'expired'; this.store.save(); return [`The edit ${p.id} is more than a day old and expired. Ask again.`]; }
    const blocked = this.invoices.guard(); if (blocked) return [blocked];
    if (!this.invoices.qbo.writeOn) { this.invoices.audit.add({ event: 'edit-refuse', previewId: p.id, reason: 'write-off' }); return ['Writing to QuickBooks is off; the invoice was not changed. The edit stays waiting.']; }
    if (this.inflight.has(p.id)) return [`The edit ${p.id} is being applied right now; wait a moment.`];
    this.inflight.add(p.id);
    try {
      const now = (await this.invoices.qbo.get(`invoice/${encodeURIComponent(p.invoiceId)}`))?.Invoice;
      if (!now || String(now.SyncToken) !== p.syncToken) {
        p.status = 'stale'; this.store.save(); this.invoices.audit.add({ event: 'edit-refuse', previewId: p.id, reason: 'changed' });
        return [`${p.docNumber} was changed in QuickBooks since the preview, so nothing was applied. Write the edit again to see the new figures.`];
      }
      let result;
      try { result = await this.invoices.qbo.write('POST', 'invoice', { Id: p.invoiceId, SyncToken: p.syncToken, sparse: true, Line: p.lines }, { requestId: `atossa-edit-${p.id}-${p.nonce}` }); } catch (e) {
        this.invoices.audit.add({ event: 'edit-failed', previewId: p.id, status: e.status || 0, fault: e.fault || null });
        return [`QuickBooks did not accept the edit (${e.message}). ${p.docNumber} was not changed; the same yes can be tried again.`];
      }
      const done = result?.Invoice;
      p.status = 'applied'; this.store.save();
      const total = Number(done?.TotalAmt);
      this.invoices.audit.add({ event: 'edit', requester: p.requester, approver: 'owner', previewId: p.id, qboId: p.invoiceId, docNumber: p.docNumber, before: p.before, after: total });
      const out = [];
      if (Number.isFinite(total) && Math.abs(total - p.after) > 0.01) out.push(`⚠ The total in QuickBooks is ${money(total)} but the preview said ${money(p.after)}; check ${p.docNumber} in QuickBooks.`);
      let posted = 0;
      try {
        const pdf = await this.invoices.qbo.getBinary(`invoice/${encodeURIComponent(p.invoiceId)}/pdf`);
        const caption = `Invoice ${p.docNumber} - ${p.customer} - total ${money(Number.isFinite(total) ? total : p.after)} ${p.currency}`;
        const fileName = `invoice-${String(p.docNumber).replace(/[^\w.-]+/g, '_')}.pdf`;
        const targets = this.invoices.targets ? await this.invoices.targets(p, decidedIn) : [this.invoices.ownerJid()];
        for (const jid of targets) { await this.invoices.post(jid, pdf, fileName, caption); posted += 1; }
      } catch (e) { out.push('The updated PDF could not be fetched or sent; the invoice was changed.'); }
      if (!posted) out.unshift(`*Invoice* ${p.docNumber} — *${p.customer}* — edited, total *${money(Number.isFinite(total) ? total : p.after)} ${p.currency}*`);
      return out;
    } finally { this.inflight.delete(p.id); }
  }
}
