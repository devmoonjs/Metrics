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
/* { u: 프로젝트 URL, k: anon key, r: 방 이름 } 을 base64url 로 묶은 한 줄 문자열. */
function makeInvite({ url, key, room }) {
  const json = JSON.stringify({ u: String(url).replace(/\/+$/, ''), k: key, r: room });
  return Buffer.from(json, 'utf8').toString('base64url');
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
  if (!/^https:\/\/[\w.-]+$/.test(obj.u)) throw new Error('초대 코드의 주소가 올바르지 않습니다');
  return { url: obj.u, key: obj.k, room: String(obj.r) };
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
  connect, disconnect, send, makeInvite, parseInvite, randomRoom,
  getStatus: () => status,
  getId: () => myId,
};
