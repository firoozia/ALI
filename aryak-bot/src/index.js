// ARYAK Assistant: WhatsApp (Baileys) + Claude + Zinax Stock.

import makeWASocket, { DisconnectReason, downloadMediaMessage, isJidGroup, jidNormalizedUser, normalizeMessageContent, useMultiFileAuthState } from 'baileys';
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
import { customerFromMessages, productCode } from './codes.js';
import { orderLinesOf } from './orderlines.js';
import { Experience, describeCandidate, importPatterns, formatStatus, learnedReport, parseLearnCommand, reportDue } from './experience.js';
import { Tracker, balanceOf, checkCod, checkDelivery, checkInvoiceAgainstCuts, dueNags, extractEvent, formatBalance, markCleared, openOrders, parseTrackerCommand, statementsDue } from './tracker.js';
import { buildDigest, digestDue, readLastDigest, writeLastDigest } from './digest.js';
import { formatDetails, formatReport, parseDay, reportFailed, reportInvalidDate, todayLine } from './report.js';
import { formatStaffStock } from './stock-format.js';
import { AvailabilityDesk, answerRequest, classify, managerQuestion, parseManagerReply, reminderText, runAvailability } from './availability.js';
import { LANG_NAME, correctionSaved, detectLang, noVoice, notUnderstood, photoUnclear, sheetFailed, sizeNote } from './lang.js';
import { imageAction, understandImages } from './image.js';
import { ignoredKind, imageOf } from './media.js';
import { appendCorrection, parseCorrection, readCorrections } from './corrections.js';
import { loadConfig } from './config.js';
import { GroupGate, staffChecker } from './gate.js';
import { afterClose, clearAuth, pairingOnce } from './pairing.js';
import { InvoiceDesk, checkInvoice, extractMeta, noRequestText, readInvoice, reportText, staffWarning } from './invoice.js';
import { helloOnce } from './hello.js';
import { BotState, isAddressed, parseCommand, runCommand, staffAnswer } from './staff.js';
import { DEFAULT_PHRASES, metadataToken, speechTranscriber } from './speech.js';
import { MAX_SECONDS, NO_VOICE_CUSTOMER, NO_VOICE_FA, NOT_UNDERSTOOD_CUSTOMER, NOT_UNDERSTOOD_FA, VoiceDesk, answerKind, nameHeard, retryText, understand, voiceAction } from './voice.js';
import { normalizeDigits } from './text.js';
import { matchOption } from './choice.js';
import { shouldProcess } from './intake.js';
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
const rules = new Rules(config.authDir); // rules the owner taught in words: durable, listed, removable\nconst aliases = new Aliases(path.join(config.authDir, 'aliases')); // other spellings of a customer's name, added by the owner
const experience = new Experience({ dir: path.join(config.authDir, 'experience') }); // counters and anonymous shapes; never messages
const tracker = new Tracker({ dir: path.join(config.authDir, 'tracker') }); // the steps of each order, from the supervised groups
const avail = new AvailabilityDesk({ dir: path.join(config.authDir, 'availability') }); // questions to the sales manager that wait for his answer
const followDesk = new VoiceDesk(); // a question the assistant asked a person; their next message answers it
const sttNotice = new Map(); // chat -> when it was last told that voice cannot be heard
const voiceDesk = new VoiceDesk(); // what was understood from a voice note, waiting for a yes
const transcribe = speechTranscriber({
  languages: config.speechLanguages, token: metadataToken(), minConfidence: config.speechMinConfidence,
  phrases: [...new Set([config.displayName, ...DEFAULT_PHRASES])],
});
const handled = new Set(); // ids of messages already taken in
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
    const customer = (named ? canon(named) : '') || info.subject.replace(config.groupSuffix, '').trim() || info.subject;
    // Availability: ask for the quantity, answer when it is comfortably in stock, otherwise ask the sales manager.
    if (config.availabilityFlow) {
      const flow = await runAvailability({
        messages, groupId, groupName: info.subject, customer, desk: avail,
        decide: async (line) => {
          try { return classify(await fetchStock(config, { code: line.code, quantity: line.quantity, quantity_unit: line.unit })); } catch { return { kind: 'unhandled' }; }
        },
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
    const result = await answer({ client, config, system: systemPrompt(), input: { groupName: info.subject, customer, transcript, messages, images }, ctx, recent });
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

// Once an hour: the polite single reminders (an order without an invoice, an invoice without a delivery), and on the
// statement day the customers whose monthly statement was not recorded. Report-only, to the information group.
setInterval(async () => {
  try {
    if (!sock?.user || !config.infoGroupName || botState.paused || !config.trackerEnabled) return;
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
    await sendTo(config.infoGroupName, buildDigest({ history: desk.history, requests: desk.requests, day, timeZone: config.timezone, events: tracker.events }));
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
const canon = (name) => aliases.resolve(name, knownCustomers());

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
  const customerGroup = config.allowedGroupNames.some((w) => subject.includes(w)) || config.watchGroupNames.some((w) => subject.includes(w));
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
      const event = { ...ev, customer: canon(ev.customer), at: Date.now(), ref: refOf(raw.key.id, i) };
      if (!tracker.add(event)) continue;
      trace(whereDet, 'tracker', `${role} recorded from the caption${event.internal ? ' (internal, not a sale)' : ''}`);
      if (role === 'delivery' && config.infoGroupName) {
        const findings = [...checkDelivery(tracker, event), ...checkCod(tracker, event)];
        if (findings.length) await sendTo(config.infoGroupName, `ℹ️ تحویل ${event.customer || ''}:\n${findings.map((f) => `- ${f}`).join('\n')}\n— ${config.displayName}`);
        if (tracker.isHeld(event.customer)) await sock.sendMessage(groupId, { text: `⛔ ${tracker.isHeld(event.customer)}: تحویل تا تأیید نقدی نباید انجام شود. — ${config.displayName}` }, { quoted: raw });
      }
    }
    return;
  }
  if (role === 'goods') return; // only the shapes above are read there
  if (!image && !/\d/.test(text) && text.length < 12) return; // a greeting or a thanks
  const images = [];
  if (image) {
    try { images.push({ base64: (await downloadMediaMessage(raw, 'buffer', {})).toString('base64'), mimeType: String(image.mimetype || 'image/jpeg').split(';')[0] }); } catch (e) { logger.warn(`tracker: photo download failed: ${e.message}`); }
  }
  const ev = await extractEvent({ client, config, role, caption: text, images });
  const where = `group "${(await groupInfo(groupId)).subject}"`;
  if (!ev) { trace(where, 'tracker', `${role}: nothing to record`); return; }
  const event = { ...ev, customer: canon(ev.customer), at: Date.now(), ref: createHash('sha256').update(`${groupId}|${raw.key.id}`).digest('hex').slice(0, 24) };
  if (!tracker.add(event)) return;
  trace(where, 'tracker', `${role} recorded (${event.lines?.length || 0} line(s)${event.amount ? ', an amount' : ''})`);
  if (!config.infoGroupName) return;
  if (role === 'delivery') {
    const findings = [...checkDelivery(tracker, event), ...checkCod(tracker, event)];
    if (findings.length) await sendTo(config.infoGroupName, `ℹ️ تحویل ${event.customer || ''}:\n${findings.map((f) => `- ${f}`).join('\n')}\n— ${config.displayName}`);
    if (tracker.isHeld(event.customer)) await sock.sendMessage(groupId, { text: `⛔ ${tracker.isHeld(event.customer)}: تحویل تا تأیید نقدی نباید انجام شود. — ${config.displayName}` }, { quoted: raw });
  } else if (role === 'payment' && event.kind !== 'statement' && event.customer && event.amount) {
    await sendTo(config.infoGroupName, `ℹ️ پرداخت ثبت شد: ${event.customer}، ${Number(event.amount).toFixed(2)} درهم\n${formatBalance(event.customer, balanceOf(tracker, event.customer))}\n— ${config.displayName}`);
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
async function watchGroup(raw, groupId, role) {
  // An invoice posted from this very account (the owner tests from it) is checked in the Invoices group: the bot never posts a PDF itself.
  if (raw.key.fromMe && role !== 'invoice') return;
  const got = await pdfOf(raw, groupId, { internal: role === 'invoice' });
  if (!got) return;
  const { info, doc } = got;
  if (role === 'request') {
    if (doc.staff) return; // a colleague's PDF in the customer group is the forwarded invoice
    const meta = await extractMeta({ client, config, doc });
    if (desk.addRequest(doc, meta, info.subject)) logger.info(`${groupId}: purchase order ${meta.po || '(no number)'} of ${meta.customer || '?'} kept`);
    return;
  }
  if (!doc.staff) { logger.info(`invoice pdf not checked: sender is not the office`); return; }
  if (botState.paused) { logger.info('invoice pdf not checked: the assistant is paused'); return; }
  if (!desk.firstTime(doc.hash)) { logger.info('invoice pdf not checked: this file was already checked'); return; }
  if (!config.infoGroupName) { logger.warn('INFO_GROUP_NAME is not set: invoice check skipped'); return; }
  const meta = await extractMeta({ client, config, doc });
  const found = desk.find(meta);
  const ctx = { groupName: info.subject, customer: meta.customer, invoiceFile: doc.fileName, invoiceSender: doc.senderName };
  let verdict;
  if (!found.request) {
    logger.info(`${groupId}: no purchase order for invoice (PO ${meta.po || '?'})`);
    await sendTo(config.infoGroupName, noRequestText(meta, { ...ctx, ambiguous: found.ambiguous, name: config.displayName }));
    // Without an order there is nothing to compare with, but the arithmetic, the prices and the number can still be checked.
    const read = await readInvoice({ client, config, invoice: doc });
    verdict = { verdict: 'no-order', request_customer: '', invoice_customer: read?.invoice_customer || meta.customer, invoice_number: read?.invoice_number || '', invoice: read?.invoice || null, problems: [] };
  } else {
    verdict = await checkInvoice({ client, config, request: found.request, invoice: doc });
  }
  if (verdict.verdict === 'error') {
    logger.info(`${groupId}: invoice check failed`);
    await sendTo(config.infoGroupName, reportText(verdict, { ...ctx, name: config.displayName }));
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
  const extra = [
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
    if (tracker.add(invoiceEvent) && config.cutGroupName) {
      const notes = checkInvoiceAgainstCuts(tracker, invoiceEvent);
      if (notes.length) await sendTo(config.infoGroupName, `ℹ️ مقایسهٔ فاکتور ${number} با گروه برش:\n${notes.map((f) => `- ${f}`).join('\n')}\n— ${config.displayName}`);
    }
  }
  desk.record({ verdict: final.verdict, customer: verdict.request_customer || verdict.invoice_customer || meta.customer, po: meta.po, file: doc.fileName, problems: problems.length, urgent, priceUrgent, number });
  if (verdict.verdict !== 'no-order') {
    const text = reportText(final, { ...ctx, name: config.displayName });
    if (text) await sendTo(config.infoGroupName, text);
  } else if (problems.length) {
    await sendTo(config.infoGroupName, reportText({ ...final, verdict: 'mismatch' }, { ...ctx, name: config.displayName }));
  }
  // The office user is told at once, in the invoices group, what to correct. Nothing is sent to a customer.
  const warn = staffWarning(final, config.displayName);
  if (warn) await sock.sendMessage(groupId, { text: warn });
}

/** Reads the photos of a message with Claude's vision. Never throws. */
async function understandPhotos(messagesWithImages, caption, fallbackLang) {
  const images = [];
  for (const m of messagesWithImages.slice(-3)) {
    try { images.push(await m.loadImage()); } catch (e) { logger.warn(`photo download failed: ${e.message}`); }
  }
  if (!images.length) return { ok: false, reason: 'error' };
  return understandImages({ images, caption, config, client, fallbackLang, log: (s) => logger.info(s) });
}

/** Reads one voice note: download, speech to text, intent. Never throws. */
async function understandAudio(load, seconds) {
  // A long note is not even downloaded.
  if (seconds > MAX_SECONDS) { logger.info(`voice: ${seconds} s is too long, skipped`); return { ok: false, reason: 'too long' }; }
  try { return await understand({ buffer: await load(), seconds, config, client, transcribe, log: (s) => logger.info(s) }); }
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
      image ? { type: 'image', source: { type: 'base64', media_type: String(image.mimetype || 'image/jpeg').split(';')[0], data: b64 } } : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
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
async function handleOnBehalf({ ob, raw, reply, role, where, lang }) {
  const customer = canon(ob.customer);
  const blocks = [];
  let toManager = 0;
  for (const line of ob.lines) {
    let res;
    try { res = await fetchStock(config, { code: line.code, quantity: line.quantity, quantity_unit: line.unit }); } catch (e) { blocks.push(sheetFailed(lang, line.code, isTimeout(e))); continue; }
    const d = classify(res);
    const verdict = d.kind === 'ok' ? 'کافی است؛ می‌شود به مشتری موجود گفت' : d.kind === 'manager' ? 'کافی نیست یا کمتر از حداقل می‌ماند؛ به مدیر فروش گزارش شد' : 'کد ناشناخته یا در چند گروه است';
    blocks.push(`${formatStaffStock(res, line.code, '', lang)}\n\n→ ${customer}: ${line.quantity} ${line.unit}: ${verdict}`);
    if (d.kind === 'manager' && config.salesManager) {
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
    tracker.add({ type: 'order', at: Date.now(), customer, lines: ob.lines.map((l) => ({ code: l.code, quantity: l.quantity, unit: l.unit })), ref: createHash('sha256').update(`behalf|${raw.key.id}`).digest('hex').slice(0, 24) });
  }
  trace(where, role, `request on behalf of a customer: ${ob.lines.length} line(s), ${toManager} sent to the sales manager`);
  await reply([`درخواست ${customer}:`, ...blocks].join('\n\n'));
}

async function handleStaffChat(raw, chatId, group) {
  const content = normalizeMessageContent(raw.message);
  const audio = config.voiceEnabled ? content?.audioMessage : null;
  const image = config.imageConfirm ? imageOf(content) : null;
  const pdf = content?.documentMessage && /pdf/i.test(String(content.documentMessage.mimetype || '')) ? content.documentMessage : null;
  const text = textOf(content) || image?.caption || pdf?.caption || '';
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
  if (!group && raw.key.fromMe && !isSelf) { trace(where, 'owner', 'ignored: the owner talking to someone else'); return false; } // from the bot's phone
  let admin = !!raw.key.fromMe;
  if (!raw.key.fromMe) {
    let info = group ? await groupInfo(chatId) : { lidToPhone: new Map() };
    const who = group ? { sender: raw.key.participant, senderAlt: raw.key.participantAlt } : { sender: chatId, senderAlt: raw.key.remoteJidAlt };
    let staff = staffChecker(config.staffNumbers, info.lidToPhone)(who);
    if (staff === null && group) { info = await groupInfo(chatId, true); staff = staffChecker(config.staffNumbers, info.lidToPhone)(who); }
    if (!staff) { trace(where, 'not-staff', group ? 'left to the customer flow' : 'ignored: private chat from a number that is not staff'); return false; }
    admin = staffChecker(config.adminNumbers, info.lidToPhone)(who) === true;
  }
  const role = admin ? 'admin' : 'staff';
  const reply = async (body) => sock.sendMessage(chatId, { text: isSelf ? `🤖 ${body}` : body }, { quoted: raw });
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
  if (admin && addressed && !audio && !image) {
    const rc = parseRuleCommand(text);
    if (rc) { await reply(rc.list ? rules.list() : rules.remove(rc.remove) ? `قانون ${rc.remove} برداشته شد.` : 'قانونی با این شماره نبود.'); return true; }
    const rule = ruleFrom(text, config.botNames);
    if (rule) { const r = rules.add(rule); trace(where, role, `owner rule ${r.id} stored`); await reply(`ثبت شد (قانون ${r.id}): ${r.text}`); return true; }
  }
  if (admin && (!group || group.command)) {
    const lc = parseLearnCommand(text);
    if (lc) { await learnCommand(lc, reply); return true; }
    const ac = parseAliasCommand(text);
    if (ac) { await reply(ac.list ? aliases.list() : aliases.add(ac.customer, ac.alias) ? `ثبت شد: «${ac.alias}» همان «${ac.customer}» است.` : 'نام را نفهمیدم.'); return true; }
  }
  // The owner's price list and special prices (admins, in a private chat or the command group).
  if (admin && (!group || group.command)) {
    if (await handlePriceFlow({ raw, content, text, key: `p:${chatId}`, reply, role, where, image, pdf })) return true;
  }
  // A customer's request posted by a colleague on his behalf (not in the groups that only record: cut, delivery, money).
  if (text && !audio && !image && !pdf && !group?.tracked) {
    const ob = parseOnBehalf(text);
    if (ob) { await handleOnBehalf({ ob, raw, reply, role, where, lang: detectLang(text, 'fa') }); return true; }
  }
  if (pdf) return false; // a PDF is for the invoice and purchase-order flows
  // "Wrong, <the right answer>" as a reply to one of the assistant's messages: stored for the owner, nothing more.
  const quotedText = textOf(normalizeMessageContent(ctx.quotedMessage));
  const quotedFromBot = !!ctx.participant && own.includes(jidNormalizedUser(ctx.participant));
  const fix = quotedFromBot && quotedText && !audio && !image ? parseCorrection(text) : null;
  if (fix) {
    appendCorrection(config.authDir, { at: new Date().toISOString(), where, role, wrong: quotedText, right: fix.right });
    experience.candidate({ kind: 'correction', wrong: quotedText.slice(0, 200), right: fix.right.slice(0, 300) });
    if (group) experience.corrected(groupLabel(where.replace(/^group "|"$/g, '')), detectLang(text, 'fa'));
    trace(where, role, 'correction of an answer stored for the owner');
    await reply(correctionSaved(detectLang(text, 'fa')));
    return true;
  }
  // A voice note is only answered with a question; the request goes on after the same person says yes.
  const key = `s:${chatId}:${jidDigits(raw.key.participant || raw.key.remoteJid)}`;
  if (audio) {
    // Nobody says the assistant's name outside the audio, so a colleague's voice note is always read; the words
    // in it decide. Addressed anyway: a mention, a reply to the assistant, a private chat, or a note that
    // follows its question.
    const explicit = addressed || !!voiceDesk.get(key) || !!followDesk.get(key);
    const u = await understandAudio(() => downloadMediaMessage(raw, 'buffer', {}), audio.seconds || 0);
    const named = !u.ok && !!u.transcript && nameHeard(u.transcript, config.botNames);
    const noticeDue = u.reason === 'speech error' && Date.now() - (sttNotice.get(chatId) || 0) > 3600 * 1000;
    const action = voiceAction({ u, explicit, namedInTranscript: named, noticeDue });
    const spoken = u.lang || (u.transcript ? detectLang(u.transcript) : 'fa');
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
    const written = detectLang(text, 'fa');
    trace(where, role, `photo received${image.mimetype ? ` (${String(image.mimetype).split(';')[0]})` : ''}: reading it`);
    const u = await understandPhotos([{ loadImage: async () => ({
      base64: (await downloadMediaMessage(raw, 'buffer', {})).toString('base64'),
      mimeType: image.mimetype?.split(';')[0] || 'image/jpeg',
    }) }], text, written);
    const action = imageAction({ u, explicit });
    if (action === 'confirm') {
      voiceDesk.set(key, { requestText: u.requestText, lang: u.lang });
      trace(where, role, `photo understood (${u.intent}, ${u.items.length} code(s)), reply language ${u.lang}: asking for confirmation`);
      await reply(u.confirmText);
    } else if (action === 'tell') {
      voiceDesk.clear(key);
      trace(where, role, `photo not usable (${u.reason}): told so`);
      await reply(photoUnclear(written));
    } else {
      trace(where, role, `ignored: photo is not a stock or order request (${u.reason}) and not addressed to the assistant`);
    }
    return true;
  }
  let asked = text;
  let confirmed = false;
  let lang = detectLang(text, 'fa'); // the language the answer is written in
  const pend = config.voiceEnabled ? voiceDesk.get(key) : null;
  if (pend) {
    const kind = answerKind(text);
    voiceDesk.clear(key);
    if (kind === 'no') { await reply(retryText(pend.lang)); return true; }
    if (kind === 'yes') { asked = pend.requestText; confirmed = true; lang = pend.lang || lang; }
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
  if (!addressed && !confirmed) { trace(where, role, 'ignored: not addressed to the assistant'); return false; }
  const answerText = await staffAnswer({
    client, config, text: normalizeDigits(asked), log: (s) => logger.warn(s), quoted: textOf(normalizeMessageContent(ctx.quotedMessage)), who: raw.pushName || '', handlers: staffHandlersFor(key, lang), lang, today: todayLine(new Date(), config.timezone),
  });
  trace(where, role, `${answerText ? 'answered' : 'no reply (the model chose silence)'}, reply language ${lang}`);
  if (answerText) await reply(answerText);
  return true;
}

async function onMessage(raw) {
  const groupId = raw.key.remoteJid;
  if (!isJidGroup(groupId)) { await handleStaffChat(raw, groupId, null); return; }
  observe(raw, groupId).catch((e) => logger.warn(`experience: ${e.message}`));
  const trackRole = await trackedRole(groupId);
  // "Invoice inv-9910 delete this one": a deleted number is a legitimate gap in the numbering
  const delNo = deletedInvoice(textOf(normalizeMessageContent(raw.message)));
  if (delNo) tracker.markDeleted(delNo);
  if (trackRole) trackGroup(raw, groupId, trackRole).catch((e) => logger.warn(`tracker failed: ${e.message}`));
  const staffWords = [...config.staffGroupNames, config.invoiceGroupName, config.infoGroupName, config.cutGroupName, config.deliveryGroupName, config.confirmGroupName, ...config.commandGroupNames].filter(Boolean);
  if (staffWords.length) {
    const subject = (await groupInfo(groupId)).subject.toLowerCase();
    if (staffWords.some((w) => subject.includes(w)) && await handleStaffChat(raw, groupId, { command: config.commandGroupNames.some((w) => subject.includes(w)), tracked: !!trackRole })) return;
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
  sock.sendMessage = async (...a) => { const r = await rawSend(...a); if (isJidGroup(a[0]) && groups.get(a[0])) experience.bot(groupLabel(groups.get(a[0]).subject)); if (r?.key?.id) { sent.add(r.key.id); if (sent.size > 500) sent.delete(sent.values().next().value); } return r; };
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
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    let history = 0;
    for (const raw of messages) {
      const verdict = shouldProcess({ type, raw, seen: handled });
      if (!verdict.ok) {
        // A refused message is never silent, except bulk history after a restart (counted in one line).
        if (verdict.reason.startsWith('old message')) { history++; continue; }
        const jid = raw?.key?.remoteJid || '';
        const where = isJidGroup(jid) ? `group "${groups.get(jid)?.subject || 'not loaded'}"` : 'private';
        logger.info(`msg ${where} unknown: ignored: ${verdict.reason}`);
        continue;
      }
      // Each message is handled on its own: a slow answer to one never holds back the next.
      onMessage(raw).catch((e) => logger.error(`message failed: ${e.message}`));
    }
    if (history) logger.info(`upsert ${type}: ${history} older message(s) ignored`);
  });
}

start();
