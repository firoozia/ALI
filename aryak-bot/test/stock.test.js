import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheckStock, managerMessage, checkStockTool } from '../src/stock.js';

const config = { sheetUrl: 'https://script.google.com/macros/s/x/exec', botToken: 'bottok', dedupeMinutes: 60 };
const ctx = { groupId: 'g1@g.us', groupName: 'Master Wood – ARYAK', customer: 'Master Wood', messageText: 'do you have 305?' };
const answer = (data) => async (url, opts) => {
  const body = JSON.parse(opts.body);
  assert.equal(body.action, 'botStock');
  assert.equal(body.token, 'bottok');
  return { ok: true, json: async () => ({ ok: true, ...data }) };
};
const low = {
  found: true, code: '305', category: 'PVC film', size: '', unit: 'm', available: false, qtyChecked: true,
  asked: 300, askedUnit: 'm', askedInUnit: 300, free: 230, reserved: 40, limit: 100,
  sizes: [{ size: '0.30*1400', free: 200, packages: 2, open: 0, limit: 50 }, { size: '0.30*1220', free: 30, packages: 1, open: 1, limit: 50 }],
  locations: ['A: 2', 'B: 1'],
};

test('available: the model is told only yes, no quantity', async () => {
  const r = await runCheckStock({ code: '305' }, ctx, config, { fetchImpl: answer({ ...low, available: true }) });
  assert.equal(r.forModel.status, 'available');
  assert.equal(r.silent, false);
  assert.ok(!JSON.stringify(r.forModel).includes('230'));
});

test('low stock: silent in the group, manager told once with the real figures', async () => {
  const recent = new Map();
  const r = await runCheckStock({ code: '305', quantity: 300 }, ctx, config, { fetchImpl: answer(low), recent, now: 1000 });
  assert.equal(r.silent, true);
  assert.equal(r.forModel.status, 'team_will_confirm');
  assert.ok(!JSON.stringify(r.forModel).includes('230'));
  assert.ok(r.managerText.includes('Master Wood'));
  assert.ok(r.managerText.includes('230 m'));
  assert.ok(r.managerText.includes('اندازه‌های ثبت‌شده: 0.30*1400 و 0.30*1220'));
  assert.ok(!r.managerText.includes('0.30*1220: 30 m'), 'no per-size lines any more');
  const again = await runCheckStock({ code: '305' }, ctx, config, { fetchImpl: answer(low), recent, now: 1000 + 10 * 60 * 1000 });
  assert.equal(again.silent, true);
  assert.equal(again.managerText, null);
  const later = await runCheckStock({ code: '305' }, ctx, config, { fetchImpl: answer(low), recent, now: 1000 + 61 * 60 * 1000 });
  assert.ok(later.managerText);
});

test('unknown code, two product groups, a written size is ignored', async () => {
  assert.equal((await runCheckStock({ code: 'X' }, ctx, config, { fetchImpl: answer({ found: false }) })).forModel.status, 'unknown_code');
  const amb = await runCheckStock({ code: '305' }, ctx, config, { fetchImpl: answer({ found: true, ambiguous: true, categories: ['PVC film', 'Edge banding'] }) });
  assert.deepEqual(amb.forModel.options, ['PVC film', 'Edge banding']);
  // A size the customer writes is never sent: the code decides, so a wrong size cannot make a product unavailable.
  let sent;
  const spy = async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, json: async () => ({ ok: true, ...low, available: true }) }; };
  const withSize = await runCheckStock({ code: '305', size: '0.40*1400' }, ctx, config, { fetchImpl: spy });
  assert.equal(sent.size, '');
  assert.equal(withSize.forModel.status, 'available');
});

test('sheet unreachable: not silent, model hands over to the team', async () => {
  const r = await runCheckStock({ code: '305' }, ctx, config, { fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(r.forModel.status, 'error');
  assert.equal(r.silent, false);
});

test('roll quantity that could not be checked is flagged for the manager', () => {
  const text = managerMessage({ ...low, qtyChecked: false, asked: 3, askedUnit: 'roll', askedInUnit: 3 }, ctx, {});
  assert.ok(text.includes('بررسی نشد'));
});

test('tool schema needs a code', () => {
  assert.deepEqual(checkStockTool.input_schema.required, ['code']);
});

// ---- fetchStock: redirects by hand, timeout, one retry, real cause in the log ----
import { describeError, fetchStock, isTimeout } from '../src/stock.js';

const cfg = { sheetUrl: 'https://script.google.com/macros/s/x/exec', botToken: 'bottok' };
const okRes = (data) => ({ ok: true, status: 200, json: async () => ({ ok: true, ...data }) });
const quick = { retryDelayMs: 0, tries: 2 };

test('fetchStock: a failure is retried once and the second answer is used; the cause is logged', async () => {
  const logs = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET', message: 'read ECONNRESET' } });
    return okRes({ found: true, code: '229' });
  };
  const r = await fetchStock(cfg, { code: '229' }, fetchImpl, { ...quick, log: (m) => logs.push(m), info: () => {} });
  assert.equal(r.code, '229');
  assert.equal(calls, 2);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /try 1 of 2/);
  assert.match(logs[0], / failed in \d+\.\d s/);
  assert.match(logs[0], /fetch failed \| ECONNRESET read ECONNRESET/);
});

test('fetchStock: two failures throw the last one, both logged', async () => {
  const logs = [];
  const fetchImpl = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } }); };
  await assert.rejects(fetchStock(cfg, { code: '229' }, fetchImpl, { ...quick, log: (m) => logs.push(m) }), /fetch failed/);
  assert.equal(logs.length, 2);
  assert.match(logs[1], /try 2 of 2.*UND_ERR_SOCKET/);
});

test('fetchStock: HTTP 500 is retried and logged with its status; 4xx and the sheet\'s own refusal are not', async () => {
  const logs = [];
  let calls = 0;
  const five = async () => { calls++; return { ok: false, status: 503, json: async () => ({}) }; };
  await assert.rejects(fetchStock(cfg, { code: '1' }, five, { ...quick, log: (m) => logs.push(m) }), /503/);
  assert.equal(calls, 2);
  assert.match(logs[0], /HTTP 503/);
  calls = 0;
  const four = async () => { calls++; return { ok: false, status: 403, json: async () => ({}) }; };
  await assert.rejects(fetchStock(cfg, { code: '1' }, four, { ...quick, log: () => {} }), /403/);
  assert.equal(calls, 1);
  calls = 0;
  const refuse = async () => { calls++; return { ok: true, status: 200, json: async () => ({ ok: false, error: 'Wrong bot token' }) }; };
  await assert.rejects(fetchStock(cfg, { code: '1' }, refuse, { ...quick, log: () => {} }), /Wrong bot token/);
  assert.equal(calls, 1);
});

test('fetchStock: the redirect is followed by hand with GET and no body; the POST body is a string', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, method: init.method, body: init.body, redirect: init.redirect, hasSignal: !!init.signal });
    if (seen.length === 1) return { ok: false, status: 302, headers: new Headers({ location: 'https://script.googleusercontent.com/macros/echo?x=1' }) };
    return okRes({ found: true, code: '408' });
  };
  const r = await fetchStock(cfg, { code: '408' }, fetchImpl, quick);
  assert.equal(r.code, '408');
  assert.equal(seen.length, 2);
  assert.equal(seen[0].method, 'POST');
  assert.equal(typeof seen[0].body, 'string');
  assert.equal(JSON.parse(seen[0].body).action, 'botStock');
  assert.equal(seen[1].method, 'GET');
  assert.equal(seen[1].body, undefined);
  assert.equal(seen[1].url, 'https://script.googleusercontent.com/macros/echo?x=1');
  assert.ok(seen.every((s) => s.redirect === 'manual' && s.hasSignal));
});

test('fetchStock: a redirect without Location or an endless chain is an error', async () => {
  await assert.rejects(fetchStock(cfg, { code: '1' }, async () => ({ ok: false, status: 302, headers: new Headers() }), { ...quick, log: () => {} }), /without a Location/);
  await assert.rejects(fetchStock(cfg, { code: '1' }, async () => ({ ok: false, status: 302, headers: new Headers({ location: '/again' }) }), { ...quick, log: () => {} }), /too many times/);
});

test('error helpers: cause is shown, timeouts are recognised', () => {
  assert.equal(describeError(Object.assign(new Error('fetch failed'), { cause: { code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' } })), 'fetch failed | ETIMEDOUT connect ETIMEDOUT');
  const t = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  assert.equal(describeError(t).startsWith('timeout'), true);
  assert.equal(isTimeout(t), true);
  assert.equal(isTimeout(new Error('fetch failed')), false);
  assert.equal(isTimeout(Object.assign(new Error('fetch failed'), { cause: { code: 'ETIMEDOUT' } })), true);
});

test('runCheckStock: a sheet that cannot be reached is an error result, after one retry', async () => {
  let calls = 0;
  const r = await runCheckStock({ code: '229' }, ctx, { ...config, retryDelayMs: 0, log: () => {} }, { fetchImpl: async () => { calls++; throw new Error('fetch failed'); } });
  assert.equal(calls, 3);
  assert.equal(r.forModel.status, 'error');
});

// ---- cache, three tries, keep-warm ----
import { SheetCache, warmSheet } from '../src/stock.js';
import { formatStaffStock } from '../src/stock-format.js';

test('three tries by default, each logged with its duration; the third can still succeed', async () => {
  const logs = [];
  let calls = 0;
  let t = 0;
  const now = () => (t += 1500);
  const fetchImpl = async () => { calls++; if (calls < 3) throw new Error('fetch failed'); return okRes({ found: true, code: '1810' }); };
  const r = await fetchStock(cfg, { code: '1810' }, fetchImpl, { retryDelayMs: 0, log: (m) => logs.push(m), info: (m) => logs.push(m), now });
  assert.equal(r.code, '1810');
  assert.equal(calls, 3);
  assert.match(logs[0], /try 1 of 3 failed in 1\.5 s/);
  assert.match(logs[2], /try 3 of 3 ok in 1\.5 s/);
});

test('every try gets a timeout signal', async () => {
  const signals = [];
  const fetchImpl = async (url, init) => { signals.push(init.signal); throw new Error('x'); };
  await assert.rejects(fetchStock(cfg, { code: '1' }, fetchImpl, { retryDelayMs: 0, log: () => {} }));
  assert.equal(signals.length, 3);
  assert.ok(signals.every((s) => s instanceof AbortSignal));
});

test('cache: a fresh answer is reused without asking the sheet again', async () => {
  let now = 0;
  const cache = new SheetCache({ now: () => now });
  let calls = 0;
  const fetchImpl = async () => { calls++; return okRes({ found: true, code: '229', free: calls }); };
  const c = { ...cfg, sheetCache: cache };
  assert.equal((await fetchStock(c, { code: '229' }, fetchImpl, { retryDelayMs: 0, info: () => {} })).free, 1);
  now = 60 * 1000;
  assert.equal((await fetchStock(c, { code: '229' }, fetchImpl, { retryDelayMs: 0, info: () => {} })).free, 1);
  assert.equal(calls, 1);
  now = 90 * 1000; // no longer fresh
  assert.equal((await fetchStock(c, { code: '229' }, fetchImpl, { retryDelayMs: 0, info: () => {} })).free, 2);
  assert.equal(calls, 2);
  await fetchStock(c, { code: '229', quantity: 50 }, fetchImpl, { retryDelayMs: 0, info: () => {} }); // another quantity is another lookup
  assert.equal(calls, 3);
});

test('cache: when the sheet does not answer an older answer is used and its age is said; too old is an error', async () => {
  let now = 0;
  const cache = new SheetCache({ now: () => now });
  const c = { ...cfg, sheetCache: cache };
  const quiet = { retryDelayMs: 0, log: () => {}, info: () => {} };
  await fetchStock(c, { code: '229' }, async () => okRes({ found: true, code: '229', free: 7 }), quiet);
  const down = async () => { throw new Error('fetch failed'); };
  now = 5 * 60 * 1000;
  const stale = await fetchStock(c, { code: '229' }, down, quiet);
  assert.equal(stale.free, 7);
  assert.equal(stale.stale, true);
  assert.equal(stale.ageMinutes, 5);
  now = 16 * 60 * 1000;
  await assert.rejects(fetchStock(c, { code: '229' }, down, quiet), /fetch failed/);
  // the sheet's own refusal is never answered from memory
  now = 5 * 60 * 1000;
  const refuse = async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error: 'Wrong bot token' }) });
  await assert.rejects(fetchStock(c, { code: '229' }, refuse, quiet), /Wrong bot token/);
});

test('the staff answer says how old a fallback answer is', () => {
  const t = formatStaffStock({ found: true, code: '229', category: 'PVC film', unit: 'm', free: 7, reserved: 0, limit: 200, sizes: [{ size: 'a', free: 7, packages: 1, open: 1, limit: 200 }], stale: true, ageMinutes: 5 }, '229');
  assert.ok(t.startsWith('(آخرین بروزرسانی: 5 دقیقه پیش، برگه الان پاسخ نداد)\n\nموجودی کد 229'));
});

test('keep-warm: one cheap lookup of a code that does not exist, one try, nothing cached', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(JSON.parse(init.body)); return okRes({ found: false, code: 'warmup' }); };
  const cache = new SheetCache();
  const ms = await warmSheet({ ...cfg, sheetCache: cache }, fetchImpl);
  assert.equal(typeof ms, 'number');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].code, 'warmup');
  assert.equal(cache.map.size, 0);
  await assert.rejects(warmSheet(cfg, async () => { throw new Error('down'); }));
});
