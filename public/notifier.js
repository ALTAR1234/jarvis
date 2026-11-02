// Notifier: every app's alerts in one list, newest first, with Do Not Disturb.
(() => {
  const { $, $$, esc, get, post, ago } = kit;
  const ICON = { Socialer: 'S', Listener: '♪', Helper: '✎', Reminder: '⏰', Keeper: '⛁', Snapper: '◱' };
  async function load() {
    const d = await get('/api/notifier');
    $('#dnd').classList.toggle('on', d.dnd);
    const unread = d.items.filter((n) => !n.read).length;
    $('#sub').textContent = unread ? `${unread} unread` : 'All caught up';
    $('#list').innerHTML = d.items.length ? d.items.map((n) => `<div class="card n${n.read ? '' : ' unread'}" data-id="${n.id}"><span class="ic">${ICON[n.app] || '•'}</span><b>${esc(n.app)} · ${esc(n.title)}</b><small>${ago(n.at)}</small>${n.body ? `<p>${esc(n.body)}</p>` : ''}</div>`).join('') : '<div class="empty">No notifications. Nice and quiet.</div>';
    $$('.n.unread').forEach((el) => (el.onclick = async () => { await post('/api/notifier/read', { id: el.dataset.id }); load(); }));
  }
  $('#readall').onclick = async () => { await post('/api/notifier/read', { id: 'all' }); load(); };
  $('#clear').onclick = async () => { await post('/api/notifier/clear'); load(); };
  $('#dnd').onclick = async () => { await post('/api/preferences', { dnd: !$('#dnd').classList.contains('on') }); load(); };
  // new notifications arrive live over the HUD's event stream
  new EventSource('/api/events').onmessage = (e) => { try { if (JSON.parse(e.data).type === 'notification') load(); } catch {} };
  load();
})();
