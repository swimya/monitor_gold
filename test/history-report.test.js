import assert from 'node:assert/strict';
import test from 'node:test';

import { compactHistory, countPoints, emptyHistory, recordFailure, recordSample } from '../src/history.js';
import { buildReport, downsample, summarize } from '../src/report.js';
import { parseConfig } from '../src/config.js';

const TZ = 'Asia/Shanghai';
const HOUR = 3600 * 1000;

function makeConfig(extra = '') {
  return parseConfig(`
settings:
  timezone: ${TZ}
items:
  - id: coin
    name: 测试金币
    url: https://example.com/coin
    parser: html
    parserOptions:
      priceSelector: '.price'
    weightGrams: 3
${extra}
`);
}

const ITEM = { id: 'coin', name: '测试金币', url: 'https://example.com/coin', parser: 'html', tags: [] };

test('recordSample 写入 [时间戳, 价格, 单价]', () => {
  const history = emptyHistory();
  recordSample(history, ITEM, { timestamp: 1000, name: '测试金币', price: 3000, weightGrams: 3 });
  assert.deepEqual(history.items.coin.points, [[1000, 3000, 1000]]);
  assert.equal(history.items.coin.weightGrams, 3);
});

test('recordSample 对相同时间戳是幂等的', () => {
  const history = emptyHistory();
  recordSample(history, ITEM, { timestamp: 1000, price: 3000, weightGrams: 3 });
  recordSample(history, ITEM, { timestamp: 1000, price: 2900, weightGrams: 3 });
  assert.equal(history.items.coin.points.length, 1);
  assert.equal(history.items.coin.points[0][1], 2900);
});

test('没有克重时不写单价', () => {
  const history = emptyHistory();
  recordSample(history, ITEM, { timestamp: 1000, price: 3000, weightGrams: null });
  assert.deepEqual(history.items.coin.points, [[1000, 3000, null]]);
});

test('recordFailure 只记录错误，不写数据点', () => {
  const history = emptyHistory();
  recordSample(history, ITEM, { timestamp: 1000, price: 3000, weightGrams: 3 });
  recordFailure(history, ITEM, new Error('HTTP 502'), 2000);
  assert.equal(history.items.coin.points.length, 1);
  assert.match(history.items.coin.lastError.message, /HTTP 502/);
});

test('compactHistory：近三天全量、更早每天留最后一个、超期丢弃', () => {
  const now = new Date('2026-09-25T12:00:00+08:00');
  const history = emptyHistory();
  const points = [];
  // 造 30 天、每 6 小时一个点
  for (let i = 30 * 4; i >= 0; i -= 1) {
    const ts = now.getTime() - i * 6 * HOUR;
    points.push([ts, 3000 + i, 1000]);
  }
  history.items.coin = { name: '测试金币', points };

  const { removed } = compactHistory(history, {
    now,
    timeZone: TZ,
    fullResolutionDays: 3,
    dailyRetentionDays: 400,
  });

  assert.ok(removed > 0);
  const kept = history.items.coin.points;
  assert.ok(kept.length < points.length);

  // 近 3 天内的点必须全部保留
  const fullCutoff = now.getTime() - 3 * 86400000;
  const recent = points.filter((p) => p[0] >= fullCutoff);
  assert.equal(kept.filter((p) => p[0] >= fullCutoff).length, recent.length);

  // 每天最多一个点
  const perDay = new Map();
  for (const p of kept) {
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(p[0]));
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  for (const [key, count] of perDay) {
    const allOfThatDayRecent = points.filter(
      (p) => p[0] >= fullCutoff && new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(p[0])) === key,
    );
    if (allOfThatDayRecent.length === 0) assert.equal(count, 1, `${key} 保留了 ${count} 个点`);
  }
  assert.ok(countPoints(history) > 0);
});

test('压缩会丢弃超过保留期的数据', () => {
  const now = new Date('2026-09-25T12:00:00+08:00');
  const history = emptyHistory();
  history.items.coin = {
    name: '旧商品',
    points: [
      [now.getTime() - 500 * 86400000, 100, null],
      [now.getTime() - 10 * 86400000, 200, null],
    ],
  };
  compactHistory(history, { now, timeZone: TZ, fullResolutionDays: 3, dailyRetentionDays: 400 });
  assert.equal(history.items.coin.points.length, 1);
  assert.equal(history.items.coin.points[0][1], 200);
});

test('buildReport：识别降价、计算单价变化', () => {
  const now = new Date('2026-09-25T12:00:00+08:00');
  const history = emptyHistory();
  history.items.coin = {
    name: '测试金币',
    url: 'https://example.com/coin',
    weightGrams: 3,
    points: [
      [new Date('2026-09-23T10:00:00+08:00').getTime(), 3100, 1033.33],
      [new Date('2026-09-24T10:00:00+08:00').getTime(), 3000, 1000],
      [new Date('2026-09-24T22:00:00+08:00').getTime(), 2980, 993.33],
      [new Date('2026-09-25T09:00:00+08:00').getTime(), 2900, 966.67],
    ],
  };

  const report = buildReport(history, makeConfig(), now);
  const item = report.items[0];
  assert.equal(item.hasData, true);
  assert.equal(item.latestPrice, 2900);
  assert.equal(item.referencePrice, 2980, '基准应为上一个自然日的最后一个价格');
  assert.equal(item.referenceDateKey, '2026-09-24');
  assert.equal(item.latestDateKey, '2026-09-25');
  assert.equal(item.direction, 'down');
  assert.equal(item.change, -80);
  assert.ok(Math.abs(item.latestUnit - 2900 / 3) < 0.001, `latestUnit=${item.latestUnit}`);
  assert.ok(Math.abs(item.unitChange - (2900 / 3 - 2980 / 3)) < 0.001, `unitChange=${item.unitChange}`);
  assert.equal(item.unitDirection, 'down');
  assert.equal(report.drops.length, 1);
  assert.equal(report.rises.length, 0);
  assert.match(summarize(report), /降价/);
});

test('buildReport：涨价与持平', () => {
  const now = new Date('2026-09-25T12:00:00+08:00');
  const history = emptyHistory();
  history.items.coin = {
    name: '测试金币',
    url: 'https://example.com/coin',
    weightGrams: 3,
    points: [
      [new Date('2026-09-24T10:00:00+08:00').getTime(), 3000, 1000],
      [new Date('2026-09-25T09:00:00+08:00').getTime(), 3000, 1000],
    ],
  };
  const report = buildReport(history, makeConfig(), now);
  assert.equal(report.items[0].direction, 'flat');
  assert.equal(report.drops.length, 0);
  assert.match(summarize(report), /没有发现降价/);
});

test('buildReport：只有一天数据时不做判断', () => {
  const now = new Date('2026-09-25T12:00:00+08:00');
  const history = emptyHistory();
  history.items.coin = {
    name: '测试金币',
    url: 'https://example.com/coin',
    weightGrams: 3,
    points: [[new Date('2026-09-25T09:00:00+08:00').getTime(), 2900, 966.67]],
  };
  const report = buildReport(history, makeConfig(), now);
  assert.equal(report.items[0].direction, 'none');
  assert.equal(report.items[0].change, null);
  assert.equal(report.pending.length, 1);
});

test('buildReport：没有克重信息时不计算单价', () => {
  const now = new Date('2026-09-25T12:00:00+08:00');
  const noWeightConfig = parseConfig(`
settings:
  timezone: ${TZ}
items:
  - id: coin
    name: 无克重商品
    url: https://example.com/coin
    parser: html
    parserOptions:
      priceSelector: '.price'
`);
  const history = emptyHistory();
  history.items.coin = {
    name: '无克重商品',
    url: 'https://example.com/coin',
    points: [
      [new Date('2026-09-24T10:00:00+08:00').getTime(), 3000, null],
      [new Date('2026-09-25T09:00:00+08:00').getTime(), 2900, null],
    ],
  };
  const report = buildReport(history, noWeightConfig, now);
  assert.equal(report.items[0].weightGrams, null);
  assert.equal(report.items[0].latestUnit, null);
  assert.equal(report.items[0].unitChange, null);
  assert.equal(report.items[0].direction, 'down');
  assert.ok(!summarize(report).includes('单价'), '无克重时摘要里不应出现单价信息');
});

test('downsample 保留首尾并控制在指定点数内', () => {
  const series = Array.from({ length: 5000 }, (_, i) => ({ t: i * 1000, price: 1000 + i, unitPrice: null }));
  const out = downsample(series, 800);
  assert.ok(out.length <= 802, `抽稀后 ${out.length} 个点`);
  assert.equal(out[out.length - 1].t, series[series.length - 1].t);
});
