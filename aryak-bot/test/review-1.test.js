import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpenseStore, expenseAsk, expensesText } from '../src/expenses.js';
import { draftText, stateOf } from '../src/availdraft.js';
import { parseCutCaption } from '../src/captions.js';
import { Tracker, reconcileCuts, settleCuts } from '../src/tracker.js';
import { cutFindingText } from '../src/finding.js';

// Invented customers and amounts only.
const DAY = 86400000;
const T0 = Date.parse('2026-11-10T08:00:00Z');
const cutEv = (customer, code, qty, at, ref, pieces) => ({ type: 'cut', at, customer, ref, lines: [{ code, quantity: qty, unit: 'm' }], ...(pieces ? { pieces } : {}) });

test('a question to Atossa in the expenses group: her name alone = today; name + expenses + a word of asking = the period; other talk is not it', () => {
  assert.equal(expenseAsk('Atossa'), 'today'); assert.equal(expenseAsk('Atossa?'), 'today'); assert.equal(expenseAsk('آتوسا'), 'today');
  assert.equal(expenseAsk('Atossa check all expenses in this group'), 'all'); assert.equal(expenseAsk('Atossa show expenses of the week'), 'week');
  assert.equal(expenseAsk('atossa expenses report this month'), 'month'); assert.equal(expenseAsk('Atossa list the expenses'), 'today');
  for (const t of ['85.5 fuel', 'check all expenses', 'Atossa what time is it', 'thanks Atossa for the receipt']) assert.equal(expenseAsk(t), null, t);
});

test('an expense made in the test group before test data was kept apart is marked once and is then in no real report', () => {
  const s = new ExpenseStore('');
  s.add({ state: 'done', day: '2026-11-10', amount: 85.5, category: 'fuel', by: 'x' }); s.add({ state: 'done', day: '2026-11-10', amount: 20, category: 'food', by: 'x' });
  const range = { from: '2026-11-10', to: '2026-11-10', label: '10/11' };
  assert.equal(s.done(range).length, 2);
  assert.equal(s.markTestOnce('m1', ['E1', 'E9']), 1); assert.equal(s.done(range).length, 1); assert.doesNotMatch(expensesText(s.done(range), '10/11'), /85\.50/);
  assert.equal(s.markTestOnce('m1', ['E2']), 0); assert.equal(s.done(range).length, 1); // once only
});

test('a tiny remnant is never «available»: it says what is left and asks how many meters; a real length still is available; a longer ask is not enough', () => {
  const r = (free) => stateOf('406', { found: true, free, unit: 'm' }, 0, 10);
  assert.equal(r(1.8).state, 'remnant'); assert.equal(draftText([r(1.8)]), 'Only 1.8 m left of code 406 (remnant). How many meters do you need?');
  assert.equal(r(2.8).state, 'remnant'); assert.equal(r(10).state, 'yes'); assert.equal(r(60).state, 'yes');
  assert.equal(stateOf('406', { found: true, free: 1.8, unit: 'm' }, 5, 10).state, 'part'); // asked for more than is there
  assert.equal(stateOf('406', { found: true, free: 1.8, unit: 'm' }, 0, 0).state, 'yes'); // threshold off
  assert.doesNotMatch(draftText([r(1.8)]), /available/);
});

test('the plus lost in WhatsApp text: «1510=25M» is 15+10=25M; a normal cut is untouched', () => {
  const a = parseCutCaption('ART NO 229 ZETA WOOD 1510=25M');
  assert.deepEqual([a.quantity, a.pieces, a.customer], [25, [15, 10], 'ZETA WOOD']);
  assert.deepEqual(parseCutCaption('ART NO 229 ZETA WOOD 15+10=25M').pieces, [15, 10]);
  const plain = parseCutCaption('ART NO 229 ZETA WOOD 10M'); assert.equal(plain.quantity, 10); assert.equal(plain.pieces, undefined);
  assert.equal(parseCutCaption('ART NO 303 120M FOR CUT.').kind, 'open-roll');
  assert.equal(parseCutCaption('ART NO 229 ZETA WOOD 1510=26M').quantity, 26); // the parts do not add up: left as written
});

test('a cut counts once: a repeated post, and the earlier part that a total post already includes', () => {
  const twice = [cutEv('SAJ TEST', '502', 17.2, T0, 'a'), cutEv('SAJ TEST', '502', 17.2, T0 + 120000, 'b')];
  assert.equal(settleCuts(twice).length, 1);
  assert.equal(settleCuts([cutEv('SAJ TEST', '502', 17.2, T0, 'a'), cutEv('SAJ TEST', '502', 17.2, T0 + 3 * 3600000, 'c')]).length, 2); // hours apart: two cuts
  const parts = [cutEv('ZETA WOOD', '229', 10, T0, 'p1'), cutEv('ZETA WOOD', '229', 25, T0 + 3600000, 'p2', [15, 10])];
  assert.deepEqual(settleCuts(parts).map((e) => e.ref), ['p2']);
  const t = new Tracker(); t.startedAt = T0 - 20 * DAY;
  t.add({ type: 'invoice', at: T0 - 3600000, ref: 'i1', number: 'inv-1', customer: 'ZETA WOOD', lines: [{ code: '229', quantity: 25, unit: 'm' }] });
  parts.forEach((e) => t.add(e));
  assert.deepEqual(reconcileCuts(t, 'ZETA WOOD', { now: T0 + DAY }), []); // 25 invoiced, 25 cut (not 35)
});

test('a new cut long after an old invoice is a cut with no invoice yet, not a mismatch on the old invoice; the finding says where the cut figure came from', () => {
  const t = new Tracker(); t.startedAt = T0 - 30 * DAY;
  t.add({ type: 'invoice', at: T0 - 6 * DAY, ref: 'i1', number: 'inv-7', customer: 'MASTER TEST', lines: [{ code: '211', quantity: 2, unit: 'm' }] });
  t.add(cutEv('MASTER TEST', '211', 2, T0 - 6 * DAY - 3600000, 'c1'));
  t.add(cutEv('MASTER TEST', '211', 5.2, T0, 'c2')); // a new order of the same code
  assert.deepEqual(reconcileCuts(t, 'MASTER TEST', { now: T0 + DAY }), []);
  const u = new Tracker(); u.startedAt = T0 - 30 * DAY;
  u.add({ type: 'invoice', at: T0 - DAY, ref: 'i2', number: 'inv-8', customer: 'MASTER TEST', lines: [{ code: '211', quantity: 2, unit: 'm' }] });
  u.add(cutEv('MASTER TEST', '211', 7.2, T0 - DAY - 3600000, 'c3'));
  const f = reconcileCuts(u, 'MASTER TEST', { now: T0 });
  assert.equal(f.length, 1); assert.equal(f[0].source, 'orders group posts');
  assert.match(cutFindingText(f), /\(cut is MORE than invoiced\) — cut counted from the orders group posts/);
});
