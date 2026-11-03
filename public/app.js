const $ = (id) => document.getElementById(id);
const form = $('chatForm'), input = $('messageInput'), convo = $('conversation'), send = $('sendButton');
const mic = $('micButton'), voiceToggle = $('voiceToggle'), messages = [];
let busy = false, voiceOn = false, voiceConfigured = false, voiceProvider = 'Gemini', wakeWord = '';
let handsFreeEnabled = false, liveSupported = false;
// Regular voice works like Live: it waits for its name, then follows the conversation until it has been quiet a while.
let regularAwakeUntil = 0, regularSleepMs = 120000, regularWakeOn = true, regularSleeping = false;
// "Jarvis" and the ways speech recognition mishears it, especially when spoken quietly ("jueves" is Spanish for Thursday).
const WAKE_NAMES = "jarvis|jarvis's|jervis|javis|jarvas|jarves|jarbis|jarvi|jarvy|harvis|garvis|charvis|jueves|jervais|jervis's";
const WAKE_RE = new RegExp(`\\b(${WAKE_NAMES})\\b`, 'i');
const nameHeard = (t) => WAKE_RE.test(t) || Boolean(wakeWord) && new RegExp(`\\b${wakeWord.replace(/[^a-z0-9 ]/gi, '')}\\b`, 'i').test(t);
// "Jarvis, go to sleep" (but not "I'm going to sleep").
const SLEEP_CMD = new RegExp(`(^|\\b(${WAKE_NAMES})\\b[\\s,!.]*|\\b(please|ok(ay)?|now|hey)\\b[\\s,]*)(go to sleep|go to bed|go on standby|go offline|sleep now)\\b|\\b(sleep mode|standby mode|stop listening)\\b`, 'i');
const SELF_SLEEP = /\b(i'?m|i am|i will|i'?ll|i want to|we'?re|i)\s+(going to |gonna |about to )?(go to sleep|go to bed)\b/i;
const isSleepCommand = (t) => SLEEP_CMD.test(t.trim()) && !SELF_SLEEP.test(t);
// Corrections taught in Controller or by voice ("you heard jueves, I said Jarvis"), for live voice text that arrives in pieces.
let heardFixes = [];
const loadHeardFixes = () => fetch('/api/voicefix').then((r) => r.json()).then((d) => { heardFixes = (d.fixes || []).sort((a, b) => b.heard.length - a.heard.length); }).catch(() => {});
loadHeardFixes(); setInterval(loadHeardFixes, 60000);
const fixHeard = (t) => heardFixes.reduce((out, f) => out.replace(new RegExp(`(^|[^\\p{L}\\p{N}'])${f.heard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}'])`, 'giu'), (_m, pre) => pre + f.said), String(t || ''));
// Regular voice always needs its name first (so games and videos are ignored), then follows up for 45 s.
const REGULAR_FOLLOW_MS = 45000;
const regularAsleep = () => handsFreeEnabled && (regularSleeping || Date.now() >= regularAwakeUntil);
// Regular voice: stop answering until the name is heard again (Live has its own sleep).
window.jarvisRegularSleep = () => regularSleep();
function regularSleep() { if (!handsFreeEnabled) return; regularSleeping = true; regularAwakeUntil = 0; updateHandsFreeUI(); if (!busy) updateState('asleep'); }
const avatar = window.JarvisAvatar ? new window.JarvisAvatar($('avatar')) : null;
const micActive = () => handsFreeEnabled || live.on;
let micStream = null, audioContext = null, analyser = null, sourceNode = null, vadFrame = 0;
let recorder = null, recordingChunks = [], recordingTimer = null, lastSpeechAt = 0, speechFrames = 0, noiseFloor = 0.004;
let currentAudio = null, currentAudioUrl = null, toastTimer;

function updateState(next) {
  if ((live.asleep || regularAsleep()) && ['idle', 'listening'].includes(next)) next = 'asleep';
  if (next === 'idle' && micActive()) next = 'listening';
  document.body.dataset.state = next; avatar?.setState(next);
  const labels = { idle: ['STANDBY', 'READY'], listening: ['LISTENING', 'LISTENING'], thinking: ['PROCESSING', 'THINKING'], speaking: ['SPEAKING', 'SPEAKING'], error: ['ATTENTION', 'ERROR'], asleep: ['SAY "JARVIS"', 'ASLEEP'] };
  $('coreState').textContent = labels[next]?.[0] || 'STANDBY'; $('sessionStatus').textContent = labels[next]?.[1] || 'READY';
  $('voiceCardTitle').textContent = next === 'asleep' ? 'Sleeping' : next === 'listening' ? 'Hands-free listening' : next === 'thinking' ? 'Processing request' : next === 'speaking' ? 'Speaking reply' : 'Voice inactive';
  $('voiceCardText').textContent = next === 'listening' ? wakeWord ? `Mic is on · say "${wakeWord}" to address me` : 'Mic is on · I am listening' : next === 'asleep' ? 'Say "Jarvis" or hold Ctrl+Space' : next === 'thinking' ? 'Waiting for assistant' : next === 'speaking' ? 'Audio playback active' : voiceOn ? 'Spoken replies enabled' : 'Click the mic to enable hands-free';
}
function showToast(text) { const el = $('toast'); el.textContent = text; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 4200); }
function addMessage(role, content, extra = '') { const el = document.createElement('div'); el.className = `message ${role} ${extra}`.trim(); el.textContent = content; convo.appendChild(el); convo.scrollTop = convo.scrollHeight; return el; }
function updateClock() { const now = new Date(); $('clock').textContent = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(now); const hour = now.getHours(); $('daypart').textContent = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening'; }
function updateHandsFreeUI() {
  if (liveSupported) {
    mic.classList.toggle('active', live.on); mic.setAttribute('aria-pressed', String(live.on));
    mic.setAttribute('aria-label', live.on ? 'End live conversation' : 'Start live conversation');
    $('voiceNote').textContent = !live.on ? 'Click the mic for a live voice conversation. Only speech is streamed to Gemini; silence stays on this device.'
      : live.mediaPlaying ? 'Media playing · say “Jarvis, …” to talk to me so I don’t answer the video · or hold Ctrl+Space.'
      : live.asleep ? 'Asleep · say “Jarvis, wake up” (short phrases are transcribed only to listen for my name) · or click the mic.'
      : 'Always listening · just talk, interrupt any time · say “Jarvis, go to sleep” to pause · Esc stops the reply.';
    return;
  }
  mic.classList.toggle('active', handsFreeEnabled); mic.setAttribute('aria-pressed', String(handsFreeEnabled));
  mic.setAttribute('aria-label', handsFreeEnabled ? 'Turn off hands-free listening' : 'Turn on hands-free listening');
  const awake = !regularAsleep();
  $('voiceNote').textContent = !handsFreeEnabled ? 'Click the mic for regular voice. Say “Jarvis, …” to talk to me; I reply after you finish speaking.'
    : awake ? 'Listening · I reply after you finish speaking. Click the mic to stop, Esc to interrupt.'
    : 'Asleep · say “Jarvis, …” to talk to me. Background noise and other voices are ignored.';
}
updateClock(); setInterval(updateClock, 30000);
async function savePreferences(patch) {
  try { const r = await fetch('/api/preferences', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }); if (!r.ok) throw new Error('Could not save this setting.'); return await r.json(); }
  catch { showToast('The setting is active for this session, but could not be saved.'); return null; }
}
Promise.all([fetch('/api/status').then((r) => r.json()), fetch('/api/preferences').then((r) => r.json())]).then(([status, prefs]) => {
  voiceConfigured = Boolean(status.voiceConfigured); voiceProvider = status.voiceProvider || 'Gemini'; wakeWord = status.wakeWord || ''; liveSupported = Boolean(status.live); updateHandsFreeUI();
  if (!status.chatConfigured) { $('sessionStatus').textContent = 'SETUP NEEDED'; $('coreState').textContent = 'CONFIGURE GEMINI'; showToast('Add GEMINI_API_KEY and GEMINI_MODEL to the app .env file, then restart.'); }
  voiceOn = Boolean(prefs.voiceReplies && voiceConfigured); live.setMuted(!voiceOn);
  $('voiceLabel').textContent = voiceConfigured ? voiceOn ? 'Voice replies on' : 'Voice replies off' : 'Voice not configured';
  voiceToggle.title = voiceOn ? 'Disable spoken replies' : 'Enable spoken replies';
  live.configure(prefs); regularWakeOn = prefs.autoSleep !== false; if (prefs.sleepMinutes) regularSleepMs = prefs.sleepMinutes * 60000; alwaysListening = prefs.alwaysListening !== false;
  if (liveSupported && (prefs.alwaysListening !== false || prefs.handsFree)) live.start();
  else if (prefs.handsFree && voiceConfigured) enableHandsFree();
}).catch(() => showToast('Could not read assistant setup. Restart the app and try again.'));

// Says once when a backup takes over from Gemini (chat and voice switch separately), and when Gemini is back.
const usingNow = { chat: 'Gemini', voice: 'Gemini' };
function noteVia(kind, via) {
  if (!via || via === usingNow[kind]) return;
  const what = kind === 'chat' ? 'answering' : 'handling voice';
  showToast(via === 'Gemini' ? `Gemini is back and ${what} again.` : usingNow[kind] === 'Gemini' ? `Gemini reached its limit, so ${via} is ${what} for now.` : `${via} is ${what} now.`);
  usingNow[kind] = via;
}
async function sendMessage(text, { voice = false } = {}) {
  const content = text.trim(); if (!content || busy) return;
  addMessage('user', content); messages.push({ role: 'user', content });
  while (messages.length > 20) messages.shift();
  input.value = ''; busy = true; send.disabled = true; updateState('thinking');
  const pending = addMessage('assistant', 'Thinking…', 'pending');
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, voice, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
    const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('Gemini returned an empty reply. Try again.');
    noteVia('chat', data.via);
    pending.textContent = data.reply; pending.classList.remove('pending'); messages.push({ role: 'assistant', content: data.reply });
    if (voiceOn) await speak(data.reply); else updateState('idle');
  } catch (err) { pending.remove(); addMessage('assistant', err.message || 'Could not reach Gemini. Check the setup and try again.', 'error'); messages.pop(); updateState('error'); setTimeout(() => updateState('idle'), 2000); }
  finally { busy = false; send.disabled = false; input.focus(); if (document.body.dataset.state === 'thinking') updateState('idle'); }
}
form.addEventListener('submit', (event) => { event.preventDefault(); if (live.on) live.sendText(input.value); else sendMessage(input.value); });
document.querySelectorAll('.quick').forEach((button) => button.addEventListener('click', () => { input.value = button.dataset.prompt || ''; input.focus(); input.setSelectionRange(input.value.length, input.value.length); }));
const navPrompts = { '#weather': "What's the weather like where I am today? I'm in ", '#search': 'Search the web for ', '#system': 'Open ', '#files': 'Find the file ' };
document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', (event) => {
  const href = item.getAttribute('href');
  if (navPrompts[href]) { event.preventDefault(); input.value = navPrompts[href]; input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  else if (href === '#calendar') { event.preventDefault(); showToast(`${item.textContent.trim()} is unavailable until a compatible integration is configured.`); }
}));

function setVoiceReplies(enabled) {
  voiceOn = Boolean(enabled && voiceConfigured);
  savePreferences({ voiceReplies: voiceOn });
  $('voiceLabel').textContent = voiceOn ? 'Voice replies on' : voiceConfigured ? 'Voice replies off' : 'Voice not configured';
  voiceToggle.title = voiceOn ? 'Disable spoken replies' : 'Enable spoken replies';
  if (enabled && !voiceConfigured) { voiceOn = false; $('voiceLabel').textContent = 'Voice not configured'; showToast('Add GEMINI_API_KEY to the app .env file to enable voice.'); }
}
async function transcribe(blob) {
  const response = await fetch('/api/voice/asr', { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
  const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Could not transcribe that recording.');
  noteVia('voice', data.via); return data.text;
}
async function processUtterance(blob) {
  if (!blob.size || !handsFreeEnabled) return;
  if (blob.size > 8 * 1024 * 1024) { showToast('That utterance was too large. Try a shorter phrase.'); updateState('listening'); return; }
  updateState('thinking');
  try {
    const transcript = await transcribe(blob);
    const awake = !regularAsleep();
    if (!awake && !nameHeard(transcript)) { updateState('listening'); return; }
    regularSleeping = false;
    if (!awake && transcript.trim().split(/\s+/).length < 2) { regularAwakeUntil = Date.now() + REGULAR_FOLLOW_MS; updateHandsFreeUI(); updateState('listening'); return; }
    if (handsFreeEnabled && transcript) {
      const goodnight = isSleepCommand(transcript);
      await sendMessage(transcript, { voice: true }); regularAwakeUntil = Date.now() + REGULAR_FOLLOW_MS;
      if (goodnight) regularSleep(); else updateHandsFreeUI();
    }
  } catch (err) {
    // Background noise that contained no words is not worth an error bubble.
    if (/No speech was detected/.test(err.message)) { if (handsFreeEnabled) updateState('listening'); return; }
    addMessage('assistant', err.message || 'Voice transcription failed. You can also type your message.', 'error'); updateState('error'); await new Promise((r) => setTimeout(r, 1800));
  }
  if (handsFreeEnabled) updateState('listening');
}
// Regular voice captures raw 40 ms blocks and keeps the half second before speech starts, so the
// first word ("Jarvis") is never clipped. A phrase ends after 1.4 s of quiet and goes up as a WAV.
const PRE_BLOCKS = 13, END_QUIET = 35, MAX_BLOCKS = 500, MIN_VOICED = 8;
let micNode = null, preroll = [], utter = null, quietBlocks = 0, loudBlocks = 0, voicedBlocks = 0;
function onRegularBlock(block) {
  if (!handsFreeEnabled) return;
  let sum = 0; for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
  const rms = Math.sqrt(sum / block.length);
  if (busy || currentAudio && !currentAudio.paused) { utter = null; preroll = []; loudBlocks = 0; return; }
  const threshold = Math.max(0.02, noiseFloor * 3.2);
  if (!utter) {
    noiseFloor = noiseFloor * 0.97 + Math.min(rms, 0.05) * 0.03;
    preroll.push(block); if (preroll.length > PRE_BLOCKS) preroll.shift();
    loudBlocks = rms > threshold ? loudBlocks + 1 : 0;
    if (loudBlocks >= 3) { utter = preroll; preroll = []; quietBlocks = 0; voicedBlocks = loudBlocks; loudBlocks = 0; recorder = true; updateState('listening'); }
    return;
  }
  utter.push(block);
  if (rms > threshold) { quietBlocks = 0; voicedBlocks++; } else quietBlocks++;
  if (quietBlocks >= END_QUIET || utter.length >= MAX_BLOCKS) {
    const blocks = utter; utter = null; recorder = null;
    if (voicedBlocks >= MIN_VOICED) processUtterance(toWav(blocks, audioContext.sampleRate));
  }
}
// 16 kHz mono 16-bit WAV: small to upload, and every speech service reads it.
function toWav(blocks, rate) {
  const total = blocks.reduce((n, b) => n + b.length, 0), step = rate / 16000, count = Math.floor(total / step);
  const all = new Float32Array(total); let o = 0; for (const b of blocks) { all.set(b, o); o += b.length; }
  const view = new DataView(new ArrayBuffer(44 + count * 2));
  const text = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const a = Math.floor(i * step), b = Math.min(total, Math.floor((i + 1) * step)); let v = 0;
    for (let j = a; j < b; j++) v += all[j]; v /= Math.max(1, b - a);
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}
async function enableHandsFree() {
  if (handsFreeEnabled && micStream) return;
  if (!voiceConfigured) { handsFreeEnabled = false; await savePreferences({ handsFree: false }); updateHandsFreeUI(); showToast('Add GEMINI_API_KEY to the app .env file to enable hands-free voice.'); return; }
  handsFreeEnabled = true; updateHandsFreeUI(); updateState('thinking');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (!handsFreeEnabled) { stream.getTracks().forEach((track) => track.stop()); return; }
    micStream = stream; audioContext = new AudioContext(); await audioContext.resume(); analyser = audioContext.createAnalyser(); analyser.fftSize = 1024; sourceNode = audioContext.createMediaStreamSource(stream); sourceNode.connect(analyser); avatar?.attach({ input: analyser });
    await audioContext.audioWorklet.addModule('/mic-worklet.js'); micNode = new AudioWorkletNode(audioContext, 'mic-capture'); micNode.port.onmessage = (e) => onRegularBlock(e.data); sourceNode.connect(micNode);
    preroll = []; utter = null; recorder = null;
    await savePreferences({ handsFree: true }); updateHandsFreeUI(); updateState('listening');
  } catch (err) {
    if (micStream) micStream.getTracks().forEach((track) => track.stop()); micStream = null;
    if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
    handsFreeEnabled = false; await savePreferences({ handsFree: false }); updateHandsFreeUI(); updateState('error');
    showToast(err.name === 'NotAllowedError' ? 'Allow microphone access in the app to enable hands-free listening.' : 'Could not start the microphone. Check that it is connected and available.'); setTimeout(() => updateState('idle'), 2200);
  }
}
async function disableHandsFree() {
  handsFreeEnabled = false; await savePreferences({ handsFree: false }); updateHandsFreeUI(); cancelAnimationFrame(vadFrame); clearTimeout(recordingTimer);
  if (micNode) { micNode.port.onmessage = null; micNode.disconnect(); micNode = null; } utter = null; preroll = []; recorder = null;
  if (micStream) micStream.getTracks().forEach((track) => track.stop()); micStream = null; analyser = null; sourceNode = null;
  if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
  updateState('idle');
}
function speakable(text) {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#>`~]+/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim().slice(0, 4000);
}
function stopSpeaking() { if (currentAudio && !currentAudio.paused) { currentAudio.pause(); updateState('idle'); } }
async function speak(text) {
  if (!voiceOn) { updateState('idle'); return; }
  text = speakable(text); if (!text) { updateState('idle'); return; }
  updateState('thinking');
  try {
    const response = await fetch('/api/voice/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Could not create the spoken reply.'); }
    noteVia('voice', response.headers.get('x-jarvis-via')); const audioBlob = await response.blob(); if (currentAudio) currentAudio.pause(); if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(audioBlob); currentAudio = new Audio(currentAudioUrl);
    currentAudio.onplay = () => updateState('speaking'); currentAudio.onended = () => updateState('idle'); currentAudio.onerror = () => { updateState('error'); showToast('The spoken reply could not be played.'); setTimeout(() => updateState('idle'), 1800); };
    await currentAudio.play();
  } catch (err) { updateState('idle'); showToast(err.message || 'Speech synthesis failed.'); }
}
// Live conversation over the local Gemini Live bridge: streams 16 kHz mic audio while speech is detected,
// plays 24 kHz reply audio gaplessly, shows both transcripts, and supports barge-in. After a quiet spell it
// sleeps (connection closed, mic stays local) and wakes when it hears "Jarvis", Ctrl+Space, or Ctrl+Shift+J.
const live = (() => {
  const IN_RATE = 16000, OUT_RATE = 24000, PREROLL = 13, HANGOVER = 35, WAKE_HANGOVER = 15, WAKE_MAX = 150;
  const WAKE = WAKE_RE;
  const s = {
    on: false, ready: false, ws: null, handle: null, attempts: 0, stopping: false,
    stream: null, inCtx: null, outCtx: null, worklet: null, inAnalyser: null, outAnalyser: null, gain: null,
    sources: new Set(), nextTime: 0, skipping: false, muted: false, outbox: [], pendingText: null,
    gate: false, above: 0, below: 0, floor: 0.004, preroll: [], awaitTimer: 0, ptt: false,
    asleep: false, wakeEnabled: false, sleepMs: 120000, sleepPending: false, turnDone: false, lastActivity: 0, sleepTimer: 0, wakeChunks: null,
    userEl: null, userText: '', botEl: null, botText: ''
  };

  function toBase64(int16) {
    const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function downsample(block, rate) {
    const ratio = rate / IN_RATE, out = new Int16Array(Math.floor(block.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const start = Math.floor(i * ratio), end = Math.min(block.length, Math.floor((i + 1) * ratio));
      let sum = 0; for (let j = start; j < end; j++) sum += block[j];
      const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return out;
  }
  function wav(chunks) {
    const total = chunks.reduce((n, c) => n + c.length, 0), buf = new ArrayBuffer(44 + total * 2), v = new DataView(buf);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, IN_RATE, true); v.setUint32(28, IN_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, total * 2, true);
    let o = 44; for (const c of chunks) { new Int16Array(buf, o, c.length).set(c); o += c.length * 2; }
    return new Blob([buf], { type: 'audio/wav' });
  }
  const playing = () => s.sources.size > 0;
  const touch = () => { s.lastActivity = performance.now(); };
  // Messages sent while (re)connecting are queued and flushed once the session is ready.
  const sendJson = (msg) => {
    if (s.ready && s.ws?.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify(msg));
    else if (s.on && !s.asleep) { s.outbox.push(msg); if (s.outbox.length > 250) s.outbox.shift(); }
  };

  // Local speech gate: only speech (plus a short pre-roll and tail) is streamed, so idle time costs nothing.
  // While Jarvis talks, the bar is raised so its own voice leaking into the mic doesn't interrupt it.
  function onMicBlock(block) {
    if (!s.on) return;
    let sum = 0; for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
    const rms = Math.sqrt(sum / block.length);
    const threshold = playing() ? Math.max(0.06, s.floor * 6) : Math.max(0.014, s.floor * 3);
    if (!s.gate && !playing() && !s.wakeChunks) s.floor = s.floor * 0.97 + Math.min(rms, 0.05) * 0.03;
    const pcm = downsample(block, s.inCtx.sampleRate);
    const speech = s.ptt || rms > threshold;
    if (speech) { s.above++; s.below = 0; } else { s.above = 0; s.below++; }
    if (s.asleep || (s.mediaPlaying && !s.ptt)) return listenForWake(pcm);
    if (!s.gate) {
      s.preroll.push(pcm); if (s.preroll.length > PREROLL) s.preroll.shift();
      if (s.above >= 2 || s.ptt) {
        s.gate = true; clearTimeout(s.awaitTimer); touch();
        for (const chunk of s.preroll) sendJson({ type: 'audio', data: toBase64(chunk) });
        s.preroll = [];
        if (!playing()) updateState('listening');
      }
      return;
    }
    sendJson({ type: 'audio', data: toBase64(pcm) }); touch();
    if (!s.ptt && s.below >= HANGOVER) endUtterance();
  }
  function endUtterance() {
    s.gate = false; s.below = 0; sendJson({ type: 'audioEnd' });
    if (!playing()) {
      updateState('thinking');
      clearTimeout(s.awaitTimer); s.awaitTimer = setTimeout(() => { if (!playing() && s.on && !s.asleep) updateState('listening'); }, 12000);
    }
  }

  // While asleep: capture each speech burst locally and only transcribe it to check for the wake word.
  function listenForWake(pcm) {
    if (!s.wakeChunks) {
      s.preroll.push(pcm); if (s.preroll.length > PREROLL) s.preroll.shift();
      if (s.above >= 2) { s.wakeChunks = s.preroll.slice(); s.preroll = []; }
      return;
    }
    s.wakeChunks.push(pcm);
    if (s.below >= WAKE_HANGOVER || s.wakeChunks.length >= WAKE_MAX) {
      const chunks = s.wakeChunks; s.wakeChunks = null; s.below = 0;
      if (chunks.length < 10) return;
      fetch('/api/voice/asr', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav(chunks) })
        .then((r) => (r.ok ? r.json() : { text: '' })).then(({ text = '' }) => {
          const m = text.match(WAKE);
          if (m && !s.asleep && s.on && s.mediaPlaying) {
            const said = text.trim(), rest = text.slice(m.index + m[0].length).replace(/^[\s,.!?:;-]+/, '').trim();
            addMessage('user', said); remember('user', said); stopPlayback();
            sendJson({ type: 'text', text: rest.length > 2 ? rest : '[The user said your name while media is playing in the browser. Reply very briefly, such as "Yes, sir?"]' });
            if (isSleepCommand(rest)) sleepAfterReply();
            touch(); updateState('thinking'); return;
          }
          if (m && s.asleep) {
            const rest = text.slice(m.index + m[0].length).replace(/^[\s,.!?:;-]+/, '').trim();
            addMessage('user', text.trim()); remember('user', text.trim());
            const justWake = rest.length <= 2 || /^(wake up|wakey wakey|you up|are you (there|awake)|i'?m back|rise and shine|back online|come back)[.!?]*$/i.test(rest);
            wake(justWake ? '[The user just woke you up. Reply with a very brief acknowledgement, such as "Back online, sir."]' : rest);
          }
        }).catch(() => {});
    }
  }

  function playChunk(b64) {
    if (s.skipping || !s.outCtx) return;
    const bin = atob(b64), bytes = new Uint8Array(bin.length & ~1);
    for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
    const pcm = new Int16Array(bytes.buffer), buffer = s.outCtx.createBuffer(1, pcm.length, OUT_RATE), ch = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = s.outCtx.createBufferSource(); src.buffer = buffer; src.connect(s.gain);
    const at = Math.max(s.nextTime, s.outCtx.currentTime + 0.04);
    src.start(at); s.nextTime = at + buffer.duration; s.sources.add(src);
    src.onended = () => { s.sources.delete(src); touch(); if (!playing() && s.on && !s.asleep) updateState(s.gate ? 'listening' : 'idle'); };
    clearTimeout(s.awaitTimer); touch(); updateState('speaking');
  }
  function stopPlayback() {
    for (const src of s.sources) { try { src.stop(); } catch {} }
    s.sources.clear(); s.nextTime = 0;
  }

  function remember(role, content) { content = content.trim(); if (!content) return; messages.push({ role, content }); while (messages.length > 20) messages.shift(); }
  // "Jarvis, go to sleep" (but not "I'm going to sleep"): let the goodnight reply finish, then sleep.
  function finishUser() { if (s.userEl) { const said = fixHeard(s.userText); if (said !== s.userText) s.userEl.textContent = said; remember('user', said); s.userEl = null; s.userText = ''; window.onUserSpeech?.(''); if (isSleepCommand(said)) sleepAfterReply(); } }
  function sleepAfterReply() {
    if (!s.on || s.asleep || s.sleepPending) return;
    s.sleepPending = true; s.turnDone = false;
    const started = performance.now();
    const tick = () => {
      if (!s.sleepPending || !s.on || s.asleep) { s.sleepPending = false; return; }
      const waited = performance.now() - started;
      if (!playing() && ((s.turnDone && waited > 600) || waited > 7000)) { s.sleepPending = false; sleep(); return; }
      if (waited > 20000) { s.sleepPending = false; sleep(); return; }
      setTimeout(tick, 300);
    };
    setTimeout(tick, 300);
  }
  function finishBot(suffix = '') {
    if (s.botEl) { if (suffix) s.botEl.textContent = s.botText.trim() + suffix; remember('assistant', s.botText); s.botEl = null; s.botText = ''; }
  }
  function append(kind, text) {
    touch();
    if (kind === 'input') {
      if (!s.userEl) s.userEl = addMessage('user', '');
      s.userText += text; s.userEl.textContent = s.userText.trim();
      window.onUserSpeech?.(s.userText);
    } else {
      finishUser();
      if (s.skipping) return;
      if (!s.botEl) s.botEl = addMessage('assistant', '');
      s.botText += text; s.botEl.textContent = s.botText.trim();
    }
    convo.scrollTop = convo.scrollHeight;
  }

  function connect() {
    const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/api/live`);
    s.ws = ws; let failed = '';
    ws.onopen = () => ws.send(JSON.stringify({ type: 'start', handle: s.handle, history: s.handle ? undefined : messages, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
    ws.onmessage = (event) => {
      let m; try { m = JSON.parse(event.data); } catch { return; }
      if (m.type === 'ready') {
        s.ready = true; s.attempts = 0; touch(); updateHandsFreeUI();
        const queued = s.outbox.splice(0); for (const q of queued) ws.send(JSON.stringify(q));
        if (s.pendingText) { ws.send(JSON.stringify({ type: 'text', text: s.pendingText })); s.pendingText = null; updateState('thinking'); }
        else if (!playing()) updateState('listening');
      }
      else if (m.type === 'audio') playChunk(m.data);
      else if (m.type === 'input' || m.type === 'output') append(m.type, m.text);
      else if (m.type === 'toolStart') { touch(); if (!playing()) updateState('thinking'); }
      else if (m.type === 'interrupted') { stopPlayback(); finishBot('…'); s.skipping = false; }
      else if (m.type === 'turnComplete') { finishUser(); finishBot(); s.skipping = false; s.turnDone = true; touch(); }
      else if (m.type === 'handle') s.handle = m.handle;
      else if (m.type === 'notice') showToast(m.text);
      else if (m.type === 'error' || m.type === 'closed' && m.reason) failed = m.message || m.reason;
    };
    ws.onclose = () => {
      if (s.ws !== ws) return;
      s.ready = false; s.ws = null; s.gate = false;
      if (!s.on || s.stopping || s.asleep) return;
      // Fatal setup problems (bad key, quota, unknown model) stop the session instead of retrying.
      if (failed && /quota/i.test(failed)) {
        // Live hit its limit: carry on with the regular record-then-reply voice until Live is available again.
        stop({ save: false }); liveSupported = false;
        showToast('Gemini Live reached its limit, so I switched to regular voice. Live comes back after Google resets it.');
        if (voiceConfigured) enableHandsFree(); return;
      }
      if (failed && /key|LIVE_MODEL|setup is incomplete/i.test(failed) || s.attempts >= 5) {
        showToast(failed || 'Lost the live connection to Gemini.'); stop(); return;
      }
      s.attempts++; updateState('thinking');
      setTimeout(() => { if (s.on && !s.ws && !s.asleep) connect(); }, Math.min(8000, 400 * 2 ** s.attempts));
    };
  }

  function checkSleep() {
    if (!s.on || s.asleep || !s.wakeEnabled || playing() || s.gate || s.ptt || document.querySelector('#confirmBanner:not([hidden])')) return;
    if (performance.now() - s.lastActivity > s.sleepMs) sleep();
  }
  function sleep() {
    if (!s.on || s.asleep) return;
    s.asleep = true; s.gate = false; s.outbox = []; s.preroll = []; s.wakeChunks = null;
    // Wake with a fresh session (recent conversation is passed as history); a resumed one can be stuck mid-tool-call.
    s.handle = null;
    stopPlayback(); finishUser(); finishBot();
    if (s.ws) { const ws = s.ws; s.ws = null; s.ready = false; ws.close(); }
    updateHandsFreeUI(); updateState('asleep');
  }
  function wake(text = '') {
    if (!s.on) { s.pendingText = text || null; start(); return; }
    if (!s.asleep) { if (text) sendText(text, { show: false }); return; }
    s.asleep = false; s.pendingText = text || null; touch();
    updateHandsFreeUI(); updateState('thinking'); connect();
  }

  async function start() {
    if (s.on) return;
    s.on = true; s.stopping = false; s.asleep = false; s.attempts = 0; s.handle = null; touch(); updateHandsFreeUI(); updateState('thinking');
    try {
      s.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (!s.on) { s.stream.getTracks().forEach((t) => t.stop()); return; }
      s.inCtx = new AudioContext(); await s.inCtx.audioWorklet.addModule('/mic-worklet.js');
      const source = s.inCtx.createMediaStreamSource(s.stream);
      s.inAnalyser = s.inCtx.createAnalyser(); s.inAnalyser.fftSize = 1024; source.connect(s.inAnalyser);
      s.worklet = new AudioWorkletNode(s.inCtx, 'mic-capture'); s.worklet.port.onmessage = (e) => onMicBlock(e.data); source.connect(s.worklet);
      s.outCtx = new AudioContext(); s.gain = s.outCtx.createGain(); s.gain.gain.value = s.muted ? 0 : 1;
      s.outAnalyser = s.outCtx.createAnalyser(); s.outAnalyser.fftSize = 1024; s.gain.connect(s.outAnalyser); s.outAnalyser.connect(s.outCtx.destination);
      await Promise.all([s.inCtx.resume(), s.outCtx.resume()]);
      avatar?.attach({ input: s.inAnalyser, output: s.outAnalyser });
      savePreferences({ handsFree: true });
      clearInterval(s.sleepTimer); s.sleepTimer = setInterval(checkSleep, 5000);
      connect();
    } catch (err) {
      stop({ save: true });
      updateState('error'); setTimeout(() => updateState('idle'), 2200);
      showToast(err.name === 'NotAllowedError' ? 'Allow microphone access in the app to talk to J.A.R.V.I.S.' : 'Could not start the microphone. Check that it is connected and available.');
    }
  }

  function stop({ save = true } = {}) {
    if (!s.on) return;
    s.on = false; s.stopping = true; s.ready = false; s.gate = false; s.asleep = false; s.outbox = []; s.pendingText = null;
    clearTimeout(s.awaitTimer); clearInterval(s.sleepTimer);
    if (s.ws) { const ws = s.ws; s.ws = null; ws.close(); }
    stopPlayback(); finishUser(); finishBot();
    s.stream?.getTracks().forEach((t) => t.stop()); s.stream = null;
    if (s.worklet) s.worklet.port.onmessage = null;
    s.inCtx?.close().catch(() => {}); s.outCtx?.close().catch(() => {}); s.inCtx = s.outCtx = s.worklet = null;
    avatar?.attach({ input: null, output: null });
    if (save) savePreferences({ handsFree: false });
    updateHandsFreeUI(); updateState('idle');
  }

  function sendText(text, { show = true } = {}) {
    const content = text.trim(); if (!content || !s.on) return;
    if (s.asleep) { if (show) { addMessage('user', content); remember('user', content); } input.value = ''; wake(content); return; }
    finishUser(); finishBot(); stopPlayback();
    if (show) { addMessage('user', content); remember('user', content); input.value = ''; }
    sendJson({ type: 'text', text: content }); touch(); updateState('thinking');
    if (show && isSleepCommand(content)) sleepAfterReply();
  }
  // Esc: silence the current reply locally and drop the rest of this turn.
  function skipReply() { if (!playing()) return; stopPlayback(); finishBot('…'); s.skipping = true; updateState('listening'); }
  function setMuted(muted) { s.muted = muted; if (s.gain) s.gain.gain.value = muted ? 0 : 1; }
  function configure({ autoSleep, sleepMinutes }) { if (typeof autoSleep === 'boolean') s.wakeEnabled = autoSleep; if (sleepMinutes) s.sleepMs = sleepMinutes * 60000; touch(); }
  // Push-to-talk: holding Ctrl+Space forces the gate open (and wakes Jarvis without the wake word).
  function pushToTalk(down) {
    if (down) { if (!s.on) { start(); } else if (s.asleep) wake(''); s.ptt = true; touch(); stopPlayback(); }
    else if (s.ptt) { s.ptt = false; if (s.gate) endUtterance(); }
  }

  function setMediaPlaying(on) {
    s.mediaPlaying = Boolean(on);
    if (s.mediaPlaying && s.gate) { s.gate = false; s.below = 0; sendJson({ type: 'audioEnd' }); }
    if (!s.mediaPlaying) { s.wakeChunks = null; s.preroll = []; }
    updateHandsFreeUI();
  }
  return { start, stop, sendText, skipReply, setMuted, configure, pushToTalk, sleep, wake, sleepAfterReply, setMediaPlaying, get mediaPlaying() { return s.mediaPlaying; },
    get on() { return s.on; }, get ready() { return s.ready; }, get asleep() { return s.asleep; } };
})();
let alwaysListening = true;
// Regular voice drifts back to sleep once the conversation has been quiet for a while.
setInterval(() => { if (handsFreeEnabled && regularAwakeUntil && Date.now() >= regularAwakeUntil) { regularAwakeUntil = 0; updateHandsFreeUI(); if (!busy && !recorder) updateState('listening'); } }, 5000);
mic.addEventListener('click', async () => {
  if (!live.on && !handsFreeEnabled) liveSupported = await fetch('/api/status').then((r) => r.json()).then((st) => Boolean(st.live)).catch(() => liveSupported);
  if (!liveSupported) { if (handsFreeEnabled) disableHandsFree(); else enableHandsFree(); return; }
  if (!live.on) live.start();
  else if (alwaysListening) { if (live.asleep) live.wake('[The user just woke you up. Reply with a very brief acknowledgement, such as "Back online, sir."]'); else live.sleep(); }
  else live.stop();
});
voiceToggle.addEventListener('click', () => { setVoiceReplies(!voiceOn); live.setMuted(!voiceOn); if (!voiceOn) { if (currentAudio) currentAudio.pause(); updateState('idle'); } });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { stopSpeaking(); live.skipReply(); } });
window.addEventListener('beforeunload', () => { live.stop({ save: false }); cancelAnimationFrame(vadFrame); if (micStream) micStream.getTracks().forEach((track) => track.stop()); if (currentAudio) currentAudio.pause(); if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl); });








