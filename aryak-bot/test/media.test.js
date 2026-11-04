import test from 'node:test';
import assert from 'node:assert/strict';
import { ignoredKind, imageOf } from '../src/media.js';

test('a photo and a picture sent as a document are both pictures; other documents are not', () => {
  const photo = { imageMessage: { mimetype: 'image/jpeg', caption: 'x' } };
  assert.equal(imageOf(photo), photo.imageMessage);
  const doc = imageOf({ documentMessage: { mimetype: 'image/jpeg', fileName: 'a.jpg' } });
  assert.equal(doc.mimetype, 'image/jpeg');
  assert.equal(doc.caption, '');
  assert.equal(imageOf({ documentMessage: { mimetype: 'application/pdf' } }), null);
  assert.equal(imageOf({ conversation: 'hi' }), null);
  assert.equal(imageOf(undefined), null);
});

test('what is ignored is named by kind only, quiet kinds are not named', () => {
  assert.equal(ignoredKind({ stickerMessage: {} }), 'stickerMessage');
  assert.equal(ignoredKind({ reactionMessage: {}, messageContextInfo: {} }), '');
  assert.equal(ignoredKind(undefined), '');
});
