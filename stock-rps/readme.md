# 锂矿板块相对强度排名

部署在 Cloudflare Pages 的锂矿板块 RPS 排名 & K线分析页面。

## 12 只锂矿股

赣锋锂业、天齐锂业、中矿资源、天华新能、盐湖股份、盛新锂能、永兴材料、雅化集团、川能动力、融捷股份、江特电机、西藏矿业

## 功能

- **相对强度排名表**：1日/5日/20日 RPS 值 + 排名变化（↑↓），点击列头排序
- **叠加K线图**：多选股票 → 归一化折线对比；单选 → 蜡烛图 + 成交量
- **自动刷新**：交易时段每 1 小时自动更新

## 本地开发

需安装 [Node.js](https://nodejs.org/)，然后：

```bash
npx wrangler pages dev ./public --port 8788
```

浏览器打开 http://localhost:8788

## 部署到 Cloudflare Pages

1. 将此仓库推送到 GitHub
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → Pages → Create project
3. 连接 GitHub 仓库
4. 配置：
   - **Build command**: 留空
   - **Build output directory**: `public`
5. 部署完成后获得 `https://xxx.pages.dev` 域名

`functions/` 目录会被 Cloudflare 自动识别为 Pages Functions。

## RPS 公式

```
RPS = (1 - 涨幅排名 / 12) × 100
```

排名范围：12 只锂矿股内部。涨幅最高排第 1 名，RPS 最高约 91.7。

## 项目结构

```
├── functions/
│   └── api/
│       └── rps.js        # Pages Function：拉取数据 + 计算 RPS
├── public/
│   ├── index.html         # 主页面
│   └── app.js             # 前端逻辑（ECharts）
└── README.md
```
