// The usual Persian spelling of every QuickBooks customer («AL EBDA AL MALKI KITCHEN» -> «الابداع الملکی کیچن»), written once by the model in a batch, kept on the VM
// and shown to the owner as a list he can correct («نام فارسی <مشتری> = <فارسی>»). A Persian or spoken name is matched against it (and against the sound
// of the Latin name, translit.js) when a statement or an invoice names a customer in Persian letters. It only helps to FIND a customer; the answer is still
// a guess that the owner confirms (never an action by itself).

import fs from 'node:fs';
import path from 'node:path';

const LETTER = /[؀-ۿ]/;
export const hasPersianLetters = (s) => LETTER.test(String(s || ''));

export class PersianNames {
  constructor(dir = '') {
    this.file = dir ? path.join(dir, 'qbo-persian-names.json') : '';
    this.d = { names: {}, seeded: false };
    try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ }
  }
  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  get seeded() { return !!this.d.seeded; }
  /** The Persian spellings of a customer (the model's first, then the owner's: the owner's correction wins and is listed first). */
  of(id) { const e = this.d.names[String(id)]; return e ? [e.owner, e.model].filter(Boolean) : []; }
  setModel(id, persian) { const k = String(id); this.d.names[k] = { ...(this.d.names[k] || {}), model: String(persian).trim().slice(0, 120) }; }
  setOwner(id, persian) { const k = String(id); this.d.names[k] = { ...(this.d.names[k] || {}), owner: String(persian).trim().slice(0, 120) }; this.save(); }
  markSeeded() { this.d.seeded = true; this.save(); }
  count() { return Object.keys(this.d.names).length; }
}

const SYSTEM = `You write company names in Persian script. For each customer name given as "id<TAB>NAME" write the spelling a Persian speaker in a workshop would normally use (a transliteration of the sound: «AL EBDA AL MALKI KITCHEN» becomes «الابداع الملکی کیچن»; «AR-RAD INTERNATIONAL» becomes «الراد اینترنشنال»; «DANDY DOORS» becomes «دندی دورز»). Use Persian letters (ک and ی, not Arabic ك and ي). Drop only the legal ending (LLC, L.L.C, FZE, EST). Reply with JSON only: {"<id>": "<persian>", ...} for every id, nothing else.`;

/** One batch of customers -> { id: persian }. Never throws; {} when the model fails. */
export async function persianBatch({ client, config, customers }) {
  try {
    const res = await client.beta.messages.create({
      model: config.visionModel || 'claude-haiku-5-5', max_tokens: 4000, system: SYSTEM,
      messages: [{ role: 'user', content: customers.map((c) => `${c.id}\t${c.name}`).join('\n') }], output_config: { effort: 'low' },
    });
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const m = /\{[\s\S]*\}/.exec(text);
    const raw = m ? JSON.parse(m[0]) : {};
    const out = {};
    for (const [id, v] of Object.entries(raw)) if (typeof v === 'string' && hasPersianLetters(v)) out[String(id)] = v.replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim();
    return out;
  } catch { return {}; }
}

/** Seed (or top up) the store for [customers] = [{ id, name }]: batches of 80, the owner's corrections untouched. Returns how many names were written. */
export async function seedPersianNames({ store, client, config, customers }) {
  const todo = customers.filter((c) => c.id && c.name && !store.of(c.id).length);
  let written = 0;
  for (let i = 0; i < todo.length; i += 80) {
    const got = await persianBatch({ client, config, customers: todo.slice(i, i + 80) });
    for (const [id, v] of Object.entries(got)) { store.setModel(id, v); written += 1; }
  }
  if (written || !todo.length) store.markSeeded(); else store.save();
  store.save();
  return written;
}
