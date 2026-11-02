// Filer: folders, thumbnails, open / show in Explorer / move to Recycle Bin, and search by name or by description.
(() => {
  const { $, $$, esc, get, post, toast, size, ago, busy } = kit;
  const ICON = { folder: '📁', image: '🖼', video: '🎞', audio: '🎵', pdf: '📕', doc: '📄', sheet: '📊', slides: '📽', archive: '🗜', code: '⌨', file: '📄' };
  let current = '';
  async function open(dir) {
    const d = await get('/api/filer?path=' + encodeURIComponent(dir || ''));
    current = d.path;
    $('#places').innerHTML = d.places.map((p) => `<button data-p="${esc(p.path)}" class="${p.path === current ? 'on' : ''}">${esc(p.name)}</button>`).join('');
    $$('#places button').forEach((b) => (b.onclick = () => open(b.dataset.p)));
    $('#note').hidden = true;
    if (!current) { $('#crumbs').textContent = 'Pick a place on the left.'; $('#grid').innerHTML = ''; if (d.places[0]) open(d.places[0].path); return; }
    $('#crumbs').innerHTML = `${d.parent ? `<button id="up">↑ Up</button> · ` : ''}${esc(current)}`;
    $('#up')?.addEventListener('click', () => open(d.parent));
    show(d.items);
  }
  function show(items) {
    $('#grid').innerHTML = items.length ? items.map((f, i) => `<button class="f" data-i="${i}" title="${esc(f.path)}"><div class="ic"${f.kind === 'image' ? ` style="background-image:url('/api/filer/thumb?path=${encodeURIComponent(f.path)}')"` : ''}>${f.kind === 'image' ? '' : ICON[f.kind] || '📄'}</div><b>${esc(f.name)}</b><small>${f.dir ? 'Folder' : size(f.size)} · ${ago(f.modified)}</small></button>`).join('') : '<div class="empty">Nothing here.</div>';
    $$('.f').forEach((b) => {
      const f = items[+b.dataset.i];
      b.ondblclick = () => (f.dir ? open(f.path) : post('/api/filer/open', { path: f.path }).catch((e) => toast(e.message)));
      b.onclick = () => f.dir && open(f.path); // folders open with one click, files with two
      b.oncontextmenu = (e) => { e.preventDefault(); menu(e, f); };
    });
  }
  function menu(e, f) {
    const m = $('#menu');
    m.innerHTML = `<button data-a="open">${f.dir ? 'Open folder' : 'Open'}</button><button data-a="reveal">Show in File Explorer</button><button data-a="copy">Copy path</button><button data-a="trash">Move to Recycle Bin</button>`;
    m.hidden = false;
    m.style.left = Math.min(e.clientX, innerWidth - 220) + 'px';
    m.style.top = Math.min(e.clientY, innerHeight - 180) + 'px';
    m.querySelectorAll('button').forEach((b) => (b.onclick = async () => {
      m.hidden = true;
      try {
        if (b.dataset.a === 'open') f.dir ? open(f.path) : await post('/api/filer/open', { path: f.path });
        if (b.dataset.a === 'reveal') await post('/api/filer/reveal', { path: f.path });
        if (b.dataset.a === 'copy') { await navigator.clipboard.writeText(f.path); toast('Path copied'); }
        if (b.dataset.a === 'trash' && confirm(`Move “${f.name}” to the Recycle Bin?`)) { await post('/api/filer/trash', { path: f.path }); toast('Moved to the Recycle Bin'); open(current); }
      } catch (err) { toast(err.message); }
    }));
  }
  addEventListener('click', (e) => { if (!e.target.closest('#menu')) $('#menu').hidden = true; });
  $('#byname').onclick = async () => {
    const q = $('#q').value.trim();
    if (!q) return;
    busy(true);
    const r = await get(`/api/filer/search?q=${encodeURIComponent(q)}`).catch((e) => (toast(e.message), null));
    busy(false);
    if (!r) return;
    $('#crumbs').textContent = `Files named like “${q}” in your folders`;
    show(r.results);
  };
  $('#find').onsubmit = async (e) => {
    e.preventDefault();
    const q = $('#q').value.trim();
    if (!q) return;
    busy(true);
    $('#crumbs').textContent = 'J.A.R.V.I.S. is looking…';
    try {
      const r = await post('/api/filer/smart', { q });
      const f = r.filters;
      $('#crumbs').textContent = `Results for “${q}”`;
      $('#note').hidden = false;
      $('#note').textContent = `Looked for ${f.keywords ? `“${f.keywords}” ` : ''}${f.extensions?.length ? f.extensions.join('/') + ' files ' : 'files '}${f.days ? `from the last ${f.days} days ` : ''}${f.folder ? `in ${f.folder}` : 'in your folders'}`;
      show(r.results);
    } catch (err) { toast(err.message); $('#crumbs').textContent = ''; }
    busy(false);
  };
  open('');
})();
