import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createMainWindow } from './services/windowManager.js';
import { registerAllIpc } from './ipc/registerIpc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = Boolean(process.defaultApp || process.argv.includes('--dev') || process.env.OPENLAUNCHER_DEV === '1');

// Only load dotenv during development to save production cold startup time
if (isDev) {
  import('dotenv').then(dotenv => dotenv.default.config()).catch(() => {});
}

app.setName('DREADLAND LAUNCHER');

// Turn off Chromium services the launcher never uses (sync, translate, autofill, crash upload...).
// Memory, GC, renderer-process, GPU and timer-throttling flags were removed on purpose: they kept
// the hidden window burning ~50% of a core and a 128 MB heap cap risked GC thrash / OOM. Measure
// before adding any of them back.
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-speech-api');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-print-preview');
app.commandLine.appendSwitch('disable-features', 'Autofill,InterestFeedContentSuggestions,MediaSessionService,Translate,PreloadMediaEngagementData');

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const mainWin = BrowserWindow.getAllWindows()[0];
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });
}

async function init() {
  Menu.setApplicationMenu(null);

  registerAllIpc();

  await createMainWindow({
    isDev,
    electronDir: __dirname,
  });
  // The launcher update check runs from the UI once it has loaded (src/App.jsx), so the
  // "update available" dialog can never be missed and GitHub is asked only once per start.
}

app.whenReady().then(init);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow({ isDev, electronDir: __dirname });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});