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
    $$('[data-live]').forEach((b) => b.classList.toggle('on', String(prefs.liveVoice !== false) === b.dataset.live));
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
  $$('[data-live]').forEach((b) => (b.onclick = async () => { await post('/api/preferences', { liveVoice: b.dataset.live === 'true' }); toast(b.dataset.live === 'true' ? 'Live voice on' : 'Regular voice on'); load(); }));
  $('#lock').onclick = () => post('/api/locker/lock');
  $$('[data-focus]').forEach((b) => (b.onclick = async () => { const r = await post('/api/controller/focus', { mode: b.dataset.focus }).catch((e) => toast(e.message)); if (r) toast(`${b.dataset.focus[0].toUpperCase() + b.dataset.focus.slice(1)} mode`); load(); }));
  $('#savepin').onclick = async () => {
    try { const r = await post('/api/locker/pin', { old: $('#oldpin').value, pin: $('#newpin').value }); toast(r.hasPin ? 'PIN saved' : 'PIN removed'); $('#oldpin').value = $('#newpin').value = ''; load(); }
    catch (e) { toast(e.message); }
  };
  $('#lockstart').onclick = async () => { await post('/api/preferences', { lockOnStart: $('#lockstart').textContent !== 'On' }); load(); };
  $('#idle').onchange = async () => { await post('/api/preferences', { lockIdleMinutes: +$('#idle').value }); toast('Saved'); };
  load().catch((e) => toast(e.message));
})();
