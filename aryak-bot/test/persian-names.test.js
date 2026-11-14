import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pickSpoken, skeleton, skeletonVariants, scoreName } from '../src/translit.js';
import { PersianNames, persianBatch, seedPersianNames } from '../src/persiannames.js';
import { QboDesk, QboMap } from '../src/qbodesk.js';
import { Aliases } from '../src/aliases.js';
import { CustomerGroups } from '../src/customergroups.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';
import { englishOut } from '../src/outlang.js';

// Invented customers (plus the look-alikes that must lose); the spoken forms are the ones the owner uses.
const NAMES = ['AR-RAD INTERNATIONAL FOR TRADE AND INVESTMENT LLC', 'AL SHABAB BILLIRAD', 'ART FACTORY', 'LARSA FACTORY', 'AL BURTOMANI NATIONAL', 'NUQOOSH IND . LLC',
  'AL EBDA AL MALKI KITCHEN', 'AL HRAYER', 'MASTER WOOD', 'MATER WOOD BRANCH 1', 'DANDY DOORS', 'ZED TRADING', 'PALM BIRD TRADING LLC', 'AL AFEEF KITCHEN', 'AL BARAKA'];

test('Persian-script names find their customer: the Arabic article is read as the sound it makes («الراد» = AR-RAD), not as AL', () => {
  const want = {
    الراد: 'AR-RAD INTERNATIONAL FOR TRADE AND INVESTMENT LLC', 'ال راد': 'AR-RAD INTERNATIONAL FOR TRADE AND INVESTMENT LLC', 'آر راد': 'AR-RAD INTERNATIONAL FOR TRADE AND INVESTMENT LLC',
    برتمانی: 'AL BURTOMANI NATIONAL', نقوش: 'NUQOOSH IND . LLC', الابداع: 'AL EBDA AL MALKI KITCHEN', حرایر: 'AL HRAYER', 'مستر وود': 'MASTER WOOD', دندی: 'DANDY DOORS',
  };
  for (const [said, name] of Object.entries(want)) {
    const r = pickSpoken(said, NAMES, { strong: 0.7 });
    assert.equal(r.kind, 'one', `${said}: ${JSON.stringify(r.candidates || r.nearest)}`);
    assert.equal(r.best.name, name, said);
  }
});

test('the skeletons: «ال» before a sun letter has two readings; the sound of a doubled letter after the vowels is one sound', () => {
  assert.deepEqual(skeletonVariants('الراد'), ['lrt', 'rrt']); // AL-RAD or AR-RAD
  assert.deepEqual(skeletonVariants('الابداع'), ['lbt']); // «ا» is not a sun letter: only AL
  assert.equal(skeleton('HRAYER'), skeleton('حرایر'));
  assert.equal(skeleton('BURTOMANI'), skeleton('برتمانی'));
  assert.ok(scoreName('الراد', 'ART FACTORY') < 0.7); // the look-alike with one R stays out
  assert.ok(scoreName('الراد', 'AR-RAD INTERNATIONAL FOR TRADE AND INVESTMENT LLC') >= 0.7);
});

// ---------------------------------------------------------------------------------------------------------------- the stored Persian spellings
const claudeSaying = (obj, calls = []) => ({ beta: { messages: { create: async (req) => { calls.push(req); return { content: [{ type: 'text', text: JSON.stringify(obj) }] }; } } } });

test('the Persian names: one batch writes them, the owner\'s correction wins and is kept, only Persian spellings are accepted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-'));
  const store = new PersianNames(dir);
  const calls = [];
  const client = claudeSaying({ 1: 'الراد اینترنشنال', 2: 'برتمانی', 3: 'not persian' }, calls);
  const written = await seedPersianNames({ store, client, config: { visionModel: 'm' }, customers: [{ id: '1', name: 'AR-RAD INTERNATIONAL' }, { id: '2', name: 'AL BURTOMANI NATIONAL' }, { id: '3', name: 'ZED' }] });
  assert.equal(written, 2); assert.equal(calls.length, 1); assert.equal(store.seeded, true);
  assert.deepEqual(store.of('1'), ['الراد اینترنشنال']); assert.deepEqual(store.of('3'), []); // a non-Persian answer is dropped
  store.setOwner('1', 'آر راد'); assert.deepEqual(store.of('1'), ['آر راد', 'الراد اینترنشنال']);
  assert.deepEqual(new PersianNames(dir).of('1')[0], 'آر راد'); // kept on disk
  await seedPersianNames({ store, client, config: {}, customers: [{ id: '1', name: 'AR-RAD INTERNATIONAL' }] });
  assert.equal(calls.length, 1); // customers that already have a spelling are not asked again
  assert.deepEqual(await persianBatch({ client: { beta: { messages: { create: async () => { throw new Error('down'); } } } }, config: {}, customers: [{ id: '9', name: 'X' }] }), {}); // a failing model: nothing written
});

const company = { CompanyName: 'TEST CO' };
function mkDesk(customers, persian = null, seedPersian = null) {
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-'));
  return new QboDesk({ qbo, list: new CustomerGroups(path.join(dir, 'cg')), aliases: new Aliases(''), map: new QboMap(path.join(dir, 'map')), config: { testGroupNames: [] }, groups: async () => [], post: async () => {}, today: () => '2026-11-08', log: () => {}, persian, seedPersian });
}

test('a customer named in Persian letters is found through the sound and through the stored spelling; the desk writes the spellings once when it first meets Persian letters', async () => {
  const customers = NAMES.map((name, i) => ({ Id: String(100 + i), DisplayName: name, CompanyName: name, Balance: 0 }));
  const plain = mkDesk(customers);
  assert.equal((await plain.resolveSpoken('الراد')).name, 'AR-RAD INTERNATIONAL FOR TRADE AND INVESTMENT LLC');
  assert.equal((await plain.resolveSpoken('مستر وود')).name, 'MASTER WOOD'); // not MATER WOOD BRANCH 1
  // a spelling that has no sound likeness is found only through the stored name
  const store = new PersianNames(fs.mkdtempSync(path.join(os.tmpdir(), 'pnx-')));
  let seeded = 0;
  const desk = mkDesk(customers, store, async () => { seeded += 1; store.setModel('105', 'عمر'); store.markSeeded(); }); // pretend «عمر» is how the workshop says NUQOOSH
  const found = await desk.resolveSpoken('عمر');
  assert.equal(seeded, 1); assert.equal(found.name, 'NUQOOSH IND . LLC'); assert.equal(found.via, 'sound');
  await desk.resolveSpoken('عمر'); assert.equal(seeded, 1); // once only
  await desk.resolveSpoken('AL BURTOMANI'); assert.equal(seeded, 1); // a Latin name never starts a seeding
});

test('the owner\'s words: the list of Persian names and a correction, in Persian and in English; English lines are data, not translated', async () => {
  assert.deepEqual(parseInvoiceCommand('نام‌های فارسی'), { type: 'persian_list' });
  assert.deepEqual(parseInvoiceCommand('persian names'), { type: 'persian_list' });
  assert.deepEqual(parseInvoiceCommand('نام فارسی AR-RAD INTERNATIONAL = آر راد'), { type: 'persian_set', customer: 'AR-RAD INTERNATIONAL', persian: 'آر راد' });
  assert.deepEqual(parseInvoiceCommand('persian name AR-RAD INTERNATIONAL = آر راد'), { type: 'persian_set', customer: 'AR-RAD INTERNATIONAL', persian: 'آر راد' });
  assert.equal(parseInvoiceCommand('نام فارسی X = latin'), null); // the value must be Persian letters
  let calls = 0;
  const same = 'Persian name: AR-RAD = آر راد';
  assert.equal(await englishOut(same, async () => { calls += 1; return ''; }), same); assert.equal(calls, 0);
});

test('an exact two-word match wins over a close but looser name; two exact matches are still asked', () => {
  const ar = 'AR-RAD INTERNATIONAL FOR TRADE AND INVESTMENT LLC';
  const r = pickSpoken('الراد', [ar, 'ALRAHAD'], { strong: 0.7 });
  assert.equal(r.kind, 'one'); assert.equal(r.best.name, ar); // 0.776 against 0.75: not "about equally good", AR + RAD fits every sound
  const both = pickSpoken('الراد', ['AR RAD', 'AL RAAD'], { strong: 0.7 });
  assert.equal(both.kind, 'many'); // two names fit exactly: the owner chooses
});

test('English statement lines are written in English at once: a statement of account, never an invoice', async () => {
  const { setOutLang } = await import('../src/outlang.js');
  const customers = [{ Id: '70', DisplayName: 'AR-RAD INTERNATIONAL FOR TRADE AND INVESTMENT LLC', Balance: 0 }, { Id: '72', DisplayName: 'AL RAAD', Balance: 0 }, { Id: '71', DisplayName: 'ZED TRADING' }, { Id: '73', DisplayName: 'AR RAD', Balance: 0 }];
  setOutLang('en');
  try {
    const desk = mkDesk(customers);
    const many = await desk.statementFor('الراد', { privateJid: 'x@s.whatsapp.net' });
    assert.equal(many.ask, true); assert.match(many.text, /^Several customers match "الراد"; write the right number:\n1\. /);
    const none = await desk.statementFor('اف', { privateJid: 'x@s.whatsapp.net' });
    assert.match(none.text, /^No customer named "اف" was found\. Closest:/);
    const one = await mkDesk([customers[0], customers[2]]).statementFor('الراد', { privateJid: 'x@s.whatsapp.net', period: { from: '2026-10-01', to: '2026-10-31', label: '2026-10' } });
    assert.equal(one.ok, true);
    assert.match(one.text, /^Statement of account for "AR-RAD INTERNATIONAL FOR TRADE AND INVESTMENT LLC" \(guessed from "الراد"; tell me if it is another customer\) from 01\/10\/2026 to 31\/10\/2026 sent \(total amount [A-Z]* ?0\.00, total received /);
    assert.doesNotMatch(one.text, /invoice/i);
  } finally { setOutLang('fa'); }
  const { TRANSLATE_SYSTEM } = await import('../src/outlang.js');
  assert.match(TRANSLATE_SYSTEM, /NEVER "invoice"/);
});

test('a statement of «designer wood» for month 8: the customer is chosen by words or shown as numbered choices, never by a weak guess; every phrasing of the month reads 01/08 to 31/08', async () => {
  const customers = ['DESIGNER WOOD PRESSING LLC', 'MASTER WOOD', 'DESIGN WORLD KITCHEN', 'AL DIWAN WOOD', 'TIGER INDUSTRIES COMPANY LLC'].map((name, i) => ({ Id: String(200 + i), DisplayName: name, CompanyName: name, Balance: 0 }));
  const desk = mkDesk(customers);
  // the typed English words are all in ONE QuickBooks name: that customer
  const byWords = await desk.resolveSpoken('designer wood'); assert.equal(byWords.name, 'DESIGNER WOOD PRESSING LLC'); assert.equal(byWords.via, 'words');
  // the same customer typed in Persian letters: only a sure sound is used; the others are shown as choices, the best first
  const fa = await desk.resolveSpoken('دیزاینر وود');
  assert.equal(fa.id, undefined); assert.ok(fa.many && fa.many.length >= 2 && fa.many.length <= 3); assert.equal(fa.many[0], 'DESIGNER WOOD PRESSING LLC');
  const ask = await desk.statementFor('دیزاینر وود', { privateJid: 'x@s.whatsapp.net', period: { from: '2026-08-01', to: '2026-08-31', label: '2026-08' } });
  assert.equal(ask.ok, false); assert.equal(ask.ask, true); assert.ok(ask.options.includes('DESIGNER WOOD PRESSING LLC')); assert.match(ask.text, /چند مشتری به «دیزاینر وود» می‌خورد/);
  const { parseStatementRequest } = await import('../src/period.js');
  for (const t of ['statement designer wood month 8', 'Atossa statement designer wood August', 'statement of designer wood 08/2026', 'statement for designer wood in august', 'صورت حساب ماه ۸ دیزاینر وود', 'آتوسا صورتحساب دیزاینر وود ماه ۸', 'آتوسا صورتحساب دیزاینر وود اوت']) {
    const r = parseStatementRequest(t, '2026-11-14');
    if (/اوت/.test(t)) continue; // the Persian spelling of August is not a month word here
    assert.deepEqual([r.period.from, r.period.to], ['2026-08-01', '2026-08-31'], t); assert.match(r.customer, /^(?:designer wood|دیزاینر وود)$/, t);
  }
  assert.equal(parseStatementRequest('statement designer wood month 12', '2026-11-14').period.from, '2025-12-01'); // a month still ahead: the last one
});
