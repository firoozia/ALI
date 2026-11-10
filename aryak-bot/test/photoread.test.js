import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TEST_MODEL, USD_TO_AED, costOf, groupKeyOf, parseReading, photoMessage, summaryText } from '../src/photoread.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';

// Invented names and amounts only.
const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
const AT = Date.parse('2026-11-09T10:55:00Z'); // 14:55 in Dubai

test('the command: a group and a number of days, owner words in English and Persian; anything else is not it', () => {
  assert.deepEqual(parseInvoiceCommand('read photos confirmation 7'), { type: 'read_photos', group: 'confirmation', days: 7 });
  assert.deepEqual(parseInvoiceCommand('read photos expenses 3'), { type: 'read_photos', group: 'expenses', days: 3 });
  assert.deepEqual(parseInvoiceCommand('Read photo group confirmation 14'), { type: 'read_photos', group: 'confirmation', days: 14 });
  assert.deepEqual(parseInvoiceCommand('خواندن عکس‌ها گروه تأیید ۷'), { type: 'read_photos', group: 'confirmation', days: 7 });
  assert.deepEqual(parseInvoiceCommand('خواندن عکس ها گروه هزینه ۳'), { type: 'read_photos', group: 'expenses', days: 3 });
  for (const t of ['read photos confirmation', 'read photos confirmation 0', 'read photos confirmation 99', 'read photos invoices 7', 'read photos']) assert.notEqual(parseInvoiceCommand(t)?.type, 'read_photos', t);
  assert.deepEqual([groupKeyOf('confirmation'), groupKeyOf('expense'), groupKeyOf('تأیید'), groupKeyOf('هزینه‌ها'), groupKeyOf('x')], ['confirmation', 'expenses', 'confirmation', 'expenses', '']);
});

test('the message of one photo: where and when, the type, the amount and date on the paper, who, the text with it, the tokens and the cost', () => {
  const entry = { groupKey: 'confirmation', at: AT, sender: 'Manager', caption: '', replies: ['Awab'] };
  const reading = parseReading('```json\n{"type":"cheque","amount":2000,"currency":"AED","date":"2026-11-08","party":"AWAB WOOD — Mashreq — 001234"}\n```');
  assert.deepEqual(reading, { type: 'cheque', amount: 2000, currency: 'AED', date: '2026-11-08', party: 'AWAB WOOD — Mashreq — 001234' });
  assert.equal(photoMessage({ n: 3, total: 12, entry, reading, usage: { input: 1650, output: 120 } }), [
    '📷 Photo 3/12 — Confirmation group — 09/11 14:55 — from Manager', 'Type: cheque', 'Amount: *2,000.00 AED*   Date on paper: 08/11/2026', 'Payer / bank / cheque no.: AWAB WOOD — Mashreq — 001234', 'Caption/reply text: "Awab"', `Tokens: in 1,650 / out 120 — cost $${costOf(1650, 120).toFixed(4)}`,
  ].join('\n'));
  assert.equal(costOf(1650, 120), (1650 * 0.1 + 120 * 0.5) / 1e6); // the price table: $0.10 in, $0.50 out per million tokens (the earlier table was ten times too dear) assert.equal(TEST_MODEL, 'claude-haiku-5-5');
  // unreadable, no text, no date
  assert.equal(photoMessage({ n: 1, total: 1, entry: { groupKey: 'expenses', at: AT, caption: '', replies: [] }, reading: null, usage: { input: 900, output: 10 } }), ['📷 Photo 1/1 — Expenses group — 09/11 14:55', 'Type: not readable', 'Amount: not read', 'Caption/reply text: none', `Tokens: in 900 / out 10 — cost $${costOf(900, 10).toFixed(4)}`].join('\n'));
  assert.match(photoMessage({ n: 1, total: 1, entry: { groupKey: 'confirmation', at: AT, caption: '85.5', replies: [] }, reading: { type: 'not a receipt', amount: null, currency: '', date: '', party: '' }, usage: null }), /Amount: not read   Date on paper: none[\s\S]*Caption\/reply text: "85\.5"[\s\S]*Tokens: none/);
  assert.equal(parseReading('not json at all'), null); assert.equal(parseReading('{"type":"cash receipt","amount":-5}').amount, null);
});

test('the summary: photos read, unreadable, skipped with the reason, tokens, the cost in dollars and dirhams; the honest word about history', () => {
  const text = summaryText({ groupKey: 'confirmation', days: 7, kept: 12, read: 10, unreadable: 1, skipped: 1, reasons: ['media expired', 'media expired'], inTokens: 16500, outTokens: 1200, since: AT });
  assert.equal(text, [
    '*Photo reading test — Confirmation group, last 7 days* (claude-haiku-5-5 only)', 'Photos kept: 12', 'Read: 10', 'Unreadable: 1', 'Skipped (could not be downloaded): 1 — media expired',
    'Only photos posted since 09/11 14:55 are available: the bot keeps no message history, so older ones cannot be fetched.', 'Tokens: in 16,500 / out 1,200',
    `Cost: $${costOf(16500, 1200).toFixed(4)} (≈ ${(costOf(16500, 1200) * USD_TO_AED).toFixed(2)} AED at 1 USD = 3.6725 AED)`, 'Nothing was stored in the payments or recorded in QuickBooks; no setting was changed.',
  ].join('\n'));
  assert.match(summaryText({ groupKey: 'expenses', days: 1, kept: 0, read: 0, unreadable: 0, skipped: 0, inTokens: 0, outTokens: 0 }), /No photo has been kept yet: only photos posted from now on can be read/);
});

test('the wiring: owner only, this model only (no fallback), nothing stored or recorded, paced, the photos are kept from now on and a reply is kept with its photo', () => {
  const run = index.slice(index.indexOf('async function readPhotoTest'), index.indexOf('// ---------------------------------------------------------------------------------------------------------------- history backfill'));
  assert.match(run, /model: TEST_MODEL, max_tokens: 1024, system: PHOTO_RULES, thinking: \{ type: 'disabled' \}, output_config: \{ effort: 'low' \}/); assert.match(run, /max_tokens: 1024, system: PHOTO_RULES, thinking: \{ type: 'disabled' \}/); assert.doesNotMatch(run, /betas|fallbacks|visionRead|extractEvent/); // this model only
  assert.doesNotMatch(run, /tracker\.|qbo\.|paymentDups|expenseStore|config\.trackModel|trackModel\s*=/); // nothing stored or recorded, no setting changed
  assert.match(run, /await new Promise\(\(r\) => setTimeout\(r, 1500\)\)/); assert.match(run, /isPdf \? \{ document: buf, mimetype: 'application\/pdf'[^}]*caption: text \} : \{ image: buf, caption: text \}/); // one message per photo, the photo attached
  assert.match(run, /skipped \+= 1; reasons\.push\(/); assert.match(run, /finally \{ photoTestRunning = false; \}/);
  assert.match(index, /OWNER_CHAT_COMMANDS = new Set\(\['unbilled', 'payments', 'backfill', 'read_photos'/); // typed in a group: «use your own chat»
  assert.match(index, /case 'read_photos': \{\n\s+if \(photoTestRunning\)/);
  assert.match(index, /\(e\.replies \|\|= \[\]\)\.push\(text\.slice\(0, 200\)\)/); assert.match(index, /try \{ keepPhotoMessage\(raw, groupId, info\); \}/);
  assert.match(index, /new MediaKeep\(path\.join\(config\.authDir, 'photo-media'\)/); // on the server, never in the repository
});
