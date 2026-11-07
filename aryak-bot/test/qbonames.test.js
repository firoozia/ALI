import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Qbo, QboError } from '../src/qbo.js';
import { QboDesk, QboMap } from '../src/qbodesk.js';
import { Aliases } from '../src/aliases.js';
import { CustomerGroups } from '../src/customergroups.js';
import { Audit, parseInvoiceCommand } from '../src/qboinvoice.js';
import { NamePreviews, QboNameDesk, planUpper } from '../src/qbonames.js';

// Invented customers only: nothing real is ever in the repository.
const REALM = '9130000000';
const res = (status, json) => ({ status, ok: status >= 200 && status < 300, json: async () => json, arrayBuffer: async () => Buffer.from(''), headers: { get: () => null } });
const C = (Id, DisplayName, extra = {}) => ({ Id: String(Id), SyncToken: '0', DisplayName, CompanyName: DisplayName, GivenName: 'Given', FamilyName: 'Family', PrintOnCheckName: DisplayName, Balance: 5, Active: true, ...extra });
const baseCustomers = () => [
  C(1, 'al burtomani national'), C(2, 'HAKIM CARPENTRY'), C(3, 'NUQOOSH ind . llc'), C(4, 'kitchen palace kitchens ind L.L.C'),
  C(5, 'Foo Co'), C(6, 'FOO CO'), // 5 would clash with the existing customer 6
  C(7, 'Bar Ltd'), C(8, 'bar ltd'), // both would become BAR LTD: both skipped
  C(9, 'Zed trading'), // a vendor already has ZED TRADING
  C(10, 'Émile & Fils'), C(11, 'only display', { CompanyName: 'ONLY DISPLAY' }), C(12, 'x', { CompanyName: undefined }),
];

function mockQbo(opts = {}) {
  const db = { customers: opts.customers || baseCustomers(), vendors: opts.vendors || [{ DisplayName: 'zed trading' }], employees: opts.employees || [] };
  const calls = []; const posts = [];
  let postsSeen = 0;
  const fetchFn = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ url: String(url), method: init.method || 'GET' });
    if (u.hostname === 'developer.intuit.com') return res(200, { authorization_endpoint: 'https://a.test/auth', token_endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', revocation_endpoint: 'https://a.test/revoke' });
    if (u.hostname.startsWith('oauth.')) return res(200, { access_token: 'ACCESS-X', refresh_token: 'REFRESH-X', expires_in: 3600 });
    const one = /\/customer\/(\d+)$/.exec(u.pathname);
    if (one && (init.method || 'GET') === 'GET') { const c = db.customers.find((x) => x.Id === one[1]); return res(c ? 200 : 404, { Customer: c && { ...c } }); }
    if (init.method === 'POST' && u.pathname.endsWith('/customer')) {
      postsSeen += 1;
      const body = JSON.parse(init.body);
      posts.push(body);
      if (opts.failOnPost && postsSeen === opts.failOnPost) return res(400, { Fault: { Error: [{ Message: 'Duplicate Name Exists Error' }] } });
      const c = db.customers.find((x) => x.Id === body.Id);
      if (c.SyncToken !== body.SyncToken) return res(400, { Fault: { Error: [{ Message: 'Stale Object Error' }] } });
      for (const k of ['DisplayName', 'CompanyName']) if (body[k] !== undefined) c[k] = body[k]; // a sparse update changes only what is sent
      c.SyncToken = String(Number(c.SyncToken) + 1);
      return res(200, { Customer: c });
    }
    const sql = u.searchParams.get('query') || '';
    const ent = /from\s+(\w+)/i.exec(sql)[1];
    if (ent === 'Vendor' && opts.vendorsDenied) return res(403, {});
    const rows = { Customer: db.customers, Vendor: db.vendors, Employee: db.employees }[ent] || [];
    return res(200, { QueryResponse: { [ent]: rows } });
  };
  return { fetchFn, calls, posts, db };
}

function mk(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qn-'));
  fs.writeFileSync(path.join(dir, 'qbo-tokens.json'), JSON.stringify({ refresh: 'R-1', access: '', accessExpiresAt: 0, initHash: '', realmId: REALM, needsReconnect: false }));
  const m = mockQbo(opts);
  const clock = { t: Date.parse('2026-11-08T08:00:00Z') };
  const config = { qboClientId: 'c', qboClientSecret: 's', qboEnv: 'production', qboRealmId: '', qboRefreshInit: '', qboWrite: opts.write !== false, qboMinorVersion: 75, testGroupNames: [], staffGroupNames: [], observeExcludeNames: [], shadowGroupNames: ['aryak'] };
  const qbo = new Qbo({ config, dir, fetchFn: m.fetchFn, now: () => clock.t, sleep: async () => {}, log: () => {} });
  const list = new CustomerGroups(path.join(dir, 'cg'));
  list.approve('al burtomani national', 'g@g.us', 'AL BURTOMANI - ARYAK');
  const desk = new QboDesk({ qbo, list, aliases: new Aliases(''), map: new QboMap(path.join(dir, 'map')), config, groups: async () => [], post: async () => {}, today: () => '2026-11-08', sleep: async () => {}, log: () => {} });
  const audit = new Audit(path.join(dir, 'qbo'), () => clock.t);
  const names = new QboNameDesk({ qbo, desk, audit, store: new NamePreviews(path.join(dir, 'qbo')), now: () => clock.t, sleep: async () => {}, gapMs: 400, log: () => {} });
  const reports = [];
  const done = new Promise((resolve) => { names.finish = async (parts) => { reports.push(...parts); resolve(parts.join('\n')); }; });
  return { dir, m, qbo, desk, audit, names, clock, config, reports, done };
}

test('the plan: only DisplayName and CompanyName, upper case, nothing else changes; clashes are found and skipped', () => {
  const r = planUpper(baseCustomers(), ['zed trading']);
  assert.deepEqual(r.changes.map((c) => [c.id, c.next]), [['1', 'AL BURTOMANI NATIONAL'], ['3', 'NUQOOSH IND . LLC'], ['4', 'KITCHEN PALACE KITCHENS IND L.L.C'], ['10', 'ÉMILE & FILS'], ['11', 'ONLY DISPLAY'], ['12', 'X']]);
  assert.equal(r.unchanged, 2); // HAKIM CARPENTRY and FOO CO are already upper
  assert.deepEqual(r.clashes.map((c) => [c.id, c.why]), [['5', 'دو مشتری با این نام یکی می‌شوند'], ['7', 'دو مشتری با این نام یکی می‌شوند'], ['8', 'دو مشتری با این نام یکی می‌شوند'], ['9', 'این نام برای تأمین‌کننده یا کارمند هست']]);
  const c11 = r.changes.find((c) => c.id === '11');
  assert.deepEqual([c11.displayChanges, c11.companyChanges], [true, false]); // the company name was already upper
  // spacing and dots are untouched
  assert.equal(r.changes.find((c) => c.id === '3').next, 'NUQOOSH IND . LLC');
});

test('the words: "نام مشتری‌ها با حروف بزرگ", and the yes and no with an N number', () => {
  assert.deepEqual(parseInvoiceCommand('نام مشتری‌ها با حروف بزرگ'), { type: 'names_plan' });
  assert.deepEqual(parseInvoiceCommand('نام مشتری ها با حروف بزرگ'), { type: 'names_plan' });
  assert.deepEqual(parseInvoiceCommand('بله #N1'), { type: 'yes', id: 'N1' });
  assert.deepEqual(parseInvoiceCommand('نه N12'), { type: 'no', id: 'N12' });
  assert.deepEqual(parseInvoiceCommand('بله #Q3'), { type: 'yes', id: 'Q3' }); // the invoice numbers still work
});

test('the preview writes nothing: counts, the first fifteen "old -> new", the clashes; the owner\'s yes updates only the two name fields, sparse, with a fresh SyncToken', async () => {
  const t = mk();
  const [p] = await t.names.plan();
  for (const s of ['#N1', 'از ۱۲ مشتری: ۶ تغییر می‌کند، ۲ از پیش درست است، ۴ به‌خاطر برخورد نام رد می‌شود', 'al burtomani national → AL BURTOMANI NATIONAL', 'Zed trading → ZED TRADING (این نام برای تأمین‌کننده یا کارمند هست)', 'Bar Ltd → BAR LTD', 'بله #N1', 'نه #N1']) assert.ok(p.includes(s), s);
  assert.equal(t.m.posts.length, 0);
  assert.equal(t.m.calls.filter((c) => c.method !== 'GET' && !c.url.includes('oauth')).length, 0);
  const started = (await t.names.decide({ verb: 'yes', id: 'N1' })).join('');
  assert.ok(started.includes('اجرا شروع شد'));
  const report = await t.done;
  assert.ok(report.includes('۶ تغییر کرد، ۴ رد شد (برخورد یا از پیش درست)، ۰ ناموفق'), report);
  // every update is sparse and only has Id, SyncToken, sparse and the changed names
  assert.equal(t.m.posts.length, 6);
  for (const b of t.m.posts) { assert.equal(b.sparse, true); assert.ok(Object.keys(b).every((k) => ['Id', 'SyncToken', 'sparse', 'DisplayName', 'CompanyName'].includes(k))); assert.equal(b.SyncToken, '0'); }
  assert.deepEqual(t.m.posts.find((b) => b.Id === '11'), { Id: '11', SyncToken: '0', sparse: true, DisplayName: 'ONLY DISPLAY' }); // the company name was already upper: not sent
  assert.deepEqual(t.m.posts.find((b) => b.Id === '12'), { Id: '12', SyncToken: '0', sparse: true, DisplayName: 'X' });
  const byId = Object.fromEntries(t.m.db.customers.map((c) => [c.Id, c]));
  assert.equal(byId['1'].DisplayName, 'AL BURTOMANI NATIONAL');
  assert.equal(byId['1'].CompanyName, 'AL BURTOMANI NATIONAL');
  assert.equal(byId['1'].GivenName, 'Given'); // other fields untouched
  assert.equal(byId['1'].PrintOnCheckName, 'al burtomani national');
  assert.equal(byId['10'].DisplayName, 'ÉMILE & FILS');
  assert.deepEqual(['5', '7', '8', '9'].map((id) => byId[id].DisplayName), ['Foo Co', 'Bar Ltd', 'bar ltd', 'Zed trading']); // the clashes were skipped
  // the audit log: every change with its id, old and new
  const a = t.audit.last(30).filter((x) => x.event === 'customer-name');
  assert.equal(a.length, 6);
  assert.deepEqual([a[0].qboId, a[0].old, a[0].new], ['1', 'al burtomani national', 'AL BURTOMANI NATIONAL']);
  assert.ok(t.audit.last(30).some((x) => x.event === 'names-done'));
});

test('idempotent: a second yes only reports; a new preview after the run finds nothing but the clashes; a customer already in upper case is skipped', async () => {
  const t = mk();
  await t.names.plan();
  await t.names.decide({ verb: 'yes', id: 'N1' });
  await t.done;
  const posts = t.m.posts.length;
  assert.ok((await t.names.decide({ verb: 'yes', id: 'N1' })).join('').includes('پیش‌تر اجرا شده است: ۶ تغییر کرد'));
  assert.equal(t.m.posts.length, posts);
  const [again] = await t.names.plan();
  assert.ok(again.includes('۰ تغییر می‌کند') === false || true);
  assert.ok(again.includes('#N2') && again.includes('از ۱۲ مشتری: ۰ تغییر می‌کند'));
  // a customer changed to upper case by someone else between the preview and the yes: skipped, not updated again
  const u = mk();
  await u.names.plan();
  u.m.db.customers.find((c) => c.Id === '1').DisplayName = 'AL BURTOMANI NATIONAL';
  u.m.db.customers.find((c) => c.Id === '1').CompanyName = 'AL BURTOMANI NATIONAL';
  await u.names.decide({ verb: 'yes', id: 'N1' });
  const report = await u.done;
  assert.ok(report.includes('۵ تغییر کرد') && report.includes('۵ رد شد'));
  assert.ok(!u.m.posts.some((b) => b.Id === '1'));
});

test('"no" cancels; a preview expires after 24 hours; an unknown id is said; nothing to change says so', async () => {
  const t = mk();
  await t.names.plan();
  assert.ok((await t.names.decide({ verb: 'no', id: 'N1' })).join('').includes('لغو شد'));
  assert.ok((await t.names.decide({ verb: 'yes', id: 'N1' })).join('').includes('لغو شده بود'));
  await t.names.plan();
  t.clock.t += 25 * 3600 * 1000;
  assert.ok((await t.names.decide({ verb: 'yes', id: 'N2' })).join('').includes('منقضی'));
  assert.equal(t.m.posts.length, 0);
  assert.ok((await t.names.decide({ verb: 'yes', id: 'N9' })).join('').includes('پیدا نشد'));
  const all = mk({ customers: [C(1, 'ALREADY UPPER'), C(2, 'ALSO UPPER')], vendors: [] });
  assert.ok((await all.names.plan()).join('').includes('از پیش با حروف بزرگ‌اند'));
});

test('QBO_WRITE off and the kill switch: nothing is updated; the kill switch stops a run and says how far it got; an error stops at the first one', async () => {
  const off = mk({ write: false });
  await off.names.plan();
  assert.ok((await off.names.decide({ verb: 'yes', id: 'N1' })).join('').includes('نوشتن در کوییک‌بوکس خاموش است'));
  assert.equal(off.m.posts.length, 0);
  assert.equal(off.names.store.get('N1').status, 'pending');
  const paused = mk();
  await paused.names.plan();
  paused.qbo.setPaused(true);
  assert.ok((await paused.names.decide({ verb: 'yes', id: 'N1' })).join('').includes('متوقف'));
  assert.ok((await paused.names.plan()).join('').includes('متوقف'));
  assert.equal(paused.m.posts.length, 0);
  // the switch turned on in the middle of a run: it stops there
  const mid = mk();
  await mid.names.plan();
  const realWrite = mid.qbo.write.bind(mid.qbo);
  let n = 0;
  mid.qbo.write = async (...a) => { n += 1; if (n === 3) mid.qbo.setPaused(true); return realWrite(...a); };
  await mid.names.decide({ verb: 'yes', id: 'N1' });
  const rep = await mid.done;
  assert.equal(mid.m.posts.length, 2);
  assert.ok(rep.includes('۲ تغییر کرد') && rep.includes('کلید توقف روشن است') && rep.includes('مورد انجام نشد'));
  assert.equal(mid.names.store.get('N1').status, 'pending'); // it can be run again: the done ones are skipped
  // an unexpected error on the second update: stop there, report
  const bad = mk({ failOnPost: 2 });
  await bad.names.plan();
  await bad.names.decide({ verb: 'yes', id: 'N1' });
  const brep = await bad.done;
  assert.equal(bad.m.posts.length, 2); // no third attempt
  assert.ok(brep.includes('۱ تغییر کرد') && brep.includes('۱ ناموفق') && brep.includes('در مورد ۲ ایستاد'));
});

test('only this customer write exists: a sparse update of the two name fields; nothing else is allowed on customers, with the switch on', async () => {
  const t = mk();
  const before = t.m.calls.length;
  for (const [method, p, body] of [
    ['POST', 'customer', { DisplayName: 'NEW' }], // a create
    ['POST', 'customer', { Id: '1', SyncToken: '0', sparse: true, Balance: 9 }], // another field
    ['POST', 'customer', { Id: '1', SyncToken: '0', sparse: true, DisplayName: 'A', PrintOnCheckName: 'B' }],
    ['POST', 'customer', { Id: '1', SyncToken: '0', DisplayName: 'A' }], // not sparse: a full update would blank the other fields
    ['POST', 'customer', { Id: '1', SyncToken: '0', sparse: true }], // nothing to change
    ['DELETE', 'customer', { Id: '1' }], ['POST', 'customer/1', { Id: '1' }], ['POST', 'vendor', { Id: '1', SyncToken: '0', sparse: true, DisplayName: 'A' }], ['POST', 'employee', {}],
  ]) await assert.rejects(() => t.qbo.write(method, p, body), (e) => e instanceof QboError && /only/.test(e.message), `${method} ${p}`);
  assert.equal(t.m.calls.length, before);
  await t.qbo.write('POST', 'customer', { Id: '1', SyncToken: '0', sparse: true, DisplayName: 'AL BURTOMANI NATIONAL' }); // the allowed one
  assert.equal(t.m.posts.length, 1);
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'qbonames.js'), 'utf8');
  assert.equal((src.match(/\.write\(/g) || []).length, 1);
  assert.ok(src.includes("'POST', 'customer'") && !/['"`](DELETE|PUT)['"`]/.test(src));
});

test('after a change the bot\'s customer list is read again and the matching, still case-insensitive, finds the same customers; the owner\'s yes is taken only in his own chat', async () => {
  const t = mk();
  const before = await t.desk.resolveStrict('al burtomani national');
  assert.equal(before.name, 'al burtomani national');
  await t.names.plan();
  await t.names.decide({ verb: 'yes', id: 'N1' });
  await t.done;
  assert.deepEqual(t.desk.cache.customers, []); // the cache was dropped
  t.desk.map.d.map = {}; // (the earlier choice of the name is forgotten to show the fresh match)
  const after = await t.desk.resolveStrict('al burtomani national');
  assert.deepEqual([after.id, after.name], ['1', 'AL BURTOMANI NATIONAL']);
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal((index.match(/qboNames\.decide\(/g) || []).length, 1); // one caller, in the owner's command function
  const block = index.slice(index.indexOf("The owner's invoice commands (his own chat, owner only)"), index.indexOf('"وضعیت سفارش‌ها" (his own chat'));
  assert.ok(block.includes('!group && isSelf') && block.includes('isOwnerCommand(') && block.includes('qboNames.finish'));
});
