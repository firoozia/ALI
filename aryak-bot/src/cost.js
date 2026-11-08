// The real cost of the paid calls, from what the API says it used: input and output tokens per model (the price table is in the configuration
// and can be edited by the environment), speech by the seconds of audio, and the counts the owner cares about: photos read by the cheap model and
// by the strong one (with the reason of each second read), voice notes and minutes, PDFs read for free from their text layer and by vision.
// The log never holds a message text: one line per call with the model, the tokens and the dollars.

import fs from 'node:fs';
import path from 'node:path';
import { localParts } from './morning.js';

/** US dollars per million tokens: [input, output]. They are estimates; COST_PRICES (JSON) overrides any of them. */
export const PRICES = {
  'claude-opus-5-5': [5, 25],
  'claude-sonnet-5-5': [3, 15],
  'claude-haiku-5-5': [1, 5],
};
export const SPEECH_PER_MINUTE = 0.016;

/** The family of a model name: 'opus', 'sonnet', 'haiku' or 'other'. */
export const familyOf = (model) => { const m = String(model || '').toLowerCase(); return m.includes('opus') ? 'opus' : m.includes('sonnet') ? 'sonnet' : m.includes('haiku') ? 'haiku' : 'other'; };

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const fa = (s) => String(s).replace(/\d/g, (d) => FA_DIGITS[d]).replace(/\./g, '٫');
const REASON = { unreadable: 'ناخوانا', unclear: 'کد نامطمئن', 'unknown-code': 'کد ناشناس', totals: 'جمع نمی‌خورد', missing: 'فیلد ناقص', parse: 'پاسخ ناقص', other: 'دیگر' };
export const reasonLabel = (r) => REASON[r] || REASON.other;
const FAMILY_FA = { opus: 'اوپوس', sonnet: 'سونِت', haiku: 'هایکو', other: 'دیگر' };

const blank = () => ({ models: {}, photo: { haiku: 0, sonnet: 0, reasons: {} }, voice: { n: 0, sec: 0, usd: 0 }, pdf: { free: 0, vision: 0 } });

export class CostMeter {
  /** [prices]: { model: [in, out] } merged over PRICES; [speechPerMinute]; [log]: a function(line). */
  constructor(dir = '', { timeZone = 'Asia/Dubai', now = () => Date.now(), prices = {}, speechPerMinute = SPEECH_PER_MINUTE, log = () => {} } = {}) {
    this.file = dir ? path.join(dir, 'cost.json') : '';
    Object.assign(this, { timeZone, now, speechPerMinute, log });
    this.prices = { ...PRICES, ...prices };
    this.days = {};
    try { if (this.file) this.days = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first start */ }
    this.dirty = false;
  }

  day(t = this.now()) { return localParts(t, this.timeZone).day; }
  today() { return (this.days[this.day()] ||= blank()); }

  /** The [input, output] price of a model: an exact entry, else the family's, else the Sonnet price. */
  priceOf(model) {
    if (this.prices[model]) return this.prices[model];
    const fam = familyOf(model);
    const hit = Object.entries(this.prices).find(([k]) => familyOf(k) === fam && fam !== 'other');
    return hit ? hit[1] : this.prices['claude-sonnet-5-5'] || [3, 15];
  }

  /** The dollars of one call from its usage object. A cache read costs a tenth of an input token, a cache write a quarter more. */
  usdOf(model, usage) {
    const [pin, pout] = this.priceOf(model);
    const u = usage || {};
    const input = Number(u.input_tokens) || 0;
    const out = Number(u.output_tokens) || 0;
    const read = Number(u.cache_read_input_tokens) || 0;
    const write = Number(u.cache_creation_input_tokens) || 0;
    return ((input + read * 0.1 + write * 1.25) * pin + out * pout) / 1e6;
  }

  /** Every call to a Claude model: the tokens and the dollars by family. */
  model(model, usage, group = '-') {
    const fam = familyOf(model);
    const d = this.today();
    const m = (d.models[fam] ||= { n: 0, in: 0, out: 0, usd: 0 });
    const usd = this.usdOf(model, usage);
    const inTok = (Number(usage?.input_tokens) || 0) + (Number(usage?.cache_read_input_tokens) || 0) + (Number(usage?.cache_creation_input_tokens) || 0);
    m.n += 1; m.in += inTok; m.out += Number(usage?.output_tokens) || 0; m.usd += usd;
    this.dirty = true;
    this.log(`cost: model=${model} in=${inTok} out=${Number(usage?.output_tokens) || 0} usd=${usd.toFixed(4)} group=${group}`);
    return usd;
  }

  /** A photo (or a scanned page) read: by the first model, or by the strong one after a failed check (with the reason). */
  photo({ escalated = false, reason = '' } = {}) {
    const p = this.today().photo;
    if (escalated) { p.sonnet += 1; p.reasons[reason || 'other'] = (p.reasons[reason || 'other'] || 0) + 1; } else p.haiku += 1;
    this.dirty = true;
    this.log(`cost: photo ${escalated ? `escalated reason=${reason || 'other'}` : 'first read'}`);
  }

  /** A voice note: its seconds, priced by the minute. */
  voice(seconds) {
    const v = this.today().voice;
    const s = Math.max(0, Number(seconds) || 0);
    const usd = (s / 60) * this.speechPerMinute;
    v.n += 1; v.sec += s; v.usd += usd;
    this.dirty = true;
    this.log(`cost: voice seconds=${Math.round(s)} usd=${usd.toFixed(4)}`);
  }

  /** A PDF taken in: read for free from its text layer, or sent to vision (its tokens are counted with the call). */
  pdf(free) {
    const p = this.today().pdf;
    if (free) p.free += 1; else p.vision += 1;
    this.dirty = true;
    this.log(`cost: pdf ${free ? 'text layer (free)' : 'vision'}`);
  }

  totals(day = this.day()) {
    const d = this.days[day] || blank();
    const usd = Object.values(d.models || {}).reduce((s, m) => s + (m.usd || 0), 0) + (d.voice?.usd || 0);
    return { ...d, usd };
  }

  /** The sum of the last [n] days (today included). */
  range(n = 7) {
    const acc = blank(); let usd = 0;
    for (let i = 0; i < n; i += 1) {
      const t = this.totals(this.day(this.now() - i * 86400000));
      for (const [f, m] of Object.entries(t.models || {})) { const a = (acc.models[f] ||= { n: 0, in: 0, out: 0, usd: 0 }); a.n += m.n; a.in += m.in; a.out += m.out; a.usd += m.usd; }
      acc.photo.haiku += t.photo?.haiku || 0; acc.photo.sonnet += t.photo?.sonnet || 0;
      for (const [r, c] of Object.entries(t.photo?.reasons || {})) acc.photo.reasons[r] = (acc.photo.reasons[r] || 0) + c;
      acc.voice.n += t.voice?.n || 0; acc.voice.sec += t.voice?.sec || 0; acc.voice.usd += t.voice?.usd || 0;
      acc.pdf.free += t.pdf?.free || 0; acc.pdf.vision += t.pdf?.vision || 0;
      usd += t.usd;
    }
    return { ...acc, usd };
  }

  save() {
    if (!this.file || !this.dirty) return;
    const keep = Object.keys(this.days).sort().slice(-35);
    this.days = Object.fromEntries(keep.map((k) => [k, this.days[k]]));
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.days)); this.dirty = false; } catch { /* best effort */ }
  }

  /** "عکس: ۱۲ (هایکو ۱۰، سونِت ۲)، ویس: ۷ (۴ دقیقه)، پی‌دی‌اف: ۵ (۴ رایگان)، هزینه: ۰٫۴۲ دلار"; empty when nothing was spent. */
  static summary(t) {
    const photos = (t.photo?.haiku || 0) + (t.photo?.sonnet || 0);
    const pdfs = (t.pdf?.free || 0) + (t.pdf?.vision || 0);
    const calls = Object.values(t.models || {}).reduce((s, m) => s + m.n, 0);
    if (!photos && !t.voice?.n && !pdfs && !calls) return '';
    const minutes = Math.round(((t.voice?.sec || 0) / 60) * 10) / 10;
    return `عکس: ${fa(photos)} (هایکو ${fa(t.photo?.haiku || 0)}، سونِت ${fa(t.photo?.sonnet || 0)})، ویس: ${fa(t.voice?.n || 0)} (${fa(minutes)} دقیقه)، پی‌دی‌اف: ${fa(pdfs)} (${fa(t.pdf?.free || 0)} رایگان)، هزینه: ${fa(t.usd.toFixed(2))} دلار`;
  }

  /** The one line for the daily digest. */
  line(day = this.day()) { const s = CostMeter.summary(this.totals(day)); return s ? `- ${s}` : ''; }

  /** The owner's «هزینهٔ امروز» / «هزینهٔ هفته»: the summary, then the calls by model and the reasons of the strong reads. */
  report(range = 'today') {
    const t = range === 'week' ? this.range(7) : this.totals();
    const head = range === 'week' ? 'هزینهٔ هفتهٔ اخیر (هفت روز)' : 'هزینهٔ امروز';
    const sum = CostMeter.summary(t);
    if (!sum) return `${head}: هنوز تماس پولی نبوده است.`;
    const lines = [head, sum];
    for (const f of ['opus', 'sonnet', 'haiku', 'other']) {
      const m = t.models[f];
      if (m) lines.push(`${f === 'opus' ? 'گفت‌وگو و کارهای اوپوس' : FAMILY_FA[f]}: ${fa(m.n)} تماس، ${fa(m.in)} واحد ورودی، ${fa(m.out)} واحد خروجی، ${fa(m.usd.toFixed(2))} دلار`);
    }
    const reasons = Object.entries(t.photo.reasons || {});
    if (reasons.length) lines.push(`خواندن دوباره با سونِت: ${reasons.map(([r, c]) => `${reasonLabel(r)} ${fa(c)}`).join('، ')}`);
    if (t.voice.n) lines.push(`ویس: ${fa(t.voice.n)} پیام، ${fa(Math.round((t.voice.sec / 60) * 10) / 10)} دقیقه، ${fa(t.voice.usd.toFixed(2))} دلار`);
    lines.push(`پی‌دی‌اف رایگان (لایهٔ متن): ${fa(t.pdf.free)}؛ با خواندن تصویری: ${fa(t.pdf.vision)}`);
    lines.push('قیمت‌ها برآورد است و از تنظیم قیمت مدل‌ها می‌آید.');
    return lines.join('\n');
  }
}
