import test from 'node:test';
import assert from 'node:assert/strict';
import { EditStore, InvoiceEdits, planEdit } from '../src/invoiceedit.js';
import { parseEditRequest, parseInvoiceCommand } from '../src/qboinvoice.js';

// Made-up customers and items; a fake QuickBooks (nothing here can touch the live company).
const items = [
  { Id: '1', Name: 'PVC 102', Sku: 'PVC-102', UnitPrice: 13, Description: 'film 102', Type: 'Inventory', Active: true },
  { Id: '2', Name: 'PVC 215', Sku: 'PVC-215', UnitPrice: 14, Type: 'Inventory', Active: true },
  { Id: '3', Name: 'PVC 303', Sku: 'PVC-303', UnitPrice: 14, Type: 'Inventory', Active: true },
  { Id: '4', Name: 'PVC 404', Sku: 'PVC-404', UnitPrice: 0, Type: 'Inventory', Active: true },
];
const sale = (id, itemId, q, rate) => ({ Id: id, LineNum: Number(id), DetailType: 'SalesItemLineDetail', Amount: q * rate, SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: q, UnitPrice: rate, TaxCodeRef: { value: 'T5' } } });
const invoice = (extra = {}) => ({ Id: '900', SyncToken: '3', DocNumber: 'inv-10003', CustomerRef: { value: 'c1', name: 'ZETA KITCHEN' }, CurrencyRef: { value: 'AED' }, TotalAmt: 176.4, TxnTaxDetail: { TotalTax: 8.4 },
  Line: [sale('1', '2', 6, 14), sale('2', '3', 12, 7), { DetailType: 'SubTotalLine', Amount: 168 }], ...extra });

test('the command: «edit invoice N» then add / remove lines, with an optional unit and price; anything else is not an edit', () => {
  assert.deepEqual(parseEditRequest('edit invoice 10003\nadd 102 5m\nadd 215 5m\nremove 303 5m'), { number: '10003', bad: [], ops: [
    { kind: 'add', code: '102', qty: 5, price: null }, { kind: 'add', code: '215', qty: 5, price: null }, { kind: 'remove', code: '303', qty: 5, price: null }] });
  const b = parseEditRequest('Edit inv-10003\nadd 102=5m /13aed\nremove 303\nadd 215 2.5\nhello there');
  assert.deepEqual(b.ops, [{ kind: 'add', code: '102', qty: 5, price: 13 }, { kind: 'remove', code: '303', qty: null, price: null }, { kind: 'add', code: '215', qty: 2.5, price: null }]); assert.deepEqual(b.bad, ['hello there']);
  assert.equal(parseEditRequest('ویرایش فاکتور ۱۰۰۰۳\nadd 102 5m').number, '10003');
  assert.equal(parseEditRequest('invoice for ZETA\n102 5m'), null); assert.equal(parseEditRequest('edit the invoice please'), null);
  assert.equal(parseInvoiceCommand('edit invoice 10003\nadd 102 5m').type, 'invoice_edit');
  assert.deepEqual(parseInvoiceCommand('yes #W1'), { type: 'yes', id: 'W1' });
});

test('the plan: a new line at the system price or the given one, more of a line keeps its rate, less shrinks it, zero deletes it, and a bad line stops everything', () => {
  const plan = planEdit({ inv: invoice(), items, taxRate: 5, ops: [{ kind: 'add', code: '102', qty: 5, price: null }, { kind: 'add', code: '215', qty: 5, price: 20 }, { kind: 'remove', code: '303', qty: 5, price: null }] });
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.rows.map((r) => r.text), [
    'Add 102: new line 5 m × 13.00 = *65.00*',
    'Add 215: 6 m → 11 m (+5 m × 14.00 = *70.00*) — the line keeps its rate 14.00, the price you gave (20.00) is not used',
    'Remove 303: 12 m → 7 m (−5 m × 7.00 = *−35.00*)']);
  assert.deepEqual(plan.rows.map((r) => r.sign), ['🟢', '🟢', '🔴']);
  assert.equal(plan.lines.some((l) => l.DetailType === 'SubTotalLine'), false); // QuickBooks recomputes it
  const lines = plan.lines.filter((l) => l.DetailType === 'SalesItemLineDetail');
  assert.deepEqual(lines.map((l) => [l.SalesItemLineDetail.ItemRef.value, l.SalesItemLineDetail.Qty, l.SalesItemLineDetail.UnitPrice, l.Amount]), [['2', 11, 14, 154], ['3', 7, 7, 49], ['1', 5, 13, 65]]);
  assert.equal(lines[2].SalesItemLineDetail.TaxCodeRef.value, 'T5'); // the new line takes the invoice's own tax code
  assert.equal(plan.before, 176.4); assert.equal(plan.after, 281.4); assert.equal(plan.ratePct, 5); // (154 + 49 + 65) = 268, plus 5 % tax
  const gone = planEdit({ inv: invoice(), items, taxRate: 5, ops: [{ kind: 'remove', code: '303', qty: null, price: null }] });
  assert.deepEqual(gone.lines.filter((l) => l.DetailType === 'SalesItemLineDetail').map((l) => l.SalesItemLineDetail.ItemRef.value), ['2']); assert.match(gone.rows[0].text, /12 m → line removed/);
  assert.match(planEdit({ inv: invoice(), items, ops: [{ kind: 'remove', code: '303', qty: 20, price: null }] }).problems[0], /only 12 m of it/);
  assert.match(planEdit({ inv: invoice(), items, ops: [{ kind: 'remove', code: '102', qty: 1, price: null }] }).problems[0], /not on the invoice/);
  assert.match(planEdit({ inv: invoice(), items, ops: [{ kind: 'add', code: '404', qty: 1, price: null }] }).problems[0], /has no price in QuickBooks/);
  assert.match(planEdit({ inv: invoice(), items, ops: [{ kind: 'add', code: '999', qty: 1, price: null }] }).problems[0], /no single QuickBooks item/);
});

function desk({ inv = invoice(), writeOn = true, posted = [], writes = [], audit = [], later = null } = {}) {
  let current = inv;
  const qbo = {
    writeOn,
    query: async (q) => (/DocNumber = 'inv-10003'/.test(q) ? [current] : []),
    get: async () => ({ Invoice: later || current }),
    write: async (m, entity, body) => { writes.push({ m, entity, body }); return { Invoice: { ...current, SyncToken: '4', TotalAmt: Number(globalThis.__total ?? 244.65) } }; },
    getBinary: async () => Buffer.from('%PDF'),
  };
  const invoices = { qbo, guard: () => '', catalog: async () => ({ items, codes: new Map([['T5', { id: 'T5', name: 'VAT 5%', rate: 5 }]]), currency: 'AED' }), audit: { add: (e) => audit.push(e) },
    targets: null, post: async (jid, buf, name, caption) => posted.push({ jid, name, caption }), ownerJid: () => 'owner@s.whatsapp.net' };
  const edits = new InvoiceEdits({ invoices, store: new EditStore('') });
  return { edits, writes, posted, audit, qbo, setLater: (v) => { later = v; } };
}

test('the preview shows the rows, the totals and the warnings; nothing is written; a payment or an email is warned about', async () => {
  const d = desk({ inv: invoice({ LinkedTxn: [{ TxnType: 'Payment', TxnId: '5' }], EmailStatus: 'EmailSent' }) });
  const text = await d.edits.request({ number: '10003', ops: [{ kind: 'add', code: '102', qty: 5, price: null }], requester: 'owner', origin: { jid: 'g1@g.us' } });
  assert.match(text, /^✏️ Edit invoice inv-10003 — #W1\nCustomer: \*ZETA KITCHEN\*\n🟢 Add 102: new line 5 m × 13\.00 = \*65\.00\*\n━+\nTotal: 176\.40 → \*244.65 AED\* \(VAT 5% included\)\n⚠ This invoice has a payment linked to it\.\n⚠ This invoice was already emailed to the customer\.\nYes #W1 \/ No #W1$/);
  assert.deepEqual(d.writes, []); assert.deepEqual(d.edits.store.openIds(), ['W1']); assert.equal(d.audit[0].event, 'edit-preview');
  assert.match(await d.edits.request({ number: '99999', ops: [{ kind: 'add', code: '102', qty: 1, price: null }], requester: 'owner' }), /No invoice numbered 99999/);
  assert.match(await d.edits.request({ number: '10003', ops: [{ kind: 'remove', code: '303', qty: 99, price: null }], requester: 'owner' }), /nothing is applied until every line is valid:\n- Remove 303: you asked to remove 99 m/);
  assert.match(await d.edits.request({ number: '10003', ops: [], bad: ['what is this'], requester: 'owner' }), /could not read these lines[\s\S]*what is this/);
});

test('yes applies a SPARSE update with the current SyncToken and only the lines, then sends the PDF with its caption; a second yes does nothing; no cancels', async () => {
  const d = desk();
  await d.edits.request({ number: '10003', ops: [{ kind: 'add', code: '102', qty: 5, price: null }], requester: 'owner', origin: { jid: 'g1@g.us' } });
  const out = await d.edits.decide({ verb: 'yes', id: 'W1' });
  assert.equal(d.writes.length, 1); const w = d.writes[0];
  assert.deepEqual([w.m, w.entity, w.body.Id, w.body.SyncToken, w.body.sparse], ['POST', 'invoice', '900', '3', true]);
  assert.deepEqual(Object.keys(w.body).sort(), ['Id', 'Line', 'SyncToken', 'sparse']); // nothing else of the invoice is sent: customer, date, number, notes, memo, form, tax stay
  assert.equal(w.body.Line.filter((l) => l.DetailType === 'SalesItemLineDetail').length, 3);
  assert.deepEqual(out, []); assert.deepEqual(d.posted, [{ jid: 'owner@s.whatsapp.net', name: 'invoice-inv-10003.pdf', caption: 'Invoice inv-10003 - ZETA KITCHEN - total 244.65 AED' }]);
  assert.equal(d.audit.at(-1).event, 'edit'); assert.match((await d.edits.decide({ verb: 'yes', id: 'W1' }))[0], /already applied/); assert.equal(d.writes.length, 1);
  const e = desk(); await e.edits.request({ number: '10003', ops: [{ kind: 'add', code: '102', qty: 5, price: null }], requester: 'owner' });
  assert.match((await e.edits.decide({ verb: 'no', id: 'W1' }))[0], /cancelled\. Nothing changed/); assert.match((await e.edits.decide({ verb: 'yes', id: 'W1' }))[0], /cancelled before/); assert.equal(e.writes.length, 0);
});

test('a changed invoice, writing switched off, a total that differs and a lost PDF are all said; nothing is applied when the invoice changed', async () => {
  const d = desk();
  await d.edits.request({ number: '10003', ops: [{ kind: 'add', code: '102', qty: 5, price: null }], requester: 'owner' });
  d.setLater({ ...invoice(), SyncToken: '9' });
  assert.match((await d.edits.decide({ verb: 'yes', id: 'W1' }))[0], /was changed in QuickBooks since the preview, so nothing was applied/); assert.equal(d.writes.length, 0);
  const off = desk({ writeOn: false }); await off.edits.request({ number: '10003', ops: [{ kind: 'add', code: '102', qty: 5, price: null }], requester: 'owner' });
  assert.match((await off.edits.decide({ verb: 'yes', id: 'W1' }))[0], /Writing to QuickBooks is off/); assert.equal(off.writes.length, 0);
  globalThis.__total = 300; const diff = desk(); await diff.edits.request({ number: '10003', ops: [{ kind: 'add', code: '102', qty: 5, price: null }], requester: 'owner' });
  assert.match((await diff.edits.decide({ verb: 'yes', id: 'W1' })).join('\n'), /The total in QuickBooks is 300\.00 but the preview said 244.65/); delete globalThis.__total;
  const lost = desk(); lost.qbo.getBinary = async () => { throw new Error('x'); }; await lost.edits.request({ number: '10003', ops: [{ kind: 'add', code: '102', qty: 5, price: null }], requester: 'owner' });
  assert.match((await lost.edits.decide({ verb: 'yes', id: 'W1' })).join('\n'), /updated PDF could not be fetched or sent; the invoice was changed/);
});
