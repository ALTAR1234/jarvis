// HUD panels and assistant events: tool activity chips, permission prompts (buttons or a spoken yes/no),
// live system stats, long-term memory and reminder lists, settings drawer, and keyboard shortcuts.
(() => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json().catch(() => ({})));
  const relTime = (iso) => {
    const mins = Math.round((new Date(iso) - Date.now()) / 60000);
    if (mins < 1) return 'now'; if (mins < 60) return `in ${mins} min`;
    const d = new Date(iso); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  };

  // ---------- tool chips ----------
  const chips = new Map();
  const ICON = { running: '⚙', done: '✓', started: '↗', failed: '✕', denied: '⊘', unverified: '?' };
  function toolEvent(ev) {
    let el = chips.get(ev.id);
    if (!el) {
      el = addMessage('tool', ''); chips.set(ev.id, el);
      // In typed chat, keep tool chips above the reply that is still being written.
      const pending = convo.querySelector('.message.pending'); if (pending) convo.insertBefore(el, pending);
    }
    el.className = `message tool ${ev.status}`;
    el.textContent = `${ICON[ev.status] || '⚙'} ${ev.summary}${ev.status === 'running' ? '…' : ev.status === 'denied' ? ' — declined' : ev.status === 'failed' && ev.error ? ` — ${ev.error}` : ''}`;
    if (ev.status !== 'running') chips.delete(ev.id);
  }

  // ---------- permission prompts ----------
  const queue = []; let current = null, countdown = 0, heard = '';
  const banner = $('confirmBanner');
  function showNext() {
    current = queue.shift() || null;
    // Words already spoken before this prompt appeared must not count as an answer to it.
    if (current) current.ignore = heard;
    clearInterval(countdown);
    if (!current) { banner.hidden = true; return; }
    $('confirmSummary').textContent = current.summary;
    $('confirmDetail').hidden = !current.detail; $('confirmDetail').textContent = current.detail || '';
    let left = 60; $('confirmTimer').textContent = left;
    countdown = setInterval(() => { left--; $('confirmTimer').textContent = Math.max(0, left); }, 1000);
    banner.hidden = false; $('confirmAllow').focus();
  }
  function answer(allow) { if (!current) return; const { id } = current; current = null; post('/api/confirm', { id, allow }); showNext(); }
  $('confirmAllow').addEventListener('click', () => answer(true));
  $('confirmDeny').addEventListener('click', () => answer(false));
  // A spoken "yes"/"no" while a prompt is showing answers it.
  window.onUserSpeech = (text) => {
    heard = text;
    if (!current) return;
    const fresh = current.ignore && text.startsWith(current.ignore) ? text.slice(current.ignore.length) : text;
    const t = fresh.toLowerCase().replace(/^[s,.!?]+/, '').trim();
    if (/^(yes|yeah|yep|yup|sure|ok(ay)?|do it|go ahead|confirm(ed)?|approve[d]?|allow( it)?|affirmative|proceed)\b/.test(t)) answer(true);
    else if (/^(no|nope|nah|cancel|stop|don'?t|deny|negative|abort)\b/.test(t)) answer(false);
  };

  // ---------- system panel ----------
  function bar(id, pct, warnAt) { const el = $(id); if (!el) return; el.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`; el.classList.toggle('warn', warnAt != null && pct >= warnAt); }
  async function refreshStats() {
    if (document.hidden) return;
    try {
      const s = await fetch('/api/system').then((r) => r.json());
      $('statCpu').textContent = s.cpu == null ? '—' : `${s.cpu}%`; bar('barCpu', s.cpu, 85);
      const memPct = s.memory ? Math.round((100 * s.memory.usedGB) / s.memory.totalGB) : 0;
      $('statMem').textContent = s.memory ? `${s.memory.usedGB} / ${s.memory.totalGB} GB` : '—'; bar('barMem', memPct, 90);
      $('statNet').textContent = s.network ? `↓ ${fmtRate(s.network.downKBps)}  ↑ ${fmtRate(s.network.upKBps)}` : '—';
      if (s.battery?.none) { $('statBat').textContent = 'AC power'; bar('barBat', 100); }
      else if (s.battery) { $('statBat').textContent = `${s.battery.percent}%${s.battery.charging ? ' · charging' : ''}`; bar('barBat', s.battery.percent); $('barBat').classList.toggle('warn', s.battery.percent <= 20 && !s.battery.charging); }
      $('statDisk').textContent = s.disk ? `${s.disk.freeGB} GB of ${s.disk.totalGB} GB` : '—';
    } catch {}
  }
  const fmtRate = (k) => (k >= 1024 ? `${(k / 1024).toFixed(1)} MB/s` : `${k} KB/s`);
  refreshStats(); setInterval(refreshStats, 3000);

  // ---------- memory & reminders ----------
  function renderList(el, items, empty, render) {
    el.replaceChildren();
    if (!items.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = empty; el.append(li); return; }
    for (const item of items) el.append(render(item));
  }
  function row(text, meta, onRemove, label) {
    const li = document.createElement('li'), span = document.createElement('span'); span.textContent = text; li.append(span);
    if (meta) { const small = document.createElement('small'); small.textContent = meta; li.append(small); }
    const b = document.createElement('button'); b.type = 'button'; b.textContent = '✕'; b.title = label; b.setAttribute('aria-label', label); b.addEventListener('click', onRemove); li.append(b);
    return li;
  }
  async function loadMemory() {
    const { memories = [] } = await fetch('/api/memory').then((r) => r.json()).catch(() => ({}));
    renderList($('memoryList'), memories, 'Nothing yet. Tell me about yourself and I will remember.', (m) => row(m.text, '', () => post('/api/memory/forget', { id: m.id }).then(loadMemory), 'Forget this'));
  }
  let reminderCache = [];
  function drawReminders() { renderList($('reminderList'), reminderCache, 'No reminders. Try “remind me in 20 minutes to…”', (r) => row(r.text, relTime(r.due), () => post('/api/reminders/cancel', { id: r.id }).then(loadReminders), 'Cancel reminder')); }
  async function loadReminders() { ({ reminders: reminderCache = [] } = await fetch('/api/reminders').then((r) => r.json()).catch(() => ({}))); drawReminders(); }
  loadMemory(); loadReminders(); setInterval(drawReminders, 30000);

  function reminderDue(ev) {
    addMessage('assistant', `⏰ Reminder: ${ev.text}`);
    const note = `[System notice, not from the user: a reminder the user set is due now: "${ev.text}". Tell them briefly.]`;
    if (live.on) live.asleep ? live.wake(note) : live.sendText(note, { show: false });
    else if (voiceOn) speak(`Reminder: ${ev.text}`);
  }

  // ---------- event stream ----------
  function connectEvents() {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      let ev; try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.type === 'tool') toolEvent(ev);
      else if (ev.type === 'confirm') { queue.push(ev); if (!current) showNext(); }
      else if (ev.type === 'confirmResolved') { const i = queue.findIndex((q) => q.id === ev.id); if (i >= 0) queue.splice(i, 1); if (current?.id === ev.id) { current = null; showNext(); } }
      else if (ev.type === 'memory') loadMemory();
      else if (ev.type === 'reminders') loadReminders();
      else if (ev.type === 'reminder') reminderDue(ev);
      else if (ev.type === 'sleep') { if (live.on) live.sleepAfterReply(); else window.jarvisRegularSleep?.(); }
      else if (ev.type === 'appdock') window.jarvisAppPanel?.[ev.action]?.(ev);
      else if (ev.type === 'launcher') window.jarvisLauncher?.[ev.action]?.();
      else if (ev.type === 'browser') window.jarvisBrowser?.[ev.action]?.();
      else if (ev.type === 'screen' && ev.done) { addMessage('assistant', ev.text, ev.error ? 'error' : ''); messages.push({ role: 'assistant', content: ev.text }); if (!live.on && voiceOn) speak(ev.text); else showToast(ev.text); }
      else if (ev.type === 'briefing') window.dispatchEvent(new CustomEvent('jarvis-briefing', { detail: ev }));
      else if (ev.type === 'profile') fetch('/api/preferences').then((r) => r.json()).then((p) => { $('userName').textContent = p.userName || 'there'; });
    };
  }
  connectEvents();

  // ---------- settings ----------
  const drawer = $('settingsDrawer');
  async function openSettings() {
    const prefs = await fetch('/api/preferences').then((r) => r.json()).catch(() => ({}));
    $('setWake').checked = prefs.autoSleep === true; $('setAlways').checked = prefs.alwaysListening !== false;
    $('setSleep').value = String(prefs.sleepMinutes || 2);
    const voice = $('setVoice'); voice.replaceChildren(...(prefs.voices || ['Charon']).map((v) => new Option(v, v)));
    voice.value = prefs.voiceName || 'Charon';
    const { tools = [] } = await fetch('/api/tools').then((r) => r.json()).catch(() => ({}));
    const plugins = tools.filter((t) => t.plugin);
    $('pluginInfo').textContent = `${tools.length} tools available${plugins.length ? ` · plugins: ${plugins.map((t) => t.name).join(', ')}` : ''}. Drop a .js skill into the plugins folder, then reload.`;
    drawer.hidden = false; $('settingsClose').focus();
  }
  const closeSettings = () => { drawer.hidden = true; };
  $('settingsClose').addEventListener('click', closeSettings);
  drawer.addEventListener('click', (e) => { if (e.target === drawer) closeSettings(); });
  $('setWake').addEventListener('change', (e) => { savePreferences({ autoSleep: e.target.checked }); live.configure({ autoSleep: e.target.checked }); });
  $('setAlways').addEventListener('change', (e) => { alwaysListening = e.target.checked; savePreferences({ alwaysListening }); if (alwaysListening && !live.on) live.start(); });
  $('setSleep').addEventListener('change', (e) => { const n = Number(e.target.value); savePreferences({ sleepMinutes: n }); live.configure({ sleepMinutes: n }); });
  $('setVoice').addEventListener('change', (e) => { savePreferences({ voiceName: e.target.value }); showToast(`Voice set to ${e.target.value}. It applies from the next live session.`); });
  document.querySelectorAll('[data-folder]').forEach((b) => b.addEventListener('click', () => post('/api/open-folder', { which: b.dataset.folder })));
  async function reloadPlugins() {
    const r = await post('/api/plugins/reload', {});
    showToast(r.errors?.length ? `Plugin problems: ${r.errors.join('; ')}` : `Plugins loaded: ${(r.tools || []).map((t) => t.name).join(', ') || 'none'}. Restart the live session to use new ones.`);
  }
  $('reloadPlugins').addEventListener('click', reloadPlugins);
  window.jarvisReloadPlugins = reloadPlugins;
  document.querySelector('.nav-item[href="#settings"]')?.addEventListener('click', (e) => { e.preventDefault(); openSettings(); });

  // ---------- shortcuts ----------
  window.jarvisHotkey = () => {
    if (!liveSupported) { if (handsFreeEnabled) disableHandsFree(); else enableHandsFree(); return; }
    if (!live.on) live.start(); else if (live.asleep) live.wake('[The user pressed your wake shortcut. Reply with a very brief acknowledgement, such as "Sir?"]'); else live.sleep();
  };
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.ctrlKey && !e.repeat && liveSupported) { e.preventDefault(); live.pushToTalk(true); }
    else if (e.key === 'Escape' && !drawer.hidden) closeSettings();
  });
  document.addEventListener('keyup', (e) => { if (e.code === 'Space' || e.key === 'Control') live.pushToTalk(false); });
  window.addEventListener('blur', () => live.pushToTalk(false));
})();

// ---------- dock & window controls (stand in for the Windows taskbar in full screen) ----------
(async () => {
  const dock = document.getElementById('dock');
  const launch = (target) => fetch('/api/launch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target }) })
    .then((r) => r.json()).then((r) => { if (r.error) showToast(r.error); }).catch(() => showToast('Could not open that.'));
  document.getElementById('dockStart').addEventListener('click', () => window.jarvisLauncher?.toggle());
  { const web = document.createElement('button'); web.type = 'button'; web.textContent = '◎'; web.dataset.label = 'Browser'; web.setAttribute('aria-label', 'Open the built-in web browser');
    web.addEventListener('click', () => window.jarvisBrowser?.toggle()); dock.append(web); }
  for (const id of ['dockPinned', 'dockDocked', 'dockRunning']) { const g = document.createElement('span'); g.id = id; g.className = 'dock-group'; dock.append(g); }
  try {
    const { apps = [], windowControls } = await fetch('/api/dock').then((r) => r.json());
    if (apps.length) { const sep = document.createElement('span'); sep.className = 'sep'; document.getElementById('dockPinned').append(sep); }
    for (const app of apps) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = app.glyph; b.dataset.label = app.label;
      b.setAttribute('aria-label', `Open ${app.label}`); b.addEventListener('click', () => launch(app.id)); document.getElementById('dockPinned').append(b);
    }
    const controls = document.getElementById('winControls');
    controls.hidden = !windowControls;
    controls.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => fetch('/api/window', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: b.dataset.win }) })));
  } catch {}
})();

// ---------- greeting & briefing (weather line, news ticker, spoken greeting at startup) ----------
(() => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let prefs = {}, lastHeadlines = [];
  const daypart = () => { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; };

  async function loadProfile() {
    prefs = await fetch('/api/preferences').then((r) => r.json()).catch(() => ({}));
    $('userName').textContent = prefs.userName || 'there';
    return prefs;
  }
  function renderWeather(w) {
    const line = $('weatherLine');
    if (!w) { line.textContent = prefs.homeCity ? 'Weather is unavailable right now.' : 'I’m J.A.R.V.I.S. — set your home city in Settings for local weather.'; return; }
    line.replaceChildren();
    const icon = document.createElement('span'); icon.className = 'wx-icon'; icon.textContent = w.icon;
    const temp = document.createElement('b'); temp.textContent = `${w.temp}${w.unit}`;
    line.append(icon, temp, ` · ${w.condition} in ${w.place}${Number.isFinite(w.high) ? ` · H ${w.high}° / L ${w.low}°` : ''}${w.rainChance ? ` · ${w.rainChance}% rain` : ''}`);
  }
  async function refreshWeather() { const { weather } = await fetch('/api/weather').then((r) => r.json()).catch(() => ({})); renderWeather(weather); return weather; }
  function renderTicker(headlines) {
    if (!headlines?.length) return;
    lastHeadlines = headlines;
    const track = $('tickerTrack'); track.replaceChildren();
    // Two copies make the scroll loop seamless.
    for (let copy = 0; copy < 2; copy++) for (const h of headlines) {
      const b = document.createElement('button'); b.type = 'button'; b.title = h.summary || h.headline; if (copy) b.tabIndex = -1;
      b.textContent = h.headline; const src = document.createElement('small'); src.textContent = h.source; b.append(src);
      b.addEventListener('click', () => fetch('/api/launch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: `https://www.google.com/search?tbm=nws&q=${encodeURIComponent(h.headline)}` }) }));
      track.append(b);
    }
    track.style.setProperty('--ticker-duration', `${Math.max(40, headlines.reduce((n, h) => n + h.headline.length, 0) * 0.32)}s`);
    $('newsTicker').hidden = false;
  }
  window.addEventListener('jarvis-briefing', (e) => renderTicker(e.detail.headlines));

  // Speak through the live session when it is running, otherwise through text-to-speech, one item at a time.
  async function untilQuiet(ms = 45000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const busyLive = live.on && ['speaking', 'thinking'].includes(document.body.dataset.state);
      const busyTts = currentAudio && !currentAudio.paused && !currentAudio.ended;
      if (!busyLive && !busyTts && !busy) return; await wait(250);
    }
  }
  async function say(text) {
    await untilQuiet();
    if (live.on) { live.sendText(`[System notice, not from the user: say this to the user now, in your own voice, without adding anything: "${text}"]`, { show: false }); return; } // its transcript appears as the reply
    addMessage('assistant', text); remember(text);
    if (voiceOn) { await speak(text); await wait(300); }
  }
  const remember = (content) => { messages.push({ role: 'assistant', content }); while (messages.length > 20) messages.shift(); };

  async function brief({ greet = true, readNews = true, fresh = false } = {}) {
    const weather = await refreshWeather();
    if (greet) {
      const name = prefs.userName || 'sir';
      const wx = weather ? ` It is ${weather.temp} degrees and ${weather.condition} in ${weather.place.split(',')[0]}${Number.isFinite(weather.high) ? `, with a high of ${weather.high} today` : ''}.` : '';
      await say(`Good ${daypart()}, ${name}.${wx}${readNews ? ' One moment while I gather today\'s headlines.' : ' How may I help?'}`);
    }
    const briefing = await fetch(`/api/briefing?tz=${encodeURIComponent(tz)}${fresh ? '&fresh=1' : ''}`).then((r) => r.json()).catch(() => ({}));
    if (briefing.error) { if (readNews) showToast(`Briefing unavailable: ${briefing.error}`); return; }
    renderTicker(briefing.headlines);
    if (readNews) {
      await say(greet ? briefing.newsSpeech : briefing.speech);
      savePreferences({ lastBriefingAt: Date.now() });
    }
  }
  window.jarvisBrief = brief;

  $('briefMe').addEventListener('click', () => brief({ greet: false, readNews: true }));
  $('briefNow').addEventListener('click', () => { $('settingsDrawer').hidden = true; brief({ greet: false, readNews: true, fresh: true }); });

  // Settings: profile fields save on change.
  const field = (id, key) => $(id).addEventListener('change', async (e) => {
    const value = e.target.value.trim(); await savePreferences({ [key]: value }); await loadProfile();
    if (key === 'homeCity') refreshWeather();
  });
  field('setName', 'userName'); field('setCity', 'homeCity'); field('setTopics', 'newsTopics');
  $('setBriefing').addEventListener('change', (e) => savePreferences({ briefingOnStart: e.target.checked }));
  document.querySelector('.nav-item[href="#settings"]')?.addEventListener('click', async () => {
    await loadProfile();
    $('setName').value = prefs.userName || ''; $('setCity').value = prefs.homeCity || ''; $('setTopics').value = prefs.newsTopics || ''; $('setBriefing').checked = prefs.briefingOnStart !== false;
  });

  // Startup: greet every launch; read the headlines only if the last full briefing was over 3 hours ago.
  (async () => {
    await loadProfile();
    await wait(1200); // let the live session (if resuming) connect first
    if (prefs.briefingOnStart === false) { refreshWeather(); fetch(`/api/briefing?tz=${encodeURIComponent(tz)}`).then((r) => r.json()).then((b) => renderTicker(b.headlines)).catch(() => {}); return; }
    brief({ greet: true, readNews: Date.now() - (prefs.lastBriefingAt || 0) > 3 * 3600 * 1000 });
  })();
  setInterval(refreshWeather, 15 * 60 * 1000);
  setInterval(() => fetch(`/api/briefing?tz=${encodeURIComponent(tz)}`).then((r) => r.json()).then((b) => renderTicker(b.headlines)).catch(() => {}), 60 * 60 * 1000);
})();

// ---------- interface style ----------
(() => {
  const apply = (style) => { avatar?.setStyle(style); document.body.classList.toggle('avatar-reactor', style !== 'head'); document.getElementById('setAvatar').value = style === 'head' ? 'head' : 'reactor'; };
  fetch('/api/preferences').then((r) => r.json()).then((p) => apply(p.avatarStyle)).catch(() => {});
  document.getElementById('setAvatar').addEventListener('change', (e) => { apply(e.target.value); savePreferences({ avatarStyle: e.target.value }); });
})();

// ---------- built-in browser ----------
// A sandboxed <webview> (desktop app only) that you or J.A.R.V.I.S. can drive. While a video or other
// media plays in it, J.A.R.V.I.S. only answers speech that starts with its name, so it doesn't reply to the video.
(() => {
  const $ = (id) => document.getElementById(id);
  const panel = $('browserPanel'), wv = $('webView'), addr = $('webAddress');
  const desktop = typeof wv.loadURL === 'function' || navigator.userAgent.includes('Electron');
  if (!desktop) $('webUnavailable').hidden = false;
  const SITES = [['YouTube', 'https://www.youtube.com'], ['X', 'https://x.com'], ['Instagram', 'https://www.instagram.com'], ['Reddit', 'https://www.reddit.com'], ['TikTok', 'https://www.tiktok.com'], ['Facebook', 'https://www.facebook.com'], ['LinkedIn', 'https://www.linkedin.com'], ['News', 'https://news.google.com'], ['Google', 'https://www.google.com']];
  for (const [label, url] of SITES) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', () => go(url)); $('webSites').append(b); }
  const toUrl = (t) => { t = t.trim(); if (/^https?:\/\//i.test(t)) return t; if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t)) return 'https://' + t; return 'https://www.google.com/search?q=' + encodeURIComponent(t); };
  const isOpen = () => !panel.classList.contains('closed');
  let media = false;
  const setMedia = (on) => { media = on && isOpen(); live.setMediaPlaying?.(media); };
  function show() { if (window.jarvisDocked?.().active) window.jarvisAppPanel?.home(); panel.classList.remove('closed'); document.body.classList.add('browsing'); if (desktop && (!wv.getURL || wv.getURL() === 'about:blank')) go('https://www.google.com'); }
  function hide() {
    panel.classList.add('closed'); document.body.classList.remove('browsing', 'browsing-wide');
    try { wv.executeJavaScript('document.querySelectorAll("video, audio").forEach((m) => m.pause())'); } catch {}
    setMedia(false);
  }
  function go(target) { if (!target) return; show(); if (desktop) try { wv.loadURL(toUrl(target)).catch(() => {}); } catch {} }
  window.jarvisBrowser = { show, hide, toggle: () => (isOpen() ? hide() : show()), wide: () => { show(); document.body.classList.add('browsing-wide'); } };
  $('webForm').addEventListener('submit', (e) => { e.preventDefault(); go(addr.value); addr.blur(); });
  $('webBack').addEventListener('click', () => { try { if (wv.canGoBack()) wv.goBack(); } catch {} });
  $('webFwd').addEventListener('click', () => { try { if (wv.canGoForward()) wv.goForward(); } catch {} });
  $('webReload').addEventListener('click', () => { try { wv.reload(); } catch {} });
  $('webWide').addEventListener('click', () => document.body.classList.toggle('browsing-wide'));
  $('webClose').addEventListener('click', hide);
  const syncUrl = (e) => { if (document.activeElement !== addr && e.url && e.url !== 'about:blank') addr.value = e.url; };
  wv.addEventListener('did-navigate', syncUrl); wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) syncUrl(e); });
  wv.addEventListener('media-started-playing', () => setMedia(true));
  wv.addEventListener('media-paused', () => setMedia(false));
  wv.addEventListener('did-start-navigation', (e) => { if (e.isMainFrame && !e.isInPlace) setMedia(false); });
  document.addEventListener('keydown', (e) => { if (isOpen() && e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); addr.focus(); addr.select(); } });
})();

// ---------- J.A.R.V.I.S. Start menu, task view and running apps in the dock ----------
(() => {
  const $ = (id) => document.getElementById(id);
  const overlay = $('launcher'), search = $('appSearch'), grid = $('appGrid'), tasks = $('taskGrid'), dock = $('dock');
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).then((r) => { if (r.error) showToast(r.error); return r; }).catch(() => showToast('That did not work.'));
  let apps = [], timer = null;
  const hue = (name) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const initials = (name) => name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '•';

  function renderApps() {
    const q = search.value.trim().toLowerCase();
    const list = q ? apps.filter((a) => a.name.toLowerCase().includes(q)).sort((a, b) => a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q)) : apps;
    $('appCount').textContent = apps.length ? `${list.length} of ${apps.length}` : 'loading…';
    grid.replaceChildren(...list.map((a, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'app-tile' + (q && i === 0 ? ' first' : ''); b.title = a.name;
      const icon = document.createElement('i'); icon.textContent = initials(a.name); const h = hue(a.name); icon.style.background = `linear-gradient(140deg, hsl(${h} 70% 38%), hsl(${(h + 40) % 360} 75% 22%))`;
      const label = document.createElement('span'); label.textContent = a.name;
      b.append(icon, label); b.addEventListener('click', () => open(a)); return b;
    }));
  }
  async function open(a) { hide(); showToast(`Opening ${a.name}…`); const r = await post('/api/launch', { app: a.id }); if (r?.note) showToast(r.note); }

  async function loadTasks(thumbs) {
    try { const r = await fetch('/api/tasks' + (thumbs ? '?thumbs=1' : '')).then((x) => x.json()); return r.windows || []; } catch { return []; }
  }
  async function renderTasks() {
    const wins = await loadTasks(true);
    $('taskCount').textContent = wins.length ? String(wins.length) : '';
    if (!wins.length) { const e = document.createElement('div'); e.className = 'task-empty'; e.textContent = 'No other windows are open.'; tasks.replaceChildren(e); return; }
    tasks.replaceChildren(...wins.map((w) => {
      const t = document.createElement('div'); t.className = 'task'; t.tabIndex = 0; t.title = w.name; t.setAttribute('role', 'button');
      const shot = document.createElement('img'); shot.className = 'shot'; shot.alt = ''; if (w.thumb) shot.src = w.thumb;
      const label = document.createElement('div'); label.className = 'label';
      if (w.icon) { const ic = document.createElement('img'); ic.src = w.icon; ic.alt = ''; label.append(ic); }
      const name = document.createElement('span'); name.textContent = w.name; label.append(name);
      const x = document.createElement('button'); x.type = 'button'; x.className = 'x'; x.textContent = '✕'; x.title = 'Close window'; x.setAttribute('aria-label', `Close ${w.name}`);
      x.addEventListener('click', async (e) => { e.stopPropagation(); await post('/api/tasks', { handle: w.handle, action: 'close' }); setTimeout(renderTasks, 700); });
      const focus = () => { hide(); post('/api/tasks', { handle: w.handle, action: 'focus' }); };
      t.addEventListener('click', focus); t.addEventListener('keydown', (e) => { if (e.key === 'Enter') focus(); });
      const d = document.createElement('button'); d.type = 'button'; d.className = 'dockit'; d.textContent = '⧉'; d.title = 'Open inside J.A.R.V.I.S.'; d.setAttribute('aria-label', `Dock ${w.name} into J.A.R.V.I.S.`);
      d.addEventListener('click', (e) => { e.stopPropagation(); hide(); post('/api/appdock', { action: 'attach', handle: w.handle }); });
      t.append(shot, label, d, x); return t;
    }));
  }

  function show() {
    overlay.hidden = false; search.value = ''; renderApps(); renderTasks(); setTimeout(() => search.focus(), 30);
    if (!apps.length) fetch('/api/apps').then((r) => r.json()).then((r) => { apps = r.apps || []; renderApps(); }).catch(() => {});
    clearInterval(timer); timer = setInterval(() => { if (!overlay.hidden) renderTasks(); }, 4000);
  }
  function hide() { overlay.hidden = true; clearInterval(timer); }
  window.jarvisLauncher = { show, hide, toggle: () => (overlay.hidden ? show() : hide()) };

  search.addEventListener('input', renderApps);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') grid.querySelector('.app-tile')?.click(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) hide(); });
  $('launcherClose').addEventListener('click', hide);
  $('toWindows').addEventListener('click', () => { hide(); post('/api/window', { action: 'desktop' }); });
  $('winStart').addEventListener('click', () => { hide(); post('/api/launch', { target: 'start' }); });
  fetch('/api/apps').then((r) => r.json()).then((r) => { apps = r.apps || []; }).catch(() => {});

  // Running apps sit at the end of the dock like a taskbar.
  let lastSig = null;
  async function refreshRunning() {
    const docked = new Set((window.jarvisDocked?.().apps || []).map((a) => a.handle));
    const wins = (await loadTasks(false)).filter((w) => !docked.has(w.handle)).slice(0, 8), sig = wins.map((w) => w.handle + w.name).join('|');
    if (sig === lastSig) return; lastSig = sig;
    const group = document.getElementById('dockRunning'); group.replaceChildren();
    if (!wins.length) return;
    const sep = document.createElement('span'); sep.className = 'sep running-sep'; group.append(sep);
    for (const w of wins) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'running'; b.dataset.label = w.name.length > 28 ? w.name.slice(0, 27) + '…' : w.name;
      b.setAttribute('aria-label', `Switch to ${w.name}`);
      if (w.icon) { const img = document.createElement('img'); img.src = w.icon; img.alt = ''; b.append(img); } else b.textContent = initials(w.name);
      b.addEventListener('click', () => post('/api/appdock', { action: 'attach', handle: w.handle })); b.title = 'Dock into J.A.R.V.I.S.'; group.append(b);
    }
    syncScroll(); // the dock scrolls, so every running app stays reachable
  }

  // The dock scrolls sideways like the taskbar: mouse wheel, arrow buttons at either end
  // (only while there is more to see), and faded edges hinting at hidden buttons.
  const arrow = (dir) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = `dock-arrow ${dir}`; b.hidden = true;
    b.textContent = dir === 'left' ? '‹' : '›'; b.setAttribute('aria-label', dir === 'left' ? 'Scroll apps left' : 'Scroll apps right');
    b.addEventListener('click', () => dock.scrollBy({ left: (dir === 'left' ? -1 : 1) * dock.clientWidth * 0.7, behavior: 'smooth' }));
    return b;
  };
  const left = arrow('left'), right = arrow('right');
  dock.before(left); dock.after(right);
  function syncScroll() {
    const max = dock.scrollWidth - dock.clientWidth;
    const scrollable = max > 2;
    left.hidden = right.hidden = !scrollable;
    left.disabled = dock.scrollLeft <= 2; right.disabled = dock.scrollLeft >= max - 2;
    dock.classList.toggle('fade-l', scrollable && !left.disabled);
    dock.classList.toggle('fade-r', scrollable && !right.disabled);
  }
  dock.addEventListener('wheel', (e) => {
    if (dock.scrollWidth <= dock.clientWidth) return;
    e.preventDefault();
    dock.scrollBy({ left: Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX });
  }, { passive: false });
  dock.addEventListener('scroll', syncScroll, { passive: true });
  dock.addEventListener('focusin', (e) => e.target.scrollIntoView?.({ inline: 'nearest', block: 'nearest' }));
  new ResizeObserver(syncScroll).observe(dock);
  new MutationObserver(syncScroll).observe(dock, { childList: true, subtree: true });
  syncScroll();
  if (navigator.userAgent.includes('Electron')) { setTimeout(refreshRunning, 1500); setInterval(() => { if (!document.hidden) refreshRunning(); }, 5000); }
})();

// ---------- docked apps: tabs over a full-screen app area ----------
// Each docked app's real window is kept over #appFrame while its tab is active. The window is hidden
// whenever HTML must show on top (Start menu, settings, approval banner) and while the HUD tab is open.
(() => {
  const $ = (id) => document.getElementById(id);
  const panel = $('appPanel'), frame = $('appFrame'), tabs = $('appTabs'), dock = $('dock');
  const send = (body) => fetch('/api/appdock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).then((r) => { if (r.error) showToast(r.error); return r; }).catch(() => ({}));
  let state = { apps: [], active: null }, opening = null, openingTimer = null;
  window.jarvisDocked = () => state;

  let raf = 0;
  const report = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (panel.hidden) return; const r = frame.getBoundingClientRect(); if (r.width > 20 && r.height > 20) send({ action: 'rect', rect: { x: r.left + 1, y: r.top + 1, width: r.width - 2, height: r.height - 2 } }); }); };
  new ResizeObserver(report).observe(frame); window.addEventListener('resize', report);

  const tab = (label, { cls = '', title = label, onClick, actions = [] } = {}) => {
    const t = document.createElement('div'); t.className = 'tab ' + cls; t.title = title; t.setAttribute('role', 'tab'); t.tabIndex = 0;
    const s = document.createElement('span'); s.textContent = label; t.append(s);
    for (const [glyph, tip, fn, c] of actions) { const i = document.createElement('i'); i.textContent = glyph; i.title = tip; i.className = c || ''; i.setAttribute('role', 'button'); i.setAttribute('aria-label', tip); i.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); t.append(i); }
    if (onClick) { t.addEventListener('click', onClick); t.addEventListener('keydown', (e) => { if (e.key === 'Enter') onClick(); }); }
    return t;
  };
  function render() {
    const showing = Boolean(state.active) || Boolean(opening);
    panel.hidden = !showing;
    document.body.classList.toggle('docking', showing);
    if (showing) window.jarvisBrowser?.hide?.();
    tabs.replaceChildren(
      tab('◉ J.A.R.V.I.S.', { cls: 'home', title: 'Back to the J.A.R.V.I.S. home screen', onClick: () => send({ action: 'activate', handle: null }) }),
      ...state.apps.map((a) => tab(a.name, { cls: a.handle === state.active ? 'active' : '', onClick: () => send({ action: 'activate', handle: a.handle }),
        actions: [['↗', `Pop ${a.name} out into its own window`, () => send({ action: 'release', handle: a.handle })], ['✕', `Close ${a.name}`, () => send({ action: 'close', handle: a.handle }), 'x']] })),
      ...(opening ? [tab(`Opening ${opening}…`, { cls: 'loading active' })] : [])
    );
    $('appFrameNote').textContent = opening && !state.active ? `Starting ${opening}…` : 'The app appears here.';
    // Docked apps also sit in the top bar, so they're one click away from the HUD.
    const group = document.getElementById('dockDocked'); group.replaceChildren();
    if (state.apps.length) {
      const sep = document.createElement('span'); sep.className = 'sep docked-sep'; group.append(sep);
      for (const a of state.apps) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'docked' + (a.handle === state.active ? ' on' : ''); b.dataset.label = a.name;
        b.textContent = a.name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '•';
        b.setAttribute('aria-label', `Show ${a.name}`); b.addEventListener('click', () => send({ action: 'activate', handle: a.handle })); group.append(b);
      }
    }
    if (showing) report();
  }
  window.jarvisAppPanel = {
    state: (ev) => { state = { apps: ev.apps || [], active: ev.active || null }; if (state.active || !opening) { opening = null; clearTimeout(openingTimer); } render(); },
    opening: (ev) => { opening = ev.name || 'app'; clearTimeout(openingTimer); openingTimer = setTimeout(() => { opening = null; render(); }, 20000); render(); },
    home: () => send({ action: 'activate', handle: null })
  };

  // Hide the native window while HTML overlays need the space.
  const covers = { launcher: () => !$('launcher').hidden, settings: () => !document.querySelector('.drawer-backdrop')?.hidden, confirm: () => !$('confirmBanner')?.hidden };
  const last = {};
  const check = () => { for (const [k, f] of Object.entries(covers)) { const v = Boolean(f()); if (v !== last[k]) { last[k] = v; send({ action: 'hidden', reason: k, hidden: v }); if (!v && !panel.hidden) report(); } } };
  const mo = new MutationObserver(check);
  [$('launcher'), document.querySelector('.drawer-backdrop'), $('confirmBanner')].filter(Boolean).forEach((el) => mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }));

  fetch('/api/appdock').then((r) => r.json()).then((r) => window.jarvisAppPanel.state(r)).catch(() => {});

  // Settings toggles.
  const toggle = (id, key) => { const box = $(id); fetch('/api/preferences').then((r) => r.json()).then((p) => { box.checked = p[key] !== false; }).catch(() => {}); box.addEventListener('change', () => savePreferences({ [key]: box.checked })); };
  toggle('setAppsInside', 'appsInside'); toggle('setLaunchApps', 'launchAppsOnStart'); toggle('setDictation', 'dictation'); toggle('setAutoDock', 'autoDock'); toggle('setHideTaskbar', 'hideTaskbar');
})();
