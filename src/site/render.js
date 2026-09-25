/** 生成静态展示页（单文件 HTML，样式与脚本全部内联，无外部依赖） */

import fs from 'node:fs';
import path from 'node:path';

import { formatMoney, formatPercent, formatSigned } from '../util/parse.js';

const ASSET_DIR = path.join(import.meta.dirname, 'assets');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 序列化成可安全嵌入 <script> 的 JSON */
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029'));
}

function chip(direction, text) {
  const cls = direction === 'down' ? 'chip chip--down' : direction === 'up' ? 'chip chip--up' : 'chip chip--muted';
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

function arrow(direction) {
  if (direction === 'down') return '↓';
  if (direction === 'up') return '↑';
  return '＝';
}

function deltaClass(direction) {
  return direction === 'down' ? 'num-down' : direction === 'up' ? 'num-up' : 'num-flat';
}

function deltaText(item) {
  if (item.change === null) return '尚未形成对比';
  const amount = formatSigned(item.change, 2);
  const pct = item.changePct === null ? '' : `（${formatPercent(item.changePct, 2)}）`;
  return `${amount} 元${pct}`;
}

/** 带箭头的涨跌文案；没有上一日数据时不显示箭头 */
function deltaHtml(item) {
  if (item.change === null) return `<span class="num-flat">${deltaText(item)}</span>`;
  return `${arrow(item.direction)} ${deltaText(item)}`;
}

/* ------------------------------------------------------------------ 顶部提示 --- */
function renderBanner(report) {
  const { drops, rises, failed, items } = report;
  const compareDate = drops[0]?.referenceDateKey ?? items.find((i) => i.referenceDateKey)?.referenceDateKey ?? null;
  const compareNote = compareDate ? `对比基准：${compareDate} 的最后一个价格` : '暂无上一日数据可用于对比';

  if (items.length === 0) {
    return `
      <section class="banner banner--none">
        <div class="banner__head">⚠️ 没有处于启用状态的监控商品</div>
        <div class="banner__sub">请在 config/monitor.config.yml 中至少启用一个商品。</div>
      </section>`;
  }

  if (drops.length === 0) {
    const extra = [];
    if (rises.length > 0) extra.push(`${rises.length} 个商品涨价`);
    const flatCount = items.filter((i) => i.direction === 'flat').length;
    if (flatCount > 0) extra.push(`${flatCount} 个商品价格不变`);
    const pendingCount = items.filter((i) => i.hasData && i.direction === 'none').length;
    if (pendingCount > 0) extra.push(`${pendingCount} 个商品数据不足`);

    return `
      <section class="banner banner--none">
        <div class="banner__head">✅ 没有发现降价商品</div>
        <div class="banner__sub">${escapeHtml(compareNote)}${extra.length ? ` · ${escapeHtml(extra.join('，'))}` : ''}</div>
        ${failed.length ? `<div class="banner__sub">⚠️ ${failed.length} 个商品本次抓取失败，下面用红色标注</div>` : ''}
      </section>`;
  }

  const list = drops
    .map((item) => {
      const unitLine =
        item.unitChange !== null && item.latestUnit !== null && item.referenceUnit !== null
          ? `<div class="banner__detail">单价变化：<strong>${formatMoney(item.referenceUnit, 2)} → ${formatMoney(
              item.latestUnit,
              2,
            )} ${escapeHtml(item.unitLabel)}（${formatSigned(item.unitChange, 2)}，${formatPercent(
              item.unitChangePct,
              2,
            )}）</strong>　按克重 ${escapeHtml(String(item.weightGrams))} 克折算</div>`
          : `<div class="banner__detail">该商品没有克重信息，只比较总价</div>`;

      return `
        <li>
          ${chip('down', `↓ 降 ${formatMoney(Math.abs(item.change), 2)} 元`)}
          ${item.lastErrorAny ? chip('muted', '⚠️ 本次抓取失败') : ''}
          <span class="banner__name"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
            item.name,
          )}</a></span>
          <div class="banner__detail">价格：${formatMoney(item.referencePrice, 2)} → <strong>${formatMoney(
            item.latestPrice,
            2,
          )} 元</strong>（${formatPercent(item.changePct, 2)}）</div>
          ${unitLine}
        </li>`;
    })
    .join('');

  const riseLine = rises.length
    ? `<div class="banner__sub">另有 ${rises.length} 个商品涨价：${escapeHtml(
        rises.map((i) => `${i.name} +${formatMoney(i.change, 2)} 元`).join('；'),
      )}</div>`
    : '';

  return `
    <section class="banner banner--down">
      <div class="banner__head">🟢 有 ${drops.length} 个商品降价了</div>
      <div class="banner__sub">${escapeHtml(compareNote)}${failed.length ? ` · ⚠️ ${failed.length} 个商品本次抓取失败` : ''}</div>
      <ul>${list}</ul>
      ${riseLine}
    </section>`;
}

/* ------------------------------------------------------------------ 概览表 --- */
function renderOverview(report) {
  const rows = report.items
    .map((item) => {
      if (!item.hasData) {
        return `<tr>
          <td><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.name)}</a>
            <span class="sub">暂无数据</span></td>
          <td colspan="7" class="num-flat">尚未采集到价格${item.error ? `（${escapeHtml(item.error)}）` : ''}</td>
        </tr>`;
      }
      const unitCurrent = item.latestUnit === null ? '—' : formatMoney(item.latestUnit, 2);
      const unitDelta =
        item.unitChange === null
          ? '<span class="num-flat">—</span>'
          : `<span class="${deltaClass(item.unitDirection)}">${arrow(item.unitDirection)} ${formatSigned(item.unitChange, 2)}</span>`;
      return `<tr>
        <td><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.name)}</a>
          <span class="sub">${escapeHtml(item.id)}${item.weightGrams ? ` · ${escapeHtml(String(item.weightGrams))} 克` : ''}</span></td>
        <td><b>${formatMoney(item.latestPrice, 2)}</b></td>
        <td>${item.referencePrice === null ? '—' : formatMoney(item.referencePrice, 2)}</td>
        <td class="${deltaClass(item.direction)}">${deltaHtml(item)}</td>
        <td>${unitCurrent}</td>
        <td>${unitDelta}</td>
        <td>${item.pointCount}</td>
        <td>${escapeHtml(item.latestLabel ?? '—')}</td>
      </tr>`;
    })
    .join('');

  return `
    <h2 class="section-title">📋 商品概览 <span class="hint">“变化”列为最新价格与上一日最后价格的差值</span></h2>
    <div class="card" style="padding:0">
      <div class="table-scroll">
        <table class="overview">
          <thead>
            <tr>
              <th>商品</th><th>最新价</th><th>上一日</th><th>变化</th>
              <th>单价（${escapeHtml(report.unitLabel)}）</th><th>单价变化</th>
              <th>采样点</th><th>最近更新</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ 趋势图 --- */
function renderItemCard(item, report) {
  const isDown = item.direction === 'down';
  const isUp = item.direction === 'up';

  const header = item.hasData
    ? `
      <div class="item__head">
        <div>
          <h3 class="item__title"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
            item.name,
          )}</a></h3>
          <div class="item__tags">
            ${item.tags.map((t) => `<span class="chip chip--tag">${escapeHtml(t)}</span>`).join('')}
            <span class="chip chip--muted">${escapeHtml(item.parser)}</span>
          </div>
        </div>
        <div class="item__price">
          <div class="value">${escapeHtml(report.currencySymbol)}${formatMoney(item.latestPrice, 2)}</div>
          <div class="delta ${deltaClass(item.direction)}">${deltaHtml(item)}</div>
        </div>
      </div>`
    : `
      <div class="item__head">
        <div>
          <h3 class="item__title"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
            item.name,
          )}</a></h3>
          <div class="item__tags">${item.tags.map((t) => `<span class="chip chip--tag">${escapeHtml(t)}</span>`).join('')}</div>
        </div>
        <div class="item__price"><div class="value num-flat">暂无数据</div></div>
      </div>`;

  const stats = [];
  if (item.hasData) {
    if (item.weightGrams) stats.push(`克重：${item.weightGrams} 克`);
    if (item.latestUnit !== null) stats.push(`当前单价：${formatMoney(item.latestUnit, 2)} ${item.unitLabel}`);
    if (item.referenceUnit !== null) stats.push(`上一日单价：${formatMoney(item.referenceUnit, 2)} ${item.unitLabel}`);
    stats.push(`区间：${formatMoney(item.min, 2)} ~ ${formatMoney(item.max, 2)} 元`);
    stats.push(`采样点：${item.pointCount}`);
    if (item.firstAt) stats.push(`起始：${escapeHtml(item.firstLabel)}（${formatMoney(item.firstPrice, 2)} 元）`);
    stats.push(`最近更新：${escapeHtml(item.latestLabel)}`);
  }

  const charts = item.hasData
    ? `
      <div class="chart-block">
        <div class="chart-block__label"><b>价格走势</b><span>单位：元 / ${escapeHtml(
          item.weightGrams ? `每 ${item.weightGrams} 克（整件）` : '件',
        )}</span></div>
        <div class="chart-host" data-item-id="${escapeHtml(item.id)}" data-value-key="price"></div>
      </div>
      ${
        item.weightGrams
          ? `<div class="chart-block">
              <div class="chart-block__label"><b>单价走势</b><span>单位：${escapeHtml(item.unitLabel)}（价格 ÷ ${escapeHtml(
                String(item.weightGrams),
              )} 克）</span></div>
              <div class="chart-host" data-item-id="${escapeHtml(item.id)}" data-value-key="unitPrice"></div>
            </div>`
          : ''
      }`
    : '';

  const errorBox = item.error
    ? `<div class="item__error">⚠️ 本次抓取失败：${escapeHtml(item.error)}</div>`
    : '';

  const staleNote =
    item.hasData && item.lastErrorAny && !item.error
      ? `<div class="item__error" style="color:var(--text-muted);background:color-mix(in srgb, var(--border) 40%, transparent)">上次抓取异常：${escapeHtml(
          item.lastErrorAny,
        )}</div>`
      : '';

  return `
    <article class="card item" id="item-${escapeHtml(item.id)}">
      ${header}
      ${stats.length ? `<div class="item__stats">${stats.map((s) => `<span>${s}</span>`).join('')}</div>` : ''}
      ${errorBox}
      ${staleNote}
      ${charts}
    </article>`;
}

/* ------------------------------------------------------------------ 组装页 --- */
export function renderSite({ report, config, siteBaseUrl = '', buildInfo = {} }) {
  const css = fs.readFileSync(path.join(ASSET_DIR, 'style.css'), 'utf8');
  const js = fs.readFileSync(path.join(ASSET_DIR, 'app.js'), 'utf8');

  const embed = {
    generatedAt: report.generatedAt,
    timeZone: report.timeZone,
    unitLabel: report.unitLabel,
    currencySymbol: report.currencySymbol,
    items: report.items.map((item) => ({
      id: item.id,
      name: item.name,
      weightGrams: item.weightGrams,
      unitLabel: item.unitLabel,
      currencySymbol: item.currencySymbol,
      hasData: item.hasData,
      series: item.series,
    })),
  };

  const siteUrlLine = siteBaseUrl
    ? `<span>固定网址：<a href="${escapeHtml(siteBaseUrl)}"><code>${escapeHtml(siteBaseUrl)}</code></a></span>`
    : '';

  const items = report.items.map((item) => renderItemCard(item, report)).join('');

  const failedNote = report.failed.length
    ? `<li>本次有 ${report.failed.length} 个商品抓取失败，页面上以红色标注，其价格沿用上一次成功采集的结果。</li>`
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(config.settings.title ?? '价格监控看板')}</title>
<meta name="description" content="自动监控指定网站商品价格走势，每日对比昨天是否降价。">
<meta name="color-scheme" content="light dark">
${siteBaseUrl ? `<link rel="canonical" href="${escapeHtml(siteBaseUrl)}">` : ''}
<style>${css}</style>
</head>
<body>
<div class="wrap">

  <header class="site-header">
    <h1>🪙 ${escapeHtml(config.settings.title ?? '价格监控看板')}</h1>
    <div class="meta">
      <span>数据更新时间：<code>${escapeHtml(report.generatedAtLabel)}</code>（${escapeHtml(report.timeZone)}）</span>
      <span>监控中：<code>${report.stats.monitored}</code> 个商品</span>
      <span>累计采样：<code>${report.stats.totalPoints}</code> 次</span>
      ${report.stats.earliestLabel ? `<span>最早数据：<code>${escapeHtml(report.stats.earliestLabel)}</code></span>` : ''}
      ${siteUrlLine}
    </div>
  </header>

  ${renderBanner(report)}

  ${renderOverview(report)}

  <h2 class="section-title">📈 各商品价格变化趋势 <span class="hint">鼠标 / 手指按住曲线可查看具体时间点的价格</span></h2>
  ${items || '<div class="card">暂无监控商品。</div>'}

  <div class="card footnote">
    <h2>关于本页</h2>
    <ul>
      <li>本页由 GitHub Actions 定时自动抓取、自动生成、自动发布，无需人工干预。</li>
      <li>绿色 ↓ 表示相对上一日价格下降，红色 ↑ 表示上涨；单价按商品克重折算为「${escapeHtml(report.unitLabel)}」。</li>
      <li>“降价”判定方式：取最新一次采样的价格，与<b>上一个自然日</b>（时区 ${escapeHtml(report.timeZone)}）最后一次采样的价格相减。</li>
      <li>点击商品标题可跳转到原始页面核对价格。数据仅用于个人参考，不构成任何投资或购买建议。</li>
      ${failedNote}
    </ul>
    <h2>本次构建</h2>
    <ul>
      <li>生成时间：${escapeHtml(report.generatedAtIso)}</li>
      <li>数据点总数：${report.stats.totalPoints}${report.stats.days ? `，覆盖约 ${report.stats.days} 天` : ''}</li>
      ${buildInfo.runUrl ? `<li>本次运行日志：<a href="${escapeHtml(buildInfo.runUrl)}">${escapeHtml(buildInfo.runUrl)}</a></li>` : ''}
      ${buildInfo.commit ? `<li>代码版本：<code>${escapeHtml(buildInfo.commit)}</code></li>` : ''}
      <li>数据文件：<a href="report.json"><code>report.json</code></a> · <a href="history.json"><code>history.json</code></a></li>
    </ul>
  </div>

</div>
<script type="application/json" id="report-data">${safeJson(embed)}</script>
<script>${js}</script>
</body>
</html>
`;
}

/**
 * 写出整个站点
 * @returns {{files: string[], html: string}}
 */
export function writeSite(outDir, options) {
  const html = renderSite(options);
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];

  const write = (name, content) => {
    const file = path.join(outDir, name);
    fs.writeFileSync(file, content, 'utf8');
    files.push(file);
  };

  write('index.html', html);
  write('.nojekyll', '');
  write('report.json', `${JSON.stringify(options.publicReport ?? options.report, null, 1)}\n`);
  if (options.history) write('history.json', `${JSON.stringify(options.history)}\n`);

  return { files, html };
}
