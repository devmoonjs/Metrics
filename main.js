const { app, BrowserWindow, ipcMain, Notification, screen, clipboard } = require('electron');
const path = require('path');
const { fetchQuotes, searchSymbol } = require('./naver');
const realtime = require('./realtime');

let win;
let petWin;          // 캐릭터 레이어 (화면 전체를 덮는 투명 창)
let petCfg = {};     // 렌더러가 넘겨준 watchlist/표시 설정
let cursorTimer = null;

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

/* ----------------------- 캐릭터 레이어 ----------------------- */
function createPetWindow() {
  // workArea 를 쓰면 메뉴바/독을 피해서 캐릭터가 '바닥'을 제대로 딛는다.
  const { workArea } = screen.getPrimaryDisplay();

  petWin = new BrowserWindow({
    ...workArea,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  petWin.setAlwaysOnTop(true, 'floating');
  // 창 전체가 클릭을 통과시킨다. 캐릭터 위에 커서가 오면 렌더러가 잠시 꺼 달라고 알린다.
  petWin.setIgnoreMouseEvents(true, { forward: true });
  petWin.loadFile('character.html');

  // 커서 위치를 렌더러에 흘려보낸다. 클릭 통과 상태에서는 mousemove 가 오지 않기 때문.
  cursorTimer = setInterval(() => {
    if (!petWin || petWin.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const b = petWin.getBounds();
    petWin.webContents.send('pet-cursor', { x: p.x - b.x, y: p.y - b.y });
  }, 60);

  petWin.on('closed', () => {
    clearInterval(cursorTimer);
    cursorTimer = null;
    petWin = null;
    if (win && !win.isDestroyed()) win.webContents.send('pet-closed');
  });
}

ipcMain.on('open-pet', (_evt, config) => {
  petCfg = config || {};
  if (petWin && !petWin.isDestroyed()) {
    petWin.webContents.send('pet-config', petCfg);
    return;
  }
  createPetWindow();
});

ipcMain.on('close-pet', () => {
  if (petWin && !petWin.isDestroyed()) petWin.close();
});

ipcMain.handle('get-pet-config', () => petCfg);

ipcMain.on('pet-interactive', (_evt, on) => {
  if (petWin && !petWin.isDestroyed()) petWin.setIgnoreMouseEvents(!on, { forward: true });
});

// 조종 모드일 때만 레이어 창이 키보드 포커스를 가진다.
// 평소에는 focusable: false 라 다른 작업에 끼어들지 않는다.
ipcMain.on('pet-control', (_evt, on) => {
  if (!petWin || petWin.isDestroyed()) return;
  if (on) {
    petWin.setFocusable(true);
    petWin.focus();
  } else {
    petWin.blur();
    petWin.setFocusable(false);
  }
});

/* ----------------------- 친구 연결 (Realtime) ----------------------- */
/* 접속은 메인에서만 한다. 렌더러 CSP 가 외부 WebSocket 을 막기 때문. */
function toPet(msg) {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet-net', msg);
  if (win && !win.isDestroyed()) win.webContents.send('pet-net', msg);
}

ipcMain.handle('net-connect', (_evt, { invite, name }) =>
  realtime.connect({ invite, name }, toPet));

ipcMain.on('net-disconnect', () => realtime.disconnect());

ipcMain.on('net-send', (_evt, { event, payload }) => realtime.send(event, payload));

ipcMain.handle('net-status', () => ({ status: realtime.getStatus(), id: realtime.getId() }));

// 초대 코드 만들기 — 방을 새로 파거나, 기존 코드의 방을 유지한다
ipcMain.handle('net-make-invite', (_evt, { url, key, room }) => {
  try {
    return { ok: true, code: realtime.makeInvite({ url, key, room: room || realtime.randomRoom() }) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

// navigator.clipboard 는 창이 포커스를 가져야만 동작해서 불안정하다. 메인에서 쓴다.
ipcMain.on('copy-text', (_evt, text) => clipboard.writeText(String(text || '')));

ipcMain.on('quit-app', () => app.quit());

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { clearInterval(cursorTimer); realtime.disconnect(); });
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
