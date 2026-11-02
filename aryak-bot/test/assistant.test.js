import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answer, buildContent } from '../src/assistant.js';

const config = { model: 'claude-opus-5-5', effort: 'medium', sheetUrl: 'https://x/exec', botToken: 't', dedupeMinutes: 60 };
const ctx = { groupId: 'g', groupName: 'Master Wood – ARYAK', customer: 'Master Wood', messageText: 'x' };
const input = { groupName: 'Master Wood – ARYAK', customer: 'Master Wood', transcript: [], messages: [{ senderName: 'Ahmed', text: 'have 305 and 101?' }] };

/** A fake Claude: returns the scripted responses in order and records each request. */
function fakeClient(responses) {
  const requests = [];
  return { requests, beta: { messages: { create: async (req) => { requests.push(structuredClone(req)); return responses.shift(); } } } };
}
const toolUse = (id, input) => ({ type: 'tool_use', id, name: 'check_stock', input });
const sheet = (byCode) => async (url, opts) => {
  const code = JSON.parse(opts.body).code;
  return { ok: true, json: async () => ({ ok: true, ...byCode[code] }) };
};
const avail = { found: true, code: '305', category: 'PVC film', unit: 'm', available: true, qtyChecked: true, free: 500, limit: 50, sizes: [], locations: [] };
const low = { found: true, code: '101', category: 'PVC film', unit: 'm', available: false, qtyChecked: true, free: 20, limit: 50, sizes: [], locations: [] };

test('photo goes first as an image block, then the text with the conversation', () => {
  const c = buildContent({ ...input, images: [{ base64: 'AAA', mimeType: 'image/jpeg' }] });
  assert.equal(c[0].type, 'image');
  assert.equal(c[0].source.data, 'AAA');
  assert.ok(c[1].text.includes('[Ahmed] have 305 and 101?'));
});

test('mixed stock: reply goes out, manager told about the low code, model never sees numbers', async () => {
  const client = fakeClient([
    { stop_reason: 'tool_use', content: [toolUse('a', { code: '305' }), toolUse('b', { code: '101' })] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: '305 is available. A colleague will confirm 101.' }] },
  ]);
  const r = await answer({ client, config, system: 's', input, ctx, recent: new Map(), fetchImpl: sheet({ 305: avail, 101: low }), now: 1 });
  assert.equal(r.reply, '305 is available. A colleague will confirm 101.');
  assert.equal(r.managerTexts.length, 1);
  assert.ok(r.managerTexts[0].includes('101'));
  const toolResults = JSON.stringify(client.requests[1].messages.at(-1));
  assert.ok(!toolResults.includes('500') && !toolResults.includes('20 m'));
  assert.equal(client.requests[0].fallbacks, 'default');
  assert.deepEqual(client.requests[0].betas, ['server-side-fallback-2026-07-01']);
});

test('only low codes: silent in the group even if the model wrote something', async () => {
  const client = fakeClient([
    { stop_reason: 'tool_use', content: [toolUse('b', { code: '101' })] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'A colleague will confirm.' }] },
  ]);
  const r = await answer({ client, config, system: 's', input, ctx, recent: new Map(), fetchImpl: sheet({ 101: low }), now: 1 });
  assert.equal(r.reply, null);
  assert.equal(r.why, 'low-stock');
  assert.equal(r.managerTexts.length, 1);
});

test('unreadable photo: NO_REPLY means nothing is sent', async () => {
  const client = fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'NO_REPLY' }] }]);
  const r = await answer({ client, config, system: 's', input, ctx, recent: new Map(), now: 1 });
  assert.equal(r.reply, null);
  assert.equal(r.why, 'no-reply');
});

test('refusal: nothing is sent', async () => {
  const client = fakeClient([{ stop_reason: 'refusal', content: [] }]);
  assert.equal((await answer({ client, config, system: 's', input, ctx, recent: new Map(), now: 1 })).reply, null);
});
