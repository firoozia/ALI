import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Qbo, QboError, looksLikeConnectLine, parseConnectLine } from '../src/qbo.js';
import { QboDesk, QboMap, parseQboCommand } from '../src/qbodesk.js';
import { Aliases } from '../src/aliases.js';
import { CustomerGroups } from '../src/customergroups.js';

// Invented keys, codes and names only: nothing real is ever in the repository.
const SECRET = 'S3CRET-VALUE-XYZ';
const CID = 'CLIENT-ID-ABC';
const CODE = 'AB11-AUTH-CODE-0123456789';
const REALM = '9130000000';
const cfg = (extra = {}) => ({
  qboClientId: CID, qboClientSecret: SECRET, qboEnv: 'sandbox', qboRealmId: '', qboRefreshInit: '', qboWrite: false, qboMinorVersion: 75, qboRedirectUri: 'https://example.test/atossa/connect.html',
  testGroupNames: ['test aryak bot'], staffGroupNames: [], observeExcludeNames: [], shadowGroupNames: ['aryak'], ...extra,
});
const res = (status, json, headers = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => json, headers: { get: (k) => headers[String(k).toLowerCase()] ?? null } });

function mock(opts = {}) {
  const calls = [];
  const st = { n: 0, codes: [], refreshSeen: [], revoked: [], discovery: 0 };
  const fetchFn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method, headers: init.headers, body: init.body });
    if (u.includes('/.well-known/')) { st.discovery += 1; return opts.discoveryFails ? res(500, {}) : res(200, { authorization_endpoint: 'https://appcenter.intuit.com/connect/oauth2', token_endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', revocation_endpoint: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke' }); }
    if (u.includes('tokens/revoke')) { st.revoked.push(JSON.parse(init.body).token); return res(opts.revokeStatus || 200, {}); }
    if (u.includes('tokens/bearer')) {
      const b = new URLSearchParams(init.body);
      st.n += 1;
      if (b.get('grant_type') === 'authorization_code') { st.codes.push(b.get('code')); return opts.badCode ? res(400, { error: 'invalid_grant' }, { intuit_tid: 'tid-code' }) : res(200, { access_token: `ACCESS-${st.n}`, refresh_token: `REFRESH-${st.n}`, expires_in: opts.expiresIn || 3600 }); }
      st.refreshSeen.push(b.get('refresh_token'));
      if (opts.invalidGrant) return res(400, { error: 'invalid_grant' }, { intuit_tid: 'tid-refresh' });
      return res(200, { access_token: `ACCESS-${st.n}`, refresh_token: `REFRESH-${st.n}`, expires_in: opts.expiresIn || 3600 });
    }
    if (opts.script?.length) { const r = opts.script.shift(); if (r) return r(u, init); }
    if (u.includes('/companyinfo/')) return res(200, { CompanyInfo: { CompanyName: 'The Test Workshop' } });
    return res(200, { QueryResponse: { Customer: [] } });
  };
  return { fetchFn, calls, st };
}

function mk(opts = {}, config = cfg()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-'));
  const m = mock(opts);
  const logs = [];
  const notices = [];
  let clock = 5_000_000;
  const qbo = new Qbo({ config, dir, fetchFn: m.fetchFn, now: () => clock, sleep: async () => {}, log: (s) => logs.push(s), onReconnect: () => notices.push('reconnect') });
  const list = new CustomerGroups(path.join(dir, 'cg'));
  const desk = new QboDesk({ qbo, list, aliases: new Aliases(''), map: new QboMap(path.join(dir, 'map')), config, groups: async () => [], post: async () => {}, today: () => '2026-11-07', sleep: async () => {}, log: (s) => logs.push(s) });
  return { dir, m, logs, notices, qbo, desk, config, tick: (ms) => { clock += ms; }, set: (t) => { clock = t; } };
}
const stateOfUrl = (url) => new URL(url).searchParams.get('state');
const lineFor = (state, realm = REALM, code = CODE) => `QBO-CONNECT ${state} ${realm} ${code}`;

test('the line format: QBO-CONNECT <state> <realmId> <code>, nothing else is taken', () => {
  const state = 'a'.repeat(48);
  assert.deepEqual(parseConnectLine(lineFor(state)), { state, realmId: REALM, code: CODE });
  assert.deepEqual(parseConnectLine(`  ${lineFor(state)}  \n`), { state, realmId: REALM, code: CODE });
  for (const bad of [`QBO-CONNECT short ${REALM} ${CODE}`, `QBO-CONNECT ${state} abc ${CODE}`, `QBO-CONNECT ${state} ${REALM}`, `qbo-connect ${state} ${REALM} ${CODE}`, `hello ${lineFor(state)}`, `${lineFor(state)} extra`]) assert.equal(parseConnectLine(bad), null, bad);
  assert.equal(looksLikeConnectLine(lineFor(state)), true);
  assert.equal(looksLikeConnectLine('hello'), false);
  assert.deepEqual(parseQboCommand('اتصال کوییک‌بوکس'), { type: 'connect' });
  assert.deepEqual(parseQboCommand('قطع کوییک‌بوکس'), { type: 'disconnect' });
});

test('the full flow on a mocked sandbox company: connect, call, disconnect, reconnect', async () => {
  const t = mk();
  assert.equal(t.qbo.connected, false);
  assert.ok((await t.desk.handle({ type: 'status' })).join('').includes('اتصال کوییک‌بوکس')); // not connected: it says how
  // 1. connect: a link with the right parts and a random one-time state
  const [text, url] = await t.desk.handle({ type: 'connect' });
  assert.ok(text.includes('۱۵ دقیقه') && url.startsWith('https://appcenter.intuit.com/connect/oauth2?'));
  const q = new URL(url).searchParams;
  assert.deepEqual([q.get('client_id'), q.get('response_type'), q.get('scope'), q.get('redirect_uri')], [CID, 'code', 'com.intuit.quickbooks.accounting', 'https://example.test/atossa/connect.html']);
  const state = q.get('state');
  assert.match(state, /^[0-9a-f]{48}$/);
  assert.ok(!url.includes(SECRET));
  assert.ok(!fs.readFileSync(path.join(t.dir, 'qbo-tokens.json'), 'utf8').includes(state)); // only a hash of the state is kept
  // 2. the line from the public page: the state is checked, the code is exchanged at once with the secret
  const [done] = await t.desk.handleLine(parseConnectLine(lineFor(state)));
  assert.ok(done.includes('کوییک‌بوکس وصل شد: The Test Workshop') && done.includes('آزمایشی'));
  assert.deepEqual(t.m.st.codes, [CODE]);
  const exch = t.m.calls.find((c) => c.body && String(c.body).includes('authorization_code'));
  assert.equal(exch.headers.Authorization, `Basic ${Buffer.from(`${CID}:${SECRET}`).toString('base64')}`);
  assert.equal(new URLSearchParams(exch.body).get('redirect_uri'), 'https://example.test/atossa/connect.html');
  const stored = JSON.parse(fs.readFileSync(path.join(t.dir, 'qbo-tokens.json'), 'utf8'));
  assert.deepEqual([stored.refresh, stored.realmId, stored.connect], [`REFRESH-1`, REALM, undefined]);
  assert.equal(t.qbo.connected, true);
  // 3. a call uses the stored company id (the settings have none)
  await t.qbo.query('select * from Customer');
  assert.ok(t.m.calls.some((c) => c.url.includes(`/v3/company/${REALM}/query`)));
  // 4. disconnect: revoke at Intuit and delete everything
  const [gone] = await t.desk.handle({ type: 'disconnect' });
  assert.ok(gone.includes('لغو شد') && gone.includes('پاک شدند'));
  assert.deepEqual(t.m.st.revoked, ['REFRESH-1']);
  const empty = JSON.parse(fs.readFileSync(path.join(t.dir, 'qbo-tokens.json'), 'utf8'));
  assert.deepEqual([empty.refresh, empty.access, empty.realmId], ['', '', '']);
  assert.equal(t.qbo.connected, false);
  const callsBefore = t.m.calls.length;
  assert.ok((await t.desk.handle({ type: 'match' })).join('').includes('وصل نیست'));
  assert.equal(t.m.calls.length, callsBefore); // nothing is called while disconnected
  // 5. reconnect: a new state, a new code
  const [, url2] = await t.desk.handle({ type: 'connect' });
  const state2 = stateOfUrl(url2);
  assert.notEqual(state2, state);
  const [again] = await t.desk.handleLine(parseConnectLine(lineFor(state2, '9130000001', 'NEWCODE-9876543210')));
  assert.ok(again.includes('وصل شد'));
  assert.equal(t.qbo.realm, '9130000001');
  assert.equal(t.qbo.connected, true);
  assert.equal(new Qbo({ config: t.config, dir: t.dir, fetchFn: t.m.fetchFn }).connected, true); // and it survives a restart
});

test('a wrong, old or used state is refused and the code is never exchanged', async () => {
  const t = mk();
  const [, url] = await t.desk.handle({ type: 'connect' });
  const state = stateOfUrl(url);
  // wrong state (this also spends the real one: one-time)
  assert.ok((await t.desk.handleLine(parseConnectLine(lineFor('b'.repeat(48))))).join('').includes('نادرست یا کهنه'));
  assert.ok((await t.desk.handleLine(parseConnectLine(lineFor(state)))).join('').includes('نادرست یا کهنه')); // the real one is spent by the attempt
  // old state: 16 minutes
  const [, url2] = await t.desk.handle({ type: 'connect' });
  t.tick(16 * 60 * 1000);
  assert.ok((await t.desk.handleLine(parseConnectLine(lineFor(stateOfUrl(url2))))).join('').includes('نادرست یا کهنه'));
  // used twice
  const [, url3] = await t.desk.handle({ type: 'connect' });
  const s3 = stateOfUrl(url3);
  assert.ok((await t.desk.handleLine(parseConnectLine(lineFor(s3)))).join('').includes('وصل شد'));
  assert.ok((await t.desk.handleLine(parseConnectLine(lineFor(s3, REALM, 'OTHER-CODE-1234567')))).join('').includes('نادرست یا کهنه'));
  assert.deepEqual(t.m.st.codes, [CODE]); // only the one good line reached Intuit
  // a line before any connect command
  const fresh = mk();
  assert.ok((await fresh.desk.handleLine(parseConnectLine(lineFor('c'.repeat(48))))).join('').includes('نادرست یا کهنه'));
  assert.deepEqual(fresh.m.st.codes, []);
});

test('a code Intuit refuses is reported, nothing is stored and the state is spent', async () => {
  const t = mk({ badCode: true });
  const [, url] = await t.desk.handle({ type: 'connect' });
  const out = (await t.desk.handleLine(parseConnectLine(lineFor(stateOfUrl(url))))).join('\n');
  assert.ok(out.includes('اتصال نشد') && out.includes('اتصال کوییک‌بوکس'));
  assert.equal(t.qbo.connected, false);
  assert.ok(!out.includes(CODE) && !out.includes(SECRET));
  assert.ok(!t.logs.join('\n').includes(CODE));
});

test('the code and the secret are in no log and no reply; the connect line never reaches a trace or a model', async () => {
  const t = mk();
  const [, url] = await t.desk.handle({ type: 'connect' });
  const replies = await t.desk.handleLine(parseConnectLine(lineFor(stateOfUrl(url))));
  await t.desk.handle({ type: 'disconnect' });
  const all = [...t.logs, ...replies].join('\n');
  for (const s of [SECRET, CODE, 'ACCESS-', 'REFRESH-', 'Basic ', 'Bearer ']) assert.ok(!all.includes(s), s);
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  const guard = index.slice(index.indexOf('The line from the public QuickBooks page carries an authorization code'));
  const first = guard.slice(0, guard.indexOf('}\n') + 2);
  assert.match(first, /looksLikeConnectLine\(text\) && !\(isSelf && isOwnerCommand\(/); // anyone but the owner in his own chat: ignored, before any model
  assert.ok(first.includes('return true;') && !/\$\{text\}|, text\)/.test(first.replace(/looksLikeConnectLine\(text\)|text, sentIds/g, ''))); // the text is not traced
  const take = index.slice(index.indexOf('The connect line (his own chat'), index.indexOf('QuickBooks (his own chat, owner only): status'));
  assert.ok(take.includes('!group && isSelf') && take.includes('qboDesk.handleLine('));
});

test('the OAuth endpoints come from the discovery document, cached for a day; if it cannot be read the built-in ones are used', async () => {
  const t = mk();
  await t.desk.handle({ type: 'connect' });
  await t.qbo.connectLink();
  await t.qbo.connectLink();
  assert.equal(t.m.st.discovery, 1);
  assert.ok(t.m.calls.find((c) => c.url.includes('/.well-known/')).url.endsWith('/openid_sandbox_configuration'));
  t.tick(25 * 3600 * 1000);
  await t.qbo.connectLink();
  assert.equal(t.m.st.discovery, 2); // a day later: read again
  const again = new Qbo({ config: t.config, dir: t.dir, fetchFn: t.m.fetchFn, now: () => 5_000_000 + 25 * 3600 * 1000 + 1000 });
  await again.connectLink();
  assert.equal(t.m.st.discovery, 2); // the cache file is shared across a restart
  const prod = mk({}, cfg({ qboEnv: 'production' }));
  await prod.qbo.connectLink();
  assert.ok(prod.m.calls.find((c) => c.url.includes('/.well-known/')).url.endsWith('/openid_configuration'));
  const broken = mk({ discoveryFails: true });
  const { url } = await broken.qbo.connectLink();
  assert.ok(url.startsWith('https://appcenter.intuit.com/connect/oauth2?')); // built-in endpoint, no throw
});

test('an invalid refresh token: the owner is told once, all calls stop until he reconnects (also after a restart)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-'));
  fs.writeFileSync(path.join(dir, 'qbo-tokens.json'), JSON.stringify({ refresh: 'OLD-REFRESH-TOKEN', access: '', accessExpiresAt: 0, initHash: '', realmId: REALM, needsReconnect: false }));
  const m = mock({ invalidGrant: true });
  const notices = [];
  const config = cfg();
  const qbo = new Qbo({ config, dir, fetchFn: m.fetchFn, now: () => 1, sleep: async () => {}, log: () => {}, onReconnect: () => notices.push('x') });
  await assert.rejects(() => qbo.query('select * from Customer'), (e) => e instanceof QboError && e.reconnect === true && /needs reconnecting/.test(e.message));
  assert.equal(notices.length, 1);
  const before = m.calls.length;
  await assert.rejects(() => qbo.query('select * from Customer'), (e) => e.reconnect === true);
  await assert.rejects(() => qbo.companyInfo(), (e) => e.reconnect === true);
  assert.equal(m.calls.length, before); // no call at all while it needs reconnecting
  assert.equal(notices.length, 1); // and no second notice
  const restarted = new Qbo({ config, dir, fetchFn: m.fetchFn, now: () => 2, sleep: async () => {}, log: () => {}, onReconnect: () => notices.push('x') });
  assert.equal(restarted.needsReconnect, true);
  await assert.rejects(() => restarted.query('select * from Customer'), (e) => e.reconnect === true);
  assert.equal(notices.length, 1);
  const desk = new QboDesk({ qbo: restarted, list: new CustomerGroups(''), aliases: new Aliases(''), map: new QboMap(''), config, groups: async () => [], post: async () => {}, today: () => '2026-11-07', log: () => {} });
  assert.ok((await desk.handle({ type: 'status' })).join('').includes('باید دوباره وصل شود'));
  assert.ok((await desk.handle({ type: 'statement', name: 'x' })).join('').includes('اتصال کوییک‌بوکس'));
  // connecting again clears it
  const ok = mock();
  const fresh = new Qbo({ config, dir, fetchFn: ok.fetchFn, now: () => 3, sleep: async () => {}, log: () => {} });
  const { state } = await fresh.connectLink();
  assert.equal(fresh.takeState(state), true);
  await fresh.exchange({ code: CODE, realmId: REALM });
  assert.equal(fresh.needsReconnect, false);
  await fresh.query('select * from Customer');
});

test('refreshing happens BEFORE the access token expires, not only when a call finds it expired', async () => {
  const t = mk({ expiresIn: 1800 });
  const { state } = await t.qbo.connectLink();
  t.qbo.takeState(state);
  await t.qbo.exchange({ code: CODE, realmId: REALM });
  assert.equal(await t.qbo.keepFresh(), false); // 30 minutes left: nothing to do
  const refreshesBefore = t.m.st.refreshSeen.length;
  t.tick(25 * 60 * 1000); // 5 minutes left, inside the 10-minute margin
  assert.equal(await t.qbo.keepFresh(), true);
  assert.equal(t.m.st.refreshSeen.length, refreshesBefore + 1);
  assert.deepEqual(t.m.st.refreshSeen, ['REFRESH-1']); // the rotated token from the connect
  assert.equal(await t.qbo.keepFresh(), false);
  assert.equal(await mk().qbo.keepFresh(), false); // not connected: nothing, no throw
  const bad = mk({ invalidGrant: true });
  bad.qbo.t = { ...bad.qbo.t, refresh: 'X-REFRESH-123', realmId: REALM };
  assert.equal(await bad.qbo.keepFresh(), false); // a failure never throws out of the timer
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(src, /setInterval\(\(\) => \{ qbo\.keepFresh\(\)/);
});

test('every error response is logged with its intuit_tid, in a short error log, with no token; validation errors are not retried', async () => {
  const t = mk({ script: [() => res(500, {}, { intuit_tid: 'tid-500-a' }), () => res(429, {}, { intuit_tid: 'tid-429' }), () => res(200, { QueryResponse: {} })] });
  const { state } = await t.qbo.connectLink();
  t.qbo.takeState(state);
  await t.qbo.exchange({ code: CODE, realmId: REALM });
  await t.qbo.query('select * from Customer');
  const bad = mk({ script: [() => res(400, { Fault: { Error: [{ Message: 'bad query' }] } }, { intuit_tid: 'tid-400' })] });
  const s2 = await bad.qbo.connectLink();
  bad.qbo.takeState(s2.state);
  await bad.qbo.exchange({ code: CODE, realmId: REALM });
  const callsBefore = bad.m.calls.length;
  await assert.rejects(() => bad.qbo.query('select nonsense from Customer'), /400/);
  assert.equal(bad.m.calls.length - callsBefore, 1); // a validation error is never retried
  const lines = fs.readFileSync(path.join(t.dir, 'qbo-errors.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.status, l.tid]), [[500, 'tid-500-a'], [429, 'tid-429']]);
  assert.ok(lines.every((l) => l.at && l.op === 'GET query'));
  const badLine = JSON.parse(fs.readFileSync(path.join(bad.dir, 'qbo-errors.log'), 'utf8').trim());
  assert.deepEqual([badLine.status, badLine.tid], [400, 'tid-400']);
  const raw = fs.readFileSync(path.join(t.dir, 'qbo-errors.log'), 'utf8') + fs.readFileSync(path.join(bad.dir, 'qbo-errors.log'), 'utf8') + t.logs.join('\n');
  for (const s of [SECRET, CODE, 'ACCESS-', 'REFRESH-', 'Bearer', 'bad query']) assert.ok(!raw.includes(s), s); // no token, no body
  assert.ok(t.logs.some((l) => /QuickBooks error 500 GET query tid=tid-500-a/.test(l)));
  // the log stays short
  const many = mk();
  for (let i = 0; i < 350; i++) many.qbo.errorLog({ status: 500, op: 'GET query', tid: `t${i}` });
  assert.ok(fs.readFileSync(path.join(many.dir, 'qbo-errors.log'), 'utf8').trim().split('\n').length <= 300);
});

test('the redirect setting is in the startup script and the example file', () => {
  const root = path.join(import.meta.dirname, '..');
  assert.ok(fs.readFileSync(path.join(root, 'deploy', 'gcp-startup.sh'), 'utf8').includes('QBO_REDIRECT_URI'));
  assert.ok(fs.readFileSync(path.join(root, '.env.example'), 'utf8').includes('QBO_REDIRECT_URI=https://firoozia.github.io/atossa/connect.html'));
  assert.ok(fs.readFileSync(path.join(root, 'src', 'config.js'), 'utf8').includes("https://firoozia.github.io/atossa/connect.html"));
});
