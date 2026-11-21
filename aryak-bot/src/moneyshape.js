// THE OWNER'S RULE (21/11): money in the Confirmation group and the expenses group is written in a few fixed shapes, each with its amount and AED:
//   CASH RECEIVED FROM <customer> <amount> AED        money received in cash
//   TRANSFER BANK FROM <customer> <amount> AED        money received by the bank («BANK TRANSFER FROM …» too)
//   CHEQUE RECEIVED FROM <customer> <amount> AED      a cheque received (a date after it is the cheque's date)
//   TRANSFER TO BOSS <amount> AED                     cash handed to the boss
//   CASH PAID FOR <what> <amount> AED                 a company expense paid in cash
//   ADVANCE TO <employee> <amount> AED                a salary advance
// A small spelling slip in the opening words («CASH RECIVED FORM», «CHEQ RECEIVED», «TRANSFAR TO BOS») is read as meant. Anything else with an amount
// is NOT recorded: the assistant asks in the group what it is for, at once.

const SAME = {
  CASH: ['CASH', 'KASH', 'CAHS', 'CSH'],
  RECEIVED: ['RECEIVED', 'RECIVED', 'RECIEVED', 'RECEVED', 'RECEIVD', 'RECEVIED', 'RECEIVE', 'RECIVE', 'RCVD', 'RECD', 'RCVED'],
  FROM: ['FROM', 'FORM', 'FRM', 'FRON'],
  TRANSFER: ['TRANSFER', 'TRANSFAR', 'TRANSFOR', 'TRANFER', 'TRASFER', 'TRANSFERED', 'TRANSFERRED', 'TRANSFR', 'TRNSFER'],
  BANK: ['BANK', 'BNK', 'BANC'],
  TO: ['TO', 'T0'],
  BOSS: ['BOSS', 'BOS', 'BOOS', 'BOSSS'],
  CHEQUE: ['CHEQUE', 'CHEQ', 'CHECK', 'CHEK', 'CHQ', 'CHEAQUE', 'CHEQUES', 'CHECQUE', 'CHAQUE'],
  PAID: ['PAID', 'PAYED', 'PAD', 'PIAD'],
  FOR: ['FOR', 'FRO', 'FOE'],
  ADVANCE: ['ADVANCE', 'ADVANS', 'ADVANSE', 'ADVENCE', 'ADVNCE', 'ADVANCED'],
};
/** The edit distance of two short words (one slip in four letters is a slip). */
function dist(a, b) {
  const m = a.length; const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
/** Is the typed word the word [key] (a known spelling, or one slip away; two slips in a word of seven letters or more)? */
export function sameWord(typed, key) {
  const w = String(typed || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!w) return false;
  if (SAME[key].includes(w)) return true;
  if (key === 'TO' || key === 'FOR') return false; // short words: only the spellings listed
  const allow = w.length >= 7 ? 2 : 1;
  return SAME[key].some((s) => Math.abs(s.length - w.length) <= allow && dist(w, s) <= allow);
}

// the shapes: the opening words (an optional word in brackets) and what the money is
const SHAPES = [
  { words: ['CASH', 'RECEIVED', '[FROM]'], kind: 'cash', group: 'confirmation' },
  { words: ['TRANSFER', 'BANK', '[FROM]'], kind: 'transfer', group: 'confirmation' },
  { words: ['BANK', 'TRANSFER', '[FROM]'], kind: 'transfer', group: 'confirmation' },
  { words: ['CHEQUE', 'RECEIVED', '[FROM]'], kind: 'cheque', group: 'confirmation' },
  { words: ['TRANSFER', 'TO', 'BOSS'], kind: 'cash_to_boss', group: 'both' },
  { words: ['CASH', 'PAID', '[FOR]'], kind: 'cash_expense', group: 'expenses' },
  { words: ['ADVANCE', 'TO'], kind: 'salary_advance', group: 'both' },
];

const AED_NEAR = /(?:\bAED|درهم)\s*[:=]?\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:AED\b|درهم)/i;
const digits = (s) => String(s || '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g, '.').replace(/٬/g, ',');
/** Does the message hold an amount at all (a number that could be money: not a lone digit of a list, not a phone number)? */
export const hasAmount = (text) => /(?<![\d.])\d{2,6}(?:[.,]\d+)?(?![\d])/.test(digits(text).replace(/(?<![A-Za-z0-9])0\d{8,}/g, ' ')) || AED_NEAR.test(digits(text));

/**
 * The money of a message in the fixed shapes: { kind, name, amount, chequeDate? } (name: the customer, the employee, or what was paid for);
 * { kind, noAed: true, amount } when the shape is right but AED is missing beside the amount; null when it is not one of the shapes.
 * [group] 'confirmation' or 'expenses': each group has its own shapes (and the two that belong to both).
 */
export function readMoneyShape(text, group = 'confirmation') {
  const t = digits(text).replace(/\s+/g, ' ').trim();
  const toks = t.split(' ');
  for (const shape of SHAPES) {
    if (shape.group !== 'both' && shape.group !== group) continue;
    let i = 0; let ok = true;
    for (const w of shape.words) {
      const optional = w.startsWith('[');
      const key = w.replace(/[[\]]/g, '');
      if (i < toks.length && sameWord(toks[i], key)) { i += 1; continue; }
      if (!optional) { ok = false; break; }
    }
    if (!ok) continue;
    const invoices = [];
    const rest = toks.slice(i).join(' ').replace(/(?:\binv(?:oice)?s?\b|فاکتور)\.?\s*(?:no\.?|number|#|شماره)?\s*[-:#]?\s*(\d{3,6}(?:\s*[/,&]\s*\d{3,6})*)/gi, (m, run) => { for (const n of run.split(/[\s/,&]+/).filter(Boolean)) invoices.push(`inv-${n}`); return ' '; }).replace(/\s+/g, ' ').trim();
    const near = AED_NEAR.exec(rest);
    const anyNum = /(\d[\d,]*(?:\.\d+)?)/.exec(rest.replace(/\b\d{1,2}\s*[/-]\s*\d{1,2}(?:\s*[/-]\s*\d{2,4})?\b/g, ' '));
    if (!near) return anyNum ? { kind: shape.kind, noAed: true, amount: Number(anyNum[1].replace(/,/g, '')), name: rest.replace(anyNum[0], ' ').replace(/[*:=,.\-–]+/g, ' ').replace(/\s+/g, ' ').trim() } : { kind: shape.kind, noAmount: true, ...(invoices.length ? { invoices } : {}) };
    const amount = Number(String(near[1] || near[2]).replace(/,/g, ''));
    let chequeDate = '';
    let name = `${rest.slice(0, near.index)} ${rest.slice(near.index + near[0].length)}`;
    name = name.replace(/(?:\b(?:dated?|due(?:\s+on)?|on|date)\s*[:=]?\s*)?\b(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(\d{2,4}))?\b/gi, (all, d, m, y) => {
      if (shape.kind === 'cheque' && Number(d) <= 31 && Number(m) <= 12) { const year = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : new Date().getUTCFullYear(); chequeDate = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
      return ' ';
    });
    name = name.replace(/\b(?:CASH|AED|DHS?|PDC|RECEIVED|FROM|BY\b.*$)/gi, ' ').replace(/[*:=,.\-–]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!(amount > 0)) return { kind: shape.kind, noAmount: true };
    return { kind: shape.kind, name, amount, ...(invoices.length ? { invoices } : {}), ...(chequeDate ? { chequeDate } : {}), ...(/\*\s*$/.test(t) ? { noInvoice: true } : {}) };
  }
  return null;
}

/** The question asked in the group for a message with an amount that is not one of the shapes. */
export function whatForText(group = 'confirmation') {
  return group === 'expenses'
    ? 'What is this amount for? Nothing was recorded. Please write it as: CASH PAID FOR <what> <amount> AED, ADVANCE TO <name> <amount> AED, or TRANSFER TO BOSS <amount> AED.'
    : 'What is this amount for? Nothing was recorded. Please write it as: CASH RECEIVED FROM <customer> <amount> AED, TRANSFER BANK FROM <customer> <amount> AED, CHEQUE RECEIVED FROM <customer> <amount> AED, or TRANSFER TO BOSS <amount> AED.';
}
