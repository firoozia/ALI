// On-demand invoice check in a colleague's chat: which messages are about an invoice, and the answer text.

import { reportText } from './invoice.js';

const INVOICE_WORDS = /(فاکتور|فاكتور|صورت\s?حساب|فاتورة|انوائس|انوائس|\binvoice\b|\binv[-\s]?\d+|\bcompare\b|مقایسه|مقارنة)/i;

/** A caption or file name that says the picture or file is an invoice, or asks for it to be compared or checked. */
export const looksLikeInvoice = (text) => INVOICE_WORDS.test(String(text || ''));

/**
 * The reply of an on-demand check. [problems]: the audit and order-memory points, [info]: { customer, number }.
 * A clean invoice gets one line; points are listed in the invoice report format.
 */
export function onDemandText({ problems, customer, number, name = '', groupName = '' }) {
  const urgent = problems.filter((p) => p.severity !== 'info');
  const verdict = urgent.length ? 'mismatch' : 'match';
  const body = reportText({ verdict, request_customer: customer, invoice_number: number, problems }, { groupName, customer, name });
  if (body) return body;
  return `فاکتور${number ? ` ${number}` : ''}${customer ? ` ${customer}` : ''} بررسی شد؛ حساب، مالیات و قیمت‌ها ایرادی نداشت.${name ? `\n— ${name}` : ''}`;
}
