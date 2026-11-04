// A colleague posts a customer's request into a company group on the customer's behalf (many customers write to the
// office privately): "Bahar: 408 - 15 mtr", "for Bahar 229 20 m", or a name on one line and the lines below it. This reads
// who it is for and what is asked. The customer's name is then matched against the known names (see aliases.js).

import { normalizeDigits } from './text.js';
import { UNIT_RE, dropAttention, dropBrandWord, tailName, unitOf } from './codes.js';

const UNIT_WORDS = { m: 'm', mtr: 'm', mtrs: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm', roll: 'roll', rolls: 'roll', pc: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs', carton: 'carton', cartons: 'carton', ctn: 'carton' };
const UNIT = UNIT_RE;
const CODE = '(?:[a-z]{1,4}-?\\d+(?:-\\d+)?|\\d{2,5})';
const NUM = '(\\d+(?:\\.\\d+)?)';
const START = '(?:^|[\\s:،,])';

const SEPARATED = new RegExp(`${START}(${CODE})\\s*[-:=x]+\\s*\\(?\\s*${NUM}\\s*${UNIT}(?![A-Za-z\\u0620-\\u06FF])`, 'g'); // "603 - 15 mtr", "119-6 MTR"
const SPACED = new RegExp(`${START}(${CODE})\\s+\\(?\\s*${NUM}\\s*${UNIT}(?![A-Za-z\\u0620-\\u06FF])`, 'g'); // "229 20 m"

const clean = (s) => dropAttention(dropBrandWord(normalizeDigits(s))).toLowerCase().replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();
const STOP = new Set(['hi', 'hello', 'please', 'pls', 'add', 'also', 'code', 'ok', 'yes', 'no', 'new', 'order', 'thanks', 'send', 'check', 'لطفا', 'سلام']);

/** The words in front of the first order line, as a customer name; '' when they are not a name. */
function nameFrom(prefix) {
  const s = prefix.replace(/^(?:please\s+|pls\s+)?(?:new\s+)?(?:order\s+)?(?:for|to|برای|به)\s+/i, '').replace(/^(?:please\s+|pls\s+)?(?:add\s+)?(?:order\s+)?/i, '').replace(/[\s:،,\-–]+$/u, '').trim();
  // the assistant's name and the words around "order for customer X" are not part of the customer's name
  const LEAD = new Set(['آتوسا', 'atossa', 'سفارش', 'مشتری', 'order', 'customer', 'new', 'please', 'pls', 'for', 'برای', 'لطفا']);
  const words = s.split(' ').filter(Boolean);
  while (words.length > 1 && LEAD.has(words[0])) words.shift();
  const name = words.join(' ');
  if (!/\p{L}{2,}/u.test(name) || name.length > 60 || words.every((w) => STOP.has(w) || LEAD.has(w))) return '';
  return name;
}

function linesOf(row) {
  const found = [];
  for (const re of [SEPARATED, SPACED]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(row))) found.push({ at: m.index + m[0].indexOf(m[1]), end: re.lastIndex, code: m[1].toUpperCase(), quantity: Number(m[2]), unit: UNIT_WORDS[m[3]] || unitOf(m[3]) });
  }
  found.sort((a, b) => a.at - b.at);
  const out = [];
  for (const f of found) if (!out.length || f.at >= out.at(-1).end) out.push(f);
  return out;
}

/**
 * @returns {{ customer: string, lines: Array<{code:string, quantity:number, unit:string, addOn:boolean}> } | null}
 * null unless a customer is named AND at least one line (code, quantity and unit) is given.
 */
export function parseOnBehalf(text) {
  const rows = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);
  let customer = '';
  let nameOnly = '';
  const lines = [];
  for (const row of rows) {
    const found = linesOf(row);
    if (!found.length) {
      // a line with no digits that can be a name ("Bahar:") before the order lines
      if (!lines.length && !/\d/.test(row) && !nameOnly) nameOnly = nameFrom(row);
      continue;
    }
    const addOn = /(^|\s)add\b|\balso\b/.test(row);
    if (!customer && !lines.length) customer = nameFrom(row.slice(0, found[0].at));
    for (const f of found) lines.push({ code: f.code, quantity: f.quantity, unit: f.unit, addOn });
  }
  if (!customer) customer = nameOnly;
  // "505=16M al ebda": the customer after the last line
  if (!customer && lines.length) {
    const last = rows.filter((r) => linesOf(r).length).at(-1);
    customer = tailName(last.slice(linesOf(last).at(-1).end));
  }
  return customer && lines.length ? { customer, lines } : null;
}
