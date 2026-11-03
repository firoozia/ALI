#!/data/data/com.termux/files/usr/bin/bash
# ARYAK Assistant on an Android phone (Termux). Run once from the unzipped aryak-bot folder:
#   bash termux/install.sh
set -e
cd "$(dirname "$0")/.."
BOT_DIR="$(pwd)"
pkg update -y
pkg install -y nodejs-lts termux-api
npm install --omit=dev
# Start again after the phone restarts (needs the Termux:Boot app, opened once).
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/aryak-bot.sh <<EOF
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
cd "$BOT_DIR"
bash termux/run.sh >> "$BOT_DIR/bot.log" 2>&1
EOF
chmod +x ~/.termux/boot/aryak-bot.sh termux/run.sh
echo
echo "Installed. Fill in .env, then start with:  bash termux/run.sh"
