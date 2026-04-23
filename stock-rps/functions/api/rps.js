// 锂矿板块相对强度排名 - Cloudflare Pages Function
// 拉取腾讯财经K线数据，计算RPS及排名变化
// RPS计算：Z-score → 正态CDF映射，幅度敏感
const STOCKS = [
  { code: '002460', name: '赣锋锂业', market: 'sz' },
  { code: '002466', name: '天齐锂业', market: 'sz' },
  { code: '002738', name: '中矿资源', market: 'sz' },
  { code: '300390', name: '天华新能', market: 'sz' },
  { code: '000792', name: '盐湖股份', market: 'sz' },
  { code: '002240', name: '盛新锂能', market: 'sz' },
  { code: '002756', name: '永兴材料', market: 'sz' },
  { code: '002497', name: '雅化集团', market: 'sz' },
  { code: '000155', name: '川能动力', market: 'sz' },
  { code: '002192', name: '融捷股份', market: 'sz' },
  { code: '002176', name: '江特电机', market: 'sz' },
  { code: '000762', name: '西藏矿业', market: 'sz' },
];

const CACHE_TTL = 3600 * 1000; // 1小时
let cachedBody = null;
let cacheTime = 0;

async function fetchKline(stock) {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${stock.market}${stock.code},day,,,500,qfq`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!resp.ok) throw new Error(`Fetch ${stock.code} failed: ${resp.status}`);

  const json = await resp.json();
  if (json.code !== 0 || !json.data) throw new Error(`No data for ${stock.code}`);

  const codeKey = `${stock.market}${stock.code}`;
  const dayData = json.data[codeKey];
  if (!dayData) throw new Error(`No data key for ${stock.code}`);

  const rawKlines = dayData.qfqday || dayData.day;
  if (!rawKlines || rawKlines.length === 0) throw new Error(`No kline for ${stock.code}`);

  const klines = rawKlines.map(line => ({
    date: line[0],
    open: +line[1],
    close: +line[2],
    high: +line[3],
    low: line.length > 4 ? +line[4] : +line[3],
    volume: line.length > 5 ? +line[5] : 0,
    change_pct: 0, // calculated below
  }));

  // Calculate change_pct
  for (let i = 0; i < klines.length; i++) {
    if (i === 0) {
      klines[i].change_pct = 0;
    } else {
      const prev = klines[i - 1].close;
      klines[i].change_pct = prev > 0 ? +((klines[i].close - prev) / prev * 100).toFixed(2) : 0;
    }
  }

  return { code: stock.code, name: stock.name, klines };
}

// 标准正态累积分布函数 Φ(z) = 0.5 * (1 + erf(z / sqrt(2)))
// Abramowitz & Stegun 近似，精度 < 1e-7
function normCDF(z) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

function calcRPS(stocksData) {
  const periods = [
    { label: '1d', offset: 1 },
    { label: '5d', offset: 5 },
    { label: '20d', offset: 20 },
  ];

  const results = stocksData.map(s => ({
    code: s.code,
    name: s.name,
    price: s.klines[s.klines.length - 1].close,
    change_pct: s.klines[s.klines.length - 1].change_pct,
    rps: {},
  }));

  for (const { label, offset } of periods) {
    // 当期涨幅
    const curReturns = stocksData.map((s, i) => {
      const len = s.klines.length;
      if (len <= offset) return { i, ret: -Infinity };
      return { i, ret: (s.klines[len - 1].close - s.klines[len - 1 - offset].close) / s.klines[len - 1 - offset].close };
    });

    // 计算有效涨幅的均值和标准差
    const validReturns = curReturns.filter(r => r.ret > -Infinity).map(r => r.ret);
    const mean = validReturns.reduce((a, b) => a + b, 0) / validReturns.length;
    const variance = validReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / validReturns.length;
    const std = Math.sqrt(variance);

    // Z-score → 正态 CDF 映射 → RPS
    curReturns.sort((a, b) => b.ret - a.ret);
    curReturns.forEach((item, rank) => {
      let rpsValue;
      if (std > 0 && item.ret > -Infinity) {
        const z = (item.ret - mean) / std;
        rpsValue = Math.round(normCDF(z) * 1000) / 10;
      } else if (item.ret > -Infinity) {
        rpsValue = 50; // 所有涨幅相同
      } else {
        rpsValue = 0; // 数据不足
      }
      results[item.i].rps[label] = {
        value: rpsValue,
        rank: rank + 1,
        rank_change: 0,
      };
    });

    // 历史 RPS（用于排名变化）
    const allHaveHist = stocksData.every(s => s.klines.length > offset + offset);
    if (!allHaveHist) continue;

    const histReturns = stocksData.map((s, i) => {
      const len = s.klines.length;
      const ret = (s.klines[len - 1 - offset].close - s.klines[len - 1 - offset - offset].close)
        / s.klines[len - 1 - offset - offset].close;
      return { i, ret };
    });
    histReturns.sort((a, b) => b.ret - a.ret);
    histReturns.forEach((item, histRank) => {
      const cur = results[item.i].rps[label];
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