import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Qbo } from '../src/qbo.js';
import { buildStatementData, loadCustomerData, statementPdf } from '../src/qbostatement.js';
import { QboDesk, QboMap } from '../src/qbodesk.js';
import { Aliases } from '../src/aliases.js';
import { CustomerGroups } from '../src/customergroups.js';

// Invented names and amounts only.
const TODAY = '2026-11-07';
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const inv = (due, bal, extra = {}) => ({ DocNumber: 'N', TxnDate: addDays(due, -30), DueDate: due, TotalAmt: bal, Balance: bal, ...extra });
const ageOf = (dueOffsetFromToday) => buildStatementData({ company: { Country: 'US' }, customer: { Balance: 100 }, invoices: [inv(addDays(TODAY, -dueOffsetFromToday), 100)], today: TODAY }).ageing;
const where = (a) => Object.entries(a).find(([, v]) => v === 10000)?.[0];

test('ageing: days overdue = statement date minus due date; zero or less is Current; the edges 30/31, 60/61, 90/91', () => {
  const edges = [[-30, 'current'], [-1, 'current'], [0, 'current'], [1, 'd1_30'], [30, 'd1_30'], [31, 'd31_60'], [60, 'd31_60'], [61, 'd61_90'], [90, 'd61_90'], [91, 'd91'], [400, 'd91']];
  for (const [overdue, bucket] of edges) assert.equal(where(ageOf(overdue)), bucket, `${overdue} days overdue`);
  // the reported case: due the day AFTER the statement date is not yet due
  const d = buildStatementData({ company: { Country: 'US' }, customer: { Balance: 239 }, invoices: [{ DocNumber: '1001', TxnDate: '2026-10-09', DueDate: '2026-11-08', TotalAmt: 239, Balance: 239 }], today: '2026-11-07' });
  assert.deepEqual(d.ageing, { current: 23900, d1_30: 0, d31_60: 0, d61_90: 0, d91: 0 });
  assert.equal(d.ageingTotal, 23900);
  // no due date: the invoice date stands in for it
  const nodue = buildStatementData({ company: { Country: 'US' }, customer: { Balance: 100 }, invoices: [{ TxnDate: '2026-10-20', TotalAmt: 100, Balance: 100 }], today: TODAY });
  assert.equal(nodue.ageing.d1_30, 10000);
  // the buckets and the total add up to the closing balance with credits in
  const mixed = buildStatementData({
    company: { Country: 'US' }, customer: { Balance: 250 }, today: TODAY,
    invoices: [inv('2026-11-20', 100), inv('2026-10-01', 200), inv('2026-06-01', 50)], payments: [], credits: [{ TxnDate: '2026-10-02', TotalAmt: 100, Balance: 100 }],
  });
  assert.deepEqual(mixed.ageing, { current: 10000, d1_30: 0, d31_60: 20000, d61_90: 0, d91: 5000 });
  assert.equal(mixed.ageingTotal, mixed.closing);
  assert.equal(mixed.closing, 25000);
});

test('the currency is the company\'s own: Preferences HomeCurrency, the country only as a fallback, the customer\'s own currency when he has one', () => {
  const base = { customer: { Balance: 0 }, invoices: [], today: TODAY };
  assert.equal(buildStatementData({ ...base, company: { Country: 'US' }, preferences: { CurrencyPrefs: { HomeCurrency: { value: 'USD' } } } }).currency, 'USD');
  assert.equal(buildStatementData({ ...base, company: { Country: 'AE' }, preferences: { CurrencyPrefs: { HomeCurrency: { value: 'AED' } } } }).currency, 'AED');
  assert.equal(buildStatementData({ ...base, company: { Country: 'AE' } }).currency, 'AED'); // preferences unreadable
  assert.equal(buildStatementData({ ...base, company: { Country: 'US' } }).currency, 'USD');
  assert.equal(buildStatementData({ ...base, company: { Country: 'ZZ' } }).currency, ''); // unknown: no code is invented
  const multi = buildStatementData({ ...base, company: { Country: 'AE' }, preferences: { CurrencyPrefs: { HomeCurrency: { value: 'AED' }, MultiCurrencyEnabled: true } }, customer: { Balance: 0, CurrencyRef: { value: 'EUR' } } });
  assert.equal(multi.currency, 'EUR');
  const foreign = buildStatementData({ ...base, company: { Country: 'US' }, invoices: [{ TxnDate: TODAY, TotalAmt: 5, Balance: 5, CurrencyRef: { value: 'EUR' } }] });
  assert.ok(foreign.warnings[0].includes('another currency than USD'));
});

test('the PDF shows the company\'s currency, never a fixed one; the sandbox footer is on every page', () => {
  const usd = buildStatementData({ company: { CompanyName: 'Sandbox Co', Country: 'US' }, preferences: { CurrencyPrefs: { HomeCurrency: { value: 'USD' } } }, customer: { DisplayName: 'Bird Sanctuary', Balance: 239 }, invoices: [{ DocNumber: '1001', TxnDate: '2026-10-09', DueDate: '2026-11-08', TotalAmt: 239, Balance: 239 }], today: TODAY });
  const pdf = statementPdf(usd, { sandbox: true, style: 'balance' }).toString('latin1');
  assert.ok(pdf.includes('(BALANCE DUE) Tj') && pdf.includes('USD 239.00'));
  assert.ok(!pdf.includes('AED'));
  assert.ok(pdf.includes('test, built by Atossa'));
  const aed = buildStatementData({ company: { CompanyName: 'Real Co', Country: 'AE' }, preferences: { CurrencyPrefs: { HomeCurrency: { value: 'AED' } } }, customer: { DisplayName: 'X', Balance: 1 }, invoices: [{ DocNumber: '1', TxnDate: TODAY, DueDate: TODAY, TotalAmt: 1, Balance: 1 }], today: TODAY });
  const real = statementPdf(aed, { sandbox: false, style: 'balance' }).toString('latin1');
  assert.ok(real.includes('(BALANCE DUE) Tj') && real.includes('AED 1.00') && !real.includes('test, built by Atossa') && !real.includes('USD'));
  assert.ok(!statementPdf({ ...aed, currency: '' }, { style: 'balance' }).toString('latin1').includes('AED 1.00')); // unknown currency: no code at all
  const long = buildStatementData({ company: { CompanyName: 'Sandbox Co', Country: 'US' }, customer: { DisplayName: 'Z', Balance: 0 }, invoices: Array.from({ length: 90 }, (_, i) => ({ DocNumber: `N${i}`, TxnDate: '2026-11-01', TotalAmt: 1, Balance: 0 })), today: TODAY });
  const pages = statementPdf(long, { sandbox: true, style: 'balance' }).toString('latin1');
  assert.equal(pages.split('test, built by Atossa').length - 1, 3); // one footer per page, three pages
});

test('the currency comes from QuickBooks Preferences and reaches the post and the reply', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qcur-'));
  const COMPANY = { CompanyName: 'Sandbox Company US', Country: 'US' };
  const fetchFn = async (url) => {
    const u = new URL(String(url));
    const ok = (json) => ({ status: 200, ok: true, json: async () => json, headers: { get: () => null } });
    if (u.hostname === 'developer.intuit.com') return ok({ authorization_endpoint: 'https://a.test/auth', token_endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', revocation_endpoint: 'https://a.test/revoke' });
    if (u.hostname.startsWith('oauth.')) return ok({ access_token: 'A', refresh_token: 'R', expires_in: 3600 });
    if (u.pathname.includes('/preferences')) return ok({ Preferences: { CurrencyPrefs: { HomeCurrency: { value: 'USD' }, MultiCurrencyEnabled: false } } });
    if (u.pathname.includes('/companyinfo/')) return ok({ CompanyInfo: COMPANY });
    const sql = u.searchParams.get('query') || '';
    const ent = /from\s+(\w+)/i.exec(sql)[1];
    const rows = { Customer: [{ Id: '1', DisplayName: 'Amy Bird Sanctuary', Balance: 239 }], Invoice: [{ DocNumber: '1001', TxnDate: '2026-10-09', DueDate: '2026-11-08', TotalAmt: 239, Balance: 239, CustomerRef: { value: '1' } }], Payment: [], CreditMemo: [] }[ent] || [];
    return ok({ QueryResponse: { [ent]: rows } });
  };
  const config = { qboClientId: 'c', qboClientSecret: 's', qboEnv: 'sandbox', qboRealmId: '123456', qboRefreshInit: 'INIT-TOKEN-1', qboWrite: false, testGroupNames: ['test aryak bot'], staffGroupNames: [], observeExcludeNames: [], shadowGroupNames: ['aryak'] };
  const qbo = new Qbo({ config, dir, fetchFn, sleep: async () => {} });
  const loaded = await loadCustomerData(qbo, '1');
  assert.equal(loaded.preferences.CurrencyPrefs.HomeCurrency.value, 'USD');
  const list = new CustomerGroups('');
  list.approve('Amy Bird Sanctuary', 'c@g.us', 'AMY - ARYAK');
  const posts = [];
  const desk = new QboDesk({
    qbo, list, aliases: new Aliases(''), map: new QboMap(''), config, groups: async () => [{ id: 't@g.us', subject: 'TEST ARYAK BOT' }], today: () => TODAY, log: () => {},
    post: async (jid, buf, fileName, caption) => { posts.push({ buf: buf.toString('latin1'), caption }); },
  });
  const out = (await desk.handle({ type: 'statement', name: 'Amy Bird Sanctuary' })).join('\n');
  assert.ok(posts[0].caption.includes('balance USD 239.00') && !posts[0].caption.includes('AED'));
  assert.ok(posts[0].buf.includes('TOTAL AMOUNT') && posts[0].buf.includes('USD 239.00') && posts[0].buf.includes('test, built by Atossa'));
  assert.ok(out.includes('239.00 USD') && !out.includes('درهم'));
  // preferences unreadable: the country decides, nothing breaks
  const noPrefs = async (url, init) => (String(url).includes('/preferences') ? { status: 403, ok: false, json: async () => ({}), headers: { get: () => null } } : fetchFn(url, init));
  const qbo2 = new Qbo({ config, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'qcur-')), fetchFn: noPrefs, sleep: async () => {} });
  const loaded2 = await loadCustomerData(qbo2, '1');
  assert.equal(loaded2.preferences, null);
  assert.equal(buildStatementData({ ...loaded2, today: TODAY }).currency, 'USD');
});
