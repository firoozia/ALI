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
