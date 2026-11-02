// Locker: clock, a short briefing, and a PIN pad (or one button when no PIN is set).
(() => {
  const { $, esc, get, post } = kit;
  let pin = '', hasPin = false;
  const tick = () => {
    const d = new Date();
    $('#time').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    $('#date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  };
  tick();
  setInterval(tick, 10000);

  async function briefing(name) {
    const h = new Date().getHours();
    $('#hi').textContent = `${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}${name ? ', ' + name : ''}.`;
    const [w, n, plan] = await Promise.all([get('/api/weather').catch(() => ({})), get('/api/notifier').catch(() => ({ items: [] })), get('/api/planner').catch(() => ({ events: [], homework: [] }))]);
    const today = new Date().toISOString().slice(0, 10);
    const todayEvents = plan.events.filter((e) => e.date === today).sort((a, b) => a.time.localeCompare(b.time));
    const dueSoon = plan.homework.filter((x) => (new Date(x.due) - Date.now()) / 86400000 < 2 && x.steps.some((s) => !s.done));
    const unread = n.items.filter((x) => !x.read);
    const cards = [];
    if (w.weather) cards.push([`${w.weather.temp}${w.weather.unit} · ${esc(w.weather.condition)}`, `${esc(w.weather.place)} · high ${w.weather.high}° low ${w.weather.low}°`]);
    cards.push([todayEvents.length ? `${todayEvents.length} event${todayEvents.length > 1 ? 's' : ''} today` : 'Nothing on the calendar', todayEvents.slice(0, 2).map((e) => `${e.time || 'All day'} ${esc(e.title)}`).join(' · ') || 'Enjoy the free time']);
    cards.push([dueSoon.length ? `${dueSoon.length} assignment${dueSoon.length > 1 ? 's' : ''} due soon` : 'No homework due soon', dueSoon.slice(0, 2).map((x) => esc(x.title)).join(' · ') || 'You are on top of it']);
    cards.push([unread.length ? `${unread.length} new notification${unread.length > 1 ? 's' : ''}` : 'No new notifications', unread.slice(0, 2).map((x) => `${esc(x.app)}: ${esc(x.title)}`).join(' · ') || 'All quiet']);
    $('#brief').innerHTML = cards.map(([b, s]) => `<div class="card"><b>${b}</b><small>${s}</small></div>`).join('');
  }

  const dots = () => ($('#dots').innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join(''));
  async function unlock() {
    try {
      await post('/api/locker/unlock', { pin });
    } catch (e) {
      $('#err').textContent = e.message;
      $('.pad').classList.remove('shake'); void $('.pad').offsetWidth; $('.pad').classList.add('shake');
      pin = '';
      dots();
    }
  }
  function press(k) {
    $('#err').textContent = '';
    if (k === '⌫') pin = pin.slice(0, -1);
    else if (k === '✓') return unlock();
    else if (pin.length < 8) pin += k;
    dots();
    if (pin.length >= 4 && pin.length === (window.pinLength || 0)) unlock();
  }
  addEventListener('keydown', (e) => {
    if (!hasPin) { if (e.key === 'Enter' || e.key === ' ') unlock(); return; }
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('⌫');
    else if (e.key === 'Enter') press('✓');
  });

  get('/api/locker').then((s) => {
    hasPin = s.hasPin;
    briefing(s.userName);
    if (hasPin) {
      $('#pinbox').hidden = false;
      $('#keys').hidden = false;
      $('#keys').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((k) => `<button>${k}</button>`).join('');
      $('#keys').querySelectorAll('button').forEach((b) => (b.onclick = () => press(b.textContent)));
      dots();
    } else {
      $('#enter').hidden = false;
      $('#enter').onclick = unlock;
    }
  });
})();
