// File tools with guard rails: protected system locations, a Jarvis trash folder instead of
// permanent deletion, and an undo stack for moves, creations, overwrites, and deletions.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { knownFolder } = require('./os');

const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.html', '.css', '.xml', '.yml', '.yaml', '.ini', '.cfg', '.log', '.bat', '.ps1', '.sh', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.rb', '.php', '.sql', '.toml', '.env.example']);
const DOC_MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const SKIP_DIRS = new Set(['node_modules', '.git', 'AppData', '$Recycle.Bin', 'System Volume Information', '.cache', '.vscode', '__pycache__', 'venv', '.venv']);

let dataDir = path.join(os.tmpdir(), 'jarvis');
const undoStack = [];
function init(dir) { dataDir = dir; fs.mkdirSync(path.join(dataDir, 'trash'), { recursive: true }); }
const trashDir = () => path.join(dataDir, 'trash');

function resolvePath(input) {
  let p = String(input || '').trim().replace(/^["']|["']$/g, '');
  if (!p) throw new Error('No path given.');
  p = p.replace(/%([^%]+)%/g, (m, v) => process.env[v] ?? m);
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  const first = p.split(/[\\/]/)[0];
  const known = !path.isAbsolute(p) && knownFolder(first);
  if (known) p = path.join(known, p.slice(first.length));
  if (!path.isAbsolute(p)) p = path.join(os.homedir(), p);
  return path.normalize(p);
}
function isProtected(p) {
  const n = path.normalize(p).toLowerCase().replace(/[\\/]+$/, '');
  const sys = [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData, path.dirname(process.execPath), dataDir]
    .filter(Boolean).map((d) => path.normalize(d).toLowerCase());
  if (/^[a-z]:$/.test(n) || n === path.normalize(os.homedir()).toLowerCase()) return true;
  return sys.some((d) => n === d || n.startsWith(d + path.sep));
}
function guardWrite(p) { if (isProtected(p)) throw new Error(`${p} is a protected location; J.A.R.V.I.S. will not modify it.`); }
function isSecret(p) { return /(^|[\\/])\.env$/i.test(p) || path.normalize(p).toLowerCase().startsWith(path.normalize(dataDir).toLowerCase() + path.sep + 'preferences'); }

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }
// Not-found errors carry near-miss names from the same folder (speech often mangles punctuation).
function notFound(p) {
  const norm = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, ''), want = norm(path.basename(p));
  let suggestions = [];
  try {
    suggestions = fs.readdirSync(path.dirname(p)).map((n) => ({ n, s: norm(n) === want ? 3 : norm(n).includes(want) || want.includes(norm(n)) ? 2 : want.slice(0, 5) && norm(n).startsWith(want.slice(0, 5)) ? 1 : 0 }))
      .filter((x) => x.s).sort((a, b) => b.s - a.s).slice(0, 5).map((x) => path.join(path.dirname(p), x.n));
  } catch {}
  return Object.assign(new Error(`${p} does not exist.${suggestions.length ? ' Similar: ' + suggestions.map((s) => path.basename(s)).join(', ') : ''}`), { suggestions });
}
async function mustExist(p) { if (!(await exists(p))) throw notFound(p); }
function info(p, st) { return { path: p, type: st.isDirectory() ? 'folder' : 'file', sizeKB: st.isDirectory() ? undefined : Math.ceil(st.size / 1024), modified: st.mtime.toISOString().slice(0, 16).replace('T', ' ') }; }

async function listFolder(input) {
  const dir = resolvePath(input || 'home');
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries.slice(0, 300)) {
    if (e.name.startsWith('.') || e.name === 'desktop.ini') continue;
    try { const st = await fsp.stat(path.join(dir, e.name)); out.push({ name: e.name, ...info(path.join(dir, e.name), st), path: undefined }); } catch {}
  }
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
  return { folder: dir, count: entries.length, entries: out.slice(0, 200) };
}

async function searchFiles(query, folder) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) throw new Error('No search text given.');
  const ext = q.match(/^\*?(\.[a-z0-9]+)$/)?.[1];
  const tokens = ext ? [] : q.replace(/\*/g, ' ').split(/\s+/).filter(Boolean);
  const roots = folder ? [resolvePath(folder)] : ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'].map(knownFolder).filter((d) => d && fs.existsSync(d));
  const results = [], queue = roots.map((r) => [r, 0]), deadline = Date.now() + 4000;
  let visited = 0;
  while (queue.length && visited < 60000 && Date.now() < deadline && results.length < 200) {
    const [dir, depth] = queue.shift();
    let entries; try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      visited++;
      const full = path.join(dir, e.name), name = e.name.toLowerCase();
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.') && depth < 8) queue.push([full, depth + 1]); }
      if (ext ? name.endsWith(ext) : tokens.every((t) => name.includes(t))) results.push(full);
    }
  }
  const detailed = [];
  for (const p of results) { try { detailed.push(info(p, await fsp.stat(p))); } catch {} }
  detailed.sort((a, b) => b.modified.localeCompare(a.modified));
  return { query, searched: roots, results: detailed.slice(0, 30), truncated: Date.now() >= deadline || visited >= 60000 };
}

async function readFile(input, question, describe) {
  const p = resolvePath(input);
  if (isSecret(p)) throw new Error('That file holds private configuration and is not readable by the assistant.');
  await mustExist(p);
  const st = await fsp.stat(p);
  if (st.isDirectory()) return listFolder(p);
  const ext = path.extname(p).toLowerCase();
  if (DOC_MIME[ext]) {
    if (st.size > 15 * 1024 * 1024) throw new Error('That document is larger than 15 MB.');
    const text = await describe(await fsp.readFile(p), DOC_MIME[ext], question || 'Extract the key content of this document as plain text. Summarise if it is long.');
    return { path: p, kind: ext.slice(1), content: text };
  }
  const buf = await fsp.readFile(p);
  if (!TEXT_EXT.has(ext) && buf.subarray(0, 4096).includes(0)) throw new Error(`${path.basename(p)} is a binary file; only text, PDF, and image files can be read.`);
  const text = buf.toString('utf8');
  return { path: p, sizeKB: Math.ceil(st.size / 1024), content: text.slice(0, 60000), truncated: text.length > 60000 };
}

async function writeFile(input, content, mode = 'create') {
  const p = resolvePath(input); guardWrite(p);
  const already = await exists(p);
  if (already && mode === 'create') throw new Error(`${p} already exists. Use mode "overwrite" or "append".`);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  let backup = null;
  if (already && mode === 'overwrite') { backup = path.join(trashDir(), `${Date.now()}-${path.basename(p)}`); await fsp.copyFile(p, backup); }
  if (mode === 'append') await fsp.appendFile(p, String(content));
  else await fsp.writeFile(p, String(content));
  undoStack.push(already ? (mode === 'overwrite' ? { kind: 'restore', path: p, backup } : { kind: 'unappend', path: p, size: (await fsp.stat(p)).size - Buffer.byteLength(String(content)) }) : { kind: 'remove', path: p });
  return { path: p, written: Buffer.byteLength(String(content)), mode: already ? mode : 'created' };
}
const willOverwrite = async (input, mode) => mode === 'overwrite' && (await exists(resolvePath(input)));

async function createFolder(input) {
  const p = resolvePath(input); guardWrite(p);
  if (await exists(p)) return { path: p, note: 'Folder already existed.' };
  await fsp.mkdir(p, { recursive: true }); undoStack.push({ kind: 'rmdir', path: p });
  return { path: p };
}

async function moveFile(from, to, copy = false) {
  const src = resolvePath(from); let dest = resolvePath(to);
  if (!copy) guardWrite(src);
  guardWrite(dest);
  await mustExist(src);
  if ((await exists(dest)) && (await fsp.stat(dest)).isDirectory()) dest = path.join(dest, path.basename(src));
  if (await exists(dest)) throw new Error(`${dest} already exists; choose another name.`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  if (copy) { await fsp.cp(src, dest, { recursive: true }); undoStack.push({ kind: 'remove', path: dest }); }
  else { try { await fsp.rename(src, dest); } catch { await fsp.cp(src, dest, { recursive: true }); await fsp.rm(src, { recursive: true }); } undoStack.push({ kind: 'move', from: dest, to: src }); }
  return { from: src, to: dest, copied: copy };
}

async function deleteFile(input) {
  const p = resolvePath(input); guardWrite(p);
  await mustExist(p);
  const dest = path.join(trashDir(), `${Date.now()}-${path.basename(p)}`);
  try { await fsp.rename(p, dest); } catch { await fsp.cp(p, dest, { recursive: true }); await fsp.rm(p, { recursive: true }); }
  undoStack.push({ kind: 'move', from: dest, to: p });
  return { deleted: p, recoverable: true, trash: dest };
}

async function undo() {
  const op = undoStack.pop();
  if (!op) return { undone: false, detail: 'There is nothing to undo.' };
  if (op.kind === 'move') { await fsp.mkdir(path.dirname(op.to), { recursive: true }); await fsp.rename(op.from, op.to).catch(async () => { await fsp.cp(op.from, op.to, { recursive: true }); await fsp.rm(op.from, { recursive: true }); }); return { undone: true, detail: `Restored ${op.to}` }; }
  if (op.kind === 'remove') { const t = path.join(trashDir(), `${Date.now()}-${path.basename(op.path)}`); await fsp.rename(op.path, t); return { undone: true, detail: `Removed ${op.path} (kept in Jarvis trash)` }; }
  if (op.kind === 'rmdir') { await fsp.rmdir(op.path); return { undone: true, detail: `Removed empty folder ${op.path}` }; }
  if (op.kind === 'restore') { await fsp.copyFile(op.backup, op.path); return { undone: true, detail: `Restored the previous version of ${op.path}` }; }
  if (op.kind === 'unappend') { await fsp.truncate(op.path, op.size); return { undone: true, detail: `Removed the appended text from ${op.path}` }; }
  if (op.kind === 'custom') return { undone: true, detail: await op.run() };
  return { undone: false };
}
function pushUndo(label, run) { undoStack.push({ kind: 'custom', label, run }); }

module.exports = { init, exists, mustExist, resolvePath, listFolder, searchFiles, readFile, writeFile, willOverwrite, createFolder, moveFile, deleteFile, undo, pushUndo, trashDir };
