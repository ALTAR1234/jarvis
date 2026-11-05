// Controller: volume, brightness, media keys, Do Not Disturb, focus modes, the brain, and Locker settings.
(() => {
  const { $, $$, esc, get, post, toast } = kit;
  let state = {};
  async function load() {
    state = await get('/api/controller');
    if (state.volume) { $('#vol').value = state.volume.level; $('#volv').textContent = state.volume.muted ? 'muted' : state.volume.level + '%'; }
    if (state.brightness != null) { $('#bri').value = state.brightness; $('#briv').textContent = state.brightness + '%'; } else { $('#bri').disabled = true; $('#briv').textContent = 'n/a'; }
    $('#dnd').classList.toggle('on', state.dnd);
    const bat = state.battery && !state.battery.none ? state.battery : null;
    $('#stats').innerHTML = `${bat ? `<div class="stat">Battery <b>${bat.percent}%${bat.charging ? ' · charging' : ''}</b></div>` : ''}${state.network ? `<div class="stat">Network <b>↓ ${state.network.downKBps} KB/s · ↑ ${state.network.upKBps} KB/s</b></div>` : ''}`;
    const B = [['gemini', 'Gemini', '✦', 'free default'], ['claude', 'Claude', '✳', 'Opus 5.5'], ['chatgpt', 'ChatGPT', '❂', 'OpenAI'], ['big', 'Big Brain', '🧠', 'all three, merged']];
    const have = state.brains || {};
    const ready = (k) => (k === 'big' ? [have.gemini, have.claude, have.chatgpt].filter(Boolean).length >= 2 : have[k]);
    $('#brains').innerHTML = B.map(([k, l, i, s]) => `<button class="tile${state.brain === k ? ' on' : ''}" data-brain="${k}" ${ready(k) ? '' : 'disabled title="Add the API key first"'}><span>${i}</span>${l}<small>${ready(k) ? s : 'needs a key'}</small></button>`).join('');
    $$('[data-brain]').forEach((b) => (b.onclick = async () => { await post('/api/preferences', { brain: b.dataset.brain }); toast(`Using ${b.textContent.trim().split(/\s{2,}/)[0]}`); load(); }));
    const prefs = await get('/api/preferences');
    const CB = [['gemini', 'Gemini', '✦', 'fastest'], ['claude', 'Claude', '✳', 'smartest'], ['chatgpt', 'ChatGPT', '❂', 'OpenAI']];
    $('#chatbrain').innerHTML = CB.map(([k, l, i, s]) => `<button class="tile${prefs.chatBrain === k ? ' on' : ''}" data-chatbrain="${k}" ${have[k] ? '' : 'disabled title="Add the API key first"'}><span>${i}</span>${l}<small>${have[k] ? s : 'needs a key'}</small></button>`).join('');
    $$('[data-chatbrain]').forEach((b) => (b.onclick = async () => { await post('/api/preferences', { chatBrain: b.dataset.chatbrain }); toast(`${b.dataset.chatbrain === 'chatgpt' ? 'ChatGPT' : b.dataset.chatbrain[0].toUpperCase() + b.dataset.chatbrain.slice(1)} answers now`); load(); }));
    const SE = [['claude', 'Claude', '✳', 'most accurate'], ['chatgpt', 'ChatGPT', '❂', 'OpenAI'], ['gemini', 'Gemini', '✦', 'Google']];
    $('#screenengine').innerHTML = SE.map(([k, l, i, s]) => `<button class="tile${prefs.screenEngine === k ? ' on' : ''}" data-screen="${k}" ${have[k] ? '' : 'disabled title="Add the API key first"'}><span>${i}</span>${l}<small>${have[k] ? s : 'needs a key'}</small></button>`).join('');
    $$('[data-screen]').forEach((b) => (b.onclick = async () => { await post('/api/preferences', { screenEngine: b.dataset.screen }); toast(`${{ claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini' }[b.dataset.screen]} controls the screen now`); load(); }));
    const SV = [['gemini', 'Gemini', '✦', 'your chosen Gemini voice'], ['openai', 'ChatGPT', '❂', 'OpenAI voice']];
    $('#speakvoice').innerHTML = SV.map(([k, l, i, s]) => { const ok = k === 'openai' ? have.chatgpt : have.gemini; return `<button class="tile${prefs.speakVoice === k ? ' on' : ''}" data-speak="${k}" ${ok ? '' : 'disabled title="Add the API key first"'}><span>${i}</span>${l}<small>${ok ? s : 'needs a key'}</small></button>`; }).join('');
    $$('[data-speak]').forEach((b) => (b.onclick = async () => { await post('/api/preferences', { speakVoice: b.dataset.speak }); toast(`${b.dataset.speak === 'openai' ? 'ChatGPT' : 'Gemini'} voice speaks now`); load(); }));
    const pick = prefs.liveVoice === false ? 'regular' : prefs.liveEngine || 'gemini';
    $$('[data-live]').forEach((b) => { b.classList.toggle('on', (b.dataset.engine || 'regular') === pick); if (b.dataset.engine === 'chatgpt' && !state.brains?.chatgpt) { b.disabled = true; b.title = 'Add OPENAI_API_KEY first'; } });
    const lk = await get('/api/locker');
    $('#pinstate').textContent = lk.hasPin ? 'set' : 'not set';
    $('#lockstart').textContent = lk.lockOnStart ? 'On' : 'Off';
    $('#lockstart').classList.toggle('on', lk.lockOnStart);
    $('#idle').value = String(lk.lockIdleMinutes);
  }
  let vt, bt;
  $('#vol').oninput = () => { $('#volv').textContent = $('#vol').value + '%'; clearTimeout(vt); vt = setTimeout(() => post('/api/controller/volume', { level: +$('#vol').value }).catch((e) => toast(e.message)), 150); };
  $('#bri').oninput = () => { $('#briv').textContent = $('#bri').value + '%'; clearTimeout(bt); bt = setTimeout(() => post('/api/controller/brightness', { level: +$('#bri').value }).catch((e) => toast(e.message)), 200); };
  $('#mute').onclick = async () => { const v = await post('/api/controller/volume', { mute: !state.volume?.muted }); state.volume = v; $('#volv').textContent = v.muted ? 'muted' : v.level + '%'; };
  $$('[data-m]').forEach((b) => (b.onclick = () => post('/api/controller/media', { action: b.dataset.m }).catch((e) => toast(e.message))));
  $$('[data-set]').forEach((b) => (b.onclick = () => post('/api/controller/settings', { page: b.dataset.set }).catch((e) => toast(e.message))));
  $('#dnd').onclick = async () => { await post('/api/preferences', { dnd: !state.dnd }); load(); };
  $$('[data-live]').forEach((b) => (b.onclick = async () => { const live = b.dataset.live === 'true'; await post('/api/preferences', live ? { liveVoice: true, liveEngine: b.dataset.engine } : { liveVoice: false }); toast(live ? `Live voice with ${b.dataset.engine === 'chatgpt' ? 'ChatGPT' : 'Gemini'}` : 'Regular voice on'); load(); }));
  $('#lock').onclick = () => post('/api/locker/lock');
  $$('[data-focus]').forEach((b) => (b.onclick = async () => { const r = await post('/api/controller/focus', { mode: b.dataset.focus }).catch((e) => toast(e.message)); if (r) toast(`${b.dataset.focus[0].toUpperCase() + b.dataset.focus.slice(1)} mode`); load(); }));
  $('#savepin').onclick = async () => {
    try { const r = await post('/api/locker/pin', { old: $('#oldpin').value, pin: $('#newpin').value }); toast(r.hasPin ? 'PIN saved' : 'PIN removed'); $('#oldpin').value = $('#newpin').value = ''; load(); }
    catch (e) { toast(e.message); }
  };
  $('#lockstart').onclick = async () => { await post('/api/preferences', { lockOnStart: $('#lockstart').textContent !== 'On' }); load(); };
  $('#idle').onchange = async () => { await post('/api/preferences', { lockIdleMinutes: +$('#idle').value }); toast('Saved'); };
  // Voice words and corrections
  async function loadWords(d) {
    d = d || await get('/api/voicefix');
    $('#vwords').innerHTML = d.words.length ? d.words.map((w) => `<span class="chip">${esc(w)}<button data-rmw="${esc(w)}" title="Remove">×</button></span>`).join('') : '<small style="color:var(--faint)">None yet</small>';
    $('#vfixes').innerHTML = d.fixes.length ? d.fixes.map((f) => `<div class="fix"><span><s>${esc(f.heard)}</s> → <b>${esc(f.said)}</b></span><button data-rmf="${esc(f.heard)}" title="Remove">×</button></div>`).join('') : '<small style="color:var(--faint)">None yet</small>';
    $$('[data-rmw]').forEach((b) => (b.onclick = async () => loadWords(await post('/api/voicefix/word', { word: b.dataset.rmw, remove: true }))));
    $$('[data-rmf]').forEach((b) => (b.onclick = async () => loadWords(await post('/api/voicefix/fix', { heard: b.dataset.rmf, remove: true }))));
  }
  $('#addvword').onclick = async () => { try { loadWords(await post('/api/voicefix/word', { word: $('#vword').value })); $('#vword').value = ''; } catch (e) { toast(e.message); } };
  $('#addvfix').onclick = async () => { try { loadWords(await post('/api/voicefix/fix', { heard: $('#vheard').value, said: $('#vsaid').value })); $('#vheard').value = $('#vsaid').value = ''; toast('Got it. I will hear that right from now on.'); } catch (e) { toast(e.message); } };
  $('#vword').onkeydown = (e) => { if (e.key === 'Enter') $('#addvword').click(); };
  $('#vsaid').onkeydown = (e) => { if (e.key === 'Enter') $('#addvfix').click(); };
  loadWords().catch(() => {});
  // Only my voice: record a few sentences at 16 kHz and send them as WAV files to build the voice fingerprint.
  const LINES = ['Jarvis, what is the weather like today?', 'Hey Jarvis, open Spotify and play my music.', 'Remind me to finish my homework at seven tonight.', 'Jarvis, how much battery do I have left?', 'Turn the volume down a little and pause the video.', 'What time is it in Tokyo right now?'];
  let vid = null, recording = false;
  function showVid(d) {
    vid = d;
    const model = d.model === 'downloading' ? ' · downloading the voice model…' : '';
    $('#vidstate').textContent = d.active ? `On · learned from ${d.samples} sentences${d.ignored ? ` · ignored ${d.ignored} other voices` : ''}` : d.samples >= 3 ? 'Off' : `${d.samples} of ${d.needed} sentences recorded${model}`;
    $('#vidprompt').innerHTML = d.samples < d.needed ? `Say: <b>“${esc(LINES[d.samples % LINES.length])}”</b>` : 'All set. You can record more sentences anytime to make it more accurate.';
    $('#viden').checked = d.enabled; $('#viden').disabled = d.samples < 3; $('#vidstrict').value = d.strictness;
    $('#vidtest').disabled = !d.samples;
  }
  async function record(seconds) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const ctx = new AudioContext(); await ctx.audioWorklet.addModule('/mic-worklet.js');
    const node = new AudioWorkletNode(ctx, 'mic-capture'), src = ctx.createMediaStreamSource(stream), blocks = [];
    node.port.onmessage = (e) => blocks.push(e.data); src.connect(node);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    src.disconnect(); stream.getTracks().forEach((t) => t.stop()); const rate = ctx.sampleRate; await ctx.close();
    const total = blocks.reduce((n, b) => n + b.length, 0), step = rate / 16000, count = Math.floor(total / step);
    const all = new Float32Array(total); let o = 0; for (const b of blocks) { all.set(b, o); o += b.length; }
    const view = new DataView(new ArrayBuffer(44 + count * 2));
    const text = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, count * 2, true);
    for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, all[Math.floor(i * step)])) * 0x7fff, true);
    return new Blob([view.buffer], { type: 'audio/wav' });
  }
  const sendWav = (url, blob) => fetch(url, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: blob }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; });
  async function capture(btn, label, url) {
    if (recording) return; recording = true; const old = btn.textContent;
    try {
      btn.textContent = label; btn.disabled = true;
      const blob = await record(5);
      btn.textContent = vid.model === 'ready' ? 'Learning…' : 'Getting the voice model (first time only)…';
      return await sendWav(url, blob);
    } finally { recording = false; btn.textContent = old; btn.disabled = false; }
  }
  $('#vidrec').onclick = async () => {
    try { const d = await capture($('#vidrec'), '● Recording… read the sentence', '/api/voiceid/enroll'); showVid(d); toast(d.active && d.samples === 3 ? 'Learned your voice. J.A.R.V.I.S. now only listens to you.' : 'Got it'); }
    catch (e) { toast(e.message); get('/api/voiceid').then(showVid).catch(() => {}); }
  };
  $('#vidtest').onclick = async () => {
    try { const r = await capture($('#vidtest'), '● Say anything…', '/api/voiceid/test'); toast(r.ok ? `That's you (match ${Math.round(r.score * 100)}%)` : `That didn't sound like you (match ${Math.round(r.score * 100)}%). Record a few more sentences, or pick Relaxed.`); }
    catch (e) { toast(e.message); }
  };
  $('#vidreset').onclick = async () => { if (confirm('Forget your voice and start over?')) showVid(await post('/api/voiceid/reset')); };
  $('#viden').onchange = async () => { showVid(await post('/api/voiceid/settings', { enabled: $('#viden').checked })); toast($('#viden').checked ? 'Only listening to your voice' : 'Listening to everyone'); };
  $('#vidstrict').onchange = async () => { showVid(await post('/api/voiceid/settings', { strictness: $('#vidstrict').value })); toast('Saved'); };
  get('/api/voiceid').then(showVid).catch((e) => toast(e.message));

  $('#screencheck').onclick = async (e) => {
    e.preventDefault(); $('#screencheckout').textContent = 'Checking…';
    try { const r = await post('/api/screen/check'); $('#screencheckout').textContent = ['claude', 'chatgpt', 'gemini'].map((k) => `${{ claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini' }[k]}: ${r[k]?.ok ? 'ready' : r[k]?.message || 'not set up'}`).join(' · '); }
    catch (err) { $('#screencheckout').textContent = err.message; }
  };

  load().catch((e) => toast(e.message));
})();
