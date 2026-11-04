# Pattern file for the learning review list

A person who has read the owner's business chats (read-only) can hand the assistant what was learned as ONE JSON file.
Put it on the VM as `<auth folder>/import/patterns.json` and the owner sends the command «بارگذاری الگوها».
Every entry goes to the **review list**; nothing is applied until the owner approves it («بپذیر 3»). Nothing is read from
the file except the fields below, and every text is cut down to a **shape** again on the way in.

## What must NOT be in it
Phone numbers, amounts, prices, bank or card data, personal names, addresses, links, message texts. Customer or business
names only in `aliasSuggestions` and only with `"approvedByOwner": true`. Personal chats are not part of this at all.

## Format (version 1)

```json
{
  "version": 1,
  "source": "owner-business-chats-review",
  "createdAt": "2026-11-05",
  "phrasings": [
    { "lang": "en", "shape": "kindly _ please", "answerType": "yes", "count": 8 }
  ],
  "routing": [
    { "trigger": "# - # mtr", "to": "Aryak Orders Pictures", "count": 40 }
  ],
  "answerShapes": [
    { "intent": "availability", "lang": "en", "answerType": "limited", "count": 10 }
  ],
  "aliasSuggestions": [
    { "customer": "Master Wood", "aliases": ["Master Wood Carpentry", "ماستر وود"], "approvedByOwner": true }
  ]
}
```

- **shape**: a message reduced to its pattern. Only these words survive: the small vocabulary of the assistant (available,
  stock, please, add, also, mtr, meter, roll, invoice, send, code, yes, no, sorry, limited, thanks, …, and their Arabic,
  Persian and Urdu equivalents). A number is `#`, any other word is `_`, punctuation `? , . - !` is kept. Example:
  `# available ?`, `please add # - # mtr also`, `_ , # - # mtr`. A shape of only `_` and `#` is dropped.
- **lang**: `fa`, `ar`, `en`, `ur` or `hi`.
- **answerType**: what a colleague answered with: `yes`, `no`, `limited`, `quantity`, `ask`, `file`, `other`.
- **intent** (answerShapes): `availability`, `order`, `addon`, `invoice`, `delivery`, `payment`, `complaint`, `thanks`,
  `question`, `other`.
- **routing**: a request shape (`trigger`) usually posted into the group named in `to` (letters, digits and spaces only).
- **count**: how many times it was seen (1 to 10000).
- Anything with another `version`, a wrong `lang`, `intent` or `answerType`, or an empty shape is skipped and counted in
  the answer to the command.

## What the owner sees
«بارگذاری الگوها» answers with the numbers added to the review list and skipped. «پیشنهادهای یادگیری» lists them
(marked as coming from an outside file). Approved ones become lines in the prompt (versioned, with rollback), approved
aliases become names the assistant matches («اسم‌های دیگر»).
