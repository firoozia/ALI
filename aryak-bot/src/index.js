// ARYAK Assistant: WhatsApp (Baileys) + Claude + Zinax Stock.

import makeWASocket, { BufferJSON, DisconnectReason, downloadMediaMessage, isJidGroup, jidNormalizedUser, normalizeMessageContent, useMultiFileAuthState } from 'baileys';
import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { answer } from './assistant.js';
import { SheetCache, fetchReport, fetchStock, isTimeout, managerMessage, warmSheet } from './stock.js';
import { PriceBook, formatBook, formatCodePrice, formatParsed, parsePriceCommand, parsePriceDocument, parsePriceText } from './prices.js';
import { auditInvoice, checkNumber, mergeProblems } from './audit.js';
import { parseOnBehalf } from './onbehalf.js';
import { Aliases, parseAliasCommand } from './aliases.js';
import { Rules, parseRuleCommand, ruleFrom } from './rules.js';
import { eventsFromCaption } from './captionevents.js';
import { deletedInvoice } from './captions.js';
import { looksLikeInvoice, onDemandText } from './ondemand.js';
import { guardedSend, observedGroup, shadowGroup } from './guard.js';
import { ShadowDesk, ShadowStore, dayLine, parseCardCorrection, parseShadowCommand, postingProblems, weekSummary } from './shadow.js';
import { isEnglishSentence, placeLanguage, toEnglish } from './english.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { UsageMeter, hasVisual } from './usage.js';
import { isQuietSubject, mayReadMedia, mayTrackWithModel } from './costpolicy.js';
import { MediaKeep, NameStore, meaninglessName, nameLineText, readableFileName, wantsRename } from './nameline.js';
import { cleanOutgoing } from './outgoing.js';
import { withFollowUp } from './followup.js';
import { Qbo, looksLikeConnectLine, parseConnectLine } from './qbo.js';
import { QboDesk, QboMap, parseQboCommand, pickTestGroup } from './qbodesk.js';
import { Audit, AuthStore, InvoiceStore, ItemCodes, PERMISSIONS, QboInvoiceDesk, TaxChoices, parseInvoiceCommand } from './qboinvoice.js';
import { extractInvoiceRequest } from './qboextract.js';
import { NamePreviews, QboNameDesk } from './qbonames.js';
import { BulkPreviews, PriceDraft, QboBulkDesk } from './qbobulk.js';
import { OneShot, SendDesk, chooseText, confirmText, findInvoice, isOwnerCommand, parseSendCommand, resolveGroups, sendFileName } from './invoicesend.js';
import { CustomerGroupDesk, CustomerGroups, NameBook, altNames, collectCustomers, customerRowFor, learnPrintedName, mergeSources, rowOfGroup, settleDuplicates } from './customergroups.js';
import { TaughtStore, TeachDesk, isExplicitTeaching, looksLikeTeaching, runTeaching } from './teach.js';
import { WatchList } from './watchlist.js';
import { cutFindingText, invoiceFindingText, shortPoint } from './finding.js';
import { differences, reconcileSheet, sameName, sheetFindingText } from './sheetcheck.js';
import { parseReceivedQuery, receivedFrom, receivedSummary } from './received.js';
import { groupAllowed } from './guard.js';
import { isSourcingRequest, markSourcingReceived, openSourcing, sourcingAnswer, sourcingCover, sourcingEvent } from './sourcing.js';
import { MorningStore, morningDue, parseMorningCommand, runMorning, matchGroups, morningText, morningLang, weekdayNumbers, localParts } from './morning.js';
import { customerFromMessages, productCode } from './codes.js';
import { orderLinesOf, parseCustomerText } from './orderlines.js';
import { Experience, describeCandidate, importPatterns, formatStatus, learnedReport, parseLearnCommand, reportDue } from './experience.js';
import { Tracker, balanceOf, checkCod, checkDelivery, checkInvoiceAgainstOrders, isDuplicatePayment, customersWithOpenInvoices, cutDigest, reconcileCuts, checkInvoiceAgainstCuts, dueNags, extractEvent, formatBalance, markCleared, openOrders, parseTrackerCommand, statementsDue } from './tracker.js';
import { buildDigest, digestDue, isOrderStatusCommand, orderStatusText, readLastDigest, writeLastDigest } from './digest.js';
import { formatDetails, formatReport, parseDay, reportFailed, reportInvalidDate, todayLine } from './report.js';
import { formatStaffStock } from './stock-format.js';
import { AvailabilityDesk, answerRequest, classify, managerQuestion, parseManagerReply, reminderText, runAvailability } from './availability.js';
import { LANG_NAME, correctionSaved, detectLang, noVoice, notUnderstood, photoNotRequest, photoUnclear, sheetFailed, sizeNote } from './lang.js';
import { imageAction, understandImages } from './image.js';
import { ignoredKind, imageOf } from './media.js';
import { appendCorrection, parseCorrection, readCorrections } from './corrections.js';
import { loadConfig } from './config.js';
import { GroupGate, staffChecker } from './gate.js';
import { afterClose, clearAuth, pairingOnce } from './pairing.js';
import { InvoiceDesk, checkInvoice, extractMeta, noRequestText, readInvoice, reportText, staffWarning } from './invoice.js';
import { helloOnce } from './hello.js';
import { BotState, isAddressed, parseCommand, runCommand, staffAnswer } from './staff.js';
import { GroupStatements, askLine, effectiveRequest, statementAsk } from './groupstatement.js';
import { DEFAULT_PHRASES, metadataToken, speechTranscriber } from './speech.js';
import { MAX_SECONDS, NO_VOICE_CUSTOMER, NO_VOICE_FA, NOT_UNDERSTOOD_CUSTOMER, NOT_UNDERSTOOD_FA, VoiceDesk, answerKind, answerLead, nameHeard, retryText, understand, voiceAction } from './voice.js';
import { normalizeDigits } from './text.js';
import { matchOption } from './choice.js';
import { shouldProcess, OwnerSeen } from './intake.js';
import { documentBlock, setDocMeter } from './pdftext.js';
import { setVisionMeter } from './vision.js';
import { CostMeter } from './cost.js';
import { planVoice, VoiceGate, bareAnswerYieldsToPending, looksLikeCorrection } from './voicegate.js';
import { deliver, captionCustomerName } from './photoflow.js';
import { cutRecords, markCutsInvoiced } from './cuts.js';
import { PendingChoice, parseChoice } from './pendingchoice.js';
import { mergeTranscripts, isShortCorrection } from './voicemerge.js';
import { codeKnownInItems } from './qboinvoice.js';
import { buildSystemPrompt } from './prompt.js';
import { applyTags } from './tags.js';

const { config, missing } = loadConfig();
config.log = (s) => console.warn(s); // replaced by the logger below
if (missing.length) {
  console.error(`Missing settings: ${missing.join(', ')}. See README.md.`);
  process.exit(1);
}
if (!config.allowedGroups.length && !config.allowedGroupNames.length) {
  console.error('Set ALLOWED_GROUP_NAMES (a word in the group names) or ALLOWED_GROUPS; otherwise the assistant answers nowhere.');
}
const client = new Anthropic();
// The paid calls are counted per group and kind (the group is carried through the handling of a message).
const usageCtx = new AsyncLocalStorage();
const usage = new UsageMeter(path.join(config.authDir, 'usage'), { timeZone: config.timezone, cost: { model: config.costModelUsd, vision: config.costVisionUsd, speech: config.costSpeechUsd } });
try {
  const rawCreate = client.beta.messages.create.bind(client.beta.messages);
  client.beta.messages.create = async (params, ...rest) => {
    const group = usageCtx.getStore()?.group || '-';
    usage.count(group, 'model');
    if (hasVisual(params)) usage.count(group, 'vision');
    const res = await rawCreate(params, ...rest);
    try { cost.model(res?.model || params.model, res?.usage, group); } catch { /* the cost log never stops an answer */ }
    return res;
  };
} catch (e) { console.warn(`paid calls are not counted: ${e.message}`); }
// The real cost: tokens per model from each answer, seconds of speech, photo reads (cheap first, strong on a failed check), PDFs (text layer free).
const cost = new CostMeter(path.join(config.authDir, 'usage'), { timeZone: config.timezone, prices: config.costPrices, speechPerMinute: config.costSpeechPerMinute, log: (s) => logger.info(s) });
setDocMeter(cost); setVisionMeter(cost);
setInterval(() => { usage.save(); cost.save(); }, 60 * 1000).unref();
// The prompt: the rules and knowledge files, plus what the owner approved from the experience store (rebuilt when it changes).
let systemCache = { version: -1, text: '' };
const systemPrompt = () => {
  const version = `${experience.version}:${rules.version}`;
  if (systemCache.version !== version) {
    systemCache = { version, text: [buildSystemPrompt(config.kbDir, config.displayName), rules.promptText(), experience.promptText()].filter(Boolean).join('\n\n') };
  }
  return systemCache.text;
};
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
config.log = (s) => logger.warn(s);
config.logInfo = (s) => logger.info(s);
config.sheetCache = new SheetCache(); // the last answer per lookup: reused for a minute, a fallback for a quarter of an hour
// The sheet's script falls asleep and then needs up to a minute to wake: a cheap lookup every four minutes keeps it up.
setTimeout(() => warmSheet(config).catch((e) => logger.warn(`keep-warm lookup failed: ${e.message}`)), 5000).unref();
setInterval(() => {
  warmSheet(config).then((ms) => { if (ms > 15000) logger.warn(`keep-warm lookup was slow: ${Math.round(ms / 1000)} s`); })
    .catch((e) => logger.warn(`keep-warm lookup failed: ${e.message}`));
}, 4 * 60 * 1000).unref();
// One short line per message and what became of it: where, who (a role, never a number), the decision. No text.
const trace = (where, role, decision) => logger.info(`msg ${where} ${role}: ${decision}`);
const recent = new Map(); // manager alerts already sent
const groups = new Map(); // group JID -> { subject, lidToPhone, at }
const desk = new InvoiceDesk({ dir: config.requestsDir }); // customers' purchase orders
const botState = new BotState(config.authDir); // pause switch
const startedAt = Date.now();
const sent = new Set(); // ids of messages the bot sent, so they are not read again
const staffChats = new Set(); // private chats a staff member started: the assistant may answer there
const lastPhotos = new Map(); // chat and sender -> their latest picture message (kept in memory, read only when she is asked about it)
const keepLang = new WeakSet(); // replies that keep their own language (the test-only played customer or owner)
const quietContents = new WeakSet(); // messages that are not an answer to anyone (the good-morning message): never counted for learning
// What the customer-flow gate did with a message, in words (the gate also watches staff messages: a colleague's
// message cancels the answer that was waiting for a customer, it is not itself answered).
const GATE_WORDS = {
  own: 'typed on the bot phone: any answer waiting for a customer is cancelled',
  staff: 'colleague message, nothing was waiting',
  'staff-replied': 'colleague replied: the answer waiting for the customer is cancelled',
  waiting: 'customer message: waiting for a colleague to answer first',
  unknown: 'sender not recognised: not answered',
};
const book = new PriceBook(path.join(config.authDir, 'prices')); // the owner's price list, on the VM only
const priceDesk = new VoiceDesk({ ttlMs: 30 * 60 * 1000 }); // a parsed list or exception waiting for the owner's yes
const watchList = new WatchList(path.join(config.authDir, 'watched-groups')); // watched groups kept by id, so a renamed group stays watched
watchList.applyTo(config);
const rules = new Rules(config.authDir); // rules the owner taught in words: durable, listed, removable
const aliases = new Aliases(path.join(config.authDir, 'aliases')); // other spellings of a customer's name, added by the owner
const experience = new Experience({ dir: path.join(config.authDir, 'experience') }); // counters and anonymous shapes; never messages
const tracker = new Tracker({ dir: path.join(config.authDir, 'tracker') }); // the steps of each order, from the supervised groups
// The test groups keep their own memory: nothing said there reaches the real tracker, digest or reports.
const testTracker = new Tracker({ dir: path.join(config.authDir, 'tracker-test') });
const trackerOf = (test) => (test ? testTracker : tracker);
const isTestSubject = (subject) => config.testGroupNames.some((w) => String(subject || '').toLowerCase().includes(w));
const avail = new AvailabilityDesk({ dir: path.join(config.authDir, 'availability') }); // questions to the sales manager that wait for his answer
const followDesk = new VoiceDesk(); // a question the assistant asked a person; their next message answers it
const sttNotice = new Map(); // chat -> when it was last told that voice cannot be heard
const voiceDesk = new VoiceDesk(); // what was understood from a voice note, waiting for a yes
const choiceDesk = new PendingChoice({ file: path.join(config.authDir, 'pending-choice.json') }); // a numbered question waiting for its answer (30 minutes, kept over a restart)
const voiceGate = new VoiceGate(); // the transcript of a voice note that would change something, waiting for the speaker's «بله»
const transcribe = speechTranscriber({
  languages: config.speechLanguages, token: metadataToken(), minConfidence: config.speechMinConfidence,
  phrases: [...new Set([config.displayName, ...DEFAULT_PHRASES])],
});
const handled = new Set(); // ids of messages already taken in
const ownerSeen = new OwnerSeen(path.join(config.authDir, 'owner-seen.json')); // the owner's own private messages taken in (survives a restart)
const lastRaw = new Map(); // group JID -> last customer message, quoted by the reply
let sock;

async function groupInfo(jid, force = false) {
  const known = groups.get(jid);
  if (known && !force && Date.now() - known.at < 6 * 3600 * 1000) return known;
  const meta = await sock.groupMetadata(jid);
  const lidToPhone = new Map();
  for (const p of meta.participants) if (p.phoneNumber) { lidToPhone.set(p.id, p.phoneNumber); if (p.lid) lidToPhone.set(p.lid, p.phoneNumber); }
  const info = { subject: meta.subject || '', lidToPhone, at: Date.now() };
  groups.set(jid, info);
  return info;
}

/** A free look at the sheet for one code: 'ok' (something free), 'none' (nothing free), or 'unknown' (several groups, no answer, not in the sheet). */
async function stockState(code) {
  try {
    const r = await fetchStock(config, { code });
    if (!r.found) return { state: 'unknown', label: 'not in the sheet' };
    if (r.ambiguous) return { state: 'unknown', label: 'in several groups' };
    const free = Number(r.free) || 0;
    if (free <= 0) return { state: 'none', label: 'none free' };
    return { state: 'ok', label: free >= Number(r.limit || 0) ? 'in stock' : 'low stock' };
  } catch { return { state: 'unknown', label: 'sheet did not answer' }; }
}

const gate = new GroupGate({
  waitMs: config.waitMinutes * 60 * 1000,
  isStaff: (m) => m.staff,
  log: (s) => logger.info(s),
  answer: async ({ groupId, messages: incoming, transcript }) => {
    if (botState.paused) { logger.info('paused: customer message not answered'); return; }
    let messages = incoming;
    if (config.voiceEnabled) {
      const step = await customerVoiceStep(groupId, messages);
      if (step.done) return;
      messages = step.messages;
    }
    const info = await groupInfo(groupId);
    // One group can hold several billing customers: the name after an order line or beside a handwritten photo wins.
    const named = customerFromMessages(messages, orderLinesOf);
    const customer = (named ? canon(named) : '') || customerOfGroup(groupId, info.subject.replace(config.groupSuffix, '').trim() || info.subject);
    // The order lines a customer wrote are kept in the order memory (with their quantities) for the invoice check.
    if (config.trackerEnabled) {
      for (const m of messages) {
        const ls = orderLinesOf(m.text);
        if (ls.length) tracker.add({ type: 'order', at: Date.now(), customer: canon(ls.find((l) => l.customer)?.customer || customer), lines: ls.map((l) => ({ code: l.code, quantity: l.quantity, unit: l.unit })), source: 'customer-text', ref: createHash('sha256').update(`text|${groupId}|${m.raw?.key?.id || m.text}`).digest('hex').slice(0, 24) });
      }
    }
    // Availability: ask for the quantity, answer when it is comfortably in stock, otherwise ask the sales manager.
    if (config.availabilityFlow) {
      const flow = await runAvailability({
        messages, groupId, groupName: info.subject, customer, desk: avail,
        decide: async (line) => {
          try { return classify(await fetchStock(config, { code: line.code, quantity: line.quantity, quantity_unit: line.unit })); } catch { return { kind: 'unhandled' }; }
        },
        lookup: async (code) => (await stockState(code)).state,
        send: (gid, text, m) => sock.sendMessage(gid, { text }, m?.raw ? { quoted: m.raw } : undefined),
        notifyManager: async (req) => (await sock.sendMessage(config.salesManager, { text: managerQuestion(req) }))?.key?.id,
        log: (s) => logger.info(`availability in group "${info.subject}": ${s}`),
      });
      messages = flow.rest;
      if (!messages.length) return;
    }
    const images = [];
    for (const m of messages.filter((x) => x.loadImage).slice(-4)) {
      try { images.push(await m.loadImage()); } catch (e) { logger.warn(`image download failed: ${e.message}`); }
    }
    const ctx = { groupId, groupName: info.subject, customer, messageText: messages.map((m) => m.text).filter(Boolean).join(' / ') };
    // a follow-up with no code ("how much meters you have") carries the group's recent code as context; the codes of this batch are remembered after
    const forModel = withFollowUp(messages, recentCodeList(groupId));
    for (const m of messages) if (m.text) rememberCodes(groupId, m.text);
    const result = await answer({ client, config, system: systemPrompt(), input: { groupName: info.subject, customer, transcript, messages: forModel, images }, ctx, recent });
    for (const text of result.managerTexts) await sock.sendMessage(config.salesManager, { text });
    logger.info(`${groupId}: ${result.why}`);
    if (!result.reply) return;
    const { text, mentions } = applyTags(result.reply, config.team);
    await sock.sendMessage(groupId, { text, mentions }, { quoted: lastRaw.get(groupId) });
  },
});

// A request the manager has not answered for a quarter of an hour: one reminder, nothing is said to the customer.
setInterval(async () => {
  try {
    if (!sock?.user) return;
    for (const r of avail.dueReminders()) await sock.sendMessage(config.salesManager, { text: reminderText(r) });
  } catch (e) { logger.warn(`reminder failed: ${e.message}`); }
}, 60 * 1000).unref();

// The good-morning message: a run is due on a working day in the window after the set time; the listed groups only.
const morningStore = new MorningStore(path.join(config.authDir, 'morning'));
let morningRunning = false;
const morningPhrases = () => { try { return JSON.parse(fs.readFileSync(new URL('../data/morning-phrases.json', import.meta.url), 'utf8')); } catch (e) { logger.warn(`morning phrases unreadable: ${e.message}`); return null; } };
const morningSend = async (id, text) => { const content = { text }; quietContents.add(content); return sock.sendMessage(id, content); };
const learnedLangOf = (g) => experience.groupLanguage(groupLabel(g.subject));
setInterval(async () => {
  if (morningRunning || !sock?.user || !config.morningGroupNames.length || !morningStore.enabled || botState.paused) return;
  const due = morningDue({ now: Date.now(), timeZone: config.timezone, time: config.morningTime, catchUpUntil: config.morningCatchUpUntil, offDays: weekdayNumbers(config.morningOffDays), weekendWishDays: weekdayNumbers(config.morningWeekendDays) });
  if (!due || morningStore.completed === due.day) return;
  const phrases = morningPhrases();
  if (!phrases) return;
  morningRunning = true;
  try {
    const all = Object.values(await sock.groupFetchAllParticipating()).map((g) => ({ id: g.id, subject: g.subject || '' }));
    const r = await runMorning({
      day: due.day, weekend: due.weekend, groups: all, words: config.morningGroupNames, phrases, name: config.displayName, store: morningStore,
      send: morningSend, sleep: (ms) => new Promise((res) => setTimeout(res, ms)), stillOpen: () => !botState.paused && !!morningDue({ now: Date.now(), timeZone: config.timezone, time: config.morningTime, catchUpUntil: config.morningCatchUpUntil, offDays: weekdayNumbers(config.morningOffDays), weekendWishDays: weekdayNumbers(config.morningWeekendDays) }),
      cap: config.morningDailyCap, gapMin: config.morningGapMin, gapMax: config.morningGapMax, learnedLang: learnedLangOf, log: (s) => logger.info(s),
    });
    logger.info(`morning run: ${r.sent} sent, ${r.skipped} skipped, ${r.failed} failed${r.capped ? ', daily cap reached' : ''}${r.closed ? ', window closed' : ''}`);
  } catch (e) { logger.warn(`morning run failed: ${e.message}`); } finally { morningRunning = false; }
}, 30 * 1000).unref();

/** The owner's commands about the good-morning message. "آزمایش" sends both variants now, to the test group only. */
async function morningCommand(c, reply) {
  if (c.type === 'on' || c.type === 'off') { morningStore.setEnabled(c.type === 'on'); return reply(c.type === 'on' ? 'پیام صبح بخیر روشن شد.' : 'پیام صبح بخیر خاموش شد.'); }
  if (c.type === 'status') {
    const p = localParts(Date.now(), config.timezone);
    return reply(`پیام صبح بخیر: ${morningStore.enabled ? 'روشن' : 'خاموش'}؛ ${config.morningGroupNames.length} نام در فهرست گروه‌ها؛ ساعت ${config.morningTime} تا ${config.morningCatchUpUntil}؛ روزهای تعطیل: ${config.morningOffDays.length ? config.morningOffDays.join('، ') : 'ندارد'}؛ امروز ${morningStore.count(p.day)} گروه فرستاده شد.`);
  }
  const phrases = morningPhrases();
  if (!phrases) return reply('فایل عبارت‌های صبح بخیر خوانده نشد.');
  const all = Object.values(await sock.groupFetchAllParticipating()).map((g) => ({ id: g.id, subject: g.subject || '' }));
  const targets = matchGroups(all, config.testGroupNames);
  if (!targets.length) return reply('گروه آزمایشی پیدا نشد؛ تنظیم گروه آزمایشی را بررسی کنید.');
  const day = localParts(Date.now(), config.timezone).day;
  for (const g of targets) for (const weekend of [false, true]) {
    await morningSend(g.id, morningText({ phrases, lang: morningLang(learnedLangOf(g), g.subject), day, weekend, name: config.displayName }));
  }
  logger.info(`morning test: sent to ${targets.length} test group(s)`);
  return reply(`نمونهٔ روز عادی و نمونهٔ آخر هفته به گروه آزمایشی فرستاده شد (${targets.length} گروه).`);
}

// Once an hour: the polite single reminders (an order without an invoice, an invoice without a delivery), and on the
// statement day the customers whose monthly statement was not recorded. Report-only, to the information group.
setInterval(async () => {
  try {
    if (!sock?.user || !config.infoGroupName || botState.paused || !config.trackerEnabled || !config.remindersOn) return;
    const lines = dueNags(tracker, desk.requests, { orderHours: config.orderNagHours, deliveryHours: config.deliveryNagHours });
    if (lines.length) await sendTo(config.infoGroupName, `یادآوری:\n${lines.slice(0, 12).map((l) => `- ${l}`).join('\n')}\n— ${config.displayName}`);
    const due = statementsDue(tracker, { timeZone: config.timezone, day: config.statementDay });
    if (due.length) await sendTo(config.infoGroupName, `صورت‌حساب ماهانهٔ این مشتری‌ها هنوز ثبت نشده است:\n${due.slice(0, 20).map((n) => `- ${n}`).join('\n')}\n— ${config.displayName}`);
  } catch (e) { logger.warn(`reminders failed: ${e.message}`); }
}, 60 * 60 * 1000).unref();

// The experience store: saved every five minutes (and old entries dropped once a day); on Monday after the summary hour
// the weekly "what I learned" report goes to the information group. Behaviour never changes without the owner's approval.
let lastPurge = '';
setInterval(async () => {
  try {
    experience.save();
    const today = new Date().toISOString().slice(0, 10);
    if (lastPurge !== today) { lastPurge = today; experience.purge(); experience.save(); }
    if (!sock?.user || !config.infoGroupName || !config.learning || !experience.on) return;
    const day = reportDue({ timeZone: config.timezone, weekday: config.learnReportWeekday, hour: config.digestHour, last: experience.lastReport });
    if (!day) return;
    await sendTo(config.infoGroupName, `${learnedReport(experience, { errors: errorKinds() })}\n— ${config.displayName}`);
    experience.lastReport = day; experience.dirty = true; experience.save();
    logger.info(`weekly learning report for ${day} sent`);
  } catch (e) { logger.warn(`experience timer failed: ${e.message}`); }
}, 5 * 60 * 1000).unref();

// The daily summary for the information group, once a day after the set hour (counts only).
setInterval(async () => {
  try {
    if (!sock?.user || !config.infoGroupName || botState.paused) return;
    const day = digestDue({ timeZone: config.timezone, hour: config.digestHour, last: readLastDigest(config.authDir) });
    if (!day) return;
    await sendTo(config.infoGroupName, buildDigest({ history: desk.history, requests: desk.requests, day, timeZone: config.timezone, events: tracker.events, extraLines: (() => { usage.save(); cost.save(); for (const l of usage.logLines()) logger.info(l); const taken = sheetState.d.notes.splice(0); if (taken.length) sheetState.save(); const c = cutDigest(tracker); if (taken.length) c.sheet = taken; return [cost.line() || usage.line(), (() => { const n = customerGroups.newUnmapped(knownInvoiceCustomers().customers, config); return n.length ? `- Invoice customers with no group in the customer list yet: ${n.slice(0, 8).join(', ')}${n.length > 8 ? ` and ${n.length - 8} more` : ''}` : ''; })(), ...customerGroups.takeNotes().map((l) => `- ${l}`), c.invoiceNoCut ? `- Invoices with no cut recorded yet: ${c.invoiceNoCut}` : '', c.cutNoInvoice ? `- Cuts with no invoice yet: ${c.cutNoInvoice}` : '', ...(c.sheet ? ['- Cut photos against the sheet:', ...c.sheet.map((l) => `  ${l}`)] : [])].filter(Boolean); })() }));
    writeLastDigest(config.authDir, day);
    logger.info(`daily summary for ${day} sent`);
  } catch (e) { logger.warn(`daily summary failed: ${e.message}`); }
}, 60 * 1000).unref();

/** The manager's own words, put into the customer's language (numbers, codes and units untouched); the words as they are if that fails. */
async function translateTo(text, lang) {
  if (detectLang(text, 'fa') === lang) return text;
  try {
    const res = await client.beta.messages.create({
      model: config.model, max_tokens: 600,
      system: `Translate the message into ${LANG_NAME[lang] || 'English'}. Keep numbers, product codes and units exactly. Short and polite, like a shop. Reply with the translation only.`,
      messages: [{ role: 'user', content: text }], output_config: { effort: 'low' },
    });
    return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || text;
  } catch { return text; }
}

const knownCustomers = () => [...groups.values()].map((g) => String(g.subject || '').replace(config.groupSuffix, '').trim()).filter(Boolean);
// The one name of a customer: his approved row first (a name, an alias or a near spelling of it), else the aliases and the group labels.
const rowOfName = (name) => customerRowFor(name, { list: customerGroups, aliases });
const canon = (name) => rowOfName(name)?.customer || aliases.resolve(name, knownCustomers());
// An order written in a customer's group belongs to the customer of the approved row that holds that group (by its id), else to the group's label.
const customerOfGroup = (groupId, label) => rowOfGroup(customerGroups, groupId)?.customer || canon(label);

/** The label of a customer group for the experience store: the customer's name part of the group name. */
const groupLabel = (subject) => String(subject || '').replace(config.groupSuffix, '').trim() || String(subject || '');

/**
 * Passive watching of the customer groups for the experience store: only kinds, languages, delays and shapes are kept,
 * never the message, a name, a number, a photo or a voice note. It changes nothing she does.
 */
async function observe(raw, groupId) {
  if (!config.learning || !experience.on || sent.has(raw.key.id)) return;
  const info = await groupInfo(groupId);
  const subject = info.subject.toLowerCase();
  const customerGroup = config.allowedGroupNames.some((w) => subject.includes(w)) || config.watchGroupNames.some((w) => subject.includes(w)) || observedGroup(info.subject, config);
  if (!customerGroup) return;
  const content = normalizeMessageContent(raw.message);
  if (!content || content.protocolMessage || content.reactionMessage) return;
  const image = imageOf(content);
  const text = textOf(content) || image?.caption || '';
  const media = image ? 'photo' : content.audioMessage ? 'voice' : '';
  if (!text && !media) return;
  let staff = !!raw.key.fromMe;
  if (!staff) {
    staff = staffChecker(config.staffNumbers, info.lidToPhone)({ sender: raw.key.participant, senderAlt: raw.key.participantAlt });
    if (staff === null) return;
  }
  const label = groupLabel(info.subject);
  if (staff) experience.staff(label, text, { media: !!media });
  else experience.customer(label, text, { media });
}

/** The experience store's commands (the owner, in a private chat or the command group). */
async function learnCommand(c, reply) {
  if (c.type === 'status') return reply(formatStatus(experience));
  if (c.type === 'off' || c.type === 'on') { experience.on = c.type === 'on'; experience.dirty = true; experience.save(); return reply(`یادگیری ${experience.on ? 'روشن' : 'خاموش'} شد.`); }
  if (c.type === 'list') { const l = experience.review(10); return reply(l.length ? [...l.map(describeCandidate), 'پاسخ: «بپذیر ۳» یا «رد ۳»'].join('\n') : 'پیشنهادی در انتظار نیست.'); }
  if (c.type === 'report') return reply(learnedReport(experience, { errors: errorKinds() }));
  if (c.type === 'import') {
    // A file of patterns put on the VM by hand (see docs/LEARNING_IMPORT_FORMAT.md): everything goes to the review list.
    const file = path.join(config.authDir, 'import', 'patterns.json');
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return reply('فایل الگوها پیدا یا خوانده نشد. آن را با نام patterns.json در پوشهٔ import روی دستگاه بگذارید.'); }
    const r = importPatterns(experience, data);
    experience.save();
    if (r.error) return reply('قالب فایل پذیرفته نشد (نسخهٔ ۱ لازم است).');
    return reply(`به فهرست بررسی رفت: ${r.phrasings} عبارت، ${r.routing} مسیر، ${r.patterns} الگوی پاسخ، ${r.aliases} نام دیگر. ردشده: ${r.skipped}. هیچ‌چیز اعمال نشد؛ با «پیشنهادهای یادگیری» ببینید.`);
  }
  if (c.type === 'rollback') { const ok = experience.rollback(); experience.save(); return reply(ok ? `به نسخهٔ ${experience.version} بازگشت داده شد.` : 'نسخهٔ تأییدشده‌ای نیست که بازگردانده شود.'); }
  const done = experience.decide(c.id, c.type === 'approve');
  if (done && c.type === 'approve' && done.kind === 'alias') aliases.add(done.customer, done.alias);
  experience.save();
  return reply(done ? (c.type === 'approve' ? `پذیرفته شد (نسخهٔ ${experience.version}); از پیام بعدی در پرسش‌ها به کار می‌رود.` : 'رد شد.') : `پیشنهاد ${c.id} در فهرست نیست.`);
}

const errorKinds = () => Object.fromEntries([...experience.keysOf('ie|', 1)].map(([k, v]) => [k.slice(3), v]));

/** Which supervised group a chat is: 'cut' | 'delivery' | 'payment' | null (by a word of its name). */
async function trackedRole(groupId) {
  if (!config.trackerEnabled) return null;
  const subject = (await groupInfo(groupId)).subject.toLowerCase();
  const has = (w) => w && subject.includes(w);
  if (has(config.cutGroupName)) return 'cut';
  if (has(config.deliveryGroupName)) return 'delivery';
  if (has(config.confirmGroupName)) return 'payment';
  if (config.goodsGroupNames.some(has)) return 'goods';
  return null;
}

/**
 * The watching of the cutting, delivery and confirmation groups. It reads each message (and its photo, in memory only),
 * keeps what it means as an event (customer, codes, quantities, amounts: no photo, no text, no bank detail), and
 * compares it with the steps before it. Anything found goes to the information group; nothing is ever written to the
 * group watched or to a customer, except the hold reminder in the delivery group.
 */
// Messages to the Information group go one after the other with a gap, so a batch of invoices is never a burst.
let infoChain = Promise.resolve();
const infoPost = (text) => {
  infoChain = infoChain.then(async () => { await sendTo(config.infoGroupName, text); await new Promise((r) => setTimeout(r, Math.max(0, config.infoGapSeconds) * 1000)); }).catch((e) => logger.warn(`information group post failed: ${e.message}`));
  return infoChain;
};

/** Invoice versus cut for one customer: one message with the new findings (a cut above the invoice at once, a partial cut after the window). */
async function cutReconcile(customer) {
  if (!config.trackerEnabled || !config.infoGroupName || !customer) return;
  const fresh = reconcileCuts(tracker, customer, { tol: config.cutToleranceMetres }).filter((f) => !tracker.nagged.has(f.key));
  if (!fresh.length) return;
  for (const f of fresh) tracker.markNagged(f.key);
  await infoPost(cutFindingText(fresh, config.displayName));
}

// The cut photos against the warehouse sheet (read only): at the summary hour the day is compared and kept; the next morning it is
// compared again (late scans) and what still differs goes out as ONE English message, or into the summary when there are few.
const sheetState = (() => {
  const file = path.join(config.authDir, 'sheetcheck.json');
  let d = { evening: '', morning: '', notes: [] };
  try { d = { ...d, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first start */ }
  return { d, save: () => { try { fs.writeFileSync(file, JSON.stringify(d)); } catch { /* best effort */ } } };
})();
const sheetMatch = (a, b) => sameName(canon(a), canon(b)) || sameName(a, b);

/** Compares one day. Returns the result, or null when the sheet could not give the whole day. */
async function sheetDay(day) {
  let rep;
  try { rep = await fetchReport(config, { from: day, to: day, detail: true, limit: 500 }); } catch (e) { logger.warn(`sheet check: the report failed (${e.message})`); return null; }
  const rows = (rep.rows || []).filter((r) => r.type === 'OUT' || r.type === 'CUT');
  if ((rep.rowsTotal || 0) > (rep.rows || []).length) { logger.warn(`sheet check: only ${(rep.rows || []).length} of ${rep.rowsTotal} operations came back; the script needs the larger page (see the deploy note)`); return null; }
  // the scans become events, so an invoice with an OUT of its quantity is satisfied even without a photo
  for (const r of rows) {
    const ref = createHash('sha256').update(`out|${r.day}|${r.at}|${r.code}|${r.qty}|${r.customer}`).digest('hex').slice(0, 24);
    tracker.add({ type: 'out', at: Number(r.at) || Date.parse(`${r.day}T12:00:00Z`), customer: String(r.customer || ''), code: String(r.code || ''), qty: Number(r.qty) || 0, unit: String(r.unit || 'm'), ref });
  }
  const dayStart = Date.parse(`${day}T00:00:00Z`) - 14 * 3600000;
  const cuts = tracker.events.filter((e) => e.type === 'cut' && e.at >= dayStart && e.at < dayStart + 38 * 3600000 && localParts(e.at, config.timezone).day === day);
  return reconcileSheet({ cuts, rows, tol: config.cutToleranceMetres, match: sheetMatch });
}

async function sheetCheck(now = Date.now()) {
  if (!config.trackerEnabled || !config.infoGroupName || botState.paused || !sock?.user) return;
  const p = localParts(now, config.timezone);
  const yesterday = localParts(now - 24 * 3600000, config.timezone).day;
  if (p.minutes >= config.digestHour * 60 && sheetState.d.evening !== p.day) {
    sheetState.d.evening = p.day; sheetState.save();
    const r = await sheetDay(p.day);
    if (r) logger.info(`sheet check ${p.day}: ${differences(r)} difference(s) so far, rechecked tomorrow morning`);
  }
  if (p.minutes >= config.sheetRecheckHour * 60 && p.minutes < config.digestHour * 60 && sheetState.d.morning !== p.day) {
    sheetState.d.morning = p.day; sheetState.save();
    const r = await sheetDay(yesterday);
    if (!r) return;
    const n = differences(r);
    logger.info(`sheet check ${yesterday}: ${n} difference(s) after the recheck`);
    if (!n) return;
    if (n <= config.sheetDigestMax) { sheetState.d.notes.push(...sheetFindingText(yesterday, r).split('\n').slice(1).filter((l) => l.startsWith('- '))); sheetState.save(); return; } // few: in the summary
    await infoPost(sheetFindingText(yesterday, r, config.displayName));
  }
}
setInterval(() => { sheetCheck().catch((e) => logger.warn(`sheet check failed: ${e.message}`)); }, 10 * 60 * 1000).unref();

// Every half hour: a partial cut of an invoice older than the window becomes a finding (once). Silent when nothing is wrong.
setInterval(async () => {
  try {
    if (!sock?.user || botState.paused) return;
    for (const customer of customersWithOpenInvoices(tracker)) await cutReconcile(customer);
  } catch (e) { logger.warn(`cut reconcile failed: ${e.message}`); }
}, 30 * 60 * 1000).unref();

async function trackGroup(raw, groupId, role) {
  if (sent.has(raw.key.id) || botState.paused) return;
  const content = normalizeMessageContent(raw.message);
  const image = imageOf(content);
  const text = textOf(content) || image?.caption || '';
  if (!text && !image) return;
  const quotedId = (content.extendedTextMessage || image)?.contextInfo?.stanzaId || '';
  const refOf = (id, i = 0) => createHash('sha256').update(`${groupId}|${id}${i ? `|${i}` : ''}`).digest('hex').slice(0, 24);
  // The shapes the groups really use are read here without a model (and without downloading the photo).
  const det = text ? eventsFromCaption(role, text) : null;
  if (det) {
    const whereDet = `group "${(await groupInfo(groupId)).subject}"`;
    if (det.cleared) { const done = markCleared(tracker, quotedId ? refOf(quotedId) : ''); trace(whereDet, 'tracker', done ? 'a money item was cleared' : 'cleared, but no open money item'); return; }
    if (det.clearInvoices) { markCleared(tracker, quotedId ? refOf(quotedId) : ''); trace(whereDet, 'tracker', `cleared ${det.clearInvoices.length} invoice(s)`); return; }
    if (det.ignore) { trace(whereDet, 'tracker', 'not a customer payment, left out'); return; }
    for (const [i, ev] of det.events.entries()) {
      const event = { ...ev, customer: canon(ev.customer), customerTyped: ev.customer, at: Date.now(), ref: refOf(raw.key.id, i) };
      if (isDuplicatePayment(tracker, event)) { trace(whereDet, 'tracker', 'the same payment was already recorded minutes ago: counted once'); continue; }
      if (!tracker.add(event)) continue;
      trace(whereDet, 'tracker', `${role} recorded from the caption${event.internal ? ' (internal, not a sale)' : ''}`);
      // goods that arrive ("received") close the sourcing requests for their code: it is not a mistake that they came in
      if (role === 'goods' && event.kind === 'received') for (const m of String(event.item || '').matchAll(/\d{2,5}/g)) markSourcingReceived(tracker, m[0]);
      if (role === 'cut' && !event.internal) await cutReconcile(event.customer);
      if (role === 'delivery') {
        const findings = [...checkDelivery(tracker, event), ...checkCod(tracker, event)];
        if (findings.length) trace(whereDet, 'tracker', `${findings.length} delivery note(s) kept for the digest only`);
        if (tracker.isHeld(event.customer)) await sock.sendMessage(groupId, { text: `⛔ ${tracker.isHeld(event.customer)}: تحویل تا تأیید نقدی نباید انجام شود. — ${config.displayName}` }, { quoted: raw });
      }
    }
    return;
  }
  if (role === 'goods') return; // only the shapes above are read there
  if (!image && !/\d/.test(text) && text.length < 12) return; // a greeting or a thanks
  // The free caption reader is done. Anything else would be a paid call (and a photo download): only when the owner allows it.
  if (!mayTrackWithModel(config)) { usage.count(groupLabel((await groupInfo(groupId)).subject), 'notRead'); return; }
  const images = [];
  if (image) {
    try { images.push({ base64: (await downloadMediaMessage(raw, 'buffer', {})).toString('base64'), mimeType: String(image.mimetype || 'image/jpeg').split(';')[0] }); } catch (e) { logger.warn(`tracker: photo download failed: ${e.message}`); }
  }
  const ev = await extractEvent({ client, config, role, caption: text, images });
  const where = `group "${(await groupInfo(groupId)).subject}"`;
  if (!ev) { trace(where, 'tracker', `${role}: nothing to record`); return; }
  const event = { ...ev, customer: canon(ev.customer), customerTyped: ev.customer, at: Date.now(), ref: createHash('sha256').update(`${groupId}|${raw.key.id}`).digest('hex').slice(0, 24) };
  if (!tracker.add(event)) return;
  trace(where, 'tracker', `${role} recorded (${event.lines?.length || 0} line(s)${event.amount ? ', an amount' : ''})`);
  if (role === 'cut' && !event.internal) await cutReconcile(event.customer);
  if (role === 'delivery') {
    const findings = [...checkDelivery(tracker, event), ...checkCod(tracker, event)];
    if (findings.length) trace(where, 'tracker', `${findings.length} delivery note(s) kept for the digest only`);
    if (tracker.isHeld(event.customer)) await sock.sendMessage(groupId, { text: `⛔ ${tracker.isHeld(event.customer)}: تحویل تا تأیید نقدی نباید انجام شود. — ${config.displayName}` }, { quoted: raw });
  }
}

async function findGroupJid(word) {
  const all = await sock.groupFetchAllParticipating();
  return Object.values(all).find((g) => (g.subject || '').toLowerCase().includes(word))?.id || null;
}

const sendTo = async (word, text) => {
  const jid = await findGroupJid(word);
  if (!jid) { logger.error(`group "${word}" not found (is the bot a member?)`); return; }
  await sock.sendMessage(jid, { text });
};

/** The PDF of a message as a document, or null for anything else. */
async function pdfOf(raw, groupId, { internal = false } = {}) {
  const file = normalizeMessageContent(raw.message)?.documentMessage;
  if (!file || !String(file.mimetype || '').includes('pdf')) return null;
  let info = await groupInfo(groupId);
  const sender = { sender: raw.key.participant, senderAlt: raw.key.participantAlt };
  let staff = staffChecker(config.staffNumbers, info.lidToPhone)(sender);
  if (staff === null) { info = await groupInfo(groupId, true); staff = staffChecker(config.staffNumbers, info.lidToPhone)(sender); }
  // The Invoices group is an internal group: whoever posts a PDF there is the office, even when the number is not in the list.
  if (staff === null && internal) staff = true;
  logger.info(`pdf in "${info.subject}": sender ${raw.key.fromMe ? 'is this account' : staff === null ? 'unknown' : staff ? 'office' : 'customer'}${internal && staff ? ' (internal group)' : ''}, size ${file.fileLength || '?'}`);
  if (staff === null) { logger.info(`pdf from unknown sender in ${groupId}, ignored (not in STAFF_NUMBERS)`); return null; }
  const buf = await downloadMediaMessage(raw, 'buffer', {});
  if (buf.length > 20 * 1024 * 1024) { logger.warn(`pdf too large in ${groupId}`); return null; }
  return { info, doc: { hash: createHash('sha256').update(buf).digest('hex'), base64: buf.toString('base64'), fileName: file.fileName || '', senderName: raw.pushName || '', staff } };
}

/**
 * Request group: a customer's PDF is a purchase order, remembered with its customer and PO number.
 * Invoice group: a colleague's PDF is an invoice, checked against its order before it goes to the customer.
 * The bot never answers a customer here.
 */
const nameStore = new NameStore(path.join(config.authDir, 'invoice-names'));

/** The check of an invoice file that has none yet (an old file, or the copy): the same read and arithmetic, one paid call, for the owner's order. */
async function checkForSend(buf) {
  const r = await readInvoice({ client, config, invoice: { base64: buf.toString('base64'), mimeType: 'application/pdf' } });
  const rows = r?.invoice?.lines;
  if (!rows?.length) return null;
  const inv = { ...r.invoice, lines: rows.map((l) => ({ ...l, code: productCode(l.code), printedCode: l.code })) };
  const customer = canon(r.invoice_customer || inv.customer || '');
  const ord = checkInvoiceAgainstOrders(tracker, { customer, at: Date.now(), lines: inv.lines }, { explain: true });
  const problems = [
    ...auditInvoice(inv, { book, day: new Date().toISOString().slice(0, 10), vatRate: config.vatRate, tol: config.moneyTolerance, customer }),
    ...ord,
  ];
  const urgent = problems.filter((p) => p.severity !== 'info');
  return { number: r.invoice_number || inv.number || '', customer: r.invoice_customer || inv.customer || '', total: inv.total ?? null, urgent: urgent.length, noOrder: problems.some((p) => p.kind === 'order-note'), orderState: ord.some((p) => p.kind === 'order-note') ? 'none' : 'text', orderPoints: ord.filter((p) => p.severity !== 'info').map(shortPoint).slice(0, 4), points: urgent.map(shortPoint).slice(0, 6) };
}

const customerGroups = new CustomerGroups(path.join(config.authDir, 'customer-groups')); // the owner's approved list: customer on the invoice -> group
const customerNames = new NameBook(path.join(config.authDir, 'customer-groups')); // the names the owner imported from his accounting export (names only, on the VM)
const customerDesk = new CustomerGroupDesk({ list: customerGroups, config, book: customerNames });
// QuickBooks Online: READ ONLY. Statements go only to the test group; nothing is written to QuickBooks (QBO_WRITE is off).
const qbo = new Qbo({
  config, dir: path.join(config.authDir, 'qbo'), log: (s) => logger.info(s),
  // an expired, revoked or invalid refresh token: the owner is told ONCE in his own chat, and no call is made until he reconnects
  onReconnect: () => { const own = ownIds()[0]; if (own && sock) sock.sendMessage(own, { text: '🤖 کوییک‌بوکس باید دوباره وصل شود. بنویسید: اتصال کوییک‌بوکس' }).catch(() => {}); },
});
setInterval(() => { qbo.keepFresh().catch(() => {}); }, 5 * 60 * 1000).unref(); // refresh before the access token expires, not only when a call finds it expired
const postDocument = async (jid, buf, fileName, caption) => { const r = await sock.sendMessage(jid, { document: buf, mimetype: 'application/pdf', fileName, caption }); if (!r) throw new Error('the document was not sent'); };
const allGroups = async () => Object.values(await sock.groupFetchAllParticipating()).map((g) => ({ id: g.id, subject: g.subject || '' }));
const qboChats = new Set(); // private chats of the people the owner authorized: the only extra chats the program may write to
const qboDesk = new QboDesk({
  qbo, list: customerGroups, aliases, map: new QboMap(path.join(config.authDir, 'qbo')), config,
  groups: allGroups,
  post: postDocument,
  today: () => localParts(Date.now(), config.timezone).day,
  log: (s) => logger.info(s),
});
// Invoices in QuickBooks: a request becomes a PREVIEW for the owner; only HIS "بله #Q12" in his own chat creates it (QBO_WRITE must be on too).
const qboAuth = new AuthStore(path.join(config.authDir, 'qbo'));
const qboInvoices = new QboInvoiceDesk({
  qbo, desk: qboDesk, store: new InvoiceStore(path.join(config.authDir, 'qbo')), audit: new Audit(path.join(config.authDir, 'qbo')), book, taxChoices: new TaxChoices(path.join(config.authDir, 'qbo')), itemCodes: new ItemCodes(path.join(config.authDir, 'qbo')),
  extract: (text) => extractInvoiceRequest({ client, config, text }), config,
  // the final cut of the customer and code, from the tracker (what the cutting group posted); marked with the invoice number once it is made
  cutsOf: (customer, codes) => cutRecords(tracker, customer, codes, { log: (s) => logger.info(s) }), markCuts: (refs, number) => markCutsInvoiced(tracker, refs, number),
  // the free stock of a code, for a warning line in an invoice preview (the sheet is read, nobody is told)
  stockOf: async (code) => { try { const r = await fetchStock(config, { code }); return r.found && !r.ambiguous ? { free: Number(r.free) || 0, unit: r.unit || '' } : null; } catch { return null; } },
  today: () => localParts(Date.now(), config.timezone).day, post: postDocument, ownerJid: () => ownIds()[0], groups: allGroups, testGroup: (g) => pickTestGroup(g, config), log: (s) => logger.info(s),
});
// The one-off upper-casing of the QuickBooks customer names: a preview (#N1) and the owner's yes; a sparse update of the two name fields only.
const qboNames = new QboNameDesk({ qbo, desk: qboDesk, audit: qboInvoices.audit, store: new NamePreviews(path.join(config.authDir, 'qbo')), log: (s) => logger.info(s) });
// The owner's other bulk jobs (e-mail #E, mobile #M, item tax code #T, base prices #P): same pattern, each changes only its own fields.
const qboBulk = new QboBulkDesk({ qbo, desk: qboDesk, audit: qboInvoices.audit, store: new BulkPreviews(path.join(config.authDir, 'qbo')), draft: new PriceDraft(path.join(config.authDir, 'qbo')), itemCodes: qboInvoices.itemCodes, config, log: (s) => logger.info(s) });
qboBulk.afterRun = () => { qboInvoices.cache.at = 0; }; // a changed item (inactive, moved, priced) is read again for the next invoice
/** The owner's invoice commands (his own chat): request, yes, no, pause, resume, audit, and the list of people allowed to ask. */
async function qboInvoiceCommand(ic, text) {
  switch (ic.type) {
    case 'names_plan': return qboNames.plan();
    case 'bulk_email': return qboBulk.planEmails(ic.email);
    case 'bulk_mobile': return qboBulk.planMobiles();
    case 'bulk_edge': return qboBulk.planEdgeList();
    case 'bulk_old_edge': return qboBulk.planOldEdge();
    case 'cost_report': return [cost.report(ic.range)];
    case 'adjust': return qboInvoices.adjust(ic);
    case 'yes_all': case 'no_all': return qboInvoices.decideAll({ verb: ic.type === 'yes_all' ? 'yes' : 'no' });
    case 'statement_nl': {
      if (ic.unsupported) return ['ماه شمسی را نمی‌توانم بسازم؛ ماه میلادی (مثل «ماه ۱۰ میلادی» یا «اکتبر») یا بازهٔ تاریخ بگویید.'];
      if (!ic.customer) { const out = ['صورت‌حساب کدام مشتری؟ نام را بنویسید یا بگویید.']; out.clarify = true; return out; }
      const blocked = qboInvoices.guard();
      if (blocked) return [blocked];
      const x = await qboDesk.statementFor(ic.customer, { privateJid: ownIds()[0], period: ic.period });
      const out = [x.text];
      if (x.ask) { out.clarify = true; if (x.options?.length) out.choice = { kind: 'statement', options: x.options, period: ic.period }; } // the next answer picks one
      return out;
    }
    case 'bulk_edge_names': return qboBulk.planEdgeNames();
    case 'bulk_undo': return qboBulk.planUndo({ scope: ic.scope, source: ic.source });
    case 'bulk_catalog': return qboBulk.planCatalog({ edge: ic.edge !== false });
    case 'bulk_tax': return qboBulk.planItemTax();
    case 'price_set': {
      const out = ic.lines.length ? await qboBulk.addPrices(ic.lines) : ['قیمت درست نیست (عدد ۰ تا ۱۰٬۰۰۰٬۰۰۰).'];
      if (ic.unread?.length) out.push(`این خط‌ها قیمت نبود و کنار گذاشته شد: ${ic.unread.slice(0, 10).map((x) => `«${x.slice(0, 40)}»`).join(' ')}\nقالب: قیمت <کد یا سری ۱۰۰> = <عدد>`);
      return out;
    }
    case 'price_list': return qboBulk.showDraft() || null;
    case 'price_remove': return qboBulk.removePrice(ic.code);
    case 'price_start': return qboBulk.planPrices();
    case 'request': { const r = await qboInvoices.request({ text, requester: 'owner' }); return [r.owner || r.requester]; }
    case 'yes': case 'no': {
      let id = ic.id; let said = '';
      if (!id) { // a bare yes or no: it counts only when exactly ONE preview is open (any kind); none: it is not ours; several: they are listed and nothing is done
        const open = [...qboInvoices.openIds(), ...qboNames.openIds(), ...qboBulk.openIds(), ...groupStatements.openIds()];
        if (!open.length) return null;
        if (open.length > 1) return [`چند پیش‌نمایش باز است: ${open.map((x) => `#${x}`).join('، ')}. چیزی انجام نشد؛ شمارهٔ پیش‌نمایش را بنویسید، مثل: ${ic.type === 'yes' ? 'بله' : 'نه'} #${open[0]}`];
        id = open[0]; said = `(${ic.type === 'yes' ? 'بله' : 'نه'} برای پیش‌نمایش #${id})\n`;
      }
      const out = await (id.startsWith('S') ? decideGroupStatement(ic.type, id) : id.startsWith('N') ? qboNames.decide({ verb: ic.type, id }) : /^[EMTPCUDRF]/.test(id) ? qboBulk.decide({ verb: ic.type, id }) : qboInvoices.decide({ verb: ic.type, id }));
      return said ? [said + out[0], ...out.slice(1)] : out;
    }
    case 'pause': qbo.setPaused(true); qboInvoices.audit.add({ event: 'pause', approver: 'owner' }); return ['کوییک‌بوکس متوقف شد: هیچ تماسی با آن گرفته نمی‌شود تا بنویسید «ادامهٔ کوییک‌بوکس».'];
    case 'resume': qbo.setPaused(false); qboInvoices.audit.add({ event: 'resume', approver: 'owner' }); return ['کوییک‌بوکس ادامه یافت.'];
    case 'audit': return [qboInvoices.auditText(10)];
    case 'tax_set': return qboInvoices.setTaxChoice({ customer: ic.customer, code: ic.code });
    case 'tax_list': return qboInvoices.taxListText();
    case 'item_code': return qboInvoices.setItemCode({ code: ic.code, item: ic.item, customer: ic.customer });
    case 'auth_add': {
      const n = qboAuth.grant(ic.number, ic.perm);
      if (n) qboInvoices.audit.add({ event: 'authorize', approver: 'owner', reason: `${n} ${ic.perm}` });
      return [n ? `مجوز ${PERMISSIONS[ic.perm].label} برای ${n} ثبت شد.${ic.perm === 'invoice' ? ' هر فاکتورش منتظر «بله» شما می‌ماند. (صورت‌حساب مجوز جدا دارد.)' : ''}` : 'شماره درست نیست (۸ تا ۱۵ رقم با کد کشور).'];
    }
    case 'auth_remove': { const ok = qboAuth.revoke(ic.number, ic.perm); if (ok) qboInvoices.audit.add({ event: 'deauthorize', approver: 'owner', reason: ic.perm }); return [ok ? `مجوز ${PERMISSIONS[ic.perm].label} برداشته شد.` : 'این شماره چنین مجوزی نداشت.']; }
    case 'auth_list': return [qboAuth.list().length ? ['مجازها:', ...qboAuth.list().map((p) => `• ${p.number}: ${p.grants.map((g) => PERMISSIONS[g]?.label || g).join('، ')}`)].join('\n') : 'کسی مجوز ندارد. بنویسید: مجوز فاکتور <شماره با کد کشور> یا مجوز صورت‌حساب <شماره با کد کشور>'];
    default: return [];
  }
}

/**
 * A person the owner authorized, in a private chat with the bot: an invoice request (becomes a PREVIEW for the owner; nothing is created) or a
 * statement for one customer (returned to that private chat only). Anything else from them is ignored as before. Replies are short English.
 */
async function authorizedFlow({ chatId, text, canInvoice = false, canStatement = false }) {
  const pend = choiceDesk.get(`pc:${chatId}`); // the number for the customer question she just asked this person
  if (pend?.kind === 'statement' && !pend.by && canStatement) {
    const at = parseChoice(text, pend.options);
    if (at >= 0) {
      choiceDesk.clear(`pc:${chatId}`);
      qboChats.add(chatId);
      try { const x = await qboDesk.statementFor(pend.options[at], { privateJid: chatId, period: pend.period }); await sock.sendMessage(chatId, { text: x.text }); } catch (e) { await sock.sendMessage(chatId, { text: 'صورت‌حساب ساخته نشد؛ دوباره بنویسید.' }); }
      return true;
    }
  }
  const ic = parseInvoiceCommand(text);
  const qc = ic ? null : parseQboCommand(text);
  const isRequest = ic?.type === 'request';
  const isStatement = qc?.type === 'statement';
  const nl = ic?.type === 'statement_nl' ? ic : null; // «صورت‌حساب شرکت … ماه ۱۰»: the same flow as the owner's, the PDF to this private chat
  if (!isRequest && !isStatement && !nl) return false;
  qboChats.add(chatId);
  const say = (t) => sock.sendMessage(chatId, { text: t });
  if (isRequest && !canInvoice) { await say('برای درخواست فاکتور مجوز ندارید.'); return true; }
  if ((isStatement || nl) && !canStatement) { await say('برای درخواست صورت‌حساب مجوز ندارید.'); return true; }
  try {
    if (nl) {
      if (nl.unsupported || !nl.customer) { await say(nl.unsupported ? 'ماه شمسی را نمی‌توانم بسازم؛ ماه میلادی یا بازهٔ تاریخ بگویید.' : 'صورت‌حساب کدام مشتری؟ نام را بنویسید.'); return true; }
      const blockedNow = qboInvoices.guard();
      if (blockedNow) { await say(blockedNow); return true; }
      const x = await qboDesk.statementFor(nl.customer, { privateJid: chatId, period: nl.period });
      await say(x.text);
      if (x.ask && x.options?.length) choiceDesk.set(`pc:${chatId}`, { kind: 'statement', options: x.options, period: nl.period });
      return true;
    }
    if (isRequest) {
      const r = await qboInvoices.request({ text, requester: jidDigits(chatId) });
      await say(r.requester);
      if (r.owner) await sock.sendMessage(ownIds()[0], { text: `🤖 ${r.owner}` });
    } else {
      const x = await qboDesk.statementOne(qc.name, chatId);
      if (!x.ok) await say('I could not find exactly one matching customer in QuickBooks (or QuickBooks is not available). Please ask the owner.');
    }
  } catch (e) {
    logger.warn(`authorized QuickBooks request failed: ${e.name} ${e.status || ''}`);
    await say(e.paused ? 'QuickBooks is paused by the owner.' : e.reconnect ? 'QuickBooks needs reconnecting; please tell the owner.' : 'I could not do that now. Please tell the owner.');
  }
  return true;
}
const taught = new TaughtStore(path.join(config.authDir, 'taught')); // what the owner taught in words: numbered, versioned, removable
const teachDesk = new TeachDesk({ store: taught });
const teachFx = () => ({ aliases, customerGroups, rules, watchList, config });

/** The owner's sentence of teaching (or his answer to her question): checked changes -> numbered confirmation. Saves nothing, sends nothing. false = nothing to teach. */
async function teachFlow({ text, reply, previous = null, explicit = false }) {
  const all = Object.values(await sock.groupFetchAllParticipating()).map((g) => ({ id: g.id, subject: g.subject || '' }));
  const names = mergeSources(customerNames.names(), { ...knownInvoiceCustomers() }).customers;
  const customers = [...new Set([...names, ...customerGroups.rows().map((r) => r.customer), ...Object.keys(aliases.map)])];
  // pairs the invoices already settled (never asked about again): the stored aliases and the near duplicates with exactly one name printed on an invoice
  const same = [...Object.entries(aliases.map).flatMap(([c, o]) => o.map((x) => [c, x])), ...settleDuplicates(names, knownInvoiceCustomers().customers).merges.flatMap((m) => m.others.map((o) => [m.main, o]))];
  const r = await runTeaching({ text, previous, explicit, client, config, customers, groups: all, fallbackRule: ruleFrom(text, config.botNames), same });
  if (r.kind === 'refuse') { await reply(r.message); return true; }
  if (r.kind === 'none') {
    if (previous) { await reply('پاسخ را نفهمیدم؛ دوباره بنویسید یا بنویسید نه. چیزی ذخیره نشد.'); return true; }
    return false;
  }
  customerDesk.pending = null; // this confirmation is the open question now
  await reply([teachDesk.propose(r.items, r.questions, { original: r.original, round: r.round }), r.note].filter(Boolean).join('\n'));
  return true;
}
const knownInvoiceCustomers = () => collectCustomers({ reads: nameStore.d.reads, events: tracker.events, aliasMap: aliases.map });
// A name printed on an invoice that differs from a stored customer but clearly is that customer: the row and its groups stay (never moved); the printed name
// becomes the main name (the stored one its alias) and one line goes to the daily digest.
nameStore.onCustomer = (printed) => { const note = learnPrintedName(printed, { list: customerGroups, aliases, config }); if (note) customerGroups.addNote(note); };
const oneShot = new OneShot();
const sendDesk = new SendDesk();

/** The owner's order "send the invoice of X into the customer's group": find the invoice and the group, then ask him. Nothing is sent here. */
async function startOwnerSend({ chatId, parsed, ctx, reply, lang = 'en' }) {
  const fa = lang === 'fa'; // the owner reads Persian, colleagues in company groups read English
  let found = null;
  const qdoc = ctx.quotedMessage ? normalizeMessageContent(ctx.quotedMessage)?.documentMessage : null;
  if (qdoc && /pdf/i.test(String(qdoc.mimetype || ''))) {
    const entry = { id: ctx.stanzaId, key: { remoteJid: chatId, id: ctx.stanzaId, participant: ctx.participant }, message: ctx.quotedMessage, fileName: qdoc.fileName || '' };
    let read = nameStore.recall(ctx.stanzaId);
    if (!read?.number || !read?.customer) {
      try {
        const buf = await downloadMediaMessage({ key: entry.key, message: entry.message }, 'buffer', {});
        const r = await readInvoice({ client, config, invoice: { base64: buf.toString('base64'), mimeType: 'application/pdf' } });
        if (r?.invoice_number && r?.invoice_customer) { nameStore.remember(ctx.stanzaId, r.invoice_number, r.invoice_customer); read = nameStore.recall(ctx.stanzaId); }
      } catch (e) { logger.warn(`owner send: the PDF could not be read (${e.message})`); }
    }
    if (read?.number && read?.customer) found = { entry, read: nameStore.fullRead(ctx.stanzaId) || read };
  } else {
    // the name he said, then his other names for that customer (aliases): "AL EBDA" finds the invoice of the customer it is an alias of
    for (const nm of [...new Set([parsed.customer, aliases.resolve(parsed.customer, []), ...altNames(aliases.map, parsed.customer)].filter((x) => x !== undefined))]) {
      found = findInvoice(nm, mediaKeep.list(), (id) => nameStore.fullRead(id) || nameStore.recall(id));
      if (found) break;
    }
  }
  // The check of this invoice, by its number (the original and its re-posted copy share it); none yet: the same read and arithmetic now.
  if (found && found.read.checked !== true) {
    try {
      const buf = await downloadMediaMessage({ key: found.entry.key, message: found.entry.message }, 'buffer', {});
      const c = await checkForSend(buf);
      if (c) { nameStore.setCheck(found.read.number, { total: c.total, urgent: c.urgent, noOrder: c.noOrder, orderState: c.orderState, orderPoints: c.orderPoints, points: c.points }); found.read = nameStore.fullRead(found.entry.id) || { ...found.read, ...c, checked: true }; }
    } catch (e) { logger.warn(`owner send: the check could not be made (${e.message})`); }
  }
  if (!found) { await reply(fa ? (qdoc ? 'این فاکتور را نتوانستم بخوانم، پس چیزی نمی‌فرستم.' : 'آن فاکتور میان فایل‌هایی که نگه داشته‌ام نیست. روی فایل فاکتور پاسخ دهید و دستور را بنویسید. چیزی فرستاده نشد.\nاگر می‌خواستید فاکتور تازه بسازم: «فاکتور بساز <مشتری>» و کالاها را بنویسید.') : (qdoc ? 'I could not read this invoice, so I send nothing.' : 'I do not have that invoice among the files I kept. Please reply to the PDF with the command. Nothing was sent.')); return; }
  const all = Object.values(await sock.groupFetchAllParticipating()).map((g) => ({ id: g.id, subject: g.subject || '' }));
  const row = customerGroups.find(found.read.customer, altNames(aliases.map, found.read.customer));
  const { groups, stale, unconfirmed } = resolveGroups(found.read.customer, all, config, row, altNames(aliases.map, found.read.customer));
  if (stale) { await reply(fa ? `گروه ثبت‌شده در فهرست برای ${found.read.customer} («${row.subject}») دیگر پیدا نمی‌شود یا گروه مشتری نیست. چیزی فرستاده نشد. اول فهرست را درست کنید.` : `The group saved in the list for ${found.read.customer} ("${row.subject}") is not there any more, or is no longer a customer group. Nothing was sent. Fix the list first.`); return; }
  if (!groups.length) { await reply(fa ? `برای ${found.read.customer} گروه مشتری پیدا نکردم. چیزی فرستاده نشد.` : `I found no customer group for ${found.read.customer}. Nothing was sent.`); return; }
  if (groups.length > 1) { sendDesk.start(chatId, { step: 'choose', invoice: found, groups, unconfirmed }); await reply(chooseText(groups, lang)); return; }
  sendDesk.start(chatId, { step: 'confirm', invoice: found, group: groups[0], unconfirmed });
  await reply(confirmText({ read: found.read, fileName: sendFileName(found.read), group: groups[0].subject, alreadySent: nameStore.sentTo(found.read.number, groups[0].id) ? (fa ? 'پیش‌تر' : 'before') : '', unconfirmed, lang }));
}

/** The owner's yes: send the same PDF bytes under the readable name to the one group, once, through the guard's one-shot token. */
async function finishOwnerSend({ chatId, pending, reply, lang = 'en' }) {
  const { invoice: { entry, read }, group } = pending;
  const file = sendFileName(read);
  try {
    const buf = await downloadMediaMessage({ key: entry.key, message: entry.message }, 'buffer', {});
    const content = { document: buf, mimetype: 'application/pdf', fileName: file };
    oneShot.grant(group.id, content);
    quietContents.add(content);
    const r = await sock.sendMessage(group.id, content);
    if (!r) throw new Error('the message was not sent');
    const p = localParts(Date.now(), config.timezone);
    const when = `${p.day} ${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`;
    nameStore.markSentTo(read.number, group.id, when, file);
    logger.info(`invoice ${read.number} sent to group "${group.subject}" by the owner's order`);
    await reply(lang === 'fa' ? `فاکتور ${read.number} به «${group.subject}» فرستاده شد (${when}، وقت دبی).` : `Sent ${read.number} to "${group.subject}" at ${when} (Dubai time).`);
  } catch (e) {
    logger.warn(`owner send of ${read.number} failed: ${e.message}`);
    await reply(lang === 'fa' ? `فرستادن فاکتور ${read.number} نشد (${e.message}). دوباره تلاش نشد.` : `Sending ${read.number} failed (${e.message}). Nothing was retried.`);
  }
}

// ---------------------------------------------------------------------------------------------------------------- statements asked for in a group
const groupStatements = new GroupStatements(); // built for a customer group, waiting for the owner's «بله #S1»
const sayIn = async (raw, chatId, where, body) => { // always Persian here (the owner and the authorized people read it), quoted first then plain
  const d = await deliver({ send: (...args) => sock.sendMessage(...args), chatId, content: { text: body }, quoted: raw, where, log: (s) => logger.info(s) });
  return d.result;
};
const personOf = (raw) => (raw.key.fromMe ? 'owner' : jidDigits(raw.key.participant || ''));
const quotedTextOf = (ctx) => {
  if (!ctx?.quotedMessage) return '';
  if (ctx.participant && ownIds().some((o) => jidDigits(o) === jidDigits(ctx.participant))) return ''; // her own message is never a request
  const quoted = textOf(normalizeMessageContent(ctx.quotedMessage)) || '';
  return quoted.startsWith('🤖') ? '' : quoted;
};
const addressedIn = (text, ctx) => isAddressed({
  text, mentioned: (ctx?.mentionedJid || []).map(jidNormalizedUser), quotedFrom: ctx?.participant ? jidNormalizedUser(ctx.participant) : '',
  ownIds: ownIds(), names: config.botNames,
});

/**
 * A statement in an INTERNAL group. The owner or an authorized person (۱) asks for it by her name or by quoting her; the PDF comes back in that group.
 * A numbered choice is kept for the person who asked. A colleague who is neither gets one Persian line. true = the message was taken.
 */
async function groupStatementTurn({ raw, chatId, text, ctx, owner, authorized, where, role }) {
  const may = owner || authorized;
  const by = personOf(raw);
  const pending = choiceDesk.get(`pc:${chatId}`);
  if (pending && pending.kind === 'statement' && pending.by) {
    if (may && pending.by === by) {
      const at = parseChoice(text, pending.options);
      if (at >= 0) {
        choiceDesk.clear(`pc:${chatId}`);
        trace(where, role, 'a numbered statement question was answered in the group');
        try {
          const x = await qboDesk.statementFor(pending.options[at], { privateJid: chatId, period: pending.period });
          await sayIn(raw, chatId, where, x.text);
        } catch (e) { await sayIn(raw, chatId, where, e.paused ? 'کوییک‌بوکس با فرمان مالک متوقف است.' : 'صورت‌حساب ساخته نشد؛ دوباره بنویسید.'); }
        return true;
      }
    }
  }
  if (!addressedIn(text, ctx)) return false;
  const ask = statementAsk(effectiveRequest(text, quotedTextOf(ctx), config.botNames));
  if (!ask) return false;
  if (!may) { trace(where, role, 'a statement request from a colleague who is not authorized'); await sayIn(raw, chatId, where, 'صورت‌حساب را فقط مالک یا کسی که مالک مجاز کرده می‌تواند بخواهد.'); return true; }
  trace(where, role, 'statement request in an internal group');
  if (ask.unsupported) { await sayIn(raw, chatId, where, 'ماه شمسی را نمی‌توانم بسازم؛ ماه میلادی (مثل «ماه ۱۰ میلادی» یا «اکتبر») یا بازهٔ تاریخ بگویید.'); return true; }
  if (!ask.customer) { await sayIn(raw, chatId, where, 'صورت‌حساب کدام مشتری؟ نام را بنویسید.'); return true; }
  const blocked = qboInvoices.guard();
  if (blocked) { await sayIn(raw, chatId, where, blocked); return true; }
  try {
    const x = await qboDesk.statementFor(ask.customer, { privateJid: chatId, period: ask.period });
    await sayIn(raw, chatId, where, x.text);
    if (x.ask && x.options?.length) choiceDesk.set(`pc:${chatId}`, { kind: 'statement', options: x.options, period: ask.period, by });
  } catch (e) {
    logger.warn(`group statement failed: ${e.name} ${e.status || ''}`);
    await sayIn(raw, chatId, where, e.paused ? 'کوییک‌بوکس با فرمان مالک متوقف است.' : e.reconnect ? 'کوییک‌بوکس باید دوباره وصل شود؛ به مالک بگویید.' : 'صورت‌حساب ساخته نشد؛ کمی بعد دوباره بنویسید.');
  }
  return true;
}

/** The statement is built but NOT sent: kept as «#S3» and shown to the owner in his own chat; nothing reaches the customer's group before his yes. */
async function prepareGroupStatement({ customer, period, groupId, subject, kind = 'group' }) {
  const own = ownIds();
  const tell = (body) => sock.sendMessage(own[0], { text: `🤖 ${body}` });
  const blocked = qboInvoices.guard();
  if (blocked) { await tell(blocked); return; }
  try {
    const x = await qboDesk.statementFor(customer, { hold: true, period });
    if (x.ask) {
      if (x.options?.length) for (const o of own) choiceDesk.set(`pc:${o}`, { kind: 'statement_group', options: x.options, period, groupId, subject, target: kind });
      await tell(`برای ${kind === 'private' ? subject : `گروه «${subject}»`}: ${x.text}`);
      return;
    }
    if (!x.ok) { await tell(x.text); return; }
    const id = groupStatements.add({ groupId, subject, held: x.held, name: x.name, period, kind });
    await postDocument(own[0], x.held.pdf, x.held.fileName, x.held.caption); // he sees the very file first
    await tell(`${askLine({ name: x.name, subject, id, period, kind })}${x.guessed ? `\n(نام را حدس زدم: «${x.typed}»؛ اگر درست نیست «نه #${id}» بنویسید.)` : ''}`);
  } catch (e) {
    logger.warn(`customer-group statement failed: ${e.name} ${e.status || ''}`);
    await tell(e.paused ? 'کوییک‌بوکس با فرمان مالک متوقف است.' : 'صورت‌حساب ساخته نشد؛ دوباره بنویسید.');
  }
}

/** The owner's «بله #S3» or «نه #S3»: only now the PDF goes to the customer's group (one-shot token for this group and this exact file). */
async function decideGroupStatement(verb, id) {
  const p = groupStatements.get(id);
  if (!p) return ['این صورت‌حساب پیدا نشد یا مهلتش (نیم ساعت) تمام شده؛ دوباره درخواست بدهید.'];
  groupStatements.clear(id);
  if (verb !== 'yes') return ['لغو شد؛ چیزی فرستاده نشد.'];
  const blocked = qboInvoices.guard();
  if (blocked) return [blocked];
  try {
    const content = { document: p.held.pdf, mimetype: 'application/pdf', fileName: p.held.fileName, caption: p.held.caption };
    oneShot.grant(p.groupId, content);
    quietContents.add(content);
    const r = await sock.sendMessage(p.groupId, content);
    if (!r) throw new Error('the message was not sent');
    logger.info(`statement sent to group "${p.subject}" by the owner's yes (${id})`);
    return [`صورت‌حساب «${p.name}» به ${p.kind === 'private' ? p.subject : `گروه «${p.subject}»`} فرستاده شد.`];
  } catch (e) {
    logger.warn(`statement send to a customer group failed: ${e.message}`);
    return [`فرستادن صورت‌حساب به ${p.kind === 'private' ? p.subject : `گروه «${p.subject}»`} نشد؛ دوباره تلاش نشد.`];
  }
}

/**
 * A customer group (not internal): the OWNER's request means «send this to the customer». true = the message was taken (never answered in the group).
 * A colleague's request is ignored there. Anyone else (a customer) is left to the normal flow.
 */
async function customerGroupStatement({ raw, groupId, info }) {
  const content = normalizeMessageContent(raw.message);
  const text = textOf(content) || '';
  if (!text || content?.audioMessage || content?.imageMessage || content?.documentMessage) return false;
  const ctx = content.extendedTextMessage?.contextInfo || {};
  if (!addressedIn(text, ctx)) return false;
  const ask = statementAsk(effectiveRequest(text, quotedTextOf(ctx), config.botNames));
  if (!ask) return false;
  const who = { sender: raw.key.participant, senderAlt: raw.key.participantAlt };
  const owner = !!raw.key.fromMe || staffChecker(config.ownerNumbers, info.lidToPhone)(who) === true;
  const where = `group "${info.subject}"`;
  if (!owner) {
    const colleague = staffChecker([...config.staffNumbers, ...config.adminNumbers], info.lidToPhone)(who) === true || qboAuth.isAuthorized(who, info.lidToPhone);
    if (colleague) { trace(where, 'staff', 'ignored: a colleague asked for a statement in a customer group (only the owner may)'); return true; }
    return false;
  }
  trace(where, 'owner', 'statement request in a customer group: asked in his own chat first');
  if (ask.unsupported || !ask.customer) {
    await sock.sendMessage(ownIds()[0], { text: `🤖 ${ask.unsupported ? 'ماه شمسی را نمی‌توانم بسازم؛ ماه میلادی یا بازهٔ تاریخ بگویید.' : `برای گروه «${info.subject}»: صورت‌حساب کدام مشتری؟ نام را همین‌جا بنویسید.`}` });
    return true;
  }
  await prepareGroupStatement({ customer: ask.customer, period: ask.period, groupId, subject: info.subject });
  return true;
}


// The PDFs seen in the Invoices group (and the test group): the last 50 messages (proto only) so invoices already sent can be named later.
const mediaKeep = new MediaKeep(path.join(config.authDir, 'invoice-media'), { replacer: BufferJSON.replacer, reviver: BufferJSON.reviver });
const keepPdf = (raw, groupId, fileName) => { const c = normalizeMessageContent(raw.message); if (c?.documentMessage) mediaKeep.add({ id: raw.key.id, groupId, key: raw.key, message: { documentMessage: c.documentMessage }, fileName: fileName || '', at: Date.now() }); };

/** Name the recent invoices that still have a meaningless file name (no quote needed). One short English line says how many. */
async function renameRecent(chatId) {
  const all = mediaKeep.list(chatId);
  if (!all.length) return 'I only keep the invoices posted since this update. New ones are named automatically; for an older file, reply to it with "Atossa rename".';
  const waiting = all.filter((e) => meaninglessName(e.fileName)).slice(0, 25);
  if (!waiting.length) return 'No recent invoice has a meaningless file name. New ones are named automatically; for an older file, reply to it with "Atossa rename".';
  let named = 0;
  let skipped = 0;
  for (const e of waiting) {
    try {
      const qraw = { key: e.key, message: e.message };
      if (nameStore.named(e.id, null)) { skipped++; continue; }
      const buf = await downloadMediaMessage(qraw, 'buffer', {}); // an expired file fails here and is counted as skipped
      let read = nameStore.recall(e.id);
      if (!read) {
        const r = await readInvoice({ client, config, invoice: { base64: buf.toString('base64'), mimeType: 'application/pdf' } });
        if (r?.invoice_number && r?.invoice_customer) { read = { number: r.invoice_number, customer: r.invoice_customer }; nameStore.remember(e.id, read.number, read.customer); }
      }
      if (!read || !readableFileName(read.number, read.customer) || nameStore.named(e.id, read.number)) { skipped++; continue; }
      if (await nameInvoice({ raw: qraw, groupId: chatId, fileName: e.fileName, base64: buf.toString('base64'), number: read.number, customer: read.customer, force: true })) named++; else skipped++;
      await new Promise((r) => setTimeout(r, 3000)); // a gap between the posts
    } catch (err) { skipped++; logger.warn(`rename: one invoice could not be named (${err.message})`); }
  }
  return `Named ${named} invoice${named === 1 ? '' : 's'}, skipped ${skipped} (already named, expired or unreadable). For an older file, reply to it with "Atossa rename".`;
}

/**
 * Give an invoice a readable name from what is printed on it. WhatsApp cannot rename a sent file, so the same PDF bytes are posted again
 * as a reply to the original under the readable file name; if that fails, one line is written. Automatic only for a meaningless file name,
 * once per message and per invoice number; [force] is the explicit request. Silent when the number or the customer is missing.
 */
async function nameInvoice({ raw, groupId, fileName, base64, number, customer, force = false }) {
  if (config.invoiceNameMode === 'off') return false;
  const file = readableFileName(number, customer);
  if (!file) return false;
  nameStore.remember(raw.key.id, number, customer);
  if (!force && (!meaninglessName(fileName) || nameStore.named(raw.key.id, number))) return false;
  let ok = false;
  if (config.invoiceNameMode === 'file' && base64) {
    try { const sentCopy = await sock.sendMessage(groupId, { document: Buffer.from(base64, 'base64'), mimetype: 'application/pdf', fileName: file }, { quoted: raw }); ok = !!sentCopy; if (sentCopy?.key?.id) nameStore.remember(sentCopy.key.id, number, customer); /* a reply to the copy finds the same read and check */ } catch (e) { logger.warn(`invoice re-post failed: ${e.message}`); }
  }
  if (ok) { nameStore.markNamed(raw.key.id, number, file); return true; }
  const sentLine = await sock.sendMessage(groupId, { text: nameLineText(number, customer) }, { quoted: raw });
  if (sentLine) nameStore.markNamed(raw.key.id, number, '');
  return !!sentLine;
}

async function watchGroup(raw, groupId, role) {
  // An invoice posted from this very account (the owner tests from it) is checked in the Invoices group: the bot never posts a PDF itself.
  if (raw.key.fromMe && role !== 'invoice') return;
  const got = await pdfOf(raw, groupId, { internal: role === 'invoice' });
  if (!got) return;
  const { info, doc } = got;
  // her own re-post under a readable name coming back: nothing is checked, recorded, read or renamed again
  if (raw.key.fromMe && nameStore.isOwnName(doc.fileName)) { logger.info('invoice pdf: her own re-post, ignored'); return; }
  if (role === 'invoice') keepPdf(raw, groupId, doc.fileName);
  if (role === 'request') {
    if (doc.staff) return; // a colleague's PDF in the customer group is the forwarded invoice
    const meta = await extractMeta({ client, config, doc });
    if (desk.addRequest(doc, { ...meta, mapped: rowOfGroup(customerGroups, groupId)?.customer || rowOfName(meta.customer)?.customer || '' }, info.subject)) logger.info(`${groupId}: purchase order ${meta.po || '(no number)'} of ${meta.customer || '?'} kept`);
    return;
  }
  if (!doc.staff) { logger.info(`invoice pdf not checked: sender is not the office`); return; }
  if (botState.paused) { logger.info('invoice pdf not checked: the assistant is paused'); return; }
  if (!desk.firstTime(doc.hash)) { logger.info('invoice pdf not checked: this file was already checked'); return; }
  if (!config.infoGroupName) { logger.warn('INFO_GROUP_NAME is not set: invoice check skipped'); return; }
  const meta = await extractMeta({ client, config, doc });
  const found = desk.find({ ...meta, mapped: rowOfName(meta.customer)?.customer || '' });
  const ctx = { groupName: info.subject, customer: meta.customer, invoiceFile: doc.fileName, invoiceSender: doc.senderName };
  let verdict;
  if (!found.request) {
    logger.info(`${groupId}: no purchase order for invoice (PO ${meta.po || '?'})`);
    // Without an order there is nothing to compare with, but the arithmetic, the prices and the number can still be checked.
    const read = await readInvoice({ client, config, invoice: doc });
    verdict = { verdict: 'no-order', request_customer: '', invoice_customer: read?.invoice_customer || meta.customer, invoice_number: read?.invoice_number || '', invoice: read?.invoice || null, problems: [] };
  } else {
    verdict = await checkInvoice({ client, config, request: found.request, invoice: doc });
  }
  if (verdict.verdict === 'error') {
    logger.info(`${groupId}: invoice check failed`);
    return;
  }
  // The arithmetic, the prices against the owner's list and the invoice number: plain checks on what was read.
  // The codes as the sheet and the list know them: "PVC FILM511" is 511 (the printed wording is kept as the description).
  if (verdict.invoice?.lines) verdict.invoice.lines = verdict.invoice.lines.map((l) => ({ ...l, code: productCode(l.code), printedCode: l.code }));
  const number = verdict.invoice_number || verdict.invoice?.number || '';
  const day = new Date().toISOString().slice(0, 10);
  // The item's own unit from the stock sheet for every code on the invoice (metres for film, pieces for hardware).
  const sheetUnits = {};
  for (const code of [...new Set((verdict.invoice?.lines || []).map((l) => String(l.code || '').trim()).filter(Boolean))].slice(0, 20)) {
    try { const r = await fetchStock(config, { code }); if (r.found && !r.ambiguous && r.unit) sheetUnits[code.toUpperCase()] = r.unit; } catch { /* the check goes on without it */ }
  }
  const own = (verdict.problems || []).map((p) => ({ severity: 'urgent', ...p }));
  // three honest states: a PDF order, an order in memory from the groups (text, low confidence) that was compared, or no order in memory
  const ordAll = !found.request && verdict.invoice
    ? checkInvoiceAgainstOrders(tracker, { customer: canon(verdict.request_customer || verdict.invoice_customer || meta.customer || ''), at: Date.now(), lines: verdict.invoice.lines || [] }, { explain: true }) : [];
  const memory = ordAll.filter((p) => p.kind !== 'order-note'); // the "no order" note is a state, not a point
  const orderState = found.request ? 'pdf' : (verdict.invoice && !ordAll.some((p) => p.kind === 'order-note') ? 'text' : 'none');
  const extra = [
    ...memory,
    ...(verdict.invoice ? auditInvoice(verdict.invoice, { book, day, vatRate: config.vatRate, tol: config.moneyTolerance, customer: verdict.request_customer || meta.customer, sheetUnits }) : []),
    ...(number ? checkNumber(number, desk.numbers(), tracker.deleted) : []),
  ];
  const problems = mergeProblems(own, extra);
  for (const p of problems) experience.bump(`ie|${p.kind}`);
  const urgent = problems.filter((p) => p.severity !== 'info').length;
  const priceUrgent = extra.filter((p) => p.kind === 'price-below' && p.severity !== 'info').length;
  const final = { ...verdict, problems, verdict: verdict.verdict === 'no-order' ? 'no-order' : urgent && verdict.verdict === 'match' ? 'mismatch' : verdict.verdict };
  logger.info(`${groupId}: invoice ${final.verdict}, ${problems.length} point(s), ${urgent} urgent${book.loaded ? '' : ', no price list stored'}`);
  if (config.trackerEnabled && final.verdict !== 'error') {
    const invoiceEvent = {
      type: 'invoice', at: Date.now(), ref: doc.hash, customer: canon(verdict.request_customer || verdict.invoice_customer || meta.customer || ''), number,
      total: verdict.invoice?.total ?? null, lines: (verdict.invoice?.lines || []).map((l) => ({ code: String(l.code || '').toUpperCase(), quantity: l.quantity, unit: l.unit })),
    };
    // the invoice stays open: the cut may come the next day (or have come before); it is compared when a cut arrives, and now
    if (tracker.add(invoiceEvent)) await cutReconcile(invoiceEvent.customer);
  }
  desk.record({ verdict: final.verdict, customer: verdict.request_customer || verdict.invoice_customer || meta.customer, po: meta.po, problems: problems.length, urgent, priceUrgent, noted: problems.length - urgent, number, orderState });
  // ONE short English message per invoice, only for a real mistake. A clean invoice, a missing order and every note are silent
  // here and only counted in the daily summary.
  if (urgent) await infoPost(invoiceFindingText({ number, customer: verdict.request_customer || verdict.invoice_customer || meta.customer, problems }, config.displayName));
  // The office user is told at once, in the invoices group, what to correct (urgent points only). Nothing is sent to a customer.
  const warn = staffWarning(final, config.displayName);
  if (warn) await sock.sendMessage(groupId, { text: warn });
  // The readable name, from the invoice itself (the read the check already made; no extra paid call). Never counted as a problem.
  nameStore.setCheck(number, { points: problems.filter((p) => p.severity !== 'info').map(shortPoint).slice(0, 6), total: verdict.invoice?.total ?? null, urgent, noOrder: orderState === 'none', orderState, orderPoints: memory.filter((p) => p.severity !== 'info').map(shortPoint).slice(0, 4) });
  try { await nameInvoice({ raw, groupId, fileName: doc.fileName, base64: doc.base64, number, customer: verdict.invoice_customer || verdict.invoice?.customer || '' }); } catch (e) { logger.warn(`invoice name failed: ${e.message}`); }
}

/** Reads the photos of a message with Claude's vision. Never throws. */
const captionCustomer = (text) => captionCustomerName(text, { canon, rowOfName, resolveLoose: (t) => qboDesk.resolveLoose(t) }); // a caption that is a customer's name is the customer of the order

async function understandPhotos(messagesWithImages, caption, fallbackLang, forceLang = '') {
  const images = [];
  for (const m of messagesWithImages.slice(-3)) {
    try { images.push(await m.loadImage()); } catch (e) { logger.warn(`photo download failed: ${e.message}`); }
  }
  if (!images.length) return { ok: false, reason: 'error' };
  return understandImages({
    images, caption, config, client, fallbackLang, forceLang, log: (s) => logger.info(s),
    // a code the stock sheet has never heard of is a reason to look again (a sheet that does not answer is not)
    // known = the current QuickBooks item names and SKUs (PVC-108, EDGE22-1810, "... - 1810"), the owner's price list, or the stock sheet; unreachable sources are not a reason
    knownCode: async (code) => {
      let reached = false;
      try { const cat = await qboInvoices.catalog(); reached = true; if (codeKnownInItems(cat.items, code)) return true; } catch { /* QuickBooks not reachable: the other sources decide */ }
      try { if (book.priceOf(code, '', new Date().toISOString().slice(0, 10))) return true; reached = true; } catch { /* no price list */ }
      try { const r = await fetchStock(config, { code }); reached = true; return !!(r.found || r.ambiguous); } catch { return true; }
    },
  });
}

/** Reads one voice note: download, speech to text, intent. Never throws. */
async function understandAudio(load, seconds, forceLang = '') {
  // A long note is not even downloaded.
  if (seconds > MAX_SECONDS) { logger.info(`voice: ${seconds} s is too long, skipped`); return { ok: false, reason: 'too long' }; }
  try { const buffer = await load(); cost.voice(seconds); return await understand({ buffer, seconds, config, client, transcribe: async (...a) => { usage.count(usageCtx.getStore()?.group || '-', 'speech'); return transcribe(...a); }, forceLang, log: (s) => logger.info(s) }); }
  catch (e) { logger.warn(`voice failed: ${e.message}`); return { ok: false, reason: 'error' }; }
}

/**
 * Customers' voice notes. A voice note is never acted on: it is answered with a question ("did I understand...?").
 * Only the customer's next written message counts: a clear yes lets the request go on as typed text.
 * Returns { done: true } when a message was sent here, else { messages } for the normal answer.
 */
async function customerVoiceStep(groupId, messages) {
  const key = `g:${groupId}`;
  const quoted = { quoted: lastRaw.get(groupId) };
  const voice = messages.filter((x) => x.isVoice).at(-1);
  if (voice) {
    const u = await understandAudio(voice.loadAudio, voice.seconds);
    if (!u.ok) {
      voiceDesk.clear(key);
      await sock.sendMessage(groupId, { text: u.reason === 'speech error' ? NO_VOICE_CUSTOMER : NOT_UNDERSTOOD_CUSTOMER }, quoted);
      return { done: true };
    }
    voiceDesk.set(key, { requestText: u.requestText, lang: u.lang });
    await sock.sendMessage(groupId, { text: u.confirmText }, quoted);
    return { done: true };
  }
  // A photo: read it, ask back, and act only after a yes. A picture of something else goes on to the normal answer.
  const photo = config.imageConfirm ? messages.filter((x) => x.loadImage).at(-1) : null;
  if (photo) {
    const u = await understandPhotos(messages.filter((x) => x.loadImage), photo.text, 'en');
    if (u.ok) {
      voiceDesk.set(key, { requestText: u.requestText, lang: u.lang, items: u.items });
      logger.info(`photo understood (${u.intent}), reply language ${u.lang}: asking for confirmation`);
      await sock.sendMessage(groupId, { text: u.confirmText }, quoted);
      return { done: true };
    }
    if (u.reason === 'unreadable' || u.reason === 'too big') {
      voiceDesk.clear(key);
      logger.info(`photo not usable (${u.reason}): the sender is asked for a clearer one`);
      await sock.sendMessage(groupId, { text: `${photoUnclear('fa')}\n${photoUnclear('en')}` }, quoted);
      return { done: true };
    }
    logger.info(`photo is not an order or stock request (${u.reason}): left to the normal answer`);
  }
  const pend = voiceDesk.get(key);
  const last = pend && messages.filter((x) => x.text && !x.hasImage && x.text !== '(voice note, sticker or file)').at(-1);
  if (last) {
    const kind = answerKind(last.text);
    voiceDesk.clear(key);
    if (kind === 'no') { await sock.sendMessage(groupId, { text: retryText(pend.lang) }, quoted); return { done: true }; }
    if (kind === 'yes') return { messages: [{ ...last, text: pend.requestText, hasImage: false, loadImage: null, lang: pend.lang, items: pend.items }] };
  }
  return { messages };
}

const jidDigits = (j) => String(j || '').replace(/@.*$/, '').replace(/:\d+$/, '').replace(/\D/g, '');
const ownIds = () => [sock.user?.id, sock.user?.lid].filter(Boolean).map(jidNormalizedUser);
const textOf = (content) => content?.conversation || content?.extendedTextMessage?.text || '';

const staffHandlersFor = (key, lang = 'fa') => ({
  staff_stock: async (i) => {
    try {
      const want = Number(i.quantity) > 0 ? { quantity: Number(i.quantity), unit: i.quantity_unit || '' } : null;
      const ask = want ? { quantity: want.quantity, quantity_unit: want.unit } : {};
      let found = await fetchStock(config, { code: i.code, category: i.category, size: i.size, ...ask });
      let note = '';
      if (found.sizeFound === false) {
        // The named size is not registered: answer for the whole code and say so.
        note = sizeNote(lang, i.size);
        found = await fetchStock(config, { code: i.code, category: i.category, size: '', ...ask });
      }
      // Which group was meant? The next message of the same person answers, even without the name.
      if (found.ambiguous) followDesk.set(key, { code: i.code, size: i.size || '', options: found.categories, lang });
      return {
        formatted: formatStaffStock(found, i.code, note, lang, want),
        instruction: 'Send the formatted text exactly as it is, character for character, with nothing added before or after.',
      };
    } catch (e) {
      // fetchStock has already logged the real cause and tried twice; the colleague gets a plain sentence.
      return {
        formatted: sheetFailed(lang, i.code, isTimeout(e)),
        instruction: 'Send the formatted text exactly as it is, character for character, with nothing added before or after.',
      };
    }
  },
  report_out: async (i) => {
    const instruction = 'Send the formatted text exactly as it is, character for character, with nothing added before or after.';
    const from = parseDay(i.from);
    const to = parseDay(i.to);
    if (!from || !to || from > to) return { formatted: reportInvalidDate(lang), instruction };
    try {
      const result = await fetchReport(config, { from, to, code: i.code, category: i.category, customer: i.customer, detail: !!i.detail });
      return { formatted: i.detail ? formatDetails(result, lang) : formatReport(result, lang), instruction };
    } catch (e) {
      return { formatted: reportFailed(lang, isTimeout(e)), instruction };
    }
  },
  recent_checks: (i) => desk.lastChecks(i.count),
  find_order: (i) => desk.listOrders(i),
});

/**
 * The team's side. [group] is null for a private chat, else { command: true if it is the command group }.
 * Staff are answered in private chats, in the staff/invoice/information/command groups when addressed (mention, a
 * reply to the bot, or its name), and the owner's commands run in a private chat or the command group. Messages typed
 * on the bot's own phone count as the owner. Returns true when the message was dealt with here.
 */
/**
 * The owner's price list. Sent as text ("لیست قیمت جدید" and the rows), a photo or a PDF with "قیمت" in the caption, in a
 * private chat or the command group by an admin: Claude (or a plain reader for simple rows) turns it into a table, the
 * table is shown back, and only a "yes" stores it as the next version. Prices are never logged and never leave this chat.
 * Also "لیست قیمت", "قیمت کد 408", "قیمت کد 408 برای <customer>", "مشتری استثنا <customer> کد 408 قیمت 11.5".
 */
async function handlePriceFlow({ raw, content, text, key, reply, role, where, image, pdf }) {
  const pending = priceDesk.get(key);
  if (pending && text) {
    const kind = answerKind(text);
    priceDesk.clear(key);
    if (kind === 'yes') {
      const saved = book.save(pending.next, role);
      trace(where, role, `price list stored as version ${saved.version} (${Object.keys(saved.items).length} codes, ${saved.exceptions.length} exceptions)`);
      await reply(`ثبت شد: نسخهٔ ${saved.version}. نسخهٔ پیشین نگه داشته شد.`);
      return true;
    }
    if (kind === 'no') { await reply('لغو شد. چیزی ثبت نشد.'); return true; }
  }
  const command = parsePriceCommand(text);
  if (command?.type === 'show') { await reply(formatBook(book)); return true; }
  if (command?.type === 'code') { await reply(formatCodePrice(book, command.code, command.customer)); return true; }
  if (command?.type === 'exception') {
    const next = book.withException(command.exception);
    priceDesk.set(key, { next });
    await reply(`استثنای تازه: ${command.exception.customer}، کد ${command.exception.code} = ${Number(command.exception.price).toFixed(2)} درهم${command.exception.from ? ` از ${command.exception.from}` : ''}${command.exception.to ? ` تا ${command.exception.to}` : ''}\nدرست است؟ (بله / نه)`);
    return true;
  }
  const looksLikePrice = /قیمت|price/i.test(text);
  let blocks = null;
  let parsed = null;
  if (command?.type === 'new-list') {
    const items = parsePriceText(command.text);
    if (Object.keys(items).length) parsed = { currency: book.data.currency || 'AED', items, exceptions: [] };
    else blocks = [{ type: 'text', text: command.text }];
  } else if ((image || pdf) && looksLikePrice) {
    const buf = await downloadMediaMessage(raw, 'buffer', {});
    const b64 = buf.toString('base64');
    blocks = [
      documentBlock({ base64: b64, mimeType: image ? String(image.mimetype || 'image/jpeg').split(';')[0] : 'application/pdf' }), // a PDF with a text layer is sent as text (free)
      { type: 'text', text: text || 'Price list.' },
    ];
  }
  if (!parsed && blocks) parsed = await parsePriceDocument({ client, config, blocks });
  if (!parsed && (blocks || command?.type === 'new-list')) { await reply('نتوانستم لیست قیمت را بخوانم. لطفاً متن یا فایل واضح‌تری بفرستید.'); return true; }
  if (!parsed) return false;
  // A list without exceptions keeps the ones already stored.
  const next = { currency: parsed.currency, items: parsed.items, exceptions: parsed.exceptions.length ? parsed.exceptions : book.data.exceptions };
  priceDesk.set(key, { next });
  trace(where, role, `price list received (${Object.keys(next.items).length} codes, ${next.exceptions.length} exceptions): waiting for confirmation`);
  await reply(formatParsed(next));
  return true;
}

/**
 * A colleague posts a customer's request in a company group ("Bahar: 408 - 15 mtr"). The stock is checked and answered in
 * the staff format, a request the stock cannot cover comfortably goes to the sales manager with the customer's name, and
 * the order is recorded for the tracker. Nothing is written to the customer.
 */
async function handleOnBehalf({ ob, raw, reply, role, where, lang, test = false }) {
  const T = trackerOf(test);
  const customer = canon(ob.customer);
  const blocks = [];
  let toManager = 0;
  for (const line of ob.lines) {
    let res;
    try { res = await fetchStock(config, { code: line.code, quantity: line.quantity, quantity_unit: line.unit }); } catch (e) { blocks.push(sheetFailed(lang, line.code, isTimeout(e))); continue; }
    const d = classify(res);
    const verdict = d.kind === 'ok' ? 'کافی است؛ می‌شود به مشتری موجود گفت' : d.kind === 'manager' ? 'کافی نیست یا کمتر از حداقل می‌ماند؛ به مدیر فروش گزارش شد' : 'کد ناشناخته یا در چند گروه است';
    blocks.push(`${formatStaffStock(res, line.code, '', lang)}\n\n→ ${customer}: ${line.quantity} ${line.unit}: ${verdict}`);
    if (d.kind === 'manager' && config.salesManager && !test) {
      const key = `${customer}|${String(res.code).toLowerCase()}|behalf`;
      const last = recent.get(key);
      if (!(last && Date.now() - last < config.dedupeMinutes * 60000)) {
        recent.set(key, Date.now());
        await sock.sendMessage(config.salesManager, { text: managerMessage(res, { customer, groupName: where }, line) });
        toManager++;
      }
    }
  }
  if (config.trackerEnabled) {
    T.add({ type: 'order', at: Date.now(), customer, lines: ob.lines.map((l) => ({ code: l.code, quantity: l.quantity, unit: l.unit })), ref: createHash('sha256').update(`behalf|${raw.key.id}`).digest('hex').slice(0, 24) });
  }
  trace(where, role, `request on behalf of a customer: ${ob.lines.length} line(s), ${toManager} sent to the sales manager`);
  await reply([`درخواست ${customer}:`, ...blocks].join('\n\n'));
}

/**
 * An invoice (a PDF or a photo) shown to the assistant in a colleague's chat: read, checked (arithmetic, VAT, prices, number,
 * and the order memory of the customer) and answered in that chat. Nothing goes to the Information group, nothing is recorded
 * for the digest. In a test group the order memory is the test one.
 */
const INVOICE_FAILED = 'بررسی فاکتور با خطا روبه‌رو شد؛ دوباره بفرستید یا به مدیر خبر بدهید.';
const ORDER_FAILED = 'ثبت یا بررسی این سفارش با خطا روبه‌رو شد؛ دوباره بفرستید یا به مدیر خبر بدهید.';

async function onDemandInvoice(args) {
  try { await onDemandInvoiceRun(args); } catch (e) {
    // an internal failure is said as one, never blamed on the photo; the cause goes to the log
    logger.error(`invoice check failed: ${e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e.message}`);
    await args.reply(INVOICE_FAILED);
  }
}

async function onDemandInvoiceRun({ doc, reply, where, role, test, hint = '', after = null }) {
  const T = trackerOf(test);
  const read = await readInvoice({ client, config, invoice: doc });
  const rows = Array.isArray(read?.invoice?.lines) ? read.invoice.lines : [];
  if (!rows.length) { trace(where, role, 'invoice check: nothing readable'); await reply('این را به‌عنوان فاکتور نخواندم؛ خوانا نبود یا ردیفی در آن ندیدم.'); return; }
  const inv = { ...read.invoice, lines: rows.map((l) => ({ ...l, code: productCode(l.code), printedCode: l.code })) };
  const customer = canon(read.invoice_customer || inv.customer || hint || '');
  const number = read.invoice_number || inv.number || '';
  const sheetUnits = {};
  for (const code of [...new Set(inv.lines.map((l) => String(l.code || '').trim()).filter(Boolean))].slice(0, 20)) {
    try { const r = await fetchStock(config, { code }); if (r.found && !r.ambiguous && r.unit) sheetUnits[code.toUpperCase()] = r.unit; } catch { /* the check goes on without it */ }
  }
  const day = new Date().toISOString().slice(0, 10);
  const problems = [
    ...auditInvoice(inv, { book, day, vatRate: config.vatRate, tol: config.moneyTolerance, customer, sheetUnits }),
    ...(number ? checkNumber(number, test ? [] : desk.numbers(), T.deleted) : []),
    ...checkInvoiceAgainstOrders(T, { customer, at: Date.now(), lines: inv.lines }, { explain: true }),
    ...sourcingCover(T, { customer, at: Date.now(), lines: inv.lines }),
  ];
  trace(where, role, `invoice check on request: ${problems.length} point(s), ${problems.filter((p) => p.severity !== 'info').length} urgent${book.loaded ? '' : ', no price list stored'}`);
  await reply(onDemandText({ problems, customer, number, name: '', groupName: where }));
  if (after) await after({ number, customer: read.invoice_customer || inv.customer || '', total: inv.total ?? null, urgent: problems.filter((p) => p.severity !== 'info').length, noOrder: problems.some((p) => p.kind === 'order-note'), points: problems.filter((p) => p.severity !== 'info').map(shortPoint).slice(0, 6) });
}

async function handleStaffChat(raw, chatId, group) {
  const content = normalizeMessageContent(raw.message);
  const audio = config.voiceEnabled ? content?.audioMessage : null;
  let image = config.imageConfirm ? imageOf(content) : null;
  let imageRaw = raw; // the message the picture is downloaded from (the quoted or the earlier one when she is asked about "the picture above")
  if (imageOf(content)) { lastPhotos.set(`${chatId}:${jidDigits(raw.key.participant || raw.key.remoteJid)}`, { raw, image: imageOf(content), at: Date.now() }); if (lastPhotos.size > 80) lastPhotos.delete(lastPhotos.keys().next().value); }
  const pdf = content?.documentMessage && /pdf/i.test(String(content.documentMessage.mimetype || '')) ? content.documentMessage : null;
  let text = textOf(content) || image?.caption || pdf?.caption || '';
  if (!text && !audio && !image && !pdf) {
    // Never silent: say which kind of message was left alone (its kind only, never its content).
    const kind = ignoredKind(content);
    if (kind) trace(group ? `group "${(await groupInfo(chatId)).subject}"` : 'private', raw.key.fromMe ? 'owner' : 'unknown', `ignored: a ${kind} is not a text, voice note or photo`);
    return false;
  }
  if (sent.has(raw.key.id) || text.startsWith('🤖')) return true; // the bot's own message coming back
  const where = group ? `group "${(await groupInfo(chatId)).subject}"` : 'private';
  const own = ownIds();
  const isSelf = own.some((o) => jidDigits(o) === jidDigits(chatId));
  // The line from the public QuickBooks page carries an authorization code: only the owner's own chat may take it, and it never reaches a model, a trace or anyone else.
  if (text && looksLikeConnectLine(text) && !(isSelf && isOwnerCommand({ fromMe: !!raw.key.fromMe, id: raw.key.id, text, sentIds: sent, forwarded: !!(((content.extendedTextMessage || audio || image)?.contextInfo || {}).isForwarded) }))) {
    trace(where, 'owner', 'ignored: a QuickBooks connect line that is not from the owner\'s own chat');
    return true;
  }
  if (!group && raw.key.fromMe && !isSelf) { // from the bot's phone, in the owner's chat with another person
    const octx = (content.extendedTextMessage || {}).contextInfo || {};
    const waitingChoice = choiceDesk.get(`pc:${chatId}`);
    if (waitingChoice?.by === 'owner' && text && !audio && !image && parseChoice(text, waitingChoice.options) >= 0) { staffChats.add(chatId); } // his number for the question she just asked there
    else if (!text || audio || image || !addressedIn(text, octx)) { trace(where, 'owner', 'ignored: the owner talking to someone else'); return false; } // only her name (or a reply to her) wakes her
    if (!(waitingChoice?.by === 'owner' && !addressedIn(text, octx))) {
    const other = { sender: chatId, senderAlt: raw.key.remoteJidAlt };
    const otherInfo = { lidToPhone: new Map() };
    const otherStaff = staffChecker([...config.staffNumbers, ...config.adminNumbers, ...qboAuth.numbers()], otherInfo.lidToPhone)(other) === true;
    const octxAsk = statementAsk(effectiveRequest(text, quotedTextOf(octx), config.botNames));
    if (octxAsk) {
      if (octxAsk.unsupported || !octxAsk.customer) { await sayIn(raw, chatId, where, octxAsk.unsupported ? 'ماه شمسی را نمی‌توانم بسازم؛ ماه میلادی یا بازهٔ تاریخ بگویید.' : 'صورت‌حساب کدام مشتری؟ نام را بنویسید.'); return true; }
      if (otherStaff) { // a colleague: the answer is in that chat
        staffChats.add(chatId);
        trace(where, 'owner', 'statement asked by the owner in a private chat with a colleague: answered there');
        const blockedNow = qboInvoices.guard();
        if (blockedNow) { await sayIn(raw, chatId, where, blockedNow); return true; }
        try { const x = await qboDesk.statementFor(octxAsk.customer, { privateJid: chatId, period: octxAsk.period }); await sayIn(raw, chatId, where, x.text); if (x.ask && x.options?.length) choiceDesk.set(`pc:${chatId}`, { kind: 'statement', options: x.options, period: octxAsk.period, by: 'owner' }); }
        catch (e) { await sayIn(raw, chatId, where, e.paused ? 'کوییک‌بوکس با فرمان مالک متوقف است.' : 'صورت‌حساب ساخته نشد؛ دوباره بنویسید.'); }
        return true;
      }
      // not a colleague (a customer or unknown): nothing is said there; the owner decides in his own chat
      trace(where, 'owner', 'statement asked by the owner in a private chat with someone who is not staff: asked in his own chat first');
      await prepareGroupStatement({ customer: octxAsk.customer, period: octxAsk.period, groupId: chatId, subject: `شمارهٔ ${jidDigits(chatId)}`, kind: 'private' });
      return true;
    }
    if (!otherStaff) { trace(where, 'owner', 'ignored: addressed to her in a chat with someone who is not staff'); return false; }
    staffChats.add(chatId); // a colleague: the rest of the flow answers in that chat
    }
  }
  let admin = !!raw.key.fromMe;
  let ownerPerson = !!raw.key.fromMe; // typed on the account's own phone counts as the owner
  let authorizedPerson = false; // a person the owner authorized for statements (in a group)
  if (!raw.key.fromMe) {
    let info = group ? await groupInfo(chatId) : { lidToPhone: new Map() };
    const who = group ? { sender: raw.key.participant, senderAlt: raw.key.participantAlt } : { sender: chatId, senderAlt: raw.key.remoteJidAlt };
    let staff = staffChecker(config.staffNumbers, info.lidToPhone)(who);
    if (staff === null && group) { info = await groupInfo(chatId, true); staff = staffChecker(config.staffNumbers, info.lidToPhone)(who); }
    // a person the owner authorized for invoices and statements: only those commands are taken, in a private chat (the rest is ignored as before)
    if (!group && text && qboAuth.isAuthorized(who, info.lidToPhone) && (await authorizedFlow({ chatId, text, canInvoice: qboAuth.has(who, 'invoice', info.lidToPhone), canStatement: qboAuth.has(who, 'statement', info.lidToPhone) }))) { trace(where, 'authorized', 'QuickBooks request'); return true; }
    // an authorized person (not staff) may ask for a statement by her name in an internal group; nothing else of theirs is taken
    if (group && !staff && text && !audio && !image && qboAuth.has(who, 'statement', info.lidToPhone)) {
      const gctx = (content.extendedTextMessage || {}).contextInfo || {};
      if (await groupStatementTurn({ raw, chatId, text, ctx: gctx, owner: false, authorized: true, where, role: 'authorized' })) return true;
    }
    authorizedPerson = !!(group && qboAuth.has(who, 'statement', info.lidToPhone));
    if (!staff) { trace(where, 'not-staff', group ? 'left to the customer flow' : 'ignored: private chat from a number that is not staff'); return false; }
    admin = staffChecker(config.adminNumbers, info.lidToPhone)(who) === true;
    ownerPerson = staffChecker(config.ownerNumbers, info.lidToPhone)(who) === true;
    if (!group) staffChats.add(chatId);
  }
  const role = admin ? 'admin' : 'staff';
  // The language follows the PLACE: English in every company group (even for the owner writing Persian, even in the test group),
  // Persian only in a private chat with the owner. In the test group the prefix "as customer:" or "as staff:" (or "as owner:", the
  // private chat language) plays another person, to try the other languages.
  let persona = '';
  if (group?.test) {
    const pm = /^\s*as\s+(customer|staff|owner)\s*:\s*/i.exec(text);
    if (pm) { text = text.slice(pm[0].length); persona = pm[1].toLowerCase(); }
  }
  const staffLang = placeLanguage({ kind: group ? 'company-group' : 'private', owner: ownerPerson, persona, written: detectLang(text, 'en'), sentence: isEnglishSentence(text) });
  const keepLanguage = persona === 'customer' || persona === 'owner'; // a played person keeps its own language, nothing is translated
  const reply = async (body) => {
    const said = staffLang === 'en' ? toEnglish(body) : body;
    const content = { text: isSelf ? `🤖 ${said}` : said };
    if (keepLanguage) keepLang.add(content);
    // every reply is accounted for: quoted first (a forwarded picture as the quote may not go through), then plain; the log says what really happened
    const d = await deliver({ send: (...a) => sock.sendMessage(...a), chatId, content, quoted: raw, where, log: (s) => logger.info(s) });
    lastReplyOk = d.ok;
    return d.result;
  };
  let lastReplyOk = false;
  // A voice note that would change something waits for its «بله»: the same person's yes runs the transcript as if typed, a no drops it,
  // and any other text is the corrected text that takes its place (it is simply handled as typed).
  const gateKey = `vg:${chatId}:${jidDigits(raw.key.participant || raw.key.remoteJid)}`;
  const rerunAsText = async (said) => handleStaffChat({ key: { ...raw.key, id: `VOICE-${raw.key.id}-${Date.now()}` }, message: { conversation: said }, pushName: raw.pushName, messageTimestamp: Math.floor(Date.now() / 1000) }, chatId, group);
  // A statement asked for in an internal group (the owner or an authorized person): answered in that group.
  if (group && text && !audio && !image && (await groupStatementTurn({ raw, chatId, text, ctx: (content.extendedTextMessage || {}).contextInfo || {}, owner: ownerPerson, authorized: authorizedPerson, where, role }))) return true;
  // A numbered question just asked waits for its answer: «1», «۱», «یک», «اولی», «شماره یک درست است» or the name itself. Nothing else may take this message.
  const pending = text && !audio && !image ? choiceDesk.get(`pc:${chatId}`) : null;
  if (pending && (!pending.by || (!group && pending.by === personOf(raw)))) {
    const at = parseChoice(text, pending.options);
    if (at >= 0) {
      choiceDesk.clear(`pc:${chatId}`);
      trace(where, role, 'a numbered question was answered');
      if (pending.kind === 'statement_group') {
        for (const o of ownIds()) choiceDesk.clear(`pc:${o}`);
        await prepareGroupStatement({ customer: pending.options[at], period: pending.period, groupId: pending.groupId, subject: pending.subject, kind: pending.target || 'group' });
      } else if (pending.kind === 'statement') {
        try {
          const x = await qboDesk.statementFor(pending.options[at], { privateJid: isSelf ? ownIds()[0] : chatId, period: pending.period });
          await reply(x.text);
        } catch (e) { await reply(e.paused ? 'کوییک‌بوکس با فرمان مالک متوقف است.' : 'صورت‌حساب ساخته نشد؛ دوباره بنویسید.'); }
      }
      return true;
    }
  }
  // the echo of a transcript (merged or not), then by its class: a question runs, a change waits for the yes
  const actOnTranscript = async (said, lang) => {
    const pv = planVoice({ transcript: said, lang, priv: true });
    await sock.sendMessage(chatId, { text: `${isSelf ? '🤖 ' : ''}${pv.echo}${pv.mode === 'ask' ? `\n${pv.prompt}` : ''}` }, { quoted: raw });
    if (pv.mode === 'ask') { voiceGate.set(gateKey, said, 'ask'); trace(where, role, 'voice note: it would change something, waiting for the yes'); return true; }
    trace(where, role, 'voice note: a plain question, run at once as typed');
    return rerunAsText(said);
  };
  const waiting = text && !audio ? voiceGate.get(gateKey) : null;
  if (waiting) {
    const k = answerKind(text);
    if (k === 'yes' && waiting.kind === 'ask') { voiceGate.clear(gateKey); trace(where, role, 'voice note: the yes came, the transcript is run as typed'); return rerunAsText(waiting.text); }
    if (k === 'no') { voiceGate.clear(gateKey); if (waiting.kind === 'ask') { await reply(staffLang === 'en' ? 'Cancelled.' : 'لغو شد.'); return true; } }
    else if (isShortCorrection(text) && !parseInvoiceCommand(text) && !parseQboCommand(text)) {
      // a short reply corrects a part of the waiting request: merged into it, never run on its own
      const merged = await mergeTranscripts({ client, config, original: waiting.text, correction: text });
      if (merged) { voiceGate.clear(gateKey); trace(where, role, 'voice note: a short reply was merged into the waiting request'); return actOnTranscript(merged, detectLang(merged, 'fa')); }
      voiceGate.clear(gateKey);
    } else { voiceGate.clear(gateKey); trace(where, role, 'voice note: a corrected text replaces the transcript'); }
  }
  // The sales manager answers a request about stock ("#12 yes", a reply to the question, or the only open one).
  if (!group && avail.open.size) {
    const reply0 = parseManagerReply(text, answerKind);
    const isManager = [chatId, raw.key.remoteJidAlt].some((j) => j && jidDigits(j) === jidDigits(config.salesManager));
    const req = reply0.action === 'none' ? null : avail.find({
      quotedId: content?.extendedTextMessage?.contextInfo?.stanzaId, id: reply0.id,
      allowSingle: (isManager || !!raw.key.fromMe) && ['yes', 'no', 'self'].includes(reply0.action),
    });
    if (req) {
      const done = await answerRequest({
        req, reply: reply0, desk: avail, log: (s) => trace(where, role, s),
        send: (r, t) => sock.sendMessage(r.groupId, { text: t }, r.quoted?.raw ? { quoted: r.quoted.raw } : undefined),
        translate: translateTo,
      });
      await reply(done);
      return true;
    }
  }
  const cmd = admin && (!group || group.command) ? parseCommand(text, { bare: true }) : null;
  if (cmd) { trace(where, role, `command ${cmd}`); await reply(runCommand(cmd, { name: config.displayName, state: botState, corrections: () => readCorrections(config.authDir), desk, staffNumbers: config.staffNumbers, startedAt })); return true; }
  const ctx = (content.extendedTextMessage || audio || image)?.contextInfo || {};
  const addressed = !group || isAddressed({
    text, mentioned: (ctx.mentionedJid || []).map(jidNormalizedUser), quotedFrom: ctx.participant ? jidNormalizedUser(ctx.participant) : '',
    ownIds: own, names: config.botNames,
  });
  // Cost control: in the cut, delivery, confirmation, information and invoices groups a photo or a voice note is never read by itself
  // (no download, no vision, no speech); only a message that addresses her by name, or answers her, may be.
  if ((audio || image) && !mayReadMedia({ group, addressed })) { trace(where, role, 'media left alone (cost control): not addressed to the assistant'); return true; }
  // The pipeline commands of the owner: a hold on delivery until cash is confirmed, the balance of a customer, the open orders.
  if (admin && (!group || group.command)) {
    const tc = parseTrackerCommand(text);
    if (tc) {
      if (tc.type === 'hold') { tracker.setHold(tc.customer); trace(where, role, 'delivery hold set'); await reply(`ثبت شد: تحویل به ${tc.customer} تا تأیید نقدی ممنوع است و در گروه تحویل یادآوری می‌شود.`); }
      else if (tc.type === 'release') { await reply(tracker.clearHold(tc.customer) ? `ممنوعیت تحویل ${tc.customer} برداشته شد.` : `برای ${tc.customer} ممنوعیتی ثبت نبود.`); }
      else if (tc.type === 'balance') { await reply(formatBalance(tc.customer, balanceOf(tracker, tc.customer))); }
      else if (tc.type === 'orders') { await reply(openOrders(tracker, desk.requests)); }
      return true;
    }
  }
  // The owner teaches in words: kept at once as a durable rule (not sent to the review list), confirmed in one line.
  // TEACHING IN WORDS (his own chat, the owner only): the answers to a confirmation, "what have you learned", "forget N", and a sentence that
  // starts like a teaching. One call understands the sentence; nothing is saved before his yes. No explicit start -> after every other command.
  if (config.ownerTeach && text && !audio && !image && !group && isSelf && isOwnerCommand({ fromMe: !!raw.key.fromMe, id: raw.key.id, text, sentIds: sent, forwarded: !!(ctx.isForwarded || ctx.forwardingScore > 0) })) {
    const tp = teachDesk.wants(text, { other: !!(customerDesk.wants(text) || parseAliasCommand(text) || parseRuleCommand(text) || parseSendCommand(text)) });
    if (tp?.type === 'answer') { if (await teachFlow({ text: tp.text, reply, previous: teachDesk.pending })) return true; } // his answer to her question: the open items are kept
    else if (tp) { for (const part of teachDesk.handle(tp, teachFx())) await reply(part); return true; }
    if (isExplicitTeaching(text) && (await teachFlow({ text, reply, explicit: true }))) return true; // every trigger (old and new) goes through his yes
  }
  // The owner teaches a rule in words: only HE can add or remove one (typed on this account, not sent by the program, not forwarded).
  if (admin && addressed && !audio && !image && isOwnerCommand({ fromMe: !!raw.key.fromMe, id: raw.key.id, text, sentIds: sent, forwarded: !!(ctx.isForwarded || ctx.forwardingScore > 0) })) {
    const rc = parseRuleCommand(text);
    if (rc) { await reply(rc.list ? rules.list() : rules.remove(rc.remove) ? `قانون ${rc.remove} برداشته شد.` : 'قانونی با این شماره نبود.'); return true; }
    // Nothing is stored at once any more: a teaching is understood, shown and saved only after his yes, in his own chat.
    if (ruleFrom(text, config.botNames)) { await reply('برای یاد دادن، در گفتگوی خودتان با من بنویسید: اول می‌گویم چه فهمیدم و فقط بعد از «بله» ذخیره می‌کنم. چیزی ذخیره نشد.'); return true; }
  }
  if (admin && (!group || group.command || group.test)) {
    const sc = parseShadowCommand(text);
    if (sc) {
      if (sc.type === 'on' || sc.type === 'off') { shadowStore.setEnabled(sc.type === 'on'); await reply(sc.type === 'on' ? 'Shadow mode is on.' : 'Shadow mode is off.'); return true; }
      const day = localParts(Date.now(), config.timezone).day;
      const d = shadowStore.day(day);
      const pp = postingProblems(shadowStore);
      await reply([`Shadow mode: ${shadowStore.enabled && config.shadowGroupNames.length ? 'on' : 'off'}; ${config.shadowGroupNames.length} name(s) in the list; media ${config.shadowMedia ? 'on' : 'off'}; cards today ${d.cards} of ${config.shadowCardCap}; model calls ${d.calls} of ${config.shadowDailyCalls}; last card #${shadowStore.d.n}${pp.unposted.length ? `; NOT posted: #${pp.unposted.join(', #')}` : ''}${pp.gaps.length ? `; missing numbers: #${pp.gaps.slice(0, 10).join(', #')}` : ''}.`, dayLine(shadowStore, day, config.shadowCompareMinutes), weekSummary(shadowStore, day)].filter(Boolean).join('\n'));
      return true;
    }
    const cc = parseCardCorrection(text);
    if (cc) {
      const card = shadowStore.card(cc.id);
      if (!card) { await reply(`There is no card #${cc.id}.`); return true; }
      appendCorrection(config.authDir, { at: new Date().toISOString(), where, role, wrong: card.reply || card.action, right: cc.right });
      experience.candidate({ kind: 'correction', wrong: String(card.reply || card.action).slice(0, 200), right: cc.right.slice(0, 300) });
      await reply(`Noted for #${cc.id}; it is on the owner's learning list.`);
      return true;
    }
  }
  if (admin && (!group || group.command || group.test)) {
    const mc = parseMorningCommand(text);
    if (mc) { await morningCommand(mc, reply); return true; }
  }
  if (admin && (!group || group.command)) {
    const lc = parseLearnCommand(text);
    if (lc) { await learnCommand(lc, reply); return true; }
    const ac = parseAliasCommand(text);
    if (ac) { await reply(ac.list ? aliases.list() : aliases.add(ac.customer, ac.alias) ? `ثبت شد: «${ac.alias}» همان «${ac.customer}» است.` : 'نام را نفهمیدم.'); return true; }
  }
  // "what was received this week": answered from the received-goods events (read only)
  if (text && !audio && !image && !pdf && addressed) {
    const rq = parseReceivedQuery(text);
    if (rq) { await reply(receivedSummary((group?.test ? testTracker : tracker).events, { period: rq.period, timeZone: config.timezone, lang: staffLang === 'fa' ? 'fa' : 'en' })); return true; }
  }
  // The connect line (his own chat, owner only; checked above): state, code exchange, company name.
  if (text && !audio && !image && !group && isSelf && parseConnectLine(text)) {
    for (const part of await qboDesk.handleLine(parseConnectLine(text))) await reply(part);
    return true;
  }
  // QuickBooks (his own chat, owner only): status, connect, disconnect, the match table, one statement or all (to the test group only). Read only.
  if (text && !audio && !image && !group && isSelf) {
    const qc = parseQboCommand(text);
    if (qc && isOwnerCommand({ fromMe: !!raw.key.fromMe, id: raw.key.id, text, sentIds: sent, forwarded: !!(ctx.isForwarded || ctx.forwardingScore > 0) })) {
      qboDesk.finish = async (parts) => { for (const part of parts) await reply(part); };
      for (const part of await qboDesk.handle(qc)) await reply(part);
      return true;
    }
  }
  // The owner's invoice commands (his own chat, owner only): the request, his yes or no, the kill switch, the audit report, the authorized people.
  if (text && !audio && !image && !group && isSelf) {
    let ic = parseInvoiceCommand(text);
    // a bare yes or no answers the question the assistant asked last in this chat (a photo, a voice note, a follow-up); only without one does it look at open previews
    if (bareAnswerYieldsToPending(ic, !!(voiceDesk.get(`s:${chatId}:${jidDigits(raw.key.participant || raw.key.remoteJid)}`) || followDesk.get(`s:${chatId}:${jidDigits(raw.key.participant || raw.key.remoteJid)}`)))) ic = null;
    if (ic && isOwnerCommand({ fromMe: !!raw.key.fromMe, id: raw.key.id, text, sentIds: sent, forwarded: !!(ctx.isForwarded || ctx.forwardingScore > 0) })) {
      qboNames.finish = async (parts) => { for (const part of parts) await reply(part); }; // the report at the end of a long update
      qboBulk.finish = qboNames.finish;
      const parts = await qboInvoiceCommand(ic, text);
      if (parts) {
        for (const part of parts) await reply(part);
        if (parts.choice) choiceDesk.set(`pc:${chatId}`, parts.choice); else if (parts.clarify) voiceGate.set(gateKey, text, 'clarify'); // "which customer?": a short answer, typed or spoken, is merged into this request
        return true;
      } // null: not ours (the older price list answers)
    }
  }
  // "وضعیت سفارش‌ها" (his own chat, owner only): counts of orders by source and of invoices in each state, last seven days, no names.
  if (config.ownerInvoiceSend && text && !audio && !image && !group && isSelf && isOrderStatusCommand(text) && isOwnerCommand({ fromMe: !!raw.key.fromMe, id: raw.key.id, text, sentIds: sent, forwarded: !!(ctx.isForwarded || ctx.forwardingScore > 0) })) {
    await reply(orderStatusText({ events: tracker.events, requests: desk.requests, history: desk.history }));
    return true;
  }
  // THE OWNER'S FIXED LIST "customer on the invoice -> group": proposal, answers and later changes. Only the owner, only in his own chat; free code.
  // Approving a row sends nothing (it only says which group an ordered invoice goes to; the order, the check and his yes stay as they are).
  if (config.ownerInvoiceSend && text && !audio && !image && !group && isSelf) {
    const photoWaiting = voiceDesk.get(`s:${chatId}:${jidDigits(raw.key.participant || raw.key.remoteJid)}`);
    const wanted = photoWaiting && looksLikeCorrection(text) ? null : customerDesk.wants(text); // a line like "508 = 50m" belongs to the photo question
    if (wanted) {
      if (!isOwnerCommand({ fromMe: !!raw.key.fromMe, id: raw.key.id, text, sentIds: sent, forwarded: !!(ctx.isForwarded || ctx.forwardingScore > 0) })) { trace(where, 'owner', 'ignored: the customer-group list answers only the owner'); return true; }
      const all = Object.values(await sock.groupFetchAllParticipating()).map((g) => ({ id: g.id, subject: g.subject || '' }));
      for (const part of customerDesk.handle(wanted, { groups: all, known: { ...knownInvoiceCustomers(), aliasMap: aliases.map, addAlias: (main, other) => aliases.add(main, other) } })) await reply(part);
      return true;
    }
  }
  // THE OWNER ORDERS AN INVOICE INTO A CUSTOMER'S GROUP. Only a message typed on this account (never one she sent, never a forwarded one),
  // only in the Invoices group, the test group or his own chat; anyone else is told only the owner can; nothing is sent without his yes.
  if (config.ownerInvoiceSend && text && !audio && !image && (group?.invoice || group?.test || (!group && isSelf))) {
    const owner = isOwnerCommand({ fromMe: !!raw.key.fromMe, id: raw.key.id, text, sentIds: sent, forwarded: !!(ctx.isForwarded || ctx.forwardingScore > 0) });
    const waiting = sendDesk.get(chatId);
    if (waiting && owner) {
      const a = sendDesk.answer(chatId, text, true);
      if (a?.type === 'choose') {
        const g = waiting.groups[a.index];
        sendDesk.start(chatId, { step: 'confirm', invoice: waiting.invoice, group: g, unconfirmed: !!waiting.unconfirmed });
        await reply(confirmText({ read: waiting.invoice.read, fileName: sendFileName(waiting.invoice.read), group: g.subject, alreadySent: nameStore.sentTo(waiting.invoice.read.number, g.id) ? (staffLang === 'fa' ? 'پیش‌تر' : 'before') : '', unconfirmed: !!waiting.unconfirmed, lang: staffLang }));
        return true;
      }
      if (a?.type === 'yes') { sendDesk.clear(chatId); await finishOwnerSend({ chatId, pending: waiting, reply, lang: staffLang }); return true; }
      if (a?.type === 'cancel') { await reply(staffLang === 'fa' ? 'لغو شد. چیزی فرستاده نشد.' : 'Cancelled. Nothing was sent.'); return true; }
    }
    if (addressed && !wantsRename(text)) {
      const parsed = parseSendCommand(text);
      if (parsed) {
        if (!owner) { await reply('Only the owner can order an invoice to be sent to a customer. I cannot send invoices to customers.'); return true; }
        await startOwnerSend({ chatId, parsed, ctx, reply, lang: staffLang });
        return true;
      }
    }
  }
  // "Atossa rename this invoice" (a reply to an invoice PDF) or "name the invoices with a code name after the customer in the invoice" (no
  // reply: the recent ones): the readable name from the invoice itself. Invoices group and test group, addressed by name.
  if (addressed && text && !audio && !image && config.invoiceNameMode !== 'off' && (group?.test || group?.invoice) && wantsRename(text)) {
    const qdoc = ctx.quotedMessage ? normalizeMessageContent(ctx.quotedMessage)?.documentMessage : null;
    if (qdoc && /pdf/i.test(String(qdoc.mimetype || ''))) {
      const qraw = { key: { remoteJid: chatId, id: ctx.stanzaId, participant: ctx.participant }, message: ctx.quotedMessage };
      let buf = null;
      try { buf = await downloadMediaMessage(qraw, 'buffer', {}); } catch (e) { logger.warn(`rename: the pdf could not be downloaded: ${e.message}`); }
      let read = nameStore.recall(ctx.stanzaId); // the read the check already made, if there is one
      if (!read && buf) {
        const r = await readInvoice({ client, config, invoice: { base64: buf.toString('base64'), mimeType: 'application/pdf' } });
        if (r?.invoice_number && r?.invoice_customer) { read = { number: r.invoice_number, customer: r.invoice_customer }; nameStore.remember(ctx.stanzaId, read.number, read.customer); }
      }
      if (!read || !readableFileName(read.number, read.customer)) { await reply('I could not read the invoice number and the customer from this file, so I cannot name it.'); return true; }
      await nameInvoice({ raw: qraw, groupId: chatId, fileName: qdoc.fileName || '', base64: buf?.toString('base64'), number: read.number, customer: read.customer, force: true });
      return true;
    }
    await reply(await renameRecent(chatId));
    return true;
  }
  // The owner's price list and special prices (admins, in a private chat or the command group).
  if (admin && (!group || group.command)) {
    if (await handlePriceFlow({ raw, content, text, key: `p:${chatId}`, reply, role, where, image, pdf })) return true;
  }
  // A customer's request posted by a colleague on his behalf (not in the groups that only record: cut, delivery, money).
  if (text && !audio && !image && !pdf && !group?.tracked) {
    const ob = parseOnBehalf(text);
    if (ob) {
      try { await handleOnBehalf({ ob, raw, reply, role, where, lang: staffLang, test: !!group?.test }); } catch (e) {
        logger.error(`order on behalf failed: ${e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e.message}`);
        await reply(ORDER_FAILED);
      }
      return true;
    }
  }
  if (pdf) {
    // An invoice shown to the assistant is checked on the spot (any PDF in a test group; elsewhere when the caption or the file
    // name says invoice and she is addressed or it is a private chat).
    const invoiceish = looksLikeInvoice(`${text} ${pdf.fileName || ''}`);
    if (group?.test || (invoiceish && (addressed || !group))) {
      let buf;
      try { buf = await downloadMediaMessage(raw, 'buffer', {}); } catch (e) { logger.warn(`pdf download failed: ${e.message}`); return true; }
      if (buf.length > 20 * 1024 * 1024) { await reply('این فایل برای بررسی بزرگ است.'); return true; }
      trace(where, role, 'pdf received: checking it as an invoice');
      if (raw.key.fromMe && nameStore.isOwnName(pdf.fileName || '')) { trace(where, role, 'her own re-post, ignored'); return true; }
      if (group?.test) keepPdf(raw, chatId, pdf.fileName);
      const b64 = buf.toString('base64');
      await onDemandInvoice({ doc: { base64: b64, fileName: pdf.fileName || '', mimeType: 'application/pdf' }, reply, where, role, test: !!group?.test, after: group?.test ? (r) => { nameStore.facts(raw.key.id, { total: r.total, urgent: r.urgent, noOrder: r.noOrder }); nameStore.setCheck(r.number, { total: r.total, urgent: r.urgent, noOrder: r.noOrder, points: r.points || [] }); return nameInvoice({ raw, groupId: chatId, fileName: pdf.fileName || '', base64: b64, number: r.number, customer: r.customer }); } : null });
      return true;
    }
    return false; // a PDF is for the invoice and purchase-order flows
  }
  // "Wrong, <the right answer>" as a reply to one of the assistant's messages: stored for the owner, nothing more.
  const quotedText = textOf(normalizeMessageContent(ctx.quotedMessage));
  const quotedFromBot = !!ctx.participant && own.includes(jidNormalizedUser(ctx.participant));
  const fix = quotedFromBot && quotedText && !audio && !image ? parseCorrection(text) : null;
  if (fix) {
    appendCorrection(config.authDir, { at: new Date().toISOString(), where, role, wrong: quotedText, right: fix.right });
    experience.candidate({ kind: 'correction', wrong: quotedText.slice(0, 200), right: fix.right.slice(0, 300) });
    if (group) experience.corrected(groupLabel(where.replace(/^group "|"$/g, '')), detectLang(text, 'fa'));
    trace(where, role, 'correction of an answer stored for the owner');
    await reply(correctionSaved(staffLang));
    return true;
  }
  // A voice note is only answered with a question; the request goes on after the same person says yes.
  const key = `s:${chatId}:${jidDigits(raw.key.participant || raw.key.remoteJid)}`;
  // "atossa read the picture above": addressed with no picture attached -> the quoted picture, or that person's previous one, read once
  if (!image && !audio && addressed && text && config.imageConfirm && /\b(?:pictures?|photos?|image|pic)\b|عکس|تصویر|صورة|صوره/i.test(text)) {
    const quoted = ctx.quotedMessage ? imageOf(normalizeMessageContent(ctx.quotedMessage)) : null;
    const last = lastPhotos.get(`${chatId}:${jidDigits(raw.key.participant || raw.key.remoteJid)}`);
    if (quoted && ctx.stanzaId) { image = quoted; imageRaw = { key: { remoteJid: chatId, id: ctx.stanzaId, participant: ctx.participant }, message: ctx.quotedMessage }; }
    else if (last && Date.now() - last.at < 30 * 60 * 1000) { image = last.image; imageRaw = last.raw; }
    else { await reply('Please send the photo again with my name in the caption.'); return true; }
  }
  if (audio) {
    // Nobody says the assistant's name outside the audio, so a colleague's voice note is always read; the words
    // in it decide. Addressed anyway: a mention, a reply to the assistant, a private chat, or a note that
    // follows its question.
    const explicit = addressed || !!voiceDesk.get(key) || !!followDesk.get(key);
    const u = await understandAudio(() => downloadMediaMessage(raw, 'buffer', {}), audio.seconds || 0, staffLang);
    const named = !u.ok && !!u.transcript && nameHeard(u.transcript, config.botNames);
    const noticeDue = u.reason === 'speech error' && Date.now() - (sttNotice.get(chatId) || 0) > 3600 * 1000;
    const action = voiceAction({ u, explicit, namedInTranscript: named, noticeDue });
    const spoken = u.lang || (u.transcript ? detectLang(u.transcript) : 'fa');
    // the transcript is echoed first; a plain question then runs at once, what would change something waits for the yes
    const pendingG = voiceGate.get(gateKey);
    if (pendingG && u.transcript && isShortCorrection(u.transcript)) {
      const merged = await mergeTranscripts({ client, config, original: pendingG.text, correction: u.transcript.trim() });
      if (merged) { voiceGate.clear(gateKey); trace(where, role, 'voice note: a short voice reply was merged into the waiting request'); return actOnTranscript(merged, spoken); }
    }
    const pv = planVoice({ transcript: u.transcript, lang: spoken, explicit, named, priv: !group, unclear: u.reason === 'unclear' });
    if (pv.mode !== 'old') {
      await sock.sendMessage(chatId, { text: `${isSelf ? '🤖 ' : ''}${pv.echo}${pv.mode === 'ask' ? `\n${pv.prompt}` : ''}` }, { quoted: raw });
      if (pv.mode === 'ask') { voiceGate.set(gateKey, u.transcript.trim()); trace(where, role, 'voice note: it would change something, waiting for the yes'); return true; }
      trace(where, role, 'voice note: a plain question, run at once as typed');
      return rerunAsText(u.transcript.trim());
    }
    if (action === 'confirm') {
      voiceDesk.set(key, { requestText: u.requestText, lang: u.lang });
      trace(where, role, `voice note understood (${u.intent}), reply language ${u.lang}: asking for confirmation`);
      await reply(u.confirmText);
    } else if (action === 'unavailable') {
      sttNotice.set(chatId, Date.now());
      trace(where, role, 'voice note: the speech service failed, told that voice cannot be heard now');
      await reply(noVoice(spoken));
    } else if (action === 'tell') {
      voiceDesk.clear(key);
      trace(where, role, `voice note not understood (${u.reason}): told so`);
      await reply(notUnderstood(spoken));
    } else {
      trace(where, role, `ignored: voice note not understood (${u.reason}) and not addressed to the assistant`);
    }
    return true;
  }
  if (image) {
    // A colleague's photo is always read (no name is written on a photo); what is in it decides.
    const explicit = addressed || !!voiceDesk.get(key) || !!followDesk.get(key);
    const written = staffLang;
    trace(where, role, `photo received${image.mimetype ? ` (${String(image.mimetype).split(';')[0]})` : ''}: reading it`);
    let photo;
    const loadPhoto = async () => { photo = photo || { base64: (await downloadMediaMessage(imageRaw, 'buffer', {})).toString('base64'), mimeType: image.mimetype?.split(';')[0] || 'image/jpeg' }; return photo; };
    const mayCheck = explicit || !group || !!group?.test;
    // A caption that says invoice (or asks to compare or check): the invoice checker, not the order flow.
    if (looksLikeInvoice(text) && mayCheck) {
      try { await onDemandInvoice({ doc: { ...(await loadPhoto()), fileName: '' }, reply, where, role, test: !!group?.test, hint: customerFromMessages([{ text, hasImage: true }], orderLinesOf) }); } catch (e) { logger.error(`invoice check failed: ${e.message}`); await reply(INVOICE_FAILED); }
      return true;
    }
    const u = await understandPhotos([{ loadImage: loadPhoto }], text, written, staffLang);
    if (u.reason === 'invoice' && mayCheck) {
      try { await onDemandInvoice({ doc: { ...(await loadPhoto()), fileName: '' }, reply, where, role, test: !!group?.test }); } catch (e) { logger.error(`invoice check failed: ${e.message}`); await reply(INVOICE_FAILED); }
      return true;
    }
    const action = imageAction({ u, explicit });
    if (action === 'confirm') {
      // a caption that is a customer's name ("Nuqoosh") is the customer of this order
      const capCustomer = await captionCustomer(text);
      voiceDesk.set(key, { requestText: u.requestText, lang: u.lang, intent: u.intent, items: u.items, customer: capCustomer || customerFromMessages([{ text, hasImage: true }], orderLinesOf), test: !!group?.test });
      await reply(`${u.confirmText}${capCustomer ? `\n${u.lang === 'en' ? 'Customer' : 'مشتری'}: ${capCustomer}` : ''}`);
      trace(where, role, `photo understood (${u.intent}, ${u.items.length} code(s)${u.notes?.length ? `, prefix removed: ${u.notes.map((n) => `${n.from}->${n.to}`).join(' ')}` : ''}), reply language ${u.lang}: ${lastReplyOk ? 'the question was delivered' : 'the question was NOT delivered'}`);
    } else if (action === 'tell') {
      voiceDesk.clear(key);
      await reply(u.reason === 'other' ? photoNotRequest(written) : photoUnclear(written));
      trace(where, role, `photo not usable (${u.reason}): ${lastReplyOk ? 'told so' : 'could NOT tell (not delivered)'}`);
    } else {
      trace(where, role, `ignored: photo is not a stock or order request (${u.reason}) and not addressed to the assistant`);
    }
    return true;
  }
  let asked = text;
  let confirmed = false;
  let lang = staffLang; // the language the answer is written in
  const pend = config.voiceEnabled ? voiceDesk.get(key) : null;
  let engaged = false; // an answer to the assistant's own question counts as addressed to her
  if (pend) {
    const kind = answerKind(text);
    const lead = kind === 'other' ? answerLead(text) : '';
    voiceDesk.clear(key);
    if (kind === 'no') { await reply(retryText(pend.lang)); return true; }
    if (kind !== 'yes' && lead !== 'yes' && kind !== 'no' && pend.requestText && looksLikeCorrection(text)) {
      asked = text; confirmed = true; lang = pend.lang || lang; // "508 = 50m": the corrected line replaces the request read from the picture
      trace(where, role, 'a correction of the photo question: the typed line replaces what was read');
    } else if (kind === 'yes' || lead === 'yes') {
      asked = pend.requestText; confirmed = true; lang = pend.lang || lang;
      // a confirmed photo or voice order enters the order memory (with its quantities)
      if (pend.intent === 'order' && (pend.items || []).length && config.trackerEnabled) {
        trackerOf(pend.test).add({ type: 'order', at: Date.now(), customer: canon(pend.customer || ''), lines: pend.items.map((i) => ({ code: i.code, quantity: i.quantity, unit: i.unit })), source: 'photo', ref: createHash('sha256').update(`photo|${raw.key.id}`).digest('hex').slice(0, 24) });
      }
    } else if (lead === 'no') engaged = true; // "no, this is an invoice, ...": handled as a message to her, not dropped
    else engaged = true;
  }
  // An answer to a question the assistant just asked ("which group?") needs no name or mention.
  const follow = audio ? null : followDesk.get(key);
  if (follow) {
    followDesk.clear(key);
    const pick = matchOption(text, follow.options);
    if (pick >= 0) {
      asked = `Stock of code ${follow.code}${follow.size ? ` size ${follow.size}` : ''} in the group "${follow.options[pick]}"`;
      confirmed = true;
      lang = follow.lang || lang;
      trace(where, role, 'follow-up: answered the assistant\'s question');
    }
  }
  // A sentence that reads as an instruction, in his own chat, that no command matched: teaching (never for a question; the model may find nothing to save).
  if (config.ownerTeach && !group && isSelf && !confirmed && !isExplicitTeaching(text) && looksLikeTeaching(text)
    && isOwnerCommand({ fromMe: !!raw.key.fromMe, id: raw.key.id, text, sentIds: sent, forwarded: !!(ctx.isForwarded || ctx.forwardingScore > 0) })) {
    if (await teachFlow({ text, reply })) return true;
  }
  if (!addressed && !confirmed && !engaged) { trace(where, role, 'ignored: not addressed to the assistant'); return false; }
  const answerText = await staffAnswer({
    client, config, text: normalizeDigits(asked), log: (s) => logger.warn(s), quoted: textOf(normalizeMessageContent(ctx.quotedMessage)), who: raw.pushName || '', handlers: staffHandlersFor(key, lang), lang, today: todayLine(new Date(), config.timezone),
  });
  trace(where, role, `${answerText ? 'answered' : 'no reply (the model chose silence)'}, reply language ${lang}`);
  if (answerText) await reply(answerText);
  return true;
}

const recentCodes = new Map(); // group id -> [{ code, at }]: what customers asked about lately (a staff answer repeats it)
/** The codes this group asked about in the last half hour, oldest first (the context of a follow-up with no code). */
const recentCodeList = (groupId) => (recentCodes.get(groupId) || []).filter((c) => Date.now() - c.at < 30 * 60 * 1000).map((c) => c.code);
const rememberCodes = (groupId, text) => {
  const now = Date.now();
  const list = (recentCodes.get(groupId) || []).filter((c) => now - c.at < 30 * 60 * 1000);
  for (const l of orderLinesOf(text)) list.push({ code: l.code, at: now });
  for (const m of String(text || '').matchAll(/(?:^|[^\d])(\d{2,5})(?:[^\d]|$)/g)) list.push({ code: m[1], at: now });
  recentCodes.set(groupId, list.slice(-60));
};

/**
 * A customer group we only WATCH: nothing is ever written to it. What is learned: language and kinds (the experience store),
 * the order lines customers write (recorded with low confidence: nobody confirms them), the purchase orders they post (the LPO
 * store for the invoice comparison), and the requests OUR staff makes TO the customer (sourcing, not a sale). Voice notes and
 * photos are not read or kept here.
 */
async function watchObserved(raw, groupId, info) {
  if (sent.has(raw.key.id) || botState.paused) return;
  const content = normalizeMessageContent(raw.message);
  if (!content || content.protocolMessage || content.reactionMessage) return;
  const image = imageOf(content);
  const text = textOf(content) || image?.caption || '';
  const sender = { sender: raw.key.participant, senderAlt: raw.key.participantAlt };
  let staff = raw.key.fromMe ? true : staffChecker(config.staffNumbers, info.lidToPhone)(sender);
  if (staff === null) { info = await groupInfo(groupId, true); staff = staffChecker(config.staffNumbers, info.lidToPhone)(sender); }
  if (staff === null) return; // cannot tell who wrote it: nothing is recorded
  const label = groupLabel(info.subject);
  if (content.documentMessage && !staff) { await watchGroup(raw, groupId, 'request'); return; }
  if (!text || !config.trackerEnabled) return;
  const ref = createHash('sha256').update(`obs|${groupId}|${raw.key.id}`).digest('hex').slice(0, 24);
  if (staff) {
    // our staff asking the customer for goods is SOURCING: never an order, never a sale
    if (isSourcingRequest(text, (recentCodes.get(groupId) || []).map((c) => c.code))) {
      const ev = sourcingEvent(text);
      if (ev && tracker.add({ ...ev, at: Date.now(), customer: customerOfGroup(groupId, label), group: groupId, ref })) trace(`group "${info.subject}"`, 'observer', 'sourcing request recorded (staff asks the customer; not an order)');
    }
    return;
  }
  // the customer's answer to such a request is not an order either
  for (const e of openSourcing(tracker, groupId)) {
    const a = sourcingAnswer(text, e);
    if (a) { tracker.update(e.ref, { status: a.status, answer: a.answer, answerQuantity: a.quantity ?? null }); trace(`group "${info.subject}"`, 'observer', `sourcing request answered (${a.answer})`); return; }
  }
  rememberCodes(groupId, text);
  const lines = orderLinesOf(text);
  if (lines.length) {
    tracker.add({ type: 'order', at: Date.now(), customer: lines.find((l) => l.customer)?.customer ? canon(lines.find((l) => l.customer).customer) : customerOfGroup(groupId, label), lines: lines.map((l) => ({ code: l.code, quantity: l.quantity, unit: l.unit })), source: 'observed', confidence: 'low', ref });
    trace(`group "${info.subject}"`, 'observer', `${lines.length} order line(s) recorded, low confidence`);
  }
}

const watchedSubject = (groupId) => groups.get(groupId)?.subject || '';

// ---- SHADOW mode: the real customer flow, its answers written as cards into the test group ----------------------------------
const shadowStore = new ShadowStore(path.join(config.authDir, 'shadow'));
const shadowAvail = new AvailabilityDesk({ dir: '' }); // its own state, nothing persisted, nothing shared with the real flow
const shadowRecent = new Map();
let shadowChain = Promise.resolve();
/** The ONLY way out of shadow mode: a card into the test group, one after the other with a gap. */
const shadowPost = (text) => {
  const run = shadowChain.then(async () => {
    const word = config.testGroupNames[0];
    const jid = word ? await findGroupJid(word) : null;
    if (!jid) throw new Error('the test group was not found');
    if (!(await sock.sendMessage(jid, { text }))) throw new Error('the card was not sent');
  });
  shadowChain = run.catch((e) => logger.warn(`shadow card failed: ${e.message}`)).then(() => new Promise((r) => setTimeout(r, Math.max(0, config.shadowCardGapSeconds) * 1000)));
  return run;
};

async function shadowAnalyze({ groupId, subject, label, messages, transcript }) {
  const customer = canon(customerFromMessages(messages, orderLinesOf) || '') || label;
  const withText = messages.filter((m) => m.text && !/^\(voice note, sticker or file\)$/.test(m.text));
  const media = messages.filter((m) => m.hasImage || m.isVoice);
  let note = media.length && !config.shadowMedia ? `${media.some((m) => m.isVoice) ? 'voice note' : 'photo'} not read (shadow media is off)` : '';
  let calls = 0;
  // Media is read only when the owner turns it on; the confirmation she would have asked is shown as a draft, never asked.
  if (media.length && config.shadowMedia) {
    for (const m of media.slice(-3)) {
      try {
        const u = m.isVoice && m.loadAudio ? await understandAudio(m.loadAudio, m.seconds || 0) : m.loadImage ? await understandPhotos([m], m.text, 'en') : null;
        calls++;
        if (u?.ok) { withText.push({ ...m, text: u.requestText, hasImage: false, isVoice: false }); note = [note, `${m.isVoice ? 'Voice note' : 'Photo'} read; the confirmation she would have asked: ${u.confirmText}`].filter(Boolean).join('\n'); }
        else note = [note, `${m.isVoice ? 'voice note' : 'photo'} could not be used (${u?.reason || 'unreadable'})`].filter(Boolean).join('\n');
      } catch (e) { note = [note, `${m.isVoice ? 'voice note' : 'photo'} could not be read`].filter(Boolean).join('\n'); }
    }
  }
  const understood = (m) => parseCustomerText(m.text || '').kind !== 'other'; // the free parser can read it without the picture
  if (media.length && !config.shadowMedia && !withText.some(understood)) {
    // "Available" under a picture: it depends on a photo or a voice note nobody read, so there is nothing fair to propose
    return { action: 'needs-media', note: note.replace(' (shadow media is off)', '').replace('not read', 'not read: the question depends on it'), customer, calls: 0 };
  }
  if (!withText.length) return media.length ? { action: 'needs-media', note, customer, calls } : { action: 'none' };
  const proposals = [];
  const statuses = new Map();
  const log = (s) => {
    if (/^asked the customer for the quantity/.test(s)) proposals.push('ask-quantity');
    else if (/^answered (?:not )?available/.test(s)) proposals.push('answer');
    else if (/sent to the sales manager/.test(s)) proposals.push('manager');
  };
  const sends = [];
  let lang = '';
  let managerLine = '';
  if (config.availabilityFlow) {
    const flow = await runAvailability({
      messages: withText, groupId, groupName: subject, customer, desk: shadowAvail,
      decide: async (line) => { calls++; try { return classify(await fetchStock(config, { code: line.code, quantity: line.quantity, quantity_unit: line.unit })); } catch { return { kind: 'unhandled' }; } },
      lookup: async (code) => { calls++; const v = await stockState(code); statuses.set(code, v); return v.state; },
      send: async (gid, text) => { sends.push(text); },
      notifyManager: async (req) => { managerLine = `Would refer to the sales manager: code ${req.res?.code || '?'}, ${req.line.quantity} ${req.line.unit} requested (nothing sent)`; return null; },
      log,
    });
    // a question she would have asked the customer is shown as a draft and closed: nobody will answer it
    shadowAvail.qty.clear();
    for (const r of [...shadowAvail.open.values()]) shadowAvail.close(r.id);
    const rest = flow.rest;
    if (sends.length || managerLine) {
      const action = proposals.includes('manager') && !sends.length ? 'manager' : proposals.includes('ask-quantity') ? 'ask-quantity' : 'answer';
      // For a bare availability question the free sheet lookup (no model) shows the stock she would rely on, the AR prefix handled.
      // The free sheet lookups made by the flow give her stance per code (the AR prefix is handled by the lookup), so "220 available" and
      // "406 and 401 no" from staff are compared code by code.
      const stances = {};
      let sheetNote = '';
      if (statuses.size) {
        sheetNote = `Sheet check: ${[...statuses].map(([c, v]) => `${productCode(c)} ${v.label}`).join(', ')}`;
        for (const [c, v] of statuses) if (v.state === 'ok') stances[productCode(c)] = 'yes'; else if (v.state === 'none' || v.label === 'not in the sheet') stances[productCode(c)] = 'no';
      }
      const states = Object.values(stances);
      const stance = !states.length ? (proposals.includes('answer') ? 'yes' : '') : states.every((x) => x === 'yes') ? 'yes' : states.every((x) => x === 'no') ? 'no' : 'mixed';
      return { action, reply: sends.join('\n'), lang: flow.lang || detectLang(withText.map((m) => m.text).join(' '), 'en'), note: [note, sheetNote, managerLine].filter(Boolean).join('\n'), stance, stances, customer, calls };
    }
    if (!rest.length) return { action: 'none' };
  }
  calls++;
  const result = await answer({ client, config, system: systemPrompt(), input: { groupName: subject, customer, transcript, messages: withFollowUp(withText, recentCodeList(groupId)), images: [] }, ctx: { groupId, groupName: subject, customer, messageText: withText.map((m) => m.text).join(' / ') }, recent: shadowRecent });
  lang = detectLang(withText.map((m) => m.text).join(' '), 'en');
  const referral = result.managerTexts.length ? 'Would send the sales manager a private report (nothing sent)' : '';
  if (!result.reply && !referral) return { action: 'none' };
  if (!result.reply) return { action: 'manager', note: [note, referral].filter(Boolean).join('\n'), customer, calls };
  // the real message ends with a mention of the colleagues ("@" and their numbers, resolved when it is sent); the card says it in words
  const tagged = applyTags(result.reply, config.team);
  const body = tagged.text.replace(/\n@\d+(?: @\d+)*\s*$/, '');
  const tagNote = tagged.mentions.length ? 'Would also tag a colleague (a real mention in the message)' : '';
  return { action: 'answer', reply: body, lang, note: [note, referral, tagNote].filter(Boolean).join('\n'), customer, calls };
}

const shadowDesk = new ShadowDesk({ store: shadowStore, post: shadowPost, analyze: shadowAnalyze, config, log: (s) => logger.warn(s) });

/** A message of a shadow group goes to the shadow desk (and nowhere near the real flow). */
async function shadowIntake(raw, groupId, info) {
  if (sent.has(raw.key.id) || botState.paused) return;
  const content = normalizeMessageContent(raw.message);
  if (!content || content.protocolMessage || content.reactionMessage) return;
  const image = imageOf(content);
  const text = normalizeDigits(content.conversation || content.extendedTextMessage?.text || image?.caption || '');
  const sender = { sender: raw.key.participant, senderAlt: raw.key.participantAlt };
  let staff = raw.key.fromMe ? true : staffChecker(config.staffNumbers, info.lidToPhone)(sender);
  if (staff === null) { info = await groupInfo(groupId, true); staff = staffChecker(config.staffNumbers, info.lidToPhone)(sender); }
  shadowDesk.onMessage({
    groupId, subject: info.subject, label: groupLabel(info.subject), staff, fromMe: !!raw.key.fromMe, text, hasImage: !!image, isVoice: !!content.audioMessage, at: Date.now(),
    seconds: content.audioMessage?.seconds || 0,
    // downloaded only when shadow media is on and the request is analysed
    loadAudio: content.audioMessage && config.shadowMedia ? () => downloadMediaMessage(raw, 'buffer', {}) : null,
    loadImage: image && config.shadowMedia ? async () => ({ base64: (await downloadMediaMessage(raw, 'buffer', {})).toString('base64'), mimeType: image.mimetype?.split(';')[0] || 'image/jpeg' }) : null,
  });
}

// The daily line at the summary hour, and the week summary on the seventh day: into the test group, one message each.
let shadowLastLine = '';
setInterval(async () => {
  try {
    if (!sock?.user || !config.shadowGroupNames.length || !shadowStore.enabled) return;
    const p = localParts(Date.now(), config.timezone);
    if (p.minutes < config.digestHour * 60 + 5 || shadowLastLine === p.day) return;
    shadowLastLine = p.day;
    const line = dayLine(shadowStore, p.day, config.shadowCompareMinutes);
    if (line) await shadowPost(line);
    const d = shadowStore.day(p.day);
    if (d.calls >= config.shadowDailyCalls && shadowStore.d.warned !== p.day) { shadowStore.d.warned = p.day; shadowStore.save(); await shadowPost(`⚠️ Shadow: the daily model budget (${config.shadowDailyCalls} calls) was reached; later requests were not analysed.`); }
    if (!shadowStore.d.started) { shadowStore.d.started = Date.now(); shadowStore.save(); }
    if (Date.now() - shadowStore.d.started >= 7 * 86400000 && shadowStore.d.summaryDay !== p.day && Object.keys(shadowStore.d.days).length >= 7) { shadowStore.d.summaryDay = p.day; shadowStore.save(); await shadowPost(weekSummary(shadowStore, p.day)); }
  } catch (e) { logger.warn(`shadow summary failed: ${e.message}`); }
}, 5 * 60 * 1000).unref();

async function onMessage(raw) {
  const groupId = raw.key.remoteJid;
  if (!isJidGroup(groupId)) { await handleStaffChat(raw, groupId, null); return; }
  const store = usageCtx.getStore();
  if (store) store.group = groupLabel((await groupInfo(groupId)).subject);
  const isTest = isTestSubject((await groupInfo(groupId)).subject);
  if (isTest) {
    // A test group: the account's own messages run the real paths here; the reports stay in the group and the memory is separate.
    const delTest = deletedInvoice(textOf(normalizeMessageContent(raw.message)));
    if (delTest) testTracker.markDeleted(delTest);
    await handleStaffChat(raw, groupId, { command: false, tracked: false, test: true });
    return;
  }
  // Goods that arrived ("JUWAT 10 GALLEN RECEIVED"), written in ANY internal group, are remembered as stock coming in.
  if (config.trackerEnabled && groupAllowed(watchedSubject(groupId), config).why === 'internal group' && !sent.has(raw.key.id)) {
    const c = normalizeMessageContent(raw.message);
    const t = textOf(c) || imageOf(c)?.caption || '';
    const rec = t && receivedFrom(t, { group: groupLabel(watchedSubject(groupId)) });
    if (rec) {
      const ref = createHash('sha256').update(`recv|${groupId}|${raw.key.id}`).digest('hex').slice(0, 24);
      if (tracker.add({ ...rec, ref })) {
        for (const code of rec.codes) markSourcingReceived(tracker, code);
        trace(`group "${watchedSubject(groupId)}"`, 'tracker', 'goods received recorded (stock arriving, not a sale)');
      }
    }
  }
  observe(raw, groupId).catch((e) => logger.warn(`experience: ${e.message}`));
  // A watched customer group (read only): recorded and learned from, never answered.
  const watchedInfo = await groupInfo(groupId);
  // The owner's statement request in a CUSTOMER group (not an internal one): asked in his own chat, sent to the group only after his yes.
  if (!groupAllowed(watchedInfo.subject, config).ok && await customerGroupStatement({ raw, groupId, info: watchedInfo }).catch((e) => { logger.warn(`customer-group statement: ${e.message}`); return false; })) return;
  // A SHADOW group: the real customer flow runs on it and its answers become cards in the test group; nothing is ever sent to it.
  const inShadow = shadowGroup(watchedInfo.subject, config);
  if (inShadow) shadowIntake(raw, groupId, watchedInfo).catch((e) => logger.warn(`shadow failed: ${e.message}`));
  if (observedGroup(watchedInfo.subject, config)) { watchObserved(raw, groupId, watchedInfo).catch((e) => logger.warn(`observer failed: ${e.message}`)); return; }
  if (inShadow) return; // never the real flow
  const trackRole = await trackedRole(groupId);
  // "Invoice inv-9910 delete this one": a deleted number is a legitimate gap in the numbering
  const delNo = deletedInvoice(textOf(normalizeMessageContent(raw.message)));
  if (delNo) tracker.markDeleted(delNo);
  if (trackRole && (trackRole !== 'cut' || config.cutTracking)) trackGroup(raw, groupId, trackRole).catch((e) => logger.warn(`tracker failed: ${e.message}`));
  const staffWords = [...config.staffGroupNames, config.invoiceGroupName, config.infoGroupName, config.cutGroupName, config.deliveryGroupName, config.confirmGroupName, ...config.commandGroupNames].filter(Boolean);
  if (staffWords.length) {
    const subject = (await groupInfo(groupId)).subject.toLowerCase();
    if (staffWords.some((w) => subject.includes(w)) && await handleStaffChat(raw, groupId, { command: config.commandGroupNames.some((w) => subject.includes(w)), tracked: !!trackRole, quiet: isQuietSubject(subject, config), invoice: !!config.invoiceGroupName && subject.includes(config.invoiceGroupName) })) return;
  }
  if (config.watchGroupNames.length || config.invoiceGroupName) {
    const subject = (await groupInfo(groupId)).subject.toLowerCase();
    if (config.invoiceGroupName && subject.includes(config.invoiceGroupName)) return watchGroup(raw, groupId, 'invoice');
    if (config.watchGroupNames.some((w) => subject.includes(w))) return watchGroup(raw, groupId, 'request');
  }
  if (!config.allowedGroups.includes(groupId)) {
    const subject = config.allowedGroupNames.length ? (await groupInfo(groupId)).subject.toLowerCase() : '';
    if (!config.allowedGroupNames.some((w) => subject.includes(w))) { trace(`group "${subject}"`, 'unknown', 'ignored: group not allowed'); return; }
  }
  const content = normalizeMessageContent(raw.message);
  if (!content || content.protocolMessage || content.reactionMessage) return;
  const text = normalizeDigits(content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption || '');
  const image = imageOf(content);
  const m = {
    raw, groupId, fromMe: !!raw.key.fromMe, sender: raw.key.participant, senderAlt: raw.key.participantAlt,
    senderName: raw.pushName || '', text, hasImage: !!image,
    isVoice: !!content.audioMessage, seconds: content.audioMessage?.seconds || 0,
    loadAudio: content.audioMessage ? () => downloadMediaMessage(raw, 'buffer', {}) : null,
    loadImage: image ? async () => ({
      base64: (await downloadMediaMessage(raw, 'buffer', {})).toString('base64'),
      mimeType: image.mimetype?.split(';')[0] || 'image/jpeg',
    }) : null,
  };
  if (!m.fromMe) {
    let info = await groupInfo(groupId);
    m.staff = staffChecker(config.staffNumbers, info.lidToPhone)(m);
    if (m.staff === null) { info = await groupInfo(groupId, true); m.staff = staffChecker(config.staffNumbers, info.lidToPhone)(m); }
    if (m.staff === false) lastRaw.set(groupId, raw);
  }
  if (!m.text && !m.hasImage && !m.fromMe) m.text = '(voice note, sticker or file)';
  const decision = gate.onMessage(m);
  trace(`group "${(await groupInfo(groupId)).subject}"`, m.fromMe ? 'owner' : m.staff === true ? 'staff' : m.staff === false ? 'customer' : 'unknown', GATE_WORDS[decision] || `customer flow: ${decision}`);
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  sock = makeWASocket({ auth: state, logger: logger.child({ module: 'baileys' }, { level: 'warn' }) });
  const rawSend = sock.sendMessage.bind(sock);
  // EVERY message leaves through this one function; the guard decides whether the destination may be written to.
  const guarded = guardedSend({ rawSend, config, oneShot, isGroup: isJidGroup, known: { has: (j) => staffChats.has(j) || qboChats.has(j) }, ownIds: () => ownIds(), log: (s) => logger.warn(s), subjectOf: async (jid) => groups.get(jid)?.subject ?? (await groupInfo(jid)).subject });
  // What colleagues read is English, whatever generated it: every group except a test group, and every private chat except the owner's.
  const englishFor = async (jid) => {
    if (isJidGroup(jid)) { const why = groupAllowed(groups.get(jid)?.subject ?? (await groupInfo(jid)).subject, config).why; return why === 'internal group' || why === 'test group'; } // a customer group keeps the customer's language
    const d = jidDigits(jid);
    return !([...(config.ownerNumbers || []), ...ownIds()].map(jidDigits).includes(d));
  };
  sock.sendMessage = async (...a) => {
    if (typeof a[1]?.text === 'string') {
      const c = cleanOutgoing(a[1].text);
      if (c.changed) { logger.warn('an unresolved placeholder was removed from an outgoing text'); if (!c.text) return undefined; a[1] = { ...a[1], text: c.text }; }
    }
    if (typeof a[1]?.text === 'string' && /[؀-ۿ]/.test(a[1].text) && !keepLang.has(a[1])) {
      try { if (await englishFor(a[0])) { const en = toEnglish(a[1].text); if (en !== a[1].text) a[1] = { ...a[1], text: en }; } } catch { /* sent as written */ }
    }
    const r = await guarded(...a); if (r && isJidGroup(a[0]) && groups.get(a[0]) && !quietContents.has(a[1])) experience.bot(groupLabel(groups.get(a[0]).subject)); if (r?.key?.id) { sent.add(r.key.id); if (sent.size > 500) sent.delete(sent.values().next().value); } return r; };
  sock.ev.on('creds.update', saveCreds);
  const onQr = pairingOnce({
    registered: () => !!state.creds.registered,
    phone: config.pairPhone,
    request: (digits) => sock.requestPairingCode(digits),
    show: (code) => console.log(`PAIRING CODE: ${code}  (on the bot phone: WhatsApp > Linked devices > Link a device > Link with phone number)`),
    log: (s) => logger.warn(s),
  });
  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) onQr();
    if (connection === 'open') {
      logger.info('connected to WhatsApp');
      sock.groupFetchAllParticipating().then((g) => { for (const r of watchList.sync(Object.values(g).map((x) => ({ id: x.id, subject: x.subject || '' })), config)) logger.info(`watched group renamed: "${r.from}" -> "${r.to}" (kept watched)`); }).catch((e) => logger.warn(`watch list: ${e.message}`));
      setTimeout(async () => {
        try {
          const all = Object.values(await sock.groupFetchAllParticipating()).map((g) => g.subject || '');
          const watched = all.filter((s) => observedGroup(s, config));
          logger.info(`watched customer groups (${watched.length} of ${all.length}): ${watched.join(' | ') || 'none'}`);
          const shadow = all.filter((s) => shadowGroup(s, config));
          logger.info(`SHADOW groups (${shadow.length} of ${all.length}): ${shadow.join(' | ') || 'none'}`);
        } catch (e) { logger.warn(`could not list the watched groups: ${e.message}`); }
      }, 30 * 1000).unref();
      // A few seconds after opening, so the session keys are ready; sent to the account's own chat only.
      setTimeout(() => {
        helloOnce({
          name: config.displayName, value: config.helloOnce, phone: config.pairPhone, dir: config.authDir,
          jid: sock.user?.id ? jidNormalizedUser(sock.user.id) : '',
          send: (jid, text) => sock.sendMessage(jid, { text }),
          log: (m) => logger.info(m),
        }).catch((e) => logger.warn(`greeting failed: ${e.message}`));
      }, 5000);
      // Names only, so the right words can be put in the group settings.
      sock.groupFetchAllParticipating()
        .then((all) => logger.info(`GROUPS (${Object.keys(all).length}): ${Object.values(all).map((g) => `"${g.subject}"`).join(', ')}`))
        .catch((e) => logger.warn(`group list failed: ${e.message}`));
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const next = afterClose({ loggedOut: code === DisconnectReason.loggedOut, registered: !!state.creds.registered });
      if (next === 'reconnect') setTimeout(start, 3000);
      else if (next === 'reset-and-wait') {
        logger.warn('logged out before pairing: clearing the old login, a new pairing code follows in a minute');
        clearAuth(config.authDir);
        setTimeout(start, 60000);
      } else logger.error('logged out: delete the auth folder and link again');
    }
  });
  sock.ev.on('groups.update', (updates) => { for (const u of updates || []) if (u?.id && u.subject && watchList.rename(u.id, u.subject, config)) logger.info(`watched group renamed to "${u.subject}" (kept watched)`); });
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    let history = 0;
    for (const raw of messages) {
      const verdict = shouldProcess({ type, raw, seen: handled, ownerSeen });
      if (!verdict.ok) {
        // A refused message is never silent, except bulk history after a restart (counted in one line).
        if (verdict.reason.startsWith('old message')) { history++; continue; }
        const jid = raw?.key?.remoteJid || '';
        const where = isJidGroup(jid) ? `group "${groups.get(jid)?.subject || 'not loaded'}"` : 'private';
        logger.info(`msg ${where} unknown: ignored: ${verdict.reason}`);
        continue;
      }
      // A message this account sent itself (the good-morning message, an answer) coming back is never read as a message of a person.
      if (raw?.key?.fromMe && sent.has(raw.key.id)) continue;
      // Each message is handled on its own: a slow answer to one never holds back the next.
      usageCtx.run({ group: '-' }, () => onMessage(raw)).catch((e) => logger.error(`message failed: ${e.message}`));
    }
    if (history) logger.info(`upsert ${type}: ${history} older message(s) ignored`);
  });
}

start();
