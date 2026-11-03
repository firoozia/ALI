import test from 'node:test';
import assert from 'node:assert/strict';
import { afterClose, pairDigits, pairingOnce } from '../src/pairing.js';

test('digits only, no plus, no leading zeros', () => {
  assert.equal(pairDigits('+971 55 769 9100'), '971557699100');
  assert.equal(pairDigits('00971557699100'), '971557699100');
});

test('asks for one code per socket, on the first qr only', async () => {
  const shown = [];
  let calls = 0;
  const onQr = pairingOnce({ registered: () => false, phone: '+971557699100', request: async (d) => { calls++; assert.equal(d, '971557699100'); return 'ABCD1234'; }, show: (c) => shown.push(c) });
  assert.equal(await onQr(), true);
  assert.equal(await onQr(), false);
  assert.deepEqual(shown, ['ABCD1234']);
  assert.equal(calls, 1);
});

test('no code when already registered or no number; a failed request is logged, not thrown', async () => {
  const none = pairingOnce({ registered: () => true, phone: '971', request: async () => 'X', show: () => assert.fail() });
  assert.equal(await none(), false);
  const logs = [];
  const bad = pairingOnce({ registered: () => false, phone: '971', request: async () => { throw new Error('Precondition Required'); }, show: () => assert.fail(), log: (s) => logs.push(s) });
  assert.equal(await bad(), false);
  assert.match(logs[0], /Precondition Required/);
});

test('close handling: unpaired logout waits instead of exiting', () => {
  assert.equal(afterClose({ loggedOut: false, registered: false }), 'reconnect');
  assert.equal(afterClose({ loggedOut: true, registered: false }), 'reset-and-wait');
  assert.equal(afterClose({ loggedOut: true, registered: true }), 'relink-needed');
});
