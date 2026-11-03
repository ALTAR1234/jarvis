// Voice vocabulary: words the user says often (passed to speech recognition as hints) and
// corrections for things it keeps mishearing ("jueves" -> "Jarvis"), fixed in every transcript.
const fs = require('node:fs');
const path = require('node:path');

let file = null, data = { words: [], fixes: [] };
const DEFAULT = { words: ['Jarvis'], fixes: [{ heard: 'jueves', said: 'Jarvis' }] };
const clean = (s, n = 60) => String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function init(dataDir) {
  file = path.join(dataDir, 'voice-words.json');
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = JSON.parse(JSON.stringify(DEFAULT)); save(); }
  data.words = Array.isArray(data.words) ? data.words : []; data.fixes = Array.isArray(data.fixes) ? data.fixes : [];
}
function save() { if (file) fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
const state = () => ({ words: [...data.words], fixes: data.fixes.map((f) => ({ ...f })) });

function addWord(word) {
  const w = clean(word, 40);
  if (!w) throw new Error('Say which word to add.');
  if (!data.words.some((x) => x.toLowerCase() === w.toLowerCase())) { data.words.push(w); data.words = data.words.slice(-150); save(); }
  return state();
}
function removeWord(word) { data.words = data.words.filter((x) => x.toLowerCase() !== clean(word, 40).toLowerCase()); save(); return state(); }
function addFix(heard, said) {
  const h = clean(heard), s = clean(said);
  if (!h || !s) throw new Error('Say what I heard and what you actually said.');
  if (h.toLowerCase() === s.toLowerCase()) throw new Error('Those are the same.');
  data.fixes = data.fixes.filter((f) => f.heard.toLowerCase() !== h.toLowerCase());
  data.fixes.push({ heard: h, said: s }); data.fixes = data.fixes.slice(-150);
  // the right word is also worth hinting
  if (!data.words.some((x) => x.toLowerCase() === s.toLowerCase()) && s.split(' ').length <= 3) data.words.push(s);
  save(); return state();
}
function removeFix(heard) { data.fixes = data.fixes.filter((f) => f.heard.toLowerCase() !== clean(heard).toLowerCase()); save(); return state(); }

// Whole words or phrases only, any capitalisation; longest first so phrases win over single words.
function apply(text) {
  if (typeof text !== 'string' || !text || !data.fixes.length) return text;
  let out = text;
  for (const f of [...data.fixes].sort((a, b) => b.heard.length - a.heard.length)) {
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}'])${escape(f.heard)}(?=$|[^\\p{L}\\p{N}'])`, 'giu'), (_m, pre) => pre + f.said);
  }
  return out;
}
// A short line for speech recognisers and the live voice models.
function hint() {
  const words = data.words.slice(-60);
  const fixes = data.fixes.slice(-30);
  return [words.length && `Words the user often says: ${words.join(', ')}.`, fixes.length && `Speech recognition often mishears them: ${fixes.map((f) => `"${f.heard}" means "${f.said}"`).join('; ')}.`].filter(Boolean).join(' ');
}

module.exports = { init, state, addWord, removeWord, addFix, removeFix, apply, hint };
