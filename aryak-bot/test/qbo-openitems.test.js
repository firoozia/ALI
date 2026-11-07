import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatementData, statementPdf } from '../src/qbostatement.js';

// Invented names and amounts only.
test('the statement lists the open invoices with their days overdue, so every ageing bucket can be checked against its own invoice', () => {
  const d = buildStatementData({
    company: { CompanyName: 'Sandbox Co', Country: 'US' }, customer: { DisplayName: 'Bird Sanctuary', Balance: 339 },
    invoices: [
      { DocNumber: '1001', TxnDate: '2026-10-09', DueDate: '2026-11-08', TotalAmt: 239, Balance: 239 },
      { DocNumber: '1002', TxnDate: '2026-09-20', DueDate: '2026-10-20', TotalAmt: 100, Balance: 100 },
      { DocNumber: '1003', TxnDate: '2026-09-01', DueDate: '2026-10-01', TotalAmt: 50, Balance: 0 },
    ],
    today: '2026-11-07',
  });
  assert.deepEqual(d.openItems.map((i) => [i.ref, i.past, i.balance]), [['1002', 18, 10000], ['1001', -1, 23900]]);
  assert.deepEqual(d.ageing, { current: 23900, d1_30: 10000, d31_60: 0, d61_90: 0, d91: 0 });
  const pdf = statementPdf(d, { sandbox: true }).toString('latin1');
  assert.ok(pdf.includes('Open invoices') && pdf.includes('not yet due') && pdf.includes('Days overdue'));
  const count = (t) => pdf.split(`(${t})`).length - 1;
  assert.deepEqual([count('1001'), count('1002'), count('1003')], [2, 2, 1]); // an open invoice is in the lines and in the open list; a paid one only in the lines
});
