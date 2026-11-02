// ARYAK Assistant: WhatsApp (Baileys) + Claude + Zinax Stock.

import makeWASocket, { DisconnectReason, downloadMediaMessage, isJidGroup, normalizeMessageContent, useMultiFileAuthState } from 'baileys';
import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { answer } from './assistant.js';
import { loadConfig } from './config.js';
import { GroupGate, staffChecker } from './gate.js';
import { buildSystemPrompt } from './prompt.js';
import { applyTags } from './tags.js';

const { config, missing } = loadConfig();
if (missing.length) {
  console.error(`Missing settings: ${missing.join(', ')}. See README.md.`);
  process.exit(1);
}
const client = new Anthropic();
const system = buildSystemPrompt(config.kbDir);
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const recent = new Map(); // manager alerts already sent
const groups = new Map(); // group JID -> { subject, lidToPhone, at }
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

async function onMessage(raw) {
  const groupId = raw.key.remoteJid;
  if (!isJidGroup(groupId)) return;
  if (config.allowedGroups.length && !config.allowedGroups.includes(groupId)) return;
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
  if (!state.creds.registered && config.pairPhone) {
    setTimeout(async () => {
      const code = await sock.requestPairingCode(config.pairPhone.replace(/\D/g, ''));
      console.log(`On the bot's phone: WhatsApp > Linked devices > Link with phone number, then enter ${code}`);
    }, 3000);
  }
  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') logger.info('connected to WhatsApp');
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) logger.error('logged out: delete the auth folder and link again');
      else setTimeout(start, 3000);
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
