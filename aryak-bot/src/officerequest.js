// A customer writes in his own group something only the office can do: «please send the invoice for this delivery», «we need AY 505 - 30 mtr, send today itself».
// The assistant never answers him; it only surfaces the message ONCE to the owner's own chat as a note (nothing is posted to the customer, nothing is created anywhere).
import { parseAvailabilityAsk } from './availdraft.js';

const INVOICE = /(?:\b(?:send|need|issue|prepare|make|share|give|want)\b[^.?!]{0,30}\binvoices?\b|\binvoices?\b[^.?!]{0,30}\b(?:please|today|send|for\s+(?:this|the)|needed)\b|فاکتور[^.؟?!]{0,30}(?:بفرست|می‌خواهم|لازم|بدهید|ارسال)|(?:بفرست|می‌خواهم|لازم)[^.؟?!]{0,30}فاکتور)/i;
const ORDER = /(?:\b(?:we\s+)?(?:need|want|require|order|send)\b)[^.?!]{0,40}?(?<![\w.])((?:[A-Za-z]{1,3}[\s-]?)?\d{2,5}[A-Za-z]?)\b[^.?!]{0,20}?(\d+(?:\.\d+)?)\s*(m|mtr|mtrs|meters?|metres?|rolls?|pcs|pieces)\b/i;

/** { kind: 'invoice' | 'order', code?, quantity?, unit? } for a customer's message that needs the office, or null. A question about availability is the other path. */
export function parseOfficeRequest(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 300) return null;
  if (parseAvailabilityAsk(s)) return null;
  if (INVOICE.test(s)) return { kind: 'invoice' };
  const o = ORDER.exec(s);
  if (o) return { kind: 'order', code: o[1].replace(/\s+/g, ' ').toUpperCase(), quantity: Number(o[2]), unit: /^roll/i.test(o[3]) ? 'roll' : /^(pcs|pieces)/i.test(o[3]) ? 'pcs' : 'm' };
  return null;
}

/** The note for the owner's own chat. */
export function officeNote(subject, text, req) {
  const what = req.kind === 'invoice' ? 'asks for an invoice' : `orders${req.code ? ` ${req.code}` : ''}${req.quantity ? ` ${req.quantity} ${req.unit}` : ''}`;
  return `📩 Customer group "${subject}" ${what}: "${String(text).trim().slice(0, 200)}"\nNothing was sent to the customer and nothing was created. To prepare it: invoice for <customer>, then one item per line.`;
}
