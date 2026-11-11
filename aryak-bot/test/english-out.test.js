import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { englishOut, setOutLang, outLang, TRANSLATE_SYSTEM } from '../src/outlang.js';
import { formatStaffStock } from '../src/stock-format.js';
import { cutLine } from '../src/cuts.js';
import { heardText } from '../src/voicegate.js';
import { englishCommand, parseInvoiceCommand } from '../src/qboinvoice.js';
import { buildSystemPrompt } from '../src/prompt.js';
import { loadConfig } from '../src/config.js';

const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');

test('English output: a line the table knows needs no model; an unknown Persian line goes to the model once and is remembered; digits become Latin', async () => {
  let calls = 0; let asked = '';
  const model = async (chunk) => { calls += 1; asked = chunk; return chunk.split('\n').map((l) => `EN(${l})`).join('\n'); };
  assert.equal(await englishOut('plain English text', model), 'plain English text'); assert.equal(calls, 0);
  const known = await englishOut('درست: 12', model); assert.equal(calls, 0); assert.equal(known, 'Correct: 12');
  const out = await englishOut('Preview #Q8\nجمع کل: ۵۰۴٫۰۰ AED\nمشتری: ACME', model);
  assert.equal(calls, 1); assert.match(asked, /504\.00 AED/); assert.ok(!/[۰-۹]/.test(asked)); // Latin digits go to the model
  assert.ok(out.startsWith('Preview #Q8\nEN(')); assert.equal(out.split('\n').length, 3);
  await englishOut('Preview #Q8\nجمع کل: ۵۰۴٫۰۰ AED\nمشتری: ACME', model); assert.equal(calls, 1); // the same text again: from memory
});

test('English output: what the person said (after the Heard: label) is quoted, not translated; a failing or confused model leaves the text as it was', async () => {
  let calls = 0;
  const model = async (chunk) => { calls += 1; return chunk; };
  const heard = 'Heard: آتوسا موجودی ۱۰۹'; assert.equal(await englishOut(heard, model), heard); assert.equal(calls, 0);
  assert.equal(await englishOut('🤖 Heard: سلام', model), '🤖 Heard: سلام'); assert.equal(calls, 0);
  const text = 'سطر اول جدید\nسطر دوم جدید';
  assert.equal(await englishOut(text, async () => { throw new Error('down'); }), text); // the model failed: sent as written, never dropped
  assert.equal(await englishOut(text, async () => 'only one line'), text); // the lines do not match: not used
  assert.equal(outLang(), 'en'); assert.ok(/same number of lines/.test(TRANSLATE_SYSTEM) && /#Q8/.test(TRANSLATE_SYSTEM) && /AED/.test(TRANSLATE_SYSTEM));
});

test('the dates and the cut line are English: Cut: 12 m, 8 Nov, orders group', () => {
  const at = Date.parse('2026-11-08T05:00:00Z');
  assert.equal(cutLine({ qty: 12, unit: 'm', at }), 'Cut: 12 m, 8 Nov, orders group');
  assert.equal(cutLine({ qty: 2, unit: 'roll', at }, { label: 'Orders Pictures' }), 'Cut: 2 roll, 8 Nov, Orders Pictures');
  setOutLang('fa');
  try { assert.equal(cutLine({ qty: 12, unit: 'm', at }), 'برش: ۱۲ متر، ۱۷ آبان، گروه سفارش آریاک'); assert.equal(heardText('fa', 'x'), 'شنیدم: x'); } finally { setOutLang('en'); }
  assert.equal(heardText('fa', 'کد ۱۰۹'), 'Heard: کد ۱۰۹'); // English mode: whatever the language, the echo is the Heard: line
});

test('stock: the total stands alone on the first line in WhatsApp bold, then the details; one block per code', () => {
  const result = { ok: true, found: true, code: '109', category: 'PVC film', size: '', unit: 'm', free: 1104.9, reserved: 0, limit: 200, sizes: [{ size: '0.30*1400', free: 1104.9, packages: 14, open: 4, limit: 200, packs: [{ qty: 120, count: 9 }], pieces: [5, 5, 3.7, 11.2] }], locations: ['Warehouse 2: 5', 'Showroom: 1'] };
  const text = formatStaffStock(result, '109', '', 'en', null, { boldTotal: true });
  const lines = text.split('\n');
  assert.equal(lines[0], '*Code 109 — Total: 1,104.9 m*');
  assert.match(lines[1], /^Stock of code 109 \(PVC film\) is enough$/);
  assert.match(text, /- Free: 1104\.9 m/); assert.match(text, /- Reserved: 0 m/); assert.match(text, /- Minimum stock: 200 m/); assert.match(text, /- Location: Warehouse 2, Showroom/);
  const reserved = formatStaffStock({ ...result, reserved: 100, free: 1000, sizes: [{ size: 'x', free: 1000, reserved: 100, packages: 1, open: 0, limit: 0 }] }, '109', '', 'en', null, { boldTotal: true });
  assert.equal(reserved.split('\n')[0], '*Code 109 — Total: 1,100 m (free 1,000 m)*'); // total = free + reserved; the free part is named when something is reserved
  assert.ok(!formatStaffStock(result, '109', '', 'en').startsWith('*')); // without the option the older block is unchanged
  assert.equal(formatStaffStock({ ...result, found: false }, '109', '', 'en', null, { boldTotal: true }).startsWith('*'), false); // an answer with no stock has no big line
});

test('English commands are read as the Persian ones; the Persian ones keep working', () => {
  const cases = {
    'yes #Q8': { type: 'yes', id: 'Q8' }, 'no #Q8': { type: 'no', id: 'Q8' }, 'بله #Q8': { type: 'yes', id: 'Q8' }, 'yes all': { type: 'yes_all' },
    'stop quickbooks': { type: 'pause' }, 'continue quickbooks': { type: 'resume' }, 'توقف کوییک‌بوکس': { type: 'pause' }, permissions: { type: 'auth_list' }, مجوزها: { type: 'auth_list' },
    'grant statement 971528493119': { type: 'auth_add', number: '971528493119', perm: 'statement' }, 'grant invoice 971528493119': { type: 'auth_add', number: '971528493119', perm: 'invoice' },
    'revoke statement 971528493119': { type: 'auth_remove', number: '971528493119', perm: 'statement' }, 'revoke invoice 971528493119': { type: 'auth_remove', number: '971528493119', perm: 'invoice' },
    'cost today': { type: 'cost_report', range: 'today' }, 'cost week': { type: 'cost_report', range: 'week' },
    'customer 2': { type: 'adjust', what: 'customer', pick: 2, id: '' }, 'tax 2 #Q4': { type: 'adjust', what: 'tax', pick: 2, id: 'Q4' },
  };
  for (const [text, want] of Object.entries(cases)) assert.deepEqual(parseInvoiceCommand(text), want, text);
  assert.equal(englishCommand('hello there'), null); assert.equal(englishCommand('grant statement 12'), null);
});

test('the switch: REPLY_LANGUAGE=en by default; fa goes back; the customer rule and the wiring follow it', () => {
  const base = { ANTHROPIC_API_KEY: 'k' };
  assert.equal(loadConfig({ ...base }).config.replyLanguage, 'en');
  assert.equal(loadConfig({ ...base, REPLY_LANGUAGE: 'fa' }).config.replyLanguage, 'fa');
  assert.equal(loadConfig({ ...base, REPLY_LANGUAGE: 'EN' }).config.replyLanguage, 'en');
  assert.match(buildSystemPrompt(undefined, 'Atossa', 'en'), /Always reply in English, whatever language the customer wrote in/);
  assert.match(buildSystemPrompt(undefined, 'Atossa', 'fa'), /Reply in the language of the customer's message/);
  assert.match(src, /setOutLang\(config\.replyLanguage\)/);
  assert.match(src, /config\.replyLanguage === 'en'\) \{\s*try \{ const en = await englishOut\(a\[1\]\.text, englishViaModel\)/); // the one outgoing path
  assert.match(src, /const staffLang = config\.replyLanguage === 'en' \? 'en' :/);
  assert.match(src, /lang = config\.replyLanguage === 'en' \? 'en' : detectLang\(withText/); // customers too
});

test('a bare yes: any case, ok, Persian words; with a full code it always names the preview; the one-waiting rule and the several-waiting listing are in place for the self chat and the internal groups', () => {
  for (const said of ['yes', 'Yes', 'YES', 'ok', 'OK', 'okay', 'بله', 'اره', 'آره', 'اوکی']) assert.deepEqual(parseInvoiceCommand(said), { type: 'yes', id: '' }, said);
  for (const said of ['no', 'No', 'NO', 'نه', 'خیر']) assert.deepEqual(parseInvoiceCommand(said), { type: 'no', id: '' }, said);
  assert.deepEqual(parseInvoiceCommand('YES #Q12'), { type: 'yes', id: 'Q12' }); assert.deepEqual(parseInvoiceCommand('ok #S3'), { type: 'yes', id: 'S3' }); assert.deepEqual(parseInvoiceCommand('no #N1'), { type: 'no', id: 'N1' });
  assert.equal(parseInvoiceCommand('yes please'), null); // a sentence is not an answer
  const at = src.indexOf("case 'yes': case 'no': {");
  const block = src.slice(at, at + 3000);
  assert.match(block, /\.\.\.qboInvoices\.openIds\(\), \.\.\.qboNames\.openIds\(\), \.\.\.qboBulk\.openIds\(\), \.\.\.groupStatements\.openIds\(\)/); // previews of every kind
  assert.match(block, /if \(!open\.length\) return null;/); // none waiting: not ours
  assert.match(block, /previews are waiting: .*Nothing was done\. Reply with the full code, for example: /); // several: listed, nothing done
  assert.match(block, /'Approved' : 'Cancelled'\} #\$\{id\}\./); // the reply names which one
  const turn = src.slice(src.indexOf('async function groupStatementTurn'), src.indexOf('async function prepareGroupStatement'));
  assert.match(turn, /bareOk = dec && \(dec\.type === 'yes' \|\| dec\.type === 'no'\) && !dec\.id && !bareAnswerYieldsToPending\(/); // internal groups, owner only (inside if (owner)), unless a photo or voice question waits
  assert.ok(turn.indexOf('if (owner) {') < turn.indexOf('bareOk'));
  assert.match(turn, /voiceDesk\.get\(`s:\$\{chatId\}:\$\{person\}`\) \|\| followDesk\.get\(`s:\$\{chatId\}:\$\{person\}`\) \|\| voiceGate\.get\(`vg:\$\{chatId\}:\$\{person\}`\)/);
});
