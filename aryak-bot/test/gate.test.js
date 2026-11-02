import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroupGate, staffChecker } from '../src/gate.js';

function fakeTimers() {
  const timers = new Map(); let id = 0;
  return {
    setTimer: (fn) => { timers.set(++id, fn); return id; },
    clearTimer: (t) => timers.delete(t),
    runAll: async () => { for (const [k, fn] of [...timers]) { timers.delete(k); await fn(); } },
    count: () => timers.size,
  };
}
const staff = staffChecker(['+971 50 111 1111'], new Map([['123@lid', '971501111111@s.whatsapp.net']]));

test('staff by phone, by @lid through the group list, unknown @lid', () => {
  assert.equal(staff({ sender: '971501111111@s.whatsapp.net' }), true);
  assert.equal(staff({ sender: '123@lid' }), true);
  assert.equal(staff({ sender: '999@lid', senderAlt: '971509999999@s.whatsapp.net' }), false);
  assert.equal(staff({ sender: '999@lid' }), null);
});

test('customer message is answered after the wait, with the conversation before it', async () => {
  const t = fakeTimers(); const calls = [];
  const gate = new GroupGate({ waitMs: 1, isStaff: (m) => m.staff, answer: async (x) => calls.push(x), ...t });
  gate.onMessage({ groupId: 'g', staff: true, senderName: 'Ali', text: 'Good morning' });
  assert.equal(gate.onMessage({ groupId: 'g', staff: false, senderName: 'Ahmed', text: 'is 305 available?' }), 'waiting');
  gate.onMessage({ groupId: 'g', staff: false, senderName: 'Ahmed', text: 'and 101', hasImage: true });
  assert.equal(t.count(), 1);
  await t.runAll();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages.length, 2);
  assert.deepEqual(calls[0].transcript, ['[Staff Ali] Good morning']);
});

test('a colleague replying within the wait keeps the assistant silent', async () => {
  const t = fakeTimers(); const calls = [];
  const gate = new GroupGate({ waitMs: 1, isStaff: (m) => m.staff, answer: async (x) => calls.push(x), ...t });
  gate.onMessage({ groupId: 'g', staff: false, text: 'price of 305?' });
  assert.equal(gate.onMessage({ groupId: 'g', staff: true, text: 'Sending now' }), 'staff-replied');
  await t.runAll();
  assert.equal(calls.length, 0);
});

test('own messages and unknown senders are never answered', async () => {
  const t = fakeTimers(); const calls = [];
  const gate = new GroupGate({ waitMs: 1, isStaff: (m) => m.staff, answer: async (x) => calls.push(x), ...t });
  assert.equal(gate.onMessage({ groupId: 'g', fromMe: true, text: 'Yes, available.' }), 'own');
  assert.equal(gate.onMessage({ groupId: 'g', staff: null, text: '?' }), 'unknown');
  await t.runAll();
  assert.equal(calls.length, 0);
});
