// ARYAK Assistant: WhatsApp (Baileys) + Claude + Zinax Stock.

import makeWASocket, { DisconnectReason, downloadMediaMessage, isJidGroup, jidNormalizedUser, normalizeMessageContent, useMultiFileAuthState } from 'baileys';
import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { createHash } from 'node:crypto';
import { answer } from './assistant.js';
import { fetchStock } from './stock.js';
import { formatStaffStock } from './stock-format.js';
import { loadConfig } from './config.js';
import { GroupGate, staffChecker } from './gate.js';
import { afterClose, clearAuth, pairingOnce } from './pairing.js';
import { InvoiceDesk, checkInvoice, extractMeta, noRequestText, reportText, staffWarning } from './invoice.js';
import { helloOnce } from './hello.js';
import { BotState, isAddressed, parseCommand, runCommand, staffAnswer } from './staff.js';
import { metadataToken, speechTranscriber } from './speech.js';
import { NOT_UNDERSTOOD_CUSTOMER, NOT_UNDERSTOOD_FA, VoiceDesk, answerKind, retryText, understand } from './voice.js';
import { normalizeDigits } from './text.js';
import { buildSystemPrompt } from './prompt.js';
import { applyTags } from './tags.js';

const { config, missing } = loadConfig();
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
// One short line per message and what became of it: where, who (a role, never a number), the decision. No text.
const trace = (where, role, decision) => logger.info(`msg ${where} ${role}: ${decision}`);
const recent = new Map(); // manager alerts already sent
const groups = new Map(); // group JID -> { subject, lidToPhone, at }
const desk = new InvoiceDesk({ dir: config.requestsDir }); // customers' purchase orders
const botState = new BotState(config.authDir); // pause switch
const startedAt = Date.now();
const sent = new Set(); // ids of messages the bot sent, so they are not read again
const voiceDesk = new VoiceDesk(); // what was understood from a voice note, waiting for a yes
const transcribe = speechTranscriber({ languages: config.speechLanguages, token: metadataToken() });
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
  if (!found.request) {
    logger.info(`${groupId}: no purchase order for invoice (PO ${meta.po || '?'})`);
    desk.record({ verdict: 'no-order', customer: meta.customer, po: meta.po, file: doc.fileName });
    await sendTo(config.infoGroupName, noRequestText(meta, { ...ctx, ambiguous: found.ambiguous, name: config.displayName }));
    return;
  }
  const verdict = await checkInvoice({ client, config, request: found.request, invoice: doc });
  logger.info(`${groupId}: invoice ${verdict.verdict}`);
  desk.record({ verdict: verdict.verdict, customer: verdict.request_customer || meta.customer, po: meta.po, file: doc.fileName, problems: verdict.problems?.length || 0 });
  const text = reportText(verdict, { ...ctx, name: config.displayName });
  if (text) await sendTo(config.infoGroupName, text);
  const warn = staffWarning(verdict, config.displayName);
  if (warn) await sock.sendMessage(groupId, { text: warn });
}

/** Reads one voice note: download, speech to text, intent. Never throws. */
async function understandAudio(load, seconds) {
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
    if (!u.ok) { voiceDesk.clear(key); await sock.sendMessage(groupId, { text: NOT_UNDERSTOOD_CUSTOMER }, quoted); return { done: true }; }
    voiceDesk.set(key, { requestText: u.requestText, lang: u.language });
    await sock.sendMessage(groupId, { text: u.confirmText }, quoted);
    return { done: true };
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

const staffHandlers = {
  staff_stock: async (i) => ({
    formatted: formatStaffStock(await fetchStock(config, { code: i.code, category: i.category, size: i.size }), i.code),
    instruction: 'Send the formatted text exactly as it is, character for character, with nothing added before or after.',
  }),
  recent_checks: (i) => desk.lastChecks(i.count),
  find_order: (i) => desk.listOrders(i),
};

/**
 * The team's side. [group] is null for a private chat, else { command: true if it is the command group }.
 * Staff are answered in private chats, in the staff/invoice/information/command groups when addressed (mention, a
 * reply to the bot, or its name), and the owner's commands run in a private chat or the command group. Messages typed
 * on the bot's own phone count as the owner. Returns true when the message was dealt with here.
 */
async function handleStaffChat(raw, chatId, group) {
  const content = normalizeMessageContent(raw.message);
  const audio = config.voiceEnabled ? content?.audioMessage : null;
  const text = textOf(content);
  if (!text && !audio) return false;
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
  if (cmd) { trace(where, role, `command ${cmd}`); await reply(runCommand(cmd, { name: config.displayName, state: botState, desk, staffNumbers: config.staffNumbers, startedAt })); return true; }
  const ctx = (content.extendedTextMessage || audio)?.contextInfo || {};
  const addressed = !group || isAddressed({
    text, mentioned: (ctx.mentionedJid || []).map(jidNormalizedUser), quotedFrom: ctx.participant ? jidNormalizedUser(ctx.participant) : '',
    ownIds: own, names: config.botNames,
  });
  // A voice note is only answered with a question; the request goes on after the same person says yes.
  const key = `s:${chatId}:${jidDigits(raw.key.participant || raw.key.remoteJid)}`;
  if (audio) {
    if (!addressed) { trace(where, role, 'ignored: voice note not addressed to the assistant'); return false; }
    trace(where, role, 'voice note: asking for confirmation');
    const u = await understandAudio(() => downloadMediaMessage(raw, 'buffer', {}), audio.seconds || 0);
    if (!u.ok) { voiceDesk.clear(key); await reply(NOT_UNDERSTOOD_FA); return true; }
    voiceDesk.set(key, { requestText: u.requestText, lang: u.language });
    await reply(u.confirmText);
    return true;
  }
  let asked = text;
  let confirmed = false;
  const pend = config.voiceEnabled ? voiceDesk.get(key) : null;
  if (pend) {
    const kind = answerKind(text);
    voiceDesk.clear(key);
    if (kind === 'no') { await reply(retryText(pend.lang)); return true; }
    if (kind === 'yes') { asked = pend.requestText; confirmed = true; }
  }
  if (!addressed && !confirmed) { trace(where, role, 'ignored: not addressed to the assistant'); return false; }
  const answerText = await staffAnswer({
    client, config, text: normalizeDigits(asked), log: (s) => logger.warn(s), quoted: textOf(normalizeMessageContent(ctx.quotedMessage)), who: raw.pushName || '', handlers: staffHandlers,
  });
  trace(where, role, answerText ? 'answered' : 'no reply (the model chose silence)');
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
  const image = content.imageMessage;
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
  trace(`group "${(await groupInfo(groupId)).subject}"`, m.fromMe ? 'own-number' : m.staff === true ? 'staff' : m.staff === false ? 'customer' : 'unknown', `customer flow: ${decision}`);
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
    if (type !== 'notify') return;
    for (const raw of messages) {
      try { await onMessage(raw); } catch (e) { logger.error(`message failed: ${e.message}`); }
    }
  });
}

start();
