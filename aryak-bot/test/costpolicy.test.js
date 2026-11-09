import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isQuietSubject, mayReadMedia, mayTrackWithModel } from '../src/costpolicy.js';
import { eventsFromCaption } from '../src/captionevents.js';
import { UsageMeter, hasVisual } from '../src/usage.js';
import { buildDigest } from '../src/digest.js';

const config = { invoiceGroupName: 'invoices group', infoGroupName: 'information group', cutGroupName: 'aryak orders pictures', deliveryGroupName: 'aryak order delivery pics', confirmGroupName: 'confirmation group', trackModel: false };
const QUIET = ['Invoices group', 'Information group', 'Aryak Orders Pictures', 'Aryak Order Delivery Pics', 'Confirmation group'];

test('a photo or a voice note in a tracked internal group makes no paid call and no download, unless she is addressed', () => {
  for (const subject of QUIET) {
    const group = { quiet: isQuietSubject(subject, config) };
    assert.equal(group.quiet, true, subject);
    assert.equal(mayReadMedia({ group, addressed: false }), false, `${subject}: a photo or a voice note must be left alone`);
    assert.equal(mayReadMedia({ group, addressed: true }), true, `${subject}: addressed by name is the exception`);
  }
  // the test group, the command group, the staff group and private chats keep working
  for (const group of [{ test: true }, { command: true }, { quiet: false }, null]) assert.equal(mayReadMedia({ group, addressed: false }), true);
  assert.equal(isQuietSubject('Master Wood - ARYAK', config), false);
});

test('the tracker never sends a photo or an unreadable caption to the model unless TRACK_MODEL is on', () => {
  assert.equal(mayTrackWithModel(config), false);
  assert.equal(mayTrackWithModel({ ...config, trackModel: true }), true);
});

test('the free caption reader still records the captions of every tracked group', () => {
  assert.equal(eventsFromCaption('cut', 'ART NO 410 DANDY DOOR 6M').events[0].customer, 'DANDY DOOR');
  assert.equal(eventsFromCaption('delivery', 'PVC WORKS (COD 908.25)').events[0].cod, 908.25);
  assert.equal(eventsFromCaption('payment', 'Dandy 1500 received').events[0].amount, 1500);
  assert.equal(eventsFromCaption('goods', 'HINGES TYPE A 20 BOX FOR SHJ CUSTOMER').events[0].quantity, 20);
});

test('the source: media is left alone before any download, the model fallback is gated, no reply is posted, the earlier picture is found for "the picture above"', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const quiet = src.indexOf('mayReadMedia({ group, addressed, voiceFromPermitted');
  assert.ok(quiet > 0);
  assert.match(src.slice(quiet, quiet + 420), /media left alone[^\n]*\n\s*return true;|media left alone[^\n]*return true;/); // consumed, no reply
  // the gate comes before every place the picture or the voice note is downloaded in the staff flow
  const firstDownload = src.indexOf("downloadMediaMessage(imageRaw, 'buffer'");
  const firstAudioDownload = src.indexOf("understandAudio(() => downloadMediaMessage(audioRaw, 'buffer', {})");
  assert.ok(quiet < firstDownload && quiet < firstAudioDownload);
  // the tracker: the model fallback (and the photo download) come after the free reader and the TRACK_MODEL gate
  const tg = src.slice(src.indexOf('async function trackGroup'), src.indexOf('async function findGroupJid'));
  assert.ok(tg.indexOf('mayTrackWithModel(config)') > 0 && tg.indexOf('mayTrackWithModel(config)') < tg.indexOf('downloadMediaMessage') && tg.indexOf('mayTrackWithModel(config)') < tg.indexOf('extractEvent('));
  assert.match(src, /Please send the photo again with my name in the caption\./);
  assert.match(src, /trackRole !== 'cut' \|\| config\.cutTracking/); // CUT_TRACKING=off stops the cut reading
});

test('the paid calls are counted per group and kind, logged, and one line goes into the summary with a rough cost', () => {
  const day = '2026-11-05';
  const m = new UsageMeter('', { timeZone: 'UTC', now: () => Date.parse(`${day}T10:00:00Z`), cost: { model: 0.01, vision: 0.012, speech: 0.016 } });
  m.count('Aryak Orders Pictures', 'model'); m.count('Aryak Orders Pictures', 'vision'); m.count('Aryak Orders Pictures', 'notRead', 5);
  m.count('Master Wood', 'model', 3); m.count('Master Wood', 'speech');
  assert.deepEqual(m.logLines(day).sort(), [
    'paid calls 2026-11-05 "Aryak Orders Pictures": model 1, vision 1, speech 0, captions not read 5',
    'paid calls 2026-11-05 "Master Wood": model 3, vision 0, speech 1, captions not read 0',
  ]);
  assert.equal(m.line(day), '- Paid calls today: model 4, vision 1, speech 1; about USD 0.07 (estimate); captions not read: 5');
  assert.equal(new UsageMeter('', { now: () => 0 }).line(), '');
  assert.equal(hasVisual({ messages: [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: 'x' }] }] }), true);
  assert.equal(hasVisual({ messages: [{ role: 'user', content: 'hello' }] }), false);
  const text = buildDigest({ history: [], requests: [], day, timeZone: 'UTC', events: [], extraLines: [m.line(day)] });
  assert.match(text, /Paid calls today: model 4, vision 1, speech 1/);
});

test('a quiet group: the voice of the owner or of a permitted person is heard (cheap); a photo and anyone else\'s voice stay unread', () => {
  const group = { quiet: true };
  assert.equal(mayReadMedia({ group, addressed: false, voiceFromPermitted: true }), true);
  assert.equal(mayReadMedia({ group, addressed: false, voiceFromPermitted: false }), false);
  assert.equal(mayReadMedia({ group, addressed: false }), false);
  const fs2 = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(fs2, /voiceFromPermitted: !!audio && !image && \(ownerPerson \|\| authorizedPerson \|\| invoicePerson\)/); // a photo is never let in by this
  assert.match(fs2, /staffLang, !!group\?\.quiet && !explicit\)/); // only the name is looked for first
});
