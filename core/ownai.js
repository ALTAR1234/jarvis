// Jarvis Core: J.A.R.V.I.S.'s own AI, built from scratch here. No downloaded or open-source model.
//  1. A small neural network (hashed word + letter features -> 64 hidden units -> intents), trained at
//     startup on phrasings generated below, works out what a request means in a few milliseconds.
//  2. Slot rules pull out the details (the level, the app, the minutes) and Jarvis's own skills do the work.
//  3. General questions: it does maths itself, and otherwise looks the answer up (DuckDuckGo instant
//     answers and Wikipedia, both free for apps) and its own ranker picks the sentences that answer it.
// Anything it is not sure about returns null, so a bigger brain can take over.

// ---------- training data ----------
const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];
const APPS = ['spotify', 'chrome', 'notepad', 'calculator', 'word', 'excel', 'discord', 'steam', 'file explorer', 'settings', 'edge', 'vs code', 'paint', 'photos', 'roblox', 'minecraft', 'teams', 'zoom', 'outlook', 'task manager', 'weber', 'listener', 'obs', 'camera'];
const NUMS = ['10', '20', '25', '30', '40', '50', '60', '70', '75', '80', '90', '100', 'fifty', 'thirty', 'twenty', 'eighty', 'five'];
const TOPICS = ['the eiffel tower', 'photosynthesis', 'black holes', 'the roman empire', 'abraham lincoln', 'mount everest', 'the moon', 'dna', 'the pacific ocean', 'world war 2', 'the great wall of china', 'albert einstein', 'volcanoes', 'the internet', 'pythagoras', 'jupiter', 'the amazon river', 'shakespeare', 'gravity', 'bitcoin', 'the olympics', 'tokyo', 'the human heart', 'electricity'];
const THINGS = ['buy milk', 'call mom', 'finish my homework', 'take out the trash', 'feed the dog', 'study for the test', 'charge my phone', 'go to practice'];
const CITIES = ['paris', 'dallas', 'new york', 'london', 'austin', 'tokyo', 'chicago', 'miami'];
const fill = (rnd, t) => t.replace(/\{app\}/g, () => pick(rnd, APPS)).replace(/\{n\}/g, () => pick(rnd, NUMS)).replace(/\{topic\}/g, () => pick(rnd, TOPICS)).replace(/\{thing\}/g, () => pick(rnd, THINGS)).replace(/\{city\}/g, () => pick(rnd, CITIES)).replace(/\{m\}/g, () => pick(rnd, ['5', '10', '15', '20', '30', 'two', 'ten', '45']));
const POLITE = ['', '', '', 'please ', 'can you ', 'could you ', 'jarvis ', 'hey jarvis ', 'jarvis can you ', 'i want you to ', 'go ahead and '];
const TAIL = ['', '', '', ' please', ' for me', ' now', ' jarvis', ' right now'];

const INTENTS = {
  time: ['what time is it', "what's the time", 'tell me the time', 'what time is it right now', 'do you know the time', 'current time', 'time please', 'what is the time now', 'whats the time jarvis', 'got the time'],
  date: ["what's the date", 'what day is it', "what's today's date", 'what is the date today', 'which day is it today', 'what month is it', 'what year is it', 'tell me the date', 'today is what day'],
  volume_set: ['set the volume to {n}', 'volume {n}', 'turn the volume to {n} percent', 'put the volume at {n}', 'change volume to {n}%', 'make the volume {n}', 'set volume {n} percent', 'volume to {n}', 'sound at {n} percent'],
  volume_up: ['turn it up', 'volume up', 'louder', 'turn the volume up', 'increase the volume', 'make it louder', 'raise the volume', 'turn up the sound', 'a bit louder', 'pump it up', 'crank it up'],
  volume_down: ['turn it down', 'volume down', 'quieter', 'turn the volume down', 'lower the volume', 'decrease the volume', 'make it quieter', 'turn down the sound', 'a bit quieter', 'too loud'],
  mute: ['mute', 'mute the sound', 'mute the volume', 'mute audio', 'silence', 'turn off the sound', 'mute my pc', 'kill the sound'],
  unmute: ['unmute', 'unmute the sound', 'turn the sound back on', 'unmute audio', 'sound on', 'unmute my pc'],
  play_pause: ['pause', 'pause the music', 'play', 'resume', 'play the music', 'resume the music', 'pause the song', 'stop the music', 'pause the video', 'play pause', 'hold the music', 'unpause', 'continue playing'],
  next: ['next song', 'skip', 'skip this song', 'next track', 'play the next song', 'skip it', 'next one', 'skip track', 'go to the next song'],
  previous: ['previous song', 'go back a song', 'last song', 'previous track', 'play the previous song', 'back one song', 'replay the last song'],
  brightness: ['set brightness to {n}', 'brightness {n}', 'make the screen brightness {n} percent', 'turn the brightness to {n}', 'screen brightness {n}', 'dim the screen to {n}', 'brightness at {n} percent'],
  open_app: ['open {app}', 'launch {app}', 'start {app}', 'open up {app}', 'run {app}', 'bring up {app}', 'fire up {app}', 'open the {app} app', 'can you open {app}', 'i need {app}', 'pull up {app}', 'load {app}'],
  close_app: ['close {app}', 'quit {app}', 'exit {app}', 'close the {app} app', 'shut {app}', 'kill {app}', 'get rid of {app}', 'close out of {app}'],
  weather: ["what's the weather", 'weather', 'how is the weather', 'is it going to rain', 'what is the weather in {city}', 'weather in {city}', 'do i need a jacket', 'how hot is it outside', "what's the forecast", 'is it cold outside', 'will it rain today', 'temperature outside'],
  news: ["what's the news", 'news', 'give me the news', 'any news today', 'headlines', "what's happening in the world", 'top stories', 'daily briefing', 'brief me', 'morning briefing'],
  system: ['system status', 'how is my pc doing', 'cpu usage', 'how much memory am i using', 'battery level', 'how much battery do i have', 'check my pc', 'system report', 'is my computer ok', 'ram usage', 'disk space'],
  timer: ['set a timer for {m} minutes', 'timer {m} minutes', 'start a {m} minute timer', 'countdown {m} minutes', 'set timer for {m} min', '{m} minute timer'],
  reminder: ['remind me to {thing} in {m} minutes', 'remind me in {m} minutes to {thing}', 'set a reminder to {thing}', 'reminder to {thing} in {m} minutes', "don't let me forget to {thing}", 'remind me to {thing}'],
  note: ['take a note {thing}', 'note that i need to {thing}', 'write down {thing}', 'make a note to {thing}', 'save a note {thing}', 'jot down {thing}', 'note {thing}'],
  todo: ['add {thing} to my to do list', 'add {thing} to my list', 'put {thing} on my to-do list', 'add {thing} to the groceries list', 'to do {thing}', 'add a todo {thing}'],
  calendar: ["what's on my calendar", 'what do i have today', 'any events today', 'what is my schedule', "what's coming up", 'my events', 'do i have anything planned', 'show my calendar'],
  reminders: ['what are my reminders', 'list my reminders', 'any reminders', 'show reminders', 'what did i ask you to remind me'],
  lock: ['lock my pc', 'lock the computer', 'lock screen', 'lock windows', 'lock it'],
  greet: ['hi', 'hello', 'hey', 'hey jarvis', 'good morning', 'good evening', 'yo', 'sup', 'hello jarvis', 'good afternoon', 'hi there', 'wake up'],
  thanks: ['thanks', 'thank you', 'thanks jarvis', 'cheers', 'appreciate it', 'nice job', 'good job', 'perfect thanks', 'awesome thank you', 'great work'],
  how_are_you: ['how are you', 'how are you doing', "how's it going", 'are you ok', 'how do you feel', 'what is up with you', 'you good'],
  who_are_you: ['who are you', 'what are you', 'what is your name', 'are you an ai', 'who made you', 'what can you do', 'introduce yourself', 'what model are you', 'which ai are you'],
  math: ['what is {n} plus {n}', 'what is {n} times {n}', '{n} divided by {n}', 'calculate {n} minus {n}', "what's {n} * {n}", '{n} + {n}', 'what is 17 times 23', 'what is 144 divided by 12', 'square root of 81', 'what is 15 percent of 80', 'what is 2 to the power of 10', '12 x 12'],
  question: ['what is {topic}', 'who is {topic}', 'tell me about {topic}', 'how tall is {topic}', 'when was {topic} built', 'where is {topic}', 'what are {topic}', 'who was {topic}', 'how big is {topic}', 'explain {topic} briefly', 'what does {topic} mean', 'how old is {topic}', 'how far away is {topic}', 'what is the capital of {city}', 'who invented {topic}', 'why is {topic} important', 'how does {topic} work', 'define {topic}', 'facts about {topic}', 'how many people live in {city}'],
  complex: ['write me an essay about {topic}', 'help me with my homework', 'plan my week', 'write a poem about {topic}', 'help me write an email to my teacher', 'summarize this document', 'compare {topic} and {topic}', 'write a story', 'debug my code', 'help me study for my test on {topic}', 'make a workout plan', 'give me ideas for a project', 'brainstorm names for my team', "what's on my screen", 'search my files for {topic}', 'take control of my screen', 'who won the game last night', 'what is the score of the game', 'send an email', 'book a flight', 'translate this to spanish', 'what did i say earlier', 'and what about tomorrow', 'do that again', 'shut down my pc', 'restart the computer', 'delete my downloads'],
};

// ---------- the network ----------
const D = 4096, H = 64;
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % D; }
function clean(t) { return String(t || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9%+*/.'\- ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function features(text) {
  const words = clean(text).split(' ').filter(Boolean), f = new Map();
  const add = (k, w) => { const i = hash(k); f.set(i, (f.get(i) || 0) + w); };
  words.forEach((w, i) => {
    add('w:' + w, 1);
    if (i) add('b:' + words[i - 1] + ' ' + w, 1);
    const p = `<${w}>`; for (let j = 0; j + 3 <= p.length; j++) add('c:' + p.slice(j, j + 3), 0.35);
  });
  if (words.length) add('first:' + words[0], 1);
  add('len:' + Math.min(words.length, 8), 0.5);
  const norm = Math.sqrt([...f.values()].reduce((s, v) => s + v * v, 0)) || 1;
  return [...f].map(([i, v]) => [i, v / norm]);
}
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

let net = null;
function train() {
  const rnd = mulberry(7), labels = Object.keys(INTENTS), K = labels.length, data = [];
  for (const [k, temps] of Object.entries(INTENTS)) {
    const reps = k === 'question' || k === 'complex' ? 14 : 10;
    for (const t of temps) for (let r = 0; r < reps; r++) {
      let s = fill(rnd, t);
      if (rnd() < 0.5) s = pick(rnd, POLITE) + s + pick(rnd, TAIL);
      if (rnd() < 0.15) s = s.replace(/\b(\w{4,})\b/, (w) => w.slice(0, -1)); // a dropped letter, like a voice slip
      data.push([features(s), labels.indexOf(k)]);
    }
  }
  const W1 = Array.from({ length: D }, () => Float32Array.from({ length: H }, () => (rnd() - 0.5) * 0.2));
  const b1 = new Float32Array(H), W2 = Array.from({ length: H }, () => Float32Array.from({ length: K }, () => (rnd() - 0.5) * 0.2)), b2 = new Float32Array(K);
  const model = { W1, b1, W2, b2, labels };
  for (let epoch = 0; epoch < 30; epoch++) {
    const lr = 0.12 * (1 - epoch / 34);
    for (let i = data.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [data[i], data[j]] = [data[j], data[i]]; }
    for (const [x, y] of data) {
      const { h, p } = forward(model, x);
      const dz = Float32Array.from(p, (v, k) => v - (k === y ? 1 : 0));
      const dh = new Float32Array(H);
      for (let j = 0; j < H; j++) { if (h[j] <= 0) continue; let s = 0; for (let k = 0; k < K; k++) { s += W2[j][k] * dz[k]; W2[j][k] -= lr * h[j] * dz[k]; } dh[j] = s; }
      for (let k = 0; k < K; k++) b2[k] -= lr * dz[k];
      for (const [i, v] of x) { const row = W1[i]; for (let j = 0; j < H; j++) row[j] -= lr * v * dh[j]; }
      for (let j = 0; j < H; j++) b1[j] -= lr * dh[j];
    }
  }
  return model;
}
function forward(m, x) {
  const h = Float32Array.from(m.b1);
  for (const [i, v] of x) { const row = m.W1[i]; for (let j = 0; j < H; j++) h[j] += row[j] * v; }
  for (let j = 0; j < H; j++) if (h[j] < 0) h[j] = 0;
  const z = Float32Array.from(m.b2);
  for (let j = 0; j < H; j++) if (h[j]) for (let k = 0; k < z.length; k++) z[k] += h[j] * m.W2[j][k];
  const mx = Math.max(...z), e = z.map((v) => Math.exp(v - mx)), s = e.reduce((a, b) => a + b, 0);
  return { h, p: e.map((v) => v / s) };
}
function classify(text) {
  net ||= train();
  const { p } = forward(net, features(text));
  const order = [...p.keys()].sort((a, b) => p[b] - p[a]);
  return { intent: net.labels[order[0]], confidence: p[order[0]], runnerUp: net.labels[order[1]], margin: p[order[0]] - p[order[1]] };
}

// ---------- slots ----------
const WORDNUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, 'twenty five': 25, thirty: 30, forty: 40, 'forty five': 45, fifty: 50, sixty: 60, seventy: 70, 'seventy five': 75, eighty: 80, ninety: 90, hundred: 100, 'a hundred': 100, 'one hundred': 100, half: 50 };
function number(t) {
  const d = t.match(/(\d+(?:\.\d+)?)/); if (d) return Number(d[1]);
  for (const [w, n] of Object.entries(WORDNUM).sort((a, b) => b[0].length - a[0].length)) if (new RegExp(`\\b${w}\\b`).test(t)) return n;
  return null;
}
const STRIP = /^(hey |ok |okay )?(jarvis[, ]+)?(please |can you |could you |would you |i want you to |go ahead and |i need you to )*/;
const tidy = (t) => clean(t).replace(STRIP, '').replace(/\b(please|for me|right now|now|jarvis)\b/g, '').replace(/\s+/g, ' ').trim();
function appName(t) { return tidy(t).replace(/^(open( up)?|launch|start( up)?|run|bring up|fire up|pull up|load|close( out of)?|quit|exit|shut|kill|get rid of|i need)\s+/, '').replace(/^(the|my)\s+/, '').replace(/\s+(app|application|program)$/, '').trim(); }
function minutes(t) {
  const m = t.match(/(\d+|[a-z]+(?: [a-z]+)?)\s*(minutes?|mins?|hours?|hrs?|seconds?|secs?)\b/); if (!m) return null;
  const n = number(m[1]); if (n == null) return null;
  return /^h/.test(m[2]) ? n * 60 : /^s/.test(m[2]) ? Math.max(1, Math.round(n / 60)) : n;
}

// ---------- maths (a tiny parser, never eval) ----------
function calc(text) {
  let t = clean(text).replace(/^(what is|what's|whats|calculate|compute|how much is|solve)\s+/, '').replace(/\?$/, '');
  let m = t.match(/^(?:the )?square root of (\d+(?:\.\d+)?)$/); if (m) return Math.sqrt(Number(m[1]));
  m = t.match(/^(\d+(?:\.\d+)?)\s*(?:%|percent) of (\d+(?:\.\d+)?)$/); if (m) return (Number(m[1]) / 100) * Number(m[2]);
  t = t.replace(/\bplus\b/g, '+').replace(/\bminus\b/g, '-').replace(/\b(times|multiplied by|x)\b/g, '*').replace(/×/g, '*').replace(/\b(divided by|over)\b/g, '/').replace(/÷/g, '/').replace(/\bto the power of\b/g, '^').replace(/\bsquared\b/g, '^2').replace(/\bcubed\b/g, '^3');
  if (!/^[\d\s.+\-*/^()]+$/.test(t) || !/\d\s*[-+*/^]\s*[\d(]/.test(t)) return null;
  const tok = t.match(/\d+(?:\.\d+)?|[-+*/^()]/g); let i = 0;
  const expr = () => { let v = term(); while (tok[i] === '+' || tok[i] === '-') { const o = tok[i++]; const r = term(); v = o === '+' ? v + r : v - r; } return v; };
  const term = () => { let v = pow(); while (tok[i] === '*' || tok[i] === '/') { const o = tok[i++]; const r = pow(); v = o === '*' ? v * r : v / r; } return v; };
  const pow = () => { const b = unary(); if (tok[i] === '^') { i++; return b ** pow(); } return b; };
  const unary = () => { if (tok[i] === '-') { i++; return -unary(); } if (tok[i] === '(') { i++; const v = expr(); i++; return v; } return Number(tok[i++]); };
  try { const v = expr(); return i === tok.length && Number.isFinite(v) ? v : null; } catch { return null; }
}
const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : Number(n.toPrecision(10)).toLocaleString('en-US', { maximumFractionDigits: 6 }));

// ---------- looking things up ----------
// Wikipedia asks apps to name themselves and link to the project
const UA = { 'user-agent': 'JarvisCore/1.0 (https://github.com/ALTAR1234/jarvis; personal desktop assistant)', 'api-user-agent': 'JarvisCore/1.0 (https://github.com/ALTAR1234/jarvis)' };
const STOP = new Set('a an the is are was were be of in on at to for and or what who whom whose when where why how which do does did tell me about please can you could explain define facts jarvis i my your it its this that with by from as than into briefly'.split(' '));
const keywords = (q) => clean(q).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
// What the question is about, for the search box: "how tall is the eiffel tower" -> "eiffel tower".
function subject(question) {
  return clean(question).replace(/\?$/, '')
    .replace(/^(jarvis )?(tell me about|facts about|define|explain|who (is|was|are|were)|what (is|are|was|were|does)|what's|whats|where (is|was|are)|when (was|is|did|were)|how (tall|high|big|large|far|old|long|many people live in|much|does|did|do)( is| was| are| were| away is)?|who (invented|discovered|founded|created|made|wrote|painted|built)|why (is|are|was|do|does))\s+/, '')
    .replace(/\b(built|born|founded|made|invented|located|from here|mean|work|important)$/, '').replace(/^(the|a|an) /, '').trim() || clean(question);
}
// What kind of fact the question wants, and what a sentence holding it looks like.
const WANTS = [
    // [question, a sentence holding the fact, words that make it the right fact]
    [/\bhow (tall|high)\b|\bheight\b/i, /\b\d[\d,.]*\s*(m|metres?|meters?|ft|feet|foot)\b/i, /\b(tall|height|high|elevation|summit)\b/i],
    [/\bhow (big|large)\b|\barea\b|\bsize\b/i, /\b\d[\d,.]*\s*(km2|km²|sq|square|acres?|hectares?|miles?|kilometres?|kilometers?)\b/i, /\b(area|largest|size|diameter|total)\b/i],
    [/\bhow (far|long is)\b|\bdistance\b/i, /\b\d[\d,.]*\s*(km|kilometres?|kilometers?|miles?|light[- ]years?|au)\b/i, /\b(distance|away|from)\b/i],
    [/\bhow old\b|\bage\b/i, /\b\d[\d.,]*\s*(billion|million|thousand)?\s*years?\s*(old|ago)\b|\baged? \d+|\bage of\b/i, /\b(formed|age|oldest|origin)\b/i],
    [/\bwhen was .* born\b/i, /\bborn\b/i],
    [/\bwhen\b|\bwhat year\b/i, /\b(1[0-9]{3}|20[0-9]{2})\b/],
    [/\bhow many people\b|\bpopulation\b/i, /\b(population|inhabitants|residents|people)\b.*\d|\d.*\b(population|inhabitants|residents|people)\b/i],
    [/\bwho (invented|discovered|founded|created|made)\b/i, /\b(invent(ed|or|ion)|discover(ed|er|y)|found(ed|er)|creat(ed|or)|credited|patent(ed)?|first to)\b/i],
];
const factPattern = (question) => WANTS.find(([q]) => q.test(question))?.[1];
const factHint = (question) => WANTS.find(([q]) => q.test(question))?.[2];
function bestSentences(question, text, max = 2) {
  // split at a full stop followed by a capital letter, so "3.2 billion" and "St. Louis" stay whole
  const keys = keywords(question), sents = String(text).replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z"'(])/).filter((s) => s.length > 15);
  const want = factPattern(question), hint = factHint(question);
  const scored = sents.map((s, i) => { const low = s.toLowerCase(); let score = 0; for (const k of keys) if (low.includes(k)) score += 1 + Math.min(k.length, 10) / 10; if (want?.test(s)) { score += 3; if (hint?.test(s)) score += 2; } return { s: s.trim(), i, score: score - i * 0.05 }; });
  if (want) max = 1; // a fact question: one sentence, the one with the fact
  const top = scored.sort((a, b) => b.score - a.score).slice(0, max).filter((x) => x.score > 0 || x.i === 0).sort((a, b) => a.i - b.i);
  return (top.length ? top : scored.slice(0, 1)).map((x) => x.s).join(' ');
}
async function getJson(url) { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(String(r.status)); return r.json(); }
// answers are kept for a day, so asking again costs nothing and doesn't hammer the sources
const cache = new Map();
async function lookUp(question) {
  const key = clean(question), hit = cache.get(key);
  if (hit && Date.now() - hit.at < 864e5) return hit.found;
  const found = await lookUpFresh(question);
  if (found) { cache.set(key, { at: Date.now(), found }); if (cache.size > 300) cache.delete(cache.keys().next().value); }
  return found;
}
async function lookUpFresh(question) {
  const q = clean(question).replace(/^(jarvis )?(tell me about|what is|what's|whats|who is|who was|what are|define|facts about|explain)\s+/, '').replace(/\?$/, '').trim() || question;
  try {
    const d = await getJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(question)}&format=json&no_html=1&skip_disambig=1`);
    const text = d.Answer || d.AbstractText || d.Definition;
    if (text && String(text).length > 20) return { answer: bestSentences(question, text, 2), source: d.AbstractSource || 'DuckDuckGo' };
  } catch {}
  try {
    const s = await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(subject(question))}&srlimit=1&format=json`);
    const title = s.query?.search?.[0]?.title; if (!title) return null;
    const text = async (intro) => Object.values((await getJson(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1${intro ? '&exintro=1' : ''}&redirects=1&titles=${encodeURIComponent(title)}&format=json`)).query?.pages || {})[0]?.extract || '';
    let body = await text(true);
    // the opening paragraphs answer most questions; a specific fact (an age, a distance) may be further down
    const want = factPattern(question);
    if (want && !want.test(body)) body = (await text(false)).split(/\n==+ ?(See also|References|Notes|External links) ?==+/)[0];
    if (body) return { answer: bestSentences(question, body.replace(/\n==+[^=]+==+\n?/g, ' '), 2), source: `Wikipedia (${title})` };
  } catch (e) { if (process.env.JARVIS_DEBUG) console.warn('lookup failed', e.message); }
  return null;
}

// ---------- replies ----------
const sir = (s) => s;
const said = (r) => r?.status === 'failed' ? `I'm afraid that didn't work, sir: ${r.error}` : r?.status === 'denied' ? 'Understood, sir, I left it alone.' : null;
const GREET = ['At your service, sir.', 'Hello, sir. What can I do for you?', 'Good to hear from you, sir.'];
const THANKS = ['My pleasure, sir.', 'Always, sir.', 'Happy to help, sir.'];
const pickNow = (a) => a[Math.floor(Math.random() * a.length)];

// Answer one request, or return null when a bigger brain should handle it.
async function reply(text, { execute, allowWeb = true } = {}) {
  const t = clean(text);
  if (!t || t.length > 220) return null;
  const c = classify(text);
  const sure = c.confidence >= 0.8 && c.margin >= 0.45;
  // maths is checked by parsing, not by the network alone
  const sum = calc(text);
  if (sum != null) return { text: `That's ${fmt(sum)}, sir.`, intent: 'math', confidence: 1 };
  if (!sure || c.intent === 'complex') return null;
  const run = async (name, args) => { const r = await execute(name, args); return { r, err: said(r) }; };
  const out = (s) => ({ text: s, intent: c.intent, confidence: c.confidence });
  switch (c.intent) {
    case 'time': return out(`It's ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}, sir.`);
    case 'date': return out(`Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, sir.`);
    case 'volume_set': { const n = number(t); if (n == null || n > 100) return null; const { r, err } = await run('set_volume', { level: n }); return out(err || `Volume set to ${r.level ?? n}%, sir.`); }
    case 'volume_up': case 'volume_down': { const { r, err } = await run('set_volume', { change: c.intent === 'volume_up' ? 10 : -10 }); return out(err || `Volume is at ${r.level}%, sir.`); }
    case 'mute': case 'unmute': { const { err } = await run('set_volume', { mute: c.intent === 'mute' }); return out(err || (c.intent === 'mute' ? 'Muted, sir.' : 'Sound is back on, sir.')); }
    case 'play_pause': case 'next': case 'previous': { const { err } = await run('media_control', { action: c.intent === 'play_pause' ? 'playpause' : c.intent }); return out(err || (c.intent === 'play_pause' ? 'Done, sir.' : c.intent === 'next' ? 'Skipping ahead, sir.' : 'Going back one, sir.')); }
    case 'brightness': { const n = number(t); if (n == null || n > 100) return null; const { err } = await run('set_brightness', { level: n }); return out(err || `Brightness set to ${n}%, sir.`); }
    case 'open_app': { const name = appName(text); if (!name || name.split(' ').length > 4) return null; const { err } = await run('open_app', { name }); return out(err || `Opening ${name}, sir.`); }
    case 'close_app': { const name = appName(text); if (!name || name.split(' ').length > 4) return null; const { err } = await run('close_app', { name }); return out(err || `${name[0].toUpperCase() + name.slice(1)} is closed, sir.`); }
    case 'weather': {
      const city = t.match(/\bin ([a-z .]+?)(?: today| tomorrow| right now)?$/)?.[1];
      const { r, err } = await run('get_weather', city ? { city } : {}); if (err) return out(err);
      const w = r.current || r.weather || r; const place = r.place || r.city || city || 'outside';
      const temp = w.temperature ?? w.temp ?? w.tempF; const desc = w.description || w.summary || w.conditions || '';
      return temp != null ? out(`It's ${Math.round(temp)}°${r.unit || 'F'}${desc ? ' and ' + String(desc).toLowerCase() : ''} in ${place}, sir.`) : null;
    }
    case 'news': return null; // headlines read best from the full briefing brain
    case 'system': {
      const { r, err } = await run('system_status', {}); if (err) return out(err);
      const bits = [r.cpu?.percent != null && `CPU at ${Math.round(r.cpu.percent)}%`, r.memory?.percent != null && `memory at ${Math.round(r.memory.percent)}%`, r.battery?.percent != null && `battery at ${r.battery.percent}%${r.battery.charging ? ' and charging' : ''}`].filter(Boolean);
      return bits.length ? out(`All systems nominal, sir: ${bits.join(', ')}.`) : null;
    }
    case 'timer': { const m = minutes(t); if (!m) return null; const { err } = await run('set_reminder', { text: `Your ${m} minute timer is done`, minutes: m }); return out(err || `Timer set for ${m} minute${m === 1 ? '' : 's'}, sir.`); }
    case 'reminder': {
      const m = minutes(t); const what = t.replace(/\bin \S+ (minutes?|mins?|hours?|hrs?)\b/, '').match(/\b(?:to|about) (.+)$/)?.[1]?.trim();
      if (!m || !what) return null; // no time given: let the bigger brain ask when
      const { err } = await run('set_reminder', { text: what, minutes: m }); return out(err || `I'll remind you to ${what} in ${m} minute${m === 1 ? '' : 's'}, sir.`);
    }
    case 'note': { const body = tidy(text).replace(/^(take a note|make a note( to)?|save a note|note that|write down|jot down|note)\s*(that\s+)?/, '').trim(); if (body.length < 3) return null; const { err } = await run('add_note', { text: body }); return out(err || 'Noted, sir.'); }
    case 'todo': {
      const m = tidy(text).match(/^(?:add|put)(?: a todo)? (.+?) (?:to|on) (?:my |the )?(.+?) list$/) || tidy(text).match(/^(?:to do|add a todo) (.+)$/);
      if (!m) return null; const list = m[2] && !/^to[- ]?do$/.test(m[2]) ? m[2].replace(/\b\w/g, (x) => x.toUpperCase()) : undefined;
      const { err } = await run('add_todo', { item: m[1], ...(list ? { list } : {}) }); return out(err || `Added ${m[1]} to your ${list || 'to-do'} list, sir.`);
    }
    case 'calendar': {
      const { r, err } = await run('list_events', {}); if (err) return out(err);
      const ev = (r.events || []).slice(0, 3); if (!ev.length) return out('Your calendar is clear, sir.');
      return out(`Coming up, sir: ${ev.map((e) => `${e.title}${e.date ? ' on ' + new Date(e.date + 'T12:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : ''}${e.time ? ' at ' + e.time : ''}`).join('; ')}.`);
    }
    case 'reminders': {
      const { r, err } = await run('list_reminders', {}); if (err) return out(err);
      const list = (r.reminders || []).slice(0, 4); return out(list.length ? `You have ${list.length === 1 ? 'one reminder' : list.length + ' reminders'}, sir: ${list.map((x) => `${x.text} at ${new Date(x.due).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`).join('; ')}.` : 'No reminders pending, sir.');
    }
    case 'lock': { const { err } = await run('power_action', { action: 'lock' }); return out(err || 'Locking up, sir.'); }
    case 'greet': return out(pickNow(GREET));
    case 'thanks': return out(pickNow(THANKS));
    case 'how_are_you': return out('All systems running smoothly, sir. How can I help?');
    case 'who_are_you': return out("I'm J.A.R.V.I.S., sir, running on Jarvis Core: an AI built just for this PC. I handle everyday commands myself, look up general questions on the web, and call in a bigger brain for anything harder.");
    case 'question': {
      if (!allowWeb) return null;
      const found = await lookUp(text); if (!found?.answer) return null;
      return out(`${found.answer.trim()} (Source: ${found.source}.)`);
    }
  }
  return null;
}

// how well the network understands phrasings it never saw while training
function selfTest(cases) { return cases.map(([text, want]) => { const c = classify(text); return { text, want, got: c.intent, conf: Number(c.confidence.toFixed(2)), ok: c.intent === want }; }); }

module.exports = { reply, classify, calc, lookUp, bestSentences, selfTest, warm: () => { net ||= train(); return net.labels.length; } };
