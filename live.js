// Bridges the renderer to the Gemini Live API so the API key never leaves this process.
// Renderer protocol (JSON text frames):
//   in:  {type:'start', handle?, history?} | {type:'audio', data} | {type:'audioEnd'} | {type:'text', text}
//   out: {type:'ready', resumed} | {type:'audio', data} | {type:'input'|'output', text} | {type:'turnComplete'}
//        {type:'interrupted'} | {type:'handle', handle} | {type:'goAway'} | {type:'error', message} | {type:'closed', reason}
const { WebSocketServer, WebSocket } = require('ws');
const { openaiLive } = require('./core/live-openai');
const voicefix = require('./core/voicefix');
const brains = require('./core/brains');
const voiceid = require('./core/voiceid');

// 16 kHz mono PCM16 pieces -> one WAV file.
function pcmWav(parts) {
  const pcm = Buffer.concat(parts), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const MAX_FRAME = 512 * 1024;
const MAX_HISTORY = 20;
// After Gemini Live runs out, ChatGPT handles live voice for a while before Gemini gets another try.
let geminiRestUntil = 0;
const SWITCH_NOTICE = 'Gemini Live reached its limit, so ChatGPT is handling live voice for now.';


function closeReason(code, reason) {
  const text = String(reason || '');
  if (/quota|exceeded|rate/i.test(text) || code === 1011 && /resource/i.test(text)) return 'Gemini Live quota reached. Wait a moment and try again.';
  if (/api key|permission|unauth/i.test(text)) return 'Gemini rejected the API key for Live voice. Check it in the app configuration folder.';
  if (/model/i.test(text) && /not found|not supported/i.test(text)) return 'The configured LIVE_MODEL is not available to this key.';
  return text ? `Gemini Live closed the session: ${text.slice(0, 160)}` : 'Gemini Live closed the session.';
}

function attachLive(server, { systemPrompt, tools, voice, trusted, engine = () => 'gemini' }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://localhost').pathname !== '/api/live' || !req.headers.origin || !trusted(req)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (client) => bridge(client, { systemPrompt, tools, voice, engine }));
  });
  return wss;
}

function bridge(client, { systemPrompt, tools, voice, engine }) {
  let upstream = null, ready = false, chatgpt = null, started = null, heard = [];
  // Gemini Live's own transcript is not held to English; OpenAI re-reads each utterance (the model still hears the audio itself).
  function betterTranscript() {
    const parts = heard; heard = [];
    const bytes = parts.reduce((n, p) => n + p.length, 0);
    if (!process.env.OPENAI_API_KEY || bytes < 16000) return; // under half a second
    brains.transcribeOpenAI(pcmWav(parts), 'audio/wav').then((text) => { if (text) toClient({ type: 'inputFix', text: voicefix.apply(text) }); }).catch(() => {});
  }
  const toClient = (msg) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg)); };
  const toUpstream = (msg) => { if (ready && upstream?.readyState === WebSocket.OPEN) upstream.send(JSON.stringify(msg)); };
  const fail = (message) => { toClient({ type: 'error', message }); client.close(); };

  function startChatGPT(notice) {
    upstream = null; ready = false;
    chatgpt = openaiLive(started, { toClient, systemPrompt, tools, onClosed: (why) => { toClient({ type: 'closed', reason: why }); client.close(); } });
    if (chatgpt && notice) toClient({ type: 'notice', text: notice });
  }
  function start(msg) {
    started = msg;
    const backup = Boolean(process.env.OPENAI_API_KEY);
    if (engine() === 'chatgpt' && backup) return startChatGPT();
    if (backup && Date.now() < geminiRestUntil) return startChatGPT(SWITCH_NOTICE);
    const { handle, history, timeZone } = msg;
    const key = process.env.GEMINI_API_KEY;
    if (!key) return fail('Gemini setup is incomplete. Add GEMINI_API_KEY to the app .env file, then restart.');
    const model = process.env.LIVE_MODEL || 'gemini-3.8-live';
    if (!/^[A-Za-z0-9._-]+$/.test(model)) return fail('LIVE_MODEL contains invalid characters.');
    const voiceName = voice();
    const search = !/^(0|false|off|no)$/i.test(process.env.GEMINI_SEARCH || 'on');
    const resuming = typeof handle === 'string' && /^[\w-]{1,512}$/.test(handle);

    upstream = new WebSocket(`${process.env.GEMINI_LIVE_URL || LIVE_URL}?key=${encodeURIComponent(key)}`);
    upstream.on('open', () => upstream.send(JSON.stringify({ setup: {
      model: `models/${model}`,
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { languageCode: 'en-GB', voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
      systemInstruction: { parts: [{ text: systemPrompt(timeZone) }] },
      tools: [{ functionDeclarations: tools.declarations() }, ...(search ? [{ googleSearch: {} }] : [])],
      // Let people pause mid-sentence without being cut off.
      realtimeInputConfig: { automaticActivityDetection: { endOfSpeechSensitivity: 'END_SENSITIVITY_LOW', silenceDurationMs: 1200 } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: resuming ? { handle } : {}
    } })));
    upstream.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
      if (msg.setupComplete) {
        ready = true;
        const turns = !resuming && Array.isArray(history) ? history.slice(-MAX_HISTORY)
          .filter((m) => m && typeof m.content === 'string' && m.content.trim() && ['user', 'assistant'].includes(m.role))
          .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content.slice(0, 6000) }] })) : [];
        if (turns.length) toUpstream({ clientContent: { turns, turnComplete: false } });
        toClient({ type: 'ready', resumed: resuming });
        return;
      }
      const sc = msg.serverContent;
      if (sc) {
        for (const part of sc.modelTurn?.parts || []) if (part.inlineData?.data) toClient({ type: 'audio', data: part.inlineData.data });
        // with an OpenAI key the accurate transcript comes from betterTranscript() instead
        if (sc.inputTranscription?.text && !process.env.OPENAI_API_KEY) toClient({ type: 'input', text: voicefix.apply(sc.inputTranscription.text) });
        if (sc.outputTranscription?.text) toClient({ type: 'output', text: sc.outputTranscription.text });
        if (sc.interrupted) toClient({ type: 'interrupted' });
        if (sc.turnComplete) toClient({ type: 'turnComplete' });
      }
      if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) toClient({ type: 'handle', handle: msg.sessionResumptionUpdate.newHandle });
      if (msg.goAway) toClient({ type: 'goAway' });
      if (msg.toolCall?.functionCalls?.length) runTools(msg.toolCall.functionCalls);
      if (msg.toolCallCancellation?.ids) tools.cancel?.(msg.toolCallCancellation.ids);
    });
    const gemini = upstream;
    upstream.on('close', (code, reason) => {
      if (upstream !== gemini) return;
      const why = code === 1000 && !String(reason) ? '' : closeReason(code, reason);
      if (/quota/i.test(why) && process.env.OPENAI_API_KEY && client.readyState === WebSocket.OPEN) { geminiRestUntil = Date.now() + 15 * 60000; return startChatGPT(SWITCH_NOTICE); }
      toClient({ type: 'closed', reason: why });
      client.close();
    });
    upstream.on('error', () => fail('Could not reach Gemini Live. Check your internet connection and try again.'));
  }

  // Tool calls run server-side; the dashboard sees progress and approval prompts over /api/events.
  async function runTools(calls) {
    toClient({ type: 'toolStart' });
    const functionResponses = await Promise.all(calls.map(async (fc) => ({ id: fc.id, name: fc.name, response: await tools.execute(fc.name, fc.args, { callId: fc.id }) })));
    toUpstream({ toolResponse: { functionResponses } });
  }

  // "Only my voice": each utterance is checked against the user's voice before the model hears it.
  const mine = voiceid.gate(
    (data) => {
      if (chatgpt) return chatgpt.audio(data);
      if (ready) heard.push(Buffer.from(data, 'base64')); if (heard.length > 1500) heard.shift();
      toUpstream({ realtimeInput: { audio: { data, mimeType: 'audio/pcm;rate=16000' } } });
    },
    () => { if (chatgpt) return chatgpt.audioEnd(); toUpstream({ realtimeInput: { audioStreamEnd: true } }); betterTranscript(); },
    () => { heard = []; toClient({ type: 'ignored' }); }
  );

  client.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
    if (msg.type === 'start' && !upstream && !chatgpt) start(msg);
    else if (msg.type === 'audio' && typeof msg.data === 'string') mine.audio(msg.data);
    else if (msg.type === 'audioEnd') mine.end();
    else if (chatgpt) {
      if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) chatgpt.text(msg.text.trim().slice(0, 6000));
    }
    else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) toUpstream({ realtimeInput: { text: msg.text.trim().slice(0, 6000) } });
  });
  client.on('close', () => { if (upstream && upstream.readyState <= WebSocket.OPEN) upstream.close(); chatgpt?.close(); });
}

module.exports = { attachLive };
