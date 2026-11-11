// ARYAK Assistant: WhatsApp (Baileys) + Claude + Zinax Stock.

import { SEP, withEnd, withSeparators } from './separator.js';
import { markAmounts } from './amount.js';
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
import { deletedInvoice, parsePaymentCaption } from './captions.js';
import { mergePayment, parseReceiptText } from './receipt.js';
import { looksLikeInvoice, onDemandText } from './ondemand.js';
import { guardedSend, observedGroup, shadowGroup } from './guard.js';
import { ShadowDesk, ShadowStore, dayLine, parseCardCorrection, parseShadowCommand, postingProblems, weekSummary } from './shadow.js';
import { isEnglishSentence, placeLanguage, toEnglish } from './english.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { UsageMeter, hasVisual } from './usage.js';
import { isQuietSubject, mayReadMedia, mayReadReceipts, mayTrackWithModel } from './costpolicy.js';
import { MediaKeep, NameStore, meaninglessName, nameLineText, readableFileName, wantsRename } from './nameline.js';
import { cleanOutgoing } from './outgoing.js';
import { withFollowUp } from './followup.js';
import { Qbo, looksLikeConnectLine, parseConnectLine, qboEscape } from './qbo.js';
import { QboDesk, QboMap, parseQboCommand, pickTestGroup } from './qbodesk.js';
import { Audit, AuthStore, InvoiceStore, ItemCodes, PERMISSIONS, QboInvoiceDesk, TaxChoices, invoiceIntent, looksLikeInvoiceRequest, parseInvoiceCommand } from './qboinvoice.js';
import { extractInvoiceRequest } from './qboextract.js';
import { NamePreviews, QboNameDesk } from './qbonames.js';
import { BulkPreviews, PriceDraft, QboBulkDesk } from './qbobulk.js';
import { OneShot, SendDesk, chooseText, confirmText, findInvoice, isOwnerCommand, parseSendCommand, resolveGroups, sendFileName } from './invoicesend.js';
import { CustomerGroupDesk, CustomerGroups, NameBook, altNames, collectCustomers, customerRowFor, learnPrintedName, mergeSources, nameKey, rowGroups, rowOfGroup, settleDuplicates } from './customergroups.js';
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
import { qboNameFor } from './qboname.js';
import { itemCodesOf, threeWay, threeWayText } from './threeway.js';
import { PayChecks } from './paychecks.js';
import { isClearingText } from './payments.js';
import { isCancelText, isClearReply, isReplyFiller, looksLikeName } from './captions.js';
import { EditStore, InvoiceEdits } from './invoiceedit.js';
import { officeNote, parseOfficeRequest } from './officerequest.js';
import { deliveryDayText, driverEveningLines, isAckText, isDeliveryReportAsk, isDriverQuestion, runDoneLine, sameStop, whereText } from './driver.js';
import { Tracker, balanceOf, settleCuts, checkCod, checkDelivery, checkInvoiceAgainstOrders, isDuplicatePayment, customersWithOpenInvoices, cutDigest, reconcileCuts, checkInvoiceAgainstCuts, dueNags, extractEvent, formatBalance, markCleared, openOrders, parseTrackerCommand, statementsDue } from './tracker.js';
import { buildDigest, digestDue, isOrderStatusCommand, orderStatusText, readLastDigest, writeLastDigest } from './digest.js';
import { formatDetails, formatReport, parseDay, reportFailed, reportInvalidDate, todayLine } from './report.js';
import { formatStaffStock, separateStockAnswers } from './stock-format.js';
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
import { BotState, isAddressed, parseCommand, runCommand, staffAnswer, stockAsk, withoutBotNames } from './staff.js';
import { fetchReserved, reservedText } from './reserved.js';
import { CutEdits, decideCutEdit, listCuts, requestCutEdit } from './cutedit.js';
import { repairSharedCuts } from './cutrepair.js';
import { lidLookup } from './lidmap.js';
import { PersianNames, seedPersianNames } from './persiannames.js';
import { stockDiff, stockDiffFile } from './stockdiff.js';
import { CutAliases, proposeAliases, sameBrand } from './cutaliases.js';
import { SheetNameStore, applyCells, backupName, cellsOf, findQboName, overrideFor, planSheetNames, sheetCall, sheetPreviewText, sheetProblem } from './sheetnames.js';
import { unbilled, unbilledText } from './unbilled.js';
import { PaymentDups, cleanPaymentEvents, groupPaymentNotices, migrateOldPayments, paymentsText, sharedPaymentList } from './payments.js';
import { AvailabilityDrafts, draftText, managerText, parseAvailabilityAsk, stateOf } from './availdraft.js';
import { GroupStatements, StatementPreviews, askLine, effectiveRequest, parseStyleReply, previewText, statementAsk } from './groupstatement.js';
import { DEFAULT_PHRASES, metadataToken, speechTranscriber } from './speech.js';
import { MAX_SECONDS, NO_VOICE_CUSTOMER, NO_VOICE_FA, NOT_UNDERSTOOD_CUSTOMER, NOT_UNDERSTOOD_FA, VoiceDesk, answerKind, answerLead, nameHeard, retryText, understand, voiceAction } from './voice.js';
import { normalizeDigits } from './text.js';
import { matchOption } from './choice.js';
import { shouldProcess, OwnerSeen } from './intake.js';
import { documentBlock, pdfTextLayer, setDocMeter } from './pdftext.js';
import { setVisionMeter, visionRead } from './vision.js';
import { PHOTO_RULES, TEST_MODEL, costOf, photoGroupLabel, parseReading, photoMessage, summaryText } from './photoread.js';
import { ExpenseStore, expenseAsk, RECEIPT_RULES, entryText, expensesText, handleReply, makeEntry, matchReceipts, monthlyFullText, whyNotFound, parseExpenseCaption, parseExpenseReply, rangeOf, receivedItems, receivedText, swapCandidate, weeklyCheckText } from './expenses.js';
import { CostMeter } from './cost.js';
import { planVoice, VoiceGate, bareAnswerYieldsToPending, looksLikeCorrection } from './voicegate.js';
import { deliver, captionCustomerName } from './photoflow.js';
import { cutRecords, markCutsInvoiced, crossCheck } from './cuts.js';
import { PendingChoice, parseChoice } from './pendingchoice.js';
import { mergeTranscripts, isShortCorrection } from './voicemerge.js';
import { codeKnownInItems } from './qboinvoice.js';
import { buildSystemPrompt } from './prompt.js';
import { acquireSingleInstance } from './singleinstance.js';
import { TRANSLATE_SYSTEM, englishOut, isEnglishOut, setOutLang } from './outlang.js';
import { applyTags } from './tags.js';

const { config, missing } = loadConfig();
setOutLang(config.replyLanguage);
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
    systemCache = { version, text: [buildSystemPrompt(config.kbDir, config.displayName, config.replyLanguage), rules.promptText(), experience.promptText()].filter(Boolean).join('\n\n') };
  }
  return systemCache.text;
};
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
config.log = (s) => logger.warn(s);
config.logInfo = (s) => logger.info(s);
// ONE bot process per WhatsApp session: a second one (a double start) waits for the first to stop, or leaves; the lock lives in the auth folder
{
  const lock = await acquireSingleInstance(path.join(config.authDir, 'bot.lock'), { log: (m) => logger.warn(m) });
  if (!lock.ok) { logger.error(`another bot process (${lock.holder}) holds the WhatsApp session; this one stops so the two do not answer twice`); process.exit(1); }
  logger.info(`single instance: process ${process.pid} holds the session lock`);
  const free = () => lock.release();
  process.on('exit', free);
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { free(); process.exit(0); });
}
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
const paymentDups = new PaymentDups(path.join(config.authDir, 'qbo')); // the owner's answers about payments that repeat (count once or two payments), kept on the server
const cutAliases = new CutAliases(path.join(config.authDir, 'qbo')); // names the cutting and delivery groups use for a customer, approved by the owner; on the server only
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

// The evening report «cut or delivered, not invoiced»: once a day after EVENING_REPORT_HOUR, to the owner's own chat (or the Information group). Read only.
let lastEvening = '';
setInterval(async () => {
  try {
    if (config.eveningReportHour === null || !sock?.user || botState.paused || !qbo.connected) return;
    const now = localParts(Date.now(), config.timezone);
    if (now.day === lastEvening || Math.floor(now.minutes / 60) < config.eveningReportHour) return;
    lastEvening = now.day;
    const text = await unbilledReport();
    if (config.eveningReportTo === 'info' && config.infoGroupName) await sendTo(config.infoGroupName, `${text}\n— ${config.displayName}`);
    else await sock.sendMessage(ownIds()[0], { text: `🤖 ${text}` });
    logger.info(`evening report for ${now.day} sent (${config.eveningReportTo})`);
  } catch (e) { logger.warn(`evening report failed: ${e.message}`); }
}, 5 * 60 * 1000).unref();

// The daily summary for the information group, once a day after the set hour (counts only).
setInterval(async () => {
  try {
    if (!sock?.user || !config.infoGroupName || botState.paused) return;
    const day = digestDue({ timeZone: config.timezone, hour: config.digestHour, last: readLastDigest(config.authDir) });
    if (!day) return;
    await sendTo(config.infoGroupName, buildDigest({ history: desk.history, requests: desk.requests, day, timeZone: config.timezone, events: tracker.events, extraLines: [...driverEveningLines(tracker.events, { day, timeZone: config.timezone, aliasOf: (n) => cutAliases.resolve(n), display: driverNamerNow() }), ...(() => { usage.save(); cost.save(); for (const l of usage.logLines()) logger.info(l); const taken = sheetState.d.notes.splice(0); if (taken.length) sheetState.save(); const c = cutDigest(tracker); if (taken.length) c.sheet = taken; return [cost.line() || usage.line(), (() => { const n = customerGroups.newUnmapped(knownInvoiceCustomers().customers, config); return n.length ? `- Invoice customers with no group in the customer list yet: ${n.slice(0, 8).join(', ')}${n.length > 8 ? ` and ${n.length - 8} more` : ''}` : ''; })(), ...customerGroups.takeNotes().map((l) => `- ${l}`), c.invoiceNoCut ? `- Invoices with no cut recorded yet: ${c.invoiceNoCut}` : '', c.cutNoInvoice ? `- Cuts with no invoice yet: ${c.cutNoInvoice}` : '', ...(c.sheet ? ['- Cut photos against the sheet:', ...c.sheet.map((l) => `  ${l}`)] : [])].filter(Boolean); })()] }));
    writeLastDigest(config.authDir, day);
    logger.info(`daily summary for ${day} sent`);
  } catch (e) { logger.warn(`daily summary failed: ${e.message}`); }
}, 60 * 1000).unref();

/** Her fixed Persian sentences, put into English right before they are sent (one small call per new message; the lines she knows are translated without it). */
async function englishViaModel(chunk) {
  const res = await client.beta.messages.create({
    model: config.visionModel, max_tokens: 1500, system: TRANSLATE_SYSTEM,
    messages: [{ role: 'user', content: chunk }], output_config: { effort: 'low' },
  });
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

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
  return reconcileSheet({ cuts: settleCuts(cuts), rows, tol: config.cutToleranceMetres, match: sheetMatch });
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

const lastPayName = new Map(); // group -> the last bare name posted in the Confirmation group
const payRef = (groupId, id) => createHash('sha256').update(`${groupId}|${id}`).digest('hex').slice(0, 24); // the reference of a payment entry made from message [id]

/** The text of a PDF (its text layer, free) as payment evidence: { amount, date, payer, receipt, invoices } or null when it has no readable text or amount. */
function receiptOfPdf(buf) {
  const layer = pdfTextLayer(buf);
  return layer.ok ? parseReceiptText(layer.text) : null;
}
/** What a photo reading (extractEvent) gives, as the base of a payment entry; null when it read no amount. */
const photoBase = (ev) => (ev && Number(ev.amount) > 0 ? { amount: Number(ev.amount), receipt: ev.kind === 'cheque' ? 'cheque' : ev.kind === 'transfer' ? 'transfer receipt' : 'receipt', payer: ev.customer || '', source: 'photo', invoices: ev.number ? [`inv-${String(ev.number).replace(/\D/g, '')}`] : [] } : null);
const baseOfReceipt = (read) => ({ amount: read?.amount || 0, paidOn: read?.date || '', receipt: read?.receipt || 'receipt', payer: read?.payer || '', source: 'pdf', invoices: read?.invoices || [] });
const withCustomer = (merged) => ({ ...merged, customer: canon(merged.customer), customerTyped: merged.customer });

/** The time of the message being read (its own time when it comes from the history), else now. */
const replayCtx = new AsyncLocalStorage();
const nowAt = () => replayCtx.getStore()?.at || Date.now();
/** A media download; when the copy on WhatsApp's servers has expired the phone is asked to upload it again. */
function downloadMedia(message) { return downloadMediaMessage(message, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage, logger }); }
const monitorStartMs = () => Date.parse(`${config.monitorFrom}T00:00:00+04:00`) || 0; // nothing before this day is monitored
const clampRange = (r) => (r.from < config.monitorFrom ? { ...r, from: config.monitorFrom } : r);

/** The owner is told what a new payment entry looks like (a proposal; nothing is recorded in QuickBooks). */
const swapPending = new Map(); // ref -> { at }: a payment to compare with QuickBooks for swapped digits
function tellPayment(event) {
  if (replayCtx.getStore()?.quiet) return; // a message read from the history is never announced
  if (qbo.connected && !qbo.paused && Number(event.amount) > 0 && event.kind !== 'cheque') swapPending.set(event.ref, { at: Date.now() });
  if (qbo.connected && !qbo.paused && (Number(event.amount) > 0 || event.invoices?.length || event.source === 'pdf') && config.paymentNotices) payPending.set(event.ref, { at: Date.now() }); // held a few minutes: the messages about one payment become ONE notice
}

// One notice per payment: an entry waits 3 minutes (8 while its amount is still unread), then the entries of one amount are announced together, once.
const payPending = new Map(); // ref -> { at }
const payNoticed = new Map(); // ref -> the amount announced
async function flushPaymentNotices() {
  if (!qbo.connected || qbo.paused || !payPending.size) return;
  const due = [...payPending].filter(([ref, p]) => { const e = tracker.events.find((x) => x.ref === ref); return Date.now() - p.at >= (e && Number(e.amount) > 0 ? 3 : 8) * 60000; }).map(([ref]) => ref);
  if (!due.length) return;
  const known = new Set((qboDesk.cache?.customers || []).map((r) => r.DisplayName).filter(Boolean));
  const isKnown = (n) => [...known].some((q) => sameStop(n, q, (x) => cutAliases.resolve(x)));
  for (const g of groupPaymentNotices(tracker.events, due, { isKnown })) {
    for (const r of g.refs) payPending.delete(r);
    if (g.refs.every((r) => payNoticed.get(r) === Number(g.rep.amount || 0))) continue; // already announced with this amount
    for (const r of g.refs) payNoticed.set(r, Number(g.rep.amount || 0));
    try {
      const body = await paymentsReport(tracker.events, g.rep.ref);
      if (body) await sock.sendMessage(ownIds()[0], { text: '🤖 ' + body + (g.others.length ? '\nAlso read from the same payment: ' + g.others.join('; ') + '.' : '') });
    } catch (e) { logger.warn('payment proposal failed: ' + e.message); }
  }
  if (payNoticed.size > 500) for (const k of [...payNoticed.keys()].slice(0, 200)) payNoticed.delete(k);
}
/** Posted 576, recorded 567 for the same customer within a week: ONE message at once to the owner's own chat (never a group) with the choice 1 / 2; nothing is written to QuickBooks. */
async function flushSwapChecks() {
  if (!qbo.connected || qbo.paused || !swapPending.size) return;
  const due = [...swapPending].filter((x) => Date.now() - x[1].at >= 3 * 60000).map((x) => x[0]);
  if (!due.length) return;
  const since = new Date(Date.now() - 12 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const payments = (await qbo.query("select * from Payment where TxnDate >= '" + since + "'").catch(() => [])).map((r) => ({ ...r, _type: 'Payment' }));
  for (const ref of due) {
    swapPending.delete(ref);
    const e = tracker.events.find((x) => x.ref === ref);
    if (!e) continue;
    const rec = swapCandidate(e, payments, nameAlias, config.timezone);
    if (!rec) continue;
    tracker.update(ref, { swapAsked: true });
    const day = (ms) => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).split('-'); return p[2] + '/' + p[1]; };
    const money = (n) => Number(n).toFixed(2);
    const text = 'payment ' + rec.TxnDate.slice(8, 10) + '/' + rec.TxnDate.slice(5, 7) + ' ' + money(rec.TotalAmt);
    const id = payChecks.codeFor(ref, text, 'swap', { qboAmount: Number(rec.TotalAmt), posted: Number(e.amount) });
    const name = String(rec.CustomerRef?.name || e.customer).toUpperCase();
    await sock.sendMessage(ownIds()[0], { text: ['🤖 Payment check #' + id + ' — ' + name, 'Posted ' + day(e.at) + ': ' + money(e.amount) + ' AED (' + JSON.stringify(String(e.text || e.customerTyped || '').slice(0, 60)) + ')', 'QuickBooks: ' + text + ' AED', 'Digits swapped?', '1. Same payment (' + money(rec.TotalAmt) + '), match it', '2. Different payment: keep ' + money(e.amount) + ' as not recorded', 'Answer 1 #' + id + ' or 2 #' + id].join('\n') });
    logger.info('payment check ' + id + ' asked: posted ' + e.amount + ', QuickBooks ' + rec.TotalAmt);
  }
}
setInterval(() => { void flushSwapChecks().catch((x) => logger.warn('payment checks failed: ' + x.message)); }, 30 * 1000).unref();
setInterval(() => { void flushPaymentNotices().catch((e) => logger.warn('payment notices failed: ' + e.message)); }, 30 * 1000).unref();

/** A bank receipt, a cheque slip or a transfer advice posted as a PDF in the Confirmation group: one payment entry from its text. */
async function trackPaymentPdf(raw, groupId) {
  let buf;
  try { buf = await downloadMedia(raw); } catch (e) { logger.warn(`tracker: the receipt pdf could not be downloaded: ${e.message}`); return; }
  if (buf.length > 10 * 1024 * 1024) { logger.warn(`tracker: a receipt pdf is too large in ${groupId}`); return; }
  const merged = mergePayment(baseOfReceipt(receiptOfPdf(buf)), {});
  const event = { ...withCustomer(merged), at: nowAt(), ref: payRef(groupId, raw.key.id) };
  if (!tracker.add(event)) return;
  trace(`group "${(await groupInfo(groupId)).subject}"`, 'tracker', `payment evidence read from a pdf${event.amount ? ' (an amount)' : ' (no readable amount)'}`);
  tellPayment(event);
}

/** A reply that quotes another message in the Confirmation group: the document or text it quotes gives the amount, the reply gives the customer and the invoice; ONE entry. true = handled here. */
async function replyToPayment({ raw, groupId, content, quotedId, event }) {
  const ctx = (content.extendedTextMessage || {}).contextInfo || {};
  const quotedRef = payRef(groupId, quotedId);
  const existing = tracker.events.find((e) => e.type === 'payment' && e.ref === quotedRef);
  let base = null;
  if (existing) base = { amount: existing.amount, paidOn: existing.paidOn, receipt: existing.receipt, payer: existing.pendingName ? '' : existing.customerTyped || existing.customer, source: existing.source, invoices: existing.invoices };
  else if (ctx.quotedMessage) {
    const quoted = normalizeMessageContent(ctx.quotedMessage);
    if (quoted?.documentMessage && /pdf/i.test(quoted.documentMessage.mimetype || '')) {
      try { base = baseOfReceipt(receiptOfPdf(await downloadMedia({ key: { remoteJid: groupId, id: quotedId, participant: ctx.participant }, message: ctx.quotedMessage }))); } catch (e) { logger.warn(`tracker: the quoted receipt could not be downloaded: ${e.message}`); }
    } else if (imageOf(quoted) && imageOf(quoted).caption && Number(parsePaymentCaption(imageOf(quoted).caption)?.amount) > 0) { // a photo WITH a caption «cash from X 789.5 aed»: the caption is the post (no model)
      const qp = parsePaymentCaption(imageOf(quoted).caption); base = { amount: qp.amount, payer: qp.customers?.[0] || '', source: 'caption' };
    } else if (imageOf(quoted)) { // a photo of a receipt or cheque: the cheap model first (the same path as every photo), only when the owner allows model reading
      if (mayReadReceipts(config)) {
        try {
          const buf = await downloadMedia({ key: { remoteJid: groupId, id: quotedId, participant: ctx.participant }, message: ctx.quotedMessage });
          const ev = await extractEvent({ client, config, role: 'payment', caption: imageOf(quoted).caption || '', images: [{ base64: buf.toString('base64'), mimeType: String(imageOf(quoted).mimetype || 'image/jpeg').split(';')[0] }] });
          base = photoBase(ev) || { amount: 0, receipt: 'receipt', source: 'photo' };
        } catch (e) { logger.warn(`tracker: the quoted photo could not be read: ${e.message}`); }
      } else { usage.count(groupLabel((await groupInfo(groupId)).subject), 'notRead'); base = { amount: 0, receipt: 'receipt', source: 'photo' }; }
    } else { const qt = textOf(quoted); const qp = qt ? parsePaymentCaption(qt) : null; if (qp && Number(qp.amount) > 0) base = { amount: qp.amount, source: 'text' }; }
  }
  if (!base) return false; // an ordinary caption: its own entry
  if (base.payer || !looksLikeName(event.customerTyped || event.customer || '')) event = { ...event, customer: '', customerTyped: '', pendingName: !base.payer }; // the reply text is never a customer name over the post's own, and filler is never one
  if (Number(event.amount) > 0 && Number(base.amount) > 0 && Math.abs(Number(event.amount) - Number(base.amount)) > 1) return false; // the reply names another amount: it is another payment
  const merged = withCustomer(mergePayment(base, event));
  if (existing) {
    tracker.update(existing.ref, { ...merged, pendingName: !!merged.pendingName, noAmount: !!merged.noAmount, cleared: !!(merged.cleared || existing.cleared) });
    trace(`group "${(await groupInfo(groupId)).subject}"`, 'tracker', 'a reply gave the customer and the invoice of the receipt it quotes: one entry');
    tellPayment(existing);
  } else {
    const made = { ...merged, at: nowAt(), ref: quotedRef }; // under the quoted receipt's own reference: a later «cleared» to the same receipt finds this entry
    if (tracker.add(made)) { trace(`group "${(await groupInfo(groupId)).subject}"`, 'tracker', 'a reply to a receipt: the receipt and the reply are one entry'); tellPayment(made); }
  }
  return true;
}

async function trackGroup(raw, groupId, role) {
  if (sent.has(raw.key.id) || botState.paused) return;
  const content = normalizeMessageContent(raw.message);
  if (role === 'payment' && content?.documentMessage && /pdf/i.test(content.documentMessage.mimetype || '')) { await trackPaymentPdf(raw, groupId); return; } // a receipt is payment evidence on its own
  const image = imageOf(content);
  const text = textOf(content) || image?.caption || '';
  if (!text && !image) return;
  const quotedId = (content.extendedTextMessage || image)?.contextInfo?.stanzaId || '';
  const refOf = (id, i = 0) => createHash('sha256').update(`${groupId}|${id}${i ? `|${i}` : ''}`).digest('hex').slice(0, 24);
  // The owner quote-replies the bank's clearing message to a cheque: THAT cheque is cleared on that date (amount from the message, customer from the cheque). Never a new payment, never a cash row.
  if (role === 'payment' && quotedId && text && isClearingText(text)) {
    const refs = new Set([payRef(groupId, quotedId), ...Array.from({ length: 12 }, (_, i) => refOf(quotedId, i))]);
    const cheque = tracker.events.find((e) => e.type === 'payment' && refs.has(e.ref));
    if (cheque) {
      const amt = Number(parsePaymentCaption(text)?.amount) || 0;
      if (!(Number(cheque.amount) > 0) && amt > 0) tracker.update(cheque.ref, { amount: amt });
      const same = amt > 0 && Math.abs(amt - (Number(cheque.amount) > 0 ? Number(cheque.amount) : amt)) <= 1;
      if (same) tracker.update(cheque.ref, { kind: 'cheque', cleared: true, clearedAt: nowAt(), clearingMismatch: null });
      else tracker.update(cheque.ref, { kind: 'cheque', clearingMismatch: { amount: amt, at: nowAt() } }); // a different amount: the owner decides, the cheque stays open
      trace(`group "${(await groupInfo(groupId)).subject}"`, 'tracker', same ? 'a clearing message quoted on a cheque: that cheque is cleared' : 'a clearing message quoted on a cheque with another amount: waiting for the owner');
      return;
    }
  }
  // A quote-reply of filler to a payment («plz clear it», «also this», «done»): never a payment of its own and never a customer name; «clear» sets the status of the quoted payment.
  if (role === 'payment' && quotedId && text && isReplyFiller(text)) {
    const refs = new Set([payRef(groupId, quotedId), ...Array.from({ length: 12 }, (_, i) => refOf(quotedId, i))]);
    const hit = tracker.events.filter((e) => e.type === 'payment' && refs.has(e.ref));
    if (isClearReply(text)) for (const e of hit) if (!e.cleared) tracker.update(e.ref, { cleared: true });
    trace(`group "${(await groupInfo(groupId)).subject}"`, 'tracker', hit.length ? (isClearReply(text) ? 'a reply cleared the payment it quotes' : 'a filler reply to a payment: nothing recorded') : 'a filler reply to a message that is no recorded payment: nothing recorded');
    return;
  }
  // A quote-reply that says «cancel» to a cut post of the orders group: that post (customer, code, quantity) is marked CANCELLED, silently. It is no cut any more; the three-way check follows it up.
  if (role === 'cut' && quotedId && text && isCancelText(text)) {
    const refs = new Set(Array.from({ length: 12 }, (_, i) => refOf(quotedId, i)));
    const hit = tracker.events.filter((e) => e.type === 'cut' && refs.has(e.ref) && !e.cancelled);
    for (const e of hit) tracker.update(e.ref, { internal: true, cancelled: { at: nowAt(), text: String(text).slice(0, 80) } });
    trace(`group "${(await groupInfo(groupId)).subject}"`, 'tracker', hit.length ? `${hit.length} cut post(s) cancelled by a quote-reply` : 'a cancel word, but no recorded cut post is quoted');
    return;
  }
  // The shapes the groups really use are read here without a model (and without downloading the photo).
  const det = text ? eventsFromCaption(role, text) : null;
  if (det) {
    const whereDet = `group "${(await groupInfo(groupId)).subject}"`;
    if (det.cleared) {
      let done = null;
      const own = role === 'payment' && quotedId ? tracker.events.find((e) => e.type === 'payment' && e.ref === refOf(quotedId)) : null;
      if (own) { if (!own.cleared) tracker.update(own.ref, { cleared: true }); done = own; } // the very receipt it quotes (already cleared by someone else: the same payment, not another one)
      else if (role === 'payment' && quotedId && await replyToPayment({ raw, groupId, content, quotedId, event: { cleared: true, customer: '', amount: 0, invoices: [] } })) done = true; // an older receipt: read from the quote
      if (!done) done = markCleared(tracker, quotedId ? refOf(quotedId) : '');
      trace(whereDet, 'tracker', done ? 'a money item was cleared' : 'cleared, but no open money item'); return;
    }
    if (det.clearInvoices) { markCleared(tracker, quotedId ? refOf(quotedId) : ''); trace(whereDet, 'tracker', `cleared ${det.clearInvoices.length} invoice(s)`); return; }
    if (det.ignore) { trace(whereDet, 'tracker', 'not a customer payment, left out'); return; }
    if (det.name && !looksLikeName(det.name)) { trace(whereDet, 'tracker', 'a filler word is no customer name'); return; }
    if (det.name && role === 'payment' && quotedId && await replyToPayment({ raw, groupId, content, quotedId, event: { customer: det.name, amount: 0, invoices: [] } })) return; // «Awab» as a reply to a receipt photo or PDF: the name belongs to that receipt
    if (det.name) { // a bare name: it belongs to the nameless payment just before it (ten minutes), or to the one that comes just after
      lastPayName.set(groupId, { customer: det.name, at: nowAt() });
      const before = [...tracker.events].reverse().find((e) => e.type === 'payment' && !e.customer && e.pendingName && nowAt() - e.at < 10 * 60 * 1000);
      if (before) { tracker.update(before.ref, { customer: canon(det.name), customerTyped: det.name, pendingName: false }); trace(whereDet, 'tracker', 'a name was given to the payment just before it'); }
      return;
    }
    for (const [i, ev] of det.events.entries()) {
      const event = { ...ev, customer: canon(ev.customer), customerTyped: ev.customer, at: nowAt(), ref: refOf(raw.key.id, i), ...(role === 'delivery' ? { msg: raw.key.id } : {}), ...(role === 'payment' ? { text: String(text).slice(0, 300) } : {}), ...(role === 'cut' ? { text: String(text).slice(0, 160) } : {}) };
      const pn = lastPayName.get(groupId); // the name posted just before a nameless payment
      if (role === 'payment' && !event.customer && pn && nowAt() - pn.at < 10 * 60 * 1000) { event.customer = canon(pn.customer); event.customerTyped = pn.customer; delete event.pendingName; trace(whereDet, 'tracker', 'the payment took the name posted just before it'); }
      if (role === 'payment' && quotedId && await replyToPayment({ raw, groupId, content, quotedId, event })) continue;
      if (isDuplicatePayment(tracker, event)) { trace(whereDet, 'tracker', 'the same payment was already recorded minutes ago: counted once'); continue; }
      if (event.customer && ev.customer && !sameStop(ev.customer, event.customer, nameAlias)) logger.info(`tracker: "${ev.customer}" was recorded as "${event.customer}" (${rowOfName(ev.customer) ? 'customer-group row' : 'alias map'}) — say "explain name ${ev.customer}" to see why`);
      if (!tracker.add(event)) continue;
      trace(whereDet, 'tracker', `${role} recorded from the caption${event.internal ? ' (internal, not a sale)' : ''}`);
      // goods that arrive ("received") close the sourcing requests for their code: it is not a mistake that they came in
      if (role === 'goods' && event.kind === 'received') for (const m of String(event.item || '').matchAll(/\d{2,5}/g)) markSourcingReceived(tracker, m[0]);
      if (role === 'cut' && !event.internal) await cutReconcile(event.customer);
      if (role === 'payment' && (Number(event.amount) > 0 || event.invoices?.length) && qbo.connected && !qbo.paused && !replayCtx.getStore()?.quiet) { // the owner is told which open invoices this payment looks like (a proposal; nothing is recorded)
        tellPayment(event);
      }
      if (role === 'delivery') {
        const findings = [...checkDelivery(tracker, event), ...checkCod(tracker, event)];
        if (findings.length) trace(whereDet, 'tracker', `${findings.length} delivery note(s) kept for the digest only`);
        await announceRunDone(tracker.events, event, (t) => sock.sendMessage(groupId, { text: t }));
        if (tracker.isHeld(event.customer)) await sock.sendMessage(groupId, { text: `⛔ ${tracker.isHeld(event.customer)}: تحویل تا تأیید نقدی نباید انجام شود. — ${config.displayName}` }, { quoted: raw });
      }
    }
    return;
  }
  if (role === 'goods') return; // only the shapes above are read there
  if (!image && !/\d/.test(text) && text.length < 12) return; // a greeting or a thanks
  // The free caption reader is done. Anything else would be a paid call (and a photo download): only when the owner allows it.
  if (!(role === 'payment' && image ? mayReadReceipts(config) : mayTrackWithModel(config))) { usage.count(groupLabel((await groupInfo(groupId)).subject), 'notRead'); return; }
  const images = [];
  if (image) {
    try { images.push({ base64: (await downloadMedia(raw)).toString('base64'), mimeType: String(image.mimetype || 'image/jpeg').split(';')[0] }); } catch (e) { logger.warn(`tracker: photo download failed: ${e.message}`); }
  }
  const ev = await extractEvent({ client, config, role, caption: text, images });
  const where = `group "${(await groupInfo(groupId)).subject}"`;
  if (!ev) { trace(where, 'tracker', `${role}: nothing to record`); return; }
  const event = { ...ev, customer: canon(ev.customer), customerTyped: ev.customer, at: nowAt(), ref: createHash('sha256').update(`${groupId}|${raw.key.id}`).digest('hex').slice(0, 24), ...(role === 'payment' && image ? { source: 'photo', receipt: ev.kind === 'cheque' ? 'cheque' : ev.kind === 'transfer' ? 'transfer receipt' : 'receipt', ...(ev.customer ? {} : { pendingName: true }) } : {}) };
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
const postFile = async (jid, buf, fileName, caption, mimetype) => { const r = await sock.sendMessage(jid, { document: buf, mimetype, fileName, caption }); if (!r) throw new Error('the document was not sent'); };
/** The text of the report «cut or delivered, not invoiced»: the posts against ALL of the customers' QuickBooks invoices of the last 40 days. Read only. */
/** The OUT rows of the stock sheet for the last [days] days (read only): [{ customer, code, qty, unit, at }], or null when the sheet could not give them all (then nothing is claimed about what left). */
const sheetPages = { at: 0, key: '', rows: null }; // the OUT rows read for the last report: a second «unbilled» or the evening report within ten minutes does not read them again
async function sheetOutRows(days) {
  const key = `${todayDubai()}|${days}`;
  if (sheetPages.rows && sheetPages.key === key && Date.now() - sheetPages.at < 10 * 60 * 1000) return sheetPages.rows;
  try {
    const to = todayDubai(); const rows = []; const returned = []; let returnsKnown = true;
    for (let back = days; back > 0; back -= 10) { // ten days at a time: a page is at most 500 rows
      const from = dayPlus(to, -back); const upTo = dayPlus(to, -Math.max(0, back - 10) - (back > 10 ? 1 : 0));
      const rep = await fetchReport(config, { from, to: back <= 10 ? to : upTo, detail: true, limit: 500, returns: true });
      if ((rep.rowsTotal || 0) > (rep.rows || []).length) { logger.warn('three-way: only ' + (rep.rows || []).length + ' of ' + rep.rowsTotal + ' sheet rows came back for ' + from + ': what left the warehouse is not claimed'); return null; }
      if (Array.isArray(rep.returns)) returned.push(...rep.returns.map((r) => ({ customer: r.customer, code: r.code, qty: r.qty, unit: r.unit, at: Number(r.at) || Date.parse(r.day + 'T12:00:00Z') }))); else returnsKnown = false; // an older script sends none
      rows.push(...(rep.rows || []).filter((r) => r.type === 'OUT' || r.type === 'CUT')); // edge banding is recorded under the colour code of the film: all rows count
    }
    const mapped = rows.map((r) => ({ customer: r.customer, code: r.code, qty: r.qty, unit: r.unit, at: Number(r.at) || Date.parse(r.day + 'T12:00:00Z') }));
    if (returnsKnown) mapped.returns = returned; // the goods that came back into stock (a property of the list)
    Object.assign(sheetPages, { at: Date.now(), key, rows: mapped });
    return mapped;
  } catch (e) { logger.warn('three-way: the sheet gave no OUT rows (' + e.message + ')'); return null; }
}

/** What was CUT (the orders group), what LEFT (the sheet's OUT rows), what was INVOICED (QuickBooks), per customer and code: the sections of src/threeway.js. */
async function unbilledReport(events = tracker.events, opts = {}) {
  const days = 45;
  const since = new Date(Date.now() - (days + 30) * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const invoices = await qbo.query("select * from Invoice where TxnDate >= '" + since + "'");
  // only what the sheet tracks: the films. Edge banding («EDGE 0.8x22 - 1810»), services (delivery, parking) and samples are no part of this comparison.
  const items = new Map((await qboBulk.items(true)).map((it) => [String(it.Id), itemCodesOf(it)])); // film by its code, edge banding by its colour, nothing else
  const qboNames = [...new Set([...(await qboDesk.customers().catch(() => [])).map((r) => r.DisplayName), ...invoices.map((i) => i.CustomerRef?.name)].filter(Boolean))];
  const outs = events === tracker.events ? await sheetOutRows(days) : null; // the test group never reads the real sheet
  const sharedNames = customerGroups.rows().filter((r) => rowGroups(r).some((g) => /\s(?:&|and|\+)\s/i.test(String(g.subject || '')))).map((r) => r.customer).filter(Boolean); // a group shared by two customers is mapped to one of them
  const result = threeWay({ events: repairSharedCuts(events, outs, sharedNames, { timeZone: config.timezone }), outs, returns: outs?.returns, invoices, itemCodes: (id, name) => (items.has(String(id)) ? items.get(String(id)) : [String(name || '')]), aliasOf: nameAlias, qboNames, days, timeZone: config.timezone, trackedSince: config.outTrackedSince ? Date.parse(config.outTrackedSince + 'T00:00:00+04:00') || 0 : 0 });
  for (const l of result.trace || []) logger.info(l); // what each line came from
  return threeWayText(result, { days, details: !!opts.details });
}

/** Payments seen in the Confirmation group against the customers' OPEN invoices: a proposal only, read only; nothing is recorded in QuickBooks. */
/** Payments stored before the new rules: a «9,940.00» that was really inv-9940 is read as the invoice, once; the numbers are logged («payments: re-parsed N stored rows»). */
async function migrateStoredPayments(events) {
  const old = events.filter((e) => e.type === 'payment' && !e.reparsed && !e.text && !e.source && e.kind === 'cash' && Number.isInteger(Number(e.amount)) && Number(e.amount) >= 100 && !(e.invoices || []).length);
  const withText = events.filter((e) => e.type === 'payment' && !e.reparsed && e.text);
  if (!old.length && !withText.length) return 0;
  const guesses = [...new Set(old.map((e) => `inv-${Number(e.amount)}`))].slice(0, 20);
  let rows = [];
  try { rows = guesses.length ? await qbo.query(`select * from Invoice where DocNumber in (${guesses.map((n) => `'${qboEscape(n)}'`).join(',')})`) : []; } catch (e) { logger.warn(`payments: the invoice look-up for the old rows failed: ${e.message}`); return 0; }
  const moves = migrateOldPayments({ events, invoiceRows: rows, aliasOf: (n) => cutAliases.resolve(n), parse: (t) => eventsFromCaption('payment', t)?.events?.[0] || null, onRow: (e, why) => logger.info(`payments: row ${String(e.ref).slice(0, 8)} amount ${e.amount} customer "${e.customer || ''}": ${why}`) });
  for (const m of moves) tracker.update(m.ref, m.patch);
  logger.info(`payments: checked ${old.length} old cash row(s) and ${withText.length} with kept words; ${rows.length} invoice(s) found; payments: re-parsed ${moves.length} stored rows`);
  return moves.length;
}

async function paymentsReport(events, only = '', opts = {}) {
  const invoices = await qbo.query("select * from Invoice where Balance > '0'");
  const since = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const payments = [...(await qbo.query(`select * from Payment where TxnDate >= '${since}'`).catch(() => [])), ...(await qbo.query(`select * from SalesReceipt where TxnDate >= '${since}'`).catch(() => [])), ...(await qbo.query(`select * from Deposit where TxnDate >= '${since}'`).catch(() => []))]; // what the office already recorded: the same three kinds of record the received report reads
  await migrateStoredPayments(events);
  const named = [...new Set(events.filter((e) => e.type === 'payment').flatMap((e) => e.invoices || []))].slice(0, 20); // the invoice numbers the messages give: paid or open
  const lookup = new Map();
  if (named.length) for (const row of await qbo.query(`select * from Invoice where DocNumber in (${named.map((n) => `'${qboEscape(n)}'`).join(',')})`).catch(() => [])) lookup.set(String(row.DocNumber).toLowerCase(), row);
  return paymentsText({ events: cleanPaymentEvents({ events, since: monitorStartMs(), isKnown: isOurCustomer }), invoices, payments, aliasOf: (n) => cutAliases.resolve(n), timeZone: config.timezone, dups: paymentDups, only, lookup, since: monitorStartMs(), ...(opts.days ? { days: opts.days } : {}), ...(opts.questions === false ? { questions: false } : {}) });
}

setTimeout(() => { if (qbo.connected && !qbo.paused) void migrateStoredPayments(tracker.events).catch((e) => logger.warn(`payments: the re-read of old rows failed: ${e.message}`)); }, 45000); // soon after the start (QuickBooks is connected by then), not only when a report is asked
const availDrafts = new AvailabilityDrafts();
const OWNER_CHAT_COMMANDS = new Set(['unbilled', 'payments', 'backfill', 'read_photos', 'expense_delete', 'cancel_all', 'queue_list', 'received_check', 'sheet_names', 'sheet_name_set', 'sheet_name_set_many', 'sheet_names_undo', 'name_explain', 'expenses_report', 'received_report', 'weekly_check', 'payment_dup', 'alias_propose', 'alias_drop', 'stock_diff', 'tax_inclusive', 'tax_inclusive_undo', 'persian_list', 'persian_set', 'compare', 'dry_run', 'cost_report', 'audit', 'auth_list', 'details']);
const asked = new Set(); // customer messages already answered with a draft
const officeAsked = new Set(); // customer messages already surfaced to the owner as an invoice request or an order
/**
 * A customer asks «209 available?» in his own group (or the owner simulates it in the test group): the answer is DRAFTED from the ZINAX sheet and sent PRIVATELY to the sales
 * manager (the owner when there is none, and always in a simulation). Nothing is said in the customer group until the manager's «yes #V1».
 */
async function customerAsksAvailability({ messageId, groupId, subject, text, simulated = false }) {
  const ask = parseAvailabilityAsk(text);
  if (!ask || asked.has(messageId)) return false;
  asked.add(messageId); if (asked.size > 300) asked.delete(asked.values().next().value);
  const states = [];
  for (const code of ask.codes) { try { states.push(stateOf(code, await fetchStock(config, { code }), ask.quantity)); } catch (e) { logger.warn(`availability draft: the sheet did not answer for ${code}: ${e.message}`); return false; } }
  const draft = states.some((x) => x.state === 'ambiguous') ? '' : draftText(states, ask.quantity);
  const id = draft ? availDrafts.add({ groupId, subject, draft, simulated, codes: ask.codes, messageId }) : '';
  const managerDigits = jidDigits(config.salesManager);
  const to = !simulated && managerDigits ? `${managerDigits}@s.whatsapp.net` : ownIds()[0];
  logger.info(`availability draft ${id || '(none)'} for "${subject}" sent privately to ${simulated ? 'the owner (simulation)' : managerDigits ? 'the sales manager' : 'the owner'}`);
  await sock.sendMessage(to, { text: `${to === ownIds()[0] ? '🤖 ' : ''}${managerText({ id, subject, asked: text.slice(0, 120), states, draft, simulated })}` });
  return true;
}

/** The manager's (or the owner's) «yes #V1» / «no #V1»: only now the draft is posted in the customer group (one token: this group, this text). A simulation posts nothing. */
async function decideAvailability(verb, id) {
  const d = availDrafts.get(id);
  if (!d) return ['That draft was not found or its half hour is over.'];
  availDrafts.clear(id);
  if (verb !== 'yes') { logger.info(`availability draft ${id} dropped`); return [`Dropped ${id}. Nothing was posted.`]; }
  if (d.simulated) return [`SIMULATION: would post in the group "${d.subject}": ${d.draft.replace(/\n/g, ' / ')} (nothing was posted)`];
  try {
    const content = { text: d.draft };
    oneShot.grantText(d.groupId, content);
    const r = await sock.sendMessage(d.groupId, content);
    if (!r) throw new Error('the message was not sent');
    logger.info(`availability draft ${id} posted in group "${d.subject}" by the yes of the manager`);
    return [`Posted the answer in the group "${d.subject}".`];
  } catch (e) {
    logger.warn(`availability draft ${id} could not be posted: ${e.message}`);
    return [`Posting in the group "${d.subject}" failed; it was not retried.`];
  }
}

function decideAlias(verb, id) {
  const r = cutAliases.decide(id, verb);
  if (r.error) return [`Proposal ${id} ${r.error === 'not found' ? 'was not found' : `is already ${r.error}`}.`];
  logger.info(`aliases ${id}: ${verb} (${r.count})`);
  return [verb === 'yes' ? `Approved ${r.count} alias(es). The cross-check and the reports use them from now on.` : `Cancelled ${id}. Those names will not be proposed again.`];
}
let stockDiffRunning = false;
/** «stock diff»: QuickBooks quantities against the ZINAX sheet (the true stock), read only on both sides; the workbook comes back to the chat that asked. */
async function runStockDiff(chatId) {
  const say = (body) => sock.sendMessage(chatId, { text: chatId === ownIds()[0] ? `🤖 ${body}` : body });
  try {
    const items = await qboBulk.items(true);
    const lookup = (code) => fetchStock(config, { code }, fetch, { tries: 2, timeoutMs: [45000, 30000], cache: null, log: () => {}, info: () => {} });
    const result = await stockDiff({ items, lookup, concurrency: 3, onProgress: (n, total) => logger.info(`stock diff: ${n} of ${total} items read`) });
    const day = localParts(Date.now(), config.timezone).day;
    const file = stockDiffFile(result, { date: day });
    const s = result.summary;
    await postFile(chatId, file, `stock-diff-${day}.xlsx`, `Stock differences, QuickBooks vs ZINAX (${day}): ${s.differs} differ, ${s.match} match, ${s['only in QuickBooks']} only in QuickBooks`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await say(`Stock difference file sent: ${result.rows.length} items — match ${s.match}, differs ${s.differs}, only in QuickBooks ${s['only in QuickBooks']}, not tracked in QuickBooks ${s['not tracked in QuickBooks']}, ambiguous in ZINAX ${s['ambiguous in ZINAX']}, could not read ZINAX ${s['could not read ZINAX']}. Largest differences first. Nothing was written to the sheet or to QuickBooks. Items only in ZINAX cannot be listed (the sheet has no list question).`);
  } catch (e) {
    logger.warn(`stock diff failed: ${e.name} ${e.message}`);
    await say(e.paused ? 'QuickBooks is paused by the owner.' : 'The stock difference could not be made now; try again later.');
  } finally { stockDiffRunning = false; }
}
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
// The usual Persian spelling of every QuickBooks customer: written once by the model, kept, listed for the owner to correct; used to find a customer named in Persian letters.
const persianNames = new PersianNames(path.join(config.authDir, 'qbo'));
qboDesk.persian = persianNames;
qboDesk.seedPersian = async () => seedPersianNames({ store: persianNames, client, config, customers: (await qboDesk.customers()).map((cu) => ({ id: String(cu.Id), name: cu.DisplayName || cu.CompanyName || '' })) });
// Invoices in QuickBooks: a request becomes a PREVIEW for the owner; only HIS "بله #Q12" in his own chat creates it (QBO_WRITE must be on too).
const qboAuth = new AuthStore(path.join(config.authDir, 'qbo'));
const qboInvoices = new QboInvoiceDesk({
  qbo, desk: qboDesk, store: new InvoiceStore(path.join(config.authDir, 'qbo')), audit: new Audit(path.join(config.authDir, 'qbo')), book, taxChoices: new TaxChoices(path.join(config.authDir, 'qbo')), itemCodes: new ItemCodes(path.join(config.authDir, 'qbo')),
  extract: (text) => extractInvoiceRequest({ client, config, text }), config,
  // the final cut of the customer and code, from the tracker (what the cutting group posted); marked with the invoice number once it is made
  cutsOf: (customer, codes) => cutRecords(tracker, customer, codes, { log: (s) => logger.info(s) }), markCuts: (refs, number) => markCutsInvoiced(tracker, refs, number),
  crossOf: (customer, lines, invoiced, opts = {}) => crossCheck(trackerOf(!!opts.test), customer, lines, { invoiced, log: (x) => logger.info(x), aliasOf: (n) => cutAliases.resolve(n) }), // a preview made in the test group is checked against the TEST data only
  // the free stock of a code, for a warning line in an invoice preview (the sheet is read, nobody is told)
  stockOf: async (code) => { try { const r = await fetchStock(config, { code }); return r.found && !r.ambiguous ? { free: Number(r.free) || 0, unit: r.unit || '' } : null; } catch { return null; } },
  today: () => localParts(Date.now(), config.timezone).day, post: postDocument, ownerJid: () => ownIds()[0], groups: allGroups, testGroup: (g) => pickTestGroup(g, config), log: (s) => logger.info(s),
});
// Where the QuickBooks PDF of a created invoice goes: the chat the request came from, the chat of the yes, and the owner's own chat when somebody else asked
// (his self chat is the origin when he asked there). The test group only when the request was made there. Never a customer group.
qboInvoices.targets = async (p, decidedIn) => {
  const wanted = [];
  const own = ownIds()[0];
  if (p.origin?.jid) wanted.push(p.origin.jid); else { wanted.push(own); const tg = pickTestGroup(await allGroups(), config); if (tg) wanted.push(tg.id); } // an old preview with no origin: as before
  if (decidedIn) wanted.push(decidedIn);
  if (p.requester !== 'owner') wanted.push(own);
  const out = [];
  for (const jid of [...new Set(wanted)]) {
    if (isJidGroup(jid)) { let subject = ''; try { subject = (await groupInfo(jid)).subject; } catch { /* unknown */ } if (!subject || !groupAllowed(subject, config).ok) { logger.info(`invoice PDF: not posted to a group that is not internal ("${subject || 'unknown'}")`); continue; } }
    out.push(jid);
  }
  return out;
};
const cutEdits = new CutEdits(path.join(config.authDir, 'qbo')); // correcting old stored cut rows: previews #X1, short row ids #Z1
const invoiceEdits = new InvoiceEdits({ invoices: qboInvoices, store: new EditStore(path.join(config.authDir, 'qbo')), log: (t) => logger.info(t) }); // editing an invoice: a preview #W1, the owner's yes applies it

// The one-off upper-casing of the QuickBooks customer names: a preview (#N1) and the owner's yes; a sparse update of the two name fields only.
const qboNames = new QboNameDesk({ qbo, desk: qboDesk, audit: qboInvoices.audit, store: new NamePreviews(path.join(config.authDir, 'qbo')), log: (s) => logger.info(s) });
// The owner's other bulk jobs (e-mail #E, mobile #M, item tax code #T, base prices #P): same pattern, each changes only its own fields.
const qboBulk = new QboBulkDesk({ qbo, desk: qboDesk, audit: qboInvoices.audit, store: new BulkPreviews(path.join(config.authDir, 'qbo')), draft: new PriceDraft(path.join(config.authDir, 'qbo')), itemCodes: qboInvoices.itemCodes, config, log: (s) => logger.info(s) });
qboBulk.afterRun = () => { qboInvoices.cache.at = 0; }; // a changed item (inactive, moved, priced) is read again for the next invoice
/** The owner's invoice commands (his own chat): request, yes, no, pause, resume, audit, and the list of people allowed to ask. */
async function qboInvoiceCommand(ic, text, here = {}) {
  switch (ic.type) {
    case 'names_plan': return qboNames.plan();
    case 'bulk_email': return qboBulk.planEmails(ic.email);
    case 'bulk_mobile': return qboBulk.planMobiles();
    case 'bulk_edge': return qboBulk.planEdgeList();
    case 'bulk_old_edge': return qboBulk.planOldEdge();
    case 'cost_report': return [cost.report(ic.range)];
    case 'details': return [qboInvoices.previewDetails(ic.id)];
    case 'alias_propose': {
      const blocked = qboInvoices.guard(); if (blocked) return [blocked];
      const since = Date.now() - 120 * 24 * 3600 * 1000;
      const postNames = tracker.events.filter((e) => ['cut', 'delivery'].includes(e.type) && !e.internal && e.at >= since).flatMap((e) => [e.customerTyped, e.customer]).filter(Boolean);
      const qboNames = (await qboDesk.customers()).map((cu) => cu.DisplayName || cu.CompanyName).filter(Boolean);
      const own = [...config.botNames, 'atousa', 'atusa', 'atoosa', 'atosa', 'آتوسا', 'اتوسا', ...(config.aliasExclude || [])].map((n) => nameKey(n)).filter(Boolean);
      const pairs = proposeAliases({ postNames: [...new Set(postNames)], qboNames, skip: (k) => cutAliases.settled(k), exclude: (n) => own.includes(nameKey(n)) }); // the assistant's own name (and staff names set in the settings) is never a customer
      if (!pairs.length) return [`No new alias to propose (${cutAliases.list().length} approved so far).`];
      const p = cutAliases.propose(pairs);
      return [[`Proposed aliases #${p.id} (names the cutting and delivery groups use → the QuickBooks customer). Nothing is used until you say yes:`, withEnd(pairs.slice(0, 25).map((x, i) => `${i + 1}. ${x.post} → ${x.qbo} (${x.score}%)`), [...(pairs.length > 25 ? [`+${pairs.length - 25} more`] : []), `Reply: yes #${p.id} (all) / no #${p.id} / drop 2,3 #${p.id} (remove lines first)`])].join('\n')];
    }
    case 'payment_dup': { const r = paymentDups.decide(ic.id, ic.verb); return [r.error ? `No open question #${ic.id} (it was answered or never asked).` : r.verb === 'dup' ? `Noted: the second payment is the same as the first; it will be counted once (#${ic.id}).` : `Noted: two separate payments (#${ic.id}); I will not ask again.`]; }
    case 'expense_delete': { const gone = expenseStore.remove(ic.id); return [gone ? `Expense #${gone.id} (${gone.amount ? `${gone.amount.toFixed(2)} AED` : 'no amount'}${gone.test ? ', test data' : ''}) was deleted.` : `No expense #${ic.id} was found.`]; }
    case 'backfill': {
      if (backfillRunning) return ['A history backfill is already running; wait for its report.'];
      const year = Number(localParts(Date.now(), config.timezone).day.slice(0, 4));
      const from = ic.day ? `${year}-${String(ic.month).padStart(2, '0')}-${String(ic.day).padStart(2, '0')}` : config.monitorFrom;
      void backfillStart(from).then((text) => sock.sendMessage(here.chatId || ownIds()[0], { text: `🤖 ${Array.isArray(text) ? text.join('\n') : text}` })).catch((e) => logger.warn(`history backfill failed: ${e.message}`));
      return [`Asking WhatsApp for the message list of the Confirmation and Expenses groups from ${from.split('-').reverse().join('/')}. This only counts; the estimate follows here and nothing is downloaded or read until you say yes.`];
    }
    case 'read_photos': {
      if (photoTestRunning) return ['A photo reading test is already running; its messages are still coming.'];
      const count = photoKeep.list_.filter((e) => e.groupKey === ic.group && e.at >= Date.now() - ic.days * 86400000).length;
      void readPhotoTest(here.chatId || ownIds()[0], ic.group, ic.days).catch((e) => logger.warn(`photo test failed: ${e.message}`));
      return [`Reading ${count} kept photo${count === 1 ? '' : 's'} of the ${photoGroupLabel(ic.group)} from the last ${ic.days} day${ic.days === 1 ? '' : 's'} with ${TEST_MODEL} only. One message per photo follows, then a summary. Nothing is stored or recorded.`];
    }
    case 'name_explain': return [nameExplain(ic.name)];
    case 'sheet_names': { const blocked = qboInvoices.guard(); if (blocked) return [blocked]; return sheetNamesPreview(); }
    case 'sheet_name_set_many': { const blocked = qboInvoices.guard(); if (blocked) return [blocked]; return sheetNameSetMany(ic.pairs); }
    case 'sheet_name_set': { const blocked = qboInvoices.guard(); if (blocked) return [blocked]; return sheetNameSet(ic.from, ic.to); }
    case 'sheet_names_undo': return sheetNamesUndo(ic.id);
    case 'received_check': { const blocked = qboInvoices.guard(); if (blocked) return [blocked]; return [await receivedCheck(ic.name)]; }
    case 'expenses_report': return [expensesReportText(ic.range)];
    case 'received_report': { const blocked = qboInvoices.guard(); if (blocked) return [blocked]; return [await receivedReportText(ic.range)]; }
    case 'weekly_check': { const blocked = qboInvoices.guard(); if (blocked) return [blocked]; return [await weeklyCheckReport()]; }
    case 'payments': { const blocked = qboInvoices.guard(); if (blocked) return [blocked]; return [await paymentsReport(tracker.events)]; }
    case 'unbilled': { const blocked = qboInvoices.guard(); if (blocked) return [blocked]; const chat = here.chatId || ownIds()[0]; const wait = setTimeout(() => { void sock.sendMessage(chat, { text: '🤖 Reading the sheet… this can take a minute.' }).catch(() => {}); }, 10000); try { return [await unbilledReport(undefined, { details: !!ic.details })]; } finally { clearTimeout(wait); } }
    case 'alias_drop': { const n = cutAliases.drop(ic.id, ic.numbers); return [n ? `Removed ${n} line(s) from #${ic.id}; reply yes #${ic.id} to approve the rest.` : `Nothing removed from #${ic.id}.`]; }
    case 'tax_inclusive': return await qboBulk.planTaxInclusive();
    case 'tax_inclusive_undo': return await qboBulk.planUndoTaxInclusive(ic.source);
    case 'stock_diff': {
      const blocked = qboInvoices.guard(); if (blocked) return [blocked];
      if (stockDiffRunning) return ['A stock difference is already being made; the file will come when it is done.'];
      stockDiffRunning = true;
      void runStockDiff(here.chatId || ownIds()[0]);
      return ['Reading the QuickBooks items and the ZINAX sheet (read only on both sides). It takes a few minutes; the Excel file comes to this chat.'];
    }
    case 'compare': { const blocked = qboInvoices.guard(); if (blocked) return [blocked]; return await qboInvoices.compareInvoices(ic.a, ic.b); }
    case 'dry_run': { const blocked = qboInvoices.guard(); if (blocked) return [blocked]; return await qboInvoices.dryRun(ic.id, ic.against); }
    case 'persian_list': {
      const blocked = qboInvoices.guard(); if (blocked) return [blocked];
      if (!persianNames.seeded) await qboDesk.seedPersian();
      const rows = (await qboDesk.customers()).map((cu) => ({ name: cu.DisplayName || cu.CompanyName || '', fa: persianNames.of(cu.Id)[0] || '' })).filter((r) => r.name && r.fa);
      if (!rows.length) return ['نام فارسی‌ای نوشته نشد؛ کمی بعد دوباره بنویسید.'];
      const parts = [`نام فارسی ${rows.length} مشتری (برای اصلاح بنویسید: «نام فارسی <مشتری> = <نام فارسی>»):`];
      for (let i = 0; i < rows.length; i += 40) parts.push(rows.slice(i, i + 40).map((r) => `Persian name: ${r.name} = ${r.fa}`).join('\n'));
      return parts;
    }
    case 'persian_set': {
      const blocked = qboInvoices.guard(); if (blocked) return [blocked];
      const r = await qboDesk.resolveLoose(ic.customer);
      if (!r.id) return [`مشتری «${ic.customer}» یکتا پیدا نشد؛ نام کامل‌تر (همان نام کوییک‌بوکس) را بنویسید.`];
      persianNames.setOwner(r.id, ic.persian);
      return [`ثبت شد: «${ic.persian}» برای ${r.name || ic.customer}. از این پس این نام فارسی را می‌شناسم.`];
    }
    case 'adjust': return qboInvoices.adjust(ic);
    case 'cancel_all': case 'queue_list': return [await queueCommand('owner', ic.type)];
    case 'yes_all': case 'no_all': return qboInvoices.decideAll({ verb: ic.type === 'yes_all' ? 'yes' : 'no' });
    case 'statement_nl': {
      if (ic.unsupported) return ['ماه شمسی را نمی‌توانم بسازم؛ ماه میلادی (مثل «ماه ۱۰ میلادی» یا «اکتبر») یا بازهٔ تاریخ بگویید.'];
      if (!ic.customer) { const out = ['صورت‌حساب کدام مشتری؟ نام را بنویسید یا بگویید.']; out.clarify = true; return out; }
      const blocked = qboInvoices.guard();
      if (blocked) return [blocked];
      const ownSay = (t) => sock.sendMessage(ownIds()[0], persianText(t));
      const x = await qboDesk.statementFor(ic.customer, { privateJid: ownIds()[0], period: ic.period, style: ic.style, preview: !ic.style });
      const out = [x.preview ? stylePreview(x, { by: 'owner', run: statementRun({ name: x.preview.name, period: ic.period, privateJid: ownIds()[0], say: ownSay }) }) : x.text];
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
    case 'swap_answer': {
      const waiting = payChecks.openIds().filter((i) => payChecks.get(i)?.action === 'swap');
      const id = ic.id ? ic.id.toUpperCase() : waiting.length === 1 ? waiting[0] : '';
      if (!id && !waiting.length) return null; // no payment check waits: the digit is not ours
      if (!id) return ['Several payment checks wait: ' + waiting.map((i) => '#' + i).join(', ') + '. Answer with the code, for example: ' + ic.choice + ' #' + waiting[0]];
      if (payChecks.get(id)?.action !== 'swap') return null;
      return decidePayCheck(ic.choice === 1 ? 'yes' : 'no', id);
    }
    case 'cut_cmd': {
      const cc = ic.cmd;
      if (cc.op === 'list') return [listCuts(cutEdits, tracker.events, { code: cc.code, day: cc.day, timeZone: config.timezone })];
      if (cc.op === 'undo') return decideCutEdit(cutEdits, tracker, 'undo', cc.id, { log: (t) => logger.info(t) });
      return [requestCutEdit(cutEdits, tracker, cc, { canon, timeZone: config.timezone }) || 'I could not read that cut edit.'];
    }
    case 'invoice_edit': { const blocked = qboInvoices.guard(); if (blocked) return [blocked]; return [await invoiceEdits.request({ number: ic.number, ops: ic.ops, bad: ic.bad, requester: 'owner', origin: here.chatId ? { jid: here.chatId } : null })]; }
    case 'request': case 'request_partial': { const r = await qboInvoices.request({ text, requester: 'owner', origin: here.chatId ? { jid: here.chatId } : null }); return [r.owner || r.requester]; }
    case 'yes': case 'no': {
      if (/^[0-9]+$/.test(ic.id || '')) { // «yes #36»: the number alone fits the ONE waiting item with it; several or none is said, never silence
        const ids = [...qboInvoices.openIds(), ...qboNames.openIds(), ...qboBulk.openIds(), ...groupStatements.openIds(), ...cutAliases.openIds(), ...availDrafts.openIds(), ...(pendingSheetNames ? [pendingSheetNames.id] : []), ...invoiceEdits.store.openIds(), ...payChecks.openIds(), ...cutEdits.openIds(), ...(pendingBackfill ? [pendingBackfill.id] : [])];
        const hits = ids.filter((x) => x.replace(/^[A-Za-z]+/, '') === ic.id);
        const word = ic.type === 'yes' ? 'yes' : 'no';
        if (hits.length !== 1) return [hits.length ? 'Several items wait under the number ' + ic.id + ': ' + hits.map((h) => '#' + h).join(', ') + '. Nothing was done. Reply with the full code, for example: ' + word + ' #' + hits[0] : 'Nothing is waiting under the number ' + ic.id + '. Nothing was done. Say "waiting" to see what is open.'];
        ic = { ...ic, id: hits[0] };
      }
      let id = ic.id; let said = '';
      if (!id) { // a bare yes or no: it counts only when exactly ONE preview is open (any kind); none: it is not ours; several: they are listed and nothing is done
        // in a GROUP a bare yes or no counts only what was made in that group (the invoice previews it asked, the statements); the drafts, the name lists and the rest live in the owner's own chat
        const inGroup = String(here.chatId || '').endsWith('@g.us');
        const open = inGroup
          ? [...qboInvoices.openIds().filter((id) => Object.values(qboInvoices.store.d.previews).find((p) => p.id === id)?.origin?.jid === here.chatId), ...invoiceEdits.store.openIds().filter((id) => invoiceEdits.store.get(id)?.origin?.jid === here.chatId), ...groupStatements.openIds()]
          : [...qboInvoices.openIds(), ...invoiceEdits.store.openIds(), ...qboNames.openIds(), ...qboBulk.openIds(), ...groupStatements.openIds(), ...cutAliases.openIds(), ...availDrafts.openIds(), ...(pendingSheetNames ? [pendingSheetNames.id] : []), ...cutEdits.openIds(), ...(pendingBackfill ? [pendingBackfill.id] : [])];
        if (!open.length) return null;
        if (open.length > 1) {
          if (isEnglishOut()) return [`${open.length} previews are waiting: ${open.map((x) => `#${x}`).join(', ')}. Nothing was done. Reply with the full code, for example: ${ic.type === 'yes' ? 'yes' : 'no'} #${open[0]}`];
          return [`چند پیش‌نمایش باز است: ${open.map((x) => `#${x}`).join('، ')}. چیزی انجام نشد؛ شمارهٔ پیش‌نمایش را بنویسید، مثل: ${ic.type === 'yes' ? 'بله' : 'نه'} #${open[0]}`];
        }
        id = open[0]; said = isEnglishOut() ? `${ic.type === 'yes' ? 'Approved' : 'Cancelled'} #${id}.\n` : `(${ic.type === 'yes' ? 'بله' : 'نه'} برای پیش‌نمایش #${id})\n`;
      }
      const out = await (id.startsWith('X') ? decideCutEdit(cutEdits, tracker, ic.type, id, { log: (t) => logger.info(t) }) : id.startsWith('G') ? decidePayCheck(ic.type, id) : id.startsWith('H') ? decideSheetNames(ic.type, id) : id.startsWith('W') ? invoiceEdits.decide({ verb: ic.type, id, decidedIn: here.chatId || '' }) : id.startsWith('B') ? decideBackfill(ic.type, id) : id.startsWith('V') ? decideAvailability(ic.type, id) : id.startsWith('A') ? decideAlias(ic.type, id) : id.startsWith('S') ? decideGroupStatement(ic.type, id) : id.startsWith('N') ? qboNames.decide({ verb: ic.type, id }) : /^[EMTPCUDRFIJKL]/.test(id) ? qboBulk.decide({ verb: ic.type, id }) : qboInvoices.decide({ verb: ic.type, id, decidedIn: here.chatId || '' }));
      return said && out.length ? [said + out[0], ...out.slice(1)] : out;
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
async function authorizedFlow({ chatId, text, canInvoice = false, canStatement = false, person = '' }) {
  { const q = parseInvoiceCommand(text); if ((q?.type === 'cancel_all' || q?.type === 'queue_list') && (canInvoice || canStatement) && person) { qboChats.add(chatId); await sock.sendMessage(chatId, { text: await queueCommand(person, q.type) }); return true; } } // his own waiting items only
  if (person && canStatement && await styleReplyFlow({ text, by: person, say: (t) => sock.sendMessage(chatId, persianText(t)), choicePending: !!choiceDesk.get(`pc:${chatId}`) })) { qboChats.add(chatId); return true; }
  const pend = choiceDesk.get(`pc:${chatId}`); // the number for the customer question she just asked this person
  if (pend?.kind === 'statement' && !pend.by && canStatement) {
    const at = parseChoice(text, pend.options);
    if (at >= 0) {
      choiceDesk.clear(`pc:${chatId}`);
      qboChats.add(chatId);
      try {
        const sayPrivate = (t) => sock.sendMessage(chatId, persianText(t));
        const x = await qboDesk.statementFor(pend.options[at], { privateJid: chatId, period: pend.period, preview: true });
        await sayPrivate(x.preview ? stylePreview(x, { by: person, run: statementRun({ name: x.preview.name, period: pend.period, privateJid: chatId, say: sayPrivate }) }) : x.text);
      } catch (e) { await sock.sendMessage(chatId, persianText('صورت‌حساب ساخته نشد؛ دوباره بنویسید.')); }
      return true;
    }
  }
  if (person && canStatement) {
    const pg = choiceDesk.get(`pcp:${person}`); // the customer of a group, asked of this person privately
    if (pg?.kind === 'statement_group') {
      const at = parseChoice(text, pg.options);
      if (at >= 0) { choiceDesk.clear(`pcp:${person}`); qboChats.add(chatId); await prepareGroupStatement({ customer: pg.options[at], period: pg.period, groupId: pg.groupId, subject: pg.subject, kind: pg.target || 'group', requester: pg.requester }); return true; }
    }
    const yn = parseInvoiceCommand(text); // his yes or no for a statement he asked for (a bare one counts when only one of his waits)
    if (yn && (yn.type === 'yes' || yn.type === 'no')) {
      const mine = groupStatements.openIds(person);
      const pick = yn.id ? (mine.includes(yn.id) ? yn.id : '') : (mine.length === 1 ? mine[0] : '');
      if (pick || (!yn.id && mine.length > 1)) {
        qboChats.add(chatId);
        const out = pick ? await decideGroupStatement(yn.type, pick, person) : [bi(`${mine.length} statements are waiting: ${mine.map((x) => `#${x}`).join(', ')}. Nothing was done. Reply with the full code, for example: ${yn.type} #${mine[0]}`, `چند صورت‌حساب منتظر است: ${mine.join('، ')}`)];
        for (const part of out) await sock.sendMessage(chatId, persianText(part));
        return true;
      }
    }
  }
  const ic = parseInvoiceCommand(text);
  const qc = ic ? null : parseQboCommand(text);
  const isRequest = ic?.type === 'request' || ic?.type === 'request_partial';
  const isStatement = qc?.type === 'statement';
  const nl = ic?.type === 'statement_nl' ? ic : null; // «صورت‌حساب شرکت … ماه ۱۰»: the same flow as the owner's, the PDF to this private chat
  if (!isRequest && !isStatement && !nl) return false;
  qboChats.add(chatId);
  const say = (t) => sock.sendMessage(chatId, persianText(t));
  if ((isRequest && !canInvoice) || ((isStatement || nl) && !canStatement)) logger.info(`not authorized: ${chatId} (${isRequest ? 'invoice' : 'statement'})`);
  if (isRequest && !canInvoice) { await say('برای درخواست فاکتور مجوز ندارید.'); return true; }
  if ((isStatement || nl) && !canStatement) { await say('برای درخواست صورت‌حساب مجوز ندارید.'); return true; }
  try {
    if (nl) {
      if (nl.unsupported || !nl.customer) { await say(nl.unsupported ? 'ماه شمسی را نمی‌توانم بسازم؛ ماه میلادی یا بازهٔ تاریخ بگویید.' : 'صورت‌حساب کدام مشتری؟ نام را بنویسید.'); return true; }
      const blockedNow = qboInvoices.guard();
      if (blockedNow) { await say(blockedNow); return true; }
      const x = await qboDesk.statementFor(nl.customer, { privateJid: chatId, period: nl.period, style: nl.style, preview: !nl.style });
      await say(x.preview ? stylePreview(x, { by: person, run: statementRun({ name: x.preview.name, period: nl.period, privateJid: chatId, say }) }) : x.text);
      if (x.ask && x.options?.length) choiceDesk.set(`pc:${chatId}`, { kind: 'statement', options: x.options, period: nl.period });
      return true;
    }
    if (isRequest) {
      const r = await qboInvoices.request({ text, requester: jidDigits(chatId), origin: { jid: chatId } });
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
const statementPreviews = new StatementPreviews({ nextId: () => groupStatements.nextId() }); // asked for, not built: waiting for «1» or «2»

/** Everything that waits for an answer, as { id, kind, cancel }. [by]: 'owner' sees every kind; a person sees only what he asked for (invoice previews, statements and their layout questions, his expenses). */
function waitingItems(by) {
  const own = by === 'owner'; const items = [];
  const add = (id, kind, cancel) => items.push({ id, kind, cancel });
  const no = (id) => () => qboInvoiceCommand({ type: 'no', id }, '', {}); // the same «no #id» the owner's command runs: one place decides each kind
  for (const id of qboInvoices.openIds()) { const p = Object.values(qboInvoices.store.d.previews).find((x) => x.id === id); if (own || p?.requester === by) add(id, 'invoice', no(id)); }
  if (own) {
    for (const id of qboNames.openIds()) add(id, 'customer names', no(id));
    for (const id of invoiceEdits.store.openIds()) add(id, 'invoice edit', no(id));
    for (const id of payChecks.openIds()) add(id, 'payment pairing to confirm', no(id));
    for (const id of cutEdits.openIds()) add(id, 'cut row correction', no(id));
    for (const id of qboBulk.openIds()) add(id, 'bulk job', no(id));
    for (const id of cutAliases.openIds()) add(id, 'aliases', no(id));
    if (pendingBackfill) add(pendingBackfill.id, 'history backfill estimate', no(pendingBackfill.id));
    if (pendingSheetNames) add(pendingSheetNames.id, 'sheet customer names', no(pendingSheetNames.id));
    for (const id of availDrafts.openIds()) add(id, 'availability draft', no(id));
    for (const id of Object.keys(paymentDups.d.open)) add(id, 'duplicate payment question', () => { delete paymentDups.d.open[id]; paymentDups.save(); return []; });
  }
  for (const id of groupStatements.openIds(own ? '' : by)) add(id, 'statement', no(id));
  for (const id of statementPreviews.openIds(by)) add(id, 'statement layout', () => { statementPreviews.clear(id); return []; });
  for (const e of expenseStore.d.items) if (!['done', 'cancelled'].includes(e.state) && Date.now() - e.at < 24 * 3600 * 1000 && (own || e.by === by)) add(e.id, 'expense', () => { e.state = 'cancelled'; expenseStore.save(); return []; });
  return items;
}

/** «no all» / «cancel all» / «لغو همه» drops everything that waits (the owner: all kinds; another person: only his own); «waiting» / «صف» only lists it. Nothing is ever created. */
async function queueCommand(by, type) {
  const items = waitingItems(by);
  if (!items.length) return 'Nothing is waiting.';
  const codes = items.map((i) => `#${i.id}`);
  if (type === 'queue_list') return [`Waiting (${items.length}):`, ...items.map((i) => `• #${i.id} — ${i.kind}`), 'Reply "no all" to cancel them all.'].join('\n');
  const done = [];
  for (const i of items) { try { await i.cancel(); done.push(`#${i.id}`); } catch (e) { logger.warn(`cancel all: ${i.id} failed: ${e.message}`); } }
  const failed = codes.filter((c) => !done.includes(c));
  return `Cancelled ${done.length}: ${done.join(', ')}. Nothing was created.${failed.length ? ` Could not cancel: ${failed.join(', ')}.` : ''}`;
}

/** Remember a statement request as a preview and return the text to show (the customer, the exact period, the two layouts). [run(style)] builds it where the request came from. */
function stylePreview(x, { by, run }) {
  const pv = x.preview;
  const id = statementPreviews.add({ by, name: pv.name, from: pv.from, to: pv.to, typed: pv.typed, guessed: pv.guessed, run });
  return previewText({ id, name: pv.name, from: pv.from, to: pv.to, typed: pv.typed, guessed: pv.guessed, several: statementPreviews.openIds(by).length > 1 }, !isEnglishOut());
}

/** What builds a previewed statement: the QuickBooks name is passed on exactly, so the customer is not guessed a second time. */
const statementRun = ({ name, period, privateJid, say }) => async (style) => {
  const y = await qboDesk.statementFor(name, { privateJid, period, style });
  await say(y.text);
};

/** The answer to a preview («1», «2», «No», with or without «#S5»): true when it was one. [say]: where the answers go; [choicePending]: a numbered customer question waits in this chat (a bare number belongs to it). */
async function styleReplyFlow({ text, by, say, choicePending = false }) {
  const r = parseStyleReply(text);
  if (!r) return false;
  const mine = statementPreviews.openIds(by);
  if (!mine.length) return false;
  if (!r.id && choicePending && r.kind === 'style') return false;
  const pick = r.id ? (mine.includes(r.id) ? r.id : '') : (mine.length === 1 ? mine[0] : '');
  if (r.id && !pick) { await say(bi('That statement was not found or its half hour is over; ask again.', 'این صورت‌حساب پیدا نشد یا مهلتش (نیم ساعت) تمام شده؛ دوباره درخواست بدهید.')); return true; }
  if (!pick) { await say(bi(`${mine.length} statements are waiting: ${mine.map((x) => `#${x}`).join(', ')}. Nothing was done. Reply with the code, for example: ${r.kind === 'no' ? 'No' : r.style === 'balance' ? '1' : '2'} #${mine[0]}`, `چند صورت‌حساب منتظر است: ${mine.map((x) => `#${x}`).join('، ')}. کاری نشد؛ با کد پاسخ بدهید، مثلاً ${r.kind === 'no' ? 'نه' : r.style === 'balance' ? '۱' : '۲'} #${mine[0]}`)); return true; }
  const p = statementPreviews.get(pick);
  statementPreviews.clear(pick);
  if (r.kind === 'no') { await say(bi('Cancelled. Nothing was made.', 'لغو شد؛ چیزی ساخته نشد.')); return true; }
  const blocked = qboInvoices.guard();
  if (blocked) { await say(blocked); return true; }
  try { await p.run(r.style); } catch (e) { logger.warn(`statement ${pick} failed: ${e.name} ${e.status || ''}`); await say(e.paused ? bi('QuickBooks is paused by the owner.', 'کوییک‌بوکس با فرمان مالک متوقف است.') : bi('The statement could not be made; write it again.', 'صورت‌حساب ساخته نشد؛ دوباره بنویسید.')); }
  return true;
}
const persianText = (body) => { const content = { text: body }; keepLang.add(content); return content; }; // kept in Persian: the outgoing hook turns Persian into English in company groups and for colleagues
const sayIn = async (raw, chatId, where, body) => { // always Persian here (the owner and the authorized people read it), quoted first then plain
  const d = await deliver({ send: (...args) => sock.sendMessage(...args), chatId, content: persianText(body), quoted: raw, where, log: (s) => logger.info(s) });
  return d.result;
};
const personOf = (raw) => (raw.key.fromMe ? 'owner' : jidDigits(raw.key.participant || ''));
const quotedTextOf = (ctx) => {
  if (!ctx?.quotedMessage) return '';
  if (ctx.participant && ownIds().some((o) => jidDigits(o) === jidDigits(ctx.participant))) return ''; // her own message is never a request
  const quoted = textOf(normalizeMessageContent(ctx.quotedMessage)) || '';
  return quoted.startsWith('🤖') ? '' : quoted;
};
const addressedIn = (text, ctx, strict = false) => isAddressed({
  text, mentioned: (ctx?.mentionedJid || []).map(jidNormalizedUser), quotedFrom: ctx?.participant ? jidNormalizedUser(ctx.participant) : '',
  ownIds: ownIds(), names: config.botNames, strict,
});

/**
 * «[orders] ART NO 303 MUNICH DOOR KITCHEN 6.4M», «[delivery] NUQOOSH 2 ROLLS DISPATCHED», «[confirm] … credited with AED 500.00 …», typed by the owner in the TEST group:
 * read exactly like a post of that group and stored in the TEST tracker, which no real report reads. Nothing is posted anywhere else.
 */
async function simulatedPost({ raw, text, where, role, reply }) {
  const cm = /^\s*\[customer\s+([^\]]+)\]\s*([\s\S]+)$/i.exec(text); // «[customer MASTER WOOD] 209 available?»: a message in that customer's group
  if (cm) {
    const done = await customerAsksAvailability({ messageId: raw.key.id, groupId: raw.key.remoteJid, subject: cm[1].trim(), text: cm[2].trim(), simulated: true });
    await reply(done ? `SIMULATION: the question was read; the draft and the sheet figures went to your own chat (nothing is posted anywhere).` : 'SIMULATION: that text was not read as an availability question (a code with "available?").');
    return true;
  }
  const m = /^\s*\[(orders|delivery|confirm)\]\s*([\s\S]+)$/i.exec(text);
  if (!m) return false;
  const kind = m[1].toLowerCase();
  const asRole = { orders: 'cut', delivery: 'delivery', confirm: 'payment' }[kind];
  const det = eventsFromCaption(asRole, m[2].trim());
  if (!det?.events?.length) { await reply(`SIMULATION: that text was not read as a post of the ${kind} group (nothing recorded).`); return true; }
  const lines = [];
  for (const [i, ev] of det.events.entries()) {
    const event = { ...ev, customer: canon(ev.customer), customerTyped: ev.customer, at: Date.now(), ref: createHash('sha256').update(`test|${raw.key.id}|${i}`).digest('hex').slice(0, 24), simulated: true, ...(asRole === 'delivery' ? { msg: raw.key.id } : {}) };
    if (!testTracker.add(event)) continue;
    if (asRole === 'delivery') await announceRunDone(testTracker.events, event, (t) => reply(`SIMULATION: ${t}`));
    trace(where, role, `simulated ${kind} post recorded as test data`);
    lines.push(`${event.type}${event.internal ? ' (internal)' : ''}: ${event.customer || '-'} ${(event.lines || []).map((l) => `${l.code} ${l.quantity}${l.invoiceQuantity !== undefined ? ` (invoiced ${l.invoiceQuantity})` : ''}`).join(', ')}${event.amount ? ` ${event.amount}` : ''}`.trim());
  }
  await reply(`SIMULATION (test data only, never in the real reports): recorded ${lines.length} ${kind} item(s)${lines.length ? `\n${lines.join('\n')}` : ''}`);
  return true;
}

/**
 * A statement in an INTERNAL group. The owner or an authorized person (۱) asks for it by her name or by quoting her; the PDF comes back in that group.
 * A numbered choice is kept for the person who asked. A colleague who is neither gets one Persian line. true = the message was taken.
 */
async function groupStatementTurn({ raw, chatId, text, ctx, owner, authorized, canInvoice = false, where, role, test = false }) {
  const may = owner || authorized;
  const by = personOf(raw);
  if (may && await styleReplyFlow({ text, by, say: (t) => sayIn(raw, chatId, where, t), choicePending: !!choiceDesk.get(`pc:${chatId}`) })) { trace(where, role, 'the answer to a statement preview'); return true; } // «1» / «2» / «No»
  // The owner's «بله #Q5» / «نه #Q5» (or the number of a statement waiting for a customer's group) typed in this internal group: the same decision as in his own chat.
  if (owner) {
    const dec = parseInvoiceCommand(text);
    const person = jidDigits(raw.key.participant || raw.key.remoteJid);
    // a bare yes or no counts here too (one waiting preview of any kind), unless a photo or voice question was asked last in this chat
    const bareOk = dec && (dec.type === 'yes' || dec.type === 'no') && !dec.id && !bareAnswerYieldsToPending(dec, !!(voiceDesk.get(`s:${chatId}:${person}`) || followDesk.get(`s:${chatId}:${person}`) || voiceGate.get(`vg:${chatId}:${person}`)));
    if (bareOk) {
      const parts = await qboInvoiceCommand(dec, text, { chatId });
      if (parts) { trace(where, role, `the owner's bare ${dec.type} typed in an internal group`); for (const part of parts) await sayIn(raw, chatId, where, part); return true; }
    }
    if (dec && OWNER_CHAT_COMMANDS.has(dec.type)) { // never silent: the test group answers from its own data, the other groups send him to his own chat
      if (test && (dec.type === 'unbilled' || dec.type === 'payments')) {
        trace(where, role, `the owner's ${dec.type} in the test group: answered from the test data`);
        try { await sayIn(raw, chatId, where, dec.type === 'unbilled' ? await unbilledReport(testTracker.events) : await paymentsReport(testTracker.events)); } catch (e) { await sayIn(raw, chatId, where, 'The report could not be made now; try again later.'); }
      } else await sayIn(raw, chatId, where, 'Owner command: use your own chat.');
      return true;
    }
    if (dec && (dec.type === 'yes' || dec.type === 'no') && /^(?:[QSA][0-9]+|W[0-9]+|[0-9]+)$/.test(dec.id || '')) {
      trace(where, role, `the owner's ${dec.type} for #${dec.id} typed in an internal group`);
      for (const part of (await qboInvoiceCommand(dec, text, { chatId })) || []) await sayIn(raw, chatId, where, part);
      return true;
    }
  }
  const pending = choiceDesk.get(`pc:${chatId}`);
  if (pending && pending.kind === 'statement' && pending.by) {
    if (may && pending.by === by) {
      const at = parseChoice(text, pending.options);
      if (at >= 0) {
        choiceDesk.clear(`pc:${chatId}`);
        trace(where, role, 'a numbered statement question was answered in the group');
        try {
          const sayHere = (t) => sayIn(raw, chatId, where, t);
          const x = await qboDesk.statementFor(pending.options[at], { privateJid: chatId, period: pending.period, preview: true });
          await sayHere(x.preview ? stylePreview(x, { by, run: statementRun({ name: x.preview.name, period: pending.period, privateJid: chatId, say: sayHere }) }) : x.text);
        } catch (e) { await sayIn(raw, chatId, where, e.paused ? 'کوییک‌بوکس با فرمان مالک متوقف است.' : 'صورت‌حساب ساخته نشد؛ دوباره بنویسید.'); }
        return true;
      }
    }
  }
  if (!addressedIn(text, ctx, !test)) return false; // an internal group: only a message that starts with her name (the test group keeps the old rule)
  const quoted = quotedTextOf(ctx);
  const eff = effectiveRequest(text, quoted, config.botNames);
  { // an invoice request: the preview is built and shown HERE (an internal group); only the owner's yes creates it
    const ic = parseInvoiceCommand(eff);
    if (ic?.type === 'invoice_edit') { // «edit invoice 10003» + changes, in an internal group: the preview is shown here; only the owner's yes applies it
      if (!(owner || canInvoice)) { await sayIn(raw, chatId, where, 'You do not have the invoice permission.'); return true; }
      const blocked = qboInvoices.guard(); if (blocked) { await sayIn(raw, chatId, where, blocked); return true; }
      trace(where, role, 'invoice edit request in an internal group');
      try {
        const text = await invoiceEdits.request({ number: ic.number, ops: ic.ops, bad: ic.bad, requester: owner ? 'owner' : by, origin: { jid: chatId } });
        await sayIn(raw, chatId, where, text);
        if (!owner && /#W\d+/.test(text)) await sock.sendMessage(ownIds()[0], { text: `🤖 ${text}` });
      } catch (e) { logger.warn(`invoice edit failed: ${e.name} ${e.status || ''} ${e.message}`); await sayIn(raw, chatId, where, 'The edit could not be prepared; try again or ask the owner.'); }
      return true;
    }
    if (ic?.type === 'request' || ic?.type === 'request_partial') {
      if (!(owner || canInvoice)) { logger.info(`not authorized: ${raw.key.participant || raw.key.remoteJid} (invoice)`); trace(where, role, 'an invoice request from a colleague without the invoice permission'); await sayIn(raw, chatId, where, 'برای درخواست فاکتور مجوز ندارید.'); return true; }
      trace(where, role, 'invoice request in an internal group');
      try {
        const r = await qboInvoices.request({ text: eff, requester: owner ? 'owner' : by, quotedText: quoted, origin: { jid: chatId }, test });
        await sayIn(raw, chatId, where, r.owner || r.requester);
        if (r.owner && !owner) await sock.sendMessage(ownIds()[0], { text: `🤖 ${r.owner}` });
      } catch (e) {
        logger.warn(`group invoice request failed: ${e.name} ${e.status || ''}`);
        await sayIn(raw, chatId, where, e.paused ? 'کوییک‌بوکس با فرمان مالک متوقف است.' : e.reconnect ? 'کوییک‌بوکس باید دوباره وصل شود؛ به مالک بگویید.' : 'پیش‌نمایش فاکتور ساخته نشد؛ کمی بعد دوباره بنویسید.');
      }
      return true;
    }
  }
  const ask = statementAsk(eff);
  if (!ask) return false;
  if (!may) { logger.info(`not authorized: ${raw.key.participant || raw.key.remoteJid} (statement)`); trace(where, role, 'a statement request from a colleague who is not authorized'); await sayIn(raw, chatId, where, 'صورت‌حساب را فقط مالک یا کسی که مالک مجاز کرده می‌تواند بخواهد.'); return true; }
  trace(where, role, 'statement request in an internal group');
  if (ask.unsupported) { await sayIn(raw, chatId, where, 'ماه شمسی را نمی‌توانم بسازم؛ ماه میلادی (مثل «ماه ۱۰ میلادی» یا «اکتبر») یا بازهٔ تاریخ بگویید.'); return true; }
  if (!ask.customer) { await sayIn(raw, chatId, where, 'صورت‌حساب کدام مشتری؟ نام را بنویسید.'); return true; }
  const blocked = qboInvoices.guard();
  if (blocked) { await sayIn(raw, chatId, where, blocked); return true; }
  try {
    const sayHere = (t) => sayIn(raw, chatId, where, t);
    const x = await qboDesk.statementFor(ask.customer, { privateJid: chatId, period: ask.period, style: ask.style, preview: !ask.style });
    await sayHere(x.preview ? stylePreview(x, { by, run: statementRun({ name: x.preview.name, period: ask.period, privateJid: chatId, say: sayHere }) }) : x.text);
    if (x.ask && x.options?.length) choiceDesk.set(`pc:${chatId}`, { kind: 'statement', options: x.options, period: ask.period, by });
  } catch (e) {
    logger.warn(`group statement failed: ${e.name} ${e.status || ''}`);
    await sayIn(raw, chatId, where, e.paused ? 'کوییک‌بوکس با فرمان مالک متوقف است.' : e.reconnect ? 'کوییک‌بوکس باید دوباره وصل شود؛ به مالک بگویید.' : 'صورت‌حساب ساخته نشد؛ کمی بعد دوباره بنویسید.');
  }
  return true;
}

/** The statement is built but NOT sent: kept as «#S3» and shown to the owner in his own chat; nothing reaches the customer's group before his yes. */
const bi = (en, fa) => (isEnglishOut() ? en : fa); // the few texts written directly in both languages
const toRequester = async (requester, body) => sock.sendMessage(requester.notify, requester.by === 'owner' ? { text: `🤖 ${body}` } : persianText(body));
const choiceKeys = (requester) => (requester.by === 'owner' ? ownIds().map((o) => `pc:${o}`) : [`pcp:${requester.by}`]);

async function prepareGroupStatement({ customer, period, groupId, subject, kind = 'group', requester = null, style = '' }) {
  const who = requester || { by: 'owner', notify: ownIds()[0] };
  const tell = (body) => toRequester(who, body);
  const where = kind === 'private' ? subject : `group "${subject}"`;
  const blocked = qboInvoices.guard();
  if (blocked) { await tell(blocked); return; }
  try {
    logger.info(`statement for a customer group: building "${customer}" for ${where}, asked by ${who.by}`);
    const x = await qboDesk.statementFor(customer, { hold: true, period, style, preview: !style });
    if (x.preview) { // the layout is chosen first, privately; the held file and the yes for the group come after it
      await tell(stylePreview(x, { by: who.by, run: (st) => prepareGroupStatement({ customer: x.preview.name, period, groupId, subject, kind, requester: who, style: st }) }));
      return;
    }
    if (x.ask) {
      if (x.options?.length) for (const key of choiceKeys(who)) choiceDesk.set(key, { kind: 'statement_group', options: x.options, period, groupId, subject, target: kind, requester: who });
      await tell(`${bi(`For ${where}: `, `برای ${kind === 'private' ? subject : `گروه «${subject}»`}: `)}${x.text}`);
      return;
    }
    if (!x.ok) { await tell(x.text); return; }
    const id = groupStatements.add({ groupId, subject, held: x.held, name: x.name, period, kind, by: who.by, notify: who.notify });
    logger.info(`statement ${id} waits for ${who.by}'s yes (${x.name}, balance ${x.balance})`);
    await postDocument(who.notify, x.held.pdf, x.held.fileName, x.held.caption); // the requester sees the very file first, in private
    const answer = groupStatements.openIds().length > 1 ? 'Yes #' + id + ' / No #' + id : 'Yes/No';
    const where2 = kind === 'private' ? subject : 'this group (' + subject + ')';
    const ask = isEnglishOut()
      ? `*Statement* — *${x.name}* — *${x.balance}*. Send to ${where2}? ${answer}`
      : askLine({ name: x.name, subject, id, period, kind });
    await tell(`${ask}${x.guessed ? bi(`\n(I guessed the name from "${x.typed}"; if it is wrong reply no #${id}.)`, `\n(نام را حدس زدم: «${x.typed}»؛ اگر درست نیست «نه #${id}» بنویسید.)`) : ''}`);
  } catch (e) {
    logger.warn(`customer-group statement failed: ${e.name} ${e.status || ''}`);
    await tell(e.paused ? bi('QuickBooks is paused by the owner.', 'کوییک‌بوکس با فرمان مالک متوقف است.') : bi('The statement could not be made; write it again.', 'صورت‌حساب ساخته نشد؛ دوباره بنویسید.'));
  }
}

/** The «بله #S3» / «نه #S3» (or a bare yes when it is the only one): only now the PDF goes to the customer's group (one-shot token for this group and this exact file). [by]: a person other than the owner may decide only what he asked for. */
async function decideGroupStatement(verb, id, by = '') {
  const p = groupStatements.get(id);
  if (!p) return [bi('That statement was not found or its half hour is over; ask again.', 'این صورت‌حساب پیدا نشد یا مهلتش (نیم ساعت) تمام شده؛ دوباره درخواست بدهید.')];
  if (by && p.by !== by) { logger.info(`not authorized: ${by} tried to decide statement ${id} of ${p.by}`); return [bi('That statement was asked for by someone else.', 'این صورت‌حساب را شخص دیگری خواسته است.')]; }
  groupStatements.clear(id);
  if (verb !== 'yes') { logger.info(`statement ${id} cancelled`); return [bi('Cancelled. Nothing was sent.', 'لغو شد؛ چیزی فرستاده نشد.')]; }
  const blocked = qboInvoices.guard();
  if (blocked) return [blocked];
  try {
    const content = { document: p.held.pdf, mimetype: 'application/pdf', fileName: p.held.fileName, caption: `Statement of account — ${p.name}` };
    oneShot.grant(p.groupId, content);
    quietContents.add(content);
    const r = await sock.sendMessage(p.groupId, content);
    if (!r) throw new Error('the message was not sent');
    logger.info(`statement ${id} sent to ${p.kind === 'private' ? 'a private chat' : `group "${p.subject}"`} by the yes of ${p.by}`);
    return [bi(`Statement for ${p.name} was sent to ${p.kind === 'private' ? p.subject : `the group "${p.subject}"`}.`, `صورت‌حساب «${p.name}» به ${p.kind === 'private' ? p.subject : `گروه «${p.subject}»`} فرستاده شد.`)];
  } catch (e) {
    logger.warn(`statement send to a customer group failed: ${e.message}`);
    return [bi(`Sending the statement to ${p.kind === 'private' ? p.subject : `the group "${p.subject}"`} failed; it was not retried.`, `فرستادن صورت‌حساب به ${p.kind === 'private' ? p.subject : `گروه «${p.subject}»`} نشد؛ دوباره تلاش نشد.`)];
  }
}
/**
 * A customer group (not internal): the OWNER's request means «send this to the customer». true = the message was taken (never answered in the group).
 * A colleague's request is ignored there. Anyone else (a customer) is left to the normal flow.
 */
/** The customers a customer group stands for: the owner's approved list first, then the group's name read against QuickBooks (a name with «&» names two). */
async function customersForGroup(groupId, subject) {
  const row = rowOfGroup(customerGroups, groupId);
  if (row) return { names: [row.customer], nearest: [] };
  const label = String(subject || '').replace(config.groupSuffix, '').trim();
  const parts = label.split(/\s*(?:&|\+|\/|,|\band\b)\s*/i).map((x) => x.replace(/\s*[-–—]\s*aryak.*$/i, '').trim()).filter(Boolean);
  const names = []; const nearest = [];
  for (const part of parts) {
    const r = await qboDesk.resolveSpoken(part);
    if (r.id) names.push(r.name); else nearest.push(...(r.many || r.nearest || []));
  }
  return { names: [...new Set(names)], nearest: [...new Set(nearest)].slice(0, 3) };
}

async function customerGroupStatement({ raw, groupId, info }) {
  const content = normalizeMessageContent(raw.message);
  const text = textOf(content) || '';
  if (!text || content?.audioMessage || content?.imageMessage || content?.documentMessage) return false;
  const ctx = content.extendedTextMessage?.contextInfo || {};
  if (!addressedIn(text, ctx)) return false;
  const ask = statementAsk(effectiveRequest(text, quotedTextOf(ctx), config.botNames));
  if (!ask) return false;
  const who = { sender: raw.key.participant, senderAlt: raw.key.participantAlt };
  const owner = !!raw.key.fromMe || staffChecker(config.ownerNumbers, lids(info.lidToPhone))(who) === true;
  const granted = !owner && qboAuth.has(who, 'statement', lids(info.lidToPhone)); // the manager with the statement permission may ask too
  const where = `group "${info.subject}"`;
  if (!owner && !granted) {
    const colleague = staffChecker([...config.staffNumbers, ...config.adminNumbers], lids(info.lidToPhone))(who) === true || qboAuth.isAuthorized(who, lids(info.lidToPhone));
    if (colleague) { logger.info(`not authorized: ${raw.key.participant || '-'} (statement in a customer group)`); trace(where, 'staff', 'ignored: a colleague without the statement permission asked for a statement in a customer group'); return true; }
    return false;
  }
  let requester;
  if (owner) requester = { by: 'owner', notify: ownIds()[0] };
  else {
    const number = qboAuth.whoIs(who, lids(info.lidToPhone)).number;
    requester = { by: number, notify: `${number}@s.whatsapp.net` };
    qboChats.add(requester.notify);
  }
  trace(where, owner ? 'owner' : 'authorized', 'statement request in a customer group: asked privately first');
  const tell = (body) => toRequester(requester, body);
  if (ask.unsupported) { await tell(bi('I cannot make a Persian-calendar month; say a Gregorian month or a date range.', 'ماه شمسی را نمی‌توانم بسازم؛ ماه میلادی یا بازهٔ تاریخ بگویید.')); return true; }
  let customer = ask.customer;
  if (!customer) { // no name: the customer is the one this group stands for
    const found = await customersForGroup(groupId, info.subject);
    logger.info(`statement in "${info.subject}" without a name: ${found.names.length} customer(s) found for the group`);
    if (!found.names.length) {
      await tell(`${bi('Customer not found for this group', 'برای این گروه مشتری پیدا نشد')}${found.nearest.length ? `${bi('. Nearest QuickBooks names: ', '. نزدیک‌ترین نام‌های کوییک‌بوکس: ')}${found.nearest.join(', ')}` : ''}.`);
      return true;
    }
    if (found.names.length > 1) {
      for (const key of choiceKeys(requester)) choiceDesk.set(key, { kind: 'statement_group', options: found.names, period: ask.period, groupId, subject: info.subject, target: 'group', requester });
      await tell(`${bi(`The group "${info.subject}" has several customers; write the number:`, `گروه «${info.subject}» چند مشتری دارد؛ شمارهٔ درست را بنویسید:`)}\n${withSeparators(found.names.map((n, i) => `${i + 1}. ${n}`))}`);
      return true;
    }
    [customer] = found.names;
  }
  await prepareGroupStatement({ customer, period: ask.period, groupId, subject: info.subject, requester });
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
async function understandAudio(load, seconds, forceLang = '', requireName = false) {
  // A long note is not even downloaded.
  if (seconds > MAX_SECONDS) { logger.info(`voice: ${seconds} s is too long, skipped`); return { ok: false, reason: 'too long' }; }
  try { const buffer = await load(); cost.voice(seconds); return await understand({ buffer, seconds, config, client, transcribe: async (...a) => { usage.count(usageCtx.getStore()?.group || '-', 'speech'); return transcribe(...a); }, forceLang, requireName, log: (s) => logger.info(s) }); }
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

const lids = (base) => lidLookup(config.authDir, base); // a sender shown only as a lid is still found by the phone number the auth folder knows
const loggedLid = new Set();
/** What this sender may ask of her (logged once when it was found only through a lid). */
const grantsOf = (who, base) => {
  const found = qboAuth.whoIs(who, lids(base));
  const lid = [who.sender, who.senderAlt].find((j) => String(j || '').endsWith('@lid'));
  if (found.number && lid && !who.senderAlt && !loggedLid.has(lid)) { loggedLid.add(lid); logger.info(`authorized: ${found.number} via lid`); }
  return found.grants;
};
/** What the sender may ask of her, as one line for the model (the owner may everything; others only what he granted). */
const abilitiesText = ({ owner, grants }) => (owner
  ? 'everything: customer statements (PDF), invoice requests (a preview, created only with his own yes), stock, reports, the cost report, QuickBooks jobs (his yes each).'
  : [grants.includes('statement') ? 'customer statements (a PDF; write her name and the request, for example «آتوسا صورت‌حساب <مشتری> ماه ۱۰»)' : '', grants.includes('invoice') ? 'invoice requests (she builds a preview; only the owner yes creates the invoice)' : ''].filter(Boolean).join('; ') || 'stock questions and reports only (no statement and no invoice: for those they need the permission of the owner).');
const jidDigits = (j) => String(j || '').replace(/@.*$/, '').replace(/:\d+$/, '').replace(/\D/g, '');
const ownIds = () => [sock.user?.id, sock.user?.lid].filter(Boolean).map(jidNormalizedUser);
const textOf = (content) => content?.conversation || content?.extendedTextMessage?.text || '';

const staffHandlersFor = (key, lang = 'fa', persianUnits = false) => ({
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
        formatted: formatStaffStock(found, i.code, note, lang, want, { units: persianUnits, boldTotal: true }),
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
  reserved_list: async () => ({ formatted: reservedText(await fetchReserved(config).catch(() => null), lang), instruction: 'Send the formatted text exactly as it is, character for character, with nothing added before or after.' }),
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
    blocks.push(`${formatStaffStock(res, line.code, '', lang, null, { boldTotal: true })}\n\n→ ${customer}: ${line.quantity} ${line.unit}: ${verdict}`);
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
  await reply([`درخواست ${customer}:`, withSeparators(blocks)].join('\n\n'));
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
  let audio = config.voiceEnabled ? content?.audioMessage : null;
  let audioRaw = raw; // the message the voice note is downloaded from (the quoted one when the person replies to a voice note with «this one»)
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
        try { const x = await qboDesk.statementFor(octxAsk.customer, { privateJid: chatId, period: octxAsk.period, style: octxAsk.style }); await sayIn(raw, chatId, where, x.text); if (x.ask && x.options?.length) choiceDesk.set(`pc:${chatId}`, { kind: 'statement', options: x.options, period: octxAsk.period, by: 'owner' }); }
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
  let invoicePerson = false; // a person the owner authorized for invoice requests (in a group)
  let requesterGrants = []; // what the owner allowed THIS sender (statement, invoice …); the owner and the account itself may everything
  if (!raw.key.fromMe) {
    let info = group ? await groupInfo(chatId) : { lidToPhone: new Map() };
    const who = group ? { sender: raw.key.participant, senderAlt: raw.key.participantAlt } : { sender: chatId, senderAlt: raw.key.remoteJidAlt };
    let staff = staffChecker(config.staffNumbers, lids(info.lidToPhone))(who);
    if (staff === null && group) { info = await groupInfo(chatId, true); staff = staffChecker(config.staffNumbers, lids(info.lidToPhone))(who); }
    // a person the owner authorized for invoices and statements: only those commands are taken, in a private chat (the rest is ignored as before)
    if (!group && text && qboAuth.isAuthorized(who, lids(info.lidToPhone)) && (await authorizedFlow({ chatId, text, canInvoice: qboAuth.has(who, 'invoice', lids(info.lidToPhone)), canStatement: qboAuth.has(who, 'statement', lids(info.lidToPhone)), person: qboAuth.whoIs(who, lids(info.lidToPhone)).number }))) { trace(where, 'authorized', 'QuickBooks request'); return true; }
    // an authorized person (not staff) may ask for a statement by her name in an internal group; nothing else of theirs is taken
    if (group && !staff && text && !audio && !image && qboAuth.isAuthorized(who, lids(info.lidToPhone))) {
      const gctx = (content.extendedTextMessage || {}).contextInfo || {};
      if (await groupStatementTurn({ raw, chatId, text, ctx: gctx, owner: false, authorized: qboAuth.has(who, 'statement', lids(info.lidToPhone)), canInvoice: qboAuth.has(who, 'invoice', lids(info.lidToPhone)), where, role: 'authorized', test: !!group?.test })) return true;
    }
    requesterGrants = grantsOf(who, info.lidToPhone);
    authorizedPerson = !!(group && qboAuth.has(who, 'statement', lids(info.lidToPhone)));
    invoicePerson = !!(group && qboAuth.has(who, 'invoice', lids(info.lidToPhone)));
    if (!staff) { trace(where, 'not-staff', group ? 'left to the customer flow' : 'ignored: private chat from a number that is not staff'); return false; }
    admin = staffChecker(config.adminNumbers, lids(info.lidToPhone))(who) === true;
    ownerPerson = staffChecker(config.ownerNumbers, lids(info.lidToPhone))(who) === true;
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
  const staffLang = config.replyLanguage === 'en' ? 'en' : placeLanguage({ kind: group ? 'company-group' : 'private', owner: ownerPerson, persona, written: detectLang(text, 'en'), sentence: isEnglishSentence(text) });
  const keepLanguage = persona === 'customer' || persona === 'owner'; // a played person keeps its own language, nothing is translated
  const reply = async (body) => {
    const said = staffLang === 'en' ? toEnglish(body) : body;
    const content = { text: isSelf ? `🤖 ${said}` : said };
    if (keepLanguage || staffLang === 'fa') keepLang.add(content); // a Persian answer is not turned into English by the outgoing hook
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
  // The sales manager's (or the owner's) answer to an availability draft, in a private chat: «yes #V1» / «no #V1» (the full code is needed).
  if (!group && text && !audio && !image && (ownerPerson || [chatId, raw.key.remoteJidAlt].some((j) => j && jidDigits(j) === jidDigits(config.salesManager) && jidDigits(config.salesManager)))) {
    const dv = parseInvoiceCommand(text);
    if (dv && (dv.type === 'yes' || dv.type === 'no') && /^V\d+$/.test(dv.id || '')) { for (const part of await decideAvailability(dv.type, dv.id)) await reply(part); return true; }
  }
  // THE OWNER SIMULATES THE OTHER GROUPS in the test group: «[orders] ART NO 303 MUNICH 6.4M», «[delivery] …», «[confirm] …». Read like a post of that group, kept as TEST data only.
  if (group?.test && ownerPerson && text && !audio && !image && (await simulatedPost({ raw, text, where, role, reply }))) return true;
  // A statement asked for in an internal group (the owner or an authorized person): answered in that group.
  if (group && text && !audio && !image && (await groupStatementTurn({ raw, chatId, text, ctx: (content.extendedTextMessage || {}).contextInfo || {}, owner: ownerPerson, authorized: authorizedPerson, canInvoice: invoicePerson, where, role, test: !!group?.test }))) return true;
  // A numbered question just asked waits for its answer: «1», «۱», «یک», «اولی», «شماره یک درست است» or the name itself. Nothing else may take this message.
  const pending = text && !audio && !image ? choiceDesk.get(`pc:${chatId}`) : null;
  if (pending && (!pending.by || (!group && pending.by === personOf(raw)))) {
    const at = parseChoice(text, pending.options);
    if (at >= 0) {
      choiceDesk.clear(`pc:${chatId}`);
      trace(where, role, 'a numbered question was answered');
      if (pending.kind === 'statement_group') {
        for (const o of ownIds()) choiceDesk.clear(`pc:${o}`);
        await prepareGroupStatement({ customer: pending.options[at], period: pending.period, groupId: pending.groupId, subject: pending.subject, kind: pending.target || 'group', requester: pending.requester || null });
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
    const echoed = `${pv.echo}${pv.mode === 'ask' ? `\n${pv.prompt}` : ''}`;
    await sock.sendMessage(chatId, group ? persianText(echoed) : { text: `${isSelf ? '🤖 ' : ''}${echoed}` }, { quoted: raw });
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
    ownIds: own, names: config.botNames, strict: !!group && !group.test, // an internal company group answers only a message that STARTS with her name (owner 2026-11-11); the test group and her own chat keep the old rule
  });
  // Cost control: in the cut, delivery, confirmation, information and invoices groups a photo or a voice note is never read by itself
  // (no download, no vision, no speech); only a message that addresses her by name, or answers her, may be.
  if ((audio || image) && !mayReadMedia({ group, addressed, voiceFromPermitted: !!audio && !image && (ownerPerson || authorizedPerson || invoicePerson) })) { trace(where, role, 'media left alone (cost control): not addressed to the assistant'); return true; }
  // «where is the driver» (owner's chat, any internal staff group, the delivery group, the test group): answered from today's dispatch and delivery posts, never «I cannot see».
  if (text && !audio && !image && addressed && isDriverQuestion(text)) {
    trace(where, role, 'the driver question, answered from the delivery posts');
    await reply(whereText(trackerOf(group?.test).events, { timeZone: config.timezone, aliasOf: (n) => cutAliases.resolve(n), display: await driverNamer() }));
    return true;
  }
  // «delivery report for the whole day» (and, in the delivery group, «for the full day?» after it): the day's DELIVERY report, not the goods-out sheet; a short thanks gets a short word.
  if (text && !audio && !image && addressed && group) {
    const inDelivery = (await trackedRole(chatId)) === 'delivery';
    if (isDeliveryReportAsk(text, inDelivery)) {
      trace(where, role, 'the delivery report of the day, from the delivery posts');
      await reply(deliveryDayText(trackerOf(group?.test).events, { timeZone: config.timezone, aliasOf: (n) => cutAliases.resolve(n), display: await driverNamer() }));
      return true;
    }
    if (inDelivery && isAckText(text)) { await reply('Noted.'); return true; }
  }
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
    if (await styleReplyFlow({ text, by: 'owner', say: (t) => reply(t), choicePending: !!choiceDesk.get(`pc:${chatId}`) })) return true; // «1» / «2» / «No» for a statement preview
    let ic = parseInvoiceCommand(text);
    // a bare yes or no answers the question the assistant asked last in this chat (a photo, a voice note, a follow-up); only without one does it look at open previews
    if (bareAnswerYieldsToPending(ic, !!(voiceDesk.get(`s:${chatId}:${jidDigits(raw.key.participant || raw.key.remoteJid)}`) || followDesk.get(`s:${chatId}:${jidDigits(raw.key.participant || raw.key.remoteJid)}`)))) ic = null;
    if (ic && isOwnerCommand({ fromMe: !!raw.key.fromMe, id: raw.key.id, text, sentIds: sent, forwarded: !!(ctx.isForwarded || ctx.forwardingScore > 0) })) {
      qboNames.finish = async (parts) => { for (const part of parts) await reply(part); }; // the report at the end of a long update
      qboBulk.finish = qboNames.finish;
      const parts = await qboInvoiceCommand(ic, text, { chatId });
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
    const ob = invoiceIntent(text) ? null : parseOnBehalf(text); // a message that opens with «invoice» is never a customer's order and never reaches the stock or the sales manager
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
  // "atossa listen to this one" as a reply to a voice note: the quoted voice note goes the same way a sent one does
  if (!audio && !image && addressed && config.voiceEnabled && ctx.quotedMessage && ctx.stanzaId) {
    const quotedAudio = normalizeMessageContent(ctx.quotedMessage)?.audioMessage;
    if (quotedAudio && (!text || withoutBotNames(text, config.botNames).replace(/[.!؟?،,\s]+/g, ' ').trim().split(/\s+/).length <= 8)) {
      audio = quotedAudio; audioRaw = { key: { remoteJid: chatId, id: ctx.stanzaId, participant: ctx.participant }, message: ctx.quotedMessage };
      trace(where, role, 'voice note: the quoted voice note is taken');
    }
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
    const u = await understandAudio(() => downloadMediaMessage(audioRaw, 'buffer', {}), audio.seconds || 0, staffLang, !!group?.quiet && !explicit);
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
      const echoText = `${pv.echo}${pv.mode === 'ask' ? `\n${pv.prompt}` : ''}`;
      await sock.sendMessage(chatId, group ? persianText(echoText) : { text: `${isSelf ? '🤖 ' : ''}${echoText}` }, { quoted: raw });
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
  let asked = (group && stockAsk(text, config.botNames)) || text; // «Atossa check 409 qty» is the plain stock question
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
  // An invoice request that could not be read never becomes a stock question: no sales-manager report, no «low stock» card.
  if (looksLikeInvoiceRequest(asked)) {
    trace(where, role, 'invoice intent that was not taken by the invoice flow: told how to write it, never sent to the stock flow');
    await reply(ownerPerson ? 'I could not read that invoice request. Write: invoice for <customer> and then one item per line or on the same line, for example 215=97m 220=12m.' : 'Invoice requests need the permission of the owner. Ask him to grant it.');
    return true;
  }
  const answerText = await staffAnswer({
    client, config, text: normalizeDigits(asked), log: (s) => logger.warn(s), quoted: textOf(normalizeMessageContent(ctx.quotedMessage)), handlers: staffHandlersFor(key, lang, !!group && lang === 'fa'), lang, today: todayLine(new Date(), config.timezone), abilities: abilitiesText({ owner: ownerPerson, grants: requesterGrants }),
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
  lang = config.replyLanguage === 'en' ? 'en' : detectLang(withText.map((m) => m.text).join(' '), 'en');
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

// ---------------------------------------------------------------------------------------------------------------- photo reading test
// The photos (and PDFs) posted in the Confirmation and Expenses groups are KEPT (the message reference only, on the server) so that the owner's one-off test can read them later; the bot has no message history.
const photoKeep = new MediaKeep(path.join(config.authDir, 'photo-media'), { replacer: BufferJSON.replacer, reviver: BufferJSON.reviver, max: 600 });
const photoStartFile = path.join(config.authDir, 'photo-media', 'started.txt');
const photoSince = () => { try { return Number(fs.readFileSync(photoStartFile, 'utf8')) || 0; } catch { return 0; } };
function keepPhotoMessage(raw, groupId, info, atMs = Date.now()) {
  const content = normalizeMessageContent(raw.message);
  if (!content) return;
  const subject = String(info.subject || '').toLowerCase();
  const groupKey = config.confirmGroupName && subject.includes(config.confirmGroupName) ? 'confirmation' : isExpensesSubject(subject) ? 'expenses' : '';
  if (!groupKey) return;
  noteSeen(raw, groupId, groupKey); // the oldest message seen here is where a history request starts
  if (atMs < monitorStartMs()) return;
  const text = String(textOf(content) || '');
  const quoted = content.extendedTextMessage?.contextInfo?.stanzaId;
  if (text && quoted) { const e = photoKeep.list_.find((x) => x.id === quoted); if (e && !(e.replies || []).includes(text)) { (e.replies ||= []).push(text.slice(0, 200)); photoKeep.save(); } } // «Awab» as a reply to a photo
  const image = content.imageMessage; const doc = content.documentMessage && /pdf/i.test(content.documentMessage.mimetype || '') ? content.documentMessage : null;
  if (!image && !doc) return;
  if (!photoSince()) { try { fs.mkdirSync(path.dirname(photoStartFile), { recursive: true }); fs.writeFileSync(photoStartFile, String(Date.now())); } catch { /* best effort */ } }
  photoKeep.add({ id: raw.key.id, groupId, groupKey, key: raw.key, message: image ? { imageMessage: image } : { documentMessage: doc }, caption: (image || doc).caption || '', fileName: doc?.fileName || '', mimetype: (image || doc).mimetype || '', at: atMs, sender: raw.pushName || '', replies: [] });
}
let photoTestRunning = false;
/** The one-off test: every kept photo of a group in the last days read by the test model only, one message per photo (with the photo attached) to the owner, then one summary. */
async function readPhotoTest(chatId, groupKey, days) {
  photoTestRunning = true;
  try {
    const entries = photoKeep.list_.filter((e) => e.groupKey === groupKey && e.at >= Math.max(Date.now() - days * 86400000, monitorStartMs())).sort((a, b) => a.at - b.at);
    let read = 0; let unreadable = 0; let skipped = 0; let inTokens = 0; let outTokens = 0; const reasons = [];
    for (const [i, e] of entries.entries()) {
      let buf;
      try { buf = fs.existsSync(photoFile(e.id)) ? fs.readFileSync(photoFile(e.id)) : await downloadMedia({ key: e.key, message: e.message }); } catch (err) { skipped += 1; reasons.push(String(err.message || 'download failed').slice(0, 60)); continue; }
      const isPdf = !!e.message.documentMessage;
      const block = isPdf ? documentBlock({ base64: buf.toString('base64'), mimeType: 'application/pdf', fileName: e.fileName }) : { type: 'image', source: { type: 'base64', media_type: String(e.mimetype || 'image/jpeg').split(';')[0], data: buf.toString('base64') } };
      let reading = null; let usage = null;
      try {
        const res = await client.beta.messages.create({ model: TEST_MODEL, max_tokens: 1024, system: PHOTO_RULES, thinking: { type: 'disabled' }, output_config: { effort: 'low' }, messages: [{ role: 'user', content: [block, { type: 'text', text: e.caption ? `Message text: ${e.caption}` : 'No text.' }] }] }); // this model only: no fallback behind it
        usage = { input: res.usage?.input_tokens || 0, output: res.usage?.output_tokens || 0 }; inTokens += usage.input; outTokens += usage.output;
        reading = parseReading(res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
      } catch (err) { logger.warn(`photo test: the read failed: ${err.message}`); }
      if (reading) read += 1; else unreadable += 1;
      const text = photoMessage({ n: i + 1, total: entries.length, entry: e, reading, usage, timeZone: config.timezone });
      await sock.sendMessage(chatId, isPdf ? { document: buf, mimetype: 'application/pdf', fileName: e.fileName || 'receipt.pdf', caption: text } : { image: buf, caption: text });
      await new Promise((r) => setTimeout(r, 1500)); // paced: one message every second and a half
    }
    await sock.sendMessage(chatId, { text: summaryText({ groupKey, days, kept: entries.length, read, unreadable, skipped, reasons, inTokens, outTokens, since: photoSince(), timeZone: config.timezone }) });
  } finally { photoTestRunning = false; }
}

// ---------------------------------------------------------------------------------------------------------------- history backfill
// (Nothing here starts by itself: the owner's «backfill» gives an estimate first, and his yes goes on.)
// Messages of the Confirmation and Expenses groups from the monitor day (MONITOR_FROM, default 01/11/2026) onward that were posted before the bot kept them: WhatsApp's on-demand history is
// asked for, starting at the oldest message the bot has seen in each group, again and again until the monitor day is reached. The answer arrives as «messaging-history.set» events; the
// messages are then read exactly like live ones (photos and PDFs kept and downloaded, the payment parser run with the message's own time), silently: nothing is posted to any group, nothing
// is recorded in QuickBooks. It needs the owner's phone online, and WhatsApp may refuse; the counts say what really came back.
const historyDir = path.join(config.authDir, 'history');
const readHistoryJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8'), BufferJSON.reviver); } catch { return fallback; } };
const writeHistoryJson = (file, value) => { try { fs.mkdirSync(historyDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, BufferJSON.replacer), { mode: 0o600 }); } catch { /* best effort */ } };
const anchors = readHistoryJson(path.join(historyDir, 'anchors.json'), {}); // group -> { key, ts (seconds), groupKey }: the oldest message seen there
const historyDone = readHistoryJson(path.join(historyDir, 'done.json'), {}); // monitor day -> when the backfill finished
const messageSeconds = (m) => { const t = m?.messageTimestamp; return Number(typeof t === 'object' && t ? (t.low ?? t.toNumber?.()) : t) || 0; };
function noteSeen(raw, groupId, groupKey) { // the anchor of a later history request
  const ts = messageSeconds(raw) || Math.floor(Date.now() / 1000);
  if (!anchors[groupId] || ts < anchors[groupId].ts) { anchors[groupId] = { key: raw.key, ts, groupKey }; writeHistoryJson(path.join(historyDir, 'anchors.json'), anchors); }
}
const photoFile = (id) => path.join(config.authDir, 'photo-media', 'files', `${String(id).replace(/[^\w-]+/g, '_')}.bin`);
let historyInbox = []; let historyWaiter = null; let backfillRunning = false;
function onHistorySet({ messages = [] }) { // the answer to an on-demand request (or WhatsApp's own sync): only the groups we asked about, from the monitor day
  const mine = messages.filter((m) => m?.key?.remoteJid && anchors[m.key.remoteJid] && messageSeconds(m) * 1000 >= monitorStartMs() - 7 * 86400000);
  if (!mine.length) return;
  historyInbox.push(...mine);
  if (historyWaiter) historyWaiter();
}
const napMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function requestHistory(groupId, cur) {
  historyInbox = [];
  const arrived = new Promise((resolve) => { historyWaiter = resolve; setTimeout(resolve, 45000); });
  await sock.fetchMessageHistory(50, cur.key, cur.ts * 1000);
  await arrived; historyWaiter = null;
  await napMs(3000); // the rest of the answer
  return historyInbox.filter((m) => m.key.remoteJid === groupId);
}

/** One message from the history, read like a live one but silently (its own time, nothing announced). */
async function processHistoryMessage(m, groupId, info, groupKey, counts) {
  const atMs = messageSeconds(m) * 1000;
  const content = normalizeMessageContent(m.message);
  if (!content) return;
  keepPhotoMessage(m, groupId, info, atMs);
  const media = content.imageMessage || (content.documentMessage && /pdf/i.test(content.documentMessage.mimetype || '') ? content.documentMessage : null);
  if (media && !fs.existsSync(photoFile(m.key.id))) {
    try { const buf = await downloadMedia(m); fs.mkdirSync(path.dirname(photoFile(m.key.id)), { recursive: true }); fs.writeFileSync(photoFile(m.key.id), buf, { mode: 0o600 }); counts.downloaded += 1; } catch (e) { counts.unavailable += 1; counts.reasons.push(String(e.message || 'download failed').slice(0, 50)); }
  }
  if (groupKey === 'confirmation') await replayCtx.run({ at: atMs, quiet: true }, () => trackGroup(m, groupId, 'payment')).catch((e) => logger.warn(`history: a message could not be tracked: ${e.message}`));
}

// The backfill runs ONLY on the owner's word and in two steps. Step 1 («backfill 01/11») fetches the history's message list (no download, no model, nothing kept), counts the photos and PDFs and
// answers with an ESTIMATE of the reading cost; step 2 is his «yes #B1»: only then are the media downloaded and read. His «no» drops it. Nothing starts by itself at the start of the bot.
let pendingBackfill = null; // { id, at, fromDay, groups: [{ groupId, info, groupKey, messages }], counts }
let backfillCount = 0;
const PHOTO_TOKENS = { input: 1700, output: 100 }; // a photo read by the cheap model with thinking off: about 60-100 tokens out
const isMediaMessage = (m) => { const c = normalizeMessageContent(m.message); return !!(c?.imageMessage || (c?.documentMessage && /pdf/i.test(c.documentMessage.mimetype || ''))); };

/** Step 1: the history of every group with an anchor, backwards to [fromDay]. Only the message list is fetched. */
async function collectHistory(fromDay) {
  const counts = { groups: 0, rounds: 0, fetched: 0, downloaded: 0, unavailable: 0, reasons: [], silent: [] };
  const floor = Date.parse(`${fromDay < config.monitorFrom ? config.monitorFrom : fromDay}T00:00:00+04:00`);
  const groups = [];
  for (const groupId of Object.keys(anchors)) {
    const info = await groupInfo(groupId); counts.groups += 1;
    const all = new Map();
    let cur = { key: anchors[groupId].key, ts: anchors[groupId].ts };
    let answered = false;
    for (let round = 0; round < 80 && cur.ts * 1000 > floor; round++) {
      counts.rounds += 1;
      let got = [];
      try { got = await requestHistory(groupId, cur); } catch (e) { logger.warn(`history: the request failed: ${e.message}`); break; }
      const older = got.filter((m) => messageSeconds(m) < cur.ts).sort((a, b) => messageSeconds(a) - messageSeconds(b));
      if (!older.length) break; // nothing older came back: the phone is offline, or WhatsApp has nothing (more) for this group
      answered = true; counts.fetched += older.length;
      for (const m of older) if (messageSeconds(m) * 1000 >= floor) all.set(m.key.id, m);
      cur = { key: older[0].key, ts: messageSeconds(older[0]) };
      await napMs(1500);
    }
    if (!answered) counts.silent.push(info.subject);
    const groupKey = anchors[groupId].groupKey || (config.confirmGroupName && String(info.subject).toLowerCase().includes(config.confirmGroupName) ? 'confirmation' : 'expenses');
    groups.push({ groupId, info, groupKey, messages: [...all.values()].sort((a, b) => messageSeconds(a) - messageSeconds(b)), oldest: cur });
  }
  return { groups, counts, floor };
}

/** The estimate the owner reads before he answers: how many photos and PDFs, about what the reading costs. */
function backfillEstimate(p) {
  const media = p.groups.flatMap((g) => g.messages.filter((m) => isMediaMessage(m) && !fs.existsSync(photoFile(m.key.id))));
  const photos = media.filter((m) => normalizeMessageContent(m.message)?.imageMessage).length;
  const pdfs = media.length - photos;
  const usd = costOf(media.length * PHOTO_TOKENS.input, media.length * PHOTO_TOKENS.output); // the cheap model at the price table of the cost meter
  return { photos, pdfs, usd, tokensIn: media.length * PHOTO_TOKENS.input, tokensOut: media.length * PHOTO_TOKENS.output };
}

async function backfillStart(fromDay = config.monitorFrom) {
  if (backfillRunning) return 'A history backfill is already running.';
  backfillRunning = true;
  try {
    const got = await collectHistory(fromDay);
    if (!got.counts.fetched) return [!got.counts.groups ? 'No group has been seen yet: the first message in a group sets where the history request starts. Try again after one message there.' : `⚠ No history came back for: ${got.counts.silent.join(', ')}. The owner's phone must be online, and WhatsApp may refuse an on-demand history request. Nothing was downloaded or read.`, 'Nothing was posted to any group and nothing was recorded in QuickBooks.'].join('\n');
    backfillCount += 1;
    pendingBackfill = { id: `B${backfillCount}`, at: Date.now(), fromDay, groups: got.groups, counts: got.counts };
    const est = backfillEstimate(pendingBackfill);
    return [
      `*History backfill* #${pendingBackfill.id} — from ${(got.floor ? new Date(got.floor + 4 * 3600000).toISOString().slice(0, 10) : fromDay).split('-').reverse().join('/')}`,
      `Messages found: ${got.counts.fetched} in ${got.counts.groups} group${got.counts.groups === 1 ? '' : 's'} (${got.counts.rounds} request${got.counts.rounds === 1 ? '' : 's'}).`,
      `Photos: ${est.photos}. PDFs: ${est.pdfs}. They would be downloaded and read with the cheap model, and the payment messages read in time order, silently.`,
      `Estimated cost: about $${est.usd.toFixed(2)} (≈ ${(est.usd * 3.6725).toFixed(2)} AED) — ${est.tokensIn.toLocaleString('en-US')} tokens in / ${est.tokensOut.toLocaleString('en-US')} out; a PDF with a text layer costs less.`,
      ...(got.counts.silent.length ? [`⚠ No history came back for: ${got.counts.silent.join(', ')}.`] : []),
      `Nothing was downloaded, read or kept yet. Reply yes #${pendingBackfill.id} to go on, or no #${pendingBackfill.id}.`,
    ].join('\n');
  } finally { backfillRunning = false; }
}

/** Step 2: the owner's yes downloads and reads (in the background; the report follows), his no drops it. */
async function decideBackfill(verb, id) {
  const p = pendingBackfill;
  if (!p || p.id !== String(id).toUpperCase() || Date.now() - p.at > 60 * 60 * 1000) return [bi('That backfill was not found or its hour is over; ask again with «backfill».', 'این پر کردن تاریخچه پیدا نشد یا مهلتش (یک ساعت) تمام شده؛ دوباره «backfill» بنویسید.')];
  pendingBackfill = null;
  if (verb !== 'yes') return ['Cancelled. Nothing was downloaded, read or kept.'];
  void runBackfill(p).then((text) => sock.sendMessage(ownIds()[0], { text: `🤖 ${text}` })).catch((e) => logger.warn(`history backfill failed: ${e.message}`));
  return [`Reading ${backfillEstimate(p).photos + backfillEstimate(p).pdfs} photos and PDFs from the history now; the report follows. Nothing is posted to any group.`];
}

async function runBackfill(p) {
  backfillRunning = true;
  const counts = { ...p.counts, downloaded: 0, unavailable: 0, reasons: [] };
  const before = tracker.events.filter((e) => e.type === 'payment').length;
  try {
    for (const g of p.groups) {
      anchors[g.groupId] = { ...anchors[g.groupId], key: g.oldest.key, ts: g.oldest.ts }; writeHistoryJson(path.join(historyDir, 'anchors.json'), anchors); // the next request continues from here
      for (const m of g.messages) await processHistoryMessage(m, g.groupId, g.info, g.groupKey, counts); // in time order
    }
    historyDone[config.monitorFrom] = Date.now(); writeHistoryJson(path.join(historyDir, 'done.json'), historyDone);
  } finally { backfillRunning = false; }
  const added = tracker.events.filter((e) => e.type === 'payment').length - before;
  logger.info(`history: ${counts.groups} group(s), ${counts.rounds} request(s), ${counts.fetched} messages fetched, ${counts.downloaded} photos/PDFs downloaded, ${counts.unavailable} expired or unavailable, ${added} payment entries added`);
  return [
    `History backfill #${p.id} done: ${counts.groups} group${counts.groups === 1 ? '' : 's'}, ${counts.rounds} request${counts.rounds === 1 ? '' : 's'}.`,
    `Messages fetched: ${counts.fetched}. Photos/PDFs downloaded: ${counts.downloaded}. Expired or unavailable: ${counts.unavailable}${counts.unavailable ? ` (${[...new Set(counts.reasons)].join('; ')})` : ''}.`,
    `Payment entries added: ${added}.`,
    'Nothing was posted to any group and nothing was recorded in QuickBooks.',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------- company expenses
// A receipt photo with the amount as its caption in the EXPENSES group (see expenses.js). Kept on the server; read only towards QuickBooks (it is only compared with what the office recorded).
const expenseStore = new ExpenseStore(path.join(config.authDir, 'expenses'));
expenseStore.markTestOnce('test-group-before-separation-2026-11-11', ['E1']); // E1 was made in the TEST group before test data was kept apart: never in a real report
if (expenseStore.d.group?.subject && !config.expensesGroupNames.includes(String(expenseStore.d.group.subject).toLowerCase())) config.expensesGroupNames.push(String(expenseStore.d.group.subject).toLowerCase());
const isExpensesSubject = (subject) => config.expensesGroupNames.some((w) => String(subject || '').toLowerCase().includes(w));
const expensesGroupJid = async () => expenseStore.d.group?.id || (config.expensesGroupNames[0] ? findGroupJid(config.expensesGroupNames[0]) : null);

/** The owner says «Atossa, this is the expenses group» inside the group: it is remembered (on the server) and she may write there. true = handled. */
async function maybeSetExpensesGroup(raw, groupId, info) {
  const text = textOf(normalizeMessageContent(raw.message)) || '';
  if (!text || !/(?:atossa|atosa|atousa|آتوسا|اتوسا)/i.test(text) || !/(?:this is|here is|اینجا|این)[\s\S]{0,40}(?:expenses?\s+group|گروه\s+هزینه)/i.test(text)) return false;
  const who = { sender: raw.key.participant, senderAlt: raw.key.participantAlt };
  const owner = !!raw.key.fromMe || staffChecker(config.ownerNumbers, lids(info.lidToPhone))(who) === true;
  if (!owner) return false;
  const before = String(expenseStore.d.group?.subject || '').toLowerCase();
  if (before && before !== String(info.subject).toLowerCase()) { const at = config.expensesGroupNames.indexOf(before); if (at >= 0 && !(process.env.EXPENSES_GROUP_NAME || '').toLowerCase().includes(before)) config.expensesGroupNames.splice(at, 1); } // the old group is no longer the expenses group
  expenseStore.setGroup({ id: groupId, subject: info.subject });
  const word = String(info.subject).toLowerCase();
  if (!config.expensesGroupNames.includes(word)) config.expensesGroupNames.push(word);
  logger.info(`expenses: the group "${info.subject}" was set by the owner`);
  await sock.sendMessage(groupId, { text: `✅ This is now the expenses group ("${info.subject}"). Post a receipt photo with the amount as the caption, for example: 85.5 fuel` });
  return true;
}

/** A receipt photo read by the cheapest vision model first: { total, currency, vendor, date, category } or null when it is not readable. */
async function readReceiptPhoto(buf, mimeType) {
  const call = (model) => client.beta.messages.create({
    model, max_tokens: 1024, system: RECEIPT_RULES, thinking: { type: 'disabled' }, output_config: { effort: 'low' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mimeType, data: buf.toString('base64') } }, { type: 'text', text: 'Read this receipt.' }] }],
  });
  const parse = (res) => { const t = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'); return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); };
  const r = await visionRead({ config, call, parse, check: (x) => (!x.relevant || Number(x.total) > 0 ? { ok: true } : { ok: false, reason: 'missing' }) });
  return r?.value?.relevant ? r.value : null;
}

/** A message in the expenses group: a receipt photo (with the amount as caption), the answers (1 / 2 / card / cash / a type word / an amount), or a caption-only expense. true = it was an expense message. */
async function expensesTurn(raw, groupId, info) {
  const testData = isTestSubject(info?.subject); // expenses made in the TEST group are test data: kept, never counted in a real report
  if (sent.has(raw.key.id)) return true; // her own message
  const content = normalizeMessageContent(raw.message);
  const image = imageOf(content);
  const text = String(textOf(content) || image?.caption || '').trim();
  const by = personOf(raw); const byName = raw.pushName || '';
  const say = (t) => sock.sendMessage(groupId, { text: t }, { quoted: raw });
  if (image) {
    let reading = null;
    if (mayReadReceipts(config)) {
      try { reading = await readReceiptPhoto(await downloadMediaMessage(raw, 'buffer', {}), String(image.mimetype || 'image/jpeg').split(';')[0]); } catch (e) { logger.warn(`expenses: the receipt could not be read: ${e.message}`); }
    } else logger.info('expenses: the receipt photo was not read (RECEIPT_VISION is off); the caption amount is used');
    const entry = expenseStore.add(makeEntry({ caption: text, reading, hasReceipt: !!reading, hasPhoto: true, by, byName, ref: raw.key.id, timeZone: config.timezone, test: testData }));
    await say(entryText(entry));
    return true;
  }
  if (!text) return false;
  const done = handleReply(expenseStore, by, parseExpenseReply(text), config.timezone);
  if (done) { await say(done.text); return true; }
  const asked = expenseAsk(text); // «Atossa check all expenses in this group» / only her name: the list, in the group
  if (asked) {
    const today = todayDubai();
    const r = asked === 'all' ? { from: config.monitorFrom, to: today, label: dayLabel(config.monitorFrom) + ' – ' + dayLabel(today) } : rangeOf(asked, today);
    await say(expensesText(expenseStore.done(r), r.label));
    return true;
  }
  const cap = parseExpenseCaption(text);
  if (cap.amount && /^[\s\d.,]+(?:aed|dhs?|درهم)?\s*[\p{L}]{0,12}\s*$/iu.test(normalizeDigits(text))) { // only an amount (and a type word): an expense with no receipt
    await say(entryText(expenseStore.add(makeEntry({ caption: text, reading: null, hasReceipt: false, by, byName, ref: raw.key.id, timeZone: config.timezone, test: testData }))));
    return true;
  }
  return false;
}

const dayLabel = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const dayPlus = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** The QuickBooks rows of an entity in a period (read only; a failed look-up gives none). */
const qbRows = async (entity, from, to) => qbo.query(`select * from ${entity} where TxnDate >= '${from}' and TxnDate <= '${to}'`).then((rows) => rows.map((r) => ({ ...r, _type: entity }))).catch((e) => { logger.warn(`expenses: the QuickBooks ${entity} look-up failed: ${e.message}`); return []; });
const todayDubai = () => localParts(Date.now(), config.timezone).day;
async function invoiceLookupFor(events) {
  const named = [...new Set(events.filter((e) => e.type === 'payment').flatMap((e) => e.invoices || []))].slice(0, 20);
  const lookup = new Map();
  if (named.length) for (const row of await qbo.query(`select * from Invoice where DocNumber in (${named.map((n) => `'${qboEscape(n)}'`).join(',')})`).catch(() => [])) lookup.set(String(row.DocNumber).toLowerCase(), row);
  return lookup;
}
const expensesReportText = (kind) => { const r = rangeOf(kind, todayDubai()); return expensesText(expenseStore.done(r), r.label); };
/** The approved aliases for a posted name: the cutting-group aliases, then the QuickBooks names the owner told for the sheet (sheet names), before any fuzzy match. */
const nameAlias = (n) => cutAliases.resolve(n) || overrideFor(sheetNameStore, n);

/** Why a posted name became a customer: every mapping that touches it, so a wrong one can be seen (and shown to the owner) before it is changed. */
function nameExplain(name) {
  const row = rowOfName(name); const stored = aliases.resolve(name, knownCustomers()); const names = (qboDesk.cache?.customers || []).map((r) => r.DisplayName).filter(Boolean);
  return [`*"${name}"*`, `customer-group row: ${row ? row.customer + ' (groups: ' + rowGroups(row).map((g) => g.subject).join(' + ') + ')' : 'none'}`, `alias map: ${stored && stored !== name ? stored : 'none'}`,
    `cut alias: ${cutAliases.resolve(name) || 'none'}`, `sheet-name answer: ${overrideFor(sheetNameStore, name) || 'none'}`, `QuickBooks match: ${qboNameFor(name, names, nameAlias) || 'none'}`, `recorded as: ${canon(name) || name}`].join('\n');
}

/** A name as QuickBooks writes it (an old alias may still give a longer one): the exact QuickBooks name when the post's name fits exactly one customer there, else the name as posted. */
function namerOver(names) {
  const memo = new Map(); // each distinct name is matched once
  return (n) => { if (!memo.has(n)) memo.set(n, qboNameFor(n, names, nameAlias) || n); return memo.get(n); };
}
const driverNamerNow = () => namerOver((qboDesk.cache?.customers || []).map((r) => r.DisplayName).filter(Boolean)); // the list already read (the evening report is not a place to call QuickBooks)
async function driverNamer() {
  try { if (qbo.connected && !qbo.paused) await qboDesk.customers(); } catch { /* the posted names are shown */ }
  return driverNamerNow();
}

/** Is this name one of our customers (a QuickBooks name it fits)? Used to tell the customer of a cheque from its drawer. */
const isOurCustomer = (n) => !!n && (qboDesk.cache?.customers || []).some((r) => r.DisplayName && sameStop(n, r.DisplayName, nameAlias));

/** The one short line in the delivery group when the last stop of a run is delivered (never per stop, never from history, never to a customer). */
async function announceRunDone(events, event, say) {
  if (replayCtx.getStore()?.quiet || event.status !== 'delivered' || (!config.deliveryRunLine && !event.simulated)) return; // silent by default; the test group's simulation still shows it
  const line = runDoneLine(events, event, { timeZone: config.timezone, aliasOf: (n) => cutAliases.resolve(n), display: await driverNamer() });
  if (line) await say(line);
}

/** For every received entry that QuickBooks does not have: one log line saying what was searched and what came nearest. */
function logNotFound(items, records) {
  const got = matchReceipts(items.filter((i) => !i.foreign), records, (n) => cutAliases.resolve(n));
  for (const it of items) if (!it.foreign && it.paid !== true && !got.has(it)) logger.info(`received: not found in QuickBooks — ${whyNotFound(it, records, (n) => cutAliases.resolve(n))}`);
}

/** «check received <customer>»: for the received entries of that customer (the last two weeks from the monitor day) what QuickBooks holds around them. Read only. */
async function receivedCheck(name) {
  const to = todayDubai(); const from = clampRange({ from: dayPlus(to, -14), to }).from;
  const records = [...await qbRows('Payment', dayPlus(from, -5), dayPlus(to, 5)), ...await qbRows('SalesReceipt', dayPlus(from, -5), dayPlus(to, 5)), ...await qbRows('Deposit', dayPlus(from, -5), dayPlus(to, 5))];
  const events = sharedPaymentList({ events: tracker.events, payments: records, aliasOf: (n) => cutAliases.resolve(n), timeZone: config.timezone, dups: paymentDups, since: monitorStartMs(), isKnown: isOurCustomer });
  const items = receivedItems(events, { from, to }, { timeZone: config.timezone, lookup: await invoiceLookupFor(events) }).filter((i) => sameBrandName(name, i.customer));
  if (!items.length) return `No received entry of "${name}" was found from ${from.split('-').reverse().join('/')} on.`;
  const got = matchReceipts(items, records, (n) => cutAliases.resolve(n));
  const lines = items.map((it) => got.has(it) ? `✔ ${it.customer || 'UNKNOWN'} — ${it.shown} (${it.day.split('-').reverse().join('/')}): found ${[got.get(it)].map((r) => `${r._type || 'record'}${r._part ? ' line' : ''} ${String(r.TxnDate).split('-').reverse().join('/')} ${Number(r.TotalAmt).toFixed(2)}${r.CustomerRef?.name ? ` ${r.CustomerRef.name}` : ''}`)[0]}` : `⚠ ${whyNotFound(it, records, (n) => cutAliases.resolve(n))}`);
  return [`*Received check — ${name}*`, withSeparators(lines)].join('\n');
}
const sameBrandName = (a, b) => !a || sameBrand(a, b || '');

// ---------------------------------------------------------------------------------------------------------------- sheet customer names
// The owner's explicit exception (2026-11-10): the customer names of the stock sheet are made EXACTLY the QuickBooks names. Preview (read only), then «yes #H1»: a full backup copy first, then only the name cells, logged for the undo.
const sheetNameStore = new SheetNameStore(path.join(config.authDir, 'qbo'));
const payChecks = new PayChecks(path.join(config.authDir, 'qbo')); // «Needs your OK»: #G1 …
let pendingSheetNames = null; // { id, at, plan, cells }
let sheetNamesRunning = false;

async function sheetNamesPreview() {
  let read;
  try { read = await sheetCall(config, { mode: 'read' }); } catch (e) { return [sheetProblem(e)]; }
  const qboNames = [...new Set((await qboDesk.customers()).map((r) => r.DisplayName).filter(Boolean))];
  const plan = planSheetNames({ sheetNames: read.names || [], qboNames, aliasOf: (n) => cutAliases.resolve(n), overrides: sheetNameStore.d.overrides, leave: sheetNameStore.d.leave || {} });
  const cells = cellsOf(plan);
  const id = sheetNameStore.nextId();
  pendingSheetNames = cells.length ? { id, at: Date.now(), plan, cells } : null;
  const tabs = ['Customers', 'Items', 'Movements'].map((t) => `${t} ${new Set((read.names || []).filter((x) => x.tab === t).map((x) => x.name)).size} names`);
  for (const u of plan.unclear) logger.info(`sheet names: unclear "${u.name}" (${u.rows} rows): ${u.candidates.length ? u.candidates.join(' | ') : 'no QuickBooks customer fits'}`);
  return [sheetPreviewText(plan, id, { namesIn: tabs })];
}

const LEAVE_WORDS = /^(?:none|cancel(?:led)?|wrong|leave|skip|ignore|هیچ|رها|لغو)\b/iu;
/** One or several corrections «OLD → NEW» (NEW = none / cancel / wrong / leave keeps that sheet name as it is): each noted or refused by itself, then ONE fresh preview. */
async function sheetNameSetMany(pairs) {
  const names = [...new Set((await qboDesk.customers()).map((r) => r.DisplayName).filter(Boolean))];
  const said = pairs.map((p) => {
    if (p.leave || LEAVE_WORDS.test(p.to)) { sheetNameStore.leaveAlone(p.from); return 'Left as is: ' + p.from; }
    const found = findQboName(names, p.to); // case and runs of spaces ignored; the EXACT QuickBooks name is kept
    if (!found) return 'Not found: "' + p.to + '" is not a QuickBooks customer (' + p.from + ' not changed)';
    sheetNameStore.tell(p.from, found);
    return 'Noted: ' + p.from + ' → ' + found;
  });
  return [said.join('\n') + '\nNothing is changed in the sheet before your yes.', ...await sheetNamesPreview()];
}

async function sheetNameSet(from, to) { return sheetNameSetMany([{ from, to, leave: false }]); }

/** The owner's yes or no on a «Needs your OK» pairing: remembered on the payment entry, nothing is recorded in QuickBooks. */
function decidePayCheck(verb, id) {
  const x = payChecks.get(id);
  if (!x || x.status !== 'open') return [`#${id} is not waiting any more.`];
  if (x.action === 'drawer') { // a cheque photo and the cheque it may belong to: yes = that cheque's drawer, the photo is no row of its own; no = this pairing is not asked again
    const photo = tracker.events.find((e) => e.ref === x.ref);
    if (verb === 'yes') { tracker.update(x.ref, { drawerInto: x.target }); payChecks.close(id, 'accepted'); return [`Accepted #${id}: the photo is the drawer of that cheque. Nothing was recorded in QuickBooks.`]; }
    tracker.update(x.ref, { drawerRefused: [...(photo?.drawerRefused || []), x.target] }); payChecks.close(id, 'refused'); return [`Refused #${id}: that pairing is dropped. Nothing was recorded in QuickBooks.`];
  }
  if (x.action === 'swap') { // the posted amount and a QuickBooks payment with the same digits: yes (1) = the same payment, no (2) = a different one; logged, nothing is written to QuickBooks
    if (verb === 'yes') { tracker.update(x.ref, { acceptedMatch: { text: 'QuickBooks ' + x.text + ' (posted ' + Number(x.posted).toFixed(2) + ')', at: Date.now() } }); payChecks.close(id, 'accepted'); logger.info('payment check ' + id + ' answered 1: same payment'); return ['Matched #' + id + ': the posted ' + Number(x.posted).toFixed(2) + ' is the QuickBooks ' + x.text + '. Nothing was written to QuickBooks.']; }
    tracker.update(x.ref, { rejectedMatch: { text: x.text, at: Date.now() } }); payChecks.close(id, 'refused'); logger.info('payment check ' + id + ' answered 2: a different payment');
    return ['Kept #' + id + ': ' + Number(x.posted).toFixed(2) + ' stays not recorded in QuickBooks yet. Nothing was written.'];
  }
  if (x.action === 'clear') { // a bank clearing and a cheque: yes = that cheque is cleared on the day of the message; no = it stays open and the message is dropped
    if (verb === 'yes') { tracker.update(x.ref, { cleared: true, clearedAt: x.clearedAt || Date.now(), clearingMismatch: null, pendingClearing: null }); payChecks.close(id, 'accepted'); return [`Cleared #${id}: that cheque is marked cleared. Nothing was recorded in QuickBooks.`]; }
    tracker.update(x.ref, { clearingMismatch: null, pendingClearing: null }); payChecks.close(id, 'refused'); return [`Refused #${id}: that cheque stays open. Nothing was recorded in QuickBooks.`];
  }
  if (verb === 'yes') { tracker.update(x.ref, { acceptedMatch: { text: x.text, at: Date.now() } }); payChecks.close(id, 'accepted'); return [`Accepted #${id}: that payment is matched to ${x.text}. Nothing was recorded in QuickBooks.`]; }
  tracker.update(x.ref, { rejectedMatch: { text: x.text, at: Date.now() } }); payChecks.close(id, 'refused');
  return [`Refused #${id}: that pairing is dropped and will not be asked again. Nothing was recorded in QuickBooks.`];
}

async function decideSheetNames(verb, id) {
  const p = pendingSheetNames;
  if (!p || p.id !== id) return [`#${id} is not waiting any more. Say "sheet names" for a fresh preview.`];
  if (verb !== 'yes') { pendingSheetNames = null; return ['Cancelled. The sheet was not touched.']; }
  if (Date.now() - p.at > 60 * 60 * 1000) { pendingSheetNames = null; return ['This preview is more than an hour old. Say "sheet names" for a fresh one. Nothing was changed.']; }
  if (sheetNamesRunning) return ['A rename is already running.'];
  sheetNamesRunning = true; pendingSheetNames = null;
  try {
    let backup;
    try { backup = await sheetCall(config, { mode: 'backup', name: backupName() }); } catch (e) { return [`The backup copy of the sheet failed, so NOTHING was changed. ${sheetProblem(e)}`]; }
    sheetNameStore.openRun(id, Date.now(), backup.url || backup.name);
    logger.info(`sheet names ${id}: backup "${backup.name}" made; ${p.cells.length} cells to change`);
    let result;
    try { result = await applyCells(config, p.cells, { onApplied: (done) => { sheetNameStore.logApplied(id, done); for (const c of done) logger.info(`sheet names ${id}: ${c.tab} row ${c.row}: "${c.old}" -> "${c.new}"`); } }); } catch (e) {
      const run = sheetNameStore.run(id);
      return [`Stopped: ${sheetProblem(e)}
Backup copy: ${backup.name} (${backup.folder || 'Drive'}) ${backup.url || ''}
Changed so far: ${run.applied.length} cells (they can be undone: undo names #${id}).`];
    }
    return [[`*Sheet names — #${id} done*`, `Backup copy first: "${backup.name}" in the Drive folder ${backup.folder || ''} ${backup.url || ''}`.trim(), `Changed: ${result.applied} name cells (only those; nothing else in the sheet).`,
      ...(result.skipped.length ? [`Left alone: ${result.skipped.length} cells whose value had changed meanwhile.`] : []), `Undo with: undo names #${id}`].join('\n')];
  } finally { sheetNamesRunning = false; }
}

async function sheetNamesUndo(id) {
  const run = sheetNameStore.run(id);
  if (!run) return [`No sheet-names change #${id} is logged.`];
  if (run.undone) return [`#${id} was already undone.`];
  if (sheetNamesRunning) return ['A rename is already running.'];
  sheetNamesRunning = true;
  try {
    const back = run.applied.map((c) => ({ tab: c.tab, row: c.row, old: c.new, new: c.old }));
    if (!back.length) return [`#${id} changed no cell; nothing to undo.`];
    const done = [];
    let result;
    try { result = await applyCells(config, back, { onApplied: (d) => done.push(...d) }); } catch (e) { return [`Undo stopped: ${sheetProblem(e)}`]; }
    run.undone = done.length === back.length; sheetNameStore.save();
    logger.info(`sheet names undo ${id}: ${result.applied} cells restored, ${result.skipped.length} left alone`);
    const left = result.skipped.length ? ' ' + result.skipped.length + ' were left alone because they changed meanwhile.' : '';
    return [`Undone #${id}: ${result.applied} name cells restored to their old names.${left}`];
  } finally { sheetNamesRunning = false; }
}

async function receivedReportText(kind) {
  const r = clampRange(rangeOf(kind, todayDubai()));
  const records = [...await qbRows('Payment', dayPlus(r.from, -3), dayPlus(r.to, 3)), ...await qbRows('SalesReceipt', dayPlus(r.from, -3), dayPlus(r.to, 3)), ...await qbRows('Deposit', dayPlus(r.from, -3), dayPlus(r.to, 3))];
  const events = sharedPaymentList({ events: tracker.events, payments: records, aliasOf: (n) => cutAliases.resolve(n), timeZone: config.timezone, dups: paymentDups, since: monitorStartMs(), isKnown: isOurCustomer }); // the same list as «payments»: names, repeats, cheques
  const items = receivedItems(events, r, { timeZone: config.timezone, lookup: await invoiceLookupFor(events) });
  logNotFound(items, records);
  const openInvoices = kind === 'today' ? await qbo.query("select * from Invoice where Balance > '0'").catch(() => []) : [];
  const linkedIds = [...new Set(records.filter((x) => x._type === 'Payment').flatMap((x) => (x.Line || []).flatMap((l) => (l.LinkedTxn || []).filter((t) => t.TxnType === 'Invoice').map((t) => String(t.TxnId)))))].filter((id) => /^[0-9]+$/.test(id) && !openInvoices.some((i) => String(i.Id) === id)).slice(0, 60);
  const linkedInvoices = linkedIds.length ? await qbo.query("select * from Invoice where Id in ('" + linkedIds.join("','") + "')").catch(() => []) : []; // the number of every invoice a payment of the day is linked to (fully paid ones too)
  const text = receivedText(items, { title: r.label, records, aliasOf: (n) => cutAliases.resolve(n), openInvoices, linkedInvoices, checks: kind === 'today' ? payChecks : null });
  return text; // the «payments to match» list is gone: its information is inside each line of the report
}
async function weeklyCheckReport() {
  const r = clampRange(rangeOf('week', todayDubai()));
  const purchases = [...await qbRows('Purchase', dayPlus(r.from, -3), dayPlus(r.to, 3)), ...await qbRows('Bill', dayPlus(r.from, -3), dayPlus(r.to, 3))];
  const payments = [...await qbRows('Payment', dayPlus(r.from, -3), dayPlus(r.to, 3)), ...await qbRows('SalesReceipt', dayPlus(r.from, -3), dayPlus(r.to, 3)), ...await qbRows('Deposit', dayPlus(r.from, -3), dayPlus(r.to, 3))];
  const events = sharedPaymentList({ events: tracker.events, payments, aliasOf: (n) => cutAliases.resolve(n), timeZone: config.timezone, dups: paymentDups, since: monitorStartMs(), isKnown: isOurCustomer });
  const items = receivedItems(events, r, { timeZone: config.timezone, lookup: await invoiceLookupFor(events) });
  return weeklyCheckText({ expenses: expenseStore.done(r), purchases, items, payments, aliasOf: (n) => cutAliases.resolve(n), title: r.label });
}
async function monthlyFullReport() {
  const r = rangeOf('month', todayDubai());
  const records = [...await qbRows('Purchase', dayPlus(r.from, -3), dayPlus(r.to, 3)), ...await qbRows('Bill', dayPlus(r.from, -3), dayPlus(r.to, 3))].filter((x) => x.TxnDate >= r.from && x.TxnDate <= r.to);
  return monthlyFullText({ expenses: expenseStore.done(r), records, title: r.label });
}

// 19:00 Dubai time: the daily expenses report in the expenses group (never salaries, rent or QuickBooks figures there) and the money received report to the owner only; on Thursday the week and the check
// of what the office has not recorded in QuickBooks; on the last day of the month the month and the owner's full report. Each is sent once (the day is remembered on the server).
setInterval(async () => {
  try {
    if (!sock?.user || botState.paused) return;
    const now = localParts(Date.now(), config.timezone);
    if (now.minutes < config.expensesReportHour * 60) return;
    const once = (key) => { if (expenseStore.d.sent[key]) return false; expenseStore.mark(key, Date.now()); return true; };
    const toGroup = async (text) => { const jid = await expensesGroupJid(); if (jid) await sock.sendMessage(jid, { text }); };
    const toOwner = (text) => sock.sendMessage(ownIds()[0], { text: `🤖 ${text}` });
    const steps = [];
    if (once(`daily:${now.day}`)) steps.push(['daily expenses', async () => { if (expenseStore.done(rangeOf('today', now.day)).length) await toGroup(expensesReportText('today')); }]);
    if (qbo.connected && !qbo.paused && once(`received:${now.day}`)) steps.push(['money received', async () => { const t = await receivedReportText('today'); if (!/No money was recorded/.test(t)) await toOwner(t); }]);
    if (now.weekday === 4 && once(`weekly:${now.day}`)) {
      steps.push(['weekly expenses', async () => { if (expenseStore.done(rangeOf('week', now.day)).length) await toGroup(expensesReportText('week')); }]);
      if (qbo.connected && !qbo.paused) steps.push(['weekly check', async () => toOwner(await weeklyCheckReport())]);
    }
    if (dayPlus(now.day, 1).endsWith('-01') && once(`monthly:${now.day}`)) {
      steps.push(['monthly expenses', async () => { if (expenseStore.done(rangeOf('month', now.day)).length) await toGroup(expensesReportText('month')); }]);
      if (qbo.connected && !qbo.paused) steps.push(['monthly full report', async () => toOwner(await monthlyFullReport())]);
    }
    for (const [name, run] of steps) { try { await run(); logger.info(`expenses: ${name} sent for ${now.day}`); } catch (e) { logger.warn(`expenses: ${name} failed: ${e.message}`); } }
  } catch (e) { logger.warn(`expenses timer failed: ${e.message}`); }
}, 5 * 60 * 1000).unref();

async function onMessage(raw) {
  const groupId = raw.key.remoteJid;
  if (!isJidGroup(groupId)) { await handleStaffChat(raw, groupId, null); return; }
  const store = usageCtx.getStore();
  if (store) store.group = groupLabel((await groupInfo(groupId)).subject);
  { const info = await groupInfo(groupId); try { keepPhotoMessage(raw, groupId, info); } catch (e) { logger.warn(`photo keep failed: ${e.message}`); } if (await maybeSetExpensesGroup(raw, groupId, info) || (isExpensesSubject(info.subject) && await expensesTurn(raw, groupId, info))) return; } // the expenses group: receipts, answers, the owner's «this is the expenses group»
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
  if (!groupAllowed(watchedInfo.subject, config).ok && availDrafts.openIds().length) { // a colleague or the owner answers the question in the customer group himself: the waiting draft is dropped, the owner told once
    const said = textOf(normalizeMessageContent(raw.message)) || '';
    const who = { sender: raw.key.participant, senderAlt: raw.key.participantAlt };
    const staffSaid = raw.key.fromMe || staffChecker([...config.staffNumbers, ...config.adminNumbers, ...config.ownerNumbers], lids(watchedInfo.lidToPhone))(who) === true;
    if (said && staffSaid && !replayCtx.getStore()?.quiet) {
      const quotedId = (normalizeMessageContent(raw.message)?.extendedTextMessage?.contextInfo || {}).stanzaId || '';
      for (const d of availDrafts.dropAnswered({ groupId, text: said, quotedId })) {
        const name = raw.key.fromMe ? 'the owner' : (raw.pushName || 'a colleague');
        void sock.sendMessage(ownIds()[0], { text: '🤖 #' + d.id + ' dropped: answered in the group by ' + name }).catch((e) => logger.warn('draft drop note failed: ' + e.message));
      }
    }
  }
  if (!groupAllowed(watchedInfo.subject, config).ok && !raw.key.fromMe) { // a customer's «209 available?» in his own group: a private draft for the sales manager; the group itself is never written to by this
    const customerText = textOf(normalizeMessageContent(raw.message)) || '';
    const sender = { sender: raw.key.participant, senderAlt: raw.key.participantAlt };
    if (customerText && staffChecker([...config.staffNumbers, ...config.adminNumbers, ...config.ownerNumbers], lids(watchedInfo.lidToPhone))(sender) !== true) {
      void customerAsksAvailability({ messageId: raw.key.id, groupId, subject: watchedInfo.subject, text: customerText }).catch((e) => logger.warn(`availability draft failed: ${e.message}`));
      const need = parseOfficeRequest(customerText); // «send the invoice», «we need 505 30 mtr»: surfaced ONCE to the owner's own chat; the customer group is never written to
      if (need && !officeAsked.has(raw.key.id) && !replayCtx.getStore()?.quiet) {
        officeAsked.add(raw.key.id); if (officeAsked.size > 300) officeAsked.delete(officeAsked.values().next().value);
        void sock.sendMessage(ownIds()[0], { text: '🤖 ' + officeNote(watchedInfo.subject, customerText, need) }).catch((e) => logger.warn('office request note failed: ' + e.message));
      }
    }
  }
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
      const sep = separateStockAnswers(a[1].text); // several stock answers in one message: a line between the code blocks
      if (sep !== a[1].text) a[1] = { ...a[1], text: sep };
    }
    if (typeof a[1]?.text === 'string' && /[؀-ۿ]/.test(a[1].text) && config.replyLanguage === 'en') {
      try { const en = await englishOut(a[1].text, englishViaModel); if (en !== a[1].text) a[1] = { ...a[1], text: en }; } catch { /* sent as written */ }
    } else if (typeof a[1]?.text === 'string' && /[؀-ۿ]/.test(a[1].text) && !keepLang.has(a[1])) {
      try { if (await englishFor(a[0])) { const en = toEnglish(a[1].text); if (en !== a[1].text) a[1] = { ...a[1], text: en }; } } catch { /* sent as written */ }
    }
    if (typeof a[1]?.text === 'string' && (ownIds().some((o) => jidDigits(o) === jidDigits(a[0])) || await englishFor(a[0]).catch(() => false))) { // the team's texts (never a customer group): amounts bold and unbroken, invoice numbers plain
      const marked = markAmounts(a[1].text); if (marked !== a[1].text) a[1] = { ...a[1], text: marked };
    }
    const r = await guarded(...a); if (r && isJidGroup(a[0]) && groups.get(a[0]) && !quietContents.has(a[1])) experience.bot(groupLabel(groups.get(a[0]).subject)); if (r?.key?.id) { sent.add(r.key.id); if (sent.size > 500) sent.delete(sent.values().next().value); } return r; };
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messaging-history.set', (h) => { try { onHistorySet(h); } catch (e) { logger.warn(`history event failed: ${e.message}`); } }); // the answer to an on-demand history request
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
