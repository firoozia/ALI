import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MorningStore, localParts, matchGroups, morningDue, morningLang, morningText, parseMorningCommand, runMorning, weekdayNumbers } from '../src/morning.js';

const phrases = JSON.parse(fs.readFileSync(new URL('../data/morning-phrases.json', import.meta.url), 'utf8'));
const TZ = 'Asia/Dubai'; // UTC+4
// 2026-11-05 is a Thursday; 04:30 UTC is 08:30 in Dubai
const at = (iso) => Date.parse(iso);
const OFF = weekdayNumbers(['friday']);
const WEEKEND = weekdayNumbers(['thursday']);
const due = (iso, extra = {}) => morningDue({ now: at(iso), timeZone: TZ, time: '08:30', catchUpUntil: '10:00', offDays: OFF, weekendWishDays: WEEKEND, ...extra });

const groups = [
  { id: 'g1@g.us', subject: 'Master Wood - ARYAK' },
  { id: 'g2@g.us', subject: 'Family Chat' },
  { id: 'g3@g.us', subject: 'مجموعة الأمل' },
  { id: 'g4@g.us', subject: 'Dandy Door - ARYAK' },
];

test('the time is Dubai time: Thursday has the weekend variant, Friday sends nothing', () => {
  assert.deepEqual(localParts(at('2026-11-05T04:30:00Z'), TZ), { day: '2026-11-05', weekday: 4, minutes: 510 });
  const thu = due('2026-11-05T04:30:00Z');
  assert.deepEqual([thu.day, thu.weekend], ['2026-11-05', true]);
  const wed = due('2026-11-04T04:30:00Z');
  assert.deepEqual([wed.day, wed.weekend], ['2026-11-04', false]);
  assert.equal(due('2026-11-06T04:30:00Z'), null); // Friday
  assert.equal(due('2026-11-05T04:29:00Z'), null); // before 08:30
  assert.deepEqual(weekdayNumbers(['Friday', 'SATURDAY', 'nonsense']), [5, 6]);
});

test('catch-up: late start still sends until 10:00, then the day is skipped', () => {
  assert.ok(due('2026-11-05T05:59:00Z')); // 09:59
  assert.equal(due('2026-11-05T06:00:00Z'), null); // 10:00
});

test('an empty list sends nothing; a group outside the list is never sent', async () => {
  const sentTo = [];
  const base = { day: '2026-11-04', weekend: false, groups, phrases, name: 'Atossa', store: new MorningStore(), send: async (id) => { sentTo.push(id); return true; }, sleep: async () => {}, cap: 50 };
  assert.deepEqual(matchGroups(groups, []), []);
  const none = await runMorning({ ...base, words: [] });
  assert.equal(none.sent, 0);
  assert.deepEqual(sentTo, []);
  const some = await runMorning({ ...base, words: ['aryak'] });
  assert.equal(some.sent, 2);
  assert.deepEqual(sentTo, ['g1@g.us', 'g4@g.us']); // "Family Chat" and the Arabic group are not in the list
});

test('no double send after a restart: the store is on disk and remembers the day and the group', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-'));
  const sentTo = [];
  const args = (store) => ({ day: '2026-11-04', weekend: false, groups, words: ['aryak'], phrases, name: 'Atossa', store, send: async (id) => { sentTo.push(id); return true; }, sleep: async () => {}, cap: 50 });
  await runMorning(args(new MorningStore(dir)));
  assert.equal(sentTo.length, 2);
  const again = await runMorning(args(new MorningStore(dir))); // a new process reads the same files
  assert.equal(again.sent, 0);
  assert.equal(sentTo.length, 2);
  assert.equal(new MorningStore(dir).completed, '2026-11-04');
  await runMorning({ ...args(new MorningStore(dir)), day: '2026-11-05' }); // the next day sends again
  assert.equal(sentTo.length, 4);
});

test('the gap is random between the two limits and the daily cap stops the run', async () => {
  const gaps = [];
  const sentTo = [];
  const many = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}@g.us`, subject: `Customer ${i} ARYAK` }));
  const rng = (() => { const v = [0, 0.5, 1, 0.25, 0.75]; let i = 0; return () => v[i++ % v.length]; })();
  const r = await runMorning({
    day: '2026-11-04', weekend: false, groups: many, words: ['aryak'], phrases, name: 'Atossa', store: new MorningStore(),
    send: async (id) => { sentTo.push(id); return true; }, sleep: async (ms) => { gaps.push(ms); }, rng, cap: 4, gapMin: 20, gapMax: 60,
  });
  assert.equal(r.sent, 4);
  assert.equal(r.capped, true);
  assert.deepEqual(gaps, [20000, 40000, 60000]); // no gap before the first message
  assert.ok(gaps.every((g) => g >= 20000 && g <= 60000));
});

test('a run stops when the catch-up window closes in the middle; a failed send is retried once the next minute, then left', async () => {
  const store = new MorningStore();
  let open = true;
  const r = await runMorning({ day: '2026-11-04', weekend: false, groups, words: ['aryak'], phrases, name: 'Atossa', store, send: async () => { open = false; return true; }, sleep: async () => {}, stillOpen: () => open });
  assert.deepEqual([r.sent, r.closed], [1, true]);
  assert.equal(store.completed, ''); // the run did not finish
  const failing = new MorningStore();
  const f = { day: '2026-11-04', weekend: false, groups, words: ['aryak'], phrases, name: 'Atossa', store: failing, send: async () => { throw new Error('offline'); }, sleep: async () => {} };
  await runMorning(f);
  await runMorning(f);
  const third = await runMorning(f);
  assert.equal(third.failed, 0); // two failures per group and day, then it is left alone
});

test('the wording: rotates by day, the Thursday variant adds the weekend, the language follows the group, signed with the name', () => {
  const a = morningText({ phrases, lang: 'en', day: '2026-11-04', weekend: false, name: 'Atossa' });
  const b = morningText({ phrases, lang: 'en', day: '2026-11-05', weekend: false, name: 'Atossa' });
  assert.notEqual(a, b);
  assert.match(a, /Atossa$/);
  assert.match(morningText({ phrases, lang: 'en', day: '2026-11-05', weekend: true, name: 'Atossa' }), /weekend/i);
  assert.match(morningText({ phrases, lang: 'ar', day: '2026-11-05', weekend: true, name: 'Atossa' }), /عطلة|إجازة/);
  assert.equal(morningLang('fa', 'Master Wood'), 'fa');
  assert.equal(morningLang('', 'مجموعة الأمل'), 'ar');
  assert.equal(morningLang('', 'Master Wood'), 'en');
  assert.equal(morningLang('hi', 'Master Wood'), 'en');
  for (const lang of ['en', 'ar', 'fa', 'ur']) for (const t of [...phrases[lang].daily, ...phrases[lang].weekend]) assert.ok(!/\d|aed|price|stock/i.test(t), t); // no prices, no stock, no figures
  const quiet = (g) => g.includes('{name}');
  assert.ok(Object.values(phrases).every((s) => !s.daily || s.daily.every(quiet)));
});

test('the owner commands', () => {
  assert.deepEqual(parseMorningCommand('صبح بخیر وضعیت'), { type: 'status' });
  assert.deepEqual(parseMorningCommand('صبح  بخیر خاموش'), { type: 'off' });
  assert.deepEqual(parseMorningCommand('صبح بخیر روشن'), { type: 'on' });
  assert.deepEqual(parseMorningCommand('صبح بخیر آزمایش'), { type: 'test' });
  assert.equal(parseMorningCommand('صبح بخیر'), null);
  assert.equal(parseMorningCommand('سلام صبح بخیر وضعیت'), null);
});

test('the switch survives a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-'));
  const s = new MorningStore(dir);
  s.setEnabled(false);
  assert.equal(new MorningStore(dir).enabled, false);
});
