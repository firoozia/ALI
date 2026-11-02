# ARYAK assistant — stock check

Part of the ARYAK WhatsApp assistant (Node.js + Baileys + Claude API). This folder holds the stock check against
Zinax Stock; the rest of the bot (knowledge base, FAQ, system prompt, WhatsApp wiring) is added once the open
questions about products and delivery are answered.

## How it behaves
- A customer asks whether a code is available. The model calls the `check_stock` tool (`src/stock.js`).
- The sheet (`botStock` action in `zinax-stock/apps-script/Code.gs`) adds up **free** stock of the code:
  in stock and not reserved. With no size, all sizes count and their limits add up; with a size, only that size.
- **Available** only when free stock > quantity asked + `BotLimit`. A quantity in rolls or cartons is turned into
  metres or pieces with the product's PackQty; when that is unknown the answer is "not available".
- Available: the model is told `available` and says so, **never a quantity**.
- Otherwise: the bot says **nothing** in the group and sends the sales manager a private message with the
  real figures (free, reserved, limit, per size, places, the customer's words). The same code in the same group
  is reported at most once an hour.
- Unknown code, a code in two product groups, or a size we do not carry: the model asks or hands over.

## Setup
1. Replace `Code.gs` in Apps Script, run `setup` once, copy **Token for the AI assistant** from the log,
   then Deploy → Manage deployments → New version.
2. In the sheet, fill **BotLimit** in the **Products** tab (per code and size, in the product's unit), and
   optionally in the **Groups** tab as the default for products of that group with no BotLimit.
3. Bot settings: `SHEET_URL` (the web app URL ending in /exec), `ZINAX_BOT_TOKEN`, `SALES_MANAGER_JID`
   (the manager's WhatsApp, e.g. `9715XXXXXXXX@s.whatsapp.net`).

## Wiring in the bot
When the model returns a `tool_use` for `check_stock`, call
`runCheckStock(input, { groupId, groupName, customer, messageText }, config, { recent })`
with one shared `recent` Map, send `result.forModel` back as the tool result, then:
- if `result.managerText`, send it to `SALES_MANAGER_JID`;
- if `result.silent`, do **not** post the model's reply in the group.

`npm test` runs the tests (Node 18+, no dependencies).
