// Jarvis Visioner (Ctrl+Alt+J): the screen frozen as it was. Drag a box around anything (or press
// Enter for the whole screen), then ask with a chip, by typing, or out loud. Esc or the ✕ closes it;
// the main process hides the window when the title becomes "close".
(() => {
  const $ = (s) => document.querySelector(s);
  const box = $('#box'), card = $('#card'), thread = $('#thread'), q = $('#q');
  let region = null, start = null, history = [], busy = false;

  const close = () => (document.title = 'close');
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter' && card.hidden) pick(null);
  });
  $('#close').onclick = close;
  $('#again').onclick = () => {
    card.hidden = true;
    box.hidden = true;
    document.body.classList.remove('picked');
    region = null;
    history = [];
    thread.replaceChildren();
  };

  // ---- drag a box ----
  addEventListener('mousedown', (e) => {
    if (!card.hidden || e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY };
    draw(e);
    box.hidden = false;
  });
  addEventListener('mousemove', (e) => start && draw(e));
  addEventListener('mouseup', (e) => {
    if (!start) return;
    const r = rect(e);
    start = null;
    if (r.w < 12 || r.h < 12) { box.hidden = true; return; }
    pick(r);
  });
  function rect(e) {
    return { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
  }
  function draw(e) {
    const r = rect(e);
    Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  }

  // ---- show the card beside the pick ----
  function pick(r) {
    document.body.classList.add('picked');
    const W = innerWidth, H = innerHeight;
    if (r) {
      region = { x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H };
      box.hidden = false;
    } else {
      region = null;
      box.hidden = true;
    }
    card.hidden = false;
    const cw = card.offsetWidth, ch = Math.min(card.offsetHeight + 260, H - 40), gap = 16;
    let x, y;
    if (!r) { x = W - cw - 28; y = 28; }
    else if (r.x + r.w + gap + cw < W - 12) { x = r.x + r.w + gap; y = r.y; }
    else if (r.x - gap - cw > 12) { x = r.x - gap - cw; y = r.y; }
    else { x = Math.min(Math.max(12, r.x), W - cw - 12); y = r.y + r.h + gap; }
    y = Math.max(12, Math.min(y, H - ch - 12));
    Object.assign(card.style, { left: x + 'px', top: y + 'px' });
    q.focus();
  }

  // ---- ask ----
  document.querySelectorAll('#chips button').forEach((b) => (b.onclick = () => ask(b.dataset.q, b.textContent)));
  $('#ask').onsubmit = (e) => {
    e.preventDefault();
    if (q.value.trim()) ask(q.value.trim());
    q.value = '';
  };
  async function ask(question, label) {
    if (busy) return;
    busy = true;
    document.body.classList.add('thinking');
    const qEl = document.createElement('div');
    qEl.className = 'q';
    qEl.textContent = label || question;
    const aEl = document.createElement('div');
    aEl.className = 'a';
    aEl.innerHTML = '<div class="typing"><i></i><i></i><i></i></div>';
    thread.append(qEl, aEl);
    thread.scrollTop = thread.scrollHeight;
    try {
      const r = await fetch('/api/vision/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, region, history }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Something went wrong.');
      history.push({ q: question, a: j.answer });
      aEl.innerHTML = render(j.answer) + '<button class="copy">Copy answer</button>';
      aEl.querySelector('.copy').onclick = async (e) => {
        await navigator.clipboard.writeText(j.answer).catch(() => {});
        e.target.textContent = 'Copied';
      };
    } catch (err) {
      aEl.innerHTML = `<p class="err">${esc(err.message)}</p>`;
    }
    busy = false;
    document.body.classList.remove('thinking');
    thread.scrollTop = qEl.offsetTop - 8;
    q.focus();
  }

  // ---- ask out loud: record until you stop talking, then Jarvis transcribes ----
  let rec = null;
  $('#mic').onclick = async () => {
    if (rec) return rec.stop();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { return; }
    const type = ['audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    rec = new MediaRecorder(stream, type ? { mimeType: type } : {});
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const ctx = new AudioContext(), an = ctx.createAnalyser(), buf = new Uint8Array(512);
    ctx.createMediaStreamSource(stream).connect(an);
    let heard = false, quietSince = Date.now();
    const watch = setInterval(() => {
      an.getByteTimeDomainData(buf);
      const level = Math.max(...buf.map((v) => Math.abs(v - 128)));
      if (level > 14) { heard = true; quietSince = Date.now(); }
      if ((heard && Date.now() - quietSince > 1400) || (!heard && Date.now() - quietSince > 7000)) rec.stop();
    }, 100);
    rec.onstop = async () => {
      clearInterval(watch);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      rec = null;
      $('#mic').classList.remove('on');
      if (!heard || !chunks.length) return;
      const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
      const r = await fetch('/api/voice/asr', { method: 'POST', headers: { 'content-type': blob.type }, body: blob }).catch(() => null);
      const j = await r?.json().catch(() => ({}));
      if (j?.text) ask(j.text);
    };
    rec.start();
    $('#mic').classList.add('on');
  };

  // ---- a little markdown: paragraphs, lists, bold, code ----
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function inline(s) { return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>'); }
  function render(md) {
    const out = [];
    const blocks = String(md).split(/```/);
    blocks.forEach((block, i) => {
      if (i % 2) { out.push(`<pre><code>${esc(block.replace(/^\w*\n/, ''))}</code></pre>`); return; }
      let list = null;
      for (const line of block.split('\n')) {
        const li = /^\s*(?:[-*•]|\d+[.)])\s+(.*)/.exec(line);
        if (li) {
          if (!list) { list = /^\s*\d/.test(line) ? 'ol' : 'ul'; out.push(`<${list}>`); }
          out.push(`<li>${inline(li[1])}</li>`);
          continue;
        }
        if (list) { out.push(`</${list}>`); list = null; }
        const h = /^#{1,6}\s+(.*)/.exec(line);
        if (h) out.push(`<h4>${inline(h[1])}</h4>`);
        else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
      }
      if (list) out.push(`</${list}>`);
    });
    return out.join('');
  }
})();
