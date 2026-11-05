// The only messages the Information group gets about invoices: short, English, one per invoice (or one per customer for the
// cut comparison), and only for a real mistake. Everything else is counted in the daily summary.

import { toEnglish } from './english.js';

const LABEL = {
  quantity: 'Wrong quantity', extra: 'Extra item', missing: 'Missing item', code: 'Wrong code', size: 'Wrong size', price: 'Wrong price', total: 'Wrong total',
  'line-total': 'Line amount', subtotal: 'Subtotal', vat: 'VAT', 'price-below': 'Price below list', unit: 'Price unit', 'unit-sheet': 'Item unit',
  currency: 'Currency', duplicate: 'Duplicate number', customer: 'Customer name', unreadable: 'Unreadable',
  'order-note': 'Order note', 'sourcing-cover': 'Covered by sourcing', 'cut-over': 'Cut above the invoice', 'cut-short': 'Cut below the invoice',
  'price-unknown': 'Price not in list', 'prices-unchecked': 'Prices not checked', gap: 'Missing number', 'price-above': 'Price above list', 'price-missing': 'Price not printed',
};

/** One problem as a short phrase for the owner's confirmation: "Wrong quantity 511 (correct: 35 m, invoice: 53 m)". */
export function shortPoint(p) {
  const right = p.requested ? ` (correct: ${p.requested}${p.invoiced ? `, invoice: ${p.invoiced}` : ''})` : p.invoiced ? ` (invoice: ${p.invoiced})` : '';
  return `${LABEL[p.kind] || String(p.kind).replace(/-/g, ' ')}${p.item ? ` ${p.item}` : ''}${right}`;
}

/** The urgent points of one invoice as one message. [v]: { number, customer, problems } (only the urgent ones are written). */
export function invoiceFindingText(v, name = '') {
  const urgent = (v.problems || []).filter((p) => p.severity !== 'info');
  const lines = [`⚠️ Invoice ${v.number || ''}${v.customer ? ` — ${v.customer}` : ''}: ${urgent.length} problem${urgent.length === 1 ? '' : 's'}`.replace(/\s+:/, ':')];
  urgent.slice(0, 6).forEach((p) => {
    const right = p.requested ? ` (correct: ${p.requested}${p.invoiced ? `, invoice: ${p.invoiced}` : ''})` : p.invoiced ? ` (invoice: ${p.invoiced})` : '';
    lines.push(`- ${LABEL[p.kind] || String(p.kind).replace(/-/g, ' ')}${p.item ? ` ${p.item}` : ''}${right}${p.note ? `. ${toEnglish(p.note)}` : ''}`);
  });
  if (urgent.length > 6) lines.push(`- and ${urgent.length - 6} more`);
  if (name) lines.push(`— ${name}`);
  return lines.join('\n');
}

/** The findings of the invoice-versus-cut comparison for one customer, as one message. */
export function cutFindingText(findings, name = '') {
  const first = findings[0];
  const lines = [`⚠️ Cut does not match the invoice — ${first.customer}`];
  for (const f of findings.slice(0, 8)) {
    const what = f.kind === 'cut-over' ? 'cut is MORE than invoiced' : 'cut is LESS than invoiced';
    lines.push(`- Invoice ${f.number || '?'}, code ${f.code}: invoiced ${f.invoiced} ${f.unit}, cut ${f.cut} ${f.unit} (${what})`);
  }
  if (findings.length > 8) lines.push(`- and ${findings.length - 8} more`);
  if (name) lines.push(`— ${name}`);
  return lines.join('\n');
}
