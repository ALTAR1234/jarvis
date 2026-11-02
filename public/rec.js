// Snapper's screen recorder: records the chosen screen (up to 3 minutes) and saves it to Videos\Snapper.
(async () => {
  const source = new URLSearchParams(location.search).get('source');
  const label = document.getElementById('t');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source, maxFrameRate: 30 } } });
  } catch {
    label.textContent = 'Could not record';
    return setTimeout(() => (document.title = 'done'), 2000);
  }
  const type = ['video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1_200_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const started = Date.now();
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    label.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s >= 180) stop(); // 3 minutes keeps the file under the save limit
  }, 250);
  rec.onstop = async () => {
    clearInterval(tick);
    stream.getTracks().forEach((t) => t.stop());
    label.textContent = 'Saving…';
    const blob = new Blob(chunks, { type: 'video/webm' });
    const data = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(blob); });
    await fetch('/api/snapper/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'video', data }) }).catch(() => {});
    label.textContent = 'Saved';
    setTimeout(() => (document.title = 'done'), 900);
  };
  function stop() { if (rec.state === 'recording') rec.stop(); }
  window.stopRecording = stop;
  document.getElementById('stop').onclick = stop;
  rec.start(1000);
})();
