// What a customer's message is, from its shape: an order (one or more "code - quantity unit" lines, perhaps an add-on),
// a bare availability question ("108 available?", "511 AVAILBLE", "116?") or something else. Real customers write
// "119-6 MTR", "603 - 15 mtr", "701 25 meter?", "Please add 234 - 3 mtr also", and misspell "available".
// The result is a hint for the answering model and a test target; it never answers anything by itself.

import { normalizeDigits } from './text.js';

const UNIT_WORDS = {
  m: 'm', mtr: 'm', mtrs: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  roll: 'roll', rolls: 'roll', pc: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs', carton: 'carton', cartons: 'carton', ctn: 'carton',
};
const UNIT = '(m|mtrs?|meters?|metres?|rolls?|pcs?|pieces?|cartons?|ctn)';
const CODE = '(?:[a-z]{1,4}-?\\d+(?:-\\d+)?|\\d{2,5})';
const NUM = '(\\d+(?:\\.\\d+)?)';

// "119-6 MTR", "603 - 15 mtr", "KG10-300 - 5 m", "201:15 m"
const WITH_SEPARATOR = new RegExp(`^(${CODE})\\s*[-:=x]\\s*${NUM}\\s*${UNIT}\\b`);
// "701 25 meter"
const WITH_SPACE = new RegExp(`^(${CODE})\\s+${NUM}\\s*${UNIT}\\b`);
// the unit is required: "119-6" alone is a code, not 6 of 119.

const cleanLine = (line) => normalizeDigits(line).toLowerCase().replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();

/** One line -> { code, quantity, unit, addOn } or null. */
function parseOrderLine(raw) {
  let s = cleanLine(raw).replace(/[?؟!.]+$/g, '').trim();
  const addOn = /^(please\s+)?add\b/.test(s) || /\balso\b/.test(s);
  s = s.replace(/^(please\s+)?(add\s+)?/, '').replace(/\s+also$/, '').trim();
  const m = WITH_SEPARATOR.exec(s) || WITH_SPACE.exec(s);
  if (!m) return null;
  return { code: m[1].toUpperCase(), quantity: Number(m[2]), unit: UNIT_WORDS[m[3]] || m[3], addOn };
}

const AVAILABILITY_WORDS = /\b(avail\w*|avil\w*|in\s*stock|stock|please|pls|kindly|check|have|do\s+you|is|are|it|the|code)\b/g;

/** "108 available?", "511 AVAILBLE", "116?", "410" -> the codes asked about; [] when it is more than that. */
function parseAvailability(raw) {
  const s = cleanLine(raw).replace(AVAILABILITY_WORDS, ' ').replace(/[?؟!.,،;/]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const parts = s.split(' ');
  return parts.every((p) => new RegExp(`^${CODE}$`).test(p)) ? parts.map((p) => p.toUpperCase()) : [];
}

/**
 * @returns {{ kind: 'order'|'availability'|'other', lines: Array<{code:string, quantity:number, unit:string, addOn:boolean}>, codes: string[] }}
 */
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
