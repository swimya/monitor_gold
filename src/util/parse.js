/** 通用小工具：数值解析、路径取值、并发控制 */

/**
 * 从任意文本里抽出数字。支持 "￥2,967.00"、"2967.000000000"、"1克"、"3.00 元/克"。
 * @returns {number|null}
 */
export function parseNumber(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  const text = String(input)
    .replace(/[，,]/g, '')
    .replace(/[￥¥$]/g, '')
    .replace(/\s+/g, '');
  const m = text.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const value = Number(m[0]);
  return Number.isFinite(value) ? value : null;
}

/** 按 a.b[0].c 形式的路径取值 */
export function getByPath(source, path) {
  if (!path) return source;
  const segments = String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((s) => s !== '');
  let current = source;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    current = current[segment];
  }
  return current;
}

/** 保留 n 位小数并去掉多余的 0 */
export function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** 金额展示：2967 -> "2,967.00" */
export function formatMoney(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 带符号展示：-30 -> "-30.00"，30 -> "+30.00" */
export function formatSigned(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return sign + formatMoney(Math.abs(value), digits);
}

/** 百分比展示 */
export function formatPercent(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

/** 简单并发池：按并发数依次执行任务，返回与输入等长的结果数组 */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.max(1, Math.min(limit, items.length || 1)))
    .fill(null)
    .map(async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        try {
          results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
        } catch (error) {
          results[index] = { status: 'rejected', reason: error };
        }
      }
    });
  await Promise.all(runners);
  return results;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
