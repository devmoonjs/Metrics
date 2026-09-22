const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const { fetchQuotes, searchSymbol } = require('./naver');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 300,
    height: 160,
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    minWidth: 220,
    minHeight: 90,
    frame: false,            // 프레임(타이틀바) 제거
    transparent: true,       // 배경 투명
    alwaysOnTop: true,       // 항상 위에
    resizable: true,
    hasShadow: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  win.loadFile('index.html');
}

ipcMain.handle('fetch-quotes', async (_evt, list) => {
  try { return { ok: true, data: await fetchQuotes(list || []) }; }
  catch (err) { return { ok: false, error: err.message || String(err) }; }
});

ipcMain.handle('search-symbol', async (_evt, query) => {
  try { return { ok: true, items: await searchSymbol(query || '') }; }
  catch (err) { return { ok: false, error: err.message || String(err) }; }
});

// 렌더러에서 창 크기를 콘텐츠에 맞게 조정
ipcMain.on('resize-window', (_evt, { width, height }) => {
  if (win && width && height) win.setSize(Math.round(width), Math.round(height));
});

ipcMain.on('notify', (_evt, { title, body }) => {
  if (!Notification.isSupported()) return;
  try { new Notification({ title: title || 'Metrics', body: body || '', silent: false }).show(); }
  catch (_) { /* ignore */ }
});

ipcMain.on('quit-app', () => app.quit());

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
