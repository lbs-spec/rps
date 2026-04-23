// 锂矿板块相对强度排名 - Cloudflare Pages Function
// 拉取东方财富K线数据，计算RPS及排名变化

const STOCKS = [
  { code: '002460', name: '赣锋锂业', market: 0 },
  { code: '002466', name: '天齐锂业', market: 0 },
  { code: '002738', name: '中矿资源', market: 0 },
  { code: '300390', name: '天华新能', market: 0 },
  { code: '000792', name: '盐湖股份', market: 0 },
  { code: '002240', name: '盛新锂能', market: 0 },
  { code: '002756', name: '永兴材料', market: 0 },
  { code: '002497', name: '雅化集团', market: 0 },
  { code: '000155', name: '川能动力', market: 0 },
  { code: '002192', name: '融捷股份', market: 0 },
  { code: '002176', name: '江特电机', market: 0 },
  { code: '000762', name: '西藏矿业', market: 0 },
];

const CACHE_TTL = 3600 * 1000; // 1小时
let cachedBody = null;
let cacheTime = 0;

async function fetchKline(stock) {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get`
    + `?secid=${stock.market}.${stock.code}`
    + `&fields1=f1,f2,f3,f4,f5,f6`
    + `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`
    + `&klt=101&fqt=1&beg=0&end=20500101`;

  const resp = await fetch(url, {
    headers: {
      'Referer': 'https://quote.eastmoney.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!resp.ok) throw new Error(`Fetch ${stock.code} failed: ${resp.status}`);

  const json = await resp.json();
  if (!json.data || !json.data.klines) throw new Error(`No kline for ${stock.code}`);

  const klines = json.data.klines.map(line => {
    const p = line.split(',');
    return {
      date: p[0],
      open: +p[1],
      close: +p[2],
      high: +p[3],
      low: +p[4],
      volume: +p[5],
      amount: +p[6],
      amplitude: +p[7],
      change_pct: +p[8],
      change_amount: +p[9],
      turnover: +p[10],
    };
  });

  return { code: stock.code, name: json.data.name || stock.name, klines };
}

function calcRPS(stocksData) {
  const n = stocksData.length;
  const periods = [
    { label: '1d', offset: 1 },
    { label: '5d', offset: 5 },
    { label: '20d', offset: 20 },
  ];

  // 构建结果骨架
  const results = stocksData.map(s => ({
    code: s.code,
    name: s.name,
    price: s.klines[s.klines.length - 1].close,
    change_pct: s.klines[s.klines.length - 1].change_pct,
    rps: {},
  }));

  for (const { label, offset } of periods) {
    // —— 当期 RPS ——
    const curReturns = stocksData.map((s, i) => {
      const len = s.klines.length;
      if (len <= offset) return { i, ret: -Infinity };
      return { i, ret: (s.klines[len - 1].close - s.klines[len - 1 - offset].close) / s.klines[len - 1 - offset].close };
    });
    curReturns.sort((a, b) => b.ret - a.ret);
    curReturns.forEach((item, rank) => {
      results[item.i].rps[label] = {
        value: Math.round((1 - (rank + 1) / n) * 1000) / 10,
        rank: rank + 1,
        rank_change: 0,
      };
    });

    // —— 历史 RPS（用于排名变化） ——
    const histOffset = offset; // 1日前 / 5日前 / 20日前
    const allHaveHist = stocksData.every(s => s.klines.length > offset + histOffset);
    if (!allHaveHist) continue;

    const histReturns = stocksData.map((s, i) => {
      const len = s.klines.length;
      const ret = (s.klines[len - 1 - histOffset].close - s.klines[len - 1 - histOffset - offset].close)
        / s.klines[len - 1 - histOffset - offset].close;
      return { i, ret };
    });
    histReturns.sort((a, b) => b.ret - a.ret);
    histReturns.forEach((item, histRank) => {
      const cur = results[item.i].rps[label];
      // 正数 = 排名上升（好事），负数 = 排名下降
      cur.rank_change = (histRank + 1) - cur.rank;
    });
  }

  return results;
}

export async function onRequestGet(context) {
  const now = Date.now();

  // 缓存命中
  if (cachedBody && (now - cacheTime) < CACHE_TTL) {
    return new Response(cachedBody, {
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
    });
  }

  try {
    // 并行拉取全部K线
    const stocksData = await Promise.all(STOCKS.map(s => fetchKline(s)));

    // 计算 RPS
    const stocks = calcRPS(stocksData);

    // 拼装K线数据
    const kline = {};
    for (const s of stocksData) {
      kline[s.code] = {
        dates: s.klines.map(k => k.date),
        open:   s.klines.map(k => k.open),
        close:  s.klines.map(k => k.close),
        high:   s.klines.map(k => k.high),
        low:    s.klines.map(k => k.low),
        volume: s.klines.map(k => k.volume),
        change_pct: s.klines.map(k => k.change_pct),
      };
    }

    const body = JSON.stringify({
      lastUpdate: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      stocks,
      kline,
    });

    cachedBody = body;
    cacheTime = now;

    return new Response(body, {
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
    });
  } catch (err) {
    // 有旧缓存就返回旧数据
    if (cachedBody) {
      return new Response(cachedBody, {
        headers: { 'Content-Type': 'application/json', 'X-Cache': 'STALE' },
      });
    }
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
