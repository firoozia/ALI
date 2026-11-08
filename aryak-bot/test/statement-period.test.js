import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { skeleton, pickSpoken, scoreName } from '../src/translit.js';
import { parsePeriod, parseStatementRequest } from '../src/period.js';
import { buildStatementData, statementPdf } from '../src/qbostatement.js';
import { QboDesk, QboMap, parseQboCommand } from '../src/qbodesk.js';
import { Aliases } from '../src/aliases.js';
import { CustomerGroups } from '../src/customergroups.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';
import { voiceChangesSomething, planVoice, VoiceGate } from '../src/voicegate.js';
import { mergeTranscripts, isShortCorrection } from '../src/voicemerge.js';
import { RULES } from '../src/prompt.js';

const TODAY = '2026-11-08';
// the owner's real transcripts of 2026-11-08
const T_TEXT = 'آتوسا حساب ماه دهم میلادی شرکت را برام بفرست';
const T_VOICE1 = 'آدرس صورتحساب شرکت نبرد رو برای برج ۱۰ میلادی برام بفرست';
const T_VOICE2 = 'شرکت پالم برد';

test('skeletons: the Persian sound and the Latin spelling reduce to the same consonants', () => {
  assert.equal(skeleton('پالم'), skeleton('PALM')); assert.equal(skeleton('برد'), skeleton('BIRD'));
  assert.equal(skeleton('حکیم'), skeleton('HAKIM'));
  assert.ok(scoreName('پالم برد', 'PALM BIRD TRADING LLC') > 0.95);
  assert.ok(scoreName('پالم برد', 'HAKIM CARPENTRY') < 0.5);
});

test('the spoken customer: one clear match, several to ask, none gives the nearest three', () => {
  const names = ['PALM BIRD TRADING LLC', 'AL BURTOMANI NATIONAL', 'HAKIM CARPENTRY', 'BRIGHT BIRD CO', 'KITCHEN PALACE KITCHENS IND L.L.C', 'ZED TRADING'];
  const one = pickSpoken('پالم برد', names, { strong: 0.7 });
  assert.equal(one.kind, 'one'); assert.equal(one.best.name, 'PALM BIRD TRADING LLC');
  assert.equal(pickSpoken('حکیم', names, { strong: 0.7 }).best.name, 'HAKIM CARPENTRY');
  const many = pickSpoken('نبرد', names, { strong: 0.7 }); // "bird" alone fits two companies: asked, not guessed
  assert.equal(many.kind, 'many'); assert.deepEqual(many.candidates.map((c) => c.name).sort(), ['BRIGHT BIRD CO', 'PALM BIRD TRADING LLC']);
  const none = pickSpoken('اف', names, { strong: 0.7 });
  assert.equal(none.kind, 'none'); assert.equal(none.nearest.length, 3);
});

test('periods: month numbers, ordinals, names, last and this month, ranges; a Persian-calendar month is refused', () => {
  const p = (t) => parsePeriod(t, TODAY);
  for (const t of ['ماه ۱۰ میلادی', 'برج ۱۰ میلادی', 'برج ۱۰', 'ماه دهم میلادی', 'اکتبر', 'october', 'ماه گذشته', 'last month']) assert.deepEqual([p(t).from, p(t).to], ['2026-10-01', '2026-10-31'], t);
  assert.deepEqual([p('این ماه').from, p('این ماه').to], ['2026-11-01', '2026-11-08']); // the month in progress ends today
  assert.equal(p('اکتبر 2025').from, '2025-10-01');
  assert.equal(p('دسامبر').from, '2025-12-01'); // a month that has not come this year is last year's
  assert.deepEqual([p('از 2026-10-01 تا 2026-10-15').from, p('از 2026-10-01 تا 2026-10-15').to], ['2026-10-01', '2026-10-15']);
  assert.deepEqual([p('از ۱ اکتبر تا ۱۵ اکتبر').from, p('از ۱ اکتبر تا ۱۵ اکتبر').to], ['2026-10-01', '2026-10-15']);
  assert.equal(p('ماه ۱۰ شمسی').unsupported, 'solar');
  assert.equal(p('سلام'), null);
});

test('the owner\'s exact words become a statement request: the period is read, the misheard company name stays as spoken, a missing customer is asked', () => {
  const a = parseInvoiceCommand(T_TEXT);
  assert.equal(a.type, 'statement_nl'); assert.equal(a.customer, ''); assert.equal(a.period.from, '2026-10-01'); assert.equal(a.period.to, '2026-10-31');
  const b = parseInvoiceCommand(T_VOICE1);
  assert.equal(b.type, 'statement_nl'); assert.equal(b.customer, 'نبرد'); assert.equal(b.period.label, '2026-10');
  assert.equal(parseInvoiceCommand('آدرس صورتحساب شرکت پالم برد رو برای برج ۱۰ میلادی برام بفرست').customer, 'پالم برد');
  assert.equal(parseInvoiceCommand('صورتحساب پالم برد از 2026-10-01 تا 2026-10-15 بده').period.to, '2026-10-15');
  assert.equal(parseInvoiceCommand('صورت‌حساب پالم برد'), null); // the older form keeps its path
  assert.deepEqual(parseQboCommand('صورت‌حساب پالم برد'), { type: 'statement', name: 'پالم برد' });
  assert.equal(parseQboCommand('صورت‌حساب پالم برد اکتبر'), null); // with a period it is the free-form request
  assert.equal(parseInvoiceCommand('فاکتور بساز برای پالم برد\nH35 4').type, 'request'); // an invoice is not a statement
  assert.equal(parseStatementRequest('ماه ۱۰ شمسی صورتحساب پالم برد بفرست', TODAY).unsupported, 'solar');
});

test('voice class: a statement or a report only reads, so it runs after the echo with no yes; changing requests still wait', () => {
  assert.equal(voiceChangesSomething(T_VOICE1), false);
  assert.equal(voiceChangesSomething(T_TEXT), false);
  assert.equal(voiceChangesSomething(T_VOICE2), false);
  assert.equal(voiceChangesSomething('صورت‌حساب پالم برد'), false);
  assert.equal(voiceChangesSomething('وضعیت کوییک‌بوکس'), false);
  const p = planVoice({ transcript: T_VOICE1, lang: 'fa', priv: true });
  assert.deepEqual([p.mode, p.echo], ['run', `شنیدم: ${T_VOICE1}`]);
  for (const c of ['فاکتور بساز برای پالم برد', 'قیمت سری ۱۰۰ = ۱۳', 'ایمیل مشتری‌ها', 'فاکتور را برای مشتری بفرست', 'بله']) assert.equal(voiceChangesSomething(c), true, c);
});

test('the correction: a short reply is merged into the waiting request, never run alone; the merged request is read as a statement of the right company', async () => {
  assert.equal(isShortCorrection(T_VOICE2), true);
  assert.equal(isShortCorrection('بله'), false); assert.equal(isShortCorrection('نه'), false);
  assert.equal(isShortCorrection(T_VOICE1), false); // a full request is not a correction
  const asked = [];
  const merged = 'آدرس صورتحساب شرکت پالم برد رو برای برج ۱۰ میلادی برام بفرست';
  const client = { beta: { messages: { create: async (p) => { asked.push(p.messages[0].content); return { content: [{ type: 'text', text: JSON.stringify({ merged }) }], usage: {} }; } } } };
  const out = await mergeTranscripts({ client, config: { visionModel: 'cheap' }, original: T_VOICE1, correction: T_VOICE2 });
  assert.equal(out, merged);
  assert.match(asked[0], /Original request:\n.*نبرد[\s\S]*Correction:\nشرکت پالم برد/);
  const ic = parseInvoiceCommand(out);
  assert.deepEqual([ic.type, ic.customer, ic.period.label], ['statement_nl', 'پالم برد', '2026-10']);
  assert.equal(planVoice({ transcript: out, lang: 'fa', priv: true }).mode, 'run');
  // not a correction: null; a failing model: null (the request is then handled as a new one)
  const unrelated = { beta: { messages: { create: async () => ({ content: [{ type: 'text', text: '{"merged": null}' }] }) } } };
  assert.equal(await mergeTranscripts({ client: unrelated, config: {}, original: T_VOICE1, correction: 'موجودی کد 408' }), null);
  assert.equal(await mergeTranscripts({ client: { beta: { messages: { create: async () => { throw new Error('x'); } } } }, config: {}, original: 'a', correction: 'b' }), null);
  // the waiting request keeps its kind
  const g = new VoiceGate({ ttlMs: 1000, now: () => 0 });
  g.set('k', T_VOICE1, 'clarify'); assert.equal(g.get('k').kind, 'clarify');
  g.set('k2', 'x'); assert.equal(g.get('k2').kind, 'ask');
});

// ------------------------------------------------------------------------------------------------ the statement of a period
const inv = (id, date, total, balance = 0) => ({ Id: id, DocNumber: `INV-${id}`, TxnDate: date, TotalAmt: total, Balance: balance, DueDate: date });
const company = { CompanyName: 'THE ARYAK WORKSHOP', Country: 'AE' };
const customer = { Id: '58', DisplayName: 'PALM BIRD TRADING LLC', Balance: 700 };

test('a statement for a period: opening balance, the lines of the period, the closing at its end (today\'s balance less what came after)', () => {
  const invoices = [inv(1, '2026-09-10', 400, 0), inv(2, '2026-10-05', 500, 500), inv(3, '2026-10-20', 300, 0), inv(4, '2026-11-02', 200, 200)];
  const payments = [{ Id: 'p1', TxnDate: '2026-09-20', TotalAmt: 400, UnappliedAmt: 0 }, { Id: 'p2', TxnDate: '2026-10-25', TotalAmt: 300, UnappliedAmt: 0 }, { Id: 'p3', TxnDate: '2026-11-04', TotalAmt: 0, UnappliedAmt: 0 }];
  const d = buildStatementData({ company, customer, invoices, payments, credits: [], today: TODAY, from: '2026-10-01', to: '2026-10-31' });
  assert.equal(d.historical, true);
  assert.equal(d.start, '2026-10-01'); assert.equal(d.periodEnd, '2026-10-31');
  // books at 2026-10-31: invoices 400 + 500 + 300, payments 400 + 300 -> 500; today's balance 700 = 500 + the November invoice 200
  assert.equal(d.closing, 50000);
  assert.deepEqual(d.lines.map((l) => [l.date, l.type, l.amount]), [['2026-10-05', 'Invoice', 50000], ['2026-10-20', 'Invoice', 30000], ['2026-10-25', 'Payment', -30000]]);
  assert.equal(d.opening, 0); // 400 invoiced and 400 paid before October
  assert.equal(d.opening + d.lines.reduce((s, l) => s + l.amount, 0), d.closing);
  assert.equal(d.lines.at(-1).balance, d.closing);
  // a period that ends today is the ordinary statement
  const now = buildStatementData({ company, customer, invoices, payments, credits: [], today: TODAY, from: '2026-10-01', to: TODAY });
  assert.equal(now.historical, false); assert.equal(now.closing, 70000);
  const pdf = Buffer.from(statementPdf(d)).toString('latin1');
  assert.match(pdf, /Balance at end of period/); assert.match(pdf, /01\/10\/2026 to 31\/10\/2026/);
  assert.doesNotMatch(pdf, /Over 90 days/); // no ageing for a past period
});

// ------------------------------------------------------------------------------------------------ the desk: the customer by its spoken name, the PDF to the asker
const res = (status, json) => ({ status, ok: status >= 200 && status < 300, json: async () => json, arrayBuffer: async () => Buffer.from(''), headers: { get: () => null } });
function mkDesk(customers) {
  const posted = [];
  const qbo = {
    configured: true, connected: true, paused: false, needsReconnect: false, env: 'production',
    query: async (sql) => {
      if (/from Customer where Id/.test(sql)) return customers.filter((c) => `'${c.Id}'` === /Id = ('[^']*')/.exec(sql)[1]);
      if (/from Customer/.test(sql)) return customers;
      return []; // no invoices, payments or credit memos in this stub
    },
    companyInfo: async () => company,
    get: async () => ({ Preferences: { CurrencyPrefs: { HomeCurrency: { value: 'AED' } } } }),
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-'));
  const list = new CustomerGroups(path.join(dir, 'cg'));
  const desk = new QboDesk({ qbo, list, aliases: new Aliases(''), map: new QboMap(path.join(dir, 'map')), config: { testGroupNames: [] }, groups: async () => [], post: async (jid, buf, name, cap) => { posted.push({ jid, size: buf.length, name, cap }); }, today: () => TODAY, sleep: async () => {}, log: () => {} });
  return { desk, posted };
}

test('the desk: PALM BIRD is found from the spoken name and its statement goes to the asker\'s own chat; the owner sees the QuickBooks name', async () => {
  const { desk, posted } = mkDesk([{ Id: '58', DisplayName: 'PALM BIRD TRADING LLC', Balance: 0 }, { Id: '59', DisplayName: 'HAKIM CARPENTRY', Balance: 0 }, { Id: '60', DisplayName: 'AL BURTOMANI NATIONAL', Balance: 0 }]);
  const found = await desk.resolveSpoken('پالم برد');
  assert.deepEqual([found.id, found.name], ['58', 'PALM BIRD TRADING LLC']);
  const r = await desk.statementFor('پالم برد', { privateJid: '9715000@s.whatsapp.net', period: { from: '2026-10-01', to: '2026-10-31', label: '2026-10' } });
  assert.equal(r.ok, true); assert.match(r.text, /PALM BIRD TRADING LLC/); assert.match(r.text, /۲۰۲۶-۱۰-۰۱ تا ۲۰۲۶-۱۰-۳۱/);
  assert.equal(posted.length, 1); assert.equal(posted[0].jid, '9715000@s.whatsapp.net'); assert.match(posted[0].name, /statement-.*2026-10\.pdf/); assert.ok(posted[0].size > 500);
});

test('the desk: two companies fit "نبرد" so a numbered list is asked, nothing is sent; an unknown name gives the nearest three', async () => {
  const { desk, posted } = mkDesk([{ Id: '58', DisplayName: 'PALM BIRD TRADING LLC' }, { Id: '61', DisplayName: 'BRIGHT BIRD CO' }, { Id: '59', DisplayName: 'HAKIM CARPENTRY' }, { Id: '60', DisplayName: 'ZED TRADING' }]);
  const many = await desk.statementFor('نبرد', { privateJid: 'x@s.whatsapp.net', period: null });
  assert.equal(many.ok, false); assert.equal(many.ask, true);
  assert.match(many.text, /۱\. .*\n۲\. /);
  assert.ok(many.options.includes('PALM BIRD TRADING LLC') && many.options.includes('BRIGHT BIRD CO'));
  const none = await desk.statementFor('اف', { privateJid: 'x@s.whatsapp.net' });
  assert.equal(none.ask, true); assert.match(none.text, /پیدا نشد/); assert.equal(none.options.length, 3);
  assert.equal(posted.length, 0);
});

// ------------------------------------------------------------------------------------------------ the general prompt
test('the general prompt tells what the program can do now, so it never answers "no access to the accounts"', () => {
  assert.match(RULES, /Customer statements from QuickBooks/);
  assert.match(RULES, /never say you have no access to the company's accounts/);
  assert.match(RULES, /ask which customer or which period/);
});
