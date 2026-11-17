// The studio's own group (the owner, 17/11: «my own chat is full; make a group for this and separate it»). index.js starts the whole
// program, so its wiring is read as text: the studio's messages go to the group, the owner's messages there are taken as his commands,
// nobody else there is answered, and finance stays in his own chat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');

test('the studio\'s messages go to its group when it is set up (his own chat otherwise)', () => {
  const say = src.slice(src.indexOf('async function socialSay('), src.indexOf('async function socialSayDesign('));
  assert.match(say, /sock\.sendMessage\(studioJid\(\) \|\| ownIds\(\)\[0\], content\)/);
});

test('in the studio\'s group only the account\'s own messages are taken, as in his own chat; it is checked before any other group flow', () => {
  const on = src.slice(src.indexOf('async function onMessage('));
  const studio = on.indexOf('groupId === studioJid()');
  assert.ok(studio > 0 && studio < on.indexOf('keepPhotoMessage') && studio < on.indexOf('isTestSubject'), 'first among the group flows');
  assert.match(on, /if \(groupId === studioJid\(\)\) \{ if \(raw\.key\.fromMe\) await handleStaffChat\(raw, groupId, null, \{ studio: true \}\); return; \}/);
  assert.match(src, /const isSelf = !!place\.studio \|\| !!place\.stock \|\| own\.some/);
});

test('the payment questions stay in the owner\'s own chat, never in the studio\'s group', () => {
  const follow = src.slice(src.indexOf('async function paymentFollowUps('), src.indexOf('async function paymentFollowUps(') + 3000);
  assert.match(follow, /sock\.sendMessage\(ownIds\(\)\[0\]/);
  assert.doesNotMatch(follow, /studioJid/);
});

test('the group\'s name and switch come from the environment (on by default, «استودیو آتوسا»)', () => {
  const c = loadConfig({}).config;
  assert.equal(c.social.studioGroup, true);
  assert.equal(c.social.studioGroupName, 'استودیو آتوسا');
  assert.equal(loadConfig({ STUDIO_GROUP: 'off' }).config.social.studioGroup, false);
});

test('the guard lets the assistant write into the studio group (live 17/11: its first message and its answers were blocked as an unknown group), and it is never watched as a customer group', async () => {
  const { groupAllowed, observedGroup } = await import('../src/guard.js');
  const { config } = loadConfig({ OBSERVE_GROUP_NAMES: 'آتوسا' });
  assert.deepEqual(groupAllowed('استودیو آتوسا', config), { ok: true, why: 'internal group' });
  assert.equal(observedGroup('استودیو آتوسا', config), false);
  assert.equal(groupAllowed('استودیو آتوسا', loadConfig({ STUDIO_GROUP: 'off' }).config).ok, false);
});

// The group of the stock drafts (the owner, 17/11: «Yes, make it»): the customers' stock questions and their drafts leave his own chat.
test('the stock drafts and their drop notes go to the stock group when it is set up (his own chat otherwise; the sales manager privately when there is one)', () => {
  const ask = src.slice(src.indexOf('async function customerAsksAvailability('), src.indexOf('async function decideAvailability('));
  assert.match(ask, /const to = toOwner \? stockJid\(\) \|\| ownIds\(\)\[0\] : `\$\{managerDigits\}@s\.whatsapp\.net`/);
  assert.match(src, /sock\.sendMessage\(stockJid\(\) \|\| ownIds\(\)\[0\], \{ text: '🤖 #' \+ d\.id \+ ' dropped/);
});

test('in the stock group only the account\'s own messages are taken, and «yes #V1» / «no #V1» decide there', () => {
  const on = src.slice(src.indexOf('async function onMessage('));
  const stock = on.indexOf('groupId === stockJid()');
  assert.ok(stock > 0 && stock < on.indexOf('keepPhotoMessage') && stock < on.indexOf('isTestSubject'), 'before the other group flows');
  assert.match(on, /if \(groupId === stockJid\(\)\) \{ if \(raw\.key\.fromMe\) await handleStaffChat\(raw, groupId, null, \{ stock: true \}\); return; \}/);
  assert.match(src, /if \(\(!group \|\| place\.stock\) && text && !audio && !image && \(ownerPerson \|\| place\.stock \|\|/);
});

test('the first message of an own group keeps its Persian (live 17/11: the studio\'s arrived in English)', () => {
  const own = src.slice(src.indexOf('async function ensureOwnGroup('), src.indexOf('const ensureStudioGroup'));
  assert.match(own, /keepLang\.add\(content\)/);
});

test('the stock group: its name and switch come from the environment, and the guard lets the assistant write there', async () => {
  const { groupAllowed, observedGroup } = await import('../src/guard.js');
  const c = loadConfig({}).config;
  assert.equal(c.stockGroup, true);
  assert.equal(c.stockGroupName, 'موجودی مشتری‌ها');
  assert.deepEqual(groupAllowed('موجودی مشتری‌ها', c), { ok: true, why: 'internal group' });
  assert.equal(observedGroup('موجودی مشتری‌ها', loadConfig({ OBSERVE_GROUP_NAMES: 'مشتری' }).config), false);
  assert.equal(groupAllowed('موجودی مشتری‌ها', loadConfig({ STOCK_GROUP: 'off' }).config).ok, false);
});
