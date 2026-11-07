import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Qbo } from '../src/qbo.js';
import { QboDesk, QboMap } from '../src/qbodesk.js';
import { Aliases } from '../src/aliases.js';
import { CustomerGroups } from '../src/customergroups.js';
import { Audit, ItemCodes, parseInvoiceCommand, codeFromInvoices } from '../src/qboinvoice.js';
import { BulkPreviews, PriceDraft, QboBulkDesk, phoneKind, planMobiles, planPrices, seriesItems, planCatalog, categoryCandidates, planEdgeList, planOldEdge, planEdgeNames } from '../src/qbobulk.js';

// Invented data only: nothing real is ever in the repository.
const REALM = '9130000000';
const MAIL = 'office@example.test';
const res = (status, json) => ({ status, ok: status >= 200 && status < 300, json: async () => json, arrayBuffer: async () => Buffer.from(''), headers: { get: () => null } });
const ph = (n) => ({ FreeFormNumber: n });
const C = (Id, DisplayName, extra = {}) => ({ Id: String(Id), SyncToken: '0', DisplayName, Active: true, Balance: 5, ...extra });
const baseCustomers = () => [
  C(1, 'Alpha Wood', { PrimaryPhone: ph('0501234567'), PrimaryEmailAddr: { Address: 'old@x.test' } }),
  C(2, 'Beta Doors', { PrimaryPhone: ph("'+971 50 111 2222 "), AlternatePhone: ph('04 333 4444'), PrimaryEmailAddr: { Address: MAIL } }),
  C(3, 'Gamma Kitchens', { PrimaryPhone: ph('04 555 6666') }), // a landline: skipped
  C(4, 'Delta Oman', { PrimaryPhone: ph('96891234567'.slice(0, 11)) }), // 968 9 + 7 digits = Oman mobile
  C(5, 'Epsilon', { PrimaryPhone: ph('0509999999'), Mobile: ph('0508888888') }), // has a mobile: untouched
  C(6, 'Zeta', {}), // no phone
  C(7, 'Eta Landline First', { PrimaryPhone: ph('02 123 4567'), AlternatePhone: ph('055 123 4567') }), // the alternate is the mobile
  C(8, 'Theta Oman Local', { PrimaryPhone: ph('91234567'), BillAddr: { Country: 'Oman' } }),
  C(9, 'Iota Odd', { PrimaryPhone: ph('12345') }),
];
const I = (Id, Name, extra = {}) => ({ Id: String(Id), SyncToken: '0', Name, Type: 'Inventory', Active: true, UnitPrice: 10, ...extra });
const baseItems = () => [
  I(1, 'PVC FILM108', { Sku: '108', UnitPrice: 10, PurchaseCost: 8, SalesTaxCodeRef: { value: 'OLD' } }),
  I(2, 'PVC FILM109', { Sku: '109', UnitPrice: 20, SalesTaxCodeRef: { value: 'DXBID' } }),
  I(3, 'Hinge 35', { Type: 'NonInventory', UnitPrice: 5 }),
  I(4, 'Labour', { Type: 'Service', UnitPrice: 0 }),
  I(5, 'Bundle X', { Type: 'Group' }),
  I(6, 'PVC TWIN 7', { Sku: 'TW7' }), I(7, 'PVC TWIN 8', { Sku: 'TW8' }),
];

function mockQbo(opts = {}) {
  const db = { Customer: opts.customers || baseCustomers(), Item: opts.items || baseItems(), TaxCode: opts.taxCodes || [{ Id: 'DXBID', Name: 'SR Standard Rated (DXB)', Active: true }, { Id: 'OLD', Name: 'Other', Active: true }] };
  const posts = []; let postsSeen = 0;
  const fetchFn = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'developer.intuit.com') return res(200, { authorization_endpoint: 'https://a.test/auth', token_endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', revocation_endpoint: 'https://a.test/revoke' });
    if (u.hostname.startsWith('oauth.')) return res(200, { access_token: 'ACCESS-X', refresh_token: 'REFRESH-X', expires_in: 3600 });
    const one = /\/(customer|item)\/(\d+)$/.exec(u.pathname);
    const key = (e) => (e === 'customer' ? 'Customer' : 'Item');
    if (one && (init.method || 'GET') === 'GET') { const r = db[key(one[1])].find((x) => x.Id === one[2]); return res(r ? 200 : 404, { [key(one[1])]: r && JSON.parse(JSON.stringify(r)) }); }
    if (init.method === 'POST') {
      const ent = u.pathname.endsWith('/customer') ? 'customer' : 'item';
      postsSeen += 1; const body = JSON.parse(init.body); posts.push({ ent, body });
      if (opts.failOnPost && postsSeen === opts.failOnPost) return res(403, { Fault: { Error: [{ Message: 'Business Validation Error' }] } });
      if (opts.rejectIds?.includes(body.Id)) return res(400, { Fault: { Error: [{ Message: 'Business Validation Error', Detail: 'Income account is inactive', code: '6000', element: 'IncomeAccountRef' }] } });
      if (opts.serverErrorOn && body.Id === opts.serverErrorOn) return res(503, {});
      if (body.Id === undefined) { const n = { Id: String(900 + db.Item.length), SyncToken: '0', Active: true, ...body }; db.Item.push(n); return res(200, { Item: n }); } // a create
      const r = db[key(ent)].find((x) => x.Id === body.Id);
      for (const [k, v] of Object.entries(body)) if (!['Id', 'SyncToken', 'sparse'].includes(k)) r[k] = v; // a sparse update changes only what is sent
      if (body.SubItem === false) delete r.ParentRef; // a top-level item has no parent
      if (body.ParentRef) r.FullyQualifiedName = `${db.Item.find((x) => x.Id === body.ParentRef.value).Name}:${r.Name}`;
      r.SyncToken = String(Number(r.SyncToken) + 1);
      return res(200, { [key(ent)]: r });
    }
    const sql = u.searchParams.get('query') || '';
    const ent = /from\s+(\w+)/i.exec(sql)[1];
    return res(200, { QueryResponse: { [ent]: db[ent] || [] } });
  };
  return { fetchFn, posts, db };
}

function mk(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-'));
  fs.writeFileSync(path.join(dir, 'qbo-tokens.json'), JSON.stringify({ refresh: 'R-1', access: '', accessExpiresAt: 0, initHash: '', realmId: REALM, needsReconnect: false }));
  const m = mockQbo(opts);
  const clock = { t: Date.parse('2026-11-08T08:00:00Z') };
  const config = { qboClientId: 'c', qboClientSecret: 's', qboEnv: 'production', qboRealmId: '', qboRefreshInit: '', qboWrite: opts.write !== false, qboMinorVersion: 75, testGroupNames: [], staffGroupNames: [], observeExcludeNames: [], shadowGroupNames: ['aryak'], qboCustomerEmail: MAIL };
  const qbo = new Qbo({ config, dir, fetchFn: m.fetchFn, now: () => clock.t, sleep: async () => {}, log: () => {} });
  const desk = new QboDesk({ qbo, list: new CustomerGroups(path.join(dir, 'cg')), aliases: new Aliases(''), map: new QboMap(path.join(dir, 'map')), config, groups: async () => [], post: async () => {}, today: () => '2026-11-08', sleep: async () => {}, log: () => {} });
  const audit = new Audit(path.join(dir, 'qbo'), () => clock.t);
  const itemCodes = new ItemCodes(path.join(dir, 'qbo'));
  const bulk = new QboBulkDesk({ qbo, desk, audit, store: new BulkPreviews(path.join(dir, 'qbo')), draft: new PriceDraft(path.join(dir, 'qbo')), itemCodes, config, now: () => clock.t, sleep: async () => {}, gapMs: 400, log: () => {} });
  const reports = [];
  const finished = () => new Promise((resolve) => { bulk.finish = async (parts) => { reports.push(...parts); resolve(parts.join('\n')); }; });
  return { dir, m, qbo, desk, audit, bulk, clock, config, reports, finished, itemCodes };
}
const only = (posts, ent, keys) => posts.filter((p) => p.ent === ent).every((p) => Object.keys(p.body).every((k) => ['Id', 'SyncToken', 'sparse', ...keys].includes(k)));

test('the words of the four jobs', () => {
  assert.deepEqual(parseInvoiceCommand('ایمیل مشتری‌ها'), { type: 'bulk_email', email: '' });
  assert.deepEqual(parseInvoiceCommand('ایمیل مشتری ها a@b.test'), { type: 'bulk_email', email: 'a@b.test' });
  assert.deepEqual(parseInvoiceCommand('موبایل مشتری‌ها'), { type: 'bulk_mobile' });
  assert.deepEqual(parseInvoiceCommand('مالیات کالاها دبی'), { type: 'bulk_tax' });
  assert.deepEqual(parseInvoiceCommand('بله #E1'), { type: 'yes', id: 'E1' });
  assert.deepEqual(parseInvoiceCommand('نه M2'), { type: 'no', id: 'M2' });
  assert.deepEqual(parseInvoiceCommand('بله #T1'), { type: 'yes', id: 'T1' });
  assert.deepEqual(parseInvoiceCommand('بله #P3'), { type: 'yes', id: 'P3' });
  assert.deepEqual(parseInvoiceCommand('شروع کن'), { type: 'price_start' });
  assert.deepEqual(parseInvoiceCommand('لیست قیمت'), { type: 'price_list' });
  assert.deepEqual(parseInvoiceCommand('حذف قیمت 108'), { type: 'price_remove', code: '108' });
  assert.deepEqual(parseInvoiceCommand('قیمت 108 = 12'), { type: 'price_set', lines: [{ code: '108', price: 12 }], bad: 0, unread: [] });
  assert.deepEqual(parseInvoiceCommand('قیمت PVC FILM108 = 12\nقیمت 109 = 13.5'), { type: 'price_set', lines: [{ code: 'PVC FILM108', price: 12 }, { code: '109', price: 13.5 }], bad: 0, unread: [] });
  assert.equal(parseInvoiceCommand('قیمت 108'), null); // the older price-book question is not ours
  assert.deepEqual(parseInvoiceCommand('قیمت 108 = 12\nسلام').unread, ['سلام']); // the line that is not a price is named, the rest is taken
});

test('phone kinds: UAE and Oman mobiles, landlines, the rest', () => {
  for (const n of ['0501234567', '+971501234567', '971501234567', '00971 50 123 4567', "'055-123-4567", '+968 9123 4567', '96891234567']) assert.equal(phoneKind(n), 'mobile', n);
  assert.equal(phoneKind('91234567'), 'other'); // 8 digits: a mobile only in Oman
  assert.equal(phoneKind('91234567', 'Oman'), 'mobile');
  for (const n of ['04 555 6666', '+97145556666', '02 123 4567']) assert.equal(phoneKind(n), 'landline', n);
  assert.equal(phoneKind('12345'), 'other');
  assert.equal(phoneKind(''), 'none');
  assert.equal(phoneKind('٠٥٠١٢٣٤٥٦٧'), 'mobile'); // Arabic digits
});

test('mobile plan: copy, never move; landline skipped; has-mobile untouched', () => {
  const r = planMobiles(baseCustomers());
  assert.deepEqual(r.changes.map((c) => [c.id, c.new, c.from]), [['1', '0501234567', 'PrimaryPhone'], ['2', '+971 50 111 2222', 'PrimaryPhone'], ['4', '96891234567', 'PrimaryPhone'], ['7', '055 123 4567', 'AlternatePhone'], ['8', '91234567', 'PrimaryPhone']]);
  assert.deepEqual(r.skipped.map((s) => [s.id, s.why]), [['3', 'landline'], ['9', 'other']]);
  assert.equal(r.hasMobile, 1); assert.equal(r.noPhone, 1);
});

test('E: the e-mail job changes only PrimaryEmailAddr, is idempotent, and needs the owner\'s yes', async () => {
  const t = mk();
  const [pv] = await t.bulk.planEmails();
  assert.match(pv, /#E1/);
  assert.equal(t.m.posts.length, 0); // the preview writes nothing
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'E1' });
  await done;
  assert.ok(t.m.posts.length >= 1);
  assert.ok(only(t.m.posts, 'customer', ['PrimaryEmailAddr']));
  assert.ok(t.m.db.Customer.every((c) => c.PrimaryEmailAddr?.Address === MAIL));
  assert.equal(t.m.db.Customer[0].PrimaryPhone.FreeFormNumber, '0501234567'); // nothing else touched
  // again: nothing to change
  const [again] = await t.bulk.planEmails();
  assert.match(again, /از پیش/);
  const n = t.m.posts.length;
  const d2 = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'E1' });
  assert.equal(t.m.posts.length, n); // done once: a second yes writes nothing
  void d2;
});

test('E: a bad or missing address stops before anything', async () => {
  const t = mk(); t.bulk.config = { ...t.config, qboCustomerEmail: '' };
  const [r] = await t.bulk.planEmails('not-an-address');
  assert.match(r, /ایمیل/);
  assert.equal(t.m.posts.length, 0);
});

test('M: the mobile job copies into Mobile only, keeps the phones, skips landlines, idempotent', async () => {
  const t = mk();
  const [pv] = await t.bulk.planMobiles();
  assert.match(pv, /#M1/);
  assert.match(pv, /رد شد: تلفن ثابت/);
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'M1' });
  const rep = await done;
  assert.ok(only(t.m.posts, 'customer', ['Mobile']));
  assert.equal(t.m.posts.length, 5);
  const by = (id) => t.m.db.Customer.find((c) => c.Id === id);
  assert.equal(by('1').Mobile.FreeFormNumber, '0501234567');
  assert.equal(by('1').PrimaryPhone.FreeFormNumber, '0501234567'); // copied, not moved
  assert.equal(by('2').Mobile.FreeFormNumber, '+971 50 111 2222'); // the apostrophe and the end spaces are gone, the text is as written
  assert.equal(by('7').Mobile.FreeFormNumber, '055 123 4567');
  assert.equal(by('7').PrimaryPhone.FreeFormNumber, '02 123 4567');
  assert.equal(by('3').Mobile, undefined); // landline
  assert.equal(by('5').Mobile.FreeFormNumber, '0508888888'); // already had one
  assert.match(rep, /۵ تغییر کرد/);
  const [again] = await t.bulk.planMobiles();
  assert.match(again, /موبایلی برای کپی نیست/);
});

test('T: the item tax job needs the code by name; stops if not found or twice; sets SalesTaxCodeRef only on the three item types', async () => {
  const none = mk({ taxCodes: [{ Id: 'X', Name: 'Other', Active: true }] });
  assert.match((await none.bulk.planItemTax())[0], /پیدا نشد/);
  const twice = mk({ taxCodes: [{ Id: 'A', Name: 'SR Standard Rated (DXB)', Active: true }, { Id: 'B', Name: 'sr standard rated (dxb)', Active: true }] });
  assert.match((await twice.bulk.planItemTax())[0], /بیش از یک/);
  assert.equal(twice.m.posts.length, 0);

  const t = mk();
  const [pv] = await t.bulk.planItemTax();
  assert.match(pv, /#T1/);
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'T1' });
  await done;
  assert.ok(only(t.m.posts, 'item', ['SalesTaxCodeRef']));
  const by = (id) => t.m.db.Item.find((i) => i.Id === id);
  for (const id of ['1', '2', '3', '4', '6', '7']) assert.equal(by(id).SalesTaxCodeRef.value, 'DXBID', id);
  assert.equal(by('5').SalesTaxCodeRef, undefined); // a Group is not one of the three types
  assert.equal(by('1').UnitPrice, 10); // nothing else touched
  assert.equal(t.m.posts.length, 5); // item 2 already had it
  assert.match((await t.bulk.planItemTax())[0], /از پیش/);
});

test('P: the draft takes lines one by one, resolves ONE item exactly, lists, removes, and survives a restart', async () => {
  const t = mk();
  const [r1] = await t.bulk.addPrices([{ code: '108', price: 12 }]);
  assert.match(r1, /PVC FILM108: 10 → 12/);
  assert.match(r1, /۱ خط/);
  const [r2] = await t.bulk.addPrices([{ code: 'pvc film109', price: 30 }, { code: 'pvc twin', price: 9 }, { code: 'nothing', price: 1 }]);
  assert.match(r2, /PVC FILM109: 20 → 30 ⚠️/); // more than 30%
  assert.match(r2, /چند کالا دارد/); // ambiguous: two twins, not taken
  assert.match(r2, /پیدا نشد/);
  assert.equal(t.bulk.draft.lines.length, 2);
  assert.match(t.bulk.showDraft()[0], /PVC FILM108/);
  // a restart: the same files, a new draft object
  const again = new PriceDraft(path.join(t.dir, 'qbo'));
  assert.equal(again.lines.length, 2);
  // the same item again replaces its line
  await t.bulk.addPrices([{ code: '108', price: 11 }]);
  assert.equal(t.bulk.draft.lines.length, 2);
  assert.equal(t.bulk.draft.lines.find((l) => l.itemId === '1').new, 11);
  assert.match(t.bulk.removePrice('108')[0], /برداشته شد/);
  assert.equal(t.bulk.draft.lines.length, 1);
  assert.match(t.bulk.removePrice('999')[0], /نبود/);
});

test('P: no draft means the older «لیست قیمت» and «شروع کن» are not ours', async () => {
  const t = mk();
  assert.equal(t.bulk.showDraft(), null);
  assert.equal(await t.bulk.planPrices(), null);
});

test('P: the preview warns (over 30%, below the purchase cost); the yes changes UnitPrice only, then the draft empties; idempotent', async () => {
  const t = mk();
  await t.bulk.addPrices([{ code: '108', price: 5 }, { code: '109', price: 21 }]);
  const [pv] = await t.bulk.planPrices();
  assert.match(pv, /#P1/);
  assert.match(pv, /بهای خرید/); // 5 < cost 8
  assert.match(pv, /۳۰٪/); // 10 -> 5 is 50%
  assert.equal(t.m.posts.length, 0);
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'P1' });
  await done;
  assert.ok(only(t.m.posts, 'item', ['UnitPrice']));
  const by = (id) => t.m.db.Item.find((i) => i.Id === id);
  assert.equal(by('1').UnitPrice, 5); assert.equal(by('2').UnitPrice, 21);
  assert.equal(by('1').SalesTaxCodeRef.value, 'OLD'); // nothing else
  assert.equal(t.bulk.draft.lines.length, 0);
  const n = t.m.posts.length;
  await t.bulk.decide({ verb: 'yes', id: 'P1' });
  assert.equal(t.m.posts.length, n);
});

test('P: a price equal to the current one is not a change', () => {
  const r = planPrices([{ itemId: '1', name: 'a', new: 10 }], baseItems());
  assert.equal(r.changes.length, 0); assert.equal(r.unchanged, 1);
});

test('only the owner\'s yes counts, a no cancels, write off refuses, kill switch refuses, expiry', async () => {
  const off = mk({ write: false });
  await off.bulk.planMobiles();
  const [refused] = await off.bulk.decide({ verb: 'yes', id: 'M1' });
  assert.match(refused, /خاموش/);
  assert.equal(off.m.posts.length, 0);

  const t = mk();
  await t.bulk.planEmails();
  assert.match((await t.bulk.decide({ verb: 'no', id: 'E1' }))[0], /لغو شد/);
  assert.match((await t.bulk.decide({ verb: 'yes', id: 'E1' }))[0], /لغو شده/);
  assert.equal(t.m.posts.length, 0);

  const k = mk(); await k.bulk.planEmails(); k.qbo.setPaused(true);
  assert.match((await k.bulk.decide({ verb: 'yes', id: 'E1' }))[0], /متوقف/);
  assert.equal(k.m.posts.length, 0);

  const e = mk(); await e.bulk.planEmails(); e.clock.t += 25 * 3600 * 1000;
  assert.match((await e.bulk.decide({ verb: 'yes', id: 'E1' }))[0], /منقضی/);
  assert.equal(e.m.posts.length, 0);

  assert.match((await e.bulk.decide({ verb: 'yes', id: 'E9' }))[0], /پیدا نشد/);
});

test('stops at the first unexpected error and says how far it got; a second yes finishes the rest', async () => {
  const t = mk({ failOnPost: 2 });
  await t.bulk.planEmails();
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'E1' });
  const rep = await done;
  assert.match(rep, /ایستاد/);
  assert.equal(t.m.posts.length, 2); // the second failed; nothing after it was tried
  const left = t.m.db.Customer.filter((c) => c.PrimaryEmailAddr?.Address !== MAIL).length;
  assert.ok(left >= 1);
  const d2 = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'E1' }); // pending again: the done ones are skipped
  await d2;
  assert.ok(t.m.db.Customer.every((c) => c.PrimaryEmailAddr?.Address === MAIL));
});

test('Qbo.write allows only the listed sparse field sets', async () => {
  const t = mk();
  const bad = async (path_, body) => assert.rejects(() => t.qbo.write('POST', path_, body), /only/);
  const base = { Id: '1', SyncToken: '0', sparse: true };
  await bad('customer', { ...base, PrimaryEmailAddr: { Address: 'a@b.test' }, Mobile: ph('050') }); // two jobs mixed
  await bad('customer', { ...base, PrimaryPhone: ph('050') });
  await bad('customer', { ...base, Active: false });
  await bad('customer', { Id: '1', SyncToken: '0', Mobile: ph('050') }); // not sparse
  await bad('customer', base); // no data field
  await bad('item', { ...base, SalesTaxCodeRef: { value: 'X' }, UnitPrice: 5 });
  await bad('item', { ...base, Active: false });
  await bad('item', { ...base, Name: 'x' });
  await bad('item', { Name: 'new item', Type: 'Service' }); // a create
  await assert.rejects(() => t.qbo.write('DELETE', 'item', base), /only/);
  await assert.rejects(() => t.qbo.write('POST', 'vendor', { ...base, DisplayName: 'x' }), /only/);
  assert.equal(t.m.posts.length, 0);
  await t.qbo.write('POST', 'item', { ...base, UnitPrice: 5 });
  await t.qbo.write('POST', 'customer', { ...base, Mobile: ph('050') });
  assert.equal(t.m.posts.length, 2);
});

test('the invoice tax rule: the owner\'s choice, then the items\' own code, then the history', async () => {
  const { QboInvoiceDesk, InvoiceStore, TaxChoices } = await import('../src/qboinvoice.js');
  const t = mk();
  const taxChoices = new TaxChoices(path.join(t.dir, 'qbo'));
  const desk = new QboInvoiceDesk({ qbo: t.qbo, desk: t.desk, store: new InvoiceStore(path.join(t.dir, 'qbo')), audit: t.audit, taxChoices, itemCodes: t.itemCodes, config: t.config, today: () => '2026-11-08', log: () => {} });
  const codes = new Map([['DXBID', { id: 'DXBID', name: 'SR Standard Rated (DXB)', rate: 5 }], ['OLD', { id: 'OLD', name: 'Other', rate: 0 }]]);
  const cat = { codes };
  const cust = { id: '1', name: 'Alpha Wood' };
  const item = (v) => ({ SalesTaxCodeRef: v ? { value: v } : undefined });
  // no owner choice, items agree: the item's code, with its source named
  const a = await desk.taxFor(cust, cat, [], [item('DXBID'), item('DXBID')]);
  assert.equal(a.id, 'DXBID'); assert.equal(a.source, 'item');
  // items disagree or have none: the history rule (no history here: asks)
  assert.ok((await desk.taxFor(cust, cat, [], [item('DXBID'), item('OLD')])).error);
  assert.ok((await desk.taxFor(cust, cat, [], [item('DXBID'), item(null)])).error);
  // the owner's choice for the customer wins over the items
  taxChoices.set('1', codes.get('OLD'));
  const b = await desk.taxFor(cust, cat, [], [item('DXBID')]);
  assert.equal(b.id, 'OLD'); assert.equal(b.source, 'owner');
  void codeFromInvoices;
});

// ---- the PVC series
const pvcItems = () => {
  const items = [];
  for (let c = 101; c <= 126; c += 1) if (c !== 113) items.push(I(c, `PVC FILM${c}`, { Sku: String(c), UnitPrice: c <= 120 ? 10 : 11, PurchaseCost: 4 }));
  items.push(I(201, 'PVC FILM201', { UnitPrice: 30 }), I(1810, 'PVC FILM1810', { UnitPrice: 99 }), I(150, 'EDGE BAND 150', { UnitPrice: 50 }), I(160, 'PVC FILM160', { UnitPrice: 8, Active: false }));
  return items;
};

test('the words of the series: digits in any script, no space, = or : or nothing, and an explicit range', () => {
  const s = (t) => parseInvoiceCommand(t).lines;
  assert.deepEqual(s('قیمت سری 100 = 12'), [{ series: 100, price: 12 }]);
  assert.deepEqual(s('قیمت سری۱۰۰=۱۲'), [{ series: 100, price: 12 }]);
  assert.deepEqual(s('قیمت سری ١٠٠ : ١٢'), [{ series: 100, price: 12 }]);
  assert.deepEqual(s('قیمت سری 100 12'), [{ series: 100, price: 12 }]);
  assert.deepEqual(s('قیمت 101 تا 126 = 12'), [{ from: 101, to: 126, price: 12 }]);
  assert.deepEqual(s('قیمت ۱۰۱ تا ۱۲۶ ۱۲'), [{ from: 101, to: 126, price: 12 }]);
  assert.deepEqual(s('قیمت 108 : 13'), [{ code: '108', price: 13 }]);
});

test('the series code rule: only three-digit PVC film codes; never edge banding, four digits, or inactive', () => {
  const items = pvcItems();
  const f = seriesItems(items, 101, 199);
  assert.equal(f.length, 25);
  assert.ok(f.every((x) => /PVC FILM1\d\d$/.test(x.item.Name)));
  assert.equal(seriesItems(items, 1801, 1899).length, 1); // 1810 is a four-digit code: in series 1800 only
  assert.equal(seriesItems(items, 101, 199).some((x) => x.code === 1810), false);
  assert.equal(seriesItems(items, 150, 160).length, 0); // the edge band and the inactive one
});

test('P series: the reply lists the range with its gap, the count and the old prices grouped; a single line wins whatever the order', async () => {
  const t = mk({ items: pvcItems() });
  const [r] = await t.bulk.addPrices([{ series: 100, price: 12 }]);
  assert.match(r, /سری 100: ۱۰۱ تا ۱۲۶، بدون ۱۱۳، ۲۵ کالا/);
  assert.match(r, /۱۹ کالا 10 → 12، ۶ کالا 11 → 12/);
  // the single line comes AFTER the series
  const [r2] = await t.bulk.addPrices([{ code: '108', price: 13 }]);
  assert.match(r2, /سری 100 هم هست/);
  const [r3] = await t.bulk.addPrices([{ series: 200, price: 5 }, { series: 150, price: 5 }, { from: 130, to: 140, price: 5 }]);
  assert.match(r3, /۲۰۱ تا ۲۰۱، ۱ کالا|۲۰۱ تا ۲۰۱/);
  assert.match(r3, /«سری 150» درست نیست/);
  assert.match(r3, /هیچ کالای فیلم/);
  assert.match(t.bulk.showDraft()[0], /خط جدا/);
  // the preview
  const [pv] = await t.bulk.planPrices();
  assert.match(pv, /#P1/);
  assert.match(pv, /سری 100 \(۱۰۱ تا ۱۲۶، بدون ۱۱۳\): ۲۴ کالا/);
  assert.match(pv, /۱ کالا خط جدا دارد/);
  assert.match(pv, /PVC FILM108: 10 → 13/);
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'P1' });
  await done;
  assert.ok(only(t.m.posts, 'item', ['UnitPrice']));
  const by = (n) => t.m.db.Item.find((i) => i.Name === `PVC FILM${n}`).UnitPrice;
  assert.equal(by(108), 13); // the single line won
  assert.equal(by(101), 12); assert.equal(by(126), 12);
  assert.equal(by(201), 5);
  assert.equal(t.m.db.Item.find((i) => i.Name === 'EDGE BAND 150').UnitPrice, 50);
  assert.equal(by(1810), 99);
  assert.equal(t.bulk.draft.size, 0); // the series left the draft
  const n = t.m.posts.length;
  await t.bulk.decide({ verb: 'yes', id: 'P1' });
  assert.equal(t.m.posts.length, n);
});

test('P series: the single line wins when it is given FIRST too, an explicit range works, and a series line can be removed', async () => {
  const t = mk({ items: pvcItems() });
  await t.bulk.addPrices([{ code: '108', price: 13 }]);
  await t.bulk.addPrices([{ from: 126, to: 101, price: 12 }]); // reversed bounds are fine
  assert.equal(t.bulk.draft.series[0].lo, 101);
  await t.bulk.planPrices();
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'P1' });
  await done;
  assert.equal(t.m.db.Item.find((i) => i.Name === 'PVC FILM108').UnitPrice, 13);
  const t2 = mk({ items: pvcItems() });
  await t2.bulk.addPrices([{ series: 100, price: 12 }]);
  assert.match(t2.bulk.removePrice('سری 100')[0], /برداشته شد/);
  assert.equal(t2.bulk.draft.size, 0);
});

test('P series: warnings per series (over 30 percent, below the purchase cost)', async () => {
  const t = mk({ items: pvcItems() });
  await t.bulk.addPrices([{ series: 100, price: 3 }]); // below the cost 4 and a big drop
  const [pv] = await t.bulk.planPrices();
  assert.match(pv, /⚠️ ۲۵ کالا هشدار دارد/);
  assert.match(pv, /قیمت تازه کمتر از بهای خرید/);
});

// ---- the owner's real layouts
test('yes and no in every layout: id before or after, with or without space and #, lower case, Persian and Arabic digits', () => {
  for (const t of ['بله#M1', 'بله # M1', 'M1# بله', '#M1 بله', 'بله M1', 'بله m1', 'بله #م1'.replace('م', 'M'), 'بله #M۱', 'بله #M١', 'M1 بله', 'بله\u200f #M1', 'بله#M1.']) assert.deepEqual(parseInvoiceCommand(t), { type: 'yes', id: 'M1' }, t);
  for (const t of ['نه#E2', 'E2# نه', 'خیر e2']) assert.deepEqual(parseInvoiceCommand(t), { type: 'no', id: 'E2' }, t);
  assert.deepEqual(parseInvoiceCommand('بله'), { type: 'yes', id: '' });
  assert.deepEqual(parseInvoiceCommand('نه'), { type: 'no', id: '' });
  assert.equal(parseInvoiceCommand('بله M1 نه'), null); // two words: not a command
});

test('openIds: only previews still open (pending, under a day) of every kind', async () => {
  const t = mk();
  assert.deepEqual(t.bulk.openIds(), []);
  await t.bulk.planEmails(); await t.bulk.planMobiles();
  assert.deepEqual(t.bulk.openIds(), ['E1', 'M1']);
  await t.bulk.decide({ verb: 'no', id: 'E1' });
  assert.deepEqual(t.bulk.openIds(), ['M1']);
  t.clock.t += 25 * 3600 * 1000;
  assert.deepEqual(t.bulk.openIds(), []);
});

test('the owner\'s exact price message: the header line and the name are ignored, Persian digits, = with or without spaces', async () => {
  const text = 'آتوسا قیمت ها به درهم است\nقیمت سری ۱۰۰ =۱۳\nقیمت سری ۲۰۰ = ۱۴\nقیمت سری۳۰۰=۱۵\nقیمت ۱۰۸ = ۱۲٫۵';
  const ic = parseInvoiceCommand(text);
  assert.equal(ic.type, 'price_set');
  assert.deepEqual(ic.lines, [{ series: 100, price: 13 }, { series: 200, price: 14 }, { series: 300, price: 15 }, { code: '108', price: 12.5 }]);
  assert.deepEqual(ic.unread, []);
  assert.deepEqual(parseInvoiceCommand('آتوسا قیمت ۱۰۸ = ۱۲').lines, [{ code: '108', price: 12 }]); // the name in front
  const t = mk({ items: pvcItems() });
  const [r] = await t.bulk.addPrices(ic.lines);
  assert.match(r, /سری 100: ۱۰۱ تا ۱۲۶/);
  assert.match(r, /سری 300.*پیدا نشد|هیچ کالای فیلم/s);
  assert.equal(t.bulk.draft.series.length, 2);
});

test('a price message with one line not understood takes the rest and names that line', () => {
  const ic = parseInvoiceCommand('قیمت 108 = 12\nقیمت نامعلوم\nقیمت 109 = 13');
  assert.equal(ic.lines.length, 2);
  assert.deepEqual(ic.unread, ['قیمت نامعلوم']);
  assert.equal(parseInvoiceCommand('قیمت نامعلوم'), null); // nothing parsed: not ours
});

test('intake: the owner\'s late private message from a sync is taken once, a repeat after a restart is not, a group or an old one is not', async () => {
  const { shouldProcess, OwnerSeen } = await import('../src/intake.js');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'os-')), 'seen.json');
  const now = 100000 * 1000;
  const msg = (id, extra = {}, key = {}) => ({ key: { id, fromMe: true, remoteJid: '97150@s.whatsapp.net', ...key }, message: { conversation: 'x' }, messageTimestamp: 100000 - 600, ...extra });
  const a = new OwnerSeen(f);
  assert.equal(shouldProcess({ type: 'append', raw: msg('m1'), seen: new Set(), now, ownerSeen: a }).ok, true); // ten minutes old, from the sync
  assert.equal(shouldProcess({ type: 'append', raw: msg('m2', { messageTimestamp: 100000 - 7200 }), seen: new Set(), now, ownerSeen: a }).ok, false); // two hours: history
  assert.equal(shouldProcess({ type: 'append', raw: msg('m3', {}, { remoteJid: 'g@g.us' }), seen: new Set(), now, ownerSeen: a }).ok, false); // a group
  assert.equal(shouldProcess({ type: 'append', raw: msg('m4', {}, { fromMe: false }), seen: new Set(), now, ownerSeen: a }).ok, false); // not his own
  // after a restart (a new process: an empty seen set, the file kept) the same id is a duplicate, live or from the sync
  const b = new OwnerSeen(f);
  assert.equal(shouldProcess({ type: 'append', raw: msg('m1'), seen: new Set(), now, ownerSeen: b }).ok, false);
  assert.equal(shouldProcess({ type: 'notify', raw: msg('m1'), seen: new Set(), now, ownerSeen: b }).ok, false);
  assert.equal(shouldProcess({ type: 'notify', raw: msg('m5'), seen: new Set(), now, ownerSeen: b }).ok, true); // a new live one still passes
});

// ---- the owner's second message (eight series, a four-digit series, Latin 8 among Persian digits)
test('the owner\'s exact eight-series message is fully taken, header ignored, Latin 8 beside Persian digits', () => {
  const text = 'آتوسا قیمت ها به درهم است\nقیمت سری ۱۰۰ =۱۳\nقیمت سری ۲۰۰ =۱۴\nقیمت سری ۳۰۰=۱۴\nقیمت سری ۴۰۰=۱۳\nقیمت سری ۵۰۰=۱۱\nقیمت سری ۶۰۰=۱۶\nقیمت سری ۷۰۰=۱۴\nقیمت سری ۱۸۰۰=8';
  const ic = parseInvoiceCommand(text);
  assert.equal(ic.type, 'price_set');
  assert.deepEqual(ic.lines.map((l) => [l.series, l.price]), [[100, 13], [200, 14], [300, 14], [400, 13], [500, 11], [600, 16], [700, 14], [1800, 8]]);
  assert.deepEqual(ic.unread, []);
  // a greeting that is not a price line is set aside and named, the prices are all taken
  const g = parseInvoiceCommand('سلام آتوسا\nقیمت سری ۱۰۰ =۱۳\nقیمت سری ۲۰۰ =۱۴');
  assert.equal(g.lines.length, 2); assert.deepEqual(g.unread, ['سلام آتوسا']);
});

test('series 1800 is the four-digit codes 1801 to 1899; a code with several PVC items is listed and not taken', async () => {
  const items = [...pvcItems(), I(1811, 'PVC 1811', { UnitPrice: 7 }), I(1812, 'PVC 1812', { UnitPrice: 7 }), I(1813, 'PVC FILM1812', { UnitPrice: 9 })];
  const t = mk({ items });
  const [r] = await t.bulk.addPrices([{ series: 1800, price: 8 }]);
  assert.match(r, /سری 1800: ۱۸۰۱ تا ۱۸۱۱|سری 1800: ۱۸۱۰ تا ۱۸۱۱/); // 1810 and 1811 (1812 is double)
  assert.match(r, /چند کالای پی‌وی‌سی دارند/);
  assert.match(r, /۱۸۱۲/);
  const [pv] = await t.bulk.planPrices();
  assert.match(pv, /سری 1800/);
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'P1' });
  await done;
  const by = (n) => t.m.db.Item.find((i) => i.Name === n).UnitPrice;
  assert.equal(by('PVC 1811'), 8);
  assert.equal(by('PVC FILM1810'), 8);
  assert.equal(by('PVC 1812'), 7); // double: untouched
  assert.equal(by('PVC FILM1812'), 9);
  assert.equal(by('PVC FILM101'), 10); // the three-digit series is not touched
});

// ---- a 400 on one record skips that record and goes on; other errors stop
test('a 400 validation error on one item: skipped with the QuickBooks message and the item name, the rest continue, the draft keeps it, a second run finishes only that one', async () => {
  const t = mk({ items: pvcItems(), rejectIds: ['105'] });
  await t.bulk.addPrices([{ series: 100, price: 12 }, { code: 'PVC FILM201', price: 31 }]);
  await t.bulk.planPrices();
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'P1' });
  const rep = await done;
  assert.match(rep, /۱ را کوییک‌بوکس نپذیرفت/);
  assert.match(rep, /PVC FILM105: Business Validation Error - Income account is inactive/);
  assert.doesNotMatch(rep, /ایستاد/);
  const by = (n) => t.m.db.Item.find((i) => i.Name === `PVC FILM${n}`).UnitPrice;
  assert.equal(by(104), 12); assert.equal(by(106), 12); assert.equal(by(126), 12); // after the refused one the job went on
  assert.equal(by(105), 10); // the refused one is untouched
  assert.equal(by(201), 31);
  assert.equal(t.bulk.draft.series.length, 1); // the series stays: one item still needs it
  assert.equal(t.bulk.draft.lines.length, 0); // the single line that was applied left
  const audit = t.audit.last(50).find((e) => e.event === 'bulk-skip');
  assert.equal(audit.name, 'PVC FILM105'); assert.equal(audit.fault.element, 'IncomeAccountRef'); assert.equal(audit.itemType, 'Inventory');
  // again «شروع کن»: only the refused one is left to change, the rest is already right
  const [pv2] = await t.bulk.planPrices();
  assert.match(pv2, /#P2/);
  assert.match(pv2, /۱ تغییر/);
  assert.match(pv2, /۲۴ از پیش درست/);
});

test('a 5xx stops the whole job, a 400 does not; the body sent has only the price', async () => {
  const t = mk({ items: pvcItems(), serverErrorOn: '103' });
  await t.bulk.addPrices([{ series: 100, price: 12 }]);
  await t.bulk.planPrices();
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'P1' });
  const rep = await done;
  assert.match(rep, /ایستاد/);
  assert.ok(only(t.m.posts, 'item', ['UnitPrice']));
  assert.ok(t.m.posts.every((p) => Object.keys(p.body).sort().join() === 'Id,SyncToken,UnitPrice,sparse'));
  assert.equal(t.m.db.Item.find((i) => i.Name === 'PVC FILM104').UnitPrice, 10); // nothing after the stop
});

test('the QuickBooks fault (code, message, detail, element) is in the error and in the error log, never a token', async () => {
  const t = mk({ items: pvcItems(), rejectIds: ['101'] });
  await assert.rejects(() => t.qbo.write('POST', 'item', { Id: '101', SyncToken: '0', sparse: true, UnitPrice: 5 }), (e) => {
    assert.equal(e.status, 400);
    assert.equal(e.fault.code, '6000'); assert.equal(e.fault.element, 'IncomeAccountRef'); assert.equal(e.fault.detail, 'Income account is inactive');
    assert.match(e.message, /Income account is inactive.*IncomeAccountRef/);
    return true;
  });
  const log = fs.readFileSync(path.join(t.dir, 'qbo-errors.log'), 'utf8');
  assert.match(log, /IncomeAccountRef/);
  assert.doesNotMatch(log, /ACCESS-X|REFRESH-X|Bearer/);
});

// ---- job C: the categories (PVC FILM, EDGE BANDING and its two widths), the moves, the SKUs
const catItems = (extra = []) => [
  I(50, 'PVC FLIM', { Type: 'Category' }),
  I(108, 'PVC FILM108', { Sku: '108', UnitPrice: 10 }), I(109, 'PVC FILM109', { Sku: 'PVC-109', ParentRef: { value: '50' }, SubItem: true }),
  I(1810, 'PVC 1810', { Sku: '1810', UnitPrice: 20 }), I(120, 'PVC FILM120', { UnitPrice: 11 }), // no SKU yet
  I(900, 'pvc flim 0.1 roll', { Sku: 'R1' }), // looks like PVC, no code: unsure
  I(901, 'Hinge', { Sku: 'H1' }),
  I(701, 'EDGE 1801 WHITE 1MM*22', { Sku: 'EDGE 1801' }), // width 22
  I(702, 'EDGE 1801 WHITE', { Sku: 'EDGE 1801', Description: 'edge banding 0.8*50' }), // width 50 from the description
  I(703, 'EDGE 3019', { Description: 'EDGE BANDING 0.18 THICKNESS' }), // a thickness only: no width
  I(704, 'EDGE 2000 22MM 50MM'), // both widths
  I(705, 'EDGE 2001 45MM'), // 45: never guessed
  I(706, 'EDGE 3020 x22'), I(707, 'EDGE 3021 22', { Sku: 'EDGE22-3020' }), // already EDGE22-3020 (the colour is read from the SKU first); 706 would get the same: a clash
  ...extra,
];

test('C plan: categories, moves per category, SKUs per family, clashes and the unsure ones listed', () => {
  const r = planCatalog(catItems());
  assert.deepEqual(r.cats.map((c) => [c.key, c.mode]), [['pvc', 'rename'], ['edge', 'create'], ['e22', 'create'], ['e50', 'create']]);
  assert.deepEqual(r.moves.filter((m) => m.cat === 'pvc').map((m) => m.id).sort(), ['108', '120', '1810']); // 109 is already inside
  assert.deepEqual(r.moves.filter((m) => m.cat === 'e22').map((m) => m.id).sort(), ['701', '706', '707']);
  assert.deepEqual(r.moves.filter((m) => m.cat === 'e50').map((m) => m.id), ['702']);
  assert.deepEqual(r.skus.map((s) => [s.id, s.old, s.new]).sort(), [['108', '108', 'PVC-108'], ['120', '', 'PVC-120'], ['1810', '1810', 'PVC-1810']]);
  assert.deepEqual(r.edgeSkus.map((s) => [s.id, s.new]).sort(), [['701', 'EDGE22-1801'], ['702', 'EDGE50-1801']]);
  assert.deepEqual(r.clashes.map((c) => [c.id, c.new]), [['706', 'EDGE22-3020']]);
  assert.deepEqual(r.unsure.map((u) => u.id).sort(), ['703', '704', '705', '900']);
  assert.match(r.unsure.find((u) => u.id === '703').why, /پهنا/);
  assert.match(r.unsure.find((u) => u.id === '704').why, /هر دو/);
  assert.match(r.unsure.find((u) => u.id === '705').why, /۴۵/);
});

test('edge width and colour are read from the name, the SKU and the descriptions; a thickness is not a width', async () => {
  const { edgeSize, edgeCode, isEdgeItem } = await import('../src/qbobulk.js');
  for (const [name, size] of [['EDGE 1801 22', 22], ['EDGE 1801 *22', 22], ['E 1801 x22', 22], ['EDGE 1801 1MM*22', 22], ['EDGE 1801 0.8*22', 22], ['EDGE 1801 22MM', 22], ['EDGE 1801 50', 50], ['EDGE 1801 0.8*50', 50]]) assert.equal(edgeSize({ Name: name }).size, size, name);
  assert.equal(edgeSize({ Name: 'EDGE 1801', Description: 'EDGE BANDING 0.18 THICKNESS' }).why, 'unknown');
  assert.equal(edgeSize({ Name: 'EDGE 1801 22', Description: '0.8*50' }).why, 'both');
  assert.equal(edgeSize({ Name: 'EDGE 1801 45' }).why, 'other');
  assert.equal(edgeSize({ Name: 'EDGE 1822' }).why, 'unknown'); // 22 inside a longer number is no width
  assert.equal(edgeCode({ Sku: 'EDGE22-1801' }), '1801'); assert.equal(edgeCode({ Sku: 'EDGE 3019', Name: 'x' }), '3019'); assert.equal(edgeCode({ Name: 'EDGE 3019 0.8*22' }), '3019');
  assert.equal(isEdgeItem({ Name: 'Wood roll', Description: 'EDGE BANDING 0.45' }), true);
  assert.equal(isEdgeItem({ Name: 'PVC FILM108' }), false);
});

test('C plan: existing categories are kept, spelling and case variants (also * for x) are renamed, two variants stop', () => {
  const c = planCatalog([I(1, 'PVC FILM', { Type: 'Category' }), I(2, 'PVC FLIM', { Type: 'Category' }), I(3, 'edge banding', { Type: 'Category' }), I(4, 'EDGE 0.8*22', { Type: 'Category' }), I(108, 'PVC FILM108')]);
  assert.deepEqual(c.cats.map((x) => [x.key, x.mode, x.id]), [['pvc', 'exists', '1'], ['edge', 'rename', '3'], ['e22', 'rename', '4'], ['e50', 'create', '']]);
  assert.ok(planCatalog([I(1, 'pvc flim', { Type: 'Category' }), I(2, 'Pvc Film ', { Type: 'Category' })]).stop);
  assert.equal(categoryCandidates([I(1, 'Hardware', { Type: 'Category' })]).variants.length, 0);
  const r = planCatalog([I(1, 'PVC FILM', { Type: 'Category' }), I(2, 'PVC FILM108'), I(3, 'PVC 108')]); // two items for one SKU: both skipped
  assert.equal(r.clashes.length, 2); assert.equal(r.skus.length, 0);
});

test('C run: renames and creates only categories, moves and SKUs only those fields; idempotent; the names stay', async () => {
  const t = mk({ items: catItems() });
  const [pv] = await t.bulk.planCatalog();
  assert.match(pv, /#C1/);
  assert.match(pv, /فاکتورهای قبلی تغییر نمی‌کنند؛ فقط دسته و کد کالا/);
  assert.match(pv, /تغییر نام می‌دهد/);
  assert.match(pv, /۳ دستهٔ تازه/);
  assert.match(pv, /مطمئن نیستم/);
  assert.equal(t.m.posts.length, 0);
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'C1' });
  await done;
  const keysOf = (p) => Object.keys(p.body).sort().join();
  const allowed = ['Id,Name,SyncToken,Type,sparse', 'Id,ParentRef,SubItem,SyncToken,sparse', 'Id,Sku,SyncToken,sparse', 'Name,Type', 'Name,ParentRef,SubItem,Type'];
  assert.ok(t.m.posts.every((p) => allowed.includes(keysOf(p))), t.m.posts.map(keysOf).join(' | '));
  const by = (id) => t.m.db.Item.find((i) => i.Id === String(id));
  const cat = (n) => t.m.db.Item.find((i) => i.Type === 'Category' && i.Name === n);
  assert.equal(by(50).Name, 'PVC FILM');
  const edge = cat('EDGE BANDING'); const e22 = cat('EDGE 0.8x22'); const e50 = cat('EDGE 0.8x50');
  assert.ok(edge && e22 && e50);
  assert.equal(e22.ParentRef.value, edge.Id); assert.equal(e22.SubItem, true); assert.equal(e50.ParentRef.value, edge.Id);
  for (const id of [108, 120, 1810]) { assert.equal(by(id).ParentRef.value, '50'); assert.equal(by(id).SubItem, true); }
  for (const id of [701, 706, 707]) assert.equal(by(id).ParentRef.value, e22.Id);
  assert.equal(by(702).ParentRef.value, e50.Id);
  assert.equal(by(108).FullyQualifiedName, 'PVC FILM:PVC FILM108');
  assert.equal(by(108).Name, 'PVC FILM108'); assert.equal(by(108).UnitPrice, 10);
  assert.deepEqual([108, 120, 1810, 701, 702, 707, 706].map((id) => by(id).Sku), ['PVC-108', 'PVC-120', 'PVC-1810', 'EDGE22-1801', 'EDGE50-1801', 'EDGE22-3020', undefined]);
  for (const id of [703, 704, 705, 900, 901]) assert.equal(by(id).ParentRef, undefined, String(id)); // unsure ones are not moved
  assert.equal(by(703).Sku, undefined);
  const n = t.m.posts.length;
  await t.bulk.decide({ verb: 'yes', id: 'C1' });
  assert.equal(t.m.posts.length, n);
  assert.equal(t.m.db.Item.filter((i) => i.Type === 'Category').length, 4); // no second category
});

test('C run: an item QuickBooks refuses (a memorised transaction) is skipped with its message and the rest go on', async () => {
  const t = mk({ items: catItems(), rejectIds: ['120'] });
  await t.bulk.planCatalog();
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'C1' });
  const rep = await done;
  assert.match(rep, /PVC FILM120: Business Validation Error/);
  assert.doesNotMatch(rep, /ایستاد/);
  assert.equal(t.m.db.Item.find((i) => i.Id === '1810').Sku, 'PVC-1810');
});

test('after the job: matching uses the name, the new SKU, the bare code and the size words; a category is never an invoice item', async () => {
  const { pickItem, itemsNamed, itemsContaining } = await import('../src/qboinvoice.js');
  const t = mk({ items: catItems() });
  await t.bulk.planCatalog();
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'C1' });
  await done;
  const items = t.m.db.Item;
  for (const q of ['PVC FILM108', 'pvc film108', 'PVC-108', 'pvc-108', 'PVC FILM:PVC FILM108', '108']) assert.equal(pickItem(q, { items }).item?.Id, '108', q);
  assert.equal(pickItem('1810', { items }).item?.Id, '1810');
  assert.equal(pickItem('EDGE22-1801', { items }).item?.Id, '701');
  assert.equal(pickItem('edge50-1801', { items }).item?.Id, '702');
  assert.equal(pickItem('نوار لبه 1801 سایز 22', { items }).item?.Id, '701');
  assert.equal(pickItem('1801 50', { items }).item?.Id, '702');
  assert.equal(pickItem('EDGE 1801 size 50', { items }).item?.Id, '702');
  // both sizes exist: the bare colour number asks for the size
  const bare = pickItem('1801', { items });
  assert.equal(bare.item, undefined);
  assert.match(bare.stop(1), /EDGE22-1801[\s\S]*EDGE50-1801|EDGE50-1801[\s\S]*EDGE22-1801/);
  assert.equal(itemsNamed(items, 'PVC FILM').length, 0); // the category is not an item
  assert.ok(itemsContaining(items, 'EDGE BANDING').every((i) => i.Type !== 'Category'));
  const [r] = await t.bulk.addPrices([{ series: 100, price: 12 }]); // the price series still finds the items by their names
  assert.match(r, /سری 100/);
});

test('Qbo.write for categories: only category creates (a sub-category with its parent and SubItem), a Name only with Type Category', async () => {
  const t = mk({ items: catItems() });
  const base = { Id: '108', SyncToken: '0', sparse: true };
  await assert.rejects(() => t.qbo.write('POST', 'item', { ...base, Name: 'x' }), /only/);
  await assert.rejects(() => t.qbo.write('POST', 'item', { ...base, Name: 'x', Type: 'Inventory' }), /only/);
  await assert.rejects(() => t.qbo.write('POST', 'item', { ...base, Name: 'x', Type: 'Category', UnitPrice: 1 }), /only/);
  await assert.rejects(() => t.qbo.write('POST', 'item', { Name: 'New thing', Type: 'Inventory' }), /only/);
  await assert.rejects(() => t.qbo.write('POST', 'item', { Name: 'New', Type: 'Category', UnitPrice: 1 }), /only/);
  await assert.rejects(() => t.qbo.write('POST', 'item', { Name: 'New', Type: 'Category', ParentRef: { value: '5' } }), /only/); // a parent needs SubItem true
  await assert.rejects(() => t.qbo.write('POST', 'item', { Name: 'New', Type: 'Category', SubItem: true }), /only/);
  await assert.rejects(() => t.qbo.write('POST', 'item', { Name: 'New', Type: 'Inventory', ParentRef: { value: '5' }, SubItem: true }), /only/);
  await assert.rejects(() => t.qbo.write('POST', 'item', { UnitPrice: 5 }), /only/);
  await assert.rejects(() => t.qbo.write('POST', 'item', { ...base, ParentRef: { value: '50' }, Sku: 'x' }), /only/);
  assert.equal(t.m.posts.length, 0);
  await t.qbo.write('POST', 'item', { ...base, ParentRef: { value: '50' }, SubItem: true });
  await t.qbo.write('POST', 'item', { ...base, Sku: 'PVC-108' });
  await t.qbo.write('POST', 'item', { Id: '50', SyncToken: '0', sparse: true, Name: 'PVC FILM', Type: 'Category' });
  await t.qbo.write('POST', 'item', { Name: 'PVC FILM', Type: 'Category' });
  await t.qbo.write('POST', 'item', { Name: 'EDGE 0.8x22', Type: 'Category', ParentRef: { value: '50' }, SubItem: true });
  assert.equal(t.m.posts.length, 5);
});

test('the words: the catalog job and the yes with C', () => {
  assert.deepEqual(parseInvoiceCommand('دسته و کد کالاها'), { type: 'bulk_catalog' });
  assert.deepEqual(parseInvoiceCommand('دسته و کد کالا'), { type: 'bulk_catalog' });
  assert.deepEqual(parseInvoiceCommand('بله#C1'), { type: 'yes', id: 'C1' });
  assert.deepEqual(parseInvoiceCommand('C1# نه'), { type: 'no', id: 'C1' });
});

// ---- the PVC-only form, and the misspelled family members
test('the family rule: FILM or FLIM, a missing space, never a catalogue, a glue or a thickness', async () => {
  const { pvcCode } = await import('../src/qbobulk.js');
  for (const [n, c] of [['PVC FILM108', 108], ['PVC FLIM 608', 608], ['PVC FLIM513', 513], ['pvc flim 513', 513], ['PVC 1810', 1810], ['PVC FILM 109', 109]]) assert.equal(pvcCode({ Name: n }), c, n);
  for (const n of ['PVC Film0.4*19', 'ARYAK PVC CATALOG', 'PVC GLUE 500ML', 'PVC flim 0.1 roll', 'EDGE 1801']) assert.equal(pvcCode({ Name: n }), null, n);
});

test('the price series now holds the misspelled PVC FLIM 608 and PVC FLIM513 (series 600 and 500)', () => {
  const items = [I(1, 'PVC FILM601', { UnitPrice: 14 }), I(2, 'PVC FLIM 608', { UnitPrice: 14 }), I(3, 'PVC FLIM513', { UnitPrice: 11 }), I(4, 'PVC FILM501', { UnitPrice: 11 }), I(5, 'PVC Film0.4*19')];
  assert.deepEqual(seriesItems(items, 601, 699).map((x) => x.item.Id), ['1', '2']);
  assert.deepEqual(seriesItems(items, 501, 599).map((x) => x.item.Id), ['4', '3']);
});

test('the PVC-only job: the words, no edge banding change of any kind, the misspelled ones in, the odd ones listed', async () => {
  assert.deepEqual(parseInvoiceCommand('دسته و کد پی‌وی‌سی'), { type: 'bulk_catalog', edge: false });
  assert.deepEqual(parseInvoiceCommand('دسته و کد پی وی سی'), { type: 'bulk_catalog', edge: false });
  assert.deepEqual(parseInvoiceCommand('دسته و کد کالاها'), { type: 'bulk_catalog' }); // the full job stays
  const items = [...catItems(), I(608, 'PVC FLIM 608', { Sku: '608' }), I(513, 'PVC FLIM513'), I(910, 'PVC Film0.4*19'), I(911, 'PVC GLUE'), I(912, 'ARYAK PVC CATALOG')];
  const r = planCatalog(items, { edge: false });
  assert.deepEqual(r.cats.map((c) => c.key), ['pvc']);
  assert.deepEqual(r.edgeSkus, []);
  assert.ok(r.moves.every((m) => m.cat === 'pvc'));
  assert.deepEqual(r.moves.map((m) => m.id).sort(), ['108', '120', '1810', '513', '608']);
  assert.deepEqual(r.skus.map((s) => s.new).sort(), ['PVC-108', 'PVC-120', 'PVC-1810', 'PVC-513', 'PVC-608']);
  assert.deepEqual(r.unsure.map((u) => u.id).sort(), ['900', '910', '911', '912']);
  assert.deepEqual(r.unsure.filter((u) => /^70|^3|^2/.test(u.id)), []); // the edge items are not even listed
  const t = mk({ items });
  const [pv] = await t.bulk.planCatalog({ edge: false });
  assert.match(pv, /#C1/);
  assert.match(pv, /به نوار لبه دست زده نمی‌شود/);
  assert.match(pv, /فاکتورهای قبلی تغییر نمی‌کنند؛ فقط دسته و کد کالا/);
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'C1' });
  await done;
  const by = (id) => t.m.db.Item.find((i) => i.Id === String(id));
  assert.equal(by(50).Name, 'PVC FILM');
  assert.equal(t.m.db.Item.filter((i) => i.Type === 'Category').length, 1); // no edge category was made
  for (const id of [701, 702, 703, 704, 705, 706, 707]) { assert.equal(by(id).ParentRef, undefined, String(id)); }
  assert.deepEqual([701, 702, 707].map((id) => by(id).Sku), ['EDGE 1801', 'EDGE 1801', 'EDGE22-3020']); // untouched
  assert.equal(by(608).ParentRef.value, '50'); assert.equal(by(608).Sku, 'PVC-608'); assert.equal(by(513).Sku, 'PVC-513');
  assert.equal(by(910).ParentRef, undefined);
  assert.ok(t.m.posts.every((p) => ['Id,Name,SyncToken,Type,sparse', 'Id,ParentRef,SubItem,SyncToken,sparse', 'Id,Sku,SyncToken,sparse'].includes(Object.keys(p.body).sort().join())));
});


// ---- job U: put a finished job's moves back, from the audit log
const undoWorld = (extraItems = []) => {
  const items = [
    I(239, 'EDGE BANDING', { Type: 'Category' }), I(271, 'EDGE 0.8x22', { Type: 'Category', ParentRef: { value: '239' }, SubItem: true }), I(272, 'EDGE 0.8x50', { Type: 'Category', ParentRef: { value: '239' }, SubItem: true }),
    I(207, 'PVC FILM', { Type: 'Category' }),
    I(301, 'EDGE A', { ParentRef: { value: '271' }, SubItem: true }), I(302, 'EDGE B', { ParentRef: { value: '271' }, SubItem: true }), // were top level
    I(303, 'EDGE C', { ParentRef: { value: '272' }, SubItem: true }), I(304, 'EDGE D', { ParentRef: { value: '272' }, SubItem: true }), // were in 239
    I(305, 'EDGE E', { ParentRef: { value: '777' }, SubItem: true }), // moved by someone else since
    I(108, 'PVC FILM108', { ParentRef: { value: '207' }, SubItem: true, Sku: 'PVC-108' }),
    ...extraItems,
  ];
  const t = mk({ items });
  const log = (field, qboId, old, nw) => t.audit.add({ event: 'bulk-change', kind: 'C', previewId: 'C2', approver: 'owner', qboId, field, ...(old !== undefined ? { old } : {}), new: nw });
  log('rename', '207', 'PVC FLIM', 'PVC FILM');
  log('category-create', '271', undefined, 'EDGE 0.8x22'); log('category-create', '272', undefined, 'EDGE 0.8x50');
  log('move', '108', '148', '207');
  log('move', '301', '', '271'); log('move', '302', '', '271'); log('move', '303', '239', '272'); log('move', '304', '239', '272'); log('move', '305', '', '271');
  log('sku', '108', '108', 'PVC-108');
  return t;
};

test('undo words, and the audit reading: only the moves into the categories the job created', async () => {
  const { undoSet, latestCreatingPreview } = await import('../src/qbobulk.js');
  assert.deepEqual(parseInvoiceCommand('برگرداندن نوار لبه'), { type: 'bulk_undo', scope: 'edge' });
  assert.deepEqual(parseInvoiceCommand('برگرداندن c2'), { type: 'bulk_undo', scope: 'all', source: 'C2' });
  assert.deepEqual(parseInvoiceCommand('بله#U1'), { type: 'yes', id: 'U1' });
  const t = undoWorld();
  const e = t.audit.all();
  assert.equal(latestCreatingPreview(e), 'C2');
  const s = undoSet(e, 'C2', { onlyCreated: true });
  assert.deepEqual(s.created.map((c) => c.id), ['271', '272']);
  assert.deepEqual(s.moves.map((m) => [m.id, m.old, m.new]), [['301', '', '271'], ['302', '', '271'], ['303', '239', '272'], ['304', '239', '272'], ['305', '', '271']]); // 108 (PVC) is not among them
  assert.equal(undoSet(e, 'C2').moves.length, 6); // the whole job: PVC too
});

test('U: the preview writes nothing; the run puts the edge items back, switches off the two empty categories, leaves PVC and the moved-since item', async () => {
  const t = undoWorld();
  const [pv] = await t.bulk.planUndo({ scope: 'edge' });
  assert.match(pv, /#U1/);
  assert.match(pv, /۲ کالا به بدون دسته و ۲ کالا به دستهٔ پیشین/);
  assert.match(pv, /دسته‌اش از آن زمان عوض شده/); // 305
  assert.equal(t.m.posts.length, 0);
  // plan-time: 305 is at 777, not at 271: left out
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'U1' });
  const rep = await done;
  const by = (id) => t.m.db.Item.find((i) => i.Id === String(id));
  for (const id of [301, 302]) { assert.equal(by(id).ParentRef, undefined, String(id)); assert.equal(by(id).SubItem, false); }
  for (const id of [303, 304]) { assert.equal(by(id).ParentRef.value, '239'); assert.equal(by(id).SubItem, true); }
  assert.equal(by(305).ParentRef.value, '777'); // someone else's move is left
  assert.equal(by(108).ParentRef.value, '207'); assert.equal(by(108).Sku, 'PVC-108'); // PVC stays
  assert.equal(by(271).Active, false); assert.equal(by(272).Active, false); assert.equal(by(239).Active, true); assert.equal(by(207).Active, true);
  assert.ok(t.m.posts.every((p) => ['Id,SubItem,SyncToken,sparse', 'Id,ParentRef,SubItem,SyncToken,sparse', 'Active,Id,SyncToken,sparse'].includes(Object.keys(p.body).sort().join())), t.m.posts.map((p) => Object.keys(p.body).sort().join()).join(' | '));
  assert.equal(t.m.posts.length, 6); // four items, two categories
  const undo = t.audit.all().filter((e) => e.field === 'undo-move');
  assert.deepEqual(undo.map((e) => [e.qboId, e.old, e.new]), [['301', '271', ''], ['302', '271', ''], ['303', '272', '239'], ['304', '272', '239']]);
  assert.ok(t.audit.all().some((e) => e.field === 'undo-category' && e.qboId === '271'));
  assert.match(rep, /۶ تغییر کرد/);
  const n = t.m.posts.length;
  await t.bulk.decide({ verb: 'yes', id: 'U1' });
  assert.equal(t.m.posts.length, n); // done once
});

test('U: a category that still holds an item is not switched off; an item moved between the preview and the yes is skipped and named', async () => {
  const t = undoWorld([I(306, 'EDGE F', { ParentRef: { value: '272' }, SubItem: true })]); // an item NOT in the audit sits in 272
  await t.bulk.planUndo({ scope: 'edge' });
  // between the preview and the yes someone moves 301 elsewhere
  t.m.db.Item.find((i) => i.Id === '301').ParentRef = { value: '555' };
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'U1' });
  const rep = await done;
  const by = (id) => t.m.db.Item.find((i) => i.Id === String(id));
  assert.equal(by(301).ParentRef.value, '555'); // left
  assert.match(rep, /EDGE A: دسته‌اش از آن زمان عوض شده/);
  assert.equal(by(272).Active, true); // EDGE F is still in it
  assert.match(rep, /EDGE 0.8x50: خالی نیست/);
  assert.equal(by(271).Active, false); // 302 went back, 305 is elsewhere, 301 left: nothing active in 271
});

test('U: the kill switch stops it; after resume it runs; a QuickBooks 400 on one item is skipped', async () => {
  const t = undoWorld(); t.qbo.setPaused(true);
  assert.match((await t.bulk.planUndo({ scope: 'edge' }))[0], /متوقف/);
  t.qbo.setPaused(false);
  const t2 = mk({ items: undoWorld().m.db.Item, rejectIds: ['302'] });
  for (const e of undoWorld().audit.all()) t2.audit.add(e);
  await t2.bulk.planUndo({ scope: 'edge' });
  const done = t2.finished();
  await t2.bulk.decide({ verb: 'yes', id: 'U1' });
  const rep = await done;
  assert.match(rep, /EDGE B: Business Validation Error/);
  assert.doesNotMatch(rep, /ایستاد/);
  assert.equal(t2.m.db.Item.find((i) => i.Id === '301').SubItem, false);
});

test('U: the generic form puts back every move of the named job; nothing found says so', async () => {
  const t = undoWorld();
  const [pv] = await t.bulk.planUndo({ scope: 'all', source: 'C2' });
  assert.match(pv, /#U1/);
  assert.match(pv, /PVC FILM108/);
  assert.match((await t.bulk.planUndo({ scope: 'all', source: 'C9' }))[0], /پیدا نشد/);
  const none = mk({ items: [] });
  assert.match((await none.bulk.planUndo({ scope: 'edge' }))[0], /پیدا نشد/);
});

test('Qbo.write: Active false only for a named category, alone', async () => {
  const t = undoWorld();
  const base = { Id: '271', SyncToken: '0', sparse: true, Active: false };
  await assert.rejects(() => t.qbo.write('POST', 'item', base), /only/); // no list given
  await assert.rejects(() => t.qbo.write('POST', 'item', base, { categoryIds: ['272'] }), /only/);
  await assert.rejects(() => t.qbo.write('POST', 'item', { ...base, UnitPrice: 1 }, { categoryIds: ['271'] }), /only/);
  await assert.rejects(() => t.qbo.write('POST', 'item', { ...base, sparse: undefined }, { categoryIds: ['271'] }), /only/);
  assert.equal(t.m.posts.length, 0);
  await t.qbo.write('POST', 'item', base, { categoryIds: ['271'] });
  assert.equal(t.m.posts.length, 1);
});


// ---- job D: the edge banding list the owner gave (33 named items, nothing else)
const edgeWorld = ({ drop = [], extra = [], cats = true } = {}) => {
  const A = Array.from({ length: 20 }, (_, i) => 1801 + i).filter((n) => !drop.includes(n)).map((n) => I(1000 + n, `${n} edge banding`, { Sku: `EDGE ${n}`, Description: 'EDGE BANDING 0.18 THICKNESS' }));
  const B = [1802, 1804, 1805, 1806, 1807, 1808, 1809, 1810, 1816, 1817, 1818, 1819, 1820].map((n) => I(2000 + n, `B ${n}`, { Sku: n === 1810 ? '18010/50MM' : `${n}/50MM` }));
  return [
    ...(cats ? [I(239, 'EDGE BANDING', { Type: 'Category' }), I(271, 'EDGE 0.8x22', { Type: 'Category', Active: false, ParentRef: { value: '239' }, SubItem: true }), I(272, 'EDGE 0.8x50', { Type: 'Category', Active: false, ParentRef: { value: '239' }, SubItem: true })] : []),
    ...A, ...B,
    I(3001, 'EDGE BAND 1MM*223019', { Sku: 'EDGE BAND 1MM*22(3019)' }), I(3002, 'edge banding', { Sku: 'edge banding' }), // group C: never touched
    I(3003, 'GLUE EDGE BANDING ARYAK', { Sku: 'GLUE-1' }), I(3004, 'B 1803', { Sku: '1803/50MM' }), // not on the list
    I(3005, 'PVC 1801', { Sku: 'PVC-1801', UnitPrice: 12 }),
    ...extra,
  ];
};

test('D plan: the 33 listed items only; reactivates the two inactive categories; the rest is untouched; a missing one is named', () => {
  const items = edgeWorld({ drop: [1815] });
  const r = planEdgeList(items.filter((i) => i.Type !== 'Category'), items.filter((i) => i.Type === 'Category'));
  assert.deepEqual(r.subs.map((s) => [s.key, s.mode, s.id]), [['e22', 'activate', '271'], ['e50', 'activate', '272']]);
  assert.equal(r.moves.filter((m) => m.cat === 'e22').length, 19); assert.equal(r.moves.filter((m) => m.cat === 'e50').length, 13);
  assert.deepEqual(r.missing, ['1815 edge banding']);
  assert.equal(r.skus.find((s) => s.label === 'B 1810').new, 'EDGE50-1810'); // the typo 18010/50MM is fixed
  assert.equal(r.skus.find((s) => s.label === '1801 edge banding').new, 'EDGE22-1801');
  const touched = new Set([...r.moves, ...r.skus].map((x) => x.label));
  for (const n of ['EDGE BAND 1MM*223019', 'edge banding', 'GLUE EDGE BANDING ARYAK', 'B 1803', 'PVC 1801']) assert.equal(touched.has(n), false, n);
});

test('D plan: a missing parent stops, a missing sub-category is created, a SKU another item holds is a clash', () => {
  const noParent = edgeWorld({ cats: false });
  assert.match(planEdgeList(noParent, []).stop, /نیست/);
  const items = edgeWorld({ cats: false, extra: [I(5000, 'Other', { Sku: 'EDGE50-1805' })] });
  const r = planEdgeList(items, [I(239, 'EDGE BANDING', { Type: 'Category' })]);
  assert.deepEqual(r.subs.map((s) => s.mode), ['create', 'create']);
  assert.deepEqual(r.clashes.map((c) => c.label), ['B 1805']);
});

test('D run: categories on, 32 moves, 32 SKUs, only the allowed fields; group C, glue, PVC and B 1803 untouched; idempotent', async () => {
  const t = mk({ items: edgeWorld({ drop: [1815] }) });
  const [pv] = await t.bulk.planEdgeList();
  assert.match(pv, /#D1/);
  assert.match(pv, /فاکتورهای قبلی تغییر نمی‌کنند؛ فقط دسته و کد کالا/);
  assert.match(pv, /دوباره فعال می‌شود/);
  assert.match(pv, /1815 edge banding/);
  assert.equal(t.m.posts.length, 0);
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'D1' });
  await done;
  const by = (id) => t.m.db.Item.find((i) => i.Id === String(id));
  assert.equal(by(271).Active, true); assert.equal(by(272).Active, true);
  assert.equal(by(2801).ParentRef.value, '271'); assert.equal(by(2820).ParentRef.value, '271'); // "1801 edge banding" and "1820 edge banding"
  assert.equal(by(2815), undefined); // 1815 was dropped from this world
  assert.equal(by(3802).ParentRef.value, '272'); assert.equal(by(3820).ParentRef.value, '272'); // "B 1802" and "B 1820"
  assert.equal(by(2801).Sku, 'EDGE22-1801'); assert.equal(by(3802).Sku, 'EDGE50-1802'); assert.equal(by(3810).Sku, 'EDGE50-1810'); // the typo is fixed
  for (const id of [3001, 3002, 3003, 3004, 3005]) assert.equal(by(id).ParentRef, undefined, String(id));
  assert.deepEqual([3001, 3002, 3004].map((id) => by(id).Sku), ['EDGE BAND 1MM*22(3019)', 'edge banding', '1803/50MM']);
  assert.equal(by(3005).Sku, 'PVC-1801');
  assert.ok(t.m.posts.every((p) => ['Active,Id,SyncToken,sparse', 'Id,ParentRef,SubItem,SyncToken,sparse', 'Id,Sku,SyncToken,sparse'].includes(Object.keys(p.body).sort().join())));
  assert.equal(t.m.posts.length, 2 + 32 + 32);
  const n = t.m.posts.length;
  await t.bulk.decide({ verb: 'yes', id: 'D1' });
  assert.equal(t.m.posts.length, n);
});

test('D run: with no sub-categories they are created under EDGE BANDING', async () => {
  const items = edgeWorld({ cats: false }).concat(I(239, 'EDGE BANDING', { Type: 'Category' }));
  const t = mk({ items });
  const [pv] = await t.bulk.planEdgeList();
  assert.match(pv, /ساخته می‌شود/);
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'D1' });
  await done;
  const e22 = t.m.db.Item.find((i) => i.Type === 'Category' && i.Name === 'EDGE 0.8x22'); const e50 = t.m.db.Item.find((i) => i.Type === 'Category' && i.Name === 'EDGE 0.8x50');
  assert.ok(e22 && e50);
  assert.equal(e22.ParentRef.value, '239'); assert.equal(e22.SubItem, true);
  assert.equal(t.m.db.Item.find((i) => i.Name === '1801 edge banding').ParentRef.value, e22.Id);
  assert.equal(t.m.db.Item.find((i) => i.Name === 'B 1802').ParentRef.value, e50.Id);
});

test('after the job: the bare colour number asks which (22, 50 and the PVC one), the exact SKU and the size words find one', async () => {
  const { pickItem } = await import('../src/qboinvoice.js');
  const world = edgeWorld({ extra: [I(9801, 'B 1801', { Sku: 'EDGE50-1801' })] }); // a second edge 1801 so that both widths exist
  const t = mk({ items: world });
  await t.bulk.planEdgeList();
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'D1' });
  await done;
  const items = t.m.db.Item;
  const bare = pickItem('1801', { items });
  assert.equal(bare.item, undefined);
  const text = bare.stop(1);
  assert.match(text, /EDGE22-1801/); assert.match(text, /EDGE50-1801/); assert.match(text, /PVC 1801/);
  assert.equal(pickItem('EDGE22-1801', { items }).item.Name, '1801 edge banding');
  assert.equal(pickItem('EDGE50-1801', { items }).item.Id, '9801');
  assert.equal(pickItem('نوار لبه 1801 سایز 22', { items }).item.Name, '1801 edge banding');
});

test('Qbo.write: a named category can be switched on or off, nothing else; the words of the job', async () => {
  const t = mk({ items: edgeWorld() });
  const base = { Id: '271', SyncToken: '0', sparse: true, Active: true };
  await assert.rejects(() => t.qbo.write('POST', 'item', base), /only/);
  await assert.rejects(() => t.qbo.write('POST', 'item', { ...base, Id: '1801' }, { categoryIds: ['271'] }), /only/);
  await t.qbo.write('POST', 'item', base, { categoryIds: ['271'] });
  assert.equal(t.m.posts.length, 1);
  assert.deepEqual(parseInvoiceCommand('دسته و کد نوار لبه'), { type: 'bulk_edge' });
  assert.deepEqual(parseInvoiceCommand('بله#D1'), { type: 'yes', id: 'D1' });
});


// ---- job R: switch off the nine old edge banding items
const oldEdgeWorld = (extra = []) => [
  ...[['3019', 134, 4000], ['3020', 135, 5000], ['394', 129, 3000], ['640', 130, 3000], ['726', 132, 3500], ['729', 133, 3000], ['735', 131, 4200], ['840', 128, 3000]]
    .map(([c, id, q]) => I(id, `EDGE BAND 1MM*22(${c})`, { Sku: `EDGE BAND 1MM*22(${c})`, QtyOnHand: q, PurchaseCost: 0.36 })),
  I(140, 'edge banding', { Sku: 'edge banding', QtyOnHand: 100, PurchaseCost: 0.36 }),
  I(239, 'EDGE BANDING', { Type: 'Category' }), // the category has the same name apart from case: never an item of this job
  I(300, '1801 edge banding', { QtyOnHand: 50 }), I(301, 'GLUE EDGE BANDING ARYAK'),
  ...extra,
];

test('R plan: exactly the nine by exact name, with stock, cost and value; the category, the glue and the numbered items are not in it', () => {
  const r = planOldEdge(oldEdgeWorld());
  assert.deepEqual(r.found.map((x) => x.id).sort(), ['128', '129', '130', '131', '132', '133', '134', '135', '140']);
  assert.equal(r.found.find((x) => x.id === '134').value, 1440); // 4000 x 0.36
  assert.equal(r.total, Math.round((4000 + 5000 + 3000 + 3000 + 3500 + 3000 + 4200 + 3000 + 100) * 0.36 * 100) / 100);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(planOldEdge([]).missing.length, 9);
  const two = planOldEdge(oldEdgeWorld([I(141, 'edge banding')]));
  assert.deepEqual(two.ambiguous, ['edge banding']);
  assert.deepEqual(planOldEdge(oldEdgeWorld().map((i) => (i.Id === '135' ? { ...i, Active: false } : i))).already, ['EDGE BAND 1MM*22(3020)']);
});

test('R run: the preview shows stock and value and the promise; the yes switches off (Active false only); a 400 for stock is skipped with its message', async () => {
  const t = mk({ items: oldEdgeWorld(), rejectIds: ['135'] });
  assert.match(t.bulk.constructor.name, /Desk/);
  const [pv] = await t.bulk.planOldEdge();
  assert.match(pv, /#R1/);
  assert.match(pv, /در کوییک‌بوکس کالا پاک نمی‌شود؛ غیرفعال می‌شود و موجودی‌اش با سند تعدیل انبار صفر می‌شود؛ فاکتورهای قبلی تغییر نمی‌کنند/);
  assert.match(pv, /EDGE BAND 1MM\*22\(3019\) \(شناسه 134\): موجودی 4,000، بها 0.36، ارزش 1,440/);
  assert.match(pv, /جمع ارزش موجودی/);
  assert.equal(t.m.posts.length, 0);
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'R1' });
  const rep = await done;
  const by = (id) => t.m.db.Item.find((i) => i.Id === String(id));
  for (const id of [134, 129, 130, 132, 133, 131, 128, 140]) assert.equal(by(id).Active, false, String(id));
  assert.equal(by(135).Active, true); // refused: stays, reported
  assert.match(rep, /EDGE BAND 1MM\*22\(3020\): Business Validation Error/);
  assert.doesNotMatch(rep, /ایستاد/);
  assert.equal(by(239).Active, true); assert.equal(by(300).Active, true); assert.equal(by(301).Active, true); // category, numbered item, glue
  assert.ok(t.m.posts.every((p) => Object.keys(p.body).sort().join() === 'Active,Id,SyncToken,sparse' && p.body.Active === false));
  assert.equal(by(134).QtyOnHand, 4000); // the bot makes no adjustment
  assert.ok(t.audit.all().some((e) => e.field === 'deactivate' && e.qboId === '134' && e.qty === 4000));
  // the same preview again after the one refusal: only that one is left
  const [pv2] = await t.bulk.planOldEdge();
  assert.match(pv2, /#R2/);
  assert.match(pv2, /۱ کالا/);
});

test('R: an item whose name no longer matches the preview is not touched; the write door only opens for a named id; inactive items are never matched', async () => {
  const t = mk({ items: oldEdgeWorld() });
  await t.bulk.planOldEdge();
  t.m.db.Item.find((i) => i.Id === '134').Name = 'Renamed since'; // changed between preview and yes
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'R1' });
  const rep = await done;
  assert.equal(t.m.db.Item.find((i) => i.Id === '134').Active, true);
  assert.match(rep, /Renamed since|EDGE BAND 1MM\*22\(3019\): نامش با پیش‌نمایش نمی‌خواند/);
  const base = { Id: '134', SyncToken: '0', sparse: true, Active: false };
  await assert.rejects(() => t.qbo.write('POST', 'item', base), /only/);
  await assert.rejects(() => t.qbo.write('POST', 'item', { ...base, Active: true }, { inactivateIds: ['134'] }), /only/); // an item can be named for OFF only
  await assert.rejects(() => t.qbo.write('POST', 'item', { ...base, UnitPrice: 1 }, { inactivateIds: ['134'] }), /only/);
  const { pickItem } = await import('../src/qboinvoice.js');
  const items = [I(1, 'edge banding', { Sku: 'edge banding', Active: false }), I(2, '1801 edge banding')];
  assert.equal(pickItem('edge banding', { items }).stop !== undefined || pickItem('edge banding', { items }).item?.Id === '2', true);
  assert.notEqual(pickItem('edge banding', { items }).item?.Id, '1'); // the inactive one is never the answer
  assert.deepEqual(parseInvoiceCommand('حذف نوار لبه‌های قدیمی'), { type: 'bulk_old_edge' });
  assert.deepEqual(parseInvoiceCommand('بله#R1'), { type: 'yes', id: 'R1' });
});


// ---- job F: tidy names and descriptions of the edge banding items
const nameWorld = (extra = []) => [
  I(239, 'EDGE BANDING', { Type: 'Category' }),
  I(271, 'EDGE 0.8x22', { Type: 'Category', ParentRef: { value: '239' }, SubItem: true }), I(272, 'EDGE 0.8x50', { Type: 'Category', ParentRef: { value: '239' }, SubItem: true }),
  ...[1801, 1802, 1803].map((n) => I(n + 1000, `${n} edge banding`, { Sku: `EDGE22-${n}`, ParentRef: { value: '271' }, SubItem: true, Description: 'EDGE BANDING 0.18 THICKNESS', PurchaseCost: 0.36, UnitPrice: 0.9, QtyOnHand: 100 })),
  I(3802, 'B 1802', { Sku: 'EDGE50-1802', ParentRef: { value: '272' }, SubItem: true, Description: 'EDGE BANDING 0.8*50MM', PurchaseCost: 0.5, UnitPrice: 1.4, QtyOnHand: 10 }),
  I(3810, 'B 1810', { Sku: 'EDGE50-1810', ParentRef: { value: '272' }, SubItem: true, Description: 'EDGE BANDING 0.8*50MM', PurchaseCost: 0, UnitPrice: 220, QtyOnHand: -5 }), // cost 0, a price outlier, negative stock
  I(3804, 'B 1804', { Sku: 'EDGE50-1804', ParentRef: { value: '272' }, SubItem: true, UnitPrice: 1.5, PurchaseCost: 0.5 }),
  I(8000, 'EDGE BAND 0.8x50 - 1804', { Active: false }), // an inactive item already holds this name: a clash
  I(3899, 'B 1899', { Sku: 'WRONG-1', ParentRef: { value: '272' }, SubItem: true }), // the SKU does not say a colour: skipped
  I(9000, 'Hinge', { Sku: 'H1' }), I(9001, 'EDGE22-9999 outside', { Sku: 'EDGE22-9999' }), // not in the categories: never touched
  ...extra,
];

test('F plan: the new names and descriptions from the category and the colour; clashes, bad SKUs listed; warnings change nothing', () => {
  const w = nameWorld();
  const active = w.filter((i) => i.Active !== false);
  const r = planEdgeNames(active, w, w.filter((i) => i.Type === 'Category'));
  assert.deepEqual(r.changes.map((c) => [c.old, c.new]).sort(), [['1801 edge banding', 'EDGE BAND 0.8x22 - 1801'], ['1802 edge banding', 'EDGE BAND 0.8x22 - 1802'], ['1803 edge banding', 'EDGE BAND 0.8x22 - 1803'], ['B 1802', 'EDGE BAND 0.8x50 - 1802'], ['B 1810', 'EDGE BAND 0.8x50 - 1810']]);
  assert.equal(r.changes[0].desc, 'EDGE BANDING 0.8 x 22 MM - COLOUR 1801');
  assert.deepEqual(r.skipped.map((s) => s.label).sort(), ['B 1804', 'B 1899']);
  assert.match(r.skipped.find((s) => s.label === 'B 1804').why, /کالای دیگری دارد/);
  assert.ok(r.warnings.some((x) => /B 1810|0.8x50 - 1810/.test(x) && /بهای خرید/.test(x)));
  assert.ok(r.warnings.some((x) => /موجودی منفی/.test(x)));
  assert.ok(r.warnings.some((x) => /1810.*220/.test(x)));
  assert.equal(r.changes.some((c) => c.label === 'Hinge' || /9999/.test(c.label)), false);
});

test('F run: Name, Description and PurchaseDesc only; the old names stay as aliases; a second run changes nothing', async () => {
  const t = mk({ items: nameWorld() });
  const [pv] = await t.bulk.planEdgeNames();
  assert.match(pv, /#F1/);
  assert.match(pv, /مبلغ و شرح سطرهای فاکتورهای قبلی تغییر نمی‌کند؛ ولی در صفحهٔ فاکتورهای قبلی، ستون نام کالا نام تازه را نشان می‌دهد چون کوییک‌بوکس نام کالا را از خود کالا می‌خواند/);
  assert.match(pv, /1801 edge banding → EDGE BAND 0.8x22 - 1801/);
  assert.match(pv, /هشدار دادهٔ کالاها/);
  assert.equal(t.m.posts.length, 0);
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'F1' });
  const rep = await done;
  const by = (id) => t.m.db.Item.find((i) => i.Id === String(id));
  assert.equal(by(2801).Name, 'EDGE BAND 0.8x22 - 1801'); assert.equal(by(2801).Description, 'EDGE BANDING 0.8 x 22 MM - COLOUR 1801'); assert.equal(by(2801).PurchaseDesc, 'EDGE BANDING 0.8 x 22 MM - COLOUR 1801');
  assert.equal(by(3802).Name, 'EDGE BAND 0.8x50 - 1802');
  assert.equal(by(3804).Name, 'B 1804'); assert.equal(by(3899).Name, 'B 1899'); assert.equal(by(9000).Name, 'Hinge'); // skipped and outside
  assert.equal(by(2801).UnitPrice, 0.9); assert.equal(by(2801).Sku, 'EDGE22-1801'); assert.equal(by(2801).ParentRef.value, '271'); assert.equal(by(2801).PurchaseCost, 0.36);
  assert.ok(t.m.posts.every((p) => Object.keys(p.body).every((k) => ['Id', 'SyncToken', 'sparse', 'Name', 'Description', 'PurchaseDesc'].includes(k))));
  assert.match(rep, /۵ تغییر کرد/);
  // the old names still find the item
  const { pickItem } = await import('../src/qboinvoice.js');
  const taught = (c) => { const x = t.itemCodes.get('', c); return x ? t.m.db.Item.find((i) => i.Id === x.itemId) : null; };
  const items = t.m.db.Item;
  assert.equal(pickItem('1801 edge banding', { items, taught }).item.Id, '2801');
  assert.equal(pickItem('1801 edge', { items, taught }).item.Id, '2801');
  assert.equal(pickItem('B 1802', { items, taught }).item.Id, '3802');
  assert.equal(pickItem('EDGE BAND 0.8x22 - 1801', { items }).item.Id, '2801'); // the new name resolves
  assert.equal(pickItem('EDGE22-1801', { items }).item.Id, '2801');
  const n = t.m.posts.length;
  await t.bulk.decide({ verb: 'yes', id: 'F1' });
  assert.equal(t.m.posts.length, n);
  assert.match((await t.bulk.planEdgeNames())[0], /ماند|از پیش|۲ کالا رد شد|رد شد/);
});

test('F: a 400 on one item is skipped; an item that left its category since the preview is not touched; the write door needs the named id', async () => {
  const t = mk({ items: nameWorld(), rejectIds: ['2802'] });
  await t.bulk.planEdgeNames();
  t.m.db.Item.find((i) => i.Id === '2803').ParentRef = { value: '555' }; // moved since the preview
  const done = t.finished();
  await t.bulk.decide({ verb: 'yes', id: 'F1' });
  const rep = await done;
  assert.match(rep, /1802 edge banding: Business Validation Error/);
  assert.equal(t.m.db.Item.find((i) => i.Id === '2803').Name, '1803 edge banding');
  assert.equal(t.m.db.Item.find((i) => i.Id === '2801').Name, 'EDGE BAND 0.8x22 - 1801');
  const base = { Id: '2801', SyncToken: '0', sparse: true, Name: 'X' };
  await assert.rejects(() => t.qbo.write('POST', 'item', base), /only/);
  await assert.rejects(() => t.qbo.write('POST', 'item', { ...base, UnitPrice: 1 }, { renameIds: ['2801'] }), /only/);
  await assert.rejects(() => t.qbo.write('POST', 'item', { ...base, Name: '' }, { renameIds: ['2801'] }), /only/);
  await assert.rejects(() => t.qbo.write('POST', 'item', { ...base, Type: 'Inventory' }, { renameIds: ['2801'] }), /only/);
  assert.deepEqual(parseInvoiceCommand('نام و شرح نوار لبه'), { type: 'bulk_edge_names' });
  assert.deepEqual(parseInvoiceCommand('بله#F1'), { type: 'yes', id: 'F1' });
});

