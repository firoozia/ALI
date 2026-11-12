// What is NOT customer money, read from the Confirmation group's own words, for new posts and for rows already stored (re-derived on read, nothing rewritten):
//   a question about stock («307 available one roll in China stock?»), the bank's SMS («… is credited with AED 708.75 for Aani Instant Payments …») whose sentence is never a customer and which is
//   a TRANSFER (or a cheque clearing), our own invoice PDF forwarded, and a word like «delivery» in the place of a customer.
import { isClearingText } from './payments.js';

export const isStockQuestion = (text) => /(?:^|[^a-z])(?:available|stock|qty|quantity)(?![a-z])/i.test(String(text || '')) || /\?\s*$/.test(String(text || ''));
const BANK = /credited (?:with|to your)|has been credited|\bAani\b|\bIPP\b|inward (?:remittance|transfer)|outward cheque clearing|login to online banking/i;
export const isBankSms = (text) => BANK.test(String(text || ''));
/** A bank SMS whose «for …» part is NOT a customer (the product name of the transfer, the standard footer): the old reading would take it for a name. */
export const isGenericBankSms = (text) => isBankSms(text) && /for\s+(?:Aani|IPP|Local|Instant|Inward|Outward|details)|login to online banking|has been credited to your/i.test(String(text || ''));
const BAD_NAME = /details|credited|aani|\bipp\b|inward|outward|login|online|instant|local|account|banking/i;
export const bankSmsAmount = (text) => { const m = /(?:AED|Dhs?)\.?\s*([\d,]+(?:\.\d+)?)/i.exec(String(text || '')); return m ? Number(m[1].replace(/,/g, '')) : 0; };
/** Our own invoice forwarded as a PDF is never a payment: «Invoice inv-10012.pdf», «Tax Invoice». */
export const isInvoiceFile = (name, text = '') => /(?:^|[^a-z])invoice[-_ ]*inv[-_]?\d|^inv[-_]?\d{3,}|tax invoice/i.test(String(name || '') + ' ' + String(text || ''));
const WORD_ONLY = new Set(['delivery', 'deliveries']);

const cleanName = (n) => String(n || '').replace(/[-_.\s]+$/g, '').trim();
const dayKey = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

/** The stored payment rows as they really are (a changed copy; the stored ones are untouched). */
export function fixStoredPayments(events, timeZone = 'Asia/Dubai') {
  let list = events.filter((e) => !(e.type === 'payment' && isStockQuestion(e.text || e.customer) && !isBankSms(e.text || e.customer) && !/cheque|chq/i.test(e.text || ''))); // a question about stock is no money
  list = list.map((e) => {
    if (e.type !== 'payment') return e;
    const words = e.text || e.customer || '';
    if (isBankSms(words) && e.kind !== 'cheque') { // the bank's message: a transfer (a cheque clearing keeps its own handling), its sentence is no customer
      const clearing = isClearingText(words);
      const named = e.customer && !BAD_NAME.test(e.customer) && String(e.customer).length <= 40 && !e.pendingName; // «… credited with AED 197.93 for AR RAD»: a real name stays
      return { ...e, text: e.text || words, ...(named ? {} : { customer: '', customerTyped: '', pendingName: true, bankSms: true }), ...(clearing ? {} : { kind: 'transfer' }), amount: Number(e.amount) > 0 ? e.amount : bankSmsAmount(words) };
    }
    if (e.kind === 'cash' && WORD_ONLY.has(String(e.customer || '').trim().toLowerCase()) && (!e.text || /^\s*[\d,.]+\s*(?:aed|dhs?)?\s*deliver\w*\s*$/i.test(e.text))) return { ...e, customer: '', customerTyped: '', pendingName: true, what: 'delivery?' }; // cash with no customer: «3000 aed delivery»
    return e;
  });
  // a bank SMS has no name: the receipt PDF of the same amount (+-1 AED) the same day gives it, and the two are ONE row (the SMS keeps its exact amount)
  const gone = new Set();
  for (const sms of list.filter((e) => e.bankSms && e.pendingName)) {
    const twin = list.find((o) => o !== sms && !gone.has(o) && o.type === 'payment' && o.source === 'pdf' && o.customer && Math.abs(Number(o.amount) - Number(sms.amount)) <= 1 && dayKey(o.at, timeZone) === dayKey(sms.at, timeZone));
    if (twin) { sms.customer = cleanName(twin.customer); sms.customerTyped = sms.customer; sms.pendingName = false; gone.add(twin); }
  }
  return list.filter((e) => !gone.has(e));
}
