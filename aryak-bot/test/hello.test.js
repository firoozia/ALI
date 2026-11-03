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
