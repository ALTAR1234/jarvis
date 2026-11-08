// Second brains for J.A.R.V.I.S.: Claude (Anthropic SDK) and ChatGPT (OpenAI API), alongside Gemini.
// Requests arrive as Gemini-style parts ({ text } or { inlineData: { mimeType, data } }) and are
// translated for each provider, so Helper, Inboxer, Visioner and chat can use any of them.
const Anthropic = require('@anthropic-ai/sdk');
const voicefix = require('./voicefix');

const CLAUDE_MODEL = () => process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const OPENAI_MODEL = () => process.env.OPENAI_MODEL || 'gpt-5';
const available = () => ({ gemini: Boolean(process.env.GEMINI_API_KEY), claude: Boolean(process.env.ANTHROPIC_API_KEY), chatgpt: Boolean(process.env.OPENAI_API_KEY), local: Boolean(localTarget()) });

// The free brain: open models running on this PC through Ollama (no key, no credits, works offline),
// or GitHub Models when GITHUB_MODELS_TOKEN is set and Ollama is not running. Both speak the OpenAI chat format.
const OLLAMA = () => (process.env.LOCAL_AI_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
let ollama = { up: false, models: [] };
async function probeLocal() {
  try {
    const r = await fetch(OLLAMA() + '/api/tags', { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    ollama = { up: r.ok, models: (j.models || []).map((m) => m.name) };
  } catch { ollama = { up: false, models: [] }; }
  return ollama;
}
probeLocal();
setInterval(probeLocal, 30000).unref?.();
function localTarget() {
  if (ollama.up && ollama.models.length) {
    const want = process.env.LOCAL_AI_MODEL;
    // Qwen 2.5 7B first: the best tool-calling open model that runs at talking speed on a laptop CPU with no graphics card
    // jarvis-qwen is Qwen 2.5 7B set up for this laptop's Arc graphics (see ollama/Modelfile)
    const PREFER = [/^jarvis-qwen/, /^qwen2\.5:7b/, /^qwen2\.5:14b/, /^granite4|^granite-?4/, /^llama3\.1:8b/, /qwen|llama|mistral|granite|gemma|phi/i];
    const model = want && ollama.models.includes(want) ? want : want || PREFER.map((re) => ollama.models.find((m) => re.test(m))).find(Boolean) || ollama.models[0];
    return { name: 'Local AI', url: OLLAMA() + '/v1/chat/completions', key: 'ollama', model };
  }
  if (process.env.GITHUB_MODELS_TOKEN) return { name: 'GitHub Models', url: 'https://models.github.ai/inference/chat/completions', key: process.env.GITHUB_MODELS_TOKEN, model: process.env.GITHUB_MODELS_MODEL || 'openai/gpt-4.1' };
  return null;
}
const localInfo = () => ({ ollama: ollama.up, models: ollama.models, github: Boolean(process.env.GITHUB_MODELS_TOKEN), using: localTarget() && { name: localTarget().name, model: localTarget().model } });

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

// Full J.A.R.V.I.S. chat on the free brain. Small local models can fumble tool calls, so a bad call is
// reported back to the model instead of failing the whole reply.
// Local models re-read the whole prompt unless its start is identical to last time, and the instructions
// plus skill list are ~8K tokens (minutes on a laptop). So the fixed part goes first and the parts that
// change (the time, voice notes, memories) go in a short note just before the newest message.
// `fixed` is the part of the instructions that never changes (the caller passes it).
function splitSystem(system, fixed) {
  return fixed && system.startsWith(fixed) ? [fixed, system.slice(fixed.length).trim()] : [system, ''];
}
// Read the fixed instructions once in the background so the first real question is quick.
async function warmLocal({ fixed, tools }) {
  const t = localTarget() || (await probeLocal(), localTarget());
  if (!t || t.name !== 'Local AI') return false;
  const defs = tools.map((d) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: jsonSchema(d.parameters) } }));
  const r = await fetch(t.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: t.model, messages: [{ role: 'system', content: fixed }, { role: 'user', content: 'Hi' }], tools: defs, max_tokens: 1 }), signal: AbortSignal.timeout(600000) }).catch(() => null);
  return Boolean(r?.ok);
}
async function chatLocal(messages, { system, fixed, tools, execute }) {
  const t = localTarget() || (await probeLocal(), localTarget());
  if (!t) throw new Error('The free AI is not set up yet. Install Ollama and download a model, or add GITHUB_MODELS_TOKEN.');
  const [head, moving] = splitSystem(system, fixed);
  const history = messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  // inside the newest message, not a system message: Ollama merges every system message into the top block
  const last = history[history.length - 1];
  if (moving && last?.role === 'user') last.content = `[${moving}]\n\n${last.content}`;
  const convo = [{ role: 'system', content: head }, ...history];
  const defs = tools.map((d) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: jsonSchema(d.parameters) } }));
  let useTools = true;
  for (let round = 0; round < 10; round++) {
    let r;
    try {
      r = await fetch(t.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t.key}` }, body: JSON.stringify({ model: t.model, messages: convo, ...(useTools ? { tools: defs } : {}) }), signal: AbortSignal.timeout(300000) });
    } catch { throw new Error(t.name === 'Local AI' ? 'The local AI stopped responding. Is Ollama still running?' : 'Could not reach GitHub Models. Check the internet connection.'); }
    const j = await r.json().catch(() => ({}));
    // some models have no tool support: answer without tools rather than failing
    if (r.status === 400 && useTools && /tool/i.test(JSON.stringify(j))) { useTools = false; continue; }
    if (r.status === 401 || r.status === 403) throw new Error(`${t.name} rejected the token. Check GITHUB_MODELS_TOKEN.`);
    if (r.status === 429) throw Object.assign(new Error(`${t.name} hit its free limit for now. Try again later.`), { status: 429 });
    if (!r.ok) throw new Error(`${t.name} returned an error (${r.status}): ${String(j.error?.message || j.error || '').slice(0, 120)}`);
    const msg = j.choices?.[0]?.message || {};
    const calls = msg.tool_calls || [];
    // reasoning models wrap their thinking in <think> tags; only the answer is spoken
    if (!calls.length) return String(msg.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim() || 'Done, sir.';
    convo.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    const results = await Promise.all(calls.map(async (c) => {
      let args = c.function?.arguments || {};
      if (typeof args === 'string') try { args = JSON.parse(args || '{}'); } catch { return { error: 'The arguments were not valid JSON.' }; }
      try { return await execute(c.function?.name, args, { callId: c.id }); } catch (e) { return { error: e.message }; }
    }));
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

module.exports = { available, localInfo, probeLocal, chatLocal, warmLocal, askClaude, askChatGPT, chatClaude, chatChatGPT, transcribeOpenAI, speakOpenAI, jsonSchema, parseJson, CLAUDE_MODEL, OPENAI_MODEL };

