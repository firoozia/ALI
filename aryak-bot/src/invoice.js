// Invoice check: a customer's request (PDF) against the invoice a colleague sends (PDF) in the same group.
// Claude reads both files (text or scanned) and lists the differences; the report goes to the information group.
// The bot only reports. It never writes to the customer, the sheet or the invoice.

export const INVOICE_RULES = `You check an ARYAK invoice against what the customer asked for. You get two PDF files: first the customer's request (an order or a list of wanted items), then the invoice issued by ARYAK. Both may be scans or photos; read them carefully.

Compare
- Customer name on both.
- Every item: product code, size or thickness and colour, quantity with its unit, and unit price and line total when the request states a price.
- Items asked for but missing from the invoice, items invoiced that were not asked for, wrong code, wrong size, wrong quantity or unit, wrong price, wrong arithmetic (line totals or the grand total that do not add up).
- A different wording of the same thing (a code written with or without dashes, "m" and "meter") is NOT a difference.

Rules
- Report only differences you can see in the documents. If a value is unreadable, say so as a problem of kind "unreadable"; do not guess.
- If the request states no prices, do not report prices as differences; still report invoice arithmetic errors.
- Answer with ONE JSON object and nothing else:
{"verdict":"match"|"mismatch"|"unreadable","request_customer":string,"invoice_customer":string,"invoice_number":string,"problems":[{"kind":"missing"|"extra"|"code"|"size"|"quantity"|"price"|"total"|"customer"|"unreadable","item":string,"requested":string,"invoiced":string,"note":string}]}
- "match" has an empty problems list. Write the strings as they appear in the documents; "note" is one short sentence in Persian.`;

const pdfBlock = (doc) => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 } });

/** The user turn: the request file, then the invoice file. */
export function buildInvoiceContent(request, invoice) {
  return [
    { type: 'text', text: `File 1: the customer's request (${request.fileName || 'request.pdf'}), sent by ${request.senderName || 'the customer'}.` },
    pdfBlock(request),
    { type: 'text', text: `File 2: the invoice (${invoice.fileName || 'invoice.pdf'}), sent by ${invoice.senderName || 'a colleague'}.` },
    pdfBlock(invoice),
    { type: 'text', text: 'Compare them and answer with the JSON object.' },
  ];
}

/** Pulls the JSON object out of the model's text; returns null when there is none. */
export function parseVerdict(text) {
  const s = String(text || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const v = JSON.parse(s.slice(a, b + 1));
    if (!['match', 'mismatch', 'unreadable'].includes(v.verdict)) return null;
    v.problems = Array.isArray(v.problems) ? v.problems : [];
    return v;
  } catch { return null; }
}

/** One check: returns { verdict, ... } or { verdict: 'error', error }. */
export async function checkInvoice({ client, config, request, invoice }) {
  try {
    const res = await client.beta.messages.create({
      model: config.model,
      max_tokens: 4000,
      system: INVOICE_RULES,
      messages: [{ role: 'user', content: buildInvoiceContent(request, invoice) }],
      output_config: { effort: config.effort || 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (res.stop_reason === 'refusal') return { verdict: 'error', error: 'refusal' };
    const v = parseVerdict(res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
    return v || { verdict: 'error', error: 'answer was not the expected JSON' };
  } catch (e) {
    return { verdict: 'error', error: String(e?.message || e) };
  }
}

const KIND = {
  missing: 'قلم جاافتاده', extra: 'قلم اضافه', code: 'کد اشتباه', size: 'اندازه اشتباه', quantity: 'مقدار اشتباه',
  price: 'قیمت اشتباه', total: 'جمع اشتباه', customer: 'نام مشتری', unreadable: 'ناخوانا',
};

/** The message for the information group, or null when the invoice matches (nothing is posted for a match). */
export function reportText(v, ctx) {
  if (v.verdict === 'match') return null;
  const lines = [];
  if (v.verdict === 'error') {
    lines.push('⚠️ بررسی فاکتور انجام نشد');
    lines.push(`گروه: ${ctx.groupName}`);
    if (ctx.invoiceFile) lines.push(`فایل فاکتور: ${ctx.invoiceFile}`);
    lines.push(`علت: ${v.error}`);
    return lines.join('\n');
  }
  lines.push(v.verdict === 'unreadable' ? '⚠️ فاکتور یا درخواست خوانا نبود' : '⚠️ فاکتور با درخواست مشتری نمی‌خواند');
  lines.push(`گروه: ${ctx.groupName}`);
  lines.push(`مشتری: ${v.request_customer || v.invoice_customer || ctx.customer || '—'}`);
  if (v.invoice_number) lines.push(`شمارهٔ فاکتور: ${v.invoice_number}`);
  if (ctx.invoiceSender) lines.push(`فاکتور را فرستاد: ${ctx.invoiceSender}`);
  lines.push('');
  v.problems.forEach((p, i) => {
    lines.push(`${i + 1}. ${KIND[p.kind] || p.kind}: ${p.item || '—'}`);
    if (p.requested || p.invoiced) lines.push(`   درخواست: ${p.requested || '—'} | فاکتور: ${p.invoiced || '—'}`);
    if (p.note) lines.push(`   ${p.note}`);
  });
  return lines.join('\n').trim();
}

/**
 * Per-group memory of the latest customer request, and the rule for which PDF is which.
 * A PDF from staff is an invoice; any other PDF is a request. The same file is never checked twice.
 */
export class InvoiceDesk {
  constructor({ maxAgeMs = 7 * 24 * 3600 * 1000 } = {}) {
    this.maxAgeMs = maxAgeMs;
    this.requests = new Map(); // groupId -> { doc, at }
    this.seen = new Set(); // file hashes already handled
  }

  /** [doc]: { hash, base64, fileName, senderName, staff }. Returns 'request' | 'duplicate' | 'no-request' | { request }. */
  take(groupId, doc, now = Date.now()) {
    if (this.seen.has(doc.hash)) return 'duplicate';
    this.seen.add(doc.hash);
    if (!doc.staff) { this.requests.set(groupId, { doc, at: now }); return 'request'; }
    const r = this.requests.get(groupId);
    if (!r || now - r.at > this.maxAgeMs) return 'no-request';
    return { request: r.doc };
  }
}
