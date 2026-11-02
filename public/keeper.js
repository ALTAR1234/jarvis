// Keeper: back up now, daily backups, and restore any of the last 10.
(() => {
  const { $, $$, esc, get, post, toast, ago, size, busy } = kit;
  async function load() {
    const d = await get('/api/keeper');
    $('#last').textContent = d.last ? `Last backup ${ago(d.last)}` : 'No backups yet';
    $('#daily').textContent = d.daily ? 'On' : 'Off';
    $('#list').innerHTML = d.backups.length ? d.backups.map((b) => `<div class="card b"><div><b>${new Date(b.at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</b><small>${size(b.size)} · ${esc(b.name)}</small></div><button class="btn small" data-r="${esc(b.name)}">Restore</button></div>`).join('') : '';
    $$('[data-r]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Restore this backup? It replaces the current settings and data of J.A.R.V.I.S. and your apps with the ones in the backup.')) return;
      busy(true);
      try { const r = await post('/api/keeper/restore', { name: b.dataset.r }); alert(`Restored ${r.restored} files. ${r.note}`); } catch (e) { toast(e.message); }
      busy(false);
    }));
  }
  $('#now').onclick = async () => {
    busy(true);
    $('#now').disabled = true; $('#now').textContent = 'Backing up…';
    try { const r = await post('/api/keeper/backup'); toast(`Backed up ${r.files} files`); } catch (e) { toast(e.message); }
    $('#now').disabled = false; $('#now').textContent = 'Back up now';
    busy(false);
    load();
  };
  $('#daily').onclick = async () => { await post('/api/preferences', { backupDaily: $('#daily').textContent !== 'On' }); load(); };
  $('#folder').onclick = () => post('/api/keeper/open').catch((e) => toast(e.message));
  load().catch((e) => toast(e.message));
})();
