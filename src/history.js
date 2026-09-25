/** 历史数据读写与压缩 */

import fs from 'node:fs';
import path from 'node:path';

import { localDateKey } from './util/time.js';
import { round } from './util/parse.js';

export const HISTORY_VERSION = 1;

export function emptyHistory() {
  return { version: HISTORY_VERSION, updatedAt: null, items: {} };
}

export function loadHistory(file) {
  if (!fs.existsSync(file)) return emptyHistory();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.items !== 'object' || parsed.items === null) {
      return emptyHistory();
    }
    for (const entry of Object.values(parsed.items)) {
      if (!Array.isArray(entry.points)) entry.points = [];
    }
    return { version: HISTORY_VERSION, updatedAt: parsed.updatedAt ?? null, items: parsed.items };
  } catch (error) {
    throw new Error(`历史数据文件损坏，无法解析：${file}\n${error.message}`);
  }
}

export function saveHistory(file, history) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const serialized = `${JSON.stringify(history, null, 0)}\n`;
  fs.writeFileSync(file, serialized, 'utf8');
  return serialized.length;
}

/**
 * 记录一次采样。数据点以紧凑数组存储：[时间戳, 价格, 单价|null]
 * 重复时间戳会覆盖，保证幂等。
 */
export function recordSample(history, item, sample, { unitLabel } = {}) {
  const existing = history.items[item.id] ?? {};
  const unitPrice =
    sample.weightGrams && sample.weightGrams > 0 ? round(sample.price / sample.weightGrams, 4) : null;

  const points = Array.isArray(existing.points) ? existing.points.slice() : [];
  const point = [sample.timestamp, round(sample.price, 4), unitPrice];

  const last = points[points.length - 1];
  if (last && last[0] === point[0]) points[points.length - 1] = point;
  else if (last && point[0] < last[0]) {
    const index = points.findIndex((p) => p[0] > point[0]);
    points.splice(index === -1 ? points.length : index, 0, point);
  } else points.push(point);

  history.items[item.id] = {
    name: sample.name || item.name,
    url: item.url,
    parser: item.parser,
    weightGrams: sample.weightGrams ?? null,
    unitLabel: unitLabel ?? '元/克',
    tags: item.tags ?? [],
    lastRunAt: sample.timestamp,
    lastError: null,
    points,
  };
  return history.items[item.id];
}

/** 抓取失败时只更新错误状态，不写入数据点 */
export function recordFailure(history, item, error, timestamp) {
  const existing = history.items[item.id] ?? { points: [] };
  history.items[item.id] = {
    ...existing,
    name: existing.name || item.name,
    url: item.url,
    parser: item.parser,
    tags: item.tags ?? [],
    lastRunAt: timestamp,
    lastError: {
      message: String(error?.message ?? error).slice(0, 500),
      at: timestamp,
    },
  };
  return history.items[item.id];
}

/** 校验并排序数据点，剔除脏数据 */
function normalizePoints(points) {
  const cleaned = [];
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const ts = Number(point[0]);
    const price = Number(point[1]);
    if (!Number.isFinite(ts) || !Number.isFinite(price)) continue;
    const unit = point[2] === null || point[2] === undefined ? null : Number(point[2]);
    cleaned.push([ts, price, Number.isFinite(unit) ? unit : null]);
  }
  cleaned.sort((a, b) => a[0] - b[0]);
  const unique = [];
  for (const point of cleaned) {
    if (unique.length && unique[unique.length - 1][0] === point[0]) unique[unique.length - 1] = point;
    else unique.push(point);
  }
  return unique;
}

/**
 * 压缩历史：
 *   - 最近 fullResolutionDays 天保留全部采样点（看日内走势）
 *   - 更早的每天只保留最后一个点（看长期趋势）
 *   - 超过 dailyRetentionDays 天的数据直接丢弃
 */
export function compactHistory(history, { now = new Date(), timeZone, fullResolutionDays = 3, dailyRetentionDays = 400 }) {
  const nowMs = now.getTime();
  const fullCutoff = nowMs - fullResolutionDays * 86400000;
  const dailyCutoff = nowMs - dailyRetentionDays * 86400000;
  let removed = 0;

  for (const entry of Object.values(history.items)) {
    const points = normalizePoints(entry.points ?? []);
    const kept = [];
    const seenDays = new Set();
    for (let i = points.length - 1; i >= 0; i -= 1) {
      const point = points[i];
      if (point[0] >= fullCutoff) {
        kept.push(point);
      } else if (point[0] >= dailyCutoff) {
        const key = localDateKey(new Date(point[0]), timeZone);
        if (!seenDays.has(key)) {
          seenDays.add(key);
          kept.push(point);
        }
      }
    }
    removed += points.length - kept.length;
    kept.reverse();
    entry.points = kept;
  }

  return { removed };
}

export function countPoints(history) {
  let total = 0;
  for (const entry of Object.values(history.items)) total += entry.points?.length ?? 0;
  return total;
}
