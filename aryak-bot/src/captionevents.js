// From a caption to tracker events, without a model, for the shapes the groups really use (see captions.js). Returns null
// when the caption is not one of them, so the model reads it instead.
//   { events: [...] }              events to record (type, customer, lines, ...), without time and ref
//   { cleared: true }              a reply that closes a money item
//   { clearInvoices: ['inv-1'] }   a reply that lists the invoices the money cleared
//   { ignore: true }               something to leave out (an expense)

import { cashOutKind, fromBoss } from './cashbox.js';
import { bankSmsAmount, collectedAmount, driverCashAmount, isBankSms, isGenericBankSms, isStockQuestion } from './paymentfix.js';
import { readMoneyShape, hasAmount } from './moneyshape.js';
import { stripPaymentWords } from './captions.js';
import { STAR_END, isStarred, parseCutCaption, parseDeliveryCaption, parseGoodsCaption, parsePaymentCaption } from './captions.js';

/** The assistant's own replies (live 16/11: a statement it sent was read as 1.00 AED cash). */
export const OWN_REPLY = /^\s*(?:🤖\s*)?(?:What is this amount for\?|Please write the amount with AED\b|Statement of account for\b|Statement\s+-\s|Invoice request for\b|Invoice #Q\d|Post #SP\d|Customer group\b|From whom\?|Done:\s)/i;

// ---- the accountant's rules for the Confirmation group (the owner, 16/11: «money is no place for mistakes: count only what is clearly a
// payment or a receipt, ask about anything that is not clear»). A message counts as money received only when it says so.
/** Words that say money came in (en, fa, ar). */
export const MONEY_WORDS = /\bcash\b|\brecei?ved?\b|\brcvd\b|\brecd\b|\bpaid\b|\bpayment\b|\bche+a?ques?\b|\bcheq\b|\bchqs?\b|\bpdc\b|\btransfer(?:red)?\b|\btt\b|\bbank\b|\bdeposit(?:ed)?\b|\bcredited\b|\bipp\b|\baani\b|\bclear(?:ed)?\b|نقد|دریافت|واریز|حواله|چک|پرداخت\s*(?:شد|کرد)|گرفتیم|گرفتم|استلم|استلمنا|استلام|نقدا|كاش|شيك|حوالة|تحويل|دفع/i;
/** A currency next to the amount: in this group «483 aed Alwan alsham» is how the staff write money received (the real rows). */
const CURRENCY = /\b(?:aed|dhs?|dirhams?)\b|درهم/i;
/** Not money received: a promise, a request, a balance, a price, an order (it is never counted, whatever amount it holds). */
const NOT_RECEIVED = /\bwill\b|\bshall\b|going to|\btomorrow\b|\blater\b|next (?:week|month)|\bpromise[sd]?\b|\bcollect\b|\bowes?\b|\bowing\b|\bbalance\b|\bremaining\b|\boutstanding\b|\bpending\b|\basked\b|\bprice\b|per (?:meter|mtr|m)\b|\bquotation\b|\boffer\b|\bhow much\b|فردا|میده|می‌دهد|میدهد|خواهد|باقی|مانده|بدهی|طلب|قیمت|بعدا|سيدفع|غدا|باقي|متبقي|سعر|بكرة/i;
/** Words that are never a customer's name (a reply, a thanks, an order word). */
export const FILLER_NAME = /^(?:done|ok|okay|noted|thanks?|thank you|thx|plz|please|plz clear it|clear it|also this|this|that|it|yes|no|sure|send|sent|check|confirm(?:ed)?|good|fine|received|بله|باشه|مرسی|ممنون|تمام|اوکی|ok شد|تم|شكرا|حاضر)(?:\s+(?:it|this|that|please|plz|done))*$/i;
/** A date alone («15/11 Zeta») holds no amount. */
const DATE = /(?<![\d.])\d{1,2}\s*[\/-]\s*\d{1,2}(?:\s*[\/-]\s*\d{2,4})?(?![\d.])/g;
/** An order or product line («410 - 4m», «check 603», «2 rolls 410»): codes and lengths, not money. */
const ORDER_LINE = /\b\d+(?:\.\d+)?\s*(?:m|mtr|mtrs|meters?|metres?|rolls?|pcs|pieces|sheets?)\b|^\s*(?:check|available|stock|colou?r|code)\b/i;

/** Is [amount] written with AED (or «درهم») right beside it in [t]? */
export function aedBeside(t, amount) {
  const re = /(?:\bAED|درهم)\s*[:=]?\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:AED\b|درهم)/gi;
  for (const m of String(t || '').matchAll(re)) if (Math.abs(Number(String(m[1] || m[2]).replace(/,/g, '')) - Number(amount)) < 0.005) return true;
  return false;
}
export function eventsFromCaption(role, text) {
  if (role === 'payment' && isStarred(text)) { // a star at the end: the star is taken off the name and the amount; the money needs no invoice
    const r = eventsFromCaption(role, String(text).replace(STAR_END, '').trim());
    return r?.events ? { ...r, events: r.events.map((e) => ({ ...e, noInvoice: true })) } : r;
  }
  if (role === 'cut') {
    const c = parseCutCaption(text);
    if (!c || c.kind === 'name') return null;
    if (c.kind === 'no-code') return { noCode: { customer: c.customer, quantity: c.quantity, unit: c.unit, ...(c.pieces ? { pieces: c.pieces } : {}), ...(c.invoiceQuantity !== undefined ? { invoiceQuantity: c.invoiceQuantity } : {}) } }; // the code comes from the quoted post, or the owner is told
    if (c.kind === 'no-customer') return { noCustomer: { code: c.code, quantity: c.quantity, unit: c.unit } }; // a cut with nobody named: not recorded, the owner is told
    const lines = c.lines || [{ code: c.code, quantity: c.quantity, unit: c.unit, ...(c.invoiceQuantity !== undefined ? { invoiceQuantity: c.invoiceQuantity } : {}) }];
    // an opened roll or a damaged piece is kept (the cutters' log) but is never a sale: no customer, flagged internal
    if (c.kind === 'open-roll' || c.kind === 'damage') return { events: [{ type: 'cut', internal: true, kind: c.kind, customer: c.kind === 'damage' ? c.customer : '', lines }] };
    // a catalog is always FREE (the owner, 14/11): kept in the log with its customer, never a sale, never «not invoiced»
    if (lines.length && lines.every((l) => l.code === 'CATALOG')) return { events: [{ type: 'cut', internal: true, kind: 'catalog', customer: c.customer, lines }] };
    return { events: [{ type: 'cut', customer: c.customer, lines, ...(c.pieces ? { pieces: c.pieces } : {}), ...(c.sample ? { sample: true } : {}) }] };
  }
  if (role === 'delivery') {
    const d = parseDeliveryCaption(text);
    if (!d || !d.customers.length) return null;
    return {
      events: d.customers.map((x) => ({
        type: 'delivery', customer: x.customer, lines: [], ...(x.quantity ? { delivered: { quantity: x.quantity, unit: x.unit } } : {}),
        ...(d.cod ? { cod: d.cod } : {}), ...(d.customers.length === 1 && collectedAmount(text) > 0 ? { collected: collectedAmount(text) } : {}), ...(d.status ? { status: d.status } : {}), ...(d.by ? { by: d.by } : {}),
      })),
    };
  }
  if (role === 'payment' && isGenericBankSms(text) && bankSmsAmount(text) > 0) { // the bank's SMS: a transfer (a cheque clearing keeps its own handling); its sentence is never a customer
    return { events: [{ type: 'payment', kind: /outward cheque clearing/i.test(text) ? 'cash' : 'transfer', customer: '', amount: bankSmsAmount(text), currency: 'AED', lines: [], pendingName: true, bankSms: true }] };
  }
  if (role === 'payment' && OWN_REPLY.test(String(text || ''))) return { ignore: true }; // the assistant's own reply in the group (a statement sent, an invoice preview) is no money
  if (role === 'payment' && driverCashAmount(text) > 0) return { ignore: true }; // «3000 aed delivery»: the amount to collect on delivery of an order, not money received
  if (role === 'payment' && !/received?|receive|cash|paid|\bpay\b|payment|cleared?|credited|cheque|chq|check|transfer|deposit|bank|inv(?:oice)?[-\s]?\d|statement/i.test(String(text)) && /deliver\w*|confirm|\broll\b|\bsend\b|\border\b|\bpcs\b|pieces|meters?|\bmtr\b/i.test(String(text))) return { ignore: true }; // an amount beside order words, with no word of money coming in, is no payment
  if (role === 'payment' && isStockQuestion(text)) return { ignore: true }; // «307 available one roll in China stock?» is a question, not money
  if (role === 'payment') {
    // THE OWNER'S RULE (21/11): money is written in the fixed shapes (src/moneyshape.js) with AED beside the amount; any other message with an
    // amount records nothing and the group is asked at once what it is for. A clearing («CLEARED», «clear inv 9808») and a bare name are read as before.
    // a bank's own message (an SMS or its forward) and a foreign currency keep their own reading
    if (!/^\s*clear/i.test(String(text || '')) && !isGenericBankSms(text) && !/credited\s+with|has\s+been\s+credited/i.test(String(text || '')) && !/\b(?:OMR|USD|SAR|EUR|GBP|QAR|KWD|BHD|INR)\b/i.test(String(text || ''))) {
      const shape = readMoneyShape(text, 'confirmation');
      if (shape?.noAed) return { askAed: { amount: shape.amount, customers: shape.name ? [shape.name] : [], shape: shape.kind } };
      if (shape && shape.amount > 0) {
        if (shape.kind === 'cash_to_boss' || shape.kind === 'salary_advance') return { events: [{ type: 'payment', kind: shape.kind, customer: '', amount: shape.amount, currency: 'AED', lines: [], ...(shape.kind === 'salary_advance' && shape.name ? { employee: shape.name } : {}) }] };
        const who = stripPaymentWords(shape.name || ''); // «CASH RECEIVED FROM receipt + clear 115 AED»: no name
        return { events: [{ type: 'payment', kind: shape.kind, customer: who, amount: shape.amount, ...(shape.invoices?.length ? { invoices: shape.invoices } : {}), currency: 'AED', lines: [], ...(who ? {} : { pendingName: true }), ...(shape.chequeDate ? { chequeDate: shape.chequeDate } : {}), ...(shape.noInvoice ? { noInvoice: true } : {}) }] };
      }
      const withoutInvoiceNumbers = String(text || '').replace(/(?:\binv(?:oice)?s?\b|فاکتور)\.?\s*(?:no\.?|number|#|شماره)?\s*[-:#]?\s*\d{3,6}(?:\s*[/,&]\s*\d{3,6})*/gi, ' ');
      // an order line, a product code to check, a date with a name and a stock question have no amount of money: ignored as before
      const tq = String(text || '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
      const quiet = !MONEY_WORDS.test(tq) && !CURRENCY.test(tq) && (ORDER_LINE.test(tq) || ((tq.match(DATE) || []).length && !/\d/.test(tq.replace(DATE, ' '))));
      if (!shape && !quiet && hasAmount(withoutInvoiceNumbers)) return { askWhat: 'confirmation' };
      // money words with no amount at all («AL Ebda check collected», live 21/11): never a bare name for a neighbour payment; the group is asked
      if (!shape && !hasAmount(withoutInvoiceNumbers) && /\b(?:che+a?ques?|cheq|chq|check|collected|recei?ved?|recived|transfer(?:red)?|deposit(?:ed)?)\b/i.test(String(text || '')) && !/^\s*check\s+\d/i.test(String(text || ''))) return { askWhat: 'confirmation' };
    }
    if (fromBoss(text)) { // money from the boss into the cash box: no customer's money and no cash out; kept apart, never counted, the owner is asked
      const a = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/.exec(String(text || '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
      if (a && Number(a[1].replace(/,/g, '')) > 0) return { events: [{ type: 'payment', kind: 'unclear', customer: '', amount: Number(a[1].replace(/,/g, '')), currency: 'AED', lines: [], unclear: true, fromBoss: true }] };
    }
    const out = cashOutKind(text); // cash leaving the cash box (to the boss, a salary advance): its own kind, never a customer payment
    if (out) return { events: [{ type: 'payment', kind: out.kind, customer: '', amount: out.amount, currency: 'AED', lines: [], ...(out.employee ? { employee: out.employee } : {}) }] };
    const t = String(text || '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))); // Persian and Arabic digits read as digits
    const said = MONEY_WORDS.test(t);
    // a promise, a request, a balance or a price is never money received (a cheque keeps its due date: «PDC 5000 due 01/12»)
    if (NOT_RECEIVED.test(t) && !/\bche+a?ques?\b|\bcheq\b|\bchqs?\b|\bpdc\b|چک|شيك/i.test(t)) return { ignore: true };
    // an order or product line with no word of money
    if (!said && !CURRENCY.test(t) && ORDER_LINE.test(t)) return { ignore: true };
    // only a date and a name: no amount at all
    if (!said && (t.match(DATE) || []).length && !/\d/.test(t.replace(DATE, ' '))) return { ignore: true };
    const p = parsePaymentCaption(text);
    if (!p) return null;
    if (p.kind === 'name' && FILLER_NAME.test(String(p.customer || '').trim())) return { ignore: true }; // «Done», «plz clear it»: never a name
    // THE OWNER'S RULE (21/11): an amount is money only with AED written beside it («1500 AED», «AED 1500», «1500aed»; «درهم» is the same word). A bare
    // number («Al ebda month 10», «Cash received from Alia wood 176.40») records nothing and the group is asked to write it again with AED
    if (p.kind === 'cash' && Number(p.amount) > 0 && !p.foreign && !p.currency && !/\b(?:OMR|USD|SAR|EUR|GBP|QAR|KWD|BHD|INR)\b/i.test(t) && !aedBeside(t, p.amount)) return { askAed: { amount: p.amount, customers: p.customers || [] } };
    // an amount and a name and NO word of money nor currency («Zeta 1500»): unclear — kept apart, never counted, the owner is asked
    if (p.kind === 'cash' && !said && !CURRENCY.test(t) && !p.cheque && !p.transfer && !(p.invoices?.length)) {
      return { events: [{ type: 'payment', kind: 'unclear', customer: (p.customers || []).join(' + '), amount: p.amount, currency: 'AED', lines: [], unclear: true }] };
    }
    if (p.kind === 'cleared') return { cleared: true };
    if (p.kind === 'clear-invoices') return { clearInvoices: p.invoices };
    if (p.kind === 'expense') return { ignore: true };
    if (p.kind === 'bank-credit') return { events: [{ type: 'payment', kind: 'transfer', customer: p.customer || '', amount: p.amount, currency: 'AED', lines: [], ...(p.customer ? {} : { pendingName: true }) }] };
    if (p.kind === 'name') return { name: p.customer }; // a bare name: it may belong to the payment just before or just after it
    const withInvoices = { ...(p.cheque ? { kind: 'cheque' } : {}), ...(p.transfer ? { kind: 'transfer' } : {}), ...(p.chequeDate ? { chequeDate: p.chequeDate } : {}), ...(p.currency ? { currency: p.currency } : {}), ...(p.foreign ? { foreign: p.foreign } : {}), ...(p.invoices?.length ? { invoices: p.invoices, ...(p.amount > 0 ? {} : { noAmount: true }) } : {}), ...(p.cleared ? { cleared: true } : {}) };
    if (p.kind === 'cash' && !p.customers.length) return { events: [{ type: 'payment', kind: 'cash', customer: '', amount: p.amount, currency: 'AED', lines: [], pendingName: true, ...withInvoices }] };
    if (p.kind === 'cash' && p.customers.length) {
      // several customers in one caption: one event with the names joined; the amount is not split between them
      return { events: [{ type: 'payment', kind: 'cash', customer: p.customers.join(' + '), amount: p.amount, currency: 'AED', lines: [], ...(p.customers.length > 1 ? { multi: true } : {}), ...withInvoices }] };
    }
    return null;
  }
  if (role === 'goods') {
    const g = parseGoodsCaption(text);
    // goods that arrived are kept by received.js, in any internal group, as stock coming in
    return g && g.kind !== 'received' ? { events: [{ type: 'goods', kind: g.kind, customer: g.customer, item: g.item, quantity: g.quantity, unit: g.unit, lines: [] }] } : null;
  }
  return null;
}
