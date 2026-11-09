import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AvailabilityDrafts, draftText, managerText, parseAvailabilityAsk, stateOf } from '../src/availdraft.js';
import { OneShot, SendDesk } from '../src/invoicesend.js';
import { guardedSend } from '../src/guard.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';

// Invented groups, codes and quantities only.
test('the question: a code with «available» in English, Arabic or Persian, «do you have 215 20m», a bare «209?»; any other message is left alone', () => {
  assert.deepEqual(parseAvailabilityAsk('209 available?'), { codes: ['209'], quantity: 0 });
  assert.deepEqual(parseAvailabilityAsk('هل 209 متوفر؟'), { codes: ['209'], quantity: 0 });
  assert.deepEqual(parseAvailabilityAsk('۲۰۹ موجوده؟'), { codes: ['209'], quantity: 0 });
  assert.deepEqual(parseAvailabilityAsk('do you have 215 20m'), { codes: ['215'], quantity: 20 });
  assert.deepEqual(parseAvailabilityAsk('209؟'), { codes: ['209'], quantity: 0 });
  assert.deepEqual(parseAvailabilityAsk('AR105 and 106 available?'), { codes: ['105', '106'], quantity: 0 });
  for (const no of ['hello how are you', 'I need 20 meters of 232 tomorrow', '232-20 MTR', 'thanks 209 was good', 'ok']) assert.equal(parseAvailabilityAsk(no), null, no);
});

test('the draft has no figures: available (and how many meters), or not available; the manager reads the real figures; a code in several groups gets no draft', () => {
  const yes = stateOf('209', { found: true, free: 40, reserved: 5, unit: 'm' }, 0);
  const no = stateOf('210', { found: false }, 0); const empty = stateOf('211', { found: true, free: 0 }, 0); const part = stateOf('212', { found: true, free: 10, unit: 'm' }, 25);
  assert.deepEqual([yes.state, no.state, empty.state, part.state], ['yes', 'no', 'no', 'part']);
  assert.equal(draftText([yes]), 'Yes, code 209 is available. How many meters do you need?');
  assert.equal(draftText([yes], 20), 'Yes, code 209 is available.');
  assert.equal(draftText([yes, no]), 'Yes, code 209 is available. How many meters do you need?\nSorry, code 210 is not available at the moment.');
  assert.equal(draftText([part], 25), 'Sorry, code 212 is not available at the moment.'); // never «we only have 10»
  for (const d of [draftText([yes]), draftText([yes, no]), draftText([part], 25)]) assert.ok(!/\b40\b|\b10\b|free|reserved/i.test(d), d);
  const text = managerText({ id: 'V1', subject: 'SAMPLE CUSTOMER---ARYAK', asked: '209 available?', states: [yes, part], draft: draftText([yes]) });
  assert.match(text, /^Customer group "SAMPLE CUSTOMER---ARYAK" asks: "209 available\?"\nSheet: 209: free 40 m; 212: free 10 m \(less than asked\)\nDraft for the group:\nYes, code 209 is available\./);
  assert.match(text, /Reply yes #V1 to post the draft in the group, or no #V1 to drop it\.$/);
  const amb = stateOf('213', { found: true, ambiguous: true, categories: ['PVC film', 'Edge'] });
  assert.match(managerText({ id: '', subject: 'G', asked: '213?', states: [amb], draft: '' }), /No draft \(a code is in several groups: answer it yourself\)\./);
  assert.match(managerText({ id: 'V2', subject: 'G', asked: '209?', states: [yes], draft: 'x', simulated: true }), /^SIMULATION: Customer group/);
});

test('the drafts: an id each, half an hour, one use', () => {
  let t = 1000; const d = new AvailabilityDrafts({ now: () => t });
  const id = d.add({ groupId: 'g@g.us', subject: 'G', draft: 'Yes' }); assert.equal(id, 'V1'); assert.deepEqual(d.openIds(), ['V1']); assert.equal(d.get('v1').groupId, 'g@g.us');
  d.clear('V1'); assert.equal(d.get('V1'), null);
  const e = d.add({ groupId: 'h@g.us', subject: 'H', draft: 'Yes' }); t += 31 * 60 * 1000; assert.equal(d.get(e), null); assert.deepEqual(d.openIds(), []);
});

test('the one-shot text token: ONE bare text for ONE group, used once; the guard lets nothing else into a customer group', async () => {
  const oneShot = new OneShot();
  const sent = [];
  const config = { staffNumbers: [], adminNumbers: [], ownerNumbers: [], testGroupNames: [] };
  const send = guardedSend({ rawSend: async (...a) => { sent.push(a); return { key: { id: 'x' } }; }, config, oneShot, subjectOf: async () => 'SAMPLE CUSTOMER---ARYAK', isGroup: (j) => j.endsWith('@g.us'), known: new Set(), ownIds: () => [] });
  const content = { text: 'Yes, code 209 is available.' };
  assert.equal(await send('c@g.us', { text: 'hello' }), undefined); // a customer group is never written to
  assert.equal(await send('c@g.us', content), undefined); // no token yet
  assert.equal(oneShot.grantText('c@g.us', content), true);
  assert.ok(await send('c@g.us', content)); assert.equal(await send('c@g.us', content), undefined); // once
  const other = { text: 'Yes, code 209 is available.' }; oneShot.grantText('c@g.us', other);
  assert.equal(await send('d@g.us', other), undefined); // another group
  assert.equal(await send('c@g.us', { text: 'Yes, code 209 is available.' }), undefined); // an equal text is another object: no token
  assert.equal(oneShot.grantText('c@g.us', { text: 'a', mentions: ['x'] }), false); assert.equal(oneShot.grantText('c@g.us', { document: Buffer.from('x'), text: 'a' }), false); assert.equal(oneShot.grantText('c@g.us', { text: '  ' }), false);
  assert.equal(oneShot.grant('c@g.us', { text: 'a' }), false); // the PDF grant still refuses text
  assert.equal(sent.length, 1);
});

test('the wiring: the draft goes privately (the manager, the owner in a simulation); only «yes #V1» posts; the customer-group hook never answers by itself; the prefix simulates a customer group', () => {
  assert.deepEqual(parseInvoiceCommand('yes #V1'), { type: 'yes', id: 'V1' }); assert.deepEqual(parseInvoiceCommand('no V2'), { type: 'no', id: 'V2' });
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const fn = index.slice(index.indexOf('async function customerAsksAvailability'), index.indexOf('async function decideAvailability'));
  assert.match(fn, /const to = !simulated && managerDigits \? `\$\{managerDigits\}@s\.whatsapp\.net` : ownIds\(\)\[0\];/);
  assert.match(fn, /await sock\.sendMessage\(to, \{ text:/); assert.doesNotMatch(fn, /sock\.sendMessage\(groupId/); // never to the customer group
  const decide = index.slice(index.indexOf('async function decideAvailability'), index.indexOf('function decideAlias'));
  assert.ok(decide.indexOf("verb !== 'yes'") < decide.indexOf('oneShot.grantText(')); assert.match(decide, /if \(d\.simulated\) return \[`SIMULATION: would post/);
  assert.match(index, /id\.startsWith\('V'\) \? decideAvailability\(ic\.type, id\)/);
  assert.match(index, /if \(!groupAllowed\(watchedInfo\.subject, config\)\.ok && !raw\.key\.fromMe\) \{[\s\S]*?\.\.\.config\.ownerNumbers\][\s\S]*?void customerAsksAvailability\(/); // a customer's message only, never staff or the owner
  assert.match(index, /\/\^\\s\*\\\[customer\\s\+\(\[\^\\\]\]\+\)\\\]\\s\*\(\[\\s\\S\]\+\)\$\/i/); // «[customer NAME] text»
  assert.match(index, /simulated: true \}\);\s*await reply\(done \? `SIMULATION:/);
  assert.match(index, /\[chatId, raw\.key\.remoteJidAlt\]\.some\(\(j\) => j && jidDigits\(j\) === jidDigits\(config\.salesManager\)/); // the manager's own chat
});
