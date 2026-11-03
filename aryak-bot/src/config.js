// Settings from the environment (or a .env file loaded by the process manager).

const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export function loadConfig(env = process.env) {
  const team = env.TEAM_TAGS ? JSON.parse(env.TEAM_TAGS) : {};
  const config = {
    // Claude
    model: env.CLAUDE_MODEL || 'claude-opus-5-5',
    effort: env.CLAUDE_EFFORT || 'medium',
    // Zinax Stock web app and the assistant's read-only token
    sheetUrl: env.SHEET_URL || '',
    botToken: env.ZINAX_BOT_TOKEN || '',
    dedupeMinutes: Number(env.MANAGER_DEDUPE_MINUTES || 60),
    // WhatsApp
    salesManager: env.SALES_MANAGER_JID || '',
    staffNumbers: list(env.STAFF_NUMBERS),
    team, // { sales: [...], accounts: [...], logistics: [...], complaints: [...], team: [...] }
    // Groups the assistant works in, by JID or by a word in the group name. With neither set it answers nowhere.
    allowedGroups: list(env.ALLOWED_GROUPS),
    allowedGroupNames: list(env.ALLOWED_GROUP_NAMES).map((s) => s.toLowerCase()),
    // Invoice check (report only, never answers in these groups): customers' purchase orders arrive as PDFs in the
    // request groups; a colleague's PDF in the invoice group is checked against its order; mismatches go to the
    // information group and a short warning to the invoice group. Words in the group names, any case.
    watchGroupNames: list(env.WATCH_GROUP_NAMES).map((x) => x.toLowerCase()),
    invoiceGroupName: (env.INVOICE_GROUP_NAME || '').trim().toLowerCase(),
    infoGroupName: (env.INFO_GROUP_NAME || '').trim().toLowerCase(),
    requestsDir: env.REQUESTS_DIR || '/opt/aryak-auth/requests',
    waitMinutes: Number(env.WAIT_MINUTES || 5),
    pairPhone: env.PAIR_PHONE || '', // the bot's own number, for a pairing code instead of a QR
    authDir: env.AUTH_DIR || './auth',
    kbDir: env.KB_DIR || './kb',
    // "Master Wood – ARYAK" -> "Master Wood"
    groupSuffix: env.GROUP_SUFFIX ? new RegExp(env.GROUP_SUFFIX, 'i') : /\s*[-–|:]\s*aryak.*$/i,
  };
  const missing = ['sheetUrl', 'botToken', 'salesManager'].filter((k) => !config[k]);
  if (!config.staffNumbers.length) missing.push('staffNumbers');
  return { config, missing };
}
