import test from 'node:test';
import assert from 'node:assert/strict';
import { QboInvoiceDesk, InvoiceStore, Audit } from '../src/qboinvoice.js';

// Two "yes" at the same moment can never make two invoices. Invented data only.
test('a second yes that arrives while the first is still creating does not start another attempt', async () => {
  let posts = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const qbo = {
    paused: false, configured: true, needsReconnect: false, connected: true, writeOn: true, missing: [],
    write: async () => { posts += 1; await gate; return { Invoice: { Id: '901', DocNumber: '2001', TotalAmt: 10.5 } }; },
    get: async () => ({ Invoice: { TotalAmt: 10.5 } }),
    getBinary: async () => Buffer.from('%PDF-1.4 x'),
  };
  const store = new InvoiceStore('');
  store.add({ id: 'Q1', nonce: 'abc123', at: Date.now(), status: 'pending', requester: 'owner', customer: { ours: 'X', id: '1', name: 'X' }, lines: [{ itemId: '1', name: 'I', sku: '', qty: 1, price: 10, amount: 1000 }], tax: { id: '11', name: '5% S', rate: 5 }, subtotal: 1000, vat: 50, total: 1050, currency: 'AED', warnings: [] });
  const desk = new QboInvoiceDesk({ qbo, desk: {}, store, audit: new Audit(''), config: {}, today: () => '2026-11-08', post: async () => {}, ownerJid: () => 'o@s.whatsapp.net', groups: async () => [], testGroup: () => null });
  const first = desk.decide({ verb: 'yes', id: 'Q1' });
  const second = await desk.decide({ verb: 'yes', id: 'Q1' });
  assert.ok(second.join('').includes('در حال ساخته شدن'));
  release();
  const done = (await first).join('');
  assert.ok(done.includes('ساخته شد'));
  assert.equal(posts, 1);
});
