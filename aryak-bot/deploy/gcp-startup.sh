#!/bin/bash
# Runs as root on every boot of the Google Cloud VM: installs or updates the ARYAK Assistant and starts it.
set -u
md() { curl -sf -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"; }
BRANCH="$(md BOT_BRANCH || echo claude/zinax-warehouse-barcode-6sv8m6)"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  apt-get update -y && apt-get install -y curl git ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
command -v git >/dev/null || apt-get install -y git

if [ -d /opt/ALI/.git ]; then
  git -C /opt/ALI fetch --depth 1 origin "$BRANCH" && git -C /opt/ALI reset --hard FETCH_HEAD
else
  git clone --depth 1 -b "$BRANCH" https://github.com/firoozia/ALI.git /opt/ALI
fi
cd /opt/ALI/aryak-bot && npm ci --omit=dev

# Settings come from the VM's metadata (Compute Engine > VM > Edit > Metadata), never from the repository.
: > .env
for k in ANTHROPIC_API_KEY CLAUDE_MODEL CLAUDE_EFFORT SHEET_URL ZINAX_BOT_TOKEN PAIR_PHONE SALES_MANAGER_JID \
         STAFF_NUMBERS TEAM_TAGS ALLOWED_GROUP_NAMES ALLOWED_GROUPS HELLO_ONCE LEARNING LEARN_REPORT_WEEKDAY TRACKER CUT_GROUP_NAME DELIVERY_GROUP_NAME CONFIRM_GROUP_NAME GOODS_GROUP_NAMES TEST_GROUP_NAMES INFO_GAP_SECONDS SHEET_RECHECK_HOUR SHEET_DIGEST_MAX REMINDERS CUT_TOLERANCE_METRES OWNER_NUMBERS OBSERVE_GROUP_NAMES OBSERVE_EXCLUDE_NAMES ALLOW_CUSTOMER_GROUP_SENDS MORNING_GROUP_NAMES MORNING_TIME MORNING_CATCHUP_UNTIL MORNING_OFF_DAYS MORNING_WEEKEND_DAYS MORNING_DAILY_CAP MORNING_GAP_MIN_SECONDS MORNING_GAP_MAX_SECONDS ORDER_NAG_HOURS DELIVERY_NAG_HOURS STATEMENT_DAY AVAILABILITY_FLOW VAT_RATE MONEY_TOLERANCE DIGEST_HOUR TIMEZONE IMAGE_CONFIRM VOICE SPEECH_LANGUAGES SPEECH_MIN_CONFIDENCE BOT_DISPLAY_NAME ADMIN_NUMBERS STAFF_GROUP_NAMES COMMAND_GROUP_NAMES BOT_NAMES WATCH_GROUP_NAMES INVOICE_GROUP_NAME INFO_GROUP_NAME WAIT_MINUTES MANAGER_DEDUPE_MINUTES; do
  v="$(md "$k" || true)"
  [ -n "$v" ] && printf '%s=%s\n' "$k" "$v" >> .env
done
echo 'AUTH_DIR=/opt/aryak-auth' >> .env
chmod 600 .env
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
systemctl enable aryak-bot
systemctl restart aryak-bot
