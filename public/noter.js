// Noter: notes with optional checklists; saves as you type.
(() => {
  const { $, $$, esc, get, post, toast, ago } = kit;
  let notes = [], cur = null, timer;
  async function load(selectId) {
    notes = (await get('/api/noter')).notes;
    cur = notes.find((n) => n.id === (selectId || cur?.id)) || notes[0] || null;
    renderList();
    renderEditor();
  }
  function renderList() {
    $('#list').innerHTML = notes.length ? notes.map((n) => `<button class="card n${n.id === cur?.id ? ' on' : ''}" data-id="${n.id}"><b>${n.pinned ? '★ ' : ''}${esc(n.title || 'Untitled')}</b><small>${n.todos.length ? `${n.todos.filter((t) => t.done).length}/${n.todos.length} done · ` : ''}${esc(n.body.slice(0, 60)) || ago(n.updated)}</small></button>`).join('') : '<div class="empty">No notes yet.</div>';
    $$('.list .n').forEach((b) => (b.onclick = async () => { await flush(); cur = notes.find((n) => n.id === b.dataset.id); renderList(); renderEditor(); }));
  }
  function renderEditor() {
    $('#editor').hidden = !cur;
    if (!cur) return;
    $('#title').value = cur.title;
    $('#body').value = cur.body;
    $('#pin').textContent = cur.pinned ? '★ Pinned' : '☆ Pin';
    $('#todos').innerHTML = cur.todos.map((t, i) => `<div class="todo${t.done ? ' done' : ''}" data-i="${i}"><input type="checkbox"${t.done ? ' checked' : ''}><input type="text" value="${esc(t.text)}"><button title="Remove">✕</button></div>`).join('');
    $$('.todo').forEach((el) => {
      const i = +el.dataset.i;
      el.querySelector('[type=checkbox]').onchange = (e) => { cur.todos[i].done = e.target.checked; el.classList.toggle('done', e.target.checked); changed(); };
      el.querySelector('[type=text]').oninput = (e) => { cur.todos[i].text = e.target.value; changed(); };
      el.querySelector('button').onclick = () => { cur.todos.splice(i, 1); renderEditor(); changed(); };
    });
  }
  function changed() { $('#saved').textContent = 'Saving…'; clearTimeout(timer); timer = setTimeout(flush, 600); }
  async function flush() {
    clearTimeout(timer);
    if (!cur) return;
    cur.title = $('#title').value;
    cur.body = $('#body').value;
    const saved = await post('/api/noter/save', cur).catch((e) => (toast(e.message), null));
    if (saved) { Object.assign(cur, saved); $('#saved').textContent = 'Saved'; const i = notes.findIndex((n) => n.id === cur.id); if (i >= 0) notes[i] = cur; renderList(); }
  }
  $('#title').oninput = changed;
  $('#body').oninput = changed;
  $('#newtodo').onkeydown = (e) => {
    if (e.key !== 'Enter' || !e.target.value.trim() || !cur) return;
    cur.todos.push({ text: e.target.value.trim(), done: false });
    e.target.value = '';
    renderEditor();
    changed();
  };
  $('#pin').onclick = () => { cur.pinned = !cur.pinned; renderEditor(); flush(); };
  $('#del').onclick = async () => { if (!cur || !confirm(`Delete “${cur.title || 'this note'}”?`)) return; await post('/api/noter/delete', { id: cur.id }); cur = null; load(); };
  $('#new').onclick = async () => { await flush(); const n = await post('/api/noter/save', { title: '', body: '', todos: [] }); await load(n.id); $('#title').focus(); };
  addEventListener('beforeunload', flush);
  load().catch((e) => toast(e.message));
})();
