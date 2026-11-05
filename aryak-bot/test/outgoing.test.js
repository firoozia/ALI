import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanOutgoing, hasPlaceholder } from '../src/outgoing.js';
import { applyTags } from '../src/tags.js';
import { cardText, mask } from '../src/shadow.js';

test('an unresolved placeholder never leaves: "@[number]", "[TAG:sales]" are removed, a real mention stays', () => {
  const c = cleanOutgoing('Kindly send the code. A colleague will also check it for you. @[number]');
  assert.deepEqual([c.text, c.changed], ['Kindly send the code. A colleague will also check it for you.', true]);
  assert.equal(cleanOutgoing('Thanks [TAG:sales]').text, 'Thanks');
  assert.equal(cleanOutgoing('@[name] @[number]').text, '');
  const real = applyTags('A colleague will help. [TAG:team]', { team: ['971501234567'] });
  assert.match(real.text, /@971501234567$/);
  assert.deepEqual(real.mentions, ['971501234567@s.whatsapp.net']);
  assert.equal(cleanOutgoing(real.text).changed, false); // a resolved mention is not touched
  assert.equal(hasPlaceholder(real.text), false);
  assert.equal(hasPlaceholder('hello @[number]'), true);
  assert.equal(cleanOutgoing('No placeholder here, 5 [m]').changed, false);
});

test('where "@[number]" came from: the card masked the colleague\'s real number; the card now says the tag in words', () => {
  const tagged = applyTags('A colleague will also check it for you. [TAG:team]', { team: ['971501234567'] });
  assert.match(mask(tagged.text), /@\[number\]/); // the old card: the digits of the mention masked like a phone number
  const body = tagged.text.replace(/\n@\d+(?: @\d+)*\s*$/, '');
  const card = cardText({ id: 11, group: 'G', text: 'Plz cheak pvc 309 available', action: 'answer', reply: body, lang: 'en', note: 'Would also tag a colleague (a real mention in the message)' });
  assert.ok(!hasPlaceholder(card), card);
  assert.ok(!/@/.test(card.split('Reply')[1]), card);
  assert.match(card, /Would also tag a colleague/);
});

test('the one send path cleans every outgoing text, and the shadow card strips the mention tail', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const send = src.slice(src.indexOf('sock.sendMessage = async (...a) => {'), src.indexOf('const r = await guarded(...a);'));
  assert.match(send, /cleanOutgoing\(a\[1\]\.text\)/);
  assert.match(send, /if \(!c\.text\) return undefined;/); // a text that was only a placeholder is not sent
  assert.ok(src.includes('tagged.text.replace(/') && src.includes('Would also tag a colleague')); // the card
});
