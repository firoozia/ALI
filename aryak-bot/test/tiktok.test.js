// TikTok (the owner, 15/11): connect once in chat, then every approved Reel goes to TikTok (a draft in the inbox until TikTok's audit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SocialStore } from '../src/social.js';
import { PublicBucket, TikTokClient, fiveHashtags, tiktokCommand } from '../src/tiktok.js';

function fakeTikTok({ status = 'SEND_TO_USER_INBOX', tokenError = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    const body = typeof opts.body === 'string' ? (opts.headers['Content-Type'].startsWith('application/json') ? JSON.parse(opts.body) : Object.fromEntries(new URLSearchParams(opts.body))) : opts.body;
    calls.push({ path: u.host === 'upload.tiktok' ? 'UPLOAD' : u.pathname, method: opts.method, headers: opts.headers, body });
    const r = (d, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => d });
    if (u.pathname === '/v2/oauth/token/') return tokenError ? r({ error: 'invalid_grant', error_description: tokenError }, false) : r({ access_token: `A-${body.grant_type}`, expires_in: 86400, refresh_token: `R-${body.grant_type}`, open_id: 'me' });
    if (u.pathname.endsWith('/video/init/')) return r({ data: { publish_id: 'pub1', upload_url: 'https://upload.tiktok/v1/x' }, error: { code: 'ok' } });
    if (u.host === 'upload.tiktok') return { ok: true, status: 201, json: async () => ({}) };
    if (u.pathname === '/v2/post/publish/status/fetch/') return r({ data: { status }, error: { code: 'ok' } });
    return r({ error: { code: 'not_found', message: u.pathname } }, false);
  };
  return { calls, fetchImpl };
}
const client = (g, o = {}) => new TikTokClient({ clientKey: 'CK', clientSecret: 'CS', redirectUri: 'https://aryak.ae/', store: new SocialStore(''), fetchImpl: g.fetchImpl, wait: async () => {}, ...o });

test('the owner\'s words: «تیک‌تاک وصل», «تیک‌تاک کد …»', () => {
  assert.deepEqual(tiktokCommand('تیک‌تاک وصل'), { verb: 'connect' });
  assert.deepEqual(tiktokCommand('تیک تاک کد https://aryak.ae/?code=ABC&state=aryak'), { verb: 'code', code: 'https://aryak.ae/?code=ABC&state=aryak' });
  assert.deepEqual(tiktokCommand('tiktok code XYZ'), { verb: 'code', code: 'XYZ' });
  assert.equal(tiktokCommand('تیک‌تاک چطوره'), null);
});

test('connect: the sign-in link asks only for posting; the code from the address is exchanged and the refresh token kept', async () => {
  const g = fakeTikTok();
  const t = client(g);
  assert.equal(t.connected, false);
  const link = new URL(t.authorizeUrl());
  assert.equal(link.searchParams.get('scope'), 'user.info.basic,video.upload,video.publish');
  assert.equal(link.searchParams.get('redirect_uri'), 'https://aryak.ae/');
  await t.connect('https://aryak.ae/?code=ABC%2A1&scopes=video.upload&state=aryak');
  assert.equal(g.calls[0].body.code, 'ABC*1');
  assert.equal(g.calls[0].body.grant_type, 'authorization_code');
  assert.equal(t.store.d.tiktok.refresh, 'R-authorization_code');
  assert.equal(t.connected, true);
  await assert.rejects(client(fakeTikTok({ tokenError: 'code expired' })).connect('XYZ'), /TikTok sign-in: code expired/);
});

test('a Reel: an expired access is renewed, the video goes up in one piece and lands in the inbox; direct mode posts with the caption', async () => {
  const g = fakeTikTok();
  const t = client(g);
  t.store.d.tiktok = { refresh: 'R0', access: 'old', until: 0 };
  const out = await t.postVideo(Buffer.from('MP4DATA'), 'Code HZ812 #ARYAK');
  assert.deepEqual(out, { publishId: 'pub1', status: 'SEND_TO_USER_INBOX' });
  assert.equal(g.calls[0].body.grant_type, 'refresh_token');
  const init = g.calls.find((c) => c.path.endsWith('/video/init/'));
  assert.equal(init.path, '/v2/post/publish/inbox/video/init/');
  assert.deepEqual(init.body.source_info, { source: 'FILE_UPLOAD', video_size: 7, chunk_size: 7, total_chunk_count: 1 });
  const up = g.calls.find((c) => c.path === 'UPLOAD');
  assert.equal(up.headers['Content-Range'], 'bytes 0-6/7');
  const d = fakeTikTok({ status: 'PUBLISH_COMPLETE' });
  const td = client(d, { mode: 'direct' });
  td.store.d.tiktok = { refresh: 'R0', access: 'A', until: Date.now() + 1e6 };
  assert.equal((await td.postVideo(Buffer.from('MP4'), 'Code HZ812')).status, 'PUBLISH_COMPLETE');
  const di = d.calls.find((c) => c.path.endsWith('/video/init/'));
  assert.equal(di.path, '/v2/post/publish/video/init/');
  assert.equal(di.body.post_info.title, 'Code HZ812');
  assert.equal(di.body.post_info.privacy_level, 'PUBLIC_TO_EVERYONE');
});

test('photos: put in the public folder with the server token, then one photo post (inbox draft, AI label for designs)', async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    calls.push({ host: u.host, path: u.pathname, search: u.search, opts, body: typeof opts.body === 'string' && String(opts.headers?.['Content-Type'] || '').startsWith('application/json') ? JSON.parse(opts.body) : null });
    const r = (d, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => d });
    if (u.host === 'metadata.google.internal') return r({ access_token: 'GCS' });
    if (u.host === 'storage.googleapis.com') return r({ name: 'x' });
    if (u.pathname === '/v2/post/publish/content/init/') return r({ data: { publish_id: 'p1' }, error: { code: 'ok' } });
    if (u.pathname === '/v2/post/publish/status/fetch/') return r({ data: { status: 'SEND_TO_USER_INBOX' }, error: { code: 'ok' } });
    return r({ error: { code: 'x', message: u.pathname } }, false);
  };
  const bucket = new PublicBucket({ bucket: 'aryak-social-media', fetchImpl });
  const url = await bucket.put('posts/SP1-1-x.jpg', Buffer.from('JPG'));
  assert.equal(url, 'https://storage.googleapis.com/aryak-social-media/posts/SP1-1-x.jpg');
  const up = calls.find((c) => c.host === 'storage.googleapis.com');
  assert.equal(up.opts.headers.Authorization, 'Bearer GCS');
  assert.match(up.search, /uploadType=media&name=posts%2FSP1-1-x\.jpg/);
  const t = new TikTokClient({ clientKey: 'CK', clientSecret: 'CS', store: { d: { tiktok: { refresh: 'R', access: 'A', until: Date.now() + 1e6 } }, save() {} }, fetchImpl, wait: async () => {} });
  const out = await t.postPhotos([url, url], 'Design idea with Code HZ806\nmore words', { aigc: true });
  assert.deepEqual(out, { publishId: 'p1', status: 'SEND_TO_USER_INBOX' });
  const init = calls.find((c) => c.path === '/v2/post/publish/content/init/').body;
  assert.equal(init.post_mode, 'MEDIA_UPLOAD');
  assert.equal(init.media_type, 'PHOTO');
  assert.equal(init.is_aigc, true);
  assert.equal(init.post_info.title, 'Design idea with Code HZ806');
  assert.deepEqual(init.source_info, { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: [url, url] });
});

test('TikTok takes five hashtags: the first five are kept, the words untouched', () => {
  const c = 'New TV wall with Code HZ806.\n#TVWallDesign #VillaInterior #WoodSlatPanels #CarpentryUAE #InteriorDesignUAE #Joinery #تصميم_داخلي';
  const out = fiveHashtags(c);
  assert.equal((out.match(/#/g) || []).length, 5);
  assert.equal(out, 'New TV wall with Code HZ806.\n#TVWallDesign #VillaInterior #WoodSlatPanels #CarpentryUAE #InteriorDesignUAE');
  assert.equal(fiveHashtags('no tags here'), 'no tags here');
});
