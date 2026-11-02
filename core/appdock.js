// J.A.R.V.I.S. as the desktop shell: real app windows are docked into the HUD as tabs. Each docked window
// loses its title bar and is kept exactly over the app area (only the active tab is shown); new app
// windows dock automatically, and the Windows taskbar is hidden while the HUD is up. Quitting releases
// every app back to its own window and brings the taskbar back. Everything changed is also written to a
// small state file, and a watchdog running outside J.A.R.V.I.S. restores it if the app ever dies without
// cleaning up (the next launch checks the file too).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const osx = require('./os');

const HELPER = `
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class JD {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte s, uint f, UIntPtr e);
  const int STYLE = -16, EXSTYLE = -20; const long FRAME = 0x00C00000L | 0x00040000L; // WS_CAPTION | WS_THICKFRAME
  const uint NOZ = 0x4, NOACT = 0x10, FRAMECHG = 0x20, SHOWW = 0x40, NOMOVE = 0x2, NOSIZE = 0x1;
  static Dictionary<long, long[]> saved = new Dictionary<long, long[]>();
  static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  // Worth docking: a visible, unowned, normal-sized app window (not a dialog, tool window or shell part).
  public static string Eligible(long h) {
    var p = new IntPtr(h); if (!IsWindow(p) || !IsWindowVisible(p)) return "0";
    if (GetWindow(p, 4) != IntPtr.Zero) return "0";
    long ex = GetWindowLongPtr(p, EXSTYLE).ToInt64(); if ((ex & 0x80) != 0 || (ex & 0x08000000) != 0) return "0";
    string c = Cls(p); if (c == "#32770" || c == "Shell_TrayWnd" || c == "Progman" || c == "WorkerW" || c.StartsWith("Windows.UI.Core")) return "0";
    RECT r; GetWindowRect(p, out r); if (r.R - r.L < 320 || r.B - r.T < 220) return "0";
    return "1";
  }
  public static string Dock(long h, int x, int y, int w, int hh) {
    var p = new IntPtr(h); if (!IsWindow(p)) return "GONE";
    if (IsIconic(p) || IsZoomed(p)) ShowWindow(p, 9);
    if (!saved.ContainsKey(h)) { RECT o; GetWindowRect(p, out o); saved[h] = new long[] { GetWindowLongPtr(p, STYLE).ToInt64(), o.L, o.T, o.R - o.L, o.B - o.T }; }
    long st = saved[h][0];
    SetWindowLongPtr(p, STYLE, new IntPtr(st & ~FRAME));
    bool ok = SetWindowPos(p, IntPtr.Zero, x, y, w, hh, FRAMECHG | SHOWW);
    RECT r; GetWindowRect(p, out r);
    if (ok && Math.Abs(r.L - x) < 40 && Math.Abs(r.T - y) < 40) return "OK " + string.Join(" ", saved[h]);
    Release(h); return "BLOCKED";
  }
  public static string Move(long h, int x, int y, int w, int hh) { var p = new IntPtr(h); if (!IsWindow(p)) return "GONE"; SetWindowPos(p, IntPtr.Zero, x, y, w, hh, NOZ | NOACT); return "OK"; }
  public static string Raise(long h) { var p = new IntPtr(h); if (!IsWindow(p)) return "GONE"; SetWindowPos(p, IntPtr.Zero, 0, 0, 0, 0, NOMOVE | NOSIZE | NOACT); return "OK"; }
  public static string Show(long h, int on) { var p = new IntPtr(h); if (!IsWindow(p)) return "GONE"; ShowWindow(p, on == 1 ? 8 : 0); return "OK"; }
  public static string Release(long h) {
    var p = new IntPtr(h); long[] o; if (!saved.TryGetValue(h, out o)) return "NONE"; saved.Remove(h);
    if (!IsWindow(p)) return "GONE";
    SetWindowLongPtr(p, STYLE, new IntPtr(o[0])); SetWindowPos(p, IntPtr.Zero, (int)o[1], (int)o[2], (int)o[3], (int)o[4], FRAMECHG | NOACT); ShowWindow(p, 8); return "OK";
  }
  public static string Restore(long h, long st, int x, int y, int w, int hh) {
    var p = new IntPtr(h); saved.Remove(h); if (!IsWindow(p)) return "GONE";
    SetWindowLongPtr(p, STYLE, new IntPtr(st)); SetWindowPos(p, IntPtr.Zero, x, y, w, hh, FRAMECHG | NOACT); ShowWindow(p, 8); return "OK";
  }
  public static void ReleaseAll() { foreach (var h in new List<long>(saved.Keys)) Release(h); }
  public static string Taskbar(int show) {
    foreach (var cls in new[] { "Shell_TrayWnd", "Shell_SecondaryTrayWnd" }) { IntPtr t = IntPtr.Zero; while ((t = FindWindowEx(IntPtr.Zero, t, cls, null)) != IntPtr.Zero) ShowWindow(t, show == 1 ? 5 : 0); }
    return "OK";
  }
  public static string Focus(long h) { var p = new IntPtr(h); if (!IsWindow(p)) return "GONE"; keybd_event(0x87, 0, 0, UIntPtr.Zero); keybd_event(0x87, 0, 2, UIntPtr.Zero); SetForegroundWindow(p); return "OK"; }
  public static string Close(long h) { PostMessage(new IntPtr(h), 0x0010, IntPtr.Zero, IntPtr.Zero); return "OK"; }
  public static string Alive(long h) { return IsWindow(new IntPtr(h)) ? "1" : "0"; }
  public static string Fg() { return GetForegroundWindow().ToInt64().ToString(); }
}
'@
[JD]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
try {
  while ($null -ne ($line = [Console]::In.ReadLine())) {
    $a = $line.Split(' ')
    try {
      $out = switch ($a[0]) {
        'eligible' { [JD]::Eligible([long]$a[1]) } 'dock' { [JD]::Dock([long]$a[1], [int]$a[2], [int]$a[3], [int]$a[4], [int]$a[5]) }
        'move' { [JD]::Move([long]$a[1], [int]$a[2], [int]$a[3], [int]$a[4], [int]$a[5]) } 'raise' { [JD]::Raise([long]$a[1]) }
        'show' { [JD]::Show([long]$a[1], [int]$a[2]) } 'release' { [JD]::Release([long]$a[1]) } 'restore' { [JD]::Restore([long]$a[1], [long]$a[2], [int]$a[3], [int]$a[4], [int]$a[5], [int]$a[6]) } 'releaseall' { [JD]::ReleaseAll(); 'OK' }
        'taskbar' { [JD]::Taskbar([int]$a[1]) } 'focus' { [JD]::Focus([long]$a[1]) } 'close' { [JD]::Close([long]$a[1]) }
        'alive' { [JD]::Alive([long]$a[1]) } 'fg' { [JD]::Fg() } default { 'ERR' }
      }
    } catch { $out = 'ERR' }
    [Console]::Out.WriteLine($out); [Console]::Out.Flush()
  }
} finally {
  # J.A.R.V.I.S. has gone (closed or crashed): give every app its window back and restore the taskbar.
  [JD]::ReleaseAll(); [JD]::Taskbar(1) | Out-Null
}`;

// One long-lived helper keeps moves and tab switches instant (compiling the Win32 bindings takes a second).
let helper = null, queue = [], buffer = '';
function startHelper() {
  if (helper) return helper;
  const encoded = Buffer.from(HELPER, 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  let readyResolve; const ready = new Promise((r) => { readyResolve = r; });
  child.stdout.on('data', (d) => {
    buffer += d.toString();
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
      if (line === 'READY') { readyResolve(); continue; }
      queue.shift()?.(line);
    }
  });
  child.on('exit', () => { helper = null; queue.splice(0).forEach((r) => r('ERR')); });
  helper = { child, ready };
  return helper;
}
async function cmd(...parts) {
  if (!parts.every((p) => /^-?\d+$/.test(String(p)) || /^[a-z]+$/.test(String(p)))) throw new Error('Bad window command.');
  const h = startHelper(); await h.ready;
  return new Promise((resolve) => { queue.push(resolve); h.child.stdin.write(parts.join(' ') + '\n'); });
}

// ---- crash safety ----
const stateFile = () => path.join(process.env.ASSISTANT_DATA_DIR || path.join(__dirname, '..', '.appdata'), 'shell-state.json');
const savedFrames = new Map(); // handle -> [style, x, y, w, h] as they were before docking
function writeState() {
  try {
    if (!savedFrames.size && !taskbarHidden) { fs.rmSync(stateFile(), { force: true }); return; }
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify({ pid: process.pid, taskbarHidden, windows: Object.fromEntries(savedFrames) }));
  } catch {}
}
// Undo whatever a previous run left behind (it crashed and its watchdog didn't get to it).
async function recover() {
  let st; try { st = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return; }
  for (const [h, v] of Object.entries(st.windows || {})) if (/^\d+$/.test(h) && Array.isArray(v) && v.length === 5 && v.every(Number.isFinite)) await cmd('restore', h, ...v.map(Math.round));
  if (st.taskbarHidden) await cmd('taskbar', 1);
  try { fs.rmSync(stateFile(), { force: true }); } catch {}
}
// The watchdog is started through WMI so it isn't part of J.A.R.V.I.S.'s process tree and outlives a crash.
const WATCHDOG = (pid, file) => `
$ErrorActionPreference = 'SilentlyContinue'
while (Get-Process -Id ${pid}) { Start-Sleep -Seconds 1 }
$f = '${file.replace(/'/g, "''")}'
if (-not (Test-Path -LiteralPath $f)) { exit }
$s = Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
if ($s.pid -ne ${pid}) { exit }
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class JW { [DllImport("user32.dll")] public static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v); [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h); [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string t); }'
foreach ($prop in $s.windows.PSObject.Properties) {
  $h = [IntPtr][long]$prop.Name; $v = $prop.Value
  if ([JW]::IsWindow($h)) { [JW]::SetWindowLongPtr($h, -16, [IntPtr][long]$v[0]) | Out-Null; [JW]::SetWindowPos($h, [IntPtr]::Zero, [int]$v[1], [int]$v[2], [int]$v[3], [int]$v[4], 0x30) | Out-Null; [JW]::ShowWindow($h, 8) | Out-Null }
}
if ($s.taskbarHidden) { foreach ($c in 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd') { $t = [IntPtr]::Zero; while (($t = [JW]::FindWindowEx([IntPtr]::Zero, $t, $c, $null)) -ne [IntPtr]::Zero) { [JW]::ShowWindow($t, 5) | Out-Null } } }
Remove-Item -LiteralPath $f -Force`;
function startWatchdog() {
  const inner = Buffer.from(WATCHDOG(process.pid, stateFile()), 'utf16le').toString('base64');
  const launcher = `$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${inner}'; ProcessStartupInformation = $si } | Out-Null`;
  osx.powershell(launcher, { timeoutMs: 30000 }).catch(() => {});
}

const MAX_APPS = 16;
const apps = new Map();   // handle -> { handle, name }
let active = null;        // handle of the tab on show, or null for the HUD home view
let rect = null;          // app area in physical screen pixels
let rectWaiters = [];
const hiddenBy = new Set();
const known = new Set();  // windows that existed before J.A.R.V.I.S. started or were popped out: never auto-docked
let watcher = null, busy = false, options = { autoDock: true, hideTaskbar: true }, taskbarHidden = false;

// The HUD by id (main.cjs records it): other Jarvis windows, like the dictation bar, must never host apps.
function hudWindow() { const B = osx.electron?.BrowserWindow; if (!B) return null; return (globalThis.jarvisHudId && B.fromId(globalThis.jarvisHudId)) || B.getAllWindows()[0] || null; }
function ownHandle() { const w = hudWindow(); if (!w) return null; const b = w.getNativeWindowHandle(); return String(b.length >= 8 ? b.readBigUInt64LE(0) : b.readUInt32LE(0)); }
const list = () => [...apps.values()].map(({ handle, name }) => ({ handle, name }));
function publish() { store.emit('appdock', { action: 'state', apps: list(), active }); }

// The renderer reports the app area in CSS pixels; convert it to physical screen pixels.
function setRect(r) {
  const win = hudWindow(); if (!win || !r) return;
  const c = win.getContentBounds();
  const dip = { x: Math.round(c.x + r.x), y: Math.round(c.y + r.y), width: Math.max(80, Math.round(r.width)), height: Math.max(60, Math.round(r.height)) };
  const p = osx.electron.screen.dipToScreenRect(win, dip);
  const changed = !rect || rect.x !== p.x || rect.y !== p.y || rect.width !== p.width || rect.height !== p.height;
  rect = { x: p.x, y: p.y, width: p.width, height: p.height };
  rectWaiters.splice(0).forEach((f) => f());
  if (changed && active && !hiddenBy.size) cmd('move', active, rect.x, rect.y, rect.width, rect.height);
}
async function waitRect() { if (rect) return; await new Promise((res) => { rectWaiters.push(res); setTimeout(res, 3000); }); if (!rect) throw new Error('The app area is not on screen.'); }

async function activate(handle) {
  const next = handle && apps.has(String(handle)) ? String(handle) : null;
  if (active && active !== next) await cmd('show', active, 0);
  active = next;
  publish();
  if (!active || hiddenBy.size) return;
  await waitRect();
  await cmd('show', active, 1);
  await cmd('move', active, rect.x, rect.y, rect.width, rect.height);
  await cmd('focus', active);
}

async function attach(handle, name) {
  if (!osx.electron) throw new Error('Docking apps is only available in the desktop app.');
  handle = String(handle);
  if (!/^\d+$/.test(handle) || handle === ownHandle()) throw new Error('That window cannot be docked.');
  if (apps.has(handle)) { await activate(handle); return { docked: apps.get(handle).name }; }
  if (apps.size >= MAX_APPS) throw new Error(`J.A.R.V.I.S. already has ${MAX_APPS} apps docked; close one first.`);
  store.emit('appdock', { action: 'opening', name });
  await waitRect();
  const result = await cmd('dock', handle, rect.x, rect.y, rect.width, rect.height);
  if (result === 'GONE') { known.add(handle); publish(); throw new Error('That window has closed.'); }
  if (result.startsWith('OK ')) { savedFrames.set(handle, result.slice(3).split(' ').map(Number)); writeState(); }
  if (result === 'BLOCKED') { known.add(handle); publish(); throw new Error(`Windows would not let me move ${name}. It may be running as administrator, so it stays in its own window.`); }
  apps.set(handle, { handle, name: String(name).slice(0, 80) });
  await activate(handle);
  return { docked: name };
}

// Top-level windows of processes whose program path contains `hint` (e.g. "AIReason\\weber\\").
// Window titles can't identify apps whose title changes (a music player shows the song), so
// apps that know their folder are matched by the program that owns the window instead.
async function windowsOfProgram(hint) {
  if (!/^[\w .\\-]{3,120}$/.test(hint)) return [];
  const like = hint.replace(/'/g, "''");
  const list = await osx.psJson(`Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path -like '*${like}*' } | Select-Object @{n='handle';e={[string]$_.MainWindowHandle}}`, { timeoutMs: 15000 }).catch(() => []);
  return (Array.isArray(list) ? list : list ? [list] : []).map((w) => String(w.handle)).filter((h) => /^\d+$/.test(h) && h !== '0');
}

// Launch an installed app and dock the window it opens (or the one it brings forward if already running).
async function openInside(app) {
  const before = new Set((await osx.taskWindows(false)).map((w) => w.handle));
  store.emit('appdock', { action: 'opening', name: app.Name });
  busy = true;
  try {
    if (app.pathHint) {
      // Already open? Dock (or switch to) that app's own window rather than guessing.
      const mine = await windowsOfProgram(app.pathHint);
      const docked = mine.find((h) => apps.has(h));
      if (docked) { await activate(docked); return { docked: apps.get(docked).name }; }
      if (mine.length) { known.add(mine[0]); return await attach(mine[0], app.Name); }
    }
    await osx.launch(`shell:AppsFolder\\${app.AppID}`);
    if (app.pathHint) {
      // Freshly started: wait for the window that belongs to this program.
      const end = Date.now() + 20000;
      while (Date.now() < end) {
        await new Promise((r) => setTimeout(r, 600));
        const mine = await windowsOfProgram(app.pathHint);
        if (mine.length) {
          known.add(mine[0]);
          await new Promise((r) => setTimeout(r, 500)); // let it finish its first layout
          return await attach(mine[0], app.Name);
        }
      }
      publish();
      return { docked: null, note: `${app.Name} started but I could not find its window, so it opened normally.` };
    }
    const own = ownHandle(), end = Date.now() + 15000;
    let found = null;
    while (!found && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 500));
      const fresh = (await osx.taskWindows(false)).filter((w) => !before.has(w.handle) && !apps.has(w.handle));
      for (const w of fresh) if ((await cmd('eligible', w.handle)) === '1') { found = w; break; }
      if (!found && Date.now() > end - 11000) {
        const fg = await cmd('fg');
        if (apps.has(fg)) { await activate(fg); return { docked: apps.get(fg).name }; }
        if (fg !== own && fg !== '0' && before.has(fg)) found = { handle: fg, name: app.Name };
      }
    }
    if (!found) { publish(); return { docked: null, note: `${app.Name} started but I could not find its window, so it opened normally.` }; }
    known.add(found.handle);
    await new Promise((r) => setTimeout(r, 500)); // let it finish its first layout
    return await attach(found.handle, app.Name);
  } finally { busy = false; }
}

async function release(handle = active) {
  handle = handle && String(handle);
  const app = handle && apps.get(handle);
  if (!app) return { released: null };
  apps.delete(handle); known.add(handle);
  if (active === handle) active = null;
  await cmd('release', handle); savedFrames.delete(handle); writeState();
  await cmd('focus', handle);
  publish();
  return { released: app.name };
}
async function close(handle = active) {
  handle = handle && String(handle);
  const app = handle && apps.get(handle);
  if (!app) return { closed: null };
  apps.delete(handle); known.add(handle);
  if (active === handle) active = null;
  await cmd('release', handle); savedFrames.delete(handle); writeState(); await cmd('close', handle);
  publish();
  return { closed: app.name };
}
async function releaseAll() {
  apps.clear(); active = null;
  await cmd('releaseall'); savedFrames.clear(); writeState();
  publish();
}

async function setHidden(reason, hidden) {
  if (hidden) hiddenBy.add(reason); else hiddenBy.delete(reason);
  if (!active) return;
  await cmd('show', active, hiddenBy.size ? 0 : 1);
  if (!hiddenBy.size && rect) await cmd('move', active, rect.x, rect.y, rect.width, rect.height);
}
async function raise() { if (active && !hiddenBy.size) await cmd('raise', active); }
async function focus() { if (active && !hiddenBy.size) await cmd('focus', active); }
async function setTaskbarHidden(hide) {
  const want = Boolean(hide && options.hideTaskbar);
  if (want === taskbarHidden) return;
  taskbarHidden = want; writeState();
  await cmd('taskbar', want ? 0 : 1);
}

// New app windows dock themselves; docked windows that close drop their tab.
async function scan() {
  if (busy || !osx.electron) return;
  busy = true;
  try {
    const wins = await osx.taskWindows(false);
    const open = new Set(wins.map((w) => w.handle));
    for (const h of [...apps.keys()]) if (!open.has(h) && (await cmd('alive', h)) === '0') { apps.delete(h); savedFrames.delete(h); writeState(); if (active === h) active = null; publish(); }
    if (!options.autoDock) { wins.forEach((w) => known.add(w.handle)); return; }
    for (const w of wins) {
      if (known.has(w.handle) || apps.has(w.handle)) continue;
      known.add(w.handle);
      if ((await cmd('eligible', w.handle)) !== '1') continue;
      await new Promise((r) => setTimeout(r, 400));
      try { await attach(w.handle, w.name); } catch {}
    }
  } catch {} finally { busy = false; }
}
async function start(opts = {}) {
  configure(opts);
  if (!osx.electron || watcher) return;
  startHelper();
  await recover().catch(() => {});
  startWatchdog();
  try { (await osx.taskWindows(false)).forEach((w) => known.add(w.handle)); } catch {}
  watcher = setInterval(scan, 1500);
}
function configure(opts = {}) {
  if (typeof opts.autoDock === 'boolean') options.autoDock = opts.autoDock;
  if (typeof opts.hideTaskbar === 'boolean') { options.hideTaskbar = opts.hideTaskbar; if (!opts.hideTaskbar && taskbarHidden) { taskbarHidden = false; writeState(); cmd('taskbar', 1).catch(() => {}); } }
}
function state() { return { apps: list(), active }; }
function find(name) { const q = String(name || '').toLowerCase(); return list().find((a) => a.name.toLowerCase() === q) || list().find((a) => a.name.toLowerCase().includes(q)) || null; }
// Called on quit: everything back to normal, then the helper exits (its own cleanup is a no-op by then).
async function shutdown() {
  clearInterval(watcher); watcher = null;
  if (!helper) return;
  try { await Promise.race([Promise.all([cmd('releaseall'), cmd('taskbar', 1)]), new Promise((r) => setTimeout(r, 2500))]); savedFrames.clear(); taskbarHidden = false; writeState(); } catch {}
  try { helper.child.stdin.end(); } catch {}
}

module.exports = { start, configure, attach, openInside, activate, release, close, releaseAll, setRect, setHidden, setTaskbarHidden, raise, focus, state, find, shutdown };
