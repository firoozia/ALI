// TikTok (the owner, 15/11): the design studio's Reels go to TikTok too, through TikTok's official Content Posting API.
// Until TikTok audits the app, a video can only be sent to the owner's TikTok inbox as a draft (he opens TikTok and taps Post);
// after the audit, «direct» posts it at once. The owner connects the account once: «تیک‌تاک وصل» gives the TikTok sign-in link,
// TikTok sends him back to the website with a code, and «تیک‌تاک کد …» hands the code to Atossa. The refresh token is kept on the
// server and renewed on every use (it lasts a year); nothing is sent before the owner's yes of the post it belongs to.

const API = 'https://open.tiktokapis.com';

export class TikTokClient {
  constructor({ clientKey = '', clientSecret = '', redirectUri = '', mode = 'inbox', privacy = 'PUBLIC_TO_EVERYONE', store = null, fetchImpl = globalThis.fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
    Object.assign(this, { clientKey, clientSecret, redirectUri, mode, privacy, store, fetchImpl, wait, now });
  }
  get configured() { return !!(this.clientKey && this.clientSecret); }
  get connected() { return this.configured && !!this.store?.d.tiktok?.refresh; }

  /** The sign-in link the owner opens once (TikTok's own page; he signs in himself). */
  authorizeUrl(state = 'aryak') {
    const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
    u.searchParams.set('client_key', this.clientKey);
    u.searchParams.set('scope', 'user.info.basic,video.upload,video.publish');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('redirect_uri', this.redirectUri);
    u.searchParams.set('state', state);
    return u.toString();
  }

  async token(params) {
    const res = await this.fetchImpl(`${API}/v2/oauth/token/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: this.clientKey, client_secret: this.clientSecret, ...params }).toString() });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error || !d.access_token) throw new Error(`TikTok sign-in: ${d.error_description || d.error || `HTTP ${res.status}`}`);
    this.store.d.tiktok = { ...(this.store.d.tiktok || {}), access: d.access_token, until: this.now() + (d.expires_in || 0) * 1000 - 60000, refresh: d.refresh_token, openId: d.open_id || this.store.d.tiktok?.openId || '' };
    this.store.save();
    return this.store.d.tiktok;
  }
  /** The code from the address TikTok sent the owner back to («…?code=XYZ&state=…», or the code alone). */
  async connect(codeOrUrl) {
    let code = String(codeOrUrl || '').trim();
    try { const u = new URL(code); code = u.searchParams.get('code') || code; } catch { /* the code alone */ }
    return this.token({ grant_type: 'authorization_code', code: decodeURIComponent(code), redirect_uri: this.redirectUri });
  }
  async access() {
    const t = this.store.d.tiktok;
    if (!t?.refresh) throw new Error('TikTok is not connected yet (write «تیک‌تاک وصل»)');
    if (t.access && t.until > this.now()) return t.access;
    return (await this.token({ grant_type: 'refresh_token', refresh_token: t.refresh })).access;
  }
  async api(p, body) {
    const res = await this.fetchImpl(`${API}${p}`, { method: 'POST', headers: { Authorization: `Bearer ${await this.access()}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body || {}) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || (d.error?.code && d.error.code !== 'ok')) throw new Error(`TikTok: ${d.error?.message || d.error?.code || `HTTP ${res.status}`}`);
    return d.data || {};
  }

  /**
   * A video from its own bytes (one piece up to 64 MB). [mode] 'inbox': a draft in the owner's TikTok inbox; 'direct': posted with the
   * caption (needs TikTok's audit). Returns { publishId, status }.
   */
  /**
   * A photo post (the pictures of a post, swipeable) from their public addresses (the verified folder): a draft in the inbox, or posted
   * at once in direct mode. [aigc] labels AI-made pictures as TikTok asks. Returns { publishId, status }.
   */
  async postPhotos(urls, caption = '', { aigc = false } = {}) {
    const direct = this.mode === 'direct';
    caption = fiveHashtags(caption);
    const title = String(caption).split('\n')[0].slice(0, 90);
    const init = await this.api('/v2/post/publish/content/init/', {
      post_info: { title, description: String(caption).slice(0, 4000), ...(direct ? { privacy_level: this.privacy, disable_comment: false, auto_add_music: true, brand_organic_toggle: true } : {}) },
      source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: urls.slice(0, 35) },
      post_mode: direct ? 'DIRECT_POST' : 'MEDIA_UPLOAD', media_type: 'PHOTO', is_aigc: !!aigc,
    });
    let status = 'PROCESSING_DOWNLOAD';
    for (let i = 0; i < 30; i++) {
      const s = await this.api('/v2/post/publish/status/fetch/', { publish_id: init.publish_id });
      status = s.status || status;
      if (status === 'FAILED') throw new Error(`TikTok could not take the pictures (${s.fail_reason || 'no reason given'})`);
      if (status === 'PUBLISH_COMPLETE' || status === 'SEND_TO_USER_INBOX') break;
      await this.wait(5000);
    }
    return { publishId: init.publish_id, status };
  }

  async postVideo(video, caption = '') {
    const size = video.length;
    const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 };
    const direct = this.mode === 'direct';
    const init = direct
      ? await this.api('/v2/post/publish/video/init/', { post_info: { title: fiveHashtags(caption).slice(0, 2200), privacy_level: this.privacy, disable_duet: false, disable_comment: false, disable_stitch: false }, source_info })
      : await this.api('/v2/post/publish/inbox/video/init/', { source_info });
    const up = await this.fetchImpl(init.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Content-Range': `bytes 0-${size - 1}/${size}` }, body: video });
    if (!up.ok) throw new Error(`TikTok upload: HTTP ${up.status}`);
    let status = 'PROCESSING_UPLOAD';
    for (let i = 0; i < 30; i++) {
      const s = await this.api('/v2/post/publish/status/fetch/', { publish_id: init.publish_id });
      status = s.status || status;
      if (status === 'FAILED') throw new Error(`TikTok could not take the video (${s.fail_reason || 'no reason given'})`);
      if (status === 'PUBLISH_COMPLETE' || status === 'SEND_TO_USER_INBOX') break;
      await this.wait(5000);
    }
    return { publishId: init.publish_id, status };
  }
}

/**
 * A public folder for the pictures TikTok takes (photo posts are taken only from a verified web address, never from the bytes):
 * a Google Cloud Storage bucket readable by everyone (the owner allowed it, 15/11: only pictures of posts he approved go there), written
 * with the server's own service account (the metadata token). put() returns the public address.
 */
export class PublicBucket {
  constructor({ bucket = '', fetchImpl = globalThis.fetch } = {}) { Object.assign(this, { bucket, fetchImpl }); }
  get enabled() { return !!this.bucket; }
  async token() {
    const r = await this.fetchImpl('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) throw new Error('no server token for the picture folder');
    return d.access_token;
  }
  async put(name, buf, type = 'image/jpeg') {
    const res = await this.fetchImpl(`https://storage.googleapis.com/upload/storage/v1/b/${this.bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': type }, body: buf });
    if (!res.ok) throw new Error(`the picture folder refused the picture (HTTP ${res.status})`);
    return `https://storage.googleapis.com/${this.bucket}/${name.split('/').map(encodeURIComponent).join('/')}`;
  }
}

/** TikTok takes at most five hashtags in a post (the owner's phone, 15/11): the first five are kept, the rest dropped. */
export function fiveHashtags(text, max = 5) {
  let n = 0;
  return String(text || '').replace(/(^|\s)#[^\s#]+/gu, (m) => (++n <= max ? m : '')).replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
}

/** «تیک‌تاک وصل» / «تیک‌تاک کد …» / «tiktok connect» / «tiktok code …». Null when not one. */
export function tiktokCommand(text) {
  const t = String(text || '').trim();
  let m;
  if (/^(?:تیک[\s‌]?تاک|tiktok)\s+(?:وصل|اتصال|connect)\s*$/i.test(t)) return { verb: 'connect' };
  if ((m = /^(?:تیک[\s‌]?تاک|tiktok)\s+(?:کد|code)\s*:?\s*(\S+)\s*$/i.exec(t))) return { verb: 'code', code: m[1] };
  return null;
}
