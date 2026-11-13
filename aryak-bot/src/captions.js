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
const QTY_ONE = /(\d+(?:\.\d+)?)\s*(M|MTRS?|METERS?|METRES?|ROLLS?|PCS?|PIECES?)\b/i;
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
  if (!m) {
    // «Golden door 1810 3m + 215 edge 50m»: the customer first, then «code quantity» pairs joined by «+» (a word between code and quantity, like «edge», is a note)
    const seg = String.raw`(\d{2,5})(?:\s+([A-Za-z]+))?\s+(\d+(?:\.\d+)?)\s*(?:M|MTRS?|METERS?|METRES?)\b`;
    const cf = new RegExp(String.raw`^([\p{L}][\p{L} &.'-]{1,38}?)\s+${seg}((?:\s*\+\s*${seg})*)$`, 'iu').exec(s);
    if (cf) {
      const lines = [{ code: cf[2], quantity: num(cf[4]), unit: 'm', ...(cf[3] ? { note: cf[3].toLowerCase() } : {}) }];
      for (const x of String(cf[5] || '').matchAll(new RegExp(seg, 'giu'))) lines.push({ code: x[1], quantity: num(x[3]), unit: 'm', ...(x[2] ? { note: x[2].toLowerCase() } : {}) });
      return { kind: 'cut', code: lines[0].code, customer: title(cf[1]), quantity: lines[0].quantity, unit: 'm', lines };
    }
    // «303 6.4»: a code and a length, nobody named: not recorded; the owner is told once (the caller decides)
    const nc = /^(\d{2,5})(?:\s+([A-Z]))?\s+(\d+(?:\.\d+)?)\s*(?:M|MTRS?|METERS?|METRES?)?$/i.exec(s);
    if (nc) return { kind: 'no-customer', code: nc[2] ? nc[1] + ' ' + nc[2].toUpperCase() : nc[1], quantity: num(nc[3]), unit: 'm' };
  }
  if (!m) return /^[\p{L} &.'-]{3,40}$/u.test(s) && !/\b(ok|yes|no|thanks|hi|hello)\b/i.test(s) ? { kind: 'name', customer: title(s) } : null;
  const code = m[2] ? `${m[1]} ${m[2].toUpperCase()}` : m[1];
  let rest = m[3];
  let quantity = null;
  let pieces;
  let unit = 'm';
  let invoiceQuantity;
  // WhatsApp text can lose the plus: «1510=25M» is 15+10=25M, «2572.6=97.6M» is 25+72.6=97.6M (a split of the digits whose parts add up to the total)
  rest = rest.replace(/(?<![0-9.])(\d[0-9.]{1,12}\d)\s*=\s*(INVOICED?\s*)?(\d+(?:\.\d+)?)(?![0-9])/i, (all, digits, inv, total) => {
    let near = '';
    for (let k = 1; k < digits.length; k++) {
      const a = digits.slice(0, k); const b = digits.slice(k);
      if (a.endsWith('.') || b.startsWith('.') || a[0] === '0' && !a.startsWith('0.') || b[0] === '0' && !b.startsWith('0.') || (a.match(/\./g) || []).length > 1 || (b.match(/\./g) || []).length > 1) continue;
      if (Math.abs(Number(a) + Number(b) - Number(total)) < 0.0005) return a + '+' + b + '=' + (inv || '') + total;
      // the writer's own slip in adding («72.6+25.6=97.6M» is 98.2): two decimal parts whose sum is within a metre of the total still read as the two parts, the total as written
      if (!near && a.includes('.') && b.includes('.') && Math.abs(Number(a) + Number(b) - Number(total)) <= 1) near = a + '+' + b + '=' + (inv || '') + total;
    }
    return near || all;
  });
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
    if (q) { quantity = num(q[1]); unit = /^roll/i.test(q[2]) ? 'roll' : /^(pc|piece)/i.test(q[2]) ? 'pcs' : 'm'; rest = rest.replace(q[0], ' '); } // «2 PCS» is two pieces, never two metres
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
    const x = /^(.*?)\s*(\d+(?:\.\d+)?)\s*(ROLLS?|M|MTRS?|METERS?|PCS?|SMPL|SAMPLES?)\b(?:\s+WITH\b.*)?\s*$/i.exec(title(part)); // «2 ROLLS WITH CATALOG»: what goes along is not part of the count
    if (x) return { customer: title(x[1]), quantity: num(x[2]), unit: /^roll/i.test(x[3]) ? 'roll' : /^(smpl|sample)/i.test(x[3]) ? 'sample' : /^pc/i.test(x[3]) ? 'pcs' : 'm' };
    const name = title(part);
    return name ? { customer: name } : null;
  }).filter(Boolean);
  const by = status === 'picked-up' ? s.slice(cut).replace(/^PICKED\s*UP\s*(?:BY\s*)?/i, '').replace(/[.\s]+$/, '').trim() : '';
  return { customers, cod: null, status, ...(by ? { by } : {}) };
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
  return String(name || '').replace(/(?<![\p{L}])(?:نقد|نقدی|از|درهم|دریافت|شد|شده|واریز|حواله|انتقال|بانکی|چک|پرداخت|پول|مبلغ|به|حساب|دادند|داد|گرفتیم|گرفتم|تومن|فاکتور)(?![\p{L}])/gu, ' ').replace(/\bBY\b.*$/i, ' ').replace(/\b(AED|OMR|USD|SAR|EUR|GBP|QAR|KWD|BHD|INR|DHS?|CASH|CHE+A?QUES?|CHEQ|CHQS?|CHECKS?|PDC|TRANSFER(?:RED)?|BANK|ONLINE|WIRE|IPP|AANI|DEPOSIT(?:ED)?|NAQD|RECEIVED?|PAID|FROM|PAYMENTS?|PAY|RECEIPTS?|CLEAR(?:ED)?|INV(?:OICES?)?|SLIP|TT|NO)\b/gi, ' ').replace(/[=/.]+/g, ' ').replace(/^[\s+&-]+|[\s+&-]+$/g, '').replace(/\s*\+\s*(?=\+|$)/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True when the words of a message say it is a cheque (cheque, cheaque, chq, check, شيك, چک). */
export const CHEQUE_WORDS = /\bche+a?ques?\b|\bcheq\b|\bchqs?\b|\bchecks?\b|\bpdc\b|شيك|شیک|چک/i;
/** The words of a bank transfer (transfer, bank, TT, IPP, Aani, deposit, online, wire, حواله, واریز, انتقال): such a payment is a transfer, not cash. */
export const TRANSFER_WORDS = /\btransfer(?:red)?\b|\bbank\b|\btt\b|\bipp\b|\baani\b|\bdeposit(?:ed)?\b|\bonline\b|\bwire\b|حواله|واریز|انتقال/i;
const FOREIGN = /\b(OMR|USD|SAR|EUR|GBP|QAR|KWD|BHD|INR)\b/i;

export function parsePaymentCaption(text) {
  const s0 = clean(text);
  if (!s0) return null;
  if (isEstimateText(s0)) return null; // an estimate, a quotation or an offer is never a payment
  const s = s0.replace(/(?<![A-Za-z0-9])\d+(?:\.d+)?\s*(?:PCS?|PIECES?)\b/gi, ' ').replace(/\s+/g, ' ').trim(); // «4PC» is a count of pieces, never an amount
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
  let work = noInv; let currency = ''; let foreign = null; let eqPair = null; let aedAfterEquals = false;
  const fc = FOREIGN.exec(work);
  if (fc) {
    const code = fc[1].toUpperCase();
    // «60 ... OMR = 567»: the sum in the foreign currency and, after the equals sign, what it is in AED (the AED figure is the amount, the foreign one is kept beside it)
    const eq = new RegExp(`\\b${code}\\s*=\\s*(\\d[\\d,]*(?:\\.\\d+)?)`, 'i').exec(work);
    if (eq) {
      const without = `${work.slice(0, eq.index)} ${work.slice(eq.index + eq[0].length)}`;
      const other = AMOUNT.exec(without);
      if (other) { eqPair = { aed: num(eq[1]), foreign: { amount: num(other[1]), currency: code } }; work = `${without.slice(0, other.index)} ${without.slice(other.index + other[0].length)}`; }
      else { work = `${work.slice(0, eq.index)} ${eq[1]} ${work.slice(eq.index + eq[0].length)}`; aedAfterEquals = true; } // «OMR = 567» alone: the figure after the equals sign is the AED sum
    }
    const near = eqPair ? null : new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*${code}\\b`, 'i').exec(work) || new RegExp(`\\b${code}\\s*[=:]?\\s*(\\d[\\d,]*(?:\\.\\d+)?)`, 'i').exec(work);
    if (near) { foreign = { amount: num(near[1]), currency: code }; work = `${work.slice(0, near.index)} ${work.slice(near.index + near[0].length)}`; }
    if (!aedAfterEquals) currency = code;
  }
  const cheque = CHEQUE_WORDS.test(work);
  const transfer = !cheque && TRANSFER_WORDS.test(work); // «transfer», «bank transfer from ...», «TT»: money by the bank, never cash
  // «dated 20/11», «due 20-11-2026», «on 20/11»: the date of a cheque (or of a promised payment); it leaves the name and is kept as the date
  let chequeDay = '';
  work = work.replace(/(?:\b(?:dated?|due(?:\s+on)?|on|for|date)\s*[:=]?\s*)?(?<![\d.\/-])(\d{1,2})\s*[\/-]\s*(\d{1,2})(?:\s*[\/-]\s*(\d{2,4}))?(?![\d\/-])/gi, (all, d, m, y) => {
    if (!(Number(d) >= 1 && Number(d) <= 31 && Number(m) >= 1 && Number(m) <= 12)) return all;
    if (!cheque && !/^(?:dated?|due|on|for|date)/i.test(all)) return all; // a bare fraction in a plain payment is left alone
    const now = new Date(); const year = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : now.getUTCFullYear();
    chequeDay = year + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); return ' ';
  }).replace(/\b(?:dated?|due)\b/gi, ' ').replace(/\s+/g, ' ').trim();
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
    .replace(/(?<![\p{L}])(?:نقد|نقدی|از|درهم|دریافت|شد|شده|واریز|حواله|انتقال|بانکی|چک|پرداخت|پول|مبلغ|به|حساب|دادند|داد|گرفتیم|گرفتم|تومن|فاکتور)(?![\p{L}])/gu, ' ')
    .replace(/\b(AED|OMR|USD|SAR|EUR|GBP|QAR|KWD|BHD|INR|DHS?|CASH|CHE+A?QUES?|CHEQ|CHQS?|CHECKS?|PDC|TRANSFER(?:RED)?|BANK|ONLINE|WIRE|IPP|AANI|DEPOSIT(?:ED)?|NAQD|RECEIVED?|PAID|FROM|PAYMENT|PAYMENTS|PAY|RECEIPTS?|CLEAR(?:ED)?|INV(?:OICES?)?|SLIP|TT|NO)\b/gi, ' ')
    .replace(/[=\/.]+/g, ' ');
  const customers = rest.split(/\s*(?:\+|&|\band\b)\s*/i).map((x) => title(x.replace(/\s+/g, ' '))).filter((x) => /\p{L}{2,}/u.test(x));
  return { kind: 'cash', amount, customers, ...(foreign && !a ? { currency: foreign.currency } : {}), ...(foreign && a ? { foreign } : {}), ...(eqPair ? { foreign: eqPair.foreign } : {}), ...(cheque ? { cheque: true } : {}), ...(transfer ? { transfer: true } : {}), ...(chequeDay ? { chequeDate: chequeDay } : {}), ...(invoices.length ? { invoices } : {}), ...(/^clear(?:ed)?\b/i.test(s) ? { cleared: true } : {}) };
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

/** A short message that says «cancel» («cancel», «cancelled», «canceled», «cancel order», «كنسل», «کنسل», «لغو», «إلغاء»): used on a quote-reply to a cut post, which it then cancels. */
export function isCancelText(text) {
  const t = String(text || '').normalize('NFKC').replace(/[*_~]+/g, ' ').trim();
  if (!t || t.length > 60) return false;
  return /(?:^|[\s,.:;!؟?()-])(?:cancel(?:l?ed)?(?:\s+order)?|[كک]نسل(?:\s*(?:شد|شده))?|لغو(?:\s*(?:شد|شده))?|إلغاء|الغاء)(?=$|[\s,.:;!؟?()-])/iu.test(t);
}

/** A text that is an estimate / quotation / offer / proforma (never a payment). */
/** A post that ENDS with a star («Cash from X 3000 *», «★», «⭐», «**»): the money needs no invoice. */
export const STAR_END = /\s*(?:\*+|★|⭐\uFE0F?)+\s*$/u;
export const isStarred = (text) => STAR_END.test(String(text || '').trim()) && String(text || '').replace(STAR_END, '').trim() !== '';
export const isEstimateText = (text) => /(?:^|[^A-Za-z])(?:estimates?|quotations?|quote|offer|pro-?forma)(?![A-Za-z])|پیش‌?فاکتور|پیشنهاد قیمت|برآورد/i.test(String(text || ''));

const FILLER = new Set(['plz', 'pls', 'please', 'kindly', 'also', 'this', 'that', 'these', 'those', 'it', 'them', 'same', 'too', 'one', 'the', 'and', 'clear', 'cleared', 'clearing', 'done', 'ok', 'okay', 'yes', 'thanks', 'thank', 'you', 'confirm', 'confirmed', 'received', 'noted']);
/** A reply that only says «please clear it», «also this», «done»: filler words, no name, no figure. Never a customer name and never a payment. */
export function isReplyFiller(text) {
  const words = String(text || '').toLowerCase().replace(/[^a-z\u0600-\u06ff ]+/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length || /[0-9۰-۹٠-٩]/.test(String(text || ''))) return false;
  return words.every((w) => FILLER.has(w));
}
/** True when the reply asks for the quoted payment to be cleared («plz clear it», «cleared», «done»). */
export const isClearReply = (text) => isReplyFiller(text) && /(?:^|[^a-z])(?:clear|cleared|clearing|done|confirmed?)(?![a-z])/i.test(String(text || ''));
/** A customer name as opposed to filler: it has a letter word outside the filler list. */
export const looksLikeName = (text) => !isReplyFiller(text) && /[A-Za-z\u0600-\u06ff]{2,}/.test(String(text || ''));
