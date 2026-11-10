// The shapes of the real captions and papers of the company, read without a model: the cut group ("ART NO 410 DANDY DOOR 6M"),
// the delivery group ("PVC WORKS (COD 908.25)"), the money group ("<customer> <amount> received"), the goods groups
// ("HINGES TYPE A 20 BOX FOR SHJ CUSTOMER"), invoice and purchase-order lines. Pure functions: they read text and return
// plain data (never a name of a courier, never a bank detail). What they cannot read they return as null, and the model reads it.

import { normalizeDigits } from './text.js';
import { dropAttention, productCode } from './codes.js';

const clean = (s) => dropAttention(normalizeDigits(String(s || ''))).replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();
const num = (s) => Number(String(s).replace(/,/g, ''));
const title = (s) => s.replace(/[\s.,;:\-]+$/g, '').replace(/^[\s.,;:\-]+/g, '').trim();

// ---- cut group -------------------------------------------------------------------------------------------------------------
const UNIT = String.raw`(?:M|MTRS?|METERS?|METRES?)`;
// pieces added up: «18+12 = 30M», «6+3.5+3.2+2.7= INVOICE 14.5M» (the number after INVOICE is what was invoiced); the total after «=» and the unit are optional
const QTY_PIECES = new RegExp(String.raw`(\d+(?:\.\d+)?(?:\s*\+\s*\d+(?:\.\d+)?)+)\s*(?:=\s*(INVOICED?\s*)?(\d+(?:\.\d+)?)\s*)?(?:${UNIT}\b)?`, 'i');
const QTY_TIMES = new RegExp(String.raw`(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+)\s*(?:${UNIT}\b)?`, 'i'); // «1.8×2»: two pieces of 1.8
const QTY_ONE = /(\d+(?:\.\d+)?)\s*(M|MTRS?|METERS?|METRES?|ROLLS?)\b/i;
const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * "ART NO 410 DANDY DOOR 6M" -> { kind: 'cut', code: '410', customer: 'DANDY DOOR', quantity: 6, unit: 'm' }.
 * "ART NO 108 C PVC WORKS 40M": a letter after the number is part of the code ("108 C" is a variant). "18+12 = 30M": two pieces.
 * "ART NO 303 120M FOR CUT." is a full roll opened inside the company: kind 'open-roll', not a sale. "... DAMAGED PIECE":
 * kind 'damage'. A bare name (and nothing else) is { kind: 'name' }. null for anything else.
 */
export function parseCutCaption(text) {
  const s = clean(text);
  if (!s) return null;
  const m = /^ART\.?\s*NO\.?\s*(\d{2,5})(?:\s+([A-Z])(?=\s|$))?\s*(.*)$/i.exec(s);
  if (!m) return /^[\p{L} &.'-]{3,40}$/u.test(s) && !/\b(ok|yes|no|thanks|hi|hello)\b/i.test(s) ? { kind: 'name', customer: title(s) } : null;
  const code = m[2] ? `${m[1]} ${m[2].toUpperCase()}` : m[1];
  let rest = m[3];
  let quantity = null;
  let pieces;
  let unit = 'm';
  let invoiceQuantity;
  const p = QTY_PIECES.exec(rest);
  const t = p ? null : QTY_TIMES.exec(rest);
  if (p) {
    pieces = p[1].split('+').map((x) => num(x));
    const sum = round3(pieces.reduce((a, b) => a + b, 0));
    if (p[2] && p[3]) { quantity = sum; invoiceQuantity = num(p[3]); } // «= INVOICE 14.5M»: the cut is the sum, 14.5 is what the office invoices
    else quantity = p[3] ? num(p[3]) : sum;
    rest = rest.replace(p[0], ' ');
  } else if (t) {
    const each = num(t[1]); const n = Number(t[2]);
    pieces = Array.from({ length: n }, () => each); quantity = round3(each * n);
    rest = rest.replace(t[0], ' ');
  } else {
    const q = QTY_ONE.exec(rest);
    if (q) { quantity = num(q[1]); unit = /^roll/i.test(q[2]) ? 'roll' : 'm'; rest = rest.replace(q[0], ' '); }
  }
  const internal = /\bFOR\s+CUT(?:TING)?\b/i.test(rest);
  const damaged = /\bDAMAG\w*/i.test(rest);
  const note = /\s+(?:\bBD\b|\bB\.D\b|\bREPAIR\w*|\bRETURN\w*|\bREPLACE\w*|\bFREE\b|\bSAMPLE\w*|\bEXTRA\b|\bOK\b)\b.*$/i; // a note after the customer's name («BD REPAIRED») is not part of it
  const customer = title(rest.replace(note, '').replace(/\bFOR\s+CUT(?:TING)?\b/gi, ' ').replace(/\bDAMAG\w*(?:\s+PIECES?)?/gi, ' ').replace(/\bPIECES?\b/gi, ' ').replace(/\s+/g, ' '));
  const base = { code, customer, quantity, unit, ...(pieces ? { pieces } : {}), ...(invoiceQuantity !== undefined ? { invoiceQuantity } : {}) };
  if (internal) return { ...base, kind: 'open-roll', customer: '' };
  if (damaged) return { ...base, kind: 'damage' };
  return { ...base, kind: 'cut' };
}

// ---- delivery group --------------------------------------------------------------------------------------------------------
const STATUS = [[/\bPICKED\s*UP\b/i, 'picked-up'], [/\bDISPATCHED\b/i, 'dispatched'], [/\bDELIVERED\b/i, 'delivered']];

/**
 * "PVC WORKS (COD 908.25)" -> { customers: [{ customer: 'PVC WORKS' }], cod: 908.25 }.
 * "MUNICH DOOR KITCHEN 1 ROLL, DESIGNER WOOD 1 ROLL & DANDY DOOR 1 ROLL PICKED UP BY <courier>" -> several customers, status
 * 'picked-up' (the courier's name is dropped). "<customer> delivered" -> status 'delivered'. null when it is none of these.
 */
export function parseDeliveryCaption(text) {
  const s = clean(text);
  if (!s) return null;
  const cod = /^(.*?)\s*\(\s*COD\s*:?\s*([\d,]+(?:\.\d+)?)\s*\)/i.exec(s);
  if (cod) return { customers: [{ customer: title(cod[1]) }], cod: num(cod[2]), status: null };
  let status = null;
  let cut = s.length;
  for (const [re, name] of STATUS) { const x = re.exec(s); if (x && x.index < cut) { cut = x.index; status = name; } }
  if (!status) return null;
  const head = s.slice(0, cut).replace(/\bAND\b/gi, '&');
  const customers = head.split(/[,&]/).map((part) => {
    const x = /^(.*?)\s*(\d+(?:\.\d+)?)\s*(ROLLS?|M|MTRS?|METERS?|PCS?|SMPL|SAMPLES?)\s*$/i.exec(title(part));
    if (x) return { customer: title(x[1]), quantity: num(x[2]), unit: /^roll/i.test(x[3]) ? 'roll' : /^(smpl|sample)/i.test(x[3]) ? 'sample' : /^pc/i.test(x[3]) ? 'pcs' : 'm' };
    const name = title(part);
    return name ? { customer: name } : null;
  }).filter(Boolean);
  return { customers, cod: null, status };
}

/**
 * The cash on delivery against the invoices still open: the amount should be the total of one invoice or of a few together
 * (908.25 = 865 + 5 %). [totals]: the open invoices' totals. Returns the indexes that add up, or null.
 */
export function matchCod(amount, totals, tol = 0.05) {
  const a = Number(amount);
  const t = totals.map(Number);
  if (!(a > 0) || !t.length) return null;
  const pick = (start, left, sum, chosen) => {
    if (Math.abs(sum - a) <= tol && chosen.length) return chosen;
    if (!left || sum > a + tol) return null;
    for (let i = start; i < t.length; i++) { const r = pick(i + 1, left - 1, sum + t[i], [...chosen, i]); if (r) return r; }
    return null;
  };
  return pick(0, 4, 0, []);
}

// ---- money group -----------------------------------------------------------------------------------------------------------
const AMOUNT = /(?:^|[^\d.,])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\d,]*\d)/;

/**
 * The reply that closes an item ("CLEARED", "cleared", "CLEARED TWO CUSTOMER") -> { kind: 'cleared' }.
 * "clear inv 9808 / 9809" -> { kind: 'clear-invoices', invoices: ['inv-9808', 'inv-9809'] }.
 * A forwarded bank SMS -> { kind: 'bank-credit', amount } (no account number is kept).
 * "<amount> <customer>", "<amount> from <customer>", "<customer> <amount> Received [BY <courier>]", "<amount> cash received from
 * <customer>", "cash from a + b" -> { kind: 'cash', amount, customers: [...] }; an expense ("sell car") -> { kind: 'expense' }.
 */
/** The words of a payment message that are never a customer («cash», «clear», «receipt», «inv», «pay» …) taken out of a name; '' when nothing is left. */
export function stripPaymentWords(name) {
  return String(name || '').replace(/\bBY\b.*$/i, ' ').replace(/\b(AED|OMR|USD|SAR|EUR|GBP|QAR|KWD|BHD|INR|DHS?|CASH|CHE+A?QUES?|CHEQ|CHQS?|CHECKS?|TRANSFER|RECEIVED?|PAID|FROM|PAYMENTS?|PAY|RECEIPTS?|CLEAR(?:ED)?|INV(?:OICES?)?|SLIP|TT|NO)\b/gi, ' ').replace(/[=/.]+/g, ' ').replace(/^[\s+&-]+|[\s+&-]+$/g, '').replace(/\s*\+\s*(?=\+|$)/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True when the words of a message say it is a cheque (cheque, cheaque, chq, check, شيك, چک). */
export const CHEQUE_WORDS = /\bche+a?ques?\b|\bcheq\b|\bchqs?\b|\bchecks?\b|شيك|شیک|چک/i;
const FOREIGN = /\b(OMR|USD|SAR|EUR|GBP|QAR|KWD|BHD|INR)\b/i;

export function parsePaymentCaption(text) {
  const s = clean(text);
  if (!s) return null;
  const INV_NO = /(?:\binv(?:oice)?s?\b|فاکتور)\.?\s*(?:no\.?|number|#|شماره)?\s*[-:#]?\s*\d{3,6}/i;
  if (/^cleared?\b(?!\s+inv)/i.test(s) && !INV_NO.test(s)) return { kind: 'cleared' }; // with an invoice number it is a payment message («clear MUNICH DOOR KITCHEN inv 9940»), below
  const ci = /^clear\s+inv(?:oices?)?\.?\s*([\d\s/,&-]+)$/i.exec(s);
  if (ci) return { kind: 'clear-invoices', invoices: ci[1].split(/[\s/,&-]+/).filter(Boolean).map((n) => `inv-${n}`) };
  const bank = /\bis\s+credited\s+with\s+AED\s*([\d,]+(?:\.\d+)?)/i.exec(s);
  if (bank) { // a name written after the amount («… credited with AED 197.93 for AR RAD») is kept; the account number never is
    const who = /(?:\bfor\b|\bfrom\b)\s+([A-Za-z][A-Za-z &.'-]{2,40})\s*$/i.exec(s.slice(bank.index + bank[0].length));
    return { kind: 'bank-credit', amount: num(bank[1]), ...(who ? { customer: title(who[1]) } : {}) };
  }
  if (/\b(sell(?:ing)?\s+car|expense|petrol|salary)\b/i.test(s)) return { kind: 'expense' };
  // «inv 9940», «invoice no 9940», «inv-9940», «فاکتور ۹۹۴۰»: an INVOICE NUMBER (or a run of them: «inv 9808 / 9809»), never an amount; it is taken out before the amount is looked for
  const invoices = [];
  const INV = /(?:\binv(?:oice)?s?\b|فاکتور)\.?\s*(?:no\.?|number|#|شماره)?\s*[-:#]?\s*(\d{3,6}(?:\s*[/,&]\s*\d{3,6})*)/gi;
  const noInv = s.replace(INV, (m, run) => { for (const n of run.split(/[\s/,&]+/).filter(Boolean)) invoices.push(`inv-${n}`); return ' '; }).replace(/\s+/g, ' ').trim();
  // a foreign currency («AL AFEEFI KITCHEN OMR = 567»): its amount is the one next to the code; an amount in AED written as well wins as the amount, the foreign one is kept beside it
  let work = noInv; let currency = ''; let foreign = null; let eqPair = null;
  const fc = FOREIGN.exec(work);
  if (fc) {
    const code = fc[1].toUpperCase();
    // «60 ... OMR = 567»: the sum in the foreign currency and, after the equals sign, what it is in AED (the AED figure is the amount, the foreign one is kept beside it)
    const eq = new RegExp(`\\b${code}\\s*=\\s*(\\d[\\d,]*(?:\\.\\d+)?)`, 'i').exec(work);
    if (eq) {
      const without = `${work.slice(0, eq.index)} ${work.slice(eq.index + eq[0].length)}`;
      const other = AMOUNT.exec(without);
      if (other) { eqPair = { aed: num(eq[1]), foreign: { amount: num(other[1]), currency: code } }; work = `${without.slice(0, other.index)} ${without.slice(other.index + other[0].length)}`; }
    }
    const near = eqPair ? null : new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*${code}\\b`, 'i').exec(work) || new RegExp(`\\b${code}\\s*[=:]?\\s*(\\d[\\d,]*(?:\\.\\d+)?)`, 'i').exec(work);
    if (near) { foreign = { amount: num(near[1]), currency: code }; work = `${work.slice(0, near.index)} ${work.slice(near.index + near[0].length)}`; }
    currency = code;
  }
  const cheque = CHEQUE_WORDS.test(work);
  const a = AMOUNT.exec(work);
  if (invoices.length && !a) { // a message about an invoice only («Munich door kitchen inv 9940»): the customer and the invoice, the amount comes from the document it replies to
    const rest0 = stripPaymentWords(work);
    const names = rest0.split(/\s*(?:\+|&|\band\b)\s*/i).map((x) => title(x.replace(/\s+/g, ' '))).filter((x) => /\p{L}{2,}/u.test(x));
    return { kind: 'cash', amount: 0, customers: names, invoices, ...(/^clear(?:ed)?\b/i.test(s) ? { cleared: true } : {}) };
  }
  if (!a && !foreign && !eqPair) { // no amount: a bare name (it may belong to the payment next to it); a message made only of payment words is no name
    if (!/^[\p{L} &.'+-]{3,40}$/u.test(s)) return null;
    const bare = stripPaymentWords(s).replace(/(?:^|\s)(?:and|\+|&)(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
    return /\p{L}{2,}/u.test(bare) ? { kind: 'name', customer: title(bare) } : null;
  }
  const aed = eqPair ? eqPair.aed : a ? num(a[1]) : 0;
  const amount = foreign && !a ? foreign.amount : aed;
  if (!(amount > 0)) return null;
  let rest = (work.slice(0, a ? a.index : 0) + ' ' + (a ? work.slice(a.index + a[0].length) : work))
    .replace(/\bBY\b.*$/i, ' ') // "RECEIVED BY <courier>": the courier is not a customer
    .replace(/\b(AED|OMR|USD|SAR|EUR|GBP|QAR|KWD|BHD|INR|DHS?|CASH|CHE+A?QUES?|CHEQ|CHQS?|CHECKS?|TRANSFER|RECEIVED?|PAID|FROM|PAYMENT|PAYMENTS|PAY|RECEIPTS?|CLEAR(?:ED)?|INV(?:OICES?)?|SLIP|TT|NO)\b/gi, ' ')
    .replace(/[=\/.]+/g, ' ');
  const customers = rest.split(/\s*(?:\+|&|\band\b)\s*/i).map((x) => title(x.replace(/\s+/g, ' '))).filter((x) => /\p{L}{2,}/u.test(x));
  return { kind: 'cash', amount, customers, ...(foreign && !a ? { currency: foreign.currency } : {}), ...(foreign && a ? { foreign } : {}), ...(eqPair ? { foreign: eqPair.foreign } : {}), ...(cheque ? { cheque: true } : {}), ...(invoices.length ? { invoices } : {}), ...(/^clear(?:ed)?\b/i.test(s) ? { cleared: true } : {}) };
}

// ---- goods groups (accessories, saw blades, glue) --------------------------------------------------------------------------
const GOODS_UNIT = [[/^box(?:es)?$/i, 'box'], [/^(?:nos?|pcs?|pieces?)$/i, 'pcs'], [/^gall?[eo]ns?$/i, 'gallon'], [/^bags?$/i, 'bag'], [/^cartons?$/i, 'carton']];
const GOODS_RE = /(\d+(?:\.\d+)?)\s*(box(?:es)?|nos?|pcs?|pieces?|gall?[eo]ns?|bags?|cartons?)\b/i;
const GLUE = [[/\b(?:jowat|juwat|jouat|jovat)\b/gi, 'JOWAT'], [/\b(?:gillu|gilu|glue|gloo)\b/gi, 'GLUE']];

/**
 * "HINGES TYPE A 20 BOX FOR SHJ CUSTOMER" -> { kind: 'goods', item: 'HINGES TYPE A', quantity: 20, unit: 'box', customer: 'SHJ CUSTOMER' }.
 * "JUWAT 10 GALLEN RECEIVED", "250 Bags Received" -> kind 'received' (stock arriving, not a sale). null when no quantity with a unit.
 */
export function parseGoodsCaption(text) {
  const s = clean(text);
  const q = GOODS_RE.exec(s);
  if (!q) return null;
  const unit = (GOODS_UNIT.find(([re]) => re.test(q[2])) || [0, q[2].toLowerCase()])[1];
  const received = /\bRECEIVED\b/i.test(s);
  const forM = /\bFOR\s+(.+)$/i.exec(s);
  let item = (s.slice(0, q.index) + ' ' + s.slice(q.index + q[0].length)).replace(/\bFOR\s+.+$/i, ' ').replace(/\bRECEIVED\b/gi, ' ');
  for (const [re, w] of GLUE) item = item.replace(re, w);
  item = title(item.replace(/\s+/g, ' '));
  item = item.replace(/\s+(?:from)\s*$/i, '').trim();
  return { kind: received ? 'received' : 'goods', item, quantity: num(q[1]), unit, customer: received || !forM ? '' : title(forM[1]) };
}

// ---- invoices and purchase orders ------------------------------------------------------------------------------------------
/**
 * The product code of an invoice line item: "PVC FILM107" -> "107", "PVC 1806" -> "1806", "KG10-300" stays, a letter variant
 * ("108 C") stays whole. Also the ARYAK prefix ("108 ARYAK", "AR102") is removed.
 */
export const codeFromItem = (item) => productCode(item);

/** "108 C" -> { base: '108', letter: 'C' }: a variant of 108, to be confirmed with a colleague, never a hard error. */
export function variantOf(code) {
  const m = /^(\d{2,5})\s?([A-Z])$/i.exec(String(code || '').trim());
  return m ? { base: m[1], letter: m[2].toUpperCase() } : null;
}

/**
 * The file name of an invoice document: "Invoice inv-9903 dandy.pdf" -> { number: 'inv-9903', customer: 'dandy', extra: '' };
 * "inv-8216 nuqoosh 309 11 rolls" -> customer 'nuqoosh', extra '309 11 rolls'; "Invoice inv-9063 (1).pdf" is the same invoice
 * (a forward), so the "(1)" is dropped.
 */
export function invoiceFileInfo(fileName) {
  const s = clean(fileName).replace(/\.pdf$/i, '').replace(/\(\d+\)\s*$/, '').replace(/^invoice\s+/i, '').trim();
  const m = /^(inv[- ]?\d+)\s*(.*)$/i.exec(s);
  if (!m) return null;
  const [name, ...tail] = m[2].split(/\s+(?=\d)/);
  return { number: m[1].toLowerCase().replace(/\s/, '-'), customer: title(name || ''), extra: tail.join(' ') };
}

/** "Invoice inv-9910 delete this one for X" -> "inv-9910": a deleted number is a legitimate gap, not an error. */
export function deletedInvoice(text) {
  const m = /\binv[- ]?(\d+)\b[^\n]*\bdelete\b|\bdelete\b[^\n]*\binv[- ]?(\d+)\b/i.exec(clean(text));
  return m ? `inv-${m[1] || m[2]}` : null;
}

/** A UAE tax registration number has 15 digits: a shorter or longer one is a note. '' when fine or absent. */
export function trnNote(trn) {
  const d = normalizeDigits(String(trn || '')).replace(/\D/g, '');
  return d && d.length !== 15 ? `شمارهٔ مالیاتی مشتری ${d.length} رقم دارد و باید 15 رقم باشد` : '';
}

/** A purchase-order line whose description holds a size ("25KG") against a quantity in the same unit that is smaller. */
export function unitConflict(description, quantity, uom) {
  const d = /(\d+(?:\.\d+)?)\s*(kg|kilo|l|ltr|litre|liter)\b/i.exec(String(description || ''));
  const u = String(uom || '').toLowerCase();
  if (!d || !(Number(quantity) > 0)) return '';
  const same = (/^kg|kilo/i.test(d[2]) && /^kilo|^kg/.test(u)) || (/^l/i.test(d[2]) && /^l(?:itre|iter|tr)?$/.test(u));
  return same && Number(quantity) < Number(d[1]) ? `توضیح کالا ${d[1]} ${d[2].toLowerCase()} است ولی مقدار ${quantity} با واحد ${uom} نوشته شده؛ باید روشن شود` : '';
}
