/**
 * 由历史数据生成“报告”：日环比、单价变化、趋势序列。
 * 这里只做纯计算，输出结构化数据，交给 site 模块渲染。
 */

import { localDateKey, localLabel, localIso } from './util/time.js';
import { formatMoney, round } from './util/parse.js';

const EPSILON = 1e-9;

/** 把数据点数组转成便于渲染的对象序列 */
function toSeries(points, weightGrams) {
  return points.map(([ts, price, unitPrice]) => ({
    t: ts,
    price,
    unitPrice: unitPrice ?? (weightGrams ? round(price / weightGrams, 4) : null),
  }));
}

/**
 * 等距抽稀，保留走势形状。返回值始终包含最后一个点。
 */
export function downsample(series, maxPoints = 800) {
  if (series.length <= maxPoints) return series;
  const bucketSize = series.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(series.length, Math.floor((i + 1) * bucketSize));
    if (end <= start) continue;
    out.push(series[end - 1]);
  }
  const last = series[series.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function pickReferencePoint(points, latestIndex, timeZone) {
  if (latestIndex <= 0) return null;
  const latestKey = localDateKey(new Date(points[latestIndex][0]), timeZone);
  for (let i = latestIndex - 1; i >= 0; i -= 1) {
    if (localDateKey(new Date(points[i][0]), timeZone) !== latestKey) return points[i];
  }
  return null;
}

function changeOf(current, previous) {
  if (previous === null || previous === undefined) {
    return { change: null, changePct: null };
  }
  const change = current - previous;
  const changePct = Math.abs(previous) > EPSILON ? (change / previous) * 100 : null;
  return { change: round(change, 4), changePct: round(changePct, 4) };
}

/**
 * @param {object} history
 * @param {object} config 已校验的配置
 * @param {Date} now
 */
export function buildReport(history, config, now = new Date()) {
  const timeZone = config.settings.timezone;
  const { currencySymbol, unitLabel, currency } = config.settings;
  const enabledItems = config.items.filter((item) => item.enabled);

  const items = enabledItems.map((item) => {
    const entry = history.items[item.id] ?? { points: [] };
    const points = Array.isArray(entry.points) ? entry.points : [];
    const weightGrams = entry.weightGrams ?? item.weightGrams ?? null;

    if (points.length === 0) {
      return {
        id: item.id,
        name: item.name,
        url: item.url,
        tags: item.tags,
        parser: item.parser,
        note: item.note,
        weightGrams,
        unitLabel,
        hasData: false,
        stale: true,
        error: entry.lastError?.message ?? null,
        lastRunAt: entry.lastRunAt ?? null,
        lastRunLabel: entry.lastRunAt ? localLabel(new Date(entry.lastRunAt), timeZone) : null,
        currency,
        currencySymbol,
        series: [],
      };
    }

    const latest = points[points.length - 1];
    const reference = pickReferencePoint(points, points.length - 1, timeZone);
    const latestDateKey = localDateKey(new Date(latest[0]), timeZone);
    const referenceDateKey = reference ? localDateKey(new Date(reference[0]), timeZone) : null;

    const priceChange = changeOf(latest[1], reference ? reference[1] : null);
    const latestUnit = weightGrams ? round(latest[1] / weightGrams, 4) : null;
    const referenceUnit = reference && weightGrams ? round(reference[1] / weightGrams, 4) : null;
    const unitChange =
      latestUnit !== null && referenceUnit !== null ? changeOf(latestUnit, referenceUnit) : { change: null, changePct: null };

    const prices = points.map((p) => p[1]);
    const first = points[0];
    const overall = changeOf(latest[1], first[1]);

    const lastError = entry.lastError && entry.lastRunAt === latest[0] ? entry.lastError.message : null;

    return {
      id: item.id,
      name: entry.name || item.name,
      url: item.url,
      tags: item.tags,
      parser: item.parser,
      note: item.note,
      weightGrams,
      unitLabel,
      hasData: true,
      currency,
      currencySymbol,

      latestAt: latest[0],
      latestAtIso: localIso(new Date(latest[0]), timeZone),
      latestLabel: localLabel(new Date(latest[0]), timeZone),
      latestDateKey,
      latestPrice: latest[1],
      latestUnit,

      referenceAt: reference ? reference[0] : null,
      referenceDateKey,
      referenceLabel: reference ? localLabel(new Date(reference[0]), timeZone) : null,
      referencePrice: reference ? reference[1] : null,
      referenceUnit,

      change: priceChange.change,
      changePct: priceChange.changePct,
      direction: priceChange.change === null ? 'none' : priceChange.change < -EPSILON ? 'down' : priceChange.change > EPSILON ? 'up' : 'flat',
      unitChange: unitChange.change,
      unitChangePct: unitChange.changePct,
      unitDirection:
        unitChange.change === null ? 'none' : unitChange.change < -EPSILON ? 'down' : unitChange.change > EPSILON ? 'up' : 'flat',

      min: round(Math.min(...prices), 4),
      max: round(Math.max(...prices), 4),
      firstAt: first[0],
      firstPrice: first[1],
      firstLabel: localLabel(new Date(first[0]), timeZone),
      overallChange: overall.change,
      overallChangePct: overall.changePct,

      pointCount: points.length,
      stale: lastError !== null,
      error: lastError,
      lastErrorAny: entry.lastError?.message ?? null,
      series: downsample(toSeries(points, weightGrams), 800),
    };
  });

  const withData = items.filter((i) => i.hasData);
  const drops = withData
    .filter((i) => i.direction === 'down')
    .sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0));
  const rises = withData
    .filter((i) => i.direction === 'up')
    .sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
  const flats = withData.filter((i) => i.direction === 'flat');
  const pending = withData.filter((i) => i.direction === 'none');
  const failed = items.filter((i) => i.stale && i.lastErrorAny);

  const allPoints = withData.reduce((sum, i) => sum + i.pointCount, 0);
  const earliest = withData.reduce((min, i) => (min === null || i.firstAt < min ? i.firstAt : min), null);

  return {
    generatedAt: now.getTime(),
    generatedAtIso: localIso(now, timeZone),
    generatedAtLabel: localLabel(now, timeZone, { withSeconds: true }),
    timeZone,
    currency,
    currencySymbol,
    unitLabel,
    items,
    drops,
    rises,
    flats,
    pending,
    failed,
    stats: {
      monitored: items.length,
      withData: withData.length,
      totalPoints: allPoints,
      earliestAt: earliest,
      earliestLabel: earliest ? localLabel(new Date(earliest), timeZone) : null,
      days: earliest ? Math.max(1, Math.ceil((now.getTime() - earliest) / 86400000)) : 0,
    },
  };
}

/** 生成一段人话版提示语，用于页面顶部与 Actions 摘要 */
export function summarize(report) {
  const { drops, rises, currencySymbol } = report;
  const lines = [];
  if (drops.length > 0) {
    const parts = drops.map((item) => {
      let text = `${item.name} ${formatMoney(item.change, 2)} 元`;
      if (item.changePct !== null) text += `（${item.changePct.toFixed(2)}%）`;
      if (item.unitChange !== null) {
        text += `，单价 ${formatMoney(item.referenceUnit, 2)} → ${formatMoney(item.latestUnit, 2)} ${item.unitLabel}（${item.unitChange > 0 ? '+' : ''}${formatMoney(item.unitChange, 2)}）`;
      }
      return text;
    });
    lines.push(`${drops.length} 个商品降价：${parts.join('；')}`);
  } else {
    lines.push('本次对比没有发现降价商品');
  }
  if (rises.length > 0) {
    lines.push(`${rises.length} 个商品涨价：${rises.map((i) => `${i.name} +${formatMoney(i.change, 2)} 元`).join('；')}`);
  }
  void currencySymbol;
  return lines.join('\n');
}
