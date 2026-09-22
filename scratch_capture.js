// 다중 종목(한국+미국) + 검색 + 테마를 실제 구동·검증하고 PNG 캡처
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { fetchQuotes, searchSymbol } = require('./naver');

// main.js 와 동일한 IPC 핸들러 등록
ipcMain.handle('fetch-quotes', async (_e, list) => { try { return { ok: true, data: await fetchQuotes(list || []) }; } catch (e) { return { ok: false, error: String(e) }; } });
ipcMain.handle('search-symbol', async (_e, q) => { try { return { ok: true, items: await searchSymbol(q || '') }; } catch (e) { return { ok: false, error: String(e) }; } });
ipcMain.on('resize-window', (e, { width, height }) => { const w = BrowserWindow.fromWebContents(e.sender); if (w && width && height) w.setSize(Math.round(width), Math.round(height)); });
ipcMain.on('quit-app', () => {});

const OUT = path.join(__dirname, 'build', 'shots', 'raw');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 시드 watchlist (한국 2 + 미국 1, 평단·목표가 포함)
const SEED = {
  watchlist: [
    { market: 'domestic', queryCode: '005930', code: '005930', reutersCode: '005930', name: '삼성전자', nation: 'KOR', avg: 330000, target: 360000 },
    { market: 'domestic', queryCode: '000660', code: '000660', reutersCode: '000660', name: 'SK하이닉스', nation: 'KOR', avg: null, target: null },
    { market: 'world', queryCode: 'AAPL.O', code: 'AAPL', reutersCode: 'AAPL.O', name: '애플', nation: 'USA', avg: 270, target: 300 },
  ],
  interval: '30', theme: 'minimal', hideName: false, hideCode: false, biz: false,
  surgeOn: true, surgePct: '5', osNotify: true,
};

async function capture(win, name) {
  await sleep(300);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
  console.log('captured', name, win.getSize());
}

async function run() {
  const win = new BrowserWindow({
    width: 300, height: 200, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile('index.html');
  const js = (c) => win.webContents.executeJavaScript(c);

  // --- 기능 검증 (IPC 직접 호출) ---
  const s1 = await js(`window.api.searchSymbol('apple').then(r=>JSON.stringify(r.items&&r.items[0]))`);
  console.log('SEARCH apple ->', s1);
  const s2 = await js(`window.api.searchSymbol('삼성').then(r=>JSON.stringify(r.items&&r.items[0]))`);
  console.log('SEARCH 삼성 ->', s2);
  const q = await js(`window.api.fetchQuotes([{queryCode:'005930',market:'domestic'},{queryCode:'AAPL.O',market:'world'}]).then(r=>JSON.stringify(Object.keys(r.data)))`);
  console.log('QUOTES keys ->', q);

  // --- watchlist 시드 후 리로드 ---
  await js(`localStorage.setItem('cfg', ${JSON.stringify(JSON.stringify(SEED))})`);
  await win.webContents.reload();
  await sleep(600);

  // 설정 화면 (watchlist 채워진 상태)
  await capture(win, '01-settings');

  // 검색 드롭다운 예시
  await js(`searchInput.value='apple'; doSearch();`);
  await sleep(900);
  await capture(win, '01b-search');
  await js(`searchInput.value=''; searchResults.classList.add('hidden'); fitWindow();`);

  // 테마별 시세 화면 (3종목)
  for (const [t, n] of [['minimal','02'],['terminal','03'],['build','04'],['sheet','05'],['chat','06']]) {
    await js(`stopWatching(); bizMode.checked=false; hideName.checked=false; hideCode.checked=false; themeSelect.value='${t}'; startWatching();`);
    await sleep(2000);
    const txt = await js(`tickerBody.innerText`);
    console.log(`RENDER ${t}:`, JSON.stringify(txt).slice(0, 160));
    await capture(win, `${n}-${t}`);
  }

  // 비즈니스 위장 (스프레드시트)
  await js(`stopWatching(); bizMode.checked=true; hideName.checked=true; hideCode.checked=true; themeSelect.value='sheet'; startWatching();`);
  await sleep(2000);
  await capture(win, '07-business-sheet');

  console.log('ALL DONE');
  app.quit();
}

app.whenReady().then(run);
