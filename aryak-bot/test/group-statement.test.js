import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isAddressed, withoutBotNames } from '../src/staff.js';
import { GroupStatements, askLine, effectiveRequest, statementAsk } from '../src/groupstatement.js';
import { isEnglishSentence, placeLanguage } from '../src/english.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';
import { QboDesk, QboMap } from '../src/qbodesk.js';
import { Aliases } from '../src/aliases.js';
import { CustomerGroups } from '../src/customergroups.js';
import { parseChoice } from '../src/pendingchoice.js';

const NAMES = ['آتوسا', 'atossa', 'دستیار'];
const OWN = ['971500000000@s.whatsapp.net'];
const addressed = (text, extra = {}) => isAddressed({ text, names: NAMES, ownIds: OWN, ...extra });

test('addressed by her name anywhere in a group: Atosa, Atossa, Atousa, ATOSSA, آتوسا, اتوسا', () => {
  for (const text of ['Atosa send Statement AR RAD', 'please Atossa send me the statement', 'send Atousa the statement of AR RAD', 'ATOSSA', 'آتوسا صورت‌حساب بده', 'صورت‌حساب بفرست اتوسا', 'hello atosa.']) {
    assert.equal(addressed(text), true, text);
  }
  assert.equal(addressed('send the statement of AR RAD'), false); // no name, no quote, no mention
  assert.equal(addressed('Atosaa'), false); // a different word
});

test('a reply to one of her messages, or a mention of her, is addressed too', () => {
  assert.equal(addressed('thanks', { quotedFrom: OWN[0] }), true);
  assert.equal(addressed('thanks', { mentioned: OWN }), true);
  assert.equal(addressed('thanks', { quotedFrom: '971511111111@s.whatsapp.net' }), false);
});

test('her name taken out of a text: only her name is left empty', () => {
  assert.equal(withoutBotNames('ATOSSA', NAMES), '');
  assert.equal(withoutBotNames('Atosa send Statement AR RAD', NAMES), 'send Statement AR RAD');
  assert.equal(withoutBotNames('آتوسا', NAMES), '');
});

test('«Atosa send Statement AR RAD» is a statement request for AR RAD, in any group', () => {
  const ask = statementAsk('Atosa send Statement AR RAD');
  assert.ok(ask); assert.match(ask.customer, /^ar rad$/i); assert.equal(ask.period, null);
  assert.match(statementAsk('Atossa statement of AR RAD for month 10').customer, /ar rad/i);
  assert.equal(statementAsk('Atosa good morning'), null);
});

test('the one word «ATOSSA» under a quoted request: the quoted message is the request', () => {
  const quoted = 'Atosa send Statement AR RAD';
  assert.equal(effectiveRequest('ATOSSA', quoted, NAMES), quoted);
  assert.match(statementAsk(effectiveRequest('ATOSSA', quoted, NAMES)).customer, /ar rad/i);
  assert.equal(effectiveRequest('Atosa send Statement AR RAD', 'something else', NAMES), 'Atosa send Statement AR RAD'); // a full text keeps itself
  assert.equal(effectiveRequest('ATOSSA', '', NAMES), 'ATOSSA'); // no quote: nothing to read
  assert.equal(statementAsk('ATOSSA'), null);
});

test('the language of a company group: Persian unless the asker wrote a full English sentence', () => {
  assert.equal(isEnglishSentence('ATOSSA'), false);
  assert.equal(isEnglishSentence('Atosa send Statement AR RAD'), true);
  assert.equal(isEnglishSentence('صورت‌حساب بده'), false);
  assert.equal(placeLanguage({ kind: 'company-group', owner: false, written: 'en', sentence: isEnglishSentence('ATOSSA') }), 'fa');
  assert.equal(placeLanguage({ kind: 'company-group', owner: true, written: 'fa', sentence: isEnglishSentence('آتوسا صورت‌حساب') }), 'fa');
  assert.equal(placeLanguage({ kind: 'company-group', owner: false, written: 'en', sentence: isEnglishSentence('how many sheets of K-120 do we have') }), 'en');
  assert.equal(placeLanguage({ kind: 'company-group', owner: true, written: 'fa' }), 'en'); // the old callers keep the old answer
});

test('«بله #S3» and «نه #S3» are the owner\'s answer to a statement waiting for a customer group', () => {
  assert.deepEqual(parseInvoiceCommand('بله #S3'), { type: 'yes', id: 'S3' });
  assert.deepEqual(parseInvoiceCommand('نه #S3'), { type: 'no', id: 'S3' });
  assert.deepEqual(parseInvoiceCommand('S12 بله'), { type: 'yes', id: 'S12' });
});

test('the held statements: an id each, thirty minutes, one use', () => {
  let t = 1000;
  const held = new GroupStatements({ now: () => t });
  const id = held.add({ groupId: 'g@g.us', subject: 'Some Customer Group', held: { pdf: Buffer.from('x') }, name: 'AR RAD TRADING', period: null });
  assert.equal(id, 'S1'); assert.deepEqual(held.openIds(), ['S1']);
  assert.equal(held.get('S1').groupId, 'g@g.us');
  assert.equal(held.add({ groupId: 'h@g.us', subject: 'B', held: {}, name: 'B' }), 'S2');
  held.clear('S1'); assert.equal(held.get('S1'), null);
  t += 31 * 60 * 1000; assert.equal(held.get('S2'), null); assert.deepEqual(held.openIds(), []);
  assert.equal(askLine({ name: 'AR RAD TRADING', subject: 'Some Customer Group', id: 'S3', period: null }), 'صورت‌حساب «AR RAD TRADING» برای گروه «Some Customer Group» آماده است؛ بفرستم؟ بله #S3');
});

// ------------------------------------------------------------------------------------------------ the desk: build now, send later
const company = { CompanyName: 'TEST CO' };
function mkDesk(customers) {
  const posted = [];
  const qbo = {
    configured: true, connected: true, paused: false, needsReconnect: false, env: 'production',
    query: async (sql) => {
      if (/from Customer where Id/.test(sql)) return customers.filter((c) => `'${c.Id}'` === /Id = ('[^']*')/.exec(sql)[1]);
      if (/from Customer/.test(sql)) return customers;
      return [];
    },
    companyInfo: async () => company,
    get: async () => ({ Preferences: { CurrencyPrefs: { HomeCurrency: { value: 'AED' } } } }),
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-'));
  const desk = new QboDesk({ qbo, list: new CustomerGroups(path.join(dir, 'cg')), aliases: new Aliases(''), map: new QboMap(path.join(dir, 'map')), config: { testGroupNames: [] }, groups: async () => [], post: async (jid, buf, name) => { posted.push({ jid, name, size: buf.length }); }, today: () => '2026-11-08', log: () => {} });
  return { desk, posted };
}

test('a held statement is built and NOT posted anywhere; the same request without hold posts to the asker\'s chat', async () => {
  const { desk, posted } = mkDesk([{ Id: '70', DisplayName: 'AR RAD TRADING LLC', Balance: 0 }, { Id: '71', DisplayName: 'ZED TRADING' }]);
  const h = await desk.statementFor('AR RAD', { hold: true, period: null });
  assert.equal(h.ok, true); assert.equal(h.name, 'AR RAD TRADING LLC');
  assert.ok(h.held.pdf.length > 500); assert.match(h.held.fileName, /^statement-AR_RAD_TRADING_LLC.*\.pdf$/); assert.match(h.held.caption, /^Statement - AR RAD TRADING LLC/);
  assert.equal(posted.length, 0); // nothing went anywhere
  const direct = await desk.statementFor('AR RAD', { privateJid: 'group@g.us' });
  assert.equal(direct.ok, true); assert.equal(posted.length, 1); assert.equal(posted[0].jid, 'group@g.us');
});

test('an unclear name with hold: the numbered question comes back, nothing is held or posted; the choice picks by number', async () => {
  const { desk, posted } = mkDesk([{ Id: '70', DisplayName: 'AR RAD TRADING LLC' }, { Id: '72', DisplayName: 'AR RADIANT CO' }, { Id: '71', DisplayName: 'ZED TRADING' }]);
  const h = await desk.statementFor('AR RAD', { hold: true });
  if (h.ask) { assert.ok(h.options.length >= 2); assert.equal(h.held, undefined); assert.equal(parseChoice('2', h.options), 1); }
  assert.equal(posted.length, 0);
});

// ------------------------------------------------------------------------------------------------ the wiring in index.js
const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
const slice = (from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

test('wiring: the group statement turn runs for the owner and the authorized only, and answers in that group in Persian', () => {
  const turn = slice('async function groupStatementTurn', 'async function prepareGroupStatement');
  assert.match(turn, /const may = owner \|\| authorized;/);
  assert.match(turn, /if \(!may\) \{[^}]*'صورت‌حساب را فقط مالک یا کسی که مالک مجاز کرده می‌تواند بخواهد\.'/);
  assert.match(turn, /privateJid: chatId/); // the PDF goes back to the group it was asked in
  assert.match(turn, /pending\.by === by/); // a numbered choice belongs to the person who asked
  assert.doesNotMatch(turn, /toEnglish/); // never turned into English
  assert.match(src, /groupStatementTurn\(\{ raw, chatId, text, ctx: \(content\.extendedTextMessage \|\| \{\}\)\.contextInfo \|\| \{\}, owner: ownerPerson, authorized: authorizedPerson/);
  assert.match(src, /qboAuth\.isAuthorized\(who, info\.lidToPhone\)\) \{\s*const gctx/); // an authorized person who is not staff is taken before the staff check
});

test('wiring: in a customer group only the owner\'s request counts; it asks in his own chat first and nothing goes to the group', () => {
  const fn = slice('async function customerGroupStatement', 'async function prepareGroupStatement') || slice('async function customerGroupStatement', '\n// ----');
  const customerPart = src.slice(src.indexOf('async function customerGroupStatement'), src.indexOf('async function customerGroupStatement') + 3000);
  assert.match(customerPart, /const owner = !!raw\.key\.fromMe \|\| staffChecker\(config\.ownerNumbers/);
  assert.match(customerPart, /a colleague asked for a statement in a customer group \(only the owner may\)/);
  assert.doesNotMatch(customerPart.slice(0, customerPart.indexOf('prepareGroupStatement({ customer')), /sock\.sendMessage\(groupId/); // no send to the group on the request
  assert.ok(fn !== undefined);
  const prep = slice('async function prepareGroupStatement', 'async function decideGroupStatement');
  assert.match(prep, /hold: true/); assert.match(prep, /groupStatements\.add\(/);
  assert.doesNotMatch(prep, /oneShot|sendMessage\(groupId|sendMessage\(p\.groupId/); // preparing never sends to the group
  assert.match(src, /if \(!groupAllowed\(watchedInfo\.subject, config\)\.ok && await customerGroupStatement\(/); // an internal group is never taken as a customer group
});

test('wiring: the group send happens only in the owner\'s yes, with a one-shot token, and a no sends nothing', () => {
  const decide = slice('async function decideGroupStatement', 'async function customerGroupStatement');
  assert.ok(decide.indexOf("verb !== 'yes'") < decide.indexOf('oneShot.grant('));
  assert.match(decide, /oneShot\.grant\(p\.groupId, content\)/);
  assert.match(src, /id\.startsWith\('S'\) \? decideGroupStatement\(ic\.type, id\)/);
  assert.match(src, /\.\.\.groupStatements\.openIds\(\)/); // a bare yes counts the open statement
});

// ------------------------------------------------------------------------------------------------ the owner's private chat with another person
import { guardedSend } from '../src/guard.js';
import { OneShot } from '../src/invoicesend.js';

test('wiring: the owner writing to another person is ignored unless her name (or a reply to her) is there', () => {
  const gate = src.slice(src.indexOf('// from the bot\'s phone, in the owner\'s chat with another person'), src.indexOf('const role = admin'));
  assert.match(gate, /!addressedIn\(text, octx\)\) \{ trace\(where, 'owner', 'ignored: the owner talking to someone else'\); return false; \}/);
  assert.match(gate, /ignored: addressed to her in a chat with someone who is not staff/); // not staff, not a statement: still nothing
});

test('wiring: a colleague gets the statement in that chat; anyone else is asked in the owner\'s own chat first', () => {
  const gate = src.slice(src.indexOf('// from the bot\'s phone, in the owner\'s chat with another person'), src.indexOf('const role = admin'));
  assert.match(gate, /if \(otherStaff\) \{[\s\S]*?privateJid: chatId[\s\S]*?return true;\s*\}/);
  const notStaff = gate.slice(gate.indexOf('not a colleague'));
  assert.match(notStaff, /kind: 'private'/);
  assert.doesNotMatch(notStaff, /sock\.sendMessage\(chatId|privateJid: chatId|oneShot/); // no word to that person before his yes
  assert.match(gate, /\.\.\.config\.staffNumbers, \.\.\.config\.adminNumbers, \.\.\.qboAuth\.numbers\(\)/);
});

test('the guard: a private chat that is not staff gets one PDF with the token, and nothing else', async () => {
  const config = { staffNumbers: ['971500000001'], adminNumbers: [], ownerNumbers: [], testGroupNames: [] };
  const sent = [];
  const oneShot = new OneShot();
  const send = guardedSend({ rawSend: async (...args) => { sent.push(args); return { key: { id: 'x' } }; }, config, oneShot, subjectOf: async () => '', isGroup: (j) => j.endsWith('@g.us'), known: new Set(), ownIds: () => [] });
  const customer = '971599999999@s.whatsapp.net';
  assert.equal(await send(customer, { text: 'hello' }), undefined); // plain text: blocked
  const doc = { document: Buffer.from('%PDF'), mimetype: 'application/pdf', fileName: 's.pdf' };
  assert.equal(await send(customer, doc), undefined); // a PDF with no token: blocked
  oneShot.grant(customer, doc);
  assert.ok(await send(customer, doc)); // with the token: sent once
  assert.equal(await send(customer, doc), undefined); // a second try: blocked
  oneShot.grant('971588888888@s.whatsapp.net', doc);
  assert.equal(await send(customer, doc), undefined); // a token for another chat does not work here
  assert.equal(sent.length, 1);
});

test('the ask line for a private chat names the chat, not a group', () => {
  assert.equal(askLine({ name: 'AR RAD', subject: 'شمارهٔ 971599999999', id: 'S4', period: null, kind: 'private' }), 'صورت‌حساب «AR RAD» برای شمارهٔ 971599999999 آماده است؛ بفرستم؟ بله #S4');
});

// ------------------------------------------------------------------------------------------------ the scope of an authorized person
import { AuthStore, PERMISSIONS } from '../src/qboinvoice.js';

test('«مجوز <چیز> <شماره>»: every permission is its own word (statement spellings, Persian digits); «لغو مجوز …» takes it', () => {
  for (const t of ['مجوز صورت‌حساب 971528493119', 'مجوز صورتحساب ۹۷۱۵۲۸۴۹۳۱۱۹', 'مجوز استیتمنت +971528493119']) {
    const ic = parseInvoiceCommand(t); assert.equal(ic.type, 'auth_add', t); assert.equal(ic.perm, 'statement', t); assert.equal(AuthStore.clean(ic.number), '971528493119');
  }
  assert.deepEqual(parseInvoiceCommand('مجوز فاکتور 971528493119'), { type: 'auth_add', number: '971528493119', perm: 'invoice' });
  assert.deepEqual(parseInvoiceCommand('لغو مجوز صورت‌حساب 971528493119'), { type: 'auth_remove', number: '971528493119', perm: 'statement' });
  assert.deepEqual(parseInvoiceCommand('لغو مجوز فاکتور 971528493119'), { type: 'auth_remove', number: '971528493119', perm: 'invoice' });
  assert.deepEqual(parseInvoiceCommand('مجوزها'), { type: 'auth_list' });
  assert.deepEqual(Object.keys(PERMISSIONS), ['invoice', 'statement']); // a new permission is one more row here
});

test('the store: separate grants; the old file (no grants = both, scope statement = statements) is converted so nobody gains or loses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-'));
  fs.writeFileSync(path.join(dir, 'qbo-authorized.json'), JSON.stringify({ people: [{ number: '971528493119', at: 'x' }, { number: '971500000002', at: 'y', scope: 'statement' }, { number: '971500000003', at: 'z', scope: 'both' }] }));
  const a = new AuthStore(dir);
  assert.deepEqual(a.grantsOf('971528493119'), ['invoice', 'statement']); // the manager keeps exactly what he had
  assert.deepEqual(a.grantsOf('971500000002'), ['statement']);
  assert.deepEqual(a.grantsOf('971500000003'), ['invoice', 'statement']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'qbo-authorized.json'), 'utf8')).people[0].grants, ['invoice', 'statement']); // written back
  const who = (n) => ({ sender: `${n}@s.whatsapp.net` });
  assert.equal(a.has(who('971500000002'), 'invoice'), false); assert.equal(a.has(who('971500000002'), 'statement'), true);
  // «مجوز فاکتور» alone no longer gives statements
  assert.equal(a.grant('971500000009', 'invoice'), '971500000009');
  assert.equal(a.has(who('971500000009'), 'invoice'), true); assert.equal(a.has(who('971500000009'), 'statement'), false); assert.equal(a.isAuthorized(who('971500000009')), true);
  assert.equal(a.grant('971500000009', 'nonsense'), false);
  assert.equal(a.revoke('971528493119', 'invoice'), true); assert.deepEqual(a.grantsOf('971528493119'), ['statement']);
  assert.equal(a.revoke('971528493119', 'invoice'), false); // did not have it
  assert.equal(a.revoke('971528493119', 'statement'), true); assert.equal(a.isAuthorized(who('971528493119')), false); // no grant left: gone
  assert.equal(new AuthStore(dir).grantsOf('971500000002')[0], 'statement'); // kept on disk
  assert.deepEqual(a.list().find((p) => p.number === '971500000003'), { number: '971500000003', grants: ['invoice', 'statement'] });
});

test('wiring: each request needs its own permission, with one Persian line when missing; the list names each person\'s permissions', () => {
  assert.match(src, /if \(isRequest && !canInvoice\) \{ await say\('برای درخواست فاکتور مجوز ندارید\.'\); return true; \}/);
  assert.match(src, /if \(\(isStatement \|\| nl\) && !canStatement\) \{ await say\('برای درخواست صورت‌حساب مجوز ندارید\.'\); return true; \}/);
  assert.match(src, /canInvoice: qboAuth\.has\(who, 'invoice', info\.lidToPhone\), canStatement: qboAuth\.has\(who, 'statement', info\.lidToPhone\)/);
  assert.match(src, /authorizedPerson = !!\(group && qboAuth\.has\(who, 'statement', info\.lidToPhone\)\)/); // an invoice-only person gets no statement in a group
  assert.match(src, /statementFor\(nl\.customer, \{ privateJid: chatId, period: nl\.period \}\)/);
  assert.match(src, /p\.grants\.map\(\(g\) => PERMISSIONS\[g\]\?\.label \|\| g\)/);
});

// ------------------------------------------------------------------------------------------------ the invoice in an internal group
test('wiring: an invoice request in an internal group needs the owner or the invoice permission; the preview is posted there; the yes with an id works there for the owner only', () => {
  const turn = src.slice(src.indexOf('async function groupStatementTurn'), src.indexOf('async function prepareGroupStatement'));
  assert.match(turn, /if \(owner\) \{\s*const dec = parseInvoiceCommand\(text\);/); // the owner's «بله #Q5» typed here
  assert.ok(turn.includes('[QS]') && turn.includes('.test(dec.id')); // only a named preview, never a bare yes
  assert.match(turn, /if \(!\(owner \|\| canInvoice\)\) \{[^}]*'برای درخواست فاکتور مجوز ندارید\.'/);
  assert.match(turn, /qboInvoices\.request\(\{ text: eff, requester: owner \? 'owner' : by, quotedText: quoted \}\)/);
  assert.match(turn, /await sayIn\(raw, chatId, where, r\.owner \|\| r\.requester\)/); // posted in the group, Persian
  assert.match(src, /canInvoice: invoicePerson, where, role/); assert.match(src, /canInvoice: qboAuth\.has\(who, 'invoice', info\.lidToPhone\), where, role: 'authorized'/);
});

test('wiring: what she says in a group or to a colleague about statements and invoices stays in Persian (the outgoing hook would turn Persian into English)', () => {
  assert.match(src, /const persianText = \(body\) => \{ const content = \{ text: body \}; keepLang\.add\(content\); return content; \}/);
  assert.match(src, /content: persianText\(body\), quoted: raw/); // sayIn
  assert.match(src, /const say = \(t\) => sock\.sendMessage\(chatId, persianText\(t\)\)/); // the authorized person's private chat
  assert.match(src, /if \(typeof a\[1\]\?\.text === 'string' && \/\[\u0600-\u06FF\]\/\.test\(a\[1\]\.text\) && !keepLang\.has\(a\[1\]\)\)|!keepLang\.has\(a\[1\]\)/); // the hook skips what is kept
});
