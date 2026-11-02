// One answer of the ARYAK assistant: Claude reads the customer's message (text and photos), checks stock with
// the check_stock tool and writes the reply. Returns null when the assistant must stay silent.

import { checkStockTool, runCheckStock } from './stock.js';

export const NO_REPLY = 'NO_REPLY';

/** The user turn: who is talking, the recent conversation, and the new customer message(s) with their photos. */
export function buildContent({ groupName, customer, transcript = [], messages, images = [] }) {
  const content = [];
  for (const img of images) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType || 'image/jpeg', data: img.base64 } });
  }
  const lines = [
    `WhatsApp group: ${groupName || '—'} (customer: ${customer || '—'})`,
    '',
    'Recent conversation, oldest first:',
    ...(transcript.length ? transcript : ['(none)']),
    '',
    `New message${messages.length > 1 ? 's' : ''} from the customer to answer:`,
    ...messages.map((m) => `[${m.senderName || 'Customer'}] ${m.text || ''}${m.hasImage ? ' (photo attached above)' : ''}`.trim()),
  ];
  content.push({ type: 'text', text: lines.join('\n') });
  return content;
}

const finalText = (res) => res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

/**
 * [client]: an Anthropic client. [config]: { model, effort, sheetUrl, botToken, dedupeMinutes }.
 * Returns { reply: string | null, managerTexts: string[], why }.
 */
export async function answer({ client, config, system, input, ctx, recent, fetchImpl, now }) {
  const messages = [{ role: 'user', content: buildContent(input) }];
  const stock = [];
  const managerTexts = [];
  let text = '';
  for (let round = 0; round < 6; round++) {
    const res = await client.beta.messages.create({
      model: config.model,
      max_tokens: 4000,
      system,
      tools: [checkStockTool],
      messages,
      output_config: { effort: config.effort || 'medium' },
      // On a safety decline the request is re-run on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (res.stop_reason === 'refusal') return { reply: null, managerTexts, why: 'refusal' };
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    const uses = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length) { text = finalText(res); break; }

    messages.push({ role: 'assistant', content: res.content });
    const results = [];
    for (const use of uses) {
      if (use.name !== checkStockTool.name) {
        results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Unknown tool', is_error: true });
        continue;
      }
      const r = await runCheckStock(use.input || {}, ctx, config, { fetchImpl, recent, now });
      stock.push(r);
      if (r.managerText) managerTexts.push(r.managerText);
      results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(r.forModel) });
    }
    messages.push({ role: 'user', content: results });
  }
  // Every code asked about is at or under its limit: nothing goes to the group, only the manager is told.
  if (stock.length && stock.every((r) => r.silent)) return { reply: null, managerTexts, why: 'low-stock' };
  if (!text || text.includes(NO_REPLY)) return { reply: null, managerTexts, why: 'no-reply' };
  return { reply: text, managerTexts, why: 'answered' };
}
