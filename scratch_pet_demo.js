/* 친구 캐릭터 상호작용 데모 녹화 (README GIF 원본).
 *
 * 캐릭터 레이어 창을 두 개 띄우고 둘 사이에 로컬 릴레이를 둔다.
 * Supabase 대신 메인 프로세스가 중계할 뿐, 창이 주고받는 move/act/hit
 * 메시지와 그것을 처리하는 코드 경로는 실제 친구 연결과 동일하다.
 * 그중 한 창(나)을 프레임 단위로 캡처한다.
 */
const { app, BrowserWindow, ipcMain, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const { fetchQuotes, searchSymbol } = require('./naver');

const OUT = path.join(__dirname, 'build', 'shots', 'pet');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const W = 720;               // 논리 px. 창 전체가 곧 GIF 프레임이 된다
const H = 210;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 창마다 다른 신원과 관심종목을 준다 */
const PROFILES = new Map();  // webContents.id -> { netId, name, cfg }

ipcMain.handle('fetch-quotes', async (_e, l) => {
  try { return { ok: true, data: await fetchQuotes(l || []) }; }
  catch (e) { return { ok: false, error: String(e) }; }
});
ipcMain.handle('search-symbol', async (_e, q) => ({ ok: true, items: await searchSymbol(q || '') }));
for (const ch of ['resize-window', 'notify', 'quit-app', 'close-pet', 'open-pet',
                  'pet-interactive', 'pet-control', 'copy-text']) ipcMain.on(ch, () => {});

ipcMain.handle('get-pet-config', (e) => (PROFILES.get(e.sender.id) || {}).cfg || { watchlist: [] });
ipcMain.handle('net-status', (e) => ({ status: 'online', id: (PROFILES.get(e.sender.id) || {}).netId }));

/* 로컬 릴레이 — 보낸 창을 빼고 나머지 창에 그대로 전달한다 */
ipcMain.on('net-send', (e, { event, payload }) => {
  const me = PROFILES.get(e.sender.id);
  if (!me) return;
  for (const [wcId] of PROFILES) {
    if (wcId === e.sender.id) continue;
    const wc = webContents.fromId(wcId);
    if (wc && !wc.isDestroyed()) wc.send('pet-net', { t: event, ...payload, id: me.netId });
  }
});

/* ----------------------- 캡처 ----------------------- */
let idx = 0;
async function shoot(win) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, String(idx).padStart(4, '0') + '.png'), img.toPNG());
  idx++;
}
async function hold(win, frames) { for (let i = 0; i < frames; i++) await shoot(win); }

/* 프레임을 찍으면서 ms 만큼 기다린다 */
async function record(win, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) await shoot(win);
}

function mkWindow() {
  return new BrowserWindow({
    width: W, height: H, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
}

async function run() {
  const me = mkWindow();
  const friend = mkWindow();

  PROFILES.set(me.webContents.id, {
    netId: 'ME', name: '나',
    cfg: {
      watchlist: [{ market: 'domestic', queryCode: '005930', code: '005930',
                    name: '삼성전자', nation: 'KOR', avg: 330000 }],
      interval: 30, wander: false,
    },
  });
  PROFILES.set(friend.webContents.id, {
    netId: 'MINJI', name: '민지',
    cfg: {
      watchlist: [{ market: 'domestic', queryCode: '000660', code: '000660',
                    name: 'SK하이닉스', nation: 'KOR', avg: 1800000 }],
      interval: 30, wander: false,
    },
  });

  await me.loadFile('character.html');
  await friend.loadFile('character.html');
  await sleep(1500);

  const jsMe = (c) => me.webContents.executeJavaScript(c);
  const jsFr = (c) => friend.webContents.executeJavaScript(c);

  // 접속 — 실제 연결과 같은 순서로 알린다
  for (const [w, peers] of [[me, [{ id: 'MINJI', name: '민지' }]],
                            [friend, [{ id: 'ME', name: '나' }]]]) {
    w.webContents.send('pet-net', { t: 'status', status: 'online' });
    w.webContents.send('pet-net', { t: 'peers', peers });
  }
  await sleep(600);
  await jsFr(`__pet.world.local.poll()`);     // 접속 후 수익률을 상대에게 알린다
  await jsMe(`__pet.world.local.poll()`);
  await sleep(900);

  // 양쪽을 화면 끝으로 떨어뜨린다. walking 을 켜야 위치가 상대에게 전송된다.
  await jsMe(`(()=>{const a=__pet.world.local; a.x=56; a.y=__pet.floorY(); a.setFacing(1);
    a.setWalking(true); setTimeout(()=>a.setWalking(false), 700);})()`);
  await jsFr(`(()=>{const a=__pet.world.local; a.x=window.innerWidth-136; a.y=__pet.floorY();
    a.setFacing(-1); a.setWalking(true); setTimeout(()=>a.setWalking(false), 700);})()`);
  await sleep(1000);
  await jsMe(`__pet.world.local.setControl(true)`);

  await hold(me, 10);                       // 둘이 멀리 마주 선 상태

  // 내가 몇 걸음 다가간다
  await jsMe(`(()=>{const a=__pet.world.local; a.setFacing(1); a.setWalking(true);
    a._iv=setInterval(()=>{a.x+=3.2;},16);})()`);
  await record(me, 900);
  await jsMe(`(()=>{const a=__pet.world.local; clearInterval(a._iv); a.setWalking(false);})()`);
  await hold(me, 5);

  // 공을 던진다 — 화면을 가로질러 민지에게 날아간다
  await jsMe(`__pet.world.local.throwBall()`);
  await record(me, 2200);                   // 비행 + 명중 + 넉백

  await hold(me, 8);

  // 되받아치기 전에 남은 공을 치운다. 화면에 보이는 공이 민지가 던진 것임을 분명히.
  await jsMe(`__pet.world.balls.forEach(b=>b.dead=true)`);
  await jsFr(`(()=>{__pet.world.balls.forEach(b=>b.dead=true);
    const a=__pet.world.local; a.stunUntil=0; a.el.classList.remove('stunned');})()`);
  await hold(me, 6);

  // 민지가 되받아친다
  await jsFr(`(()=>{const a=__pet.world.local; a.setFacing(-1); a.throwBall();})()`);
  await record(me, 2400);

  await hold(me, 14);                       // 마무리

  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ frames: idx, w: W, h: H }));
  console.log(`캡처 ${idx}프레임 -> ${OUT}`);
  app.quit();
}

app.whenReady().then(run);
