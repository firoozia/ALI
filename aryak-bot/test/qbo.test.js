import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Qbo, QboError } from '../src/qbo.js';
import { MiniPdf, textWidth } from '../src/minipdf.js';
import { buildStatementData, money, statementPdf } from '../src/qbostatement.js';
import { QboDesk, QboMap, MAX_ALL, matchOne, parseQboCommand, pickTestGroup } from '../src/qbodesk.js';
import { Aliases } from '../src/aliases.js';
import { CustomerGroups } from '../src/customergroups.js';

// Invented names, keys and amounts only: nothing real is ever in the repository.
const SECRET = 'S3CRET-VALUE-XYZ';
const CID = 'CLIENT-ID-ABC';
const INIT = 'INIT-REFRESH-TOKEN-111';
const baseConfig = (extra = {}) => ({
  qboClientId: CID, qboClientSecret: SECRET, qboEnv: 'sandbox', qboRealmId: '9130000000', qboRefreshInit: INIT, qboWrite: false, qboMinorVersion: 75,
  testGroupNames: ['test aryak bot'], staffGroupNames: ['aryak staff'], invoiceGroupName: 'invoices group', infoGroupName: 'information group', cutGroupName: 'aryak orders pictures',
  observeExcludeNames: [], shadowGroupNames: ['aryak'], testCustomerName: 'test customer', ...extra,
});
const res = (status, json, headers = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => json, headers: { get: (k) => headers[String(k).toLowerCase()] ?? null } });

/** A mocked Intuit: the token endpoint (a new rotating refresh token every time) and the data endpoints. */
function mockIntuit(db = {}) {
  const calls = [];
  const tokens = { n: 0, seen: [] };
  const fetchFn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('oauth.platform.intuit.com')) {
      const body = new URLSearchParams(init.body);
      tokens.seen.push(body.get('refresh_token'));
      tokens.n += 1;
      if (db.rejectRefresh) return res(400, { error: 'invalid_grant' });
      return res(200, { access_token: `ACCESS-${tokens.n}`, refresh_token: `REFRESH-${tokens.n}`, expires_in: 3600, x_refresh_token_expires_in: 8640000 });
    }
    if (String(url).includes('developer.intuit.com/.well-known')) return res(200, { authorization_endpoint: 'https://appcenter.intuit.com/connect/oauth2', token_endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', revocation_endpoint: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke' });
    if (String(url).includes('tokens/revoke')) { tokens.revoked = (tokens.revoked || []); tokens.revoked.push(JSON.parse(init.body).token); return res(db.revokeStatus || 200, {}); }
    if (db.script) { const r = db.script.shift(); if (r) return r(String(url), init); }
    const u = new URL(String(url));
    if (u.pathname.includes('/companyinfo/')) return res(200, { CompanyInfo: db.company || { CompanyName: 'The Test Workshop', Country: 'AE', CompanyAddr: { Line1: 'Industrial Area 1', City: 'Sharjah', Country: 'UAE' } } });
    const sql = u.searchParams.get('query') || '';
    const entity = /from\s+(\w+)/i.exec(sql)?.[1];
    const idm = /(?:Id|CustomerRef)\s*=\s*'([^']*)'/.exec(sql);
    let rows = (db[entity] || []);
    if (idm && entity === 'Customer') rows = rows.filter((r) => r.Id === idm[1]);
    else if (idm) rows = rows.filter((r) => r.CustomerRef?.value === idm[1]);
    const start = Number(/STARTPOSITION (\d+)/.exec(sql)?.[1] || 1);
    const max = Number(/MAXRESULTS (\d+)/.exec(sql)?.[1] || 1000);
    return res(200, { QueryResponse: { [entity]: rows.slice(start - 1, start - 1 + max) } });
  };
  return { fetchFn, calls, tokens };
}
const mk = (config = baseConfig(), db = {}, extra = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qbo-'));
  const logs = [];
  const m = mockIntuit(db);
  const sleeps = [];
  let clock = 1_000_000;
  const qbo = new Qbo({ config, dir, fetchFn: m.fetchFn, now: () => clock, sleep: async (ms) => { sleeps.push(ms); }, log: (s) => logs.push(s), ...extra });
  return { dir, logs, m, sleeps, qbo, tick: (ms) => { clock += ms; }, config };
};

test('the first refresh token comes from the settings once; every new one is saved at once and used next time, across a restart', async () => {
  const { dir, m, qbo, config } = mk();
  await qbo.get('companyinfo/9130000000');
  assert.deepEqual(m.tokens.seen, [INIT]);
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'qbo-tokens.json'), 'utf8'));
  assert.equal(stored.refresh, 'REFRESH-1');
  assert.equal(stored.access, 'ACCESS-1');
  const again = new Qbo({ config, dir, fetchFn: m.fetchFn, now: () => 9_000_000, sleep: async () => {}, log: () => {} }); // a restart, the access token has expired
  await again.get('companyinfo/9130000000');
  assert.deepEqual(m.tokens.seen, [INIT, 'REFRESH-1']); // the init token was used once only; the rotated one is used now
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'qbo-tokens.json'), 'utf8')).refresh, 'REFRESH-2');
  const auth = m.calls.find((c) => c.url.includes('oauth')).init.headers.Authorization;
  assert.equal(auth, `Basic ${Buffer.from(`${CID}:${SECRET}`).toString('base64')}`);
  // a NEW value of the init setting (a fresh authorization) replaces the stored token
  const fresh = new Qbo({ config: { ...config, qboRefreshInit: 'INIT-NEW-222' }, dir, fetchFn: m.fetchFn, now: () => 99_000_000, sleep: async () => {}, log: () => {} });
  await fresh.get('companyinfo/9130000000');
  assert.equal(m.tokens.seen.at(-1), 'INIT-NEW-222');
});

test('two requests at once share one refresh (the rotating token would be spoiled by two)', async () => {
  const { m, qbo } = mk();
  await Promise.all([qbo.get('companyinfo/9130000000'), qbo.get('companyinfo/9130000000'), qbo.get('companyinfo/9130000000')]);
  assert.equal(m.tokens.n, 1);
});

test('a 401 refreshes once and retries; a second 401 is an error', async () => {
  const db = { script: [(url) => res(401, { fault: { error: [{ message: 'expired' }] } })] };
  const { m, qbo } = mk(baseConfig(), db);
  const j = await qbo.get('companyinfo/9130000000');
  assert.ok(j.CompanyInfo);
  assert.equal(m.tokens.n, 2); // the first login, then the refresh on the 401
  const both = mk(baseConfig(), { script: [() => res(401, {}), () => res(401, {})] });
  await assert.rejects(() => both.qbo.get('companyinfo/9130000000'), (e) => e instanceof QboError && e.status === 401);
});

test('429 and 5xx are retried with backoff (and Retry-After); other errors are not retried; the pause is capped', async () => {
  const db = { script: [() => res(429, {}, { 'retry-after': '3' }), () => res(503, {}), () => res(500, {})] };
  const { qbo, sleeps } = mk(baseConfig(), db);
  await qbo.get('companyinfo/9130000000');
  assert.deepEqual(sleeps, [3000, 2000, 4000]);
  const bad = mk(baseConfig(), { script: [() => res(400, { Fault: { Error: [{ Message: 'bad query' }] } })] });
  await assert.rejects(() => bad.qbo.get('query', { query: 'x' }), (e) => /400/.test(e.message) && /bad query/.test(e.message));
  assert.deepEqual(bad.sleeps, []);
  const down = mk(baseConfig(), { script: [() => res(500, {}), () => res(500, {}), () => res(500, {}), () => res(500, {})] });
  await assert.rejects(() => down.qbo.get('companyinfo/9130000000'), QboError);
  assert.equal(down.sleeps.length, 3);
});

test('no token, secret or Authorization header ever reaches a log or an error message', async () => {
  const { logs, qbo } = mk(baseConfig(), { script: [() => res(401, {})] });
  await qbo.get('companyinfo/9130000000');
  await qbo.companyInfo();
  const fail = mk(baseConfig(), { rejectRefresh: true });
  let message = '';
  try { await fail.qbo.get('companyinfo/9130000000'); } catch (e) { message = e.message; }
  const all = [...logs, ...fail.logs, message].join('\n');
  for (const secret of [SECRET, INIT, 'ACCESS-1', 'REFRESH-1', 'Bearer', 'Basic', 'Authorization', Buffer.from(`${CID}:${SECRET}`).toString('base64')]) assert.ok(!all.includes(secret), secret);
  assert.ok(logs.some((l) => /QuickBooks GET companyinfo -> 200/.test(l)) && /needs reconnecting/.test(message));
});

test('writes are refused while QBO_WRITE is off, and nothing is sent; every read is a GET', async () => {
  const { m, qbo } = mk();
  await assert.rejects(() => qbo.write('POST', 'invoice', { Line: [] }), (e) => e instanceof QboError && /switched off/.test(e.message));
  assert.equal(m.calls.length, 0); // not even a login
  await qbo.query('select * from Customer');
  await qbo.companyInfo();
  assert.ok(m.calls.filter((c) => !c.url.includes('oauth')).every((c) => c.init.method === 'GET' && !c.init.body));
  const on = mk(baseConfig({ qboWrite: true }));
  await on.qbo.write('POST', 'invoice', { Line: [] }); // the switch is the only gate; this stage has no caller of it
  assert.equal(on.m.calls.at(-1).init.method, 'POST');
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'qbodesk.js'), 'utf8') + fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'qbostatement.js'), 'utf8');
  assert.ok(!/\.write\(|\.send\(|'POST'|"POST"/.test(src)); // the desk and the statement can only read
});

test('a query is paged and the base URL, minor version and company follow the settings', async () => {
  const many = Array.from({ length: 1003 }, (_, i) => ({ Id: String(i) }));
  const { m, qbo } = mk(baseConfig(), { Customer: many });
  const rows = await qbo.query('select * from Customer');
  assert.equal(rows.length, 1003);
  const urls = m.calls.filter((c) => c.url.includes('/query')).map((c) => decodeURIComponent(c.url));
  assert.ok(urls[0].includes('STARTPOSITION 1 MAXRESULTS 1000') && urls[1].includes('STARTPOSITION 1001 MAXRESULTS 1000'));
  assert.ok(urls[0].startsWith('https://sandbox-quickbooks.api.intuit.com/v3/company/9130000000/query') && urls[0].includes('minorversion=75'));
  const prod = mk(baseConfig({ qboEnv: 'production' }));
  await prod.qbo.companyInfo();
  assert.ok(prod.m.calls.at(-1).url.startsWith('https://quickbooks.api.intuit.com/v3/company/9130000000/'));
  assert.deepEqual(mk(baseConfig({ qboClientId: '', qboClientSecret: '' })).qbo.missing, ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET']);
});

// ------------------------------------------------------------------------------------------------------------------ the statement
const INV = [
  { Id: '1', DocNumber: 'INV-1', TxnDate: '2026-09-01', DueDate: '2026-09-30', TotalAmt: 100.1, Balance: 100.1, CustomerRef: { value: '58' } },
  { Id: '2', DocNumber: 'INV-2', TxnDate: '2026-10-05', DueDate: '2026-11-04', TotalAmt: 200.2, Balance: 200.2, CustomerRef: { value: '58' } },
  { Id: '3', DocNumber: 'INV-3', TxnDate: '2026-10-20', DueDate: '2026-12-01', TotalAmt: 300.3, Balance: 0, CustomerRef: { value: '58' } },
  { Id: '4', DocNumber: 'INV-4', TxnDate: '2026-06-01', DueDate: '2026-06-30', TotalAmt: 50.05, Balance: 50.05, CustomerRef: { value: '58' } },
];
const PAY = [{ Id: 'p1', TxnDate: '2026-10-25', PaymentRefNum: 'CHQ-9', TotalAmt: 300.3, UnappliedAmt: 0, CustomerRef: { value: '58' } }, { Id: 'p2', TxnDate: '2026-10-28', TotalAmt: 100.15, UnappliedAmt: 100.15, CustomerRef: { value: '58' } }];
const CRD = [{ Id: 'c1', DocNumber: 'CM-1', TxnDate: '2026-10-10', TotalAmt: 20.2, Balance: 20.2, CustomerRef: { value: '58' } }];
const COMPANY = { CompanyName: 'The Test Workshop', Country: 'AE', CompanyAddr: { Line1: 'Industrial Area 1', City: 'Sharjah', Country: 'UAE' }, Email: { Address: 'office@example.test' } };
const CUSTOMER = (balance) => ({ Id: '58', DisplayName: 'Orion Furniture', CompanyName: 'Orion Furniture LLC', Balance: balance, BillAddr: { Line1: 'Shop 4', City: 'Dubai', Country: 'UAE' } });

test('the statement totals equal the data to the fil: closing, opening, running balance and the ageing buckets', () => {
  // open: INV-1 100.10 + INV-2 200.20 + INV-4 50.05 = 350.35; less unapplied payment 100.15 and credit memo balance 20.20 = 230.00
  const d = buildStatementData({ company: COMPANY, customer: CUSTOMER(230), invoices: INV, payments: PAY, credits: CRD, today: '2026-11-07', days: 60 });
  assert.equal(d.closing, 23000);
  assert.equal(d.balanceCheck.matches, true);
  // the period (60 days to 07/11) holds INV-2, INV-3, the two payments and the credit memo: +200.20 +300.30 -300.30 -100.15 -20.20 = 79.85
  assert.equal(d.lines.length, 5);
  assert.equal(d.opening, 23000 - 7985); // 150.15 = INV-1 100.10 + INV-4 50.05
  assert.equal(d.opening, 15015);
  assert.equal(d.lines.at(-1).balance, d.closing); // the running balance ends exactly at the closing balance
  assert.equal(d.lines.reduce((s, l) => s + l.amount, d.opening), d.closing);
  // ageing as of 07/11: INV-4 (due 30/06) over 90, INV-1 (due 30/09) 38 days = 31-60, INV-2 (due 04/11) 3 days = 1-30; credits -120.35
  assert.deepEqual(d.ageing, { current: 0, d1_30: 20020, d31_60: 10010, d61_90: 0, d91: 5005 });
  assert.equal(d.credit, -12035);
  assert.equal(d.ageingTotal, d.closing);
  // a customer balance that differs is said
  assert.equal(buildStatementData({ company: COMPANY, customer: CUSTOMER(231.5), invoices: INV, payments: PAY, credits: CRD, today: '2026-11-07' }).balanceCheck.matches, false);
  // floating point cannot leak in: 0.1 + 0.2 style sums are whole fils
  const f = buildStatementData({ company: COMPANY, customer: CUSTOMER(30.3), invoices: [{ TxnDate: '2026-11-01', TotalAmt: 10.1, Balance: 10.1 }, { TxnDate: '2026-11-02', TotalAmt: 20.2, Balance: 20.2 }], today: '2026-11-07' });
  assert.equal(f.closing, 3030);
  assert.equal(money(3030), '30.30');
  assert.equal(money(-5), '-0.05');
  assert.equal(money(123456789), '1,234,567.89');
});

test('the PDF is a valid one-page document with the company, customer, period, lines, balance and ageing; the footer only in the sandbox', () => {
  const d = buildStatementData({ company: COMPANY, customer: CUSTOMER(230), invoices: INV, payments: PAY, credits: CRD, today: '2026-11-07', days: 60 });
  const sandbox = statementPdf(d, { sandbox: true }).toString('latin1');
  assert.ok(sandbox.startsWith('%PDF-1.4') && sandbox.trimEnd().endsWith('%%EOF'));
  for (const s of ['The Test Workshop', 'STATEMENT', 'Orion Furniture', 'Balance brought forward', 'INV-2', 'CHQ-9', 'CM-1', '230.00', '150.15', 'Over 90 days', 'test, built by Atossa']) assert.ok(sandbox.includes(s), s);
  const off = Number(/startxref\n(\d+)\n/.exec(sandbox)[1]);
  assert.equal(sandbox.slice(off, off + 4), 'xref'); // the cross-reference offset is right
  assert.ok(!statementPdf(d, { sandbox: false }).toString('latin1').includes('test, built by Atossa'));
  const many = buildStatementData({ company: COMPANY, customer: CUSTOMER(0), invoices: Array.from({ length: 90 }, (_, i) => ({ DocNumber: `N${i}`, TxnDate: '2026-11-01', TotalAmt: 1, Balance: 0 })), today: '2026-11-07' });
  const long = statementPdf(many, { sandbox: true }).toString('latin1');
  assert.ok(/Page 3 of 3/.test(long) && /\/Count 3/.test(long)); // 90 lines: 28 + 48 + 14
  const pdf = new MiniPdf().text(50, 50, 'a (b) \\ c Arabic: م');
  assert.ok(pdf.build().toString('latin1').includes('a \\(b\\) \\\\ c Arabic: ?')); // escaped; a letter outside Latin-1 becomes "?"
  assert.ok(textWidth('Hello', 10) > 0 && textWidth('W', 10) > textWidth('i', 10));
});

// ------------------------------------------------------------------------------------------------------------------ commands and the test group
const GROUPS = [{ id: 't1@g.us', subject: 'TEST ARYAK BOT' }, { id: 'c1@g.us', subject: 'ORION - ARYAK' }, { id: 's1@g.us', subject: 'Aryak Staff' }];
const QB_CUSTOMERS = [CUSTOMER(230), { Id: '60', DisplayName: 'Cedar Wood', CompanyName: 'Cedar Wood LLC', Balance: 0 }, { Id: '61', DisplayName: 'Blue Point', Balance: 0 }, { Id: '62', DisplayName: 'Blue Capital', Balance: 0 }];
function mkDesk(groups = GROUPS, db = {}) {
  const base = mk(baseConfig(), { Customer: QB_CUSTOMERS, Invoice: INV, Payment: PAY, CreditMemo: CRD, company: COMPANY, ...db });
  const list = new CustomerGroups(path.join(base.dir, 'cg'));
  const posts = [];
  const sleeps = [];
  const desk = new QboDesk({
    qbo: base.qbo, list, aliases: new Aliases(''), map: new QboMap(path.join(base.dir, 'map')), config: base.config, gapMs: 5000,
    groups: async () => groups, post: async (jid, buf, fileName, caption) => { posts.push({ jid, size: buf.length, fileName, caption, head: buf.subarray(0, 8).toString('latin1') }); },
    today: () => '2026-11-07', sleep: async (ms) => { sleeps.push(ms); }, log: () => {},
  });
  return { ...base, list, posts, sleeps, desk };
}

test('the commands are read in Persian with either spelling of QuickBooks', () => {
  assert.deepEqual(parseQboCommand('وضعیت کوییک‌بوکس'), { type: 'status' });
  assert.deepEqual(parseQboCommand('وضعیت کویک بوکس'), { type: 'status' });
  assert.deepEqual(parseQboCommand('تطبیق کوییک‌بوکس'), { type: 'match' });
  assert.deepEqual(parseQboCommand('تطبیق ۳ = ۲'), { type: 'pick', n: 3, option: 2 });
  assert.deepEqual(parseQboCommand('تطبیق ۳ نه'), { type: 'skip', n: 3 });
  assert.deepEqual(parseQboCommand('صورت‌حساب Orion Furniture'), { type: 'statement', name: 'Orion Furniture' });
  assert.deepEqual(parseQboCommand('صورت‌حساب همه'), { type: 'all' });
  assert.equal(parseQboCommand('سلام'), null);
  assert.equal(parseQboCommand('صورت‌حساب'), null);
});

test('a statement goes ONLY to the test group, whatever is asked; with no test group nothing is sent', async () => {
  assert.equal(pickTestGroup(GROUPS, baseConfig()).id, 't1@g.us');
  assert.equal(pickTestGroup(GROUPS.filter((g) => g.id !== 't1@g.us'), baseConfig()), null); // a customer group or the staff group is never the target
  const t = mkDesk();
  t.list.approve('Orion Furniture', 'c1@g.us', 'ORION - ARYAK');
  const out = (await t.desk.handle(parseQboCommand('صورت‌حساب Orion Furniture'))).join('\n');
  assert.equal(t.posts.length, 1);
  assert.equal(t.posts[0].jid, 't1@g.us');
  assert.equal(t.posts[0].head, '%PDF-1.4');
  assert.ok(t.posts[0].caption.includes('Orion Furniture') && t.posts[0].caption.includes('230.00'));
  assert.ok(out.includes('به گروه آزمایشی رفت'));
  const noTest = mkDesk(GROUPS.filter((g) => g.id !== 't1@g.us'));
  noTest.list.approve('Orion Furniture', 'c1@g.us', 'ORION - ARYAK');
  const none = (await noTest.desk.handle(parseQboCommand('صورت‌حساب Orion Furniture'))).join('\n');
  assert.equal(noTest.posts.length, 0);
  assert.ok(none.includes('گروه آزمایشی پیدا نشد'));
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'qbodesk.js'), 'utf8');
  assert.ok(!/sendMessage/.test(src)); // the desk never sends by itself: it hands the document to the test-group poster
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  const block = index.slice(index.indexOf('QuickBooks (his own chat, owner only)'), index.indexOf('"وضعیت سفارش‌ها" (his own chat'));
  assert.ok(block.includes('!group && isSelf') && block.includes('isOwnerCommand('));
});

test('a mismatch with the QuickBooks customer balance is said on the post', async () => {
  const t = mkDesk(GROUPS, { Customer: [CUSTOMER(999.99)] });
  t.list.approve('Orion Furniture', 'c1@g.us', 'ORION - ARYAK');
  const out = (await t.desk.handle({ type: 'statement', name: 'Orion Furniture' })).join('\n');
  assert.ok(t.posts[0].caption.includes('QuickBooks balance differs: AED 999.99'));
  assert.ok(out.includes('با مانده کوییک‌بوکس نمی‌خواند'));
});

test('"all" posts one statement per listed customer, a gap between posts, at most 50, only to the test group; customers it cannot match are named', async () => {
  const names = Array.from({ length: 60 }, (_, i) => `Customer Number${i}`);
  const customers = names.map((n, i) => ({ Id: `X${i}`, DisplayName: n, Balance: 0 }));
  const t = mkDesk(GROUPS, { Customer: [...customers, CUSTOMER(230)] });
  names.forEach((n, i) => t.list.approve(n, 'c1@g.us', 'ORION - ARYAK'));
  const done = new Promise((resolve) => { t.desk.finish = async (parts) => resolve(parts.join('\n')); });
  const head = (await t.desk.handle({ type: 'all' })).join('\n');
  assert.ok(head.includes('۵۰ صورت‌حساب') || head.includes('شروع شد'));
  assert.ok((await t.desk.handle({ type: 'all' })).join('').includes('در حال اجرا')); // not twice at once
  const end = await done;
  assert.equal(MAX_ALL, 50);
  assert.equal(t.posts.length, 50);
  assert.ok(t.posts.every((p) => p.jid === 't1@g.us'));
  assert.equal(t.sleeps.filter((ms) => ms === 5000).length, 49); // a gap between posts
  assert.ok(end.includes('۵۰ صورت‌حساب رفت'));
});

test('matching: exact and clear names are saved; ambiguous ones are asked and the answer is kept', async () => {
  assert.equal(matchOne('Orion Furniture', QB_CUSTOMERS).kind, 'confident');
  assert.equal(matchOne('ORION FURNITURE LLC', QB_CUSTOMERS).id, '58'); // by the company name
  const m = matchOne('Blue', QB_CUSTOMERS);
  assert.equal(m.kind, 'options');
  assert.deepEqual(m.options.map((o) => o.id).sort(), ['61', '62']);
  assert.equal(matchOne('Nobody Known', QB_CUSTOMERS).kind, 'none');
  const t = mkDesk();
  t.list.approve('Orion Furniture', 'c1@g.us', 'ORION - ARYAK');
  t.list.approve('Blue', 'c1@g.us', 'ORION - ARYAK');
  t.list.approve('Nobody Known', 'c1@g.us', 'ORION - ARYAK');
  const table = (await t.desk.handle({ type: 'match' })).join('\n');
  assert.ok(table.includes('۱ مطمئن، ۱ نامطمئن، ۱ بدون مشابه') && table.includes('1. Blue') || table.includes('۱. Blue'));
  assert.equal(t.desk.map.get('Orion Furniture').id, '58');
  assert.equal(t.desk.map.get('Blue'), null); // not saved until he answers
  assert.ok((await t.desk.handle({ type: 'pick', n: 1, option: 9 })).join('').includes('گزینهٔ ۹ ندارد'));
  const pickedFirst = t.desk.map.d.pending[0].options[0];
  assert.ok((await t.desk.handle({ type: 'pick', n: 1, option: 1 })).join('').includes('ثبت شد'));
  assert.equal(t.desk.map.get('Blue').id, pickedFirst.id);
  assert.equal(new QboMap(path.join(t.dir, 'map')).get('Blue').how, 'owner'); // kept on disk
  assert.ok(fs.existsSync(path.join(t.dir, 'map', 'qbo-map-history'))); // versions kept
  // an unsure customer asked for a statement is asked about, and nothing is posted
  const ask = (await mkDesk().desk.handle({ type: 'statement', name: 'Blue' })).join('\n');
  assert.ok(ask.includes('چند مشتری در کوییک‌بوکس هست'));
});

test('the status shows connected or not, the environment, the company and the last call, and no secret', async () => {
  const t = mkDesk();
  const on = (await t.desk.handle({ type: 'status' })).join('\n');
  assert.ok(on.includes('وصل است') && on.includes('آزمایشی') && on.includes('The Test Workshop') && on.includes('آخرین تماس') && on.includes('نوشتن در کوییک‌بوکس: خاموش'));
  for (const s of [SECRET, INIT, CID, 'ACCESS-', 'REFRESH-', '9130000000']) assert.ok(!on.includes(s), s);
  const off = mkDesk();
  off.qbo.config.qboClientId = '';
  off.qbo.config.qboRefreshInit = '';
  const miss = (await off.desk.handle({ type: 'status' })).join('\n');
  assert.ok(miss.includes('وصل نیست') && miss.includes('QBO_CLIENT_ID') && !miss.includes('QBO_REFRESH_TOKEN_INIT'));
  assert.ok(!miss.includes(SECRET));
  assert.ok((await off.desk.handle({ type: 'statement', name: 'x' })).join('').includes('تنظیم نشده'));
});

test('the new settings are in the startup script and the example file; QuickBooks writes default to off', () => {
  const root = path.join(import.meta.dirname, '..');
  const startup = fs.readFileSync(path.join(root, 'deploy', 'gcp-startup.sh'), 'utf8');
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  for (const k of ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_ENV', 'QBO_REALM_ID', 'QBO_REFRESH_TOKEN_INIT', 'QBO_WRITE', 'QBO_MINOR_VERSION']) { assert.ok(startup.includes(k), k); assert.ok(example.includes(k), k); }
  assert.ok(/QBO_WRITE=off/.test(example));
  const cfg = fs.readFileSync(path.join(root, 'src', 'config.js'), 'utf8');
  assert.match(cfg, /qboWrite: \/\^\(1\|true\|on\|yes\)\$\/i\.test\(\(env\.QBO_WRITE \|\| ''\)\.trim\(\)\)/); // anything but an explicit on is off
});
