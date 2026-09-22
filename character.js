/* 캐릭터 레이어 렌더러.
   Actor 인스턴스 여러 개와 공(Ball)을 한 루프에서 굴린다.
   내 캐릭터는 입력을 받고, 친구 캐릭터(원격)는 받은 좌표로 보간만 한다. */

const stage = document.getElementById('stage');
const actorTpl = document.getElementById('actorTpl');
const ballTpl = document.getElementById('ballTpl');

/* ----------------------- 상수 ----------------------- */
const PET_W = 80;
const PET_H = 72;
const SPEED = 46;            // 자동 산책 속도 px/s
const CTRL_SPEED = 190;      // 방향키 조종 속도 px/s
const GRAVITY = 2400;        // px/s^2
const JUMP_V = 760;          // 점프 초기 속도 px/s
const FLOOR_GAP = 32;        // 화면 아래 여백. 이름표·툴 버튼이 발밑에 붙으므로
                             // 8px 로 두면 화면 밖으로 잘린다.
const FRICTION = 4.5;        // 넉백 감쇠 (1/s)

const BALL_R = 9;
const BALL_VX = 560;         // 던지는 초기 속도
const BALL_VY = -330;
const BALL_BOUNCE = 0.52;
const BALL_LIFE = 6000;      // ms

const PUNCH_RANGE = 62;      // 주먹이 닿는 거리 (중심 간)
const PUNCH_COOLDOWN = 380;  // ms
const HIT_KNOCK = 430;       // 넉백 수평 속도
const HIT_POP = 300;         // 넉백 수직 속도
const STUN_MS = 800;

const floorY = () => window.innerHeight - PET_H - FLOOR_GAP;
const clampX = (v) => Math.max(0, Math.min(window.innerWidth - PET_W, v));
const dirCls = (d) => (d === 'up' ? 'up' : d === 'down' ? 'down' : '');

/* ----------------------- 설정 ----------------------- */
let cfg = { watchlist: [], interval: 30, biz: false, hideName: false, wander: false };

const LABELS = {
  avg: { normal: '평단', biz: 'baseline' },
  closed: { normal: '장마감', biz: 'synced' },
};
const lbl = (k) => LABELS[k][cfg.biz ? 'biz' : 'normal'];

/* 아이디에서 고정 색을 뽑는다 (친구 구분용 테두리 색).
   몸 색은 수익률을 나타내므로 신원 표시에 쓸 수 없다. */
function tintOf(seed) {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h}, 78%, 62%)`;
}

/* ----------------------- Actor ----------------------- */
class Actor {
  constructor({ id, name = '', local = false }) {
    this.id = id;
    this.name = name;
    this.local = local;

    this.x = clampX(window.innerWidth * (local ? 0.28 : 0.6));
    this.y = floorY();
    this.vx = 0;               // 넉백 등 외력에 의한 수평 속도
    this.vy = 0;
    this.facing = 1;
    this.onGround = true;
    this.walking = false;

    this.goal = null;          // 자동 산책 목표 x
    this.restUntil = 0;
    this.dragging = false;
    this.control = false;
    this.stunUntil = 0;
    this.lastPunch = 0;

    this.tx = this.x;          // 원격 보간 목표
    this.ty = this.y;

    this.quote = null;
    this.target = null;        // 대표 종목 watchlist 항목
    this.symIdx = 0;
    this.pollTimer = null;

    this.build();
  }

  build() {
    this.el = actorTpl.content.firstElementChild.cloneNode(true);
    this.el.dataset.id = this.id;
    this.el.classList.toggle('remote', !this.local);
    this.bubble = this.el.querySelector('.bubble');
    this.bubName = this.el.querySelector('.bub-name');
    this.bubPrice = this.el.querySelector('.bub-price');
    this.bubPnl = this.el.querySelector('.bub-pnl');
    this.tag = this.el.querySelector('.tag');
    if (!this.local) {
      this.tag.textContent = this.name || this.id;
      this.el.style.setProperty('--tint', tintOf(this.id));
    }
    stage.appendChild(this.el);
    this.render();
  }

  destroy() {
    clearInterval(this.pollTimer);
    this.el.remove();
  }

  get cx() { return this.x + PET_W / 2; }
  get cy() { return this.y + PET_H / 2; }
  get stunned() { return performance.now() < this.stunUntil; }

  /* --- 표시 --- */
  setWalking(on) {
    if (this.walking === on) return;
    this.walking = on;
    this.el.classList.toggle('walking', on);
  }

  setFacing(d) {
    if (!d || this.facing === d) return;
    this.facing = d;
    this.el.classList.toggle('face-left', d < 0);
  }

  setMood(cls) {
    this.el.classList.remove('mood-up', 'mood-down');
    if (cls) this.el.classList.add(cls);
  }

  setControl(on) {
    if (this.control === on) return;
    this.control = on;
    this.el.classList.toggle('controlled', on);
    if (!on) this.setWalking(false);
  }

  /* --- 상호작용 --- */
  hit(dirX, power = 1) {
    this.vx = dirX * HIT_KNOCK * power;
    this.vy = -HIT_POP * power;
    this.onGround = false;
    this.stunUntil = performance.now() + STUN_MS;
    this.el.classList.add('stunned');
    this.el.classList.remove('bump');
    void this.el.offsetWidth;                 // 리플로우로 애니메이션 재시작
    this.el.classList.add('bump');
  }

  punchFx() {
    this.el.classList.remove('punching');
    void this.el.offsetWidth;                 // 리플로우로 애니메이션 재시작
    this.el.classList.add('punching');
    setTimeout(() => this.el.classList.remove('punching'), 260);
  }

  punch() {
    const now = performance.now();
    if (now - this.lastPunch < PUNCH_COOLDOWN || this.stunned) return null;
    this.lastPunch = now;
    this.punchFx();

    // 바라보는 쪽 사거리 안의 가장 가까운 상대를 때린다
    let best = null;
    for (const a of world.actors.values()) {
      if (a === this) continue;
      const dx = a.cx - this.cx;
      if (Math.sign(dx) !== this.facing) continue;
      const d = Math.hypot(dx, a.cy - this.cy);
      if (d <= PUNCH_RANGE && (!best || d < best.d)) best = { a, d };
    }
    if (this.local) window.api.netSend('act', { kind: 'punch' });
    if (best) {
      best.a.hit(this.facing, 1);
      onHit(best.a, this.id, 'punch', this.facing);
    }
    return best ? best.a : null;
  }

  throwBall() {
    if (this.stunned) return null;
    const b = new Ball({
      x: this.cx + this.facing * 26 - BALL_R,
      y: this.y + 22,
      vx: this.facing * BALL_VX,
      vy: BALL_VY,
      ownerId: this.id,
    });
    world.balls.push(b);
    if (this.local) {
      window.api.netSend('act', {
        kind: 'ball',
        nx: b.x / Math.max(1, window.innerWidth - PET_W),
        ny: b.y / Math.max(1, window.innerHeight - PET_H),
        vx: b.vx, vy: b.vy,
      });
    }
    return b;
  }

  jump() {
    if (!this.onGround || this.stunned) return;
    this.vy = -JUMP_V;
    this.onGround = false;
  }

  pickGoal(ts) {
    const w = window.innerWidth - PET_W;
    let g;
    let guard = 0;
    do { g = Math.random() * w; guard++; }
    while (Math.abs(g - this.x) < 90 && guard < 12);
    this.goal = g;
    this.setFacing(g > this.x ? 1 : -1);
    this.setWalking(true);
    void ts;
  }

  /* --- 물리 --- */
  tick(dt, ts, input) {
    if (this.dragging) {
      this.vx = 0;
      this.vy = 0;
      this.render();
      return;
    }

    if (!this.local) {
      // 원격: 받은 좌표로 부드럽게 따라간다 (10Hz 수신을 60fps로 보간)
      const k = Math.min(1, dt * 12);
      this.x += (this.tx - this.x) * k;
      this.y += (this.ty - this.y) * k;
    } else if (this.stunned) {
      this.setWalking(false);
    } else if (this.control) {
      let ax = 0;
      if (input.has('left')) ax -= 1;
      if (input.has('right')) ax += 1;
      if (ax) {
        this.x += CTRL_SPEED * dt * ax;
        this.setFacing(ax);
        this.setWalking(true);
      } else {
        this.setWalking(false);
      }
    } else if (cfg.wander) {
      if (this.goal === null) {
        if (ts >= this.restUntil) this.pickGoal(ts);
      } else {
        const step = SPEED * dt;
        if (Math.abs(this.goal - this.x) <= step) {
          this.x = this.goal;
          this.goal = null;
          this.setWalking(false);
          this.restUntil = ts + 1200 + Math.random() * 3800;
        } else {
          this.x += step * this.facing;
        }
      }
    } else {
      this.goal = null;
      this.setWalking(false);
    }

    // 넉백 + 중력 (원격 캐릭터도 내 화면에서 맞으면 튕긴다)
    this.x += this.vx * dt;
    this.vx -= this.vx * Math.min(1, FRICTION * dt);
    if (Math.abs(this.vx) < 4) this.vx = 0;

    this.vy += GRAVITY * dt;
    this.y += this.vy * dt;

    const fy = floorY();
    if (this.y >= fy) { this.y = fy; this.vy = 0; this.onGround = true; }
    else this.onGround = false;

    // 벽에서 튕긴다
    const maxX = window.innerWidth - PET_W;
    if (this.x < 0) { this.x = 0; this.vx = Math.abs(this.vx) * 0.5; }
    else if (this.x > maxX) { this.x = maxX; this.vx = -Math.abs(this.vx) * 0.5; }

    if (!this.stunned) this.el.classList.remove('stunned');
    this.render();
  }

  render() {
    this.el.style.transform = `translate(${Math.round(this.x)}px, ${Math.round(this.y)}px)`;
  }

  /* --- 시세 --- */
  setQuote(q) {
    this.quote = q;
    this.renderBubble();
  }

  renderBubble() {
    const t = this.target;
    if (!t) { this.bubble.classList.add('hidden'); return; }
    this.bubble.classList.remove('hidden');

    const cur = t.market === 'world' ? '$' : '';
    const q = this.quote;
    if (!q) {
      this.bubName.textContent = cfg.hideName ? '—' : (t.name || t.queryCode);
      this.bubPrice.textContent = cur + '—';
      this.bubPrice.className = 'bub-price';
      this.bubPnl.textContent = '';
      this.setMood(null);
      return;
    }

    const closed = q.marketStatus && q.marketStatus !== 'OPEN';
    this.bubName.textContent = (cfg.hideName ? '' : (q.name || t.name || '')) +
                               (closed ? ` · ${lbl('closed')}` : '');
    this.bubPrice.textContent = cur + (q.price || '—');
    this.bubPrice.className = 'bub-price ' + dirCls(q.direction);

    if (t.avg && q.priceRaw) {
      const pl = ((q.priceRaw - t.avg) / t.avg) * 100;
      const sign = pl > 0 ? '+' : '';
      this.bubPnl.textContent =
        `${lbl('avg')} ${Number(t.avg).toLocaleString()} ${sign}${pl.toFixed(2)}%`;
      this.bubPnl.className = 'bub-pnl ' + (pl > 0 ? 'up' : pl < 0 ? 'down' : '');
      this.setMood(pl > 0 ? 'mood-up' : pl < 0 ? 'mood-down' : null);
      if (this.local) netSendPnl(Number(pl.toFixed(2)));
    } else {
      this.bubPnl.textContent = q.ratio ? `${q.ratio}%` : '';
      this.bubPnl.className = 'bub-pnl ' + dirCls(q.direction);
      this.setMood(q.direction === 'up' ? 'mood-up' : q.direction === 'down' ? 'mood-down' : null);
    }
  }

  /* 친구 캐릭터의 말풍선 — 수익률 퍼센트만 받는다.
     평단가·수량·금액은 전송하지 않으므로 여기서도 표시할 수 없다. */
  setPeerPnl(pct) {
    if (this.local || pct == null) return;
    this.bubble.classList.remove('hidden');
    this.bubName.textContent = this.name || '';
    const sign = pct > 0 ? '+' : '';
    this.bubPrice.textContent = `${sign}${Number(pct).toFixed(2)}%`;
    this.bubPrice.className = 'bub-price ' + (pct > 0 ? 'up' : pct < 0 ? 'down' : '');
    this.bubPnl.textContent = '';
    this.setMood(pct > 0 ? 'mood-up' : pct < 0 ? 'mood-down' : null);
  }

  startPolling() {
    clearInterval(this.pollTimer);
    this.poll();
    this.pollTimer = setInterval(() => this.poll(),
      Math.max(10, Number(cfg.interval) || 30) * 1000);
  }

  async poll() {
    if (!this.target) return;
    const res = await window.api.fetchQuotes([
      { queryCode: this.target.queryCode, market: this.target.market },
    ]);
    if (!res || !res.ok) return;
    const next = res.data[this.target.queryCode];
    if (!next) return;
    if (this.quote && next.priceRaw != null && this.quote.priceRaw != null &&
        next.priceRaw > this.quote.priceRaw) this.cheer();
    this.setQuote(next);
  }

  cheer() {
    this.el.classList.remove('cheer');
    void this.el.offsetWidth;
    this.el.classList.add('cheer');
    setTimeout(() => this.el.classList.remove('cheer'), 1900);
  }

  nextSymbol() {
    if (cfg.watchlist.length < 2) return;
    this.symIdx = (this.symIdx + 1) % cfg.watchlist.length;
    this.target = cfg.watchlist[this.symIdx];
    this.quote = null;
    this.renderBubble();
    this.poll();
  }
}

/* ----------------------- Ball ----------------------- */
class Ball {
  constructor({ x, y, vx, vy, ownerId }) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.ownerId = ownerId;
    this.bornAt = performance.now();
    this.dead = false;
    this.immuneUntil = new Map();          // actorId -> ts (연속 재타격 방지)

    this.el = ballTpl.content.firstElementChild.cloneNode(true);
    stage.appendChild(this.el);
    this.render();
  }

  tick(dt) {
    this.vy += GRAVITY * 0.55 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const fy = window.innerHeight - FLOOR_GAP - BALL_R * 2;
    if (this.y >= fy) { this.y = fy; this.vy = -this.vy * BALL_BOUNCE; this.vx *= 0.82; }
    const maxX = window.innerWidth - BALL_R * 2;
    if (this.x < 0) { this.x = 0; this.vx = -this.vx * BALL_BOUNCE; }
    else if (this.x > maxX) { this.x = maxX; this.vx = -this.vx * BALL_BOUNCE; }

    // 충돌: 원(공) vs 사각(캐릭터)
    const now = performance.now();
    for (const a of world.actors.values()) {
      if ((this.immuneUntil.get(a.id) || 0) > now) continue;
      if (a.id === this.ownerId && now - this.bornAt < 150) continue;  // 던진 직후 자기 몸 통과
      const bx = this.x + BALL_R;
      const by = this.y + BALL_R;
      const nx = Math.max(a.x, Math.min(bx, a.x + PET_W));
      const ny = Math.max(a.y, Math.min(by, a.y + PET_H));
      if (Math.hypot(bx - nx, by - ny) > BALL_R) continue;

      a.hit(Math.sign(this.vx) || 1, 0.8);
      this.immuneUntil.set(a.id, now + 400);
      this.vx = -this.vx * 0.45;
      this.vy = -220;
      onHit(a, this.ownerId, 'ball', Math.sign(this.vx) || 1);
    }

    // 수명이 다했거나 바닥에서 거의 멈추면 사라진다
    if (now - this.bornAt > BALL_LIFE ||
        (Math.abs(this.vx) < 12 && Math.abs(this.vy) < 40 && this.y >= fy - 1)) {
      this.dead = true;
    }
    this.render();
  }

  render() {
    this.el.style.transform = `translate(${Math.round(this.x)}px, ${Math.round(this.y)}px)`;
  }

  destroy() { this.el.remove(); }
}

/* ----------------------- 월드 ----------------------- */
const world = {
  actors: new Map(),
  balls: [],
  local: null,
};

/* ----------------------- 네트워크 ----------------------- */
/* 좌표는 정규화(0~1)로 주고받는다. 모니터 해상도가 달라도 같은 위치에 보이도록.
   위치는 "움직이는 동안에만" 보낸다. 캐릭터가 기본으로 정지해 있으므로
   가만히 있을 때 트래픽이 0 이 되고, 무료 티어 메시지 한도를 아낄 수 있다. */
const SEND_HZ = 10;
let online = false;
let lastSend = 0;
let lastSent = null;

const norm = (a) => ({
  nx: a.x / Math.max(1, window.innerWidth - PET_W),
  ny: a.y / Math.max(1, window.innerHeight - PET_H),
});

function pumpState(ts) {
  const me = world.local;
  if (!online || !me) return;

  const { nx, ny } = norm(me);
  const moving = me.walking || Math.abs(me.vx) > 1 || !me.onGround || me.dragging;
  const changed = !lastSent ||
    Math.abs(nx - lastSent.nx) > 0.002 || Math.abs(ny - lastSent.ny) > 0.002 ||
    lastSent.face !== me.facing || lastSent.walk !== me.walking;

  // 움직임이 멈춘 뒤 마지막 한 장만 더 보내고 조용해진다
  if (!moving && !changed) return;
  if (ts - lastSend < 1000 / SEND_HZ) return;

  lastSend = ts;
  lastSent = { nx, ny, face: me.facing, walk: me.walking };
  window.api.netSend('move', lastSent);
}

/* 피격은 때린 쪽 클라이언트가 판정하고 결과만 상대에게 알린다. */
function onHit(victim, byId, kind, dir) {
  if (!online || !world.local || byId !== world.local.id) return;
  if (victim.local) return;                     // 내가 나를 때린 건 보낼 필요 없다
  window.api.netSend('hit', { target: victim.id, kind, dir: dir || 1 });
}

function netSendPnl(pct) {
  if (online) window.api.netSend('pnl', { pct });
}

window.api.onNet((msg) => {
  if (!msg) return;
  switch (msg.t) {
    case 'status':
      online = msg.status === 'online';
      if (online) {
        window.api.netStatus().then((st) => {
          if (world.local && st) world.local.netId = st.id;
        });
      }
      if (!online) for (const id of [...world.actors.keys()]) if (id !== 'me') removePeer(id);
      break;
    case 'peers': {
      const seen = new Set(['me']);
      for (const p of msg.peers) { upsertPeer({ id: p.id, name: p.name }); seen.add(p.id); }
      for (const id of [...world.actors.keys()]) if (!seen.has(id)) removePeer(id);
      break;
    }
    case 'left':
      removePeer(msg.id);
      break;
    case 'move':
      upsertPeer({ id: msg.id, nx: msg.nx, ny: msg.ny, face: msg.face, walk: msg.walk });
      break;
    case 'act': {
      const a = world.actors.get(msg.id);
      if (!a) break;
      if (msg.kind === 'punch') a.punchFx();
      if (msg.kind === 'ball') {
        world.balls.push(new Ball({
          x: msg.nx * (window.innerWidth - PET_W),
          y: msg.ny * (window.innerHeight - PET_H),
          vx: msg.vx, vy: msg.vy, ownerId: msg.id,
        }));
      }
      break;
    }
    case 'hit': {
      // 내가 맞았다고 상대가 알려온 경우
      const me = world.local;
      if (me && msg.target === me.netId) me.hit(msg.dir || -1, msg.kind === 'ball' ? 0.8 : 1);
      break;
    }
    case 'pnl': {
      const a = world.actors.get(msg.id);
      if (a) a.setPeerPnl(msg.pct);
      break;
    }
    default: break;
  }
});

/* ----------------------- 입력 ----------------------- */
const keys = new Set();
const KEYMAP = {
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
};

function localControl(on) {
  const me = world.local;
  if (!me || me.control === on) return;
  me.setControl(on);
  keys.clear();
  window.api.setPetControl(on);
}

window.addEventListener('keydown', (e) => {
  const me = world.local;
  if (!me || !me.control) return;
  if (e.key === 'Escape') { localControl(false); return; }
  if (e.key === 'ArrowUp' || e.key === ' ' || e.key === 'w' || e.key === 'W') {
    me.jump(); e.preventDefault(); return;
  }
  if (e.key === 'f' || e.key === 'F') { me.punch(); e.preventDefault(); return; }
  if (e.key === 'g' || e.key === 'G') { me.throwBall(); e.preventDefault(); return; }
  const k = KEYMAP[e.key];
  if (k) { keys.add(k); e.preventDefault(); }
});

window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.key];
  if (k) keys.delete(k);
});

// 다른 창으로 포커스가 넘어가면 조종을 놓는다
window.addEventListener('blur', () => localControl(false));

/* ----------------------- 마우스 ----------------------- */
/* 창 전체가 클릭을 통과시키므로, 커서가 내 캐릭터 위에 올 때만
   메인 프로세스에 알려 마우스 입력을 잠시 받는다. */
const CLICK_SLOP = 5;
const CLICK_MS = 350;
let interactive = false;
let downAt = 0;
let downPos = null;
let moved = false;
let dragDX = 0;
let dragDY = 0;

function hitTest(px, py) {
  const me = world.local;
  if (!me) return false;
  const pad = 10;
  return px >= me.x - pad && px <= me.x + PET_W + pad &&
         py >= me.y - pad && py <= me.y + PET_H + pad;
}

window.api.onCursor(({ x: cx, y: cy }) => {
  const me = world.local;
  if (!me || me.dragging) return;
  const over = hitTest(cx, cy);
  if (over === interactive) return;
  interactive = over;
  me.el.classList.toggle('hovered', over);
  window.api.setPetInteractive(over);
});

stage.addEventListener('mousedown', (e) => {
  const me = world.local;
  if (!me || !me.el.contains(e.target) || e.target.closest('.tool')) return;
  me.dragging = true;
  moved = false;
  downAt = performance.now();
  downPos = { x: e.clientX, y: e.clientY };
  me.goal = null;
  me.setWalking(false);
  dragDX = e.clientX - me.x;
  dragDY = e.clientY - me.y;
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  const me = world.local;
  if (!me || !me.dragging) return;
  if (downPos && (Math.abs(e.clientX - downPos.x) > CLICK_SLOP ||
                  Math.abs(e.clientY - downPos.y) > CLICK_SLOP)) moved = true;
  me.x = clampX(e.clientX - dragDX);
  me.y = Math.max(0, Math.min(window.innerHeight - PET_H, e.clientY - dragDY));
  me.render();
});

window.addEventListener('mouseup', () => {
  const me = world.local;
  if (!me || !me.dragging) return;
  me.dragging = false;
  me.vy = 0;
  // 제자리 클릭이면 조종 모드 토글, 끌었으면 드래그로 본다
  if (!moved && performance.now() - downAt < CLICK_MS) localControl(!me.control);
  me.restUntil = performance.now() + 600;
  downPos = null;
});

document.addEventListener('click', (e) => {
  const tool = e.target.closest('.tool');
  if (!tool) return;
  if (tool.dataset.act === 'close') window.api.closePet();
  if (tool.dataset.act === 'next' && world.local) world.local.nextSymbol();
});

/* ----------------------- 루프 ----------------------- */
let lastTs = 0;

function frame(ts) {
  const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0;
  lastTs = ts;

  for (const a of world.actors.values()) a.tick(dt, ts, keys);
  for (const b of world.balls) b.tick(dt);
  pumpState(ts);

  if (world.balls.some((b) => b.dead)) {
    world.balls = world.balls.filter((b) => {
      if (b.dead) b.destroy();
      return !b.dead;
    });
  }

  requestAnimationFrame(frame);
}

/* ----------------- 원격 캐릭터 (2단계 연결 지점) ----------------- */
/* 좌표는 정규화(0~1)로 주고받는다. 모니터 해상도가 달라도 같은 위치에 보이도록. */
function upsertPeer({ id, name, nx, ny, face, walk }) {
  let a = world.actors.get(id);
  if (!a) {
    a = new Actor({ id, name, local: false });
    world.actors.set(id, a);
  }
  if (name && a.tag.textContent !== name) a.tag.textContent = name;
  if (nx != null) a.tx = clampX(nx * (window.innerWidth - PET_W));
  if (ny != null) a.ty = ny * (window.innerHeight - PET_H);
  if (face) a.setFacing(face);
  if (walk != null) a.setWalking(!!walk);
  return a;
}

function removePeer(id) {
  const a = world.actors.get(id);
  if (!a) return;
  a.destroy();
  world.actors.delete(id);
}

// 테스트/디버그용 — 더미 캐릭터를 띄워 충돌을 확인한다
window.__pet = { world, upsertPeer, removePeer, Actor, Ball, localControl, floorY, PET_W, PET_H };

/* ----------------------- 시작 ----------------------- */
async function init() {
  cfg = (await window.api.getPetConfig()) || cfg;
  cfg.watchlist = Array.isArray(cfg.watchlist) ? cfg.watchlist : [];

  const me = new Actor({ id: 'me', local: true });
  me.target = cfg.watchlist[0] || null;
  world.local = me;
  world.actors.set('me', me);

  me.renderBubble();
  if (me.target) me.startPolling();
  requestAnimationFrame(frame);
}

window.api.onPetConfig((next) => {
  cfg = next || cfg;
  cfg.watchlist = Array.isArray(cfg.watchlist) ? cfg.watchlist : [];
  const me = world.local;
  if (!me) return;
  me.symIdx = Math.min(me.symIdx, Math.max(0, cfg.watchlist.length - 1));
  const prev = me.target && me.target.queryCode;
  me.target = cfg.watchlist[me.symIdx] || null;
  if (!me.target || me.target.queryCode !== prev) me.quote = null;
  me.renderBubble();
  if (me.target) me.startPolling();
});

window.addEventListener('resize', () => {
  for (const a of world.actors.values()) {
    a.y = Math.min(a.y, floorY());
    a.x = clampX(a.x);
  }
});

init();
