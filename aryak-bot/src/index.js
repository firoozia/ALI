// ARYAK Assistant: WhatsApp (Baileys) + Claude + Zinax Stock.

import makeWASocket, { DisconnectReason, downloadMediaMessage, isJidGroup, jidNormalizedUser, normalizeMessageContent, useMultiFileAuthState } from 'baileys';
import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { answer } from './assistant.js';
import { SheetCache, fetchReport, fetchStock, isTimeout, warmSheet } from './stock.js';
import { PriceBook, formatBook, formatCodePrice, formatParsed, parsePriceCommand, parsePriceDocument, parsePriceText } from './prices.js';
import { auditInvoice, checkNumber } from './audit.js';
import { buildDigest, digestDue, readLastDigest, writeLastDigest } from './digest.js';
import { formatDetails, formatReport, parseDay, reportFailed, reportInvalidDate, todayLine } from './report.js';
import { formatStaffStock } from './stock-format.js';
import { correctionSaved, detectLang, noVoice, notUnderstood, photoUnclear, sheetFailed, sizeNote } from './lang.js';
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
const system = buildSystemPrompt(config.kbDir, config.displayName);
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
    const customer = info.subject.replace(config.groupSuffix, '').trim() || info.subject;
    const images = [];
    for (const m of messages.filter((x) => x.loadImage).slice(-4)) {
      try { images.push(await m.loadImage()); } catch (e) { logger.warn(`image download failed: ${e.message}`); }
    }
    const ctx = { groupId, groupName: info.subject, customer, messageText: messages.map((m) => m.text).filter(Boolean).join(' / ') };
    const result = await answer({ client, config, system, input: { groupName: info.subject, customer, transcript, messages, images }, ctx, recent });
    for (const text of result.managerTexts) await sock.sendMessage(config.salesManager, { text });
    logger.info(`${groupId}: ${result.why}`);
    if (!result.reply) return;
    const { text, mentions } = applyTags(result.reply, config.team);
    await sock.sendMessage(groupId, { text, mentions }, { quoted: lastRaw.get(groupId) });
  },
});

// The daily summary for the information group, once a day after the set hour (counts only).
setInterval(async () => {
  try {
    if (!sock?.user || !config.infoGroupName || botState.paused) return;
    const day = digestDue({ timeZone: config.timezone, hour: config.digestHour, last: readLastDigest(config.authDir) });
    if (!day) return;
    await sendTo(config.infoGroupName, buildDigest({ history: desk.history, requests: desk.requests, day, timeZone: config.timezone }));
    writeLastDigest(config.authDir, day);
    logger.info(`daily summary for ${day} sent`);
  } catch (e) { logger.warn(`daily summary failed: ${e.message}`); }
}, 60 * 1000).unref();

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
async function pdfOf(raw, groupId) {
  const file = normalizeMessageContent(raw.message)?.documentMessage;
  if (!file || !String(file.mimetype || '').includes('pdf')) return null;
  let info = await groupInfo(groupId);
  const sender = { sender: raw.key.participant, senderAlt: raw.key.participantAlt };
  let staff = staffChecker(config.staffNumbers, info.lidToPhone)(sender);
  if (staff === null) { info = await groupInfo(groupId, true); staff = staffChecker(config.staffNumbers, info.lidToPhone)(sender); }
  if (staff === null) { logger.info(`pdf from unknown sender in ${groupId}, ignored`); return null; }
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
  if (raw.key.fromMe) return;
  const got = await pdfOf(raw, groupId);
  if (!got) return;
  const { info, doc } = got;
  if (role === 'request') {
    if (doc.staff) return; // a colleague's PDF in the customer group is the forwarded invoice
    const meta = await extractMeta({ client, config, doc });
    if (desk.addRequest(doc, meta, info.subject)) logger.info(`${groupId}: purchase order ${meta.po || '(no number)'} of ${meta.customer || '?'} kept`);
    return;
  }
  if (!doc.staff || botState.paused || !desk.firstTime(doc.hash)) return;
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
  const number = verdict.invoice_number || verdict.invoice?.number || '';
  const day = new Date().toISOString().slice(0, 10);
  const own = (verdict.problems || []).map((p) => ({ severity: 'urgent', ...p }));
  const extra = [
    ...(verdict.invoice ? auditInvoice(verdict.invoice, { book, day, vatRate: config.vatRate, tol: config.moneyTolerance, customer: verdict.request_customer || meta.customer }) : []),
    ...(number ? checkNumber(number, desk.numbers()) : []),
  ];
  const problems = [...own, ...extra];
  const urgent = problems.filter((p) => p.severity !== 'info').length;
  const priceUrgent = extra.filter((p) => p.kind === 'price-below' && p.severity !== 'info').length;
  const final = { ...verdict, problems, verdict: verdict.verdict === 'no-order' ? 'no-order' : urgent && verdict.verdict === 'match' ? 'mismatch' : verdict.verdict };
  logger.info(`${groupId}: invoice ${final.verdict}, ${problems.length} point(s), ${urgent} urgent${book.loaded ? '' : ', no price list stored'}`);
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
      voiceDesk.set(key, { requestText: u.requestText, lang: u.lang });
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
    if (kind === 'yes') return { messages: [{ ...last, text: pend.requestText, hasImage: false, loadImage: null }] };
  }
  return { messages };
}

const jidDigits = (j) => String(j || '').replace(/@.*$/, '').replace(/:\d+$/, '').replace(/\D/g, '');
const ownIds = () => [sock.user?.id, sock.user?.lid].filter(Boolean).map(jidNormalizedUser);
const textOf = (content) => content?.conversation || content?.extendedTextMessage?.text || '';

const staffHandlersFor = (key, lang = 'fa') => ({
  staff_stock: async (i) => {
    try {
      let found = await fetchStock(config, { code: i.code, category: i.category, size: i.size });
      let note = '';
      if (found.sizeFound === false) {
        // The named size is not registered: answer for the whole code and say so.
        note = sizeNote(lang, i.size);
        found = await fetchStock(config, { code: i.code, category: i.category, size: '' });
      }
      // Which group was meant? The next message of the same person answers, even without the name.
      if (found.ambiguous) followDesk.set(key, { code: i.code, size: i.size || '', options: found.categories, lang });
      return {
        formatted: formatStaffStock(found, i.code, note, lang),
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
    await reply(`استثنای تازه: ${command.exception.customer}، کد ${command.exception.code} = ${command.exception.price}${command.exception.from ? ` از ${command.exception.from}` : ''}${command.exception.to ? ` تا ${command.exception.to}` : ''}\nدرست است؟ (بله / نه)`);
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
  const cmd = admin && (!group || group.command) ? parseCommand(text, { bare: true }) : null;
  if (cmd) { trace(where, role, `command ${cmd}`); await reply(runCommand(cmd, { name: config.displayName, state: botState, corrections: () => readCorrections(config.authDir), desk, staffNumbers: config.staffNumbers, startedAt })); return true; }
  const ctx = (content.extendedTextMessage || audio || image)?.contextInfo || {};
  const addressed = !group || isAddressed({
    text, mentioned: (ctx.mentionedJid || []).map(jidNormalizedUser), quotedFrom: ctx.participant ? jidNormalizedUser(ctx.participant) : '',
    ownIds: own, names: config.botNames,
  });
  // The owner's price list and special prices (admins, in a private chat or the command group).
  if (admin && (!group || group.command)) {
    if (await handlePriceFlow({ raw, content, text, key: `p:${chatId}`, reply, role, where, image, pdf })) return true;
  }
  if (pdf) return false; // a PDF is for the invoice and purchase-order flows
  // "Wrong, <the right answer>" as a reply to one of the assistant's messages: stored for the owner, nothing more.
  const quotedText = textOf(normalizeMessageContent(ctx.quotedMessage));
  const quotedFromBot = !!ctx.participant && own.includes(jidNormalizedUser(ctx.participant));
  const fix = quotedFromBot && quotedText && !audio && !image ? parseCorrection(text) : null;
  if (fix) {
    appendCorrection(config.authDir, { at: new Date().toISOString(), where, role, wrong: quotedText, right: fix.right });
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
  const staffWords = [...config.staffGroupNames, config.invoiceGroupName, config.infoGroupName, ...config.commandGroupNames].filter(Boolean);
  if (staffWords.length) {
    const subject = (await groupInfo(groupId)).subject.toLowerCase();
    if (staffWords.some((w) => subject.includes(w)) && await handleStaffChat(raw, groupId, { command: config.commandGroupNames.some((w) => subject.includes(w)) })) return;
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
    groupId, fromMe: !!raw.key.fromMe, sender: raw.key.participant, senderAlt: raw.key.participantAlt,
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
  sock.sendMessage = async (...a) => { const r = await rawSend(...a); if (r?.key?.id) { sent.add(r.key.id); if (sent.size > 500) sent.delete(sent.values().next().value); } return r; };
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
