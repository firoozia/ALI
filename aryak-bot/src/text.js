// Text clean-up for what people type: Persian and Arabic digits become Latin (numbers and codes are always Latin),
// and the Persian/Arabic letter variants are made equal so a name or a word matches however it was typed.

const DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

/** ۲۲۹ and ٢٢٩ become 229; the Arabic decimal sign between digits becomes ".". Nothing else changes. */
export const normalizeDigits = (s) => String(s ?? '').replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d]).replace(/(?<=\d)٫(?=\d)/g, '.').replace(/(?<=\d)٬(?=\d)/g, ',');

/** For matching only: digits, ي/ك/ى to ی/ک, no diacritics, tatweel or ZWNJ, "؟" to "?", lower case. */
export const normalizeLetters = (s) => normalizeDigits(String(s ?? '').normalize('NFKC'))
  .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/؟/g, '?')
  .replace(/[ً-ٰٟـ‌‍‎‏]/g, '')
  .toLowerCase();
