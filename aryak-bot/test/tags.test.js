import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTags } from '../src/tags.js';

const team = { sales: ['+971 50 111 1111', '971502222222'], team: ['971503333333'] };

test('a tag becomes mentions of the colleagues for that topic', () => {
  const r = applyTags('A colleague will send the price. [TAG:sales]', team);
  assert.equal(r.text, 'A colleague will send the price.\n@971501111111 @971502222222');
  assert.deepEqual(r.mentions, ['971501111111@s.whatsapp.net', '971502222222@s.whatsapp.net']);
});

test('a topic with nobody set goes to the team; no tag, no mentions', () => {
  assert.deepEqual(applyTags('Checking. [TAG:logistics]', team).mentions, ['971503333333@s.whatsapp.net']);
  assert.deepEqual(applyTags('Yes, 305 is available.', team), { text: 'Yes, 305 is available.', mentions: [] });
});
