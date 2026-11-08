// A PDF with a text layer is read WITHOUT any model: its text is pulled out here (free). Only a scanned PDF (no usable text) goes to vision.
// This is a small reader for the PDFs offices produce (streams with Flate, object streams, fonts with a ToUnicode map, plain Latin fonts); anything it
// cannot read gives "no text layer" and the PDF takes the picture route, so a miss only costs money, never a wrong answer.

import zlib from 'node:zlib';
import { createHash } from 'node:crypto';

const MAX_TEXT = 60000;
const MIN_LETTERS = 30; // fewer letters and digits than this is not a text layer

// ---- the file as objects ------------------------------------------------------------------------------------------------

/** The text between the first "<<" after [from] and its matching ">>", or ''. */
function dictAt(s, from) {
  const a = s.indexOf('<<', from);
  if (a < 0) return '';
  let depth = 0;
  for (let i = a; i < s.length - 1; i += 1) {
    if (s[i] === '<' && s[i + 1] === '<') { depth += 1; i += 1; } else if (s[i] === '>' && s[i + 1] === '>') { depth -= 1; i += 1; if (depth === 0) return s.slice(a, i + 1); }
  }
  return '';
}

function inflate(raw) {
  try { return zlib.inflateSync(raw); } catch { /* try raw deflate */ }
  try { return zlib.inflateRawSync(raw); } catch { return null; }
}

/** All objects: { dict: string, data: Buffer|null (decoded stream) } by object number. Objects inside object streams are included. */
export function parseObjects(buf) {
  const s = buf.toString('latin1');
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  const starts = [];
  while ((m = re.exec(s))) starts.push({ n: Number(m[1]), at: m.index + m[0].length });
  for (let i = 0; i < starts.length; i += 1) {
    const { n, at } = starts[i];
    const endAt = s.indexOf('endobj', at);
    const body = s.slice(at, endAt < 0 ? undefined : endAt);
    const dict = dictAt(body, 0) || body.trim().slice(0, 400);
    let data = null;
    const sm = /stream\r?\n/.exec(body);
    if (sm) {
      const from = sm.index + sm[0].length;
      const to = body.lastIndexOf('endstream');
      let raw = Buffer.from(body.slice(from, to < 0 ? undefined : to), 'latin1');
      if (/\/Filter\s*(?:\[\s*)?\/FlateDecode/.test(dict)) raw = inflate(raw);
      else if (/\/Filter/.test(dict)) raw = null; // a filter we cannot undo (an image, ASCII85, LZW)
      data = raw;
    }
    if (!objs.has(n)) objs.set(n, { dict, data });
    if (/\/Type\s*\/ObjStm/.test(dict) && data) {
      const text = data.toString('latin1');
      const count = Number(/\/N\s+(\d+)/.exec(dict)?.[1] || 0);
      const first = Number(/\/First\s+(\d+)/.exec(dict)?.[1] || 0);
      const nums = text.slice(0, first).trim().split(/\s+/).map(Number);
      for (let k = 0; k < count; k += 1) {
        const id = nums[k * 2]; const off = nums[k * 2 + 1];
        const next = k + 1 < count ? nums[(k + 1) * 2 + 1] : text.length - first;
        const inner = text.slice(first + off, first + next);
        if (!Number.isNaN(id) && !objs.has(id)) objs.set(id, { dict: dictAt(inner, 0) || inner.trim(), data: null });
      }
    }
  }
  return objs;
}

const refOf = (dict, key) => { const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict); return m ? Number(m[1]) : 0; };
const refsIn = (text) => [...String(text).matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => Number(x[1]));

/** The dictionary a key points to, inline or by reference. */
function subDict(objs, dict, key) {
  const at = dict.search(new RegExp(`/${key}\\b`));
  if (at < 0) return '';
  const after = dict.slice(at + key.length + 1).trimStart();
  if (after.startsWith('<<')) return dictAt(after, 0);
  const r = /^(\d+)\s+\d+\s+R/.exec(after);
  return r ? objs.get(Number(r[1]))?.dict || '' : '';
}

// ---- fonts: a ToUnicode map ---------------------------------------------------------------------------------------------

const hexNum = (h) => parseInt(h, 16);
const uni = (hex) => { let out = ''; for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(hexNum(hex.slice(i, i + 4))); return out; };

/** { width: bytes per code, map: Map(code -> string) } from a ToUnicode CMap. */
export function parseCMap(text) {
  const map = new Map(); let width = 1;
  for (const blk of String(text).matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) { const h = /<([0-9a-fA-F]+)>/.exec(blk[1]); if (h) width = Math.max(width, h[1].length / 2); }
  for (const blk of String(text).matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) { map.set(hexNum(p[1]), uni(p[2])); width = Math.max(width, p[1].length / 2); }
  }
  for (const blk of String(text).matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
      const lo = hexNum(p[1]); const hi = hexNum(p[2]);
      if (hi - lo > 65535) continue;
      width = Math.max(width, p[1].length / 2);
      if (p[3].startsWith('[')) { const arr = [...p[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => uni(x[1])); for (let c = lo; c <= hi; c += 1) if (arr[c - lo] !== undefined) map.set(c, arr[c - lo]); }
      else { const base = hexNum(p[3].slice(1, -1)); const len = p[3].length - 2; for (let c = lo; c <= hi; c += 1) map.set(c, uni((base + (c - lo)).toString(16).padStart(len, '0'))); }
    }
  }
  return { width, map };
}

// ---- a content stream into text -----------------------------------------------------------------------------------------

function unescapeLiteral(src) {
  let out = '';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c !== '\\') { out += c; continue; }
    const n = src[i + 1]; i += 1;
    if (n === 'n') out += '\n'; else if (n === 'r') out += '\r'; else if (n === 't') out += '\t'; else if (n === 'b') out += '\b'; else if (n === 'f') out += '\f';
    else if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(src[i + 1] || '')) { o += src[i + 1]; i += 1; } out += String.fromCharCode(parseInt(o, 8)); }
    else if (n === '\n' || n === '\r') { /* a line continuation */ } else out += n;
  }
  return out;
}

/** Reads one string token at i (literal or hex); returns { bytes: string (one char per byte), end } . */
function readString(s, i) {
  if (s[i] === '(') {
    let depth = 0; let j = i;
    for (; j < s.length; j += 1) { if (s[j] === '\\') { j += 1; continue; } if (s[j] === '(') depth += 1; else if (s[j] === ')') { depth -= 1; if (depth === 0) break; } }
    return { bytes: unescapeLiteral(s.slice(i + 1, j)), end: j + 1 };
  }
  const j = s.indexOf('>', i);
  let h = s.slice(i + 1, j).replace(/\s+/g, '');
  if (h.length % 2) h += '0';
  let out = ''; for (let k = 0; k < h.length; k += 2) out += String.fromCharCode(hexNum(h.slice(k, k + 2)));
  return { bytes: out, end: j + 1 };
}

function decodeBytes(bytes, font) {
  if (!font?.cmap) return bytes.replace(/[\x00-\x08\x0e-\x1f]/g, '');
  const { width, map } = font.cmap; let out = '';
  for (let i = 0; i + width <= bytes.length; i += width) { let code = 0; for (let k = 0; k < width; k += 1) code = code * 256 + bytes.charCodeAt(i + k); out += map.get(code) ?? ''; }
  return out;
}

/** The text of one content stream; [fonts]: { '/F1': { cmap } }. */
export function contentText(content, fonts) {
  const s = content; let out = ''; let font = null; let y = 0; let lastY = null; let pendingNewline = false;
  const stack = []; // operands
  const emit = (t) => { if (!t) return; if (lastY !== null && Math.abs(y - lastY) > 0.5) out += '\n'; else if (pendingNewline) out += ' '; out += t; lastY = y; pendingNewline = false; };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '(' || (c === '<' && s[i + 1] !== '<')) { const r = readString(s, i); stack.push({ str: r.bytes }); i = r.end; continue; }
    if (c === '[') { const arr = []; i += 1; while (i < s.length && s[i] !== ']') { if (/\s/.test(s[i])) { i += 1; continue; } if (s[i] === '(' || s[i] === '<') { const r = readString(s, i); arr.push({ str: r.bytes }); i = r.end; } else { const m = /^[-+]?\d*\.?\d+/.exec(s.slice(i, i + 24)); if (m) { arr.push({ num: Number(m[0]) }); i += m[0].length; } else i += 1; } } i += 1; stack.push({ arr }); continue; }
    if (c === '/') { const m = /^\/[^\s/<>\[\]()%]*/.exec(s.slice(i, i + 80)); stack.push({ name: m[0] }); i += m[0].length; continue; }
    if (c === '%') { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i += 1; continue; }
    const num = /^[-+]?\d*\.?\d+/.exec(s.slice(i, i + 24));
    if (num && num[0] && !/[a-zA-Z]/.test(s[i + num[0].length] || '')) { stack.push({ num: Number(num[0]) }); i += num[0].length; continue; }
    const op = /^[A-Za-z*'"]+/.exec(s.slice(i, i + 8));
    if (!op) { i += 1; continue; }
    i += op[0].length;
    const o = op[0];
    const nums = stack.filter((x) => x.num !== undefined).map((x) => x.num);
    if (o === 'BT') { y = 0; lastY = lastY; }
    else if (o === 'ET') { pendingNewline = true; }
    else if (o === 'Tf') { const nm = stack.find((x) => x.name); font = nm ? fonts[nm.name] || null : null; }
    else if (o === 'Td' || o === 'TD') { y += nums[nums.length - 1] || 0; if (nums[nums.length - 1]) pendingNewline = true; }
    else if (o === 'Tm') { y = nums[5] ?? y; }
    else if (o === 'T*') { y -= 12; }
    else if (o === 'Tj') { const t = stack.find((x) => x.str !== undefined); if (t) emit(decodeBytes(t.str, font)); }
    else if (o === "'" || o === '"') { y -= 12; const t = [...stack].reverse().find((x) => x.str !== undefined); if (t) emit(decodeBytes(t.str, font)); }
    else if (o === 'TJ') {
      const a = stack.find((x) => x.arr); let t = '';
      for (const el of a?.arr || []) { if (el.str !== undefined) t += decodeBytes(el.str, font); else if (el.num < -250) t += ' '; }
      emit(t);
    }
    stack.length = 0;
  }
  return out;
}

// ---- the whole document -------------------------------------------------------------------------------------------------

/** The pages in order, from the page tree when it can be walked, else in file order. */
function pageList(objs) {
  const all = [...objs.entries()].filter(([, o]) => /\/Type\s*\/Page\b(?!s)/.test(o.dict)).map(([n]) => n);
  const root = [...objs.entries()].find(([, o]) => /\/Type\s*\/Catalog/.test(o.dict));
  const out = [];
  const visited = new Set();
  const walk = (n) => {
    if (visited.has(n)) return; visited.add(n);
    const o = objs.get(n); if (!o) return;
    if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) { out.push(n); return; }
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict);
    if (kids) for (const k of refsIn(kids[1])) walk(k);
  };
  if (root) walk(refOf(root[1].dict, 'Pages'));
  return out.length >= all.length ? out : all.sort((a, b) => a - b);
}

/** { ok, text, pages } : ok is true only when the text is real (enough letters and digits). */
export function pdfTextLayer(input) {
  try {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'base64');
    if (buf.slice(0, 5).toString('latin1') !== '%PDF-') return { ok: false, text: '', pages: 0 };
    const objs = parseObjects(buf);
    const fontCache = new Map();
    const fontOf = (n) => {
      if (fontCache.has(n)) return fontCache.get(n);
      const o = objs.get(n); let f = {};
      const tu = o ? refOf(o.dict, 'ToUnicode') : 0;
      if (tu && objs.get(tu)?.data) f = { cmap: parseCMap(objs.get(tu).data.toString('latin1')) };
      fontCache.set(n, f); return f;
    };
    const pages = pageList(objs);
    const texts = [];
    for (const pn of pages) {
      const page = objs.get(pn); if (!page) continue;
      let res = subDict(objs, page.dict, 'Resources');
      for (let up = refOf(page.dict, 'Parent'), hops = 0; !res && up && hops < 6; hops += 1) { const parent = objs.get(up); if (!parent) break; res = subDict(objs, parent.dict, 'Resources'); up = refOf(parent.dict, 'Parent'); }
      const fdict = subDict(objs, res, 'Font');
      const fonts = {};
      for (const m of fdict.matchAll(/(\/[^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) fonts[m[1]] = fontOf(Number(m[2]));
      const cm = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(page.dict);
      const parts = [];
      for (const cn of cm ? refsIn(cm[1]) : []) { const d = objs.get(cn)?.data; if (d) parts.push(contentText(d.toString('latin1'), fonts)); }
      texts.push(parts.join('\n').trim());
    }
    const text = texts.map((t, i) => (texts.length > 1 ? `--- page ${i + 1} ---\n${t}` : t)).join('\n\n').slice(0, MAX_TEXT);
    const letters = (text.match(/[\p{L}\p{N}]/gu) || []).length;
    return { ok: letters >= MIN_LETTERS, text, pages: pages.length };
  } catch { return { ok: false, text: '', pages: 0 }; }
}

// ---- the block that goes to the model -----------------------------------------------------------------------------------

let meter = null;
/** The CostMeter that counts PDFs (free or by vision). */
export function setDocMeter(m) { meter = m; }
const cache = new Map();
const counted = new Set();

/**
 * The content block for a document or a picture: an image is an image block; a PDF with a text layer becomes a TEXT block (no vision, free);
 * a scanned PDF stays a document block (vision). Each distinct PDF is counted once.
 */
export function documentBlock(doc) {
  const mime = String(doc?.mimeType || 'application/pdf');
  if (mime.startsWith('image/')) return { type: 'image', source: { type: 'base64', media_type: mime, data: doc.base64 } };
  const key = createHash('sha1').update(String(doc.base64 || '')).digest('hex');
  let t = cache.get(key);
  if (!t) { t = pdfTextLayer(doc.base64); if (cache.size > 50) cache.delete(cache.keys().next().value); cache.set(key, t); }
  if (!counted.has(key)) { counted.add(key); if (counted.size > 500) counted.delete(counted.values().next().value); meter?.pdf(t.ok); }
  if (t.ok) return { type: 'text', text: `The text of the PDF file${doc.fileName ? ` ${doc.fileName}` : ''} (taken from its text layer, in reading order; table columns follow each other from left to right):\n${t.text}` };
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 } };
}
