// ChatGPT live voice: the same renderer protocol as Gemini Live (see live.js), spoken through the
// OpenAI Realtime API. Used when the user picks ChatGPT for live voice, or when Gemini Live runs out.
const { WebSocket } = require('ws');
const { jsonSchema } = require('./brains');
const voicefix = require('./voicefix');

const URL_BASE = 'wss://api.openai.com/v1/realtime';
const MAX_HISTORY = 20;
// Without Jarvis's name, speech only counts as a follow-up for this long after a reply.
const FOLLOW_UP_MS = 30000;

// The renderer streams 16 kHz PCM; Realtime only takes 24 kHz.
function to24k(b64) {
  const src = Buffer.from(b64, 'base64'), n = src.length >> 1;
  if (!n) return '';
  const outN = Math.floor(n * 1.5), out = Buffer.alloc(outN * 2);
  for (let i = 0; i < outN; i++) {
    const pos = i / 1.5, a = Math.floor(pos), b = Math.min(n - 1, a + 1), f = pos - a;
    out.writeInt16LE(Math.round(src.readInt16LE(a * 2) * (1 - f) + src.readInt16LE(b * 2) * f), i * 2);
  }
  return out.toString('base64');
}
const SILENCE = Buffer.alloc(24000 * 2 * 1.2).toString('base64'); // 1.2 s, lets the server notice the end of speech

function reason(status, text = '') {
  if (status === 401 || /invalid_api_key|incorrect api key/i.test(text)) return 'ChatGPT rejected the API key for live voice. Check OPENAI_API_KEY in the configuration file.';
  if (status === 429 || /quota|rate limit|insufficient/i.test(text)) return 'ChatGPT live voice quota reached. Check your OpenAI credit.';
  if (status === 404 || /model/i.test(text) && /not found|does not exist|access/i.test(text)) return 'This OpenAI key cannot use the live voice model (OPENAI_LIVE_MODEL).';
  return text ? `ChatGPT live voice closed: ${String(text).slice(0, 160)}` : 'ChatGPT live voice closed the session.';
}

// ctx: { toClient, systemPrompt, tools, onClosed(reasonText) }
function openaiLive({ history, timeZone }, { toClient, systemPrompt, tools, onClosed }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) { onClosed('ChatGPT is not set up yet. Add OPENAI_API_KEY to the configuration file, then restart.'); return null; }
  const model = process.env.OPENAI_LIVE_MODEL || 'gpt-realtime';
  if (!/^[A-Za-z0-9._-]+$/.test(model)) { onClosed('OPENAI_LIVE_MODEL contains invalid characters.'); return null; }
  let ready = false, closed = false, calls = [], speaking = false, responding = false, lastReplyAt = 0;
  const ws = new WebSocket(`${process.env.OPENAI_REALTIME_URL || URL_BASE}?model=${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${key}` } });
  const send = (msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
  const end = (text) => { if (closed) return; closed = true; onClosed(text); try { ws.close(); } catch {} };

  const past = Array.isArray(history) ? history.slice(-MAX_HISTORY).filter((m) => m && typeof m.content === 'string' && m.content.trim() && ['user', 'assistant'].includes(m.role)) : [];
  const instructions = systemPrompt(timeZone) + (past.length ? `\n\nRecent conversation, for context:\n${past.map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${m.content.slice(0, 1500)}`).join('\n')}` : '');

  ws.on('open', () => send({ type: 'session.update', session: {
    type: 'realtime',
    output_modalities: ['audio'],
    instructions,
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        // Waits through mid-sentence pauses. Replies are started here, only for speech meant for Jarvis,
        // so games, videos and other people in the room are ignored.
        turn_detection: { type: 'server_vad', threshold: 0.55, prefix_padding_ms: 300, silence_duration_ms: 900, create_response: false, interrupt_response: false },
        transcription: { model: process.env.OPENAI_ASR_MODEL || 'gpt-4o-mini-transcribe', language: 'en', prompt: `Someone talking to their voice assistant, Jarvis. ${voicefix.hint()}`.slice(0, 900) }
      },
      output: { format: { type: 'audio/pcm', rate: 24000 }, voice: process.env.OPENAI_LIVE_VOICE || 'cedar' }
    },
    tools: tools.declarations().map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: jsonSchema(t.parameters) })),
    tool_choice: 'auto'
  } }));
  ws.on('unexpected-response', (_req, res) => {
    let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => end(reason(res.statusCode, body)));
  });
  ws.on('message', (raw) => {
    let ev; try { ev = JSON.parse(raw.toString('utf8')); } catch { return; }
    switch (ev.type) {
      case 'session.updated': if (!ready) { ready = true; toClient({ type: 'ready', resumed: false }); } break;
      case 'response.output_audio.delta': case 'response.audio.delta': if (ev.delta) { speaking = true; toClient({ type: 'audio', data: ev.delta }); } break;
      case 'response.output_audio_transcript.delta': case 'response.audio_transcript.delta': if (ev.delta) toClient({ type: 'output', text: ev.delta }); break;
      case 'conversation.item.input_audio_transcription.completed': {
        const text = voicefix.apply(String(ev.transcript || '').trim());
        const forJarvis = text && (voicefix.addressed(text) || responding || Date.now() - lastReplyAt < FOLLOW_UP_MS);
        if (!forJarvis) {
          // not meant for Jarvis: drop it so it never builds up in the conversation
          if (ev.item_id) send({ type: 'conversation.item.delete', item_id: ev.item_id });
          toClient({ type: 'turnComplete' });
          break;
        }
        toClient({ type: 'input', text });
        if (responding) { send({ type: 'response.cancel' }); speaking = false; toClient({ type: 'interrupted' }); }
        send({ type: 'response.create' });
        break;
      }
      case 'response.created': responding = true; break;
      case 'response.function_call_arguments.done': calls.push({ id: ev.call_id, name: ev.name, args: ev.arguments }); break;
      case 'response.done': {
        speaking = false; responding = false; lastReplyAt = Date.now();
        const status = ev.response?.status, err = ev.response?.status_details?.error;
        if (status === 'failed' && err) { if (/quota|rate|insufficient|invalid_api_key/i.test(`${err.code} ${err.message}`)) return end(reason(0, `${err.code} ${err.message}`)); }
        const batch = calls; calls = [];
        if (batch.length && status === 'completed') runTools(batch); else toClient({ type: 'turnComplete' });
        break;
      }
      case 'error': {
        const e = ev.error || {};
        // Most errors are about one event (e.g. cancelling a finished reply) and are not fatal.
        if (/invalid_api_key|insufficient_quota|rate_limit|session_expired|model_not_found/i.test(`${e.code} ${e.type}`)) end(reason(0, `${e.code}: ${e.message}`));
        else console.warn('ChatGPT live voice:', e.code || e.type, e.message);
        break;
      }
    }
  });
  ws.on('close', (code, why) => end(code === 1000 && !String(why) ? '' : reason(0, String(why))));
  ws.on('error', () => end('Could not reach ChatGPT live voice. Check your internet connection and try again.'));

  async function runTools(batch) {
    toClient({ type: 'toolStart' });
    const results = await Promise.all(batch.map(async (c) => {
      let args = {}; try { args = JSON.parse(c.args || '{}'); } catch {}
      return tools.execute(c.name, args, { callId: c.id });
    }));
    batch.forEach((c, i) => send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: c.id, output: JSON.stringify(results[i] ?? {}).slice(0, 50000) } }));
    send({ type: 'response.create' });
  }

  return {
    audio: (b64) => { if (ready) send({ type: 'input_audio_buffer.append', audio: to24k(b64) }); },
    audioEnd: () => { if (ready) send({ type: 'input_audio_buffer.append', audio: SILENCE }); },
    text: (text) => { if (!ready) return; send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }); send({ type: 'response.create' }); },
    close: () => { closed = true; try { ws.close(); } catch {} }
  };
}

module.exports = { openaiLive, to24k };
