import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GeminiImage, MetaClient, SocialDesk, SocialStore, brandDesign, catalogRequest, designRequest, fitForInstagram, parseSocialCommand, postRequest } from '../src/social.js';

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
  assert.deepEqual(catalogRequest('پست کاتالوگ اچ‌زد ۸۳۲'), { code: 'HZ832', note: '' });
  assert.deepEqual(catalogRequest('post catalogue hz 816 kitchen'), { code: 'HZ816', note: 'kitchen' });
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
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ HZ832: { file: '1812.jpg', catalogue: 'TEST signature catalogue' } }));
  await desk.draftFromCatalog(catalogRequest('پست کاتالوگ ۸۳۲'));
  assert.match(writes[1].text, /colour code HZ832 from the TEST signature catalogue/, 'the number alone finds its prefixed code');
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

test('«طرح»: alone the designer chooses; with a room; with a code built around it; any digits', () => {
  assert.deepEqual(designRequest('طرح ۸۳۲ کمد دیواری'), { code: '832', note: 'کمد دیواری' });
  assert.deepEqual(designRequest('طرح اچ‌زد ۸۱۶: آشپزخانه مدرن'), { code: 'HZ816', note: 'آشپزخانه مدرن' });
  assert.deepEqual(designRequest('design 212 kitchen'), { code: '212', note: 'kitchen' });
  assert.deepEqual(designRequest('طرح'), { code: '', note: '' });
  assert.deepEqual(designRequest('پیشنهاد طرح'), { code: '', note: '' });
  assert.deepEqual(designRequest('طرح آشپزخانه ویلا'), { code: '', note: 'آشپزخانه ویلا' });
  assert.equal(designRequest('طراحی جدید'), null, 'another word');
  assert.equal(designRequest('پست کاتالوگ ۸۳۲'), null);
});

test('the owner teaches the designer: a no with its reason, «سلیقه …»', () => {
  assert.deepEqual(parseSocialCommand('نه پست ۵ خیلی تیره است'), { verb: 'no', kind: 'SP', id: 'SP5', text: 'خیلی تیره است' });
  assert.deepEqual(parseSocialCommand('no #SP5'), { verb: 'no', kind: 'SP', id: 'SP5' });
  assert.deepEqual(parseSocialCommand('سلیقه: رنگ‌های روشن و چوب گرم'), { verb: 'taste', text: 'رنگ‌های روشن و چوب گرم' });
});

test('Gemini: the sample goes in as a picture with the prompt, 4:5 is asked, the final picture comes out; its error is said', async () => {
  const calls = [];
  const png = Buffer.from('PNG-ROOM');
  const ok = new GeminiImage({ apiKey: 'K', model: 'm-1', fetchImpl: async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { inlineData: { mimeType: 'image/png', data: Buffer.from('DRAFT').toString('base64') }, thought: true }, { text: 'Here it is' }, { inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] }) };
  } });
  const out = await ok.make({ prompt: 'a kitchen', images: [{ buffer: Buffer.from('SAMPLE'), mime: 'image/jpeg' }] });
  assert.equal(out.image.toString(), 'PNG-ROOM', 'the final picture, not a thought picture');
  assert.match(calls[0].url, /\/v1beta\/models\/m-1:generateContent$/);
  assert.equal(calls[0].opts.headers['x-goog-api-key'], 'K');
  assert.equal(calls[0].body.generationConfig.imageConfig.aspectRatio, '4:5');
  assert.equal(calls[0].body.generationConfig.imageConfig.imageSize, '2K', 'the sharper size by default');
  assert.equal(Buffer.from(calls[0].body.contents[0].parts[0].inline_data.data, 'base64').toString(), 'SAMPLE');
  assert.equal(calls[0].body.contents[0].parts[1].text, 'a kitchen');
  const bad = new GeminiImage({ apiKey: 'K', fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid' } }) }) });
  await assert.rejects(bad.make({ prompt: 'x' }), /Gemini: API key not valid/);
  const none = new GeminiImage({ apiKey: 'K', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }) }) });
  await assert.rejects(none.make({ prompt: 'x' }), /no picture \(IMAGE_SAFETY\)/);
  assert.equal(new GeminiImage({ apiKey: '' }).enabled, false);
});

test('the designer: looks once, a plan of films from the list, each film\'s picture labelled for Gemini, a draft with Persian reasons; the owner\'s answers teach her', async () => {
  const cat = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-'));
  fs.writeFileSync(path.join(cat, 'catalog.json'), JSON.stringify({ HZ832: { file: 'HZ832.jpg', catalogue: 'TEST signature', kind: 'stone look' }, HZ818: { file: 'HZ818.jpg', catalogue: 'TEST signature', kind: 'solid colour' } }));
  fs.writeFileSync(path.join(cat, 'HZ832.jpg'), Buffer.from('SAMPLE-832'));
  fs.writeFileSync(path.join(cat, 'HZ818.jpg'), Buffer.from('SAMPLE-818'));
  const writes = [];
  const made = [];
  const g = fakeGraph({});
  const plan = { title_fa: 'کمد سنگی با قاب کرم', why_fa: 'سنگ تیره با کرم روشن تعادل می‌سازد.', room: 'master bedroom wardrobe', parts: [{ code: 'hz832', where: 'wardrobe doors', where_fa: 'درهای کمد' }, { code: 'HZ818', where: 'side panels', where_fa: 'بدنه‌ها' }, { code: 'XX999', where: 'ceiling' }], scene: 'A calm bedroom; the wardrobe doors in film HZ832, side panels in film HZ818.' };
  const write = async (r) => { writes.push(r); return r.kind === 'look' ? `look of ${r.text.split(' ')[1]}` : r.kind === 'design-plan' ? `Here:\n${JSON.stringify(plan)}` : 'Design idea with Code HZ832 and Code HZ818.'; };
  const imager = { enabled: true, make: async (r) => { made.push(r); return { image: Buffer.from('ROOM'), mime: 'image/png' }; } };
  const desk = new SocialDesk({ client: client(g.fetchImpl), store: new SocialStore(''), catalogDir: cat, mediaDir: dir(), imager, write });
  const out = await desk.draftDesign(designRequest('طرح کمد دیواری'));
  // the looks: asked once from each picture, kept in catalog.json
  assert.equal(writes.filter((w) => w.kind === 'look').length, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cat, 'catalog.json'), 'utf8')).HZ818.look, 'look of HZ818');
  // the plan: the designer reads every film's look and the owner's words
  const asked = writes.find((w) => w.kind === 'design-plan');
  assert.match(asked.prefix, /^The films \(code: look \[catalogue\]\):[\s\S]*HZ832: look of HZ832 \[TEST signature\]/); // the film list is the cached first block (the owner, 19/11: the cost)
  assert.match(asked.text, /The owner's words: کمد دیواری/);
  assert.equal(asked.effort, 'medium');
  // Gemini: each film's own picture, labelled with its place; an unknown code is dropped
  assert.deepEqual(made[0].images.map((i) => [i.label, i.buffer.toString()]), [['Reference: film HZ832, for wardrobe doors', 'SAMPLE-832'], ['Reference: film HZ818, for side panels', 'SAMPLE-818']]);
  assert.match(made[0].prompt, /^A calm bedroom; .*\nThe camera stands inside the room, at eye level, far enough back that the WHOLE room[^\n]*\nEach labelled reference picture is the exact surface film/);
  // the draft: the picture, the designer's Persian reasons above the caption
  assert.equal(out.image.toString(), 'ROOM');
  assert.match(out.text, /^پیشنهاد طراحی: کمد سنگی با قاب کرم\nسنگ تیره با کرم روشن تعادل می‌سازد\.\n• کد HZ832: درهای کمد\n• کد HZ818: بدنه‌ها/);
  assert.match(out.text, /Post #SP1/);
  assert.match(writes.at(-1).text, /AI design idea \(not a photo of a finished job\): master bedroom wardrobe, made with «Code HZ832» \(wardrobe doors\), «Code HZ818» \(side panels\)/);
  assert.equal(desk.designsWaiting(), 1);
  assert.equal(g.calls.length, 0, 'nothing reaches Meta before the yes');
  // a no with its reason is kept; the next plan reads it and the recent proposal
  assert.match(await desk.handle({ verb: 'no', kind: 'SP', id: 'SP1', text: 'too dark' }), /reason is kept/);
  assert.match(await desk.handle({ verb: 'taste', text: 'light colours' }), /Noted/);
  await desk.draftDesign({});
  const second = writes.filter((w) => w.kind === 'design-plan')[1];
  assert.match(second.text, /Rejected: master bedroom wardrobe with HZ832 \+ HZ818: too dark/);
  assert.match(second.text, /The owner says: light colours/);
  assert.match(second.text, /recent compositions[\s\S]*- master bedroom wardrobe: HZ832 \+ HZ818/);
  assert.equal(writes.filter((w) => w.kind === 'look').length, 2, 'the looks are not asked again');
});

test('the designer around a code: the code is kept as the main film; no key, an unknown code, a bad plan or a failed picture are said, no draft', async () => {
  const cat = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-'));
  fs.writeFileSync(path.join(cat, 'catalog.json'), JSON.stringify({ HZ832: { file: 'HZ832.jpg', catalogue: 'T', look: 'dark stone' }, HZ818: { file: 'HZ818.jpg', catalogue: 'T', look: 'cream' } }));
  fs.writeFileSync(path.join(cat, 'HZ832.jpg'), Buffer.from('S832'));
  fs.writeFileSync(path.join(cat, 'HZ818.jpg'), Buffer.from('S818'));
  const g = fakeGraph({});
  const made = [];
  const plan = { title_fa: 'ت', why_fa: 'چ', room: 'kitchen', parts: [{ code: 'HZ818', where: 'upper doors' }], scene: 'A kitchen.' };
  const writes = [];
  const desk = new SocialDesk({ client: client(g.fetchImpl), store: new SocialStore(''), catalogDir: cat, imager: { enabled: true, make: async (r) => { made.push(r); return { image: Buffer.from('R'), mime: 'image/png' }; } },
    write: async (r) => { writes.push(r); return r.kind === 'clean-check' ? '{"text":false,"collage":false,"mismatch":"","hidden":false}' : r.kind === 'check-change' ? '{"done":true,"missing":""}' : r.kind === 'design-plan' ? JSON.stringify(plan) : 'caption'; } });
  await desk.draftDesign(designRequest('طرح ۸۳۲ آشپزخانه'));
  assert.match(writes[0].text, /built around film HZ832: it is the main film/);
  assert.deepEqual(made[0].images.map((i) => i.buffer.toString()), ['S832', 'S818'], 'the asked code is added when the designer left it out');
  assert.match((await new SocialDesk({ client: client(g.fetchImpl), store: new SocialStore(''), catalogDir: cat, write: async () => 'x' }).draftDesign({})).text, /not connected yet/);
  assert.match((await desk.draftDesign({ code: '999' })).text, /no colour 999/);
  const bad = new SocialDesk({ client: client(g.fetchImpl), store: new SocialStore(''), catalogDir: cat, imager: { enabled: true, make: async () => ({}) }, write: async () => 'no json here' });
  assert.match((await bad.draftDesign({})).text, /gave no plan/);
  const failing = new SocialDesk({ client: client(g.fetchImpl), store: new SocialStore(''), catalogDir: cat, imager: { enabled: true, make: async () => { throw new Error('Gemini: quota'); } }, write: async () => JSON.stringify(plan) });
  assert.match((await failing.draftDesign({})).text, /could not be made: Gemini: quota/);
  assert.equal(Object.keys(failing.store.d.posts).length, 0);
});

test('Gemini: a label goes before its reference picture', async () => {
  let body;
  const gi = new GeminiImage({ apiKey: 'K', fetchImpl: async (u, o) => { body = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'UA==' } }] } }] }) }; } });
  await gi.make({ prompt: 'P', images: [{ label: 'Reference: film A', buffer: Buffer.from('A') }, { buffer: Buffer.from('B') }] });
  assert.deepEqual(body.contents[0].parts.map((x) => x.text || Buffer.from(x.inline_data.data, 'base64').toString()), ['Reference: film A', 'A', 'B', 'P']);
});

test('the owner\'s mark on a design: the logo in the top corner, each film\'s swatch and code along the bottom; the size is kept; a bad picture is left as it is', async () => {
  const sharp = (await import('sharp')).default;
  const room = await sharp({ create: { width: 1000, height: 1250, channels: 3, background: '#808080' } }).jpeg().toBuffer();
  const logo = await sharp({ create: { width: 200, height: 150, channels: 4, background: { r: 214, g: 178, b: 94, alpha: 1 } } }).png().toBuffer();
  const swatch = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#ff0000' } }).jpeg().toBuffer();
  const out = await brandDesign(room, { logo, codes: [{ code: 'HZ802', swatch }, { code: '1813', swatch }] });
  const m = await sharp(out).metadata();
  assert.deepEqual([m.width, m.height], [1000, 1250], 'the picture keeps its size (Instagram\'s ratio)');
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 40);
  assert.ok(near(px(60, 60), [214, 178, 94]), 'the logo sits in the top corner');
  assert.ok(near(px(500, 600), [128, 128, 128]), 'the middle of the room is untouched');
  assert.ok(px(990, 1240).every((v) => v < 60), 'a dark band along the bottom');
  assert.ok(near(px(28 + 30, 1250 - 45), [255, 0, 0]), 'the first film\'s swatch on the band');
  assert.equal((await brandDesign(Buffer.from('not a picture'), { logo })).toString(), 'not a picture');
});

test('a catalogue post carries the logo too; without a logo on the server the picture is sent as it is', async () => {
  const sharp = (await import('sharp')).default;
  const cat = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-'));
  const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'));
  const sample = await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#808080' } }).jpeg().toBuffer();
  fs.writeFileSync(path.join(cat, 'catalog.json'), JSON.stringify({ 212: { file: '212.jpg', catalogue: 'T' } }));
  fs.writeFileSync(path.join(cat, '212.jpg'), sample);
  fs.writeFileSync(path.join(brand, 'logo.png'), await sharp({ create: { width: 200, height: 150, channels: 4, background: { r: 214, g: 178, b: 94, alpha: 1 } } }).png().toBuffer());
  const seen = [];
  const make = (brandDir) => new SocialDesk({ client: client(fakeGraph({}).fetchImpl), store: new SocialStore(''), catalogDir: cat, brandDir, write: async (r) => { seen.push(r.image); return 'caption'; } });
  await make(brand).draftFromCatalog({ code: '212' });
  const { data, info } = await sharp(seen[0]).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  assert.ok(Math.abs(at(45, 45)[0] - 214) < 40 && Math.abs(at(45, 45)[2] - 94) < 40, 'the gold logo in the top corner');
  assert.ok(Math.abs(at(400, 700)[0] - 128) < 20, 'the colour itself untouched');
  await make('').draftFromCatalog({ code: '212' });
  assert.ok(seen[1].equals(sample), 'no logo on the server: the picture as it is');
});

test('the owner\'s own photo carries the logo too, after the 4:5 cut', async () => {
  const sharp = (await import('sharp')).default;
  const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'));
  fs.writeFileSync(path.join(brand, 'logo.png'), await sharp({ create: { width: 200, height: 150, channels: 4, background: { r: 214, g: 178, b: 94, alpha: 1 } } }).png().toBuffer());
  const photo = await sharp({ create: { width: 900, height: 1600, channels: 3, background: '#808080' } }).jpeg().toBuffer();
  const seen = [];
  const desk = new SocialDesk({ client: client(fakeGraph({}).fetchImpl), store: new SocialStore(''), brandDir: brand, write: async (r) => { seen.push(r.image); return 'caption'; } });
  await desk.draftPost({ image: photo, note: 'new job' });
  const m = await sharp(seen[0]).metadata();
  assert.deepEqual([m.width, m.height], [900, 1125], 'cut to 4:5 first');
  const { data, info } = await sharp(seen[0]).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  assert.ok(Math.abs(at(40, 40)[0] - 214) < 40 && Math.abs(at(40, 40)[2] - 94) < 40, 'the gold logo in the top corner');
});

test('the black logo turns white on a dark corner and stays black on a light one', async () => {
  const sharp = (await import('sharp')).default;
  const logo = await sharp({ create: { width: 200, height: 150, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  const corner = async (bg) => {
    const out = await brandDesign(await sharp({ create: { width: 1000, height: 1250, channels: 3, background: bg } }).jpeg().toBuffer(), { logo });
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    return data[(60 * info.width + 60) * info.channels];
  };
  assert.ok(await corner('#f0f0f0') < 40, 'black on a light wall');
  assert.ok(await corner('#202020') > 215, 'white on a dark cabinet');
});

test('the preview names its picture; a «test» no teaches nothing', async () => {
  const media = dir();
  const desk = new SocialDesk({ client: client(fakeGraph({}).fetchImpl), store: new SocialStore(''), mediaDir: media, write: async () => 'caption' });
  const text = await desk.draftPost({ image: Buffer.from('PIC'), fitted: true });
  assert.equal(desk.draftPicture(text).toString(), 'PIC');
  assert.equal(desk.draftPicture('no post here'), null);
  desk.store.d.posts.SP1.design = { room: 'kitchen', codes: ['HZ1'] };
  assert.match(await desk.handle({ verb: 'no', kind: 'SP', id: 'SP1', text: 'آزمون' }), /A test: nothing was kept/);
  assert.equal((desk.store.d.taste || []).length, 0, 'a test answer is not the owner\'s taste');
});
