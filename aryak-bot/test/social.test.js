import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MetaClient, SocialDesk, SocialStore, catalogRequest, fitForInstagram, parseSocialCommand, postRequest } from '../src/social.js';

// A fake Graph API: answers by the path, records every call.
function fakeGraph(routes) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    const key = `${opts.method} ${u.pathname.replace(/^\/v[\d.]+\//, '/')}`;
    calls.push({ key, url: u, opts });
    const hit = Object.entries(routes).find(([k]) => new RegExp(`^${k}$`).test(key));
    const body = hit ? (typeof hit[1] === 'function' ? hit[1](u, opts) : hit[1]) : { error: { message: `no route ${key}`, code: 100 } };
    return { ok: !body.error, status: body.error ? 400 : 200, json: async () => body };
  };
  return { calls, fetchImpl };
}
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'social-'));
const client = (fetchImpl, o = {}) => new MetaClient({ igToken: 'IG', igUserId: '111', pageId: '222', pageToken: 'PG', fetchImpl, wait: async () => {}, ...o });

test('the owner\'s words: yes, no, edit, reply, status, leads', () => {
  assert.deepEqual(parseSocialCommand('yes #SP3'), { verb: 'yes', kind: 'SP', id: 'SP3' });
  assert.deepEqual(parseSocialCommand('بله #sr12'), { verb: 'yes', kind: 'SR', id: 'SR12' });
  assert.deepEqual(parseSocialCommand('No #SP3'), { verb: 'no', kind: 'SP', id: 'SP3' });
  assert.deepEqual(parseSocialCommand('edit #SP3 New colours are here'), { verb: 'edit', kind: 'SP', id: 'SP3', text: 'New colours are here' });
  assert.deepEqual(parseSocialCommand('reply #SR5: Please message us on WhatsApp'), { verb: 'reply', kind: 'SR', id: 'SR5', text: 'Please message us on WhatsApp' });
  assert.equal(parseSocialCommand('social').verb, 'status');
  assert.equal(parseSocialCommand('leads').verb, 'leads');
  assert.deepEqual(parseSocialCommand('بله پست ۱'), { verb: 'yes', kind: 'SP', id: 'SP1' });
  assert.deepEqual(parseSocialCommand('نه پیام ۱۲'), { verb: 'no', kind: 'SR', id: 'SR12' });
  assert.deepEqual(parseSocialCommand('ویرایش پست ۲ رنگ‌های تازه'), { verb: 'edit', kind: 'SP', id: 'SP2', text: 'رنگ‌های تازه' });
  assert.deepEqual(parseSocialCommand('جواب پیام ۳ با ما در واتس‌اپ تماس بگیرید'), { verb: 'reply', kind: 'SR', id: 'SR3', text: 'با ما در واتس‌اپ تماس بگیرید' });
  assert.equal(parseSocialCommand('پست رنگ جدید'), null, 'a post request is not a decision');
  assert.equal(parseSocialCommand('yes #S3'), null); // a statement preview is not ours
  assert.equal(parseSocialCommand('yes #Q3'), null);
});

test('a photo caption that asks for a post', () => {
  assert.deepEqual(postRequest('post new marble colours, 3 designs'), { note: 'new marble colours, 3 designs' });
  assert.deepEqual(postRequest('پست رنگ‌های جدید'), { note: 'رنگ‌های جدید' });
  assert.deepEqual(postRequest('Instagram'), { note: '' });
  assert.equal(postRequest('postman delivered'), null);
  assert.equal(postRequest('212 30m TEST WOOD'), null);
});

test('a post is only a draft until yes; yes posts on Facebook, then Instagram takes the photo from there', async () => {
  const g = fakeGraph({
    'POST /222/photos': { id: 'PH1', post_id: '222_P1' },
    'GET /222_P1': { permalink_url: 'fb-link' },
    'GET /PH1': { images: [{ width: 300, source: 'small' }, { width: 1080, source: 'big-url' }] },
    'POST /111/media': (u, o) => { assert.match(String(o.body), /image_url=big-url/); return { id: 'C1' }; },
    'GET /C1': { status_code: 'FINISHED' },
    'POST /111/media_publish': { id: 'M1' },
    'GET /M1': { permalink: 'ig-link' },
  });
  const store = new SocialStore(dir());
  const writes = [];
  const desk = new SocialDesk({ client: client(g.fetchImpl), store, write: async (r) => { writes.push(r); return 'New colours.\nألوان جديدة.\n#aryak'; }, mediaDir: path.join(store.dir, 'media') });
  const preview = await desk.draftPost({ image: Buffer.from('jpg'), note: 'new colours' });
  assert.match(preview, /Post #SP1 for Instagram \+ Facebook \(nothing is posted yet\)/);
  assert.match(writes[0].system, /never invent a price/);
  assert.equal(g.calls.length, 0, 'nothing reaches Meta before the yes');
  const done = await desk.handle(parseSocialCommand('yes #SP1'));
  assert.match(done, /Facebook: posted fb-link/);
  assert.match(done, /Instagram: posted ig-link/);
  assert.equal(await desk.handle(parseSocialCommand('yes #SP1')), 'Post #SP1 was already posted.');
});

test('no cancels a draft; edit replaces its caption', async () => {
  const g = fakeGraph({});
  const desk = new SocialDesk({ client: client(g.fetchImpl), store: new SocialStore(''), write: async () => 'Caption' });
  await desk.draftPost({ image: Buffer.from('x') });
  assert.match(await desk.handle(parseSocialCommand('edit #SP1 Better words')), /Better words/);
  assert.match(await desk.handle(parseSocialCommand('no #SP1')), /cancelled; nothing was posted/);
  assert.equal(g.calls.length, 0);
});

test('the first look only marks what is there; a new comment later is shown with a drafted answer and sent only on yes', async () => {
  let comments = [{ id: 'c1', text: 'old one', username: 'ann', timestamp: '2026-11-01T10:00:00+0000', from: { id: '9' } }];
  const g = fakeGraph({
    'GET /111/media': { data: [{ id: 'M1', caption: 'Marble film', permalink: 'p' }] },
    'GET /M1/comments': () => ({ data: comments }),
    'GET /111/conversations': { data: [] },
    'GET /222/feed': { data: [] },
    'GET /222/conversations': { data: [] },
    'POST /c2/replies': { id: 'r1' },
  });
  const store = new SocialStore(dir());
  const desk = new SocialDesk({ client: client(g.fetchImpl), store, write: async (r) => (r.kind === 'reply' ? 'Thank you! Please message us.' : '') });
  assert.deepEqual(await desk.poll(), []);
  comments = [...comments, { id: 'c2', text: 'price?', username: 'bob', timestamp: '2026-11-14T10:00:00+0000', from: { id: '8' } }, { id: 'c3', text: 'our own answer', username: 'aryak', timestamp: '2026-11-14T10:01:00+0000', from: { id: '111' } }];
  const notices = await desk.poll();
  assert.equal(notices.length, 1, 'the account\'s own comment is never shown');
  assert.match(notices[0], /#SR1 Instagram comment from @bob on «Marble film»:\nprice\?/);
  assert.match(notices[0], /Suggested answer: Thank you! Please message us\./);
  assert.ok(!g.calls.some((c) => c.key.startsWith('POST')), 'nothing is answered before the yes');
  assert.match(await desk.handle(parseSocialCommand('yes #SR1')), /answer sent to @bob on Instagram/);
  assert.equal(g.calls.filter((c) => c.key === 'POST /c2/replies').length, 1);
  assert.deepEqual(await desk.poll(), [], 'a comment is shown once');
  assert.match(desk.leadsText(), /@bob \(instagram\), 1 message/);
});

test('a direct message older than 24 hours is never answered by the program', async () => {
  const g = fakeGraph({});
  const store = new SocialStore('');
  const now = Date.parse('2026-11-14T12:00:00Z');
  const desk = new SocialDesk({ client: client(g.fetchImpl), store, write: async () => '', now: () => now });
  store.d.inbox.SR1 = { id: 'SR1', platform: 'instagram', kind: 'message', id2: 'm', fromId: '77', name: '@x', text: 'hi', at: now - 30 * 3600 * 1000, state: 'open', draft: 'Hello' };
  assert.match(await desk.handle(parseSocialCommand('yes #SR1')), /older than 24 hours/);
  assert.equal(g.calls.length, 0);
});

test('a source that fails is kept as a problem and the others still run', async () => {
  const g = fakeGraph({ 'GET /111/media': { data: [] }, 'GET /111/conversations': { error: { message: 'missing permission', code: 10 } } });
  const store = new SocialStore('');
  const desk = new SocialDesk({ client: client(g.fetchImpl, { pageToken: '' }), store, write: async () => '' });
  assert.deepEqual(await desk.poll(), []);
  assert.match(await desk.statusText(), /Facebook not connected/);
  assert.match(await desk.statusText(), /ig-messages: missing permission \(code 10\)/);
});

test('without tokens nothing is posted and nothing is read', async () => {
  const desk = new SocialDesk({ client: new MetaClient({}), store: new SocialStore(''), write: async () => 'x' });
  assert.match(await desk.draftPost({ image: Buffer.from('x') }), /not connected yet/);
  assert.deepEqual(await desk.poll(), []);
});

test('the system-user way: the Page token and the Instagram account are read once, Instagram goes through graph.facebook.com', async () => {
  const g = fakeGraph({
    'GET /222': (u) => { assert.equal(u.searchParams.get('access_token'), 'SYS'); return { access_token: 'PAGE', instagram_business_account: { id: '333' } }; },
    'GET /333/media': (u) => { assert.equal(u.hostname, 'graph.facebook.com'); assert.equal(u.searchParams.get('access_token'), 'PAGE'); return { data: [] }; },
    'GET /222/conversations': (u) => ({ data: [] }),
    'GET /222/feed': { data: [] },
  });
  const c = new MetaClient({ pageId: '222', systemToken: 'SYS', fetchImpl: g.fetchImpl, wait: async () => {} });
  const desk = new SocialDesk({ client: c, store: new SocialStore(''), write: async () => '' });
  assert.equal(desk.enabled, false, 'nothing is known before the first look');
  assert.deepEqual(await desk.poll(), []);
  assert.equal(c.igUserId, '333');
  assert.equal(desk.enabled, true);
  assert.equal(g.calls.filter((x) => x.key === 'GET /222').length, 1);
  assert.equal(g.calls.filter((x) => x.key === 'GET /222/conversations').length, 2, 'Instagram and Facebook messages are both read from the Page');
  assert.match(await desk.statusText(), /Instagram connected, Facebook connected/);
});

test('«پست کاتالوگ ۱۸۰۵»: the code in any digits, the owner words after it', () => {
  assert.deepEqual(catalogRequest('پست کاتالوگ ۱۸۰۵'), { code: '1805', note: '' });
  assert.deepEqual(catalogRequest('post catalogue 212 for kitchens'), { code: '212', note: 'for kitchens' });
  assert.deepEqual(catalogRequest('پست کاتالوگ کد ts840: رنگ ویژه'), { code: 'TS840', note: 'رنگ ویژه' });
  assert.equal(catalogRequest('پست رنگ جدید'), null);
  assert.equal(catalogRequest('پست کاتالوگ'), null);
});

test('a catalogue colour: its own picture and its code go to the caption; an unknown code is said with the known ones', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-'));
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ 1812: { file: '1812.jpg', catalogue: 'TEST film catalogue', kind: 'marble' }, 212: { file: '212.jpg', catalogue: 'TEST catalogue' } }));
  fs.writeFileSync(path.join(dir, '1812.jpg'), Buffer.from('JPEG-1812'));
  const writes = [];
  const g = fakeGraph({});
  const desk = new SocialDesk({ client: client(g.fetchImpl), store: new SocialStore(''), catalogDir: dir, write: async (r) => { writes.push(r); return 'Marble look. Code 1812.'; } });
  const out = await desk.draftFromCatalog(catalogRequest('پست کاتالوگ ۱۸۱۲ برای کابینت'));
  assert.match(out, /Post #SP1/);
  assert.equal(writes[0].image.toString(), 'JPEG-1812', 'the catalogue picture is sent as it is (already 4:5)');
  assert.match(writes[0].text, /colour code 1812 from the TEST film catalogue \(marble\)/);
  assert.match(writes[0].text, /The owner's note: برای کابینت/);
  assert.match(await desk.draftFromCatalog({ code: '999', note: '' }), /no colour 999 in the catalogues\. Known codes: 2/);
  assert.equal(g.calls.length, 0, 'nothing reaches Meta before the yes');
});

test('a tall phone photo is cut to 4:5 for Instagram; a square one is kept; an unreadable one is left as it is', async () => {
  const sharp = (await import('sharp')).default;
  const tall = await sharp({ create: { width: 900, height: 1600, channels: 3, background: '#888' } }).png().toBuffer();
  const m1 = await sharp(await fitForInstagram(tall)).metadata();
  assert.equal(m1.width, 900); assert.equal(m1.height, 1125); assert.equal(m1.format, 'jpeg');
  const wide = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#888' } }).png().toBuffer();
  const m2 = await sharp(await fitForInstagram(wide)).metadata();
  assert.ok(Math.abs(m2.width / m2.height - 1.91) < 0.01 && m2.width <= 1440);
  const sq = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#888' } }).png().toBuffer();
  const m3 = await sharp(await fitForInstagram(sq)).metadata();
  assert.equal(m3.width, 800); assert.equal(m3.height, 800);
  assert.equal((await fitForInstagram(Buffer.from('not a picture'))).toString(), 'not a picture');
});
