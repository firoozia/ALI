#!/bin/bash
# ARYAK Assistant on Google Cloud. Run in Google Cloud Shell (console.cloud.google.com, the >_ button):
#   bash <(curl -s https://raw.githubusercontent.com/firoozia/ALI/claude/zinax-warehouse-barcode-6sv8m6/aryak-bot/deploy/gcp.sh)
# Then:  ... gcp.sh code      show the WhatsApp pairing code again
#        ... gcp.sh restart   restart the bot (also updates it to the latest version)
#        ... gcp.sh logs      last lines the bot printed
#        ... gcp.sh relink    forget the WhatsApp login and link again (e.g. the new SIM; change PAIR_PHONE first)
set -euo pipefail
NAME=aryak-bot
ZONE=us-central1-a   # e2-micro in us-central1 is in Google Cloud's free tier
RAW=https://raw.githubusercontent.com/firoozia/ALI/claude/zinax-warehouse-barcode-6sv8m6/aryak-bot/deploy

project="$(gcloud config get-value project 2>/dev/null || true)"
if [ -z "$project" ]; then
  gcloud projects list --format='value(projectId)'
  read -rp "Project ID to use: " project
  gcloud config set project "$project"
fi

serial() { gcloud compute instances get-serial-port-output "$NAME" --zone "$ZONE" 2>/dev/null || true; }
show_code() {
  echo "Waiting for the pairing code (a few minutes on the first start)..."
  for _ in $(seq 1 60); do
    code="$(serial | grep -o 'PAIRING CODE: [A-Z0-9-]*' | tail -1 | cut -d' ' -f3)"
    if [ -n "$code" ]; then
      echo
      echo "   PAIRING CODE:  $code"
      echo "   On the bot's phone: WhatsApp > Linked devices > Link a device > Link with phone number instead"
      echo "   If it expires, run this again with: code"
      return
    fi
    if serial | grep -q 'connected to WhatsApp'; then echo "Already linked: the bot is connected to WhatsApp."; return; fi
    sleep 10
  done
  echo "No code yet. Run again with: code   (or: logs)"
}

case "${1:-install}" in
  code) show_code; exit ;;
  logs) serial | grep -a 'aryak\|node\|PAIRING\|connected\|Missing\|ERROR\|answered\|low-stock\|no-reply' | tail -40; exit ;;
  restart) gcloud compute instances reset "$NAME" --zone "$ZONE" --quiet; show_code; exit ;;
  relink)
    gcloud compute instances add-metadata "$NAME" --zone "$ZONE" --metadata RESET_AUTH="$(date +%s)"
    gcloud compute instances reset "$NAME" --zone "$ZONE" --quiet; show_code; exit ;;
esac

echo "ARYAK Assistant: setting up a server in project $project"
read -rsp "Claude API key (sk-ant-...): " KEY; echo
read -rp  "Zinax Stock web app URL (ends in /exec): " SHEET
read -rp  "Token for the AI assistant (from the Apps Script log): " BOTTOKEN
read -rp  "Bot WhatsApp number [971557699100]: " PHONE; PHONE="${PHONE:-971557699100}"
read -rp  "Sales manager number for stock alerts [$PHONE]: " MANAGER; MANAGER="${MANAGER:-$PHONE}"

tmp="$(mktemp -d)"
curl -sf "$RAW/gcp-startup.sh" -o "$tmp/startup.sh"
printf '%s' "$KEY" > "$tmp/key"
printf '%s' "{\"team\":[\"$MANAGER\"]}" > "$tmp/team"

gcloud services enable compute.googleapis.com
gcloud compute instances create "$NAME" --zone "$ZONE" --machine-type e2-micro \
  --image-family debian-12 --image-project debian-cloud --boot-disk-size 30GB --boot-disk-type pd-standard \
  --metadata-from-file startup-script="$tmp/startup.sh",ANTHROPIC_API_KEY="$tmp/key",TEAM_TAGS="$tmp/team" \
  --metadata "^|^SHEET_URL=$SHEET|ZINAX_BOT_TOKEN=$BOTTOKEN|PAIR_PHONE=$PHONE|SALES_MANAGER_JID=$MANAGER@s.whatsapp.net|STAFF_NUMBERS=971528493119,971581671909,971566224371|ALLOWED_GROUP_NAMES=TEST ARYAK BOT|WAIT_MINUTES=1|CLAUDE_MODEL=claude-opus-5-5|CLAUDE_EFFORT=medium"
rm -rf "$tmp"
echo "Server created. Installing the bot on it..."
show_code
