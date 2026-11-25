import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { callsHer } from '../src/staff.js';

test('his own chat reacts only when she is called (the owner, 25/11): her name, a reply to her, or a code of hers', () => {
  const names = ['آتوسا', 'atossa', 'Atossa'];
  for (const t of ['آتوسا فاکتور بساز مستر وود', 'Atossa invoice master wood 213 10m', 'اتوسا صندوق', 'بله #Q5', 'yes #W1', 'Q5 yes', 'بله پست 3', 'جواب پیام 5 ممنون', 'edit #E8 cash', 'cut #Z1 cancel'])
    assert.equal(callsHer({ text: t, names }), true, t);
  for (const t of ['سلام', 'بله', '1', 'مستر وود ۵۰۰ درهم', 'فاکتور بساز مستر وود', 'طرح', 'پست', 'این عکس را ببین'])
    assert.equal(callsHer({ text: t, names }), false, t);
  assert.equal(callsHer({ text: 'بله', names, repliedToHer: true }), true, 'a reply to her message is enough');
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(src, /own chat: the message does not call her/);
  assert.match(src, /own chat: a voice note that does not call her: no reaction/);
});
