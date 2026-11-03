// Bridges the renderer to the Gemini Live API so the API key never leaves this process.
// Renderer protocol (JSON text frames):
//   in:  {type:'start', handle?, history?} | {type:'audio', data} | {type:'audioEnd'} | {type:'text', text}
//   out: {type:'ready', resumed} | {type:'audio', data} | {type:'input'|'output', text} | {type:'turnComplete'}
//        {type:'interrupted'} | {type:'handle', handle} | {type:'goAway'} | {type:'error', message} | {type:'closed', reason}
const { WebSocketServer, WebSocket } = require('ws');

const LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const MAX_FRAME = 512 * 1024;
const MAX_HISTORY = 20;


function closeReason(code, reason) {
  const text = String(reason || '');
  if (/quota|exceeded|rate/i.test(text) || code === 1011 && /resource/i.test(text)) return 'Gemini Live quota reached. Wait a moment and try again.';
  if (/api key|permission|unauth/i.test(text)) return 'Gemini rejected the API key for Live voice. Check it in the app configuration folder.';
  if (/model/i.test(text) && /not found|not supported/i.test(text)) return 'The configured LIVE_MODEL is not available to this key.';
  return text ? `Gemini Live closed the session: ${text.slice(0, 160)}` : 'Gemini Live closed the session.';
}

function attachLive(server, { systemPrompt, tools, voice, trusted }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://localhost').pathname !== '/api/live' || !req.headers.origin || !trusted(req)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (client) => bridge(client, { systemPrompt, tools, voice }));
  });
  return wss;
}

function bridge(client, { systemPrompt, tools, voice }) {
  let upstream = null, ready = false;
  const toClient = (msg) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg)); };
  const toUpstream = (msg) => { if (ready && upstream?.readyState === WebSocket.OPEN) upstream.send(JSON.stringify(msg)); };
  const fail = (message) => { toClient({ type: 'error', message }); client.close(); };

  function start({ handle, history, timeZone }) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return fail('Gemini setup is incomplete. Add GEMINI_API_KEY to the app .env file, then restart.');
    const model = process.env.LIVE_MODEL || 'gemini-3.8-live';
    if (!/^[A-Za-z0-9._-]+$/.test(model)) return fail('LIVE_MODEL contains invalid characters.');
    const voiceName = voice();
    const search = !/^(0|false|off|no)$/i.test(process.env.GEMINI_SEARCH || 'on');
    const resuming = typeof handle === 'string' && /^[\w-]{1,512}$/.test(handle);

    upstream = new WebSocket(`${LIVE_URL}?key=${encodeURIComponent(key)}`);
    upstream.on('open', () => upstream.send(JSON.stringify({ setup: {
      model: `models/${model}`,
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { languageCode: 'en-GB', voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
      systemInstruction: { parts: [{ text: systemPrompt(timeZone) }] },
      tools: [{ functionDeclarations: tools.declarations() }, ...(search ? [{ googleSearch: {} }] : [])],
      // Let people pause mid-sentence without being cut off.
      realtimeInputConfig: { automaticActivityDetection: { endOfSpeechSensitivity: 'END_SENSITIVITY_LOW', prefixPaddingMs: 300, silenceDurationMs: 1200 } },
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
        if (sc.inputTranscription?.text) toClient({ type: 'input', text: sc.inputTranscription.text });
        if (sc.outputTranscription?.text) toClient({ type: 'output', text: sc.outputTranscription.text });
        if (sc.interrupted) toClient({ type: 'interrupted' });
        if (sc.turnComplete) toClient({ type: 'turnComplete' });
      }
      if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) toClient({ type: 'handle', handle: msg.sessionResumptionUpdate.newHandle });
      if (msg.goAway) toClient({ type: 'goAway' });
      if (msg.toolCall?.functionCalls?.length) runTools(msg.toolCall.functionCalls);
      if (msg.toolCallCancellation?.ids) tools.cancel?.(msg.toolCallCancellation.ids);
    });
    upstream.on('close', (code, reason) => {
      toClient({ type: 'closed', reason: code === 1000 && !String(reason) ? '' : closeReason(code, reason) });
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

  client.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
    if (msg.type === 'start' && !upstream) start(msg);
    else if (msg.type === 'audio' && typeof msg.data === 'string') toUpstream({ realtimeInput: { audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' } } });
    else if (msg.type === 'audioEnd') toUpstream({ realtimeInput: { audioStreamEnd: true } });
    else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) toUpstream({ realtimeInput: { text: msg.text.trim().slice(0, 6000) } });
  });
  client.on('close', () => { if (upstream && upstream.readyState <= WebSocket.OPEN) upstream.close(); });
}

module.exports = { attachLive };
