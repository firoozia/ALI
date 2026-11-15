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
  if ((m = /^(?:yes|ok|okay|بله|آره|اره|باشه)\s*#?\s*(SP|SR)\s*(\d+)\s*[.!]?$/i.exec(t))) return { verb: 'yes', kind: m[1].toUpperCase(), id: `${m[1].toUpperCase()}${m[2]}` };
  if ((m = /^(?:no|cancel|نه|خیر|لغو)\s*#?\s*(SP|SR)\s*(\d+)\s*[.!]?(?:\s*[:\-،,]?\s*([\s\S]+))?$/i.exec(t))) return { verb: 'no', kind: m[1].toUpperCase(), id: `${m[1].toUpperCase()}${m[2]}`, ...(m[3]?.trim() ? { text: m[3].trim() } : {}) };
  if ((m = /^(?:taste|سلیقه|سلیقه‌ی من|سلیقه من)\s*[:\-]?\s*([\s\S]+)$/i.exec(t))) return { verb: 'taste', text: m[1].trim() };
  if ((m = /^(?:edit|ویرایش|اصلاح)\s*#?\s*SP\s*(\d+)\s*[:\-]?\s*([\s\S]+)$/i.exec(t))) return { verb: 'edit', kind: 'SP', id: `SP${m[1]}`, text: m[2].trim() };
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
  async make({ prompt, images = [], aspect = '4:5' }) {
    const body = {
      contents: [{ role: 'user', parts: [...images.flatMap((i) => [...(i.label ? [{ text: i.label }] : []), { inline_data: { mime_type: i.mime || 'image/jpeg', data: i.buffer.toString('base64') } }]), { text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect, ...(this.size ? { imageSize: this.size } : {}) } },
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
export const ATOSSA = `You are Atossa, Creative Director of the ARYAK Design Studio in Dubai.
Your taste: warm minimal luxury with a Gulf soul. You pair honest wood grains with calm solid colours and one dramatic stone; you love golden-hour light, brass details, arches, palms, pools and the generous volumes of UAE villas; you design for real families, never for show.
Your eye is editorial: you read Architectural Digest, Elle Decor, Dezeen, ArchDaily, Dwell and Pinterest every day, you know what Salone del Mobile, Poliform, Molteni, Boffi and Minotti showed this year, and you turn it into rooms our clients can build with our films.
Your rule: every picture makes the film the hero. Your voice: confident, warm, expert and short; never salesy, never a claim you cannot prove.`;

export const TREND_RULES = `${ATOSSA}
This morning you scan the world's best interior design sources for new ideas: Pinterest (trends and Pinterest Predicts), Architectural Digest, Elle Decor, Dezeen, ArchDaily, Dwell, Houzz, and what leading kitchen and wardrobe brands show this season. Search the web; prefer pages from the last few weeks.
Write today's notes for your studio: 5 to 8 short English bullet points of concrete ideas you can use with decorative films on cabinets, wardrobes, wall panels and doors (colour pairings, wood and stone looks, finishes, details, layouts, lighting), each with its source site in brackets.
Then one line starting with «فارسی:» with two Persian sentences for the owner: the most useful idea of the day.
Output only the notes.`;

export const FOCUS_RULES = `Look at this interior picture. Give the point at the centre of the largest, best-lit area of the named film, where its colour and texture show best.
x and y go from 0 to 1, from the left and from the top. Answer with JSON only, for example {"x":0.62,"y":0.41}.`;

export const LOOK_RULES = `Describe this decorative film sample for an interior designer in at most 18 English words:
its colour (warm or cool; light, medium or dark), its pattern (solid colour; the wood it looks like and its grain; stone, concrete or marble and its veins) and its finish.
Output only the description.`;

export const DESIGNER_RULES = `${ATOSSA}
You design the rooms that sell our decorative films: a client must look at the picture and want THAT film on his doors. The owner is not a designer: you choose everything, he only approves or rejects. Each time propose ONE design.
- The films are the heroes. Choose rooms where they cover large, well-lit surfaces seen up close: a full kitchen, a wall of wardrobe doors, a full-height TV feature wall, a walk-in closet, a vanity, a reception desk. The films must fill at least half of the picture.
- Combine one to three films from the list (only codes from the list), the way the best designers do: a main film with character (a rich wood grain or a stone with movement), a second that contrasts (a solid colour, light against dark, warm against cool), at most a small accent; the 60-30-10 balance.
- Use today's notes from the world's design press when they fit: say in inspiration_fa which idea you took and from where.
- The picture must be rich and alive, never plain or empty: layered warm lighting (golden late-afternoon sun through the windows, hidden LED strips grazing the panels so the grain and texture show), fine details (handleless grooves, slim brass or black metal profiles, fluted glass, a marble or quartz worktop, open shelves with styled objects, plants, books, ceramics), depth (a second room or a view beyond), real reflections and soft shadows.
- Luxury, current and livable, for villas and apartments in the UAE. Vary the room and the style from your recent proposals; follow the owner's notes.
- The scene: ONE English paragraph of 120 to 180 words for an image model, written as the brief of an editorial photograph for a luxury interior magazine: the camera (35 mm lens, eye level, three-quarter view, slightly close so the film texture is crisp), the light, the materials, each film named by the fronts it covers ("the tall wardrobe doors in film HZ812, its walnut grain running vertically, lit by a warm LED strip"). No people, no text, no logos.
Answer with JSON only:
{"title_fa":"a short Persian title","why_fa":"two or three Persian sentences for the owner: why these films work together and for whom","music":"one English line for the background music of this room's Reel: the mood, the instruments and the tempo, calm and elegant (no artist or song names)","inspiration_fa":"one Persian sentence: the idea of the day you used and its source, or empty","room":"the room in English","parts":[{"code":"HZ818","where":"upper kitchen cabinet doors","where_fa":"درهای کابینت بالا"}],"scene":"the English paragraph"}`;

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

/** A photo's caption that asks for a post: «post …», «پست …», «instagram …», «اینستا …». Returns { note } (the rest of the caption) or null. */
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
export class SocialDesk {
  constructor({ client, store, write, research = null, reel = null, tiktok = null, cfg = {}, mediaDir = '', catalogDir = '', brandDir = '', imager = null, log = () => {}, now = () => Date.now() }) {
    Object.assign(this, { client, store, write, research, reel, tiktok, cfg, mediaDir, catalogDir, brandDir, imager, log, now });
  }
  get enabled() { return this.client.hasIg || this.client.hasFb; }
  /** The system-user way: the Page token and the Instagram account are read once; a failure is said in «social». */
  async ready() {
    try { await this.client.ready?.(); delete this.store.d.errors.connect; } catch (e) { this.store.d.errors.connect = { message: e.message, at: this.now() }; this.log(`social: connect failed: ${e.message}`); }
  }

  /** A photo from the owner with «post …»: a caption is written and shown as #SP n; nothing is posted. */
  async draftPost({ image, mime = 'image/jpeg', note = '', facts = '', fitted = false }) {
    await this.ready();
    if (!this.enabled) return 'Instagram and Facebook are not connected yet, so nothing can be posted.';
    // a tall phone photo is cut to 4:5, or Instagram refuses it; the owner's own photos carry the logo like every post (15/11)
    if (!fitted) { image = await brandDesign(await fitForInstagram(image), { ...this.brandAssets(), codes: this.codesIn(note) }); mime = 'image/jpeg'; }
    const ask = [facts, note ? `The owner's note: ${note}` : facts ? '' : 'The owner gave no note; describe what the photo shows.'].filter(Boolean).join('\n');
    const caption = String(await this.write({ kind: 'caption', system: fill(CAPTION_RULES, this.cfg), text: ask, image, mime }) || '').trim();
    if (!caption) return 'No caption could be written; send the photo again.';
    const id = this.store.next('SP');
    let file = '';
    if (this.mediaDir) { fs.mkdirSync(this.mediaDir, { recursive: true }); file = path.join(this.mediaDir, `${id}.jpg`); fs.writeFileSync(file, image); }
    this.store.d.posts[id] = { id, at: this.now(), note, caption, file, mime, state: 'draft', image: file ? undefined : image?.toString('base64') };
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
    return this.draftPost({ image: await brandDesign(image, this.brandAssets()), mime: 'image/jpeg', note, facts, fitted: true });
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
  async designPlan({ code = '', note = '' } = {}) {
    const all = this.catalog();
    const d = this.store.d;
    const text = [
      'The films (code: look [catalogue]):',
      ...Object.entries(all).map(([k, e]) => `${k}: ${e.look || e.kind || 'decorative film'} [${e.catalogue || ''}]`),
      (d.designs || []).length ? `\nYour recent proposals (vary from them):\n${d.designs.slice(-12).map((x) => `- ${x.room}: ${x.codes.join(' + ')}`).join('\n')}` : '',
      (d.taste || []).length ? `\nThe owner's notes on your earlier proposals (follow them):\n${d.taste.slice(-15).map((x) => `- ${x.text}`).join('\n')}` : '',
      this.todayTrends() ? `\nToday's notes from the world's design press (your own research this morning):\n${this.todayTrends()}` : '',
      code ? `\nThe owner asks for a design built around film ${code}: it is the main film.` : '',
      note ? `\nThe owner's words: ${note}` : '',
    ].filter(Boolean).join('\n');
    // room to think: the morning's notes made the brief longer, and a cut answer has no JSON (live test 15/11); one more try when it is cut
    let plan;
    for (let i = 0; i < 2 && !plan; i++) {
      const raw = String(await this.write({ kind: 'design-plan', system: fill(DESIGNER_RULES, this.cfg), text, effort: 'medium', maxTokens: 12000 }) || '');
      try { plan = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { this.log(`social: the plan was not JSON (${raw.length} characters)`); }
    }
    if (!plan) return { error: 'The designer gave no plan; try again.' };
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
  async draftDesign({ code: asked = '', note = '' } = {}) {
    if (!this.imager?.enabled) return { text: 'The design maker (Google Gemini) is not connected yet: its key is missing on the server.' };
    let code = '';
    if (asked) { const c = this.catalogColour(asked); if (c.error) return { text: c.error }; code = c.code; }
    await this.ensureLooks();
    await this.researchTrends().catch((err) => this.log(`social: today's research failed: ${err.message}`));
    const plan = await this.designPlan({ code, note });
    if (plan.error) return { text: plan.error };
    const all = this.catalog();
    let made;
    try {
      const images = plan.parts.map((p) => ({ label: `Reference: film ${p.code}, for ${p.where}`, buffer: fs.readFileSync(path.join(this.catalogDir, all[p.code].file)), mime: 'image/jpeg' }));
      made = await this.imager.make({ prompt: `${plan.scene}\nEach labelled reference picture is the exact surface film for the fronts named in its label: reproduce each film's colour, pattern and scale faithfully, each only on its own fronts. An editorial photograph for a luxury interior design magazine: photorealistic, highly detailed, crisp film textures with visible grain, rich warm light and depth, real reflections and soft shadows. 4:5 portrait.`, images });
    } catch (err) {
      this.log(`social: design failed: ${err.message}`);
      return { text: `The design could not be made: ${err.message}` };
    }
    const facts = `This picture is an AI design idea (not a photo of a finished job): ${plan.room}, made with ${plan.parts.map((p) => `«Code ${p.code}» (${p.where})`).join(', ')}. Say in the caption that it is a design idea and name the codes.`;
    // the owner's mark (15/11): the ARYAK logo in the top corner, each film's swatch and code along the bottom
    const codes = plan.parts.map((x) => ({ code: x.code, swatch: fs.readFileSync(path.join(this.catalogDir, all[x.code].file)) }));
    const room = await fitForInstagram(made.image);
    const image = await brandDesign(room, { ...this.brandAssets(), codes });
    // the second picture: the main film seen close, its grain and finish filling the frame (a swipe in the post, the second shot of the Reel)
    const main = plan.parts[0];
    let detail = null;
    try {
      const d = await this.imager.make({ prompt: `A close-up detail photograph taken in this same room: the camera is about 40 cm from the ${main.where} in film ${main.code}, at a slight angle, so the film fills two thirds of the frame and its colour, grain or texture and finish are crisp and exactly like the reference sample; at one side a slim brass profile, a handle groove or the edge of the worktop; warm light grazing across the surface; shallow depth of field. Photorealistic editorial macro interior photograph, 4:5 portrait. No people, no text.`,
        images: [{ label: 'The room', buffer: room, mime: 'image/jpeg' }, { label: `Reference: film ${main.code}`, buffer: codes[0].swatch, mime: 'image/jpeg' }] });
      detail = await fitForInstagram(d.image);
    } catch (err) { this.log(`social: the close-up failed: ${err.message}`); }
    const before = new Set(Object.keys(this.store.d.posts));
    const text = await this.draftPost({ image, mime: 'image/jpeg', note, facts, fitted: true });
    const p = this.store.d.posts[Object.keys(this.store.d.posts).find((k) => !before.has(k))];
    if (!p) return { text };
    p.design = { room: plan.room, codes: plan.parts.map((x) => x.code), title: plan.title_fa, scene: plan.scene };
    const save = (name, buf) => { if (!this.mediaDir) return ''; const f = path.join(this.mediaDir, name); fs.writeFileSync(f, buf); return f; };
    let detailImage = null;
    if (detail) { detailImage = await brandDesign(detail, { ...this.brandAssets(), codes: codes.slice(0, 1) }); p.extras = [save(`${p.id}-2.jpg`, detailImage)].filter(Boolean); }
    let video = null;
    if (this.reel) {
      try { video = await this.makeReelFor({ room, detail, codes, main, music: plan.music }); p.reel = save(`${p.id}.mp4`, video); } catch (err) { this.log(`social: the Reel failed: ${err.message}`); }
    }
    (this.store.d.designs ||= []).push({ at: this.now(), room: plan.room, codes: p.design.codes });
    this.store.d.designs = this.store.d.designs.slice(-40);
    this.store.save();
    const head = [`پیشنهاد طراحی: ${plan.title_fa || plan.room}`, plan.why_fa || '', plan.inspiration_fa ? `الهام: ${plan.inspiration_fa}` : '', ...plan.parts.map((x) => `• کد ${x.code}: ${x.where_fa || x.where}`), `(رد با دلیل: «نه پست ${p.id.slice(2)} …»؛ دلیل شما در طرح‌های بعدی به کار می‌رود)`].filter(Boolean).join('\n');
    return { text: `${head}\n\n${text}${detailImage || video ? `\nWith the post: ${[detailImage ? 'a close-up as a second picture' : '', video ? 'a Reel' : ''].filter(Boolean).join(' and ')}; one yes posts them all.` : ''}`,
      image: p.file ? fs.readFileSync(p.file) : made.image, detail: detailImage, video };
  }

  /** Today's research notes (Atossa reads the world's design press once a day); '' when none. */
  todayTrends() {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    return (this.store.d.trends || []).find((t) => t.day === day)?.text || '';
  }
  async researchTrends() {
    if (!this.research || this.todayTrends()) return this.todayTrends();
    const text = String(await this.research({ system: fill(TREND_RULES, this.cfg), text: `Today is ${new Date(this.now()).toISOString().slice(0, 10)}. Your notes for today.` }) || '').trim();
    if (!text) return '';
    (this.store.d.trends ||= []).push({ day: new Date(this.now()).toISOString().slice(0, 10), at: this.now(), text: text.slice(0, 4000) });
    this.store.d.trends = this.store.d.trends.slice(-14);
    this.store.save();
    return text;
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
      const mp3 = await this.imager.music(`${mood || 'Warm minimal luxury lounge: soft piano, gentle strings, a slow deep pulse, 78 BPM'}. Instrumental only, no vocals. Calm and elegant, for a short luxury interior design video.`);
      if (dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${this.now()}.mp3`), mp3); }
      return mp3;
    } catch (err) {
      this.log(`social: new music failed (${err.message}); a kept clip is used`);
      const all = kept();
      return all.length ? fs.readFileSync(path.join(dir, all[Math.floor(Math.random() * all.length)])) : null;
    }
  }

  async makeReelFor({ room, detail, codes, main, music: mood = '' }) {
    const sharp = (await import('sharp')).default;
    let focus = { x: 0.5, y: 0.5 };
    try {
      const raw = String(await this.write({ kind: 'focus', system: FOCUS_RULES, text: `The film: ${main.code}, on ${main.where}.`, image: room, mime: 'image/jpeg' }) || '');
      const f = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      if (Number.isFinite(f.x) && Number.isFinite(f.y)) focus = f;
    } catch { /* the middle */ }
    const brand = this.brandAssets();
    const frame = await sharp(room).resize(1080, 1920, { fit: 'cover' }).jpeg().toBuffer();
    const overlay = await brandDesign(frame, { ...brand, codes, transparent: true });
    const { endCard } = await import('./reel.js');
    const card = await endCard({ codes, logo: brand.logo, font: brand.font, line: this.cfg.contact ? `WhatsApp ${this.cfg.contact}` : 'ARYAK' });
    return this.reel({ room, detail, focus, overlay, card, music: await this.reelMusic(mood) });
  }

  /** Design drafts still waiting for the owner's answer: the daily proposal waits while there are [max]. */
  designsWaiting() { return Object.values(this.store.d.posts).filter((p) => p.design && p.state === 'draft').length; }

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
    if (p.state !== 'draft') return `Post #${c.id} was already ${p.state}.`;
    const trial = /^(?:آزمون|آزمایش|تست|test)$/i.test(c.text || ''); // «نه پست 7 آزمون»: a test, not the owner's taste
    if (p.design && !trial && (c.verb === 'no' || c.verb === 'yes')) this.addTaste(`${c.verb === 'yes' ? 'Approved' : 'Rejected'}: ${p.design.room} with ${p.design.codes.join(' + ')}${c.text ? `: ${c.text}` : ''}`);
    if (c.verb === 'no') { p.state = 'cancelled'; this.store.save(); return `Post #${c.id} cancelled; nothing was posted.${p.design ? (trial ? ' (A test: nothing was kept.)' : c.text ? ' Your reason is kept for the next designs.' : ' (A reason after the number, e.g. «نه پست 5 too dark», teaches the designer.)') : ''}`; }
    if (c.verb === 'edit') { p.caption = c.text; this.store.save(); return this.postPreview(c.id); }
    if (c.verb !== 'yes') return null;
    const image = p.file ? fs.readFileSync(p.file) : Buffer.from(p.image || '', 'base64');
    p.state = 'posting'; this.store.save(); // a second yes while it runs does nothing
    const done = [];
    const failed = [];
    const extras = (p.extras || []).filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f));
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
    p.state = done.length ? 'posted' : 'draft'; // nothing went out: the draft stays, a later yes tries again
    p.postedAt = this.now();
    this.store.save();
    return [`Post #${c.id}:`, ...done, ...failed.map((f) => `NOT posted, ${f}`)].join('\n');
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

  /** The Reel of a design: a Facebook video and an Instagram Reel, with the same caption. */
  async postReel(p, video, done, failed) {
    if (this.client.hasFb) {
      try { const v = await this.client.fbVideo(video, p.caption); p.fbReel = v.id; done.push(`Facebook video: posted https://www.facebook.com/${v.id}`); } catch (e) { failed.push(`Facebook video: ${e.message}`); }
    }
    if (this.client.hasIg) {
      try { const r = await this.client.igReel(video, p.caption); p.igReel = r.id; done.push(`Instagram Reel: posted${r.link ? ` ${r.link}` : ''}`); } catch (e) { failed.push(`Instagram Reel: ${e.message}`); }
    }
    if (this.tiktok?.connected) {
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
    return ['گزارش هفتگی صفحه (۷ روز گذشته)', `پست‌ها: ${week.length}؛ روی هم دیده‌شده در اینستاگرام: ${reachAll}`, ...lines, top.length ? `رنگ‌هایی که بیشتر دیده و ذخیره شدند: ${top.join('، ')}` : ''].filter(Boolean).join('\n');
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
