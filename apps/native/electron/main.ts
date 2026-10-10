import { startAccountSync, stopAccountSync, syncAccount } from './account/sync';
import { app, BrowserWindow, Menu, nativeImage, nativeTheme, session, shell, Tray } from 'electron';
import path from 'node:path';
import { initDb, db } from './core/db';
import { bus } from './core/bus';
import { getSettings, onSettings } from './core/settings';
import { callHandler, registerIpc } from './ipc';
import { startRemote, stopRemote } from './remote';
import { discoverAll, healthCheckSample, loadRegistry } from './providers/registry';
import { cancelAll } from './agents/orchestrator';
import { stopAllChats } from './chat/service';
import { cancelExperiment } from './core/experiments';
import { stopAll } from './tools/process';
import { stopAllStatic } from './tools/staticServer';
import { closeBrowser } from './browser/browser';
import { workspaceRoot } from './projects/projects';
import type { Project, Run, Task } from '../shared/types';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
/** Tray mode: closing the window only hides it; Quit (tray menu) is the only way to really exit. */
let isQuitting = false;
const isSmoke = process.argv.includes('--smoke');
const isRemoteSelfTest = process.argv.includes('--remote-self-test');
const isDiagnosticHost = process.argv.includes('--remote-diagnostic-host');

if (!isRemoteSelfTest && !isDiagnosticHost && !app.requestSingleInstanceLock() && !isSmoke && !process.argv.includes('--account-sync-only')) app.quit();
function showWindow() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
app.on('second-instance', () => { showWindow(); });
app.setAppUserModelId('ai.swarm.desktop');
if (process.env.SWARM_USER_DATA) app.setPath('userData', process.env.SWARM_USER_DATA);

const resources = () => (app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(__dirname, '..', '..', 'resources'));

function createWindow() {
  const s = getSettings();
  const dark = s.appearance.theme === 'dark' || (s.appearance.theme === 'system' && nativeTheme.shouldUseDarkColors);
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 680, minHeight: 640,
    show: false,
    title: 'SWARM',
    icon: path.join(resources(), process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    backgroundColor: dark ? '#0d0d0f' : '#fbfbfa',
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32' ? { color: dark ? '#0d0d0f' : '#fbfbfa', symbolColor: dark ? '#e8e8ea' : '#2a2a2e', height: 40 } : undefined,
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
      devTools: true,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && getSettings().computer.openExternal) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
  // Guest <webview> (browser preview) hardening.
  win.webContents.on('will-attach-webview', (_e, prefs, params) => {
    delete (prefs as Record<string, unknown>).preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    if (!/^https?:\/\//.test(params.src ?? '') && params.src !== 'about:blank') params.src = 'about:blank';
  });
  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('close', (e) => {
    if (!isQuitting && tray && !isSmoke) { e.preventDefault(); win?.hide(); }
  });
  win.on('closed', () => { win = null; });
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(resources(), process.platform === 'win32' ? 'icon.ico' : 'icon.png'));
    if (img.isEmpty()) return;
    tray = new Tray(process.platform === 'win32' ? img : img.resize({ width: 18, height: 18 }));
    tray.setToolTip('SWARM');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open SWARM', click: () => showWindow() },
      { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.on('click', () => showWindow());
    tray.on('double-click', () => showWindow());
  } catch (e) { console.error('tray failed', e); tray = null; }
}

function retention() {
  const s = getSettings();
  const d = db();
  d.prepare('DELETE FROM events WHERE ts < ?').run(Date.now() - s.logs.retentionDays * 86400_000);
  d.prepare('DELETE FROM cache WHERE ts < ?').run(Date.now() - 30 * 86400_000);
  const cutoff = Date.now() - s.memory.retentionDays * 86400_000;
  d.prepare('DELETE FROM usage WHERE ts < ?').run(cutoff);
  d.prepare('DELETE FROM notifications WHERE ts < ?').run(cutoff);
}

/** Runs that were active when SWARM last exited are marked as interrupted (never left "running"). */
function recoverInterrupted() {
  const d = db();
  const running = d.list<Run>('runs', "json_extract(data, '$.status') = 'running'");
  for (const r of running) {
    r.status = 'cancelled'; r.endedAt = r.endedAt ?? Date.now(); r.summary = 'Interrupted: SWARM was closed while this run was active';
    for (const g of r.gates) if (g.status === 'running' || g.status === 'pending') { g.status = 'skipped'; g.detail = 'Interrupted'; }
    d.put('runs', r.id, r, { project_id: r.projectId, started_at: r.startedAt });
    for (const t of d.list<Task>('tasks', 'run_id = ?', [r.id])) {
      if (t.status === 'running' || t.status === 'waiting') d.put('tasks', t.id, { ...t, status: 'cancelled', endedAt: t.endedAt ?? Date.now() }, { run_id: t.runId, created_at: t.createdAt });
    }
  }
  for (const p of d.list<Project>('projects', "json_extract(data, '$.status') = 'running'")) d.put('projects', p.id, { ...p, status: 'idle' }, { updated_at: p.updatedAt });
}

let discoveryTimer: NodeJS.Timeout | null = null;
function scheduleDiscovery() {
  if (discoveryTimer) clearInterval(discoveryTimer);
  const mins = getSettings().routing.discoveryIntervalMin;
  if (mins > 0) discoveryTimer = setInterval(() => { void discoverAll(); }, mins * 60_000);
}

app.whenReady().then(async () => {
  if (isDiagnosticHost) {
    const { diagnosticHost } = await import('./remote/diagnosticHost');
    await diagnosticHost();
    return;
  }
  if (isRemoteSelfTest) {
    const { remoteSelfTest } = await import('./remote/selfTest');
    app.exit(await remoteSelfTest() ? 0 : 1);
    return;
  }
  initDb(path.join(app.getPath('userData'), 'swarm.db'));
  if(process.argv.includes('--account-sync-only')) {
    try {await startAccountSync();const status=await syncAccount();console.log(JSON.stringify({account:status.account,connected:status.connected,lastSync:status.lastSync,error:status.error,chats:db().list('conversations').length}));stopAccountSync();db().close();app.exit(status.error?1:0);}catch{app.exit(1);}return;
  }
  const s = getSettings();
  bus.debug = s.logs.level === 'debug';
  bus.persist = s.privacy.storeLogs;
  try { retention(); } catch (e) { console.error('retention failed', e); }
  recoverInterrupted();
  workspaceRoot();
  loadRegistry();
  bus.attach(
    (events) => win?.webContents.send('events', events),
    (channel, payload) => win?.webContents.send(channel, payload),
  );
  registerIpc(() => win);
  void startAccountSync().catch(() => console.error('Account connection could not start.'));
  startRemote({ invoke: callHandler, send: (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); } });
  // Content Security Policy for the app renderer (guest webviews are separate).
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (details.url.startsWith('file://')) {
      cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; img-src 'self' data: blob: https://img.clerk.com https://images.clerk.dev; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self'"] } });
    } else cb({ responseHeaders: details.responseHeaders });
  });
  createTray();
  createWindow();
  onSettings(() => scheduleDiscovery());
  scheduleDiscovery();
  // Model discovery + health checks run in the background; the UI is usable immediately.
  if (!isSmoke) {
    void discoverAll().then(() => { if (getSettings().routing.healthCheckOnStartup) return healthCheckSample(4); });
  }
});

let cleaned = false;
async function cleanup() {
  if (isRemoteSelfTest) return;
  if (cleaned) return;
  cleaned = true;
  stopAccountSync();
  await stopRemote().catch(() => undefined); // closes the bridge and removes router port mappings
  cancelExperiment();
  cancelAll();
  stopAllChats();
  stopAll();
  stopAllStatic();
  await (await import('./runtime/manager')).runtimeManager.dispose();
  await closeBrowser();
  bus.flush();
  db().close();
}

app.on('before-quit', (e) => {
  isQuitting = true;
  tray?.destroy(); tray = null;
  if (cleaned) return;
  e.preventDefault();
  void cleanup().finally(() => app.exit(0));
});
// Tray mode: the app keeps running (agents, remote bridge) without a window. Quit from the tray menu.
app.on('window-all-closed', () => { if (isSmoke || !tray) app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); else showWindow(); });
