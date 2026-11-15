// Atossa's design studio (the owner, 15/11): her morning research, the close-up and the Reel of a design, one yes for a swipeable post
// and its Reel, the codes on the owner's own photos, the weekly report. Meta and the models are fakes; nothing leaves the machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MetaClient, SocialDesk, SocialStore, conceptChoice, conceptsRequest, designEditRequest, goodHour, inspirationRequest, linkRequest, nextGoodTime, looksLikeDesignNote, parseSocialCommand, reelRequest, retouchRequest } from '../src/social.js';
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
  assert.deepEqual(reelArgs.details.map((x) => [x.seconds, x.zoom]), [[4.35, 0.18], [4.35, 0.18]], 'wood: longer and closer (whole beats at 80 BPM, plus the cross-fade)');
  assert.ok(reelArgs.hook, 'the Reel opens on the texture, very close');
  for (const sec of [reelArgs.seconds.room, reelArgs.seconds.hook, ...reelArgs.details.map((x) => x.seconds)]) assert.ok(Math.abs(((sec - 0.6) / 0.75) - Math.round((sec - 0.6) / 0.75)) < 1e-9, `${sec} s: cuts on the beat`);
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
  assert.deepEqual(args.details.map((x) => [x.seconds, x.zoom]), [[4.35, 0.18], [2.85, 0.1]]);
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
  assert.match(made[2].prompt, /redrawn for the owner who asked: «جزیره روشن‌تر»/);
  assert.match(made[2].images[0].label, /^The previous version/);
  assert.ok(writes.some((w) => w.kind === 'design-plan' && /He asks for this change: «جزیره روشن‌تر»/.test(w.text)), 'Atossa rewrites the plan around his words');
  assert.ok(writes.some((w) => w.kind === 'check-change'), 'the change is checked by eye');
  assert.match(d.text, /Post #SP1/);
  assert.match(desk.store.d.taste.at(-1).text, /chose concept «دو» and asked: جزیره روشن‌تر/);
  assert.match((await desk.chooseConcept({ n: 9 })).text, /no concept 9/);
  const before = made.length;
  await desk.chooseConcept({ n: 1, note: 'جزئیات و کیفیت بالاتر' });
  assert.ok(made.slice(before).every((m) => m.size === '4K'), 'a quality request: the edit and the close-ups at 4K');
  assert.match(made[before].prompt, /highest quality/);
});

test('the owner\'s change is checked: a redraw that does not show it is drawn once more with what it missed; the change is said', async () => {
  const { desk, made } = await studio();
  const plans = [{ title_fa: 'یک', room: 'library', parts: [{ code: 'HZ812', where: 'all doors' }], scene: 'A library.' }];
  const base = desk.write;
  const looks = [];
  desk.write = async (r) => {
    if (r.kind === 'concepts') return JSON.stringify(plans);
    if (r.kind === 'design-plan' && /He asks for this change/.test(r.text)) return JSON.stringify({ ...plans[0], scene: 'A much wider library.', change_fa: 'دوربین بازتر شد.' });
    if (r.kind === 'check-change') { looks.push(r); return looks.length === 1 ? '{"done":false,"missing":"the room is not wider"}' : '{"done":true}'; }
    return base(r);
  };
  await desk.draftConcepts({ family: 'HZ', n: 1 });
  const before = made.length;
  const d = await desk.chooseConcept({ n: 1, note: 'فضای بیشتری تو ویو باشه' });
  assert.equal(looks.length, 2);
  assert.equal(looks[0].images.length, 2, 'old and new side by side');
  assert.match(made[before].prompt, /A much wider library/);
  assert.match(made[before + 1].prompt, /The last try still missed: the room is not wider/);
  assert.match(d.text, /تغییر به خواست شما: دوربین بازتر شد/);
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

test('the Reel that walks around the room: two more views and close-ups crossed by a sideways move, no zoom', { skip: !fs.existsSync(await ffmpegPath()) && 'no ffmpeg here' }, async () => {
  const card = await endCard({ codes: [{ code: 'HZ812', swatch: await pic('#3a2a1e') }], line: 'WhatsApp +971000' });
  const mp4 = await makeReel({ room: await pic('#806040', 1440, 1800), views: [await pic('#705030', 1440, 1800), await pic('#604020', 1440, 1800)], motion: 'orbit',
    details: [{ image: await pic('#402010', 1440, 1800), seconds: 1.5 }], card, seconds: { room: 1.5, view: 1.5, detail: 1.5, card: 1 } });
  assert.equal(mp4.subarray(4, 8).toString(), 'ftyp');
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

test('the hours the Gulf looks: 12-14 and 19-22 Dubai time, Friday only the evening, Ramadan 21-01; the next good minute', () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(goodHour(at('2026-11-16T09:00:00Z')), true, 'Monday 13:00');
  assert.equal(goodHour(at('2026-11-16T06:00:00Z')), false, 'Monday 10:00');
  assert.equal(goodHour(at('2026-11-20T09:00:00Z')), false, 'Friday 13:00: the noon prayer');
  assert.equal(goodHour(at('2026-11-20T16:00:00Z')), true, 'Friday 20:00');
  assert.equal(goodHour(at('2027-02-10T15:00:00Z')), false, 'Ramadan 19:00: iftar');
  assert.equal(goodHour(at('2027-02-10T17:30:00Z')), true, 'Ramadan 21:30');
  assert.equal(goodHour(at('2027-02-10T20:30:00Z')), true, 'Ramadan 00:30');
  assert.equal(nextGoodTime(at('2026-11-16T06:07:00Z')), at('2026-11-16T08:00:00Z'), '10:07 waits for 12:00');
  assert.equal(nextGoodTime(at('2026-11-20T08:00:00Z')), at('2026-11-20T15:00:00Z'), 'Friday noon waits for 19:00');
  assert.equal(nextGoodTime(at('2026-11-16T15:30:00Z')), at('2026-11-16T15:30:00Z'), 'already good: now');
  assert.deepEqual(parseSocialCommand('بله پست ۱۳ الان'), { verb: 'yes', kind: 'SP', id: 'SP13', now: true });
  assert.deepEqual(parseSocialCommand('بله پست 13 همین الان'), { verb: 'yes', kind: 'SP', id: 'SP13', now: true });
  assert.deepEqual(parseSocialCommand('بله پست 13'), { verb: 'yes', kind: 'SP', id: 'SP13' });
});

test('the owner\'s yes outside the good hours: the post waits for the next one, «… الان» posts at once, «نه» cancels it; it goes out when due', async () => {
  const { desk } = await studio();
  let T = Date.parse('2026-11-16T06:00:00Z'); // Monday 10:00 Dubai
  desk.now = () => T;
  desk.cfg.postWindows = true;
  await desk.draftPost({ image: await pic('#806040'), note: 'kitchen' });
  assert.equal(desk.store.d.posts.SP1.pillar, 'real', 'the owner\'s own photo is a real job');
  const r = await desk.decidePost({ verb: 'yes', kind: 'SP', id: 'SP1' });
  assert.match(r, /goes out at 12:00 Dubai time/);
  assert.equal(desk.store.d.posts.SP1.state, 'scheduled');
  assert.match(await desk.decidePost({ verb: 'yes', kind: 'SP', id: 'SP1' }), /already goes out at 12:00/);
  assert.deepEqual(desk.duePosts(), [], 'not yet');
  assert.match(await desk.statusText(), /goes out at 12:00 Dubai time: #SP1/);
  T = Date.parse('2026-11-16T08:01:00Z');
  assert.deepEqual(desk.duePosts(), ['SP1']);
  assert.match(await desk.decidePost({ verb: 'yes', kind: 'SP', id: 'SP1', now: true }), /^Post #SP1:/, 'it goes out');
  T = Date.parse('2026-11-16T06:00:00Z');
  await desk.draftPost({ image: await pic('#806040'), note: 'wardrobe' });
  await desk.decidePost({ verb: 'yes', kind: 'SP', id: 'SP2' });
  assert.match(await desk.decidePost({ verb: 'no', kind: 'SP', id: 'SP2' }), /cancelled/);
  assert.deepEqual(desk.duePosts(), []);
  await desk.draftPost({ image: await pic('#806040'), note: 'door' });
  assert.match(await desk.decidePost({ verb: 'yes', kind: 'SP', id: 'SP3', now: true }), /^Post #SP3:/, '«الان»: at once');
});

test('the weekly mix: Atossa makes the kind the week is short of, the plan and the caption know it, the owner is asked for a real job once a week', async () => {
  const { desk, writes } = await studio();
  assert.equal(desk.nextPillar(), 'proof', 'an empty week starts with proof of the product');
  const T = Date.now();
  desk.store.d.posts = { SP91: { id: 'SP91', at: T, state: 'posted', pillar: 'proof' }, SP92: { id: 'SP92', at: T, state: 'posted', pillar: 'proof' }, SP93: { id: 'SP93', at: T, state: 'cancelled', pillar: 'inspiration' } };
  assert.equal(desk.nextPillar(), 'inspiration');
  assert.deepEqual(desk.weekMix(), { proof: 2, inspiration: 0, education: 0, transform: 0, real: 0 });
  assert.match(desk.realJobReminder(), /کار واقعی/);
  assert.equal(desk.realJobReminder(), '', 'once a week');
  const d = await desk.draftDesign({ pillar: 'education' });
  assert.match(writes.find((w) => w.kind === 'design-plan').text, /PILLAR: education/);
  assert.match(writes.find((w) => w.kind === 'caption').text, /three short, useful points/);
  assert.match(d.text, /نوع پست: آموزش/);
  assert.equal(Object.values(desk.store.d.posts).at(-1).pillar, 'education');
});

test('two concepts produced at once: each keeps its own post, picture, close-ups and note (live 15/11 they were mixed)', async () => {
  const { desk } = await studio();
  const plans = [
    { title_fa: 'کتابخانه', room: 'library', parts: [{ code: 'HZ812', where: 'all doors' }], scene: 'A library.' },
    { title_fa: 'اتاق خواب', room: 'bedroom', parts: [{ code: 'HZ812', where: 'headboard wall' }], scene: 'A bedroom.' },
  ];
  const base = desk.write;
  let slow = 0;
  desk.write = async (r) => {
    if (r.kind === 'concepts') return JSON.stringify(plans);
    if (r.kind === 'caption') { await new Promise((res) => setTimeout(res, slow++ === 0 ? 60 : 5)); return `Caption ${slow}`; }
    return base(r);
  };
  await desk.draftConcepts({ family: 'HZ', n: 2 });
  const [a, b] = await Promise.all([desk.chooseConcept({ n: 1 }), desk.chooseConcept({ n: 2 })]);
  const posts = Object.values(desk.store.d.posts);
  assert.equal(posts.length, 2);
  for (const p of posts) assert.ok(p.design, `post ${p.id} has its design`);
  assert.deepEqual(posts.map((p) => p.design.room).sort(), ['bedroom', 'library']);
  for (const p of posts) assert.ok((p.extras || []).every((f) => path.basename(f).startsWith(`${p.id}-`)), 'its own close-ups');
  assert.match(a.text, /کتابخانه/);
  assert.match(b.text, /اتاق خواب/);
});

test('the owner\'s links: TikTok by its oEmbed, Instagram by its link preview; Atossa looks at the pictures, answers in Persian, keeps them for her designs', async () => {
  assert.deepEqual(linkRequest('اینا رو ببین https://www.instagram.com/p/ABC/ و https://vm.tiktok.com/xyz/.'), { urls: ['https://www.instagram.com/p/ABC/', 'https://vm.tiktok.com/xyz/'], note: 'اینا رو ببین و' });
  assert.equal(linkRequest('بله پست ۱۲'), null);
  const { desk, writes } = await studio();
  const asked = [];
  const img = await pic('#8a6a4a', 900, 1100);
  const picture = { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => img.buffer.slice(img.byteOffset, img.byteOffset + img.length) };
  desk.fetchImpl = async (u, o = {}) => {
    asked.push({ u, ua: o.headers?.['User-Agent'] });
    if (u.startsWith('https://www.tiktok.com/oembed')) return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ thumbnail_url: 'https://cdn.tt/thumb.jpg', title: 'Walnut kitchen reveal', author_name: 'studio' }) };
    if (u === 'https://www.instagram.com/p/ABC/') return { ok: true, headers: { get: () => 'text/html' }, text: async () => '<meta property="og:image" content="https://cdn.ig/p.jpg?a=1&amp;b=2"><meta property="og:description" content="Fluted oak wardrobe">' };
    if (u === 'https://private.example/x') return { ok: true, headers: { get: () => 'text/html' }, text: async () => '<html>login</html>' };
    return picture;
  };
  const base = desk.write;
  desk.write = async (r) => (r.kind === 'owner-links' ? (writes.push(r), 'Post 1: fluted oak doors, HZ812 could make them.\nPost 2: a slow reveal Reel.\nفارسی: درهای شیاردار بلوط را با HZ812 می‌سازم.\nفارسی: ریلز آهسته را برای نمایش بافت به کار می‌برم.') : base(r));
  const text = await desk.studyLinks({ urls: ['https://www.instagram.com/p/ABC/', 'https://www.tiktok.com/@s/video/1', 'https://private.example/x'], note: 'این‌ها رو دوست دارم' });
  assert.match(asked.find((a) => a.u === 'https://www.instagram.com/p/ABC/').ua, /facebookexternalhit/, 'asked like a link preview');
  assert.ok(asked.some((a) => a.u === 'https://cdn.ig/p.jpg?a=1&b=2'), 'the og:image, unescaped');
  assert.ok(asked.some((a) => a.u === 'https://cdn.tt/thumb.jpg'), 'the TikTok thumbnail');
  const w = writes.find((x) => x.kind === 'owner-links');
  assert.equal(w.images.length, 2);
  assert.match(w.text, /Fluted oak wardrobe[\s\S]*Walnut kitchen reveal[\s\S]*این‌ها رو دوست دارم/);
  assert.match(text, /^آتوسا 2 پیوند را دید/);
  assert.match(text, /• درهای شیاردار بلوط/);
  assert.match(text, /1 پیوند باز نشد/);
  assert.doesNotMatch(desk.store.d.inspo[0].text, /فارسی/);
  desk.write = base;
  await desk.draftDesign({});
  assert.match(writes.find((x) => x.kind === 'design-plan').text, /Posts the owner sent you[\s\S]*fluted oak doors/);
  desk.fetchImpl = async () => ({ ok: true, headers: { get: () => 'text/html' }, text: async () => '' });
  assert.match(await desk.studyLinks({ urls: ['https://x.example/'] }), /نتوانست تصویر این پیوند/);
});

test('Atossa\'s morning look at Instagram: the most liked recent post of each design account, looked at, read by the designer', async () => {
  const { desk, writes } = await studio({ research: async () => '- Oak [AD]' });
  const now = Date.now();
  desk.client.igDiscover = async (a) => {
    if (a === 'gone') throw new Error('not found');
    return [
      { media_type: 'IMAGE', like_count: a === 'archdigest' ? 900 : 50, media_url: `https://cdn.ig/${a}-1.jpg`, permalink: `https://ig/${a}/1`, timestamp: new Date(now - 2 * 864e5).toISOString() },
      { media_type: 'VIDEO', like_count: 5000, thumbnail_url: `https://cdn.ig/${a}-old.jpg`, permalink: `https://ig/${a}/old`, timestamp: new Date(now - 40 * 864e5).toISOString() },
    ];
  };
  Object.defineProperty(desk.client, 'hasIg', { get: () => true });
  desk.cfg.watchAccounts = 'archdigest, dezeen gone';
  const got = [];
  const img = await pic('#8a6a4a', 900, 1100);
  desk.fetchImpl = async (u) => { got.push(u); return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => img.buffer.slice(img.byteOffset, img.byteOffset + img.length) }; };
  const base = desk.write;
  desk.write = async (r) => (r.kind === 'instagram-watch' ? (writes.push(r), '- Dark walnut galley kitchens [archdigest]') : base(r));
  await desk.draftDesign({});
  assert.deepEqual(got, ['https://cdn.ig/archdigest-1.jpg', 'https://cdn.ig/dezeen-1.jpg'], 'the fresh ones only, the most liked first, one per account');
  assert.match(writes.find((w) => w.kind === 'instagram-watch').text, /@archdigest, 900 likes/);
  assert.match(writes.find((w) => w.kind === 'design-plan').text, /What is working on Instagram now[\s\S]*Dark walnut galley/);
});

test('the owner\'s change to a drafted design: by quoting it or «تغییر پست N …»; redrawn, a new draft with the Reel as he asked, the old one set aside', async () => {
  assert.deepEqual(designEditRequest('خط های عمودی رو هم رنگ درب ها کن', '#SP22 the Reel'), { id: 'SP22', note: 'خط های عمودی رو هم رنگ درب ها کن' });
  assert.deepEqual(designEditRequest('تغییر پست ۲۲ موزیک عوض کن'), { id: 'SP22', note: 'موزیک عوض کن' });
  assert.equal(designEditRequest('بله پست ۲۲', '#SP22 the Reel'), null, 'a yes stays a yes');
  assert.equal(designEditRequest('خط های عمودی رو هم رنگ کن', 'no number here'), null);
  let reelArgs = null;
  const { desk, made, writes } = await studio({ reel: async (a) => { reelArgs = a; return Buffer.from('MP4'); } });
  const first = await desk.draftDesign({});
  const id = /Post #(SP\d+)/.exec(first.text)[1];
  assert.ok(desk.store.d.posts[id].design.plan.scene, 'the whole plan is kept with the post');
  const base = desk.write;
  desk.write = async (r) => {
    if (r.kind === 'design-plan' && /He asks for this change/.test(r.text)) { writes.push(r); return JSON.stringify({ title_fa: 'آشپزخانه', room: 'kitchen', parts: [{ code: 'HZ812', where: 'doors and the vertical strips' }], scene: 'Strips in the door colour.', change_fa: 'نوارهای عمودی هم‌رنگ درها شد.', reel: { seconds: 22, music: 'warm oud and piano', motion: 'orbit' } }); }
    if (r.kind === 'check-change') return '{"done":true}';
    return base(r);
  };
  const before = made.length;
  const d = await desk.reviseDesign({ id, note: 'خط های عمودی هم رنگ درب ها، ریلز بلندتر، موزیک عوض، چرخش دوربین' });
  assert.equal(desk.store.d.posts[id].state, 'replaced');
  const nid = /Post #(SP\d+)/.exec(d.text)[1];
  assert.notEqual(nid, id);
  assert.equal(desk.store.d.posts[id].replacedBy, nid);
  assert.match(d.text, /تغییر به خواست شما: نوارهای عمودی هم‌رنگ درها شد/);
  assert.match(d.text, /کنار گذاشته شد/);
  assert.match(made[before].prompt, /redrawn for the owner who asked/);
  assert.equal(reelArgs.motion, 'orbit');
  assert.equal(reelArgs.views.length, 2, 'two more camera places');
  assert.ok(made.some((m) => /wide establishing shot from the far opposite corner/.test(m.prompt)), 'a really different camera place');
  const total = reelArgs.seconds.room + reelArgs.views.length * (reelArgs.seconds.view - 0.6) + reelArgs.details.reduce((a, x) => a + x.seconds - 0.6, 0) + reelArgs.seconds.card - 0.6;
  assert.ok(Math.abs(total - 22) < 1, `about 22 s (${total.toFixed(1)})`);
  assert.match((await desk.decidePost({ verb: 'yes', kind: 'SP', id })), /already replaced/, 'the old draft cannot be posted');
  assert.match((await desk.reviseDesign({ id, note: 'x' })).text, /already replaced/);
});

test('«ریلز پست N»: only the Reel made again from the post\'s own unmarked pictures, walking around the room; an older post is unmarked first', async () => {
  assert.deepEqual(reelRequest('ریلز پست ۲۴'), { id: 'SP24', note: '' });
  assert.deepEqual(reelRequest('ریلز ۲۴ بلندتر'), { id: 'SP24', note: 'بلندتر' });
  assert.equal(reelRequest('پست ۲۴'), null);
  let reelArgs = null;
  const { desk, made } = await studio({ reel: async (a) => { reelArgs = a; return Buffer.from('MP4'); } });
  const id = /Post #(SP\d+)/.exec((await desk.draftDesign({})).text)[1];
  const p = desk.store.d.posts[id];
  assert.ok(fs.existsSync(p.raw.room) && p.raw.shots.length, 'the unmarked room and close-ups are kept');
  const before = made.length;
  const oldReel = p.reel;
  const r = await desk.remakeReel({ id });
  assert.equal(reelArgs.motion, 'orbit');
  assert.equal(reelArgs.views.length, 2);
  assert.ok(made.slice(before).every((m) => !/Remove the logo/.test(m.prompt)), 'its own pictures need no unmarking');
  assert.notEqual(p.reel, oldReel);
  assert.match(r.text, /ریلز تازهٔ پست/);
  delete p.raw;
  const before2 = made.length;
  await desk.remakeReel({ id });
  assert.ok(made.slice(before2).some((m) => /Remove the logo/.test(m.prompt)), 'an older post: the marks are taken off first');
  p.state = 'posted';
  assert.match((await desk.remakeReel({ id })).text, /already posted/);
});

test('a before/after: «پیش و پس», the room before made from the room after, first in the post and wiped away in the Reel', async () => {
  const { designRequest } = await import('../src/social.js');
  assert.deepEqual(designRequest('پیش و پس'), { code: '', note: '', pillar: 'transform' });
  assert.deepEqual(designRequest('قبل و بعد کد ۸۱۲ آشپزخانه'), { code: 'HZ812'.slice(0, 0) + '812', note: 'آشپزخانه', pillar: 'transform' });
  let reelArgs = null;
  const routes = { 'POST /222/photos': () => ({ id: `ph${Math.random()}` }), 'POST /222/feed': { id: '222_9' }, 'GET /ph.*': { images: [{ width: 10, source: 'https://x/p.jpg' }] }, 'GET /222_9': { permalink_url: 'https://fb/post' } };
  const { desk, made, writes } = await studio({ routes, reel: async (a) => { reelArgs = a; return Buffer.from('MP4'); } });
  const d = await desk.draftDesign({ pillar: 'transform' });
  const id = /Post #(SP\d+)/.exec(d.text)[1];
  const p = desk.store.d.posts[id];
  assert.ok(made.some((m) => /BEFORE the renovation/.test(m.prompt)), 'the before picture is made from the room');
  assert.ok(p.lead && fs.existsSync(p.lead));
  assert.ok(reelArgs.before, 'the Reel opens on the room before');
  assert.equal(reelArgs.hook, null);
  assert.match(writes.find((w) => w.kind === 'caption').text, /before and after/);
  assert.match(d.text, /نوع پست: پیش و پس/);
});

test('the Reel with the texture hook and a before wiped by the after: a real MP4', { skip: !fs.existsSync(await ffmpegPath()) && 'no ffmpeg here' }, async () => {
  const card = await endCard({ codes: [{ code: 'HZ812', swatch: await pic('#3a2a1e') }], line: 'WhatsApp +971000' });
  for (const extra of [{ hook: await pic('#402010', 1440, 1800) }, { before: await pic('#cccccc', 1440, 1800) }]) {
    const mp4 = await makeReel({ room: await pic('#806040', 1440, 1800), ...extra, details: [{ image: await pic('#402010', 1440, 1800), seconds: 1.35 }], card, seconds: { room: 1.35, hook: 1.35, before: 1.35, detail: 1.35, card: 1 } });
    assert.equal(mp4.subarray(4, 8).toString(), 'ftyp');
  }
});

test('«رتوش پست N»: a small fix of the room keeps the design; the picture is marked again and the Reel made again from it', async () => {
  assert.deepEqual(retouchRequest('رتوش پست ۲۵ کیف رنگی روی پیشخوان را بردار'), { id: 'SP25', note: 'کیف رنگی روی پیشخوان را بردار' });
  assert.equal(retouchRequest('رتوش پست ۲۵'), null, 'what to fix is needed');
  let reelArgs = null;
  const { desk, made, writes } = await studio({ reel: async (a) => { reelArgs = a; return Buffer.from('MP4'); } });
  const id = /Post #(SP\d+)/.exec((await desk.draftDesign({})).text)[1];
  const p = desk.store.d.posts[id];
  const caption = p.caption; const file = p.file;
  const before = made.length; const plans = writes.filter((w) => w.kind === 'design-plan').length;
  const r = await desk.retouch({ id, note: 'کیف رنگی روی پیشخوان را بردار' });
  assert.match(made[before].prompt, /Make only this small change: «کیف رنگی روی پیشخوان را بردار»[\s\S]*Keep everything else exactly/);
  assert.equal(writes.filter((w) => w.kind === 'design-plan').length, plans, 'the design is not planned again');
  assert.equal(p.caption, caption);
  assert.notEqual(p.file, file);
  assert.ok(r.image && r.video, 'the new picture and Reel are sent');
  assert.ok(reelArgs.room, 'the Reel made again');
  assert.match(r.text, /رتوش شد/);
});

test('plain words right after a design are a change to it; «like reel 24» tells Atossa how that Reel was made', async () => {
  assert.equal(looksLikeDesignNote('HZ816 طرح چوب سیاه است و حرکت دوربین مثل reel 24 شود'), true);
  assert.equal(looksLikeDesignNote('گزارش صندوق امروز'), false);
  assert.equal(looksLikeDesignNote('فاکتور کد ۲۱۲ رنگ سفید'), false, 'money words win');
  assert.equal(looksLikeDesignNote('سلام'), false);
  let reelArgs = null;
  const { desk, writes } = await studio({ reel: async (a) => { reelArgs = a; return Buffer.from('MP4'); } });
  assert.equal(desk.latestDesignDraft(), '');
  const a = /Post #(SP\d+)/.exec((await desk.draftDesign({})).text)[1];
  desk.store.d.posts[a].design.plan.reel = { seconds: 22, motion: 'orbit', music: 'oud' };
  const b = /Post #(SP\d+)/.exec((await desk.draftDesign({})).text)[1];
  desk.store.d.posts[b].at += 1;
  assert.equal(desk.latestDesignDraft(), b, 'the newest draft');
  const base = desk.write;
  desk.write = async (r) => (r.kind === 'check-change' ? '{"done":true}' : base(r));
  await desk.reviseDesign({ id: b, note: `حرکت دوربین مثل ریلز ${a.slice(2)} شود` });
  const asked = writes.filter((w) => w.kind === 'design-plan').at(-1).text;
  assert.match(asked, /the Reel of post \d+ was made with: \{"seconds":22,"motion":"orbit","music":"oud"\}/);
  void reelArgs;
});
