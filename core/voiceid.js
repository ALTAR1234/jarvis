// "Only my voice": a voice fingerprint made from a few sentences the user reads aloud, then every
// utterance is compared to it before J.A.R.V.I.S. listens. Runs entirely on this PC with a small
// speaker-recognition model (sherpa-onnx + WeSpeaker ResNet34, trained on English speech).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx';
const MODEL_SHA256 = 'e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012';
const MODEL_BYTES = 26530550;
// Similarity needed to count as the user. Same person usually scores well above these; others well below.
const STRICTNESS = { relaxed: 0.5, normal: 0.58, strict: 0.66 };
const MAX_SAMPLES = 12, MIN_SECONDS = 0.6;

let dir = null, file = null, profile = null, extractor = null, downloading = null;
const modelPath = () => path.join(dir, 'models', 'wespeaker_en_voxceleb_resnet34_LM.onnx');

function init(dataDir) {
  dir = dataDir; file = path.join(dataDir, 'voice-id.json');
  try { profile = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { profile = {}; }
  profile = { enabled: profile.enabled === true, strictness: STRICTNESS[profile.strictness] ? profile.strictness : 'normal', samples: Array.isArray(profile.samples) ? profile.samples : [], ignored: profile.ignored || 0 };
}
function save() { fs.writeFileSync(file, JSON.stringify(profile)); }
const hasModel = () => { try { return fs.statSync(modelPath()).size === MODEL_BYTES; } catch { return false; } };
const active = () => profile.enabled && profile.samples.length >= 3 && hasModel();

function state() {
  return { enabled: profile.enabled, strictness: profile.strictness, samples: profile.samples.length, needed: 5, model: hasModel() ? 'ready' : downloading ? 'downloading' : 'missing', active: active(), ignored: profile.ignored };
}

// One-time download, checked against its known SHA-256 before it is used.
async function ensureModel() {
  if (hasModel()) return;
  if (downloading) return downloading;
  downloading = (async () => {
    const r = await fetch(MODEL_URL, { signal: AbortSignal.timeout(300000) });
    if (!r.ok) throw new Error(`Could not download the voice model (${r.status}).`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (crypto.createHash('sha256').update(buf).digest('hex') !== MODEL_SHA256) throw new Error('The downloaded voice model did not match its checksum, so it was not used.');
    fs.mkdirSync(path.dirname(modelPath()), { recursive: true });
    const tmp = modelPath() + '.part'; fs.writeFileSync(tmp, buf); fs.renameSync(tmp, modelPath());
  })().finally(() => { downloading = null; });
  return downloading;
}

function embed(samples) {
  if (!extractor) {
    const sherpa = require('sherpa-onnx-node');
    extractor = new sherpa.SpeakerEmbeddingExtractor({ model: modelPath(), numThreads: 2, debug: 0, provider: 'cpu' });
  }
  const stream = extractor.createStream();
  stream.acceptWaveform({ sampleRate: 16000, samples });
  stream.inputFinished();
  return Array.from(extractor.compute(stream, false)); // Electron does not allow external buffers
}
function cosine(a, b) { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / Math.sqrt(x * y || 1); }
function score(samples) {
  const e = embed(samples);
  // best match against each enrolled sample and their average, so one odd recording does not decide it
  const mean = profile.samples[0].map((_, i) => profile.samples.reduce((s, v) => s + v[i], 0) / profile.samples.length);
  const best = profile.samples.map((v) => cosine(e, v)).sort((a, b) => b - a).slice(0, 2);
  return Math.max(cosine(e, mean), best.reduce((s, x) => s + x, 0) / best.length);
}

// Audio helpers: 16 kHz mono PCM16 (base64 pieces or WAV files) -> Float32 samples.
function pcm16(buf) { const n = buf.length >> 1, out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2) / 32768; return out; }
function fromWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let at = 12, rate = 16000, channels = 1, bits = 16, data = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4), size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') { channels = buf.readUInt16LE(at + 10); rate = buf.readUInt32LE(at + 12); bits = buf.readUInt16LE(at + 22); }
    if (id === 'data') { data = buf.subarray(at + 8, Math.min(buf.length, at + 8 + size)); break; }
    at += 8 + size + (size & 1);
  }
  if (!data || bits !== 16 || channels !== 1) return null;
  const s = pcm16(data);
  if (rate === 16000) return s;
  const step = rate / 16000, out = new Float32Array(Math.floor(s.length / step));
  for (let i = 0; i < out.length; i++) out[i] = s[Math.floor(i * step)];
  return out;
}

async function enroll(wav) {
  await ensureModel();
  const s = fromWav(wav);
  if (!s || s.length < 16000 * 1.5) throw new Error('That recording was too short. Read the whole sentence.');
  let peak = 0; for (const v of s) peak = Math.max(peak, Math.abs(v));
  if (peak < 0.02) throw new Error('I could not hear you. Check the microphone and speak a little louder.');
  const e = embed(s);
  const match = profile.samples.length ? Math.max(...profile.samples.map((v) => cosine(e, v))) : null;
  profile.samples.push(e); profile.samples = profile.samples.slice(-MAX_SAMPLES);
  if (profile.samples.length >= 3 && !profile.enabledOnce) { profile.enabled = true; profile.enabledOnce = true; }
  save();
  return { ...state(), match };
}
function settings({ enabled, strictness }) {
  if (typeof enabled === 'boolean') profile.enabled = enabled;
  if (STRICTNESS[strictness]) profile.strictness = strictness;
  save(); return state();
}
function reset() { profile.samples = []; profile.enabled = false; profile.enabledOnce = false; profile.ignored = 0; save(); return state(); }

// Is this the user? Very short sounds get the relaxed bar (there is less voice to judge).
function check(samples) {
  if (!active()) return { ok: true, skipped: true };
  if (!samples || samples.length < 16000 * 0.25) return { ok: false, score: 0 };
  const sc = score(samples), seconds = samples.length / 16000;
  const bar = seconds < MIN_SECONDS * 1.5 ? Math.min(STRICTNESS.relaxed, STRICTNESS[profile.strictness]) : STRICTNESS[profile.strictness];
  const ok = sc >= bar;
  if (!ok) { profile.ignored++; if (profile.ignored % 10 === 0) save(); }
  return { ok, score: Math.round(sc * 100) / 100 };
}
const checkWav = (wav) => { const s = fromWav(wav); return s ? check(s) : { ok: true, skipped: true }; };
function test(wav) {
  if (!profile.samples.length) throw new Error('Teach me your voice first.');
  const s = fromWav(wav); if (!s) throw new Error('Unsupported recording.');
  const sc = score(s); return { score: Math.round(sc * 100) / 100, ok: sc >= STRICTNESS[profile.strictness] };
}

// Holds the first 2 s of each utterance while it is checked; then lets the rest through, or drops it.
function gate(forward, finish, rejected) {
  const NEED = 16000 * 2 * 2;
  let mode = 'idle', held = [], bytes = 0;
  const decide = () => {
    let r; try { r = check(pcm16(Buffer.concat(held.map((b) => Buffer.from(b, 'base64'))))); } catch (err) { console.warn('Voice ID check failed:', err.message); r = { ok: true }; }
    mode = r.ok ? 'pass' : 'block';
    if (r.ok) held.forEach(forward);
    held = []; bytes = 0;
  };
  return {
    audio(b64) {
      if (mode === 'pass') return forward(b64);
      if (mode === 'block') return;
      if (!active()) { held.forEach(forward); held = []; bytes = 0; mode = 'pass'; return forward(b64); }
      held.push(b64); bytes += (b64.length * 3) >> 2;
      if (bytes >= NEED) decide();
    },
    end() {
      if (mode === 'idle' && held.length) decide();
      const was = mode; mode = 'idle'; held = []; bytes = 0;
      if (was === 'block') rejected(); else finish();
    }
  };
}

module.exports = { init, state, ensureModel, enroll, settings, reset, check, checkWav, test, gate, fromWav };
