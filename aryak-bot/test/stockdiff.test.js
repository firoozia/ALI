import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildXlsx, crc32, readZip } from '../src/xlsx.js';
import { itemCodes, stockDiff, stockDiffFile, STATUS } from '../src/stockdiff.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';

// Invented items and quantities only.
test('the workbook: a valid zip of the XML parts, the header bold and frozen, text escaped, numbers as numbers, every part with a good checksum', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926); // the standard check value
  const buf = buildXlsx([{ name: 'Stock differences', widths: [10, 20], rows: [['Code', 'Name <&>'], ['505', 'PVC "film" & more'], [12.5, null]] }, { name: 'Summary', rows: [['Status', 'Items'], ['match', 3]] }]);
  assert.equal(buf.readUInt32LE(0), 0x04034b50); // a zip
  const parts = readZip(buf);
  assert.deepEqual([...parts.keys()], ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
  assert.match(parts.get('xl/workbook.xml'), /<sheet name="Stock differences" sheetId="1" r:id="rId1"\/><sheet name="Summary" sheetId="2" r:id="rId2"\/>/);
  const s1 = parts.get('xl/worksheets/sheet1.xml');
  assert.match(s1, /state="frozen"/); assert.match(s1, /<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Code<\/t><\/is><\/c>/); // the header is bold (style 1)
  assert.match(s1, /Name &lt;&amp;&gt;/); assert.match(s1, /PVC &quot;film&quot; &amp; more/);
  assert.match(s1, /<c r="A3"><v>12\.5<\/v><\/c>/); assert.ok(!s1.includes('r="B3"')); // a number; an empty cell is left out
  assert.match(s1, /<col min="2" max="2" width="20" customWidth="1"\/>/);
  assert.ok(buf.readUInt32LE(buf.length - 22) === 0x06054b50); // the end of the central directory
});

test('the codes of an item: its SKU without the prefix, then the number at the end of its name', () => {
  assert.deepEqual(itemCodes({ Sku: 'PVC-505', Name: 'PVC FILM505' }), ['505']);
  assert.deepEqual(itemCodes({ Sku: 'EDGE22-1801', Name: 'EDGE BAND 1801 X' }), ['1801']);
  assert.deepEqual(itemCodes({ Sku: '', Name: 'PVC FILM108' }), ['108']);
  assert.deepEqual(itemCodes({ Sku: 'H35', Name: 'Hinge 35' }), ['H35']);
});

const I = (Id, Name, Sku, qty, extra = {}) => ({ Id: String(Id), Name, Sku, Type: 'Inventory', Active: true, QtyOnHand: qty, ParentRef: { value: '90' }, ...extra });
const items = [
  { Id: '90', Name: 'PVC FILM', Type: 'Category' },
  I(1, 'PVC FILM101', 'PVC-101', 50), I(2, 'PVC FILM102', 'PVC-102', 10), I(3, 'PVC FILM103', 'PVC-103', 0), I(4, 'PVC FILM104', 'PVC-104', 7),
  I(5, 'PVC FILM105', 'PVC-105', 5), I(6, 'PVC FILM106', 'PVC-106', 8),
  { Id: '7', Name: 'Hinge 35', Sku: 'H35', Type: 'NonInventory', Active: true },
  I(8, 'PVC FILM108', 'PVC-108', 20, { TrackQtyOnHand: false }),
];
const sheet = {
  101: { found: true, free: 40, reserved: 10, unit: 'm' },        // 50 total: match
  102: { found: true, free: 100, reserved: 0, unit: 'm' },        // 100 against 10: differs by 90
  103: { found: true, free: 3, reserved: 0, unit: 'm' },          // 3 against 0
  105: { found: true, ambiguous: true, categories: ['PVC film', 'Edge'] },
  H35: { found: true, free: 12, reserved: 0, unit: 'pcs' },       // QuickBooks does not track it
  108: { found: true, free: 20, reserved: 0, unit: 'm' },         // QuickBooks does not track the quantity
};
const lookup = async (code) => { if (code === '106') throw new Error('sheet down'); return sheet[code] || { found: false, code }; };

test('the difference: ZINAX total (free + reserved) minus QuickBooks, a status for every item, the largest differences first; the sheet is only asked', async () => {
  const asked = [];
  const r = await stockDiff({ items, lookup: async (c) => { asked.push(c); return lookup(c); }, concurrency: 3 });
  const by = Object.fromEntries(r.rows.map((x) => [x.name, x]));
  assert.equal(r.rows.length, 8); // the Category row is a folder, not an item
  assert.deepEqual([by['PVC FILM101'].status, by['PVC FILM101'].zinax, by['PVC FILM101'].qbo, by['PVC FILM101'].diff], ['match', 50, 50, 0]);
  assert.deepEqual([by['PVC FILM102'].status, by['PVC FILM102'].diff, by['PVC FILM102'].unit, by['PVC FILM102'].category], ['differs', 90, 'm', 'PVC FILM']);
  assert.deepEqual([by['PVC FILM103'].status, by['PVC FILM103'].diff], ['differs', 3]);
  assert.equal(by['PVC FILM104'].status, 'only in QuickBooks'); assert.equal(by['PVC FILM104'].zinax, null);
  assert.equal(by['PVC FILM105'].status, 'ambiguous in ZINAX'); assert.equal(by['PVC FILM105'].note, 'PVC film, Edge');
  assert.equal(by['PVC FILM106'].status, 'could not read ZINAX');
  assert.deepEqual([by['Hinge 35'].status, by['Hinge 35'].zinax, by['Hinge 35'].unit, by['Hinge 35'].qbo], ['not tracked in QuickBooks', 12, 'pcs', null]);
  assert.equal(by['PVC FILM108'].status, 'not tracked in QuickBooks');
  assert.deepEqual(r.rows.slice(0, 2).map((x) => x.name), ['PVC FILM102', 'PVC FILM103']); // the largest absolute differences first
  assert.deepEqual(r.summary, { match: 1, differs: 2, 'only in QuickBooks': 1, 'not tracked in QuickBooks': 2, 'ambiguous in ZINAX': 1, 'could not read ZINAX': 1 });
  assert.ok(asked.every((c) => /^[A-Z0-9]+$/.test(c)) && asked.length >= 8);
});

test('the file: the differences sheet and the summary with the counts, the note about items only in ZINAX; nothing real in it', async () => {
  const r = await stockDiff({ items, lookup });
  const parts = readZip(stockDiffFile(r, { date: '2026-11-08' }));
  const s1 = parts.get('xl/worksheets/sheet1.xml'); const s2 = parts.get('xl/worksheets/sheet2.xml');
  assert.match(s1, /Difference \(ZINAX minus QuickBooks\)/); assert.match(s1, /QuickBooks QtyOnHand/);
  assert.ok(s1.indexOf('PVC FILM102') < s1.indexOf('PVC FILM103')); // largest first
  for (const status of STATUS) assert.ok(s2.includes(status), status);
  assert.match(s2, /only in ZINAX/); assert.match(s2, /ask for a list action/); assert.match(s2, /quantities were not changed/);
  assert.match(parts.get('xl/workbook.xml'), /name="Summary"/);
});

test('the words and the wiring: «stock diff» in both languages; the file goes back to the chat that asked; the sheet and QuickBooks quantities are never written', () => {
  assert.deepEqual(parseInvoiceCommand('stock diff'), { type: 'stock_diff' }); assert.deepEqual(parseInvoiceCommand('Stock Difference'), { type: 'stock_diff' }); assert.deepEqual(parseInvoiceCommand('اختلاف موجودی'), { type: 'stock_diff' });
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const at = index.indexOf('async function runStockDiff');
  const run = index.slice(at, at + 2400);
  assert.match(run, /await postFile\(chatId, file, `stock-diff-\$\{day\}\.xlsx`/); // the chat that asked
  assert.match(run, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.doesNotMatch(run, /qbo\.write|sock\.sendMessage\(config|botSync|action: 'sync'/); // read only: no write of any kind
  assert.match(index, /case 'stock_diff': \{[\s\S]*?stockDiffRunning = true;[\s\S]*?void runStockDiff\(here\.chatId \|\| ownIds\(\)\[0\]\);/);
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'stockdiff.js'), 'utf8');
  assert.doesNotMatch(src, /\.write\(|POST|action: 'sync'/); // the module only reads
});
