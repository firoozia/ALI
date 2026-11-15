// Atossa's design studio (the owner, 15/11): her morning research, the close-up and the Reel of a design, one yes for a swipeable post
// and its Reel, the codes on the owner's own photos, the weekly report. Meta and the models are fakes; nothing leaves the machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MetaClient, SocialDesk, SocialStore, conceptChoice, conceptsRequest, inspirationRequest } from '../src/social.js';
import { endCard, ffmpegPath, makeReel } from '../src/reel.js';

const sharp = (await import('sharp')).default;
const pic = (bg, w = 800, h = 1000) => sharp({ create: { width: w, height: h, channels: 3, background: bg } }).jpeg().toBuffer();
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function fakeGraph(routes) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    const key = `${opts.method} ${u.host === 'rupload.facebook.com' ? 'RUPLOAD ' : ''}${u.pathname.replace(/^\/(?:ig-api-upload\/)?v[\d.]+\//, '/')}`;
    const params = opts.body instanceof FormData ? Object.fromEntries([...opts.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '[file]'])) : typeof opts.body === 'string' ? Object.fromEntries(new URLSearchParams(opts.body)) : Object.fromEntries(u.searchParams);
    calls.push({ key, params, headers: opts.headers || {} });
    const hit = Object.entries(routes).find(([k]) => new RegExp(`^${k}$`).test(key));
    const body = hit ? (typeof hit[1] === 'function' ? hit[1](params) : hit[1]) : { error: { message: `no route ${key}` } };
    return { ok: !body.error, status: body.error ? 400 : 200, json: async () => body };
  };
  return { calls, fetchImpl };
}
const client = (fetchImpl) => new MetaClient({ pageId: '222', pageToken: 'PG', systemToken: 'SYS', igUserId: '111', fetchImpl, wait: async () => {} });

async function studio({ routes = {}, research = null, reel = null } = {}) {
  const cat = tmp('cat-');
  fs.writeFileSync(path.join(cat, 'catalog.json'), JSON.stringify({ HZ812: { file: 'HZ812.jpg', catalogue: 'T', look: 'dark walnut' }, 1805: { file: '1805.jpg', catalogue: 'T', look: 'light oak' } }));
  fs.writeFileSync(path.join(cat, 'HZ812.jpg'), await pic('#3a2a1e'));
  fs.writeFileSync(path.join(cat, '1805.jpg'), await pic('#c8b49a'));
  const writes = [];
  const made = [];
  const plan = { title_fa: 'آشپزخانه', why_fa: 'چرا', inspiration_fa: 'ایدهٔ شیار برنجی از ای‌دی', room: 'kitchen', parts: [{ code: 'HZ812', where: 'tall doors', where_fa: 'درهای قدی' }, { code: '1805', where: 'island' }], scene: 'A kitchen.' };
  const g = fakeGraph(routes);
  const desk = new SocialDesk({ client: client(g.fetchImpl), store: new SocialStore(''), catalogDir: cat, mediaDir: tmp('media-'), research, reel, cfg: { contact: '+971000' },
    imager: { enabled: true, make: async (r) => { made.push(r); return { image: await pic(made.length === 1 ? '#806040' : '#402010'), mime: 'image/jpeg' }; } },
    write: async (r) => { writes.push(r); return r.kind === 'design-plan' ? JSON.stringify(plan) : r.kind === 'focus' ? '{"x":0.7,"y":0.3}' : 'Design idea with Code HZ812.'; } });
  return { desk, writes, made, g };
}

test('her morning reading: once a day, kept, read by the designer; the inspiration is shown to the owner', async () => {
  let asked = 0;
  const { desk, writes } = await studio({ research: async ({ system }) => { asked++; assert.match(system, /Atossa, Creative Director/); assert.match(system, /Pinterest/); return '- Fluted walnut with brass [AD]\nفارسی: گردوی شیاردار.'; } });
  const d = await desk.draftDesign({});
  await desk.draftDesign({});
  assert.equal(asked, 1, 'once a day');
  assert.match(writes.find((w) => w.kind === 'design-plan').text, /Today's notes from the world's design press[\s\S]*Fluted walnut with brass \[AD\]/);
  assert.match(writes.find((w) => w.kind === 'design-plan').system, /Atossa, Creative Director/);
  assert.match(d.text, /الهام: ایدهٔ شیار برنجی از ای‌دی/);
});

test('a design: one close-up per film (up to three, wood first, closer along the grain), and a Reel that visits each film (wood longer)', async () => {
  let reelArgs = null;
  const { desk, made } = await studio({ reel: async (a) => { reelArgs = a; return Buffer.from('MP4'); } });
  const d = await desk.draftDesign({});
  assert.equal(made.length, 3, 'the room, then a close-up of each of the two films');
  assert.deepEqual(made[1].images.map((i) => i.label), ['The room', 'Reference: film HZ812']);
  assert.deepEqual(made[2].images.map((i) => i.label), ['The room', 'Reference: film 1805']);
  assert.match(made[1].prompt, /about 30 cm from the tall doors in film HZ812, looking along the wood grain/);
  assert.equal(d.details.length, 2);
  assert.deepEqual(d.details.map((x) => x.code), ['HZ812', '1805']);
  assert.ok(d.video);
  assert.deepEqual(reelArgs.focus, { x: 0.7, y: 0.3 });
  assert.deepEqual(reelArgs.details.map((x) => [x.seconds, x.zoom]), [[4.5, 0.18], [4.5, 0.18]], 'wood: longer and closer');
  const p = desk.store.d.posts.SP1;
  assert.equal(p.extras.length, 2);
  assert.ok(fs.existsSync(p.reel));
  assert.match(d.text, /With the post: 2 close-ups \(HZ812, 1805\) and a Reel; one yes posts them all\./);
});

test('a stone or solid film gets a gentler, shorter look; wood comes first even when listed second', async () => {
  const { desk } = await studio();
  const cat = desk.catalog();
  cat.HZ812.look = 'dark grey marble with gold veins';
  fs.writeFileSync(path.join(desk.catalogDir, 'catalog.json'), JSON.stringify(cat));
  assert.equal(desk.isWood('HZ812'), false);
  assert.equal(desk.isWood('1805'), true);
  const shots = [];
  desk.closeUp = async (room, part) => { shots.push(part.code); return room; };
  let args = null;
  desk.reel = async (a) => { args = a; return Buffer.from('MP4'); };
  await desk.draftDesign({});
  assert.deepEqual(shots, ['1805', 'HZ812'], 'the wood first');
  assert.deepEqual(args.details.map((x) => [x.seconds, x.zoom]), [[4.5, 0.18], [3, 0.1]]);
});

test('concepts: «پیشنهادهای اچ‌زد», numbered rooms of that catalogue only; «شماره ۲ …» edits that one and produces it in full', async () => {
  assert.deepEqual(conceptsRequest('پیشنهادهای اچ‌زد'), { family: 'HZ', n: 4, note: '' });
  assert.deepEqual(conceptsRequest('پیشنهاد اچ‌زد ۳ آشپزخانه'), { family: 'HZ', n: 3, note: 'آشپزخانه' });
  assert.deepEqual(conceptsRequest('پیشنهادهای کاتالوگ جدید'), { family: 'HZ', n: 4, note: '' });
  assert.equal(conceptsRequest('پیشنهاد طرح'), null);
  assert.deepEqual(conceptChoice('شماره ۲ جزیره روشن‌تر'), { n: 2, note: 'جزیره روشن‌تر' });
  assert.deepEqual(conceptChoice('شماره 1'), { n: 1, note: '' });
  assert.deepEqual(conceptChoice('شماره یک ولی جزئیات و کیفیت بالاتری ارائه بده'), { n: 1, note: 'جزئیات و کیفیت بالاتری ارائه بده' });
  assert.deepEqual(conceptChoice('پیشنهاد دوم'), { n: 2, note: '' });
  assert.equal(conceptChoice('شماره یکی از این‌ها'), null);
  const { desk, writes, made } = await studio();
  const plans = [
    { title_fa: 'یک', room: 'kitchen', parts: [{ code: 'HZ812', where: 'all doors' }], scene: 'A monochrome kitchen.' },
    { title_fa: 'دو', room: 'wardrobe', parts: [{ code: 'HZ812', where: 'doors' }, { code: '1805', where: 'shelves' }], scene: 'A wardrobe.' },
  ];
  const base = desk.write;
  desk.write = async (r) => (r.kind === 'concepts' ? JSON.stringify(plans) : base(r));
  const list = await desk.draftConcepts({ family: 'HZ', n: 2 });
  assert.deepEqual(list.map((x) => x.n), [1, 2]);
  assert.match(list[0].text, /^پیشنهاد شمارهٔ ۱|^پیشنهاد شمارهٔ 1/);
  assert.deepEqual(desk.store.d.concepts.items[1].plan.parts.map((p) => p.code), ['HZ812'], 'only the HZ films stay');
  assert.equal(made.length, 2, 'one room per concept, nothing more yet');
  assert.equal(Object.keys(desk.store.d.posts).length, 0, 'no post before the choice');
  const d = await desk.chooseConcept({ n: 2, note: 'جزیره روشن‌تر' });
  assert.match(made[2].prompt, /Edit this interior design exactly as the owner asks: «جزیره روشن‌تر»/);
  assert.equal(made[2].images[0].label, 'The design to edit');
  assert.match(d.text, /Post #SP1/);
  assert.match(desk.store.d.taste.at(-1).text, /chose concept «دو» and asked: جزیره روشن‌تر/);
  assert.match((await desk.chooseConcept({ n: 9 })).text, /no concept 9/);
  const before = made.length;
  await desk.chooseConcept({ n: 1, note: 'جزئیات و کیفیت بالاتر' });
  assert.ok(made.slice(before).every((m) => m.size === '4K'), 'a quality request: the edit and the close-ups at 4K');
  assert.match(made[before].prompt, /highest quality/);
});

test('Atossa and Dariush: he reads every plan before it is drawn, she revises what he sends back; the talk is shown; no composition twice', async () => {
  const { desk, writes } = await studio();
  const base = desk.write;
  const first = { title_fa: 'اول', room: 'kitchen', parts: [{ code: 'HZ812', where: 'tall doors' }], signature: 'modern kitchen, island with drum pendants, frontal', scene: 'A kitchen.' };
  const second = { title_fa: 'دوم', room: 'majlis', parts: [{ code: 'HZ812', where: 'wall panels' }], signature: 'Arabic contemporary majlis, low seating, panelled wall, corner view', scene: 'A majlis.' };
  desk.store.d.designs = [{ room: 'kitchen', codes: ['HZ812'], signature: 'modern kitchen, island with drum pendants, frontal' }];
  desk.write = async (r) => {
    if (r.kind === 'critique') return JSON.stringify([{ verdict: 'revise', notes: ['the same island again: make it a majlis'], hook: 'Walnut that hosts the evening', dialogue_fa: 'داریوش: تکراری است. آتوسا: مجلس می‌کنم.' }]);
    if (r.kind === 'design-plan') return JSON.stringify(/Dariush, your marketing partner/.test(r.text) ? second : first);
    return base(r);
  };
  const plan = await desk.designPlan({ code: 'HZ812' });
  assert.equal(plan.room, 'majlis', 'the revised plan is the one drawn');
  assert.equal(plan.hook, 'Walnut that hosts the evening');
  assert.match(plan.dialogue_fa, /داریوش/);
  const asks = [];
  desk.write = async (r) => { asks.push(r); return r.kind === 'critique' ? JSON.stringify([{ verdict: 'ok', notes: [], hook: 'h', dialogue_fa: 'خوب است' }]) : JSON.stringify(second); };
  await desk.designPlan({ code: 'HZ812' });
  assert.match(asks.find((r) => r.kind === 'critique').text, /island with drum pendants/, 'Dariush sees the recent compositions');
  assert.match(asks.find((r) => r.kind === 'design-plan').text, /never repeat them[\s\S]*island with drum pendants/, 'Atossa sees them too');
  assert.equal(asks.filter((r) => r.kind === 'design-plan').length, 1, 'an ok plan is not written twice');
  desk.remember(second);
  assert.match(desk.recentCompositions(), /Arabic contemporary majlis/);
  desk.write = async () => 'not json';
  assert.deepEqual(await desk.challenge([second]), [], 'Dariush unreadable: the plans stay as they are');
});

test('one yes: both pictures as one swipeable post on Facebook and Instagram, then the Reel on both', async () => {
  let photo = 0;
  const routes = {
    'POST /222/photos': () => ({ id: `ph${++photo}` }),
    'GET /ph\\d': () => ({ images: [{ width: 1440, source: 'https://cdn/x.jpg' }] }),
    'POST /222/feed': { id: '222_9' },
    'GET /222_9': { permalink_url: 'https://fb/post' },
    'POST /111/media': (q) => (q.media_type === 'CAROUSEL' ? { id: 'car' } : q.media_type === 'REELS' ? { id: 'reel', uri: 'https://rupload.facebook.com/ig-api-upload/v24.0/reel' } : { id: 'kid1' }),
    'GET /(kid1|car|reel)': { status_code: 'FINISHED' },
    'POST /111/media_publish': (q) => ({ id: `pub-${q.creation_id}` }),
    'GET /pub-car': { permalink: 'https://ig/p/car' },
    'GET /pub-reel': { permalink: 'https://ig/reel/1' },
    'POST /222/videos': { id: 'vid1' },
    'POST RUPLOAD /reel': { success: true },
  };
  const { desk, g } = await studio({ routes, reel: async () => Buffer.from('MP4') });
  await desk.draftDesign({});
  const out = await desk.handle({ verb: 'yes', kind: 'SP', id: 'SP1' });
  assert.match(out, /Facebook: posted \(3 pictures\) https:\/\/fb\/post/);
  assert.match(out, /Instagram: posted \(3 pictures\) https:\/\/ig\/p\/car/);
  assert.match(out, /Facebook video: posted/);
  assert.match(out, /Instagram Reel: posted https:\/\/ig\/reel\/1/);
  const feed = g.calls.find((c) => c.key === 'POST /222/feed');
  assert.deepEqual(JSON.parse(feed.params.attached_media), [{ media_fbid: 'ph1' }, { media_fbid: 'ph2' }, { media_fbid: 'ph3' }]);
  const carousel = g.calls.find((c) => c.key === 'POST /111/media' && c.params.media_type === 'CAROUSEL');
  assert.equal(carousel.params.children.split(',').length, 3);
  const up = g.calls.find((c) => c.key === 'POST RUPLOAD /reel');
  assert.equal(up.headers.Authorization, 'OAuth PG');
  assert.equal(up.headers.file_size, '3');
  assert.equal(desk.store.d.posts.SP1.state, 'posted');
});

test('the owner\'s own photo with «کد ۸۱۲»: the swatch and the code on the band; unknown numbers are left out', async () => {
  const { desk, writes } = await studio();
  await desk.draftPost({ image: await pic('#888888', 900, 1125), note: 'کابینت با کد ۸۱۲ و ۱۸۰۵، تلفن 0557' });
  assert.deepEqual(desk.codesIn('کد ۸۱۲ و ۱۸۰۵، تلفن 0557').map((c) => c.code), ['HZ812', '1805']);
  const { data, info } = await sharp(writes[0].image).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  const y = info.height - Math.round(info.width * 0.045);
  assert.ok(Math.abs(at(Math.round(info.width * 0.028) + 20, y)[0] - 0x3a) < 30, 'the first swatch (HZ812, dark walnut) on the band');
});

test('the weekly report: each post with its numbers, the colours seen most, in Persian', async () => {
  const routes = {
    'GET /ig1/insights': { data: [{ name: 'reach', values: [{ value: 900 }] }, { name: 'likes', values: [{ value: 40 }] }, { name: 'saved', values: [{ value: 12 }] }] },
    'GET /222_1': { reactions: { summary: { total_count: 7 } }, comments: { summary: { total_count: 2 } } },
  };
  const { desk } = await studio({ routes });
  desk.store.d.posts.SP1 = { id: 'SP1', state: 'posted', at: Date.now(), postedAt: Date.now(), ig: 'ig1', fb: '222_1', design: { codes: ['HZ812'] }, caption: '' };
  desk.store.d.posts.SP2 = { id: 'SP2', state: 'posted', at: Date.now() - 9 * 86400000, ig: 'old' };
  const t = await desk.weeklyText();
  assert.match(t, /گزارش هفتگی صفحه/);
  assert.match(t, /پست 1 \(HZ812\): اینستاگرام: دیده‌شده 900، پسند 40، نظر 0، ذخیره 12؛ فیس‌بوک: واکنش 7، نظر 2/);
  assert.match(t, /بیشتر دیده و ذخیره شدند: HZ812/);
  assert.doesNotMatch(t, /پست 2/, 'older than a week');
});

test('the Reel itself: an MP4 from two stills and the end card', { skip: !fs.existsSync(await ffmpegPath()) && 'no ffmpeg here' }, async () => {
  const card = await endCard({ codes: [{ code: 'HZ812', swatch: await pic('#3a2a1e') }], line: 'WhatsApp +971000' });
  const mp4 = await makeReel({ room: await pic('#806040', 1440, 1800), detail: await pic('#402010', 1440, 1800), card, seconds: { room: 2, detail: 2, card: 1 } });
  assert.ok(mp4.length > 1000);
  assert.equal(mp4.subarray(4, 8).toString(), 'ftyp', 'an MP4');
});

test('the Reel gets new music in the mood the designer chose; when the music model fails, a kept clip; with none, silence', async () => {
  let reelArgs = null;
  const { desk } = await studio({ reel: async (a) => { reelArgs = a; return Buffer.from('MP4'); } });
  desk.brandDir = tmp('brand-');
  const prompts = [];
  desk.imager.music = async (p) => { prompts.push(p); return Buffer.from('MP3-1'); };
  await desk.draftDesign({});
  assert.equal(reelArgs.music.toString(), 'MP3-1');
  assert.match(prompts[0], /Instrumental only, no vocals/);
  assert.equal(fs.readdirSync(path.join(desk.brandDir, 'music')).length, 1, 'kept');
  desk.imager.music = async () => { throw new Error('quota'); };
  assert.equal((await desk.reelMusic('calm')).toString(), 'MP3-1', 'a kept clip');
  desk.brandDir = tmp('brand-');
  assert.equal(await desk.reelMusic('calm'), null, 'silence');
});

test('Lyria: the audio of the model output is taken; its error is said', async () => {
  const { GeminiImage } = await import('../src/social.js');
  let sent;
  const ok = new GeminiImage({ apiKey: 'K', fetchImpl: async (u, o) => { sent = { u, o }; return { ok: true, status: 200, json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'text', text: '<instrumental>' }, { type: 'audio', data: Buffer.from('MP3').toString('base64') }] }] }) }; } });
  assert.equal((await ok.music('calm piano')).toString(), 'MP3');
  assert.match(sent.u, /\/v1beta\/interactions$/);
  assert.equal(JSON.parse(sent.o.body).model, 'lyria-3-clip-preview');
  const bad = new GeminiImage({ apiKey: 'K', fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) }) });
  await assert.rejects(bad.music('x'), /Lyria: quota/);
});

test('«الهام»: the picture of the owner guides the plan (Atossa sees it) and the room (a labelled mood reference), and is kept as his taste', async () => {
  assert.deepEqual(inspirationRequest('الهام آشپزخانه'), { note: 'آشپزخانه' });
  assert.deepEqual(inspirationRequest('inspiration'), { note: '' });
  assert.equal(inspirationRequest('الهامی نیست'), null);
  const { desk, writes, made } = await studio();
  const insp = await pic('#556677');
  await desk.draftDesign({ note: 'آشپزخانه', inspiration: { image: insp, mime: 'image/jpeg' } });
  const plan = writes.find((w) => w.kind === 'design-plan');
  assert.ok(plan.image.equals(insp), 'the designer sees the picture');
  assert.match(plan.text, /The owner liked the attached picture/);
  const ref = made[0].images.at(-1);
  assert.match(ref.label, /Mood and layout reference/);
  assert.ok(ref.buffer.equals(insp));
  assert.match(desk.store.d.taste.at(-1).text, /The owner's inspiration picture: kitchen \(آشپزخانه\)/);
});

test('the press pictures: the research names them, they are fetched (pictures only), looked at once, and the designer reads what they show', async () => {
  const { desk, writes } = await studio({ research: async () => '- Walnut with brass [AD]\nفارسی: گردو.\nIMAGES: https://img.example/a.jpg https://img.example/b.png https://img.example/page.html' });
  const fetched = [];
  desk.fetchImpl = async (u) => {
    fetched.push(u);
    if (u.endsWith('.html')) return { ok: true, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(4) };
    const b = await pic('#8a6a4a', 1200, 900);
    return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
  };
  const base = desk.write;
  desk.write = async (r) => (r.kind === 'press-pictures' ? 'Picture 1: walnut slats with brass.\nTogether: warm wood with thin brass lines.' : base(r));
  await desk.draftDesign({});
  assert.equal(fetched.length, 3);
  assert.doesNotMatch(desk.todayTrends(), /IMAGES/, 'the address line is not kept in the notes');
  assert.match(desk.todayLooks(), /Together: warm wood with thin brass lines/);
  assert.match(writes.find((w) => w.kind === 'design-plan').text, /What today's pictures from the design press show[\s\S]*thin brass lines/);
});
