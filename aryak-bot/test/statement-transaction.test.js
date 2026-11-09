import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { parsePeriod, parseStatementRequest } from '../src/period.js';
import { buildStatementData, loadLogo, statementPdf, transactionPdf, wrapText } from '../src/qbostatement.js';
import { readImage, textWidth } from '../src/minipdf.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';

// Invented company, customer and invoices only.
const TODAY = '2026-11-09';
const range = (text) => { const p = parsePeriod(text, TODAY); return p && p.from ? `${p.from}..${p.to}` : null; };

test('dates: a month in any words is its first to its last day (the year is this one, last year when that month has not come); ranges are day first', () => {
  for (const t of ['month 10', 'October', 'oct', 'Oct 2026', '10/2026', '10-2026', 'ماه ۱۰ میلادی', 'ماه دهم', 'برج 10', 'اکتبر', 'اکتبر ۲۰۲۶']) assert.equal(range(t), '2026-10-01..2026-10-31', t);
  assert.equal(range('month 12'), '2025-12-01..2025-12-31'); // December has not come yet: last year
  assert.equal(range('month 12 2024'), '2024-12-01..2024-12-31');
  assert.equal(range('Feb 2024'), '2024-02-01..2024-02-29');
  for (const t of ['from 01/10/2026 to 15/10/2026', '01/10 to 15/10', '1-15 October', '1 - 15 october', 'from 1 oct to 15 oct', 'from 1 to 15 oct', 'از ۱ تا ۱۵ اکتبر', 'از ۱ اکتبر تا ۱۵ اکتبر', 'از ۰۱/۱۰/۲۰۲۶ تا ۱۵/۱۰/۲۰۲۶', 'from 2026-10-01 to 2026-10-15', 'from 01.10.2026 to 15.10.2026']) assert.equal(range(t), '2026-10-01..2026-10-15', t);
  assert.equal(range('from 20/12 to 05/01'), '2025-12-20..2026-01-05'); // across the new year
  assert.equal(range('from 05/12/2025 to 05/01/2026'), '2025-12-05..2026-01-05');
  assert.equal(range('1-15 Feb 2024'), '2024-02-01..2024-02-15');
  assert.equal(range('last month'), '2026-10-01..2026-10-31');
  assert.equal(range('this month'), '2026-11-01..2026-11-09'); // clipped at today
  assert.deepEqual(parsePeriod('ماه ۱۰ شمسی', TODAY).unsupported, 'solar');
  assert.equal(range('hello there'), null);
  assert.equal(range('from 31/02/2026 to 05/03/2026'), null); // a day that does not exist is not guessed
});

test('the request: customer, period and layout; «statement balance …» asks for the older layout, plain asks for the app layout', () => {
  const a = parseStatementRequest('Atossa statement golden door month 10', TODAY);
  assert.equal(a.customer, 'golden door'); assert.equal(a.period.from, '2026-10-01'); assert.equal(a.period.to, '2026-10-31'); assert.equal(a.style, '');
  const b = parseStatementRequest('Atossa statement balance golden door month 10', TODAY);
  assert.equal(b.customer, 'golden door'); assert.equal(b.style, 'balance'); assert.equal(b.period.to, '2026-10-31');
  const c = parseStatementRequest('Atossa statement golden door from 1 to 15 oct', TODAY);
  assert.equal(c.customer, 'golden door'); assert.deepEqual([c.period.from, c.period.to], ['2026-10-01', '2026-10-15']);
  assert.equal(parseInvoiceCommand('Atossa statement balance golden door month 10').style, 'balance');
});

const COMPANY = { CompanyName: 'The Sample Workshop For Doors And Kitchens Trading L.L.C', Country: 'AE', CompanyAddr: { Line1: '00000', City: 'Sharjah' }, Email: { Address: 'sample@example.test' }, WebAddr: { URI: 'www.sample.test' } };
const CUSTOMER = { DisplayName: 'A VERY LONG CUSTOMER NAME FOR DOORS AND KITCHENS WOODEN WORKS TRADING COMPANY L.L.C S.P.C', PrimaryPhone: { FreeFormNumber: '0500000000' }, BillAddr: { City: 'Sharjah', CountrySubDivisionCode: 'Sharjah' }, Balance: 5153.98 };
const inv = (n, date, total, balance) => ({ DocNumber: `inv-${n}`, TxnDate: date, TotalAmt: total, Balance: balance, CustomerRef: { value: '1' } });
const INV = [inv(9650, '2026-10-20', 800, 800), inv(9645, '2026-10-02', 1000.5, 0), inv(9646, '2026-10-02', 2000, 500.25), inv(9500, '2026-09-30', 700, 0), inv(9700, '2026-11-02', 300, 300)];
const strings = (pdf) => [...pdf.toString('latin1').matchAll(/\(((?:[^()\\]|\\.)*)\) Tj/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));

test('the app layout: one row per invoice of the period (date, then number), amount and received, the two totals, no payment rows and no running balance', () => {
  const d = buildStatementData({ company: COMPANY, customer: CUSTOMER, invoices: INV, today: TODAY, from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(d.txn.map((t) => [t.ref, t.amount, t.received]), [['inv-9645', 100050, 100050], ['inv-9646', 200000, 149975], ['inv-9650', 80000, 0]]);
  const text = strings(transactionPdf(d));
  for (const s of ['Statement', 'TO', 'DATE', 'DESCRIPTION', 'AMOUNT', 'RECEIVED', 'Invoice No.inv-9645', 'Invoice No.inv-9646', 'Invoice No.inv-9650', 'TOTAL AMOUNT', 'AED 3,800.50', 'TOTAL RECEIVED', 'AED 2,500.25', '0500000000', 'THE SAMPLE WORKSHOP FOR DOORS', 'WWW.SAMPLE.TEST', 'SAMPLE@EXAMPLE.TEST']) assert.ok(text.some((x) => x === s || x.startsWith(s)), s);
  assert.ok(text.indexOf('Invoice No.inv-9645') < text.indexOf('Invoice No.inv-9646') && text.indexOf('Invoice No.inv-9646') < text.indexOf('Invoice No.inv-9650'));
  assert.ok(!text.some((x) => /Balance brought forward|Payment|Credit memo|Over 90/.test(x))); assert.ok(!text.includes('Invoice No.inv-9500') && !text.includes('Invoice No.inv-9700'));
  assert.ok(!text.some((x) => /STATEMENT NO/i.test(x))); // QuickBooks numbers its own statements
  const old = strings(statementPdf(d, { style: 'balance' }));
  assert.ok(old.includes('Balance forward') && old.includes('BALANCE DUE'));
});

test('nothing overlaps: long names are wrapped by measured width; the title is below the company block; the customer block is above the period', () => {
  for (const [size, max, bold] of [[12, 270, true], [11, 280, true], [10, 280, false]]) {
    const lines = wrapText(CUSTOMER.DisplayName + ' ' + 'X'.repeat(80), size, max, bold);
    assert.ok(lines.length > 1); for (const l of lines) assert.ok(textWidth(l, size, bold) <= max + 0.01, l);
  }
  const d = buildStatementData({ company: { ...COMPANY, CompanyName: COMPANY.CompanyName + ' ' + COMPANY.CompanyName, CompanyAddr: { Line1: 'A LONG ADDRESS LINE '.repeat(5), City: 'Sharjah' } }, customer: CUSTOMER, invoices: INV, today: TODAY, from: '2026-10-01', to: '2026-10-31' });
  const raw = transactionPdf(d).toString('latin1');
  const ys = [...raw.matchAll(/([\d.]+) ([\d.]+) Td \(([^)]*)\) Tj/g)].map((m) => ({ y: 842 - +m[2], x: +m[1], s: m[3] }));
  const at = (s) => { const p = ys.find((q) => q.s === s); assert.ok(p, s); return p; };
  const title = at('Statement'); assert.ok(title.y > 140);
  const companyLines = ys.filter((p) => p.x < 100 && p.y < title.y - 5 && p.y > 40);
  assert.ok(companyLines.length >= 4); assert.ok(Math.max(...companyLines.map((p) => p.y)) < title.y - 20, 'the company block ends above the title');
  const toY = at('TO').y; const nameRows = ys.filter((p) => p.x < 100 && p.y > toY && p.y < at('DESCRIPTION').y - 10);
  assert.ok(nameRows.length >= 4, 'the long customer name and its details are on several lines');
  const ordered = nameRows.map((p) => p.y); assert.deepEqual(ordered, [...ordered].sort((a, b) => a - b)); assert.equal(new Set(ordered).size, ordered.length); // no two lines on one baseline
  for (let k = 1; k < ordered.length; k++) assert.ok(ordered[k] - ordered[k - 1] >= 11, 'lines are spaced');
  const right = ys.filter((p) => p.x > 380 && p.y > toY - 2 && p.y < at('DESCRIPTION').y - 10); assert.ok(right.length >= 2); // the date block sits on the right, not over the name
  assert.ok(at('DESCRIPTION').y > Math.max(...ordered) + 8, 'the table starts below the whole customer block');
});

test('pages: the header band repeats, the totals stay with the rows, and the page numbers are right', () => {
  const many = Array.from({ length: 120 }, (_, i) => inv(1000 + i, `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, 100 + i, i % 3 ? 0 : 100 + i));
  const d = buildStatementData({ company: COMPANY, customer: CUSTOMER, invoices: many, today: TODAY, from: '2026-10-01', to: '2026-10-31' });
  const pdf = transactionPdf(d).toString('latin1');
  const pages = (pdf.match(/\/Type \/Page /g) || []).length;
  assert.ok(pages >= 3);
  assert.equal((pdf.match(/\(DESCRIPTION\) Tj/g) || []).length, pages); // the band on every page
  assert.equal((pdf.match(/\(TOTAL AMOUNT\) Tj/g) || []).length, 1);
  assert.ok(pdf.includes(`(Page ${pages} of ${pages}) Tj`) && pdf.includes(`(Page 1 of ${pages}) Tj`));
  assert.equal((pdf.match(/\(Invoice No\.inv-/g) || []).length, 120); // every invoice once
  const empty = strings(transactionPdf(buildStatementData({ company: COMPANY, customer: CUSTOMER, invoices: [], today: TODAY, from: '2026-10-01', to: '2026-10-31' })));
  assert.ok(empty.includes('No invoice dated in this period.') && empty.includes('AED 0.00'));
});

// a PNG made here (RGBA, 2 x 1, filter 0 on every row); the checksums are not read by the reader
const png = (w, h, type, bytesPerPixel, fill) => {
  const raw = Buffer.alloc(h * (1 + w * bytesPerPixel)); for (let y = 0; y < h; y++) { raw[y * (1 + w * bytesPerPixel)] = 0; raw.fill(fill, y * (1 + w * bytesPerPixel) + 1, (y + 1) * (1 + w * bytesPerPixel)); }
  const chunk = (name, body) => { const b = Buffer.alloc(12 + body.length); b.writeUInt32BE(body.length, 0); b.write(name, 4, 'latin1'); body.copy(b, 8); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = type;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

test('the logo comes from a file on the server, never from the repository; no file or an unreadable one leaves the space empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-'));
  assert.equal(loadLogo(dir), null);
  fs.writeFileSync(path.join(dir, 'statement-logo.png'), Buffer.from('not a picture at all, just text bytes here'));
  assert.equal(loadLogo(dir), null);
  fs.writeFileSync(path.join(dir, 'statement-logo.png'), png(4, 3, 6, 4, 90));
  const logo = loadLogo(dir);
  assert.equal(logo.width, 4); assert.equal(logo.height, 3); assert.ok(logo.alpha); assert.equal(logo.space, 'DeviceRGB');
  assert.equal(readImage(png(2, 2, 2, 3, 10)).alpha, null); assert.equal(readImage(png(2, 2, 0, 1, 10)).space, 'DeviceGray');
  assert.equal(readImage(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 20, 0, 30, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0, 0, 0, 0, 0, 0])).width, 30);
  const d = buildStatementData({ company: COMPANY, customer: CUSTOMER, invoices: INV, today: TODAY, from: '2026-10-01', to: '2026-10-31' });
  const withLogo = transactionPdf(d, { logo }).toString('latin1');
  assert.ok(withLogo.includes('/Subtype /Image') && withLogo.includes('/SMask') && withLogo.includes('/Im0 Do'));
  assert.ok(withLogo.startsWith('%PDF-1.4') && withLogo.trimEnd().endsWith('%%EOF'));
  const startx = Number(/startxref\n(\d+)\n/.exec(withLogo)[1]); assert.ok(withLogo.slice(startx).startsWith('xref')); // the table of objects still points right
  assert.ok(!transactionPdf(d).toString('latin1').includes('/Subtype /Image'));
  const repo = path.join(import.meta.dirname, '..');
  const tracked = fs.readdirSync(path.join(repo, 'src')).concat(fs.readdirSync(path.join(repo, 'test')));
  assert.ok(!tracked.some((f) => /logo.*\.(png|jpe?g)$/i.test(f))); // no company branding in the public repository
});

test('the wiring: the default is the app layout, the style is passed on, the logo folder is the server folder, the period is echoed day first', () => {
  const desk = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'qbodesk.js'), 'utf8');
  assert.match(desk, /style: style \|\| 'transaction', logo: this\.config\?\.authDir \? loadLogo\(this\.config\.authDir\) : null/);
  assert.match(desk, /from \$\{dm\(period\.from\)\} to \$\{dm\(period\.to\)\}/);
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  for (const v of ['ic', 'nl', 'ask', 'octxAsk']) assert.ok(index.includes(`style: ${v}.style`), v);
});

test('both layouts are one look: the very same header (company, logo, title, TO, DATE, PERIOD) and band styling; only the columns and the totals differ', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo2-'));
  fs.writeFileSync(path.join(dir, 'statement-logo.png'), png(4, 3, 6, 4, 90));
  const logo = loadLogo(dir);
  const d = buildStatementData({ company: { ...COMPANY, CompanyName: COMPANY.CompanyName + ' ' + COMPANY.CompanyName }, customer: CUSTOMER, invoices: INV, payments: [{ TxnDate: '2026-10-25', TotalAmt: 100, UnappliedAmt: 0, PaymentRefNum: 'CHQ-9' }], today: TODAY, from: '2026-10-01', to: '2026-10-31' });
  const draw = (style) => statementPdf(d, { style, logo }).toString('latin1');
  const one = draw('balance'); const two = draw('transaction');
  const ops = (raw) => [...raw.matchAll(/(\S+ \S+ \S+ rg|\S+ g) BT \/(F\d) ([\d.]+) Tf ([\d.]+) ([\d.]+) Td \(([^)]*)\) Tj/g)].map((m) => ({ color: m[1], font: m[2], size: m[3], x: +m[4], y: 842 - +m[5], s: m[6] }));
  const bandY = (raw) => ops(raw).find((p) => ['DESCRIPTION'].includes(p.s)).y;
  assert.equal(bandY(one), bandY(two)); // the table starts at the same place
  const above = (raw) => ops(raw).filter((p) => p.y < bandY(raw) - 5).map((p) => `${p.s}|${p.x}|${p.y}|${p.size}|${p.font}|${p.color}`);
  assert.deepEqual(above(one), above(two)); // the header is identical, text by text, position by position
  assert.ok(above(one).some((x) => x.startsWith('Statement|')) && above(one).some((x) => x.startsWith('TO|')) && above(one).some((x) => x.startsWith('PERIOD|')));
  for (const raw of [one, two]) { assert.ok(raw.includes('/Im0 Do')); assert.ok(raw.includes('(Page 1 of 1) Tj')); }
  const band = (raw) => raw.match(/[\d.]+ [\d.]+ [\d.]+ rg [\d.]+ [\d.]+ [\d.]+ 20 re f/)[0].split(' ').slice(0, 3).join(' ');
  assert.equal(band(one), band(two)); // the same light-blue band
  const heads = (raw) => ops(raw).filter((p) => p.y === bandY(raw)).map((p) => p.s);
  assert.deepEqual(heads(one), ['DATE', 'DESCRIPTION', 'AMOUNT', 'BALANCE']); assert.deepEqual(heads(two), ['DATE', 'DESCRIPTION', 'AMOUNT', 'RECEIVED']);
  const text = strings(Buffer.from(one, 'latin1'));
  for (const s of ['Balance forward', 'Invoice No.inv-9645', 'Payment CHQ-9', 'BALANCE DUE']) assert.ok(text.some((x) => x.startsWith(s)), s);
  assert.ok(!text.some((x) => /Balance brought forward|Over 90|Balance due/.test(x))); // nothing of the old look is left
  assert.ok(!/\(STATEMENT\) Tj/.test(one)); // the black title of the old layout is gone
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'qbostatement.js'), 'utf8');
  assert.equal((src.match(/function drawStatement\(/g) || []).length, 1); assert.ok(!/function balancePdf/.test(src)); // one drawing function for both
});
