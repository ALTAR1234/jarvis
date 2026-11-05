const { app, BrowserWindow, Menu, shell, session, globalShortcut } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createServer, loadEnv, launchOwnApps } = require('./server');
const { PARTITION: WEB_PARTITION } = require('./core/browser');
const appdock = require('./core/appdock');
let server;
let mainWindow;
let appOrigin;
if (!app.isPackaged) app.setPath('userData', path.join(__dirname, '.appdata'));
function isAppOrigin(value) {
  try { return new URL(value).origin === appOrigin; } catch { return false; }
}
// Only J.A.R.V.I.S.'s own pages get the microphone; only Snapper's recorder page gets the screen.
const isRecorder = (url) => isAppOrigin(url) && new URL(url).pathname === '/rec.html';
function configureMediaPermissions() {
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) => permission === 'media' && isAppOrigin(origin) && (details.mediaType === 'audio' || (details.mediaType === 'video' && isRecorder(contents?.getURL() || ''))));
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const audioOnly = permission === 'media' && isAppOrigin(contents.getURL()) && details.mediaTypes?.includes('audio') && !details.mediaTypes?.includes('video');
    const screen = permission === 'media' && isRecorder(contents.getURL());
    callback(Boolean(audioOnly || screen));
  });
}
// The built-in browser panel: its own persistent session (sign-ins stick between launches), no device
// permissions beyond full screen, a plain Chrome user agent, and only web pages may load in it.
const WEB_PERMS = ['fullscreen', 'clipboard-sanitized-write'];
function configureWebBrowser() {
  const web = session.fromPartition(WEB_PARTITION);
  web.setUserAgent(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`);
  web.setPermissionCheckHandler((_c, permission) => WEB_PERMS.includes(permission));
  web.setPermissionRequestHandler((_c, permission, callback) => callback(WEB_PERMS.includes(permission)));
  const webOnly = (url) => /^https?:\/\//i.test(url) || url === 'about:blank';
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, prefs, params) => {
      // Only the HUD itself may embed a page, and the page gets no Node, no preload and the browser session.
      if (!isAppOrigin(contents.getURL()) || !webOnly(params.src || 'about:blank')) { event.preventDefault(); return; }
      delete prefs.preload;
      Object.assign(prefs, { nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, partition: WEB_PARTITION });
      params.partition = WEB_PARTITION;
    });
    if (contents.getType() !== 'webview') return;
    contents.on('will-navigate', (event, url) => { if (!webOnly(url)) event.preventDefault(); });
    contents.on('will-frame-navigate', (event) => { if (!webOnly(event.url) && !/^(data|blob):/i.test(event.url)) event.preventDefault(); });
    // Links meant for a new tab open in the panel; real pop-ups (such as "Sign in with ...") get a small window.
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (!/^https?:\/\//i.test(url)) return { action: 'deny' };
      if (disposition === 'new-window') return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, parent: mainWindow || undefined, backgroundColor: '#ffffff', webPreferences: { partition: WEB_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false } } };
      contents.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });
  });
}
function startHttpServer() {
  return new Promise((resolve, reject) => {
    server = createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}
async function createWindow() {
  const configPath = path.join(app.getPath('userData'), '.env');
  if (!fs.existsSync(configPath)) fs.copyFileSync(path.join(__dirname, '.env.example'), configPath);
  loadEnv(configPath);
  process.env.ASSISTANT_PREFERENCES_PATH = path.join(app.getPath('userData'), 'preferences.json');
  process.env.ASSISTANT_DATA_DIR = path.join(app.getPath('userData'), 'assistant');
  app.setAppUserModelId('com.jarvis.assistant');
  const port = await startHttpServer();
  appOrigin = `http://127.0.0.1:${port}`;
  configureMediaPermissions();
  configureWebBrowser();
  const prefsPath = process.env.ASSISTANT_PREFERENCES_PATH;
  let prefs = {}; try { prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8')) || {}; } catch {}
  // Full screen covers the Windows taskbar so the HUD works like its own desktop (F11 toggles it).
  mainWindow = new BrowserWindow({ width: 1500, height: 960, minWidth: 900, minHeight: 600, fullscreen: prefs.fullscreen !== false, autoHideMenuBar: true, backgroundColor: '#030913', title: 'J.A.R.V.I.S. Assistant', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, webviewTag: true } });
  mainWindow.setMenuBarVisibility(false);
  globalThis.jarvisHudId = mainWindow.id; // appdock and window controls find the HUD by this
  const saveFullscreen = (value) => { let p = {}; try { p = JSON.parse(fs.readFileSync(prefsPath, 'utf8')) || {}; } catch {} p.fullscreen = value; try { fs.writeFileSync(prefsPath, JSON.stringify(p, null, 2)); } catch {} };
  mainWindow.on('enter-full-screen', () => { mainWindow.setMenuBarVisibility(false); saveFullscreen(true); });
  mainWindow.on('leave-full-screen', () => saveFullscreen(false));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) shell.openExternal(url); return { action: 'deny' }; });
  await mainWindow.loadURL(appOrigin);
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'J.A.R.V.I.S.', submenu: [{ label: 'Open configuration folder', click: () => shell.openPath(app.getPath('userData')) }, { label: 'Open plugins folder', click: () => shell.openPath(path.join(process.env.ASSISTANT_DATA_DIR, 'plugins')) }, { label: 'Reload plugins', click: () => mainWindow?.webContents.executeJavaScript('window.jarvisReloadPlugins && window.jarvisReloadPlugins()') }, { type: 'separator' }, { role: 'quit', label: 'Quit', accelerator: 'CommandOrControl+Q' }] }, { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen', accelerator: 'F11' }] }]));
  mainWindow.on('closed', () => { mainWindow = null; });
  // A docked app follows the HUD: above it when it's focused, hidden while it's minimised.
  mainWindow.on('focus', () => { appdock.raise().catch(() => {}); });
  // The HUD is the desktop while it's up: the Windows taskbar hides in full screen and comes back when the
  // HUD is minimised, windowed or closed; docked apps hide and return with it.
  const shell = () => appdock.setTaskbarHidden(Boolean(mainWindow && !mainWindow.isMinimized() && mainWindow.isFullScreen())).catch(() => {});
  mainWindow.on('minimize', () => { appdock.setHidden('minimized', true).catch(() => {}); shell(); });
  mainWindow.on('restore', () => { appdock.setHidden('minimized', false).catch(() => {}); shell(); });
  mainWindow.on('enter-full-screen', shell); mainWindow.on('leave-full-screen', shell);
  appdock.start({ autoDock: prefs.autoDock !== false, hideTaskbar: prefs.hideTaskbar !== false }).then(shell)
    .then(() => setTimeout(() => launchOwnApps().catch((e) => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'launch-apps.log'), `${new Date().toISOString()} failed: ${e.message}
`); } catch {} }), 4000)); // after the HUD has laid out its app area
  // Ctrl+Shift+Space from anywhere: voice dictation into whatever app has focus.
  if (prefs.dictation !== false) setupDictation();
  // Ctrl+Alt+J from anywhere: Vision. Freeze the screen, box anything, ask about it.
  if (prefs.vision !== false) setupVision();
  // Locker (Ctrl+Alt+L), Snapper (Ctrl+Alt+S, recording Ctrl+Alt+R) and Switcher (Ctrl+Alt+W)
  setupOsWindows(prefs);
  // Ctrl+Shift+J from anywhere: wake J.A.R.V.I.S. (or start a live conversation).
  globalShortcut.register('CommandOrControl+Shift+J', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
    mainWindow.webContents.executeJavaScript('window.jarvisHotkey && window.jarvisHotkey()').catch(() => {});
  });
}
// A small bar at the bottom of the screen that listens and types. It never takes focus, so the
// words land in the app you were using. dictate.js sets the page title back to "idle" when done.
let dictateWin = null;
function setupDictation() {
  const { screen } = require('electron');
  const make = () => {
    const area = screen.getPrimaryDisplay().workArea;
    dictateWin = new BrowserWindow({ width: 380, height: 60, x: Math.round(area.x + (area.width - 380) / 2), y: area.y + area.height - 96, frame: false, transparent: true, resizable: false, movable: false,
      alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, hasShadow: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    dictateWin.setAlwaysOnTop(true, 'screen-saver');
    dictateWin.loadURL(`${appOrigin}/dictate.html`);
    dictateWin.on('page-title-updated', (_e, title) => { if (title === 'idle') dictateWin.hide(); });
    dictateWin.on('closed', () => { dictateWin = null; });
  };
  make();
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (!dictateWin) make();
    if (!dictateWin.isVisible()) dictateWin.showInactive();
    dictateWin.webContents.executeJavaScript('window.dictate && window.dictate.toggle()').catch(() => {});
  });
}
// Vision: the hotkey takes a full-resolution screenshot of the screen the mouse is on, then covers
// that screen with vision.html showing it frozen. The page sets its title to "close" when done.
let visionWin = null;
function setupVision() {
  const { screen, desktopCapturer } = require('electron');
  globalThis.jarvisVision = { shot: null };
  const close = () => { if (visionWin && !visionWin.isDestroyed()) visionWin.hide(); globalThis.jarvisVision.shot = null; };
  globalShortcut.register('CommandOrControl+Alt+J', async () => {
    if (visionWin?.isVisible()) return close();
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size }).catch(() => []);
    const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!source) return;
    globalThis.jarvisVision.shot = source.thumbnail.toJPEG(92);
    if (!visionWin || visionWin.isDestroyed()) {
      visionWin = new BrowserWindow({ frame: false, resizable: false, movable: false, skipTaskbar: true, show: false, backgroundColor: '#000000', alwaysOnTop: true, fullscreenable: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
      visionWin.setAlwaysOnTop(true, 'screen-saver');
      visionWin.on('page-title-updated', (_e, title) => { if (title === 'close') close(); });
      visionWin.on('closed', () => { visionWin = null; });
    }
    visionWin.setBounds(display.bounds);
    await visionWin.loadURL(`${appOrigin}/vision.html?t=${Date.now()}`);
    visionWin.show();
    visionWin.focus();
  });
}
// Inboxer and Helper: J.A.R.V.I.S.'s own app windows, served by its server and kept above the HUD.
const panels = {};
const PANELS = { inboxer: { title: 'Inboxer', width: 1100, height: 820 }, helper: { title: 'Helper', width: 1180, height: 840 }, dreamer: { title: 'Dreamer', width: 1400, height: 900, maximize: true },
  notifier: { title: 'Notifier', width: 560, height: 760 }, controller: { title: 'Controller', width: 900, height: 760 }, filer: { title: 'Filer', width: 1200, height: 820 },
  planner: { title: 'Planner', width: 1200, height: 860 }, noter: { title: 'Noter', width: 1100, height: 800 }, watcher: { title: 'Watcher', width: 1000, height: 780 },
  keeper: { title: 'Keeper', width: 820, height: 720 }, shopper: { title: 'Shopper', width: 980, height: 760 }, updater: { title: 'Updater', width: 900, height: 720 } };
globalThis.jarvisFocusHud = () => { if (!mainWindow) return; if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); };
// ---------- Locker, Snapper, the screen recorder and Switcher: full-screen J.A.R.V.I.S. windows ----------
const overlays = {};
function overlay(name, { bounds, focusable = true, url, onTitle } = {}) {
  let win = overlays[name];
  if (!win || win.isDestroyed()) {
    win = overlays[name] = new BrowserWindow({ frame: false, resizable: false, movable: false, skipTaskbar: true, show: false, backgroundColor: '#000000', alwaysOnTop: true, fullscreenable: false, focusable,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.webContents.on('will-navigate', (e, u) => { if (!isAppOrigin(u)) e.preventDefault(); });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    if (onTitle) win.on('page-title-updated', (_e, t) => onTitle(t, win));
    win.on('closed', () => { delete overlays[name]; });
  }
  if (bounds) win.setBounds(bounds);
  return win.loadURL(`${appOrigin}/${url || name + '.html'}${url?.includes('?') ? '&' : '?'}t=${Date.now()}`).then(() => { win.show(); if (focusable) win.focus(); return win; });
}
function setupOsWindows(prefs) {
  const { screen, desktopCapturer, powerMonitor } = require('electron');
  const here = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  // Locker: covers every screen; unlocking goes through the server, which checks the PIN
  let locked = false;
  globalThis.jarvisLock = async () => {
    if (locked) return;
    locked = true;
    const primary = screen.getPrimaryDisplay();
    await overlay('locker', { bounds: primary.bounds });
    overlays.locker?.setKiosk?.(true);
  };
  globalThis.jarvisUnlock = () => { locked = false; const w = overlays.locker; if (w && !w.isDestroyed()) { w.setKiosk?.(false); w.close(); } };
  globalShortcut.register('CommandOrControl+Alt+L', () => globalThis.jarvisLock());
  // Screen control: J.A.R.V.I.S. steps aside (minimized) and a small banner with a Stop button stays on top.
  // The banner is hidden from screenshots, so Claude never sees or clicks it. Ctrl+Alt+X stops at any time.
  let screenBanner = null, wasMinimized = false;
  globalThis.jarvisScreenControl = async (s) => {
    if (s.running) {
      if (screenBanner) return;
      wasMinimized = Boolean(mainWindow?.isMinimized());
      if (mainWindow && !wasMinimized) { if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false); mainWindow.minimize(); }
      const area = screen.getPrimaryDisplay().workArea;
      screenBanner = overlay('screen-banner', { bounds: { x: Math.round(area.x + (area.width - 560) / 2), y: area.y + 8, width: 560, height: 190 }, focusable: false })
        .then((w) => { w.setContentProtection(true); return w; });
    } else {
      const opening = screenBanner; screenBanner = null;
      if (opening) opening.then((w) => { if (!w.isDestroyed()) w.close(); }).catch(() => {});
      if (mainWindow && !wasMinimized) { mainWindow.restore(); if (prefs.fullscreen !== false) mainWindow.setFullScreen(true); }
    }
  };
  globalShortcut.register('CommandOrControl+Alt+X', () => require('./core/screenagent').stop());
  setInterval(() => {
    let p = {};
    try { p = JSON.parse(fs.readFileSync(process.env.ASSISTANT_PREFERENCES_PATH, 'utf8')) || {}; } catch {}
    if (p.lockIdleMinutes > 0 && !locked && powerMonitor.getSystemIdleTime() >= p.lockIdleMinutes * 60) globalThis.jarvisLock();
  }, 20000);
  if (prefs.lockOnStart) setTimeout(() => globalThis.jarvisLock(), 1500);

  // Snapper: freeze the screen into an editor (crop, draw, highlight, blur, then copy or save)
  globalThis.jarvisSnap = { shot: null };
  globalThis.jarvisSnapClose = () => { const w = overlays.snapper; if (w && !w.isDestroyed()) w.hide(); globalThis.jarvisSnap.shot = null; };
  globalShortcut.register('CommandOrControl+Alt+S', async () => {
    if (overlays.snapper?.isVisible()) return globalThis.jarvisSnapClose();
    const d = here();
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) } }).catch(() => []);
    const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
    if (!src) return;
    globalThis.jarvisSnap.shot = src.thumbnail.toPNG();
    await overlay('snapper', { bounds: d.bounds });
  });
  // the recorder: a small pill that records the screen the mouse is on until you stop it
  globalShortcut.register('CommandOrControl+Alt+R', async () => {
    if (overlays.rec && !overlays.rec.isDestroyed()) return overlays.rec.webContents.executeJavaScript('window.stopRecording && window.stopRecording()').catch(() => {});
    const d = here();
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => []);
    const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
    if (!src) return;
    const w = 210, h = 54;
    await overlay('rec', { bounds: { x: d.workArea.x + d.workArea.width - w - 24, y: d.workArea.y + 24, width: w, height: h }, focusable: false, url: `rec.html?source=${encodeURIComponent(src.id)}`, onTitle: (t, win) => { if (t === 'done') win.close(); } });
    overlays.rec.setContentProtection(true); // the pill itself stays out of the recording
  });
  // Switcher: every open window with a live preview; click or type to switch
  globalShortcut.register('CommandOrControl+Alt+W', async () => {
    if (overlays.switcher?.isVisible()) return overlays.switcher.hide();
    await overlay('switcher', { bounds: here().bounds, onTitle: (t, win) => { if (t === 'close') win.hide(); } });
  });
}
// Claude and ChatGPT as apps: their own websites in their own signed-in sessions, kept between launches
const WEB_APPS = {
  claude: { title: 'Claude', url: 'https://claude.ai/new', hosts: ['claude.ai', 'anthropic.com'] },
  chatgpt: { title: 'ChatGPT', url: 'https://chatgpt.com/', hosts: ['chatgpt.com', 'openai.com', 'oaistatic.com', 'oaiusercontent.com'] },
};
const SIGN_IN_HOSTS = ['accounts.google.com', 'appleid.apple.com', 'login.microsoftonline.com', 'login.live.com', 'auth.openai.com'];
function openWebApp(name) {
  const spec = WEB_APPS[name];
  const open = panels[name];
  if (open && !open.isDestroyed()) { if (open.isMinimized()) open.restore(); open.show(); open.focus(); return; }
  const partition = `persist:app-${name}`;
  const ses = session.fromPartition(partition);
  ses.setUserAgent(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`);
  ses.setPermissionRequestHandler((_c, permission, done) => done(['clipboard-sanitized-write', 'notifications', 'fullscreen', 'media'].includes(permission)));
  const belongs = (url, hosts) => { try { const h = new URL(url).hostname; return hosts.some((x) => h === x || h.endsWith('.' + x)); } catch { return false; } };
  const win = new BrowserWindow({ width: 1200, height: 860, title: spec.title, parent: mainWindow || undefined, autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (belongs(url, [...spec.hosts, ...SIGN_IN_HOSTS])) return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, parent: win, webPreferences: { partition, sandbox: true, contextIsolation: true } } };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!belongs(url, [...spec.hosts, ...SIGN_IN_HOSTS])) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.on('closed', () => { delete panels[name]; });
  panels[name] = win;
  win.loadURL(spec.url);
}
globalThis.jarvisOpenPanel = async (name) => {
  if (WEB_APPS[name]) return openWebApp(name);
  const spec = PANELS[name];
  if (!spec || !appOrigin) return;
  const open = panels[name];
  if (open && !open.isDestroyed()) { if (open.isMinimized()) open.restore(); open.show(); open.focus(); return; }
  const win = new BrowserWindow({ width: spec.width, height: spec.height, minWidth: 720, minHeight: 560, title: spec.title, parent: mainWindow || undefined, autoHideMenuBar: true, backgroundColor: '#030913',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!isAppOrigin(url)) e.preventDefault(); });
  win.on('closed', () => { delete panels[name]; });
  panels[name] = win;
  if (spec.maximize) win.maximize();
  await win.loadURL(`${appOrigin}/${name}.html`);
};
app.whenReady().then(createWindow).catch((error) => { console.error('Could not start the assistant app:', error.message); app.quit(); });
app.on('window-all-closed', () => app.quit());
// Hand a docked app back its own window before quitting, so it keeps running normally.
// Closing the HUD puts Windows back to normal: every docked app gets its own window again and the taskbar returns.
let releasing = false;
app.on('before-quit', (event) => {
  if (!releasing) {
    event.preventDefault(); releasing = true;
    appdock.shutdown().catch(() => {}).finally(() => app.quit());
    return;
  }
  globalShortcut.unregisterAll(); if (server) server.close();
});
