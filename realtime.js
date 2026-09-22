/* 친구 캐릭터 실시간 공유 (메인 프로세스 전용).
 *
 * 렌더러가 아니라 여기서 접속하는 이유는 naver.js 와 같다 —
 * index.html / character.html 의 CSP 가 default-src 'self' 라
 * 렌더러에서 외부 WebSocket 을 열 수 없다. 메인에서 붙고 IPC 로 중계한다.
 *
 * 접속 정보(프로젝트 URL·anon key·방 코드)는 저장소에 넣지 않는다.
 * 사용자가 설정에서 '초대 코드'를 붙여넣으면 거기서 풀어 쓴다.
 */
const { RealtimeClient } = require('@supabase/realtime-js');
// Electron 31 의 Node 20 에는 전역 WebSocket 이 없다(Node 22+ 부터).
// realtime-js 가 쓸 구현을 직접 넘겨야 한다.
const WebSocketImpl = globalThis.WebSocket || require('ws');

let client = null;
let channel = null;
let myId = null;
let onEvent = () => {};
let status = 'idle';        // idle | connecting | online | error

/* ----------------------- 초대 코드 ----------------------- */
/* 대시보드에서 복사한 주소는 그냥 https://xxx.supabase.co 일 때도 있고
   https://xxx.supabase.co/rest/v1 처럼 경로가 붙어 있을 때도 있다.
   어느 쪽을 붙여넣어도 되도록 호스트까지만 남긴다. */
function normalizeUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new Error('프로젝트 URL 이 비어 있습니다');
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

  let host;
  try {
    host = new URL(raw).host;
  } catch (_) {
    throw new Error('프로젝트 URL 형식이 올바르지 않습니다');
  }
  if (!/^[\w.-]+\.[a-z]{2,}$/i.test(host)) {
    throw new Error('프로젝트 URL 형식이 올바르지 않습니다 (예: https://xxxx.supabase.co)');
  }
  return `https://${host}`;
}

/* { u: 프로젝트 URL, k: 공개 키, r: 방 이름 } 을 base64url 로 묶은 한 줄 문자열. */
function makeInvite({ url, key, room }) {
  assertPublicKey(key);
  const json = JSON.stringify({ u: normalizeUrl(url), k: key, r: room });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/* 초대 코드는 친구에게 전달되는 값이다. secret 키가 들어가면 그대로 유출되므로
   공개용 키(publishable / 레거시 anon)만 받는다.
   - 신형: sb_publishable_... (공개) / sb_secret_... (비공개)
   - 레거시: JWT. payload 의 role 이 anon 이면 공개, service_role 이면 비공개 */
function assertPublicKey(key) {
  const k = String(key || '').trim();
  if (!k) throw new Error('키가 비어 있습니다');

  if (k.startsWith('sb_secret_')) {
    throw new Error('secret 키는 쓸 수 없습니다. publishable 키를 사용하세요');
  }
  if (k.startsWith('sb_publishable_')) return k;

  // 레거시 JWT
  if (k.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(Buffer.from(k.split('.')[1], 'base64').toString('utf8'));
      if (payload.role === 'service_role') {
        throw new Error('service_role 키는 쓸 수 없습니다. anon public 키를 사용하세요');
      }
      return k;
    } catch (err) {
      if (/service_role/.test(err.message)) throw err;
      throw new Error('키 형식을 알 수 없습니다');
    }
  }
  throw new Error('키 형식을 알 수 없습니다. publishable 키 또는 anon public 키여야 합니다');
}

function parseInvite(code) {
  const raw = String(code || '').trim();
  if (!raw) throw new Error('초대 코드가 비어 있습니다');
  let obj;
  try {
    obj = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch (_) {
    throw new Error('초대 코드 형식이 올바르지 않습니다');
  }
  if (!obj || !obj.u || !obj.k || !obj.r) throw new Error('초대 코드에 빠진 항목이 있습니다');
  assertPublicKey(obj.k);
  return { url: normalizeUrl(obj.u), key: obj.k, room: String(obj.r) };
}

const randomRoom = () => Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);

/* ----------------------- 접속 ----------------------- */
/* realtime-js 의 오류 문구는 그대로 보여주기엔 불친절하다. 흔한 경우만 바꿔준다. */
function friendlyError(raw) {
  const m = String(raw || '');
  if (/transport failure|websocket|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(m)) {
    return '서버에 연결할 수 없습니다. 초대 코드의 주소와 네트워크를 확인하세요';
  }
  if (/401|unauthorized|jwt|apikey|token/i.test(m)) {
    return '접속이 거부되었습니다. 초대 코드의 키가 올바른지 확인하세요';
  }
  if (/TIMED_OUT|timeout/i.test(m)) return '연결 시간이 초과되었습니다';
  return m || '연결에 실패했습니다';
}

function setStatus(next, detail) {
  status = next;
  onEvent({ t: 'status', status: next, detail });
}

function connect({ invite, name }, emit) {
  disconnect();
  onEvent = typeof emit === 'function' ? emit : () => {};

  let cfg;
  try {
    cfg = parseInvite(invite);
  } catch (err) {
    setStatus('error', err.message);
    return { ok: false, error: err.message };
  }

  myId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  setStatus('connecting');

  try {
    client = new RealtimeClient(`${cfg.url}/realtime/v1`, {
      params: { apikey: cfg.key, eventsPerSecond: 20 },
      transport: WebSocketImpl,
    });

    channel = client.channel(`pet:${cfg.room}`, {
      config: {
        presence: { key: myId },
        broadcast: { self: false },     // 내가 보낸 건 되돌려 받지 않는다
      },
    });

    // 위치·동작·수익률은 전부 broadcast 로 흘린다 (저장되지 않음)
    for (const ev of ['move', 'act', 'hit', 'pnl']) {
      channel.on('broadcast', { event: ev }, ({ payload }) => {
        if (!payload || payload.id === myId) return;
        onEvent({ t: ev, ...payload });
      });
    }

    // 누가 들어오고 나갔는지는 Presence 가 관리해준다
    channel.on('presence', { event: 'sync' }, () => {
      const st = channel.presenceState();
      const peers = Object.entries(st)
        .filter(([id]) => id !== myId)
        .map(([id, metas]) => ({ id, name: (metas[0] && metas[0].name) || id.slice(0, 4) }));
      onEvent({ t: 'peers', peers });
    });
    channel.on('presence', { event: 'leave' }, ({ leftPresences, key }) => {
      const id = key || (leftPresences[0] && leftPresences[0].presence_ref);
      if (id && id !== myId) onEvent({ t: 'left', id });
    });

    channel.subscribe(async (st, err) => {
      if (st === 'SUBSCRIBED') {
        await channel.track({ name: name || '친구' });
        setStatus('online');
      } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
        setStatus('error', friendlyError((err && err.message) || st));
      } else if (st === 'CLOSED') {
        if (status !== 'idle') setStatus('idle');
      }
    });
  } catch (err) {
    setStatus('error', err.message || String(err));
    return { ok: false, error: err.message || String(err) };
  }

  return { ok: true, id: myId, room: cfg.room };
}

function disconnect() {
  try {
    if (channel) { channel.untrack(); channel.unsubscribe(); }
    if (client) client.removeAllChannels();
    if (client) client.disconnect();
  } catch (_) { /* ignore */ }
  channel = null;
  client = null;
  if (status !== 'idle') { status = 'idle'; onEvent({ t: 'status', status: 'idle' }); }
}

/* 위치는 이동 중에만, 그 외에는 이벤트가 생길 때만 보낸다.
   캐릭터가 기본으로 정지해 있으므로 평소 트래픽은 0 이다. */
function send(event, payload) {
  if (!channel || status !== 'online') return false;
  channel.send({ type: 'broadcast', event, payload: { ...payload, id: myId } });
  return true;
}

module.exports = {
  connect, disconnect, send, makeInvite, parseInvite, randomRoom, assertPublicKey, normalizeUrl,
  getStatus: () => status,
  getId: () => myId,
};
