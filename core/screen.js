// Screen control for "control my screen": screenshots of the main display and real mouse and keyboard
// input, through one long-lived PowerShell helper (compiling the Win32 bindings once keeps every step fast).
const { spawn } = require('node:child_process');

const HELPER = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System; using System.Drawing; using System.Drawing.Drawing2D; using System.Drawing.Imaging; using System.IO; using System.Runtime.InteropServices;
public static class JS {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, int x, int y, int d, IntPtr e);
  [DllImport("user32.dll")] static extern short VkKeyScan(char c);
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  public static void Init() { SetProcessDPIAware(); }
  public static string Size() { return GetSystemMetrics(0) + " " + GetSystemMetrics(1); }
  public static string Shot(int w, int h) {
    int sw = GetSystemMetrics(0), sh = GetSystemMetrics(1);
    using (var full = new Bitmap(sw, sh)) {
      using (var g = Graphics.FromImage(full)) g.CopyFromScreen(0, 0, 0, 0, new Size(sw, sh));
      using (var small = new Bitmap(w, h)) {
        using (var g = Graphics.FromImage(small)) { g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.DrawImage(full, 0, 0, w, h); }
        using (var ms = new MemoryStream()) { small.Save(ms, ImageFormat.Png); return Convert.ToBase64String(ms.ToArray()); }
      }
    }
  }
  public static string Zoom(int x0, int y0, int x1, int y1, int w, int h) {
    using (var part = new Bitmap(x1 - x0, y1 - y0)) {
      using (var g = Graphics.FromImage(part)) g.CopyFromScreen(x0, y0, 0, 0, new Size(x1 - x0, y1 - y0));
      using (var out1 = new Bitmap(w, h)) {
        using (var g = Graphics.FromImage(out1)) { g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.DrawImage(part, 0, 0, w, h); }
        using (var ms = new MemoryStream()) { out1.Save(ms, ImageFormat.Png); return Convert.ToBase64String(ms.ToArray()); }
      }
    }
  }
  public static void Move(int x, int y) { SetCursorPos(x, y); }
  public static string Pos() { POINT p; GetCursorPos(out p); return p.X + " " + p.Y; }
  // button: 0 left, 1 right, 2 middle; down/up flags per mouse_event
  public static void Button(int b, bool down) {
    uint[] d = { 0x02, 0x08, 0x20 }, u = { 0x04, 0x10, 0x40 };
    mouse_event(down ? d[b] : u[b], 0, 0, 0, IntPtr.Zero);
  }
  public static void Wheel(bool horizontal, int clicks) { mouse_event(horizontal ? 0x1000u : 0x0800u, 0, 0, clicks * 120, IntPtr.Zero); }
  static INPUT Key(ushort vk, ushort scan, uint flags) { var i = new INPUT(); i.type = 1; i.u.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags }; return i; }
  static uint Ext(ushort vk) { return (vk >= 0x21 && vk <= 0x2E) || vk == 0x5B || vk == 0x5C || vk == 0x5D ? 1u : 0u; }
  public static void KeyEvent(ushort vk, bool down) { SendInput(1, new[] { Key(vk, 0, Ext(vk) | (down ? 0u : 2u)) }, Marshal.SizeOf(typeof(INPUT))); }
  // a character as its key (with shift if needed), for combinations like ctrl+/ ; -1 when the layout has no key for it
  public static int CharVk(char c) { short r = VkKeyScan(c); return r == -1 ? -1 : r; }
  public static void TypeText(string s) {
    foreach (char c in s) {
      if (c == '\r') continue;
      INPUT[] pair = c == '\n' ? new[] { Key(0x0D, 0, 0), Key(0x0D, 0, 2) } : new[] { Key(0, c, 4), Key(0, c, 6) };
      SendInput(2, pair, Marshal.SizeOf(typeof(INPUT)));
      System.Threading.Thread.Sleep(4);
    }
  }
}
'@ -ReferencedAssemblies System.Drawing
[JS]::Init()
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Split(' ')
  try {
    switch ($p[0]) {
      'size' { $out = [JS]::Size() }
      'shot' { $out = [JS]::Shot([int]$p[1], [int]$p[2]) }
      'zoom' { $out = [JS]::Zoom([int]$p[1], [int]$p[2], [int]$p[3], [int]$p[4], [int]$p[5], [int]$p[6]) }
      'move' { [JS]::Move([int]$p[1], [int]$p[2]); $out = 'OK' }
      'pos' { $out = [JS]::Pos() }
      'button' { [JS]::Button([int]$p[1], $p[2] -eq 'down'); $out = 'OK' }
      'wheel' { [JS]::Wheel($p[1] -eq 'h', [int]$p[2]); $out = 'OK' }
      'key' { [JS]::KeyEvent([uint16]$p[1], $p[2] -eq 'down'); $out = 'OK' }
      'charvk' { $out = [string][JS]::CharVk([char][int]$p[1]) }
      'type' { [JS]::TypeText([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[1]))); $out = 'OK' }
      default { $out = 'ERR unknown' }
    }
  } catch { $out = 'ERR ' + ($_.Exception.Message -replace '\s+', ' ') }
  [Console]::Out.WriteLine($out); [Console]::Out.Flush()
}`;

let helper = null, queue = [], buffer = '';
function startHelper() {
  if (helper) return helper;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(HELPER, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
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
  child.on('exit', () => { helper = null; buffer = ''; queue.splice(0).forEach((r) => r('ERR helper stopped')); });
  helper = { child, ready };
  return helper;
}
async function cmd(...parts) {
  const h = startHelper(); await h.ready;
  const out = await new Promise((resolve) => { queue.push(resolve); h.child.stdin.write(parts.join(' ') + '\n'); });
  if (out.startsWith('ERR')) throw new Error(out.slice(4) || 'Screen control failed.');
  return out;
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Screenshots are scaled to fit 1280x800 (a good size for Claude); coordinates are scaled back to real pixels.
const MAX_W = 1280, MAX_H = 800;
let real = null;
async function geometry() {
  const [w, h] = (await cmd('size')).split(' ').map(Number);
  const k = Math.min(1, MAX_W / w, MAX_H / h);
  real = { w, h, sw: Math.round(w * k), sh: Math.round(h * k), k };
  return real;
}
const toReal = ([x, y]) => [Math.round(Math.min(Math.max(x, 0), real.sw - 1) / real.k), Math.round(Math.min(Math.max(y, 0), real.sh - 1) / real.k)];

async function screenshot() { const g = await geometry(); return cmd('shot', g.sw, g.sh); }
async function zoom([x0, y0, x1, y1]) {
  if (!real) await geometry();
  const [a, b] = toReal([Math.min(x0, x1), Math.min(y0, y1)]), [c, d] = toReal([Math.max(x0, x1), Math.max(y0, y1)]);
  if (c - a < 4 || d - b < 4) throw new Error('That zoom area is too small.');
  const k = Math.min(real.sw / (c - a), real.sh / (d - b));
  return cmd('zoom', a, b, c, d, Math.max(1, Math.round((c - a) * k)), Math.max(1, Math.round((d - b) * k)));
}

// Key names Claude uses (xdotool style) -> Windows virtual-key codes.
const VK = { return: 0x0d, enter: 0x0d, tab: 0x09, escape: 0x1b, esc: 0x1b, backspace: 0x08, back_space: 0x08, delete: 0x2e, del: 0x2e, space: 0x20, home: 0x24, end: 0x23,
  prior: 0x21, page_up: 0x21, pageup: 0x21, next: 0x22, page_down: 0x22, pagedown: 0x22, left: 0x25, up: 0x26, right: 0x27, down: 0x28, insert: 0x2d,
  ctrl: 0x11, control: 0x11, control_l: 0x11, control_r: 0x11, shift: 0x10, shift_l: 0x10, shift_r: 0x10, alt: 0x12, alt_l: 0x12, alt_r: 0x12, option: 0x12,
  super: 0x5b, super_l: 0x5b, win: 0x5b, windows: 0x5b, cmd: 0x5b, command: 0x5b, meta: 0x5b, menu: 0x5d, caps_lock: 0x14, print: 0x2c, pause: 0x13,
  minus: 0xbd, equal: 0xbb, plus: 0xbb, comma: 0xbc, period: 0xbe, slash: 0xbf, semicolon: 0xba, apostrophe: 0xde, bracketleft: 0xdb, bracketright: 0xdd, backslash: 0xdc, grave: 0xc0,
  volumeup: 0xaf, volumedown: 0xae, volumemute: 0xad, xf86audioraisevolume: 0xaf, xf86audiolowervolume: 0xae, xf86audiomute: 0xad };
for (let i = 1; i <= 24; i++) VK['f' + i] = 0x6f + i;
async function vkOf(name) {
  const n = String(name).trim(), low = n.toLowerCase();
  if (VK[low] != null) return [VK[low]];
  if (/^[a-z0-9]$/i.test(n)) return [n.toUpperCase().charCodeAt(0)];
  if (n.length === 1) {
    const r = Number(await cmd('charvk', n.charCodeAt(0)));
    if (r < 0) throw new Error(`There is no key for "${n}".`);
    return [...(r & 0x100 ? [0x10] : []), r & 0xff];
  }
  throw new Error(`Unknown key "${n}".`);
}
async function combo(text) {
  const keys = []; for (const part of String(text).split('+').filter(Boolean)) keys.push(...(await vkOf(part)));
  if (!keys.length) throw new Error('No key given.');
  return keys;
}
async function holdKeys(keys, fn) {
  for (const k of keys) await cmd('key', k, 'down');
  try { return await fn(); } finally { for (const k of [...keys].reverse()) await cmd('key', k, 'up'); }
}
const BUTTON = { left: 0, right: 1, middle: 2 };
async function click(button, count, coordinate, mods) {
  if (!real) await geometry();
  if (coordinate) { await cmd('move', ...toReal(coordinate)); await pause(40); }
  await holdKeys(mods ? await combo(mods) : [], async () => {
    for (let i = 0; i < count; i++) { await cmd('button', BUTTON[button], 'down'); await cmd('button', BUTTON[button], 'up'); await pause(60); }
  });
}

// Runs one computer-toolset action. Returns text, or { image } for screenshot and zoom.
async function act(name, a = {}) {
  if (!real) await geometry();
  switch (name) {
    case 'screenshot': return { image: await screenshot() };
    case 'zoom': return { image: await zoom(a.region || []) };
    case 'left_click': await click('left', 1, a.coordinate, a.text); return 'OK';
    case 'right_click': await click('right', 1, a.coordinate, a.text); return 'OK';
    case 'middle_click': await click('middle', 1, a.coordinate, a.text); return 'OK';
    case 'double_click': await click('left', 2, a.coordinate, a.text); return 'OK';
    case 'triple_click': await click('left', 3, a.coordinate, a.text); return 'OK';
    case 'mouse_move': await cmd('move', ...toReal(a.coordinate)); return 'OK';
    case 'left_mouse_down': await cmd('button', 0, 'down'); return 'OK';
    case 'left_mouse_up': await cmd('button', 0, 'up'); return 'OK';
    case 'left_click_drag':
      await holdKeys(a.text ? await combo(a.text) : [], async () => {
        await cmd('move', ...toReal(a.start_coordinate)); await cmd('button', 0, 'down'); await pause(80);
        const [x0, y0] = toReal(a.start_coordinate), [x1, y1] = toReal(a.coordinate);
        for (let i = 1; i <= 10; i++) { await cmd('move', Math.round(x0 + ((x1 - x0) * i) / 10), Math.round(y0 + ((y1 - y0) * i) / 10)); await pause(15); }
        await cmd('button', 0, 'up');
      });
      return 'OK';
    case 'cursor_position': { const [x, y] = (await cmd('pos')).split(' ').map(Number); return `X=${Math.round(x * real.k)}, Y=${Math.round(y * real.k)}`; }
    case 'scroll': {
      if (a.coordinate) await cmd('move', ...toReal(a.coordinate));
      const n = Math.max(1, Math.min(30, Number(a.scroll_amount) || 3)), d = a.scroll_direction;
      await holdKeys(a.text ? await combo(a.text) : [], () => cmd('wheel', d === 'left' || d === 'right' ? 'h' : 'v', d === 'down' || d === 'left' ? -n : n));
      return 'OK';
    }
    case 'type': await cmd('type', Buffer.from(String(a.text ?? ''), 'utf8').toString('base64')); return 'OK';
    case 'key': {
      const keys = await combo(a.text), times = Math.max(1, Math.min(100, Number(a.repeat) || 1));
      for (let i = 0; i < times; i++) { await holdKeys(keys, () => pause(20)); await pause(30); }
      return 'OK';
    }
    case 'hold_key': { const keys = await combo(a.text); await holdKeys(keys, () => pause(Math.min(300, Number(a.duration) || 1) * 1000)); return 'OK'; }
    case 'wait': await pause(Math.min(300, Math.max(0, Number(a.duration) || 1)) * 1000); return 'OK';
    default: throw new Error(`Unsupported action ${name}.`);
  }
}

function stop() { if (helper) { helper.child.kill(); helper = null; } }
module.exports = { act, screenshot, geometry, stop };
