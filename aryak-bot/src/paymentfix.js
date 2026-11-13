// What is NOT customer money, read from the Confirmation group's own words, for new posts and for rows already stored (re-derived on read, nothing rewritten):
//   a question about stock («307 available one roll in China stock?»), the bank's SMS («… is credited with AED 708.75 for Aani Instant Payments …») whose sentence is never a customer and which is
//   a TRANSFER (or a cheque clearing), our own invoice PDF forwarded, and a word like «delivery» in the place of a customer.
import { createHash } from 'node:crypto';
import { isClearingText } from './payments.js';
import { eventsFromCaption } from './captionevents.js';
import { typedFitsName } from './qboname.js';

/** «DERWAZAA BANK TRANSFER 294 AED» -> { name, amount } or null (the office's words on a receipt, as its caption or as a reply). */
export function replyNameAmount(text) {
  const m = /^\s*([A-Za-z\u0600-\u06ff][^\d]{1,40}?)\s+(?:bank\s+)?transfer\s+([\d,]+(?:\.\d+)?)\s*(?:aed|dhs?)?\s*$/i.exec(String(text || ''));
  return m ? { name: String(m[1]).replace(/\s+bank$/i, '').replace(/[-_.\s]+$/g, '').trim(), amount: Number(m[2].replace(/,/g, '')) } : null;
}

export const isStockQuestion = (text) => /(?:^|[^a-z])(?:available|stock|qty|quantity)(?![a-z])/i.test(String(text || '')) || /\?\s*$/.test(String(text || ''));
const BANK = /credited (?:with|to your)|has been credited|\bAani\b|\bIPP\b|inward (?:remittance|transfer)|outward cheque clearing|login to online banking/i;
export const isBankSms = (text) => BANK.test(String(text || ''));
/** A bank SMS whose «for …» part is NOT a customer (the product name of the transfer, the standard footer): the old reading would take it for a name. */
export const isGenericBankSms = (text) => isBankSms(text) && /for\s+(?:Aani|IPP|Local|Instant|Inward|Outward|details)|login to online banking|has been credited to your/i.test(String(text || ''));
const BAD_NAME = /details|credited|aani|\bipp\b|inward|outward|login|online|instant|local|account|banking/i;
export const bankSmsAmount = (text) => { const m = /(?:AED|Dhs?)\.?\s*([\d,]+(?:\.\d+)?)/i.exec(String(text || '')); return m ? Number(m[1].replace(/,/g, '')) : 0; };
/** Our own invoice forwarded as a PDF is never a payment: «Invoice inv-10012.pdf», «Tax Invoice». */
/** The money the DRIVER collected on deliveries and handed in: «3000 aed delivery», «driver cash 3000», «from driver 3000». Returns the amount or 0. */
export const driverCashAmount = (text) => {
  const t = String(text || '').trim();
  const m = /^\s*([\d,]+(?:\.\d+)?)\s*(?:aed|dhs?)?\s*deliver\w*\s*$/i.exec(t) || /(?:driver\s+cash|from\s+(?:the\s+)?driver|cash\s+from\s+(?:the\s+)?driver)\D{0,12}([\d,]+(?:\.\d+)?)/i.exec(t) || /([\d,]+(?:\.\d+)?)\s*(?:aed|dhs?)?\s*(?:from\s+(?:the\s+)?driver|driver\s+cash)/i.exec(t);
  return m ? Number(m[1].replace(/,/g, '')) : 0;
};
/** The amount a delivery post says was COLLECTED: «Aila wood AED750 collected», «delivered AED 176 collected», «COD 945». Returns the amount or 0. */
export const collectedAmount = (text) => {
  const t = String(text || '');
  const m = /(?:AED|Dhs?)\.?\s*([\d,]+(?:\.\d+)?)\s*(?:\w+\s+)?collected/i.exec(t) || /collected\s*:?\s*(?:AED|Dhs?)?\.?\s*([\d,]+(?:\.\d+)?)/i.exec(t) || /\bCOD\s*:?\s*(?:AED|Dhs?)?\.?\s*([\d,]+(?:\.\d+)?)/i.exec(t);
  return m ? Number(m[1].replace(/,/g, '')) : 0;
};
export const isInvoiceFile = (name, text = '') => /(?:^|[^a-z])invoice[-_ ]*inv[-_]?\d|^inv[-_]?\d{3,}|tax invoice/i.test(String(name || '') + ' ' + String(text || ''));
const WORD_ONLY = new Set(['delivery', 'deliveries']);

const cleanName = (n) => String(n || '').replace(/[-_.\s]+$/g, '').trim();
const dayKey = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

/** The stored payment rows as they really are (a changed copy; the stored ones are untouched). */
export function fixStoredPayments(events, timeZone = 'Asia/Dubai', rawMessages = [], approved = () => false) {
  // RE-JUDGED from the raw message: a row made from a plain text message that today's rules say is no money (an amount beside order words, a stock question, «3000 aed delivery») is dropped, whatever the
  // code that stored it thought; the message is read as it stands now (edits applied, deleted ones gone). The owner's answers on the row are not touched (the row is only dropped or kept).
  if (rawMessages.length) {
    const bad = new Set();
    for (const m of rawMessages) {
      const text = String(m.text || m.caption || '').trim();
      if (!text || m.quoted || m.file) continue; // a reply or a document is read with what it quotes
      const verdict = eventsFromCaption('payment', text);
      if (verdict?.ignore) bad.add(createHash('sha256').update(m.chat + '|' + m.id).digest('hex').slice(0, 24));
    }
    if (bad.size) events = events.filter((e) => !(e.type === 'payment' && bad.has(e.ref)));
  }
  let list = events.filter((e) => !(e.type === 'payment' && isStockQuestion(e.text || e.customer) && !isBankSms(e.text || e.customer) && !/cheque|chq/i.test(e.text || ''))); // a question about stock is no money
  list = list.filter((e) => !(e.type === 'payment' && e.kind === 'cash' && (driverCashAmount(e.text) > 0 || (!e.text && WORD_ONLY.has(String(e.customer || '').trim().toLowerCase()))))); // «3000 aed delivery»: the amount to collect on delivery, not money received
  list = list.map((e) => {
    if (e.type !== 'payment') return e;
    const words = e.text || e.customer || '';
    if (isBankSms(words) && e.kind !== 'cheque') { // the bank's message: a transfer (a cheque clearing keeps its own handling), its sentence is no customer
      const clearing = isClearingText(words);
      const named = e.customer && !BAD_NAME.test(e.customer) && String(e.customer).length <= 40 && !e.pendingName; // «… credited with AED 197.93 for AR RAD»: a real name stays
      return { ...e, text: e.text || words, ...(named ? {} : { customer: '', customerTyped: '', pendingName: true, bankSms: true }), ...(clearing ? {} : { kind: 'transfer' }), amount: Number(e.amount) > 0 ? e.amount : bankSmsAmount(words) };
    }
    if (e.customerTyped && e.customer && e.customer !== e.customerTyped && !approved(e.customerTyped, e.customer) && !typedFitsName(e.customerTyped, e.customer)) return { ...e, customer: e.customerTyped }; // the name TYPED does not fit the customer an old code chose («Al masar» was «MASTER WOOD»): the typed name stands
    if (e.kind === 'cash' && WORD_ONLY.has((e.text) > 0 || (WORD_ONLY.has(String(e.customer || '').trim().toLowerCase()) && !e.text))) return { ...e, customer: '', customerTyped: '', pendingName: false, source: 'driver', amount: Number(e.amount) > 0 ? e.amount : driverCashAmount(e.text) }; // «3000 aed delivery»: the cash the driver handed in, never a customer
    return e;
  });
  // the office's reply «NAME BANK TRANSFER 294 AED» to a receipt PDF / photo whose amount was not read: the name and the amount fill that receipt, and the reply is not a payment of its own
  const REPLY = /^\s*([A-Za-z\u0600-\u06ff][^\d]{1,40}?)\s+(?:bank\s+)?transfer\s+([\d,]+(?:\.\d+)?)\s*(?:aed|dhs?)?\s*$/i;
  const filled = new Map(); const spent = new Set();
  for (const r of list.filter((e) => e.type === 'payment' && e.source !== 'pdf' && e.source !== 'photo' && REPLY.test(String(e.text || e.customer || '')))) {
    const m = REPLY.exec(String(r.text || r.customer || '')) || REPLY.exec(String(r.customer || ''));
    if (!m) continue;
    const name = cleanName(m[1].replace(/\s+bank$/i, '')); const amount = Number(m[2].replace(/,/g, ''));
    const target = [...list].reverse().find((o) => o !== r && o.type === 'payment' && (o.source === 'pdf' || o.source === 'photo') && !(Number(o.amount) > 0) && o.at <= r.at && r.at - o.at <= 6 * 3600000 && !filled.has(o));
    const fill = { customer: name, customerTyped: name, amount, kind: 'transfer', pendingName: false, noAmount: false };
    if (target) { filled.set(target, { ...target, ...fill }); spent.add(r); } else filled.set(r, { ...r, ...fill });
  }
  if (filled.size || spent.size) list = list.filter((e) => !spent.has(e)).map((e) => filled.get(e) || e);
  if (rawMessages.length) {
    const byRef = new Map(rawMessages.map((m) => [createHash('sha256').update(m.chat + '|' + m.id).digest('hex').slice(0, 24), m]));
    list = list.map((e) => {
      if (e.type !== 'payment' || !(e.source === 'pdf' || e.source === 'photo') || Number(e.amount) > 0) return e;
      const own = byRef.get(e.ref);
      const words = own ? replyNameAmount(own.caption || own.text) || rawMessages.map((m) => (m.quoted === own.id ? replyNameAmount(m.text) : null)).find(Boolean) : null;
      return words ? { ...e, customer: words.name, customerTyped: words.name, amount: words.amount, kind: 'transfer', pendingName: false } : e;
    });
  }
  // an old receipt whose amount was never read and that has no name, followed within a day and a half by a NAMED payment with an amount, is that payment: it is dropped, not said in every report
  list = list.filter((e) => {
    if (!(e.type === 'payment' && (e.source === 'pdf' || e.source === 'photo') && !(Number(e.amount) > 0)) || (e.invoices || []).length) return true;
    const names = [e.customer, e.customerTyped, String(e.file || '').replace(/\.pdf$/i, '')].map((n) => String(n || '').trim()).filter(Boolean);
    const usable = names.some((n) => n.replace(/[^\p{L}]/gu, '').length >= 4); // «sen» is a fragment, «saj» fits by itself
    const explained = list.some((l) => l !== e && l.type === 'payment' && l.customer && Number(l.amount) > 0 && l.at > e.at && l.at - e.at <= 36 * 3600000
      && (names.some((n) => n.replace(/[^\p{L}]/gu, '').length >= 2 && typedFitsName(n, l.customer)) || !usable));
    return !explained;
  });
  // a bank SMS has no name: the receipt PDF of the same amount (+-1 AED) the same day gives it, and the two are ONE row (the SMS keeps its exact amount)
  const gone = new Set();
  for (const sms of list.filter((e) => e.bankSms && e.pendingName)) {
    const twin = list.find((o) => o !== sms && !gone.has(o) && o.type === 'payment' && o.source === 'pdf' && o.customer && Math.abs(Number(o.amount) - Number(sms.amount)) <= 1 && dayKey(o.at, timeZone) === dayKey(sms.at, timeZone));
    if (twin) { sms.customer = cleanName(twin.customer); sms.customerTyped = sms.customer; sms.pendingName = false; gone.add(twin); }
  }
  return list.filter((e) => !gone.has(e));
}
