import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SEP, withSeparators } from '../src/separator.js';
import { unbilledText } from '../src/unbilled.js';
import { paymentsText } from '../src/payments.js';
import { formatChecks } from '../src/staff.js';
import { formatReport } from '../src/report.js';
import { formatStaffStock } from '../src/stock-format.js';
import { chooseText } from '../src/invoicesend.js';

// Invented customers and amounts only.
const src = (name) => fs.readFileSync(path.join(import.meta.dirname, '..', 'src', name), 'utf8');
const between = (text) => { const lines = text.split('\n'); const at = lines.map((l, i) => (l === SEP ? i : -1)).filter((i) => i >= 0); return { lines, at }; };

test('the helper: about eighteen heavy box characters; between blocks only, never first or last; one block or none gets no line', () => {
  assert.equal(SEP, '━'.repeat(18)); assert.ok(SEP.length >= 16 && SEP.length <= 20);
  assert.equal(withSeparators(['a', 'b', 'c']), `a\n${SEP}\nb\n${SEP}\nc`);
  assert.equal(withSeparators(['only']), 'only'); assert.equal(withSeparators([]), ''); assert.equal(withSeparators(['a', '', 'b']), `a\n${SEP}\nb`);
});

test('every report formatter puts the line between its entries, not before the first or after the last, and the «+N more» line stays after the last block', () => {
  const groups = Array.from({ length: 13 }, (_, i) => ({ customer: `CUSTOMER ${i + 1}`, parts: ['303 6m 08/11'] }));
  const u = between(unbilledText({ groups }));
  assert.equal(u.at.length, 9); assert.equal(u.lines.at(-1), '+3 more'); assert.notEqual(u.lines.at(-2), SEP); assert.notEqual(u.lines[1], SEP);

  const NOW = Date.parse('2026-11-09T14:00:00Z');
  const pay = (customer, amount, at) => ({ type: 'payment', kind: 'cash', currency: 'AED', customer, amount, at });
  const p = between(paymentsText({ events: [pay('ZED CARPENTRY', 250, NOW - 3600000), pay('HAMED TRADING', 8000, NOW - 7200000), pay('PALM BIRD', 100, NOW - 9000000)], invoices: [], now: NOW }));
  assert.equal(p.at.length, 2); assert.equal(p.lines.at(-1), 'Proposal only: nothing was recorded in QuickBooks.'); assert.notEqual(p.lines[1], SEP);

  const c = between(formatChecks([{ verdict: 'match', customer: 'A', po: '1', file: 'f1.pdf' }, { verdict: 'mismatch', customer: 'B', po: '2', file: 'f2.pdf', problems: 2 }, { verdict: 'match', customer: 'C', po: '3', file: 'f3.pdf' }]));
  assert.equal(c.at.length, 2); assert.equal(c.lines.length, 5);
  assert.equal(formatChecks([{ verdict: 'match', customer: 'A', po: '1', file: 'f1.pdf' }]).includes(SEP), false); // one entry: no line

  const result = { from: '2026-10-01', to: '2026-10-31', operations: 7, totals: [{ qty: 10, unit: 'm' }], byCode: [{ code: '229', category: '', unit: 'm', total: 300, operations: 4, packages: 3, customers: [] }, { code: '408', category: '', unit: 'm', total: 142.5, operations: 2, packages: 2, customers: [] }] };
  const r = formatReport(result, 'en');
  assert.equal(r.split(SEP).length - 1, 1); assert.ok(!r.startsWith(SEP) && !r.trimEnd().endsWith(SEP));

  const q = formatStaffStock({ found: true, ambiguous: true, categories: ['PVC film', 'Edge banding', 'Hinge'] }, '1810', '', 'en');
  assert.equal(between(q).at.length, 2);
  assert.equal(between(chooseText([{ subject: 'A' }, { subject: 'B' }, { subject: 'C' }])).at.length, 2);
});

test('the wiring: every multi-entry report uses the shared helper (aliases, choice lists, stock blocks, the week summary), and the previews of one customer do not', () => {
  for (const f of ['unbilled.js', 'payments.js', 'staff.js', 'report.js', 'stock-format.js', 'invoicesend.js', 'qbodesk.js', 'shadow.js', 'index.js']) assert.match(src(f), /import \{ withSeparators \} from '\.\/separator\.js';/, f);
  const index = src('index.js');
  assert.match(index, /withSeparators\(pairs\.slice\(0, 25\)\.map\(/); // cut aliases, one line each
  assert.match(index, /withSeparators\(found\.names\.map\(/); // a customer group with several customers
  const desk = src('qbodesk.js');
  assert.equal((desk.match(/withSeparators\(/g) || []).length, 4); // the four customer-choice lists (English and Persian, several and nearest)
  assert.match(src('stock-format.js'), /withSeparators\(stockBlocks\(result, lang, want, opts\)\)/); // a stock answer with several codes or sizes
  assert.match(src('shadow.js'), /withSeparators\(perGroup\)/);
  assert.match(src('report.js'), /withSeparators\(blocks\)/);
  // a single-customer preview has no separator
  const inv = src('qboinvoice.js'); assert.ok(!inv.includes('withSeparators') && !/\bSEP\b/.test(inv));
  const stm = src('qbostatement.js'); assert.ok(!stm.includes('withSeparators'));
});
