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
  assert.match(src, /const isSelf = !!place\.studio \|\| own\.some/);
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
