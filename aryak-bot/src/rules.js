// Rules the owner teaches the assistant in words ("Atossa, from now on ... / do not take ... into account"). An instruction
// from an admin is stored at once as a durable, versioned rule: listed by a command, removable, put into the prompt. A
// colleague's teaching never comes here; it goes to the review list of the learning store.

import fs from 'node:fs';
import path from 'node:path';
import { normalizeLetters } from './text.js';

const TEACHING = /(از\s+این\s+به\s+بعد|از\s+حالا\s+به\s+بعد|از\s+الان|در\s+نظر\s+نگیر|حساب\s+نکن|یادت\s+باشد|یادت\s+باشه|یاد\s+بگیر|فراموش\s+نکن|\bfrom now on\b|\bremember that\b|\bdo not take\b)/iu;
const MAX = 400;

/** An admin's message that teaches a rule -> the rule text without the assistant's name; else ''. */
export function ruleFrom(text, names = []) {
  let s = String(text || '').trim();
  if (!s || s.length > 1200 || /[?؟]\s*$/.test(s) || !TEACHING.test(s)) return '';
  for (const n of names) s = s.replace(new RegExp(`^[@\\s]*${String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s,،:؛-]*`, 'iu'), '');
  s = s.replace(/\s+/g, ' ').trim();
  return s.length >= 8 ? s.slice(0, MAX) : '';
}

/** "قانون‌ها" -> list; "حذف قانون 3" -> remove 3; else null. */
export function parseRuleCommand(text) {
  const s = normalizeLetters(String(text || '')).trim();
  if (/^قانون‌?ها$|^قوانین$/u.test(s)) return { list: true };
  const m = /^حذف\s+قانون\s+(\d+)$/u.exec(s);
  return m ? { remove: Number(m[1]) } : null;
}

export class Rules {
  constructor(dir = '') {
    this.file = dir ? path.join(dir, 'rules.json') : '';
    this.items = [];
    this.nextId = 1;
    this.version = 0;
    try {
      if (this.file) {
        const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.items = Array.isArray(d.items) ? d.items : [];
        this.nextId = Number(d.nextId) || this.items.reduce((m, r) => Math.max(m, r.id), 0) + 1;
      }
    } catch { /* none yet */ }
  }

  save() {
    if (!this.file) return;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify({ items: this.items, nextId: this.nextId })); } catch { /* best effort */ }
  }

  add(text, at = new Date().toISOString()) {
    const t = String(text || '').trim();
    if (!t) return null;
    const same = this.items.find((r) => r.text === t);
    if (same) return same;
    const item = { id: this.nextId++, text: t, at };
    this.items.push(item);
    this.version++;
    this.save();
    return item;
  }

  remove(id) {
    const n = this.items.length;
    this.items = this.items.filter((r) => r.id !== id);
    if (this.items.length === n) return false;
    this.version++;
    this.save();
    return true;
  }

  list() {
    return this.items.length ? ['قانون‌هایی که مالک آموخته است:', ...this.items.map((r) => `${r.id}. ${r.text}`), 'برای برداشتن: حذف قانون <شماره>'].join('\n')
      : 'قانونی ثبت نشده است. هر دستور مالک که با «از این به بعد» یا «در نظر نگیر» بیاید همان لحظه ثبت می‌شود.';
  }

  promptText() {
    return this.items.length ? ['Rules taught by the owner in his own words (always follow them; they come before anything learned from colleagues):', ...this.items.map((r) => `- ${r.text}`)].join('\n') : '';
  }
}
