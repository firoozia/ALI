// What a customer's message is, from its shape: an order (one or more "code - quantity unit" lines, perhaps an add-on),
// a bare availability question ("108 available?", "511 AVAILBLE", "116?") or something else. Real customers write
// "119-6 MTR", "603 - 15 mtr", "701 25 meter?", "Please add 234 - 3 mtr also", and misspell "available".
// The result is a hint for the answering model and a test target; it never answers anything by itself.

import { normalizeDigits, normalizeLetters } from './text.js';
import { UNIT_RE, dropBrandWord, tailName, unitOf } from './codes.js';

const UNIT_WORDS = {
  m: 'm', mtr: 'm', mtrs: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  roll: 'roll', rolls: 'roll', pc: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs', carton: 'carton', cartons: 'carton', ctn: 'carton',
};
const UNIT = UNIT_RE;
const CODE = '(?:[a-z]{1,4}-?\\d+(?:-\\d+)?|\\d{2,5})';
const NUM = '(\\d+(?:\\.\\d+)?)';

// "119-6 MTR", "603 - 15 mtr", "KG10-300 - 5 m", "201:15 m"
const WITH_SEPARATOR = new RegExp(`^(${CODE})\\s*[-:=x]+\\s*\\(?\\s*${NUM}\\s*${UNIT}\\b`);
// "701 25 meter"
const WITH_SPACE = new RegExp(`^(${CODE})\\s+\\(?\\s*${NUM}\\s*${UNIT}\\b`);
// the unit in front of the number: "101-- roll 2"
const UNIT_FIRST = new RegExp(`^(${CODE})\\s*[-:=]*\\s*${UNIT}\\s*${NUM}\\b`);
// the unit is required: "119-6" alone is a code, not 6 of 119.

const cleanLine = (line) => dropBrandWord(normalizeDigits(line)).toLowerCase().replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();

/** One line -> { code, quantity, unit, addOn } or null. */
function parseOrderLine(raw) {
  let s = cleanLine(raw).replace(/[?؟!.]+$/g, '').trim();
  const addOn = /^(please\s+)?add\b/.test(s) || /\balso\b/.test(s);
  s = s.replace(/^(please\s+)?(add\s+)?/, '').replace(/\s+also$/, '').trim();
  let m = WITH_SEPARATOR.exec(s) || WITH_SPACE.exec(s);
  let q;
  let u;
  if (m) { q = m[2]; u = m[3]; } else if ((m = UNIT_FIRST.exec(s))) { q = m[3]; u = m[2]; } else return null;
  // the words after the line ("al ebda", "nuqoosh") name the billing customer
  const customer = tailName(s.slice(m[0].length));
  return { code: m[1].toUpperCase(), quantity: Number(q), unit: UNIT_WORDS[u] || unitOf(u), addOn, ...(customer ? { customer } : {}) };
}

// The words around a code in an availability question, in the languages of the customers.
const AVAILABILITY_TOKENS = new Set([
  'is', 'are', 'it', 'the', 'code', 'please', 'pls', 'kindly', 'check', 'have', 'do', 'you', 'stock', 'in', 'still', 'now', 'number', 'no',
  'هل', 'متوفر', 'متوفره', 'متاح', 'موجود', 'لديكم', 'عندكم', 'كود', 'رقم', 'من', 'فضلك', 'لو', 'سمحت', 'الكود',
  'کیا', 'دستیاب', 'ہے', 'ہیں', 'کوڈ', 'براہ', 'کرم', 'آپ', 'کے', 'پاس',
  'آیا', 'موجوده', 'موجودی', 'هست', 'هستش', 'هستند', 'دارید', 'دارین', 'کد', 'لطفا', 'لطفاً', 'ممنون', 'شماره',
].map((w) => normalizeLetters(w)));

/** "108 available?", "511 AVAILBLE", "116?", "هل 408 متوفر؟", "۴۰۸ موجوده؟" -> the codes asked about; [] when it is more than that. */
function parseAvailability(raw) {
  const tokens = cleanLine(normalizeLetters(raw)).replace(/[?؟!.,،;/]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
    .filter((w) => !AVAILABILITY_TOKENS.has(w) && !/^(avail|avil)\w*$/.test(w));
  const re = new RegExp(`^${CODE}$`);
  // a bare one or two digit number is more likely a quantity than a code
  return tokens.length && tokens.every((p) => re.test(p) && !/^\d{1,2}$/.test(p)) ? tokens.map((p) => p.toUpperCase()) : [];
}

/**
 * @returns {{ kind: 'order'|'availability'|'other', lines: Array<{code:string, quantity:number, unit:string, addOn:boolean}>, codes: string[] }}
 */
export function orderLinesOf(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(parseOrderLine).filter(Boolean);
}

export function parseCustomerText(text) {
  const rows = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lines = rows.map(parseOrderLine).filter(Boolean);
  // every non-empty row must be an order line (a greeting or a question around them is allowed: the rows that are not
  // lines are simply not part of the order)
  if (lines.length) return { kind: 'order', lines, codes: [] };
  const codes = parseAvailability(rows.join(' '));
  if (codes.length) return { kind: 'availability', lines: [], codes };
  return { kind: 'other', lines: [], codes: [] };
}

/** The hint put before the model: what the message looks like, and what to do with each line. */
export function hintFor(parsed) {
  if (parsed.kind === 'order') {
    const list = parsed.lines.map((l) => `${l.code} = ${l.quantity} ${l.unit}${l.addOn ? ' (an addition to an open order)' : ''}`).join('; ');
    return `Looks like an order: ${list}. Check every line with check_stock (give the quantity and unit) and answer line by line; the order itself is confirmed by a colleague.`;
  }
  if (parsed.kind === 'availability') {
    return `Looks like a short availability question for: ${parsed.codes.join(', ')}. Check each code with check_stock and answer very briefly.`;
  }
  return '';
}
