// Shopper: switch plugins on and off, remove them, and install more from the jarvis-plugins repo.
(() => {
  const { $, $$, esc, get, post, toast, size } = kit;
  const nice = (f) => f.replace(/\.js$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const ICON = (f) => (/music|listener/.test(f) ? '♪' : /tv|stream/.test(f) ? '▷' : /game/.test(f) ? '◈' : /web|browser/.test(f) ? '◎' : /note/.test(f) ? '✐' : /social/.test(f) ? '◉' : '⚙');
  const report = (r) => (r.errors?.length ? toast(`Loaded with problems: ${r.errors[0]}`) : toast('Done. J.A.R.V.I.S. reloaded its plugins.'));
  async function load() {
    const { installed } = await get('/api/shopper');
    $('#installed').innerHTML = installed.length ? installed.map((p) => `<div class="card p${p.on ? '' : ' off'}"><span class="ic">${ICON(p.file)}</span><b>${esc(nice(p.file))}</b><div class="acts"><button class="btn small" data-t="${esc(p.file)}" data-on="${!p.on}">${p.on ? 'Turn off' : 'Turn on'}</button><button class="btn small danger" data-rm="${esc(p.file)}">Remove</button></div><small>${p.on ? `${p.tools.length} skill${p.tools.length === 1 ? '' : 's'}` : 'Turned off'}</small><div class="tools">${p.tools.map((t) => `<span title="${esc(t.description)}">${esc(t.name.replace(/_/g, ' '))}</span>`).join('')}</div></div>`).join('') : '<div class="empty">No plugins installed.</div>';
    $$('[data-t]').forEach((b) => (b.onclick = async () => { report(await post('/api/shopper/toggle', { file: b.dataset.t, on: b.dataset.on === 'true' })); load(); }));
    $$('[data-rm]').forEach((b) => (b.onclick = async () => { if (!confirm(`Remove ${nice(b.dataset.rm)}?`)) return; report(await post('/api/shopper/remove', { file: b.dataset.rm })); load(); }));
    get('/api/shopper/catalog').then(({ catalog }) => {
      $('#catalog').innerHTML = catalog.length ? catalog.map((p) => `<div class="card p"><span class="ic">${ICON(p.file)}</span><b>${esc(nice(p.file))}</b><div class="acts">${p.installed ? '<button class="btn small" disabled>Installed</button>' : `<button class="btn small primary" data-in="${esc(p.file)}">Install</button>`}</div><small>${size(p.size)} · ${esc(p.file)}</small></div>`).join('') : '<div class="empty">The catalog is empty.</div>';
      $$('[data-in]').forEach((b) => (b.onclick = async () => {
        if (!confirm(`Install ${nice(b.dataset.in)}? Plugins run as part of J.A.R.V.I.S. on this PC; only install ones you trust (this catalog is your own repo).`)) return;
        try { report(await post('/api/shopper/install', { file: b.dataset.in })); load(); } catch (e) { toast(e.message); }
      }));
    }).catch((e) => ($('#catalog').innerHTML = `<div class="empty">${esc(e.message)}</div>`));
  }
  load().catch((e) => toast(e.message));
})();
