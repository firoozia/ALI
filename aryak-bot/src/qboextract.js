// READING A FREE-FORM INVOICE REQUEST. The owner (or an authorized person) may write the request in any layout: "اتوسا فاکتور بساز مشتری برای / Ar-rad /
// Code 108 / 32.5m / 12 aed / ...", one value per line, several per line, with units and currency words. The model only EXTRACTS what is written
// into a strict JSON shape; it never decides a customer or an item, computes nothing and invents nothing (a value that is not written stays empty).
// Everything after that is the same deterministic matching, preview and owner's yes as for the strict format. One paid call, only for the owner's
// and the authorized people's own messages.

const SYSTEM = `You extract an invoice request from a message written by a colleague of a company that sells PVC film, edge banding and hardware. Reply with JSON only:
{"customer": string|null, "lines": [{"item": string|null, "qty": number|null, "price": number|null}], "unsure": [string]}
Rules:
- customer: the customer's name exactly as written (without words like "customer" or "for"). null if there is none.
- lines: one entry per product. item: the product code or name exactly as written, without the word "code". qty: the quantity as a number; ignore units such as m, meter, pcs, roll. price: the UNIT price as a number if one is written for that product; ignore currency words (aed, dirham). If a price is not written, price is null.
- A quantity can be in words: «یک» 1, «دو تا» 2, «سه عدد» 3, «چهار» 4, «پنج» 5, «ده» 10, "two", "three" (also Arabic and Urdu words). «تا» and «عدد» only count the pieces.
- Packaging words («گالن ۲۵ کیلویی», «کارتن», «رول», «بسته», "25 kg gallon", "carton") say how the product is packed; they are NOT the product and not a multiplier of the quantity. "item" is the product name or code WITHOUT them (for «دو تا گالن ۲۵ کیلویی GLUE JOWAT» the item is "GLUE JOWAT" and qty is 2).
- A product may be given by NAME (not a code): copy the name as written, without the packaging words.
- A price can be in words: «به قیمت هر عدد ۱۵۰۰ درهم», «هر کدام ۱۵۰۰», «هر گالن ۱۵۰۰», "1500 each": price 1500 (the price of ONE piece); ignore the currency word. A total («جمعاً ۳۰۰۰») is not a unit price: leave price null and add a note to "unsure".
- The words «فاکتور کن», «فاکتور بزن», «برای من بفرست» only say what to do; they are not part of the customer or the product.
- The layout can be anything: all values on one line, or one value per line, in Persian, English or mixed. Group the values of one product together in the order written.
- Never invent, convert, compute or correct anything. If a value is not written, use null. If something is unclear (a quantity with no product, a product with no quantity, an odd count of values), add a short note to "unsure" and do not guess.`;

/** One paid call: the message -> { customer, lines, unsure } or null. */
export async function extractInvoiceRequest({ client, config, text }) {
  const res = await client.beta.messages.create({ model: config.model, max_tokens: 1500, system: SYSTEM, messages: [{ role: 'user', content: String(text).slice(0, 4000) }], output_config: { effort: 'low' } });
  const out = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const m = /\{[\s\S]*\}/.exec(out);
  if (!m) return null;
  try { return validateExtraction(JSON.parse(m[0])); } catch { return null; }
}

/** The extraction checked in code: only well-formed values pass; anything else becomes a note. Returns { customer, lines, unsure }. */
export function validateExtraction(raw) {
  const unsure = (Array.isArray(raw?.unsure) ? raw.unsure : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 160)).slice(0, 6);
  const customer = typeof raw?.customer === 'string' && raw.customer.trim() ? raw.customer.trim().slice(0, 120) : null;
  const lines = [];
  const list = Array.isArray(raw?.lines) ? raw.lines.slice(0, 40) : [];
  list.forEach((l, i) => {
    const item = typeof l?.item === 'string' && l.item.trim() ? l.item.trim().slice(0, 100) : null;
    const qty = typeof l?.qty === 'number' && Number.isFinite(l.qty) && l.qty > 0 ? l.qty : null;
    const priceGiven = l?.price !== null && l?.price !== undefined;
    const price = priceGiven && typeof l.price === 'number' && Number.isFinite(l.price) && l.price >= 0 ? l.price : null;
    if (priceGiven && price === null) { unsure.push(`ردیف ${i + 1}: قیمت درست نیست`); return; } // a bad price is never replaced by a default
    if (!item || !qty) { unsure.push(`ردیف ${i + 1}: ${item ? `تعداد کالای «${item}» نوشته نشده` : 'کالا مشخص نیست'}`); return; }
    lines.push({ item, qty, price });
  });
  return { customer, lines, unsure };
}
