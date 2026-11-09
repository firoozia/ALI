// Payment evidence posted in the Confirmation group: a bank receipt, a cheque deposit slip or a transfer advice (a PDF), and a reply to it that says which customer and
// which invoice it is for. This module reads the TEXT of such a document (free: the text layer of the PDF) and joins it with the words of the reply into ONE payment entry.
// Read only: nothing here writes anywhere.

const NUM = String.raw`\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
const toNumber = (s) => Number(String(s).replace(/,/g, ''));
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

/** What kind of document it is, in a word the report can show. */
function kindOf(text) {
  if (/\bche(?:que|ck)\b/i.test(text)) return 'cheque';
  if (/\bdeposit\b/i.test(text)) return 'deposit slip';
  if (/\b(?:transfer|remittance|swift|iban|ipp|wps|credit advice)\b/i.test(text)) return 'transfer receipt';
  return 'receipt';
}

function dateOf(text) {
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/.exec(text))) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`; // day first, as in the UAE
  if ((m = /\b(\d{1,2})\s+([A-Za-z]{3,4})[a-z]*\.?,?\s+(\d{4})\b/.exec(text)) && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
  return '';
}

/**
 * The text of a payment document -> { amount, date, payer, receipt, invoices } or null when no amount can be read. The amount is the one that follows a word like «amount» or
 * «AED» (or precedes «AED»), else the largest number with decimals. An invoice number after «inv», «invoice» or «فاکتور» is an invoice number, never an amount.
 */
export function parseReceiptText(text) {
  const t = String(text || '').replace(/\r/g, '');
  if (!t.trim()) return null;
  const invoices = [...t.matchAll(/(?:\binv(?:oice)?s?\b|فاکتور)\.?\s*(?:no\.?|number|#)?\s*[-:#]?\s*(\d{3,6})\b/gi)].map((m) => `inv-${m[1]}`);
  const body = t.replace(/(?:\binv(?:oice)?s?\b|فاکتور)\.?\s*(?:no\.?|number|#)?\s*[-:#]?\s*\d{3,6}\b/gi, ' ');
  let amount = 0;
  const labeled = new RegExp(String.raw`(?:amount|total|credit(?:ed)?|debit(?:ed)?|value|sum|aed|dhs?)\s*[:=-]?\s*(?:aed|dhs?)?\s*(${NUM})`, 'i').exec(body);
  const after = new RegExp(String.raw`(${NUM})\s*(?:aed|dhs?)\b`, 'i').exec(body);
  if (labeled && toNumber(labeled[1]) > 0) amount = toNumber(labeled[1]);
  else if (after && toNumber(after[1]) > 0) amount = toNumber(after[1]);
  else { const all = [...body.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{3})*\.\d{2})(?![\d])/g)].map((m) => toNumber(m[1])); if (all.length) amount = Math.max(...all); }
  if (!(amount > 0)) return null;
  const who = /(?:payer|sender|from|ordering customer|remitter|customer name|account name|depositor)\s*[:\-]\s*([A-Za-z][A-Za-z &.'-]{2,60})/i.exec(body);
  const payer = who ? who[1].replace(/\s+/g, ' ').replace(/\s+(?:account|iban|ref(?:erence)?|date|amount|aed)\b.*$/i, '').trim() : '';
  return { amount, date: dateOf(body), payer, receipt: kindOf(body), invoices: [...new Set(invoices)] };
}

/**
 * One payment entry from the document (or the quoted message) and the reply's own words. The document gives the amount, the date and the kind; the reply gives the customer and the
 * invoice numbers (and wins on those); an amount is taken from the reply only when the document has none. [base]: { amount, paidOn, receipt, payer, source }, [reply]: an event from the caption.
 */
export function mergePayment(base = {}, reply = {}) {
  const invoices = [...new Set([...(base.invoices || []), ...(reply.invoices || [])])];
  const customer = reply.customer || base.customer || base.payer || '';
  const amount = Number(base.amount) > 0 ? Number(base.amount) : Number(reply.amount) > 0 ? Number(reply.amount) : 0;
  const out = { type: 'payment', kind: reply.kind && reply.kind !== 'cash' ? reply.kind : base.receipt === 'cheque' ? 'cheque' : base.receipt ? 'transfer' : reply.kind || 'cash', currency: base.currency || reply.currency || 'AED', lines: [], customer, amount };
  if (base.receipt) out.receipt = base.receipt;
  if (base.source) out.source = base.source;
  if (base.paidOn) out.paidOn = base.paidOn;
  if (invoices.length) out.invoices = invoices;
  if (!customer) out.pendingName = true;
  if (reply.multi) out.multi = true;
  if (amount === 0) out.noAmount = true;
  return out;
}
