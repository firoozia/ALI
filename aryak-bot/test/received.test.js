import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceivedQuery, receivedFrom, receivedSummary } from '../src/received.js';
import { parseGoodsCaption } from '../src/captions.js';
import { eventsFromCaption } from '../src/captionevents.js';
import { parsePaymentCaption } from '../src/captions.js';
import { Tracker } from '../src/tracker.js';
import { markSourcingReceived, sourcingEvent } from '../src/sourcing.js';
import { buildDigest } from '../src/digest.js';
import { toEnglish } from '../src/english.js';

const NOW = Date.parse('2026-11-05T08:00:00Z');

test('goods that arrived are read with spelling tolerance and kept as stock coming in', () => {
  const a = receivedFrom('JUWAT 10 GALLEN RECEIVED', { group: 'Accessories', at: NOW });
  assert.deepEqual([a.type, a.item, a.quantity, a.unit, a.group], ['received', 'JOWAT', 10, 'gallon', 'Accessories']);
  const b = receivedFrom('250 Bags Received', { at: NOW });
  assert.deepEqual([b.quantity, b.unit, b.supplier], [250, 'bag', '']);
  assert.equal(receivedFrom('Jowat 5 gallon received from Hamid Trading', { at: NOW }).supplier, 'Hamid Trading');
  assert.equal(receivedFrom('JOWAT GILLU 4 GALLEN for Bahar', { at: NOW }), null); // an order for a customer, not goods arriving
  assert.equal(eventsFromCaption('goods', 'JUWAT 10 GALLEN RECEIVED'), null); // the goods group's own path leaves it to received.js
});

test('a payment note with a customer and an amount is never goods received', () => {
  assert.equal(receivedFrom('Dandy 88 Received', { at: NOW }), null);
  assert.equal(parseGoodsCaption('Dandy 88 Received'), null);
  assert.equal(parsePaymentCaption('Dandy 88 Received').kind, 'cash');
});

test('a received item closes the open and the promised sourcing requests for its code', () => {
  const t = new Tracker();
  t.add({ ...sourcingEvent('Do you have 603 - 20 mtr?'), at: NOW, customer: 'Master Wood', group: 'g', ref: 's1' });
  t.add({ ...sourcingEvent('Do you have 408 - 5 mtr?'), at: NOW, customer: 'Bahar', group: 'g', ref: 's2', status: 'answered' });
  assert.equal(markSourcingReceived(t, '603'), 1);
  assert.equal(markSourcingReceived(t, '408'), 1);
  assert.deepEqual(t.events.map((e) => e.status), ['received', 'received']);
});

test('the owner can ask what came in; the answer is in his language and read only', () => {
  assert.deepEqual(parseReceivedQuery('what was received this week?'), { period: 'week' });
  assert.deepEqual(parseReceivedQuery('چه کالایی رسید؟'), { period: 'recent' });
  assert.deepEqual(parseReceivedQuery('چه کالایی امروز رسید'), { period: 'today' });
  assert.equal(parseReceivedQuery('is 408 available?'), null);
  const events = [receivedFrom('JUWAT 10 GALLEN RECEIVED', { group: 'A', at: NOW - 86400000 }), receivedFrom('JOWAT 5 gallon received from Hamid', { at: NOW }), receivedFrom('250 Bags Received', { at: NOW - 20 * 86400000 })];
  const en = receivedSummary(events, { period: 'week', now: NOW, timeZone: 'UTC', lang: 'en' });
  assert.match(en, /JOWAT: 15 gallon \(from Hamid\)/);
  assert.ok(!en.includes('Bags')); // 20 days ago: outside the week
  assert.match(receivedSummary(events, { period: 'month', now: NOW, timeZone: 'UTC', lang: 'en' }), /Bags|bag/i);
  assert.match(receivedSummary(events, { period: 'week', now: NOW, timeZone: 'UTC', lang: 'fa' }), /کالاهای دریافت‌شده/);
  assert.equal(receivedSummary([], { lang: 'en' }), 'No received goods are recorded for this period.');
});

test('the summary has one count line, no separate message', () => {
  const events = [receivedFrom('JUWAT 10 GALLEN RECEIVED', { at: NOW }), receivedFrom('250 Bags Received', { at: NOW })].map((e, i) => ({ ...e, ref: `r${i}` }));
  const text = toEnglish(buildDigest({ history: [], requests: [], day: '2026-11-05', timeZone: 'UTC', events }));
  assert.match(text, /Goods received entries: 2/);
});
