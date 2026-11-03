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
  load().catch((e) => toast(e.message));
})();
