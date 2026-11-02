// Planner: a month calendar of your events, Helper's homework (due dates and the steps planned for each
// day) and reminders. Add events by just typing them.
(() => {
  const { $, $$, esc, get, post, toast, busy } = kit;
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let view = new Date(), selected = ymd(new Date()), data = { events: [], homework: [], reminders: [] };
  view.setDate(1);

  // everything on one day: events, homework due, homework steps planned, reminders
  function itemsOn(day) {
    const out = [];
    for (const e of data.events) if (e.date === day) out.push({ kind: 'ev', time: e.time, title: e.title, id: e.id, notes: e.notes });
    for (const h of data.homework) {
      if (ymd(new Date(h.due)) === day) out.push({ kind: 'hw', time: '', title: `Due: ${h.title}` });
      const start = new Date(h.created); start.setHours(0, 0, 0, 0);
      for (const s of h.steps) {
        const d = new Date(start); d.setDate(d.getDate() + s.day);
        if (ymd(d) === day && !s.done) out.push({ kind: 'step', time: '', title: `${h.title}: ${s.text}` });
      }
    }
    for (const r of data.reminders) if (ymd(new Date(r.due)) === day && !r.text.startsWith('Helper:') && !data.events.some((e) => e.reminderId === r.id)) out.push({ kind: 'rem', time: new Date(r.due).toTimeString().slice(0, 5), title: `⏰ ${r.text}` });
    return out.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  }
  function render() {
    $('#month').textContent = view.toLocaleDateString([], { month: 'long', year: 'numeric' });
    const first = new Date(view), start = new Date(first);
    start.setDate(1 - first.getDay());
    const today = ymd(new Date());
    let html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="dow">${d}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const key = ymd(d), items = itemsOn(key);
      html += `<button class="day${d.getMonth() !== view.getMonth() ? ' out' : ''}${key === today ? ' today' : ''}${key === selected ? ' sel' : ''}" data-d="${key}"><span class="n">${d.getDate()}</span>${items.slice(0, 3).map((it) => `<span class="chip ${it.kind}">${it.time ? it.time + ' ' : ''}${esc(it.title)}</span>`).join('')}${items.length > 3 ? `<span class="chip">+${items.length - 3} more</span>` : ''}</button>`;
    }
    $('#cal').innerHTML = html;
    $$('.day').forEach((b) => (b.onclick = () => { selected = b.dataset.d; render(); }));
    const items = itemsOn(selected);
    const label = new Date(selected + 'T12:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    $('#dayview').innerHTML = `<h3>${label}</h3>${items.length ? items.map((it) => `<div class="item"><span class="t">${it.time || (it.kind === 'hw' ? 'Due' : it.kind === 'step' ? 'Study' : 'All day')}</span><div>${esc(it.title)}${it.notes ? `<small>${esc(it.notes)}</small>` : ''}</div>${it.id ? `<button class="btn small danger" data-del="${it.id}">✕</button>` : ''}</div>`).join('') : '<p style="color:var(--faint)">Nothing planned.</p>'}`;
    $$('[data-del]').forEach((b) => (b.onclick = async () => { await post('/api/planner/delete', { id: b.dataset.del }); load(); }));
  }
  async function load() { data = await get('/api/planner'); render(); }
  $('#prev').onclick = () => { view.setMonth(view.getMonth() - 1); render(); };
  $('#next').onclick = () => { view.setMonth(view.getMonth() + 1); render(); };
  $('#today').onclick = () => { view = new Date(); view.setDate(1); selected = ymd(new Date()); render(); };
  $('#add').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('#text').value.trim();
    if (!text) return;
    busy(true);
    try {
      const ev = await post('/api/planner/add', { text });
      $('#text').value = '';
      toast(`Added “${ev.title}” on ${new Date(ev.date + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}${ev.time ? ' at ' + ev.time : ''}`);
      selected = ev.date;
      view = new Date(ev.date + 'T12:00'); view.setDate(1);
      await load();
    } catch (err) { toast(err.message); }
    busy(false);
  };
  load().catch((e) => toast(e.message));
})();
