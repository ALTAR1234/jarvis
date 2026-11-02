// Updater: each app's update status against GitHub, and one-click update + rebuild.
(() => {
  const { $, $$, esc, get, post, toast, busy } = kit;
  async function load() {
    busy(true);
    $('#list').innerHTML = '<div class="empty">Checking each app…</div>';
    try {
      const { apps } = await get('/api/updater');
      $('#list').innerHTML = apps.map((a) => `<div class="card a"><span class="ic">${esc(a.name[0])}</span><div><b>${esc(a.name)}</b><small>${a.error ? esc(a.error) : esc(a.last)}${a.changed ? ` · ${a.changed} unsaved change${a.changed > 1 ? 's' : ''} on this PC` : ''}</small></div>
        ${a.error ? '<span class="tag err">Can\'t check</span>' : a.behind ? `<span class="tag new">${a.behind} update${a.behind > 1 ? 's' : ''}</span><button class="btn small primary" data-u="${esc(a.name)}">Update</button>` : '<span class="tag">Up to date</span>'}</div>`).join('') || '<div class="empty">No app folders found.</div>';
      $$('[data-u]').forEach((b) => (b.onclick = async () => {
        if (b.dataset.u === 'J.A.R.V.I.S.' && !confirm('Updating J.A.R.V.I.S. closes and restarts it. Go ahead?')) return;
        b.disabled = true; b.textContent = 'Updating…';
        try { const r = await post('/api/updater/update', { name: b.dataset.u }); toast(r.rebuilding ? `Updated. ${b.dataset.u} is rebuilding in its own window.` : r.note || 'Updated'); load(); }
        catch (e) { toast(e.message); b.disabled = false; b.textContent = 'Update'; }
      }));
    } catch (e) { $('#list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    busy(false);
  }
  $('#check').onclick = load;
  load();
})();
