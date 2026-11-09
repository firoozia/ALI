import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WJ, markAmounts } from '../src/amount.js';
import { SEP, withEnd } from '../src/separator.js';
import { paymentsText } from '../src/payments.js';
import { unbilledText } from '../src/unbilled.js';

// Invented customers and amounts only.
test('every money amount is bold and unbroken by the auto-detection; invoice numbers stay plain; sizes, quantities, dates and phones are left alone', () => {
  assert.equal(markAmounts('9,940.00 AED'), `*9,${WJ}940${WJ}.00 AED*`);
  assert.equal(markAmounts('115.00'), `*115${WJ}.00*`);
  assert.equal(markAmounts('inv-9988 88.20'), `inv-${WJ}9988 *88${WJ}.20*`);
  assert.equal(markAmounts('inv-9961 88.20 + inv-9714 23.10 = 111.30'), `inv-${WJ}9961 *88${WJ}.20* + inv-${WJ}9714 *23${WJ}.10* = *111${WJ}.30*`);
  assert.equal(markAmounts('5,633.00 and 1,386.00 USD'), `*5,${WJ}633${WJ}.00* and *1,${WJ}386${WJ}.00 USD*`);
  assert.equal(markAmounts('*Total 1,386.00*'), `*Total 1,${WJ}386${WJ}.00*`); // already inside a bold span: only the breaker, no nested asterisks
  for (const same of ['Size: 0.35*1400', 'Free: 295.1 m', 'due 09/11 at 14:30', '+971 50 123 4567', 'code 505 x 3', '1.4 x 50', 'inv-9988']) assert.equal(markAmounts(same).replace(new RegExp(WJ, 'g'), ''), same.replace(/\binv-/, 'inv-'), same);
  assert.equal(markAmounts('Size: 0.35*1400'), 'Size: 0.35*1400'); assert.equal(markAmounts('Free: 295.1 m'), 'Free: 295.1 m');
  const once = markAmounts('Payments: 9,940.00 AED, inv-9988 88.20'); assert.equal(markAmounts(once), once); // running it again changes nothing
  assert.equal(once.replace(new RegExp(WJ, 'g'), '').replace(/\*/g, ''), 'Payments: 9,940.00 AED, inv-9988 88.20'); // read without the invisible character and the stars it is the same text
});

test('the wiring: the team\'s texts (the owner chat, internal groups, staff) get it; a customer group never does; it runs just before the guarded send', () => {
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(index, /ownIds\(\)\.some\(\(o\) => jidDigits\(o\) === jidDigits\(a\[0\]\)\) \|\| await englishFor\(a\[0\]\)\.catch\(\(\) => false\)\)/);
  assert.ok(index.indexOf('markAmounts(a[1].text)') > index.indexOf('toEnglish(a[1].text)') && index.indexOf('markAmounts(a[1].text)') < index.indexOf('const r = await guarded(...a);'));
  assert.match(index, /const englishFor = async \(jid\) => \{\n\s+if \(isJidGroup\(jid\)\) \{ const why = groupAllowed\([^\n]*return why === 'internal group' \|\| why === 'test group'; \}/); // a customer group is not in it
});

test('the closing lines of a report are set apart from the last item by the line (two or more items); one item keeps its closing line directly', () => {
  assert.equal(withEnd(['a', 'b'], ['+3 more']), `a\n${SEP}\nb\n${SEP}\n+3 more`);
  assert.equal(withEnd(['a'], ['footer']), 'a\nfooter'); assert.equal(withEnd(['a', 'b'], []), `a\n${SEP}\nb`); assert.equal(withEnd([], ['only the closing']), 'only the closing');
  assert.equal(withEnd(['a', 'b'], ['', '+1']), `a\n${SEP}\nb\n${SEP}\n+1`); // empty closing parts are dropped
  const NOW = Date.parse('2026-11-09T14:00:00Z');
  const pay = (customer, amount, at) => ({ type: 'payment', kind: 'cash', currency: 'AED', customer, amount, at });
  const text = paymentsText({ events: [pay('A CO', 10, NOW - 3600000), pay('B CO', 20, NOW - 7200000)], invoices: [], now: NOW });
  const lines = text.split('\n'); assert.equal(lines.at(-1), 'Proposal only — nothing was recorded in QuickBooks.'); assert.equal(lines.at(-2), SEP);
  assert.equal(paymentsText({ events: [pay('A CO', 10, NOW - 3600000)], invoices: [], now: NOW }).split('\n').at(-2).includes(SEP), false); // one payment: the footer follows directly
  const u = unbilledText({ groups: Array.from({ length: 12 }, (_, i) => ({ customer: `C${i}`, parts: ['303 6m'] })) }).split('\n');
  assert.equal(u.at(-1), '+2 more'); assert.equal(u.at(-2), SEP);
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(index, /withEnd\(pairs\.slice\(0, 25\)[^\n]*Reply: yes #\$\{p\.id\}/); // the alias list: «+N more» and the reply line
  assert.match(fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'report.js'), 'utf8'), /withEnd\(blocks, \[\.\.\.\(rest > 0 \? \[t\.moreCodes\(rest\)\] : \[\]\), t\.hint\]\)/);
  assert.match(fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'qbodesk.js'), 'utf8'), /withEnd\([^\n]*\['Write the right name\.'\]\)/);
});
