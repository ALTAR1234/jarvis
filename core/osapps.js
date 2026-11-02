// The J.A.R.V.I.S. OS apps' back end: Notifier (one notification center), Locker (PIN lock),
// Planner (calendar), Noter (notes and to-dos), Filer (files), Keeper (backups), Shopper
// (plugin store) and Updater (updates every app from its GitHub repo).
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const osx = require('./os');
const store = require('./store');

let deps = null; // { dataDir, askJson, prefs(), setPrefs(patch), tools, control(dir, action, extra) }
function init(d) { deps = d; startWatchers(); }
const file = (name) => path.join(deps.dataDir, name);
const load = (name, fallback) => { try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; } };
const save = (name, v) => fs.writeFileSync(file(name), JSON.stringify(v, null, 2));
const id = () => crypto.randomUUID();

// ======================= Notifier =======================
function notifications() { return load('notifications.json', []); }
function notify({ app, title, body = '', quiet = false }) {
  const list = notifications();
  const n = { id: id(), app: String(app || 'J.A.R.V.I.S.'), title: String(title).slice(0, 160), body: String(body).slice(0, 400), at: Date.now(), read: false };
  list.unshift(n);
  save('notifications.json', list.slice(0, 300));
  store.emit('notification', n);
  if (!quiet && !deps.prefs().dnd) osx.notify(`${n.app}: ${n.title}`, n.body);
  return n;
}
function markRead(which) {
  const list = notifications().map((n) => (which === 'all' || n.id === which ? { ...n, read: true } : n));
  save('notifications.json', list);
}
function clearNotifications() { save('notifications.json', []); }
// watch the other apps: new Socialer messages, and what Listener starts playing
let lastUnread = null, lastSong = '';
function startWatchers() {
  setInterval(async () => {
    try {
      const s = await deps.control('Socialer', 'status');
      if (lastUnread !== null && s.unread > lastUnread) for (const c of (s.chats || []).slice(0, 3)) notify({ app: 'Socialer', title: c.chat, body: c.last });
      lastUnread = s.unread;
    } catch { lastUnread = null; }
    try {
      const now = await deps.control('aurora-music', 'now');
      const song = now?.playing ? `${now.title}${now.artist ? ' · ' + now.artist : ''}` : '';
      if (song && song !== lastSong) notify({ app: 'Listener', title: 'Now playing', body: song, quiet: true });
      lastSong = song;
    } catch {}
  }, 45000);
}

// ======================= Locker =======================
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
let tries = 0, coolUntil = 0;
function lockState() { const l = load('locker.json', {}); return { hasPin: Boolean(l.hash) }; }
function setPin(oldPin, newPin) {
  const l = load('locker.json', {});
  if (l.hash && hashPin(oldPin, l.salt) !== l.hash) throw new Error('The current PIN is wrong.');
  if (newPin === '' || newPin == null) { save('locker.json', {}); return { hasPin: false }; }
  if (!/^\d{4,8}$/.test(String(newPin))) throw new Error('Use a PIN of 4 to 8 digits.');
  const salt = crypto.randomBytes(16).toString('hex');
  save('locker.json', { salt, hash: hashPin(newPin, salt) });
  return { hasPin: true };
}
function checkPin(pin) {
  const l = load('locker.json', {});
  if (!l.hash) return true;
  if (Date.now() < coolUntil) throw new Error(`Too many tries. Wait ${Math.ceil((coolUntil - Date.now()) / 1000)} seconds.`);
  const ok = crypto.timingSafeEqual(Buffer.from(hashPin(pin, l.salt), 'hex'), Buffer.from(l.hash, 'hex'));
  if (ok) { tries = 0; return true; }
  if (++tries >= 5) { coolUntil = Date.now() + 30000; tries = 0; }
  return false;
}

// ======================= Planner =======================
function events() { return load('planner.json', []); }
function addEvent({ title, date, time = '', notes = '', remind = 15 }) {
  if (!String(title || '').trim()) throw new Error('What is the event called?');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('Give the date as YYYY-MM-DD.');
  if (time && !/^\d{2}:\d{2}$/.test(String(time))) throw new Error('Give the time as HH:MM.');
  const ev = { id: id(), title: String(title).slice(0, 120), date, time, notes: String(notes).slice(0, 1000), reminderId: null };
  if (time && Number.isFinite(Number(remind)) && remind >= 0) {
    const at = new Date(`${date}T${time}`);
    at.setMinutes(at.getMinutes() - Number(remind));
    if (at > new Date()) try { ev.reminderId = store.addReminder({ text: `${ev.title} at ${time}`, time: at.toISOString() }).id; } catch {}
  }
  const list = events();
  list.push(ev);
  save('planner.json', list);
  return ev;
}
function deleteEvent(eid) {
  const list = events(), ev = list.find((e) => e.id === eid);
  if (ev?.reminderId) try { store.cancelReminder(ev.reminderId); } catch {}
  save('planner.json', list.filter((e) => e.id !== eid));
}
async function parseEvent(text) {
  const today = new Date();
  const out = await deps.askJson([{ text: `Turn this into a calendar event. Today is ${today.toDateString()} (${today.toISOString().slice(0, 10)}).
Text: "${String(text).slice(0, 400)}"
Return JSON {"title": "...", "date": "YYYY-MM-DD", "time": "HH:MM" or "" if no time, "notes": ""}. Resolve words like "Thursday" or "tomorrow" to the next such date.` }]);
  return addEvent(out);
}

// ======================= Noter =======================
function notes() { return load('notes.json', []).sort((a, b) => (b.pinned - a.pinned) || b.updated - a.updated); }
function saveNote(n) {
  const list = load('notes.json', []);
  const note = { id: n.id || id(), title: String(n.title || '').slice(0, 120), body: String(n.body || '').slice(0, 20000), todos: (Array.isArray(n.todos) ? n.todos : []).slice(0, 200).map((t) => ({ text: String(t.text || '').slice(0, 300), done: !!t.done })), pinned: !!n.pinned, color: String(n.color || '').slice(0, 20), updated: Date.now() };
  const i = list.findIndex((x) => x.id === note.id);
  if (i >= 0) list[i] = note; else list.unshift(note);
  save('notes.json', list);
  return note;
}
function deleteNote(nid) { save('notes.json', load('notes.json', []).filter((n) => n.id !== nid)); }
function addTodo(text, listName = 'To-do') {
  const list = load('notes.json', []);
  let note = list.find((n) => n.title.toLowerCase() === String(listName).toLowerCase());
  if (!note) note = { title: listName, body: '', todos: [] };
  note.todos = [...(note.todos || []), { text, done: false }];
  return saveNote(note);
}

// ======================= Filer =======================
const PLACES = () => ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'].map((k) => ({ name: k[0].toUpperCase() + k.slice(1), path: osx.knownFolder(k) })).filter((p) => p.path && fs.existsSync(p.path)).concat([{ name: 'Home', path: os.homedir() }]);
const KIND = (ext) => (/^(png|jpe?g|gif|webp|bmp|heic)$/.test(ext) ? 'image' : /^(mp4|mov|mkv|webm|avi)$/.test(ext) ? 'video' : /^(mp3|wav|flac|m4a|ogg)$/.test(ext) ? 'audio' : /^(pdf)$/.test(ext) ? 'pdf' : /^(docx?|txt|md|rtf|odt)$/.test(ext) ? 'doc' : /^(xlsx?|csv)$/.test(ext) ? 'sheet' : /^(pptx?)$/.test(ext) ? 'slides' : /^(zip|rar|7z)$/.test(ext) ? 'archive' : /^(js|ts|py|html|css|json|cjs|mjs|java|c|cpp|cs)$/.test(ext) ? 'code' : 'file');
async function entry(full, name) {
  try {
    const st = await fsp.stat(full);
    const ext = path.extname(name).slice(1).toLowerCase();
    return { name, path: full, dir: st.isDirectory(), size: st.size, modified: st.mtimeMs, kind: st.isDirectory() ? 'folder' : KIND(ext) };
  } catch { return null; }
}
async function listDir(dir) {
  const target = dir ? path.resolve(dir) : null;
  if (!target) return { path: '', places: PLACES(), items: [] };
  const names = (await fsp.readdir(target)).filter((n) => !/^(desktop\.ini|thumbs\.db|\$recycle\.bin)$/i.test(n) && !n.startsWith('~$'));
  const items = (await Promise.all(names.slice(0, 2000).map((n) => entry(path.join(target, n), n)))).filter(Boolean).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
  return { path: target, parent: path.dirname(target) !== target ? path.dirname(target) : null, places: PLACES(), items };
}
async function search({ q = '', root, exts = [], days = 0, limit = 200 }) {
  const roots = root ? [path.resolve(root)] : PLACES().filter((p) => p.name !== 'Home').map((p) => p.path);
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const since = days > 0 ? Date.now() - days * 86400000 : 0;
  const out = [];
  const walk = async (dir, depth) => {
    if (out.length >= limit || depth > 6) return;
    let names = [];
    try { names = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      if (out.length >= limit) return;
      if (/^(node_modules|\.git|appdata|\$recycle\.bin)$/i.test(d.name)) continue;
      const full = path.join(dir, d.name), lower = d.name.toLowerCase();
      const ext = path.extname(lower).slice(1);
      const nameOk = words.every((w) => lower.includes(w)), extOk = !exts.length || exts.includes(ext);
      if (nameOk && extOk && (words.length || exts.length || since)) {
        const e = await entry(full, d.name);
        if (e && (!since || e.modified >= since)) out.push(e);
      }
      if (d.isDirectory()) await walk(full, depth + 1);
    }
  };
  for (const r of roots) await walk(r, 0);
  return out.sort((a, b) => b.modified - a.modified);
}
async function smartSearch(text) {
  const f = await deps.askJson([{ text: `Turn this file search into filters. Request: "${String(text).slice(0, 300)}"
Return JSON {"keywords": "words that would be in the file name (or empty)", "extensions": ["pdf", ...] or [], "days": number of days back to look (0 = any time), "folder": "desktop|documents|downloads|pictures|music|videos|" }.` }]);
  const root = f.folder ? osx.knownFolder(f.folder) : null;
  const results = await search({ q: f.keywords || '', root, exts: (f.extensions || []).map((e) => String(e).toLowerCase().replace(/^\./, '')), days: Number(f.days) || 0 });
  return { filters: f, results };
}

// ======================= Keeper =======================
const backupDir = () => path.join(osx.knownFolder('documents') || os.homedir(), 'Jarvis Backups');
const APPDATA = process.env.APPDATA || '';
// what goes in a backup: each app's own settings files (never .env keys or sign-in cookies), Jarvis's
// memory, notes, plans and homework, Petter's progress, and the beats you saved in Beater
function sources() {
  const appJson = (dir) => ({ from: path.join(APPDATA, dir), only: /\.json$/i, skip: /^(control|Preferences|Local State)\.json$|^Cookies/i, as: `apps/${dir}` });
  return [
    { from: deps.dataDir, only: /\.json$/i, skip: /^$/, as: 'jarvis/assistant' },
    { from: path.dirname(process.env.ASSISTANT_PREFERENCES_PATH || ''), only: /^preferences\.json$/i, skip: /^$/, as: 'jarvis/config' },
    appJson('Weber'), appJson('aurora-music'), appJson('nexus-games'), appJson('Streamer'), appJson('Petter'), appJson('Beater'), appJson('Socialer'),
    { from: path.join(osx.knownFolder('music') || '', 'Beater'), only: /\.wav$/i, skip: /^$/, as: 'beats' },
  ].filter((s) => s.from && fs.existsSync(s.from));
}
function ps(script) {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err.split('\n')[0] || 'PowerShell failed'))));
  });
}
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
async function backup() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const stage = path.join(os.tmpdir(), `jarvis-backup-${stamp}`);
  await fsp.rm(stage, { recursive: true, force: true });
  const manifest = { made: new Date().toISOString(), host: os.hostname(), files: [] };
  for (const s of sources()) {
    for (const name of await fsp.readdir(s.from).catch(() => [])) {
      if (!s.only.test(name) || s.skip.test(name)) continue;
      const src = path.join(s.from, name);
      if (!(await fsp.stat(src)).isFile()) continue;
      const rel = `${s.as}/${name}`;
      await fsp.mkdir(path.join(stage, s.as), { recursive: true });
      await fsp.copyFile(src, path.join(stage, rel));
      manifest.files.push({ rel, to: src });
    }
  }
  await fsp.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await fsp.mkdir(backupDir(), { recursive: true });
  const zip = path.join(backupDir(), `Jarvis backup ${stamp}.zip`);
  await ps(`Compress-Archive -Path ${psq(path.join(stage, '*'))} -DestinationPath ${psq(zip)} -Force`);
  await fsp.rm(stage, { recursive: true, force: true });
  const all = await backups();
  for (const old of all.slice(10)) await fsp.rm(old.path, { force: true }); // keep the newest 10
  deps.setPrefs({ lastBackupAt: Date.now() });
  notify({ app: 'Keeper', title: 'Backup finished', body: `${manifest.files.length} files saved`, quiet: true });
  return { file: zip, files: manifest.files.length };
}
async function backups() {
  const dir = backupDir();
  const names = (await fsp.readdir(dir).catch(() => [])).filter((n) => /^Jarvis backup .*\.zip$/.test(n));
  const list = await Promise.all(names.map(async (n) => { const st = await fsp.stat(path.join(dir, n)); return { name: n, path: path.join(dir, n), size: st.size, at: st.mtimeMs }; }));
  return list.sort((a, b) => b.at - a.at);
}
async function restore(name) {
  const zip = path.join(backupDir(), path.basename(String(name)));
  if (!fs.existsSync(zip)) throw new Error('That backup is gone.');
  const stage = path.join(os.tmpdir(), `jarvis-restore-${Date.now()}`);
  await ps(`Expand-Archive -Path ${psq(zip)} -DestinationPath ${psq(stage)} -Force`);
  const manifest = JSON.parse(await fsp.readFile(path.join(stage, 'manifest.json'), 'utf8'));
  let n = 0;
  for (const f of manifest.files) {
    const src = path.join(stage, f.rel);
    if (!fs.existsSync(src) || !f.to) continue;
    await fsp.mkdir(path.dirname(f.to), { recursive: true });
    await fsp.copyFile(src, f.to);
    n++;
  }
  await fsp.rm(stage, { recursive: true, force: true });
  return { restored: n, note: 'Restart J.A.R.V.I.S. and your apps to load what was restored.' };
}
setInterval(() => { // a daily backup while J.A.R.V.I.S. is running
  if (!deps) return;
  const p = deps.prefs();
  if (p.backupDaily && Date.now() - (p.lastBackupAt || 0) > 24 * 3600000) backup().catch(() => {});
}, 3600000);

// ======================= Shopper =======================
const CATALOG = 'https://api.github.com/repos/ALTAR1234/jarvis-plugins/contents';
function installed() {
  const dir = deps.tools.pluginDirectory();
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.js(\.off)?$/.test(f) && !f.startsWith('_')) : [];
  const live = deps.tools.list().filter((t) => t.plugin);
  return files.map((f) => ({ file: f.replace(/\.off$/, ''), on: !f.endsWith('.off'), tools: live.filter((t) => t.plugin === f).map((t) => ({ name: t.name, description: t.description })) }));
}
function togglePlugin(name, on) {
  const dir = deps.tools.pluginDirectory(), base = path.basename(String(name)).replace(/\.off$/, '');
  if (!/^[\w-]+\.js$/.test(base)) throw new Error('Not a plugin file.');
  const a = path.join(dir, base), b = a + '.off';
  if (on && fs.existsSync(b)) fs.renameSync(b, a);
  if (!on && fs.existsSync(a)) fs.renameSync(a, b);
  return deps.tools.loadPlugins();
}
async function catalog() {
  const r = await fetch(CATALOG, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'jarvis-shopper' } });
  if (!r.ok) throw new Error(`The plugin catalog is not reachable (${r.status}).`);
  const have = new Set(installed().map((p) => p.file));
  return (await r.json()).filter((f) => f.type === 'file' && /^[\w-]+\.js$/.test(f.name)).map((f) => ({ file: f.name, size: f.size, url: f.download_url, installed: have.has(f.name) }));
}
async function installPlugin(name) {
  const item = (await catalog()).find((f) => f.file === name);
  if (!item || !/^https:\/\/raw\.githubusercontent\.com\/ALTAR1234\/jarvis-plugins\//.test(item.url)) throw new Error('That plugin is not in the catalog.');
  const r = await fetch(item.url);
  if (!r.ok) throw new Error('Could not download the plugin.');
  const code = await r.text();
  fs.writeFileSync(path.join(deps.tools.pluginDirectory(), item.file), code);
  return deps.tools.loadPlugins();
}
function removePlugin(name) {
  const dir = deps.tools.pluginDirectory(), base = path.basename(String(name)).replace(/\.off$/, '');
  if (!/^[\w-]+\.js$/.test(base)) throw new Error('Not a plugin file.');
  for (const f of [base, base + '.off']) fs.rmSync(path.join(dir, f), { force: true });
  return deps.tools.loadPlugins();
}

// ======================= Updater =======================
const CODE = path.join(os.homedir(), 'OneDrive', 'Desktop', 'AIReason');
const APPS = [
  { name: 'J.A.R.V.I.S.', dir: path.join(os.homedir(), 'Jarvis'), script: 'rebuild-jarvis.ps1' },
  { name: 'Weber', dir: path.join(CODE, 'weber'), script: 'redeploy.ps1' },
  { name: 'Listener', dir: path.join(CODE, 'aurora-music') },
  { name: 'Gamer', dir: path.join(CODE, 'nexus') },
  { name: 'Streamer', dir: path.join(CODE, 'streamer-tv') },
  { name: 'Socialer', dir: path.join(CODE, 'socialer'), script: 'desktop/install.ps1' },
  { name: 'Beater', dir: path.join(CODE, 'beater'), script: 'install.ps1' },
  { name: 'Petter', dir: path.join(CODE, 'petter'), script: 'install.ps1' },
].filter((a) => fs.existsSync(path.join(a.dir, '.git')));
function git(dir, args) {
  return new Promise((resolve) => {
    const p = spawn('git', ['-C', dir, ...args], { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', () => resolve({ code: 1, out: '', err: 'git is not installed' }));
    p.on('exit', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}
async function updates() {
  return Promise.all(APPS.map(async (a) => {
    const fetched = await git(a.dir, ['fetch', '--quiet']);
    const behind = await git(a.dir, ['rev-list', '--count', 'HEAD..@{u}']);
    const dirty = await git(a.dir, ['status', '--porcelain']);
    const last = await git(a.dir, ['log', '-1', '--format=%cr · %s']);
    return { name: a.name, behind: Number(behind.out) || 0, changed: dirty.out ? dirty.out.split('\n').length : 0, last: last.out, canRebuild: Boolean(a.script), error: fetched.code ? fetched.err.split('\n')[0] : null };
  }));
}
async function update(name) {
  const a = APPS.find((x) => x.name === name);
  if (!a) throw new Error('Unknown app.');
  const pull = await git(a.dir, ['pull', '--ff-only']);
  if (pull.code) throw new Error(`Could not update ${a.name}: ${pull.err.split('\n')[0]}`);
  if (a.script && fs.existsSync(path.join(a.dir, a.script))) {
    // the rebuild runs in its own window so you can watch it (J.A.R.V.I.S.'s own rebuild restarts it)
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${psq(path.join(a.dir, a.script))}`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return { pulled: pull.out, rebuilding: true };
  }
  return { pulled: pull.out, rebuilding: false, note: `${a.name} has no install script yet; its code is updated.` };
}

module.exports = {
  init, notify, notifications, markRead, clearNotifications,
  lockState, setPin, checkPin,
  events, addEvent, deleteEvent, parseEvent,
  notes, saveNote, deleteNote, addTodo,
  listDir, search, smartSearch, PLACES,
  backup, backups, restore,
  installed, togglePlugin, catalog, installPlugin, removePlugin,
  updates, update,
};
