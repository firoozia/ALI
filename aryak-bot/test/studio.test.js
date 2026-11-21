// Atossa's design studio (the owner, 15/11): her morning research, the close-up and the Reel of a design, one yes for a swipeable post
// and its Reel, the codes on the owner's own photos, the weekly report. Meta and the models are fakes; nothing leaves the machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MetaClient, SocialDesk, SocialStore, approveDesignRequest, conceptChoice, conceptsRequest, designEditRequest, goodHour, inspirationRequest, linkRequest, nextGoodTime, looksLikeDesignNote, parseSocialCommand, reelOnlyNote, reelRequest, retouchRequest } from '../src/social.js';
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

async function studio({ routes = {}, research = null, reel = null, reelAuto = true, reveal = false, roomFirst = false, reelMotion = 'zoom' } = {}) {
  const cat = tmp('cat-');
  fs.writeFileSync(path.join(cat, 'catalog.json'), JSON.stringify({ HZ812: { file: 'HZ812.jpg', catalogue: 'T', look: 'dark walnut' }, 1805: { file: '1805.jpg', catalogue: 'T', look: 'light oak' } }));
  fs.writeFileSync(path.join(cat, 'HZ812.jpg'), await pic('#3a2a1e'));
  fs.writeFileSync(path.join(cat, '1805.jpg'), await pic('#c8b49a'));
  const writes = [];
  const made = [];
  const plan = { title_fa: 'آشپزخانه', why_fa: 'چرا', inspiration_fa: 'ایدهٔ شیار برنجی از ای‌دی', room: 'kitchen', parts: [{ code: 'HZ812', where: 'tall doors', where_fa: 'درهای قدی' }, { code: '1805', where: 'island' }], scene: 'A kitchen.' };
  const g = fakeGraph(routes);
  const desk = new SocialDesk({ client: client(g.fetchImpl), store: new SocialStore(''), catalogDir: cat, mediaDir: tmp('media-'), research, reel, cfg: { contact: '+971000', reelAuto, reveal, roomFirst, reelMotion },
    imager: { enabled: true, make: async (r) => { made.push(r); return { image: await pic(made.length === 1 ? '#806040' : '#402010'), mime: 'image/jpeg' }; } },
    write: async (r) => { writes.push(r); return r.kind === 'clean-check' ? '{"text":false,"collage":false,"mismatch":"","hidden":false}' : r.kind === 'check-change' ? '{"done":true,"missing":""}' : r.kind === 'design-plan' ? JSON.stringify(plan) : r.kind === 'focus' ? '{"x":0.7,"y":0.3}' : 'Design idea with Code HZ812.'; } });
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
  assert.equal(d.details.filter((x) => !x.board).length, 2);
  assert.deepEqual(d.details.filter((x) => !x.board).map((x) => x.code), ['HZ812', '1805']);
  assert.ok(d.video);
  assert.deepEqual(reelArgs.focus, { x: 0.7, y: 0.3 });
  // the owner's review of the Reels (17/11): the room first (never the cards), the cards a quick insert, quick cuts on the beat, at most 20 s
  const seq = reelArgs.sequence;
  assert.equal(reelArgs.open, 'room');
  assert.equal(seq[0].image, made[0].image ? seq[0].image : seq[0].image);
  assert.ok(seq[0].sec < (reelArgs.views.length ? 2.2 : 3.2), 'the opening is short (longer when no other camera place shows the room: live 17/11, the room was on screen 2 s)');
  assert.equal(reelArgs.intro.length, 2, 'two films: their pairing cards');
  assert.equal(seq[1].image, reelArgs.intro[1], 'the cards come right after the opening, never first');
  const wood = seq.filter((x) => x.label);
  assert.equal(wood.length, 2, 'each close-up says its film');
  assert.deepEqual(wood.map((x) => [x.sec, x.zoom]), [[3.35, 0.18], [3.35, 0.18]], 'wood: longer and closer (whole beats at 80 BPM, plus the quick cross-fade)');
  for (const x of seq) assert.ok(Math.abs(((x.sec - 0.35) / 0.75) - Math.round((x.sec - 0.35) / 0.75)) < 1e-9, `${x.sec} s: cuts on the beat`);
  assert.ok(seq.reduce((a, x) => a + x.sec, 0) - 0.35 * (seq.length - 1) + 2.5 - 0.35 <= 20, 'at most 20 s');
  assert.equal(new Set(seq.map((x) => x.image)).size, seq.length, 'every shot once');
  const p = desk.store.d.posts.SP1;
  assert.equal(p.extras.length, 3, 'two close-ups and the design board');
  assert.ok(fs.existsSync(p.reel));
  assert.match(d.text, /With the post: 2 close-ups \(HZ812, 1805\), the design board, a Reel; one yes posts them all\./);
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
  assert.deepEqual(args.sequence.filter((x) => x.label).map((x) => [x.sec, x.zoom]), [[3.35, 0.18], [2.6, 0.1]]); // a plain colour stays a little longer in its context view (the owner, 20/11)
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

test('Atossa and Dariush: he reads every plan before it is drawn and writes the hook; no second plan (the owner, 19/11: the cost); no composition twice', async () => {
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
  assert.equal(plan.room, 'kitchen', 'no second plan is written (the owner, 19/11)');
  assert.equal(plan.hook, 'Walnut that hosts the evening');
  assert.equal(plan.dialogue_fa, '', 'a talk about changes that were not made is not shown');
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
  // the room, two close-ups and the design board (17/11)
  assert.match(out, /Facebook: posted \(4 pictures\) https:\/\/fb\/post/);
  assert.match(out, /Instagram: posted \(4 pictures\) https:\/\/ig\/p\/car/);
  assert.match(out, /Facebook video: posted/);
  assert.match(out, /Instagram Reel: posted https:\/\/ig\/reel\/1/);
  const feed = g.calls.find((c) => c.key === 'POST /222/feed');
  assert.deepEqual(JSON.parse(feed.params.attached_media), [{ media_fbid: 'ph1' }, { media_fbid: 'ph2' }, { media_fbid: 'ph3' }, { media_fbid: 'ph4' }]);
  const carousel = g.calls.find((c) => c.key === 'POST /111/media' && c.params.media_type === 'CAROUSEL');
  assert.equal(carousel.params.children.split(',').length, 4);
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
  assert.match(plan.text, /The owner sent the attached picture as the design to make[\s\S]*Draw THE SAME ROOM[\s\S]*the same camera place/);
  assert.doesNotMatch(plan.text, /never repeat them/, 'his picture is followed, not novelty (the owner, 19/11)');
  assert.ok(!writes.some((w) => w.kind === 'critique'), 'Dariush does not send his picture back');
  const ref = made[0].images.at(-1);
  assert.match(ref.label, /The design to follow \(the owner's picture\): the same room, layout, main pieces and camera place/);
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
  // the link's own picture is kept for a design made from it at once (the owner, 18/11)
  assert.ok(Buffer.isBuffer(desk.linkIdea.image) && /fluted oak doors/.test(desk.linkIdea.text));
  desk.write = base;
  const seen = [];
  const draft = desk.draftDesign;
  desk.draftDesign = async (r) => (seen.push(r), { text: 'ok' });
  assert.deepEqual(await desk.designFromLink(), { text: 'ok' });
  assert.ok(seen[0].inspiration.image && /این‌ها رو دوست دارم[\s\S]*Design from the post the owner sent[\s\S]*fluted oak doors/.test(seen[0].note));
  assert.equal(await desk.designFromLink(), null, 'once only');
  desk.draftDesign = draft;
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
  assert.equal(reelArgs.views.length, 3, 'three more camera places (the owner, 20/11)');
  assert.ok(made.some((m) => /wide establishing shot from the far opposite corner/.test(m.prompt)), 'a really different camera place');
  const total = reelArgs.sequence.reduce((a, x) => a + x.sec, 0) - 0.35 * (reelArgs.sequence.length - 1) + reelArgs.seconds.card - 0.35;
  assert.ok(Math.abs(total - 22) < 2.5, `about the 22 s he asked (${total.toFixed(1)})`);
  assert.ok(reelArgs.sequence.filter((x) => x.move === 'pan').length >= 3, 'the camera walks around the room');
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
  assert.equal(reelArgs.views.length, 3);
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
  desk.write = async (r) => { if (r.kind === 'reel-wish') { writes.push(r); return '{}'; } return r.kind === 'check-change' ? '{"done":true}' : base(r); };
  await desk.reviseDesign({ id: b, note: `حرکت دوربین مثل ریلز ${a.slice(2)} شود` });
  const asked = (writes.filter((w) => w.kind === 'design-plan' || w.kind === 'reel-wish').at(-1) || {}).text || '';
  assert.match(asked, /the Reel of post \d+ was made with: \{"seconds":22,"motion":"orbit","music":"oud"\}/);
  void reelArgs;
});

test('a change that only asks about the Reel makes only the Reel again: the picture and the post stay (live 16/11, #SP23)', async () => {
  assert.equal(reelOnlyNote('اتوسا تایم ریلز اینو بیشتر کن چرخش دوربین در فضا هم باشه'), true);
  assert.equal(reelOnlyNote('رنگ درها روشن‌تر و ریلز بلندتر'), false, 'a change to the room too');
  assert.equal(reelOnlyNote('کابینت بالا حذف شود'), false);
  let reelArgs = null;
  const { desk, made, writes } = await studio({ reel: async (a) => { reelArgs = a; return Buffer.from('MP4'); } });
  const id = /Post #(SP\d+)/.exec((await desk.draftDesign({})).text)[1];
  const before = made.length; const posts = Object.keys(desk.store.d.posts).length;
  const base = desk.write;
  desk.write = async (r) => (r.kind === 'reel-wish' ? '{"seconds":22,"music":"","motion":"orbit"}' : base(r));
  const d = await desk.reviseDesign({ id, note: 'اتوسا تایم ریلز اینو بیشتر کن چرخش دوربین در فضا هم باشه' });
  assert.equal(Object.keys(desk.store.d.posts).length, posts, 'no new post');
  assert.equal(desk.store.d.posts[id].state, 'draft', 'the same post');
  assert.ok(made.slice(before).every((m) => !/redrawn for the owner/.test(m.prompt)), 'the room is not drawn again');
  assert.equal(reelArgs.motion, 'orbit');
  assert.match(d.text, /فقط ریلز را خواستید/);
  assert.ok(d.video);
  void writes;
});

test('the pairing cards and the open picture: «reveal» draws the same room opened, first in the album and dissolved in after the room', async () => {
  const { pairCards } = await import('../src/reel.js');
  const cards = await pairCards({ codes: [{ code: 'HZ812', swatch: await pic('#3a2a1e') }, { code: 'HZ818', swatch: await pic('#efe6d8') }] });
  assert.equal(cards.length, 2);
  const m = await sharp(cards[1]).metadata();
  assert.deepEqual([m.width, m.height], [1080, 1920]);
  assert.deepEqual(await pairCards({ codes: [{ code: 'HZ812', swatch: await pic('#3a2a1e') }] }), [], 'one film: no pairing');
  let reelArgs = null;
  const { desk, made } = await studio({ reveal: true, reel: async (a) => { reelArgs = a; return Buffer.from('MP4'); } });
  const base = desk.write;
  desk.write = async (r) => (r.kind === 'design-plan' ? JSON.stringify({ title_fa: 'آشپزخانه', room: 'kitchen', parts: [{ code: 'HZ812', where: 'tall doors' }], reel_open: 'texture', reveal: 'the tall pantry doors open on lit shelves', scene: 'A kitchen.' }) : base(r));
  const d = await desk.draftDesign({});
  const id = /Post #(SP\d+)/.exec(d.text)[1];
  const p = desk.store.d.posts[id];
  assert.ok(made.some((x) => /everything the same, except: the tall pantry doors open on lit shelves/.test(x.prompt)));
  assert.match(path.basename(p.extras[0]), /-open\.jpg$/, 'the open picture comes right after the room in the album');
  assert.ok(reelArgs.reveal, 'the Reel dissolves into it');
  assert.ok(reelArgs.hook && !reelArgs.intro.length, 'texture chosen: no cards');
  assert.ok(fs.existsSync(p.raw.reveal), 'kept for a Reel made again');
});

test('the Reel with pairing cards and the open room: a real MP4', { skip: !fs.existsSync(await ffmpegPath()) && 'no ffmpeg here' }, async () => {
  const { pairCards } = await import('../src/reel.js');
  const card = await endCard({ codes: [{ code: 'HZ812', swatch: await pic('#3a2a1e') }], line: 'WhatsApp +971000' });
  const intro = await pairCards({ codes: [{ code: 'HZ812', swatch: await pic('#3a2a1e') }, { code: 'HZ818', swatch: await pic('#efe6d8') }] });
  const mp4 = await makeReel({ room: await pic('#806040', 1440, 1800), intro, reveal: await pic('#907050', 1440, 1800), card, seconds: { room: 1.35, intro: 1.35, reveal: 1.35, card: 1 } });
  assert.equal(mp4.subarray(4, 8).toString(), 'ftyp');
});

test('the proposal of the day waits only for the last two days\' drafts: old unanswered ones do not stop it', async () => {
  const { desk } = await studio();
  const T = Date.now();
  desk.now = () => T;
  desk.store.d.posts = Object.fromEntries([1, 2, 3, 4].map((k) => [`SP${k}`, { id: `SP${k}`, at: T - 5 * 864e5, state: 'draft', design: { room: 'x', codes: [] } }]));
  assert.equal(desk.designsWaiting(), 0, 'five-day-old drafts do not count');
  desk.store.d.posts.SP9 = { id: 'SP9', at: T - 3600e3, state: 'draft', design: { room: 'x', codes: [] } };
  assert.equal(desk.designsWaiting(), 1);
});

test('«دوباره پست N»: a posted post whose Instagram Reel failed sends only that again; an upload is tried twice before it fails', async () => {
  assert.deepEqual(parseSocialCommand('دوباره پست ۳۱'), { verb: 'retry', kind: 'SP', id: 'SP31' });
  const { desk } = await studio();
  let tries = 0;
  desk.client.wait = async () => {};
  desk.client.igReel = async () => { tries++; if (tries < 2) throw new Error('Request processing failed'); return { id: 'R1', link: 'https://ig/reel/1' }; };
  desk.client.fbVideo = async () => { throw new Error('should not be sent again'); };
  Object.defineProperty(desk.client, 'hasIg', { get: () => true });
  const f = path.join(tmp('reel-'), 'x.mp4'); fs.writeFileSync(f, 'MP4');
  desk.store.d.posts.SP31 = { id: 'SP31', state: 'posted', reel: f, fbReel: 'V1', tiktok: 'T1', caption: 'c', at: Date.now() };
  const out = await desk.decidePost({ verb: 'retry', kind: 'SP', id: 'SP31' });
  assert.equal(tries, 2, 'tried twice');
  assert.match(out, /Instagram Reel: posted/);
  assert.equal(desk.store.d.posts.SP31.igReel, 'R1');
  assert.match(await desk.decidePost({ verb: 'retry', kind: 'SP', id: 'SP31' }), /nothing is missing/);
});

// ---- the owner's review of the Reels (17/11): each criticism is a rule that a test keeps
const alphaBox = async (png) => { // the rows and columns where a transparent layer has any mark
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let top = info.height; let bottom = -1; let left = info.width; let right = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] > 8) { top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); }
  return { top, bottom, left, right };
};

test('every mark of a Reel stays inside Instagram\'s safe area: the logo, and each close-up\'s label with the film\'s name (no band of codes at the bottom)', async () => {
  const { reelOverlay, shotLabel, SAFE } = await import('../src/reel.js');
  const logo = await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  const o = await alphaBox(await reelOverlay({ logo }));
  assert.ok(o.top >= SAFE.top - 20 && o.bottom < SAFE.bottom && o.left >= SAFE.left - 20 && o.right <= SAFE.right, `the logo ${JSON.stringify(o)}`);
  const l = await alphaBox(await shotLabel({ code: 'HZ810', name: 'Honey oak' }));
  assert.ok(l.top >= SAFE.top && l.bottom < SAFE.bottom && l.left >= SAFE.left && l.right <= SAFE.right, `the label ${JSON.stringify(l)}`);
});

test('the end card names each film under its code and says what to do; the pairing cards name the films too', async () => {
  const { pairCards } = await import('../src/reel.js');
  const codes = [{ code: 'HZ816', name: 'Black-green ash', swatch: await pic('#1d2420') }, { code: 'HZ827', name: 'Black-green solid', swatch: await pic('#1c231f') }];
  const lit = async (png, y0, y1) => { const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true }); let n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < info.width; x++) { const i = (y * info.width + x) * 3; if (data[i] > 150) n++; } return n; };
  const withNames = await endCard({ codes, line: 'WhatsApp +971000', cta: 'Send this code on WhatsApp' });
  const without = await endCard({ codes: codes.map(({ name, ...c }) => c), line: 'WhatsApp +971000' });
  assert.ok(await lit(withNames, 1220, 1290) > await lit(without, 1220, 1290) + 50, 'the names are drawn under the codes');
  assert.ok(await lit(withNames, 1440, 1510) > 200, 'the call to action is drawn');
  assert.equal((await pairCards({ codes })).length, 2);
});

test('an AI picture with text, a grid or a wrong film is drawn again with its fault named; a close-up wrong twice is left out', async () => {
  const { desk, made } = await studio({ reel: async () => Buffer.from('MP4') });
  const base = desk.write;
  let checks = 0;
  desk.write = async (r) => (r.kind === 'clean-check' ? (checks++, '{"text":true,"collage":false,"mismatch":"the oak is shown as deep carved grain"}') : base(r));
  const room = await pic('#806040');
  await assert.rejects(desk.closeUp(room, { code: 'HZ812', where: 'tall doors' }, await pic('#3a2a1e')), /not like the film or not clean 2 times/);
  assert.equal(checks, 2);
  assert.match(made.at(-1).prompt, /The last try was wrong: there is text, a label, a card or a logo in the picture; a film does not look like its sample: the oak is shown as deep carved grain/);
  // every try is drawn from the room, never from the sample alone (the owner, 20/11: SP43's close-ups came from another room); the check sees the room
  assert.deepEqual(made.at(-1).images.map((i) => i.label), ['The room', 'Reference: film HZ812']);
  assert.match(made.at(-1).prompt, /a part of the room picture seen closer: the same worktop, floor, materials, light and styled objects/);
  assert.deepEqual(made.at(-2).images.map((i) => i.label), ['The room', 'Reference: film HZ812']);
  for (const m of made.slice(-2)) assert.match(m.prompt, /exactly like the reference sample in colour, brightness and pattern scale, under clean neutral daylight/);
  for (const m of made) { assert.match(m.prompt, /No text, letters, numbers, labels/); assert.match(m.prompt, /never a collage, a grid/); assert.match(m.prompt, /never deep carved, brushed or embossed wood/); }
  desk.write = async (r) => (r.kind === 'clean-check' ? '{"text":false,"collage":false,"mismatch":""}' : base(r));
  assert.ok(await desk.closeUp(room, { code: 'HZ812', where: 'tall doors' }, await pic('#3a2a1e')), 'a clean close-up is kept');
});

test('a camera place that came back as the same framing is never used (live: the same doors twice in #SP31)', async () => {
  const { desk } = await studio();
  const base = desk.write;
  desk.write = async (r) => (r.kind === 'check-change' ? '{"done":false,"missing":"the same framing"}' : base(r));
  assert.deepEqual(await desk.otherAngles(await pic('#806040'), { parts: [] }), [], 'no view at all rather than the same picture again');
});

test('the Reels vary: never the same opening three times in a row, never the pairing cards in two Reels in a row', async () => {
  const opens = []; const pairs = [];
  const { desk } = await studio({ reel: async (a) => { opens.push(a.open); pairs.push(a.intro.length > 0); return Buffer.from('MP4'); } });
  for (let i = 0; i < 4; i++) await desk.draftDesign({});
  assert.deepEqual(opens, ['room', 'room', 'texture', 'room']);
  assert.deepEqual(pairs, [true, false, true, false]);
});

test('a Reel made from a chosen sequence: the labels shown on their shots, the sound held under full scale', { skip: !(await ffmpegPath()) }, async () => {
  const { shotLabel } = await import('../src/reel.js');
  const card = await endCard({ codes: [{ code: 'HZ812', name: 'Dark walnut', swatch: await pic('#3a2a1e') }], line: 'WhatsApp +971000', cta: 'Send this code on WhatsApp' });
  const mp4 = await makeReel({ room: await pic('#806040', 1440, 1800), card, fade: 0.35, seconds: { card: 1 }, sequence: [
    { image: await pic('#806040', 1440, 1800), sec: 1.1, move: 'push', zoom: 0.2 },
    { image: await pic('#402010', 1440, 1800), sec: 1.1, move: 'push', zoom: 0.18, label: await shotLabel({ code: 'HZ812', name: 'Dark walnut' }) },
  ] });
  assert.ok(mp4.length > 1000 && mp4.subarray(4, 8).toString() === 'ftyp', 'an MP4');
});

test('a Reel made again checks its stored pictures first (live 17/11: SP33\'s open picture, drawn before the rules, carried spec cards; the black close-up was a dark blur)', async () => {
  let reelArgs = null;
  const { desk } = await studio({ reveal: true, reel: async (a) => { reelArgs = a; return Buffer.from('MP4'); } });
  const id = /Post #(SP\d+)/.exec((await desk.draftDesign({})).text)[1];
  const p = desk.store.d.posts[id];
  const reveal = fs.readFileSync(p.raw.room); p.raw.reveal = p.raw.room + '.open.jpg'; fs.writeFileSync(p.raw.reveal, reveal);
  const shots = p.raw.shots.length;
  const asked = [];
  // the open picture carries a card, the first close-up hides its film, the room is clean
  desk.cleanCheck = async (image, refs = [], o = {}) => { asked.push(o.close ? 'close' : 'wide'); return asked.length === 2 ? { ok: false, problem: 'there is text' } : asked.length === 3 ? { ok: o.close !== true, problem: 'the film can hardly be seen' } : { ok: true, problem: '' }; };
  const r = await desk.remakeReel({ id });
  assert.equal(reelArgs.reveal, null, 'the open picture with a card is left out');
  assert.equal(reelArgs.details.length + (reelArgs.open === 'texture' ? 1 : 0), shots - 1, 'the hidden close-up is left out');
  assert.match(r.text, /کنار گذاشته شد/);
  assert.match(r.text, /عکس کشوی باز/);
  // a room with a fault: no Reel, the owner is told to redraw it
  desk.cleanCheck = async () => ({ ok: false, problem: 'a film does not look like its sample' });
  reelArgs = null;
  const bad = await desk.remakeReel({ id });
  assert.equal(reelArgs, null);
  assert.match(bad.text, /خود عکس اتاق ایراد دارد/);
  assert.match(bad.text, /تغییر پست/);
});

test('the pairing card is on the end card\'s dark ground (live 17/11: a cream card flashed white between dark shots); two films: «the code you like»', async () => {
  const { pairCards } = await import('../src/reel.js');
  const sharp = (await import('sharp')).default;
  const sw = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#808080' } }).jpeg().toBuffer();
  const [, both] = await pairCards({ codes: [{ code: 'HZ1', swatch: sw }, { code: 'HZ2', swatch: sw }] });
  const { data } = await sharp(both).extract({ left: 10, top: 10, width: 4, height: 4 }).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] < 40 && data[1] < 40 && data[2] < 40, 'dark ground');
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'social.js'), 'utf8');
  assert.match(src, /cta: codes\.length > 1 \? 'Send the code you like on WhatsApp' : 'Send this code on WhatsApp'/);
  assert.match(src, /this\.log\(`social: a view of the room was not used/);
});

test('SP34 review (17/11): a view is judged as another camera place (not the named lens), a solid close-up shows the lit surface itself, the open picture pushes into the open part', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'social.js'), 'utf8');
  assert.match(src, /changeSeen\(room, v\.image, 'the same room seen from a clearly different camera position: another side, height or distance[^']*it need not match any particular lens or corner\)\. A slightly closer, slightly wider or slightly shifted version of the same view is NOT done[^']*and it is clearly the same room: the same worktop, floor, walls, furniture, fronts and objects/);
  assert.match(src, /the film covers half to two thirds of the frame, evenly and clearly lit \(never a dark gradient or a shadow\)[^`]*never one lone flat door filling the frame/);
  assert.match(src, /in deep shadow, or covering less than half of the picture/);
  assert.match(src, /if \(reveal\) seq\.push\(\{ image: reveal, sec: onBeat\(2\.6\), move: 'push', zoom: 0\.3, cx: focus\.x, cy: focus\.y, cut: 'dissolve' \}\)/);
});

test('the camera moves in fractions of a pixel and every length is whole frames (the owner, 17/11: «small pauses»; zoompan stepped 4, 2, 4, 2 px)', async () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'reel.js'), 'utf8');
  assert.doesNotMatch(src, /zoompan=/);
  assert.match(src, /perspective=x0=.*interpolation=cubic:eval=frame/);
  assert.match(src, /settb=1\/\$\{fps\},setpts=N,fps=\$\{fps\}/);
  assert.match(src, /const fade = Math\.round\(cross \* fps\) \/ fps;/);
  assert.match(src, /n\(seq\[i\]\.sec\) \+ 4/);
});

test('an empty answer of a picture check is never a pass for a view, a close-up or a stored picture (live 17/11: the thinking used up 400 tokens; SP34\'s view with a black worktop went out)', async () => {
  const { desk } = await studio({});
  let asked = 0;
  desk.write = async (r) => { if (r.kind === 'clean-check' || r.kind === 'check-change') { asked++; assert.ok(r.maxTokens >= 3000, 'room for the thinking'); return ''; } return ''; };
  const pic = fs.readFileSync(path.join(desk.catalogDir, 'HZ812.jpg'));
  assert.deepEqual(await desk.cleanCheck(pic, [], { strict: true }), { ok: false, problem: 'the check of the picture could not be read' });
  assert.equal(asked, 2, 'asked once more before giving up');
  assert.equal((await desk.cleanCheck(pic)).ok, true, 'the room itself is not lost for an unreadable check');
  assert.equal((await desk.changeSeen(pic, pic, 'x', { strict: true })).done, false);
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'social.js'), 'utf8');
  assert.match(src, /any of them changed is not done', \{ strict: true \}\);\n\s*const clean = await this\.cleanCheck\(v\.image, \(plan\?\.parts[\s\S]{0,200}\{ strict: true \}\);/);
  assert.match(src, /\{ close: true, strict: true, scene: room \}\);\n\s*if \(look\.ok\) return fitForInstagram/);
  assert.match(src, /scene && v\.elsewhere === true && 'the detail is not from this room/); // a detail from another room is drawn again (the owner, 20/11)
});

test('the design board (the owner, 17/11): the room above, the real samples with code, name and part below; the last page of the album, sent to the owner', async () => {
  const { moodBoard } = await import('../src/reel.js');
  const sharp = (await import('sharp')).default;
  const swatch = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#a0522d' } }).jpeg().toBuffer();
  const room = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#cccccc' } }).jpeg().toBuffer();
  const b = await moodBoard({ room, codes: [{ code: 'HZ1', name: 'Honey oak', swatch }, { code: 'HZ2', name: 'Black', swatch }] });
  const m = await sharp(b).metadata();
  assert.deepEqual([m.width, m.height], [1080, 1350], 'a 4:5 page');
  const at = async (x, y) => [...(await sharp(b).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer())];
  const [r, g] = await at(540, 400); assert.ok(r > 180 && g > 180, 'the room above');
  const [dr, dg, db] = await at(20, 1330); assert.ok(dr < 40 && dg < 40 && db < 40, 'a dark band below');
  const [sr, sg, sb] = await at(355, 1060); assert.ok(sr > 130 && sg < 110 && sb < 80, 'the real sample, not a drawn one');
  const { desk } = await studio({ reel: async () => Buffer.from('MP4') });
  const d = await desk.draftDesign({});
  const id = /Post #(SP\d+)/.exec(d.text)[1];
  const p = desk.store.d.posts[id];
  assert.match(p.extras[p.extras.length - 1], /-board\.jpg$/, 'the last page of the album');
  assert.ok(d.details.some((x) => x.board), 'the owner sees it with the draft');
  assert.match(d.text, /the design board/);
});

test('SP35 review (17/11): a texture opening is a wood close-up only, the main film gets a third try at its close-up, a label fades in and out', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'social.js'), 'utf8');
  assert.match(src, /if \(open === 'texture' && !details\.some\(\(x\) => x\.wood\)\) open = 'room';/);
  assert.match(src, /const first = rest\.splice\(rest\.findIndex\(\(x\) => x\.wood\), 1\)\[0\];/);
  assert.match(src, /closeUp\(room, x, sw, \{ size, tries: 2 \}\)/); // the owner, 18/11: two tries for every close-up (the cost)
  const reel = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'reel.js'), 'utf8');
  assert.match(reel, /fade=t=in:st=\$\{a\.toFixed\(3\)\}:d=0\.3:alpha=1,fade=t=out/);
});

test('the cost of the pictures (the owner, 18/11): a second try and a Reel view use the cheap model at 1K, every picture is priced and counted', async () => {
  const { GeminiImage } = await import('../src/social.js');
  const { CostMeter } = await import('../src/cost.js');
  const asked = [];
  const ok = { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('x').toString('base64') } }] } }] }) };
  const meter = new CostMeter('', { now: () => Date.UTC(2026, 10, 18, 8) });
  const g = new GeminiImage({ apiKey: 'k', fetchImpl: async (u, o) => (asked.push({ u, size: JSON.parse(o.body).generationConfig.imageConfig.imageSize }), ok), onCost: (c) => meter.image(c) });
  await g.make({ prompt: 'a room' });
  await g.make({ prompt: 'again', cheap: true });
  assert.match(asked[0].u, /gemini-3-pro-image:generateContent/); assert.equal(asked[0].size, '2K');
  assert.match(asked[1].u, /gemini-3\.1-flash-image:generateContent/); assert.equal(asked[1].size, '1K');
  const t = meter.totals();
  assert.equal(t.image.n, 2); assert.equal(t.image.cheap, 1);
  assert.ok(Math.abs(t.image.usd - (0.134 + 0.067)) < 1e-9 && Math.abs(t.usd - t.image.usd) < 1e-9);
  assert.match(meter.line(), /عکس‌های استودیو: ۲ \(۱ ارزان\) ۰٫۲۰ دلار/);
  assert.match(meter.report(), /عکس‌های استودیوی آتوسا: ۲ عکس \(۱ با مدل ارزان\)/);
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'social.js'), 'utf8');
  assert.match(src, /make\(\{ cheap: k > 0, prompt: alone/); // a second close-up try
  assert.match(src, /for \(let i = 0; i < 1; i\+\+\) \{[^\n]*\n\s*try \{\n\s*const v = await this\.imager\.make\(\{ cheap: false,/); // one try per Reel view, on the main model (the owner, 21/11: the cheap one kept the same framing)
});

test('a design is first one picture of the whole space; «تایید پست N» makes the close-ups and the board; no design of the day by itself (the owner, 18/11)', async () => {
  let reels = 0;
  const { desk, made } = await studio({ reelAuto: false, roomFirst: true, reel: async () => { reels += 1; return Buffer.from('MP4'); } });
  const d = await desk.draftDesign({});
  const id = /Post #(SP\d+)/.exec(d.text)[1];
  const n = id.slice(2);
  assert.equal(made.length, 1, 'only the room is drawn');
  assert.ok(d.image && d.details.length === 0 && !d.video, 'one picture, nothing else');
  assert.ok(d.text.includes(`«تایید پست ${n}»`) && d.text.includes(`«ریلز پست ${n} بساز»`));
  assert.equal(desk.store.d.posts[id].design.stage, 'room');
  assert.equal(desk.latestRoomOnly(), id);
  const e = await desk.expandDesign(id);
  assert.equal(made.length, 3, 'a close-up of each of the two films');
  assert.ok(e.details.some((x) => x.board) && e.details.filter((x) => !x.board).length === 2);
  assert.match(e.text, new RegExp(`Post #${id}: 2 عکس نزدیک`));
  assert.equal(desk.store.d.posts[id].design.stage, 'full');
  assert.equal(desk.store.d.posts[id].raw.shots.length, 2);
  assert.equal(desk.store.d.posts[id].extras.length, 3);
  assert.equal(desk.latestRoomOnly(), '');
  assert.match((await desk.expandDesign(id)).text, /پیش‌تر ساخته شده‌اند/);
  assert.equal(reels, 0);
  for (const [t, want] of [['تایید پست ۴۰', 'SP40'], ['آتوسا تایید ۴۰', 'SP40'], ['تأیید', ''], ['تایید عکس های دیگه رو بده', ''], ['تایید پست 40 عکس‌های دیگر بساز', 'SP40']]) assert.equal(approveDesignRequest(t)?.id, want, t);
  assert.equal(approveDesignRequest('تایید', '#SP41 ...').id, 'SP41');
  assert.equal(approveDesignRequest('تایید فاکتور'), null);
  assert.equal(approveDesignRequest('بله پست ۴۰'), null);
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'config.js'), 'utf8');
  assert.match(src, /env\.SOCIAL_DESIGN_HOUR \|\| 'off'/, 'no design of the day unless set');
});

test('a design comes with its pictures only; its Reel is made when the owner asks (the owner, 18/11: a Reel costs a lot)', async () => {
  let reels = 0;
  const { desk } = await studio({ reelAuto: false, reel: async () => { reels += 1; return Buffer.from('MP4'); } });
  const d = await desk.draftDesign({});
  const id = /Post #(SP\d+)/.exec(d.text)[1];
  const n = id.slice(2);
  assert.equal(reels, 0, 'no Reel with the design');
  assert.equal(d.video, null);
  assert.ok(d.image && d.details.length >= 2, 'the room, the close-ups and the design board are sent');
  assert.ok(d.text.includes(`«ریلز پست ${n} بساز»`), 'he is told how to ask for the Reel');
  assert.ok(d.text.includes(`«آپلود کن پست ${n}»`), 'and how to post without it');
  assert.equal(desk.store.d.posts[id].reel, undefined);
  // a retouch of a post with no Reel makes no Reel
  const r = await desk.retouch({ id, note: 'کیف را بردار' });
  assert.equal(reels, 0);
  assert.equal(r.video, null);
  assert.match(r.text, /عکس تازه همین‌جاست/);
  // he asks: the Reel is made from the stored pictures
  const m = await desk.remakeReel({ id });
  assert.equal(reels, 1);
  assert.ok(m.video && desk.store.d.posts[id].reel);
});

test('«ریلز پست ۳۶ بساز», «آتوسا ریلز این رو بساز» (the post answered, else the newest design), «آپلود کن پست ۳۶» = «بله پست ۳۶»', () => {
  assert.deepEqual(reelRequest('ریلز پست ۳۶ بساز'), { id: 'SP36', note: '' });
  assert.deepEqual(reelRequest('آتوسا ریلز پست ۳۶ رو دوباره بساز'), { id: 'SP36', note: '' });
  assert.deepEqual(reelRequest('ریلز ۳۶ دوباره بساز'), { id: 'SP36', note: '' });
  assert.deepEqual(reelRequest('آتوسا ریلز این رو بساز', 'پیشنهاد طراحی … Post #SP36'), { id: 'SP36', note: '' });
  assert.deepEqual(reelRequest('اتوسا، ریلز اینو بساز'), { id: '', note: '' }, 'no number, no answer: the newest design');
  assert.deepEqual(reelRequest('ریلز بساز'), { id: '', note: '' });
  assert.equal(reelRequest('ریلز خیلی کوتاه بود'), null, 'words about a Reel are not a command to make one');
  assert.equal(reelRequest('آتوسا گزارش امروز'), null);
  assert.deepEqual(parseSocialCommand('آپلود کن پست ۳۶'), { verb: 'yes', kind: 'SP', id: 'SP36' });
  assert.deepEqual(parseSocialCommand('اتوسا اپلود کن پست 36'), { verb: 'yes', kind: 'SP', id: 'SP36' });
  assert.deepEqual(parseSocialCommand('پست ۳۶ رو آپلود کن'), { verb: 'yes', kind: 'SP', id: 'SP36' });
  assert.deepEqual(parseSocialCommand('آتوسا بله پست ۳۶'), { verb: 'yes', kind: 'SP', id: 'SP36' });
  assert.equal(parseSocialCommand('آپلود کن'), null, 'a post is never published without its number');
  assert.equal(parseSocialCommand('آپلود کن پیام ۳'), null, 'only a post is uploaded');
});

test('the main picture of a design is the whole room with its full decor; a close crop is drawn again (the owner, 18/11, SP37)', async () => {
  const { PILLARS, DARIUSH, DESIGNER_RULES, WIDE, CLEAN_RULES } = await import('../src/social.js');
  assert.doesNotMatch(PILLARS.proof.brief, /a close vignette \(one cabinet front/, 'proof is no longer a close vignette');
  assert.match(PILLARS.proof.brief, /A whole room/);
  assert.match(DARIUSH, /The whole space: the main picture always shows a whole room/);
  assert.match(DESIGNER_RULES, /24 to 28 mm lens/);
  assert.match(CLEAN_RULES, /"cropped"/);
  const { desk, made } = await studio();
  // the first room comes back cropped: drawn again from further back
  let n = 0;
  desk.write = async (r) => r.kind === 'clean-check' ? (n++ === 0 ? '{"text":false,"collage":false,"mismatch":"","hidden":false,"cropped":true}' : '{"text":false,"collage":false,"mismatch":"","hidden":false,"cropped":false}') : r.kind === 'check-change' ? '{"done":true,"missing":""}' : r.kind === 'design-plan' ? JSON.stringify({ title_fa: 'آشپزخانه', room: 'kitchen', parts: [{ code: 'HZ812', where: 'tall doors' }], scene: 'A kitchen.' }) : r.kind === 'focus' ? '{"x":0.5,"y":0.5}' : 'Design idea with Code HZ812.';
  await desk.draftDesign({});
  assert.ok(made[0].prompt.includes(WIDE), 'the first drawing asks for the whole room');
  assert.match(made[1].prompt, /The last try was wrong: only a part of the room is seen/);
  assert.ok(made[1].prompt.includes(WIDE));
  // a close-up is never refused for being a part of the room
  const c = await desk.cleanCheck(Buffer.from('x'), [], { close: true });
  assert.equal(typeof c.ok, 'boolean');
});

test('no open doors or drawers: the plan asks none, no open picture is drawn, the close-up proves the quality (the owner, 18/11)', async () => {
  const { DESIGNER_RULES, WIDE } = await import('../src/social.js');
  assert.match(DESIGNER_RULES, /"reveal":"always empty/);
  assert.match(DESIGNER_RULES, /every door and drawer closed/);
  assert.match(WIDE, /Every door and drawer is closed/);
  const { desk, made } = await studio();
  desk.write = async (r) => r.kind === 'clean-check' ? '{"text":false,"collage":false,"mismatch":"","hidden":false,"cropped":false}' : r.kind === 'check-change' ? '{"done":true,"missing":""}' : r.kind === 'design-plan' ? JSON.stringify({ title_fa: 'کمد', room: 'bedroom', reveal: 'the wardrobe doors open on lit shelves', parts: [{ code: 'HZ812', where: 'wardrobe doors' }], scene: 'A bedroom.' }) : r.kind === 'focus' ? '{"x":0.5,"y":0.5}' : 'Design idea with Code HZ812.';
  const d = await desk.draftDesign({});
  assert.ok(!made.some((m) => /except: the wardrobe doors open/.test(m.prompt)), 'no open picture is drawn');
  const id = /Post #(SP\d+)/.exec(d.text)[1];
  assert.equal(desk.store.d.posts[id].raw.reveal, undefined);
  assert.match(made[1].prompt, /proves the quality of the film[\s\S]*clean edge where the film wraps around the door edge[\s\S]*every door and drawer closed/);
});

test('the cost and the camera (the owner, 19/11): one press search a week shared by designs made at once; the camera inside the room; the studio writes on the cheaper model', async () => {
  let asked = 0;
  const { desk } = await studio({ research: async () => { asked++; await new Promise((r) => setTimeout(r, 20)); return '- Walnut [AD]'; } });
  await Promise.all([desk.researchTrends(), desk.researchTrends(), desk.researchTrends()]);
  assert.equal(asked, 1, 'three designs at once: one search');
  const t0 = desk.now();
  desk.now = () => t0 + 6 * 86400000;
  await desk.researchTrends();
  assert.equal(asked, 1, 'still fresh after six days');
  assert.match(desk.todayTrends(), /Walnut/);
  desk.now = () => t0 + 8 * 86400000;
  await desk.researchTrends();
  assert.equal(asked, 2, 'a new search after a week');
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'social.js'), 'utf8');
  assert.match(src, /never a close crop of one cabinet or corner; the camera always stands inside the room, never outside it/);
  assert.match(src, /never ask for a camera outside the room, in a doorway or through glass/);
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(index, /const STUDIO_PLAN_KINDS = new Set\(\['design-plan', 'critique', 'concepts', 'owner-links', 'press-pictures', 'instagram-watch', 'clean-check', 'check-change', 'spots'\]\)/); // the picture checks and the Reel's pointers too (the owner, 19/11 and 21/11)
  assert.match(index, /STUDIO_PLAN_KINDS\.has\(kind\) && config\.social\.planModel \? config\.social\.planModel : config\.model/);
  const cfg = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'config.js'), 'utf8');
  assert.match(cfg, /planModel: \(env\.SOCIAL_PLAN_MODEL \?\? 'claude-sonnet-5-5'\)/);
});

test('a top designer with a marketer\'s eye; every room styled to the last detail, never an empty room behind the glass (the owner, 19/11: SP42)', async () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'social.js'), 'utf8');
  assert.match(src, /You think like the best designers of the world and like a marketer at the same time/);
  assert.match(src, /names at least eight concrete styled objects and textures/);
  assert.match(src, /Every space seen beyond a glass partition, an opening or a door is designed and styled too: never an empty room behind/);
});

test('the cost (the owner, 19/11): the week\'s notes dropped on the server are used and no search is paid; the music comes from the kept clips once there are enough; the fixed rules are cached', async () => {
  let asked = 0;
  const { desk } = await studio({ research: async () => { asked++; return '- paid search'; } });
  const inbox = path.join(tmp('inbox-'), 'research-inbox.md');
  desk.cfg.researchInbox = inbox; desk.cfg.researchSource = 'inbox';
  assert.equal(await desk.researchTrends(), '', 'no notes yet: no paid search either');
  assert.equal(asked, 0);
  fs.writeFileSync(inbox, '- Fluted walnut and brass [AD]\nIMAGES: https://x.example/a.jpg');
  assert.equal(await desk.researchTrends(), '- Fluted walnut and brass [AD]');
  assert.match(desk.todayTrends(), /Fluted walnut/);
  assert.equal(asked, 0);
  desk.cfg.researchSource = 'bot'; desk.cfg.researchInbox = '';
  desk.store.d.trends = [];
  await desk.researchTrends();
  assert.equal(asked, 1, 'the bot searches only when set to');
  // the music library
  const brand = tmp('brand-'); desk.brandDir = brand; fs.mkdirSync(path.join(brand, 'music'));
  let made = 0; desk.imager.music = async () => { made++; return Buffer.from(`clip${made}`); };
  desk.cfg.musicLibrary = 2;
  await desk.reelMusic('calm'); await desk.reelMusic('calm');
  assert.equal(made, 2);
  const a = await desk.reelMusic('calm'); const b = await desk.reelMusic('calm');
  assert.equal(made, 2, 'the library is full: no new clip');
  assert.notDeepEqual(a, b, 'never the same clip twice in a row');
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(index, /\{ type: 'text', text: prefix, cache_control: \{ type: 'ephemeral' \} \}/);
  assert.match(index, /system = system \? \[\{ type: 'text', text: system, cache_control: \{ type: 'ephemeral' \} \}\] : system;/);
});

test('a plain colour is shown where it meets the room, smooth, and the Reel turns around the room by default (the owner, 20/11: SP43)', async () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'social.js'), 'utf8');
  assert.match(src, /a styled detail view about one metre from where the \$\{part\.where\} in film \$\{part\.code\} meets another surface of the room/);
  assert.match(src, /export const SMOOTH = 'A plain colour film is perfectly smooth and even/);
  assert.match(src, /"rough":true or false/);
  assert.match(src, /close && v\.rough === true && 'a plain film looks sandy or rough; it is perfectly smooth'/);
  assert.match(src, /a medium view at standing height from the other side of the room, a 28 mm lens, where two of the films meet/);
  const { desk } = await studio({ reelMotion: 'orbit' });
  let args = null;
  desk.reel = async (a) => { args = a; return Buffer.from('MP4'); };
  const d = await desk.draftDesign({});
  await desk.remakeReel({ id: /Post #(SP\d+)/.exec(d.text)[1] });
  assert.equal(args.motion, 'orbit');
  assert.equal(args.views.length, 3);
  const cfg = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'config.js'), 'utf8');
  assert.match(cfg, /reelMotion: \(env\.SOCIAL_REEL_MOTION \|\| 'orbit'\)/);
});

test('a yes posts the stories too: Instagram, Facebook and a WhatsApp status, the Reel when there is one, at most two statuses a day (the owner, 21/11)', async () => {
  const { desk } = await studio({ reelAuto: false });
  const calls = [];
  desk.client.igStory = async (a) => (calls.push(['ig', a.video ? 'video' : a.imageUrl ? 'image' : '?']), { id: 'IGS' });
  desk.client.fbStory = async (a) => (calls.push(['fb', a.video ? 'video' : a.photoId ? 'image' : '?']), { id: 'FBS' });
  desk.client.fbPhoto = async () => ({ id: 'PH' });
  desk.client.fbPhotoUrl = async () => 'https://x/p.jpg';
  Object.defineProperty(desk.client, 'hasIg', { get: () => true });
  Object.defineProperty(desk.client, 'hasFb', { get: () => true });
  const wa = [];
  desk.waStatus = async (a) => (wa.push(a), 37);
  desk.cfg.contact = '+971000';
  const post = { id: 'SP90', design: { codes: ['HZ812', '1805'] }, caption: 'c' };
  const done = []; const failed = [];
  await desk.postStories(post, { image: Buffer.from('i'), video: Buffer.from('v') }, done, failed);
  assert.deepEqual(calls, [['ig', 'video'], ['fb', 'video']]);
  assert.equal(wa[0].video.toString(), 'v');
  assert.match(wa[0].caption, /HZ812 {2}1805 {2}Send the code you like on WhatsApp \+971000/);
  assert.deepEqual(done, ['Instagram story: posted', 'Facebook story: posted', 'WhatsApp status: posted (seen by 37 customers)']);
  await desk.postStories({ id: 'SP91' }, { image: Buffer.from('i') }, [], []);
  assert.deepEqual(calls.slice(2), [['ig', 'image'], ['fb', 'image']], 'no Reel: the main picture');
  const f3 = [];
  await desk.postStories({ id: 'SP92' }, { image: Buffer.from('i') }, [], f3);
  assert.match(f3.join('|'), /WhatsApp status: not posted, 2 statuses today already/);
  assert.equal(wa.length, 2);
  desk.cfg.stories = false;
  const d4 = [];
  await desk.postStories({ id: 'SP93' }, { image: Buffer.from('i') }, d4, []);
  assert.equal(d4.length, 0, 'SOCIAL_STORIES=off');
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(index, /sock\.sendMessage\('status@broadcast', video \? \{ video, caption, mimetype: 'video\/mp4' \} : \{ image, caption \}, \{ statusJidList: list, broadcast: true \}\)/);
  assert.match(index, /if \(!j\.endsWith\('@s\.whatsapp\.net'\) \|\| staff\.has\(jidDigits\(j\)\)/, 'never the staff');
});

test('a Reel like the reference (the owner, 21/11): pointers on the room, a centred header, a voice line per shot with the music stepping back, whooshes at the cuts, the end on the room', async () => {
  const { makeReel, endCard, reelOverlay, calloutRoom } = await import('../src/reel.js');
  const room = await pic('#806040', 1080, 1350);
  const tagged = await calloutRoom({ image: room, spots: [{ x: 0.3, y: 0.4, code: 'HZ806', name: 'Dark walnut' }, { x: 0.9, y: 0.05, code: 'HZ818', name: 'Ivory' }] });
  const m = await sharp(tagged).metadata();
  assert.equal(m.width, 1080); assert.equal(m.height, 1350);
  assert.notDeepEqual(await sharp(tagged).raw().toBuffer(), await sharp(room).raw().toBuffer(), 'the pointers are drawn');
  const logo = await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  const o = await alphaBox(await reelOverlay({ logo, tagline: 'Premium Surface Films' }));
  assert.ok(Math.abs((o.left + o.right) / 2 - 540) < 40, `the header is centred ${JSON.stringify(o)}`);
  const card = await endCard({ codes: [{ code: 'HZ812', swatch: await pic('#3a2a1e') }], line: 'WhatsApp +971000', background: await pic('#d0c0a0', 1080, 1350) });
  const { data } = await sharp(card).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 30, 'the end card stands on the darkened room, not on the plain dark ground');
  const wav = (sec) => { const rate = 24000; const pcm = Buffer.alloc(rate * 2 * sec); for (let i = 0; i < rate * sec; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), i * 2); const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40); return Buffer.concat([h, pcm]); };
  const mp4 = await makeReel({ room, card, fade: 0.35, seconds: { card: 1 }, sequence: [{ image: tagged, sec: 1.4, move: 'pan', toRight: true, voice: wav(1) }, { image: room, sec: 1.4, move: 'push', zoom: 0.1, voice: wav(1) }], cardVoice: wav(1), whoosh: true });
  assert.ok(mp4.length > 1000);
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'reel.js'), 'utf8');
  assert.match(src, /sidechaincompress=threshold=0\.02:ratio=8/, 'the music steps back under the voice');
  assert.match(src, /anoisesrc=c=pink/, 'the whooshes');
  const social = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'social.js'), 'utf8');
  assert.match(social, /const opens = \['Experience luxury with Ah-ree-yack\.'/, 'the brand said the way the owner says it');
  assert.match(social, /if \(cardVoice\) cardSec = Math\.max\(cardSec, \(cardVoice\.length - 44\) \/ 48000 \+ 1\.1\);/, 'the card waits for its line');
  assert.match(social, /model = 'gemini-3\.1-flash-tts-preview'/);
});
