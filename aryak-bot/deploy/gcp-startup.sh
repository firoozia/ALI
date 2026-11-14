#!/bin/bash
# Runs as root on every boot of the Google Cloud VM: installs or updates the ARYAK Assistant and starts it.
# The service is NOT enabled at boot: only this script starts it, after the code is updated, so the bot never runs old code beside the update (and never two at once).
# One hard rule: the bot must never stay down because of the update. A failed fetch, reset, npm or metadata read is logged and the service is still started with what is on disk.
set -u
say() { echo "aryak-startup: $*"; }
# idempotent: safe on every boot, also when the unit is already disabled or does not exist yet
systemctl disable aryak-bot >/dev/null 2>&1 || true
md() { curl -sf -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"; }
BRANCH="$(md BOT_BRANCH || echo claude/zinax-warehouse-barcode-6sv8m6)"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  apt-get update -y && apt-get install -y curl git ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
command -v git >/dev/null || apt-get install -y git

if [ -d /opt/ALI/.git ]; then
  if timeout 180 git -C /opt/ALI fetch --depth 1 origin "$BRANCH" && git -C /opt/ALI reset --hard FETCH_HEAD; then
    say "code updated: $(git -C /opt/ALI log -1 --format='%h %s' 2>/dev/null)"
  else
    say "UPDATE FAILED (git fetch or reset): the bot starts with the code already on disk ($(git -C /opt/ALI log -1 --format='%h' 2>/dev/null))"
  fi
elif ! timeout 300 git clone --depth 1 -b "$BRANCH" https://github.com/firoozia/ALI.git /opt/ALI; then
  say "UPDATE FAILED (git clone): there is no code on disk yet"
fi
cd /opt/ALI/aryak-bot 2>/dev/null || say "the bot folder is missing"
# the packages are installed only when the lock file changed (npm ci empties node_modules first, so a failure would leave the bot without packages)
lockhash="$(sha256sum package-lock.json 2>/dev/null | cut -d' ' -f1)"
if [ -d node_modules ] && [ -n "$lockhash" ] && [ "$lockhash" = "$(cat /opt/.aryak-lock-hash 2>/dev/null)" ]; then
  say "packages unchanged"
elif timeout 600 npm ci --omit=dev; then
  echo "$lockhash" > /opt/.aryak-lock-hash; say "packages installed"
else
  say "UPDATE FAILED (npm ci): trying npm install once, then starting anyway"
  timeout 600 npm install --omit=dev || say "UPDATE FAILED (npm install): the bot starts with the packages on disk"
fi

# Settings come from the VM's metadata (Compute Engine > VM > Edit > Metadata), never from the repository.
: > .env.new
for k in ANTHROPIC_API_KEY CLAUDE_MODEL CLAUDE_EFFORT SHEET_URL ZINAX_BOT_TOKEN PAIR_PHONE SALES_MANAGER_JID \
         STAFF_NUMBERS TEAM_TAGS ALLOWED_GROUP_NAMES ALLOWED_GROUPS HELLO_ONCE LEARNING LEARN_REPORT_WEEKDAY TRACKER CUT_GROUP_NAME DELIVERY_GROUP_NAME CONFIRM_GROUP_NAME GOODS_GROUP_NAMES TEST_GROUP_NAMES OWNER_INVOICE_SEND OWNER_TEACH QBO_CLIENT_ID QBO_CLIENT_SECRET QBO_ENV QBO_REALM_ID QBO_REFRESH_TOKEN_INIT QBO_WRITE QBO_MINOR_VERSION QBO_REDIRECT_URI QBO_TAX_CODE VISION_MODEL VISION_ESCALATE_MODEL COST_PRICES COST_SPEECH_USD_PER_MIN QBO_CUSTOMER_EMAIL QBO_ITEM_TAX_CODE TEST_CUSTOMER_NAME INVOICE_NAME_LINE TRACK_MODEL CUT_TRACKING COST_MODEL_USD COST_VISION_USD COST_SPEECH_USD SHADOW_GROUP_NAMES SHADOW_MEDIA SHADOW_MERGE_SECONDS SHADOW_CARD_CAP SHADOW_DAILY_MODEL_CALLS SHADOW_CARD_GAP_SECONDS SHADOW_COMPARE_MINUTES INFO_GAP_SECONDS SHEET_RECHECK_HOUR SHEET_DIGEST_MAX REMINDERS CUT_TOLERANCE_METRES OWNER_NUMBERS OBSERVE_GROUP_NAMES OBSERVE_EXCLUDE_NAMES ALLOW_CUSTOMER_GROUP_SENDS MORNING_GROUP_NAMES MORNING_TIME MORNING_CATCHUP_UNTIL MORNING_OFF_DAYS MORNING_WEEKEND_DAYS MORNING_DAILY_CAP MORNING_GAP_MIN_SECONDS MORNING_GAP_MAX_SECONDS ORDER_NAG_HOURS DELIVERY_NAG_HOURS STATEMENT_DAY AVAILABILITY_FLOW VAT_RATE MONEY_TOLERANCE DIGEST_HOUR TIMEZONE IMAGE_CONFIRM VOICE SPEECH_LANGUAGES SPEECH_MIN_CONFIDENCE BOT_DISPLAY_NAME ADMIN_NUMBERS STAFF_GROUP_NAMES COMMAND_GROUP_NAMES BOT_NAMES WATCH_GROUP_NAMES INVOICE_GROUP_NAME INFO_GROUP_NAME WAIT_MINUTES MANAGER_DEDUPE_MINUTES REPLY_LANGUAGE QBO_INVOICE_TEMPLATE EVENING_REPORT_HOUR EVENING_REPORT_TO EXPENSES_GROUP_NAME EXPENSES_REPORT_HOUR RECEIPT_VISION MONITOR_FROM SOCIAL META_IG_TOKEN META_IG_USER_ID META_IG_USERNAME META_PAGE_ID META_PAGE_TOKEN META_GRAPH_VERSION SOCIAL_POLL_MINUTES SOCIAL_BRAND SOCIAL_CONTACT; do
  v="$(md "$k" || true)"
  [ -n "$v" ] && printf '%s=%s\n' "$k" "$v" >> .env.new
done
echo 'AUTH_DIR=/opt/aryak-auth' >> .env.new
chmod 600 .env.new
if grep -q '^ANTHROPIC_API_KEY=' .env.new; then
  mv -f .env.new .env; say "settings written from the VM metadata"
else
  rm -f .env.new; say "METADATA NOT READ: the settings of the last start are kept"
fi
# "gcp.sh relink" changes RESET_AUTH: forget the WhatsApp login once, so a new number can be linked.
reset="$(md RESET_AUTH || true)"
if [ -n "$reset" ] && [ "$reset" != "$(cat /opt/.aryak-reset 2>/dev/null)" ]; then
  rm -rf /opt/aryak-auth && echo "$reset" > /opt/.aryak-reset
fi
mkdir -p /opt/aryak-auth

cat > /etc/systemd/system/aryak-bot.service <<'UNIT'
[Unit]
Description=ARYAK Assistant
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/ALI/aryak-bot
ExecStart=/usr/bin/node --env-file=.env src/index.js
Restart=always
RestartSec=10
# The pairing code is printed here too, so it can be read from the serial port in the Cloud Console.
StandardOutput=journal+console
StandardError=journal+console

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl disable aryak-bot >/dev/null 2>&1 || true # not at boot: only this script starts it (idempotent)
if systemctl restart aryak-bot; then
  say "service aryak-bot started by the startup script (code $(git -C /opt/ALI log -1 --format='%h' 2>/dev/null))"
else
  say "START FAILED: systemctl restart aryak-bot returned an error"
fi
