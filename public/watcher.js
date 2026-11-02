// Watcher: CPU, memory, disk and battery gauges, the busiest programs, and a plain-language "why is it slow?"
(() => {
  const { $, esc, get, post, md, toast, busy } = kit;
  const history = [];
  const ring = (pct, color) => {
    const r = 50, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pct || 0));
    return `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${r}" fill="none" stroke="rgb(255 255 255 / .08)" stroke-width="10"/><circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * v) / 100} ${c}" transform="rotate(-90 60 60)"/><text x="60" y="68" text-anchor="middle" fill="#fff" font-size="24" font-weight="800">${Math.round(v)}%</text></svg>`;
  };
  async function load() {
    const s = await get('/api/watcher');
    history.push(s.cpu || 0);
    if (history.length > 40) history.shift();
    const mem = s.memory ? (s.memory.usedGB / s.memory.totalGB) * 100 : 0;
    const disk = s.disk ? ((s.disk.totalGB - s.disk.freeGB) / s.disk.totalGB) * 100 : 0;
    const bat = s.battery && !s.battery.none ? s.battery : null;
    $('#sub').textContent = `${esc(s.cpuModel || '')} · ${s.cores} cores · up ${s.uptimeHours} hours`;
    $('#gauges').innerHTML = [
      [ring(s.cpu, '#38cfff'), 'CPU', s.cpu > 85 ? 'Very busy' : s.cpu > 50 ? 'Busy' : 'Relaxed'],
      [ring(mem, '#b48cff'), 'Memory', s.memory ? `${s.memory.usedGB} of ${s.memory.totalGB} GB` : ''],
      [ring(disk, '#ffb35c'), 'Disk', s.disk ? `${s.disk.freeGB} GB free` : ''],
      [bat ? ring(bat.percent, '#5ee6a5') : ring(0, '#5ee6a5'), 'Battery', bat ? (bat.charging ? 'Charging' : 'On battery') : 'Plugged in (no battery)'],
    ].map(([g, b, sm]) => `<div class="card g">${g}<b>${b}</b><small>${sm}</small></div>`).join('');
    const top = s.processes || [];
    const max = Math.max(1, ...top.map((p) => p.memoryMB));
    $('#procs').innerHTML = top.map((p) => `<tr><td>${esc(p.window || p.name)}<div class="bar" style="width:${(p.memoryMB / max) * 100}%"></div></td><td>${p.memoryMB.toLocaleString()} MB</td></tr>`).join('');
    const cv = $('#hist'), g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.strokeStyle = '#38cfff'; g.lineWidth = 2.5; g.beginPath();
    history.forEach((v, i) => { const x = (i / 39) * cv.width, y = cv.height - (v / 100) * (cv.height - 8) - 4; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  }
  $('#why').onclick = async () => {
    busy(true);
    $('#answer').innerHTML = '<p>Looking at what is running…</p>';
    try { $('#answer').innerHTML = md((await post('/api/watcher/explain')).text); } catch (e) { $('#answer').innerHTML = ''; toast(e.message); }
    busy(false);
  };
  load().catch((e) => toast(e.message));
  setInterval(() => load().catch(() => {}), 3000);
})();
