import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BotState, formatChecks, isAddressed, parseCommand, runCommand, staffAnswer } from '../src/staff.js';
import { InvoiceDesk } from '../src/invoice.js';

const OWN = ['971557699100@s.whatsapp.net'];
const names = ['bot', 'aryak bot', 'بات', 'ربات'];

test('addressed: mention, reply to the bot, or its name as a word; nothing else', () => {
  assert.equal(isAddressed({ text: 'x', mentioned: OWN, ownIds: OWN, names }), true);
  assert.equal(isAddressed({ text: 'x', quotedFrom: OWN[0], ownIds: OWN, names }), true);
  assert.equal(isAddressed({ text: 'ربات موجودی ۳۰۵ چقدره', ownIds: OWN, names }), true);
  assert.equal(isAddressed({ text: 'Hey bot, stock 305?', ownIds: OWN, names }), true);
  assert.equal(isAddressed({ text: 'hello aryak bot', ownIds: OWN, names }), true);
  assert.equal(isAddressed({ text: 'ثبات قیمت و اثبات سفارش', ownIds: OWN, names }), false);
  assert.equal(isAddressed({ text: 'robot parts, bottle', ownIds: OWN, names }), false);
  assert.equal(isAddressed({ text: 'x', mentioned: ['971500000000@s.whatsapp.net'], quotedFrom: '971500000000@s.whatsapp.net', ownIds: OWN, names }), false);
});

test('commands: slash always, bare word only where allowed', () => {
  assert.equal(parseCommand('/status'), 'status');
  assert.equal(parseCommand('/وضعیت'), 'status');
  assert.equal(parseCommand('!pause'), 'pause');
  assert.equal(parseCommand('توقف'), null);
  assert.equal(parseCommand('توقف', { bare: true }), 'pause');
  assert.equal(parseCommand('ادامه', { bare: true }), 'resume');
  assert.equal(parseCommand('وضعیت موجودی چطوره', { bare: true }), null);
  assert.equal(parseCommand('/nothing'), null);
});

test('pause survives a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
  const a = new BotState(dir);
  assert.equal(a.paused, false);
  a.setPaused(true);
  assert.equal(new BotState(dir).paused, true);
  a.setPaused(false);
  assert.equal(new BotState(dir).paused, false);
});

test('desk history and orders', () => {
  const d = new InvoiceDesk();
  assert.deepEqual(d.lastChecks(), []);
  d.record({ verdict: 'match', customer: 'A', po: '1', file: 'a.pdf', problems: 0 });
  d.record({ verdict: 'mismatch', customer: 'B', po: '2', file: 'b.pdf', problems: 2 });
  assert.equal(d.lastChecks(1)[0].customer, 'B');
  assert.equal(d.lastChecks().length, 2);
  d.addRequest({ hash: 'h', base64: 'AA', fileName: 'LPO 2.pdf' }, { customer: 'B Trading LLC', po: '2' }, 'g');
  assert.equal(d.listOrders({ po: 'LPO-2' }).length, 1);
  assert.equal(d.listOrders({ customer: 'b trading' })[0].file, 'LPO 2.pdf');
  assert.equal(d.listOrders({ po: '9' }).length, 0);
});

test('commands produce Persian text and change the state', () => {
  const d = new InvoiceDesk();
  const state = new BotState('');
  const ctx = { state, desk: d, staffNumbers: ['9715'], startedAt: 0, now: 120000 };
  assert.match(runCommand('status', ctx), /در حال کار/);
  assert.match(runCommand('status', ctx), /2 دقیقه/);
  assert.match(runCommand('pause', ctx), /متوقف/);
  assert.equal(state.paused, true);
  assert.match(runCommand('status', ctx), /حالت توقف/);
  runCommand('resume', ctx);
  assert.equal(state.paused, false);
  assert.match(runCommand('staff', ctx), /9715/);
  assert.match(runCommand('last', ctx), /ثبت نشده/);
  assert.match(runCommand('help', ctx), /راهنما/);
  assert.match(runCommand('help', { ...ctx, name: 'آتوسا' }), /من آتوسا هستم[\s\S]*— آتوسا$/);
  assert.match(formatChecks([{ verdict: 'mismatch', customer: 'B', po: '2', file: 'b.pdf', problems: 2 }]), /ناهماهنگ.*2 مورد/);
});

const reply = (content, stop = 'end_turn') => ({ stop_reason: stop, content });

test('staffAnswer: runs a tool, then answers; NO_REPLY is silence; a tool error does not stop it', async () => {
  const calls = [];
  const script = [
    reply([{ type: 'tool_use', id: 't1', name: 'staff_stock', input: { code: '305' } }], 'tool_use'),
    reply([{ type: 'text', text: 'Free 120 m' }]),
  ];
  const client = { beta: { messages: { create: async (req) => { calls.push(req); return script.shift(); } } } };
  const handlers = { staff_stock: async (i) => ({ code: i.code, free: 120 }) };
  const out = await staffAnswer({ client, config: { model: 'm' }, text: 'stock 305?', handlers });
  assert.equal(out, 'Free 120 m');
  assert.equal(calls[1].messages.at(-1).content[0].content, '{"code":"305","free":120}');

  const silent = { beta: { messages: { create: async () => reply([{ type: 'text', text: 'NO_REPLY' }]) } } };
  assert.equal(await staffAnswer({ client: silent, config: { model: 'm' }, text: 'x', handlers }), null);

  const bad = [reply([{ type: 'tool_use', id: 't', name: 'staff_stock', input: {} }], 'tool_use'), reply([{ type: 'text', text: 'sorry' }])];
  const c2 = { beta: { messages: { create: async () => bad.shift() } } };
  assert.equal(await staffAnswer({ client: c2, config: { model: 'm' }, text: 'x', handlers: { staff_stock: async () => { throw new Error('down'); } } }), 'sorry');
});
