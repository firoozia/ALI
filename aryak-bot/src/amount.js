// WhatsApp highlights numbers by itself, and only part of an amount («9,» plain, «940.00» highlighted). Every money amount in a report for the team is made bold and
// the number is split by an invisible WORD JOINER (U+2060) at the comma and before the decimal point, so the automatic detection does not take a part of it. An invoice
// number (inv-9988) gets the joiner after the hyphen, so it stays plain. The text is the same when it is read; only a copy of it carries the invisible character.

export const WJ = String.fromCharCode(0x2060); // written as a code, never as the invisible character itself

// an amount with two decimals (never one followed by «*», «x» or a digit: «0.35*1400» is a size), optionally with its currency
const AMOUNT = new RegExp(`(?<![\\w.,${WJ}])(\\d{1,3}(?:,\\d{3})*\\.\\d{2}|\\d+\\.\\d{2})(?![\\d*${WJ}x×])(\\s?(?:AED|USD|EUR|SAR|GBP))?`, 'g');
const breakAmount = (n) => n.replace(/,/g, `,${WJ}`).replace(/\.(\d{2})$/, `${WJ}.$1`);

/** [text] with every money amount bold and unbroken by the auto-detection; an amount already inside a bold span only gets the breaker. Running it again changes nothing. */
export function markAmounts(text) {
  return String(text).split(/(\*[^*\n]+\*)/).map((part) => {
    const inBold = /^\*[^*\n]+\*$/.test(part);
    const body = inBold ? part.slice(1, -1) : part; // inside a bold span the closing star is not part of the text
    const out = body.replace(AMOUNT, (m, num, cur) => { const broken = breakAmount(num) + (cur || ''); return inBold ? broken : `*${broken}*`; }).replace(/\b(inv-)(?=\d)/gi, `$1${WJ}`);
    return inBold ? `*${out}*` : out;
  }).join('');
}
