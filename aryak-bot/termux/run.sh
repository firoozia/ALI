#!/data/data/com.termux/files/usr/bin/bash
# Keeps the assistant running: stops the phone sleeping and restarts the bot if it ever exits.
cd "$(dirname "$0")/.."
termux-wake-lock 2>/dev/null || true
while true; do
  node --env-file=.env src/index.js
  echo "$(date) bot stopped, restarting in 10 s"
  sleep 10
done
