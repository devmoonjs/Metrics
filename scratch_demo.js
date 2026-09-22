// 실제 앱을 조작하며 프레임 단위로 녹화 (README 데모 GIF 원본).
// 검색 → 종목 선택 → 평단가/목표가 입력 → 시작 → 시세 표시 흐름을 사람이 쓰듯 재현한다.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { fetchQuotes, searchSymbol } = require('./naver');

ipcMain.handle('fetch-quotes', async (_e, list) => { try { return { ok: true, data: await fetchQuotes(list || []) }; } catch (e) { return { ok: false, error: String(e) }; } });
ipcMain.handle('search-symbol', async (_e, q) => { try { return { ok: true, items: await searchSymbol(q || '') }; } catch (e) { return { ok: false, error: String(e) }; } });
ipcMain.on('resize-window', (e, { width, height }) => { const w = BrowserWindow.fromWebContents(e.sender); if (w && width && height) w.setSize(Math.round(width), Math.round(height)); });
ipcMain.on('quit-app', () => {});

const OUT = path.join(__dirname, 'build', 'shots', 'demo');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2); // easeInOutQuad

let win, idx = 0;
const meta = [];
let cursor = { x: 150, y: 180 };

const js = (code) => win.webContents.executeJavaScript(code);

async function shoot(click = false) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, String(idx).padStart(4, '0') + '.png'), img.toPNG());
  const [w, h] = win.getSize();
  meta.push({ i: idx, x: cursor.x, y: cursor.y, w, h, click });
  idx++;
}

async function hold(frames) { for (let i = 0; i < frames; i++) await shoot(); }

// 요소 중심으로 커서 이동 (CSS px 기준)
async function moveTo(sel, frames = 12, dx = 0, dy = 0) {
  const r = JSON.parse(await js(
    `(()=>{const e=document.querySelector(${JSON.stringify(sel)});const b=e.getBoundingClientRect();
      return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2});})()`));
  const to = { x: r.x + dx, y: r.y + dy };
  const from = { ...cursor };
  for (let s = 1; s <= frames; s++) {
    const t = ease(s / frames);
    cursor = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    await shoot();
  }
}

// 클릭 연출: 눌린 프레임 1장 + 여운
async function click(frames = 2) {
  await shoot(true);
  for (let i = 1; i < frames; i++) await shoot();
}

// 한 글자씩 입력
async function type(sel, text, perChar = 2) {
  for (let i = 1; i <= text.length; i++) {
    const v = text.slice(0, i);
    await js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});
      e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    for (let f = 0; f < perChar; f++) await shoot();
  }
}

async function run() {
  win = new BrowserWindow({
    width: 300, height: 200, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile('index.html');

  // 깨끗한 첫 실행 상태
  await js(`localStorage.clear()`);
  await win.webContents.reload();
  await sleep(700);

  // 마우스가 없으므로 :hover 를 클래스로 흉내
  await js(`(()=>{const s=document.createElement('style');
    s.textContent='.sr-item.demo-hover{background:rgba(76,141,255,0.22)}.primary.demo-hover{background:#4480ff}';
    document.head.appendChild(s);})()`);

  await hold(8);                                  // 빈 설정 패널
  await moveTo('#searchInput', 14);               // 검색창으로 이동
  await click();
  await js(`document.querySelector('#searchInput').focus()`);
  await hold(3);

  await type('#searchInput', '삼성전자', 3);      // 한 글자씩 입력
  await hold(4);
  await sleep(700);                               // 디바운스 + 검색 응답 대기
  await hold(6);                                  // 드롭다운 등장

  await moveTo('.sr-item', 12);                   // 첫 결과로 이동
  await js(`document.querySelector('.sr-item').classList.add('demo-hover')`);
  await hold(4);
  await click(2);
  await js(`(()=>{const el=document.querySelector('.sr-item');
    if(el) searchResults.dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`);
  await js(`(()=>{const items=searchResults._items; if(items) addSymbol(items[0]);})()`);
  await hold(8);                                  // 목록에 추가됨

  await moveTo('.wl-avg', 12);                    // 평단가 입력
  await click();
  await type('.wl-avg', '330000', 2);
  await js(`document.querySelector('.wl-avg').dispatchEvent(new Event('change',{bubbles:true}))`);
  await hold(4);

  await moveTo('.wl-target', 12);                 // 목표가 입력
  await click();
  await type('.wl-target', '360000', 2);
  await js(`document.querySelector('.wl-target').dispatchEvent(new Event('change',{bubbles:true}))`);
  await hold(6);

  await moveTo('#startBtn', 14);                  // 시작
  await js(`document.querySelector('#startBtn').classList.add('demo-hover')`);
  await hold(4);
  await click(2);
  await js(`startWatching()`);
  await sleep(1600);                              // 첫 시세 도착
  await hold(20);                                 // 시세 화면 유지

  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta));
  console.log(`캡처 ${idx}프레임 -> ${OUT}`);
  app.quit();
}

app.whenReady().then(run);
