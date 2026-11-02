// Dreamer: an isometric room drawn in SVG. Every app is a thing in the room; click it to open the app.
// The window shows the real sky for the time of day and the current weather, the lamp comes on at
// night, the record spins while Listener plays, and little badges show what's waiting.
(() => {
  const $ = (s) => document.querySelector(s);
  const svg = $('#room');
  const S = 40, C = 0.866;
  const iso = (x, y, z = 0) => [(x - y) * S * C, (x + y) * S * 0.5 - z * S];
  const pts = (list) => list.map((p) => iso(...p).map((v) => v.toFixed(1)).join(',')).join(' ');
  let light = 1, hour = new Date().getHours(), weather = null, status = {};

  // ---------- colour ----------
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const shade = (h, f) => { const [r, g, b] = hex(h); const k = f * light; return `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`; };
  const poly = (list, fill, extra = '') => `<polygon points="${pts(list)}" fill="${fill}" ${extra}/>`;
  // a box: top, +x side and +y side (the three faces you can see)
  function box(x, y, z, w, d, h, color, extra = '') {
    return `<g ${extra}>${poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], shade(color, 0.78))}${poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], shade(color, 0.62))}${poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], shade(color, 1))}</g>`;
  }
  const ellipse = (x, y, z, rx, color, extra = '') => { const [cx, cy] = iso(x, y, z); return `<ellipse cx="${cx}" cy="${cy}" rx="${rx * S * C * 1.15}" ry="${rx * S * 0.66}" fill="${color}" ${extra}/>`; };
  const at = (x, y, z) => iso(x, y, z).map((v) => v.toFixed(1)).join(',');

  // ---------- time of day ----------
  function skyFor(h) {
    if (h >= 6 && h < 9) return { top: '#f6a96b', bottom: '#ffd9a0', light: 0.92, bg: '#3a2a3f' };
    if (h >= 9 && h < 17) return { top: '#5aa9f0', bottom: '#bfe3ff', light: 1, bg: '#1d3557' };
    if (h >= 17 && h < 20) return { top: '#ff7e5f', bottom: '#feb47b', light: 0.85, bg: '#3b2340' };
    return { top: '#0a1230', bottom: '#1f2d5c', light: 0.55, bg: '#070b18' };
  }

  // ---------- the room ----------
  function draw() {
    const sky = skyFor(hour);
    light = sky.light;
    document.body.style.setProperty('--sky', sky.bg);
    const night = sky.light < 0.6;
    const cond = String(weather?.condition || '').toLowerCase();
    const rainy = /rain|drizzle|shower|thunder|storm/.test(cond), snowy = /snow|sleet/.test(cond), cloudy = rainy || snowy || /cloud|overcast|fog|mist/.test(cond);
    const playing = !!status.listener?.playing;
    let s = '';
    s += `<defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky.top}"/><stop offset="1" stop-color="${sky.bottom}"/></linearGradient>
      <radialGradient id="lamp"><stop offset="0" stop-color="#ffd58a" stop-opacity=".55"/><stop offset="1" stop-color="#ffd58a" stop-opacity="0"/></radialGradient>
      <radialGradient id="holo"><stop offset="0" stop-color="#bff3ff"/><stop offset=".35" stop-color="#38cfff"/><stop offset="1" stop-color="#0a4f86" stop-opacity="0"/></radialGradient>
      <linearGradient id="screen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7b5cff"/><stop offset=".5" stop-color="#38cfff"/><stop offset="1" stop-color="#ff5fa8"/></linearGradient>
      <clipPath id="win"><polygon points="${pts([[0, 3, 2.6], [0, 6, 2.6], [0, 6, 5.4], [0, 3, 5.4]])}"/></clipPath>
    </defs>`;
    // floor and walls
    s += poly([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], shade('#8a6b52', 1));
    for (let i = 1; i < 10; i++) s += `<line x1="${iso(i, 0)[0]}" y1="${iso(i, 0)[1]}" x2="${iso(i, 10)[0]}" y2="${iso(i, 10)[1]}" stroke="${shade('#6e5440', 1)}" stroke-width="1.2"/>`;
    s += poly([[0, 0, 0], [0, 10, 0], [0, 10, 7], [0, 0, 7]], shade('#c9b8e8', 0.82));
    s += poly([[0, 0, 0], [10, 0, 0], [10, 0, 7], [0, 0, 7]], shade('#d8cbef', 0.95));
    s += poly([[0, 0, 0], [0, 10, 0], [0, 10, 0.35], [0, 0, 0.35]], shade('#ffffff', 0.7)) + poly([[0, 0, 0], [10, 0, 0], [10, 0, 0.35], [0, 0, 0.35]], shade('#ffffff', 0.8));
    // the window: real sky, sun or moon, clouds, rain or snow
    s += `<g clip-path="url(#win)">${poly([[0, 3, 2.6], [0, 6, 2.6], [0, 6, 5.4], [0, 3, 5.4]], 'url(#sky)')}`;
    if (night) for (let i = 0; i < 14; i++) { const [sx, sy] = iso(0, 3.1 + ((i * 37) % 29) / 10, 3 + ((i * 53) % 24) / 10); s += `<circle cx="${sx}" cy="${sy}" r="${i % 3 ? 1.2 : 1.8}" fill="#fff" class="${i % 4 ? '' : 'pulse'}"/>`; }
    const [ox, oy] = iso(0, 5, 4.7);
    if (!cloudy || !night) s += night ? `<circle cx="${ox}" cy="${oy}" r="13" fill="#f4f1d6"/><circle cx="${ox + 6}" cy="${oy - 4}" r="12" fill="${sky.top}"/>` : !cloudy ? `<circle cx="${ox}" cy="${oy}" r="15" fill="#fff4b0"/><circle cx="${ox}" cy="${oy}" r="24" fill="#fff4b0" opacity=".25"/>` : '';
    if (cloudy) for (const [cy, cz, sc] of [[3.8, 4.6, 1], [5.2, 4, 0.8], [4.4, 3.4, 0.9]]) { const [cx, ccy] = iso(0, cy, cz); s += `<g opacity="${night ? 0.5 : 0.9}" fill="${rainy ? '#9aa6b8' : '#ffffff'}"><ellipse cx="${cx}" cy="${ccy}" rx="${26 * sc}" ry="${11 * sc}"/><ellipse cx="${cx - 12 * sc}" cy="${ccy - 6 * sc}" rx="${14 * sc}" ry="${10 * sc}"/></g>`; }
    if (rainy || snowy) { s += '<g class="rain">'; for (let i = 0; i < 18; i++) { const [rx, ry] = iso(0, 3.2 + (i % 6) * 0.5, 3 + Math.floor(i / 6) * 0.8); s += snowy ? `<circle cx="${rx}" cy="${ry}" r="2" fill="#fff" style="animation:rain ${1.6 + (i % 3) * 0.3}s linear infinite;animation-delay:-${i * 0.2}s"/>` : `<line x1="${rx}" y1="${ry}" x2="${rx - 3}" y2="${ry + 9}" stroke="#cfe6ff" stroke-width="1.4" style="animation-delay:-${(i * 0.13).toFixed(2)}s"/>`; } s += '</g>'; }
    s += `</g>${poly([[0, 3, 2.6], [0, 6, 2.6], [0, 6, 2.75], [0, 3, 2.75]], shade('#ffffff', 0.85))}`;
    s += `<polyline points="${pts([[0, 3, 2.6], [0, 3, 5.4], [0, 6, 5.4], [0, 6, 2.6]])}" fill="none" stroke="${shade('#ffffff', 0.9)}" stroke-width="5"/>`;
    s += `<line x1="${iso(0, 4.5, 2.6)[0]}" y1="${iso(0, 4.5, 2.6)[1]}" x2="${iso(0, 4.5, 5.4)[0]}" y2="${iso(0, 4.5, 5.4)[1]}" stroke="${shade('#ffffff', 0.9)}" stroke-width="3"/>`;
    // floor lamp in the corner, lit at night
    if (night) { const [lx, ly] = iso(0.9, 0.9, 2.4); s += `<circle cx="${lx}" cy="${ly + 60}" r="180" fill="url(#lamp)"/>`; }
    s += box(0.75, 0.75, 0, 0.3, 0.3, 0.12, '#444a5a') + box(0.86, 0.86, 0.12, 0.08, 0.08, 2.2, '#444a5a');
    s += poly([[0.5, 0.5, 2.3], [1.3, 0.5, 2.3], [1.15, 0.65, 2.9], [0.65, 0.65, 2.9]], night ? '#ffe2a6' : shade('#f2e6d0', 1)) + poly([[0.5, 1.3, 2.3], [1.3, 1.3, 2.3], [1.15, 1.15, 2.9], [0.65, 1.15, 2.9]], night ? '#ffd58a' : shade('#e6d6bc', 1));
    // Inboxer: a letter tray on the wall
    s += obj('inboxer', box(3.5, 0.02, 3.0, 1.1, 0.4, 0.75, '#38cfff') + `<polygon points="${pts([[3.65, 0.42, 3.55], [4.45, 0.42, 3.55], [4.05, 0.42, 3.2]])}" fill="none" stroke="#fff" stroke-width="2"/>`);
    // Listener: a record player on a side table
    s += obj('listener', box(1.6, 0.3, 0, 1.4, 1.0, 1.4, '#7a5a8c') + box(1.72, 0.38, 1.4, 1.16, 0.84, 0.18, '#2b2d3a') +
      `<g ${playing ? 'class="spin"' : ''}>${ellipse(2.3, 0.8, 1.6, 0.38, '#111')}${ellipse(2.3, 0.8, 1.6, 0.12, '#ff5fa8')}</g>` +
      (playing ? [0, 1, 2].map((i) => `<text x="${iso(2.3, 0.8, 2.2)[0] + i * 10}" y="${iso(2.3, 0.8, 2.2)[1]}" class="note" style="animation-delay:${i * 0.8}s" fill="#ff9ad0" font-size="22">♪</text>`).join('') : ''));
    // rug
    s += poly([[3.8, 2.6, 0.01], [8.8, 2.6, 0.01], [8.8, 7.4, 0.01], [3.8, 7.4, 0.01]], shade('#5b6cff', 0.85));
    s += poly([[4.2, 3.0, 0.02], [8.4, 3.0, 0.02], [8.4, 7.0, 0.02], [4.2, 7.0, 0.02]], 'none', `stroke="${shade('#a9bcff', 1)}" stroke-width="3"`);
    // Streamer: the TV, Gamer: the console on its stand
    s += box(5.4, 0.3, 0, 3.2, 1.0, 1.1, '#3a3f52');
    s += obj('streamer', box(5.6, 0.12, 1.45, 2.8, 0.22, 2.15, '#15171f') + `<polygon points="${pts([[5.72, 0.35, 1.58], [8.28, 0.35, 1.58], [8.28, 0.35, 3.48], [5.72, 0.35, 3.48]])}" fill="url(#screen)" class="tvglow"/>`);
    s += obj('gamer', box(6.3, 0.55, 1.1, 1.3, 0.55, 0.28, '#f2f4f8') + box(6.4, 0.6, 1.38, 0.3, 0.05, 0.02, '#38cfff'));
    s += box(6.2, 3.4, 0.02, 0.7, 0.45, 0.12, '#2b2d3a');
    // Beater: a synth on a stand
    s += box(9.05, 3.4, 0, 0.12, 0.12, 1.0, '#444a5a') + box(9.05, 6.3, 0, 0.12, 0.12, 1.0, '#444a5a');
    let keys = '';
    for (let k = 0; k < 14; k++) keys += poly([[9.0, 3.3 + k * 0.23, 1.26], [9.45, 3.3 + k * 0.23, 1.26], [9.45, 3.5 + k * 0.23, 1.26], [9.0, 3.5 + k * 0.23, 1.26]], k % 7 === 2 || k % 7 === 6 ? '#222' : '#f6f6f6');
    s += obj('beater', box(8.85, 3.2, 1.0, 0.85, 3.4, 0.25, '#7b5cff') + keys + box(9.5, 3.4, 1.25, 0.15, 0.6, 0.06, '#ff5fa8'));
    // the desk with Weber's laptop, Helper's notebook and Socialer's phone
    s += box(0.35, 6.3, 0, 0.12, 0.12, 1.5, '#5a4636') + box(1.7, 6.3, 0, 0.12, 0.12, 1.5, '#5a4636') + box(0.35, 9.4, 0, 0.12, 0.12, 1.5, '#5a4636') + box(1.7, 9.4, 0, 0.12, 0.12, 1.5, '#5a4636');
    s += box(0.3, 6.2, 1.5, 1.6, 3.4, 0.14, '#a07a58');
    s += obj('weber', poly([[0.62, 6.65, 1.72], [0.62, 7.85, 1.72], [0.62, 7.85, 2.62], [0.62, 6.65, 2.62]], '#2b2d3a') + poly([[0.64, 6.72, 1.8], [0.64, 7.78, 1.8], [0.64, 7.78, 2.55], [0.64, 6.72, 2.55]], night ? '#4f7dff' : '#7fb0ff') + box(0.62, 6.65, 1.64, 0.9, 1.2, 0.08, '#c3c8d6'));
    s += obj('helper', box(0.75, 8.2, 1.64, 0.75, 0.95, 0.1, '#38cfff') + box(0.75, 8.2, 1.74, 0.75, 0.95, 0.03, '#f8f8f8'), status.helperToday);
    s += obj('socialer', box(1.45, 9.05, 1.64, 0.3, 0.42, 0.06, '#1b1a24') + poly([[1.48, 9.08, 1.71], [1.72, 9.08, 1.71], [1.72, 9.44, 1.71], [1.48, 9.44, 1.71]], '#a9bcff'), status.socialerUnread);
    // a plant, for the vibe
    s += box(9.1, 0.5, 0, 0.6, 0.6, 0.7, '#c46a4a') + ellipse(9.4, 0.8, 1.35, 0.55, shade('#3f9e5f', 1)) + ellipse(9.35, 0.75, 1.75, 0.38, shade('#56c27a', 1));
    // Petter: a pet bed
    s += obj('petter', ellipse(3.2, 8.4, 0.02, 1.05, shade('#ff8fbf', 0.9)) + ellipse(3.2, 8.4, 0.12, 0.72, shade('#ffd1e6', 1)) +
      `<g transform="translate(${at(3.2, 8.4, 0.5)})"><ellipse cx="0" cy="0" rx="20" ry="16" fill="#8fb0ff"/><circle cx="-6" cy="-3" r="${night ? 0 : 3}" fill="#1b1a24"/><circle cx="6" cy="-3" r="${night ? 0 : 3}" fill="#1b1a24"/>${night ? '<path d="M-9 -3 q3 3 6 0 M3 -3 q3 3 6 0" stroke="#1b1a24" stroke-width="2" fill="none"/><text x="18" y="-14" fill="#cfe0ff" font-size="14" class="pulse">z</text>' : ''}</g>`);
    // Jarvis: a hologram in the front corner
    const [hx, hy] = iso(8.7, 8.7, 0.1);
    s += obj('jarvis', ellipse(8.7, 8.7, 0.05, 0.75, '#1a2a44') + ellipse(8.7, 8.7, 0.12, 0.5, '#38cfff', 'opacity=".5" class="pulse"') +
      `<polygon points="${hx - 30},${hy} ${hx + 30},${hy} ${hx + 10},${hy - 70} ${hx - 10},${hy - 70}" fill="#38cfff" opacity=".12"/>` +
      `<g class="float"><circle cx="${hx}" cy="${hy - 78}" r="34" fill="url(#holo)"/><ellipse cx="${hx}" cy="${hy - 78}" rx="44" ry="12" fill="none" stroke="#7fe0ff" stroke-width="1.5" opacity=".8"/><ellipse cx="${hx}" cy="${hy - 78}" rx="12" ry="44" fill="none" stroke="#7fe0ff" stroke-width="1" opacity=".5"/></g>`);
    svg.innerHTML = s;
    svg.querySelectorAll('.obj').forEach((g) => {
      g.onclick = () => open(g.dataset.id);
      g.onmouseenter = (e) => tip(g.dataset.id, e);
      g.onmousemove = (e) => tip(g.dataset.id, e);
      g.onmouseleave = () => ($('#tip').hidden = true);
    });
  }
  function obj(id, inner, badge) {
    let b = '';
    if (badge) {
      const anchor = { helper: [1.1, 8.7, 2.3], socialer: [1.6, 9.25, 2.2] }[id];
      if (anchor) { const [bx, by] = iso(...anchor); b = `<g><circle cx="${bx}" cy="${by}" r="12" fill="#ff5fa8"/><text x="${bx}" y="${by + 4.5}" text-anchor="middle" font-size="13" font-weight="800" fill="#fff">${badge > 9 ? '9+' : badge}</text></g>`; }
    }
    return `<g class="obj" data-id="${id}">${inner}${b}</g>`;
  }

  // ---------- hover labels and opening apps ----------
  const NAMES = {
    listener: ['Listener', () => (status.listener?.playing ? `♪ ${status.listener.title}` : 'Your music')],
    streamer: ['Streamer', () => 'Shows and movies'], gamer: ['Gamer', () => 'Your games'], weber: ['Weber', () => 'The web'],
    socialer: ['Socialer', () => (status.socialerUnread ? `${status.socialerUnread} unread` : 'Messages')], beater: ['Beater', () => 'Make a beat'],
    helper: ['Helper', () => (status.helperToday ? `${status.helperToday} step${status.helperToday > 1 ? 's' : ''} for today` : 'Homework')],
    inboxer: ['Inboxer', () => 'Everything waiting for you'], petter: ['Petter', () => 'Your desktop pet'], jarvis: ['J.A.R.V.I.S.', () => 'Back to the HUD'],
  };
  function tip(id, e) {
    const t = $('#tip'), [name, sub] = NAMES[id];
    t.innerHTML = `${name}<small>${sub()}</small>`;
    t.hidden = false;
    t.style.left = e.clientX + 16 + 'px';
    t.style.top = e.clientY + 14 + 'px';
  }
  let toastTimer;
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2400); };
  async function open(id) {
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json());
    const r = id === 'jarvis' || id === 'petter' ? await post(`/api/dreamer/${id}`) : await post('/api/launch', { target: id });
    if (r?.error) toast(r.error); else toast(`Opening ${NAMES[id][0]}…`);
  }

  // ---------- parallax: the room tilts a little toward the mouse ----------
  addEventListener('mousemove', (e) => {
    const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
    svg.style.transform = `rotateY(${x * 6}deg) rotateX(${-y * 4}deg)`;
  });

  // ---------- clock, weather, status ----------
  function tick() {
    const d = new Date();
    $('#clock').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    $('#date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    if (d.getHours() !== hour) { hour = d.getHours(); draw(); }
  }
  async function refresh() {
    const [w, st] = await Promise.all([fetch('/api/weather').then((r) => r.json()).catch(() => ({})), fetch('/api/dreamer/status').then((r) => r.json()).catch(() => ({}))]);
    weather = w.weather || null;
    status = st || {};
    $('#wx').innerHTML = weather ? `<b>${weather.temp}${weather.unit}</b>${weather.condition} · ${weather.place}` : '';
    draw();
  }
  tick();
  draw();
  refresh();
  setInterval(tick, 15000);
  setInterval(refresh, 30000);
})();
