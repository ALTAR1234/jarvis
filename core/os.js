// Windows integration: PowerShell runner, apps, audio, media keys, keyboard, power, processes, clipboard,
// screen capture, notifications, and live system stats. Uses Electron APIs when running inside the app.
const { spawn, execFile } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

let electron = null;
try { const e = require('electron'); if (e && typeof e === 'object' && e.app) electron = e; } catch {}

function powershell(script, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(`$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8\n${script}`, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`PowerShell timed out after ${Math.round(timeoutMs / 1000)} s.`)); }, timeoutMs);
    child.stdout.on('data', (d) => { if (out.length < 200000) out += d; });
    child.stderr.on('data', (d) => { if (err.length < 20000) err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout: out.trim(), stderr: err.trim() }); });
  });
}
async function psJson(script, opts) {
  const r = await powershell(`${script} | ConvertTo-Json -Depth 4 -Compress`, opts);
  if (r.code !== 0) throw new Error((r.stderr || 'PowerShell failed.').split('\n')[0].slice(0, 300));
  return r.stdout ? JSON.parse(r.stdout) : null;
}
const psString = (value) => `'${String(value).replace(/'/g, "''")}'`;

// ---------- launching ----------
function launch(target) {
  if (electron?.shell && /^(https?:|ms-settings:|mailto:)/i.test(target)) return electron.shell.openExternal(target).then(() => true);
  if (electron?.shell && !/^shell:/i.test(target) && fs.existsSync(target)) return electron.shell.openPath(target).then((e) => { if (e) throw new Error(e); return true; });
  return new Promise((resolve, reject) => {
    const child = spawn('explorer.exe', [target], { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', reject); child.unref(); setTimeout(() => resolve(true), 300);
  });
}

let appCache = { at: 0, apps: [] };
async function startApps() {
  if (Date.now() - appCache.at < 10 * 60 * 1000 && appCache.apps.length) return appCache.apps;
  const apps = await psJson('Get-StartApps | Select-Object Name, AppID', { timeoutMs: 30000 });
  appCache = { at: Date.now(), apps: (Array.isArray(apps) ? apps : apps ? [apps] : []).filter((a) => a?.Name && a?.AppID) };
  return appCache.apps;
}
const APP_ALIASES = {
  'settings': 'ms-settings:', 'windows settings': 'ms-settings:', 'file explorer': 'explorer.exe', 'explorer': 'explorer.exe', 'files': 'explorer.exe',
  'task manager': 'taskmgr.exe', 'command prompt': 'cmd.exe', 'cmd': 'cmd.exe', 'powershell': 'powershell.exe', 'terminal': 'wt.exe',
  'notepad': 'notepad.exe', 'calculator': 'calc.exe', 'paint': 'mspaint.exe', 'control panel': 'control.exe', 'snipping tool': 'ms-screenclip:'
};
function scoreName(name, query) {
  const n = name.toLowerCase(), q = query.toLowerCase().trim();
  if (n === q) return 100;
  if (n.startsWith(q)) return 80 - (n.length - q.length) * 0.1;
  if (n.includes(q)) return 60 - (n.length - q.length) * 0.1;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length && tokens.every((t) => n.includes(t))) return 40;
  return 0;
}
async function openApp(name) {
  const query = String(name || '').trim();
  if (!query) throw new Error('No app name given.');
  const apps = await startApps().catch(() => []);
  const best = apps.map((a) => ({ a, s: scoreName(a.Name, query) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s)[0];
  if (best && best.s >= 40) {
    await launch(`shell:AppsFolder\\${best.a.AppID}`);
    return { opened: best.a.Name };
  }
  const alias = APP_ALIASES[query.toLowerCase()];
  if (alias) {
    if (/:$/.test(alias) || /^ms-/.test(alias)) await launch(alias);
    else await new Promise((resolve, reject) => { const c = spawn(alias, [], { detached: true, stdio: 'ignore' }); c.on('error', reject); c.unref(); setTimeout(resolve, 300); });
    return { opened: query };
  }
  const suggestions = apps.map((a) => ({ n: a.Name, s: scoreName(a.Name, query.split(/\s+/)[0] || query) })).filter((x) => x.s > 0).slice(0, 5).map((x) => x.n);
  throw Object.assign(new Error(`No installed app matches "${query}".`), { suggestions });
}
// Best installed-app match for a spoken or typed name.
async function findApp(name) {
  const query = String(name || '').trim();
  const apps = await startApps().catch(() => []);
  const best = apps.map((a) => ({ a, s: scoreName(a.Name, query) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s)[0];
  return best && best.s >= 40 ? best.a : null;
}
async function isProcessRunning(fragment) {
  const list = await psJson('Get-Process | Where-Object MainWindowTitle | Select-Object ProcessName, MainWindowTitle').catch(() => []);
  const f = fragment.toLowerCase().replace(/\s+/g, '');
  return (Array.isArray(list) ? list : [list]).some((p) => p && (p.ProcessName.toLowerCase().includes(f) || String(p.MainWindowTitle).toLowerCase().replace(/\s+/g, '').includes(f)));
}

// ---------- audio / media / keyboard (Win32 via Add-Type) ----------
const AUDIO_CS = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { int f(); int g(); int h(); int i(); int SetMasterVolumeLevelScalar(float l, Guid c); int j(); int GetMasterVolumeLevelScalar(out float l); int k(); int l(); int m(); int n(); int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, Guid c); int GetMute(out bool m); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int ctx, int p, out IAudioEndpointVolume v); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }
public static class JarvisAudio {
  static IAudioEndpointVolume V() { var e = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom()); IMMDevice d; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d)); IAudioEndpointVolume v; var id = typeof(IAudioEndpointVolume).GUID; Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, 0, out v)); return v; }
  public static float Get() { float l; Marshal.ThrowExceptionForHR(V().GetMasterVolumeLevelScalar(out l)); return l; }
  public static void Set(float l) { Marshal.ThrowExceptionForHR(V().SetMasterVolumeLevelScalar(l, Guid.Empty)); }
  public static bool Muted() { bool m; Marshal.ThrowExceptionForHR(V().GetMute(out m)); return m; }
  public static void Mute(bool m) { Marshal.ThrowExceptionForHR(V().SetMute(m, Guid.Empty)); }
}
'@`;
async function volume({ level, change, mute } = {}) {
  const lines = [AUDIO_CS];
  if (typeof mute === 'boolean') lines.push(`[JarvisAudio]::Mute($${mute})`);
  if (Number.isFinite(level)) lines.push(`[JarvisAudio]::Set(${Math.min(100, Math.max(0, level)) / 100})`);
  if (Number.isFinite(change)) lines.push(`[JarvisAudio]::Set([Math]::Min(1,[Math]::Max(0,[JarvisAudio]::Get() + ${change / 100})))`);
  lines.push('@{ level = [int]([Math]::Round([JarvisAudio]::Get() * 100)); muted = [JarvisAudio]::Muted() } | ConvertTo-Json -Compress');
  const r = await powershell(lines.join('\n'));
  if (r.code !== 0) throw new Error((r.stderr || 'Volume control failed.').split('\n')[0]);
  return JSON.parse(r.stdout);
}

const KEYS_CS = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class JarvisKeys {
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static void Press(byte[] keys) { foreach (var k in keys) keybd_event(k, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(30); for (int i = keys.Length - 1; i >= 0; i--) keybd_event(keys[i], 0, 2, UIntPtr.Zero); }
}
'@`;
const VK = { ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, win: 0x5b, windows: 0x5b, enter: 0x0d, return: 0x0d, tab: 0x09, esc: 0x1b, escape: 0x1b, space: 0x20,
  backspace: 0x08, delete: 0x2e, del: 0x2e, insert: 0x2d, up: 0x26, down: 0x28, left: 0x25, right: 0x27, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  printscreen: 0x2c, capslock: 0x14, volumemute: 0xad, volumedown: 0xae, volumeup: 0xaf, nexttrack: 0xb0, prevtrack: 0xb1, stop: 0xb2, playpause: 0xb3 };
function keyCodes(combo) {
  return String(combo).toLowerCase().split('+').map((k) => k.trim()).filter(Boolean).map((k) => {
    if (VK[k] !== undefined) return VK[k];
    if (/^[a-z0-9]$/.test(k)) return k.toUpperCase().charCodeAt(0);
    if (/^f([1-9]|1[0-2])$/.test(k)) return 0x6f + Number(k.slice(1));
    throw new Error(`Unknown key "${k}".`);
  });
}
async function pressKeys(combo) {
  const codes = keyCodes(combo);
  const r = await powershell(`${KEYS_CS}\n[JarvisKeys]::Press([byte[]](${codes.join(',')}))`);
  if (r.code !== 0) throw new Error((r.stderr || 'Key press failed.').split('\n')[0]);
}
async function media(action) {
  const map = { play: 'playpause', pause: 'playpause', playpause: 'playpause', toggle: 'playpause', next: 'nexttrack', previous: 'prevtrack', prev: 'prevtrack', stop: 'stop' };
  if (!map[action]) throw new Error('Unknown media action.');
  await pressKeys(map[action]);
}
async function typeText(text) {
  const escaped = String(text).replace(/[+^%~(){}[\]]/g, '{$&}').replace(/\r?\n/g, '{ENTER}');
  const r = await powershell(`Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.SendKeys]::SendWait(${psString(escaped)})`);
  if (r.code !== 0) throw new Error((r.stderr || 'Typing failed.').split('\n')[0]);
}

// ---------- display / power ----------
async function brightness(level) {
  if (Number.isFinite(level)) {
    const r = await powershell(`(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1) | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1; Brightness=${Math.round(Math.min(100, Math.max(0, level)))}} | Out-Null`);
    if (r.code !== 0) throw new Error('This display does not support software brightness control (external monitors usually do not).');
  }
  const cur = await psJson('(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1).CurrentBrightness').catch(() => null);
  return { level: cur };
}
async function power(action) {
  const cmds = {
    lock: ['rundll32.exe', ['user32.dll,LockWorkStation']],
    sleep: null,
    shutdown: ['shutdown.exe', ['/s', '/t', '10']],
    restart: ['shutdown.exe', ['/r', '/t', '10']],
    sign_out: ['shutdown.exe', ['/l']],
    cancel: ['shutdown.exe', ['/a']]
  };
  if (!(action in cmds)) throw new Error('Unknown power action.');
  if (action === 'sleep') {
    const r = await powershell("Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false) | Out-Null");
    if (r.code !== 0) throw new Error('Could not put the PC to sleep.');
    return;
  }
  const [cmd, args] = cmds[action];
  await new Promise((resolve, reject) => execFile(cmd, args, { windowsHide: true }, (e) => (e && action !== 'cancel' ? reject(e) : resolve())));
}

// ---------- processes / windows ----------
async function processes(limit = 15) {
  const list = await psJson(`Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First ${Math.min(40, limit)} @{n='name';e={$_.ProcessName}}, @{n='pid';e={$_.Id}}, @{n='memoryMB';e={[int]($_.WorkingSet64/1MB)}}, @{n='window';e={$_.MainWindowTitle}}`);
  return Array.isArray(list) ? list : [list];
}
async function windows() {
  const list = await psJson("Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object @{n='app';e={$_.ProcessName}}, @{n='title';e={$_.MainWindowTitle}}");
  return Array.isArray(list) ? list : list ? [list] : [];
}
async function closeApp(name, force) {
  const n = String(name).replace(/\.exe$/i, '');
  const r = await powershell(`$procs = @(Get-Process | Where-Object { $_.ProcessName -like ${psString('*' + n.replace(/\s+/g, '*') + '*')} -or $_.MainWindowTitle -like ${psString('*' + n + '*')} })
if ($procs.Count -eq 0) { 'NONE'; exit }
$names = ($procs | Select-Object -ExpandProperty ProcessName -Unique) -join ', '
${force ? '$procs | Stop-Process -Force' : '$procs | Where-Object MainWindowHandle -ne 0 | ForEach-Object { [void]$_.CloseMainWindow() }'}
$names`);
  if (r.code !== 0) throw new Error((r.stderr || 'Could not close the app.').split('\n')[0]);
  if (r.stdout === 'NONE') throw new Error(`No running app matches "${name}".`);
  return { closed: r.stdout };
}
async function focusWindow(title) {
  const r = await powershell(`$w = New-Object -ComObject WScript.Shell; if ($w.AppActivate(${psString(title)})) { 'OK' } else { 'NO' }`);
  if (r.stdout !== 'OK') throw new Error(`No window titled like "${title}".`);
}

// ---------- windows by handle (the HUD's task view) ----------
const WIN_CS = `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class JarvisWin {
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static void Focus(long h) { var p = new IntPtr(h); if (IsIconic(p)) ShowWindowAsync(p, 9); keybd_event(0x87, 0, 0, UIntPtr.Zero); keybd_event(0x87, 0, 2, UIntPtr.Zero); SetForegroundWindow(p); }
  public static void Close(long h) { PostMessage(new IntPtr(h), 0x0010, IntPtr.Zero, IntPtr.Zero); }
}
'@`;
// Open windows of other apps, with their icons and (optionally) live thumbnails.
async function taskWindows(withThumbs) {
  if (!electron?.desktopCapturer) throw new Error('The task view is only available in the desktop app.');
  const own = new Set(electron.BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()));
  const size = withThumbs ? { width: 420, height: 260 } : { width: 0, height: 0 };
  const sources = await electron.desktopCapturer.getSources({ types: ['window'], thumbnailSize: size, fetchWindowIcons: true });
  return sources.filter((s) => !own.has(s.id) && s.name && !/^(Program Manager|Windows Input Experience|Task Switching)$/i.test(s.name)).map((s) => ({
    handle: s.id.split(':')[1], name: s.name,
    icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.resize({ width: 32, height: 32 }).toDataURL() : null,
    thumb: withThumbs && !s.thumbnail.isEmpty() ? `data:image/jpeg;base64,${s.thumbnail.toJPEG(65).toString('base64')}` : null
  }));
}
async function windowByHandle(handle, action) {
  if (!/^\d{1,20}$/.test(String(handle))) throw new Error('That window is not valid.');
  const r = await powershell(`${WIN_CS}\n[JarvisWin]::${action === 'close' ? 'Close' : 'Focus'}(${handle})`);
  if (r.code !== 0) throw new Error((r.stderr || 'The window action failed.').split('\n')[0]);
}

// ---------- clipboard / screen / notify ----------
async function clipboardRead() {
  if (electron?.clipboard) return electron.clipboard.readText();
  return (await powershell('Get-Clipboard -Raw')).stdout;
}
async function clipboardWrite(text) {
  if (electron?.clipboard) { electron.clipboard.writeText(String(text)); return; }
  await powershell(`Set-Clipboard -Value ${psString(text)}`);
}
async function screenshot() {
  if (!electron?.desktopCapturer) throw new Error('Screen capture is only available in the desktop app.');
  const display = electron.screen.getPrimaryDisplay();
  const scale = Math.min(1, 1600 / display.size.width);
  const sources = await electron.desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * display.scaleFactor * scale), height: Math.round(display.size.height * display.scaleFactor * scale) } });
  if (!sources.length) throw new Error('No screen is available to capture.');
  return sources[0].thumbnail.toJPEG(82);
}
function notify(title, body) {
  if (electron?.Notification?.isSupported()) new electron.Notification({ title, body, silent: false }).show();
}

// ---------- system stats ----------
let lastCpu = null, lastNet = null, battery = { at: 0, value: null };
let cpuNow = null;
function sampleCpu() {
  const t = os.cpus().reduce((acc, c) => { const tot = Object.values(c.times).reduce((a, b) => a + b, 0); acc.total += tot; acc.idle += c.times.idle; return acc; }, { total: 0, idle: 0 });
  const prev = lastCpu; lastCpu = t;
  if (prev && t.total > prev.total) cpuNow = Math.round(100 * (1 - (t.idle - prev.idle) / (t.total - prev.total)));
}
sampleCpu(); setInterval(sampleCpu, 2000).unref();
const cpuPercent = () => cpuNow;
function netBytes() {
  return new Promise((resolve) => execFile('netstat.exe', ['-e'], { windowsHide: true, timeout: 4000 }, (e, out) => {
    const m = !e && String(out).match(/Bytes\s+(\d+)\s+(\d+)/);
    resolve(m ? { rx: Number(m[1]), tx: Number(m[2]), at: Date.now() } : null);
  }));
}
async function batteryStatus() {
  if (Date.now() - battery.at < 60000) return battery.value;
  battery.at = Date.now();
  battery.value = await psJson('Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining, BatteryStatus', { timeoutMs: 10000 })
    .then((b) => (b ? { percent: b.EstimatedChargeRemaining, charging: [2, 6, 7, 8, 9].includes(b.BatteryStatus) } : { none: true })).catch(() => null);
  return battery.value;
}
function diskFree() {
  try { const s = fs.statfsSync(path.parse(os.homedir()).root); return { freeGB: Math.round((s.bavail * s.bsize) / 1e9), totalGB: Math.round((s.blocks * s.bsize) / 1e9) }; }
  catch { return null; }
}
async function stats() {
  let net = await netBytes(), prev = lastNet;
  // First call has no baseline yet: take a second sample shortly after.
  if (!prev && net) { await new Promise((r) => setTimeout(r, 1000)); prev = net; net = await netBytes(); }
  lastNet = net;
  const secs = net && prev ? (net.at - prev.at) / 1000 : 0;
  return {
    cpu: cpuPercent(), cpuModel: os.cpus()[0]?.model?.trim(), cores: os.cpus().length,
    memory: { usedGB: +((os.totalmem() - os.freemem()) / 1e9).toFixed(1), totalGB: +(os.totalmem() / 1e9).toFixed(1) },
    network: secs > 0 ? { downKBps: Math.max(0, Math.round((net.rx - prev.rx) / 1024 / secs)), upKBps: Math.max(0, Math.round((net.tx - prev.tx) / 1024 / secs)) } : null,
    battery: await batteryStatus(), disk: diskFree(), uptimeHours: +(os.uptime() / 3600).toFixed(1), host: os.hostname()
  };
}

function knownFolder(name) {
  const map = { desktop: 'desktop', documents: 'documents', docs: 'documents', downloads: 'downloads', pictures: 'pictures', photos: 'pictures', music: 'music', videos: 'videos', home: 'home' };
  const key = map[String(name).toLowerCase()];
  if (!key) return null;
  if (electron?.app) { try { return electron.app.getPath(key); } catch {} }
  const home = os.homedir();
  if (key === 'home') return home;
  const cap = key[0].toUpperCase() + key.slice(1);
  const oneDrive = process.env.OneDrive && path.join(process.env.OneDrive, cap);
  return oneDrive && fs.existsSync(oneDrive) ? oneDrive : path.join(home, cap);
}

module.exports = { electron, powershell, psJson, launch, openApp, findApp, isProcessRunning, volume, pressKeys, media, typeText, brightness, power, processes, windows, closeApp, focusWindow, taskWindows, windowByHandle, clipboardRead, clipboardWrite, screenshot, notify, stats, knownFolder };
