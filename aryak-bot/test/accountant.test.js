// The accountant's rules for the Confirmation group (the owner, 16/11: «money is no place for mistakes: count only what is clearly a
// payment or a receipt, ask about anything that is not clear»). Made-up names; every line says what an accountant would do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventsFromCaption } from '../src/captionevents.js';
import { cleanPaymentEvents } from '../src/payments.js';
import { parseInvoiceCommand, readEnglishInvoice } from '../src/qboinvoice.js';
import { isExpenseText, makeEntry, parseExpenseCaption } from '../src/expenses.js';

const cases = [
  // clear cash
  ['Cash from Zeta Work 789.5 aed', 'PAY cash 789.5 Zeta'],
  ['789.5 aed cash received from Zeta Work', 'PAY cash 789.5 Zeta'],
  ['Zeta Work 1500 cash', 'ASK'], // the owner, 21/11: no AED beside the amount: nothing is recorded, the group is asked
  ['received 2000 aed from Nova Kitchens', 'PAY cash 2000 Nova'],
  ['نقد ۱۵۰۰ درهم از زتا', 'PAY cash 1500'],
  ['دریافت شد ۲۰۰۰ درهم نوا', 'PAY cash 2000'],
  ['استلمنا 3000 درهم نقدا من نوفا', 'PAY cash 3000'],
  // cheques
  ['Nova Kitchens cheque 3500 aed', 'PAY cheque 3500 Nova'],
  ['chq 4200 omega co dated 20/11', 'ASK'],
  ['chq 4200 aed omega co dated 20/11', 'PAY cheque 4200 Omega'],
  ['PDC 5000 AED Zeta Work due 01/12/2026', 'PAY cheque 5000 Zeta'],
  ['چک ۳۵۰۰ درهم نوا', 'PAY cheque 3500'],
  ['چک ۳۵۰۰ نوا', 'ASK'],
  // transfers
  ['Omega Co bank transfer 2750 aed', 'PAY transfer 2750 Omega'],
  ['TT 1200 AED Zeta', 'PAY transfer 1200 Zeta'],
  ['واریز ۲۰۰۰ درهم نوا', 'PAY transfer 2000'],
  ['Your AC No: XXXXXXXX1234 is credited with AED 708.75 for Aani Instant Payments. Login to Online Banking for details.', 'PAY transfer 708.75 nameless'],
  ['Your AC No: XXXXXXXX1234 is credited with AED 579.60 for Outward Cheque Clearing. Login to Online Banking for details.', 'PAY cash 579.6'], // stored as the bank message; every read makes it the cleared cheque
  // not money
  ['307 available one roll in China stock?', 'IGNORE'],
  ['3000 aed delivery', 'IGNORE'],
  ['deliver 2 rolls 410 to Zeta', 'IGNORE'],
  ['ok', 'IGNORE'],
  ['Done', 'IGNORE'],
  ['plz clear it', 'IGNORE'],
  ['Quotation for Zeta 4500 aed', 'IGNORE'],
  ['estimate 2300 for nova', 'IGNORE'],
  ['petrol 150', 'IGNORE'],
  ['salary advance 500 Ahmed', 'CASH-OUT'],
  ['18000 deposit to boss', 'CASH-OUT'],
  ['Statement of account for "ZETA LLC" from 01/10/2026 to 16/11/2026 sent (balance *0.00 AED*).', 'IGNORE'],
  ['Invoice #Q12 Customer: ZETA LLC Total: 54.60 AED Yes/No', 'IGNORE'],
  ['410 - 4m', 'IGNORE'],
  ['Check 603', 'IGNORE'],
  ['Zeta asked price of 212, 25 per meter', 'IGNORE'],
  ['balance of Zeta is 3400', 'IGNORE'],
  ['Zeta will pay 2000 tomorrow', 'IGNORE'],
  ['please collect 1500 from Zeta', 'IGNORE'],
  ['زتا فردا ۲۰۰۰ میده', 'IGNORE'],
  ['how much Zeta owes?', 'IGNORE'],
  ['15/11 Zeta', 'IGNORE'],
  // unclear: an amount and a name, no word of money -> ASK
  ['Zeta 1500', 'ASK'],
  ['1500 Zeta Work', 'ASK'],
  ['Nova 3500 aed', 'PAY cash 3500 Nova'], // the staff's own way («483 aed Alwan alsham»): a currency says money
  ['زتا ۱۵۰۰', 'ASK'],
  ['Omega Co 2,750', 'ASK'],
];

const verdict = (text) => {
  const r = eventsFromCaption('payment', text);
  const ev = r?.events?.[0];
  if (!r || r.ignore || r.cleared || r.clearInvoices || r.name) return 'IGNORE';
  if (r.askAed) return 'ASK'; // the owner, 21/11: no AED beside the amount, the group is asked
  if (ev.kind === 'unclear') return 'ASK';
  if (/cash_to|salary|advance|boss/.test(String(ev.kind))) return 'CASH-OUT';
  return `PAY ${ev.kind} ${ev.amount} ${ev.customer || 'nameless'}`;
};

test('the accountant reads every kind of Confirmation-group message: money received, not money, and unclear (asked, never counted)', () => {
  for (const [text, want] of cases) {
    const got = verdict(text);
    if (want.startsWith('PAY')) {
      const [, kind, amount] = want.split(' ');
      assert.ok(got.startsWith(`PAY ${kind} ${amount}`), `${text}: ${got}`);
    } else assert.equal(got, want, text);
  }
});

test('an unclear entry and a «not money» one are in no report; the owner\'s answer «cash 16:23 …» / «not money 16:23» is read', () => {
  const rows = [
    { type: 'payment', kind: 'unclear', ref: 'u', at: 1, amount: 1500, customer: 'Zeta', text: 'Zeta 1500' },
    { type: 'payment', kind: 'not-money', ref: 'n', at: 2, amount: 900, customer: 'Nova', text: 'Nova 900' },
    { type: 'payment', kind: 'cash', ref: 'c', at: 3, amount: 500, customer: 'Omega', text: 'cash from Omega 500' },
  ];
  assert.deepEqual(cleanPaymentEvents({ events: rows, isKnown: () => true }).map((e) => e.ref), ['c']);
  assert.deepEqual(parseInvoiceCommand('cash 16:23 Zeta Work'), { type: 'payment_kind', kind: 'cash', hh: 16, mm: 23, day: '', name: 'Zeta Work' });
  assert.deepEqual(parseInvoiceCommand('not money 16:23'), { type: 'payment_kind', kind: 'not-money', hh: 16, mm: 23, day: '', name: '' });
  assert.equal(parseInvoiceCommand('پول نیست ۱۶:۲۳').kind, 'not-money');
  assert.equal(parseInvoiceCommand('transfer 9:05 12/11').day, '11-12');
});

test('a Persian name of three letters is never matched to a customer by sound (live 16/11: «زتا» became «ASAD AND RIZWAN CONTRACTION»)', async () => {
  const fs = await import('node:fs'); const path = await import('node:path');
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(index.includes("length < 4) return name; // live 16/11"), 'a short Persian name is kept as written');
});

// ---- part 2 (the owner, 17/11: «yes, all of them»): the cash box, the expenses group and invoice requests, message by message

const box = [
  ['18000 deposit to boss', 'cash_to_boss 18000'],
  ['gave 5000 to boss', 'cash_to_boss 5000'],
  ['5000 cash handed to boss', 'cash_to_boss 5000'],
  ['advance 500 Raju', 'salary_advance 500'],
  ['salary advance 750 to Ahmed', 'salary_advance 750'],
  ['سلف ۵۰۰ راجو', 'salary_advance 500'],
  ['مساعده ۳۰۰ علی', 'salary_advance 300'],
  ['Pay by cash 157 aed for garbage box', 'cash_expense 157'],
  ['paid 200 aed for water', 'cash_expense 200'],
  ['handed 1000 to Ali', 'cash_unclear 1000'],
  ['loan 2000 to Ahmed', 'cash_unclear 2000'],
  // money coming IN, never cash out
  ['received 2000 from boss for cash box', 'ASK'],
  ['boss gave 5000 to cash box', 'ASK'],
  ['advance payment 2000 aed from Zeta Work', 'PAY'],
  ['advance payment 2000 from Zeta Work', 'ASK'],
  ['Zeta paid 1500 aed cash for 2 rolls', 'PAY'],
  ['Zeta Work paid 900 aed for invoice 1203', 'PAY'],
  ['cash 1200 aed from Nova for advance', 'PAY'],
  ['Omega Co paid advance 3000 aed cheque', 'PAY'],
];
test('the cash box: money to the boss, staff advances and company cash expenses are cash out; money FROM the boss is asked; a customer advance or payment is money received', () => {
  for (const [text, want] of box) {
    const r = eventsFromCaption('payment', text); const e = r?.events?.[0];
    const got = !r || r.ignore ? 'IGNORE' : r.askAed || e.kind === 'unclear' ? 'ASK' : ['cash', 'cheque', 'transfer'].includes(e.kind) ? `PAY ${e.kind} ${e.amount} ${e.customer || ''}` : `${e.kind} ${e.amount} ${e.employee || ''}`;
    assert.ok(want === 'PAY' ? got.startsWith('PAY') : got.startsWith(want), `${text} -> ${got} (wanted ${want})`);
  }
  assert.equal(eventsFromCaption('payment', 'Zeta Work paid 900 aed for invoice 1203').events[0].customer, 'Zeta Work'); // no «for» left on the name
  // live 17/11: what the money was for and the word «advance» are no part of the customer's name
  for (const [text, name] of [['advance payment 2000 aed from Zeta Work', 'Zeta Work'], ['Zeta paid 1500 aed cash for 2 rolls', 'Zeta'], ['Omega Co paid advance 3000 aed cheque', 'Omega Co'], ['cash 1200 aed from Nova for advance', 'Nova'], ['cash 800 aed for Nova', 'Nova'], ['Cash from Lions for Kitchens 164 aed', 'Lions for Kitchens']]) assert.equal(eventsFromCaption('payment', text).events[0].customer, name, text);
});

const exp = [
  ['85.5', 'E 85.5 other ask'],
  ['85.5 fuel', 'E 85.5 fuel ask'],
  ['85.5 aed petrol', 'E 85.5 fuel ask'],
  ['fuel 85.5', 'E 85.5 fuel ask'],
  ['petrol 120 aed cash', 'E 120 fuel done'],
  ['۸۵٫۵ بنزین', 'E 85.5 fuel ask'],
  ['۱۲۰ ناهار', 'E 120 food ask'],
  ['150 lunch staff', 'E 150 food ask'],
  ['60 car wash', 'E 60 vehicles ask'],
  ['200 cash', 'E 200 other done'],
  ['1,250 tyre card', 'E 1250 vehicles done'],
  // not an expense
  ['0501234567', 'NO'],
  ['050 123 4567', 'NO'],
  ['100 50', 'NO'],
  ['12/11', 'NO'],
  ['tomorrow 200 fuel', 'NO'],
  ['how much fuel 300?', 'NO'],
  ['room 12', 'NO'],
  ['ok', 'NO'],
];
test('the expenses group: a text with no photo is an expense only when it is plainly one (never a phone number, two numbers, a date, a question or a plan)', () => {
  for (const [text, want] of exp) {
    let got = 'NO';
    if (parseExpenseCaption(text).amount && isExpenseText(text)) { const e = makeEntry({ caption: text, at: Date.parse('2026-11-17T08:00:00Z') }); got = `E ${e.amount} ${e.type} ${e.state === 'done' ? 'done' : e.state === 'ask_method' ? 'ask' : e.state}`; }
    assert.equal(got, want, text);
  }
});

const inv = [
  ['invoice for Zeta Work\n603 = 30 mtr', 'Zeta Work | 603 30'],
  ['invoice for Zeta Work\n603 30m 25aed', 'Zeta Work | 603, 30, 25'],
  ['invoice for Zeta Work\nJowat glue 1pc 1500aed', 'Zeta Work | Jowat glue, 1, 1500'],
  ['invoice for Zeta Work\n603 30m @ 25', 'Zeta Work | 603, 30, 25'],
  ['invoice for Zeta Work\n۶۰۳ = ۳۰ متر', 'Zeta Work | 603 30'],
  ['Atossa invoice for Nova 215=97M 220=12M', 'Nova | 215 97 ; 220 12'],
  ['invoice for Zeta Work\nJowat glue 1500aed', 'UNREAD'],
  ['invoice for Zeta Work\n603 30m\ndiscount 10%', 'UNREAD'],
  ['invoice for Zeta Work\n603 30m 25', 'UNREAD'],
  ['invoice for Zeta Work\n603 1,000m', 'UNREAD'],
  ['invoice for Zeta Work\n603 0m', 'UNREAD'],
  ['invoice for Zeta Work\n603 -30m', 'UNREAD'],
  ['invoice for Zeta Work\n603', 'UNREAD'],
  ['invoice for Zeta Work?', 'NONE'],
  ['invoice for Zeta Work\n603 30m\nPO 1029', 'Zeta Work | 603 30'],
];
test('an invoice request: every line is read exactly or said as not understood (a bare code, a quantity of 0, «-30» are never guessed)', () => {
  for (const [text, want] of inv) {
    const r = readEnglishInvoice(text);
    const got = !r ? 'NONE' : (r.unread.length || !r.lines.length) ? 'UNREAD' : `${r.customer} | ${r.lines.join(' ; ')}`;
    assert.equal(got, want, text);
  }
});
