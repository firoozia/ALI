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
  assert.equal(p.at.length, 2); assert.equal(p.lines.at(-1), 'Proposal only — nothing was recorded in QuickBooks.'); assert.notEqual(p.lines[1], SEP);

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
  for (const f of ['unbilled.js', 'payments.js', 'staff.js', 'report.js', 'stock-format.js', 'invoicesend.js', 'qbodesk.js', 'shadow.js', 'index.js']) assert.match(src(f), /import \{[^}]*withSeparators[^}]* \} from '\.\/separator\.js';/, f);
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

test('several stock answers in one message (one per code) get the line between the code blocks, in any language, whoever assembled them; one answer is left alone', async () => {
  const { separateStockAnswers, formatStaffStock } = await import('../src/stock-format.js');
  const block = (code) => `*Code ${code} — Total: 40 m (Free 30 m)*\nCode ${code} is in stock\n- Free: 30 m`;
  const three = [block(505), block(403), block(701)].join('\n\n');
  const out = separateStockAnswers(three);
  assert.equal(out, [block(505), block(403), block(701)].join(`\n${SEP}\n`));
  assert.equal(out.split(SEP).length - 1, 2); assert.ok(!out.startsWith(SEP) && !out.trimEnd().endsWith(SEP));
  assert.equal(separateStockAnswers(out), out); // already separated: unchanged
  assert.equal(separateStockAnswers(block(505)), block(505)); // one answer: unchanged
  const fa = ['*کد 505 — جمع: 40 m*\nخط', '*کد 403 — جمع: 12 m*\nخط'].join('\n\n');
  assert.equal(separateStockAnswers(fa).split(SEP).length - 1, 1);
  const withNote = `Note for the group\n\n${block(505)}\n\nwarning line\n\n${block(403)}`; // a note first, a warning paragraph inside a block
  const w = separateStockAnswers(withNote);
  assert.ok(w.startsWith('Note for the group\n\n*Code 505')); assert.ok(w.includes(`warning line\n${SEP}\n*Code 403`)); assert.equal(w.split(SEP).length - 1, 1);
  assert.equal(separateStockAnswers('Hello, no stock here'), 'Hello, no stock here');
  const real = formatStaffStock({ found: true, code: '505', category: 'PVC film', unit: 'm', free: 30, reserved: 5, limit: 10, sizes: ['1.4 x 50'], packages: [], places: [] }, '505', '', 'en', null, { boldTotal: true });
  assert.equal(separateStockAnswers(`${real}\n\n${real.replace(/505/g, '403')}`).split(SEP).length - 1, 1); // the real formatter's blocks are recognized
  const index = src('index.js');
  assert.match(index, /const sep = separateStockAnswers\(a\[1\]\.text\);/); // every outgoing text, groups included
  assert.match(index, /withSeparators\(blocks\)\]\.join/); // the on-behalf desk
});

test('three codes in one message, the first with no warning and the second with one: the line is between EVERY pair of blocks, however they were joined', async () => {
  const { separateStockAnswers } = await import('../src/stock-format.js');
  const plain = (code) => `*Code ${code} — Total: 40 m (Free 30 m)*\nCode ${code} is in stock\n- Free: 30 m\n- Location: A1`;
  const warned = (code) => `${plain(code)}\n\n⚠ Free stock is below the minimum stock`;
  for (const joiner of ['\n\n', '\n', '\n\n\n']) { // the model may join the blocks with a blank line, a single newline or more
    const out = separateStockAnswers([plain(505), warned(403), plain(701)].join(joiner));
    assert.equal(out.split(SEP).length - 1, 2, JSON.stringify(joiner));
    const lines = out.split('\n'); const at = lines.map((l, i) => (l === SEP ? i : -1)).filter((i) => i >= 0);
    assert.ok(lines[at[0] + 1].startsWith('*Code 403') && lines[at[1] + 1].startsWith('*Code 701')); assert.ok(lines[at[0] - 1].trim() !== '' && lines[at[1] - 1].trim() !== ''); // nothing but the line between two blocks
    assert.ok(lines[0].startsWith('*Code 505') && !out.trimEnd().endsWith(SEP));
  }
  const out = separateStockAnswers([warned(505), plain(403), warned(701)].join('\n\n'));
  assert.equal(out.split(SEP).length - 1, 2); assert.equal(separateStockAnswers(out), out); // unchanged when run again
  assert.equal(separateStockAnswers('*Note — read this: 5*\nplain text'), '*Note — read this: 5*\nplain text'); // a bold line that is not a stock head
});

test('the exact owner-chat text: the «🤖 » mark before the first block, a blank line between 505 and 403, no asterisks left: the line is before EVERY code header but the first', async () => {
  const { separateStockAnswers } = await import('../src/stock-format.js');
  const text = [
    '🤖 *Code 505 — Total: 295.1 m*', 'Stock of code 505 (PVC film) is enough', '- Size: 0.35*1400', '- Free: 295.1 m', '- Reserved: 0 m', '- Minimum stock: 200 m', '- Packages: 2 packs of 120 m + open (total 295.1 m)', '- Location: Showroom, Warehouse 2',
    '', '*Code 403 — Total: 0.2 m*', 'Stock of code 403 (PVC film) is very low', '- Free: 0.2 m', '- Location: Showroom', '', '⚠ Free stock is below the minimum stock (200 m)',
    '', '*Code 701 — Total: 454 m*', 'Stock of code 701 (PVC film) is enough', '- Free: 454 m',
  ].join('\n');
  const out = separateStockAnswers(text);
  const lines = out.split('\n'); const at = lines.map((l, i) => (l === SEP ? i : -1)).filter((i) => i >= 0);
  assert.equal(at.length, 2); assert.ok(lines[at[0] + 1].startsWith('*Code 403') && lines[at[1] + 1].startsWith('*Code 701'));
  assert.ok(lines[at[0] - 1] === '- Location: Showroom, Warehouse 2' && lines[at[1] - 1].startsWith('⚠ Free stock')); // no blank line next to the separator
  assert.ok(lines[0].startsWith('🤖 *Code 505'));
  // without the asterisks (bold already rendered) and in Persian
  assert.equal(separateStockAnswers('Code 505 — Total: 1 m\nx\n\nCode 403 — Total: 2 m\ny').split(SEP).length - 1, 1);
  assert.equal(separateStockAnswers('🤖 *کد 505 — جمع: 1 m*\nx\n\n*کد 403 — جمع: 2 m*\ny\n\n*کد 701 — جمع: 3 m*\nz').split(SEP).length - 1, 2);
  assert.equal(separateStockAnswers('🤖 *Code 505 — Total: 1 m*\nonly one').includes(SEP), false);
});
