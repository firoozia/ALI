// On-read repair of OLD stored cut rows. A post written in a group shared by two customers («NUQOOSH & AL EBDA») got the name mapped to the group (one of the two) before the typed name was kept.
// Such a row has no customerTyped. When its code and day match a sheet OUT row of ANOTHER customer within the tolerance (alone, or as the sum of the day's such rows), the row takes the OUT row's
// customer. Rows of the same day and code that are smaller than the one that fits are parts of it: they are dropped from the copy, never counted twice. Pure: the stored events are not changed.
const tol = (q) => Math.max(1.5, 0.06 * q);
const key = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const digits = (c) => (String(c || '').match(/\d{2,5}/) || [''])[0];
const dayOf = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

export function repairSharedCuts(events, outs, sharedNames = [], options = {}) {
  const timeZone = options.timeZone || 'Asia/Dubai';
  if (!Array.isArray(outs) || !outs.length || !sharedNames.length) return events;
  const shared = new Set(sharedNames.map(key));
  const suspects = events.filter((e) => e.type === 'cut' && !e.internal && !e.simulated && !e.customerTyped && shared.has(key(e.customer)) && (e.lines || []).length === 1);
  if (!suspects.length) return events;
  const pools = new Map(); // customer|code|day -> { customer, code, day, qty }
  for (const r of outs) {
    const code = digits(r.code); const qty = Number(r.qty) || 0; const cust = String(r.customer || '').trim();
    if (!code || !(qty > 0) || !cust || !Number(r.at)) continue;
    const day = dayOf(Number(r.at), timeZone);
    const k = key(cust) + '|' + code + '|' + day;
    const p = pools.get(k) || { customer: cust, code, day, qty: 0 }; p.qty += qty; pools.set(k, p);
  }
  const drop = new Set(); const patch = new Map();
  const groups = new Map(); // code|day -> suspects
  for (const e of suspects) {
    const l = e.lines[0]; const code = digits(l.code); const q = Number(l.invoiceQuantity) > 0 ? Number(l.invoiceQuantity) : Number(l.quantity);
    if (!code || !(q > 0)) continue;
    const k = code + '|' + dayOf(e.at, timeZone);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ e, q });
  }
  for (const [k, list] of groups) {
    const parts = k.split('|'); const code = parts[0]; const day = parts[1];
    const others = [...pools.values()].filter((p) => p.code === code && p.day === day && key(p.customer) !== key(list[0].e.customer));
    if (!others.length) continue;
    const sum = list.reduce((s, x) => s + x.q, 0);
    let best = null;
    for (const p of others) {
      const alone = list.filter((x) => Math.abs(x.q - p.qty) <= tol(p.qty)).sort((a, b) => Math.abs(a.q - p.qty) - Math.abs(b.q - p.qty))[0];
      const fit = alone || (Math.abs(sum - p.qty) <= tol(p.qty) ? list.slice().sort((a, b) => b.q - a.q)[0] : null);
      if (!fit) continue;
      const d = Math.abs((alone ? fit.q : sum) - p.qty);
      if (!best || d < best.d) best = { p, fit, alone: !!alone, d };
    }
    if (!best) continue;
    const change = { customer: best.p.customer, customerTyped: best.p.customer, repaired: true };
    patch.set(best.fit.e.ref, change);
    for (const x of list) {
      if (x === best.fit) continue;
      if (!best.alone || x.q < best.fit.q) drop.add(x.e.ref); // a part of the larger cut of that day: merged, not counted twice
    }
    if (!best.alone) change.lines = [{ ...best.fit.e.lines[0], quantity: Math.round(sum * 100) / 100, invoiceQuantity: undefined }];
  }
  if (!patch.size) return events;
  return events.filter((e) => !drop.has(e.ref)).map((e) => (patch.has(e.ref) ? { ...e, ...patch.get(e.ref) } : e));
}
