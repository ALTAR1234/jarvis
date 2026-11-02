// J.A.R.V.I.S. on a 2D canvas, in one of two styles: the "reactor" interface from the films (rotating
// segmented rings around a glowing core that pulses with the voice, amber while thinking), or a
// holographic point-cloud head that blinks, shifts its gaze and lip-syncs. Both carry a live waveform ring.
(() => {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // Head surface: latitude rings over an egg-shaped ellipsoid, front-weighted.
  function buildHead() {
    const pts = [];
    for (let ring = 0; ring <= 34; ring++) {
      const v = -1 + (ring / 34) * 2;                 // -1 crown .. 1 chin
      const lower = Math.max(0, v);
      const radius = Math.sqrt(Math.max(0, 1 - v * v)) * (1 - 0.32 * lower * lower) * (v < -0.2 ? 1.02 : 1);
      const count = Math.max(6, Math.round(64 * radius));
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU + ring * 0.09;
        pts.push({ x: Math.sin(a) * radius * 0.8, y: v * 1.08, z: Math.cos(a) * radius * 0.86, ring });
      }
    }
    return pts;
  }

  function project(p, yaw, pitch, cx, cy, s) {
    const cyaw = Math.cos(yaw), syaw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x1 = p.x * cyaw + p.z * syaw, z1 = -p.x * syaw + p.z * cyaw;
    const y2 = p.y * cp - z1 * sp, z2 = p.y * sp + z1 * cp;
    const f = 3.2 / (3.2 - z2);
    return { x: cx + x1 * s * f, y: cy + y2 * s * f, z: z2, f };
  }

  class JarvisAvatar {
    constructor(canvas) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.head = buildHead();
      this.state = 'idle'; this.style = 'reactor'; this.spin = [0, 0, 0, 0]; this.inAnalyser = null; this.outAnalyser = null;
      this.mouth = 0; this.mouthWidth = 1; this.level = 0; this.prevOut = 0; this.nod = 0;
      this.yaw = 0; this.pitch = 0; this.gaze = { x: 0, y: 0 }; this.gazeTarget = { x: 0, y: 0 }; this.nextSaccade = 0;
      this.blink = 0; this.nextBlink = performance.now() + 2000; this.eyeOpen = 1;
      this.bars = new Float32Array(96); this.freq = new Uint8Array(512); this.wave = new Float32Array(1024);
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.resize(); new ResizeObserver(() => this.resize()).observe(canvas);
      this.frame = this.frame.bind(this); requestAnimationFrame(this.frame);
    }
    setState(state) { this.state = state; }
    setStyle(style) { this.style = style === 'head' ? 'head' : 'reactor'; }
    attach({ input, output } = {}) { if (input !== undefined) this.inAnalyser = input; if (output !== undefined) this.outAnalyser = output; }
    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1), r = this.canvas.getBoundingClientRect();
      this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
      this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    rms(analyser) {
      if (!analyser) return 0;
      const buf = this.wave.length >= analyser.fftSize ? this.wave.subarray(0, analyser.fftSize) : (this.wave = new Float32Array(analyser.fftSize));
      analyser.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      return Math.sqrt(sum / buf.length);
    }
    color() {
      const css = getComputedStyle(document.documentElement).getPropertyValue('--cyan').trim() || '#00c8ff';
      if (css !== this.cssColor) {
        this.cssColor = css;
        const m = css.match(/^#?([0-9a-f]{6})$/i), n = m ? parseInt(m[1], 16) : 0x00c8ff;
        this.rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      }
      return this.rgb;
    }

    update(now, dt) {
      const speaking = this.state === 'speaking', listening = this.state === 'listening', thinking = this.state === 'thinking';
      const outLevel = this.rms(this.outAnalyser), inLevel = this.rms(this.inAnalyser);
      // Mouth follows reply audio; fall back to a gentle synthetic motion when no analyser is attached.
      let target = speaking ? (this.outAnalyser ? clamp(outLevel * 7, 0, 1) : 0.25 + 0.25 * Math.sin(now / 90) * Math.sin(now / 37)) : 0;
      this.mouth = lerp(this.mouth, target, target > this.mouth ? 0.55 : 0.25);
      this.mouthWidth = lerp(this.mouthWidth, 1 - this.mouth * 0.25 + (speaking ? 0.08 * Math.sin(now / 120) : 0), 0.2);
      // Small nods on stressed syllables.
      if (speaking && outLevel - this.prevOut > 0.045) this.nod = Math.min(1, this.nod + 0.6);
      this.prevOut = lerp(this.prevOut, outLevel, 0.3); this.nod *= 0.9;
      this.level = lerp(this.level, speaking ? outLevel : listening ? inLevel : 0, 0.3);

      // Gaze: eye contact while listening, looking away while thinking, wandering when idle.
      if (now > this.nextSaccade) {
        const spread = thinking ? 0 : listening || speaking ? 0.12 : 0.5;
        this.gazeTarget = this.state === 'asleep' ? { x: 0, y: 0.45 } : thinking ? { x: -0.55 + Math.random() * 0.15, y: -0.5 } : { x: (Math.random() - 0.5) * spread, y: (Math.random() - 0.5) * spread * 0.6 };
        this.nextSaccade = now + (thinking ? 900 : 700 + Math.random() * 2200);
      }
      const k = 1 - Math.pow(0.0001, dt / 1000);
      this.gaze.x = lerp(this.gaze.x, this.gazeTarget.x, Math.min(1, k * 1.6)); this.gaze.y = lerp(this.gaze.y, this.gazeTarget.y, Math.min(1, k * 1.6));
      const sway = this.reduced ? 0 : Math.sin(now / 2300) * 0.06;
      this.yaw = lerp(this.yaw, this.gaze.x * 0.35 + sway, 0.06);
      this.pitch = lerp(this.pitch, this.gaze.y * 0.22 + this.nod * 0.07 + (this.reduced ? 0 : Math.sin(now / 3100) * 0.025), 0.08);

      // Blinking; eyes rest half-closed on standby.
      if (now > this.nextBlink && this.state !== 'asleep') { this.blink = 1; this.nextBlink = now + 2200 + Math.random() * 4200; }
      this.blink = Math.max(0, this.blink - dt / 140);
      const rest = this.state === 'asleep' ? 0 : this.state === 'idle' ? 0.45 : thinking ? 0.75 : 1;
      this.eyeOpen = lerp(this.eyeOpen, rest * (1 - Math.sin(this.blink * Math.PI)), 0.35);

      // Ring rotation: slow at rest, quicker while listening or speaking, fast while thinking.
      const mult = this.reduced ? 0 : this.state === 'asleep' ? 0.2 : thinking ? 4 : speaking ? 1.8 + this.level * 6 : listening ? 1.4 : 1;
      [0.16, -0.06, 0.32, 0.025].forEach((v, i) => { this.spin[i] += v * mult * dt / 1000; });

      // Waveform ring from whichever stream is active.
      const analyser = speaking ? this.outAnalyser : listening ? this.inAnalyser : null;
      if (analyser) {
        const bins = analyser.frequencyBinCount;
        if (this.freq.length !== bins) this.freq = new Uint8Array(bins);
        analyser.getByteFrequencyData(this.freq);
      }
      const usable = Math.floor(this.freq.length * 0.45);
      for (let i = 0; i < this.bars.length; i++) {
        const mirror = i < 48 ? i : 95 - i;
        const v = analyser ? this.freq[Math.floor((mirror / 48) * usable)] / 255 : 0;
        const idle = this.reduced ? 0.04 : 0.04 + 0.03 * Math.sin(now / 700 + i * 0.4);
        this.bars[i] = lerp(this.bars[i], Math.max(idle, v), 0.35);
      }
    }

    drawReactor(now) {
      const { ctx, w, h } = this; const [r, g, b] = this.color();
      const asleep = this.state === 'asleep', thinking = this.state === 'thinking', dim = asleep ? 0.35 : 1;
      const rgba = (a) => `rgba(${r},${g},${b},${a * dim})`, amber = (a) => `rgba(255,168,58,${a * dim})`;
      const cx = w / 2, cy = h / 2, size = Math.min(w, h), [s1, s2, s3, s4] = this.spin;
      const arc = (rad, a0, a1, width, style) => { ctx.strokeStyle = style; ctx.lineWidth = width; ctx.beginPath(); ctx.arc(cx, cy, rad, a0, a1); ctx.stroke(); };
      const spoke = (a, r0, r1, width, style) => { ctx.strokeStyle = style; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke(); };
      ctx.clearRect(0, 0, w, h); ctx.lineCap = 'butt';

      // Outer frame: hairline ring with four slow bracket arcs.
      arc(size * 0.445, 0, TAU, 1, rgba(0.2));
      for (let i = 0; i < 4; i++) { const a = (i * TAU) / 4 + s4; arc(size * 0.43, a - 0.3, a + 0.3, Math.max(2, size * 0.006), rgba(0.65)); }
      // Voice waveform.
      const ringR = size * 0.355; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.5, size * 0.005);
      for (let i = 0; i < this.bars.length; i++) {
        const a = (i / this.bars.length) * TAU - Math.PI / 2, len = size * (0.008 + this.bars[i] * 0.06);
        spoke(a, ringR, ringR + len, ctx.lineWidth, rgba(0.25 + this.bars[i] * 0.75));
      }
      ctx.lineCap = 'butt';
      // Graduated tick ring.
      const tr = size * 0.305;
      for (let i = 0; i < 120; i++) { const long = i % 10 === 0; spoke((i / 120) * TAU + s2, tr, tr - size * (long ? 0.024 : 0.011), Math.max(1, size * 0.0025), rgba(long ? 0.85 : 0.35)); }
      // Heavy arcs; they turn amber while thinking.
      const col = thinking ? amber : rgba;
      for (const [a0, a1] of [[0, 1.1], [1.5, 2.25], [2.7, 4.35], [4.85, 5.7]]) arc(size * 0.255, a0 + s3, a1 + s3, size * 0.017, col(0.8));
      arc(size * 0.232, 0, TAU, 1, rgba(0.3));
      // Segmented ring.
      for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU + s1; arc(size * 0.195, a + 0.035, a + TAU / 24 - 0.035, size * 0.03, rgba(i % 3 === 0 ? 0.6 : 0.24)); }
      // Inner housing and spokes.
      arc(size * 0.148, 0, TAU, Math.max(1.5, size * 0.004), rgba(0.9));
      for (let i = 0; i < 10; i++) spoke((i / 10) * TAU - s1 * 0.5, size * 0.1, size * 0.138, size * 0.014, rgba(0.45));
      // Scanning sweep while thinking.
      if (thinking && !this.reduced) { const a = (now / 520) % TAU; ctx.fillStyle = amber(0.13); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, size * 0.305, a, a + 0.7); ctx.closePath(); ctx.fill(); }
      // Core: white-hot centre, pulsing with the voice.
      const pulse = asleep ? 0.75 : 1 + this.level * 2.2 + (this.reduced ? 0 : 0.04 * Math.sin(now / 420)), cr = size * 0.2 * Math.min(1.5, pulse);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
      glow.addColorStop(0, `rgba(240,252,255,${0.95 * dim})`); glow.addColorStop(0.22, rgba(0.85)); glow.addColorStop(0.5, rgba(0.25)); glow.addColorStop(1, rgba(0));
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, cr, 0, TAU); ctx.fill();
    }

    draw(now) {
      if (this.style === 'reactor') return this.drawReactor(now);
      const { ctx, w, h } = this; const [r, g, b] = this.color();
      const rgba = (a) => `rgba(${r},${g},${b},${a})`;
      const cx = w / 2, cy = h / 2, size = Math.min(w, h), s = size * 0.225;
      ctx.clearRect(0, 0, w, h);

      // Waveform ring.
      const ringR = size * 0.335;
      ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.5, size * 0.006);
      for (let i = 0; i < this.bars.length; i++) {
        const a = (i / this.bars.length) * TAU - Math.PI / 2, len = size * (0.012 + this.bars[i] * 0.075);
        ctx.strokeStyle = rgba(0.25 + this.bars[i] * 0.75);
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * ringR, cy + Math.sin(a) * ringR); ctx.lineTo(cx + Math.cos(a) * (ringR + len), cy + Math.sin(a) * (ringR + len)); ctx.stroke();
      }

      // Glow behind the head, brighter with voice level.
      const glow = ctx.createRadialGradient(cx, cy, s * 0.2, cx, cy, s * 1.6);
      glow.addColorStop(0, rgba(0.16 + this.level * 0.5)); glow.addColorStop(1, rgba(0));
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, s * 1.6, 0, TAU); ctx.fill();

      // Point-cloud head with a sweeping scan line.
      const scan = this.reduced ? -9 : ((now / 2600) % 1) * 2.6 - 1.3;
      const headCy = cy + s * 0.02;
      for (const p of this.head) {
        const q = project(p, this.yaw, this.pitch, cx, headCy, s);
        if (q.z < -0.25) continue;
        const front = clamp((q.z + 0.25) / 1.1, 0, 1), near = Math.max(0, 1 - Math.abs(p.y - scan) * 6);
        ctx.fillStyle = rgba(0.12 + front * 0.55 + near * 0.35);
        const d = (0.7 + front * 0.9 + near) * size * 0.0028;
        ctx.fillRect(q.x - d / 2, q.y - d / 2, d, d);
      }

      // Facial features sit on the head surface and rotate with it.
      const at = (x, y, z) => project({ x, y, z }, this.yaw, this.pitch, cx, headCy, s);
      ctx.shadowColor = rgba(0.9); ctx.shadowBlur = size * 0.02;
      // Brows lift slightly while speaking.
      const lift = this.nod * 0.05 + (this.state === 'thinking' ? 0.04 : 0);
      ctx.strokeStyle = rgba(0.75); ctx.lineWidth = Math.max(1.2, size * 0.005);
      for (const side of [-1, 1]) {
        const a = at(side * 0.16, -0.36 - lift, 0.82), m = at(side * 0.3, -0.42 - lift, 0.8), c = at(side * 0.46, -0.36 - lift, 0.7);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(m.x, m.y, c.x, c.y); ctx.stroke();
      }
      // Eyes: almond outline, open amount from blink/state, iris follows gaze.
      for (const side of [-1, 1]) {
        const e = at(side * 0.3, -0.2, 0.8), ew = s * 0.17 * e.f, eh = s * 0.075 * e.f * this.eyeOpen;
        ctx.strokeStyle = rgba(0.95); ctx.lineWidth = Math.max(1.2, size * 0.0045);
        ctx.beginPath(); ctx.moveTo(e.x - ew, e.y); ctx.quadraticCurveTo(e.x, e.y - eh * 2, e.x + ew, e.y); ctx.quadraticCurveTo(e.x, e.y + eh * 1.6, e.x - ew, e.y); ctx.stroke();
        if (this.eyeOpen > 0.15) {
          ctx.fillStyle = rgba(0.95);
          const ix = e.x + this.gaze.x * ew * 0.45, iy = e.y - eh * 0.15 + this.gaze.y * eh * 0.5;
          ctx.beginPath(); ctx.arc(ix, iy, Math.min(eh * 0.9, s * 0.045), 0, TAU); ctx.fill();
        }
      }
      // Nose hint.
      const n1 = at(0, -0.08, 0.9), n2 = at(0.035, 0.14, 0.98), n3 = at(-0.06, 0.18, 0.94);
      ctx.strokeStyle = rgba(0.45); ctx.lineWidth = Math.max(1, size * 0.003);
      ctx.beginPath(); ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.lineTo(n3.x, n3.y); ctx.stroke();
      // Mouth: lips part with the reply audio.
      const mw = 0.2 * this.mouthWidth, open = this.mouth * 0.16;
      const ml = at(-mw, 0.42, 0.82), mr = at(mw, 0.42, 0.82), up = at(0, 0.4 - open * 0.35, 0.88), lo = at(0, 0.44 + open, 0.86);
      ctx.strokeStyle = rgba(0.95); ctx.lineWidth = Math.max(1.3, size * 0.005);
      ctx.beginPath(); ctx.moveTo(ml.x, ml.y); ctx.quadraticCurveTo(up.x, up.y - s * 0.02, mr.x, mr.y); ctx.quadraticCurveTo(lo.x, lo.y + s * 0.02, ml.x, ml.y);
      if (open > 0.01) { ctx.fillStyle = rgba(0.18 + this.mouth * 0.3); ctx.fill(); }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    frame(now) {
      const dt = Math.min(100, now - (this.last || now)); this.last = now;
      if (!document.hidden) { this.update(now, dt); this.draw(now); }
      requestAnimationFrame(this.frame);
    }
  }
  window.JarvisAvatar = JarvisAvatar;
})();
