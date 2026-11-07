// A tiny PDF writer for one-page-or-more text documents: A4, the standard Helvetica fonts (no font files, no dependency), lines and filled boxes.
// Text is Latin-1 (WinAnsi); any other character is drawn as "?". Coordinates are in points from the TOP-left of the page (the writer flips them).

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
  text(x, y, s, { size = 10, bold = false, align = 'left', gray = 0 } = {}) {
    if (!this.cur) this.addPage();
    const w = textWidth(s, size, bold);
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.cur.push(`${num(gray)} g BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(left)} ${num(H - y)} Td (${esc(s)}) Tj ET 0 g`);
    return this;
  }

  line(x1, y1, x2, y2, width = 0.5, gray = 0) {
    if (!this.cur) this.addPage();
    this.cur.push(`${num(gray)} G ${num(width)} w ${num(x1)} ${num(H - y1)} m ${num(x2)} ${num(H - y2)} l S 0 G`);
    return this;
  }

  /** A filled box from its top-left corner. */
  box(x, y, w, h, gray = 0.93) {
    if (!this.cur) this.addPage();
    this.cur.push(`${num(gray)} g ${num(x)} ${num(H - y - h)} ${num(w)} ${num(h)} re f 0 g`);
    return this;
  }

  /** The finished document as bytes. */
  build() {
    if (!this.pages.length) this.addPage();
    const objs = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    const n = this.pages.length;
    objs[2] = `<< /Type /Pages /Kids [${this.pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ')}] /Count ${n} >>`;
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    this.pages.forEach((ops, i) => {
      const content = ops.join('\n');
      objs[5 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`;
      objs[6 + 2 * i] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
    });
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
