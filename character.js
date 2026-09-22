/* 캐릭터 레이어 렌더러.
   화면 전체를 덮는 투명 창에서 캐릭터를 걸어다니게 하고,
   머리 위 말풍선에 대표 종목의 평단가와 수익률을 띄운다. */

const pet = document.getElementById('pet');
const bubble = document.getElementById('bubble');
const bubName = document.getElementById('bubName');
const bubPrice = document.getElementById('bubPrice');
const bubPnl = document.getElementById('bubPnl');

/* ----------------------- 설정 ----------------------- */
const PET_W = 80;
const PET_H = 72;
const SPEED = 46;            // 자동 산책 속도 px/s
const CTRL_SPEED = 190;      // 방향키 조종 속도 px/s
const GRAVITY = 2400;        // px/s^2
const JUMP_V = 760;          // 점프 초기 속도 px/s
const FLOOR_GAP = 8;         // 화면 아래에서 띄울 여백

let cfg = { watchlist: [], interval: 30, biz: false, hideName: false, wander: false };
let quote = null;            // 대표 종목 시세
let target = null;           // 대표 종목 watchlist 항목

/* ----------------------- 상태 ----------------------- */
let x = 120;
let y = 0;
let dir = 1;                 // 1 오른쪽, -1 왼쪽
let goal = null;             // 걸어갈 목표 x
let restUntil = 0;
let vy = 0;                  // 수직 속도 (점프/낙하)
let onGround = true;
let dragging = false;
let dragDX = 0;
let dragDY = 0;
let interactive = false;
let lastTs = 0;

/* 조종 모드: 캐릭터를 클릭하면 켜지고, 방향키로 직접 움직인다.
   Esc / 다시 클릭 / 다른 창으로 포커스가 넘어가면 꺼진다. */
let control = false;
const keys = new Set();
let downAt = 0;
let downPos = null;
let moved = false;

const floorY = () => window.innerHeight - PET_H - FLOOR_GAP;
const clampX = (v) => Math.max(0, Math.min(window.innerWidth - PET_W, v));

/* ----------------------- 시세 ----------------------- */
const LABELS = {
  avg: { normal: '평단', biz: 'baseline' },
  closed: { normal: '장마감', biz: 'synced' },
};
const lbl = (k) => LABELS[k][cfg.biz ? 'biz' : 'normal'];

function setMood(cls) {
  pet.classList.remove('mood-up', 'mood-down');
  if (cls) pet.classList.add(cls);
}

function renderBubble() {
  if (!target) {
    bubble.classList.add('hidden');
    return;
  }
  bubble.classList.remove('hidden');

  const cur = target.market === 'world' ? '$' : '';
  if (!quote) {
    bubName.textContent = cfg.hideName ? '—' : (target.name || target.queryCode);
    bubPrice.textContent = cur + '—';
    bubPrice.className = 'bub-price';
    bubPnl.textContent = '';
    setMood(null);
    return;
  }

  const closed = quote.marketStatus && quote.marketStatus !== 'OPEN';
  bubName.textContent = (cfg.hideName ? '' : (quote.name || target.name || '')) +
                        (closed ? ` · ${lbl('closed')}` : '');
  bubPrice.textContent = cur + (quote.price || '—');
  bubPrice.className = 'bub-price ' +
    (quote.direction === 'up' ? 'up' : quote.direction === 'down' ? 'down' : '');

  // 평단가가 있으면 수익률을, 없으면 당일 등락률을 표시한다
  if (target.avg && quote.priceRaw) {
    const pl = ((quote.priceRaw - target.avg) / target.avg) * 100;
    const sign = pl > 0 ? '+' : '';
    bubPnl.textContent = `${lbl('avg')} ${Number(target.avg).toLocaleString()} ${sign}${pl.toFixed(2)}%`;
    bubPnl.className = 'bub-pnl ' + (pl > 0 ? 'up' : pl < 0 ? 'down' : '');
    setMood(pl > 0 ? 'mood-up' : pl < 0 ? 'mood-down' : null);
  } else {
    bubPnl.textContent = quote.ratio ? `${quote.ratio}%` : '';
    bubPnl.className = 'bub-pnl ' +
      (quote.direction === 'up' ? 'up' : quote.direction === 'down' ? 'down' : '');
    setMood(quote.direction === 'up' ? 'mood-up'
          : quote.direction === 'down' ? 'mood-down' : null);
  }
}

let pollTimer = null;

async function poll() {
  if (!target) return;
  const res = await window.api.fetchQuotes([{ queryCode: target.queryCode, market: target.market }]);
  if (res && res.ok) {
    const next = res.data[target.queryCode];
    if (next) {
      // 가격이 올라가는 순간 잠깐 폴짝 뛴다
      if (quote && next.priceRaw != null && quote.priceRaw != null &&
          next.priceRaw > quote.priceRaw) cheer();
      quote = next;
    }
  }
  renderBubble();
}

function cheer() {
  pet.classList.remove('cheer');
  void pet.offsetWidth;            // 리플로우로 애니메이션 재시작
  pet.classList.add('cheer');
  setTimeout(() => pet.classList.remove('cheer'), 1900);
}

function startPolling() {
  clearInterval(pollTimer);
  poll();
  pollTimer = setInterval(poll, Math.max(10, Number(cfg.interval) || 30) * 1000);
}

/* ----------------------- 이동 ----------------------- */
function setWalking(on) { pet.classList.toggle('walking', on); }
function setFacing(d) { dir = d; pet.classList.toggle('face-left', d < 0); }

function pickGoal(ts) {
  // 지금 위치에서 최소 90px 떨어진 곳을 고른다. 제자리걸음 방지.
  const w = window.innerWidth - PET_W;
  let g;
  let guard = 0;
  do {
    g = Math.random() * w;
    guard++;
  } while (Math.abs(g - x) < 90 && guard < 12);
  goal = g;
  setFacing(g > x ? 1 : -1);
  setWalking(true);
  void ts;
}

function jump() {
  if (!onGround) return;
  vy = -JUMP_V;
  onGround = false;
}

function tick(ts) {
  const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0;
  lastTs = ts;

  if (dragging) {
    vy = 0;                                   // 잡고 있는 동안은 중력 정지
  } else {
    if (control) {
      // 방향키 조종
      let ax = 0;
      if (keys.has('left')) ax -= 1;
      if (keys.has('right')) ax += 1;
      if (ax) {
        x += CTRL_SPEED * dt * ax;
        setFacing(ax);
        setWalking(true);
      } else {
        setWalking(false);
      }
    } else if (cfg.wander) {
      // 자동 산책 (기본은 꺼져 있다)
      if (goal === null) {
        if (ts >= restUntil) pickGoal(ts);
      } else {
        const step = SPEED * dt;
        if (Math.abs(goal - x) <= step) {
          x = goal;
          goal = null;
          setWalking(false);
          restUntil = ts + 1200 + Math.random() * 3800;   // 1.2~5초 쉰다
        } else {
          x += step * dir;
        }
      }
    } else {
      goal = null;
      setWalking(false);
    }

    // 중력 — 점프하거나 위에서 놓으면 바닥으로 떨어진다
    vy += GRAVITY * dt;
    y += vy * dt;
    const fy = floorY();
    if (y >= fy) { y = fy; vy = 0; onGround = true; }
    else onGround = false;
  }

  x = clampX(x);
  pet.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  requestAnimationFrame(tick);
}

/* ----------------------- 조종 모드 ----------------------- */
function setControl(on) {
  if (control === on) return;
  control = on;
  keys.clear();
  pet.classList.toggle('controlled', on);
  if (!on) setWalking(false);
  // 키 입력을 받으려면 레이어 창이 포커스를 가져야 한다
  window.api.setPetControl(on);
}

const KEYMAP = {
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
};

window.addEventListener('keydown', (e) => {
  if (!control) return;
  if (e.key === 'Escape') { setControl(false); return; }
  if (e.key === 'ArrowUp' || e.key === ' ' || e.key === 'w' || e.key === 'W') {
    jump();
    e.preventDefault();
    return;
  }
  const k = KEYMAP[e.key];
  if (k) { keys.add(k); e.preventDefault(); }
});

window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.key];
  if (k) keys.delete(k);
});

// 다른 창으로 포커스가 넘어가면 조종을 놓는다
window.addEventListener('blur', () => setControl(false));

/* ----------------------- 마우스 ----------------------- */
/* 창 전체가 클릭을 통과시키므로(setIgnoreMouseEvents), 커서가 캐릭터 위에 올 때만
   메인 프로세스에 알려 마우스 입력을 잠시 받는다. */
function hitTest(px, py) {
  const pad = 10;
  const bx = x - pad;
  const by = y - pad;
  return px >= bx && px <= bx + PET_W + pad * 2 &&
         py >= by && py <= by + PET_H + pad * 2;
}

window.api.onCursor(({ x: cx, y: cy }) => {
  if (dragging) return;
  const over = hitTest(cx, cy);
  if (over === interactive) return;
  interactive = over;
  pet.classList.toggle('hovered', over);
  window.api.setPetInteractive(over);
});

/* 짧게 누르면 클릭(조종 모드 토글), 끌면 드래그로 본다. */
const CLICK_SLOP = 5;        // px
const CLICK_MS = 350;

pet.addEventListener('mousedown', (e) => {
  if (e.target.closest('.tool')) return;
  dragging = true;
  moved = false;
  downAt = performance.now();
  downPos = { x: e.clientX, y: e.clientY };
  goal = null;
  setWalking(false);
  dragDX = e.clientX - x;
  dragDY = e.clientY - y;
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  if (downPos && (Math.abs(e.clientX - downPos.x) > CLICK_SLOP ||
                  Math.abs(e.clientY - downPos.y) > CLICK_SLOP)) moved = true;
  x = clampX(e.clientX - dragDX);
  y = Math.max(0, Math.min(window.innerHeight - PET_H, e.clientY - dragDY));
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  vy = 0;
  const quick = performance.now() - downAt < CLICK_MS;
  if (!moved && quick) setControl(!control);   // 제자리 클릭 → 조종 모드 토글
  restUntil = performance.now() + 600;
  downPos = null;
});

document.addEventListener('click', (e) => {
  const tool = e.target.closest('.tool');
  if (!tool) return;
  if (tool.dataset.act === 'close') window.api.closePet();
  if (tool.dataset.act === 'next') nextSymbol();
});

/* 대표 종목 바꾸기 */
let symIdx = 0;
function nextSymbol() {
  if (cfg.watchlist.length < 2) return;
  symIdx = (symIdx + 1) % cfg.watchlist.length;
  target = cfg.watchlist[symIdx];
  quote = null;
  renderBubble();
  poll();
}

/* ----------------------- 시작 ----------------------- */
async function init() {
  cfg = (await window.api.getPetConfig()) || cfg;
  cfg.watchlist = Array.isArray(cfg.watchlist) ? cfg.watchlist : [];
  target = cfg.watchlist[0] || null;

  y = floorY();
  x = clampX(window.innerWidth * 0.28);
  pet.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;

  renderBubble();
  if (target) startPolling();
  requestAnimationFrame(tick);
}

// 설정 화면에서 종목/옵션을 바꾸면 그대로 반영된다
window.api.onPetConfig((next) => {
  cfg = next || cfg;
  cfg.watchlist = Array.isArray(cfg.watchlist) ? cfg.watchlist : [];
  symIdx = Math.min(symIdx, Math.max(0, cfg.watchlist.length - 1));
  const prev = target && target.queryCode;
  target = cfg.watchlist[symIdx] || null;
  if (!target || target.queryCode !== prev) quote = null;
  renderBubble();
  if (target) startPolling();
});

window.addEventListener('resize', () => { y = floorY(); x = clampX(x); });
init();
