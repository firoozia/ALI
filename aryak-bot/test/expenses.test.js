import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExpenseStore, entryText, expensesText, handleReply, makeEntry, matchExpenses, monthlyFullText, parseExpenseCaption, parseExpenseReply, rangeOf, receivedItems, receivedText, savedText, typeFromWords, weeklyCheckText } from '../src/expenses.js';
import { SEP } from '../src/separator.js';
import { loadConfig } from '../src/config.js';
import { groupAllowed } from '../src/guard.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';

// Invented people, vendors, customers and amounts only.
const src = (n) => fs.readFileSync(path.join(import.meta.dirname, '..', 'src', n), 'utf8');
const NOW = Date.parse('2026-11-10T08:00:00Z'); // 12:00 in Dubai
const store = () => new ExpenseStore(fs.mkdtempSync(path.join(os.tmpdir(), 'exp-')), () => NOW);
const fuelReading = { relevant: true, total: 85.5, currency: 'AED', vendor: 'ENOC', date: '2026-11-10', category: 'fuel' };

test('the caption: the amount in any digits, a type word in any of the languages; the receipt\'s own guess when there is no word', () => {
  assert.deepEqual(parseExpenseCaption('85.5'), { amount: 85.5, type: '' });
  assert.deepEqual(parseExpenseCaption('85.5 fuel'), { amount: 85.5, type: 'fuel' });
  assert.deepEqual(parseExpenseCaption('fuel 85.5 aed'), { amount: 85.5, type: 'fuel' });
  assert.deepEqual(parseExpenseCaption('۸۵٫۵ بنزین'), { amount: 85.5, type: 'fuel' });
  assert.deepEqual(parseExpenseCaption('1,250.00 office'), { amount: 1250, type: 'office' });
  assert.deepEqual(parseExpenseCaption('hello'), { amount: null, type: '' });
  for (const [t, k] of [['petrol', 'fuel'], ['بترول', 'fuel'], ['وقود', 'fuel'], ['food', 'food'], ['غذا', 'food'], ['طعام', 'food'], ['office', 'office'], ['دفتر', 'office'], ['مكتب', 'office'], ['car', 'vehicles'], ['vehicle', 'vehicles'], ['خودرو', 'vehicles'], ['سيارة', 'vehicles'], ['tyres', 'vehicles'], ['fine', 'vehicles'], ['other', 'other'], ['nothing here', '']]) assert.equal(typeFromWords(t), k, t);
});

test('the replies: 1 / 2 bare or with the code, card / cash, a type word, an amount, cancel; ordinary talk is none', () => {
  assert.deepEqual(parseExpenseReply('1'), { pick: '1', id: '' }); assert.deepEqual(parseExpenseReply('2 #E12'), { pick: '2', id: 'E12' }); assert.deepEqual(parseExpenseReply('#E12 1'), { pick: '1', id: 'E12' }); assert.deepEqual(parseExpenseReply('۲'), { pick: '2', id: '' });
  assert.deepEqual(parseExpenseReply('card'), { method: 'card', id: '' }); assert.deepEqual(parseExpenseReply('cash #E3'), { method: 'cash', id: 'E3' }); assert.deepEqual(parseExpenseReply('نقد'), { method: 'cash', id: '' });
  assert.deepEqual(parseExpenseReply('food'), { type: 'food', id: '' }); assert.deepEqual(parseExpenseReply('car #E7'), { type: 'vehicles', id: 'E7' });
  assert.deepEqual(parseExpenseReply('95.5'), { amount: 95.5, id: '' }); assert.deepEqual(parseExpenseReply('#E5 40 aed'), { amount: 40, id: 'E5' });
  assert.deepEqual(parseExpenseReply('cancel #E3'), { cancel: true, id: 'E3' });
  for (const t of ['hello everyone', 'who has the key to the store room', '', 'thank you very much for your help today']) assert.equal(parseExpenseReply(t), null, t);
});

test('the preview: the receipt total against the caption, the type, the date and who, how it was paid; the mismatch asks which is right; no receipt and no readable photo say so', () => {
  const st = store();
  const ok = st.add(makeEntry({ caption: '85.5', reading: fuelReading, hasReceipt: true, by: '971500000001', byName: 'Ali', ref: 'm1', at: NOW }));
  assert.equal(ok.state, 'ask_method'); assert.equal(entryText(ok), '🧾 *Expense* #E1\nReceipt: *85.50 AED* — caption 85.5 ✔\nType: ⛽ Fuel (ENOC)\nDate: 10/11/2026 — Ali\nPaid by?  1. Card   2. Cash\n(wrong type? write: food / office / car / other)');
  const bad = st.add(makeEntry({ caption: '85.5', reading: { ...fuelReading, total: 95.5 }, hasReceipt: true, by: '971500000001', byName: 'Ali', at: NOW }));
  assert.equal(bad.state, 'pick_amount'); assert.equal(entryText(bad), '🧾 *Expense* #E2\n⚠ Receipt says *95.50 AED*, caption says *85.50* — which is right?\n1. 95.50  2. 85.50');
  const none = st.add(makeEntry({ caption: '40 food', reading: null, hasReceipt: false, by: '971500000002', byName: 'Sara', at: NOW }));
  assert.deepEqual([none.state, none.amount, none.type, none.hasReceipt], ['ask_method', 40, 'food', false]); assert.match(entryText(none), /^🧾 \*Expense\* #E3\nAmount: \*40\.00 AED\* — no receipt \(caption only\)\nType: 🍞 Food\n/);
  const unread = st.add(makeEntry({ caption: '', reading: null, hasReceipt: false, by: '971500000002', at: NOW })); assert.equal(unread.state, 'need_amount'); assert.match(entryText(unread), /No amount was written\. Please write the amount as a number\./);
  assert.match(entryText({ ...unread, hasReceipt: true }), /I could not read the receipt\./);
  const noCaption = makeEntry({ caption: '', reading: fuelReading, hasReceipt: true, by: 'x', at: NOW }); assert.match(entryText({ id: 'E9', ...noCaption }), /Receipt: \*85\.50 AED\* — no caption/);
  // the type: a word in the caption wins over the receipt's guess; the receipt's guess when there is no word; Other when neither
  assert.equal(makeEntry({ caption: '85.5 office', reading: fuelReading, hasReceipt: true, at: NOW }).type, 'office'); assert.equal(makeEntry({ caption: '85.5', reading: fuelReading, hasReceipt: true, at: NOW }).type, 'fuel'); assert.equal(makeEntry({ caption: '85.5', reading: null, at: NOW }).type, 'other');
});

test('the conversation: a mismatch is settled, then card or cash; bare answers work when ONE expense waits, the code when several; a type word changes the type; nothing is saved before the payment is said', () => {
  const st = store(); const ali = '971500000001'; const sara = '971500000002';
  st.add(makeEntry({ caption: '85.5', reading: { ...fuelReading, total: 95.5 }, hasReceipt: true, by: ali, byName: 'Ali', at: NOW })); // E1 mismatch
  assert.match(handleReply(st, ali, parseExpenseReply('1')).text, /^🧾 \*Expense\* #E1\nReceipt: \*95\.50 AED\*/); assert.equal(st.get('E1').amount, 95.5); assert.equal(st.get('E1').state, 'ask_method');
  assert.equal(handleReply(st, ali, parseExpenseReply('food')).text.includes('Type: 🍞 Food'), true); assert.equal(st.get('E1').type, 'food');
  assert.equal(handleReply(st, ali, parseExpenseReply('2')).text, '✅ *Expense* #E1 saved — *95.50 AED*, 🍞 Food (ENOC), Cash.'); assert.equal(st.get('E1').state, 'done'); assert.equal(st.get('E1').method, 'cash');
  // two waiting from one person: the code is needed; another person's bare answer is not for them
  st.add(makeEntry({ caption: '10', reading: null, by: sara, byName: 'Sara', at: NOW })); st.add(makeEntry({ caption: '20 car', reading: null, by: sara, byName: 'Sara', at: NOW }));
  assert.match(handleReply(st, sara, parseExpenseReply('1')).text, /2 expenses wait for you: #E2, #E3\. Write the code with your answer, for example: 1 #E2/);
  assert.equal(handleReply(st, sara, parseExpenseReply('1 #E2')).text.startsWith('✅ *Expense* #E2 saved'), true); assert.equal(st.get('E2').method, 'card');
  assert.equal(handleReply(st, ali, parseExpenseReply('1')), null); // nothing of Ali's is open: ordinary
  assert.equal(handleReply(st, sara, parseExpenseReply('2 #E99')).text, 'No expense #E99 was found.');
  assert.equal(handleReply(st, sara, parseExpenseReply('2 #E3')).text.startsWith('✅ *Expense* #E3 saved'), true); // the other one is saved first
  // typed amount for an unread photo, a type change after it was saved, a cancel
  st.add(makeEntry({ caption: '', reading: null, hasReceipt: true, by: sara, at: NOW })); assert.equal(st.get('E4').state, 'need_amount');
  assert.match(handleReply(st, sara, parseExpenseReply('33.25'), 'Asia/Dubai').text, /Paid by\?/); assert.equal(st.get('E4').amount, 33.25);
  handleReply(st, sara, parseExpenseReply('#E2 office')); assert.equal(st.get('E2').type, 'office');
  assert.equal(handleReply(st, sara, parseExpenseReply('cancel #E4')).text, 'Expense #E4 cancelled.'); assert.equal(st.done({ from: '2026-11-10', to: '2026-11-10' }).length, 3); // E1, E2 and E3 are saved; the cancelled E4 is not counted
  assert.equal(savedText({ id: 'E5', amount: 5, type: 'other', method: 'card' }), '✅ *Expense* #E5 saved — *5.00 AED*, 📦 Other, Card.');
});

test('the server file: kept between starts, in its own folder, never in the repository', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-'));
  const a = new ExpenseStore(dir, () => NOW); a.add({ by: '1', amount: 5, type: 'food', day: '2026-11-10', state: 'done', method: 'cash' }); a.setGroup({ id: 'g@g.us', subject: 'Company Expenses' });
  const b = new ExpenseStore(dir, () => NOW); assert.equal(b.d.items.length, 1); assert.deepEqual(b.d.group, { id: 'g@g.us', subject: 'Company Expenses' }); assert.equal(b.d.n, 1);
  assert.ok(!fs.readdirSync(path.join(import.meta.dirname, '..')).some((f) => /expenses\.json/.test(f)));
});

const E = (day, amount, type, method, extra = {}) => ({ id: `E${amount}`, day, date: day, by: '1', byName: 'Ali', amount, type, method, state: 'done', ...extra });

test('the daily, weekly and monthly report: a line per type, one separator, the total with card and cash; a quiet day says so', () => {
  const list = [E('2026-11-10', 120, 'fuel', 'card'), E('2026-11-10', 65, 'food', 'cash'), E('2026-11-10', 45, 'office', 'cash'), E('2026-11-10', 310, 'vehicles', 'card'), E('2026-11-10', 30, 'other', 'cash')];
  assert.equal(expensesText(list, '10/11/2026'), ['*Expenses — 10/11/2026*', '⛽ Fuel: *120.00*', '🍞 Food: *65.00*', '🖇 Office supplies: *45.00*', '🚚 Vehicles: *310.00*', '📦 Other: *30.00*', SEP, 'Total: *570.00 AED* (card *430.00* / cash *140.00*)'].join('\n'));
  assert.equal(expensesText([], '10/11/2026'), '*Expenses — 10/11/2026*\nNo expense was recorded.');
  assert.deepEqual(rangeOf('today', '2026-11-10'), { from: '2026-11-10', to: '2026-11-10', label: '10/11/2026' }); assert.deepEqual(rangeOf('week', '2026-11-10'), { from: '2026-11-04', to: '2026-11-10', label: '04/11/2026 – 10/11/2026' }); assert.deepEqual(rangeOf('month', '2026-11-10'), { from: '2026-11-01', to: '2026-11-10', label: '11/2026' });
  const st = store(); st.add({ by: '1', amount: 5, type: 'food', day: '2026-11-09', state: 'done', method: 'cash' }); st.add({ by: '1', amount: 7, type: 'food', day: '2026-11-10', state: 'ask_method' });
  assert.equal(st.done(rangeOf('week', '2026-11-10')).length, 1); assert.equal(st.done(rangeOf('today', '2026-11-10')).length, 0);
});

const pay = (extra) => ({ type: 'payment', kind: 'cash', currency: 'AED', at: Date.parse('2026-11-10T08:00:00Z'), ref: `p${Math.random()}`, ...extra });
test('money received, private to the owner: cash, cheques, bank transfers, each with its QuickBooks status, the totals and the warnings', () => {
  const events = [pay({ customer: 'ALWAN ALSHAM', amount: 115 }), pay({ customer: 'AL AHLIA KITCHEN', amount: 3500 }), pay({ kind: 'cheque', customer: 'AWAB WOOD', amount: 2000 }), pay({ kind: 'transfer', receipt: 'transfer receipt', customer: 'MUNICH DOOR KITCHEN', amount: 0, invoices: ['inv-9940'], noAmount: true })];
  const lookup = new Map([['inv-9940', { DocNumber: 'inv-9940', TotalAmt: 504, Balance: 0, CustomerRef: { name: 'MUNICH DOOR KITCHEN TRADING L.L.C- S.P.C' } }]]);
  const items = receivedItems(events, rangeOf('today', '2026-11-10'), { lookup });
  assert.deepEqual(items.map((i) => [i.kind, i.amount, i.customer]), [['cash', 115, 'ALWAN ALSHAM'], ['cash', 3500, 'AL AHLIA KITCHEN'], ['cheque', 2000, 'AWAB WOOD'], ['bank', 504, 'MUNICH DOOR KITCHEN']]);
  const records = [{ TxnDate: '2026-11-09', TotalAmt: 115, CustomerRef: { name: 'ALWAN ALSHAM' } }]; // ±3 days, the same customer
  const text = receivedText(items, { title: '10/11/2026', records, now: Date.parse('2026-11-10T09:00:00Z') });
  assert.equal(text, ['💰 *Money received — 10/11/2026*', SEP, SEP, '💵 *Cash*', '', '*ALWAN ALSHAM*', '🟢 115.00', SEP, '*AL AHLIA KITCHEN*', '🔴 3,500.00  not in QuickBooks yet', SEP, SEP, '🧾 *Cheques*', '', '*AWAB WOOD*', '⏳ 2,000.00  cheque not cleared (0 days)', SEP, SEP, '🏦 *Bank transfers*', '', '*MUNICH DOOR KITCHEN*', '🟢 504.00 for inv-9940', SEP, SEP, '*Total: 6,119.00 AED*', 'Cash 3,615.00 | Cheques 2,000.00 | Transfers 504.00', '🟢 Recorded: 2    🔴 Not recorded: 2'].join('\n'));
  assert.equal(receivedText([], { title: '10/11/2026' }), '💰 *Money received — 10/11/2026*\nNo money was recorded.');
  // another customer's payment of the same amount is not the same receipt; the simulated and the old are left out
  assert.match(receivedText(items.slice(0, 1), { title: 't', records: [{ TxnDate: '2026-11-10', TotalAmt: 115, CustomerRef: { name: 'ZED CARPENTRY' } }] }), /🔴 115\.00  not in QuickBooks yet/);
  assert.equal(receivedItems([pay({ simulated: true, amount: 5, customer: 'X' }), pay({ amount: 5, customer: 'X', at: Date.parse('2026-10-01T08:00:00Z') })], rangeOf('today', '2026-11-10')).length, 0);
});

test('the Thursday check: expenses and money of the week that the office has NOT recorded (amount ±1, date ±3 days, the vendor or customer when known); all recorded says so', () => {
  const expenses = [E('2026-11-05', 85.5, 'fuel', 'card', { vendor: 'ENOC' }), E('2026-11-06', 40, 'food', 'cash'), E('2026-11-07', 200, 'vehicles', 'card')];
  const purchases = [{ TxnDate: '2026-11-07', TotalAmt: 85, EntityRef: { name: 'ENOC STATION' } }, { TxnDate: '2026-11-06', TotalAmt: 200, EntityRef: { name: 'GARAGE' } }];
  const m = matchExpenses(expenses, purchases);
  assert.deepEqual(m.found.map((f) => f.entry.amount), [85.5, 200]); assert.deepEqual(m.missing.map((e) => e.amount), [40]); assert.equal(m.unused.length, 0);
  assert.equal(matchExpenses([E('2026-11-05', 85.5, 'fuel', 'card', { vendor: 'ENOC' })], [{ TxnDate: '2026-11-05', TotalAmt: 85.5, EntityRef: { name: 'OTHER SHOP' } }]).missing.length, 1); // the vendor is known and differs
  assert.equal(matchExpenses([E('2026-11-01', 85.5, 'fuel', 'card')], [{ TxnDate: '2026-11-06', TotalAmt: 85.5 }]).missing.length, 1); // five days apart
  const items = [{ amount: 504, day: '2026-11-07', customer: 'MUNICH DOOR KITCHEN', kind: 'bank', paid: null, invoices: [], cleared: false, due: '' }, { amount: 115, day: '2026-11-08', customer: 'ALWAN ALSHAM', kind: 'cash', paid: null, invoices: [], cleared: false, due: '' }];
  const text = weeklyCheckText({ expenses, purchases, items, payments: [{ TxnDate: '2026-11-07', TotalAmt: 504, CustomerRef: { name: 'MUNICH DOOR KITCHEN TRADING L.L.C- S.P.C' } }], title: '04/11/2026 – 10/11/2026' });
  assert.equal(text, ['*Weekly check — 04/11/2026 – 10/11/2026*', 'Expenses not found in QuickBooks:', '1. 06/11/2026 — Ali — *40.00* — 🍞 Food', SEP, '💰 *Money received not found in QuickBooks*', '', '*ALWAN ALSHAM*', '🔴 115.00  cash 08/11/2026'].join('\n'));
  assert.equal(weeklyCheckText({ expenses: [], purchases: [], items: [], payments: [], title: 'w' }), '*Weekly check — w*\n✔ All recorded in QuickBooks this week.');
});

test('the owner\'s monthly report: the group expenses by type, what only QuickBooks has, what both have (counted once), the company total', () => {
  const expenses = [E('2026-11-05', 120, 'fuel', 'card'), E('2026-11-06', 65, 'food', 'cash')];
  const records = [{ TxnDate: '2026-11-05', TotalAmt: 120 }, { TxnDate: '2026-11-01', TotalAmt: 9000 }, { TxnDate: '2026-11-02', TotalAmt: 4000 }];
  assert.equal(monthlyFullText({ expenses, records, title: '11/2026' }), ['*Company expenses — 11/2026*', 'Group expenses:', '⛽ Fuel: *120.00*', '🍞 Food: *65.00*', SEP, 'In QuickBooks only (salaries, rent …): *13,000.00*', 'In both (counted once): *120.00*', SEP, 'Total company expenses: *13,185.00 AED*'].join('\n'));
});

test('the wiring: the group is set by the owner inside it or by a setting; the guard lets her write there; the owner\'s words; 19:00 Dubai, each report once; nothing is written to QuickBooks', () => {
  const env = (extra) => ({ ANTHROPIC_API_KEY: 'k', SHEET_URL: 'u', ZINAX_BOT_TOKEN: 't', ...extra });
  const { config } = loadConfig(env({ EXPENSES_GROUP_NAME: 'Company Expenses' }));
  assert.deepEqual(config.expensesGroupNames, ['company expenses']); assert.equal(config.expensesReportHour, 19);
  assert.equal(groupAllowed('Aryak Company Expenses 2026', config).why, 'internal group');
  assert.equal(groupAllowed('Some Customer', config).ok, false);
  assert.deepEqual(parseInvoiceCommand('expenses today'), { type: 'expenses_report', range: 'today' }); assert.deepEqual(parseInvoiceCommand('expenses week'), { type: 'expenses_report', range: 'week' }); assert.deepEqual(parseInvoiceCommand('هزینه ماه'), { type: 'expenses_report', range: 'month' });
  assert.deepEqual(parseInvoiceCommand('received today'), { type: 'received_report', range: 'today' }); assert.deepEqual(parseInvoiceCommand('money received week'), { type: 'received_report', range: 'week' }); assert.deepEqual(parseInvoiceCommand('weekly check'), { type: 'weekly_check' }); assert.deepEqual(parseInvoiceCommand('بررسی هفتگی'), { type: 'weekly_check' });
  const index = src('index.js');
  assert.match(index, /maybeSetExpensesGroup\(raw, groupId, info\) \|\| \(isExpensesSubject\(info\.subject\) && await expensesTurn\(raw, groupId, info\)\)/);
  assert.ok(index.includes('expenses?' + String.fromCharCode(92) + 's+group') && index.includes('گروه' + String.fromCharCode(92) + 's+هزینه')); // «Atossa, this is the expenses group»
  assert.match(index, /const owner = !!raw\.key\.fromMe \|\| staffChecker\(config\.ownerNumbers/); // only the owner can set it
  assert.match(index, /if \(now\.minutes < config\.expensesReportHour \* 60\) return;/); assert.match(index, /const once = \(key\) => \{ if \(expenseStore\.d\.sent\[key\]\) return false;/);
  assert.match(index, /if \(now\.weekday === 4 && once\(`weekly:\$\{now\.day\}`\)\)/); assert.match(index, /dayPlus\(now\.day, 1\)\.endsWith\('-01'\)/);
  assert.match(index, /const toOwner = \(text\) => sock\.sendMessage\(ownIds\(\)\[0\], \{ text: `🤖 \$\{text\}` \}\);/); // the money received report is private
  const block = index.slice(index.indexOf('// ---------------------------------------------------------------------------------------------------------------- company expenses'), index.indexOf('async function onMessage'));
  assert.doesNotMatch(block, /qbo\.(write|create|post|send)|\.write\(|postDocument/); assert.doesNotMatch(src('expenses.js'), /qbo\.|\.write\(|POST/);
  assert.ok(block.indexOf("toGroup(expensesReportText('today'))") > 0 && !/toGroup\([^)]*(?:monthlyFullReport|weeklyCheckReport|receivedReportText)/.test(block)); // salaries, rent, QuickBooks figures and the money received never go to the group
  assert.match(fs.readFileSync(path.join(import.meta.dirname, '..', 'deploy', 'gcp-startup.sh'), 'utf8'), /EXPENSES_GROUP_NAME EXPENSES_REPORT_HOUR/);
});
