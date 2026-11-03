// Second brains for J.A.R.V.I.S.: Claude (Anthropic SDK) and ChatGPT (OpenAI API), alongside Gemini.
// Requests arrive as Gemini-style parts ({ text } or { inlineData: { mimeType, data } }) and are
// translated for each provider, so Helper, Inboxer, Visioner and chat can use any of them.
const Anthropic = require('@anthropic-ai/sdk');
const voicefix = require('./voicefix');

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

// Gemini tool schemas use upper-case types ('OBJECT', 'STRING'); Claude and OpenAI want JSON Schema.
function jsonSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'type' && typeof v === 'string') out.type = v.toLowerCase();
    else if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v || {}).map(([pk, pv]) => [pk, jsonSchema(pv)]));
    else if (k === 'items') out.items = jsonSchema(v);
    else if (k !== 'nullable') out[k] = v;
  }
  if (out.type === 'object' && !out.properties) out.properties = {};
  return out;
}
const toolText = (r) => { try { return JSON.stringify(r ?? {}).slice(0, 50000); } catch { return String(r); } };

// Full J.A.R.V.I.S. chat on Claude: same system prompt, same skills, with web search for live answers.
async function chatClaude(messages, { system, tools, execute, voice = false }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Claude is not set up yet.');
  const convo = messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  const defs = [...tools.map((t) => ({ name: t.name, description: t.description, input_schema: jsonSchema(t.parameters) })), { type: 'web_search_20260209', name: 'web_search' }];
  for (let round = 0; round < 12; round++) {
    let response;
    try {
      response = await claude().beta.messages.create({ model: CLAUDE_MODEL(), max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: voice ? 'low' : 'medium' }, system, tools: defs, messages: convo });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error('Claude rejected the API key. Check ANTHROPIC_API_KEY in the configuration file.');
      if (e instanceof Anthropic.RateLimitError) throw Object.assign(new Error('Claude is rate-limited right now. Try again in a minute.'), { status: 429 });
      if (e instanceof Anthropic.APIError) throw new Error(`Claude returned an error (${e.status}).`);
      throw new Error('Could not reach Claude. Check the internet connection.');
    }
    if (response.stop_reason === 'refusal') return 'I am afraid I cannot help with that one, sir.';
    convo.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'pause_turn') continue; // a long web search: let it carry on
    const calls = response.content.filter((b) => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !calls.length) {
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      return text || 'Done, sir.';
    }
    const results = await Promise.all(calls.map((c) => execute(c.name, c.input || {}, { callId: c.id })));
    convo.push({ role: 'user', content: calls.map((c, i) => ({ type: 'tool_result', tool_use_id: c.id, content: toolText(results[i]) })) });
  }
  throw new Error('That took too many steps. Try breaking the request into smaller parts.');
}

// The same on ChatGPT, through OpenAI function calling.
async function chatChatGPT(messages, { system, tools, execute, voice = false }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('ChatGPT is not set up yet.');
  const convo = [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))];
  const defs = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: jsonSchema(t.parameters) } }));
  for (let round = 0; round < 12; round++) {
    let r;
    try {
      r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model: OPENAI_MODEL(), messages: convo, tools: defs, reasoning_effort: voice ? 'low' : 'medium' }), signal: AbortSignal.timeout(120000) });
    } catch { throw new Error('Could not reach ChatGPT. Check the internet connection.'); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('ChatGPT rejected the API key. Check OPENAI_API_KEY in the configuration file.');
    if (r.status === 429) throw Object.assign(new Error('ChatGPT is rate-limited or out of credit right now.'), { status: 429 });
    if (!r.ok) throw new Error(`ChatGPT returned an error (${r.status}): ${String(j.error?.message || '').slice(0, 120)}`);
    const msg = j.choices?.[0]?.message || {};
    const calls = msg.tool_calls || [];
    if (!calls.length) return String(msg.content || '').trim() || 'Done, sir.';
    convo.push(msg);
    const results = await Promise.all(calls.map((c) => { let args = {}; try { args = JSON.parse(c.function?.arguments || '{}'); } catch {} return execute(c.function?.name, args, { callId: c.id }); }));
    calls.forEach((c, i) => convo.push({ role: 'tool', tool_call_id: c.id, content: toolText(results[i]) }));
  }
  throw new Error('That took too many steps. Try breaking the request into smaller parts.');
}

// Speech on OpenAI, for when Gemini's voice limit runs out.
async function transcribeOpenAI(audio, contentType) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('ChatGPT is not set up yet.');
  const type = contentType.split(';')[0];
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), `voice.${type.split('/')[1] || 'webm'}`);
  form.append('model', process.env.OPENAI_ASR_MODEL || 'gpt-4o-transcribe');
  form.append('language', 'en');
  form.append('prompt', `Someone talking to their voice assistant, Jarvis. ${voicefix.hint()}`.slice(0, 900));
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`OpenAI speech recognition failed (${r.status}).`), { status: r.status === 429 ? 429 : 502 });
  const text = String(j.text || '').trim();
  if (!text) throw Object.assign(new Error('No speech was detected. Try again, or type your message.'), { status: 422 });
  return text;
}
async function speakOpenAI(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('ChatGPT is not set up yet.');
  const r = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', voice: process.env.OPENAI_TTS_VOICE || 'onyx', input: text, response_format: 'mp3' }), signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw Object.assign(new Error(`OpenAI speech failed (${r.status}).`), { status: r.status === 429 ? 429 : 502 });
  return { audio: Buffer.from(await r.arrayBuffer()), type: 'audio/mpeg' };
}

module.exports = { available, askClaude, askChatGPT, chatClaude, chatChatGPT, transcribeOpenAI, speakOpenAI, jsonSchema, parseJson, CLAUDE_MODEL, OPENAI_MODEL };

