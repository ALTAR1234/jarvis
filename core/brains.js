// Second brains for J.A.R.V.I.S.: Claude (Anthropic SDK) and ChatGPT (OpenAI API), alongside Gemini.
// Requests arrive as Gemini-style parts ({ text } or { inlineData: { mimeType, data } }) and are
// translated for each provider, so Helper, Inboxer, Visioner and chat can use any of them.
const Anthropic = require('@anthropic-ai/sdk');

const CLAUDE_MODEL = () => process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const OPENAI_MODEL = () => process.env.OPENAI_MODEL || 'gpt-5';
const available = () => ({ gemini: Boolean(process.env.GEMINI_API_KEY), claude: Boolean(process.env.ANTHROPIC_API_KEY), chatgpt: Boolean(process.env.OPENAI_API_KEY) });

let client = null;
const claude = () => (client ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120000 }));

// pull the JSON object out of a reply (models sometimes wrap it in a code fence)
function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*|```$/g, '');
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) try { return JSON.parse(t.slice(a, b + 1)); } catch {}
  throw new Error('The answer could not be read as JSON. Try again.');
}

async function askClaude(parts, { json = false, system, effort = 'medium' } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Claude is not set up yet. Add ANTHROPIC_API_KEY to the J.A.R.V.I.S. configuration file, then restart.');
  const content = [];
  for (const p of parts) {
    const d = p.inlineData;
    if (d?.mimeType === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.data } });
    else if (d?.mimeType?.startsWith('image/')) content.push({ type: 'image', source: { type: 'base64', media_type: d.mimeType, data: d.data } });
    else if (p.text) content.push({ type: 'text', text: p.text });
  }
  // documents and images go before the text that asks about them
  content.sort((a, b) => (a.type === 'text') - (b.type === 'text'));
  let response;
  try {
    response = await claude().beta.messages.create({
      model: CLAUDE_MODEL(),
      max_tokens: 16000,
      // a declined request is re-run on a suitable fallback model inside the same call
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort },
      ...(system || json ? { system: [system, json ? 'Reply with one JSON object only, no other text.' : ''].filter(Boolean).join('\n') } : {}),
      messages: [{ role: 'user', content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Claude rejected the API key. Check ANTHROPIC_API_KEY in the configuration file.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Claude is rate-limited right now. Try again in a minute.');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude returned an error (${e.status}).`);
    throw new Error('Could not reach Claude. Check the internet connection.');
  }
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to answer that one.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return json ? parseJson(text) : text || 'Claude had nothing to add.';
}

async function askChatGPT(parts, { json = false, system } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('ChatGPT is not set up yet. Add OPENAI_API_KEY to the J.A.R.V.I.S. configuration file, then restart.');
  const content = parts.map((p) => {
    const d = p.inlineData;
    if (d?.mimeType === 'application/pdf') return { type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${d.data}` } };
    if (d?.mimeType?.startsWith('image/')) return { type: 'image_url', image_url: { url: `data:${d.mimeType};base64,${d.data}` } };
    return p.text ? { type: 'text', text: p.text } : null;
  }).filter(Boolean);
  const messages = [];
  if (system || json) messages.push({ role: 'system', content: [system, json ? 'Reply with one JSON object only.' : ''].filter(Boolean).join('\n') });
  messages.push({ role: 'user', content });
  let r;
  try {
    r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: OPENAI_MODEL(), messages, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
      signal: AbortSignal.timeout(120000),
    });
  } catch { throw new Error('Could not reach ChatGPT. Check the internet connection.'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('ChatGPT rejected the API key. Check OPENAI_API_KEY in the configuration file.');
  if (r.status === 429) throw new Error('ChatGPT is rate-limited or out of credit right now.');
  if (!r.ok) throw new Error(`ChatGPT returned an error (${r.status}): ${String(j.error?.message || '').slice(0, 120)}`);
  const text = String(j.choices?.[0]?.message?.content || '').trim();
  return json ? parseJson(text) : text || 'ChatGPT had nothing to add.';
}

module.exports = { available, askClaude, askChatGPT, parseJson, CLAUDE_MODEL, OPENAI_MODEL };
