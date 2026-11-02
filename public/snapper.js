// Snapper: the screen, frozen. Crop to the part you want, draw on it, box things, blur private bits,
// then copy it or save it to Pictures\Snapper.
(() => {
  const { $, $$, post, toast } = kit;
  const cv = $('#c'), g = cv.getContext('2d');
  let tool = 'crop', crop = null, drag = null, undo = [];
  const img = new Image();
  img.onload = () => { cv.width = img.naturalWidth; cv.height = img.naturalHeight; g.drawImage(img, 0, 0); };
  img.src = '/api/snapper/shot?t=' + Date.now();
  const sx = () => cv.width / innerWidth, sy = () => cv.height / innerHeight;
  const pt = (e) => ({ x: e.clientX * sx(), y: e.clientY * sy(), cx: e.clientX, cy: e.clientY });
  const snapshot = () => { undo.push(g.getImageData(0, 0, cv.width, cv.height)); if (undo.length > 20) undo.shift(); };

  $$('[data-tool]').forEach((b) => (b.onclick = () => { tool = b.dataset.tool; $$('[data-tool]').forEach((x) => x.classList.toggle('on', x === b)); }));
  cv.onmousedown = (e) => {
    const p = pt(e);
    drag = { start: p, last: p };
    if (tool !== 'crop') snapshot();
    if (tool === 'box' || tool === 'blur') drag.base = g.getImageData(0, 0, cv.width, cv.height);
  };
  addEventListener('mousemove', (e) => {
    if (!drag) return;
    const p = pt(e), s = drag.start;
    if (tool === 'crop') {
      crop = { x: Math.min(s.cx, p.cx), y: Math.min(s.cy, p.cy), w: Math.abs(p.cx - s.cx), h: Math.abs(p.cy - s.cy) };
      Object.assign($('#crop').style, { left: crop.x + 'px', top: crop.y + 'px', width: crop.w + 'px', height: crop.h + 'px' });
      $('#crop').hidden = false;
    } else if (tool === 'pen') {
      g.strokeStyle = $('#color').value; g.lineWidth = 4 * sx(); g.lineCap = g.lineJoin = 'round';
      g.beginPath(); g.moveTo(drag.last.x, drag.last.y); g.lineTo(p.x, p.y); g.stroke();
      drag.last = p;
    } else {
      g.putImageData(drag.base, 0, 0);
      const r = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
      if (tool === 'box') { g.strokeStyle = $('#color').value; g.lineWidth = 4 * sx(); g.strokeRect(r.x, r.y, r.w, r.h); }
      else pixelate(r);
    }
  });
  addEventListener('mouseup', () => { drag = null; });
  function pixelate(r) {
    if (r.w < 4 || r.h < 4) return;
    const block = Math.max(8, Math.round(14 * sx()));
    for (let y = r.y; y < r.y + r.h; y += block) for (let x = r.x; x < r.x + r.w; x += block) {
      const d = g.getImageData(x, y, 1, 1).data;
      g.fillStyle = `rgb(${d[0]},${d[1]},${d[2]})`;
      g.fillRect(x, y, Math.min(block, r.x + r.w - x), Math.min(block, r.y + r.h - y));
    }
  }
  // the finished picture: the crop if you made one, otherwise the whole screen
  function result() {
    if (!crop || crop.w < 5 || crop.h < 5) return cv.toDataURL('image/png').split(',')[1];
    const out = document.createElement('canvas');
    out.width = Math.round(crop.w * sx()); out.height = Math.round(crop.h * sy());
    out.getContext('2d').drawImage(cv, crop.x * sx(), crop.y * sy(), out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png').split(',')[1];
  }
  const close = () => post('/api/snapper/close');
  $('#copy').onclick = async () => { await post('/api/snapper/copy', { data: result() }); toast('Copied'); setTimeout(close, 500); };
  $('#save').onclick = async () => { const r = await post('/api/snapper/save', { kind: 'image', data: result(), copy: true }); toast('Saved to Pictures\\Snapper and copied'); setTimeout(close, 700); return r; };
  $('#undo').onclick = () => { const s = undo.pop(); if (s) g.putImageData(s, 0, 0); };
  $('#close').onclick = close;
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.ctrlKey && e.key.toLowerCase() === 'z') $('#undo').click();
    if (e.ctrlKey && e.key.toLowerCase() === 'c') { e.preventDefault(); $('#copy').click(); }
    if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); $('#save').click(); }
  });
})();
