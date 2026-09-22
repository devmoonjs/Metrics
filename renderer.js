const $ = (id) => document.getElementById(id);

const app = $('app');
const settingsEl = $('settings');
const tickerEl = $('ticker');
const tickerBody = $('tickerBody');
const searchInput = $('searchInput');
const searchResults = $('searchResults');
const petMode = $('petMode');
const petWander = $('petWander');
const watchlistEl = $('watchlist');
const intervalSelect = $('intervalSelect');
const themeSelect = $('themeSelect');
const startBtn = $('startBtn');
const stopBtn = $('stopBtn');
const closeBtn = $('closeBtn');
const hideName = $('hideName');
const hideCode = $('hideCode');
const bizMode = $('bizMode');
const opacitySlider = $('opacitySlider');
const opacityVal = $('opacityVal');
const surgeOn = $('surgeOn');
const surgePct = $('surgePct');
const osNotify = $('osNotify');

let timer = null;
let searchTimer = null;
let fitted = false;
let curTheme = 'minimal';
let biz = false;
let watchlist = [];   // [{ key, market, queryCode, code, reutersCode, name, nation, avg, target }]
let quotes = {};      // queryCode -> quote

// 알림 상태
let prevPrice = {};   // queryCode -> 직전 polling 가격 (교차 감지용)
let firedTarget = {}; // queryCode -> 목표가 알림 래치
let firedSurge = {};  // queryCode -> 급등락 알림 래치
let alertSeeded = false; // 첫 폴링은 baseline만 잡고 발화 안 함

/** 워딩 사전: 일반(주식) ↔ 비즈니스(업무용 영문) */
const LABELS = {
  avg:    { normal: '평단',   biz: 'baseline' },
  gain:   { normal: '수익',   biz: 'gain' },
  rate:   { normal: '수익률', biz: 'rate' },
  change: { normal: '변동',   biz: 'delta' },
  closed: { normal: '장마감', biz: 'synced' },
  item:   { normal: '항목',   biz: 'metric' },
  pnl:    { normal: 'pnl',    biz: 'rate' },
};
const lbl = (k) => LABELS[k][biz ? 'biz' : 'normal'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const flag = (nation) => (nation === 'USA' ? '🇺🇸' : nation === 'KOR' ? '🇰🇷' : '🌐');
const dirClass = (d) => (d === 'up' ? 'up' : d === 'down' ? 'down' : 'flat');

function nowTime() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** watchlist 항목 + 시세 → 표시용 정규화 */
function normalizeRow(w) {
  const q = quotes[w.queryCode];
  const name = hideName.checked ? '' : esc((q && q.name) || w.name || '');
  const code = hideCode.checked ? '' : esc(w.market === 'world' ? (w.code || '') : w.queryCode);
  const cur = w.market === 'world' ? '$' : '';
  if (!q) {
    return { loading: true, name, code, flagEmoji: flag(w.nation),
      cls: 'flat', price: cur + '—', ratio: '', change: '', closed: false, profit: null };
  }
  const cls = dirClass(q.direction);
  const closed = q.marketStatus && q.marketStatus !== 'OPEN';
  let profit = null;
  if (w.avg && q.priceRaw) {
    const pl = ((q.priceRaw - w.avg) / w.avg) * 100;
    const sign = pl > 0 ? '+' : '';
    profit = { str: `${sign}${pl.toFixed(2)}%`, cls: pl > 0 ? 'up' : pl < 0 ? 'down' : 'flat',
      avg: Number(w.avg).toLocaleString() };
  }
  return {
    loading: false, name, code, flagEmoji: flag(w.nation), cls, closed, profit,
    price: cur + esc(q.price || '—'),
    change: esc(q.change || ''),
    ratio: q.ratio ? esc(q.ratio) + '%' : '',
  };
}

/* ----------------------- 테마 (다중 행 렌더) ----------------------- */
const THEMES = {
  minimal(rows) {
    return rows.map((v) => {
      const nm = v.name ? `<span class="t-name">${v.name}${v.closed ? ' · ' + lbl('closed') : ''}</span>` : '';
      const cd = v.code ? `<span class="t-code">${v.code}</span>` : '';
      const pf = v.profit ? `<div class="t-profit ${v.profit.cls}">${lbl('avg')} ${v.profit.avg} ${v.profit.str}</div>` : '';
      return `<div class="m-row">
        <div class="m-left">${nm}${cd}</div>
        <div class="m-right">
          <div class="t-price ${v.cls}">${v.price}</div>
          <div class="t-sub ${v.cls}">${[v.change, v.ratio].filter(Boolean).join(' ')}</div>
          ${pf}
        </div></div>`;
    }).join('');
  },

  terminal(rows) {
    const lines = rows.map((v) => {
      const label = v.code || v.name || 'main';
      const pf = v.profit ? ` <span class="tl-dim">${lbl('pnl')}=</span><span class="${v.profit.cls}">${v.profit.str}</span>` : '';
      return `<div class="tl">[${nowTime()}] ${label} <span class="${v.cls}">${v.price}</span> <span class="${v.cls}">${v.ratio || '0%'}</span>${pf}</div>`;
    }).join('');
    return `<div class="term"><div class="tl tl-dim">$ tail -f deploy.log</div>${lines}</div>`;
  },

  build(rows) {
    return `<div class="bld">` + rows.map((v) => {
      const label = v.name || v.code || 'project';
      const mag = Math.abs(parseFloat(v.ratio)) || 0;
      const pct = Math.min(98, Math.max(6, Math.round(mag * 9) + 41));
      const pf = v.profit ? ` · <span class="${v.profit.cls}">${v.profit.str}</span>` : '';
      return `<div class="bld-item">
        <div class="bld-top">${label} 패키지 설치 중…</div>
        <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bld-line"><span class="${v.cls}">${v.price}</span> <span class="${v.cls}">${v.ratio}</span>${pf}</div>
      </div>`;
    }).join('') + `</div>`;
  },

  sheet(rows) {
    const hasProfit = rows.some((v) => v.profit);
    const head = `<tr><th class="rn"></th><th>A</th><th>B</th><th>C</th>${hasProfit ? '<th>D</th>' : ''}</tr>`;
    const body = rows.map((v, i) => {
      const nm = v.name || lbl('item');
      const pf = hasProfit ? `<td class="cell num ${v.profit ? v.profit.cls : ''}">${v.profit ? v.profit.str : ''}</td>` : '';
      return `<tr><td class="rn">${i + 7}</td><td class="cell">${nm}</td>
        <td class="cell num ${v.cls}">${v.price}</td>
        <td class="cell num ${v.cls}">${v.ratio || '-'}</td>${pf}</tr>`;
    }).join('');
    return `<table class="sheet">${head}${body}</table>`;
  },

  chat(rows) {
    return `<div class="chat">` + rows.map((v) => {
      const sender = v.name || '이대리';
      const pf = v.profit ? ` · ${lbl('gain')} <span class="${v.profit.cls}">${v.profit.str}</span>` : '';
      return `<div class="chat-msg">
        <div class="chat-name">${sender}</div>
        <div class="bubble"><span class="${v.cls}">${v.price}</span> 확인했습니다 👍</div>
        <div class="chat-meta"><span class="${v.cls}">${v.ratio || ''}</span> 반영${pf}</div>
      </div>`;
    }).join('') + `</div>`;
  },
};

function renderRows() {
  if (!watchlist.length) {
    tickerBody.innerHTML = '<div class="status-msg">종목을 추가하세요</div>';
    return;
  }
  const rows = watchlist.map(normalizeRow);
  tickerBody.innerHTML = (THEMES[curTheme] || THEMES.minimal)(rows);
}

/* ----------------------- 알림 ----------------------- */
function notify(body) {
  if (osNotify.checked) window.api.notify({ title: biz ? 'Metrics' : '📈 시세 알림', body });
}

/** 목표가 교차 / 급등락 임계 평가. 첫 폴링은 baseline만 잡는다. 알림 발생 시 true */
function evaluateAlerts() {
  let fired = false;
  const surgeEnabled = surgeOn.checked;
  const pct = parseFloat(surgePct.value) || 0;

  for (const w of watchlist) {
    const q = quotes[w.queryCode];
    if (!q || q.priceRaw == null) continue;
    const cur = q.priceRaw;
    const prev = prevPrice[w.queryCode];
    const cur$ = (w.market === 'world' ? '$' : '') + (q.price || '');
    const disp = hideName.checked
      ? (biz ? 'metric' : (w.market === 'world' ? w.code : w.queryCode))
      : (q.name || w.name || w.queryCode);

    // 목표가 교차 (상향/하향 자동)
    if (w.target && alertSeeded && prev != null) {
      const t = w.target;
      const crossed = (prev < t && cur >= t) || (prev > t && cur <= t);
      if (crossed && !firedTarget[w.queryCode]) {
        firedTarget[w.queryCode] = true;
        fired = true;
        notify(`${disp} ${biz ? '임계값 도달' : '목표가 도달'} ${cur$}`);
      } else if (firedTarget[w.queryCode] && Math.abs(cur - t) / t > 0.01) {
        firedTarget[w.queryCode] = false; // 목표가에서 1% 벗어나면 재무장
      }
    }

    // 급등락 (당일 등락률 ±pct)
    if (surgeEnabled && pct > 0 && alertSeeded) {
      const ratio = parseFloat(q.ratio) || 0;
      if (Math.abs(ratio) >= pct && !firedSurge[w.queryCode]) {
        firedSurge[w.queryCode] = true;
        fired = true;
        const word = biz ? `±${pct}% 변동 감지` : `${ratio >= 0 ? '급등' : '급락'} ${q.ratio}%`;
        notify(`${disp} ${word} ${cur$}`);
      } else if (Math.abs(ratio) < pct - 0.3) {
        firedSurge[w.queryCode] = false; // 히스테리시스 재무장
      }
    }

    prevPrice[w.queryCode] = cur;
  }
  alertSeeded = true;
  return fired;
}

/* ----------------------- 폴링 ----------------------- */
async function pollAll() {
  if (!watchlist.length) return;
  const res = await window.api.fetchQuotes(watchlist.map((w) => ({ queryCode: w.queryCode, market: w.market })));
  if (res.ok) quotes = res.data;
  const fired = evaluateAlerts();
  renderRows();
  if (fired) { tickerBody.classList.remove('flash'); void tickerBody.offsetWidth; tickerBody.classList.add('flash'); }
  if (!fitted) { fitWindow(); fitted = true; }
}

/** 창 크기를 콘텐츠에 맞춤 */
function fitWindow() {
  const card = $('app');
  const prev = card.style.minHeight;
  card.style.minHeight = '0px';
  const h = Math.min(640, Math.ceil(card.scrollHeight)); // 너무 길면 상한
  card.style.minHeight = prev;
  window.api.resizeWindow({ width: 300, height: h });
}

/* ----------------------- 검색 ----------------------- */
function renderSearchResults(items) {
  if (!items || !items.length) { searchResults.classList.add('hidden'); fitWindow(); return; }
  searchResults.innerHTML = items.slice(0, 8).map((it, i) =>
    `<div class="sr-item no-drag" data-i="${i}">
      <span class="sr-flag">${flag(it.nation)}</span>
      <span class="sr-name">${esc(it.name)}</span>
      <span class="sr-sub">${esc(it.code)} · ${esc(it.typeName || '')}</span>
    </div>`).join('');
  searchResults._items = items;
  searchResults.classList.remove('hidden');
  fitWindow();
}

function doSearch() {
  const q = searchInput.value.trim();
  if (q.length < 1) { searchResults.classList.add('hidden'); fitWindow(); return; }
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const res = await window.api.searchSymbol(q);
    if (res.ok) renderSearchResults(res.items);
  }, 250);
}

function addSymbol(it) {
  const key = `${it.market}:${it.queryCode}`;
  if (watchlist.some((w) => w.key === key)) return; // 중복 방지
  watchlist.push({ key, market: it.market, queryCode: it.queryCode, code: it.code,
    reutersCode: it.reutersCode, name: it.name, nation: it.nation, avg: null });
  searchInput.value = '';
  searchResults.classList.add('hidden');
  renderWatchlist();
  saveSettings();
  if (timer) { quotes = {}; fitted = false; pollAll(); } // 감시 중이면 즉시 반영
}

/* ----------------------- watchlist UI ----------------------- */
function renderWatchlist() {
  watchlistEl.innerHTML = watchlist.map((w, i) =>
    `<div class="wl-item">
      <div class="wl-head">
        <span class="wl-flag">${flag(w.nation)}</span>
        <span class="wl-name" title="${esc(w.name)}">${esc(w.name)}</span>
        <button class="wl-del no-drag" data-i="${i}" title="삭제">✕</button>
      </div>
      <div class="wl-inputs">
        <input class="wl-avg no-drag" data-i="${i}" type="text" inputmode="decimal"
               placeholder="평단가" value="${w.avg != null ? esc(String(w.avg)) : ''}" />
        <input class="wl-target no-drag" data-i="${i}" type="text" inputmode="decimal"
               placeholder="🔔 목표가" value="${w.target != null ? esc(String(w.target)) : ''}" />
      </div>
    </div>`).join('');
  fitWindow();
}

/* ----------------------- 시작/정지 ----------------------- */
function startWatching() {
  if (!watchlist.length) { searchInput.focus(); return; }
  curTheme = themeSelect.value;
  biz = bizMode.checked;
  app.className = 'card theme-' + curTheme;
  const seconds = parseInt(intervalSelect.value, 10);

  saveSettings();
  settingsEl.classList.add('hidden');
  searchResults.classList.add('hidden');
  tickerEl.classList.remove('hidden');
  stopBtn.classList.remove('hidden');
  quotes = {};
  fitted = false;
  // 알림 상태 초기화 (이번 세션 baseline 다시 잡음)
  prevPrice = {}; firedTarget = {}; firedSurge = {}; alertSeeded = false;
  tickerBody.innerHTML = '<div class="status-msg">불러오는 중…</div>';

  pollAll();
  if (timer) clearInterval(timer);
  timer = setInterval(pollAll, seconds * 1000);
}

function stopWatching() {
  if (timer) { clearInterval(timer); timer = null; }
  tickerEl.classList.add('hidden');
  stopBtn.classList.add('hidden');
  settingsEl.classList.remove('hidden');
  app.className = 'card';
  fitted = false;
  fitWindow();
}

/* ----------------------- 투명도 ----------------------- */
function applyOpacity(pct) {
  const alpha = Math.max(10, Math.min(100, pct)) / 100;
  document.documentElement.style.setProperty('--bg-alpha', alpha.toFixed(2));
  opacityVal.textContent = `${pct}%`;
  opacitySlider.value = pct;
  localStorage.setItem('bgOpacity', String(pct));
}

/* ----------------------- 설정 저장/복원 ----------------------- */
function saveSettings() {
  localStorage.setItem('cfg', JSON.stringify({
    watchlist: watchlist.map((w) => ({ market: w.market, queryCode: w.queryCode, code: w.code,
      reutersCode: w.reutersCode, name: w.name, nation: w.nation, avg: w.avg, target: w.target })),
    interval: intervalSelect.value, theme: themeSelect.value,
    hideName: hideName.checked, hideCode: hideCode.checked, biz: bizMode.checked,
    surgeOn: surgeOn.checked, surgePct: surgePct.value, osNotify: osNotify.checked,
    petMode: petMode.checked, petWander: petWander.checked,
  }));
  updatePet();
}
function loadSettings() {
  try {
    const c = JSON.parse(localStorage.getItem('cfg') || '{}');
    if (Array.isArray(c.watchlist)) {
      watchlist = c.watchlist.map((w) => ({ ...w, key: `${w.market}:${w.queryCode}` }));
    }
    if (c.interval) intervalSelect.value = c.interval;
    if (c.theme) themeSelect.value = c.theme;
    hideName.checked = !!c.hideName;
    hideCode.checked = !!c.hideCode;
    bizMode.checked = !!c.biz;
    surgeOn.checked = !!c.surgeOn;
    if (c.surgePct) surgePct.value = c.surgePct;
    if (c.osNotify !== undefined) osNotify.checked = !!c.osNotify;
    petMode.checked = !!c.petMode;
    petWander.checked = !!c.petWander;
  } catch (_) { /* ignore */ }
}

/* ----------------------- 캐릭터 레이어 ----------------------- */
function petConfig() {
  return {
    watchlist: watchlist.map((w) => ({ market: w.market, queryCode: w.queryCode, code: w.code,
      name: w.name, nation: w.nation, avg: w.avg })),
    interval: intervalSelect.value,
    biz: bizMode.checked,
    hideName: hideName.checked,
    wander: petWander.checked,
  };
}

// 설정이 바뀔 때마다 캐릭터에도 반영한다 (켜져 있을 때만).
function updatePet() {
  if (petMode.checked && watchlist.length) window.api.openPet(petConfig());
}

petWander.addEventListener('change', saveSettings);
petMode.addEventListener('change', () => {
  if (petMode.checked && watchlist.length) window.api.openPet(petConfig());
  else window.api.closePet();
  saveSettings();
});
window.api.onPetClosed(() => { petMode.checked = false; saveSettings(); });

/* ----------------------- 이벤트 ----------------------- */
searchInput.addEventListener('input', doSearch);
searchInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const items = searchResults._items;
  if (items && items.length && !searchResults.classList.contains('hidden')) {
    addSymbol(items[0]);
  } else if (/^\d{6}$/.test(searchInput.value.trim())) {
    const code = searchInput.value.trim();
    addSymbol({ market: 'domestic', queryCode: code, code, reutersCode: code, name: code, nation: 'KOR' });
  }
});
searchResults.addEventListener('click', (e) => {
  const el = e.target.closest('.sr-item');
  if (el) addSymbol(searchResults._items[Number(el.dataset.i)]);
});
watchlistEl.addEventListener('click', (e) => {
  const del = e.target.closest('.wl-del');
  if (del) {
    watchlist.splice(Number(del.dataset.i), 1);
    renderWatchlist(); saveSettings();
    if (timer) { fitted = false; renderRows(); fitWindow(); }
  }
});
watchlistEl.addEventListener('change', (e) => {
  const avgInp = e.target.closest('.wl-avg');
  const tgtInp = e.target.closest('.wl-target');
  const parse = (v) => {
    const raw = v.replace(/[, ]/g, '').trim();
    return raw && !isNaN(Number(raw)) && Number(raw) > 0 ? Number(raw) : null;
  };
  if (avgInp) {
    watchlist[Number(avgInp.dataset.i)].avg = parse(avgInp.value);
    saveSettings();
    if (timer) renderRows();
  } else if (tgtInp) {
    const i = Number(tgtInp.dataset.i);
    watchlist[i].target = parse(tgtInp.value);
    delete firedTarget[watchlist[i].queryCode]; // 목표가 변경 시 재무장
    saveSettings();
  }
});
opacitySlider.addEventListener('input', () => applyOpacity(Number(opacitySlider.value)));
[surgeOn, surgePct, osNotify].forEach((el) => el.addEventListener('change', () => {
  firedSurge = {}; // 임계 변경 시 재무장
  saveSettings();
}));
startBtn.addEventListener('click', startWatching);
stopBtn.addEventListener('click', stopWatching);
closeBtn.addEventListener('click', () => window.api.quit());

// 초기화
loadSettings();
renderWatchlist();
const savedOpacity = Number(localStorage.getItem('bgOpacity'));
applyOpacity(savedOpacity >= 10 ? savedOpacity : 78);
window.addEventListener('DOMContentLoaded', fitWindow);
