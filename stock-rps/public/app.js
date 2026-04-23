// 锂矿板块相对强度排名 - 前端逻辑

const STOCK_META = {
  '002460': { name: '赣锋锂业', color: '#ef4444' },
  '002466': { name: '天齐锂业', color: '#f97316' },
  '002738': { name: '中矿资源', color: '#eab308' },
  '300390': { name: '天华新能', color: '#22c55e' },
  '000792': { name: '盐湖股份', color: '#06b6d4' },
  '002240': { name: '盛新锂能', color: '#3b82f6' },
  '002756': { name: '永兴材料', color: '#8b5cf6' },
  '002497': { name: '雅化集团', color: '#ec4899' },
  '000155': { name: '川能动力', color: '#14b8a6' },
  '002192': { name: '融捷股份', color: '#f59e0b' },
  '002176': { name: '江特电机', color: '#6366f1' },
  '000762': { name: '西藏矿业', color: '#84cc16' },
};

let data = null;
let selected = new Set(Object.keys(STOCK_META));
let sortKey = '20d';
let chart = null;
let refreshTimer = null;

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  chart = echarts.init(document.getElementById('chart'), 'dark');
  window.addEventListener('resize', () => chart && chart.resize());
  loadData();

  // 排序点击
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      sortKey = th.dataset.sort;
      document.querySelectorAll('th[data-sort]').forEach(t => t.classList.remove('active'));
      th.classList.add('active');
      renderTable();
    });
  });

  // 默认 20d 排序高亮
  document.querySelector('th[data-sort="20d"]').classList.add('active');
  document.querySelector('th[data-sort="1d"]').classList.remove('active');
});

async function loadData() {
  showState('loading');
  try {
    const resp = await fetch('/api/rps');
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    data = await resp.json();
    showState('main');
    render();
    // 确保容器可见后 resize 图表
    setTimeout(() => { if (chart) chart.resize(); }, 50);
    startAutoRefresh();
  } catch (e) {
    document.getElementById('errorMsg').textContent = '数据加载失败: ' + e.message;
    showState('error');
  }
}

function refreshData() {
  loadData();
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    // 非交易时段(周末+非9:30-15:00)不刷新
    const now = new Date();
    const day = now.getDay();
    const h = now.getHours(), m = now.getMinutes();
    const t = h * 60 + m;
    if (day === 0 || day === 6) return;
    if (t < 570 || t > 900) return; // 9:30-15:00
    loadData();
  }, 3600000); // 1小时
}

// ── Render ──
function render() {
  document.getElementById('updateTime').textContent = '更新: ' + data.lastUpdate;
  renderTable();
  renderSelector();
  updateChart();
}

function renderTable() {
  const sorted = [...data.stocks].sort((a, b) => {
    return (b.rps[sortKey]?.value || 0) - (a.rps[sortKey]?.value || 0);
  });

  const tbody = document.getElementById('tbody');
  tbody.innerHTML = sorted.map((s, i) => {
    const rank = i + 1;
    const priceClass = s.change_pct >= 0 ? 'change-up' : 'change-down';
    const priceStr = s.price.toFixed(2);
    const pctStr = (s.change_pct >= 0 ? '+' : '') + s.change_pct.toFixed(2) + '%';

    let cells = `<td>${rank}</td><td class="name-cell">${s.name}</td>`;
    cells += `<td class="price-cell ${priceClass}">${priceStr}<br><span style="font-size:11px">${pctStr}</span></td>`;

    for (const p of ['1d', '5d', '20d']) {
      const r = s.rps[p];
      if (!r) { cells += '<td>—</td><td>—</td>'; continue; }
      const cls = r.value >= 75 ? 'rps-high' : r.value >= 40 ? 'rps-mid' : 'rps-low';
      cells += `<td class="rps-val ${cls}">${r.value.toFixed(1)}</td>`;
      cells += `<td>${fmtChange(r.rank_change)}</td>`;
    }
    return `<tr>${cells}</tr>`;
  }).join('');
}

function fmtChange(c) {
  if (c > 0) return `<span class="change-up">↑${c}</span>`;
  if (c < 0) return `<span class="change-down">↓${Math.abs(c)}</span>`;
  return `<span class="change-same">—</span>`;
}

function renderSelector() {
  const box = document.getElementById('selector');
  let html = `<span class="select-all-btn" onclick="event.stopPropagation();toggleAll()">${selected.size === 12 ? '全不选' : '全选'}</span>`;
  for (const [code, meta] of Object.entries(STOCK_META)) {
    const on = selected.has(code);
    html += `<span class="stock-tag${on ? ' checked' : ''}" onclick="event.stopPropagation();toggleStock('${code}')">
      <span class="dot" style="background:${meta.color}"></span>${meta.name}
    </span>`;
  }
  box.innerHTML = html;
}

function toggleStock(code) {
  if (selected.has(code)) selected.delete(code); else selected.add(code);
  renderSelector();
  updateChart();
}

function toggleAll() {
  if (selected.size === 12) selected.clear(); else Object.keys(STOCK_META).forEach(c => selected.add(c));
  renderSelector();
  updateChart();
}

// ── Chart ──
function updateChart() {
  const codes = [...selected];
  const emptyEl = document.getElementById('chartEmpty');
  const chartEl = document.getElementById('chart');

  if (codes.length === 0) {
    emptyEl.style.display = 'flex';
    chartEl.style.display = 'none';
    chart.clear();
    return;
  }
  emptyEl.style.display = 'none';
  chartEl.style.display = 'block';

  if (codes.length === 1) {
    renderCandlestick(codes[0]);
  } else {
    renderNormalized(codes);
  }
  // 确保图表宽度适配容器
  setTimeout(() => { if (chart) chart.resize(); }, 0);
}

function renderCandlestick(code) {
  const k = data.kline[code];
  const name = STOCK_META[code].name;
  const len = k.dates.length;

  // 默认显示最近1年
  const startIdx = Math.max(0, len - 250);
  const startPercent = Math.round((startIdx / len) * 100);

  const candleData = k.dates.map((_, i) => [k.open[i], k.close[i], k.low[i], k.high[i]]);
  const volData = k.dates.map((_, i) => ({
    value: k.volume[i],
    itemStyle: {
      color: k.close[i] >= k.open[i] ? 'rgba(239,68,68,.45)' : 'rgba(34,197,94,.45)',
    },
  }));

  chart.setOption({
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: function(params) {
        if (!params || !params.length) return '';
        const idx = params[0].dataIndex;
        const d = k.dates[idx];
        let s = `<div style="font-size:12px;margin-bottom:4px">${name} ${d}</div>`;
        s += `开 ${k.open[idx].toFixed(2)} 收 ${k.close[idx].toFixed(2)}<br>`;
        s += `高 ${k.high[idx].toFixed(2)} 低 ${k.low[idx].toFixed(2)}<br>`;
        s += `量 ${(k.volume[idx]/10000).toFixed(0)}万 涨跌 ${k.change_pct[idx].toFixed(2)}%`;
        return s;
      }
    },
    grid: [
      { left: '8%', right: '3%', top: '4%', height: '58%' },
      { left: '8%', right: '3%', top: '70%', height: '18%' },
    ],
    xAxis: [
      { type: 'category', data: k.dates, gridIndex: 0, axisLabel: { show: false }, axisTick: { show: false }, boundaryGap: true },
      { type: 'category', data: k.dates, gridIndex: 1, axisLabel: { color: '#64748b', fontSize: 11 }, boundaryGap: true },
    ],
    yAxis: [
      { type: 'value', scale: true, gridIndex: 0, splitLine: { lineStyle: { color: '#1e293b' } }, axisLabel: { color: '#94a3b8', fontSize: 11 } },
      { type: 'value', scale: true, gridIndex: 1, splitLine: { show: false }, axisLabel: { color: '#64748b', fontSize: 10, formatter: v => (v/10000).toFixed(0)+'万' } },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: startPercent, end: 100 },
      { type: 'slider', xAxisIndex: [0, 1], bottom: '2%', height: 20, start: startPercent, end: 100, borderColor: '#1e293b', fillerColor: 'rgba(59,130,246,.15)', handleStyle: { color: '#3b82f6' } },
    ],
    series: [
      {
        name, type: 'candlestick',
        data: candleData,
        xAxisIndex: 0, yAxisIndex: 0,
        itemStyle: { color: '#ef4444', color0: '#22c55e', borderColor: '#ef4444', borderColor0: '#22c55e' },
      },
      {
        name: '成交量', type: 'bar',
        data: volData,
        xAxisIndex: 1, yAxisIndex: 1,
      },
    ],
  }, true);
}

function renderNormalized(codes) {
  // 求日期交集
  const dateSets = codes.map(c => new Set(data.kline[c].dates));
  let common = [...dateSets[0]].filter(d => dateSets.every(s => s.has(d)));
  common.sort();

  if (common.length === 0) {
    chart.setOption({ title: { text: '无共同交易日', left: 'center', top: 'center', textStyle: { color: '#64748b' } } }, true);
    return;
  }

  // 默认显示最近1年
  const startIdx = Math.max(0, common.length - 250);
  const startPercent = Math.round((startIdx / common.length) * 100);

  const series = codes.map(code => {
    const k = data.kline[code];
    const name = STOCK_META[code].name;
    const color = STOCK_META[code].color;
    const dateMap = {};
    k.dates.forEach((d, i) => dateMap[d] = i);
    const baseIdx = dateMap[common[0]];
    const baseClose = k.close[baseIdx];
    const values = common.map(d => {
      const idx = dateMap[d];
      if (idx === undefined) return null;
      return +(k.close[idx] / baseClose * 100).toFixed(2);
    });
    return { name, type: 'line', data: values, smooth: false, symbol: 'none', lineStyle: { width: 1.8, color }, itemStyle: { color } };
  });

  chart.setOption({
    animation: false,
    tooltip: {
      trigger: 'axis',
      formatter: function(params) {
        if (!params || !params.length) return '';
        let s = `<div style="font-size:12px;margin-bottom:4px">${params[0].axisValue}</div>`;
        for (const p of params) {
          const pct = (p.value - 100).toFixed(2);
          const sign = pct >= 0 ? '+' : '';
          s += `${p.marker} ${p.seriesName}: ${p.value.toFixed(2)} (${sign}${pct}%)<br>`;
        }
        return s;
      }
    },
    legend: { data: codes.map(c => STOCK_META[c].name), top: 4, textStyle: { color: '#94a3b8', fontSize: 12 } },
    grid: { left: '8%', right: '3%', top: '10%', bottom: '14%' },
    xAxis: { type: 'category', data: common, axisLabel: { color: '#64748b', fontSize: 11 } },
    yAxis: {
      type: 'value',
      name: '基准=100',
      nameTextStyle: { color: '#64748b', fontSize: 11 },
      scale: true,
      splitLine: { lineStyle: { color: '#1e293b' } },
      axisLabel: { color: '#94a3b8', fontSize: 11 },
    },
    dataZoom: [
      { type: 'inside', start: startPercent, end: 100 },
      { type: 'slider', bottom: '2%', height: 20, start: startPercent, end: 100, borderColor: '#1e293b', fillerColor: 'rgba(59,130,246,.15)', handleStyle: { color: '#3b82f6' } },
    ],
    series,
  }, true);
}

// ── UI state ──
function showState(s) {
  document.getElementById('loading').style.display = s === 'loading' ? 'flex' : 'none';
  document.getElementById('mainContent').style.display = s === 'main' ? 'block' : 'none';
  document.getElementById('errorBox').style.display = s === 'error' ? 'block' : 'none';
}
