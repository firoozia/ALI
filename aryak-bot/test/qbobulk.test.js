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
import { BulkPreviews, PriceDraft, QboBulkDesk, phoneKind, planMobiles, planPrices } from '../src/qbobulk.js';

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
      if (opts.failOnPost && postsSeen === opts.failOnPost) return res(400, { Fault: { Error: [{ Message: 'Business Validation Error' }] } });
      const r = db[key(ent)].find((x) => x.Id === body.Id);
      for (const [k, v] of Object.entries(body)) if (!['Id', 'SyncToken', 'sparse'].includes(k)) r[k] = v; // a sparse update changes only what is sent
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
  assert.deepEqual(parseInvoiceCommand('قیمت 108 = 12'), { type: 'price_set', lines: [{ code: '108', price: 12 }], bad: 0 });
  assert.deepEqual(parseInvoiceCommand('قیمت PVC FILM108 = 12\nقیمت 109 = 13.5'), { type: 'price_set', lines: [{ code: 'PVC FILM108', price: 12 }, { code: '109', price: 13.5 }], bad: 0 });
  assert.equal(parseInvoiceCommand('قیمت 108'), null); // the older price-book question is not ours
  assert.equal(parseInvoiceCommand('قیمت 108 = 12\nسلام'), null); // every line must be a price line
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
