// Cut photos in the cut group versus the warehouse sheet (the roll is scanned after cutting and an OUT is written there): a
// three-way check with the invoices. Read-only on the sheet. The captions and the scans agree to a few tenths of a metre (a cut
// from an open roll is recorded about 0.1 to 0.2 m above the caption, full rolls are exact), so a difference counts only beyond a
// tolerance PER OPERATION. Names differ between the two sources ("dandy Door", "DANDY DOOR"), so they are matched loosely.

import { productCode } from './codes.js';

const GENERIC = new Set(['al', 'the', 'door', 'doors', 'wood', 'kitchen', 'kitchens', 'trading', 'trd', 'llc', 'ind', 'industries', 'furniture', 'carpentry', 'decor', 'co', 'company', 'est', 'fze']);
const tokens = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ ]/g, ' ').split(/\s+/).filter(Boolean);

function near(a, b) { // an edit distance of one on words of five letters or more ("ahalia" and "ahlia")
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** The same customer in the two sources: a shared distinctive word (generic words such as door, wood, kitchen do not count). */
export function sameName(a, b) {
  const ta = tokens(a); const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join('') === tb.join('')) return true;
  const da = ta.filter((t) => !GENERIC.has(t)); const db = tb.filter((t) => !GENERIC.has(t));
  if (!da.length || !db.length) return false;
  return da.some((x) => db.some((y) => near(x, y)));
}

const unitOf = (u) => (/roll/i.test(u) ? 'roll' : 'm');
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * [cuts]: caption events { customer, lines: [{ code, quantity, unit }], internal, kind } of the day; [rows]: the sheet's OUT/CUT
 * rows { code, qty, unit, customer } of the same day; [tol]: metres allowed per operation; [match]: the name matcher.
 * A caption with kind 'damage' or an internal roll is not compared. Returns { mismatch, cutNoOut, outNoCut, agree, damage }.
 */
export function reconcileSheet({ cuts, rows, tol = 0.5, match = sameName }) {
  const out = { mismatch: [], cutNoOut: [], outNoCut: [], agree: 0, damage: 0 };
  const groups = [];
  const groupFor = (customer, code, unit) => {
    let g = groups.find((x) => x.code === code && x.unit === unit && match(x.customer, customer));
    if (!g) { g = { customer, code, unit, cut: 0, cutOps: 0, out: 0, outOps: 0 }; groups.push(g); }
    return g;
  };
  for (const e of cuts) {
    if (e.kind === 'damage') { out.damage++; continue; }
    if (e.internal) continue;
    for (const l of e.lines || []) {
      if (!l.code || !(l.quantity > 0)) continue;
      const g = groupFor(e.customer, productCode(l.code), unitOf(l.unit));
      g.cut += l.quantity; g.cutOps++;
    }
  }
  for (const r of rows) {
    if (!String(r.customer || '').trim()) continue; // an OUT with no customer name cannot be matched
    const g = groupFor(r.customer, productCode(r.code), unitOf(r.unit));
    g.out += Number(r.qty) || 0; g.outOps++;
  }
  for (const g of groups) {
    const base = { customer: g.customer, code: g.code, unit: g.unit, cut: round1(g.cut), out: round1(g.out), outOps: g.outOps };
    if (g.cutOps && !g.outOps) out.cutNoOut.push(base);
    else if (g.outOps && !g.cutOps) out.outNoCut.push(base);
    else if (Math.abs(g.cut - g.out) > tol * Math.max(1, g.outOps) + 1e-9) out.mismatch.push(base);
    else out.agree++;
  }
  return out;
}

/** One English message for the day, or '' when everything agrees. */
export function sheetFindingText(day, r, name = '') {
  const lines = [];
  for (const m of r.mismatch) lines.push(`- ${m.customer}, code ${m.code}: cut photos ${m.cut} ${m.unit}, sheet OUT ${m.out} ${m.unit}`);
  for (const m of r.cutNoOut) lines.push(`- Cut photo but no OUT scanned in the sheet: ${m.customer}, code ${m.code}, ${m.cut} ${m.unit}`);
  for (const m of r.outNoCut) lines.push(`- OUT in the sheet but no cut photo: ${m.customer}, code ${m.code}, ${m.out} ${m.unit}`);
  if (!lines.length) return '';
  const shown = lines.slice(0, 12);
  if (lines.length > 12) shown.push(`- and ${lines.length - 12} more`);
  return [`⚠️ Cut photos against the warehouse sheet — ${day}`, ...shown, ...(name ? [`— ${name}`] : [])].join('\n');
}

/** The number of differences in a result. */
export const differences = (r) => r.mismatch.length + r.cutNoOut.length + r.outNoCut.length;
