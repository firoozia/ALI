import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Qbo, QboError } from '../src/qbo.js';
import { QboDesk, QboMap, pickTestGroup } from '../src/qbodesk.js';
import { Aliases } from '../src/aliases.js';
import { CustomerGroups } from '../src/customergroups.js';
import { STAFF_RULES } from '../src/staff.js';
import { extractInvoiceRequest, validateExtraction } from '../src/qboextract.js';
import { ItemCodes, itemsContaining, looksLikeInvoiceRequest, parseInvoiceBlocks } from '../src/qboinvoice.js';
import { Audit, AuthStore, CAP_DAY, CAP_HOUR, EXPIRY_MS, InvoiceStore, QboInvoiceDesk, TaxChoices, codeFromInvoices, itemsNamed, lineCandidates, parseInvoiceCommand, resolveLines, taxCodeMap, totals } from '../src/qboinvoice.js';

// Invented names, items, numbers and amounts only: nothing real is ever in the repository.
const REALM = '9130000000';
const OWNER_JID = '971500000000@s.whatsapp.net';
const GROUPS = [{ id: 'test@g.us', subject: 'TEST ARYAK BOT' }, { id: 'orion@g.us', subject: 'ORION - ARYAK' }, { id: 'staff@g.us', subject: 'Aryak Staff' }];
const ITEMS = [
  { Id: '1', Name: 'Hinge 35mm', Sku: 'H35', UnitPrice: 2.5, Type: 'Inventory', Active: true, Description: '35 mm soft-close hinge' },
  { Id: '2', Name: 'Edge Tape White', Sku: 'ET-W', UnitPrice: 1.2, Type: 'Inventory', Active: true },
  { Id: '3', Name: 'Handle Steel', Sku: 'HS-1', UnitPrice: 0, Type: 'Inventory', Active: true },
  { Id: '4', Name: 'Hinge', Sku: 'H', UnitPrice: 1, Type: 'Inventory', Active: true },
];
const CUSTOMERS = [{ Id: '58', DisplayName: 'Orion Furniture', CompanyName: 'Orion Furniture LLC', Balance: 0, SalesTermRef: { value: '3' }, PrimaryEmailAddr: { Address: 'office@orion.test' } }, { Id: '59', DisplayName: 'Cedar Wood Works', Balance: 0 }];
const TAXCODES = [
  { Id: '11', Name: '5% S', Taxable: true, Active: true, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: '5' } }] } },
  { Id: '12', Name: 'Zero rated', Taxable: true, Active: true, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: '6' } }] } },
  { Id: 'NON', Name: 'Out of scope', Taxable: false, Active: true },
];
const TAXRATES = [{ Id: '5', RateValue: 5 }, { Id: '6', RateValue: 0 }];
const invLine = (code) => ({ DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { TaxCodeRef: { value: code } } });
const RECENT = [{ Id: '501', CustomerRef: { value: '58' }, Line: [invLine('11'), invLine('11'), { DetailType: 'SubTotalLineDetail' }] }, { Id: '502', CustomerRef: { value: '58' }, Line: [invLine('11')] }];

const res = (status, json, extra = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => json, arrayBuffer: async () => Buffer.from(extra.bytes || ''), headers: { get: () => null } });

function mockQbo(opts = {}) {
  const calls = []; const posts = []; const invoices = new Map(); const byRequest = new Map();
  let failures = opts.postFailures || 0;
  const fetchFn = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ url: String(url), method: init.method || 'GET' });
    if (u.hostname === 'developer.intuit.com') return res(200, { authorization_endpoint: 'https://a.test/auth', token_endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', revocation_endpoint: 'https://a.test/revoke' });
    if (u.hostname.startsWith('oauth.')) return res(200, { access_token: 'ACCESS-X', refresh_token: 'REFRESH-X', expires_in: 3600 });
    const p = u.pathname;
    if (init.method === 'POST' && p.endsWith('/invoice')) {
      const requestId = u.searchParams.get('requestid');
      posts.push({ requestId, body: JSON.parse(init.body), minor: u.searchParams.get('minorversion') });
      if (failures > 0) { failures -= 1; return res(500, {}); }
      if (requestId && byRequest.has(requestId)) return res(200, { Invoice: byRequest.get(requestId) }); // Intuit returns the same invoice for the same request id
      const n = invoices.size + 1;
      const sum = Math.round(JSON.parse(init.body).Line.reduce((s, l) => s + l.Amount * 100, 0));
      const body0 = JSON.parse(init.body);
      if (body0.DocNumber && (opts.docNumbers || []).includes(body0.DocNumber)) return res(400, { Fault: { Error: [{ Message: 'Duplicate Document Number Error' }] } });
      const inv = { Id: String(900 + n), DocNumber: body0.DocNumber || String(2000 + n), TotalAmt: opts.totalOverride ?? Math.round(sum * 1.05) / 100 };
      invoices.set(inv.Id, inv); if (requestId) byRequest.set(requestId, inv); if (body0.DocNumber) (opts.docNumbers ||= []).unshift(body0.DocNumber);
      return res(200, { Invoice: inv });
    }
    if (p.endsWith('/pdf')) return opts.pdfFails ? res(500, {}) : res(200, {}, { bytes: '%PDF-1.4 fake invoice' });
    const one = /\/invoice\/(\d+)$/.exec(p);
    if (one) return res(200, { Invoice: invoices.get(one[1]) });
    if (p.includes('/preferences')) return res(200, { Preferences: { CurrencyPrefs: { HomeCurrency: { value: 'AED' } }, SalesFormsPrefs: { CustomTxnNumbers: !!opts.customTxn } } });
    if (p.includes('/companyinfo/')) return res(200, { CompanyInfo: { CompanyName: 'The Test Workshop', Country: 'AE' } });
    const sql = u.searchParams.get('query') || '';
    const ent = /from\s+(\w+)/i.exec(sql)[1];
    const used = opts.docNumbers || (opts.docNumbers = []);
    if (ent === 'Invoice' && sql.includes('MetaData.CreateTime')) return res(200, { QueryResponse: { Invoice: used.map((n, i) => ({ Id: String(i + 1), DocNumber: n })) } });
    const dn = /DocNumber = '([^']*)'/.exec(sql);
    if (ent === 'Invoice' && dn) return res(200, { QueryResponse: { Invoice: used.includes(dn[1]) ? [{ Id: '1' }] : [] } });
    const byId = /from Customer where Id = '(\d+)'/i.exec(sql);
    if (byId) return res(200, { QueryResponse: { Customer: (opts.customers || CUSTOMERS).filter((c) => c.Id === byId[1]) } });
    const rows = { Customer: opts.customers || CUSTOMERS, Item: opts.items || ITEMS, TaxCode: opts.taxCodes || TAXCODES, TaxRate: TAXRATES, Invoice: opts.invoices || RECENT, Payment: [], CreditMemo: [] }[ent] || [];
    return res(200, { QueryResponse: { [ent]: rows } });
  };
  return { fetchFn, calls, posts, invoices };
}

function mk(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qi-'));
  fs.writeFileSync(path.join(dir, 'qbo-tokens.json'), JSON.stringify({ refresh: 'R-1', access: '', accessExpiresAt: 0, initHash: '', realmId: REALM, needsReconnect: false }));
  const m = mockQbo(opts);
  const clock = { t: Date.parse('2026-11-08T08:00:00Z') };
  const config = { qboClientId: 'c', qboClientSecret: 's', qboEnv: 'production', qboRealmId: '', qboRefreshInit: '', qboWrite: opts.write !== false, qboMinorVersion: 75, qboTaxCode: '',
    testGroupNames: ['test aryak bot'], staffGroupNames: ['aryak staff'], observeExcludeNames: [], shadowGroupNames: ['aryak'], infoGroupName: 'information group', invoiceGroupName: 'invoices group', cutGroupName: 'aryak orders pictures', ...(opts.config || {}) };
  const qbo = new Qbo({ config, dir, fetchFn: m.fetchFn, now: () => clock.t, sleep: async () => {}, log: () => {} });
  const list = new CustomerGroups(path.join(dir, 'cg'));
  list.approve('Orion Furniture', 'orion@g.us', 'ORION - ARYAK');
  const map = new QboMap(path.join(dir, 'map'));
  const sent = [];
  const post = async (jid, buf, fileName, caption) => { sent.push({ jid, bytes: buf.toString('latin1'), fileName, caption }); };
  const desk = new QboDesk({ qbo, list, aliases: new Aliases(''), map, config, groups: async () => GROUPS, post, today: () => '2026-11-08', sleep: async () => {}, log: () => {} });
  const store = new InvoiceStore(path.join(dir, 'qbo'));
  const audit = new Audit(path.join(dir, 'qbo'), () => clock.t);
  const book = opts.book || null;
  const itemCodes = new ItemCodes(path.join(dir, 'qbo'));
  const extractCalls = [];
  const extract = opts.extract ? async (text) => { extractCalls.push(text); return opts.extract(text); } : null;
  const inv = new QboInvoiceDesk({ qbo, desk, store, audit, book, taxChoices: new TaxChoices(path.join(dir, 'qbo')), itemCodes, extract, config, today: () => '2026-11-08', now: () => clock.t, post, ownerJid: () => OWNER_JID, groups: async () => GROUPS, testGroup: (g) => pickTestGroup(g, config), log: () => {} });
  return { dir, m, clock, config, qbo, desk, inv, store, audit, sent, map, list, itemCodes, extractCalls };
}
const REQ = 'فاکتور بساز Orion Furniture\nHinge 35mm, 10\nEdge Tape White, 3, 1.1';

test('the words: the request with its lines, yes and no with the preview id, the kill switch, the audit report, the authorized people', () => {
  assert.deepEqual(parseInvoiceCommand(REQ), { type: 'request', customer: 'Orion Furniture', lines: ['Hinge 35mm, 10', 'Edge Tape White, 3, 1.1'] });
  assert.deepEqual(parseInvoiceCommand('آتوسا فاکتور بساز Cedar\nH35 4'), { type: 'request', customer: 'Cedar', lines: ['H35 4'] });
  assert.deepEqual(parseInvoiceCommand('بله #Q12'), { type: 'yes', id: 'Q12' });
  assert.deepEqual(parseInvoiceCommand('بله #Q۱۲'), { type: 'yes', id: 'Q12' });
  assert.deepEqual(parseInvoiceCommand('نه Q3'), { type: 'no', id: 'Q3' });
  assert.deepEqual(parseInvoiceCommand('بله'), { type: 'yes', id: '' }); // bare: the desk looks for the one open preview (none open: not ours)
  assert.deepEqual(parseInvoiceCommand('توقف کوییک‌بوکس'), { type: 'pause' });
  assert.deepEqual(parseInvoiceCommand('ادامهٔ کوییک‌بوکس'), { type: 'resume' });
  assert.deepEqual(parseInvoiceCommand('گزارش کوییک‌بوکس'), { type: 'audit' });
  assert.deepEqual(parseInvoiceCommand('مجوز فاکتور 971 50 111 2222'), { type: 'auth_add', number: '971 50 111 2222', scope: 'both' });
  assert.deepEqual(parseInvoiceCommand('لغو مجوز فاکتور 971501112222'), { type: 'auth_remove', number: '971501112222', scope: 'invoice' });
  assert.deepEqual(parseInvoiceCommand('مجوزها'), { type: 'auth_list' });
  assert.equal(parseInvoiceCommand('سلام'), null);
});

test('item lines: commas make them exact; without commas the numbers at the end are read; an unclear line is never guessed', () => {
  assert.deepEqual(lineCandidates('Hinge 35mm, 10, 2.5'), [{ item: 'Hinge 35mm', qty: 10, price: 2.5 }]);
  assert.deepEqual(lineCandidates('Hinge 35mm | ۱۰'), [{ item: 'Hinge 35mm', qty: 10, price: null }]);
  assert.deepEqual(lineCandidates('1) Edge Tape White 3 1.1'), [{ item: 'Edge Tape White', qty: 3, price: 1.1 }, { item: 'Edge Tape White 3', qty: 1.1, price: null }]);
  assert.deepEqual(lineCandidates('Hinge, ten'), []);
  const r = resolveLines(['Hinge 35mm, 10', 'edge tape white 3', 'hs-1, 2, 9', 'Mystery Thing, 1', 'Hinge 5', 'Hinge, 0', 'broken'], ITEMS);
  assert.deepEqual(r.lines.map((l) => [l.item.Id, l.qty, l.price]), [['1', 10, null], ['2', 3, null], ['3', 2, 9], ['4', 5, null]]); // name or SKU, any case, exact
  assert.equal(r.stops.length, 3);
  assert.ok(r.stops[0].includes('Mystery Thing') && r.stops[0].includes('دقیقاً پیدا نشد'));
  assert.ok(r.stops.some((s) => s.includes('تعداد درست نیست')) && r.stops.some((s) => s.includes('broken')));
  // two readings that BOTH name an item are ambiguous: "Hinge 35mm 10" could be item "Hinge 35mm" qty 10 only; "Hinge 35 10" is not an item at all
  assert.equal(itemsNamed(ITEMS, 'HINGE 35MM').length, 1);
  assert.equal(itemsNamed(ITEMS, 'Hinge 35').length, 0); // not "close enough"
  const amb = resolveLines(['Hinge 35mm 2 3'], [...ITEMS, { Id: '9', Name: 'Hinge 35mm 2', Sku: 'X9', Active: true }]);
  assert.equal(amb.lines.length, 0);
  assert.ok(amb.stops[0].includes('بیش از یک جور'));
});

test('the tax codes are all READ from QuickBooks (zero-rated and exempt too); the code of a customer is what the office used on his recent invoices', () => {
  const codes = taxCodeMap(TAXCODES, TAXRATES);
  assert.deepEqual([...codes.values()].map((c) => [c.id, c.name, c.rate]), [['11', '5% S', 5], ['12', 'Zero rated', 0], ['NON', 'Out of scope', 0]]);
  assert.deepEqual(taxCodeMap([{ Id: '9', Name: 'Old', Active: false }], []).size, 0); // inactive codes are not offered
  assert.deepEqual(totals([{ amount: 2500 }, { amount: 330 }], 5), { subtotal: 2830, vat: 142, total: 2972 });
  assert.deepEqual(totals([{ amount: 2500 }], 0), { subtotal: 2500, vat: 0, total: 2500 }); // zero-rated: no VAT
  assert.equal(codeFromInvoices(RECENT, codes).code.name, '5% S'); // all lines of all recent invoices agree
  assert.equal(codeFromInvoices([], codes).error, 'none'); // no invoices: he picks
  const mixed = codeFromInvoices([{ Line: [invLine('11'), invLine('12'), invLine('12')] }], codes);
  assert.equal(mixed.error, 'disagree');
  assert.deepEqual(mixed.found.map((f) => [f.name, f.n]), [['Zero rated', 2], ['5% S', 1]]);
  assert.equal(codeFromInvoices([{ Line: [invLine('99')] }], codes).error, 'unknown'); // a code that is not in the company's list
  assert.equal(codeFromInvoices([{ Line: [{ DetailType: 'SubTotalLineDetail' }] }], codes).error, 'none');
});

test('a request becomes a PREVIEW for the owner: customer, lines, subtotal, VAT and total as QuickBooks will add them; nothing is created', async () => {
  const t = mk({ book: { priceOf: (code) => (code === 'ET-W' ? { price: 1.3 } : null) } });
  const r = await t.inv.request({ text: REQ, requester: '971501112222' });
  assert.ok(r.requester.includes('#Q1') && r.requester.includes('sent to the owner for approval'));
  for (const s of ['پیش‌نمایش فاکتور #Q1', 'Orion Furniture', 'Hinge 35mm [H35] × 10 @ 2.5 = 25.00', 'Edge Tape White [ET-W] × 3 @ 1.1 = 3.30', 'جمع قبل از مالیات: 28.30', 'مالیات: 5% S 5٪ (از ۳ سطر از ۳ سطر فاکتورهای قبلی): 1.42', 'جمع کل: 29.72 AED', 'بله #Q1', 'نه #Q1']) assert.ok(r.owner.includes(s), s);
  assert.ok(r.owner.includes('سطر ۲') && r.owner.includes('کمتر از قیمت کوییک‌بوکس (1.2)') && r.owner.includes('کمتر از فهرست قیمت مالک (1.3)'));
  assert.equal(t.m.posts.length, 0);
  assert.equal(t.store.get('Q1').status, 'pending');
  assert.equal(t.audit.last(5)[0].event, 'preview');
  assert.ok(!JSON.stringify(t.audit.last(5)).includes('Hinge')); // the audit log has no message text and no lines
});

test('an unsure customer or item is GUESSED, marked and shown; a request stops only when there is nothing to guess from; nothing is applied before the yes', async () => {
  const t = mk();
  const near = await t.inv.request({ text: 'فاکتور بساز Orion Furnitur\nH35, 1', requester: 'owner' });
  assert.ok(near.owner.includes('مشتری: Orion Furniture (حدس از «Orion Furnitur»'));
  assert.ok(near.owner.includes('حدس') && near.owner.includes('بله #Q1'));
  assert.equal(t.store.get('Q1').guesses.customer.text, 'Orion Furnitur');
  assert.equal(t.m.posts.length, 0); // a preview only
  const item = await t.inv.request({ text: 'فاکتور بساز Orion Furniture\nHinge 35, 1', requester: 'owner' });
  assert.ok(item.owner.includes('حدس') && item.owner.includes('Hinge'));
  const none = await t.inv.request({ text: 'فاکتور بساز Orion Furniture', requester: 'owner' });
  assert.ok(none.requester.includes('هر کالا را در یک سطر')); // nothing to guess from: no line at all
  const noPrice = await t.inv.request({ text: 'فاکتور بساز Orion Furniture\nHS-1, 2', requester: 'owner' });
  assert.ok(noPrice.requester.includes('قیمتی نیست')); // a price is never guessed
  const nothing = await t.inv.request({ text: 'فاکتور بساز Qqqqq Wwwww\nH35, 1', requester: 'owner' });
  assert.equal(nothing.owner, null); // no customer is near
  assert.equal(t.store.d.n, 2);
  assert.equal(t.m.posts.length, 0);
  // an auto-matched choice is only a guess; the owner's confirmed one is exact
  t.map.set('Cedar Wod', '59', 'Cedar Wood Works', 'auto');
  assert.ok((await t.inv.request({ text: 'فاکتور بساز Cedar Wod\nH35, 1', requester: 'owner' })).owner.includes('(حدس از «Cedar Wod»'));
  t.map.set('Cedar Wod', '59', 'Cedar Wood Works', 'owner');
  const exact = (await t.inv.request({ text: 'فاکتور بساز Cedar Wod\nH35, 1', requester: 'owner' })).owner;
  assert.ok(exact.includes('Cedar Wood Works') && !exact.includes('(حدس از'));
  assert.ok((await t.inv.request({ text: 'فاکتور بساز Cedar\nH35, 1', requester: 'owner' })).owner.includes('(از «Cedar»)')); // one customer holds the word: used and shown
});

test('only the owner\'s yes creates: the invoice body, the request id, the read-back, the PDF to his chat and the test group only', async () => {
  const t = mk();
  await t.inv.request({ text: REQ, requester: '971501112222' });
  assert.equal(t.m.posts.length, 0);
  const out = (await t.inv.decide({ verb: 'yes', id: 'Q1' })).join('\n');
  assert.equal(t.m.posts.length, 1);
  const { body, requestId, minor } = t.m.posts[0];
  assert.match(requestId, /^atossa-Q1-[0-9a-f]{10}$/);
  assert.equal(minor, '75');
  assert.deepEqual([body.CustomerRef.value, body.TxnDate, body.GlobalTaxCalculation, body.PrivateNote], ['58', '2026-11-08', 'TaxExcluded', 'Atossa Q1']);
  assert.deepEqual(body.Line.map((l) => [l.DetailType, l.Amount, l.SalesItemLineDetail.ItemRef.value, l.SalesItemLineDetail.Qty, l.SalesItemLineDetail.UnitPrice, l.SalesItemLineDetail.TaxCodeRef.value]), [['SalesItemLineDetail', 25, '1', 10, 2.5, '11'], ['SalesItemLineDetail', 3.3, '2', 3, 1.1, '11']]);
  assert.ok(out.includes('ساخته شد') && out.includes('2001') && out.includes('29.72 AED') && !out.includes('نمی‌خواند'));
  assert.deepEqual(t.sent.map((s) => s.jid).sort(), [OWNER_JID, 'test@g.us'].sort()); // his chat and the test group, never a customer group
  assert.ok(t.sent.every((s) => s.bytes.startsWith('%PDF') && s.caption.includes('2001') && s.fileName === 'invoice-2001.pdf'));
  assert.ok(!t.sent.some((s) => s.jid === 'orion@g.us'));
  assert.equal(t.store.get('Q1').status, 'created');
  const a = t.audit.last(5);
  assert.deepEqual(a.map((x) => x.event), ['preview', 'create']);
  assert.deepEqual([a[1].approver, a[1].qboId, a[1].docNumber, a[1].total, a[1].requester], ['owner', '901', '2001', 2972, '971501112222']);
});

test('a second yes returns the same invoice and never makes a second one; after a failure the retry carries the same request id', async () => {
  const t = mk();
  await t.inv.request({ text: REQ, requester: 'owner' });
  await t.inv.decide({ verb: 'yes', id: 'Q1' });
  const again = (await t.inv.decide({ verb: 'yes', id: 'Q1' })).join('\n');
  assert.equal(t.m.posts.length, 1);
  assert.ok(again.includes('پیش‌تر ساخته شده') && again.includes('2001') && again.includes('دوباره ساخته نشد'));
  const f = mk({ postFailures: 4 });
  await f.inv.request({ text: REQ, requester: 'owner' });
  const failed = (await f.inv.decide({ verb: 'yes', id: 'Q1' })).join('\n');
  assert.ok(failed.includes('ساخت فاکتور نشد') && failed.includes('دو فاکتور ساخته نمی‌شود'));
  assert.equal(f.store.get('Q1').status, 'pending'); // can be retried
  const ok = (await f.inv.decide({ verb: 'yes', id: 'Q1' })).join('\n');
  assert.ok(ok.includes('ساخته شد'));
  const ids = new Set(f.m.posts.map((p) => p.requestId));
  assert.equal(ids.size, 1); // every attempt, the failed ones and the good one, used the same id
  assert.equal(f.m.invoices.size, 1);
});

test('"no" cancels; a preview older than 24 hours expires; an unknown id is said', async () => {
  const t = mk();
  await t.inv.request({ text: REQ, requester: 'owner' });
  assert.ok((await t.inv.decide({ verb: 'no', id: 'Q1' })).join('').includes('لغو شد'));
  assert.ok((await t.inv.decide({ verb: 'yes', id: 'Q1' })).join('').includes('لغو شده بود'));
  await t.inv.request({ text: REQ, requester: 'owner' });
  t.clock.t += EXPIRY_MS + 60000;
  assert.ok((await t.inv.decide({ verb: 'yes', id: 'Q2' })).join('').includes('منقضی'));
  assert.equal(t.m.posts.length, 0);
  assert.ok((await t.inv.decide({ verb: 'yes', id: 'Q99' })).join('').includes('پیدا نشد'));
  assert.deepEqual(t.audit.last(10).map((x) => x.event), ['preview', 'cancel', 'preview', 'expire']);
});

test('the caps: ten creations an hour, forty a day; a refused yes is not lost', async () => {
  const t = mk();
  for (let i = 1; i <= CAP_HOUR + 1; i++) await t.inv.request({ text: REQ, requester: 'owner' });
  for (let i = 1; i <= CAP_HOUR; i++) assert.ok((await t.inv.decide({ verb: 'yes', id: `Q${i}` })).join('').includes('ساخته شد'));
  const over = (await t.inv.decide({ verb: 'yes', id: `Q${CAP_HOUR + 1}` })).join('');
  assert.ok(over.includes('سقف ساخت فاکتور پر است'));
  assert.equal(t.m.posts.length, CAP_HOUR);
  assert.equal(t.store.get(`Q${CAP_HOUR + 1}`).status, 'pending');
  t.clock.t += 61 * 60 * 1000;
  assert.ok((await t.inv.decide({ verb: 'yes', id: `Q${CAP_HOUR + 1}` })).join('').includes('ساخته شد')); // an hour later
  // a day: forty already made in the last 24 hours, spread over many hours
  const d = mk();
  d.store.d.creates = Array.from({ length: CAP_DAY }, (_, i) => d.clock.t - (i + 1) * 30 * 60 * 1000);
  await d.inv.request({ text: REQ, requester: 'owner' });
  assert.ok((await d.inv.decide({ verb: 'yes', id: 'Q1' })).join('').includes('سقف'));
  assert.equal(d.m.posts.length, 0);
});

test('the kill switch stops every call, survives a restart, and is lifted by the owner; QBO_WRITE off refuses a yes', async () => {
  const t = mk();
  await t.inv.request({ text: REQ, requester: 'owner' });
  t.qbo.setPaused(true);
  const calls = t.m.calls.length;
  assert.ok((await t.inv.request({ text: REQ, requester: 'owner' })).requester.includes('متوقف'));
  assert.ok((await t.inv.decide({ verb: 'yes', id: 'Q1' })).join('').includes('متوقف'));
  await assert.rejects(() => t.qbo.query('select * from Customer'), (e) => e.paused === true);
  await assert.rejects(() => t.qbo.getBinary('invoice/1/pdf'), (e) => e.paused === true);
  assert.equal(await t.qbo.keepFresh(), false);
  assert.equal(t.m.calls.length, calls); // not one call, not even to Intuit's token endpoint
  const restarted = new Qbo({ config: t.config, dir: t.dir, fetchFn: t.m.fetchFn, now: () => t.clock.t, sleep: async () => {}, log: () => {} });
  assert.equal(restarted.paused, true);
  restarted.setPaused(false);
  assert.equal(new Qbo({ config: t.config, dir: t.dir, fetchFn: t.m.fetchFn }).paused, false);
  t.qbo.setPaused(false);
  assert.ok((await t.inv.decide({ verb: 'yes', id: 'Q1' })).join('').includes('ساخته شد'));
  // write off: the preview works (it only reads), the yes is refused and nothing is posted
  const off = mk({ write: false });
  await off.inv.request({ text: REQ, requester: 'owner' });
  const refused = (await off.inv.decide({ verb: 'yes', id: 'Q1' })).join('');
  assert.ok(refused.includes('نوشتن در کوییک‌بوکس خاموش است'));
  assert.equal(off.m.posts.length, 0);
  assert.equal(off.store.get('Q1').status, 'pending');
  assert.equal(off.audit.last(3).at(-1).reason, 'write-off');
});

test('the only write that exists is "create an invoice": a delete, a void, a payment, a refund, an update are refused whatever the switch', async () => {
  const t = mk();
  const before = t.m.calls.length;
  for (const [method, p] of [['DELETE', 'invoice'], ['POST', 'payment'], ['POST', 'invoice/901'], ['POST', 'creditmemo'], ['POST', 'refundreceipt'], ['PUT', 'invoice'], ['POST', 'invoice?operation=void'], ['POST', 'deposit']]) {
    await assert.rejects(() => t.qbo.write(method, p, {}), (e) => e instanceof QboError && /only creating an invoice/.test(e.message), `${method} ${p}`);
  }
  assert.equal(t.m.calls.length, before);
  const src = ['qbo.js', 'qbodesk.js', 'qboinvoice.js', 'qbostatement.js'].map((f) => fs.readFileSync(path.join(import.meta.dirname, '..', 'src', f), 'utf8')).join('\n');
  assert.ok(!/['"`](DELETE|PUT|PATCH)['"`]/.test(src));
  assert.ok(!/['"`]payment['"`]|['"`]creditmemo['"`]|operation=void/.test(src.replace(/select \* from (Payment|CreditMemo)[^']*/g, '')));
  assert.equal((src.match(/\.write\(/g) || []).length, 1); // one caller of the write function in the whole QuickBooks code
});

test('the authorized people: add, remove, list; a number is matched by its phone number, also through the alt id of a lid chat', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-'));
  const a = new AuthStore(dir);
  assert.equal(a.add('+971 50 111 2222'), '971501112222');
  assert.equal(a.add('12'), false);
  assert.equal(a.add('۹۷۱۵۰۳۳۳۴۴۴۴'), '971503334444');
  assert.deepEqual(a.numbers(), ['971501112222', '971503334444']);
  assert.equal(a.isAuthorized({ sender: '971501112222@s.whatsapp.net' }), true);
  assert.equal(a.isAuthorized({ sender: '55555@lid', senderAlt: '971501112222@s.whatsapp.net' }), true);
  assert.equal(a.isAuthorized({ sender: '971509999999@s.whatsapp.net' }), false);
  assert.equal(a.isAuthorized({ sender: '55555@lid' }), false);
  assert.deepEqual(new AuthStore(dir).numbers(), ['971501112222', '971503334444']); // kept on disk
  assert.equal(a.remove('971501112222'), true);
  assert.equal(a.remove('971501112222'), false);
  assert.equal(new AuthStore(dir).isAuthorized({ sender: '971501112222@s.whatsapp.net' }), false);
});

test('an authorized person\'s statement goes to that private chat only; the test-group "all" stays the owner\'s', async () => {
  const t = mk();
  const x = await t.desk.statementOne('Orion Furniture', '971501112222@s.whatsapp.net');
  assert.equal(x.ok, true);
  assert.deepEqual(t.sent.map((s) => s.jid), ['971501112222@s.whatsapp.net']);
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  const flow = index.slice(index.indexOf('async function authorizedFlow'), index.indexOf("const taught = new TaughtStore"));
  assert.ok(flow.includes("qc?.type === 'statement'") && !flow.includes("'all'") && !flow.includes('.decide(') && !flow.includes('setPaused') && !flow.includes('qboAuth.add')); // nothing else is within reach
  assert.ok(flow.includes('qboInvoices.request(') && flow.includes('qboChats.add(chatId)'));
});

test('the wiring: the owner\'s yes is taken only in his own chat; the guard knows the authorized chats; the invoice commands are owner-only', () => {
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal((index.match(/qboInvoices\.decide\(/g) || []).length, 1); // one caller, in the owner's command function
  const block = index.slice(index.indexOf("The owner's invoice commands (his own chat, owner only)"), index.indexOf('"وضعیت سفارش‌ها" (his own chat'));
  assert.ok(block.includes('!group && isSelf') && block.includes('isOwnerCommand(') && block.includes('qboInvoiceCommand('));
  assert.match(index, /known: \{ has: \(j\) => staffChats\.has\(j\) \|\| qboChats\.has\(j\) \}/);
  assert.match(index, /qboAuth\.isAuthorized\(who, info\.lidToPhone\) && \(await authorizedFlow\(/);
  const flow = index.slice(index.indexOf('async function authorizedFlow'), index.indexOf("const taught = new TaughtStore"));
  assert.ok(!/orion|customerGroups|shadowGroup/i.test(flow) && !flow.includes('@g.us')); // it never addresses a group
  // the startup script and the example file know the tax setting
  const root = path.join(import.meta.dirname, '..');
  assert.ok(fs.readFileSync(path.join(root, 'deploy', 'gcp-startup.sh'), 'utf8').includes('QBO_TAX_CODE'));
  assert.ok(fs.readFileSync(path.join(root, '.env.example'), 'utf8').includes('QBO_TAX_CODE'));
});

test('the audit report shows the last ten events with no message text', async () => {
  const t = mk();
  for (let i = 0; i < 12; i++) await t.inv.request({ text: REQ, requester: 'owner' });
  await t.inv.decide({ verb: 'yes', id: 'Q12' });
  const rep = t.inv.auditText(10);
  assert.ok(rep.startsWith('گزارش کوییک‌بوکس') && rep.split('\n').length === 11);
  assert.ok(rep.includes('create') && rep.includes('شمارهٔ 2001') && rep.includes('جمع 29.72'));
  assert.ok(!/Hinge|Edge Tape|فاکتور بساز/.test(rep));
  assert.ok(fs.readFileSync(path.join(t.dir, 'qbo', 'qbo-audit.log'), 'utf8').trim().split('\n').length === 13); // append-only: every preview and the create
});

test('the VAT code is that of THE CUSTOMER: zero-rated customers pay no VAT, an unclear customer gets a GUESSED code with the others as alternatives, the owner\'s choice is kept', async () => {
  const zero = mk({ invoices: [{ Id: '601', Line: [invLine('12'), invLine('12')] }] });
  const r = await zero.inv.request({ text: REQ, requester: 'owner' });
  assert.ok(r.owner.includes('مالیات: Zero rated 0٪ (از ۲ سطر از ۲ سطر فاکتورهای قبلی): 0.00') && r.owner.includes('جمع کل: 28.30 AED'));
  assert.equal(zero.store.get('Q1').tax.id, '12');
  await zero.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.deepEqual(zero.m.posts[0].body.Line.map((l) => l.SalesItemLineDetail.TaxCodeRef.value), ['12', '12']);
  // the lines disagree: the code used most is proposed as a guess, the other one is an alternative
  const mixed = mk({ invoices: [{ Id: '602', Line: [invLine('11'), invLine('12')] }] });
  const guess = await mixed.inv.request({ text: REQ, requester: 'owner' });
  assert.ok(guess.owner.includes('مالیات حدس است') && guess.owner.includes('«مالیات ۱»'));
  assert.equal(mixed.store.get('Q1').tax.source, 'guess');
  // «مالیات ۱» takes the alternative and rebuilds the same preview
  const changed = (await mixed.inv.adjust({ what: 'tax', pick: 1 })).join('');
  assert.ok(changed.includes('پیش‌نمایش فاکتور #Q1'));
  assert.equal(mixed.store.get('Q1').tax.source, 'chosen'); assert.equal(mixed.store.d.n, 1);
  // no invoice lines at all: the only 5% code is proposed
  const none = mk({ invoices: [{ Id: '603', Line: [] }] });
  const nr = await none.inv.request({ text: REQ, requester: 'owner' });
  assert.ok(nr.owner.includes('مالیات حدس است') && nr.owner.includes('تنها کد ۵٪'));
  // an authorized person gets the same flow: his request is told as sent, and the OWNER gets the preview with the guess
  const auth = mk({ invoices: [{ Id: '604', Line: [invLine('11'), invLine('12')] }] });
  const ar = await auth.inv.request({ text: REQ, requester: '971501112222' });
  assert.ok(ar.requester.includes('#Q1') && ar.owner.includes('971501112222') && ar.owner.includes('مالیات حدس است'));
  // the owner chooses a code for good; it is stored on the VM by QuickBooks customer id and used from then on
  const fixed = mk({ invoices: [{ Id: '602', Line: [invLine('11'), invLine('12')] }] });
  assert.ok((await fixed.inv.setTaxChoice({ customer: 'Orion Furniture', code: 'zero rated' })).join('').includes('Zero rated'));
  assert.deepEqual(fixed.inv.taxChoices.get('58').codeId, '12');
  assert.equal(new TaxChoices(path.join(fixed.dir, 'qbo')).get('58').name, 'Zero rated');
  const after = await fixed.inv.request({ text: REQ, requester: 'owner' });
  assert.ok(after.owner.includes('مالیات 0٪ (Zero rated، انتخاب مالک)') && !after.owner.includes('مالیات حدس'));
  // a code that does not exist, a customer that is not exact
  assert.ok((await fixed.inv.setTaxChoice({ customer: 'Orion Furniture', code: 'Nope' })).join('').includes('کدهای موجود'));
  assert.ok((await fixed.inv.setTaxChoice({ customer: 'Orion Furnitur', code: '5% S' })).join('').includes('معرفی شود'));
  assert.ok((await fixed.inv.taxListText()).join('').includes('5% S — 5٪') && (await fixed.inv.taxListText()).join('').includes('Zero rated — 0٪'));
  // the setting stays as an owner override over everything
  const over = mk({ invoices: [{ Id: '605', Line: [invLine('11')] }], config: { qboTaxCode: 'Zero rated' } });
  assert.ok((await over.inv.request({ text: REQ, requester: 'owner' })).owner.includes('Zero rated'));
});

// ------------------------------------------------------------------------------------------------ the owner's real first request
const OWNER_MESSAGE = 'اتوسا فاکتور بساز مشتری برای / Ar-rad / Code 108 / 32.5m / 12 aed / Code 105 / 14.5m / 12aed / Code 1810 / 5m / 8aed';
const ARRAD = { Id: '70', DisplayName: 'AR-RAD INTERNATIONAL FOR TRADE AND INVESTMENT LLC', Balance: 0 };
const REAL_ITEMS = [
  { Id: '31', Name: '108', Sku: '108', UnitPrice: 12.5, Active: true }, { Id: '32', Name: '105', Sku: '105', UnitPrice: 12.5, Active: true },
  { Id: '33', Name: '1810 edge banding', Sku: '', UnitPrice: 4.5, Active: true }, { Id: '34', Name: 'B 1810', Sku: 'B1810', UnitPrice: 5, Active: true }, { Id: '35', Name: 'PVC 1810', Sku: 'P1810', UnitPrice: 8.5, Active: true },
];
const EXTRACTED = { customer: 'Ar-rad', lines: [{ item: '108', qty: 32.5, price: 12 }, { item: '105', qty: 14.5, price: 12 }, { item: '1810', qty: 5, price: 8 }], unsure: [] };
const hist = (...ids) => [{ Id: '801', Line: [...ids.map((id) => ({ DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: id }, TaxCodeRef: { value: '11' } } }))] }];
const realMk = (extra = {}) => {
  const t = mk({ customers: [ARRAD, ...CUSTOMERS], items: REAL_ITEMS, extract: async () => EXTRACTED, invoices: hist('31'), ...extra });
  t.list.approve('Ar-Rad INTL(IBN AJMI)', 'arrad@g.us', 'Ar-Rad INTL(IBN AJMI)\u2013 ARYAK');
  return t;
};

test('free-form requests go to the invoice flow: any layout, with or without the assistant\'s name; never a question or a send', () => {
  assert.equal(parseInvoiceCommand(OWNER_MESSAGE).type, 'request');
  assert.equal(parseInvoiceCommand(OWNER_MESSAGE).free, undefined); // its first line is read as the strict form, but it has no lines, so it is read by the model
  for (const t of ['فاکتور بزن برای Ar-rad\nکد 108 تعداد 32 قیمت 12', 'اتوسا فاکتور رو بساز: Cedar / 105 / 4m', 'لطفا یک فاکتور صادر کن برای ar-rad', 'create an invoice for Cedar, code 108, 5 m', 'آتوسا فاکتور بساز']) assert.equal(looksLikeInvoiceRequest(t), true, t);
  for (const t of ['فاکتور Cedar را بفرست', 'فاکتور بساز؟', 'send the invoice of Cedar', 'چند فاکتور داریم', 'سلام']) assert.equal(looksLikeInvoiceRequest(t), false, t);
  assert.equal(parseInvoiceCommand('فاکتور بزن برای Cedar\n108, 3').free, true);
  assert.deepEqual(parseInvoiceCommand('کد 1810 = PVC 1810'), { type: 'item_code', code: '1810', item: 'PVC 1810', customer: '' });
  assert.deepEqual(parseInvoiceCommand('کد 1810 = PVC 1810 مشتری Ar-rad'), { type: 'item_code', code: '1810', item: 'PVC 1810', customer: 'Ar-rad' });
  assert.deepEqual(parseInvoiceCommand('کد مالیات Cedar = Zero rated'), { type: 'tax_set', customer: 'Cedar', code: 'Zero rated' }); // the tax command is not taken for an item code
  assert.ok(STAFF_RULES.includes('Making an invoice: you CAN') && STAFF_RULES.includes('Never say you cannot make invoices'));
});

test('the model only EXTRACTS: a strict shape, nothing invented, an unclear request stops with what was understood', async () => {
  const client = (answer) => ({ beta: { messages: { create: async () => ({ content: [{ type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }] }) } } });
  const ok = await extractInvoiceRequest({ client: client(`Here: ${JSON.stringify(EXTRACTED)}`), config: { model: 'm' }, text: OWNER_MESSAGE });
  assert.deepEqual(ok, EXTRACTED);
  assert.equal(await extractInvoiceRequest({ client: client('no json'), config: { model: 'm' }, text: 'x' }), null);
  const v = validateExtraction({ customer: '  ', lines: [{ item: 'A', qty: 2, price: -1 }, { item: null, qty: 3, price: null }, { item: 'B', qty: null, price: 1 }, { item: 'C', qty: '5', price: 1 }, { item: 'D', qty: 1.5, price: 0 }], unsure: ['odd count'] });
  assert.equal(v.customer, null);
  assert.deepEqual(v.lines, [{ item: 'D', qty: 1.5, price: 0 }]); // a bad price, a missing item, a missing or text quantity: none is kept or guessed
  assert.equal(v.unsure.length, 1 + 4);
  const t = realMk({ extract: async () => ({ customer: 'Ar-rad', lines: [{ item: '108', qty: 32.5, price: 12 }], unsure: ['یک عدد بدون کالا'] }) });
  const r = await t.inv.request({ text: OWNER_MESSAGE, requester: 'owner' });
  assert.equal(r.owner, null);
  assert.ok(r.requester.includes('این را فهمیدم') && r.requester.includes('Ar-rad') && r.requester.includes('108 × 32.5 @ 12') && r.requester.includes('مطمئن نیستم') && r.requester.includes('چیزی ساخته نشد'));
  assert.equal(t.store.d.n, 0);
  const none = realMk({ extract: async () => ({ customer: null, lines: [], unsure: [] }) });
  assert.ok((await none.inv.request({ text: OWNER_MESSAGE, requester: 'owner' })).requester.includes('نام مشتری مشخص نیست'));
  const broken = realMk({ extract: async () => { throw new Error('down'); } });
  assert.ok((await broken.inv.request({ text: OWNER_MESSAGE, requester: 'owner' })).requester.includes('درخواست را نفهمیدم'));
  // the strict format needs no model at all
  const strict = realMk();
  await strict.inv.request({ text: 'فاکتور بساز AR-RAD INTERNATIONAL FOR TRADE AND INVESTMENT LLC\n108, 3, 12', requester: 'owner' });
  assert.equal(strict.extractCalls.length, 0);
});

test('the owner\'s exact message: "Ar-rad" is found as the one customer that holds those words; 108 and 105 are shown as what they are; 1810 is settled by what he bought before', async () => {
  const t = realMk({ invoices: hist('31', '35') }); // he bought PVC 1810 before
  const r = await t.inv.request({ text: OWNER_MESSAGE, requester: 'owner' });
  assert.equal(t.extractCalls.length, 1);
  assert.ok(r.owner, r.requester);
  for (const s of ['مشتری: AR-RAD INTERNATIONAL FOR TRADE AND INVESTMENT LLC (از «Ar-rad»)', '108 × 32.5 @ 12 = 390.00', '105 × 14.5 @ 12 = 174.00', 'PVC 1810 [P1810] × 5 @ 8 = 40.00 (از خریدهای قبلی مشتری)', 'جمع قبل از مالیات: 604.00', 'مالیات: 5% S 5٪ (از ۲ سطر از ۲ سطر فاکتورهای قبلی): 30.20', 'جمع کل: 634.20']) assert.ok(r.owner.includes(s), s);
  assert.deepEqual(t.store.get('Q1').customer, { ours: 'Ar-rad', id: '70', name: 'AR-RAD INTERNATIONAL FOR TRADE AND INVESTMENT LLC', from: 'Ar-rad' });
  assert.equal(t.m.posts.length, 0); // the preview creates nothing
  await t.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.deepEqual(t.m.posts[0].body.Line.map((l) => [l.SalesItemLineDetail.ItemRef.value, l.SalesItemLineDetail.Qty, l.SalesItemLineDetail.UnitPrice]), [['31', 32.5, 12], ['32', 14.5, 12], ['35', 5, 8]]);
});

test('a code that fits several items and was never bought: the best candidate is GUESSED, the others are numbered alternatives; the owner picks one or teaches the code once', async () => {
  const t = realMk({ invoices: hist('31') });
  const guess = await t.inv.request({ text: OWNER_MESSAGE, requester: 'owner' });
  assert.ok(guess.owner); // a preview, not a stop
  for (const s of ['حدس', '۱) ', '۲) ', 'قیمت ', '«سطر ۳ = ۱»']) assert.ok(guess.owner.includes(s), s);
  const pv = t.store.get('Q1');
  assert.equal(pv.guesses.lines.length, 1); assert.equal(pv.guesses.lines[0].alts.length, 2); // three candidates: one guessed, two alternatives
  assert.equal(itemsContaining(REAL_ITEMS, '1810').length, 3);
  assert.equal(itemsContaining(REAL_ITEMS, '181').length, 0); // whole words only
  // «سطر ۳ = ۲» takes the second alternative and rebuilds the same preview
  const alt2 = pv.guesses.lines[0].alts[1];
  const rebuilt = (await t.inv.adjust({ what: 'line', n: 3, pick: 2 })).join('');
  assert.ok(rebuilt.includes('پیش‌نمایش فاکتور #Q1') && rebuilt.includes('(انتخاب شما)') && rebuilt.includes(alt2.name));
  assert.equal(t.store.d.n, 1);
  // the yes remembers the chosen item for the typed code: next time it is exact
  await t.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.equal(new ItemCodes(path.join(t.dir, 'qbo')).get('', '1810').itemId, alt2.itemId);
  // he can also teach it for everybody by a command
  assert.ok((await t.inv.setItemCode({ code: '1810', item: 'PVC 1810', customer: '' })).join('').includes('برای همهٔ مشتری‌ها'));
  const again = await t.inv.request({ text: OWNER_MESSAGE, requester: 'owner' });
  assert.ok(again.owner.includes('PVC 1810 [P1810] × 5 @ 8 = 40.00 (کد آموخته‌شدهٔ مالک)') && !again.owner.includes('حدس'));
  assert.equal(new ItemCodes(path.join(t.dir, 'qbo')).get('70', '1810').name, 'PVC 1810'); // kept on the VM
  // taught for one customer only: another customer is not affected
  const one = realMk({ invoices: hist('31') });
  assert.ok((await one.inv.setItemCode({ code: '1810', item: 'B 1810', customer: 'Ar-rad' })).join('').includes('برای مشتری AR-RAD'));
  assert.ok((await one.inv.request({ text: OWNER_MESSAGE, requester: 'owner' })).owner.includes('B 1810 [B1810] × 5 @ 8 = 40.00 (کد آموخته‌شدهٔ مالک)'));
  assert.equal(one.itemCodes.get('59', '1810'), null);
  // errors: a name that is not exactly one item; a customer that is not unique
  assert.ok((await t.inv.setItemCode({ code: '1810', item: 'Nope', customer: '' })).join('').includes('دقیقاً پیدا نشد'));
  assert.ok((await t.inv.setItemCode({ code: '1810', item: '1810', customer: '' })).join('').includes('دقیقاً پیدا نشد')); // "1810" alone is not an item name
});

test('a short customer name: exactly one match is used and shown; several are GUESSED with the others listed; none near stops', async () => {
  const two = realMk({ customers: [ARRAD, { Id: '71', DisplayName: 'Ar Rad Trading', Balance: 0 }, ...CUSTOMERS] });
  const r = await two.inv.request({ text: OWNER_MESSAGE, requester: 'owner' });
  assert.ok(r.owner.includes('(حدس از «Ar-rad»: چند مشتری با این واژه‌ها)'));
  assert.ok(r.owner.includes('۱) ') && /AR-RAD INTERNATIONAL|Ar Rad Trading/.test(r.owner));
  assert.equal(two.store.get('Q1').guesses.customer.alts.length, 1);
  // «مشتری ۱» takes the alternative; the yes remembers it as the customer for «Ar-rad»
  const other = two.store.get('Q1').guesses.customer.alts[0];
  assert.ok((await two.inv.adjust({ what: 'customer', pick: 1 })).join('').includes(other.name));
  await two.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.equal(two.map.get('Ar-rad').id, other.id); assert.equal(two.map.get('Ar-rad').how, 'owner');
  const nobody = realMk({ extract: async () => ({ ...EXTRACTED, customer: 'Zorvan' }) });
  assert.equal((await nobody.inv.request({ text: OWNER_MESSAGE, requester: 'owner' })).owner, null); // nothing is near: it stops
  // a word that is only part of a word is not a match ("rad" is not "radiant"): nothing is exact, the nearest is only a guess
  const part = realMk({ customers: [{ Id: '72', DisplayName: 'RADIANT LIGHTING', Balance: 0 }, ...CUSTOMERS], extract: async () => ({ ...EXTRACTED, customer: 'rad' }) });
  const pr = await part.inv.request({ text: OWNER_MESSAGE, requester: 'owner' });
  assert.ok(pr.owner === null || pr.owner.includes('(حدس از «rad»'));
  // and an authorized person gets the same flow: the preview goes to the owner
  const auth = realMk({ invoices: hist('31', '35') });
  const ar = await auth.inv.request({ text: OWNER_MESSAGE, requester: '971501112222' });
  assert.ok(ar.requester.includes('#Q1') && ar.owner.includes('شمارهٔ 971501112222') && ar.owner.includes('(از «Ar-rad»)'));
})

test('the tax code is the clear majority of the recent lines (at least 90%) AND the code of the most recent invoice; otherwise the owner is asked', () => {
  const codes = taxCodeMap(TAXCODES, TAXRATES);
  const inv = (...ids) => ({ Line: ids.map(invLine) });
  const many = (n, id) => Array.from({ length: n }, () => id);
  // 34 of 35 lines are 11, the newest invoice is 11: the owner's real case
  const r = codeFromInvoices([inv(...many(5, '11')), inv(...many(29, '11'), '12')], codes);
  assert.equal(r.code.id, '11');
  assert.deepEqual([r.n, r.total], [34, 35]);
  assert.deepEqual(r.found.map((f) => [f.name, f.n]), [['5% S', 34], ['Zero rated', 1]]);
  // the lone odd line is in the NEWEST invoice, but that invoice is still mostly 11: fine
  assert.equal(codeFromInvoices([inv(...many(4, '11'), '12'), inv(...many(30, '11'))], codes).code.id, '11');
  // under 90% (31 of 35): stop
  assert.equal(codeFromInvoices([inv(...many(31, '11')), inv(...many(4, '12'))], codes).error, 'disagree');
  // 34 of 35 but the newest invoice is the other code: the customer changed, stop
  assert.equal(codeFromInvoices([inv('12'), inv(...many(34, '11'))], codes).error, 'disagree');
  // the newest invoice without tax lines is skipped for that test
  assert.equal(codeFromInvoices([{ Line: [{ DetailType: 'SubTotalLineDetail' }] }, inv(...many(10, '11'))], codes).code.id, '11');
  // a tie inside the newest invoice is no clear code
  assert.equal(codeFromInvoices([inv('11', '12'), inv(...many(40, '11'))], codes).error, 'disagree');
  assert.equal(codeFromInvoices([inv(...many(10, '99'))], codes).error, 'unknown');
});

test('every unsure field is GUESSED in ONE preview (customer, item, tax) with alternatives; the minority tax lines are mentioned; a stop only for nothing to guess from', async () => {
  const t = mk({ invoices: [{ Id: '701', Line: [...Array.from({ length: 29 }, () => invLine('11')), invLine('12')] }, { Id: '702', Line: Array.from({ length: 5 }, () => invLine('11')) }] });
  const r = await t.inv.request({ text: REQ, requester: 'owner' });
  assert.ok(r.owner.includes('مالیات: 5% S 5٪ (از ۳۴ سطر از ۳۵ سطر فاکتورهای قبلی)'));
  assert.ok(r.owner.includes('در فاکتورهای قبلی این مشتری چند سطر کد دیگری داشت: Zero rated (1 سطر)'));
  assert.equal(t.store.get('Q1').tax.n, 34);
  // an unsure customer, an unsure item and an unclear tax code: one preview with the three guesses
  const bad = mk({ invoices: [{ Id: '703', Line: [invLine('11'), invLine('12')] }] });
  const all = await bad.inv.request({ text: 'فاکتور بساز Orion Furnitur\nHinge 35, 2, 3\nH35, 1', requester: 'owner' });
  assert.ok(all.owner);
  for (const s of ['مشتری: Orion Furniture (حدس از «Orion Furnitur»', 'حدس: ', 'مالیات حدس است', '🔶']) assert.ok(all.owner.includes(s), s);
  const g = bad.store.get('Q1').guesses;
  assert.ok(g.customer && g.lines.length >= 1 && g.tax);
  assert.equal(bad.m.posts.length, 0); // nothing is applied before the yes
  // an item that is nowhere near stops; a known customer with it too
  const two = mk({ invoices: [{ Id: '704', Line: [invLine('11'), invLine('12')] }] });
  const stop = await two.inv.request({ text: 'فاکتور بساز Orion Furniture\nZzzzz Qqqqq, 2, 3', requester: 'owner' });
  assert.equal(stop.owner, null); assert.ok(stop.requester.includes('کالاها:') && stop.requester.includes('Zzzzz Qqqqq'));
  // an authorized person: the request is told as sent, the owner gets the preview with the guesses
  const auth = mk({ invoices: [{ Id: '705', Line: [invLine('11'), invLine('12')] }] });
  const ar = await auth.inv.request({ text: 'فاکتور بساز Orion Furniture\nH35, 2, 3', requester: '971501112222' });
  assert.ok(ar.requester.includes('#Q1') && ar.owner.includes('971501112222') && ar.owner.includes('مالیات حدس است'));
});

test('when the company numbers invoices by hand: the next number of the office\'s own pattern is in the preview, checked again before the create, and an invoice is never made without one', async () => {
  const t = mk({ customTxn: true, docNumbers: ['inv-8996', 'inv-8973', 'inv-8956'] });
  const r = await t.inv.request({ text: REQ, requester: 'owner' });
  assert.ok(r.owner.includes('شمارهٔ فاکتور: inv-8997'), r.requester);
  assert.equal(t.store.get('Q1').docNumber, 'inv-8997');
  // a second preview waiting takes the next one, not the same
  const r2 = await t.inv.request({ text: REQ, requester: 'owner' });
  assert.ok(r2.owner.includes('شمارهٔ فاکتور: inv-8998'));
  // the create carries it
  const out = (await t.inv.decide({ verb: 'yes', id: 'Q1' })).join('\n');
  assert.equal(t.m.posts[0].body.DocNumber, 'inv-8997');
  assert.ok(out.includes('inv-8997') && !out.includes('بی‌شماره'));
  // the line description, the terms and the e-mail of the customer
  assert.deepEqual(t.m.posts[0].body.Line.map((l) => l.Description), ['35 mm soft-close hinge', undefined]); // only where QuickBooks has one
  assert.deepEqual([t.m.posts[0].body.SalesTermRef, t.m.posts[0].body.BillEmail], [{ value: '3' }, { Address: 'office@orion.test' }]);
});

test('hand numbering: a number taken before the yes is renumbered and nothing is created; an unreadable pattern stops; auto-numbering companies get no DocNumber', async () => {
  const docNumbers = ['inv-8996'];
  const t = mk({ customTxn: true, docNumbers });
  await t.inv.request({ text: REQ, requester: 'owner' });
  assert.equal(t.store.get('Q1').docNumber, 'inv-8997');
  docNumbers.unshift('inv-8997'); // the office typed that number by hand in the meantime
  const again = (await t.inv.decide({ verb: 'yes', id: 'Q1' })).join('\n');
  assert.ok(again.includes('inv-8997') && again.includes('inv-8998') && again.includes('دوباره «بله #Q1»'));
  assert.equal(t.m.posts.length, 0);
  assert.equal(t.store.get('Q1').docNumber, 'inv-8998');
  assert.equal(t.store.get('Q1').status, 'pending');
  assert.ok(t.audit.last(3).some((x) => x.event === 'renumber'));
  assert.ok((await t.inv.decide({ verb: 'yes', id: 'Q1' })).join('').includes('ساخته شد'));
  assert.equal(t.m.posts[0].body.DocNumber, 'inv-8998');
  // leading zeros keep their width; another prefix of the office is not mixed in
  const z = mk({ customTxn: true, docNumbers: ['INV-0099', 'CN-500', 'INV-0098'] });
  assert.ok((await z.inv.request({ text: REQ, requester: 'owner' })).owner.includes('شمارهٔ فاکتور: INV-0100'));
  // the pattern cannot be read: no preview, the stop says so (together with the other stops)
  const none = mk({ customTxn: true, docNumbers: [] });
  const stop = await none.inv.request({ text: REQ, requester: 'owner' });
  assert.equal(stop.owner, null);
  assert.ok(stop.requester.includes('شمارهٔ فاکتور:') && stop.requester.includes('الگوی شمارهٔ فاکتورهای دفتر'));
  assert.equal(none.store.d.n, 0);
  // a company that numbers by itself: no DocNumber is sent
  const auto = mk({ customTxn: false });
  const ar = await auto.inv.request({ text: REQ, requester: 'owner' });
  assert.ok(!ar.owner.includes('شمارهٔ فاکتور:'));
  await auto.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.equal('DocNumber' in auto.m.posts[0].body, false);
  // a preview made while hand numbering was on but without a number is refused at the yes
  const odd = mk({ customTxn: false });
  await odd.inv.request({ text: REQ, requester: 'owner' });
  odd.store.get('Q1').customTxn = true;
  assert.ok((await odd.inv.decide({ verb: 'yes', id: 'Q1' })).join('').includes('شماره ندارد'));
  assert.equal(odd.m.posts.length, 0);
});

// ------------------------------------------------------------------------------------------------ "فاکتور کن … برای من بفرست" is an invoice to CREATE, not a send
const GLUE_MESSAGE = 'آتوسا برای شرکت Mice Interiors Decoration LLC\nدو تا گالن ۲۵ کیلویی GLUE JOWAT به قیمت هر عدد ۱۵۰۰ درهم فاکتور کن برای من بفرست';

test('the owner\'s exact message is an invoice to create; «برای من بفرست» only means show me the preview; sending is for an invoice that exists', () => {
  const ic = parseInvoiceCommand(GLUE_MESSAGE);
  assert.equal(ic.type, 'request'); assert.equal(ic.free, true);
  for (const t of ['فاکتور کن برای Cedar، دو تا Hinge 35mm، برای من بفرست', 'برای Cedar ده عدد 108 فاکتور بزن بفرست برام', 'آتوسا صادر کن فاکتور Cedar 108 سه تا بفرست برای من', 'فاکتورش کن و برای من بفرست: Cedar، H35 4']) assert.equal(looksLikeInvoiceRequest(t), true, t);
  // an existing invoice sent to a group is the other flow
  for (const t of ['فاکتور 8996 را به گروه Cedar بفرست', 'فاکتور Cedar را بفرست', 'send the invoice of Cedar to the group', 'فاکتور بساز؟']) assert.equal(looksLikeInvoiceRequest(t), false, t);
  assert.notEqual(parseInvoiceCommand('فاکتور 8996 را به گروه Cedar بفرست')?.type, 'request');
});

test('in the program the invoice commands are read before the send-to-customer flow', () => {
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const make = src.indexOf('parseInvoiceCommand(text)');
  const send = src.indexOf('parseSendCommand(text)');
  assert.ok(make > 0 && send > 0 && make < send, 'the invoice request is taken before the send flow can grab the message');
});

test('the extraction is told about words for quantity, packaging, an item by name and a price in words', async () => {
  const prompts = [];
  const client = { beta: { messages: { create: async (p) => { prompts.push(p.system); return { content: [{ type: 'text', text: JSON.stringify({ customer: 'Mice Interiors Decoration LLC', lines: [{ item: 'GLUE JOWAT', qty: 2, price: 1500 }], unsure: [] }) }] }; } } } };
  const got = await extractInvoiceRequest({ client, config: { model: 'm' }, text: GLUE_MESSAGE });
  assert.deepEqual(got, { customer: 'Mice Interiors Decoration LLC', lines: [{ item: 'GLUE JOWAT', qty: 2, price: 1500 }], unsure: [] });
  for (const needle of ['دو تا', 'گالن ۲۵ کیلویی', 'NOT the product', 'by NAME', 'به قیمت هر عدد', 'فاکتور کن']) assert.ok(prompts[0].includes(needle), needle);
});

test('item by name in any word order, price per piece, the customer GUESSED from the nearest names; nothing is created and nothing is applied before the yes', async () => {
  const items = [{ Id: '41', Name: 'JOWAT PVC GLUE', Sku: 'JOWAT-25', UnitPrice: 1400, Type: 'Inventory', Active: true, Description: 'Jowat glue 25 kg' }, { Id: '42', Name: 'Hinge 35mm', Sku: 'H35', UnitPrice: 2.5, Type: 'Inventory', Active: true }];
  const extracted = { customer: 'Mice Interiors Decoration LLC', lines: [{ item: 'GLUE JOWAT', qty: 2, price: 1500 }], unsure: [] };
  // the customer is not exact: the nearest is the guess and the others are alternatives; no customer is made, no invoice
  const t = mk({ customers: [{ Id: '80', DisplayName: 'MICE INTERIORS', Balance: 0 }, { Id: '81', DisplayName: 'MICE DECOR LLC', Balance: 0 }, ...CUSTOMERS], items, extract: async () => extracted, invoices: [] });
  const r = await t.inv.request({ text: GLUE_MESSAGE, requester: 'owner' });
  const text = r.owner || r.requester;
  assert.ok(text.includes('JOWAT PVC GLUE')); // the QuickBooks name of the item, found from "GLUE JOWAT"
  assert.ok(/MICE/.test(text) && text.includes('حدس از «Mice Interiors Decoration LLC»'));
  assert.equal(t.m.posts.length, 0);
  assert.ok(!t.m.calls.some((c) => c.method === 'POST' && /customer/.test(c.url)));
  // the customer exists (any case, L.L.C): used and not a guess; the preview has 2 x 1500 on the QuickBooks item
  const ok = mk({ customers: [{ Id: '80', DisplayName: 'MICE INTERIORS DECORATION L.L.C', Balance: 0 }, ...CUSTOMERS], items, extract: async () => extracted, invoices: [{ Id: '801', CustomerRef: { value: '80' }, Line: [{ DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '41' }, TaxCodeRef: { value: '11' } } }] }] });
  const r2 = await ok.inv.request({ text: GLUE_MESSAGE, requester: 'owner' });
  const text2 = r2.owner || r2.requester;
  assert.ok(text2.includes('JOWAT PVC GLUE') && /@ 1500/.test(text2));
  assert.ok(text2.includes('مشتری: MICE INTERIORS DECORATION L.L.C') && !text2.includes('(حدس از «Mice'));
  assert.equal(ok.m.posts.length, 0); // a preview only: the owner's yes makes the invoice
});

test('the invoice-send questions speak Persian to the owner and English by default; names and amounts stay as printed', async () => {
  const { confirmText, chooseText, confirmTextFa } = await import('../src/invoicesend.js');
  const read = { number: 'INV-8996', customer: 'ACME LLC', total: 157.5, checked: true, urgent: 0, orderState: 'none' };
  const fa = confirmText({ read, fileName: 'INV-8996 ACME.pdf', group: 'ACME - ARYAK', alreadySent: '', lang: 'fa' });
  assert.equal(fa, confirmTextFa({ read, fileName: 'INV-8996 ACME.pdf', group: 'ACME - ARYAK', alreadySent: '' }));
  assert.match(fa, /فرستاده شود\؟ بله \/ نه/); assert.match(fa, /جمع با مالیات: AED 157\.50/); assert.match(fa, /گروه: ACME - ARYAK/);
  assert.doesNotMatch(fa, /Send\?|Group:|Total with VAT/);
  assert.match(confirmText({ read, fileName: 'f', group: 'g', alreadySent: '' }), /Send\? yes \/ no/); // the default is unchanged
  assert.match(chooseText([{ subject: 'A' }, { subject: 'B' }], 'fa'), /^کدام گروه؟ شماره را بنویسید:\n1\) A\n2\) B/);
  assert.match(chooseText([{ subject: 'A' }]), /^Which group\? Reply with the number:/);
  const warn = confirmText({ read: { ...read, urgent: 2, points: ['x', 'y'], checked: false }, fileName: 'f', group: 'g', alreadySent: 'پیش‌تر', unconfirmed: true, lang: 'fa' });
  assert.match(warn, /این گروه در فهرست تأیید نشده/); assert.match(warn, /بررسی نشده/); assert.match(warn, /۲ ایراد فوری/);
});

test('one item found by a name in any word order is used and shown; two are asked; the owner\'s price stays with a note beside the QuickBooks price', async () => {
  const one = [{ Id: '41', Name: 'JOWAT PVC GLUE', Sku: 'JOWAT-25', UnitPrice: 1100, Type: 'Inventory', Active: true }, { Id: '42', Name: 'Hinge 35mm', Sku: 'H35', UnitPrice: 2.5, Type: 'Inventory', Active: true }];
  const ctx = { items: one };
  const { pickItem } = await import('../src/qboinvoice.js');
  assert.deepEqual([pickItem('GLUE JOWAT', ctx).item?.Id, pickItem('GLUE JOWAT', ctx).via], ['41', 'name']);
  assert.equal(pickItem('jowat glue', ctx).item?.Id, '41');
  // two candidates: asked, not guessed
  const two = [...one, { Id: '43', Name: 'JOWAT HOTMELT GLUE', Sku: 'JOWAT-H', UnitPrice: 900, Type: 'Inventory', Active: true }];
  const r = pickItem('GLUE JOWAT', { items: two });
  assert.equal(r.item, undefined); assert.match(r.stop(1), /JOWAT PVC GLUE[\s\S]*JOWAT HOTMELT GLUE|JOWAT HOTMELT GLUE[\s\S]*JOWAT PVC GLUE/);
  // a single word is still not guessed from a longer name
  assert.equal(pickItem('Hinge', { items: [{ Id: '9', Name: 'Hinge Soft Close', Type: 'Inventory', Active: true }] }).item, undefined);
  // the preview: the QuickBooks item named, the owner's price 1500 kept, the QuickBooks price 1100 beside it, no stop
  const extracted = { customer: 'Mice Interiors Decoration LLC', lines: [{ item: 'GLUE JOWAT', qty: 2, price: 1500 }], unsure: [] };
  const t = mk({ customers: [{ Id: '80', DisplayName: 'MICE INTERIORS DECORATION LLC', Balance: 0 }, ...CUSTOMERS], items: one, extract: async () => extracted, invoices: [{ Id: '801', CustomerRef: { value: '80' }, Line: [{ DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '41' }, TaxCodeRef: { value: '11' } } }] }] });
  const res = await t.inv.request({ text: GLUE_MESSAGE, requester: 'owner' });
  const text = res.owner || res.requester;
  assert.ok(text.includes('JOWAT PVC GLUE')); assert.ok(text.includes('«GLUE JOWAT» را همین کالا گرفتم'));
  assert.ok(text.includes('قیمت شما 1500 است و قیمت کوییک‌بوکس 1100؛ قیمت شما می‌ماند'));
  assert.ok(text.includes('@ 1500'));
  assert.equal(t.m.posts.length, 0); assert.equal(t.store.d.n, 1); // a preview, not an invoice
});

test('the customer not found: the nearest among ALL customers (inactive too, LLC and L.L.C ignored) is the guess and the others are alternatives; none near says so plainly and suggests creating it', async () => {
  const items = [{ Id: '41', Name: 'JOWAT PVC GLUE', Sku: 'J', UnitPrice: 1100, Type: 'Inventory', Active: true }];
  const extracted = { customer: 'Mice Interiors Decoration LLC', lines: [{ item: 'GLUE JOWAT', qty: 2, price: 1500 }], unsure: [] };
  const near = mk({ customers: [{ Id: '90', DisplayName: 'MICE INTERIOR & DECOR L.L.C', Balance: 0, Active: false }, { Id: '91', DisplayName: 'INTERIORS PLUS', Balance: 0 }, { Id: '92', DisplayName: 'DECORATION HOUSE', Balance: 0 }, { Id: '93', DisplayName: 'ZED TRADING', Balance: 0 }], items, extract: async () => extracted, invoices: [] });
  const r = await near.inv.request({ text: GLUE_MESSAGE, requester: 'owner' });
  assert.ok(r.owner);
  assert.match(r.owner, /مشتری: MICE INTERIOR & DECOR L\.L\.C \(غیرفعال\)|مشتری: MICE INTERIOR & DECOR L\.L\.C/);
  assert.ok(!r.owner.includes('ZED TRADING'));
  assert.equal(near.m.posts.length, 0);
  const none = mk({ customers: [{ Id: '93', DisplayName: 'ZED TRADING', Balance: 0 }], items, extract: async () => extracted, invoices: [] });
  const r2 = await none.inv.request({ text: GLUE_MESSAGE, requester: 'owner' });
  assert.equal(r2.owner, null);
  assert.match(r2.requester, /خودتان در کوییک‌بوکس بسازید \(من مشتری نمی‌سازم\)/);
  assert.ok(!none.m.calls.some((c) => c.method === 'POST' && /customer/.test(c.url)));
});

test('the owner\'s Mice Interiors message: a preview with the customer GUESSED and the item GUESSED, 1500 beside the QuickBooks 1100; the yes applies and remembers both', async () => {
  const items = [{ Id: '41', Name: 'JOWAT PVC GLUE', Sku: 'JOWAT-25', UnitPrice: 1100, Type: 'Inventory', Active: true }, { Id: '43', Name: 'JOWAT PVC GLUE 5KG', Sku: 'JOWAT-5', UnitPrice: 300, Type: 'Inventory', Active: true }];
  const extracted = { customer: 'Mice Interiors Decoration LLC', lines: [{ item: 'GLUE JOWAT', qty: 2, price: 1500 }], unsure: [] };
  const hist41 = [{ Id: '801', CustomerRef: { value: '90' }, Line: [{ DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '99' }, TaxCodeRef: { value: '11' } } }] }];
  const t = mk({ customers: [{ Id: '90', DisplayName: 'MICE INTERIOR & DECOR L.L.C', Balance: 0 }, ...CUSTOMERS], items, extract: async () => extracted, invoices: hist41 });
  const r = await t.inv.request({ text: GLUE_MESSAGE, requester: 'owner' });
  assert.ok(r.owner, r.requester);
  for (const s of ['مشتری: MICE INTERIOR & DECOR L.L.C (حدس از «Mice Interiors Decoration LLC»', '«GLUE JOWAT» ← JOWAT PVC GLUE', '(حدس: ', '× 2 @ 1500', '۱) JOWAT PVC GLUE 5KG', '«سطر ۱ = ۱»', 'قیمت شما 1500 است و قیمت کوییک‌بوکس 1100', '🔶', 'بله #Q1']) assert.ok(r.owner.includes(s), s);
  assert.equal(t.m.posts.length, 0); assert.equal(t.store.d.n, 1);
  // the owner changes one guess by number: the same preview is rebuilt and shown again
  const re = (await t.inv.adjust({ what: 'line', n: 1, pick: 1 })).join('');
  assert.ok(re.includes('JOWAT PVC GLUE 5KG') && re.includes('(انتخاب شما)') && re.includes('پیش‌نمایش فاکتور #Q1'));
  assert.equal(t.store.d.n, 1); assert.equal(t.m.posts.length, 0);
  // only his yes creates; then both guesses are remembered as exact
  await t.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.equal(t.m.posts.length, 1);
  assert.equal(t.m.posts[0].body.CustomerRef.value, '90'); assert.equal(t.m.posts[0].body.Line[0].SalesItemLineDetail.ItemRef.value, '43');
  assert.deepEqual([t.map.get('Mice Interiors Decoration LLC').id, t.map.get('Mice Interiors Decoration LLC').how], ['90', 'owner']);
  assert.equal(t.itemCodes.get('', 'GLUE JOWAT').itemId, '43');
  // the next time the same words are exact: no guess marks
  const again = await t.inv.request({ text: GLUE_MESSAGE, requester: 'owner' });
  assert.ok(again.owner && !again.owner.includes('(حدس') && !again.owner.includes('🔶'));
  // the words of the adjustments
  assert.deepEqual(parseInvoiceCommand('مشتری ۲'), { type: 'adjust', what: 'customer', pick: 2, id: '' });
  assert.deepEqual(parseInvoiceCommand('سطر ۱ = ۳'), { type: 'adjust', what: 'line', n: 1, pick: 3, id: '' });
  assert.deepEqual(parseInvoiceCommand('مالیات ۲ #Q4'), { type: 'adjust', what: 'tax', pick: 2, id: 'Q4' });
  assert.deepEqual((await t.inv.adjust({ what: 'tax', pick: 1, id: 'Q9' })), ['پیش‌نمایشی با حدس باز نیست که چیزی در آن عوض شود.']);
});

// ------------------------------------------------------------------------------------------------ several customers in one message
const MULTI = 'اتوسا فاکتور میخوام برای مشتری های زیر\nAL EBDA\n۲۱۵ =۹۷ متر\nNUQOOSH\n۲۲۰ =۱۲ متر';
const MULTI_ITEMS = [{ Id: '51', Name: 'PVC FILM215', Sku: 'PVC-215', UnitPrice: 14, Type: 'Inventory', Active: true }, { Id: '52', Name: 'PVC FILM220', Sku: 'PVC-220', UnitPrice: 16, Type: 'Inventory', Active: true }];
const MULTI_CUSTOMERS = [{ Id: '81', DisplayName: 'AL EBDA AL MALKI KITCHEN', Balance: 0 }, { Id: '82', DisplayName: 'NUQOOSH IND . LLC', Balance: 0 }];
const histFor = (customerId) => [{ Id: `h${customerId}`, CustomerRef: { value: customerId }, Line: [{ DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '51' }, TaxCodeRef: { value: '11' } } }] }];

test('«فاکتور میخوام …» in every spelling is an invoice to create, never the stock flow', () => {
  assert.equal(parseInvoiceCommand(MULTI).type, 'request');
  for (const t of ['فاکتور می‌خواهم برای Cedar', 'فاکتور میخوام برای Cedar', 'آتوسا فاکتور می‌خوام برای Cedar', 'اتوسا فاکتور لازم دارم برای Cedar', 'فاکتور بده برای Cedar', 'می‌خواهم یک فاکتور برای Cedar']) assert.equal(looksLikeInvoiceRequest(t), true, t);
  for (const t of ['فاکتور 8996 را بفرست', 'فاکتور Cedar را بفرست', 'چند فاکتور داریم', 'موجودی 215']) assert.equal(looksLikeInvoiceRequest(t), false, t);
});

test('the lines «۲۱۵ =۹۷ متر» under a customer name are read without a model: code, quantity, unit; customers start blocks', () => {
  assert.deepEqual(parseInvoiceBlocks(MULTI), [{ customer: 'AL EBDA', lines: [{ code: '215', qty: 97, unit: 'm' }] }, { customer: 'NUQOOSH', lines: [{ code: '220', qty: 12, unit: 'm' }] }]);
  assert.deepEqual(parseInvoiceBlocks('فاکتور بده\nCedar\n108 = 3.5 رول\nH35: 4 عدد\nOrion\nET-W = 2')[0].lines, [{ code: '108', qty: 3.5, unit: 'roll' }, { code: 'H35', qty: 4, unit: 'pcs' }]);
  assert.equal(parseInvoiceBlocks('سلام\nCedar\n108 = 3'), null); // not an invoice request
  assert.equal(parseInvoiceBlocks('فاکتور بده\n108 = 3\nCedar'), null); // a line before any customer
  assert.equal(parseInvoiceBlocks('فاکتور بده\nCedar\nOrion\n108 = 3'), null); // a customer without lines
});

test('the owner\'s exact message: two customers, two previews, the codes and quantities read, stock beside the line, no model, nobody told; «بله همه» approves both', async () => {
  const stockAsked = [];
  const t = mk({ customers: [...MULTI_CUSTOMERS, ...CUSTOMERS], items: MULTI_ITEMS, invoices: [...histFor('81'), ...histFor('82')], extract: async () => { throw new Error('the model must not be needed'); } });
  t.inv.stockOf = async (code) => { stockAsked.push(code); return code === '215' ? { free: 27.8, unit: 'm' } : { free: 400, unit: 'm' }; };
  const r = await t.inv.request({ text: MULTI, requester: 'owner' });
  assert.ok(r.owner);
  assert.equal(t.extractCalls.length, 0);
  assert.equal(t.store.d.n, 2);
  for (const s of ['پیش‌نمایش فاکتور #Q1', 'پیش‌نمایش فاکتور #Q2', 'مشتری: AL EBDA AL MALKI KITCHEN (از «AL EBDA»)', 'مشتری: NUQOOSH IND . LLC (از «NUQOOSH»)', 'PVC FILM215', '× 97 @ 14', 'PVC FILM220', '× 12 @ 16', 'موجودی از شیت زیناکس — کد ۲۱۵: آزاد ۲۷٫۸ متر، کمتر از ۹۷', 'بله #Q1', 'بله #Q2', '«بله همه»']) assert.ok(r.owner.includes(s), s);
  assert.ok(!r.owner.includes('موجودی از شیت زیناکس — کد ۲۲۰')); // 400 is enough: no warning
  assert.deepEqual(stockAsked.sort(), ['215', '220']);
  assert.equal(t.m.posts.length, 0); // two previews, no invoice
  assert.equal(t.store.get('Q1').batch, t.store.get('Q2').batch);
  assert.deepEqual(parseInvoiceCommand('بله همه'), { type: 'yes_all' }); assert.deepEqual(parseInvoiceCommand('نه همه'), { type: 'no_all' });
  const done = (await t.inv.decideAll({ verb: 'yes' })).join('\n');
  assert.equal(t.m.posts.length, 2);
  assert.deepEqual(t.m.posts.map((p) => p.body.CustomerRef.value).sort(), ['81', '82']);
  assert.ok(done.includes('Q1') || done.length > 0);
  assert.equal(t.store.get('Q1').status, 'created'); assert.equal(t.store.get('Q2').status, 'created');
});

test('two similar names are two customers and two previews, never merged; «نه همه» cancels all; an unsure block does not stop the others', async () => {
  const t = mk({ customers: [...MULTI_CUSTOMERS, ...CUSTOMERS], items: MULTI_ITEMS, invoices: [...histFor('81'), ...histFor('82')] });
  const r = await t.inv.request({ text: MULTI, requester: 'owner' });
  assert.equal(t.store.d.n, 2);
  assert.deepEqual([t.store.get('Q1').customer.id, t.store.get('Q2').customer.id], ['81', '82']); // AL EBDA and NUQOOSH: separate balances, separate invoices
  assert.ok(!r.owner.includes('یک مشتری هستند'));
  assert.ok(r.owner.includes('«بله همه»'));
  // a block with nothing near stops alone; the other one is made
  const mixed = mk({ customers: [...MULTI_CUSTOMERS, ...CUSTOMERS], items: MULTI_ITEMS, invoices: histFor('81') });
  const m = await mixed.inv.request({ text: 'اتوسا فاکتور میخوام برای مشتری های زیر\nAL EBDA AL MALKI KITCHEN\n۲۱۵ =۹۷ متر\nQqqqq Wwwww\n۲۲۰ =۱۲ متر', requester: 'owner' });
  assert.equal(mixed.store.d.n, 1); assert.ok(m.owner.includes('مشتری «Qqqqq Wwwww»'));
  const none = (await mixed.inv.decideAll({ verb: 'no' })).join('\n');
  assert.equal(mixed.store.get('Q1').status, 'cancelled'); assert.equal(mixed.m.posts.length, 0);
  assert.deepEqual(await mixed.inv.decideAll({ verb: 'yes' }), ['پیش‌نمایش بازی از یک پیام چندمشتری نیست.']);
  assert.ok(none.length > 0);
});

// ------------------------------------------------------------------------------------------------ the final cut beside each line
import { Tracker } from '../src/tracker.js';
import { cutRecords, cutTotal, markCutsInvoiced, unInvoicedCuts, persianDay, cutLine } from '../src/cuts.js';

const CUT_AT = Date.parse('2026-10-30T09:00:00Z'); // 8 Aban 1405 in the books' time zone
function cutDesk() {
  const t = mk({ customers: [...MULTI_CUSTOMERS, ...CUSTOMERS], items: MULTI_ITEMS, invoices: [...histFor('81'), ...histFor('82')] });
  const tr = new Tracker({ dir: '' });
  tr.add({ type: 'cut', at: CUT_AT, customer: 'NUQOOSH', lines: [{ code: '220', quantity: 12, unit: 'm' }], ref: 'c1' }); // «ART NO 220 NUQOOSH 12M»
  tr.add({ type: 'cut', at: CUT_AT + 3600000, customer: 'AL EBDA', lines: [{ code: '215', quantity: 90, unit: 'm' }, { code: '999', quantity: 5, unit: 'm' }], ref: 'c2' });
  tr.add({ type: 'cut', at: CUT_AT, customer: 'NUQOOSH', internal: true, kind: 'open-roll', lines: [{ code: '220', quantity: 50, unit: 'm' }], ref: 'c3' }); // an opened roll is not a sale
  t.inv.cutsOf = (customer, codes) => cutRecords(tr, customer, codes, { now: CUT_AT + 86400000 });
  t.inv.markCuts = (refs, number) => markCutsInvoiced(tr, refs, number);
  return { t, tr };
}

test('the cut beside the line: a matching cut is shown with the day and the group; a different quantity and a missing cut are warnings; the persian day is right', async () => {
  assert.equal(persianDay(CUT_AT), '۸ آبان');
  assert.equal(persianDay(Date.parse('2026-03-21T10:00:00Z')), '۱ فروردین'); // Nowruz 1405
  assert.equal(cutLine({ qty: 12, unit: 'm', at: CUT_AT }), 'برش: ۱۲ متر، ۸ آبان، گروه سفارش آریاک');
  const { t } = cutDesk();
  const r = await t.inv.request({ text: MULTI, requester: 'owner' }); // AL EBDA 215 = 97 m, NUQOOSH 220 = 12 m
  const [ebda, nuq] = r.owner.split('— — —');
  assert.ok(nuq.includes('برش: ۱۲ متر، ۸ آبان، گروه سفارش آریاک'), nuq); // matches: no warning
  assert.ok(!nuq.includes('برش ثبت‌شده') && !nuq.includes('برشی ثبت نشده'));
  assert.ok(ebda.includes('برش: ۹۰ متر، ۸ آبان') && ebda.includes('درخواست ۹۷ متر، برش ثبت‌شده ۹۰ متر'), ebda); // the quantity differs
  // no cut recorded for the code of a line
  const none = cutDesk();
  const r2 = await none.t.inv.request({ text: 'فاکتور بده\nNUQOOSH\n۲۱۵ =۴ متر', requester: 'owner' });
  assert.ok(r2.owner.includes('برشی ثبت نشده') && !r2.owner.includes('برش: '), r2.owner);
  assert.equal(none.t.m.posts.length, 0); // read only: nothing posted, nothing written
});

test('no quantity: the cut quantity is proposed as a guess; with no cut it says why it cannot', async () => {
  const { t } = cutDesk();
  const r = await t.inv.request({ text: 'اتوسا فاکتور میخوام برای مشتری های زیر\nNUQOOSH\n۲۲۰', requester: 'owner' });
  assert.ok(r.owner, r.requester);
  assert.ok(r.owner.includes('× 12 (حدس از برش)') && r.owner.includes('برش: ۱۲ متر'), r.owner);
  assert.equal(t.store.get('Q1').lines[0].qty, 12);
  const none = cutDesk();
  const r2 = await none.t.inv.request({ text: 'اتوسا فاکتور میخوام برای مشتری های زیر\nNUQOOSH\n۲۱۵', requester: 'owner' });
  assert.equal(none.t.store.d.n, 0); // the line stops: AL EBDA has the 215 cut, NUQOOSH has none
  assert.ok(String(r2.owner || r2.requester).includes('برشی هم برایش ثبت نشده'));
});

test('after the invoice is created its cut lines carry the invoice number: offered once, and the report of cuts with no invoice keeps the rest', async () => {
  const { t, tr } = cutDesk();
  await t.inv.request({ text: MULTI, requester: 'owner' });
  assert.equal(unInvoicedCuts(tr).length, 3); // 220 (NUQOOSH), 215 and 999 (AL EBDA); the opened roll is not a sale
  await t.inv.decide({ verb: 'yes', id: 'Q2' }); // the NUQOOSH invoice
  const number = t.store.get('Q2').qbo.docNumber;
  assert.ok(number);
  assert.equal(tr.events.find((e) => e.ref === 'c1').lines[0].invoiced.number, number);
  assert.equal(tr.events.find((e) => e.ref === 'c2').lines[0].invoiced, undefined); // the other customer's cut is untouched
  assert.deepEqual(unInvoicedCuts(tr).map((c) => [c.customer, c.code]).sort(), [['AL EBDA', '215'], ['AL EBDA', '999']]);
  // offered once: a new request for the same customer and code finds no cut left
  const again = await t.inv.request({ text: 'فاکتور بده\nNUQOOSH\n۲۲۰ =۱۲ متر', requester: 'owner' });
  assert.ok(again.owner.includes('برشی ثبت نشده'));
  // the records: customer and code, not yet invoiced, newest first; the unit of the newest
  const recs = cutRecords(tr, 'AL EBDA AL MALKI KITCHEN', ['215', 'PVC-215'], { now: CUT_AT + 86400000 });
  assert.equal(recs.length, 1); assert.deepEqual([cutTotal(recs).qty, cutTotal(recs).unit], [90, 'm']);
  assert.equal(cutRecords(tr, 'AL EBDA', '215', { now: CUT_AT + 90 * 86400000 }).length, 0); // too old to be this order's cut
});

// ------------------------------------------------------------------------------------------------ NUQOOSH is NUQOOSH IND . LLC; the cut of «ART NO 220 NUQOOSH 12M» is found
test('QuickBooks\' own names beat a group alias: NUQOOSH is the customer NUQOOSH IND . LLC, never the one the WhatsApp group name pairs it with', async () => {
  const t = mk({ customers: [...MULTI_CUSTOMERS, ...CUSTOMERS], items: MULTI_ITEMS, invoices: [...histFor('81'), ...histFor('82')] });
  // the owner's teaching: the group «NUQOOSH & AL EBDA» holds both names; the alias store pairs them
  t.list.approve('AL EBDA AL MALKI KITCHEN', 'g1@g.us', 'NUQOOSH & AL EBDA - ARYAK');
  t.desk.aliases.add('AL EBDA AL MALKI KITCHEN', 'NUQOOSH');
  const r = await t.desk.resolveLoose('NUQOOSH');
  assert.deepEqual([r.id, r.name], ['82', 'NUQOOSH IND . LLC']);
  assert.equal((await t.desk.resolveLoose('AL EBDA')).id, '81');
  assert.equal((await t.desk.resolveStrict('NUQOOSH IND . LLC')).id, '82');
  const pv = await t.inv.request({ text: MULTI, requester: 'owner' });
  assert.deepEqual([t.store.get('Q1').customer.id, t.store.get('Q2').customer.id], ['81', '82']);
  assert.ok(!pv.owner.includes('حدس از «NUQOOSH»'));
});

test('the cut of «ART NO 220 NUQOOSH 12M» is found: the caption\'s name, the group name the tracker kept, the code with words around it, the unit M', () => {
  const tr = new Tracker({ dir: '' });
  tr.add({ type: 'cut', at: CUT_AT, customer: 'NUQOOSH & AL EBDA', customerTyped: 'NUQOOSH', lines: [{ code: 'ART NO 220', quantity: 12, unit: 'M' }], ref: 'k1' });
  tr.add({ type: 'cut', at: CUT_AT, customer: 'NUQOOSH & AL EBDA', lines: [{ code: '221', quantity: 3, unit: 'm' }], ref: 'k2' }); // an event recorded before the typed name was kept
  const logs = [];
  const opts = { now: CUT_AT + 3600000, log: (l) => logs.push(l) };
  const found = cutRecords(tr, 'NUQOOSH IND . LLC', ['220', 'PVC-220'], opts);
  assert.equal(found.length, 1); assert.deepEqual([found[0].qty, found[0].unit], [12, 'm']);
  assert.equal(cutRecords(tr, 'NUQOOSH IND . LLC', '221', opts).length, 1); // the old event, by the shared word
  assert.equal(cutRecords(tr, 'ZED TRADING', '220', opts).length, 0); // another customer
  assert.equal(cutRecords(tr, 'NUQOOSH IND . LLC', '999', opts).length, 0); // another code
  assert.ok(logs.some((l) => /cut lookup: customer "NUQOOSH IND \. LLC", codes 220\/PVC-220: 2 cut event\(s\).*1 line\(s\) matched/.test(l)), logs.join(' | '));
  assert.equal(cutTotal(found).qty, 12);
});
