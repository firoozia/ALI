// Customer names: the same customer is written short, long, in Arabic or English, or as the name of his group. A small
// list the owner extends by command ("اسم دیگر <مشتری> = <نام>") maps every spelling to one name; without an entry the
// match is by one name containing the other.

import { nameFallback } from './namelead.js';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeLetters } from './text.js';

const norm = (s) => normalizeLetters(String(s || '')).replace(/\b(llc|l\.l\.c|co|company|ltd|fze|trading|est)\b/g, '').replace(/[^a-z0-9؀-ۿ]/g, '');
// "al ebda", "alebda", "ebdaa" are one name: drop a leading "al" and doubled letters
const fold = (s) => norm(s).replace(/^al(?=.{4})/, '').replace(/(.)\1+/g, '$1');
const same = (a, b) => {
  const x = norm(a); const y = norm(b);
  if (!x || !y) return false;
  if (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)))) return true;
  const fx = fold(a); const fy = fold(b);
  return Math.min(fx.length, fy.length) >= 4 && fx === fy;
};

export class Aliases {
  constructor(dir = '') {
    this.file = dir ? path.join(dir, 'aliases.json') : '';
    this.map = {}; // customer -> [other names]
    try { if (this.file) this.map = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* none yet */ }
  }

  add(customer, alias) {
    const c = String(customer).trim();
    const a = String(alias).trim();
    if (!c || !a) return false;
    const key = Object.keys(this.map).find((k) => same(k, c)) || c;
    const list = this.map[key] || [];
    if (!list.some((x) => norm(x) === norm(a)) && norm(key) !== norm(a)) list.push(a);
    this.map[key] = list;
    this.save();
    return true;
  }

  /** Takes one other name off a customer (the customer stays); true when it was there. */
  remove(customer, alias) {
    const key = Object.keys(this.map).find((k) => same(k, customer));
    if (!key) return false;
    const n = this.map[key].length;
    this.map[key] = this.map[key].filter((x) => norm(x) !== norm(alias));
    if (this.map[key].length === n) return false;
    if (!this.map[key].length) delete this.map[key];
    this.save();
    return true;
  }

  save() {
    if (!this.file) return;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.map)); } catch { /* best effort */ }
  }

  /**
   * The one name for [name]: a listed customer or one of his other names, else a known group label (the customer part of
   * a group name), else the name as written. [known]: group labels.
   */
  resolve(name, known = []) {
    const n = String(name || '').trim();
    if (!n) return '';
    for (const [customer, others] of Object.entries(this.map)) if (same(customer, n) || others.some((o) => same(o, n))) return customer;
    return known.find((k) => same(k, n)) || n;
  }

  list() {
    const rows = Object.entries(this.map).map(([c, o]) => `${c} = ${o.join('، ') || '—'}`);
    return rows.length ? ['نام‌های دیگر مشتری‌ها:', ...rows].join('\n') : 'نام دیگری ثبت نشده است. بنویسید: اسم دیگر <مشتری> = <نام>';
  }
}

/** "اسم دیگر Bahar Design = بهار" -> { customer, alias }; "اسم‌های دیگر" -> { list: true }; else null. */
function parseAliasCommandImpl(text) {
  const s = String(text || '').trim();
  if (/^اسم‌?های\s+دیگر$/.test(s)) return { list: true };
  const m = /^(?:اسم|نام)\s+دیگر\s+(.+?)\s*=\s*(.+)$/u.exec(s);
  return m ? { customer: m[1].trim(), alias: m[2].trim() } : null;
}

/** parseAliasCommand as written, and when it reads nothing, once more with a leading «Atossa» taken off. */
export const parseAliasCommand = nameFallback(parseAliasCommandImpl);
