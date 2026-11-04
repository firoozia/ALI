import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldProcess } from '../src/intake.js';

const msg = (id, extra = {}) => ({ key: { id, remoteJid: 'g@g.us' }, message: { conversation: 'x' }, messageTimestamp: 1000, ...extra });

test('a live message passes once; the same id again is a duplicate', () => {
  const seen = new Set();
  assert.deepEqual(shouldProcess({ type: 'notify', raw: msg('a'), seen, now: 5000 * 1000 }), { ok: true });
  assert.equal(shouldProcess({ type: 'notify', raw: msg('a'), seen }).reason, 'duplicate');
});

test('an undecryptable message (no content) is refused with a reason that names it', () => {
  const r = shouldProcess({ type: 'notify', raw: msg('b', { message: undefined, messageStubType: 2 }), seen: new Set() });
  assert.equal(r.ok, false);
  assert.match(r.reason, /decrypt.*stub 2/);
});

test('an appended message passes only when fresh; history is not answered', () => {
  const now = 2000 * 1000;
  const seen = new Set();
  assert.equal(shouldProcess({ type: 'append', raw: msg('c', { messageTimestamp: 1990 }), seen, now }).ok, true);
  const old = shouldProcess({ type: 'append', raw: msg('d', { messageTimestamp: 1000 }), seen, now });
  assert.equal(old.ok, false);
  assert.match(old.reason, /old message of type append/);
  assert.equal(shouldProcess({ type: 'append', raw: msg('e', { messageTimestamp: { low: 1995, high: 0 } }), seen, now }).ok, true); // Long-style timestamp
});

test('the seen set is capped', () => {
  const seen = new Set();
  for (let i = 0; i < 2100; i++) shouldProcess({ type: 'notify', raw: msg(`m${i}`), seen });
  assert.ok(seen.size <= 2000);
});
