// Atossa's design studio (the owner, 15/11): her morning research, the close-up and the Reel of a design, one yes for a swipeable post
// and its Reel, the codes on the owner's own photos, the weekly report. Meta and the models are fakes; nothing leaves the machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MetaClient, SocialDesk, SocialStore } from '../src/social.js';
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

test('a design comes with its close-up (second picture) and, with a Reel maker, a Reel pushed in where the main film shows best', async () => {
  let reelArgs = null;
  const { desk, made } = await studio({ reel: async (a) => { reelArgs = a; return Buffer.from('MP4'); } });
  const d = await desk.draftDesign({});
  assert.equal(made.length, 2, 'the room, then the close-up');
  assert.deepEqual(made[1].images.map((i) => i.label), ['The room', 'Reference: film HZ812']);
  assert.match(made[1].prompt, /close-up detail photograph taken in this same room[\s\S]*tall doors in film HZ812/);
  assert.ok(d.detail && d.video, 'the owner gets both');
  assert.deepEqual(reelArgs.focus, { x: 0.7, y: 0.3 });
  assert.ok(reelArgs.overlay && reelArgs.card && reelArgs.detail);
  const p = desk.store.d.posts.SP1;
  assert.equal(p.extras.length, 1);
  assert.ok(fs.existsSync(p.reel));
  assert.match(d.text, /With the post: a close-up as a second picture and a Reel; one yes posts them all\./);
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
  assert.match(out, /Facebook: posted \(2 pictures\) https:\/\/fb\/post/);
  assert.match(out, /Instagram: posted \(2 pictures\) https:\/\/ig\/p\/car/);
  assert.match(out, /Facebook video: posted/);
  assert.match(out, /Instagram Reel: posted https:\/\/ig\/reel\/1/);
  const feed = g.calls.find((c) => c.key === 'POST /222/feed');
  assert.deepEqual(JSON.parse(feed.params.attached_media), [{ media_fbid: 'ph1' }, { media_fbid: 'ph2' }]);
  const carousel = g.calls.find((c) => c.key === 'POST /111/media' && c.params.media_type === 'CAROUSEL');
  assert.equal(carousel.params.children.split(',').length, 2);
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
