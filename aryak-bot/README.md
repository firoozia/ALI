# ARYAK Assistant

AI assistant for ARYAK customer groups on WhatsApp: Node.js + Baileys + Claude API, connected to Zinax Stock.

## What it does
- Answers **customer** messages only, in the customer's language (Arabic, English, Urdu, Persian).
- Waits `WAIT_MINUTES` (default 5). If a colleague writes in the group meanwhile, it stays silent.
- Prices, discounts, orders, delivery dates and complaints are handed over with a mention of the right colleagues
  (`TEAM_TAGS`); anything it is not sure of is handed over too.
- **Photos:** reads product codes handwritten on paper or in a catalogue photo and treats them as typed.
  Unreadable photo: no reply. Some codes unclear: answers the clear ones and asks for the rest to be typed.
  A code read from a photo that is not in the catalogue is treated as misread.
- **Stock** (`check_stock` tool, `src/stock.js`): "available" only when free stock (not reserved) is above the
  quantity asked plus `BotLimit`. Otherwise nothing is said about that code; the sales manager gets a private
  message with the real figures (once an hour per code and group). If every code asked about is low, the bot
  does not reply at all. Claude never sees a quantity.

## Files
- `src/index.js` WhatsApp connection and message handling
- `src/gate.js` who is staff, the waiting time, the recent conversation
- `src/assistant.js` one answer: Claude call, photos, tool loop, silence rules
- `src/stock.js` stock check against the sheet and the manager message
- `src/prompt.js` the system prompt (rules); product knowledge and FAQ from `kb/*.md`
- `src/tags.js` `[TAG:sales]` etc. to WhatsApp mentions

## Setup
1. Zinax Stock: replace `Code.gs`, run `setup` once, copy **Token for the AI assistant**, deploy a new version,
   fill **BotLimit** in the Products tab (and per group in the Groups tab).
2. On a server with Node 18+: `npm install`, copy `.env.example` to `.env` and fill it.
3. `node --env-file=.env src/index.js`. The first time it prints a pairing code: on the bot's phone open
   WhatsApp → Linked devices → Link with phone number and enter it. The login is kept in `auth/`.
4. Add the bot's number to the customer groups.

`npm test` runs the tests (no network, no WhatsApp, no API key).

## Note
Baileys is not an official WhatsApp API; WhatsApp may block a number it treats as automated. Use a separate
SIM, keep volume low, and keep the bot to the groups it serves (`ALLOWED_GROUPS`).
