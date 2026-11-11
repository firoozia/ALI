// Following ARYAK's own driver from the delivery group's posts (nothing here talks to QuickBooks or to a customer group).
// A «… DISPATCHED» post opens a RUN with its stops (a customer and a quantity each); a «<customer> delivered» post closes that customer's stop in the newest run that still has it open.
// «… PICKED UP BY <courier>» is not our driver: it is kept as a pickup by that courier, outside every run. Everything is derived from the tracker's delivery events (so the test group's
// simulated posts, which live in the test tracker, drive exactly the same logic).
import { brandWords, nearWord } from './cutaliases.js';
import { sameCutCustomer } from './cuts.js';
import { sameBrandForm } from './expenses.js';

const dayOf = (ms, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
export const hhmm = (ms, timeZone) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
const nameOf = (e) => String(e.customer || e.customerTyped || '').trim();
const show = (n) => String(n || '').toUpperCase();

/** The same customer written two ways: the plain rules, an approved alias, a doubled letter or plural, or one letter wrong in every brand word (AL lTQAN / AL ITQAN). */
export function sameStop(a, b, aliasOf = () => '') {
  if (!a || !b) return false;
  if (sameCutCustomer(a, b) || sameBrandForm(a, b)) return true;
  if (aliasOf(a) && sameCutCustomer(aliasOf(a), b)) return true;
  if (aliasOf(b) && sameCutCustomer(aliasOf(b), a)) return true;
  const x = brandWords(a); const y = brandWords(b);
  const [few, many] = x.length <= y.length ? [x, y] : [y, x];
  return few.length > 0 && few.every((w) => many.some((v) => nearWord(w, v)));
}

const parcels = (stop) => (stop.quantity > 0 ? stop.quantity : 1);
const sum = (stops) => stops.reduce((s, x) => s + parcels(x), 0);
const packages = (n) => `${n} package${n === 1 ? '' : 's'}`;

/**
 * The day's driver picture: { runs: [{ at, ref, stops: [{ customer, quantity, unit, deliveredAt }] }], pickups: [{ at, customer, by }], strays: [{ at, customer }] }.
 * A run is one dispatch post (its events share a message id; an old event without one is grouped with the ones posted within a minute).
 */
export function driverDay(events, { day, timeZone = 'Asia/Dubai', aliasOf = () => '', display = (n) => n }) {
  const mine = events.filter((e) => e.type === 'delivery' && e.status && !e.internal && dayOf(e.at, timeZone) === day)
    .map((e, i) => ({ e, i })).sort((p, q) => p.e.at - q.e.at || p.i - q.i).map((p) => p.e);
  const runs = []; const pickups = []; const strays = [];
  for (const e of mine) {
    if (e.status === 'dispatched') {
      const last = runs[runs.length - 1];
      const same = last && (e.msg ? last.msg === e.msg : !last.msg && e.at - last.lastAt <= 60 * 1000);
      const stop = { customer: display(nameOf(e)), raw: nameOf(e), quantity: Number(e.delivered?.quantity) || 0, unit: e.delivered?.unit || '', deliveredAt: null };
      if (same) { last.stops.push(stop); last.lastAt = e.at; } else runs.push({ at: e.at, lastAt: e.at, ref: e.ref, msg: e.msg || '', stops: [stop] });
    } else if (e.status === 'picked-up') {
      pickups.push({ at: e.at, customer: display(nameOf(e)), by: String(e.by || '').trim() });
    }
  }
  for (const e of mine) {
    if (e.status !== 'delivered') continue;
    const who = nameOf(e);
    let hit = null;
    for (const run of [...runs].reverse()) { // the newest dispatch that is already out and still waits for this customer
      if (run.at > e.at) continue;
      hit = run.stops.find((s) => s.deliveredAt === null && sameStop(s.raw, who, aliasOf));
      if (hit) break;
    }
    if (hit) hit.deliveredAt = e.at; else strays.push({ at: e.at, customer: display(who) });
  }
  return { runs, pickups, strays };
}

const stopsList = (stops, timeZone) => stops.map((s) => `${show(s.customer)}${s.deliveredAt ? ` ${hhmm(s.deliveredAt, timeZone)}` : ''}`).join(', ');
const pickupLine = (pickups, timeZone) => `Courier pickups today: ${pickups.map((p) => `${show(p.customer)} (${p.by ? `${p.by.toUpperCase()} ` : ''}${hhmm(p.at, timeZone)})`).join(', ')}.`;

/** The answer to «where is the driver»: from today's runs, the newest one that still has stops open (else the newest); never «I cannot see». */
export function whereText(events, { now = Date.now(), timeZone = 'Asia/Dubai', aliasOf = () => '', display } = {}) {
  const d = driverDay(events, { day: dayOf(now, timeZone), timeZone, aliasOf, display });
  if (!d.runs.length) return ['Nothing was dispatched with our driver today.', d.pickups.length ? pickupLine(d.pickups, timeZone) : ''].filter(Boolean).join('\n');
  const open = d.runs.filter((r) => r.stops.some((s) => !s.deliveredAt));
  const run = open.length ? open[open.length - 1] : d.runs[d.runs.length - 1];
  const at = hhmm(run.at, timeZone);
  const done = run.stops.filter((s) => s.deliveredAt).sort((a, b) => a.deliveredAt - b.deliveredAt);
  const left = run.stops.filter((s) => !s.deliveredAt);
  const lines = [];
  if (!left.length) lines.push(`The driver delivered all ${packages(sum(run.stops))} of the ${at} dispatch (${stopsList(done, timeZone)}) and is on his way back.`);
  else if (!done.length) lines.push(`The ${at} dispatch (${run.stops.map((s) => `${show(s.customer)} ${parcels(s)}`).join(', ')}) is out; no delivery is confirmed yet.`);
  else lines.push(`Last delivery: ${show(done[done.length - 1].customer)} at ${hhmm(done[done.length - 1].deliveredAt, timeZone)}. Still to deliver: ${left.map((s) => show(s.customer)).join(', ')} (${sum(left)} of ${sum(run.stops)} left from the ${at} dispatch).`);
  const others = open.filter((r) => r !== run);
  if (others.length) lines.push(`An earlier dispatch (${others.map((r) => hhmm(r.at, timeZone)).join(', ')}) still has stops open: ${others.flatMap((r) => r.stops.filter((s) => !s.deliveredAt).map((s) => show(s.customer))).join(', ')}.`);
  return lines.join('\n');
}

/** True when [text] asks where our driver is (English or Persian; a voice note arrives as text the same way). */
export function isDriverQuestion(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  return /\bwhere\b[^.?!]{0,30}\bdriver\b/i.test(s) || /\bdriver\b[^.?!]{0,20}\b(location|reached|status|now)\b/i.test(s) || /\b(has|did)\s+(the\s+)?driver\s+(reach|arriv|deliver|left)/i.test(s)
    || /\bhow\s+far\b[^.?!]{0,15}\bdriver\b/i.test(s) || /راننده[^.؟?!]{0,30}(کجا|رسید|موقعیت|لوکیشن)/u.test(s) || /کجا[^.؟?!]{0,30}راننده/u.test(s);
}

/**
 * When [event] (a «delivered» post just recorded in [events]) closed the LAST open stop of a run: the one short line for the delivery group; else ''.
 * Compared with the picture before this post, so it is said once per run.
 */
export function runDoneLine(events, event, { timeZone = 'Asia/Dubai', aliasOf = () => '', display } = {}) {
  if (event.status !== 'delivered') return '';
  const day = dayOf(event.at, timeZone);
  const before = driverDay(events.filter((e) => e !== event), { day, timeZone, aliasOf, display });
  const after = driverDay(events, { day, timeZone, aliasOf, display });
  const wasOpen = before.runs.map((r) => r.stops.some((s) => !s.deliveredAt));
  for (const [i, run] of after.runs.entries()) {
    const complete = run.stops.every((s) => s.deliveredAt);
    if (complete && wasOpen[i]) {
      const names = run.stops.map((s) => show(s.customer)).join(', ');
      return `All ${packages(sum(run.stops))} of the ${hhmm(run.at, timeZone)} dispatch delivered (${names}). Driver on the way back.`;
    }
  }
  return '';
}

/** The evening report's lines for [day]: each dispatch with what was delivered and what is NOT confirmed, the courier pickups, deliveries that match no dispatch. */
export function driverEveningLines(events, { day, timeZone = 'Asia/Dubai', aliasOf = () => '', display }) {
  const d = driverDay(events, { day, timeZone, aliasOf, display });
  if (!d.runs.length && !d.pickups.length && !d.strays.length) return [];
  const lines = ['Driver and couriers today:'];
  for (const run of d.runs) {
    const done = run.stops.filter((s) => s.deliveredAt); const left = run.stops.filter((s) => !s.deliveredAt);
    lines.push(`- ${hhmm(run.at, timeZone)} dispatch: ${sum(done)} of ${sum(run.stops)} delivered${done.length ? ` (${stopsList(done, timeZone)})` : ''}${left.length ? `; NOT confirmed delivered: ${left.map((s) => show(s.customer)).join(', ')}` : ''}`);
  }
  if (d.pickups.length) lines.push(`- ${pickupLine(d.pickups, timeZone)}`);
  if (d.strays.length) lines.push(`- Delivered with no matching dispatch: ${d.strays.map((s) => `${show(s.customer)} ${hhmm(s.at, timeZone)}`).join(', ')}`);
  return lines;
}

/** A request for the day's DELIVERY report («delivery report for the whole day?», «گزارش تحویل»), or, in the delivery group itself, «for the full day?» after it. */
export function isDeliveryReportAsk(text, inDeliveryGroup = false) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (/\bdeliver\w*\s+report\b|\breport\s+(?:of|on|for)\s+(?:the\s+)?deliver|\btoday'?s\s+deliver|\bdeliveries\s+(?:of\s+|for\s+)?(?:today|the\s+day)\b|گزارش\s+تحویل/i.test(s)) return true;
  return inDeliveryGroup && /^(?:and\s+)?(?:for\s+)?(?:the\s+)?(?:whole|full|entire)\s+day\b[^.]{0,20}$/i.test(s.replace(/[?!]+$/, ''));
}

/** The day's delivery report: our driver's dispatches with delivered times and what is not confirmed, the courier and client pickups with times, deliveries with no dispatch. */
export function deliveryDayText(events, { now = Date.now(), timeZone = 'Asia/Dubai', aliasOf = () => '', display } = {}) {
  const day = dayOf(now, timeZone);
  const d = driverDay(events, { day, timeZone, aliasOf, display });
  const [y, m, dd] = day.split('-');
  if (!d.runs.length && !d.pickups.length && !d.strays.length) return `Delivery report — ${dd}/${m}\nNothing was dispatched or picked up today.`;
  const lines = [`Delivery report — ${dd}/${m}`];
  if (d.runs.length) {
    lines.push('Our driver:');
    for (const run of d.runs) {
      const done = run.stops.filter((s) => s.deliveredAt).sort((a, b) => a.deliveredAt - b.deliveredAt); const left = run.stops.filter((s) => !s.deliveredAt);
      lines.push(`- ${hhmm(run.at, timeZone)} dispatch, ${packages(sum(run.stops))}: ${done.length ? `delivered ${stopsList(done, timeZone)}` : 'nothing delivered yet'}${left.length ? `; NOT confirmed delivered: ${left.map((s) => show(s.customer)).join(', ')}` : ''}`);
    }
  } else lines.push('Our driver: nothing dispatched.');
  if (d.pickups.length) lines.push(`Courier and client pickups: ${d.pickups.map((p) => `${show(p.customer)} (${p.by ? `${p.by.toUpperCase()} ` : ''}${hhmm(p.at, timeZone)})`).join(', ')}.`);
  if (d.strays.length) lines.push(`Delivered with no matching dispatch: ${d.strays.map((s) => `${show(s.customer)} ${hhmm(s.at, timeZone)}`).join(', ')}.`);
  return lines.join('\n');
}

/** «Yes this good», «thanks», «perfect»: a short thanks or approval that needs no report, only a short acknowledgement. */
export function isAckText(text) {
  const s = String(text || '').replace(/[.!?؟,،]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || /[0-9#۰-۹]/.test(s) || s.split(' ').length > 6) return false;
  return /\b(?:good|great|perfect|nice|thanks|thank\s+you|well\s+done|noted|got\s+it)\b|ممنون|مرسی|عالی|خوبه|دمت\s+گرم|دستت\s+درد/i.test(s);
}
