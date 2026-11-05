// The daily summary for the information group: what came in and what was checked today. Counts only, no prices.

import fs from 'node:fs';
import path from 'node:path';
import { toDMY } from './report.js';

const dayOf = (ms, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const hourOf = (ms, timeZone) => Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(new Date(ms))) % 24;

/** The day (yyyy-mm-dd) to send the digest for, or null: after [hour] o'clock local time and not yet sent today. */
export function digestDue({ now = Date.now(), timeZone = 'Asia/Dubai', hour = 18, last = '' }) {
  const day = dayOf(now, timeZone);
  return hourOf(now, timeZone) >= hour && last !== day ? day : null;
}

const file = (dir) => path.join(dir, 'digest.json');
export const readLastDigest = (dir) => { try { return JSON.parse(fs.readFileSync(file(dir), 'utf8')).day || ''; } catch { return ''; } };
export const writeLastDigest = (dir, day) => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file(dir), JSON.stringify({ day })); } catch { /* best effort */ } };

/** [history]: the finished checks ({ at, verdict, urgent, priceUrgent }), [requests]: the orders kept ({ at }). */
export function buildDigest({ history, requests, day, timeZone = 'Asia/Dubai', events = [], extraLines = [] }) {
  const checks = history.filter((h) => dayOf(h.at, timeZone) === day);
  const orders = requests.filter((r) => dayOf(r.at, timeZone) === day);
  // EVERY check of the day counts as checked, with or without an order: the arithmetic, the number and the prices are checked either way, and not
  // having an order is not a problem by itself. An unreadable file is checked but never clean, and is shown on its own line.
  const unreadable = checks.filter((h) => h.verdict === 'unreadable' || h.verdict === 'error').length;
  const noOrder = checks.filter((h) => h.verdict === 'no-order').length;
  const compared = checks.filter((h) => h.verdict === 'match' || h.verdict === 'mismatch').length;
  const wrong = checks.filter((h) => h.verdict !== 'unreadable' && h.verdict !== 'error' && ((h.urgent || 0) > 0 || h.verdict === 'mismatch')).length;
  const priceAlerts = checks.reduce((s, h) => s + (h.priceUrgent || 0), 0);
  const lines = [
    `خلاصهٔ روز ${toDMY(day)}`,
    `- سفارش‌های دریافتی: ${orders.length}`,
    `- فاکتورهای بررسی‌شده: ${checks.length}`,
    `- بدون ایراد: ${checks.length - wrong - unreadable}`,
    `- دارای ایراد: ${wrong}${priceAlerts ? ` (هشدار قیمت: ${priceAlerts})` : ''}`,
  ];
  if (unreadable) lines.push(`- فاکتور ناخوانا: ${unreadable}`);
  if (checks.length) lines.push(`- از این‌ها با سفارش مقایسه شد: ${compared}`, `- فاکتور بدون سفارش پیدا شده: ${noOrder}`);
  const notedOnly = checks.filter((h) => (h.noted || 0) > 0 && !(h.urgent || 0)).length;
  if (notedOnly) lines.push(`- فاکتورهای فقط دارای یادداشت: ${notedOnly}`);
  const today = events.filter((e) => dayOf(e.at, timeZone) === day);
  const count = (type) => today.filter((e) => e.type === type).length;
  if (count('cut') || count('delivery') || count('payment')) lines.push(`- برش‌های ثبت‌شده: ${count('cut')}`, `- تحویل‌ها: ${count('delivery')}`, `- پرداخت‌های ثبت‌شده: ${count('payment')}`);
  const open = events.filter((e) => e.type === 'payment' && ['receipt', 'cheque', 'transfer', 'cash'].includes(e.kind) && !e.cleared).length;
  const received = count('received');
  if (received) lines.push(`- کالاهای رسیده‌شده: ${received}`);
  if (open) lines.push(`- پرداخت‌های هنوز تأییدنشده («CLEARED» نخورده): ${open}`);
  lines.push(...extraLines);
  if (!orders.length && !checks.length) lines.push('امروز سفارش یا فاکتوری ثبت نشد.');
  return lines.join('\n');
}
