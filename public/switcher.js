// Switcher: every open window with a live preview, plus J.A.R.V.I.S.'s own apps. Type to filter.
(() => {
  const { $, $$, esc, get, post, toast } = kit;
  let wins = [], sel = 0;
  const close = () => (document.title = 'close');
  const APPS = [['dreamer', 'Dreamer'], ['inboxer', 'Inboxer'], ['helper', 'Helper'], ['planner', 'Planner'], ['noter', 'Noter'], ['filer', 'Filer'], ['controller', 'Controller'], ['notifier', 'Notifier'], ['watcher', 'Watcher'], ['claude', 'Claude'], ['chatgpt', 'ChatGPT']];
  function render() {
    const q = $('#q').value.toLowerCase();
    const list = wins.filter((w) => w.name.toLowerCase().includes(q));
    sel = Math.min(sel, Math.max(0, list.length - 1));
    $('#apps').innerHTML = APPS.filter(([, l]) => l.toLowerCase().includes(q)).map(([id, l]) => `<button data-app="${id}">${l}</button>`).join('');
    $$('[data-app]').forEach((b) => (b.onclick = async () => { await post('/api/launch', { target: b.dataset.app }); close(); }));
    $('#grid').innerHTML = list.length ? list.map((w, i) => `<button class="win${i === sel ? ' sel' : ''}" data-h="${w.handle}"><div class="thumb" style="background-image:url('${w.thumb || ''}')"></div><div class="name">${w.icon ? `<img src="${w.icon}" alt="">` : ''}${esc(w.name)}</div><span class="x" data-close="${w.handle}" title="Close window">✕</span></button>`).join('') : '<div class="empty">No other windows are open.</div>';
    $$('.win').forEach((b) => (b.onclick = (e) => (e.target.dataset.close ? closeWin(e.target.dataset.close) : focus(b.dataset.h))));
    return list;
  }
  async function focus(handle) {
    try { await post('/api/tasks', { handle, action: 'focus' }); close(); } catch (e) { toast(e.message); }
  }
  async function closeWin(handle) {
    try { await post('/api/tasks', { handle, action: 'close' }); wins = wins.filter((w) => w.handle !== handle); render(); } catch (e) { toast(e.message); }
  }
  addEventListener('keydown', (e) => {
    const list = wins.filter((w) => w.name.toLowerCase().includes($('#q').value.toLowerCase()));
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter' && list[sel]) focus(list[sel].handle);
    else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); sel = (sel + 1) % Math.max(1, list.length); render(); }
    else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); sel = (sel - 1 + list.length) % Math.max(1, list.length); render(); }
  });
  $('#q').oninput = () => { sel = 0; render(); };
  get('/api/tasks?thumbs=1').then((r) => { wins = r.windows || []; render(); }).catch((e) => ($('#grid').innerHTML = `<div class="empty">${esc(e.message)}</div>`));
  render();
  $('#q').focus();
})();
