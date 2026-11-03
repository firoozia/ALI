// ARYAK Assistant: WhatsApp (Baileys) + Claude + Zinax Stock.

import makeWASocket, { DisconnectReason, downloadMediaMessage, isJidGroup, normalizeMessageContent, useMultiFileAuthState } from 'baileys';
import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { createHash } from 'node:crypto';
import { answer } from './assistant.js';
import { loadConfig } from './config.js';
import { GroupGate, staffChecker } from './gate.js';
import { afterClose, clearAuth, pairingOnce } from './pairing.js';
import { InvoiceDesk, checkInvoice, reportText } from './invoice.js';
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
const system = buildSystemPrompt(config.kbDir);
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const recent = new Map(); // manager alerts already sent
const groups = new Map(); // group JID -> { subject, lidToPhone, at }
const desk = new InvoiceDesk(); // latest customer request per watched group
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
  answer: async ({ groupId, messages, transcript }) => {
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

/** A watched group: PDFs only. Staff PDF = invoice, other PDF = request. The bot never writes in this group. */
async function watchGroup(raw, groupId) {
  if (raw.key.fromMe) return;
  const content = normalizeMessageContent(raw.message);
  const file = content?.documentMessage;
  if (!file || !String(file.mimetype || '').includes('pdf')) return;
  let info = await groupInfo(groupId);
  const sender = { sender: raw.key.participant, senderAlt: raw.key.participantAlt };
  let staff = staffChecker(config.staffNumbers, info.lidToPhone)(sender);
  if (staff === null) { info = await groupInfo(groupId, true); staff = staffChecker(config.staffNumbers, info.lidToPhone)(sender); }
  if (staff === null) { logger.info(`pdf from unknown sender in ${groupId}, ignored`); return; }
  const buf = await downloadMediaMessage(raw, 'buffer', {});
  if (buf.length > 20 * 1024 * 1024) { logger.warn(`pdf too large in ${groupId}`); return; }
  const doc = { hash: createHash('sha256').update(buf).digest('hex'), base64: buf.toString('base64'), fileName: file.fileName || '', senderName: raw.pushName || '', staff };
  const got = desk.take(groupId, doc);
  if (typeof got === 'string') { logger.info(`${groupId}: pdf ${got}`); return; }
  if (!config.infoGroupName) { logger.warn('INFO_GROUP_NAME is not set: invoice check skipped'); return; }
  const verdict = await checkInvoice({ client, config, request: got.request, invoice: doc });
  const customer = info.subject.replace(config.groupSuffix, '').trim() || info.subject;
  const text = reportText(verdict, { groupName: info.subject, customer, invoiceFile: doc.fileName, invoiceSender: doc.senderName });
  logger.info(`${groupId}: invoice ${verdict.verdict}`);
  if (!text) return;
  const infoJid = await findGroupJid(config.infoGroupName);
  if (!infoJid) { logger.error(`information group "${config.infoGroupName}" not found`); return; }
  await sock.sendMessage(infoJid, { text });
}

async function onMessage(raw) {
  const groupId = raw.key.remoteJid;
  if (!isJidGroup(groupId)) return;
  if (config.watchGroupNames.length) {
    const subject = (await groupInfo(groupId)).subject.toLowerCase();
    if (config.watchGroupNames.some((w) => subject.includes(w))) return watchGroup(raw, groupId);
  }
  if (!config.allowedGroups.includes(groupId)) {
    const subject = config.allowedGroupNames.length ? (await groupInfo(groupId)).subject.toLowerCase() : '';
    if (!config.allowedGroupNames.some((w) => subject.includes(w))) return;
  }
  const content = normalizeMessageContent(raw.message);
  if (!content || content.protocolMessage || content.reactionMessage) return;
  const text = content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption || '';
  const image = content.imageMessage;
  const m = {
    groupId, fromMe: !!raw.key.fromMe, sender: raw.key.participant, senderAlt: raw.key.participantAlt,
    senderName: raw.pushName || '', text, hasImage: !!image,
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
  gate.onMessage(m);
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  sock = makeWASocket({ auth: state, logger: logger.child({ module: 'baileys' }, { level: 'warn' }) });
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
    if (connection === 'open') logger.info('connected to WhatsApp');
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
