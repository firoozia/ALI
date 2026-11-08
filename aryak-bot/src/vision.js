// Reading a picture (or a scanned page) in two steps: the cheap model first (VISION_MODEL), the strong one (VISION_ESCALATE_MODEL) on the SAME
// input only when an objective check of the first answer fails. The model's own confidence never decides that; the checks are facts: the reader says
// "unreadable", a code is not in the catalogue, the lines of an invoice do not add up, a required field is missing. If the strong model's
// answer passes the checks it is used; if both fail, the later answer is returned and the caller does what it always did (ask back, say unreadable).

let meter = null;
/** The CostMeter that counts the photo reads (set once by the program). */
export function setVisionMeter(m) { meter = m; }

export const DEFAULT_VISION_MODEL = 'claude-haiku-5-5';
export const DEFAULT_ESCALATE_MODEL = 'claude-sonnet-5-5';

/**
 * [call]: async (model) => the API response; [parse]: (res) => value | null; [check]: (value) => { ok: true } | { ok: false, reason } (may be async);
 * [cost]: a CostMeter (or null). Returns { value, res, model, escalated, reason, checked } where [checked] is the verdict of the answer returned.
 * Never throws for an API error of the strong step (the first answer is kept); an error of the first step throws.
 */
export async function visionRead({ config, call, parse, check, cost = meter, visual = true, log = () => {} }) {
  const first = config.visionModel || DEFAULT_VISION_MODEL;
  const strong = config.visionEscalateModel || DEFAULT_ESCALATE_MODEL;
  const res1 = await call(first);
  if (visual) cost?.photo({ escalated: false });
  let v1 = null;
  try { v1 = parse(res1); } catch { v1 = null; }
  const c1 = v1 === null || v1 === undefined ? { ok: false, reason: 'parse' } : await check(v1);
  if (c1.ok) return { value: v1, res: res1, model: first, escalated: false, reason: '', checked: c1 };
  if (!strong || strong === first) return { value: v1, res: res1, model: first, escalated: false, reason: c1.reason, checked: c1 };
  log(`vision: ${first} failed a check (${c1.reason}${c1.detail ? `: ${c1.detail}` : ''}); reading the same input again with ${strong}`);
  let res2;
  try { res2 = await call(strong); } catch (e) { log(`vision: the second read failed: ${e.message}`); return { value: v1, res: res1, model: first, escalated: false, reason: c1.reason, checked: c1 }; }
  if (visual) cost?.photo({ escalated: true, reason: c1.reason });
  let v2 = null;
  try { v2 = parse(res2); } catch { v2 = null; }
  const c2 = v2 === null || v2 === undefined ? { ok: false, reason: 'parse' } : await check(v2);
  if (c2.ok) return { value: v2, res: res2, model: strong, escalated: true, reason: c1.reason, checked: c2 };
  log(`vision: ${strong} also failed (${c2.reason}${c2.detail ? `: ${c2.detail}` : ''})`);
  return { value: v2 ?? v1, res: v2 ? res2 : res1, model: v2 ? strong : first, escalated: true, reason: c1.reason, checked: c2 };
}

const num = (x) => (x === null || x === undefined || x === '' || Number.isNaN(Number(x)) ? null : Number(x));

/**
 * The facts about an invoice the reader printed: number, date, customer and total are all there, and the lines add up to the subtotal and the
 * subtotal plus VAT to the total, each within [tol] plus a cent for every ten lines of rounding. Returns { ok } or { ok: false, reason: 'missing' | 'totals', detail }.
 */
export function invoiceChecks(inv, tol = 0.05) {
  if (!inv || typeof inv !== 'object') return { ok: false, reason: 'missing', detail: 'no invoice' };
  const missing = [];
  if (!String(inv.number || '').trim()) missing.push('number');
  if (!String(inv.date || '').trim()) missing.push('date');
  if (!String(inv.customer || '').trim()) missing.push('customer');
  if (num(inv.total) === null) missing.push('total');
  if (missing.length) return { ok: false, reason: 'missing', detail: missing.join(',') };
  const lines = Array.isArray(inv.lines) ? inv.lines : [];
  const slack = tol + 0.01 * Math.ceil(lines.length / 10);
  const sub = num(inv.subtotal); const vat = num(inv.vat); const total = num(inv.total);
  const sum = lines.map((l) => num(l?.line_total)).filter((x) => x !== null).reduce((s, x) => s + x, 0);
  const haveLines = lines.some((l) => num(l?.line_total) !== null);
  if (haveLines && sub !== null && Math.abs(sum - sub) > slack) return { ok: false, reason: 'totals', detail: `lines ${sum.toFixed(2)} vs subtotal ${sub}` };
  if (sub !== null && vat !== null && Math.abs(sub + vat - total) > slack) return { ok: false, reason: 'totals', detail: `subtotal+vat ${(sub + vat).toFixed(2)} vs total ${total}` };
  if (haveLines && sub === null && vat === null && inv.prices_include_vat !== true && Math.abs(sum - total) > slack) return { ok: false, reason: 'totals', detail: `lines ${sum.toFixed(2)} vs total ${total}` };
  return { ok: true };
}
