// Settings from the environment (or a .env file loaded by the process manager).

import { nameMode } from './nameline.js';

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
    // The team: numbers allowed to give commands (the bot's own phone always may), groups where colleagues are answered
    // when they address the bot (words in the group names; never customer groups), the command group, and the bot's names.
    adminNumbers: list(env.ADMIN_NUMBERS),
    staffGroupNames: list(env.STAFF_GROUP_NAMES).map((x) => x.toLowerCase()),
    commandGroupNames: list(env.COMMAND_GROUP_NAMES).map((x) => x.toLowerCase()),
    // The assistant's name: how she introduces herself and signs, and the first word colleagues call her by.
    displayName: (env.BOT_DISPLAY_NAME || 'آتوسا').trim(),
    botNames: (env.BOT_NAMES ? list(env.BOT_NAMES) : [env.BOT_DISPLAY_NAME || 'آتوسا', 'atossa', 'دستیار']).map((x) => x.toLowerCase()),
    // Voice notes: speech-to-text languages (the first is the main one, up to three more are alternatives), the lowest
    // confidence accepted, and a switch (VOICE=off keeps the old behaviour: voice notes are ignored).
    voiceEnabled: (env.VOICE || 'on').toLowerCase() !== 'off',
    speechLanguages: env.SPEECH_LANGUAGES ? list(env.SPEECH_LANGUAGES) : ['fa-IR', 'ar-AE', 'en-IN', 'ur-PK'],
    speechMinConfidence: Number(env.SPEECH_MIN_CONFIDENCE || 0.5),
    timezone: env.TIMEZONE || 'Asia/Dubai', // the day boundaries the team means by "today"
    // Photos: read with Claude's vision and confirmed with the sender before anything is done (IMAGE_CONFIRM=off keeps the
    // old behaviour: the answering model looks at customers' photos itself).
    imageConfirm: (env.IMAGE_CONFIRM || 'on').toLowerCase() !== 'off',
    // Invoice audit: VAT percent, money tolerance for rounding, the hour of the daily summary (local time).
    vatRate: Number(env.VAT_RATE || 5),
    moneyTolerance: Number(env.MONEY_TOLERANCE || 0.05),
    digestHour: Number(env.DIGEST_HOUR || 18),
    // The customer availability flow (ask the quantity, answer or ask the sales manager); AVAILABILITY_FLOW=off keeps the old answer.
    availabilityFlow: (env.AVAILABILITY_FLOW || 'on').toLowerCase() !== 'off',
    // The supervised pipeline: where goods are cut, where they are delivered, and the money side (a word of each group's name).
    trackerEnabled: (env.TRACKER || 'on').toLowerCase() !== 'off',
    cutGroupName: (env.CUT_GROUP_NAME || '').trim().toLowerCase(),
    deliveryGroupName: (env.DELIVERY_GROUP_NAME || '').trim().toLowerCase(),
    confirmGroupName: (env.CONFIRM_GROUP_NAME || '').trim().toLowerCase(),
    // groups of countable goods (accessories, saw blades, glue): a word of each name, comma separated
    // groups for live tests: the account's own messages run the real paths there, the reports stay in the group and nothing enters the real tracker
    testGroupNames: (env.TEST_GROUP_NAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    // the good-morning message: only the groups listed here (empty = nothing is ever sent)
    morningGroupNames: (env.MORNING_GROUP_NAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    morningTime: (env.MORNING_TIME || '08:30').trim(),
    morningCatchUpUntil: (env.MORNING_CATCHUP_UNTIL || '10:00').trim(),
    morningOffDays: (env.MORNING_OFF_DAYS || 'friday').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    morningWeekendDays: (env.MORNING_WEEKEND_DAYS || 'thursday').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    morningDailyCap: Number(env.MORNING_DAILY_CAP || 40),
    morningGapMin: Number(env.MORNING_GAP_MIN_SECONDS || 20),
    morningGapMax: Number(env.MORNING_GAP_MAX_SECONDS || 60),
    // people: the owner gets Persian, every other staff member English, customers the language they wrote in
    ownerNumbers: list(env.OWNER_NUMBERS),
    // customer groups to WATCH and learn from (read only, never a reply); internal and configured groups are excluded automatically
    observeGroupNames: (env.OBSERVE_GROUP_NAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    observeExcludeNames: (env.OBSERVE_EXCLUDE_NAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    // customer groups are never written to unless this is switched on
    allowCustomerGroupSends: /^(1|true|on|yes)$/i.test(env.ALLOW_CUSTOMER_GROUP_SENDS || ''),
    // the Information group: gap between its messages (a batch of invoices is not a burst); reminders are off until the owner decides
    infoGapSeconds: Number(env.INFO_GAP_SECONDS || 6),
    remindersOn: /^(1|true|on|yes)$/i.test(env.REMINDERS || ''),
    sheetRecheckHour: Number(env.SHEET_RECHECK_HOUR || 9),
    sheetDigestMax: Number(env.SHEET_DIGEST_MAX || 2),
    cutToleranceMetres: Number(env.CUT_TOLERANCE_METRES || 0.5),
    // SHADOW mode: customer groups whose answers she writes into the test group instead of sending (empty = off)
    shadowGroupNames: (env.SHADOW_GROUP_NAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    shadowMedia: /^(1|true|on|yes)$/i.test(env.SHADOW_MEDIA || ''),
    shadowMergeMs: Number(env.SHADOW_MERGE_SECONDS || 120) * 1000,
    shadowCardCap: Number(env.SHADOW_CARD_CAP || 60),
    shadowDailyCalls: Number(env.SHADOW_DAILY_MODEL_CALLS || 400),
    shadowCardGapSeconds: Number(env.SHADOW_CARD_GAP_SECONDS || 20),
    shadowCompareMinutes: Number(env.SHADOW_COMPARE_MINUTES || 60),
    // cost control in the tracked internal groups (cut, delivery, confirmation, goods): the free caption reader always runs, the model
    // fallback (a photo or an unreadable caption sent to the model) only when TRACK_MODEL is on; CUT_TRACKING=off stops the cut reading too
    trackModel: /^(1|true|on|yes)$/i.test(env.TRACK_MODEL || ''),
    cutTracking: !/^(0|false|off|no)$/i.test(env.CUT_TRACKING || 'on'),
    costModelUsd: Number(env.COST_MODEL_USD || 0.01),
    costVisionUsd: Number(env.COST_VISION_USD || 0.012),
    costSpeechUsd: Number(env.COST_SPEECH_USD || 0.016),
    // an invoice with a meaningless file name is re-posted with the number and customer printed on it: file (default), line, off
    invoiceNameMode: nameMode(env.INVOICE_NAME_LINE),
    // the owner can order an invoice to be sent into the customer's own group (his yes needed); the test customer goes to the test group
    ownerInvoiceSend: !/^(0|false|off|no)$/i.test(env.OWNER_INVOICE_SEND || 'on'),
    // the owner can teach her in one sentence in his own chat (aliases, customer groups, watched groups, rules, terms); every change needs his yes
    ownerTeach: !/^(0|false|off|no)$/i.test(env.OWNER_TEACH || 'on'),
    // QuickBooks Online (read only in this stage). The keys come from the VM's metadata; none of them is ever logged or sent anywhere but Intuit.
    qboClientId: (env.QBO_CLIENT_ID || '').trim(),
    qboClientSecret: (env.QBO_CLIENT_SECRET || '').trim(),
    qboEnv: /^production$/i.test((env.QBO_ENV || '').trim()) ? 'production' : 'sandbox',
    qboRealmId: (env.QBO_REALM_ID || '').trim(),
    qboRefreshInit: (env.QBO_REFRESH_TOKEN_INIT || '').trim(), // used once; after that the rotating token lives in a file under authDir
    qboWrite: /^(1|true|on|yes)$/i.test((env.QBO_WRITE || '').trim()), // off: no write to QuickBooks is possible
    qboMinorVersion: Number(env.QBO_MINOR_VERSION) || 75,
    testCustomerName: (env.TEST_CUSTOMER_NAME || 'test customer').trim().toLowerCase(),
    goodsGroupNames: (env.GOODS_GROUP_NAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    orderNagHours: Number(env.ORDER_NAG_HOURS || 24),
    deliveryNagHours: Number(env.DELIVERY_NAG_HOURS || 48),
    statementDay: Number(env.STATEMENT_DAY || 1),
    // Learning from the groups (counters and anonymous shapes only); LEARNING=off, or the owner's command, stops it.
    learning: (env.LEARNING || 'on').toLowerCase() !== 'off',
    learnReportWeekday: Number(env.LEARN_REPORT_WEEKDAY ?? 1), // 0 = Sunday, 1 = Monday
    helloOnce: (env.HELLO_ONCE || '').trim(), // a new value sends one greeting to the bot's own number
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
