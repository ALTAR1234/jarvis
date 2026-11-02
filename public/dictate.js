// Voice dictation bar: records, Jarvis transcribes (/api/voice/asr), then the text is pasted into
// whatever app had focus (/api/dictate/paste). The window never takes focus itself. The main
// process shows it, calls dictate.toggle(), and hides it again when the title goes back to "idle".
(() => {
  const pill = document.getElementById('pill');
  const msg = document.getElementById('msg');
  const bars = [...document.querySelectorAll('#bars i')];
  let rec = null, stream = null, ctx = null, watch = null, cancelled = false;

  const show = (state, text) => {
    pill.className = 'pill ' + state;
    msg.textContent = text;
    document.getElementById('bars').style.display = state === 'listening' ? '' : 'none';
    document.getElementById('key').style.display = state === 'listening' ? '' : 'none';
  };
  const done = (delay = 0) => setTimeout(() => (document.title = 'idle'), delay);
  const cleanup = () => {
    clearInterval(watch);
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
    stream = ctx = null;
  };

  async function start() {
    document.title = 'busy';
    cancelled = false;
    show('listening', 'Listening…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      show('error', 'Microphone unavailable');
      return done(2000);
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    rec = new MediaRecorder(stream, type ? { mimeType: type } : {});
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    // stop ~1.5s after you stop talking, after 60s, or after 8s of nothing
    ctx = new AudioContext();
    const an = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    let spoke = false, quietSince = Date.now();
    const started = Date.now();
    watch = setInterval(() => {
      an.getByteTimeDomainData(buf);
      const level = Math.sqrt(buf.reduce((s, v) => s + (v - 128) ** 2, 0) / buf.length);
      bars.forEach((b, i) => (b.style.height = `${Math.max(4, Math.min(22, level * (0.6 + ((i * 7) % 5) / 5) * 1.6))}px`));
      if (level > 6) { spoke = true; quietSince = Date.now(); }
      if ((spoke && Date.now() - quietSince > 1500) || Date.now() - started > 60000 || (!spoke && Date.now() - started > 8000)) stop();
    }, 80);
    rec.onstop = async () => {
      cleanup();
      rec = null;
      if (cancelled) return done();
      if (!spoke) { show('error', 'Didn’t hear anything'); return done(1500); }
      show('working', 'Writing…');
      try {
        const blob = new Blob(chunks, { type: (type || 'audio/webm').split(';')[0] });
        const r = await fetch('/api/voice/asr', { method: 'POST', headers: { 'content-type': blob.type }, body: blob }).then((x) => x.json());
        if (!r.text) throw new Error(r.error || 'Didn’t catch that');
        const p = await fetch('/api/dictate/paste', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: r.text }) }).then((x) => x.json());
        if (p.error) throw new Error(p.error);
        show('working', '“' + r.text + '”');
        done(900);
      } catch (e) {
        show('error', e.message);
        done(2500);
      }
    };
    rec.start();
  }
  function stop() {
    if (rec && rec.state === 'recording') rec.stop();
  }
  window.dictate = {
    toggle() { if (rec) stop(); else if (document.title === 'idle') start(); },
    cancel() { cancelled = true; stop(); },
  };
})();
