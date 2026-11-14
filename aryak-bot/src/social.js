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
  constructor({ client, store, write, cfg = {}, mediaDir = '', log = () => {}, now = () => Date.now() }) {
    Object.assign(this, { client, store, write, cfg, mediaDir, log, now });
  }
  get enabled() { return this.client.hasIg || this.client.hasFb; }
  /** The system-user way: the Page token and the Instagram account are read once; a failure is said in «social». */
  async ready() {
    try { await this.client.ready?.(); delete this.store.d.errors.connect; } catch (e) { this.store.d.errors.connect = { message: e.message, at: this.now() }; this.log(`social: connect failed: ${e.message}`); }
  }

  /** A photo from the owner with «post …»: a caption is written and shown as #SP n; nothing is posted. */
  async draftPost({ image, mime = 'image/jpeg', note = '' }) {
    await this.ready();
    if (!this.enabled) return 'Instagram and Facebook are not connected yet, so nothing can be posted.';
    const caption = String(await this.write({ kind: 'caption', system: fill(CAPTION_RULES, this.cfg), text: note ? `The owner's note: ${note}` : 'The owner gave no note; describe what the photo shows.', image, mime }) || '').trim();
    if (!caption) return 'No caption could be written; send the photo again.';
    const id = this.store.next('SP');
    let file = '';
    if (this.mediaDir) { fs.mkdirSync(this.mediaDir, { recursive: true }); file = path.join(this.mediaDir, `${id}.jpg`); fs.writeFileSync(file, image); }
    this.store.d.posts[id] = { id, at: this.now(), note, caption, file, mime, state: 'draft', image: file ? undefined : image?.toString('base64') };
    this.store.save();
    return this.postPreview(id);
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
