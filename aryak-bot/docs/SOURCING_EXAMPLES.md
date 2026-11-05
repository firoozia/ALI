# Sourcing: our staff asks a customer for goods

Direction is reversed: OUR staff writes in a customer's group and the customer is the supplier. Such a message is never an
order and never a sale. It is kept as an open sourcing event and shown in the daily digest.

Examples (owner's words welcome here; the phrase lists are `ASK_PHRASES` in `src/sourcing.js`):

- "Do you have 603 20 m available? We need it for Bahar"  -> request: code 603, 20 m, for Bahar
- "Can you give us 408 - 15 mtr"                          -> request
- "عندكم 505 كم متر؟"                                      -> request
- Customer: "yes, 20 m" / "603 - 20 mtr" / "no"           -> the ANSWER (not an order)
- Staff: "509 16 meter available" right after a customer asked about 509 -> a staff answer, not a request

When the goods arrive ("received" in a goods group), or an invoice for the other customer appears with that code, the note says
the line was covered by sourcing.
