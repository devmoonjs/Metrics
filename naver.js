// 네이버 금융 비공식 API 접근 (메인 프로세스 전용 · CORS 회피)
const { net } = require('electron');

function httpGet(url, referer = 'https://finance.naver.com/') {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url });
    request.setHeader('User-Agent', 'Mozilla/5.0');
    request.setHeader('Referer', referer);
    request.setHeader('Accept', 'application/json');
    let body = '';
    request.on('response', (res) => {
      res.on('data', (c) => (body += c.toString()));
      res.on('end', () => resolve(body));
    });
    request.on('error', reject);
    request.end();
  });
}

/** 폴링 응답 한 건(d)을 표시용으로 정규화 */
function parseQuote(d, market) {
  const dirCode = d.compareToPreviousPrice && d.compareToPreviousPrice.code; // 1상한 2상승 3보합 4하한 5하락
  let direction = 'flat';
  if (dirCode === '1' || dirCode === '2') direction = 'up';
  else if (dirCode === '4' || dirCode === '5') direction = 'down';

  const price = d.closePrice || '';
  const priceRaw = price ? Number(String(price).replace(/,/g, '')) : null;
  const nation = (d.stockExchangeType && d.stockExchangeType.nationCode) || (market === 'world' ? 'USA' : 'KOR');

  return {
    market,
    code: d.symbolCode || d.itemCode || '',
    reutersCode: d.reutersCode || d.symbolCode || d.itemCode || '',
    name: d.stockName || '',
    price,
    priceRaw,
    change: d.compareToPreviousClosePrice || '',
    ratio: d.fluctuationsRatio || '',
    direction,
    marketStatus: d.marketStatus || '',
    nation,
    currency: nation === 'KOR' ? '₩' : '$',
  };
}

/**
 * watchlist 시세 배치 조회. 시장별로 콤마로 묶어 호출.
 * list: [{ queryCode, market }]   반환: { [queryCode]: quote }
 */
async function fetchQuotes(list) {
  const byMarket = { domestic: [], world: [] };
  for (const it of list) {
    if (it && it.queryCode) (byMarket[it.market] || byMarket.domestic).push(it.queryCode);
  }
  const out = {};
  for (const market of ['domestic', 'world']) {
    const codes = byMarket[market];
    if (!codes.length) continue;
    const pathSeg = market === 'world' ? 'worldstock' : 'domestic'; // API 경로명은 worldstock
    const url = `https://polling.finance.naver.com/api/realtime/${pathSeg}/stock/${codes.map(encodeURIComponent).join(',')}`;
    try {
      const json = JSON.parse(await httpGet(url, 'https://m.stock.naver.com/'));
      for (const d of (json.datas || [])) {
        const q = parseQuote(d, market);
        out[market === 'world' ? q.reutersCode : q.code] = q;
      }
    } catch (_) { /* 해당 시장 실패 → 누락 */ }
  }
  return out;
}

/** 종목명/코드 검색 (한국·미국 동시) */
async function searchSymbol(query) {
  const url = `https://m.stock.naver.com/front-api/search/autoComplete?query=${encodeURIComponent(query)}&target=stock`;
  const json = JSON.parse(await httpGet(url, 'https://m.stock.naver.com/'));
  const items = (json.result && json.result.items) || [];
  return items.map((it) => {
    const market = (it.url || '').includes('worldstock') ? 'world' : 'domestic';
    return {
      name: it.name,
      code: it.code,
      reutersCode: it.reutersCode || it.code,
      nation: it.nationCode,
      typeName: it.typeName,
      market,
      queryCode: market === 'world' ? (it.reutersCode || it.code) : it.code,
    };
  });
}

module.exports = { fetchQuotes, searchSymbol };
