// A tiny PDF writer for one-page-or-more text documents: A4, the standard Helvetica fonts (no font files, no dependency), lines and filled boxes.
// Text is Latin-1 (WinAnsi); any other character is drawn as "?". Coordinates are in points from the TOP-left of the page (the writer flips them).

import zlib from 'node:zlib';

const W = 595;
const H = 842;
// Helvetica advance widths of the printable ASCII characters (1/1000 em), for right and centre alignment.
const HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

const latin = (s) => String(s ?? '').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const esc = (s) => latin(s).replace(/[\\()]/g, (c) => `\\${c}`);
const num = (n) => (Math.round(n * 100) / 100).toString();

/** The width of a text in points at a font size (bold is a little wider). */
export function textWidth(s, size, bold = false) {
  let w = 0;
  for (const ch of latin(s)) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? HW[c - 32] : 556; }
  return (w / 1000) * size * (bold ? 1.06 : 1);
}

export class MiniPdf {
  constructor() { this.pages = []; this.cur = null; this.width = W; this.height = H; }

  addPage() { this.cur = []; this.pages.push(this.cur); return this; }

  /** Draws [s] with its left edge (or right edge, or centre) at x and its baseline at y. */
  text(x, y, s, { size = 10, bold = false, align = 'left', gray = 0, rgb = null } = {}) {
    if (!this.cur) this.addPage();
    const w = textWidth(s, size, bold);
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    const fill = rgb ? `${rgb.map(num).join(' ')} rg` : `${num(gray)} g`;
    this.cur.push(`${fill} BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(left)} ${num(H - y)} Td (${esc(s)}) Tj ET 0 g`);
    return this;
  }

  line(x1, y1, x2, y2, width = 0.5, gray = 0, dash = null) {
    if (!this.cur) this.addPage();
    const d = dash ? `[${dash.join(' ')}] 0 d` : '[] 0 d';
    this.cur.push(`${num(gray)} G ${num(width)} w ${d} ${num(x1)} ${num(H - y1)} m ${num(x2)} ${num(H - y2)} l S [] 0 d 0 G`);
    return this;
  }

  /** A filled box from its top-left corner. */
  box(x, y, w, h, gray = 0.93, rgb = null) {
    if (!this.cur) this.addPage();
    this.cur.push(`${rgb ? `${rgb.map(num).join(' ')} rg` : `${num(gray)} g`} ${num(x)} ${num(H - y - h)} ${num(w)} ${num(h)} re f 0 g`);
    return this;
  }

  /** A picture (see readImage) with its top-left corner at x, y and a box of w x h points (kept in proportion, centred in the box). */
  image(img, x, y, w, h) {
    if (!this.cur) this.addPage();
    if (!this.images) this.images = [];
    let k = this.images.indexOf(img);
    if (k < 0) { this.images.push(img); k = this.images.length - 1; }
    const r = Math.min(w / img.width, h / img.height);
    const dw = img.width * r; const dh = img.height * r;
    this.cur.push(`q ${num(dw)} 0 0 ${num(dh)} ${num(x + (w - dw) / 2)} ${num(H - y - h + (h - dh) / 2)} cm /Im${k} Do Q`);
    return this;
  }

  /** The finished document as bytes. */
  build() {
    if (!this.pages.length) this.addPage();
    const objs = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    const n = this.pages.length;
    const first = 5 + 2 * n; // the picture objects come after the pages
    const imgObjs = [];
    (this.images || []).forEach((im, k) => {
      const base = first + 2 * k;
      const smask = im.alpha ? ` /SMask ${base + 1} 0 R` : '';
      imgObjs.push([base, im, smask]);
    });
    objs[2] = `<< /Type /Pages /Kids [${this.pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ')}] /Count ${n} >>`;
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    this.pages.forEach((ops, i) => {
      const content = ops.join('\n');
      objs[5 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${this.images?.length ? ` /XObject << ${this.images.map((_, k) => `/Im${k} ${first + 2 * k} 0 R`).join(' ')} >>` : ''} >> /Contents ${6 + 2 * i} 0 R >>`;
      objs[6 + 2 * i] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
    });
    const stream = (dict, data) => `<< ${dict} /Length ${data.length} >>\nstream\n${data.toString('latin1')}\nendstream`;
    for (const [base, im, smask] of imgObjs) {
      objs[base] = stream(`/Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /${im.space} /BitsPerComponent 8 /Filter /${im.filter}${smask}`, im.data);
      if (im.alpha) objs[base + 1] = stream(`/Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, im.alpha);
    }
    const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
    const offsets = [];
    let pos = parts[0].length;
    for (let i = 1; i < objs.length; i++) {
      offsets[i] = pos;
      const b = Buffer.from(`${i} 0 obj\n${objs[i]}\nendobj\n`, 'latin1');
      parts.push(b); pos += b.length;
    }
    const xref = [`xref\n0 ${objs.length}\n0000000000 65535 f \n`];
    for (let i = 1; i < objs.length; i++) xref.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
    xref.push(`trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`);
    parts.push(Buffer.from(xref.join(''), 'latin1'));
    return Buffer.concat(parts);
  }
}

/**
 * A PNG (8 bit, grey, grey+alpha, RGB or RGB+alpha, not interlaced) or a JPEG as a picture for MiniPdf.image, or null when the bytes are neither or
 * are a kind not read here (the caller then leaves the space empty).
 */
export function readImage(buf) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8) { // JPEG: the size and the number of colour channels are in the first frame header
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
          const comps = buf[i + 9];
          if (comps === 4) return null; // CMYK: not read here
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), space: comps === 1 ? 'DeviceGray' : 'DeviceRGB', filter: 'DCTDecode', data: buf, alpha: null };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return null;
    }
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;
    let pos = 8; let width = 0; let height = 0; let depth = 0; let type = 0; let interlace = 0; const idat = [];
    while (pos + 8 <= buf.length) {
      const len = buf.readUInt32BE(pos); const name = buf.toString('latin1', pos + 4, pos + 8); const body = buf.subarray(pos + 8, pos + 8 + len);
      if (name === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
      else if (name === 'IDAT') idat.push(body);
      else if (name === 'IEND') break;
      pos += 12 + len;
    }
    const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
    if (!channels || depth !== 8 || interlace || !width || !height || !idat.length) return null;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels; const px = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) { // undo the PNG row filters
      const f = raw[y * (stride + 1)]; const src = y * (stride + 1) + 1; const out = y * stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? px[out + x - channels] : 0; const b = y ? px[out - stride + x] : 0; const cc = x >= channels && y ? px[out - stride + x - channels] : 0;
        const v = raw[src + x];
        let add = 0;
        if (f === 1) add = a; else if (f === 2) add = b; else if (f === 3) add = (a + b) >> 1;
        else if (f === 4) { const p = a + b - cc; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - cc); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc; }
        px[out + x] = (v + add) & 255;
      }
    }
    if (type === 0 || type === 2) return { width, height, space: type === 0 ? 'DeviceGray' : 'DeviceRGB', filter: 'FlateDecode', data: zlib.deflateSync(px), alpha: null };
    const colour = channels - 1; const rgb = Buffer.alloc(width * height * colour); const alpha = Buffer.alloc(width * height);
    for (let k = 0; k < width * height; k++) { for (let j = 0; j < colour; j++) rgb[k * colour + j] = px[k * channels + j]; alpha[k] = px[k * channels + colour]; }
    return { width, height, space: colour === 1 ? 'DeviceGray' : 'DeviceRGB', filter: 'FlateDecode', data: zlib.deflateSync(rgb), alpha: zlib.deflateSync(alpha) };
  } catch (e) { return null; }
}
