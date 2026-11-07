import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Qbo, QboError } from '../src/qbo.js';
import { QboDesk, QboMap, pickTestGroup } from '../src/qbodesk.js';
import { Aliases } from '../src/aliases.js';
import { CustomerGroups } from '../src/customergroups.js';
import { Audit, AuthStore, CAP_DAY, CAP_HOUR, EXPIRY_MS, InvoiceStore, QboInvoiceDesk, findVatCode, itemsNamed, lineCandidates, parseInvoiceCommand, resolveLines, totals } from '../src/qboinvoice.js';

// Invented names, items, numbers and amounts only: nothing real is ever in the repository.
const REALM = '9130000000';
const OWNER_JID = '971500000000@s.whatsapp.net';
const GROUPS = [{ id: 'test@g.us', subject: 'TEST ARYAK BOT' }, { id: 'orion@g.us', subject: 'ORION - ARYAK' }, { id: 'staff@g.us', subject: 'Aryak Staff' }];
const ITEMS = [
  { Id: '1', Name: 'Hinge 35mm', Sku: 'H35', UnitPrice: 2.5, Type: 'Inventory', Active: true },
  { Id: '2', Name: 'Edge Tape White', Sku: 'ET-W', UnitPrice: 1.2, Type: 'Inventory', Active: true },
  { Id: '3', Name: 'Handle Steel', Sku: 'HS-1', UnitPrice: 0, Type: 'Inventory', Active: true },
  { Id: '4', Name: 'Hinge', Sku: 'H', UnitPrice: 1, Type: 'Inventory', Active: true },
];
const CUSTOMERS = [{ Id: '58', DisplayName: 'Orion Furniture', CompanyName: 'Orion Furniture LLC', Balance: 0 }, { Id: '59', DisplayName: 'Cedar Wood Works', Balance: 0 }];
const TAXCODES = [
  { Id: '11', Name: '5% S', Taxable: true, Active: true, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: '5' } }] } },
  { Id: '12', Name: 'Zero rated', Taxable: true, Active: true, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: '6' } }] } },
  { Id: 'NON', Name: 'Out of scope', Taxable: false, Active: true },
];
const TAXRATES = [{ Id: '5', RateValue: 5 }, { Id: '6', RateValue: 0 }];

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
      const inv = { Id: String(900 + n), DocNumber: String(2000 + n), TotalAmt: opts.totalOverride ?? Math.round(sum * 1.05) / 100 };
      invoices.set(inv.Id, inv); if (requestId) byRequest.set(requestId, inv);
      return res(200, { Invoice: inv });
    }
    if (p.endsWith('/pdf')) return opts.pdfFails ? res(500, {}) : res(200, {}, { bytes: '%PDF-1.4 fake invoice' });
    const one = /\/invoice\/(\d+)$/.exec(p);
    if (one) return res(200, { Invoice: invoices.get(one[1]) });
    if (p.includes('/preferences')) return res(200, { Preferences: { CurrencyPrefs: { HomeCurrency: { value: 'AED' } } } });
    if (p.includes('/companyinfo/')) return res(200, { CompanyInfo: { CompanyName: 'The Test Workshop', Country: 'AE' } });
    const sql = u.searchParams.get('query') || '';
    const ent = /from\s+(\w+)/i.exec(sql)[1];
    const rows = { Customer: CUSTOMERS, Item: ITEMS, TaxCode: opts.taxCodes || TAXCODES, TaxRate: TAXRATES, Invoice: [], Payment: [], CreditMemo: [] }[ent] || [];
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
  const inv = new QboInvoiceDesk({ qbo, desk, store, audit, book, config, today: () => '2026-11-08', now: () => clock.t, post, ownerJid: () => OWNER_JID, groups: async () => GROUPS, testGroup: (g) => pickTestGroup(g, config), log: () => {} });
  return { dir, m, clock, config, qbo, desk, inv, store, audit, sent, map, list };
}
const REQ = 'فاکتور بساز Orion Furniture\nHinge 35mm, 10\nEdge Tape White, 3, 1.1';

test('the words: the request with its lines, yes and no with the preview id, the kill switch, the audit report, the authorized people', () => {
  assert.deepEqual(parseInvoiceCommand(REQ), { type: 'request', customer: 'Orion Furniture', lines: ['Hinge 35mm, 10', 'Edge Tape White, 3, 1.1'] });
  assert.deepEqual(parseInvoiceCommand('آتوسا فاکتور بساز Cedar\nH35 4'), { type: 'request', customer: 'Cedar', lines: ['H35 4'] });
  assert.deepEqual(parseInvoiceCommand('بله #Q12'), { type: 'yes', id: 'Q12' });
  assert.deepEqual(parseInvoiceCommand('بله #Q۱۲'), { type: 'yes', id: 'Q12' });
  assert.deepEqual(parseInvoiceCommand('نه Q3'), { type: 'no', id: 'Q3' });
  assert.equal(parseInvoiceCommand('بله'), null); // a bare yes belongs to other conversations
  assert.deepEqual(parseInvoiceCommand('توقف کوییک‌بوکس'), { type: 'pause' });
  assert.deepEqual(parseInvoiceCommand('ادامهٔ کوییک‌بوکس'), { type: 'resume' });
  assert.deepEqual(parseInvoiceCommand('گزارش کوییک‌بوکس'), { type: 'audit' });
  assert.deepEqual(parseInvoiceCommand('مجوز فاکتور 971 50 111 2222'), { type: 'auth_add', number: '971 50 111 2222' });
  assert.deepEqual(parseInvoiceCommand('لغو مجوز فاکتور 971501112222'), { type: 'auth_remove', number: '971501112222' });
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

test('the VAT code is READ from QuickBooks: the 5% sales code; none or several stop with the candidates; the setting can name one', () => {
  assert.deepEqual(findVatCode(TAXCODES, TAXRATES), { id: '11', name: '5% S', rate: 5 });
  assert.ok(findVatCode([TAXCODES[1], TAXCODES[2]], TAXRATES).error.includes('۵ درصد'));
  const two = [...TAXCODES, { Id: '13', Name: 'Standard Rate', Taxable: true, Active: true, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: '5' } }] } }];
  assert.equal(findVatCode(two, TAXRATES).name, 'Standard Rate'); // "standard" breaks the tie
  const same = [...TAXCODES, { Id: '14', Name: 'Other five', Taxable: true, Active: true, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: '5' } }] } }];
  assert.ok(findVatCode(same, TAXRATES).error.includes('QBO_TAX_CODE'));
  assert.equal(findVatCode(same, TAXRATES, 'Other five').id, '14');
  assert.deepEqual(totals([{ amount: 2500 }, { amount: 330 }], 5), { subtotal: 2830, vat: 142, total: 2972 });
});

test('a request becomes a PREVIEW for the owner: customer, lines, subtotal, VAT and total as QuickBooks will add them; nothing is created', async () => {
  const t = mk({ book: { priceOf: (code) => (code === 'ET-W' ? { price: 1.3 } : null) } });
  const r = await t.inv.request({ text: REQ, requester: '971501112222' });
  assert.ok(r.requester.includes('#Q1') && r.requester.includes('sent to the owner for approval'));
  for (const s of ['پیش‌نمایش فاکتور #Q1', 'Orion Furniture', 'Hinge 35mm × 10 @ 2.5 = 25.00', 'Edge Tape White × 3 @ 1.1 = 3.30', 'جمع قبل از مالیات: 28.30', 'مالیات 5٪ (5% S): 1.42', 'جمع کل: 29.72 AED', 'بله #Q1', 'نه #Q1']) assert.ok(r.owner.includes(s), s);
  assert.ok(r.owner.includes('سطر ۲') && r.owner.includes('کمتر از قیمت کوییک‌بوکس (1.2)') && r.owner.includes('کمتر از فهرست قیمت مالک (1.3)'));
  assert.equal(t.m.posts.length, 0);
  assert.equal(t.store.get('Q1').status, 'pending');
  assert.equal(t.audit.last(5)[0].event, 'preview');
  assert.ok(!JSON.stringify(t.audit.last(5)).includes('Hinge')); // the audit log has no message text and no lines
});

test('an unknown customer or item stops with "map this first" and the candidates; a near name is never guessed', async () => {
  const t = mk();
  const unknown = await t.inv.request({ text: 'فاکتور بساز Orion Furnitur\nH35, 1', requester: 'owner' });
  assert.equal(unknown.owner, null);
  assert.ok(unknown.requester.includes('تطبیق کوییک‌بوکس') && unknown.requester.includes('Orion Furniture')); // the near name is only SHOWN
  assert.equal(t.store.d.n, 0);
  const item = await t.inv.request({ text: 'فاکتور بساز Orion Furniture\nHinge 35, 1', requester: 'owner' });
  assert.ok(item.requester.includes('دقیقاً پیدا نشد') && item.requester.includes('Hinge 35mm'));
  const none = await t.inv.request({ text: 'فاکتور بساز Orion Furniture', requester: 'owner' });
  assert.ok(none.requester.includes('هر کالا را در یک سطر'));
  const noPrice = await t.inv.request({ text: 'فاکتور بساز Orion Furniture\nHS-1, 2', requester: 'owner' });
  assert.ok(noPrice.requester.includes('قیمتی نیست'));
  assert.equal(t.store.d.n, 0); // no id is spent on a request that stopped
  assert.equal(t.m.posts.length, 0);
  // an auto-matched (fuzzy) choice from the statement is not enough; the owner's confirmed one is
  t.map.set('Cedar Wood', '59', 'Cedar Wood Works', 'auto');
  assert.equal((await t.inv.request({ text: 'فاکتور بساز Cedar Wood\nH35, 1', requester: 'owner' })).owner, null);
  t.map.set('Cedar Wood', '59', 'Cedar Wood Works', 'owner');
  assert.ok((await t.inv.request({ text: 'فاکتور بساز Cedar Wood\nH35, 1', requester: 'owner' })).owner.includes('Cedar Wood Works'));
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
