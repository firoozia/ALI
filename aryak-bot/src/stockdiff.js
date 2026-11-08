// The stock difference between QuickBooks and the ZINAX stock sheet. The sheet is the TRUE stock. READ ONLY on both sides: the sheet is only asked (the same
// per-code lookup the assistant uses for every stock question) and QuickBooks quantities are never changed. The result is a spreadsheet file for the owner to read.
// Matching is by code: the item's SKU without its prefix (PVC-505 -> 505, EDGE22-1801 -> 1801), else the number at the end of its name (PVC FILM505 -> 505); the sheet
// side also strips ARYAK's own AR/ART prefix, as for every lookup. A code the sheet has in several groups is reported as ambiguous, never guessed.
// The sheet has no «list everything» question, so an item that exists only in the sheet cannot be found from here (said in the summary).

import { buildXlsx } from './xlsx.js';

export const STATUS = ['match', 'differs', 'only in QuickBooks', 'not tracked in QuickBooks', 'ambiguous in ZINAX', 'could not read ZINAX'];

/** The codes to ask the sheet for one QuickBooks item, best first. */
export function itemCodes(item) {
  const out = [];
  const sku = String(item.Sku || '').trim().replace(/^(?:PVC|EDGE\d*)-/i, '');
  if (sku) out.push(sku);
  const tail = /(\d{3,5})\s*$/.exec(String(item.Name || ''));
  if (tail) out.push(tail[1]);
  return [...new Set(out)];
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * [items]: the QuickBooks items (Category rows are the folders: they name the category). [lookup](code) -> the sheet's answer ({ found, free, reserved, unit, ambiguous,
 * categories } or throws). Runs with [concurrency] lookups at a time. Returns { rows, summary }.
 */
export async function stockDiff({ items, lookup, concurrency = 3, onProgress = () => {} }) {
  const byId = new Map(items.map((i) => [String(i.Id), i]));
  const list = items.filter((i) => i.Type !== 'Category');
  const rows = new Array(list.length);
  let next = 0; let done = 0;
  const work = async () => {
    for (;;) {
      const at = next; next += 1;
      if (at >= list.length) return;
      const it = list[at];
      const tracked = it.Type === 'Inventory' && it.TrackQtyOnHand !== false;
      const row = { code: itemCodes(it)[0] || '', name: it.Name || '', sku: it.Sku || '', category: byId.get(String(it.ParentRef?.value || ''))?.Name || '', zinax: null, unit: '', qbo: tracked && it.QtyOnHand !== undefined ? round2(it.QtyOnHand) : null, diff: null, status: '' };
      let hit = null; let ambiguous = null; let failed = false;
      for (const code of itemCodes(it)) {
        try {
          const r = await lookup(code);
          if (r?.ambiguous) { ambiguous = r.categories || []; break; }
          if (r?.found) { hit = r; row.code = code; break; }
        } catch { failed = true; break; }
      }
      if (ambiguous) { row.status = 'ambiguous in ZINAX'; row.note = ambiguous.join(', '); }
      else if (failed) row.status = 'could not read ZINAX';
      else if (hit) {
        row.zinax = round2((Number(hit.free) || 0) + (Number(hit.reserved) || 0)); row.unit = String(hit.unit || '');
        if (row.qbo === null) row.status = 'not tracked in QuickBooks';
        else { row.diff = round2(row.zinax - row.qbo); row.status = Math.abs(row.diff) < 0.005 ? 'match' : 'differs'; }
      } else row.status = 'only in QuickBooks';
      rows[at] = row;
      done += 1; if (done % 25 === 0) onProgress(done, list.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, work));
  rows.sort((a, b) => (Math.abs(b.diff ?? -1) - Math.abs(a.diff ?? -1)) || String(a.name).localeCompare(String(b.name)));
  const summary = Object.fromEntries(STATUS.map((s) => [s, rows.filter((r) => r.status === s).length]));
  return { rows, summary };
}

/** The workbook: the differences sheet and a summary sheet with the counts per status. */
export function stockDiffFile({ rows, summary }, { date = '' } = {}) {
  const head = ['Code', 'QuickBooks item name', 'SKU', 'Category', 'ZINAX qty', 'Unit', 'QuickBooks QtyOnHand', 'Difference (ZINAX minus QuickBooks)', 'Status', 'Note'];
  const sheet1 = { name: 'Stock differences', widths: [12, 38, 16, 20, 12, 8, 20, 30, 26, 30], rows: [head, ...rows.map((r) => [r.code, r.name, r.sku, r.category, r.zinax, r.unit, r.qbo, r.diff, r.status, r.note || ''])] };
  const total = rows.length;
  const sheet2 = { name: 'Summary', widths: [34, 12], rows: [['Status', 'Items'], ...STATUS.map((s) => [s, summary[s] || 0]), ['Items compared', total],
    ['only in ZINAX', 'not available: the sheet cannot list its codes; ask for a list action to see them'], ['Date', date], ['Sheet', 'ZINAX is the true stock; read only'], ['QuickBooks', 'quantities were not changed']] };
  return buildXlsx([sheet1, sheet2]);
}
