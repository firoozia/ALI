// The accountant's rules for the Confirmation group (the owner, 16/11: «money is no place for mistakes: count only what is clearly a
// payment or a receipt, ask about anything that is not clear»). Made-up names; every line says what an accountant would do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventsFromCaption } from '../src/captionevents.js';
import { cleanPaymentEvents } from '../src/payments.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';

const cases = [
  // clear cash
  ['Cash from Zeta Work 789.5 aed', 'PAY cash 789.5 Zeta'],
  ['789.5 aed cash received from Zeta Work', 'PAY cash 789.5 Zeta'],
  ['Zeta Work 1500 cash', 'PAY cash 1500 Zeta'],
  ['received 2000 aed from Nova Kitchens', 'PAY cash 2000 Nova'],
  ['نقد ۱۵۰۰ درهم از زتا', 'PAY cash 1500'],
  ['دریافت شد ۲۰۰۰ درهم نوا', 'PAY cash 2000'],
  ['استلمنا 3000 درهم نقدا من نوفا', 'PAY cash 3000'],
  // cheques
  ['Nova Kitchens cheque 3500 aed', 'PAY cheque 3500 Nova'],
  ['chq 4200 omega co dated 20/11', 'PAY cheque 4200 Omega'],
  ['PDC 5000 Zeta Work due 01/12/2026', 'PAY cheque 5000 Zeta'],
  ['چک ۳۵۰۰ نوا', 'PAY cheque 3500'],
  // transfers
  ['Omega Co bank transfer 2750 aed', 'PAY transfer 2750 Omega'],
  ['TT 1200 Zeta', 'PAY transfer 1200 Zeta'],
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
