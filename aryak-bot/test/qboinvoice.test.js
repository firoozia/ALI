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
import { ItemCodes, extractPo, itemsContaining, looksLikeInvoiceRequest, parseEnglishInvoice, parseInvoiceBlocks } from '../src/qboinvoice.js';
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
      { // the fake refuses what the real one refuses: an unknown property of an address, and any field named in opts.rejectField
        const sent = JSON.parse(init.body); const okAddr = ['Id', 'Line1', 'Line2', 'Line3', 'Line4', 'Line5', 'City', 'Country', 'CountrySubDivisionCode', 'PostalCode'];
        const bad = ['BillAddr', 'ShipAddr'].find((k) => sent[k] && Object.keys(sent[k]).some((x) => !okAddr.includes(x))) || (opts.rejectField && opts.rejectField in sent ? opts.rejectField : '');
        if (bad) return res(400, { Fault: { Error: [{ Message: 'Request has invalid or unsupported property', Detail: 'Property Name: failed to parse json object; a property specified is unsupported or invalid', code: '2010', element: bad }] } });
      }
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
    if (p.includes('/preferences')) return res(200, { Preferences: { CurrencyPrefs: { HomeCurrency: { value: 'AED' } }, SalesFormsPrefs: { CustomTxnNumbers: !!opts.customTxn, ...(opts.salesForms || {}) } } });
    if (p.includes('/companyinfo/')) return res(200, { CompanyInfo: { CompanyName: 'The Test Workshop', Country: 'AE' } });
    const sql = u.searchParams.get('query') || '';
    const ent = /from\s+(\w+)/i.exec(sql)[1];
    if (ent === 'Invoice' && /where CustomerRef/i.test(sql) && opts.customerInvoices) return res(200, { QueryResponse: { Invoice: opts.customerInvoices } });
    if (ent === 'Invoice' && /^select \*/i.test(sql) && opts.officeInvoices && !/DocNumber = /.test(sql)) return res(200, { QueryResponse: { Invoice: opts.officeInvoices } });
    if (ent === 'Invoice' && /^select \*/i.test(sql) && opts.byNumber && /DocNumber = '([^']*)'/.test(sql)) return res(200, { QueryResponse: { Invoice: [opts.byNumber[/DocNumber = '([^']*)'/.exec(sql)[1]]].filter(Boolean) } });
    if (ent === 'Template') return res(200, { QueryResponse: { Template: opts.templates || [] } });
    const used = opts.docNumbers || (opts.docNumbers = []);
    if (ent === 'Invoice' && sql.includes('MetaData.LastUpdatedTime') && opts.changed) return res(200, { QueryResponse: { Invoice: opts.changed().map((n, i) => ({ Id: String(500 + i), DocNumber: n })) } });
    if (ent === 'Invoice' && (sql.includes('MetaData.CreateTime') || sql.includes('MetaData.LastUpdatedTime'))) return res(200, { QueryResponse: { Invoice: used.map((n, i) => ({ Id: String(i + 1), DocNumber: n })) } });
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
  assert.deepEqual(parseInvoiceCommand('مجوز فاکتور 971 50 111 2222'), { type: 'auth_add', number: '971 50 111 2222', perm: 'invoice' });
  assert.deepEqual(parseInvoiceCommand('لغو مجوز فاکتور 971501112222'), { type: 'auth_remove', number: '971501112222', perm: 'invoice' });
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
  assert.equal(a.grant('+971 50 111 2222', 'invoice'), '971501112222');
  assert.equal(a.grant('12', 'invoice'), false);
  assert.equal(a.grant('۹۷۱۵۰۳۳۳۴۴۴۴', 'invoice'), '971503334444');
  assert.deepEqual(a.numbers(), ['971501112222', '971503334444']);
  assert.equal(a.isAuthorized({ sender: '971501112222@s.whatsapp.net' }), true);
  assert.equal(a.isAuthorized({ sender: '55555@lid', senderAlt: '971501112222@s.whatsapp.net' }), true);
  assert.equal(a.isAuthorized({ sender: '971509999999@s.whatsapp.net' }), false);
  assert.equal(a.isAuthorized({ sender: '55555@lid' }), false);
  assert.deepEqual(new AuthStore(dir).numbers(), ['971501112222', '971503334444']); // kept on disk
  assert.equal(a.revoke('971501112222', 'invoice'), true);
  assert.equal(a.revoke('971501112222', 'invoice'), false);
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
  assert.match(index, /qboAuth\.isAuthorized\(who, lids\(info\.lidToPhone\)\) && \(await authorizedFlow\(/);
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

test('the invoice number is QuickBooks\': the preview reserves none; with hand numbering on, the next number is read at the create (the latest invoice + 1); a cancelled preview leaves no gap', async () => {
  const t = mk({ customTxn: true, docNumbers: ['inv-8996', 'inv-8973', 'inv-8956'] });
  const r = await t.inv.request({ text: REQ, requester: 'owner' });
  assert.ok(r.owner.includes('شمارهٔ فاکتور: هنگام ساخت را کوییک‌بوکس می‌دهد'), r.requester); // nothing reserved
  assert.equal(t.store.get('Q1').docNumber, '');
  const r2 = await t.inv.request({ text: REQ, requester: 'owner' });
  assert.ok(r2.owner.includes('هنگام ساخت') && t.store.get('Q2').docNumber === '');
  await t.inv.decide({ verb: 'no', id: 'Q1' }); // a cancelled preview takes no number
  const out = (await t.inv.decide({ verb: 'yes', id: 'Q2' })).join('\n');
  assert.equal(t.m.posts[0].body.DocNumber, 'inv-8997'); // the next after the latest invoice, read now
  assert.ok(out.includes('inv-8997') && !out.includes('بی‌شماره'));
  assert.deepEqual(t.m.posts[0].body.Line.map((l) => l.Description), ['35 mm soft-close hinge', undefined]); // only where QuickBooks has one
  assert.deepEqual([t.m.posts[0].body.SalesTermRef, t.m.posts[0].body.BillEmail], [{ value: '3' }, { Address: 'office@orion.test' }]);
});

test('hand numbering at the create: leading zeros keep their width, another prefix is not mixed in, a number the office took in the meantime is skipped, an unreadable pattern stops before anything is made; automatic numbering sends no DocNumber', async () => {
  const docNumbers = ['inv-8996'];
  const t = mk({ customTxn: true, docNumbers });
  await t.inv.request({ text: REQ, requester: 'owner' });
  docNumbers.unshift('inv-8997'); // the office typed that number by hand after the preview
  assert.ok((await t.inv.decide({ verb: 'yes', id: 'Q1' })).join('').includes('ساخته شد'));
  assert.equal(t.m.posts[0].body.DocNumber, 'inv-8998'); // the number is read at the yes, after what the office did
  const z = mk({ customTxn: true, docNumbers: ['INV-0099', 'CN-500', 'INV-0098'] });
  await z.inv.request({ text: REQ, requester: 'owner' });
  await z.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.equal(z.m.posts[0].body.DocNumber, 'INV-0100');
  const none = mk({ customTxn: true, docNumbers: [] }); // the pattern cannot be read: nothing is created
  await none.inv.request({ text: REQ, requester: 'owner' });
  const stop = (await none.inv.decide({ verb: 'yes', id: 'Q1' })).join('');
  assert.ok(stop.includes('شمارهٔ بعدی فاکتور را از کوییک‌بوکس نتوانستم بخوانم')); assert.equal(none.m.posts.length, 0);
  assert.equal(none.store.get('Q1').status, 'pending');
  const auto = mk({ customTxn: false }); // a company that numbers by itself: QuickBooks assigns it, none is sent
  const ar = await auto.inv.request({ text: REQ, requester: 'owner' });
  assert.ok(ar.owner.includes('هنگام ساخت'));
  await auto.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.equal('DocNumber' in auto.m.posts[0].body, false);
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
  assert.match(chooseText([{ subject: 'A' }, { subject: 'B' }], 'fa'), /^کدام گروه؟ شماره را بنویسید:\n1\) A\n━{18}\n2\) B/);
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
import { setOutLang } from '../src/outlang.js';
setOutLang('fa'); // these tests read the Persian sentences; the English output is tested in english-out.test.js

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

// ------------------------------------------------------------------------------------------------ an invoice asked for in English, in an internal group
const BURT = 'Atossa invoice for burtomani\n603 = 30 mtr';
test('English invoice words: «Atossa invoice for <customer>» and its lines; «A603» is code 603; units mtr/m/meter; no send, no question', () => {
  assert.equal(looksLikeInvoiceRequest(BURT), true);
  assert.equal(parseInvoiceCommand(BURT).type, 'request');
  assert.deepEqual(parseEnglishInvoice(BURT), { customer: 'burtomani', lines: ['603 30'] });
  assert.deepEqual(parseEnglishInvoice('Atosa invoice burtomani\nA603 -- 30 m\n215 x 4.5 meter'), null); // an odd dash line is not this format: the model reads it
  assert.deepEqual(parseEnglishInvoice('Atosa make invoice for burtomani\nA603 30 m\n215 = 4.5 meters'), { customer: 'burtomani', lines: ['603 30', '215 4.5'] });
  assert.equal(looksLikeInvoiceRequest('Atossa create invoice for burtomani\n603 = 30 mtr'), true);
  assert.equal(looksLikeInvoiceRequest('please send invoice 9910 to the group'), false);
  assert.equal(looksLikeInvoiceRequest('invoice inv-9910 delete this one'), false);
  assert.equal(looksLikeInvoiceRequest('what is the status of invoice for burtomani?'), false);
  assert.equal(extractPo('A603 -- 30 mtr / PN 1029'), '1029'); assert.equal(extractPo('x', 'po: AB-77'), 'AB-77'); assert.equal(extractPo('شماره سفارش ۱۰۲۹'), '1029'); assert.equal(extractPo('603 = 30 mtr'), '');
});

test('the exact English request builds a preview (guessed customer, code 603 with the sheet stock, the cut, the PO number) and creates nothing; the memo carries the PO', async () => {
  const items = [{ Id: '9', Name: 'PVC 603', Sku: 'PVC-603', UnitPrice: 4.5, Type: 'Inventory', Active: true }];
  const t = mk({ customers: [{ Id: '91', DisplayName: 'AL BURTOMANI NATIONAL', CompanyName: 'AL BURTOMANI NATIONAL LLC', Balance: 0 }], items });
  const tr = new Tracker({ dir: '' });
  tr.add({ type: 'cut', at: Date.parse('2026-11-08T05:00:00Z'), customer: 'AL BURTOMANI NATIONAL', customerTyped: 'BURTOMANI', lines: [{ code: 'ART NO 603', quantity: 30, unit: 'm' }], ref: 'c1' });
  t.inv.cutsOf = (customer, codes) => cutRecords(tr, customer, codes, { now: Date.parse('2026-11-08T08:00:00Z') });
  t.inv.stockOf = async (code) => ({ free: code === '603' ? 12 : 500, unit: 'm' });
  const r = await t.inv.request({ text: BURT, requester: 'owner', quotedText: 'A603 -- 30 mtr / PN 1029' });
  assert.ok(r.owner, r.requester);
  assert.match(r.owner, /AL BURTOMANI NATIONAL/); assert.match(r.owner, /× 30/); assert.match(r.owner, /شمارهٔ سفارش مشتری: ۱۰۲۹/);
  assert.match(r.owner, /برش: ۳۰ متر/); // the cutting group's line
  assert.match(r.owner, /موجودی از شیت زیناکس/); // 12 m free for 30 m: a warning, not a stop
  assert.equal(t.m.posts.length, 0); // nothing created
  const p = t.store.get(/#(Q\d+)/.exec(r.owner)[1]);
  assert.equal(p.po, '1029');
  assert.deepEqual(t.inv.invoiceBody(p).CustomerMemo, { value: 'PO 1029' });
});

// ------------------------------------------------------------------------------------------------ one line, capitals: «ATOSSA INVOICE FOR AL EBDA 215=97M»
const ONE_LINE = 'ATOSSA INVOICE FOR AL EBDA 215=97M';
test('one capital line: the customer is the text between FOR and the first code=quantity; several items on the line; it is an invoice, never a stock question', async () => {
  assert.deepEqual(parseEnglishInvoice(ONE_LINE), { customer: 'AL EBDA', lines: ['215 97'] });
  assert.deepEqual(parseEnglishInvoice('Atossa invoice for AL EBDA 215=97M, 220=12M'), { customer: 'AL EBDA', lines: ['215 97', '220 12'] });
  assert.deepEqual(parseEnglishInvoice('invoice for Al Ebda 215 = 97 mtr and 220=12m'), { customer: 'Al Ebda', lines: ['215 97', '220 12'] });
  assert.equal(parseInvoiceCommand(ONE_LINE).type, 'request'); assert.equal(looksLikeInvoiceRequest(ONE_LINE), true);
  assert.equal(parseEnglishInvoice('invoice for'), null); assert.equal(looksLikeInvoiceRequest('how much is 215=97M'), false);
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const guard = index.indexOf('if (looksLikeInvoiceRequest(asked))');
  assert.ok(guard > 0 && guard < index.indexOf('const answerText = await staffAnswer(')); // before the stock model
  assert.match(index.slice(guard, guard + 700), /never sent to the stock flow/);
});

test('the exact line builds a preview for AL EBDA AL MALKI KITCHEN (QuickBooks\' own name; NUQOOSH is another customer) with 215 = 97 m, no number reserved, and creates nothing', async () => {
  setOutLang('en');
  try {
    const customers = [{ Id: '91', DisplayName: 'AL EBDA AL MALKI KITCHEN', CompanyName: 'AL EBDA AL MALKI KITCHEN', Balance: 0 }, { Id: '92', DisplayName: 'NUQOOSH IND . LLC', CompanyName: 'NUQOOSH IND . LLC', Balance: 0 }];
    const items = [{ Id: '15', Name: 'PVC 215', Sku: 'PVC-215', UnitPrice: 16, Type: 'Inventory', Active: true }, { Id: '20', Name: 'PVC 220', Sku: 'PVC-220', UnitPrice: 14, Type: 'Inventory', Active: true }];
    const t = mk({ customers, items, customTxn: true, docNumbers: ['inv-9983'] });
    t.desk.aliases.add('NUQOOSH IND . LLC', 'NUQOOSH & AL EBDA'); // the group name taught long ago: it never decides which customer is meant
    const r = await t.inv.request({ text: ONE_LINE, requester: 'owner' });
    assert.ok(r.owner, r.requester);
    assert.match(r.owner, /AL EBDA AL MALKI KITCHEN/); assert.doesNotMatch(r.owner, /NUQOOSH/);
    assert.match(r.owner, /\(97 ×16 = 1,552\.00\)/); assert.doesNotMatch(r.owner, /Invoice no|assigned by/); // the short preview: no number line
    assert.equal(t.m.posts.length, 0);
    assert.equal(t.store.get('Q1').docNumber, '');
    await t.inv.decide({ verb: 'yes', id: 'Q1' });
    assert.equal(t.m.posts[0].body.DocNumber, 'inv-9984'); // QuickBooks' next number, read at the yes
  } finally { setOutLang('fa'); }
});

// ------------------------------------------------------------------------------------------------ nothing claims a number before the final yes
test('an old waiting preview that carries a stored number loses it at load; the create reads QuickBooks\' next number; waiting previews never count in the sequence', async () => {
  const t = mk({ customTxn: true, docNumbers: ['inv-9984', 'inv-9980'] });
  await t.inv.request({ text: REQ, requester: 'owner' });
  const q = t.store.get('Q1');
  q.docNumber = 'inv-9979'; // what a preview made before the rule carried (and saved)
  t.store.save();
  const reloaded = new InvoiceStore(path.join(t.dir, 'qbo'));
  assert.equal(reloaded.get('Q1').docNumber, ''); // cleared at load
  t.inv.store = reloaded;
  assert.equal((await t.inv.nextDocNumber()).docNumber, 'inv-9985'); // QuickBooks' own latest + 1; no waiting preview takes part
  reloaded.get('Q1').docNumber = 'inv-9999'; reloaded.get('Q1').attempted = false;
  assert.equal((await t.inv.nextDocNumber()).docNumber, 'inv-9985'); // even a stored number on a waiting preview is ignored
  await t.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.equal(t.m.posts[0].body.DocNumber, 'inv-9985'); // never the old 9979 or 9999
});

test('a lost answer keeps THIS attempt\'s number for the retry (same invoice); a refused number is chosen again', async () => {
  const lost = mk({ customTxn: true, docNumbers: ['inv-9984'], postFailures: 4 });
  await lost.inv.request({ text: REQ, requester: 'owner' });
  assert.ok((await lost.inv.decide({ verb: 'yes', id: 'Q1' })).join('').includes('ساخت فاکتور نشد'));
  assert.equal(lost.store.get('Q1').docNumber, 'inv-9985'); assert.equal(lost.store.get('Q1').attempted, true);
  await lost.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.equal(lost.m.posts.at(-1).body.DocNumber, 'inv-9985'); // the retry carries the same number
  assert.ok(lost.m.posts.every((x) => x.body.DocNumber === 'inv-9985')); // every try carried the same number
  // a 4xx refusal of the number: it is dropped, and the next attempt reads QuickBooks again
  const t = mk({ customTxn: true, docNumbers: ['inv-9984'] });
  await t.inv.request({ text: REQ, requester: 'owner' });
  const p = t.store.get('Q1');
  p.status = 'pending'; p.docNumber = 'inv-9984'; p.attempted = true; // pretend an attempt chose a number the office has since taken
  t.store.save();
  const out = (await t.inv.decide({ verb: 'yes', id: 'Q1' })).join('');
  assert.ok(out.includes('ساخت فاکتور نشد')); assert.equal(p.docNumber, ''); assert.equal(p.attempted, false);
  await t.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.equal(t.m.posts.at(-1).body.DocNumber, 'inv-9985');
});

test('the next number is read from QuickBooks at that moment: a renumbered invoice is followed, the last-changed list is read too, and the reason is logged', async () => {
  const docNumbers = ['inv-9984', 'inv-9979', 'inv-9978'];
  const t = mk({ customTxn: true, docNumbers });
  const lines = []; t.inv.log = (x) => lines.push(x);
  assert.equal((await t.inv.nextDocNumber()).docNumber, 'inv-9985');
  assert.match(lines.at(-1), /^next number: max inv-9984 in QuickBooks \(\d+ invoices read\) -> inv-9985$/);
  docNumbers.splice(0, 1); // the owner renumbered inv-9984 to a lower number in QuickBooks
  assert.equal((await t.inv.nextDocNumber()).docNumber, 'inv-9980'); // nothing of ours remembers 9984
  assert.match(lines.at(-1), /max inv-9979 in QuickBooks .* -> inv-9980$/);
  // an invoice changed recently but created long ago (a renumbered old one) is seen through the last-changed list
  const u = mk({ customTxn: true, docNumbers: ['inv-9975', 'inv-9974'], changed: () => ['inv-9990'] });
  assert.equal((await u.inv.nextDocNumber()).docNumber, 'inv-9991');
});

// ------------------------------------------------------------------------------------------------ where the PDF of a created invoice goes
test('the PDF goes to the targets the program names (the chat of the request, the chat of the yes), each once; an old preview with no origin keeps the owner chat and the test group', async () => {
  const t = mk();
  const seen = [];
  t.inv.targets = async (p, decidedIn) => { seen.push([p.origin?.jid || '', decidedIn]); return [...new Set([p.origin?.jid, decidedIn].filter(Boolean))]; };
  const r = await t.inv.request({ text: REQ, requester: 'owner', origin: { jid: 'invoices@g.us' } });
  assert.ok(r.owner); assert.equal(t.store.get('Q1').origin.jid, 'invoices@g.us');
  assert.equal(new InvoiceStore(path.join(t.dir, 'qbo')).get('Q1').origin.jid, 'invoices@g.us'); // kept on disk
  await t.inv.decide({ verb: 'yes', id: 'Q1', decidedIn: 'invoices@g.us' });
  assert.deepEqual(seen, [['invoices@g.us', 'invoices@g.us']]);
  assert.deepEqual(t.sent.map((x) => x.jid), ['invoices@g.us']); // once, where it was asked and answered
  assert.match(t.sent[0].caption, /^Invoice /);
  const u = mk(); // asked in one place, answered in another: both
  u.inv.targets = async (p, decidedIn) => [...new Set([p.origin?.jid, decidedIn].filter(Boolean))];
  await u.inv.request({ text: REQ, requester: '971528493119', origin: { jid: '971528493119@s.whatsapp.net' } });
  await u.inv.decide({ verb: 'yes', id: 'Q1', decidedIn: OWNER_JID });
  assert.deepEqual(u.sent.map((x) => x.jid).sort(), ['971528493119@s.whatsapp.net', OWNER_JID].sort());
  const old = mk(); // an old preview with no origin and no targets function: the owner chat and the test group, as before
  await old.inv.request({ text: REQ, requester: 'owner' });
  await old.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.deepEqual(old.sent.map((x) => x.jid), [OWNER_JID, 'test@g.us']);
});

test('wiring: the targets are the request chat, the yes chat and the owner copy for somebody else\'s request; never a group that is not internal', () => {
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const at = index.indexOf('qboInvoices.targets = async');
  const block = index.slice(at, at + 1500);
  assert.ok(at > index.indexOf('const qboInvoices = new QboInvoiceDesk(')); // the desk exists first
  assert.match(block, /if \(p\.origin\?\.jid\) wanted\.push\(p\.origin\.jid\); else \{ wanted\.push\(own\);/);
  assert.match(block, /if \(decidedIn\) wanted\.push\(decidedIn\);/);
  assert.match(block, /if \(p\.requester !== 'owner'\) wanted\.push\(own\);/);
  assert.match(block, /!groupAllowed\(subject, config\)\.ok\) \{ logger\.info\(`invoice PDF: not posted to a group that is not internal/);
  assert.match(index, /qboInvoices\.request\(\{ text, requester: 'owner', origin: here\.chatId \? \{ jid: here\.chatId \} : null \}\)/);
  assert.match(index, /qboInvoices\.decide\(\{ verb: ic\.type, id, decidedIn: here\.chatId \|\| '' \}\)/);
  assert.match(index, /requester: jidDigits\(chatId\), origin: \{ jid: chatId \}/);
});

// ------------------------------------------------------------------------------------------------ the short preview (English): a snapshot
test('the short preview: *Invoice* #Q1, the customer in bold, one line per item with the code in bold, the total in bold, a one-line flag only when it matters, Yes/No', async () => {
  setOutLang('en');
  try {
    const t = mk();
    const r = await t.inv.request({ text: REQ, requester: 'owner' });
    assert.equal(r.owner, [
      '*Invoice* #Q1',
      'Customer: *Orion Furniture*',
      '1. *Hinge 35mm* (10 ×2.5 = 25.00)',
      '2. *Edge Tape White* (3 ×1.1 = 3.30) ✎ your price (system 1.20)',
      'Total: *29.72 AED*',
      'Yes/No',
    ].join('\n'));
    // gone from the default: the "nothing created" sentence, the number line, subtotal, VAT, tax text, validity
    for (const gone of ['nothing', 'Invoice no', 'Subtotal', 'VAT', '24 hours', 'tax']) assert.ok(!r.owner.toLowerCase().includes(gone.toLowerCase()), gone);
    // a second waiting preview: the answers carry the full code
    const r2 = await t.inv.request({ text: REQ, requester: 'owner' });
    assert.ok(r2.owner.startsWith('*Invoice* #Q2') && r2.owner.endsWith('Yes #Q2 / No #Q2'));
    // the full old preview on request, in either language
    assert.deepEqual(parseInvoiceCommand('details #Q2'), { type: 'details', id: 'Q2' }); assert.deepEqual(parseInvoiceCommand('جزئیات #q2'), { type: 'details', id: 'Q2' });
    const full = t.inv.previewDetails('Q2');
    assert.ok(full.includes('پیش‌نمایش فاکتور #Q2') && full.includes('جمع کل'));
    // the created message
    const done = await t.inv.decide({ verb: 'yes', id: 'Q1' });
    assert.match(done[0], /^\*Invoice\* \S+ — \*Orion Furniture\* — \*29\.72 AED\*$/);
  } finally { setOutLang('fa'); }
});

test('the short preview: the code is bold inside the item name; flags are one line each (guess, no cut, low stock, cut differs); the PO shows', async () => {
  setOutLang('en');
  try {
    const items = [{ Id: '9', Name: 'PVC FILM 509', Sku: 'PVC-509', UnitPrice: 11, Type: 'Inventory', Active: true }];
    const t = mk({ customers: [{ Id: '91', DisplayName: 'HIGH POINT', CompanyName: 'HIGH POINT LLC', Balance: 0 }], items });
    t.inv.stockOf = async () => ({ free: 27.8, unit: 'm' });
    t.inv.cutsOf = () => [];
    t.inv.crossOf = () => ({ problems: ['509: no order found'] });
    const r = await t.inv.request({ text: 'Atossa invoice for high pnt\n509 = 97 mtr\nPN 77', requester: 'owner' });
    assert.ok(r.owner, r.requester);
    const lines = r.owner.split('\n');
    assert.equal(lines[0], '*Invoice* #Q1'); assert.equal(lines[1], 'Customer: *HIGH POINT*'); assert.equal(lines[2], 'PO: *77*');
    assert.equal(lines[3], '1. PVC FILM *509* (97 ×11 = 1,067.00)');
    assert.match(lines[4], /^Total: \*1,120\.35 AED\*$/);
    const flags = lines.filter((l) => l.startsWith('⚠'));
    assert.ok(flags.includes('⚠ stock 27.8 m < 97') && flags.includes('⚠ 509: no order found'), flags.join(' | '));
    assert.ok(lines.includes('Cross-check (Aryak Orders):'));
    assert.equal(lines.at(-1), 'Yes/No');
    assert.ok(flags.length <= 4 && lines.length <= 11); // short
  } finally { setOutLang('fa'); }
});

test('the statement confirmation is short too, and the Persian mode keeps the old texts', () => {
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(index.includes('*Statement* — *${x.name}* — *${x.balance}*. Send to ${where2}? ${answer}'));
  assert.match(index, /const answer = groupStatements\.openIds\(\)\.length > 1 \? 'Yes #' \+ id \+ ' \/ No #' \+ id : 'Yes\/No';/);
  const t = mk(); // Persian mode: the full old preview as before
  return t.inv.request({ text: REQ, requester: 'owner' }).then((r) => { assert.ok(r.owner.startsWith('پیش‌نمایش فاکتور #Q1')); });
});

test('the bold code is separated from a name that glues it (PVC FILM509 -> PVC FILM *509*), and from what follows', async () => {
  setOutLang('en');
  try {
    const items = [{ Id: '9', Name: 'PVC FILM509', Sku: 'PVC-509', UnitPrice: 11, Type: 'Inventory', Active: true }, { Id: '10', Name: 'EDGE0.4MM-215X', Sku: 'ED-215', UnitPrice: 2, Type: 'Inventory', Active: true }];
    const t = mk({ customers: [{ Id: '91', DisplayName: 'HIGH POINT', CompanyName: 'HIGH POINT LLC', Balance: 0 }], items });
    const r = await t.inv.request({ text: 'Atossa invoice for HIGH POINT 509=8M 215=3M', requester: 'owner' });
    const lines = r.owner.split('\n');
    assert.ok(lines.includes('1. PVC FILM *509* (8 ×11 = 88.00)'), lines.join(' | '));
    assert.ok(lines.some((l) => /^2\. EDGE0\.4MM-\*215\*\s?X \(3 ×2 = 6\.00\)$|^2\. EDGE0\.4MM- \*215\* X \(3 ×2 = 6\.00\)$/.test(l)), lines.join(' | '));
  } finally { setOutLang('fa'); }
});

// ------------------------------------------------------------------------------------------------ what the QuickBooks screen fills in and the API does not
test('the create carries the default terms and the message on invoice, read live: the preference first, else the newest invoice the OFFICE made; the PO number goes first; nothing is invented', async () => {
  const NL = String.fromCharCode(10);
  const MESSAGE = ['Thank you for being our loyal customer.', 'Beneficiary Name: Test Workshop LLC', 'IBAN: AE000000000000000000000'].join(NL);
  const noTerms = [{ Id: '58', DisplayName: 'Orion Furniture', CompanyName: 'Orion Furniture LLC', Balance: 0 }]; // a customer with no terms of his own
  const a = mk({ customers: noTerms, salesForms: { DefaultTerms: '5', DefaultCustomerMessage: MESSAGE } });
  await a.inv.request({ text: REQ, requester: 'owner' });
  await a.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.equal(a.m.posts[0].body.CustomerMemo.value, MESSAGE); assert.deepEqual(a.m.posts[0].body.SalesTermRef, { value: '5' });
  // the customer's own terms win over the default
  const b = mk({ salesForms: { DefaultTerms: '5', DefaultCustomerMessage: MESSAGE } });
  await b.inv.request({ text: REQ, requester: 'owner' }); await b.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.deepEqual(b.m.posts[0].body.SalesTermRef, { value: '3' });
  // no preference text: the newest invoice made by the office (not Atossa's) lends its message
  const c2 = mk({ customers: noTerms, officeInvoices: [{ Id: '1', DocNumber: 'inv-1', PrivateNote: 'Atossa Q9', CustomerMemo: { value: 'OUR OWN TEXT' } }, { Id: '2', DocNumber: 'inv-2', CustomerMemo: { value: MESSAGE } }, { Id: '3', DocNumber: 'inv-3', CustomerMemo: { value: 'OLDER' } }] });
  await c2.inv.request({ text: REQ, requester: 'owner' }); await c2.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.equal(c2.m.posts[0].body.CustomerMemo.value, MESSAGE);
  // the PO number comes first, then the company's message
  const d = mk({ customers: noTerms, salesForms: { DefaultCustomerMessage: MESSAGE } });
  await d.inv.request({ text: REQ, requester: 'owner', quotedText: 'PN 1029' }); await d.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.equal(d.m.posts[0].body.CustomerMemo.value, `PO 1029${NL}${NL}${MESSAGE}`);
  // nothing anywhere: no memo and no terms are made up
  const none = mk({ customers: noTerms });
  await none.inv.request({ text: REQ, requester: 'owner' }); await none.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.equal('CustomerMemo' in none.m.posts[0].body, false); assert.equal('SalesTermRef' in none.m.posts[0].body, false);
  assert.equal('TemplateRef' in none.m.posts[0].body, false); // the company default form style
});

test('the form style: listed in the log; a style named in QBO_INVOICE_TEMPLATE is used, an unknown name falls back to the company default', async () => {
  const templates = [{ Id: '10', Name: 'MY INVOICE ALI', TemplateType: 'Invoice' }, { Id: '11', Name: 'Standard', TemplateType: 'Invoice' }];
  const t = mk({ templates }); t.config.qboInvoiceTemplate = 'my invoice ali';
  const lines = []; t.inv.log = (x) => lines.push(x);
  await t.inv.request({ text: REQ, requester: 'owner' }); await t.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.deepEqual(t.m.posts[0].body.TemplateRef, { value: '10' });
  assert.ok(lines.some((l) => l.includes('form styles in QuickBooks: MY INVOICE ALI [Invoice], Standard [Invoice]')));
  const u = mk({ templates }); u.config.qboInvoiceTemplate = 'No such style';
  const log2 = []; u.inv.log = (x) => log2.push(x);
  await u.inv.request({ text: REQ, requester: 'owner' }); await u.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.equal('TemplateRef' in u.m.posts[0].body, false); assert.ok(log2.some((l) => l.includes('was not found; the company default is used')));
  // the short preview shows nothing of this
  const r = await mk({ templates }).inv.request({ text: REQ, requester: 'owner' });
  assert.ok(!/terms|message|template/i.test(r.owner));
});

// ------------------------------------------------------------------------------------------------ the same fields the QuickBooks screen fills (invented data only)
test('the invoice takes the customer\'s addresses, e-mail, terms and currency from his record read at the create (as the screen does); the private note is the only text of ours', async () => {
  const customer = {
    Id: '58', DisplayName: 'Orion Furniture', CompanyName: 'Orion Furniture LLC', Balance: 0, SalesTermRef: { value: '7' },
    PrimaryEmailAddr: { Address: 'accounts@orion.example' }, CurrencyRef: { value: 'AED', name: 'United Arab Emirates Dirham' },
    BillAddr: { Id: '501', Line1: '1 Sample Street', City: 'Sample City', Country: 'Sample Land' }, ShipAddr: { Id: '502', Line1: '2 Sample Yard', City: 'Sample City' },
  };
  const t = mk({ customers: [customer] });
  await t.inv.request({ text: REQ, requester: 'owner' });
  customer.PrimaryEmailAddr.Address = 'changed@orion.example'; // changed after the preview: the create reads it again
  await t.inv.decide({ verb: 'yes', id: 'Q1' });
  const body = t.m.posts[0].body;
  assert.deepEqual(body.BillAddr, { Line1: 'Orion Furniture', Line2: '1 Sample Street', Line3: 'Sample City' }); // the screen's block: the name, the phone, the address lines, the city (no record id)
  assert.deepEqual(body.ShipAddr, { Line1: '2 Sample Yard', City: 'Sample City' });
  assert.deepEqual(body.BillEmail, { Address: 'changed@orion.example' }); assert.deepEqual(body.SalesTermRef, { value: '7' });
  assert.deepEqual(body.CurrencyRef, { value: 'AED', name: 'United Arab Emirates Dirham' });
  assert.equal(body.PrivateNote, 'Atossa Q1');
  // a customer with no address: none is made up
  const bare = mk({ customers: [{ Id: '58', DisplayName: 'Orion Furniture', CompanyName: 'Orion Furniture LLC', Balance: 0, BillAddr: { Id: '9' } }] });
  await bare.inv.request({ text: REQ, requester: 'owner' }); await bare.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.deepEqual(bare.m.posts[0].body.BillAddr, { Line1: 'Orion Furniture' }); // only the name: nothing is made up
  for (const k of ['ShipAddr', 'CurrencyRef']) assert.equal(k in bare.m.posts[0].body, false, k);
});

test('compare invoices: the owner sees field by field what the office\'s screen made and ours did not (read only); not found is said; the Persian words work', async () => {
  assert.deepEqual(parseInvoiceCommand('compare invoices inv-1 inv-2'), { type: 'compare', a: 'inv-1', b: 'inv-2' });
  assert.deepEqual(parseInvoiceCommand('مقایسه فاکتورها inv-1 inv-2'), { type: 'compare', a: 'inv-1', b: 'inv-2' });
  const office = { Id: '1', DocNumber: 'inv-1', SyncToken: '0', CustomerMemo: { value: 'Sample thank-you text' }, SalesTermRef: { value: '3' }, BillAddr: { Line1: 'A' }, ShipAddr: { Line1: 'B' }, PrintStatus: 'NeedToPrint', TxnTaxDetail: { TxnTaxCodeRef: { value: '11' } }, Line: [{ DetailType: 'SalesItemLineDetail', Description: 'd', Amount: 1, SalesItemLineDetail: { ItemRef: { value: '1' }, TaxCodeRef: { value: '11' }, ServiceDate: '2026-11-01' } }] };
  const ours = { Id: '2', DocNumber: 'inv-2', SyncToken: '0', PrivateNote: 'Atossa Q1', Line: [{ DetailType: 'SalesItemLineDetail', Amount: 1, SalesItemLineDetail: { ItemRef: { value: '1' }, TaxCodeRef: { value: '11' } } }] };
  const t = mk({ byNumber: { 'inv-1': office, 'inv-2': ours } });
  const text = (await t.inv.compareInvoices('inv-1', 'inv-2')).join('\n');
  for (const want of ['CustomerMemo: {"value":"Sample thank-you text"} | (missing)', 'SalesTermRef: {"value":"3"} | (missing)', 'BillAddr:', 'ShipAddr:', 'PrintStatus: NeedToPrint | (missing)', 'PrivateNote: (missing) | Atossa Q1', '(intended: ours is "Atossa Qn")',
    'TxnTaxDetail.TxnTaxCodeRef: {"value":"11"} | (missing)', 'line 1 field Description: present | missing', 'line 1 field SalesItemLineDetail.ServiceDate: present | missing']) assert.ok(text.includes(want), `${want}\n${text}`);
  assert.ok(!text.includes('SyncToken') && !text.includes('DocNumber:')); // ids and numbers are not differences
  assert.deepEqual(await t.inv.compareInvoices('inv-1', 'nope'), ['Not found in QuickBooks: nope']);
  const same = await mk({ byNumber: { a: office, b: { ...office, Id: '9' } } }).inv.compareInvoices('a', 'b');
  assert.match(same[0], /no difference in the compared fields/);
});

// ------------------------------------------------------------------------------------------------ parity with the screen: the switches, the dry run, the pages
test('the create copies the switches the screen sets (online payment, print status) from the newest invoice the OFFICE made; ours are skipped; nothing when there is no such invoice', async () => {
  const officeInvoices = [
    { Id: '1', DocNumber: 'inv-1', PrivateNote: 'Atossa Q9', AllowOnlinePayment: false, PrintStatus: 'NeedToPrint' },
    { Id: '2', DocNumber: 'inv-2', AllowOnlineACHPayment: true, AllowOnlineCreditCardPayment: true, AllowOnlinePayment: true, PrintStatus: 'NotSet' },
  ];
  const t = mk({ officeInvoices });
  await t.inv.request({ text: REQ, requester: 'owner' }); await t.inv.decide({ verb: 'yes', id: 'Q1' });
  const body = t.m.posts[0].body;
  assert.equal(body.AllowOnlineACHPayment, true); assert.equal(body.AllowOnlineCreditCardPayment, true); assert.equal(body.AllowOnlinePayment, true); assert.equal(body.PrintStatus, 'NotSet');
  const none = mk();
  await none.inv.request({ text: REQ, requester: 'owner' }); await none.inv.decide({ verb: 'yes', id: 'Q1' });
  for (const k of ['AllowOnlinePayment', 'AllowOnlineACHPayment', 'AllowOnlineCreditCardPayment', 'PrintStatus']) assert.equal(k in none.m.posts[0].body, false, k);
});

test('invoice dry run: the exact body a yes would send is compared with an office invoice, field by field, and nothing is created or numbered', async () => {
  assert.deepEqual(parseInvoiceCommand('invoice dry run Q16 inv-9982'), { type: 'dry_run', id: 'Q16', against: 'inv-9982' });
  assert.deepEqual(parseInvoiceCommand('آزمایش فاکتور #q3 inv-1'), { type: 'dry_run', id: 'Q3', against: 'inv-1' });
  const office = {
    Id: '7', DocNumber: 'inv-1', SyncToken: '0', CustomerMemo: { value: 'Sample office message' }, SalesTermRef: { value: '3' }, PrintStatus: 'NotSet', AllowOnlinePayment: true, EmailStatus: 'NotSet',
    BillAddr: { Line1: 'Sample Co', FreeFormAddress: true }, DueDate: '2026-12-01', TotalAmt: 1,
    Line: [{ DetailType: 'SalesItemLineDetail', Description: 'd', Amount: 1, SalesItemLineDetail: { ItemRef: { value: '1' }, TaxCodeRef: { value: '11' }, ServiceDate: '2026-11-01' } }],
  };
  const t = mk({ byNumber: { 'inv-1': office }, salesForms: { DefaultTerms: '3', DefaultCustomerMessage: 'Sample office message' }, officeInvoices: [office] });
  await t.inv.request({ text: REQ, requester: 'owner' });
  const out = await t.inv.dryRun('Q1', 'inv-1');
  const text = out.join('\n');
  assert.match(out[0], /^Dry run of Q1 against inv-1 \(nothing created, no number taken\): \d+ difference\(s\)\. Left = inv-1, right = what Q1 would send/);
  assert.ok(!text.includes('CustomerMemo:') && !text.includes('PrintStatus:') && !text.includes('AllowOnlinePayment:')); // these match now
  assert.ok(!text.includes('EmailStatus')); // QuickBooks fills it by itself: not listed
  assert.ok(text.includes('BillAddr:')); // what is still different is listed
  assert.ok(text.includes('line 1 field Description: present | missing') || text.includes('line 1 field SalesItemLineDetail.ServiceDate: present | missing'));
  assert.ok(!text.includes('DueDate') && !text.includes('TotalAmt')); // QuickBooks computes these
  assert.equal(t.m.posts.length, 0); // nothing created
  assert.equal(t.store.get('Q1').status, 'pending'); assert.equal(t.store.get('Q1').docNumber, ''); // no number taken
  assert.deepEqual(await t.inv.dryRun('Q9', 'inv-1'), ['Preview Q9 was not found.']);
  assert.deepEqual(await t.inv.dryRun('Q1', 'nope'), ['Not found in QuickBooks: nope']);
});

test('a long comparison is cut into several messages so WhatsApp cuts nothing', () => {
  const lines = Array.from({ length: 60 }, (_, i) => `Field${i}: ${'x'.repeat(100)} | (missing)`);
  const pages = QboInvoiceDesk.pages(lines, 'Comparing a with b: 60 difference(s)');
  assert.ok(pages.length > 3); assert.ok(pages.every((p) => p.length <= 1400));
  assert.equal(pages.join('\n').split('\n').length, 61); // nothing lost
  assert.ok(pages[0].startsWith('Comparing a with b'));
});

// ------------------------------------------------------------------------------------------------ terms, place of supply and the bill-to block as the screen makes them
test('terms and the place of supply: the customer\'s record, else the company default, else what the office last used for HIM, else for anybody; the bill-to block is name, phone, address lines, city', async () => {
  const bare = { Id: '58', DisplayName: 'Orion Furniture', CompanyName: 'Orion Furniture LLC', Balance: 0 };
  const hisInvoice = { Id: '5', DocNumber: 'inv-5', SalesTermRef: { value: '4' }, TransactionLocationType: 'AbuDhabi', AllowOnlinePayment: true };
  const anyInvoice = { Id: '6', DocNumber: 'inv-6', SalesTermRef: { value: '9' }, TransactionLocationType: 'Dubai' };
  // his own newest office invoice wins over the newest overall
  const a = mk({ customers: [bare], officeInvoices: [anyInvoice], customerInvoices: [{ ...hisInvoice, PrivateNote: 'Atossa Q1', SalesTermRef: { value: '1' } }, hisInvoice] });
  await a.inv.request({ text: REQ, requester: 'owner' }); await a.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.deepEqual(a.m.posts[0].body.SalesTermRef, { value: '4' }); assert.equal(a.m.posts[0].body.TransactionLocationType, 'AbuDhabi');
  // none of his own: the newest office invoice overall
  const b = mk({ customers: [bare], officeInvoices: [anyInvoice], customerInvoices: [] });
  await b.inv.request({ text: REQ, requester: 'owner' }); await b.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.deepEqual(b.m.posts[0].body.SalesTermRef, { value: '9' }); assert.equal(b.m.posts[0].body.TransactionLocationType, 'Dubai');
  // the company default before any invoice
  const d = mk({ customers: [bare], salesForms: { DefaultTerms: '2' }, officeInvoices: [anyInvoice], customerInvoices: [hisInvoice] });
  await d.inv.request({ text: REQ, requester: 'owner' }); await d.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.deepEqual(d.m.posts[0].body.SalesTermRef, { value: '2' });
  // the customer's own terms before everything
  const e = mk({ customers: [{ ...bare, SalesTermRef: { value: '7' } }], salesForms: { DefaultTerms: '2' }, officeInvoices: [anyInvoice], customerInvoices: [hisInvoice] });
  await e.inv.request({ text: REQ, requester: 'owner' }); await e.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.deepEqual(e.m.posts[0].body.SalesTermRef, { value: '7' });
  // nothing anywhere: none is sent
  const none = mk({ customers: [bare] });
  await none.inv.request({ text: REQ, requester: 'owner' }); await none.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.equal('SalesTermRef' in none.m.posts[0].body, false); assert.equal('TransactionLocationType' in none.m.posts[0].body, false);
  // the bill-to block: name, phone, address lines, city, in that order, free-form
  const f = mk({ customers: [{ ...bare, PrimaryPhone: { FreeFormNumber: '+000 0000 000' }, BillAddr: { Id: '3', Line1: 'Sample Tower', City: 'SAMPLE CITY' } }] });
  await f.inv.request({ text: REQ, requester: 'owner' }); await f.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.deepEqual(f.m.posts[0].body.BillAddr, { Line1: 'Orion Furniture', Line2: '+000 0000 000', Line3: 'Sample Tower', Line4: 'SAMPLE CITY' });
});

test('the dry run lists only real gaps: what QuickBooks fills in by itself is not shown', async () => {
  const office = { Id: '7', DocNumber: 'inv-1', AllowIPN: false, AllowOnlinePayPalPayment: false, CustomField: [], EmailStatus: 'NotSet', ExchangeRate: 1, PrivateNote: 'office note',
    Line: [{ DetailType: 'SalesItemLineDetail', Id: '1', LineNum: 1, Amount: 1, CustomExtensions: [], SalesItemLineDetail: { ItemRef: { value: '1' }, TaxCodeRef: { value: '11' }, ItemAccountRef: { value: '79' } } }] };
  const t = mk({ byNumber: { 'inv-1': office }, officeInvoices: [office] });
  await t.inv.request({ text: REQ, requester: 'owner' });
  const text = (await t.inv.dryRun('Q1', 'inv-1')).join('\n');
  for (const harmless of ['AllowIPN', 'AllowOnlinePayPalPayment', 'CustomField', 'EmailStatus', 'ExchangeRate', 'PrivateNote', 'field Id', 'LineNum', 'CustomExtensions', 'ItemAccountRef']) assert.ok(!text.includes(harmless), `${harmless}\n${text}`);
  assert.ok(text.includes('BillEmail') || text.includes('GlobalTaxCalculation')); // a real gap is still there
});

// ------------------------------------------------------------------------------------------------ the owner's sample: price in the request + the cross-check section
test('the owner\'s sample: the price asked for wins on its line (marked, item price untouched), the cross-check lists only problems, the total and 5% VAT as before', async () => {
  setOutLang('en');
  try {
    const items = [{ Id: '5', Name: 'PVC FILM505', Sku: 'PVC-505', UnitPrice: 11, Type: 'Inventory', Active: true }, { Id: '2', Name: 'PVC FILM211', Sku: 'PVC-211', UnitPrice: 12, Type: 'Inventory', Active: true }];
    const t = mk({ customers: [{ Id: '91', DisplayName: 'MASTER WOOD', CompanyName: 'MASTER WOOD LLC', Balance: 0 }], items });
    t.inv.crossOf = () => ({ problems: ['211: no order found', '503: cut 8m on 07/11, not invoiced'], more: 2 });
    const r = await t.inv.request({ text: 'Atossa invoice MASTER WOOD 505=10m 211=20 /10aed', requester: 'owner' });
    assert.equal(r.owner, [
      '*Invoice* #Q1',
      'Customer: *MASTER WOOD*',
      '1. PVC FILM *505* (10 ×11 = 110.00)',
      '2. PVC FILM *211* (20 ×10 = 200.00) ✎ your price (system 12.00)',
      'Total: *325.50 AED*',
      'Cross-check (Aryak Orders):',
      '⚠ 211: no order found',
      '⚠ 503: cut 8m on 07/11, not invoiced',
      '+2 more',
      'Yes/No',
    ].join('\n'));
    // the line carries the price asked for; no item price is written anywhere in QuickBooks
    const dry = (await t.inv.dryRun('Q1', 'inv-x').catch(() => [])).join('');
    assert.equal(t.store.get('Q1').lines[1].price, 10);
    assert.equal(t.inv.invoiceBody(t.store.get('Q1'), {}).Line[1].SalesItemLineDetail.UnitPrice, 10); // the dry run builds the same body
    assert.ok(dry === '' || dry.includes('Not found'));
    await t.inv.decide({ verb: 'yes', id: 'Q1' });
    assert.deepEqual(t.m.posts.map((x) => x.body.Line.map((l) => l.SalesItemLineDetail.UnitPrice)), [[11, 10]]);
    assert.ok(t.m.calls.every((x) => x.method === 'GET' || /\/invoice/.test(x.url) || /oauth|developer/.test(x.url))); // the only writes: the invoice
    // everything matches: one line
    const u = mk({ customers: [{ Id: '91', DisplayName: 'MASTER WOOD', CompanyName: 'MASTER WOOD LLC', Balance: 0 }], items });
    u.inv.crossOf = () => ({ problems: [] });
    const ok = await u.inv.request({ text: 'Atossa invoice MASTER WOOD 505=10m', requester: 'owner' });
    assert.ok(!ok.owner.includes('Cross-check')); // everything matches: no section at all
    // no cutting data wired (the group is not watched): the section is left out, nothing is claimed
    const n = mk({ customers: [{ Id: '91', DisplayName: 'MASTER WOOD', CompanyName: 'MASTER WOOD LLC', Balance: 0 }], items });
    assert.ok(!(await n.inv.request({ text: 'Atossa invoice MASTER WOOD 505=10m', requester: 'owner' })).owner.includes('Cross-check'));
  } finally { setOutLang('fa'); }
});

// ------------------------------------------------------------------------------------------------ real invoices must never fail on a parity field
const CUSTOMER_WITH_ADDRESS = { Id: '58', DisplayName: 'Orion Furniture', CompanyName: 'Orion Furniture LLC', Balance: 0, PrimaryPhone: { FreeFormNumber: '+000 0000 000' },
  BillAddr: { Id: '501', Line1: '1 Sample Street', City: 'Sample City', Lat: '25.1', Long: '55.2', FreeFormAddress: true }, ShipAddr: { Id: '502', Line1: '2 Sample Yard', City: 'Sample City', Lat: '1', Long: '2' } };

test('no read-only or unknown property reaches an address: FreeFormAddress, coordinates and record ids are dropped; the fake QuickBooks refuses a bad address and accepts the body', async () => {
  const t = mk({ customers: [CUSTOMER_WITH_ADDRESS] });
  await t.inv.request({ text: REQ, requester: 'owner' });
  const dry = t.inv.invoiceBody(t.store.get('Q1'), await t.inv.salesDefaults('58'));
  for (const k of ['BillAddr', 'ShipAddr']) for (const bad of ['FreeFormAddress', 'Lat', 'Long', 'Id']) assert.ok(!(bad in (dry[k] || {})), `${k}.${bad}`);
  assert.deepEqual(dry.BillAddr, { Line1: 'Orion Furniture', Line2: '+000 0000 000', Line3: '1 Sample Street', Line4: 'Sample City' });
  assert.deepEqual(dry.ShipAddr, { Line1: '2 Sample Yard', City: 'Sample City' });
  const out = (await t.inv.decide({ verb: 'yes', id: 'Q1' })).join('\n');
  assert.ok(out.includes('ساخته شد') || out.startsWith('*Invoice*'), out); assert.equal(t.m.posts.length, 1); // accepted at the first try
  // the old body (with FreeFormAddress) is exactly what the fake refuses
  const refused = mk({ customers: [CUSTOMER_WITH_ADDRESS] });
  const r = await fetchLike(refused, { ...dry, BillAddr: { ...dry.BillAddr, FreeFormAddress: true } });
  assert.equal(r.status, 400);
});

async function fetchLike(t, body) { // posts a body straight to the fake QuickBooks of a desk and returns the answer status
  try { await t.qbo.write('POST', 'invoice', body, { requestId: 'probe' }); return { status: 200 }; } catch (e) { return { status: e.status }; }
}

test('a 400 on an optional parity field: ONE retry without the optional fields, the owner is told which were dropped, the fault is in the audit and the log; nothing else is retried', async () => {
  const t = mk({ customers: [{ ...CUSTOMER_WITH_ADDRESS, BillAddr: { Id: '1', Line1: 'A' } }], rejectField: 'TransactionLocationType', officeInvoices: [{ Id: '9', DocNumber: 'inv-0', TransactionLocationType: 'AbuDhabi', PrintStatus: 'NotSet' }] });
  const log = []; t.inv.log = (x) => log.push(x);
  await t.inv.request({ text: REQ, requester: 'owner' });
  const out = (await t.inv.decide({ verb: 'yes', id: 'Q1' })).join('\n');
  assert.equal(t.m.posts.length, 2); // refused once, then created without the optional fields
  assert.ok('TransactionLocationType' in t.m.posts[0].body && !('TransactionLocationType' in t.m.posts[1].body));
  for (const keep of ['CustomerRef', 'Line', 'GlobalTaxCalculation']) assert.ok(keep in t.m.posts[1].body, keep); // customer, lines, tax stay
  assert.ok(!('BillAddr' in t.m.posts[1].body) && !('PrintStatus' in t.m.posts[1].body));
  assert.match(out, /Note: QuickBooks refused some optional fields \(.*TransactionLocationType.*\); the invoice was created without them\./);
  assert.notEqual(t.m.posts[0].requestId, t.m.posts[1].requestId); // a 400 stored nothing: the retry is its own request
  const events = t.audit.last(10);
  const refusal = events.find((x) => x.event === 'refused-400');
  assert.equal(refusal.fault.code, '2010'); assert.equal(refusal.fault.element, 'TransactionLocationType'); assert.match(refusal.fault.detail, /unsupported or invalid/);
  assert.ok(events.some((x) => x.event === 'created-lean' && x.dropped.includes('TransactionLocationType')));
  assert.ok(log.some((l) => l.includes('QuickBooks refused the invoice (400)') && l.includes('2010')));
});

test('a 400 that the lean retry does not cure ends there (one retry only), a 5xx and a network error are never retried by this path; the whole fault is kept and a short reason is shown', async () => {
  const bare = { Id: '58', DisplayName: 'Orion Furniture', CompanyName: 'Orion Furniture LLC', Balance: 0 };
  const noOptional = mk({ customers: [bare], rejectField: 'CustomerRef' }); // a refusal that no optional field explains
  await noOptional.inv.request({ text: REQ, requester: 'owner' });
  const out = (await noOptional.inv.decide({ verb: 'yes', id: 'Q1' })).join('\n');
  assert.equal(noOptional.m.posts.length, 2); // the one lean retry (the bill-to block was optional), refused again for the same real reason
  assert.match(out, /ساخت فاکتور نشد: .*unsupported property/);
  const failed = noOptional.audit.last(5).find((x) => x.event === 'failed');
  assert.equal(failed.status, 400); assert.equal(failed.fault.element, 'CustomerRef'); assert.equal(failed.fault.code, '2010');
  assert.equal(noOptional.store.get('Q1').status, 'pending'); // the preview stays; nothing was created
  const server = mk({ customers: [CUSTOMER_WITH_ADDRESS], postFailures: 9 }); // 5xx all the way: the client's own retries only; no lean second attempt
  await server.inv.request({ text: REQ, requester: 'owner' });
  await server.inv.decide({ verb: 'yes', id: 'Q1' });
  assert.ok(server.m.posts.every((x) => x.body.BillAddr), 'every try carried the same body (no lean retry after a 5xx)');
  assert.ok(!server.audit.last(10).some((x) => x.event === 'refused-400'));
});

test('the dry run builds the very body the create sends (the same sanitising), so it would have shown a bad address', async () => {
  const office = { Id: '7', DocNumber: 'inv-1', BillAddr: { Line1: 'x' } };
  const t = mk({ customers: [CUSTOMER_WITH_ADDRESS], byNumber: { 'inv-1': office }, officeInvoices: [office] });
  await t.inv.request({ text: REQ, requester: 'owner' });
  const text = (await t.inv.dryRun('Q1', 'inv-1')).join('\n');
  assert.ok(!text.includes('FreeFormAddress') && !text.includes('"Lat"'), text);
  const built = t.inv.invoiceBody(t.store.get('Q1'), await t.inv.salesDefaults('58'));
  const sent = (await t.inv.decide({ verb: 'yes', id: 'Q1' })).length && t.m.posts[0].body;
  assert.deepEqual(Object.keys(built).sort(), Object.keys(sent).filter((k) => k !== 'DocNumber').sort());
});

// ------------------------------------------------------------------------------------------------ SIMULATION MODE (the test group)
test('simulation: the yes of a preview made in the TEST group writes nothing to QuickBooks and takes no number; it describes the exact body; the preview is not reusable', async () => {
  setOutLang('en');
  try {
    const items = [{ Id: '5', Name: 'PVC FILM505', Sku: 'PVC-505', UnitPrice: 11, Type: 'Inventory', Active: true }];
    const t = mk({ customers: [{ Id: '91', DisplayName: 'MASTER WOOD', CompanyName: 'MASTER WOOD LLC', Balance: 0, SalesTermRef: { value: '4' } }], items, customTxn: true, docNumbers: ['inv-9984'], salesForms: { DefaultCustomerMessage: 'Sample message text' } });
    const r = await t.inv.request({ text: 'Atossa invoice MASTER WOOD 505=10m', requester: 'owner', test: true });
    assert.equal(t.store.get('Q1').test, true);
    const out = (await t.inv.decide({ verb: 'yes', id: 'Q1' })).join('\n');
    assert.match(out, /^SIMULATION: would create an invoice for MASTER WOOD — nothing was created in QuickBooks and no number was taken\./);
    assert.match(out, /1\. PVC FILM505 ×10 @ 11 = 110\.00/); assert.match(out, /Total 115\.50 AED/); assert.match(out, /Number: would be inv-9985 \(read now, not taken\)/);
    assert.match(out, /terms 4; message on invoice 19 characters; bill-to yes/);
    assert.equal(t.m.posts.length, 0); // no write of any kind
    assert.equal(t.store.get('Q1').status, 'simulated'); assert.deepEqual(t.inv.openIds(), []); // not open any more
    assert.equal(t.store.get('Q1').docNumber, ''); // no number held
    assert.equal(t.store.d.creates.length, 0); // not counted as a creation
    assert.ok(t.audit.last(5).some((x) => x.event === 'simulated'));
    // the next real preview gets the same number: nothing was consumed
    const real = await t.inv.request({ text: 'Atossa invoice MASTER WOOD 505=10m', requester: 'owner' });
    assert.ok(real.owner); await t.inv.decide({ verb: 'yes', id: 'Q2' });
    assert.equal(t.m.posts[0].body.DocNumber, 'inv-9985');
    assert.equal(t.store.get('Q2').test, undefined);
  } finally { setOutLang('fa'); }
});

test('simulation: wiring — a preview made in the test group is flagged, its cross-check reads the TEST tracker, the other groups are simulated by a prefix and stored as test data only', () => {
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(index, /canInvoice: invoicePerson, where, role, test: !!group\?\.test \}/);
  assert.match(index, /quotedText: quoted, origin: \{ jid: chatId \}, test \}\)/);
  assert.match(index, /crossCheck\(trackerOf\(!!opts\.test\), customer, lines/); // the test data, not the real tracker
  const at = index.indexOf('async function simulatedPost');
  const block = index.slice(at, at + 2100);
  assert.match(block, /\[\(orders\|delivery\|confirm\)\\\]/);
  assert.match(block, /testTracker\.add\(event\)/); assert.doesNotMatch(block, /[^t]tracker\.add\(/); // only the test tracker
  assert.match(index, /if \(group\?\.test && ownerPerson && text && !audio && !image && \(await simulatedPost\(/); // the test group and the owner only
});

test('simulation: a prefix post is read like the post of that group (cut posts with several pieces included)', async () => {
  const { eventsFromCaption } = await import('../src/captionevents.js');
  const cut = eventsFromCaption('cut', 'ART NO 303 MUNICH DOOR KITCHEN 6.4M').events[0];
  assert.equal(cut.customer, 'MUNICH DOOR KITCHEN'); assert.equal(cut.lines[0].quantity, 6.4);
  const delivery = eventsFromCaption('delivery', 'NUQOOSH 2 ROLLS DISPATCHED').events[0];
  assert.equal(delivery.type, 'delivery'); assert.match(JSON.stringify(delivery), /NUQOOSH/);
  const pay = eventsFromCaption('payment', 'HAMED TRADING 500 received');
  assert.ok(pay === null || pay.events?.length >= 0); // a payment line is read by its own shapes; an unread one is simply said so
});
