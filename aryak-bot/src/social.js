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
  if ((m = /^(?:no|cancel|نه|خیر|لغو)\s*#?\s*(SP|SR)\s*(\d+)\s*[.!]?$/i.exec(t))) return { verb: 'no', kind: m[1].toUpperCase(), id: `${m[1].toUpperCase()}${m[2]}` };
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

/** «طرح ۸۳۲ کمد دیواری» / «design 212 kitchen»: an AI design idea of a room made with that catalogue colour. Null when not one. */
export function designRequest(text) {
  const m = /^(?:طرح|design)\s+(?:کد|code)?\s*#?\s*([A-Za-z]{0,3}\s*\d{3,4})(?![\d])\s*[:،,\-]?\s*([\s\S]*)$/i.exec(plainCode(text));
  return m ? { code: m[1].replace(/\s+/g, '').toUpperCase(), note: m[2].trim() } : null;
}

/**
 * Google's image model (Gemini, «Nano Banana») through its official API: a prompt and reference pictures in, one picture out.
 * [apiKey] from Google AI Studio, [model] e.g. gemini-nano-banana-2.1. make() throws with Google's own words when no picture comes back.
 */
export class GeminiImage {
  constructor({ apiKey, model = 'gemini-nano-banana-2.1', fetchImpl = globalThis.fetch }) { Object.assign(this, { apiKey, model, fetchImpl }); }
  get enabled() { return !!this.apiKey; }
  async make({ prompt, images = [], aspect = '4:5' }) {
    const body = {
      contents: [{ role: 'user', parts: [...images.map((i) => ({ inline_data: { mime_type: i.mime || 'image/jpeg', data: i.buffer.toString('base64') } })), { text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect } },
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
}

export const DESIGN_RULES = `You write the prompt for an image model that makes interior design ideas for {BRAND}.
The image model gets the attached picture as its reference: a sample of one decorative film (colour code {CODE}, {KIND}).
Write ONE English paragraph of 80 to 140 words describing a photorealistic interior photograph in which the fronts named by the owner (cabinet doors, wardrobe doors, wall panels…) are covered with exactly this film.
- Describe the film precisely from the sample: its colour, its pattern or grain and the grain direction, matt or gloss. Keep the pattern at real scale (wood grain runs along the door; stone veins are large and calm).
- Everything else in the room is neutral and quiet (white or light walls, simple handles, plain worktop), so the film is the hero. Natural daylight, eye-level camera, wide-angle interior photography.
- No people, no text, no logos, no brand names.
- The owner's words may be in Persian or Arabic: follow them (the room, the style, the colours around). With no words, a modern kitchen.
Output only the prompt.`;

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

export const CAPTION_RULES = `You write social media captions for {BRAND}.
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
  constructor({ client, store, write, cfg = {}, mediaDir = '', catalogDir = '', imager = null, log = () => {}, now = () => Date.now() }) {
    Object.assign(this, { client, store, write, cfg, mediaDir, catalogDir, imager, log, now });
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
    if (!fitted) { image = await fitForInstagram(image); mime = 'image/jpeg'; } // a tall phone photo is cut to 4:5, or Instagram refuses it
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
  async draftFromCatalog({ code: asked, note = '' }) {
    const { code, e, image, error } = this.catalogColour(asked);
    if (error) return error;
    const facts = `This is colour code ${code} from the ${e.catalogue}${e.kind ? ` (${e.kind})` : ''}. Name it in the caption as «Code ${code}». The picture is the colour sample itself (a decorative film for furniture), not a room.`;
    return this.draftPost({ image, mime: 'image/jpeg', note, facts, fitted: true });
  }
  /**
   * «طرح ۸۳۲ کمد دیواری»: the model writes the scene from the colour sample, Gemini draws the room with that film, and the picture
   * becomes a draft #SP like any other (nothing is posted before the yes). Returns { text, image } so the owner sees the picture itself.
   */
  async draftDesign({ code: asked, note = '' }) {
    if (!this.imager?.enabled) return { text: 'The design maker (Google Gemini) is not connected yet: its key is missing on the server.' };
    const { code, e, image: sample, error } = this.catalogColour(asked);
    if (error) return { text: error };
    const system = fill(DESIGN_RULES, this.cfg).replace('{CODE}', code).replace('{KIND}', e.kind || e.catalogue || 'decorative film');
    const scene = String(await this.write({ kind: 'design-prompt', system, text: note ? `The owner's words: ${note}` : 'The owner gave no words.', image: sample, mime: 'image/jpeg' }) || '').trim();
    if (!scene) return { text: 'No design description could be written; try again.' };
    let made;
    try {
      made = await this.imager.make({ prompt: `${scene}\nThe attached picture is the exact surface film (colour code ${code}): reproduce its colour, pattern and scale faithfully on those fronts. Photorealistic, 4:5 portrait.`, images: [{ buffer: sample, mime: 'image/jpeg' }] });
    } catch (err) {
      this.log(`social: design ${code} failed: ${err.message}`);
      return { text: `The design of colour ${code} could not be made: ${err.message}` };
    }
    const facts = `This picture is an AI design idea (not a photo of a finished job) showing colour code ${code} from the ${e.catalogue}${e.kind ? ` (${e.kind})` : ''}. Say in the caption that it is a design idea made with «Code ${code}».`;
    const before = new Set(Object.keys(this.store.d.posts));
    const text = await this.draftPost({ image: made.image, mime: made.mime, note, facts });
    const p = this.store.d.posts[Object.keys(this.store.d.posts).find((k) => !before.has(k))];
    if (p) { p.design = { code, scene }; this.store.save(); }
    return { text, image: p?.file ? fs.readFileSync(p.file) : made.image };
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
    if (c.verb === 'no') { p.state = 'cancelled'; this.store.save(); return `Post #${c.id} cancelled; nothing was posted.`; }
    if (c.verb === 'edit') { p.caption = c.text; this.store.save(); return this.postPreview(c.id); }
    if (c.verb !== 'yes') return null;
    const image = p.file ? fs.readFileSync(p.file) : Buffer.from(p.image || '', 'base64');
    p.state = 'posting'; this.store.save(); // a second yes while it runs does nothing
    const done = [];
    const failed = [];
    let photoUrl = '';
    try {
      if (this.client.hasFb) {
        // the Facebook photo is published (with the caption) and its address is the one Instagram fetches the picture from
        const fb = await this.client.fbPhoto(image, p.caption, { published: true, mime: p.mime });
        const link = await this.client.fbPermalink(fb.post_id || fb.id);
        done.push(`Facebook: posted${link ? ` ${link}` : ''}`);
        p.fb = fb.post_id || fb.id;
        if (this.client.hasIg) photoUrl = await this.client.fbPhotoUrl(fb.id);
      }
    } catch (e) { failed.push(`Facebook: ${e.message}`); }
    if (this.client.hasIg) {
      try {
        if (!photoUrl && this.client.hasFb) { const hidden = await this.client.fbPhoto(image, '', { published: false, mime: p.mime }); photoUrl = await this.client.fbPhotoUrl(hidden.id); }
        if (!photoUrl) throw new Error('Instagram takes a photo only from a web address; connect the Facebook Page so the photo can be held there');
        const ig = await this.client.igPublish(photoUrl, p.caption);
        p.ig = ig.id;
        done.push(`Instagram: posted${ig.link ? ` ${ig.link}` : ''}`);
      } catch (e) { failed.push(`Instagram: ${e.message}`); }
    }
    p.state = done.length ? 'posted' : 'draft'; // nothing went out: the draft stays, a later yes tries again
    this.store.save();
    return [`Post #${c.id}:`, ...done, ...failed.map((f) => `NOT posted, ${f}`)].join('\n');
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

  async handle(c) {
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
