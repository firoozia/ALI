import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { PaymentDups, paymentsText, sharedPaymentList } from '../src/payments.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';

// Invented customers and amounts only.
const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
const part = (from, to) => index.slice(index.indexOf(from), index.indexOf(to));
const env = (extra) => ({ ANTHROPIC_API_KEY: 'k', SHEET_URL: 'u', ZINAX_BOT_TOKEN: 't', ...extra });
const pay = (at, extra) => ({ type: 'payment', kind: 'cash', currency: 'AED', at: Date.parse(at), ref: `p${at}${extra.amount}`, ...extra });

test('the monitor day: 01/11/2026 by default, a setting, and nothing before it in the payments, the shared list, the received report', () => {
  assert.equal(loadConfig(env({})).config.monitorFrom, '2026-11-01'); assert.equal(loadConfig(env({ MONITOR_FROM: '2026-12-01' })).config.monitorFrom, '2026-12-01');
  const events = [pay('2026-10-30T08:00:00Z', { customer: 'OLD CO', amount: 100 }), pay('2026-11-02T08:00:00Z', { customer: 'NEW CO', amount: 200 })];
  const since = Date.parse('2026-11-01T00:00:00+04:00');
  const NOW = Date.parse('2026-11-05T08:00:00Z');
  assert.match(paymentsText({ events, invoices: [], now: NOW, since }), /Payments to match \(1\):\n1\. 200\.00 AED — cash from NEW CO/); assert.ok(!paymentsText({ events, invoices: [], now: NOW, since }).includes('OLD CO'));
  assert.ok(paymentsText({ events, invoices: [], now: NOW }).includes('OLD CO')); // without a start day it is as before
  assert.deepEqual(sharedPaymentList({ events, since }).map((e) => e.customer), ['NEW CO']);
  assert.ok(sharedPaymentList({ events, dups: new PaymentDups('') }).length === 2);
  assert.match(index, /const clampRange = \(r\) => \(r\.from < config\.monitorFrom \? \{ \.\.\.r, from: config\.monitorFrom \} : r\);/);
  assert.match(index, /const r = clampRange\(rangeOf\(kind, todayDubai\(\)\)\);/); assert.match(index, /const r = clampRange\(rangeOf\('week', todayDubai\(\)\)\);/);
  assert.equal((index.match(/since: monitorStartMs\(\)/g) || []).length, 4); // «payments», the received report, the weekly check
  assert.match(index, /e\.at >= Math\.max\(Date\.now\(\) - days \* 86400000, monitorStartMs\(\)\)/); // the photo test too
  assert.match(fs.readFileSync(path.join(import.meta.dirname, '..', 'deploy', 'gcp-startup.sh'), 'utf8'), /MONITOR_FROM/);
});

test('the command: «backfill», «backfill 01/11», «پر کردن تاریخچه ۰۱/۱۱»', () => {
  assert.deepEqual(parseInvoiceCommand('backfill'), { type: 'backfill' }); assert.deepEqual(parseInvoiceCommand('Backfill 01/11'), { type: 'backfill', day: 1, month: 11 });
  assert.deepEqual(parseInvoiceCommand('backfill 5.11'), { type: 'backfill', day: 5, month: 11 }); assert.deepEqual(parseInvoiceCommand('پر کردن تاریخچه ۰۱/۱۱'), { type: 'backfill', day: 1, month: 11 });
  assert.notEqual(parseInvoiceCommand('backfill everything now')?.type, 'backfill');
});

test('the backfill: WhatsApp\'s on-demand history from the oldest message seen, again and again to the monitor day; each message read like a live one but silently; the counts are logged and told to the owner', () => {
  const b = part('// ---------------------------------------------------------------------------------------------------------------- history backfill', '// ---------------------------------------------------------------------------------------------------------------- company expenses');
  assert.match(b, /await sock\.fetchMessageHistory\(50, cur\.key, cur\.ts \* 1000\);/); // the oldest known key and time of the group
  assert.match(b, /for \(let round = 0; round < 80 && cur\.ts \* 1000 > floor; round\+\+\)/); // until the monitor day is reached
  assert.match(b, /if \(!older\.length\) break;/); assert.match(b, /counts\.silent\.push\(info\.subject\)/); // nothing came back: said, with the reason
  assert.match(b, /await replayCtx\.run\(\{ at: atMs, quiet: true \}, \(\) => trackGroup\(m, groupId, 'payment'\)\)/); // the payment parser, with the message's own time, silently
  assert.match(b, /keepPhotoMessage\(m, groupId, info, atMs\);/); assert.match(b, /fs\.writeFileSync\(photoFile\(m\.key\.id\), buf/); // the photos and PDFs are downloaded and kept
  assert.match(b, /for \(const m of g\.messages\) await processHistoryMessage/); // in time order (the list was sorted when it was collected)
  assert.match(b, /history: \$\{counts\.groups\} group\(s\), \$\{counts\.rounds\} request\(s\), \$\{counts\.fetched\} messages fetched, \$\{counts\.downloaded\} photos\/PDFs downloaded, \$\{counts\.unavailable\} expired or unavailable/);
  assert.doesNotMatch(b, /setInterval|backfillHistory\(\)/); // nothing starts by itself: only the owner's word
  assert.doesNotMatch(b, /sock\.sendMessage\(groupId|sayIn|postDocument|qbo\.(write|create|post)/); // never posts to a group, never records in QuickBooks
  assert.match(b, /Nothing was posted to any group and nothing was recorded in QuickBooks\./);
  assert.match(index, /sock\.ev\.on\('messaging-history\.set', \(h\) => \{ try \{ onHistorySet\(h\); \}/);
  assert.match(index, /noteSeen\(raw, groupId, groupKey\);/); // the anchor is every group's oldest message seen
  assert.match(index, /return downloadMediaMessage\(message, 'buffer', \{\}, \{ reuploadRequest: sock\.updateMediaMessage, logger \}\);/); // an expired copy: the phone is asked to upload it again
  assert.match(index, /const nowAt = \(\) => replayCtx\.getStore\(\)\?\.at \|\| Date\.now\(\);/);
  assert.match(index, /function tellPayment\(event\) \{\n  if \(replayCtx\.getStore\(\)\?\.quiet\) return;/); assert.ok(index.includes('&& !qbo.paused && !replayCtx.getStore()?.quiet) {')); // a message from the history is never announced
  assert.match(index, /case 'backfill': \{\n\s+if \(backfillRunning\)/); assert.match(index, /OWNER_CHAT_COMMANDS = new Set\(\['unbilled', 'payments', 'backfill'/);
  const tg = part('async function trackGroup', 'async function findGroupJid'); assert.ok(!/Date\.now\(\)/.test(tg), 'the tracker takes its time from nowAt()'); // every event of the tracker carries the message's time
});

test('two steps: «backfill» only counts and estimates; only the owner\'s yes downloads and reads; his no (or the cancel-all, or an hour) drops it', () => {
  const b = part('let pendingBackfill = null;', '// ---------------------------------------------------------------------------------------------------------------- company expenses');
  const step1 = b.slice(b.indexOf('async function collectHistory'), b.indexOf('/** Step 2'));
  assert.doesNotMatch(step1, /downloadMedia\(|extractEvent|visionRead|trackGroup|processHistoryMessage|keepPhotoMessage|photoFile\([^)]*\), buf/); // step 1: no download, no model, nothing kept
  assert.match(step1, /Nothing was downloaded, read or kept yet\. Reply yes #\$\{pendingBackfill\.id\} to go on, or no #\$\{pendingBackfill\.id\}\./);
  assert.match(step1, /Estimated cost: about \$\$\{est\.usd\.toFixed\(2\)\} \(≈ \$\{\(est\.usd \* 3\.6725\)\.toFixed\(2\)\} AED\)/); assert.match(step1, /Photos: \$\{est\.photos\}\. PDFs: \$\{est\.pdfs\}\./);
  assert.match(b, /const PHOTO_TOKENS = \{ input: 1700, output: 100 \};/); assert.match(b, /costOf\(media\.length \* PHOTO_TOKENS\.input, media\.length \* PHOTO_TOKENS\.output\)/); // Haiku prices; what is already downloaded is not counted
  assert.match(b, /!fs\.existsSync\(photoFile\(m\.key\.id\)\)/);
  const step2 = b.slice(b.indexOf('async function decideBackfill'), b.indexOf('async function runBackfill'));
  assert.match(step2, /if \(verb !== 'yes'\) return \['Cancelled\. Nothing was downloaded, read or kept\.'\];/); assert.ok(step2.indexOf("verb !== 'yes'") < step2.indexOf('runBackfill(p)')); // the yes comes before any work
  assert.match(step2, /Date\.now\(\) - p\.at > 60 \* 60 \* 1000/); // an hour
  assert.match(index, /id\.startsWith\('B'\) \? decideBackfill\(ic\.type, id\)/); assert.match(index, /\.\.\.\(pendingBackfill \? \[pendingBackfill\.id\] : \[\]\)\];/); // «yes #B1», and a bare yes counts it
  assert.match(index, /if \(pendingBackfill\) add\(pendingBackfill\.id, 'history backfill estimate', no\(pendingBackfill\.id\)\);/); // «no all» drops it too
  for (const [t, v, id] of [['yes #B1', 'yes', 'B1'], ['no #B2', 'no', 'B2'], ['yes B3', 'yes', 'B3']]) assert.deepEqual(parseInvoiceCommand(t), { type: v, id }, t);
});
