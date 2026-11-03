import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HELLO_TEXT, helloOnce, ownJid } from '../src/hello.js';

test('own chat is the bot number only', () => {
  assert.equal(ownJid('+971 55 769 9100'), '971557699100@s.whatsapp.net');
  assert.equal(ownJid(''), '');
});

test('greeting goes once per value, only to the own number', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-'));
  const sent = [];
  const send = async (jid, text) => sent.push([jid, text]);
  const run = (value) => helloOnce({ value, phone: '971557699100', dir, send });
  assert.equal(await run(''), false);
  assert.equal(await run('1'), true);
  assert.equal(await run('1'), false);
  assert.equal(await run('2'), true);
  assert.deepEqual(sent, [['971557699100@s.whatsapp.net', HELLO_TEXT], ['971557699100@s.whatsapp.net', HELLO_TEXT]]);
});

test('a failed send is not remembered, so it is tried again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-'));
  await assert.rejects(helloOnce({ value: 'x', phone: '9715', dir, send: async () => { throw new Error('down'); } }));
  assert.equal(await helloOnce({ value: 'x', phone: '9715', dir, send: async () => {} }), true);
});

test('the socket\'s own jid wins, every outcome is logged, a silent socket times out', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-'));
  const logs = [];
  const sent = [];
  const log = (m) => logs.push(m);
  assert.equal(await helloOnce({ value: '', phone: '9715', dir, send: async () => {}, log }), false);
  assert.equal(await helloOnce({ value: 'a', phone: '9715', jid: '971@s.whatsapp.net', dir, send: async (j) => sent.push(j), log }), true);
  assert.deepEqual(sent, ['971@s.whatsapp.net']);
  assert.equal(await helloOnce({ value: 'a', phone: '9715', dir, send: async () => {}, log }), false);
  assert.ok(logs.some((l) => /empty/.test(l)) && logs.some((l) => /sent$/.test(l)) && logs.some((l) => /already/.test(l)));
  await assert.rejects(helloOnce({ value: 'b', phone: '9715', dir, send: () => new Promise(() => {}), timeoutMs: 20 }), /no answer/);
});
