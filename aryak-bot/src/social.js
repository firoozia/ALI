// Instagram and Facebook (the owner, 14/11): the assistant drafts posts and answers, and the owner decides. Only the official Graph API
// (Instagram API with Instagram Login, and the Facebook Page). Three hard rules:
//   1. nothing is posted, answered or sent before the owner's «yes #SP3» / «yes #SR5» in his own chat;
//   2. no cold messages: only an answer to someone who wrote first, inside Meta's 24-hour window;
//   3. the first look at the accounts only marks what is there as seen (old comments are never brought up again).
// The comments and messages are read by polling (no public web address is needed); a failing source is reported, never fatal.

import fs from 'node:fs';
import path from 'node:path';

export const GRAPH_IG = 'https://graph.instagram.com';
export const GRAPH_FB = 'https://graph.facebook.com';
export const WINDOW_MS = 24 * 3600 * 1000; // Meta's standard messaging window
const DAY = 24 * 3600 * 1000;
// The owner's review of the Reels (17/11): the image model drew spec cards, codes, a nine-picture grid and a line of words INTO the
// pictures (cut at the frame's edge), and close-ups showed deep carved grain and bright gold veins where the real film is a smooth print.
export const NO_TEXT = 'One single photograph: never a collage, a grid, a split screen or several panels. No text, letters, numbers, labels, cards, captions, logos or watermarks anywhere in the picture.';
export const TRUE_FILM = "Each film's surface looks exactly like its reference sample: the same colour, pattern, vein colour and surface relief (a printed decorative film is smooth or as finely textured as its sample, never deep carved, brushed or embossed wood).";
export const CLEAN_RULES = 'You check one AI interior picture for a decorative film brand before it is posted; the reference film samples follow it. Answer only JSON: {"text":true or false (any letters, numbers, labels, cards, captions, logos or watermarks drawn in the picture),"collage":true or false (several pictures, panels, a grid or a split screen instead of one photograph),"mismatch":"" or a short English note when a film in the picture clearly differs from its sample in colour, pattern, vein colour or surface relief (a smooth printed film shown as deep carved or embossed wood)","hidden":true or false (the surface of the film can hardly be seen: too dark, too blurred, in deep shadow, or covering less than half of the picture, so its colour and pattern cannot be read)}';
export const NAME_RULES = 'Give a short English trade name of two or three words for this decorative film, from its description, the way a showroom labels a sample: «Honey oak», «Charcoal black», «Grey gold marble», «Olive khaki». Two films that differ only by pattern must get different names («Black-green ash», «Black-green solid»). Output only the name.';
// Reels (the owner's review, 17/11): quick cuts, at most 20 s, the strongest picture first, every shot once
export const REEL_FADE = 0.35;
export const REEL_MAX_SECONDS = 20;

/** The Graph API calls the assistant uses, nothing more. [fetchImpl] is replaced in the tests. */
export class MetaClient {
  // Two ways in: an Instagram-Login token (graph.instagram.com), or the business's system-user token (never expires): with it the Page
  // token and the Instagram account behind the Page are read once (ready()) and Instagram is reached through graph.facebook.com.
  constructor({ igToken = '', igUserId = '', pageId = '', pageToken = '', systemToken = '', version = 'v24.0', fetchImpl = globalThis.fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    Object.assign(this, { igToken, igUserId, pageId, pageToken, systemToken, version, fetchImpl, wait });
    this.viaFb = !!systemToken && !igToken;
  }
  get hasIg() { return !!(this.igUserId && (this.igToken || (this.viaFb && this.pageToken))); }
  get hasFb() { return !!(this.pageToken && this.pageId); }
  /** With a system-user token: the Page token and the Instagram account of the Page, read once. */
  async ready() {
    if (!this.systemToken || !this.pageId || (this.pageToken && (this.igUserId || !this.viaFb))) return;
    const r = await this.call(GRAPH_FB, this.pageId, { params: { fields: 'access_token,instagram_business_account' }, token: this.systemToken });
    if (r.access_token) this.pageToken = r.access_token;
    if (this.viaFb && !this.igUserId && r.instagram_business_account?.id) this.igUserId = r.instagram_business_account.id;
  }

  async call(base, p, { method = 'GET', params = {}, token, form = null, json = null, versioned = true } = {}) {
    const url = new URL(`${base}/${versioned ? `${this.version}/` : ''}${p}`);
    const opts = { method, headers: {} };
    if (method === 'GET') { for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v)); url.searchParams.set('access_token', token); }
    else if (form) { form.set('access_token', token); opts.body = form; }
    else if (json) { opts.headers['Content-Type'] = 'application/json'; opts.headers.Authorization = `Bearer ${token}`; opts.body = JSON.stringify(json); }
    else { opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'; opts.body = new URLSearchParams({ ...params, access_token: token }).toString(); }
    const res = await this.fetchImpl(url.toString(), opts);
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok || body?.error) {
      const e = body?.error || {};
      const err = new Error(`${e.message || `HTTP ${res.status}`}${e.code ? ` (code ${e.code})` : ''}`);
      err.code = e.code; err.status = res.status;
      throw err;
    }
    return body;
  }
  ig(p, o = {}) { return this.viaFb ? this.call(GRAPH_FB, p, { ...o, token: this.pageToken }) : this.call(GRAPH_IG, p, { ...o, token: this.igToken }); }
  fb(p, o = {}) { return this.call(GRAPH_FB, p, { ...o, token: this.pageToken }); }

  // Facebook Page
  async fbPhoto(buffer, caption, { published = true, mime = 'image/jpeg' } = {}) {
    const form = new FormData();
    form.set('source', new Blob([buffer], { type: mime }), 'photo.jpg');
    if (caption) form.set('caption', caption);
    form.set('published', published ? 'true' : 'false');
    return this.fb(`${this.pageId}/photos`, { method: 'POST', form });
  }
  async fbPhotoUrl(photoId) {
    const r = await this.fb(photoId, { params: { fields: 'images' } });
    const best = (r.images || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    return best?.source || '';
  }
  /** Another professional account's latest posts (Business Discovery): [{ media_type, like_count, permalink, media_url, thumbnail_url, timestamp }]. */
  async igDiscover(username, limit = 8) {
    const r = await this.ig(this.igUserId, { params: { fields: `business_discovery.username(${username}){username,media.limit(${limit}){media_type,like_count,comments_count,permalink,media_url,thumbnail_url,timestamp}}` } });
    return r.business_discovery?.media?.data || [];
  }
  async fbPermalink(postId) { try { return (await this.fb(postId, { params: { fields: 'permalink_url' } })).permalink_url || ''; } catch { return ''; } }
  fbFeed(limit = 5) { return this.fb(`${this.pageId}/feed`, { params: { fields: 'id,message,permalink_url,comments.limit(25){id,message,from,created_time}', limit } }); }
  fbCommentReply(commentId, message) { return this.fb(`${commentId}/comments`, { method: 'POST', params: { message } }); }
  fbConversations() { return this.fb(`${this.pageId}/conversations`, { params: { fields: 'id,updated_time,messages.limit(5){id,from,message,created_time}', limit: 10 } }); }
  fbSend(recipient, text) { return this.fb(`${this.pageId}/messages`, { method: 'POST', json: { recipient: { id: recipient }, messaging_type: 'RESPONSE', message: { text } } }); }

  // Instagram (professional account, Instagram Login)
  async igPublish(imageUrl, caption) {
    const c = await this.ig(`${this.igUserId}/media`, { method: 'POST', params: { image_url: imageUrl, caption } });
    for (let i = 0; i < 10; i++) { // the container is ready within seconds for a photo
      const s = await this.ig(c.id, { params: { fields: 'status_code' } });
      if (s.status_code === 'FINISHED') break;
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram could not take the photo (${s.status_code})`);
      await this.wait(3000);
    }
    const p = await this.ig(`${this.igUserId}/media_publish`, { method: 'POST', params: { creation_id: c.id } });
    let link = '';
    try { link = (await this.ig(p.id, { params: { fields: 'permalink' } })).permalink || ''; } catch { /* the post is there; only its link is missing */ }
    return { id: p.id, link };
  }
  /** Waits for an Instagram container (a photo is ready in seconds, a video can take minutes). */
  async igReady(id, tries = 10, ms = 3000) {
    for (let i = 0; i < tries; i++) {
      const s = await this.ig(id, { params: { fields: 'status_code' } });
      if (s.status_code === 'FINISHED') return;
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram could not take the media (${s.status_code})`);
      await this.wait(ms);
    }
    throw new Error('Instagram is still processing the media; try the yes again later');
  }
  async igFinish(creationId) {
    const p = await this.ig(`${this.igUserId}/media_publish`, { method: 'POST', params: { creation_id: creationId } });
    let link = '';
    try { link = (await this.ig(p.id, { params: { fields: 'permalink' } })).permalink || ''; } catch { /* posted; only the link is missing */ }
    return { id: p.id, link };
  }
  /** Several pictures in one swipeable post (their web addresses, as for igPublish). */
  async igCarousel(urls, caption) {
    const kids = [];
    for (const u of urls) { const c = await this.ig(`${this.igUserId}/media`, { method: 'POST', params: { image_url: u, is_carousel_item: 'true' } }); await this.igReady(c.id); kids.push(c.id); }
    const c = await this.ig(`${this.igUserId}/media`, { method: 'POST', params: { media_type: 'CAROUSEL', children: kids.join(','), caption } });
    await this.igReady(c.id);
    return this.igFinish(c.id);
  }
  /** A Reel from the video's own bytes (Instagram's resumable upload: no public web address is needed). */
  async igReel(video, caption) {
    const c = await this.ig(`${this.igUserId}/media`, { method: 'POST', params: { media_type: 'REELS', upload_type: 'resumable', caption, share_to_feed: 'true' } });
    const uri = c.uri || `https://rupload.facebook.com/ig-api-upload/${this.version}/${c.id}`;
    const res = await this.fetchImpl(uri, { method: 'POST', headers: { Authorization: `OAuth ${this.viaFb ? this.pageToken : this.igToken}`, offset: '0', file_size: String(video.length) }, body: video });
    let body = null; try { body = await res.json(); } catch { /* none */ }
    if (!res.ok || body?.error || body?.success === false) throw new Error(`the Reel upload failed: ${body?.error?.message || body?.debug_info?.message || `HTTP ${res.status}`}`);
    await this.igReady(c.id, 40, 5000);
    return this.igFinish(c.id);
  }
  /** Several pictures in one Facebook post: each is uploaded unpublished, then one post carries them all. */
  async fbAlbumPost(buffers, caption) {
    const ids = [];
    for (const b of buffers) ids.push((await this.fbPhoto(b, '', { published: false })).id);
    const post = await this.fb(`${this.pageId}/feed`, { method: 'POST', params: { message: caption, attached_media: JSON.stringify(ids.map((id) => ({ media_fbid: id }))) } });
    return { id: post.id, photoIds: ids };
  }
  async fbVideo(video, caption) {
    const form = new FormData();
    form.set('source', new Blob([video], { type: 'video/mp4' }), 'reel.mp4');
    if (caption) form.set('description', caption);
    return this.call('https://graph-video.facebook.com', `${this.pageId}/videos`, { method: 'POST', form, token: this.pageToken });
  }
  /** The numbers of an Instagram post: reach, likes, comments, saves, shares (null when Meta gives none). */
  async igInsights(mediaId) {
    try {
      const r = await this.ig(`${mediaId}/insights`, { params: { metric: 'reach,likes,comments,saved,shares' } });
      return Object.fromEntries((r.data || []).map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0]));
    } catch {
      try { const r = await this.ig(mediaId, { params: { fields: 'like_count,comments_count' } }); return { likes: r.like_count || 0, comments: r.comments_count || 0 }; } catch { return null; }
    }
  }
  async fbPostNumbers(postId) {
    try {
      const r = await this.fb(postId, { params: { fields: 'reactions.summary(true).limit(0),comments.summary(true).limit(0),shares' } });
      return { reactions: r.reactions?.summary?.total_count || 0, comments: r.comments?.summary?.total_count || 0, shares: r.shares?.count || 0 };
    } catch { return null; }
  }
  igMedia(limit = 5) { return this.ig(`${this.igUserId}/media`, { params: { fields: 'id,caption,permalink,timestamp', limit } }); }
  igComments(mediaId) { return this.ig(`${mediaId}/comments`, { params: { fields: 'id,text,username,timestamp,from' } }); }
  igReply(commentId, message) { return this.ig(`${commentId}/replies`, { method: 'POST', params: { message } }); }
  igConversations() { return this.ig(`${this.viaFb ? this.pageId : this.igUserId}/conversations`, { params: { platform: 'instagram', fields: 'id,updated_time,messages.limit(5){id,from,message,created_time}', limit: 10 } }); }
  igSend(recipient, text) { return this.ig(`${this.viaFb ? this.pageId : this.igUserId}/messages`, { method: 'POST', json: { recipient: { id: recipient }, message: { text } } }); }
  async igRefresh() { if (this.viaFb) return null; return this.call(GRAPH_IG, 'refresh_access_token', { params: { grant_type: 'ig_refresh_token' }, token: this.igToken, versioned: false }); }
}

/** The state on the server: drafts (#SP), inbox items (#SR), what was seen, the people who wrote (leads), the refreshed token. */
export class SocialStore {
  constructor(dir) {
    this.dir = dir;
    this.file = dir ? path.join(dir, 'social.json') : '';
    this.d = { n: { SP: 0, SR: 0 }, posts: {}, inbox: {}, seen: {}, leads: {}, primed: {}, token: null, errors: {} };
    if (this.file) { try { this.d = { ...this.d, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch { /* first start */ } }
  }
  save() {
    if (!this.file) return;
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.d, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  next(kind) { this.d.n[kind] = (this.d.n[kind] || 0) + 1; return `${kind}${this.d.n[kind]}`; }
  prune(now = Date.now()) { for (const [k, at] of Object.entries(this.d.seen)) if (now - at > 90 * DAY) delete this.d.seen[k]; }
}

/** The owner's words in his own chat: «yes #SP3», «no #SR5», «edit #SP3 new text», «reply #SR5 text», «social», «leads». Null when not one. */
export function parseSocialCommand(text) {
  // «بله پست ۱» / «نه پیام ۳» / «ویرایش پست ۱ …» / «جواب پیام ۳ …»: the Persian word for the kind, Persian or Latin digits
  const t = String(text || '').trim().replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/(^|\s)(?:پست|post)\s*#?\s*(\d+)/i, '$1#SP$2').replace(/(^|\s)(?:پیام|نظر|message|comment)\s*#?\s*(\d+)/i, '$1#SR$2');
  let m;
  if ((m = /^(?:yes|ok|okay|بله|آره|اره|باشه)\s*#?\s*(SP|SR)\s*(\d+)\s*[.!]?(\s*(?:همین\s*)?(?:الان|حالا|فوری|now|right now)\s*[.!]?)?$/i.exec(t))) return { verb: 'yes', kind: m[1].toUpperCase(), id: `${m[1].toUpperCase()}${m[2]}`, ...(m[3] ? { now: true } : {}) };
  if ((m = /^(?:no|cancel|نه|خیر|لغو)\s*#?\s*(SP|SR)\s*(\d+)\s*[.!]?(?:\s*[:\-،,]?\s*([\s\S]+))?$/i.exec(t))) return { verb: 'no', kind: m[1].toUpperCase(), id: `${m[1].toUpperCase()}${m[2]}`, ...(m[3]?.trim() ? { text: m[3].trim() } : {}) };
  if ((m = /^(?:taste|سلیقه|سلیقه‌ی من|سلیقه من)\s*[:\-]?\s*([\s\S]+)$/i.exec(t))) return { verb: 'taste', text: m[1].trim() };
  if ((m = /^(?:edit|ویرایش|اصلاح)\s*#?\s*SP\s*(\d+)\s*[:\-]?\s*([\s\S]+)$/i.exec(t))) return { verb: 'edit', kind: 'SP', id: `SP${m[1]}`, text: m[2].trim() };
  if ((m = /^(?:retry|again|دوباره|مجدد)\s*#?\s*SP\s*(\d+)\s*[.!]?$/i.exec(t))) return { verb: 'retry', kind: 'SP', id: `SP${m[1]}` };
  if ((m = /^(?:reply|answer|جواب|پاسخ)\s*#?\s*SR\s*(\d+)\s*[:\-]?\s*([\s\S]+)$/i.exec(t))) return { verb: 'reply', kind: 'SR', id: `SR${m[1]}`, text: m[2].trim() };
  if (/^(?:social|social status|سوشال|وضعیت سوشال|وضعیت اینستاگرام)\s*[?؟]?$/i.test(t)) return { verb: 'status' };
  if (/^(?:leads|social leads|لیدها|مشتری(?:‌|\s)?های بالقوه)\s*[?؟]?$/i.test(t)) return { verb: 'leads' };
  return null;
}

/** «پست کاتالوگ ۱۸۰۵ …» / «post catalogue 212 …»: a colour of the catalogues by its code, with the owner's words after it. Null when not one. */
const plainCode = (text) => String(text || '').trim().replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/اچ[\s‌]*زد/g, 'HZ');
export function catalogRequest(text) {
  const t = plainCode(text);
  const m =/^(?:پست|post)\s+(?:کاتالوگ|کاتالوگی|catalog(?:ue)?)\s*:?\s*(?:کد|code)?\s*#?\s*([A-Za-z]{0,3}\s*\d{3,4})(?![\d])\s*[:،,\-]?\s*([\s\S]*)$/i.exec(t);
  return m ? { code: m[1].replace(/\s+/g, '').toUpperCase(), note: m[2].trim() } : null;
}

/**
 * «طرح» / «پیشنهاد طرح» (the designer chooses everything), «طرح آشپزخانه» (the room), «طرح ۸۳۲ کمد دیواری» (built around that colour).
 * Returns { code, note } (code '' when none) or null.
 */
export function designRequest(text) {
  const ba = /^(?:پیش\s*و\s*پس|قبل\s*و\s*بعد|before\s*(?:and|&|\/)\s*after)\s*:?\s*([\s\S]*)$/i.exec(plainCode(text)); // a before/after design now
  if (ba) { const c = /^(?:کد|code)?\s*#?\s*([A-Za-z]{0,3}\s*\d{3,4})(?![\d])\s*[:،,\-]?\s*([\s\S]*)$/i.exec(ba[1].trim()); return { code: c ? c[1].replace(/\s+/g, '').toUpperCase() : '', note: (c ? c[2] : ba[1]).trim(), pillar: 'transform' }; }
  const m = /^(?:پیشنهاد\s+طرح|طرح|design)(?=\s|:|$)\s*:?\s*([\s\S]*)$/i.exec(plainCode(text));
  if (!m) return null;
  const c = /^(?:کد|code)?\s*#?\s*([A-Za-z]{0,3}\s*\d{3,4})(?![\d])\s*[:،,\-]?\s*([\s\S]*)$/i.exec(m[1].trim());
  return c ? { code: c[1].replace(/\s+/g, '').toUpperCase(), note: c[2].trim() } : { code: '', note: m[1].trim() };
}

/**
 * Google's image model (Gemini, «Nano Banana») through its official API: a prompt and reference pictures in, one picture out.
 * [apiKey] from Google AI Studio, [model] e.g. gemini-nano-banana-2.1. make() throws with Google's own words when no picture comes back.
 */
export class GeminiImage {
  constructor({ apiKey, model = 'gemini-3-pro-image', size = '2K', fetchImpl = globalThis.fetch }) { Object.assign(this, { apiKey, model, size, fetchImpl }); }
  get enabled() { return !!this.apiKey; }
  async make({ prompt, images = [], aspect = '4:5', size = '' }) {
    const body = {
      contents: [{ role: 'user', parts: [...images.flatMap((i) => [...(i.label ? [{ text: i.label }] : []), { inline_data: { mime_type: i.mime || 'image/jpeg', data: i.buffer.toString('base64') } }]), { text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect, ...((size || this.size) ? { imageSize: size || this.size } : {}) } },
    };
    const res = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`Gemini: ${data.error?.message || `HTTP ${res.status}`}`);
    const c = data.candidates?.[0];
    const parts = (c?.content?.parts || []).filter((p) => !p.thought);
    const pic = parts.map((p) => p.inlineData || p.inline_data).filter((d) => d?.data && /^image\//.test(d.mimeType || d.mime_type || '')).pop(); // the last picture is the final one
    if (!pic) throw new Error(`Gemini gave no picture (${c?.finishReason || data.promptFeedback?.blockReason || 'no reason given'}): ${parts.map((p) => p.text).filter(Boolean).join(' ').slice(0, 200)}`);
    return { image: Buffer.from(pic.data, 'base64'), mime: pic.mimeType || pic.mime_type };
  }
  /** A 30-second instrumental clip from Google's music model (Lyria, the Interactions API): an MP3. Throws with Google's words. */
  async music(prompt, model = 'lyria-3-clip-preview') {
    const res = await this.fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', { method: 'POST', headers: { 'content-type': 'application/json', 'Api-Revision': '2026-05-20', 'x-goog-api-key': this.apiKey }, body: JSON.stringify({ model, input: prompt }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`Lyria: ${data.error?.message || `HTTP ${res.status}`}`);
    const audio = (data.steps || []).filter((s) => s.type === 'model_output').flatMap((s) => s.content || []).filter((c) => c.type === 'audio' && c.data).pop();
    if (!audio) throw new Error('Lyria gave no audio');
    return Buffer.from(audio.data, 'base64');
  }
}

/**
 * Atossa, the head of the ARYAK design studio (the owner, 15/11: «she is the manager and the designer of the design department; the
 * whole job is hers»). One character for everything she makes: the trends she follows, the rooms she designs, the captions she writes.
 */
export const ATOSSA = `You are Atossa, Creative Director and lead interior designer of the ARYAK Design Studio in Dubai.
Every design starts with people: who lives there, how they cook, host and store, and the room's size and light. Plan the layout first (work zones, landing space beside sink and hob, clear walkways), then choose the finishes.
Your rules for surfaces (the craft of the best studios):
- At most three finishes in a room, in a 60-30-10 balance by visual weight: one dominant film, one supporting film or stone, one small accent.
- Match undertones, warm with warm and cool with cool; contrast in light, middle and dark steps on the same undertone.
- Never two loud patterns side by side: every strong wood grain or veined stone sits beside a calm solid or a quiet texture.
- Pattern scale follows the surface: bold grain or veins on large, focal surfaces (island, TV wall, majlis feature wall), fine quiet patterns on small or busy ones.
- Wood grain runs in one direction and continues from door to door: horizontal to widen and calm, vertical to lift.
- Repeat each finish at least twice in the room so it looks intended.
- Matte, anti-fingerprint films for busy family rooms; gloss only where light must bounce.
- Light every room in warm, dimmable layers (2700 to 3000 K): ambient, task and accent, with grazing light where texture must show.
For the Gulf: warm sand, taupe and greige with one deeper accent, veined stone with warm-grey veins, natural textures, quiet luxury, a generous and practical majlis for large families. Timeless over trendy: trends are seasoning, never the meal.
Your eye is editorial: you read Architectural Digest, Elle Decor, Dezeen, ArchDaily, Dwell, Houzz and Pinterest, and you know what the great kitchen and wardrobe brands show this season.
You present every design as a story that sells the film: the hero room first, then slow side-lit close-ups of each film (wood grain longest and closest), then the details, then the codes.
Your voice: confident, warm, expert and short; never salesy, never a claim you cannot prove.`;

export const TREND_RULES = `${ATOSSA}
This morning you scan the world's best interior design sources for new ideas: Pinterest (trends and Pinterest Predicts), Architectural Digest, Elle Decor, Dezeen, ArchDaily (real luxury projects, many in Dubai, Milan and London), Dwell, Houzz (kitchen layouts, islands, built-in ovens and coffee machines, under-cabinet light), Behance (interior and kitchen CGI: camera angles and studio light), and the gold standard of luxury cabinetry: Poliform, Molteni&C, Snaidero, Arclinea, Boffi, Dada (handleless, super-matte, dark tones with brass or copper). Search the web; prefer pages from the last few weeks.
Write today's notes for your studio: 5 to 8 short English bullet points of concrete ideas you can use with decorative films on cabinets, wardrobes, wall panels and doors (colour pairings, wood and stone looks, finishes, details, layouts, lighting), each with its source site in brackets.
Then one line starting with «فارسی:» with two Persian sentences for the owner: the most useful idea of the day.
Also look at what interior, kitchen and wardrobe videos people watch and save on TikTok and Instagram Reels this week (search the web: TikTok Creative Center, articles and lists of trending interior Reels and TikToks) and add one or two bullets on formats or ideas that work there, with the source.
Last, one line starting with «IMAGES:» and up to four direct addresses of interior pictures from the pages you read (jpg, png or webp, the article's own photos), separated by spaces.
Output only the notes.`;

export const LINK_RULES = `${ATOSSA}
The owner sent you posts he likes (from Instagram, TikTok, Pinterest or a magazine) to inspire your next designs. You see each one's picture and words.
For each, write in English: what to take from it (the layout, the colour pairing of the materials, a detail, the lighting style, the camera angle and lens, the format of the post) and which ARYAK films from the list could make it, as a short scene you could build next for ARYAK and the Dubai luxury market.
Then, for the owner, one line per post starting with «فارسی:», two short Persian sentences: what you will take from it and how you will use it in an ARYAK design.
Output only that.`;

export const WATCH_RULES = `${ATOSSA}
These are the most liked recent posts of leading interior design accounts on Instagram (their account and likes are given). In 4 to 6 English bullets: what is working there now (rooms, colours, materials, details, light, camera, the format of the post), each with the account in brackets. Only what you can see.`;

export const LOOKS_RULES = `${ATOSSA}
These are interior pictures from today's design press. For each one, write one short English line of what a designer can take from it for decorative films on cabinets, wardrobes and wall panels: the colours and how they are paired, the wood or stone look, the finish, the light, one detail. Then one line «Together:» with the strongest common idea. Output only the lines.`;

export const FOCUS_RULES = `Look at this interior picture. Give the point at the centre of the largest, best-lit area of the named film, where its colour and texture show best.
x and y go from 0 to 1, from the left and from the top. Answer with JSON only, for example {"x":0.62,"y":0.41}.`;

export const DARIUSH = `You are Dariush, ARYAK's marketing strategist and Atossa's sparring partner. Atossa designs; you make sure every design sells the films on Instagram, TikTok and Facebook and never looks like the last one. The audience: UAE carpentry workshops, kitchen and wardrobe makers, contractors, designers and villa owners. Your one question: would a joiner send this to a client? (Instagram's top signals are watch time, likes and sends; sends reach new people.)
- Novelty first: if a plan repeats a recent composition (same room type with the same layout and key elements), or shares the room type and the camera angle with any of the last three, send it back with a concrete different idea (another room, layout, camera and focal length, style, time of day and light, palette). Lived-in details and real props beat the sterile AI look.
- The design rules: at most three finishes, 60-30-10, matched undertones, one loud pattern, pattern scale fits the surface, grain in one direction. Two films that look almost the same at a glance (two near-black solids, two near-white solids) are never paired: the viewer cannot tell them apart.
- The hook: in the first two seconds the viewer sees motion or the payoff (the film filling the frame in raking light, the finished room), never a logo; a 5 to 7 word keyword headline. The film is the hero, not the furniture.
- Proof: a benefit (anti-fingerprint, scratch resistance, super-matte) only with a visible test or a spec; never an absolute ("scratch-proof").
- Useful and saveable: a clear pairing idea or a detail worth copying; the film code and its place named.
- Gulf taste: modern Arabic, majlis and hosting-ready kitchens fit; Ramadan and Eid renovation, 2 December, September; no alcohol, bar carts, wine or ashtrays, no religious text as decor, people modest if any.
- Honest: it is a design idea made with AI; the film shown is a real ARYAK film.
Be short and concrete; praise only what earns it.`;

export const DARIUSH_RULES = `${DARIUSH}
Read Atossa's plans. Answer with a JSON array, one object per plan in the same order:
[{"verdict":"ok" or "revise","notes":["short concrete changes (empty when ok)"],"hook":"the post's hook in English, 3 to 6 words, the first line of the caption","dialogue_fa":"two short Persian sentences for the owner: what Dariush said and what Atossa changes or keeps"}]
Output only the JSON.`;

export const LOOK_RULES = `Describe this decorative film sample for an interior designer in at most 18 English words:
its colour (warm or cool; light, medium or dark), its pattern (solid colour; the wood it looks like and its grain; stone, concrete or marble and its veins) and its finish.
Output only the description.`;

export const DESIGNER_RULES = `${ATOSSA}
You design the rooms that sell our decorative films: a client must look at the picture and want THAT film on his doors. The owner is not a designer: you choose everything, he only approves or rejects. Each time propose ONE design.
- The films are the heroes. Choose rooms where they cover large, well-lit surfaces seen up close: a full kitchen, a wall of wardrobe doors, a full-height TV feature wall, a walk-in closet, a vanity, a reception desk. The films must fill at least half of the picture.
- Combine one to three films from the list (only codes from the list), the way the best designers do: a main film with character (a rich wood grain or a stone with movement), a second that contrasts (a solid colour, light against dark, warm against cool), at most a small accent; the 60-30-10 balance.
- Use today's notes from the world's design press when they fit: say in inspiration_fa which idea you took and from where.
- The picture must be rich and alive, never plain or empty: layered warm lighting (golden late-afternoon sun through the windows, hidden LED strips grazing the panels so the grain and texture show), fine details (handleless grooves, slim brass or black metal profiles, fluted glass, a marble or quartz worktop, open shelves with styled objects, plants, books, ceramics), depth (a second room or a view beyond), real reflections and soft shadows.
- Luxury, current and livable, for villas and apartments in the UAE. Follow the owner's notes.
- Never repeat a composition (the owner, 15/11: «we must be different»): your recent compositions are listed; change the room type, or at least the layout, the camera angle, the light and the key elements (no second island with drum pendants in front of a wall of tall doors). Rotate styles: Arabic contemporary, Japandi, organic modern, classic shaker, mid-century, minimal monolith, warm industrial, coastal Gulf villa; and rooms: kitchen, walk-in closet, wardrobe wall, TV wall, majlis, home office, library, vanity and bathroom, entrance and console, bedroom headboard wall, kids room, hotel suite, reception desk, dining sideboard.
- The scene: ONE English paragraph of 120 to 180 words for an image model, written as the brief of an editorial photograph for a luxury interior magazine: the camera (35 mm lens, eye level, three-quarter view, slightly close so the film texture is crisp), the light, the materials, each film named by the fronts it covers ("the tall wardrobe doors in film HZ812, its walnut grain running vertically, lit by a warm LED strip"). No people, no text, no logos.
Answer with JSON only:
{"title_fa":"a short Persian title","why_fa":"two or three Persian sentences for the owner: why these films work together and for whom","music":"one English line for the background music of this room's Reel: the mood, the instruments and the tempo, calm and elegant (no artist or song names)","inspiration_fa":"one Persian sentence: the idea of the day you used and its source, or empty","room":"the room in English","parts":[{"code":"HZ818","where":"upper kitchen cabinet doors","where_fa":"درهای کابینت بالا"}],"signature":"one English line: style, room, layout and its three key elements, camera angle","reel_open":"pair (the Reel opens on the films as cards side by side: for a pairing of two or three films) or texture (very close on the main film)","reveal":"when the design has a storage or appliance feature worth showing, what opens in the Reel, in English (the tall pantry doors open on lit shelves; the oven drawer slides out); else empty","scene":"the English paragraph"}`;

/**
 * The owner's mark on a design picture (15/11): the ARYAK logo in the top corner and, along the bottom, a band with each film's swatch
 * and its code. [logo] a PNG with its own plate; [font] a font file for the codes (the server has no fonts of its own). The picture
 * keeps its size (Instagram's ratio is kept). The original when anything fails.
 */
export async function brandDesign(buf, { codes = [], logo = null, font = '', transparent = false } = {}) {
  try {
    const sharp = (await import('sharp')).default;
    const { width: W, height: H } = await sharp(buf).metadata();
    const comps = [];
    const pad = Math.round(W * 0.028);
    if (codes.length) {
      const bandH = Math.round(W * 0.09);
      const sw = Math.round(bandH * 0.6);
      const top = H - bandH + Math.round((bandH - sw) / 2);
      comps.push({ input: { create: { width: W, height: bandH, channels: 4, background: { r: 20, g: 17, b: 14, alpha: 0.74 } } }, top: H - bandH, left: 0 });
      let x = pad;
      for (const c of codes) {
        const items = [];
        if (c.swatch) items.push({ input: await sharp(c.swatch).resize(sw, sw, { fit: 'cover' }).extend({ top: 2, bottom: 2, left: 2, right: 2, background: '#ffffff' }).png().toBuffer(), w: sw + 4, dy: -2 });
        const text = await sharp({ text: { text: `<span foreground="#ffffff">${String(c.code).replace(/[<&>]/g, '')}</span>`, font: `IBM Plex Sans SemiBold ${Math.round(sw * 0.58)}`, ...(font ? { fontfile: font } : {}), dpi: 72, rgba: true } }).png().toBuffer();
        const tm = await sharp(text).metadata();
        items.push({ input: text, w: tm.width, dy: Math.round((sw - tm.height) / 2) });
        const need = items.reduce((s, i) => s + i.w, 0) + Math.round(pad * 0.45) * (items.length - 1);
        if (x + need > W - pad) break; // a band never runs off the picture
        for (const i of items) { comps.push({ input: i.input, top: top + i.dy, left: x }); x += i.w + Math.round(pad * 0.45); }
        x += Math.round(pad * 0.9);
      }
    }
    if (logo) {
      // the black logo, white where its corner is dark (the owner, 15/11: only the logo, no plate): the picture under the logo's own strokes decides
      const lg = await sharp(logo).resize({ width: Math.round(W * 0.17) }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width: lw, height: lh } = lg.info;
      const under = await sharp(buf).extract({ left: pad, top: pad, width: Math.min(lw, W - pad), height: Math.min(lh, H - pad) }).removeAlpha().resize(lw, lh, { fit: 'fill' }).raw().toBuffer();
      let sum = 0, weight = 0;
      for (let i = 0, j = 0; i < lg.data.length; i += 4, j += 3) { const a = lg.data[i + 3]; if (!a) continue; sum += a * (0.2126 * under[j] + 0.7152 * under[j + 1] + 0.0722 * under[j + 2]); weight += a; }
      if (weight && sum / weight < 110) for (let i = 0; i < lg.data.length; i += 4) { lg.data[i] = 255; lg.data[i + 1] = 255; lg.data[i + 2] = 255; }
      comps.push({ input: await sharp(lg.data, { raw: { width: lw, height: lh, channels: 4 } }).png().toBuffer(), top: pad, left: pad });
    }
    // [transparent]: only the marks, on a clear layer of the picture's size (the Reel lays it over the moving picture)
    if (transparent) return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comps).png().toBuffer();
    return comps.length ? await sharp(buf).composite(comps).jpeg({ quality: 90 }).toBuffer() : buf;
  } catch { return buf; }
}

/** Instagram takes a feed photo between 4:5 (tall) and 1.91:1 (wide): the middle is kept, the width is at most 1440, a JPEG comes out. The original when it cannot be read. */
export async function fitForInstagram(buf) {
  try {
    const sharp = (await import('sharp')).default;
    const m = await sharp(buf).rotate().toBuffer({ resolveWithObject: true });
    let { width: w, height: h } = m.info;
    if (!w || !h) return buf;
    let pipe = sharp(m.data);
    if (w / h < 0.8) { const nh = Math.floor(w / 0.8); pipe = pipe.extract({ left: 0, top: Math.floor((h - nh) / 2), width: w, height: nh }); h = nh; }
    else if (w / h > 1.91) { const nw = Math.floor(h * 1.91); pipe = pipe.extract({ left: Math.floor((w - nw) / 2), top: 0, width: nw, height: h }); w = nw; }
    if (w > 1440) pipe = pipe.resize({ width: 1440 });
    return await pipe.jpeg({ quality: 88 }).toBuffer();
  } catch { return buf; }
}

/** «پیشنهادهای اچ‌زد» / «پیشنهاد اچ‌زد ۵ آشپزخانه» / «concepts HZ»: numbered concepts of a catalogue family. { family, n, note } or null. */
export function conceptsRequest(text) {
  const m = /^(?:پیشنهاد(?:\s*ها(?:ی)?|‌ها(?:ی)?)?|concepts?)\s+(?:از\s+)?(?:کاتالوگ\s+)?(HZ|کاتالوگ\s+جدید|جدید)\s*(\d{1,2})?\s*(?:تا|عدد)?\s*[:،,\-]?\s*([\s\S]*)$/i.exec(plainCode(text));
  if (!m) return null;
  return { family: 'HZ', n: Math.min(6, Math.max(1, Number(m[2]) || 4)), note: m[3].trim() };
}
/** «شماره ۱» / «شماره ۲ جزیره روشن‌تر»: the concept the owner chose, with his edit. { n, note } or null. */
export function conceptChoice(text) {
  // «شماره یک …» / «پیشنهاد دوم …»: the number as a word too (the owner wrote «شماره یک ولی …», 15/11)
  const words = { 'یک': 1, 'اول': 1, 'یکم': 1, 'دو': 2, 'دوم': 2, 'سه': 3, 'سوم': 3, 'چهار': 4, 'چهارم': 4, 'پنج': 5, 'پنجم': 5, 'شش': 6, 'ششم': 6 };
  const t = plainCode(text).replace(/^((?:شماره|پیشنهاد|طرح)\s*(?:ی\s+)?)(یکم|یک|اول|دوم|دو|سوم|سه|چهارم|چهار|پنجم|پنج|ششم|شش)(?=\s|$|[:،,\-])/u, (_, a, w) => `${a.startsWith('شماره') ? a : 'شماره '}${words[w]}`);
  const m = /^(?:شماره|number|no\.?)\s*(\d{1,2})(?!\d)\s*[:،,\-]?\s*([\s\S]*)$/i.exec(t);
  return m ? { n: Number(m[1]), note: m[2].replace(/^(?:ولی|اما|و|but|with)\s+/i, '').trim() } : null;
}

/** «الهام …» / «inspiration …»: a picture the owner liked; Atossa remakes its mood with ARYAK films. Returns { note } or null. */
export function inspirationRequest(caption) {
  const m = /^\s*(?:الهام|inspiration|inspire)(?=\s|:|$)\s*:?\s*([\s\S]*)$/i.exec(String(caption || ''));
  return m ? { note: m[1].trim() } : null;
}

/** A photo's caption that asks for a post: «post …», «پست …», «instagram …», «اینستا …». Returns { note } (the rest of the caption) or null. */
/**
 * The owner's change to a drafted design: a reply to one of its messages (the quoted text carries «#SP22») or «تغییر پست ۲۲ …» /
 * «اصلاح طرح ۲۲ …». { id, note } or null. A caption edit («ویرایش پست …») and the yes / no commands are not this.
 */
export function designEditRequest(text, quotedText = '') {
  const t = String(text || '').trim().replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  let m = /^(?:تغییر|اصلاح|عوض\s*کن)\s*(?:پست|طرح|post)\s*#?\s*(?:SP)?\s*(\d+)(?!\d)\s*[:\-،,]?\s*([\s\S]+)$/i.exec(t);
  if (m) return { id: `SP${m[1]}`, note: m[2].trim() };
  if (!t || parseSocialCommand(t) || /https?:\/\//.test(t)) return null;
  m = /#SP(\d+)/i.exec(String(quotedText || ''));
  return m && t.length >= 4 ? { id: `SP${m[1]}`, note: t } : null;
}

/**
 * Plain words about a design (live 16/11: «HZ816 is a black wood and the camera should move like reel 24» came right after #SP26 and got
 * «I did not understand»): words about rooms, films, colours, light, the camera, the Reel or the music, and nothing about money.
 */
export function looksLikeDesignNote(text) {
  const t = String(text || '');
  if (t.length < 6 || /https?:\/\//.test(t)) return false;
  if (/فاکتور|invoice|پرداخت|صندوق|گزارش|هزینه|حقوق|بدهی|چک|received|cash|expense|unbilled|qbo|quickbooks/i.test(t)) return false;
  return /طرح|ریلز|reel|دوربین|رنگ|نور|کابینت|درب|دیوار|زاویه|موزیک|آهنگ|بافت|چوب|سنگ|جزیره|سقف|کف|عکس|نما|HZ\s*\d|TS\s*\d|\bکد\b/i.test(t);
}

/**
 * Words only about the Reel (live 16/11: «make this Reel longer and let the camera turn in the space», a reply to #SP23, redrew the room
 * twice and made a new post): its length, the music, the camera move; nothing about what the room shows.
 */
export function reelOnlyNote(text) {
  const t = String(text || '');
  if (!/ریلز|reel|ویدیو|ویدئو|video|دوربین|camera|موزیک|موسیقی|آهنگ|music|تایم|زمان|طول|ثانیه|کوتاه|بلند/i.test(t)) return false;
  return !/رنگ|کابینت|چوب|سنگ|نور|دیوار|درب|در ها|جزیره|سقف|کف|عکس|طرح|سبک|کمد|میز|صندلی|HZ\s*\d|TS\s*\d|\bکد\b|اضافه|حذف|بردار|جزئیات|دیتیل|مدرن|کلاسیک/i.test(t);
}

/** «رتوش پست ۲۵ …»: a small fix of a drafted design's picture, the design kept. { id, note } or null. */
export function retouchRequest(text) {
  const t = String(text || '').trim().replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  const m = /^(?:رتوش|retouch)\s*(?:پست|post)?\s*#?\s*(?:SP)?\s*(\d+)(?!\d)\s*[:\-،,]?\s*([\s\S]+)$/i.exec(t);
  return m ? { id: `SP${m[1]}`, note: m[2].trim() } : null;
}

/** «ریلز پست ۲۴ …» / «ریلز ۲۴ …»: only the Reel of a drafted design made again. { id, note } or null. */
export function reelRequest(text) {
  const t = String(text || '').trim().replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  const m = /^(?:ریلز|reel)\s*(?:پست|post)?\s*#?\s*(?:SP)?\s*(\d+)\s*[:\-،,]?\s*([\s\S]*)$/i.exec(t);
  return m ? { id: `SP${m[1]}`, note: m[2].trim() } : null;
}

/** A message of the owner with web links (Instagram, TikTok, Pinterest, a magazine…): { urls, note } for Atossa to study; null when none. */
export function linkRequest(text) {
  const urls = [...new Set((String(text || '').match(/https?:\/\/[^\s<>«»"']+/g) || []).map((u) => u.replace(/[),.;!؟،]+$/, '')))];
  if (!urls.length) return null;
  const note = String(text).replace(/https?:\/\/[^\s<>«»"']+/g, ' ').replace(/\s+/g, ' ').trim();
  return { urls: urls.slice(0, 8), note };
}

export function postRequest(caption) {
  const m = /^\s*(?:post|instagram|insta|پست|اینستا|اینستاگرام)(?=\s|:|$)\s*:?\s*([\s\S]*)$/i.exec(String(caption || ''));
  return m ? { note: m[1].trim() } : null;
}

export const CAPTION_RULES = `You write social media captions for {BRAND}, in the voice of Atossa, its design director: confident, warm, expert, never salesy.
Write ONE caption for Instagram and Facebook from the photo and the owner's note.
- First a short English part (one to three sentences), then the same in Arabic.
- Then 4 to 8 relevant hashtags on one line (English, one or two Arabic).
- Say only what the photo shows and what the note says: never invent a price, a discount, a stock amount, a size or a delivery promise.
- {CONTACT}
- At most two emoji. No quotation marks around the caption.
Output only the caption.`;

export const REPLY_RULES = `You draft a reply for {BRAND} to a comment or a direct message on Instagram or Facebook. The owner reads it before it is sent.
- Answer in the language of the person (English, Arabic, Persian, Hindi or Urdu as they wrote), short and friendly, at most three sentences.
- Never give a price, a discount, a stock amount or a delivery date. For a price, an order or anything about stock, thank them and invite them to message us. {CONTACT}
- A comment that is only praise or an emoji gets a short thank you.
- Spam, abuse or a message that needs no answer: output exactly SKIP.
Output only the reply.`;

const fill = (rules, cfg) => rules.replace('{BRAND}', cfg.brand || 'ARYAK').replace(/\{CONTACT\}/g, cfg.contact ? `Our WhatsApp for orders and prices: ${cfg.contact}.` : 'Do not invent a phone number or a link.');

/** One source's items of the last look: { key, platform, kind, id, from, fromId, name, text, at, context, link, convId }. */
function itemsFromIgComments(media, comments, own) {
  return (comments.data || []).filter((c) => !own(c.from?.id, c.username)).map((c) => ({
    key: `igc:${c.id}`, platform: 'instagram', kind: 'comment', id: c.id, fromId: c.from?.id || c.username || '', name: c.username ? `@${c.username}` : 'someone',
    text: c.text || '', at: Date.parse(c.timestamp) || Date.now(), context: String(media.caption || '').slice(0, 80), link: media.permalink || '',
  }));
}
function itemsFromConversations(platform, conv, own) {
  const out = [];
  for (const c of conv.data || []) {
    for (const m of c.messages?.data || []) {
      if (own(m.from?.id, m.from?.username) || !m.message) continue;
      out.push({ key: `${platform === 'instagram' ? 'igm' : 'fbm'}:${m.id}`, platform, kind: 'message', id: m.id, fromId: m.from?.id || '', name: m.from?.username ? `@${m.from.username}` : (m.from?.name || 'someone'), text: m.message, at: Date.parse(m.created_time) || Date.now(), convId: c.id });
    }
  }
  return out;
}
function itemsFromFbFeed(feed, own) {
  const out = [];
  for (const post of feed.data || []) {
    for (const c of post.comments?.data || []) {
      if (own(c.from?.id) || !c.message) continue;
      out.push({ key: `fbc:${c.id}`, platform: 'facebook', kind: 'comment', id: c.id, fromId: c.from?.id || '', name: c.from?.name || 'someone', text: c.message, at: Date.parse(c.created_time) || Date.now(), context: String(post.message || '').slice(0, 80), link: post.permalink_url || '' });
    }
  }
  return out;
}

const where = (it) => `${it.platform === 'instagram' ? 'Instagram' : 'Facebook'} ${it.kind}`;
const ago = (ms) => { const h = Math.round(ms / 3600000); return h < 1 ? 'just now' : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`; };

/**
 * The desk: [client] a MetaClient, [store] a SocialStore, [write] async ({ kind: 'caption' | 'reply', system, text, image?, mime? }) => text,
 * [cfg] { brand, contact }, [mediaDir] where the photo of a draft waits for the yes.
 */
// ---- when a post goes out (the owner, 15/11, from the research report): the hours the Gulf looks at its phone, Dubai time.
// Every day 12:00-14:00 and 19:00-22:00, Friday only the evening (the noon prayer); in Ramadan 21:00-01:00 (after Taraweeh).
// Ramadan by the Umm al-Qura calendar (a day either way is fine for this).
const RAMADAN = [['2027-02-08', '2027-03-09'], ['2028-01-28', '2028-02-26'], ['2029-01-16', '2029-02-14'], ['2030-01-05', '2030-02-03']];
export function gulfParts(ms, timeZone = 'Asia/Dubai') {
  const f = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${f.year}-${f.month}-${f.day}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(f.weekday), minutes: Number(f.hour) * 60 + Number(f.minute) };
}
const inRamadan = (day) => RAMADAN.some(([a, b]) => day >= a && day <= b);
export function goodHour(ms, timeZone = 'Asia/Dubai') {
  const p = gulfParts(ms, timeZone);
  const before = gulfParts(ms - 3 * 3600 * 1000, timeZone); // after midnight still belongs to the Ramadan night before
  if (inRamadan(p.day) || (p.minutes < 60 && inRamadan(before.day))) return p.minutes >= 21 * 60 || p.minutes < 60;
  if (p.minutes >= 19 * 60 && p.minutes < 22 * 60) return true;
  return p.weekday !== 5 && p.minutes >= 12 * 60 && p.minutes < 14 * 60;
}
/** The first good minute from [ms] on (ms itself when it is good), on the quarter hour. */
export function nextGoodTime(ms, timeZone = 'Asia/Dubai') {
  if (goodHour(ms, timeZone)) return ms;
  const q = 15 * 60 * 1000;
  for (let t = Math.ceil(ms / q) * q; t < ms + 4 * DAY; t += q) if (goodHour(t, timeZone)) return t;
  return ms;
}

// ---- the weekly mix (the owner, 15/11, from the research report): proof of the product, inspiration, education, real jobs.
// Atossa's daily proposal takes the kind the week is most short of; real jobs need the owner's photos, so she asks for one.
export const PILLARS = {
  proof: { share: 0.35, fa: 'اثبات کیفیت', brief: 'PILLAR: product proof. The film is the whole picture: a close vignette (one cabinet front, a drawer, a door edge, a corner), not a whole room, in raking light, where its texture, its matte or gloss surface and its edge are seen up close; one film, at most one partner. The Reel shows the surface.', caption: 'This post proves the product: name one real quality of the film the picture shows (texture, matte surface, edge) with no absolute claim.' },
  transform: { share: 0.10, fa: 'پیش و پس', brief: 'PILLAR: before and after. Choose a room people really renovate in the UAE (a dated villa kitchen, a tired wardrobe wall, an old TV wall) and show it after, refaced with ARYAK films: same layout and cabinet sizes, new fronts, light and styling. The scene is the AFTER; a before picture is made from it.', caption: 'This is a before and after: the first picture is the room before, the next one after it was refaced with ARYAK films (a design idea). Open with the change in one line, then the codes.' },
  inspiration: { share: 0.15, fa: 'الهام', brief: 'PILLAR: inspiration. A whole room that people want to live in and save.', caption: '' },
  education: { share: 0.15, fa: 'آموزش', brief: 'PILLAR: education. Teach one thing a joiner or a villa owner can use: where this finish suits and where not, how to pair it, how to match the edge banding, how to care for it. The room shows that lesson clearly.', caption: 'This post teaches: give the lesson in three short, useful points (where it suits, how to pair it, how to care for it) before the codes.' },
  real: { share: 0.20, fa: 'کار واقعی', brief: '', caption: '' },
};

export class SocialDesk {
  constructor({ client, store, write, research = null, reel = null, tiktok = null, bucket = null, cfg = {}, mediaDir = '', catalogDir = '', brandDir = '', imager = null, log = () => {}, now = () => Date.now() }) {
    Object.assign(this, { client, store, write, research, reel, tiktok, bucket, cfg, mediaDir, catalogDir, brandDir, imager, log, now });
  }
  get enabled() { return this.client.hasIg || this.client.hasFb; }
  /** The system-user way: the Page token and the Instagram account are read once; a failure is said in «social». */
  async ready() {
    try { await this.client.ready?.(); delete this.store.d.errors.connect; } catch (e) { this.store.d.errors.connect = { message: e.message, at: this.now() }; this.log(`social: connect failed: ${e.message}`); }
  }

  /** A photo from the owner with «post …»: a caption is written and shown as #SP n; nothing is posted. */
  async draftPost({ image, mime = 'image/jpeg', note = '', facts = '', fitted = false, pillar = '', made = null }) {
    await this.ready();
    if (!this.enabled) return 'Instagram and Facebook are not connected yet, so nothing can be posted.';
    // a tall phone photo is cut to 4:5, or Instagram refuses it; the owner's own photos carry the logo like every post (15/11)
    if (!fitted) { image = await brandDesign(await fitForInstagram(image), { ...this.brandAssets(), codes: this.codesIn(note) }); mime = 'image/jpeg'; }
    const ask = [facts, note ? `The owner's note: ${note}` : facts ? '' : 'The owner gave no note; describe what the photo shows.'].filter(Boolean).join('\n');
    const caption = String(await this.write({ kind: 'caption', system: fill(CAPTION_RULES, this.cfg), text: ask, image, mime }) || '').trim();
    if (!caption) return 'No caption could be written; send the photo again.';
    const id = this.store.next('SP');
    if (made) made.id = id; // the caller's own post (two designs made at once must not take each other's: live 15/11)
    let file = '';
    if (this.mediaDir) { fs.mkdirSync(this.mediaDir, { recursive: true }); file = path.join(this.mediaDir, `${id}.jpg`); fs.writeFileSync(file, image); }
    this.store.d.posts[id] = { id, at: this.now(), note, caption, file, mime, state: 'draft', pillar: pillar || (fitted ? '' : 'real'), image: file ? undefined : image?.toString('base64') };
    this.store.save();
    return this.postPreview(id);
  }
  /** The catalogue colours a note names («پست کد ۸۱۲ و ۱۸۰۵ کابینت»): [{ code, swatch }], at most four, only codes the catalogues have. */
  codesIn(note) {
    const all = this.catalog();
    const out = [];
    for (const m of plainCode(note).matchAll(/(?:^|[^A-Za-z0-9])((?:[A-Za-z]{1,3}\s*)?\d{3,4})(?!\d)/g)) {
      const c = this.catalogColour(m[1].replace(/\s+/g, '').toUpperCase());
      if (!c.error && !out.some((x) => x.code === c.code)) out.push({ code: c.code, swatch: c.image });
      if (out.length === 4) break;
    }
    return out;
  }

  /** The colours of the catalogues (catalog.json + one 4:5 picture per code, on the server): «پست کاتالوگ ۱۸۰۵» drafts that colour's post. */
  catalog() {
    if (!this.catalogDir) return {};
    try { return JSON.parse(fs.readFileSync(path.join(this.catalogDir, 'catalog.json'), 'utf8')); } catch { return {}; }
  }
  /** A colour of the catalogues by its code: { code, e, image } or { error } (the words for the owner). */
  catalogColour(code) {
    const all = this.catalog();
    // «۸۳۲» alone finds HZ832 when no plain 832 exists (the owner types the number, the catalogue prints the prefix)
    if (!all[code] && /^\d+$/.test(code)) code = Object.keys(all).find((k) => /^[A-Z]+\d+$/.test(k) && k.replace(/^[A-Z]+/, '') === code) || code;
    const e = all[code];
    if (!e) {
      const codes = Object.keys(all);
      return { error: codes.length ? `There is no colour ${code} in the catalogues. Known codes: ${codes.length} (${codes.slice(0, 3).join(', ')} … ${codes.slice(-2).join(', ')}).` : 'The catalogue pictures are not on the server yet.' };
    }
    try { return { code, e, image: fs.readFileSync(path.join(this.catalogDir, e.file)) }; } catch { return { error: `The picture of colour ${code} is missing on the server.` }; }
  }
  /** The owner's logo and the font of the codes (social/brand on the server): { logo, font }, empty when missing. */
  brandAssets() {
    const at = (f) => (this.brandDir && fs.existsSync(path.join(this.brandDir, f)) ? path.join(this.brandDir, f) : '');
    return { logo: at('logo.png') ? fs.readFileSync(at('logo.png')) : null, font: at('IBMPlexSans-SemiBold.ttf') };
  }
  async draftFromCatalog({ code: asked, note = '' }) {
    const { code, e, image, error } = this.catalogColour(asked);
    if (error) return error;
    const facts = `This is colour code ${code} from the ${e.catalogue}${e.kind ? ` (${e.kind})` : ''}. Name it in the caption as «Code ${code}». The picture is the colour sample itself (a decorative film for furniture), not a room.`;
    // the logo in the top corner like every design (the owner, 15/11); the catalogue picture already carries its code
    return this.draftPost({ image: await brandDesign(image, this.brandAssets()), mime: 'image/jpeg', note, facts, fitted: true, pillar: 'proof' });
  }
  /** A short look of every colour (colour, pattern, finish), asked once from its picture and kept in catalog.json: what the designer reads. */
  async ensureLooks({ batch = 6 } = {}) {
    const all = this.catalog();
    const todo = Object.keys(all).filter((k) => !all[k].look);
    if (!todo.length) return 0;
    let done = 0;
    const sharp = (await import('sharp').catch(() => null))?.default;
    for (let i = 0; i < todo.length; i += batch) {
      await Promise.all(todo.slice(i, i + batch).map(async (code) => {
        try {
          let image = fs.readFileSync(path.join(this.catalogDir, all[code].file));
          if (sharp) image = await sharp(image).resize({ width: 384 }).jpeg({ quality: 80 }).toBuffer().catch(() => image);
          const look = String(await this.write({ kind: 'look', system: LOOK_RULES, text: `Film ${code} (${all[code].kind || all[code].catalogue || ''})`, image, mime: 'image/jpeg' }) || '').trim().replace(/\s+/g, ' ').slice(0, 200);
          if (look) { all[code].look = look; done++; }
        } catch (err) { this.log(`social: the look of ${code} failed: ${err.message}`); }
      }));
      try { fs.writeFileSync(path.join(this.catalogDir, 'catalog.json'), JSON.stringify(all, null, 1)); } catch (err) { this.log(`social: the looks could not be kept: ${err.message}`); }
    }
    this.log(`social: ${done} colour looks written`);
    return done;
  }

  /** The designer's plan: { title_fa, why_fa, room, parts: [{ code, where, where_fa }], scene } or { error }. */
  async designPlan({ code = '', note = '', inspiration = null, pillar = '' } = {}) {
    const all = this.catalog();
    const d = this.store.d;
    const text = [
      'The films (code: look [catalogue]):',
      ...Object.entries(all).map(([k, e]) => `${k}: ${e.look || e.kind || 'decorative film'} [${e.catalogue || ''}]`),
      this.recentCompositions() ? `\nYour recent compositions (never repeat them):\n${this.recentCompositions()}` : '',
      (d.taste || []).length ? `\nThe owner's notes on your earlier proposals (follow them):\n${d.taste.slice(-15).map((x) => `- ${x.text}`).join('\n')}` : '',
      this.todayTrends() ? `\nToday's notes from the world's design press (your own research this morning):\n${this.todayTrends()}` : '',
      PILLARS[pillar]?.brief ? `\nThis post's job: ${PILLARS[pillar].brief}` : '',
      code ? `\nThe owner asks for a design built around film ${code}: it is the main film.` : '',
      note ? `\nThe owner's words: ${note}` : '',
      inspiration ? '\nThe owner liked the attached picture (his inspiration). Design the same kind of room with the same mood, layout, light and style, but with ARYAK films from the list on the fronts, chosen to match its colours and feeling. Never copy a brand, a logo or text from it. Say in inspiration_fa that the idea is the owner\'s picture.' : '',
      this.todayLooks() ? `\nWhat today's pictures from the design press show (your own eye this morning):\n${this.todayLooks()}` : '',
      this.todayInstagram() ? `\nWhat is working on Instagram now (the most liked recent posts of leading design accounts, your own look this morning):\n${this.todayInstagram()}` : '',
      this.ownerInspirations() ? `\nPosts the owner sent you because he likes them (his taste; take from them, never copy):\n${this.ownerInspirations()}` : '',
    ].filter(Boolean).join('\n');
    // room to think: the morning's notes made the brief longer, and a cut answer has no JSON (live test 15/11); one more try when it is cut
    let plan;
    for (let i = 0; i < 2 && !plan; i++) {
      const raw = String(await this.write({ kind: 'design-plan', system: fill(DESIGNER_RULES, this.cfg), text, effort: 'medium', maxTokens: 12000, ...(inspiration ? { image: inspiration.image, mime: inspiration.mime || 'image/jpeg' } : {}) }) || '');
      try { plan = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { this.log(`social: the plan was not JSON (${raw.length} characters)`); }
    }
    if (!plan) return { error: 'The designer gave no plan; try again.' };
    if (pillar) plan.pillar = pillar;
    // Dariush challenges the plan before anything is drawn; Atossa revises once when he asks (the owner, 15/11: two characters, a talk, the best)
    const [review] = await this.challenge([plan]);
    if (review?.verdict === 'revise' && review.notes?.length) {
      const raw = String(await this.write({ kind: 'design-plan', system: fill(DESIGNER_RULES, this.cfg), text: `${text}\n\nYour first plan:\n${JSON.stringify(plan)}\n\nDariush, your marketing partner, asks for these changes:\n${review.notes.map((x) => `- ${x}`).join('\n')}\nRevise the plan; answer with the full JSON.`, effort: 'medium', maxTokens: 12000, ...(inspiration ? { image: inspiration.image, mime: inspiration.mime || 'image/jpeg' } : {}) }) || '');
      try { const revised = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); if (revised?.scene) plan = revised; } catch { this.log('social: the revised plan was not JSON; the first one stays'); }
    }
    plan.hook = review?.hook || plan.hook || '';
    plan.dialogue_fa = review?.dialogue_fa || '';
    if (pillar) plan.pillar = pillar;
    plan.parts = (Array.isArray(plan.parts) ? plan.parts : []).map((p) => ({ ...p, code: String(p.code || '').replace(/\s+/g, '').toUpperCase() })).filter((p) => all[p.code]).slice(0, 4);
    if (code && !plan.parts.some((p) => p.code === code)) plan.parts.unshift({ code, where: 'the main fronts', where_fa: 'سطح اصلی' });
    if (!plan.parts.length || !plan.scene) return { error: 'The designer chose no colour of the catalogues; try again.' };
    return plan;
  }

  /**
   * «طرح …» and the daily proposal: the designer chooses the room, the style and the films, Gemini draws it with each film's own
   * picture, and it becomes a draft #SP like any other (nothing is posted before the yes). Returns { text, image }: the owner sees the
   * picture with the designer's Persian reasons above the caption.
   */
  async draftDesign({ code: asked = '', note = '', inspiration = null, pillar = '' } = {}) {
    if (!this.imager?.enabled) return { text: 'The design maker (Google Gemini) is not connected yet: its key is missing on the server.' };
    let code = '';
    if (asked) { const c = this.catalogColour(asked); if (c.error) return { text: c.error }; code = c.code; }
    await this.ensureLooks();
    await this.researchTrends().catch((err) => this.log(`social: today's research failed: ${err.message}`));
    const plan = await this.designPlan({ code, note, inspiration, pillar });
    if (plan.error) return { text: plan.error };
    if (inspiration) this.addTaste(`The owner's inspiration picture: ${plan.room}${note ? ` (${note})` : ''}`);
    let roomRaw;
    try { roomRaw = await this.renderRoom(plan, { inspiration }); } catch (err) {
      this.log(`social: design failed: ${err.message}`);
      return { text: `The design could not be made: ${err.message}` };
    }
    return this.produceDesign({ plan, roomRaw, note });
  }

  /** The room of a plan, drawn by Gemini with each film's own picture (and the owner's inspiration as a mood reference). The raw picture. */
  async renderRoom(plan, { inspiration = null } = {}) {
    const all = this.catalog();
    const images = plan.parts.map((p) => ({ label: `Reference: film ${p.code}, for ${p.where}`, buffer: fs.readFileSync(path.join(this.catalogDir, all[p.code].file)), mime: 'image/jpeg' }));
    // the owner's picture guides the room (mood, layout, light) only; the films on the fronts come from the labelled samples
    if (inspiration) images.push({ label: 'Mood and layout reference (the owner\'s inspiration; do not copy its materials, brands or text)', buffer: inspiration.image, mime: inspiration.mime || 'image/jpeg' });
    const made = await this.imager.make({ prompt: `${plan.scene}\nEach labelled reference picture is the exact surface film for the fronts named in its label: reproduce each film's colour, pattern and scale faithfully, each only on its own fronts. An editorial photograph for a luxury interior design magazine: photorealistic, highly detailed, crisp film textures, rich warm light and depth, real reflections and soft shadows. ${TRUE_FILM} ${NO_TEXT} 4:5 portrait.`, images });
    // checked by eye before anything is made from it: drawn once more with the fault named when it carries text, a grid or a wrong film
    const refs = plan.parts.filter((p) => all[p.code]).map((p) => ({ code: p.code, swatch: fs.readFileSync(path.join(this.catalogDir, all[p.code].file)) }));
    const look = await this.cleanCheck(made.image, refs);
    if (look.ok) return made.image;
    this.log(`social: the room was drawn again: ${look.problem}`);
    try { return (await this.imager.make({ prompt: `${plan.scene}\nThe last try was wrong: ${look.problem}. Each labelled reference picture is the exact surface film for the fronts named in its label, each only on its own fronts. An editorial photograph for a luxury interior design magazine, photorealistic. ${TRUE_FILM} ${NO_TEXT} 4:5 portrait.`, images })).image; } catch { return made.image; }
  }

  /** Is this film a wood grain? (its look or kind): wood gets a closer, longer look in the close-up and the Reel (the owner, 15/11). */
  isWood(code) {
    const e = this.catalog()[code] || {};
    return /wood|walnut|oak|grain|teak|ash|maple|cherry|elm|veneer|timber/i.test(`${e.look || ''} ${e.kind || ''}`);
  }

  /** One close-up of one film of the room: wood seen closer, along its grain, in raking light; stone and solids slightly further. */
  async closeUp(room, part, swatch, { size = '' } = {}) {
    const wood = this.isWood(part.code);
    const how = wood
      ? `the camera is about 30 cm from the ${part.where} in film ${part.code}, looking along the wood grain, so the grain, its direction and the pores fill three quarters of the frame, crisp and exactly like the reference sample; low warm light grazing across the surface so every line of the grain shows`
      : `the camera is about 40 cm from the ${part.where} in film ${part.code}, at a slight angle, so the flat film surface itself fills at least three quarters of the frame, evenly and clearly lit (never a dark gradient or a shadow), its exact colour and fine matte texture crisp and exactly like the reference sample; a soft light raking across the surface`;
    let miss = '';
    for (let k = 0; k < 2; k++) {
      const d = await this.imager.make({ prompt: `A close-up detail photograph taken in this same room: ${how}; at one side a slim brass profile, a handle groove or the edge of the worktop; shallow depth of field. Photorealistic editorial macro interior photograph, 4:5 portrait. No people. ${TRUE_FILM} ${NO_TEXT}${miss ? ` The last try was wrong: ${miss}.` : ''}`,
        images: [{ label: 'The room', buffer: room, mime: 'image/jpeg' }, { label: `Reference: film ${part.code}`, buffer: swatch, mime: 'image/jpeg' }], size });
      const look = await this.cleanCheck(d.image, [{ code: part.code, swatch }], { close: true });
      if (look.ok) return fitForInstagram(d.image);
      miss = look.problem;
    }
    throw new Error(`not like the film or not clean twice: ${miss}`); // left out: a wrong close-up is worse than none
  }

  /**
   * The production of a design (the owner, 15/11: «focus on up to three colours; on wood grain more»): the room with the logo and the
   * codes, one close-up per film (up to three), a Reel that visits each film (wood longer and closer), then a draft #SP like any other.
   */
  async produceDesign({ plan, roomRaw, note = '', size = '' }) {
    const all = this.catalog();
    const facts = `This picture is an AI design idea (not a photo of a finished job): ${plan.room}, made with ${plan.parts.map((p) => `«Code ${p.code}» (${p.where})`).join(', ')}. Say in the caption that it is a design idea and name the codes.${plan.hook ? ` Open the caption with this hook, the line that stops the scroll: «${plan.hook}».` : ''}${PILLARS[plan.pillar]?.caption ? ` ${PILLARS[plan.pillar].caption}` : ''}`;
    // the owner's mark (15/11): the ARYAK logo in the top corner, each film's swatch and code along the bottom
    const codes = plan.parts.map((x) => ({ code: x.code, swatch: fs.readFileSync(path.join(this.catalogDir, all[x.code].file)) }));
    const room = await fitForInstagram(roomRaw);
    const image = await brandDesign(room, { ...this.brandAssets(), codes });
    // the close-ups: one per film, wood first (it sells by its grain), at most three
    const order = plan.parts.slice(0, 3).map((x, i) => ({ x, i })).sort((a, b) => Number(this.isWood(b.x.code)) - Number(this.isWood(a.x.code)) || a.i - b.i);
    const shots = [];
    for (const { x, i } of order) {
      try { shots.push({ part: x, wood: this.isWood(x.code), raw: await this.closeUp(room, x, codes[i].swatch, { size }) }); } catch (err) { this.log(`social: the close-up of ${x.code} failed: ${err.message}`); }
    }
    // a before/after (the owner, 15/11): the same room before, with tired plain cabinets, made from the finished room
    let beforeRaw = null;
    if (plan.pillar === 'transform') {
      try {
        beforeRaw = await fitForInstagram((await this.imager.make({ images: [{ label: 'The finished room', buffer: room, mime: 'image/jpeg' }],
          prompt: 'The same room photographed from exactly the same camera position BEFORE the renovation: the same walls, windows, layout and cabinet sizes, but the cabinet and wall fronts are tired, dated plain fronts (yellowed white gloss or worn beige laminate with chipped edges and old handles), flat cool daylight, a little clutter. Realistic, not dirty or ruined. Photorealistic interior photograph, 4:5 portrait. ' + NO_TEXT })).image);
        if (!(await this.cleanCheck(beforeRaw)).ok) { this.log('social: the before picture carried text or a grid: left out'); beforeRaw = null; }
      } catch (err) { this.log(`social: the before picture failed: ${err.message}`); }
    }
    // the function reveal (the owner, 16/11): the same room, the same camera, with what Atossa named opened
    let revealRaw = null;
    if (plan.reveal && String(plan.reveal).trim()) {
      try {
        const all2 = this.catalog();
        revealRaw = await fitForInstagram((await this.imager.make({ images: [{ label: 'The room: keep this exact design and camera', buffer: room, mime: 'image/jpeg' }, ...plan.parts.filter((x) => all2[x.code]).map((x) => ({ label: `Reference: film ${x.code}, for ${x.where}`, buffer: fs.readFileSync(path.join(this.catalogDir, all2[x.code].file)), mime: 'image/jpeg' }))],
          prompt: `The same room from exactly the same camera position, everything the same, except: ${plan.reveal}. Show the inside clearly and beautifully lit (warm LED strips, tidy styled contents), the opened fronts still showing their film. Photorealistic editorial interior photograph, 4:5 portrait. ${TRUE_FILM} ${NO_TEXT}` })).image);
        if (!(await this.cleanCheck(revealRaw)).ok) { this.log('social: the open picture carried text or a grid: left out'); revealRaw = null; }
      } catch (err) { this.log(`social: the open picture failed: ${err.message}`); }
    }
    const mine = {};
    const text = await this.draftPost({ image, mime: 'image/jpeg', note, facts, fitted: true, pillar: plan.pillar || 'inspiration', made: mine });
    const p = this.store.d.posts[mine.id];
    if (!p) return { text };
    p.design = { room: plan.room, codes: plan.parts.map((x) => x.code), title: plan.title_fa, scene: plan.scene, plan: { ...plan, dialogue_fa: undefined, change_fa: undefined } };
    const save = (name, buf) => { if (!this.mediaDir) return ''; const f = path.join(this.mediaDir, name); fs.writeFileSync(f, buf); return f; };
    if (beforeRaw) p.lead = save(`${p.id}-before.jpg`, await brandDesign(beforeRaw, { ...this.brandAssets(), codes: [] }));
    if (revealRaw) p.extras = [save(`${p.id}-open.jpg`, await brandDesign(revealRaw, { ...this.brandAssets(), codes })), ...(p.extras || [])].filter(Boolean);
    p.raw = { ...(revealRaw ? { reveal: save(`${p.id}-open-raw.jpg`, revealRaw) } : {}), room: save(`${p.id}-room.jpg`, room), shots: shots.map((sh, k) => ({ file: save(`${p.id}-shot${k + 1}.jpg`, sh.raw), code: sh.part.code, where: sh.part.where, wood: sh.wood })) };
    const details = [];
    for (const [k, sh] of shots.entries()) {
      const branded = await brandDesign(sh.raw, { ...this.brandAssets(), codes: codes.filter((c) => c.code === sh.part.code) });
      details.push({ code: sh.part.code, image: branded });
      p.extras = [...(p.extras || []), save(`${p.id}-${k + 2}.jpg`, branded)].filter(Boolean);
    }
    let video = null;
    if (this.reel) {
      try { video = await this.makeReelFor({ room, shots, codes, main: plan.parts[0], music: plan.music, opts: plan.reel || null, plan, before: beforeRaw, reveal: revealRaw }); p.reel = save(`${p.id}.mp4`, video); } catch (err) { this.log(`social: the Reel failed: ${err.message}`); }
    }
    this.remember(plan);
    const head = [`پیشنهاد طراحی: ${plan.title_fa || plan.room}`, PILLARS[plan.pillar]?.fa ? `نوع پست: ${PILLARS[plan.pillar].fa}` : '', plan.why_fa || '', plan.inspiration_fa ? `الهام: ${plan.inspiration_fa}` : '', plan.dialogue_fa ? `گفت‌وگوی آتوسا و داریوش: ${plan.dialogue_fa}` : '', plan.change_fa ? `تغییر به خواست شما: ${plan.change_fa}` : '', ...plan.parts.map((x) => `• کد ${x.code}: ${x.where_fa || x.where}`), `(رد با دلیل: «نه پست ${p.id.slice(2)} …»؛ دلیل شما در طرح‌های بعدی به کار می‌رود)`].filter(Boolean).join('\n');
    const extra = [details.length ? `${details.length} close-up${details.length > 1 ? 's' : ''} (${details.map((x) => x.code).join(', ')})` : '', video ? 'a Reel' : ''].filter(Boolean).join(' and ');
    return { text: `${head}\n\n${text}${extra ? `\nWith the post: ${extra}; one yes posts them all.` : ''}`,
      image: p.file ? fs.readFileSync(p.file) : image, details, detail: details[0]?.image || null, video };
  }

  // ---- concepts (the owner, 15/11): several numbered proposals of a catalogue, he picks one («شماره ۱ …»), it is then produced
  /**
   * [n] concepts that use only the films of one family (HZ…): one plan call for all (so they differ: single-film rooms and pairings),
   * each room drawn once. Kept as the concepts of the day; returns [{ n, text, image }].
   */
  async draftConcepts({ family = 'HZ', n = 4, note = '' } = {}) {
    if (!this.imager?.enabled) return [{ n: 0, text: 'The design maker (Google Gemini) is not connected yet: its key is missing on the server.' }];
    await this.ensureLooks();
    await this.researchTrends().catch((err) => this.log(`social: today's research failed: ${err.message}`));
    const all = this.catalog();
    const allowed = Object.keys(all).filter((k) => k.toUpperCase().startsWith(family.toUpperCase()));
    if (!allowed.length) return [{ n: 0, text: `There is no film of the ${family} catalogue on the server.` }];
    const text = [
      `The films you may use (only these, the ${family} catalogue; code: look):`,
      ...allowed.map((k) => `${k}: ${all[k].look || all[k].kind || 'decorative film'}`),
      this.todayTrends() ? `\nToday's notes from the world's design press:\n${this.todayTrends()}` : '',
      this.todayLooks() ? `\nWhat today's press pictures show:\n${this.todayLooks()}` : '',
      (this.store.d.taste || []).length ? `\nThe owner's notes (follow them):\n${this.store.d.taste.slice(-15).map((x) => `- ${x.text}`).join('\n')}` : '',
      note ? `\nThe owner's words: ${note}` : '',
      this.recentCompositions() ? `\nYour recent compositions (never repeat them, and make the ${n} concepts differ from each other in room, layout, style and camera):\n${this.recentCompositions()}` : '',
      `\nPropose ${n} different concepts: at least one that uses a single film alone (a monochrome room that lets one film speak), the others your best pairings of two or three films. Each a different room. Answer with a JSON array of ${n} objects in the plan format.`,
    ].filter(Boolean).join('\n');
    let plans = null;
    for (let i = 0; i < 2 && !Array.isArray(plans); i++) {
      const raw = String(await this.write({ kind: 'concepts', system: fill(DESIGNER_RULES, this.cfg), text, effort: 'medium', maxTokens: 20000 }) || '');
      try { plans = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)); } catch { this.log(`social: the concepts were not JSON (${raw.length} characters)`); }
    }
    if (!Array.isArray(plans)) return [{ n: 0, text: 'The designer gave no concepts; try again.' }];
    // Dariush looks at all of them before anything is drawn; the ones he sends back are revised together, once
    const reviews = await this.challenge(plans);
    if (reviews.some((r) => r?.verdict === 'revise' && r.notes?.length)) {
      const asks = reviews.map((r, i) => (r?.verdict === 'revise' && r.notes?.length ? `Concept ${i + 1}: ${r.notes.join('; ')}` : `Concept ${i + 1}: keep`)).join('\n');
      const raw = String(await this.write({ kind: 'concepts', system: fill(DESIGNER_RULES, this.cfg), text: `${text}\n\nYour first concepts:\n${JSON.stringify(plans)}\n\nDariush, your marketing partner, asks:\n${asks}\nRevise them; answer with the full JSON array of ${n}.`, effort: 'medium', maxTokens: 20000 }) || '');
      try { const revised = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)); if (Array.isArray(revised) && revised.length) plans = revised; } catch { this.log('social: the revised concepts were not JSON; the first ones stay'); }
    }
    plans.forEach((pl, i) => { pl.hook = reviews[i]?.hook || pl.hook || ''; pl.dialogue_fa = reviews[i]?.dialogue_fa || ''; });
    const items = [];
    for (const pl of plans.slice(0, n)) {
      pl.parts = (Array.isArray(pl.parts) ? pl.parts : []).map((p) => ({ ...p, code: String(p.code || '').replace(/\s+/g, '').toUpperCase() })).filter((p) => allowed.includes(p.code)).slice(0, 3);
      if (!pl.parts.length || !pl.scene) continue;
      try {
        const raw = await this.renderRoom(pl);
        const k = items.length + 1;
        const file = this.mediaDir ? path.join(this.mediaDir, `concept-${this.now().toString(36)}-${k}.jpg`) : '';
        if (file) { fs.mkdirSync(this.mediaDir, { recursive: true }); fs.writeFileSync(file, raw); }
        const preview = await brandDesign(await fitForInstagram(raw), { ...this.brandAssets(), codes: pl.parts.map((x) => ({ code: x.code, swatch: fs.readFileSync(path.join(this.catalogDir, all[x.code].file)) })) });
        items.push({ n: k, plan: pl, file, image: file ? undefined : raw.toString('base64'), preview });
        this.remember(pl); // a concept shown is a composition used, chosen or not
      } catch (err) { this.log(`social: concept failed: ${err.message}`); }
    }
    this.store.d.concepts = { at: this.now(), family, items: items.map(({ preview, ...x }) => x) };
    this.store.save();
    if (!items.length) return [{ n: 0, text: 'No concept could be drawn; try again.' }];
    return items.map((x) => ({ n: x.n, image: x.preview, text: [`پیشنهاد شمارهٔ ${x.n}: ${x.plan.title_fa || x.plan.room}`, x.plan.why_fa || '', ...x.plan.parts.map((p) => `• کد ${p.code}: ${p.where_fa || p.where}`), x.plan.dialogue_fa ? `گفت‌وگوی آتوسا و داریوش: ${x.plan.dialogue_fa}` : ''].filter(Boolean).join('\n') }));
  }

  /** «شماره ۱ …»: that concept, edited as the owner says (when he says something), then produced in full (close-ups, Reel, draft #SP). */
  async chooseConcept({ n, note = '' }) {
    const set = this.store.d.concepts;
    const c = set?.items?.find((x) => x.n === n);
    if (!c) return { text: set?.items?.length ? `There is no concept ${n}; the concepts are 1 to ${set.items.length}.` : 'There are no concepts yet: write «پیشنهادهای اچ‌زد».' };
    let roomRaw = c.file ? fs.readFileSync(c.file) : Buffer.from(c.image || '', 'base64');
    // «جزئیات و کیفیت بالاتر»: the room redrawn and the close-ups made at 4K (sharper detail; the post is cut to Instagram's size after)
    const hq = /کیفیت|جزئیات|دقیق|وضوح|quality|detail|sharp/i.test(note);
    const size = hq ? '4K' : '';
    let plan = c.plan;
    if (note) {
      // the owner's change is a new brief, not a touch-up (live 15/11: «more space in the view» came back as the same picture, «more
      // detail» unchanged): Atossa rewrites the plan around his words, the room is drawn again from it with the old picture only as the
      // version to move away from, and a look at both pictures checks that the change can be seen; once more when it cannot
      try {
        plan = await this.revisePlan(c.plan, note, set.family);
        roomRaw = await this.redraw(plan, roomRaw, note, { size, hq });
        this.addTaste(`The owner chose concept «${c.plan.title_fa || c.plan.room}» and asked: ${note}`);
      } catch (err) { return { text: `The edit could not be made: ${err.message}` }; }
    } else this.addTaste(`The owner chose concept «${c.plan.title_fa || c.plan.room}» (${c.plan.parts.map((p) => p.code).join(' + ')})`);
    return this.produceDesign({ plan, roomRaw, note, size });
  }

  /**
   * The owner's change to a design already drafted (he quotes it or names it: «تغییر پست ۲۲ …»): the plan rewritten around his words,
   * the room drawn again and checked, close-ups, the Reel as he asked; the old draft is set aside so it is never posted by mistake.
   */
  /** The newest design draft made in the last [ms] (what plain words right after a design are about), or ''. */
  latestDesignDraft(ms = 60 * 60 * 1000) {
    const recent = Object.values(this.store.d.posts).filter((p) => p.design && (p.state === 'draft' || p.state === 'scheduled') && this.now() - p.at < ms).sort((a, b) => b.at - a.at);
    return recent[0]?.id || '';
  }

  async reviseDesign({ id, note }) {
    const asked = note;
    // «the camera like reel 24»: the Reel wishes of that post are told to Atossa
    for (const m of String(note).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).matchAll(/(?:ریلز|reel|پست|post)\s*(?:پست|post)?\s*#?\s*(?:SP)?\s*(\d+)/gi)) {
      const other = this.store.d.posts[`SP${m[1]}`];
      const wish = other?.design?.plan?.reel || (other?.design?.plan ? { motion: 'zoom' } : null);
      if (wish && `SP${m[1]}` !== id) note += ` (the Reel of post ${m[1]} was made with: ${JSON.stringify(wish)}; when he says like it, use the same "reel" values)`;
    }
    // only the Reel asked for: the picture stays, only the Reel is made again (no redraw, no new post)
    if (reelOnlyNote(asked) && this.store.d.posts[id]?.design) {
      const r = await this.remakeReel({ id, note });
      return { ...r, text: `${r.text}\n(فقط ریلز را خواستید؛ عکس و پست ${id.slice(2)} همان ماند.)` };
    }
    const p = this.store.d.posts[id];
    if (!p?.design) return { text: `There is no design #${id} to change.` };
    if (p.state !== 'draft' && p.state !== 'scheduled') return { text: `Post #${id} was already ${p.state}; a posted design is not changed.` };
    const all = this.catalog();
    const old = p.design.plan || { room: p.design.room, title_fa: p.design.title, scene: p.design.scene || p.design.room, parts: (p.design.codes || []).filter((c) => all[c]).map((code) => ({ code, where: 'as in the picture' })) };
    const oldRaw = p.file ? fs.readFileSync(p.file) : Buffer.from(p.image || '', 'base64');
    const hq = /کیفیت|جزئیات|دقیق|وضوح|quality|detail|sharp/i.test(note);
    let plan;
    let roomRaw;
    try {
      plan = await this.revisePlan(old, note, '');
      roomRaw = await this.redraw(plan, oldRaw, note, { size: hq ? '4K' : '', hq });
    } catch (err) { return { text: `The change could not be made: ${err.message}` }; }
    this.addTaste(`The owner changed design «${old.title_fa || old.room}»: ${note}`);
    p.state = 'replaced'; this.store.save();
    const d = await this.produceDesign({ plan, roomRaw, note, size: hq ? '4K' : '' });
    const nid = /Post #(SP\d+)/.exec(d.text || '')?.[1];
    if (nid) { p.replacedBy = nid; this.store.save(); }
    return { ...d, text: `${d.text}\n\n(پست ${id.slice(2)} کنار گذاشته شد؛ این نسخهٔ تازهٔ آن است.)` };
  }

  /**
   * «ریلز پست ۲۴ …» (the owner, 15/11): only the Reel of a drafted design made again, from its own pictures, with the Reel wishes of its
   * plan (length, music, the camera walking around the room) and his new words. Older posts keep only marked pictures: the logo and the
   * band of codes are taken off them first.
   */
  async remakeReel({ id, note = '' }) {
    const p = this.store.d.posts[id];
    if (!p?.design) return { text: `There is no design #${id}.` };
    if (p.state !== 'draft' && p.state !== 'scheduled') return { text: `Post #${id} was already ${p.state}.` };
    if (!this.reel) return { text: 'The Reel maker is not on this server.' };
    const all = this.catalog();
    const plan = p.design.plan || { room: p.design.room, parts: (p.design.codes || []).filter((c) => all[c]).map((code) => ({ code, where: 'the fronts' })) };
    const read = (f) => (f && fs.existsSync(f) ? fs.readFileSync(f) : null);
    let room = read(p.raw?.room);
    let shots = (p.raw?.shots || []).map((s) => ({ part: { code: s.code, where: s.where }, wood: s.wood, raw: read(s.file) })).filter((s) => s.raw);
    if (!room) {
      room = await this.unmark(p.file ? fs.readFileSync(p.file) : Buffer.from(p.image || '', 'base64'));
      const order = plan.parts.slice(0, 3).map((x, i) => ({ x, i })).sort((a, b) => Number(this.isWood(b.x.code)) - Number(this.isWood(a.x.code)) || a.i - b.i);
      shots = [];
      for (const [k, f] of (p.extras || []).entries()) { const x = order[k]?.x; if (x && fs.existsSync(f)) shots.push({ part: x, wood: this.isWood(x.code), raw: await this.unmark(fs.readFileSync(f)) }); }
    }
    let opts = { motion: 'orbit', ...(plan.reel || {}) };
    if (note) {
      try {
        const raw = String(await this.write({ kind: 'reel-wish', system: 'You turn the owner\'s words about a Reel into JSON: {"seconds": the whole Reel in seconds or null, "music": a new English music mood or "", "motion": "orbit" (the camera turns around the room) or "zoom"}. Output only the JSON.', text: `Now: ${JSON.stringify(opts)}\nThe owner says: «${note}»`, effort: 'low', maxTokens: 300 }) || '');
        const w = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
        opts = { ...opts, ...(w.seconds ? { seconds: w.seconds } : {}), ...(w.music ? { music: w.music } : {}), ...(w.motion ? { motion: w.motion } : {}) };
      } catch { /* the plan's own wishes */ }
    }
    const codes = plan.parts.filter((x) => all[x.code]).map((x) => ({ code: x.code, swatch: fs.readFileSync(path.join(this.catalogDir, all[x.code].file)) }));
    const roomLook = await this.cleanCheck(room, codes);
    if (!roomLook.ok) {
      this.log(`social: the room of ${id} is not fit for a Reel: ${roomLook.problem}`);
      return { text: `ریلز پست ${id.slice(2)} ساخته نشد: خود عکس اتاق ایراد دارد (${roomLook.problem}). با «تغییر پست ${id.slice(2)} …» اتاق دوباره کشیده و بازبینی می‌شود، بعد ریلز از آن ساخته می‌شود.` };
    }
    let reveal = read(p.raw?.reveal);
    const left = [];
    if (reveal && !(await this.cleanCheck(reveal, codes)).ok) { reveal = null; left.push('عکس کشوی باز'); }
    const kept = [];
    for (const s of shots) { const sw = codes.find((c) => c.code === s.part.code); if ((await this.cleanCheck(s.raw, sw ? [sw] : [], { close: true })).ok) kept.push(s); else left.push(`عکس نزدیک ${s.part.code}`); }
    shots = kept;
    if (left.length) this.log(`social: ${id}: left out of the Reel: ${left.join(', ')}`);
    const video = await this.makeReelFor({ room, shots, codes, main: plan.parts[0], music: plan.music, opts, plan, reveal });
    if (this.mediaDir) { const f = path.join(this.mediaDir, `${p.id}-reel-${this.now().toString(36)}.mp4`); fs.writeFileSync(f, video); p.reel = f; }
    p.design.plan = { ...plan, reel: opts };
    this.store.save();
    return { text: `ریلز تازهٔ پست ${id.slice(2)} آماده است${opts.motion === 'orbit' ? ' (دوربین دور اتاق می‌چرخد)' : ''}.${left.length ? ` کنار گذاشته شد چون نوشته داشت، شبیه فیلم نبود یا فیلم در آن دیده نمی‌شد: ${left.join('، ')}.` : ''} با «بله پست ${id.slice(2)}» همراه پست منتشر می‌شود.`, video };
  }

  /**
   * «رتوش پست ۲۵ …» (the owner, 15/11: «take the colourful bag off the counter»): a small fix of the room picture that keeps the design
   * exactly (unlike a change, which redraws it); the post's picture is marked again and its Reel made again from the fixed room.
   */
  async retouch({ id, note }) {
    const p = this.store.d.posts[id];
    if (!p?.design) return { text: `There is no design #${id}.` };
    if (p.state !== 'draft' && p.state !== 'scheduled') return { text: `Post #${id} was already ${p.state}.` };
    const all = this.catalog();
    const plan = p.design.plan || { room: p.design.room, parts: (p.design.codes || []).filter((c) => all[c]).map((code) => ({ code, where: 'the fronts' })) };
    let room = p.raw?.room && fs.existsSync(p.raw.room) ? fs.readFileSync(p.raw.room) : await this.unmark(p.file ? fs.readFileSync(p.file) : Buffer.from(p.image || '', 'base64'));
    let fixed = null;
    let miss = '';
    for (let i = 0; i < 2 && !fixed; i++) {
      const r = await this.imager.make({ images: [{ label: 'The picture', buffer: room, mime: 'image/jpeg' }],
        prompt: `Make only this small change: «${note}».${miss ? ` The last try missed: ${miss}.` : ''} Keep everything else exactly as it is: the room, the camera, the light, every surface, colour and object. Photorealistic, the same size, 4:5 portrait. ${NO_TEXT}` });
      const look = await this.changeSeen(room, r.image, note);
      if (look.done || i === 1) fixed = await fitForInstagram(r.image); else miss = look.missing || 'not done';
    }
    room = fixed;
    const codes = plan.parts.filter((x) => all[x.code]).map((x) => ({ code: x.code, swatch: fs.readFileSync(path.join(this.catalogDir, all[x.code].file)) }));
    const image = await brandDesign(room, { ...this.brandAssets(), codes });
    if (this.mediaDir) {
      const stamp = this.now().toString(36);
      const f = path.join(this.mediaDir, `${p.id}-room-${stamp}.jpg`); fs.writeFileSync(f, room);
      p.raw = { ...(p.raw || {}), room: f };
      const m = path.join(this.mediaDir, `${p.id}-${stamp}.jpg`); fs.writeFileSync(m, image); p.file = m;
    } else p.image = image.toString('base64');
    this.store.save();
    this.addTaste(`The owner fixed design «${plan.title_fa || plan.room}»: ${note}`);
    let video = null;
    try { video = (await this.remakeReel({ id })).video || null; } catch (err) { this.log(`social: the Reel after the retouch failed: ${err.message}`); }
    return { text: `پست ${id.slice(2)} رتوش شد: «${note}». عکس و ریلز تازه همین‌جاست؛ طرح و متن پست همان است.`, image, video };
  }

  /** A posted-style picture without the ARYAK marks (the logo in the corner and the band of codes), the picture behind them restored. */
  async unmark(buf) {
    const r = await this.imager.make({ images: [{ label: 'The picture', buffer: buf, mime: 'image/jpeg' }], prompt: 'Remove the logo in the top corner and the dark band with colour swatches and codes along the bottom edge; restore the picture behind them exactly as it continues. Change nothing else. Same size, 4:5 portrait.' });
    return fitForInstagram(r.image);
  }

  /** Atossa's plan rewritten around the owner's words (films of the same catalogue); the old plan when no JSON comes back. */
  async revisePlan(plan, note, family = '') {
    const all = this.catalog();
    const allowed = Object.keys(all).filter((k) => !family || k.toUpperCase().startsWith(family.toUpperCase()));
    const raw = String(await this.write({ kind: 'design-plan', system: fill(DESIGNER_RULES, this.cfg), effort: 'medium', maxTokens: 12000, text: [
      'The films you may use (code: look):', ...allowed.map((k) => `${k}: ${all[k].look || all[k].kind || 'decorative film'}`),
      `\nThe owner chose this concept of yours:\n${JSON.stringify(plan)}`,
      `\nHe asks for this change: «${note}».`,
      'Rewrite the plan so that his change is the first thing anyone sees in the new picture. Read his words as a designer: «more space in the view» = a wider room and a wider camera (more floor, ceiling and depth, the walls further away, a lighter balance so the dark film does not close the room in); «more modern» = cleaner lines, slimmer profiles, fewer ornaments; «more detail» = more visible joinery, profiles, lighting and styling details, closer textures; «change the design» = another style or layout, not the same room recoloured. Keep his chosen films unless he asks otherwise.',
      'When he asks about the Reel (its length, the music, how the camera moves), add "reel": {"seconds": the whole Reel in seconds (he says longer: about 22), "music": a new music mood in English when he wants other music, "motion": "orbit" when he wants the camera to turn around the room instead of zooming, else "zoom"}.',
      'Add "change_fa": one Persian sentence for the owner saying exactly what you changed. Answer with the full JSON.',
    ].join('\n') }) || '');
    try {
      const p = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      if (p?.scene && Array.isArray(p.parts) && p.parts.length && p.parts.every((x) => all[x.code])) return { ...plan, ...p, dialogue_fa: '' };
    } catch { this.log('social: the revised plan was not JSON; the change goes to the picture only'); }
    return { ...plan, scene: `${plan.scene}\nThe owner's change, clearly visible: ${note}.` };
  }

  /** The room drawn again from the revised plan; the old picture is the version to change. Checked once by eye, drawn again if needed. */
  async redraw(plan, oldRaw, note, { size = '', hq = false } = {}) {
    const all = this.catalog();
    const films = plan.parts.map((p) => ({ label: `Reference: film ${p.code}, for ${p.where}`, buffer: fs.readFileSync(path.join(this.catalogDir, all[p.code].file)), mime: 'image/jpeg' }));
    let missing = '';
    let made = null;
    for (let i = 0; i < 2; i++) {
      const res = await this.imager.make({ size, images: [{ label: 'The previous version: the owner did not accept it as it is; change it as asked', buffer: oldRaw, mime: 'image/jpeg' }, ...films],
        prompt: `A new photograph of this design, redrawn for the owner who asked: «${note}». His change must be obvious at first glance: never return the previous picture or a crop of it.${missing ? ` The last try still missed: ${missing}.` : ''}\n${plan.scene}\nEach labelled film picture is the exact surface for the fronts named in its label: reproduce its colour, pattern and scale faithfully. ${TRUE_FILM} ${NO_TEXT}${hq ? ' Render it at the highest quality: finer detail in every material, crisp film grain, realistic joinery edges, accurate reflections and soft shadows.' : ''} Photorealistic editorial interior photograph, 4:5 portrait.` });
      made = res.image;
      const verdict = await this.changeSeen(oldRaw, made, note);
      if (verdict.done) break;
      missing = verdict.missing || 'the change is not visible enough';
      this.log(`social: the redraw missed «${note}»: ${missing}`);
    }
    return made;
  }

  /** One look at the old and the new picture: is the owner's change visible? { done, missing }; done when the look cannot be read. */
  /** An AI picture checked before use: no text or cards in it, one photograph (no grid), each film like its sample. { ok, problem }; ok when the check cannot be read. */
  async cleanCheck(image, refs = [], { close = false } = {}) {
    try {
      const small = async (b) => (await import('sharp')).default(b).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      const raw = String(await this.write({ kind: 'clean-check', system: CLEAN_RULES, text: `The picture, then the samples: ${refs.map((r) => `film ${r.code}`).join(', ') || 'none'}.`, images: [await small(image), ...(await Promise.all(refs.map((r) => small(r.swatch))))], mime: 'image/jpeg', effort: 'low', maxTokens: 400 }) || '');
      const v = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      const problems = [v.text === true && 'there is text, a label, a card or a logo in the picture', v.collage === true && 'it is a collage or a grid of several pictures, not one photograph', v.mismatch && String(v.mismatch).trim() && `a film does not look like its sample: ${String(v.mismatch).trim()}`, close && v.hidden === true && 'the film can hardly be seen (too dark or too blurred)'].filter(Boolean);
      return { ok: !problems.length, problem: problems.join('; ') };
    } catch { return { ok: true, problem: '' }; }
  }

  /** A short trade name of every colour («Honey oak»), asked once from its look and kept in catalog.json: a buyer does not read codes. */
  async ensureNames() {
    const all = this.catalog();
    const todo = Object.keys(all).filter((k) => all[k].look && !all[k].name);
    if (!todo.length) return 0;
    let done = 0;
    for (let i = 0; i < todo.length; i += 8) {
      await Promise.all(todo.slice(i, i + 8).map(async (code) => {
        try {
          const name = String(await this.write({ kind: 'name', system: NAME_RULES, text: `Film ${code}: ${all[code].look}`, effort: 'low', maxTokens: 60 }) || '').trim().replace(/^["«']|["»'.]$/g, '').replace(/\s+/g, ' ');
          if (name && name.split(' ').length <= 4 && name.length <= 28) { all[code].name = name; done++; }
        } catch (err) { this.log(`social: the name of ${code} failed: ${err.message}`); }
      }));
    }
    try { fs.writeFileSync(path.join(this.catalogDir, 'catalog.json'), JSON.stringify(all, null, 1)); } catch (err) { this.log(`social: the names could not be kept: ${err.message}`); }
    return done;
  }

  async changeSeen(oldRaw, newRaw, note) {
    try {
      const small = async (b) => (await import('sharp')).default(b).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      const raw = String(await this.write({ kind: 'check-change', system: 'You compare two interior pictures for a design studio. Answer only JSON: {"done":true or false,"missing":"what of the request is not visible yet, in English, short"}.', text: `The first picture is the old version, the second the new one. The owner asked: «${note}». Is his change clearly visible in the new picture?`, images: [await small(oldRaw), await small(newRaw)], mime: 'image/jpeg', effort: 'low', maxTokens: 400 }) || '');
      const v = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      return { done: v.done !== false, missing: String(v.missing || '') };
    } catch { return { done: true, missing: '' }; }
  }

    /** Today's research notes (Atossa reads the world's design press once a day); '' when none. */
  todayTrends() {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    return (this.store.d.trends || []).find((t) => t.day === day)?.text || '';
  }
  async researchTrends() {
    if (!this.research || this.todayTrends()) return this.todayTrends();
    const raw = String(await this.research({ system: fill(TREND_RULES, this.cfg), text: `Today is ${new Date(this.now()).toISOString().slice(0, 10)}. Your notes for today.` }) || '').trim();
    if (!raw) return '';
    // the last line «IMAGES: url url …»: the pictures she wants to look at (the owner, 15/11: ideas from the pictures too, not only the words)
    const m = /^\s*IMAGES?\s*:\s*(.*)$/im.exec(raw);
    const text = raw.replace(/^\s*IMAGES?\s*:.*$/gim, '').trim();
    const urls = m ? (m[1].match(/https?:\/\/\S+/g) || []).map((u) => u.replace(/[),.;]+$/, '')).slice(0, 4) : [];
    const entry = { day: new Date(this.now()).toISOString().slice(0, 10), at: this.now(), text: text.slice(0, 4000) };
    (this.store.d.trends ||= []).push(entry);
    this.store.d.trends = this.store.d.trends.slice(-14);
    this.store.save();
    if (urls.length) {
      try { entry.looks = await this.lookAtPictures(urls); this.store.save(); } catch (err) { this.log(`social: the press pictures were not read: ${err.message}`); }
    }
    try { entry.instagram = await this.watchInstagram(); this.store.save(); } catch (err) { this.log(`social: the look at Instagram failed: ${err.message}`); }
    return text;
  }
  /** Today's notes on the press pictures ('' when none). */
  todayLooks() {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    return (this.store.d.trends || []).find((t) => t.day === day)?.looks || '';
  }
  /** The pictures of the day's articles: fetched (pictures only, at most 8 MB each), made small, looked at together once. */
  async lookAtPictures(urls) {
    const pics = (await this.fetchPictures(urls)).filter(Boolean);
    if (!pics.length) return '';
    return String(await this.write({ kind: 'press-pictures', system: LOOKS_RULES, text: `${pics.length} interior pictures from today's design press.`, images: pics, mime: 'image/jpeg', effort: 'low', maxTokens: 1500 }) || '').trim().slice(0, 2000);
  }

  /** Pictures from their addresses, 768 px JPEG; null for one that cannot be read (not a picture, too big, no answer in 15 s). */
  async fetchPictures(urls) {
    const sharp = (await import('sharp')).default;
    const fetchImpl = this.fetchImpl || globalThis.fetch;
    const out = [];
    for (const u of urls) {
      let pic = null;
      if (!u) { out.push(null); continue; }
      try {
        const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
        const r = await fetchImpl(u, { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0 ARYAK design studio' } }).finally(() => clearTimeout(t));
        if (r.ok && /^image\//.test(r.headers.get('content-type') || '')) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length <= 8 * 1024 * 1024) pic = await sharp(buf).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        }
      } catch { /* that picture is skipped */ }
      out.push(pic);
    }
    return out;
  }

  /**
   * What a link shows: its picture and words. TikTok answers its public oEmbed; Instagram, Pinterest and most sites give their picture
   * to link previews (og:image), so the page is asked as a link preview would ask it. { url, image, text } (image '' when none).
   */
  async previewOf(url) {
    const fetchImpl = this.fetchImpl || globalThis.fetch;
    const get = async (u, ua) => {
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
      return fetchImpl(u, { signal: ac.signal, redirect: 'follow', headers: { 'User-Agent': ua, 'Accept-Language': 'en' } }).finally(() => clearTimeout(t));
    };
    try {
      if (/tiktok\.com/i.test(url)) {
        const r = await get(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, 'Mozilla/5.0 ARYAK design studio');
        if (r.ok) { const j = await r.json(); if (j.thumbnail_url) return { url, image: j.thumbnail_url, text: [j.author_name, j.title].filter(Boolean).join(': ') }; } // no thumbnail (live 15/11): the page's own preview
      }
      const r = await get(url, 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)');
      if (/^image\//.test(r.headers.get('content-type') || '')) return { url, image: url, text: '' };
      const html = (await r.text()).slice(0, 400000);
      const meta = (name) => {
        const m = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html) || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i').exec(html);
        return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'") : '';
      };
      return { url, image: meta('og:image') || meta('twitter:image'), text: [meta('og:title'), meta('og:description') || meta('description')].filter(Boolean).join(': ').slice(0, 600) };
    } catch (err) { return { url, image: '', text: '', error: err.message }; }
  }

  /** «Look at these» (the owner's links): Atossa studies each post's picture and words, keeps what she takes, answers in Persian. */
  async studyLinks({ urls, note = '' }) {
    const seen = [];
    for (const u of urls) seen.push(await this.previewOf(u));
    const pics = await this.fetchPictures(seen.map((s) => s.image || ''));
    const read = seen.map((s, i) => ({ ...s, pic: pics[i] })).filter((s) => s.pic);
    const blind = seen.filter((s, i) => !pics[i]);
    if (!read.length) return `آتوسا نتوانست تصویر این ${seen.length === 1 ? 'پیوند' : 'پیوندها'} را باز کند (احتمالاً صفحه خصوصی است یا ورود می‌خواهد). خود عکس را با «الهام» بفرستید.`;
    const all = this.catalog();
    const text = String(await this.write({ kind: 'owner-links', system: LINK_RULES, effort: 'medium', maxTokens: 2500, images: read.map((s) => s.pic), mime: 'image/jpeg', text: [
      ...read.map((s, i) => `Post ${i + 1} (${s.url}): ${s.text || '(no words)'}`),
      note ? `\nThe owner's words: ${note}` : '',
      `\nARYAK films (code: look): ${Object.entries(all).slice(0, 200).map(([k, e]) => `${k}: ${e.look || e.kind || ''}`).join('; ')}`,
    ].filter(Boolean).join('\n') }) || '').trim();
    if (!text) return 'آتوسا پاسخی ننوشت؛ دوباره بفرستید.';
    const english = text.split('\n').filter((l) => !/^\s*فارسی\s*:/.test(l)).join('\n').trim();
    const persian = text.split('\n').filter((l) => /^\s*فارسی\s*:/.test(l)).map((l) => `• ${l.replace(/^\s*فارسی\s*:\s*/, '')}`);
    (this.store.d.inspo ||= []).push({ at: this.now(), urls: read.map((s) => s.url), text: english.slice(0, 3000), note });
    this.store.d.inspo = this.store.d.inspo.slice(-20);
    this.store.save();
    this.addTaste(`The owner sent posts he likes${note ? ` (${note})` : ''}: ${english.slice(0, 300)}`);
    return [`آتوسا ${read.length} پیوند را دید و برای طرح‌های بعدی نگه داشت:`, ...persian, blind.length ? `\n${blind.length} پیوند باز نشد (خصوصی یا نیازمند ورود): عکسش را با «الهام» بفرستید.` : ''].filter(Boolean).join('\n');
  }
  /** The owner's saved ideas (his links), newest last: what Atossa reads before she designs. */
  ownerInspirations(max = 5) {
    return (this.store.d.inspo || []).slice(-max).map((x) => `- ${x.text.replace(/\s+/g, ' ').slice(0, 600)}`).join('\n');
  }

  /**
   * Atossa's look around Instagram (the owner, 15/11: she looks for ideas on Instagram and TikTok herself): the latest posts of leading
   * design accounts (Business Discovery, no review needed), the most liked of the last two weeks looked at once a day.
   */
  async watchInstagram() {
    if (!this.client.hasIg || !this.client.igDiscover) return '';
    const accounts = (this.cfg.watchAccounts || 'archdigest,elledecor,dezeen,archdaily,housebeautiful,dwellmagazine,houzz,studiomcgee,amberinteriors,kellywearstler,poliform_official,molteniandc,snaiderocucine,arclinea_official').split(/[\s,]+/).filter(Boolean);
    const posts = [];
    for (const a of accounts) {
      try { for (const m of await this.client.igDiscover(a)) posts.push({ ...m, account: a }); } catch (err) { this.log(`social: Instagram account ${a} not read: ${err.message}`); }
    }
    const fresh = posts.filter((m) => !m.timestamp || this.now() - Date.parse(m.timestamp) < 14 * DAY).sort((x, y) => (y.like_count || 0) - (x.like_count || 0));
    const top = [];
    for (const m of fresh) { if (top.filter((x) => x.account === m.account).length < 1 && (m.media_url || m.thumbnail_url)) top.push(m); if (top.length === 4) break; }
    if (!top.length) return '';
    const pics = await this.fetchPictures(top.map((m) => (m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url) || ''));
    const seen = top.map((m, i) => ({ ...m, pic: pics[i] })).filter((m) => m.pic);
    if (!seen.length) return '';
    return String(await this.write({ kind: 'instagram-watch', system: WATCH_RULES, effort: 'low', maxTokens: 1200, images: seen.map((m) => m.pic), mime: 'image/jpeg',
      text: seen.map((m, i) => `Picture ${i + 1}: @${m.account}, ${m.like_count ?? '?'} likes, ${m.media_type === 'VIDEO' ? 'a Reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'a carousel' : 'a photo'} ${m.permalink || ''}`).join('\n') }) || '').trim().slice(0, 2000);
  }
  /** Today's look at Instagram ('' when none). */
  todayInstagram() {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    return (this.store.d.trends || []).find((t) => t.day === day)?.instagram || '';
  }

  /** The Reel of a design: the camera pushes in on the main film (Atossa finds where it shows best), then the close-up, then the codes. */
  /**
   * The Reel's music (the owner, 15/11): a new instrumental clip from Google's music model in the mood the designer chose; every clip is
   * kept, and when the model fails a kept one is used; with none, the Reel is silent.
   */
  async reelMusic(mood = '') {
    const dir = this.brandDir ? path.join(this.brandDir, 'music') : '';
    const kept = () => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')); } catch { return []; } };
    try {
      if (!this.imager?.music) throw new Error('no music model');
      // the sound design (the owner, 15/11, from a Gemini prompt): quiet sounds of the materials under the music keep people watching
      const mp3 = await this.imager.music(`${mood || 'Warm minimal luxury lounge: soft piano, gentle strings, a slow deep pulse, 78 BPM'}. Instrumental only, no vocals. Calm and elegant, for a short luxury interior design video. Under the music, quiet close-miked sounds of the room: a soft-close cabinet door settling shut, a hand gliding over a matte surface, a drawer sliding, the soft air of a quiet villa; low in the mix, never louder than the music.`);
      if (dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${this.now()}.mp3`), mp3); }
      return mp3;
    } catch (err) {
      this.log(`social: new music failed (${err.message}); a kept clip is used`);
      const all = kept();
      return all.length ? fs.readFileSync(path.join(dir, all[Math.floor(Math.random() * all.length)])) : null;
    }
  }

  async makeReelFor({ room, detail = null, shots = null, codes, main, music: mood = '', opts = null, plan = null, before = null, reveal = null }) {
    let focus = { x: 0.5, y: 0.5 };
    try {
      const raw = String(await this.write({ kind: 'focus', system: FOCUS_RULES, text: `The film: ${main.code}, on ${main.where}.`, image: room, mime: 'image/jpeg' }) || '');
      const f = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      if (Number.isFinite(f.x) && Number.isFinite(f.y)) focus = f;
    } catch { /* the middle */ }
    await this.ensureNames().catch(() => 0);
    const brand = this.brandAssets();
    const all = this.catalog();
    const named = codes.map((c) => ({ ...c, name: c.name || all[c.code]?.name || '' }));
    const { endCard, pairCards, reelOverlay, shotLabel } = await import('./reel.js');
    // the marks inside Instagram's safe area: the logo only (the band of codes at the bottom was under Instagram's own words); each
    // close-up says its own film; the end card names the films and says what to do (the owner's review, 17/11)
    const overlay = await reelOverlay({ logo: brand.logo });
    const card = await endCard({ codes: named, logo: brand.logo, font: brand.font, cta: codes.length > 1 ? 'Send the code you like on WhatsApp' : 'Send this code on WhatsApp', line: this.cfg.contact ? `WhatsApp ${this.cfg.contact}` : 'ARYAK' });
    const label = async (code) => { const c = named.find((x) => x.code === code); return c ? shotLabel({ code: c.code, name: c.name, font: brand.font }).catch(() => null) : null; };
    const details = shots ? shots.map((sh) => ({ image: sh.raw, code: sh.part?.code || sh.code || '', wood: !!sh.wood })) : detail ? [{ image: detail, code: main?.code || '', wood: false }] : [];
    // the owner's wishes for the Reel (15/11): its length, new music, the camera turning around the room instead of a zoom
    const motion = opts?.motion === 'orbit' ? 'orbit' : 'zoom';
    const orbit = motion === 'orbit';
    const views = orbit ? await this.otherAngles(room, plan) : [];
    // cuts on the beat (the owner, 15/11): the music is asked at a known tempo and every shot lasts whole beats
    const tune = /(\d{2,3})\s*BPM/i.exec(opts?.music || mood || '') ? (opts?.music || mood) : `${opts?.music || mood || 'Warm minimal luxury lounge: soft piano, gentle strings, a slow deep pulse'}, 80 BPM`;
    const bpm = Math.min(140, Math.max(60, Number(/(\d{2,3})\s*BPM/i.exec(tune)[1])));
    const beat = 60 / bpm; const fade = REEL_FADE;
    const onBeat = (sec, min = 2) => Math.max(min, Math.round((sec - fade) / beat)) * beat + fade;
    // the opening (the owner's review, 17/11: three or four seconds of an almost empty card lost the viewer): the payoff first, the room or
    // the film's texture, never the cards; and never the same opening three Reels in a row
    const d = this.store.d;
    const recent = (d.reelOpens || []).slice(-2);
    let open = before ? 'before' : plan?.reel_open && /^tex/i.test(plan.reel_open) ? 'texture' : 'room';
    if (!before && recent.length === 2 && recent.every((o) => o === open)) open = open === 'room' ? 'texture' : 'room';
    if (open === 'texture' && !details.length) open = 'room';
    // the pairing cards: a quick insert after the opening, and not in two Reels in a row
    const pairWanted = codes.length >= 2 && !before && (plan?.reel_open ? /^pair/i.test(plan.reel_open) : true);
    const usePair = pairWanted && !(d.reelPairs || []).slice(-1)[0];
    const cards = usePair ? await pairCards({ codes: named, font: brand.font }).catch(() => []) : [];
    const roomMove = (zoom) => (orbit ? { move: 'pan', toRight: true } : { move: 'push', zoom, cx: focus.x, cy: focus.y });
    const seq = [];
    const rest = [...details];
    if (open === 'before') { seq.push({ image: before, sec: onBeat(1.8), move: 'push', zoom: 0.06 }); seq.push({ image: room, sec: onBeat(2.6), ...roomMove(0.18), cut: 'wipeleft' }); }
    else if (open === 'texture') { const first = rest.shift(); seq.push({ image: first.image, sec: onBeat(1.8), move: 'push', zoom: 0.25, label: await label(first.code) }); } // shown once: not again later
    else seq.push({ image: room, sec: onBeat(views.length ? 1.8 : 2.6), ...roomMove(0.2) });
    if (cards.length) seq.push({ image: cards[cards.length - 1], sec: onBeat(1.1, 1), move: 'push', zoom: 0.03, cy: 0.45 });
    if (open === 'texture') seq.push({ image: room, sec: onBeat(2.6), ...roomMove(0.18) });
    if (reveal) seq.push({ image: reveal, sec: onBeat(2.6), move: 'push', zoom: 0.3, cx: focus.x, cy: focus.y, cut: 'dissolve' }); // into the open part (live 17/11: room then the same framing open read as the same shot twice)
    views.forEach((v, k) => seq.push({ image: v, sec: onBeat(2.2), move: 'pan', toRight: k % 2 === 1 }));
    for (const [k, x] of rest.entries()) seq.push({ image: x.image, sec: onBeat(x.wood ? 3 : 2.2), ...(orbit ? { move: 'pan', toRight: k % 2 === 0 } : { move: 'push', zoom: x.wood ? 0.18 : 0.1 }), label: await label(x.code) });
    // the length: 20 s at most (the owner's review, 17/11: 41 s with the same doors twice), or what the owner asked (8 to 30 s)
    const cardSec = 2.5;
    const want = Number(opts?.seconds);
    const cap = Number.isFinite(want) && want > 0 ? Math.min(30, Math.max(8, want)) : REEL_MAX_SECONDS;
    const length = () => seq.reduce((a, x) => a + x.sec, 0) - fade * (seq.length - 1) + cardSec - fade;
    while (length() > cap && seq.length > 3) { // the extra camera places go first, then the last close-ups
      const k = seq.map((x) => views.includes(x.image)).lastIndexOf(true);
      seq.splice(k >= 0 ? k : seq.length - 1, 1);
    }
    if (length() > cap) for (const x of seq.slice(1)) x.sec = onBeat(x.sec * 0.7, 2);
    // a longer Reel the owner asked for: one beat more at a time to the shortest shot (the opening stays quick; his wish allows a shot up to about 6 s)
    for (let guard = 0; Number.isFinite(want) && want > 0 && length() < cap - beat && guard < 60; guard++) {
      const grow = seq.slice(1).filter((x) => x.sec + beat <= 6.3).sort((a, b) => a.sec - b.sec)[0];
      if (!grow) break;
      grow.sec += beat;
    }
    d.reelOpens = [...(d.reelOpens || []), open].slice(-6);
    d.reelPairs = [...(d.reelPairs || []), cards.length > 0].slice(-6);
    this.store.save();
    return this.reel({ room, sequence: seq, fade, open, intro: cards, hook: open === 'texture' ? seq[0].image : null, before, reveal, views, motion, details: rest, seconds: { card: cardSec }, focus, overlay, card, music: await this.reelMusic(tune) });
  }

  /** The same room from two other camera places (left and right around it), for a Reel that walks around the design. */
  async otherAngles(room, plan) {
    const all = this.catalog();
    const films = (plan?.parts || []).filter((p) => all[p.code]).map((p) => ({ label: `Reference: film ${p.code}, for ${p.where}`, buffer: fs.readFileSync(path.join(this.catalogDir, all[p.code].file)), mime: 'image/jpeg' }));
    // live 15/11: «moved 35 degrees» came back as the same picture; each view is now a named, very different shot, checked by eye
    const shotsWanted = [
      'a wide establishing shot from the far opposite corner of the room, the camera low at the height of a seated person, a 20 mm lens: the whole room, more floor and ceiling, the joinery seen at a strong diagonal from the left',
      'a three-quarter view standing close beside the main furniture on the right, looking along the joinery wall at a sharp angle, a 35 mm lens, the nearest fronts large in the foreground and the rest of the room receding',
    ];
    const out = [];
    for (const shot of shotsWanted) {
      let miss = '';
      for (let i = 0; i < 2; i++) {
        try {
          const v = await this.imager.make({ images: [{ label: 'The room: keep this exact design, change only the camera', buffer: room, mime: 'image/jpeg' }, ...films],
            prompt: `The same room with the same design, furniture, films, light and styling, photographed as ${shot}. The camera position and angle must be clearly different from the reference picture: never the same framing.${miss ? ` The last try was still too close to the reference: ${miss}.` : ''} Nothing new is added. Photorealistic editorial interior photograph, 4:5 portrait. ${NO_TEXT}` });
          const look = await this.changeSeen(room, v.image, 'the same room seen from a clearly different camera position: another side, height or distance, so the framing is plainly not the same (it need not match any particular lens or corner)');
          const clean = await this.cleanCheck(v.image);
          // only a view that is really another camera place, and clean (the owner's review, 17/11: a view that came back as the same framing
          // was used anyway on the second try, so the Reel showed the same doors twice)
          if (look.done && clean.ok) { out.push(await fitForInstagram(v.image)); break; }
          miss = [look.done ? '' : look.missing || 'the framing is almost the same', clean.ok ? '' : clean.problem].filter(Boolean).join('; ');
          this.log(`social: a view of the room was not used (try ${i + 1}): ${miss}`);
        } catch (err) { this.log(`social: a view of the room failed: ${err.message}`); break; }
      }
    }
    return out;
  }

  /** A composition used (a produced design or a concept shown): its signature is kept so it is never made again (last 40). */
  remember(plan) {
    (this.store.d.designs ||= []).push({ at: this.now(), room: plan.room, codes: (plan.parts || []).map((x) => x.code), signature: plan.signature || '' });
    this.store.d.designs = this.store.d.designs.slice(-40);
    this.store.save();
  }
  /** The last compositions, one line each, for the designer and for Dariush. */
  recentCompositions(max = 15) {
    return (this.store.d.designs || []).slice(-max).map((x) => `- ${x.signature || x.room}: ${(x.codes || []).join(' + ')}`).join('\n');
  }

  /**
   * Dariush, Atossa's marketing partner, reads the plans before anything is drawn: novelty against the recent compositions, the design
   * rules, the marketing (scroll-stopping, the film filling the frame, saveable, Gulf taste). One answer per plan: { verdict, notes, hook,
   * dialogue_fa }; when he cannot be read, every plan is taken as it is.
   */
  async challenge(plans) {
    try {
      const raw = String(await this.write({ kind: 'critique', system: fill(DARIUSH_RULES, this.cfg), text: [
        'The recent compositions:', this.recentCompositions() || '(none yet)',
        (this.store.d.taste || []).length ? `\nThe owner's notes:\n${this.store.d.taste.slice(-10).map((x) => `- ${x.text}`).join('\n')}` : '',
        `\nAtossa's plans (${plans.length}):`, JSON.stringify(plans),
      ].filter(Boolean).join('\n'), effort: 'medium', maxTokens: 6000 }) || '');
      const out = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
      return Array.isArray(out) ? out : [];
    } catch (err) { this.log(`social: Dariush could not be read: ${err.message}`); return []; }
  }

  /** Design drafts still waiting for the owner's answer: the daily proposal waits while there are [max]. */
  // only the last day counts (live 16/11: nine old drafts the owner had moved past stopped every proposal of the day)
  designsWaiting(ms = DAY) { return Object.values(this.store.d.posts).filter((p) => p.design && p.state === 'draft' && this.now() - p.at < ms).length; }

  /** The picture of the draft a preview names («Post #SP7 …»), so the owner sees what will be posted; null when none. */
  draftPicture(text) {
    const m = /Post #(SP\d+)/.exec(String(text || ''));
    const p = m && this.store.d.posts[m[1]];
    try { return p ? (p.file ? fs.readFileSync(p.file) : p.image ? Buffer.from(p.image, 'base64') : null) : null; } catch { return null; }
  }

  postPreview(id) {
    const p = this.store.d.posts[id];
    const to = [this.client.hasIg ? 'Instagram' : '', this.client.hasFb ? 'Facebook' : ''].filter(Boolean).join(' + ');
    return [`Post #${id} for ${to} (nothing is posted yet):`, '', p.caption, '', `Reply: yes #${id} (post it) / no #${id} / edit #${id} <the new caption>`].join('\n');
  }

  async decidePost(c) {
    await this.ready();
    const p = this.store.d.posts[c.id];
    if (!p) return `There is no post #${c.id}.`;
    // «دوباره پست ۳۱»: a posted post whose Reel did not go out somewhere: only the missing parts are tried again (the owner's yes was given)
    if (c.verb === 'retry') {
      if (p.state !== 'posted') return `Post #${c.id} is not posted yet (${p.state}); «بله پست ${c.id.slice(2)}» posts it.`;
      const only = [p.reel && !p.fbReel && this.client.hasFb ? 'fbReel' : '', p.reel && !p.igReel && this.client.hasIg ? 'igReel' : '', p.reel && !p.tiktok && this.tiktok?.connected ? 'tiktok' : ''].filter(Boolean);
      if (!only.length || !p.reel || !fs.existsSync(p.reel)) return `Post #${c.id}: nothing is missing that can be sent again.`;
      const done = []; const failed = [];
      await this.postReel(p, fs.readFileSync(p.reel), done, failed, { only });
      this.store.save();
      return [`Post #${c.id}, sent again:`, ...done, ...failed.map((f) => `NOT posted, ${f}`)].join(String.fromCharCode(10));
    }
    const waiting = p.state === 'scheduled';
    if (waiting && c.verb === 'yes' && !c.now) return `Post #${c.id} already goes out at ${this.clock(p.postAt)} Dubai time. To post it now: «بله پست ${c.id.slice(2)} الان».`;
    if (p.state !== 'draft' && !waiting) return `Post #${c.id} was already ${p.state}.`;
    const trial = /^(?:آزمون|آزمایش|تست|test)$/i.test(c.text || ''); // «نه پست 7 آزمون»: a test, not the owner's taste
    if (p.design && !trial && !waiting && (c.verb === 'no' || c.verb === 'yes')) this.addTaste(`${c.verb === 'yes' ? 'Approved' : 'Rejected'}: ${p.design.room} with ${p.design.codes.join(' + ')}${c.text ? `: ${c.text}` : ''}`);
    if (c.verb === 'no') { p.state = 'cancelled'; this.store.save(); return `Post #${c.id} cancelled; nothing was posted.${p.design ? (trial ? ' (A test: nothing was kept.)' : c.text ? ' Your reason is kept for the next designs.' : ' (A reason after the number, e.g. «نه پست 5 too dark», teaches the designer.)') : ''}`; }
    if (c.verb === 'edit') { p.caption = c.text; this.store.save(); return this.postPreview(c.id); }
    if (c.verb !== 'yes') return null;
    // the owner's yes outside the hours people look: the post waits for the next good hour (Dubai time); «… الان» posts at once
    if (this.cfg.postWindows && !c.now) {
      const at = nextGoodTime(this.now(), this.cfg.timezone || 'Asia/Dubai');
      if (at - this.now() > 60 * 1000) {
        p.state = 'scheduled'; p.postAt = at; this.store.save();
        return `Post #${c.id} is approved and goes out at ${this.clock(at)} Dubai time, the hour most people look. To post it now: «بله پست ${c.id.slice(2)} الان»; to cancel: «نه پست ${c.id.slice(2)}».`;
      }
    }
    let image = p.file ? fs.readFileSync(p.file) : Buffer.from(p.image || '', 'base64');
    p.state = 'posting'; this.store.save(); // a second yes while it runs does nothing
    const done = [];
    const failed = [];
    const extras = (p.extras || []).filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f));
    if (p.lead && fs.existsSync(p.lead)) { extras.unshift(image); image = fs.readFileSync(p.lead); } // a before/after: «before» is the first picture
    if (extras.length) await this.postAlbum(p, [image, ...extras], done, failed);
    let photoUrl = '';
    if (!extras.length) try {
      if (this.client.hasFb) {
        // the Facebook photo is published (with the caption) and its address is the one Instagram fetches the picture from
        const fb = await this.client.fbPhoto(image, p.caption, { published: true, mime: p.mime });
        const link = await this.client.fbPermalink(fb.post_id || fb.id);
        done.push(`Facebook: posted${link ? ` ${link}` : ''}`);
        p.fb = fb.post_id || fb.id;
        if (this.client.hasIg) photoUrl = await this.client.fbPhotoUrl(fb.id);
      }
    } catch (e) { failed.push(`Facebook: ${e.message}`); }
    if (this.client.hasIg && !extras.length) {
      try {
        if (!photoUrl && this.client.hasFb) { const hidden = await this.client.fbPhoto(image, '', { published: false, mime: p.mime }); photoUrl = await this.client.fbPhotoUrl(hidden.id); }
        if (!photoUrl) throw new Error('Instagram takes a photo only from a web address; connect the Facebook Page so the photo can be held there');
        const ig = await this.client.igPublish(photoUrl, p.caption);
        p.ig = ig.id;
        done.push(`Instagram: posted${ig.link ? ` ${ig.link}` : ''}`);
      } catch (e) { failed.push(`Instagram: ${e.message}`); }
    }
    if (p.reel && fs.existsSync(p.reel)) await this.postReel(p, fs.readFileSync(p.reel), done, failed);
    await this.postTikTokPhotos(p, [image, ...extras], done, failed);
    p.state = done.length ? 'posted' : 'draft'; // nothing went out: the draft stays, a later yes tries again
    p.postedAt = this.now();
    this.store.save();
    return [`Post #${c.id}:`, ...done, ...failed.map((f) => `NOT posted, ${f}`)].join('\n');
  }

  /** The approved posts whose hour has come. */
  duePosts() { return Object.values(this.store.d.posts).filter((p) => p.state === 'scheduled' && p.postAt <= this.now()).map((p) => p.id); }
  /** «19:00» or «Friday 19:00» (Dubai time). */
  clock(ms) {
    const tz = this.cfg.timezone || 'Asia/Dubai';
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
    return gulfParts(ms, tz).day === gulfParts(this.now(), tz).day ? hm : `${new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long' }).format(new Date(ms))} ${hm}`;
  }

  /** The posts of the last 7 days by kind (drafts, approved and posted; not cancelled). */
  weekMix() {
    const mix = { proof: 0, inspiration: 0, education: 0, transform: 0, real: 0 };
    for (const p of Object.values(this.store.d.posts)) {
      if (p.state === 'cancelled' || this.now() - (p.postedAt || p.at) >= 7 * DAY) continue;
      const k = p.pillar || (p.design ? 'inspiration' : '');
      if (k in mix) mix[k]++;
    }
    return mix;
  }
  /** The kind Atossa makes next: the one the week is most short of (real jobs are the owner's photos, so never hers). */
  nextPillar() {
    const mix = this.weekMix();
    const total = Math.max(5, Object.values(mix).reduce((a, b) => a + b, 0) + 1);
    return ['proof', 'inspiration', 'education', 'transform'].map((k) => ({ k, short: PILLARS[k].share * total - mix[k] })).sort((a, b) => b.short - a.short)[0].k;
  }
  /** Once a week, when no photo of a real job went out in 7 days: the owner is asked for one. */
  realJobReminder() {
    const d = this.store.d;
    if (this.weekMix().real || (d.realAskedAt && this.now() - d.realAskedAt < 7 * DAY)) return '';
    d.realAskedAt = this.now(); this.store.save();
    return 'آتوسا: این هفته هنوز عکسی از یک کار واقعی نصب‌شده منتشر نشده است. مردم به کار واقعی بیشتر اعتماد می‌کنند. یک عکس از کابینت یا کمدی که با فیلم‌های آریاک ساخته شده بفرستید و زیرش بنویسید «پست کد …» تا پستش را آماده کنم.';
  }

  /** Several pictures as one swipeable post: a Facebook post with all of them, an Instagram carousel from their Facebook addresses. */
  async postAlbum(p, images, done, failed) {
    let urls = [];
    if (this.client.hasFb) {
      try {
        const fb = await this.client.fbAlbumPost(images, p.caption);
        p.fb = fb.id;
        const link = await this.client.fbPermalink(fb.id);
        done.push(`Facebook: posted (${images.length} pictures)${link ? ` ${link}` : ''}`);
        if (this.client.hasIg) urls = await Promise.all(fb.photoIds.map((id) => this.client.fbPhotoUrl(id)));
      } catch (e) { failed.push(`Facebook: ${e.message}`); }
    }
    if (this.client.hasIg) {
      try {
        if (urls.length !== images.length || urls.some((u) => !u)) {
          if (!this.client.hasFb) throw new Error('Instagram takes pictures only from a web address; connect the Facebook Page so they can be held there');
          urls = [];
          for (const b of images) urls.push(await this.client.fbPhotoUrl((await this.client.fbPhoto(b, '', { published: false })).id));
        }
        const ig = await this.client.igCarousel(urls, p.caption);
        p.ig = ig.id;
        done.push(`Instagram: posted (${images.length} pictures)${ig.link ? ` ${ig.link}` : ''}`);
      } catch (e) { failed.push(`Instagram: ${e.message}`); }
    }
  }

  /**
   * The pictures of a post on TikTok too (the owner, 15/11: «only the Reels are on TikTok, not the pictures»): put in the public folder,
   * then one photo post (a draft in the inbox until TikTok's audit). AI design pictures carry TikTok's AI label.
   */
  async postTikTokPhotos(p, images, done, failed) {
    if (!this.tiktok?.connected || !this.bucket?.enabled || !images.length) return;
    try {
      const urls = [];
      // TikTok takes photos up to 1080 pixels wide (live test 15/11: picture_size_check_failed on 1440): 1080 x 1350, JPEG
      const sharp = (await import('sharp')).default;
      for (let i = 0; i < images.length; i++) {
        const small = await sharp(images[i]).resize({ width: 1080, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer().catch(() => images[i]);
        urls.push(await this.bucket.put(`posts/${p.id}-${i + 1}-${this.now().toString(36)}.jpg`, small));
      }
      const t = await this.tiktok.postPhotos(urls, p.caption, { aigc: !!p.design });
      p.tiktokPhotos = t.publishId;
      done.push(t.status === 'SEND_TO_USER_INBOX' ? `TikTok photos: sent to your TikTok inbox as a draft (${images.length} pictures; open TikTok and tap Post)` : `TikTok photos: posted (${images.length} pictures)`);
    } catch (e) { failed.push(`TikTok photos: ${e.message}`); }
  }

  /** The Reel of a design: a Facebook video and an Instagram Reel, with the same caption. */
  async postReel(p, video, done, failed, { only = null } = {}) {
    const want = (k) => !only || only.includes(k);
    // one more try after a pause (live 16/11: #SP31's Instagram Reel came back «Request processing failed» while #SP30 posted)
    const twice = async (fn) => { try { return await fn(); } catch (e) { await this.client.wait?.(20000); return fn(); } };
    if (this.client.hasFb && want('fbReel')) {
      try { const v = await twice(() => this.client.fbVideo(video, p.caption)); p.fbReel = v.id; done.push(`Facebook video: posted https://www.facebook.com/${v.id}`); } catch (e) { failed.push(`Facebook video: ${e.message}`); }
    }
    if (this.client.hasIg && want('igReel')) {
      try { const r = await twice(() => this.client.igReel(video, p.caption)); p.igReel = r.id; done.push(`Instagram Reel: posted${r.link ? ` ${r.link}` : ''}`); } catch (e) { failed.push(`Instagram Reel: ${e.message}`); }
    }
    if (this.tiktok?.connected && want('tiktok')) {
      try {
        const t = await this.tiktok.postVideo(video, p.caption);
        p.tiktok = t.publishId;
        done.push(t.status === 'SEND_TO_USER_INBOX' ? 'TikTok: sent to your TikTok inbox as a draft (open TikTok and tap Post)' : 'TikTok: posted');
      } catch (e) { failed.push(`TikTok: ${e.message}`); }
    }
  }

  /** The owner's weekly report (in Persian): what went out in the last 7 days, how each did, which colours people looked at most. */
  async weeklyText() {
    await this.ready();
    const week = Object.values(this.store.d.posts).filter((p) => p.state === 'posted' && this.now() - (p.postedAt || p.at) < 7 * DAY);
    if (!week.length) return 'گزارش هفتگی صفحه: این هفته پستی منتشر نشد.';
    const lines = [];
    const byCode = {};
    let reachAll = 0;
    for (const p of week) {
      const ig = p.ig ? await this.client.igInsights(p.ig) : null;
      const reel = p.igReel ? await this.client.igInsights(p.igReel) : null;
      const fb = p.fb ? await this.client.fbPostNumbers(p.fb) : null;
      const codes = p.design?.codes || this.codesIn(`${p.note || ''} ${p.caption || ''}`).map((c) => c.code);
      const reach = (ig?.reach || 0) + (reel?.reach || 0);
      reachAll += reach;
      for (const c of codes) byCode[c] = (byCode[c] || 0) + reach + (ig?.saved || 0) * 20;
      const parts = [];
      if (ig) parts.push(`اینستاگرام: دیده‌شده ${ig.reach ?? '-'}، پسند ${ig.likes ?? 0}، نظر ${ig.comments ?? 0}، ذخیره ${ig.saved ?? 0}`);
      if (reel) parts.push(`ریلز: دیده‌شده ${reel.reach ?? '-'}، پسند ${reel.likes ?? 0}`);
      if (fb) parts.push(`فیس‌بوک: واکنش ${fb.reactions}، نظر ${fb.comments}`);
      lines.push(`• پست ${p.id.slice(2)}${codes.length ? ` (${codes.join('، ')})` : ''}: ${parts.join('؛ ') || 'عددی از متا نرسید'}`);
    }
    const top = Object.entries(byCode).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([c]) => c);
    const mix = this.weekMix();
    const mixLine = `ترکیب هفته: ${Object.entries(mix).map(([k, n]) => `${PILLARS[k].fa} ${n}`).join('، ')}`;
    return ['گزارش هفتگی صفحه (۷ روز گذشته)', `پست‌ها: ${week.length}؛ روی هم دیده‌شده در اینستاگرام: ${reachAll}`, mixLine, ...lines, top.length ? `رنگ‌هایی که بیشتر دیده و ذخیره شدند: ${top.join('، ')}` : ''].filter(Boolean).join('\n');
  }

  /** One look at the accounts. Returns the notices for the owner (one per new comment or message), each with a drafted answer. */
  async poll() {
    await this.ready();
    if (!this.enabled) return [];
    const own = (id, username) => (id && (id === this.client.igUserId || id === this.client.pageId)) || (username && this.cfg.username && String(username).toLowerCase() === String(this.cfg.username).toLowerCase());
    const sources = [];
    if (this.client.hasIg) {
      sources.push(['ig-comments', async () => { const media = (await this.client.igMedia(5)).data || []; const out = []; for (const m of media) out.push(...itemsFromIgComments(m, await this.client.igComments(m.id), own)); return out; }]);
      sources.push(['ig-messages', async () => itemsFromConversations('instagram', await this.client.igConversations(), own)]);
    }
    if (this.client.hasFb) {
      sources.push(['fb-comments', async () => itemsFromFbFeed(await this.client.fbFeed(5), own)]);
      sources.push(['fb-messages', async () => itemsFromConversations('facebook', await this.client.fbConversations(), own)]);
    }
    const fresh = [];
    for (const [name, read] of sources) {
      let items;
      try { items = await read(); delete this.store.d.errors[name]; } catch (e) {
        if (this.store.d.errors[name]?.message !== e.message) this.log(`social: ${name} failed: ${e.message}`);
        this.store.d.errors[name] = { message: e.message, at: this.now() };
        continue;
      }
      const first = !this.store.d.primed[name];
      for (const it of items) {
        if (this.store.d.seen[it.key]) continue;
        this.store.d.seen[it.key] = this.now();
        if (!first) fresh.push(it);
      }
      this.store.d.primed[name] = true; // the first look only marks what is there
    }
    this.store.prune(this.now());
    const notices = [];
    for (const it of fresh.sort((a, b) => a.at - b.at)) {
      this.lead(it);
      let draft = '';
      try { draft = String(await this.write({ kind: 'reply', system: fill(REPLY_RULES, this.cfg), text: `${where(it)} from ${it.name}${it.context ? ` on the post «${it.context}»` : ''}:\n${it.text}` }) || '').trim(); } catch (e) { this.log(`social: no draft for ${it.key}: ${e.message}`); }
      const skip = /^SKIP\.?$/i.test(draft);
      const id = this.store.next('SR');
      this.store.d.inbox[id] = { id, ...it, draft: skip ? '' : draft, state: 'open' };
      notices.push(this.inboxText(id, skip));
    }
    this.store.save();
    return notices;
  }
  inboxText(id, skip = false) {
    const it = this.store.d.inbox[id];
    return [`#${id} ${where(it)} from ${it.name}${it.context ? ` on «${it.context}»` : ''}:`, it.text, '',
      it.draft ? `Suggested answer: ${it.draft}` : skip ? 'No answer suggested (looks like spam or needs none).' : 'No answer was drafted.',
      `Reply: ${it.draft ? `yes #${id} (send it) / ` : ''}reply #${id} <your text> / no #${id}`].join('\n');
  }
  lead(it) {
    const k = `${it.platform}:${it.fromId || it.name}`;
    const l = this.store.d.leads[k] || { platform: it.platform, name: it.name, first: it.at, count: 0 };
    Object.assign(l, { name: it.name, last: it.at, lastText: String(it.text).slice(0, 120), count: l.count + 1 });
    this.store.d.leads[k] = l;
  }

  async decideReply(c) {
    await this.ready();
    const it = this.store.d.inbox[c.id];
    if (!it) return `There is no message #${c.id}.`;
    if (it.state !== 'open') return `#${c.id} was already ${it.state}.`;
    if (c.verb === 'no') { it.state = 'dropped'; this.store.save(); return `#${c.id}: no answer will be sent.`; }
    const text = c.verb === 'reply' ? c.text : c.verb === 'yes' ? it.draft : '';
    if (!text) return `#${c.id} has no suggested answer; write: reply #${c.id} <your text>`;
    if (it.kind === 'message' && this.now() - it.at > WINDOW_MS) { it.state = 'too late'; this.store.save(); return `#${c.id}: the message is older than 24 hours, and Meta allows no answer from a program after that. Answer from the phone if needed.`; }
    try {
      if (it.platform === 'instagram' && it.kind === 'comment') await this.client.igReply(it.id, text);
      else if (it.platform === 'instagram') await this.client.igSend(it.fromId, text);
      else if (it.kind === 'comment') await this.client.fbCommentReply(it.id, text);
      else await this.client.fbSend(it.fromId, text);
    } catch (e) { return `#${c.id} was NOT sent: ${e.message}`; }
    it.state = 'answered'; it.answer = text; it.answeredAt = this.now();
    this.store.save();
    return `#${c.id}: answer sent to ${it.name} on ${it.platform === 'instagram' ? 'Instagram' : 'Facebook'}.`;
  }

  addTaste(text) { (this.store.d.taste ||= []).push({ at: this.now(), text }); this.store.d.taste = this.store.d.taste.slice(-40); this.store.save(); }
  async handle(c) {
    if (c.verb === 'taste') { this.addTaste(`The owner says: ${c.text}`); return 'Noted for the next designs.'; }
    if (c.verb === 'status') return this.statusText();
    if (c.verb === 'leads') return this.leadsText();
    return c.kind === 'SP' ? this.decidePost(c) : this.decideReply(c);
  }

  async statusText() {
    await this.ready();
    const d = this.store.d;
    const open = Object.values(d.inbox).filter((x) => x.state === 'open');
    const drafts = Object.values(d.posts).filter((x) => x.state === 'draft');
    const posted = Object.values(d.posts).filter((x) => x.state === 'posted' && this.now() - x.at < 7 * DAY);
    const errs = Object.entries(d.errors).map(([k, e]) => `${k}: ${e.message}`);
    return [`Social: Instagram ${this.client.hasIg ? 'connected' : 'not connected'}, Facebook ${this.client.hasFb ? 'connected' : 'not connected'}.`,
      `Posts this week: ${posted.length}; drafts waiting: ${drafts.map((x) => `#${x.id}`).join(', ') || 'none'}.`,
      ...Object.values(d.posts).filter((x) => x.state === 'scheduled').map((x) => `Approved, goes out at ${this.clock(x.postAt)} Dubai time: #${x.id}.`),
      `Messages and comments waiting for your answer: ${open.map((x) => `#${x.id}`).join(', ') || 'none'}.`,
      `People who wrote in the last 30 days: ${Object.values(d.leads).filter((l) => this.now() - l.last < 30 * DAY).length}.`,
      ...(errs.length ? ['Problems:', ...errs] : [])].join('\n');
  }
  leadsText() {
    const rows = Object.values(this.store.d.leads).filter((l) => this.now() - l.last < 30 * DAY).sort((a, b) => b.last - a.last);
    if (!rows.length) return 'Nobody wrote on Instagram or Facebook in the last 30 days.';
    return [`People who wrote in the last 30 days (${rows.length}):`, ...rows.slice(0, 30).map((l, i) => `${i + 1}. ${l.name} (${l.platform}), ${l.count} message(s), last ${ago(this.now() - l.last)}: ${l.lastText}`)].join('\n');
  }

  /** The Instagram token lives 60 days; it is renewed once a week and kept on the server (never in the repository). */
  async refreshToken() {
    if (!this.client.hasIg || this.client.viaFb) return false;
    const t = this.store.d.token;
    if (t?.at && t.from === (this.cfg.tokenFrom || '') && this.now() - t.at < 7 * DAY) return false;
    const r = await this.client.igRefresh();
    if (!r?.access_token) return false;
    this.client.igToken = r.access_token;
    this.store.d.token = { ig: r.access_token, from: this.cfg.tokenFrom || '', at: this.now(), expires: r.expires_in ? this.now() + r.expires_in * 1000 : null };
    this.store.save();
    return true;
  }
}
