import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { CostMeter, PRICES, familyOf } from '../src/cost.js';
import { visionRead, invoiceChecks, setVisionMeter } from '../src/vision.js';
import { understandImages } from '../src/image.js';
import { checkInvoice, readInvoice, extractMeta } from '../src/invoice.js';
import { pdfTextLayer, documentBlock, setDocMeter, parseCMap } from '../src/pdftext.js';
import { MiniPdf } from '../src/minipdf.js';
import { voiceChangesSomething, planVoice, heardText, VoiceGate } from '../src/voicegate.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';

const text = (t) => ({ content: [{ type: 'text', text: t }], usage: { input_tokens: 1000, output_tokens: 200 } });
const meter = (extra = {}) => new CostMeter('', { now: () => Date.parse('2026-11-08T08:00:00Z'), ...extra });
const png = { base64: Buffer.from('not really a picture').toString('base64'), mimeType: 'image/png' };

// ------------------------------------------------------------------------------------------------ cost
test('cost: tokens priced per model, cache read and write, the family of a name, a price table the environment can edit', () => {
  const m = meter();
  assert.equal(familyOf('claude-haiku-5-5'), 'haiku'); assert.equal(familyOf('claude-opus-5-5'), 'opus'); assert.equal(familyOf('whatever'), 'other');
  assert.ok(Math.abs(m.usdOf('claude-haiku-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 }) - (PRICES['claude-haiku-5-5'][0] + PRICES['claude-haiku-5-5'][1])) < 1e-9);
  assert.ok(Math.abs(m.usdOf('claude-sonnet-5-5', { cache_read_input_tokens: 1_000_000 }) - PRICES['claude-sonnet-5-5'][0] * 0.1) < 1e-9);
  assert.ok(Math.abs(m.usdOf('claude-sonnet-5-5', { cache_creation_input_tokens: 1_000_000 }) - PRICES['claude-sonnet-5-5'][0] * 1.25) < 1e-9);
  const edited = meter({ prices: { 'claude-haiku-5-5': [2, 10] } });
  assert.ok(Math.abs(edited.usdOf('claude-haiku-5-5', { input_tokens: 1_000_000 }) - 2) < 1e-9);
  assert.ok(Math.abs(m.usdOf('some-new-sonnet-9', { input_tokens: 1_000_000 }) - PRICES['claude-sonnet-5-5'][0]) < 1e-9); // an unknown name of a known family
  assert.equal(m.usdOf('x', undefined), 0);
});

test('cost: the daily line in Persian digits, voice minutes at the per-minute price, PDFs free and by vision, the owner\'s report', () => {
  const lines = [];
  const m = meter({ log: (l) => lines.push(l), speechPerMinute: 0.02 });
  assert.equal(m.line(), ''); // nothing yet: no line
  for (let i = 0; i < 10; i += 1) { m.photo({}); m.model('claude-haiku-5-5', { input_tokens: 2000, output_tokens: 300 }); }
  for (const r of ['unreadable', 'unknown-code']) { m.photo({ escalated: true, reason: r }); m.model('claude-sonnet-5-5', { input_tokens: 2000, output_tokens: 300 }); }
  for (let i = 0; i < 4; i += 1) m.voice(60);
  for (let i = 0; i < 3; i += 1) m.voice(0);
  for (let i = 0; i < 4; i += 1) m.pdf(true); m.pdf(false);
  m.model('claude-opus-5-5', { input_tokens: 10000, output_tokens: 1000 });
  const line = m.line();
  assert.match(line, /عکس: ۱۰ \(خواندن دوباره با سونِت ۲\)/); // ten photos, two of them read again
  assert.match(line, /ویس: ۷ \(۴ دقیقه\)/);
  assert.match(line, /پی‌دی‌اف: ۵ \(۴ رایگان\)/);
  assert.match(line, /هزینه: ۰٫[۰-۹]{2} دلار/);
  const t = m.totals();
  const expected = 10 * m.usdOf('claude-haiku-5-5', { input_tokens: 2000, output_tokens: 300 }) + 2 * m.usdOf('claude-sonnet-5-5', { input_tokens: 2000, output_tokens: 300 }) + m.usdOf('claude-opus-5-5', { input_tokens: 10000, output_tokens: 1000 }) + (4 * 0.02);
  assert.ok(Math.abs(t.usd - expected) < 1e-9);
  const rep = m.report('today');
  assert.match(rep, /هزینهٔ امروز/); assert.match(rep, /ناخوانا ۱/); assert.match(rep, /کد ناشناس ۱/); assert.match(rep, /اوپوس/);
  assert.match(m.report('week'), /هفت روز/);
  assert.equal(meter().report('today').includes('هنوز تماس پولی نبوده'), true);
  // one log line per call, never a message text
  assert.ok(lines.length >= 30 && lines.every((l) => l.startsWith('cost: ')));
});

test('cost: the days are kept on disk and a week sums the last seven', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-'));
  const clock = { t: Date.parse('2026-11-08T08:00:00Z') };
  const a = new CostMeter(dir, { now: () => clock.t });
  a.model('claude-haiku-5-5', { input_tokens: 1_000_000 }); a.save();
  clock.t += 2 * 86400000;
  a.model('claude-haiku-5-5', { input_tokens: 1_000_000 }); a.save();
  const b = new CostMeter(dir, { now: () => clock.t });
  assert.ok(Math.abs(b.totals().usd - 1) < 1e-9);
  assert.ok(Math.abs(b.range(7).usd - 2) < 1e-9);
  assert.match(parseInvoiceCommand('هزینهٔ امروز').type, /cost_report/);
  assert.deepEqual(parseInvoiceCommand('هزینهٔ هفته'), { type: 'cost_report', range: 'week' });
});

// ------------------------------------------------------------------------------------------------ the two-step reading
test('visionRead: a passing first answer is final; the strong model reads again only after a failed fact, with the reason counted', async () => {
  const m = meter();
  const models = [];
  const mk = (answers) => ({ config: { visionModel: 'claude-haiku-5-5', visionEscalateModel: 'claude-sonnet-5-5' }, cost: m, call: async (model) => { models.push(model); return answers[models.length - 1] ?? answers.at(-1); }, parse: (r) => r });
  // 1. the first passes: one call
  let r = await visionRead({ ...mk([{ n: 1 }]), check: () => ({ ok: true }) });
  assert.deepEqual([models, r.escalated, r.model], [['claude-haiku-5-5'], false, 'claude-haiku-5-5']);
  // 2. the first fails a fact, the second passes: the second is used
  models.length = 0;
  r = await visionRead({ ...mk([{ n: 1 }, { n: 2 }]), check: (v) => (v.n === 2 ? { ok: true } : { ok: false, reason: 'unclear' }) });
  assert.deepEqual([models, r.value.n, r.escalated, r.reason], [['claude-haiku-5-5', 'claude-sonnet-5-5'], 2, true, 'unclear']);
  // 3. both fail: the later answer comes back (today's behaviour goes on with it)
  models.length = 0;
  r = await visionRead({ ...mk([{ n: 1 }, { n: 3 }]), check: () => ({ ok: false, reason: 'unreadable' }) });
  assert.deepEqual([models.length, r.value.n, r.checked.ok], [2, 3, false]);
  // 4. the strong call throws: the first answer is kept
  models.length = 0;
  r = await visionRead({ config: { visionModel: 'a', visionEscalateModel: 'b' }, cost: m, call: async (model) => { if (model === 'b') throw new Error('overloaded'); return { n: 1 }; }, parse: (x) => x, check: () => ({ ok: false, reason: 'unclear' }) });
  assert.equal(r.value.n, 1);
  // 5. an unparseable first answer is a failed check
  r = await visionRead({ config: { visionModel: 'a', visionEscalateModel: 'b' }, cost: m, call: async (model) => model, parse: (x) => (x === 'b' ? { ok: 1 } : null), check: () => ({ ok: true }) });
  assert.equal(r.escalated, true);
  // 6. no strong model configured: no second read
  models.length = 0;
  r = await visionRead({ ...mk([{ n: 1 }]), config: { visionModel: 'claude-haiku-5-5', visionEscalateModel: 'claude-haiku-5-5' }, check: () => ({ ok: false, reason: 'unclear' }) });
  assert.equal(models.length, 1);
  const t = m.totals().photo;
  assert.equal(t.sonnet, 3); assert.deepEqual(t.reasons, { unclear: 1, unreadable: 1, parse: 1 });
});

test('photos: the cheap model alone when the reading is clean; the strong one for unreadable, unclear codes or a code the sheet does not know', async () => {
  const m = meter(); setVisionMeter(m);
  const cfg = { visionModel: 'claude-haiku-5-5', visionEscalateModel: 'claude-sonnet-5-5', model: 'claude-opus-5-5' };
  const good = JSON.stringify({ readable: true, intent: 'stock', language: 'fa', items: [{ code: '408', quantity: null, unit: '' }], unclear: 0 });
  const run = async (answers, knownCode) => {
    const models = [];
    const client = { beta: { messages: { create: async (p) => { models.push(p.model); return text(answers[models.length - 1] ?? answers.at(-1)); } } } };
    const u = await understandImages({ images: [png], config: cfg, client, knownCode });
    return { u, models };
  };
  let r = await run([good], async () => true);
  assert.deepEqual([r.u.ok, r.models], [true, ['claude-haiku-5-5']]);
  r = await run([JSON.stringify({ readable: false, intent: 'other', items: [], unclear: 0 }), good], async () => true);
  assert.deepEqual([r.models, r.u.ok], [['claude-haiku-5-5', 'claude-sonnet-5-5'], true]);
  r = await run([JSON.stringify({ readable: true, intent: 'stock', items: [{ code: '408' }], unclear: 2 }), good], async () => true);
  assert.equal(r.models.length, 2);
  const unknown = JSON.stringify({ readable: true, intent: 'stock', items: [{ code: '999999' }], unclear: 0 });
  r = await run([unknown, good], async (c) => c === '408');
  assert.deepEqual([r.models.length, r.u.items[0].code], [2, '408']);
  r = await run([unknown, unknown], async () => false); // both fail: today's behaviour with the later answer
  assert.deepEqual([r.models.length, r.u.ok], [2, true]);
  // a clean "not an order" picture needs no second look
  r = await run([JSON.stringify({ readable: true, intent: 'other', items: [], unclear: 0 })], async () => false);
  assert.deepEqual([r.models.length, r.u.reason], [1, 'other']);
  // without a catalogue check the unknown code is not a reason
  r = await run([unknown]);
  assert.equal(r.models.length, 1);
  const p = m.totals().photo;
  assert.ok(p.haiku >= 7 && p.sonnet >= 4);
  setVisionMeter(null);
});

// ------------------------------------------------------------------------------------------------ invoices
const goodInv = () => ({ number: 'INV-1', date: '2026-11-08', customer: 'ACME LLC', currency: 'AED', prices_include_vat: false, lines: [{ code: '108', quantity: 10, unit_price: 12, line_total: 120 }, { code: '109', quantity: 5, unit_price: 6, line_total: 30 }], subtotal: 150, vat: 7.5, total: 157.5 });

test('invoice facts: required fields and the arithmetic within the tolerance', () => {
  assert.equal(invoiceChecks(goodInv()).ok, true);
  assert.deepEqual(invoiceChecks({ ...goodInv(), number: '' }), { ok: false, reason: 'missing', detail: 'number' });
  assert.equal(invoiceChecks({ ...goodInv(), date: '' }).reason, 'missing');
  assert.equal(invoiceChecks({ ...goodInv(), total: null }).reason, 'missing');
  assert.equal(invoiceChecks({ ...goodInv(), customer: ' ' }).reason, 'missing');
  assert.equal(invoiceChecks({ ...goodInv(), subtotal: 160 }).reason, 'totals'); // lines add to 150
  assert.equal(invoiceChecks({ ...goodInv(), total: 170 }).reason, 'totals'); // subtotal + vat is 157.5
  assert.equal(invoiceChecks({ ...goodInv(), total: 157.52 }).ok, true); // inside the tolerance
  assert.equal(invoiceChecks(null).ok, false);
});

test('invoice reading: the cheap model first; the strong one only for a missing field or sums that do not add up', async () => {
  const verdict = (inv) => JSON.stringify({ verdict: 'match', request_customer: 'ACME', invoice_customer: 'ACME LLC', invoice_number: 'INV-1', invoice: inv, problems: [] });
  const calls = [];
  const clientOf = (answers) => ({ beta: { messages: { create: async (p) => { calls.push(p.model); return text(answers[calls.length - 1] ?? answers.at(-1)); } } } });
  const cfg = { visionModel: 'claude-haiku-5-5', visionEscalateModel: 'claude-sonnet-5-5', model: 'claude-opus-5-5', moneyTolerance: 0.05 };
  const doc = (n) => ({ base64: Buffer.from(`%PDF-1.4 scanned ${n}`).toString('base64'), mimeType: 'application/pdf', fileName: 'a.pdf' });
  let v = await checkInvoice({ client: clientOf([verdict(goodInv())]), config: cfg, request: doc(1), invoice: doc(2) });
  assert.deepEqual([calls, v.verdict], [['claude-haiku-5-5'], 'match']);
  calls.length = 0;
  v = await checkInvoice({ client: clientOf([verdict({ ...goodInv(), total: 999 }), verdict(goodInv())]), config: cfg, request: doc(1), invoice: doc(2) });
  assert.deepEqual([calls, v.invoice.total], [['claude-haiku-5-5', 'claude-sonnet-5-5'], 157.5]);
  calls.length = 0;
  v = await checkInvoice({ client: clientOf([JSON.stringify({ verdict: 'unreadable', problems: [] }), verdict(goodInv())]), config: cfg, request: doc(1), invoice: doc(2) });
  assert.deepEqual([calls.length, v.verdict], [2, 'match']);
  calls.length = 0;
  const one = await readInvoice({ client: clientOf([JSON.stringify({ invoice_number: 'x', invoice: { ...goodInv(), date: '' } }), JSON.stringify({ invoice_number: 'x', invoice: goodInv() })]), config: cfg, invoice: doc(3) });
  assert.deepEqual([calls.length, one.invoice.date], [2, '2026-11-08']);
  calls.length = 0;
  const meta = await extractMeta({ client: clientOf([JSON.stringify({ customer: '', po_number: '' }), JSON.stringify({ customer: 'ACME', po_number: 'LPO 615' })]), config: cfg, doc: doc(4) });
  assert.deepEqual([calls.length, meta], [2, { customer: 'ACME', po: '615' }]);
});

// ------------------------------------------------------------------------------------------------ PDFs
const textPdf = () => { const p = new MiniPdf(); p.addPage().text(50, 100, 'TAX INVOICE No. 8996 for ACME LLC', { size: 12 }).text(50, 120, 'PVC FILM108   10 m   AED 120.00', { size: 10 }).text(50, 140, 'Total 126.00 including VAT 6.00 thank you very much', { size: 10 }); return Buffer.from(p.build()); };

test('pdf: the text layer is read without any model; a scan has none', () => {
  const t = pdfTextLayer(textPdf());
  assert.equal(t.ok, true);
  assert.match(t.text, /TAX INVOICE No\. 8996/); assert.match(t.text, /PVC FILM108/);
  assert.equal(pdfTextLayer(Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n')).ok, false);
  assert.equal(pdfTextLayer(Buffer.from('not a pdf')).ok, false);
  assert.equal(pdfTextLayer(Buffer.alloc(0)).ok, false);
});

test('pdf: a compressed stream, a ToUnicode font and an object stream are read too', () => {
  const hex = (str) => `<${[...str].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('')}>`;
  const content = `/F1 12 Tf BT 50 700 Td ${hex('Hello ARYAK')} Tj 0 -20 Td ${hex('Total 126.00 AED for the invoice number one')} Tj ET`;
  const cmap = '/CIDInit begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0000> <FFFF> <0000> endbfrange endcmap';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  ];
  const flate = zlib.deflateSync(Buffer.from(content, 'latin1'));
  const toUni = zlib.deflateSync(Buffer.from(cmap, 'latin1'));
  let pdf = Buffer.from('%PDF-1.5\n', 'latin1');
  const add = (s) => { pdf = Buffer.concat([pdf, Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1')]); };
  objs.forEach((o, i) => add(`${i + 1} 0 obj\n${o}\nendobj\n`));
  add(`4 0 obj\n<< /Length ${flate.length} /Filter /FlateDecode >>\nstream\n`); add(flate); add('\nendstream\nendobj\n');
  add('5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /X /ToUnicode 6 0 R >>\nendobj\n');
  add(`6 0 obj\n<< /Length ${toUni.length} /Filter /FlateDecode >>\nstream\n`); add(toUni); add('\nendstream\nendobj\n');
  const t = pdfTextLayer(pdf);
  assert.equal(t.ok, true);
  assert.match(t.text, /Hello ARYAK/);
  assert.match(t.text, /Total 126\.00 AED/);
  assert.equal(parseCMap('beginbfchar <0001> <0041> endbfchar').map.get(1), 'A');
  // an object stream holding the page tree
  const o1 = '<< /Type /Catalog /Pages 2 0 R >>'; const o2 = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'; const o3 = '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << >> >>';
  const inner = `1 0 2 ${o1.length} 3 ${o1.length + o2.length} `;
  const innerObjs = o1 + o2 + o3;
  const stm = zlib.deflateSync(Buffer.from(inner + innerObjs, 'latin1'));
  let p2 = Buffer.from('%PDF-1.5\n', 'latin1');
  const add2 = (s) => { p2 = Buffer.concat([p2, Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1')]); };
  add2(`7 0 obj\n<< /Type /ObjStm /N 3 /First ${inner.length} /Length ${stm.length} /Filter /FlateDecode >>\nstream\n`); add2(stm); add2('\nendstream\nendobj\n');
  const plain = zlib.deflateSync(Buffer.from('BT 50 700 Td (Hello from an object stream with plenty of letters) Tj ET', 'latin1'));
  add2(`4 0 obj\n<< /Length ${plain.length} /Filter /FlateDecode >>\nstream\n`); add2(plain); add2('\nendstream\nendobj\n');
  const t2 = pdfTextLayer(p2);
  assert.match(t2.text, /Hello from an object stream/);
});

test('pdf: a text-layer PDF becomes a TEXT block and is counted free; a scan stays a document and counts as vision; each file once', () => {
  const m = meter(); setDocMeter(m);
  const base64 = textPdf().toString('base64');
  const b = documentBlock({ base64, mimeType: 'application/pdf', fileName: 'inv.pdf' });
  assert.equal(b.type, 'text'); assert.match(b.text, /TAX INVOICE No\. 8996/);
  documentBlock({ base64, mimeType: 'application/pdf' }); // the same file again
  const scan = documentBlock({ base64: Buffer.from('%PDF-1.4 only a picture inside').toString('base64'), mimeType: 'application/pdf' });
  assert.equal(scan.type, 'document');
  assert.equal(documentBlock({ base64: png.base64, mimeType: 'image/png' }).type, 'image');
  assert.deepEqual(m.totals().pdf, { free: 1, vision: 1 });
  setDocMeter(null);
});

test('pdf: checking an invoice from text-layer PDFs sends no document and no image to the model', async () => {
  const sent = [];
  const client = { beta: { messages: { create: async (p) => { sent.push(JSON.stringify(p.messages)); return text(JSON.stringify({ verdict: 'match', request_customer: 'A', invoice_customer: 'A', invoice_number: 'INV-1', invoice: goodInv(), problems: [] })); } } } };
  const doc = { base64: textPdf().toString('base64'), mimeType: 'application/pdf', fileName: 'x.pdf' };
  const v = await checkInvoice({ client, config: { visionModel: 'claude-haiku-5-5', visionEscalateModel: 'claude-sonnet-5-5' }, request: doc, invoice: doc });
  assert.equal(v.verdict, 'match');
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0], /"type":"document"/); assert.doesNotMatch(sent[0], /"type":"image"/);
  assert.match(sent[0], /TAX INVOICE No\. 8996/);
});

// ------------------------------------------------------------------------------------------------ voice
test('voice: what changes something waits for a yes; a plain question runs at once; reading commands are plain', () => {
  const changing = ['فاکتور بساز برای آریاک', 'بله', 'نه', 'بله #M1', 'ایمیل مشتری‌ها', 'قیمت سری ۱۰۰ = ۱۳', 'قیمت 108 = 12', 'مالیات کالاها دبی', 'شروع کن', 'فاکتور را برای مشتری بفرست', 'یاد بگیر که آریاک و آریاک ترید یکی هستند', 'تحویل نشود تا تأیید نقدی آریاک', 'کد مالیات آریاک = دبی', 'توقف کوییک‌بوکس', 'دسته و کد کالاها'];
  for (const t of changing) assert.equal(voiceChangesSomething(t), true, t);
  const plain = ['موجودی کد 408 چقدره', 'گزارش کوییک‌بوکس', 'کدهای مالیات', 'هزینهٔ امروز', 'سفارش‌های باز', 'آتوسا سلام', ''];
  for (const t of plain) assert.equal(voiceChangesSomething(t), false, t);
});

test('voice: the echo in the speaker\'s language, the plan per case, and the pending yes that expires', () => {
  assert.equal(heardText('fa', ' موجودی ۴۰۸ '), 'شنیدم: موجودی ۴۰۸');
  assert.equal(heardText('ar', 'x'), 'سمعت: x'); assert.equal(heardText('en', 'x'), 'Heard: x');
  let p = planVoice({ transcript: 'موجودی کد 408', lang: 'fa', priv: true });
  assert.deepEqual([p.mode, p.echo, p.prompt], ['run', 'شنیدم: موجودی کد 408', '']);
  p = planVoice({ transcript: 'فاکتور بساز', lang: 'fa', priv: true });
  assert.equal(p.mode, 'ask'); assert.match(p.prompt, /بله/);
  assert.equal(planVoice({ transcript: 'موجودی کد 408', lang: 'fa', priv: false }).mode, 'old'); // a group chat note not for her: as before
  assert.equal(planVoice({ transcript: 'موجودی کد 408', lang: 'fa', priv: false, named: true }).mode, 'run');
  assert.equal(planVoice({ transcript: 'موجودی کد 408', lang: 'fa', priv: true, unclear: true }).mode, 'ask'); // an unsure transcript is never acted on alone
  assert.equal(planVoice({ transcript: '', lang: 'fa', priv: true }).mode, 'old');
  const clock = { t: 0 };
  const g = new VoiceGate({ ttlMs: 1000, now: () => clock.t });
  g.set('k', 'فاکتور بساز');
  assert.equal(g.get('k').text, 'فاکتور بساز');
  clock.t = 1500;
  assert.equal(g.get('k'), null);
  g.set('k', 'x'); g.clear('k'); assert.equal(g.get('k'), null);
});

// ------------------------------------------------------------------------------------------------ the live fixes
import { codeKnownInItems, itemCodeKeys } from '../src/qboinvoice.js';
import { bareAnswerYieldsToPending, gatePrompt } from '../src/voicegate.js';
import { fmtUsd } from '../src/cost.js';
import { BulkPreviews, QboBulkDesk } from '../src/qbobulk.js';

test('known codes: the current item names, SKUs and full names (PVC-108, EDGE22-1810, "... - 1810"); a code that fits several items is known; a category and an inactive item are not', () => {
  const I = (Id, Name, extra = {}) => ({ Id: String(Id), Name, Type: 'Inventory', Active: true, ...extra });
  const items = [
    I(1, 'PVC FILM108', { Sku: 'PVC-108', FullyQualifiedName: 'PVC FILM:PVC FILM108' }), I(2, 'PVC FILM205', { Sku: 'PVC-205' }), I(3, 'PVC 1810', { Sku: 'PVC-1810' }),
    I(4, 'EDGE BAND 0.8x22 - 1810', { Sku: 'EDGE22-1810' }), I(5, 'EDGE BAND 0.8x50 - 1810', { Sku: 'EDGE50-1810' }), I(6, 'Hinge KG10-300', { Sku: 'KG10-300' }),
    I(7, 'PVC FILM300', { Active: false }), I(8, 'PVC FILM', { Type: 'Category' }),
  ];
  for (const c of ['108', '205', '1810', 'PVC-108', 'pvc-1810', 'EDGE22-1810', 'EDGE50-1810', 'KG10-300', 'PVC FILM108', 'PVC FILM:PVC FILM108']) assert.equal(codeKnownInItems(items, c), true, c);
  for (const c of ['999999', '300', 'PVC FILM', '10', '']) assert.equal(codeKnownInItems(items, c), false, c);
  assert.ok(itemCodeKeys(items[3]).has('1810'));
});

test('the unknown-code check names the code that failed', async () => {
  const logs = [];
  const client = { beta: { messages: { create: async () => text(JSON.stringify({ readable: true, intent: 'stock', language: 'fa', items: [{ code: '999999' }], unclear: 0 })) } } };
  await understandImages({ images: [png], config: { visionModel: 'a', visionEscalateModel: 'b' }, client, knownCode: async () => false, log: (l) => logs.push(l) });
  assert.ok(logs.some((l) => /unknown-code: 999999/.test(l)), logs.join(' | '));
});

test('a bare yes or no goes to the question asked last in the chat; with none it may look at the open previews', () => {
  assert.equal(bareAnswerYieldsToPending({ type: 'no', id: '' }, true), true);
  assert.equal(bareAnswerYieldsToPending({ type: 'yes', id: '' }, true), true);
  assert.equal(bareAnswerYieldsToPending({ type: 'yes', id: '' }, false), false);
  assert.equal(bareAnswerYieldsToPending({ type: 'yes', id: 'P1' }, true), false); // an id is always for the preview
  assert.equal(bareAnswerYieldsToPending({ type: 'request' }, true), false);
  assert.equal(bareAnswerYieldsToPending(null, true), false);
});

test('a preview that ran or was stopped is no longer open', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-'));
  const store = new BulkPreviews(dir);
  const bulk = new QboBulkDesk({ qbo: {}, desk: {}, audit: { add() {} }, store, draft: {}, itemCodes: null, config: {}, now: () => 1000 });
  const a = store.add('P', { at: 1000, status: 'pending', changes: [], skipped: [], unchanged: 0, params: {} });
  const b = store.add('C', { at: 1000, status: 'pending', changes: [], skipped: [], unchanged: 0, params: {} });
  const c = store.add('E', { at: 1000, status: 'pending', changes: [], skipped: [], unchanged: 0, params: {} });
  assert.deepEqual(bulk.openIds(), [a.id, b.id, c.id]);
  b.result = { changed: 3 }; b.ran = true; // run, then stopped by the kill switch: it can still be run by its id, but it is not "open"
  a.result = { changed: 10 }; // a stored one from before the flag: the result says it ran
  assert.deepEqual(bulk.openIds(), [c.id]);
});

test('cost: a photo is counted once and its second reads apart; small amounts keep four decimals; the main chat model always has its line', () => {
  assert.equal(fmtUsd(0.0013), '۰٫۰۰۱۳'); assert.equal(fmtUsd(0.0038), '۰٫۰۰۳۸'); assert.equal(fmtUsd(0.42), '۰٫۴۲'); assert.equal(fmtUsd(0), '۰٫۰۰'); assert.equal(fmtUsd(12.345), '۱۲٫۳۵');
  const m = meter();
  m.photo({}); m.photo({ escalated: true, reason: 'unknown-code' });
  m.model('claude-haiku-5-5', { input_tokens: 1000, output_tokens: 100 }); m.model('claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100 });
  const line = m.line();
  assert.match(line, /عکس: ۱ \(خواندن دوباره با سونِت ۱\)/);
  const rep = m.report('today');
  assert.match(rep, /گفت‌وگوی اصلی و کارهای اوپوس: بدون تماس/); // no chat call yet: the line still shows
  assert.match(rep, /هایکو: ۱ تماس.*۰٫۰[۰-۹]{3} دلار/); // under a cent: four decimals
  m.model('claude-opus-5-5', { input_tokens: 5000, output_tokens: 500 });
  assert.match(m.report('today'), /گفت‌وگوی اصلی و کارهای اوپوس: ۱ تماس/);
});

test('voice: Persian, Arabic and Urdu transcripts are echoed in their language; a plain question runs, a change waits for the yes in that language', () => {
  const cases = [
    ['fa', 'موجودی کد ۴۰۸ چقدر است', /^شنیدم: /, /بله/],
    ['ar', 'كم المخزون من الكود 408', /^سمعت: /, /نعم/],
    ['ur', 'کوڈ 408 کا اسٹاک کتنا ہے', /^میں نے سنا: /, /ہاں/],
  ];
  const change = 'فاکتور بساز برای آریاک';
  for (const [lang, plain, echo, yes] of cases) {
    let p = planVoice({ transcript: plain, lang, priv: true });
    assert.equal(p.mode, 'run', lang); assert.match(p.echo, echo); assert.equal(p.prompt, '');
    assert.ok(p.echo.endsWith(plain), lang);
    p = planVoice({ transcript: change, lang, priv: true });
    assert.equal(p.mode, 'ask', lang); assert.match(p.echo, echo); assert.match(p.prompt, yes); assert.ok(p.echo.endsWith(change));
    assert.match(gatePrompt(lang), yes);
  }
  assert.match(heardText('hi', 'x'), /^मैंने सुना: /);
  assert.equal(planVoice({ transcript: 'كم المخزون من الكود 408', lang: 'ar', priv: false }).mode, 'old'); // a group note not for her
  assert.equal(planVoice({ transcript: 'كم المخزون من الكود 408', lang: 'ar', priv: false, explicit: true }).mode, 'run');
});

// ------------------------------------------------------------------------------------------------ forwarded photos, prefixes, rotated chips, captions
import { deliver, captionCustomerName } from '../src/photoflow.js';
import { stripPrefixes } from '../src/image.js';
import { looksLikeCorrection } from '../src/voicegate.js';
import { setOutLang } from '../src/outlang.js';
setOutLang('fa'); // these tests read the Persian sentences; the English output is tested in english-out.test.js

const reading = (o) => text(JSON.stringify({ readable: true, intent: 'order', language: 'en', items: [], unclear: 0, ...o }));
const forwardedPhoto = { key: { remoteJid: '97150@s.whatsapp.net', fromMe: true, id: 'FWD1' }, message: { imageMessage: { mimetype: 'image/jpeg', caption: 'Nuqoosh', contextInfo: { isForwarded: true, forwardingScore: 1 } } } };

test('a reply to a forwarded photo is delivered: quoted first, plain when the quote does not go through, and the log tells the truth', async () => {
  const logs = [];
  // 1. the quoted send works
  let calls = [];
  let r = await deliver({ send: async (...a) => { calls.push(a); return { key: { id: 'OK1' } }; }, chatId: forwardedPhoto.key.remoteJid, content: { text: 'q' }, quoted: forwardedPhoto, where: 'private', log: (l) => logs.push(l) });
  assert.deepEqual([r.ok, calls.length, r.quotedFailed], [true, 1, false]);
  assert.deepEqual(calls[0][2], { quoted: forwardedPhoto });
  // 2. the quoted send throws (a forwarded picture as the quote): the plain one is sent and arrives
  calls = [];
  r = await deliver({ send: async (...a) => { calls.push(a); if (a[2]?.quoted) throw new Error('cannot quote this message'); return { key: { id: 'OK2' } }; }, chatId: 'c', content: { text: 'q' }, quoted: forwardedPhoto, where: 'private', log: (l) => logs.push(l) });
  assert.deepEqual([r.ok, calls.length, r.quotedFailed, r.result.key.id], [true, 2, true, 'OK2']);
  assert.equal(calls[1][2], undefined);
  // 3. the quoted send returns nothing (no error): the plain one follows
  calls = [];
  r = await deliver({ send: async (...a) => { calls.push(a); return a[2]?.quoted ? undefined : { key: { id: 'OK3' } }; }, chatId: 'c', content: { text: 'q' }, quoted: forwardedPhoto, where: 'private', log: (l) => logs.push(l) });
  assert.deepEqual([r.ok, calls.length], [true, 2]);
  // 4. nothing goes out: not ok, and the log says NOT delivered (never "told")
  logs.length = 0;
  r = await deliver({ send: async () => undefined, chatId: 'c', content: { text: 'q' }, quoted: forwardedPhoto, where: 'private', log: (l) => logs.push(l) });
  assert.equal(r.ok, false); assert.ok(logs.some((l) => /NOT delivered/.test(l)));
  // 5. both fail by error: it throws
  await assert.rejects(() => deliver({ send: async () => { throw new Error('closed'); }, chatId: 'c', content: { text: 'q' }, quoted: forwardedPhoto, where: 'private' }), /closed/);
});

test('customer prefixes: AR508 is code 508, ART108 is code 108, a real SKU keeps its letters, an unknown whole code with an unknown number stays unknown', async () => {
  const known = async (c) => ['508', '105', '108', 'EDGE22-1810', 'PVC-108', 'KG10-300'].includes(c);
  const s = await stripPrefixes([{ code: 'AR508', quantity: 50, unit: 'm' }, { code: 'ART 108' }, { code: 'AR-105' }, { code: 'EDGE22-1810' }, { code: 'KG10-300' }, { code: 'XY999' }], known);
  assert.deepEqual(s.items.map((i) => i.code), ['508', '108', '105', 'EDGE22-1810', 'KG10-300', 'XY999']);
  assert.deepEqual(s.notes.map((n) => [n.from, n.to]), [['AR508', '508'], ['ART 108', '108'], ['AR-105', '105']]);
  assert.equal(s.unknown, 'XY999');
  assert.equal((await stripPrefixes([{ code: 'PVC-108' }], known)).notes.length, 0); // known as it is: not touched
  const models = [];
  const client = { beta: { messages: { create: async (p) => { models.push(p.model); return reading({ items: [{ code: 'AR508', quantity: 50, unit: 'm' }] }); } } } };
  const u = await understandImages({ images: [png], caption: 'Nuqoosh', config: { visionModel: 'haiku-x', visionEscalateModel: 'sonnet-x' }, client, knownCode: known });
  assert.deepEqual(models, ['haiku-x']); // not an unknown code: the strong model is not paid for
  assert.equal(u.ok, true);
  assert.equal(u.items[0].code, '508');
  assert.match(u.requestText, /508/); assert.doesNotMatch(u.requestText, /AR508/);
  assert.match(u.confirmText, /«AR508» را کد 508 خواندم|AR508.*508/);
  const art = await understandImages({ images: [png], config: { visionModel: 'h', visionEscalateModel: 's' }, client: { beta: { messages: { create: async () => reading({ items: [{ code: 'ART108' }] }) } } }, knownCode: known, forceLang: 'en' });
  assert.deepEqual([art.items[0].code, /I read "ART108" as code 108/.test(art.confirmText)], ['108', true]);
});

test('a rotated chip: unclear first, the same model once more with the picture turned 90 and 270; the strong model only if that fails too', async () => {
  const turned = [];
  const turn = async (b64, deg) => { turned.push(deg); return { base64: Buffer.from(`${deg}`).toString('base64'), mimeType: 'image/jpeg' }; };
  const calls = [];
  const mk = (answers) => ({ beta: { messages: { create: async (p) => { calls.push({ model: p.model, images: p.messages[0].content.filter((b) => b.type === 'image').length, note: JSON.stringify(p.messages[0].content).includes('turned by 90') }); return answers[calls.length - 1] ?? answers.at(-1); } } } });
  const cfg = { visionModel: 'haiku-x', visionEscalateModel: 'sonnet-x' };
  const unclear = reading({ intent: 'other', items: [], unclear: 1 });
  const found = reading({ intent: 'stock', items: [{ code: '109' }] });
  // the turned picture is enough
  let u = await understandImages({ images: [png], config: cfg, client: mk([unclear, found]), knownCode: async () => true, turnImage: turn });
  assert.equal(u.ok, true); assert.equal(u.items[0].code, '109');
  assert.deepEqual(calls.map((c) => [c.model, c.images, c.note]), [['haiku-x', 1, false], ['haiku-x', 3, true]]); // the same model, three pictures: as sent, +90, +270
  assert.deepEqual(turned, [90, 270]);
  // not enough: the strong model, with the turned pictures too
  calls.length = 0; turned.length = 0;
  u = await understandImages({ images: [png], config: cfg, client: mk([unclear, unclear, found]), knownCode: async () => true, turnImage: turn });
  assert.equal(u.ok, true);
  assert.deepEqual(calls.map((c) => [c.model, c.images]), [['haiku-x', 1], ['haiku-x', 3], ['sonnet-x', 3]]);
  // without an image library the step is skipped and the strong model reads at once
  calls.length = 0;
  u = await understandImages({ images: [png], config: cfg, client: mk([unclear, found]), knownCode: async () => true, turnImage: async () => null });
  assert.deepEqual(calls.map((c) => c.model), ['haiku-x', 'sonnet-x']);
  // a clean first read is never read again
  calls.length = 0;
  u = await understandImages({ images: [png], config: cfg, client: mk([found]), knownCode: async () => true, turnImage: turn });
  assert.equal(calls.length, 1);
  // the rules tell the reader about rotated codes and colour samples
  const { IMAGE_RULES } = await import('../src/image.js');
  assert.match(IMAGE_RULES, /ROTATED/); assert.match(IMAGE_RULES, /colour or decor sample/);
});

test('the real image library turns a picture when it is installed', async () => {
  const { rotateImage } = await import('../src/image.js');
  let sharp; try { sharp = (await import('sharp')).default; } catch { return; }
  const png1 = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#a0522d' } }).png().toBuffer();
  const r = await rotateImage(png1.toString('base64'), 90);
  const meta = await sharp(Buffer.from(r.base64, 'base64')).metadata();
  assert.deepEqual([meta.width, meta.height, r.mimeType], [20, 40, 'image/jpeg']);
});

test('a caption that is a customer name gives the customer; a sentence or a code does not', async () => {
  const rows = { Nuqoosh: { customer: 'NUQOOSH IND LLC' } };
  const look = { canon: (t) => (rows[t] ? rows[t].customer : t), rowOfName: (t) => Object.values(rows).find((r) => r.customer === t) || rows[t] || null, resolveLoose: async (t) => (t === 'Hakim' ? { id: '7', name: 'HAKIM CARPENTRY' } : { ours: t }) };
  assert.equal(await captionCustomerName('Nuqoosh', look), 'NUQOOSH IND LLC');
  assert.equal(await captionCustomerName('Hakim', look), 'HAKIM CARPENTRY'); // QuickBooks, short name
  assert.equal(await captionCustomerName('please check 108', look), ''); // digits: not a name
  assert.equal(await captionCustomerName('what is the stock of this one please', look), ''); // a sentence
  assert.equal(await captionCustomerName('', look), '');
  assert.equal(await captionCustomerName('Unknown Co', { ...look, resolveLoose: async () => { throw new Error('offline'); } }), ''); // never throws
});

test('a correction typed after the photo question: "508 = 50m" goes to that question, not to another flow; yes and no are not corrections', () => {
  for (const t of ['508 = 50m', '508=50', 'AR508 = 50 m', 'ART 108: 20 rolls', '108 30', '508 = 50m' + String.fromCharCode(10) + '105 = 20m']) assert.equal(looksLikeCorrection(t), true, t);
  for (const t of ['بله', 'نه', 'yes', 'no', 'send the invoice please', 'قیمت 108 = 12', 'کد 108 = x', '']) assert.equal(looksLikeCorrection(t), false, t);
});

test('the customer-group list names itself in a refusal, so the owner knows which flow answered', async () => {
  const src = fs.readFileSync(new URL('../src/customergroups.js', import.meta.url), 'utf8');
  assert.match(src, /فهرست مشتری‌ها و گروه‌ها: ردیف/);
});
