/**
 * 时区/时间工具：全部基于 Intl，无第三方依赖。
 * 监控系统需要按“用户所在时区”的日界线来判定“昨天”，因此不能用 UTC 直接切天。
 */

const FORMATTERS = new Map();

function formatter(timeZone) {
  let f = FORMATTERS.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    FORMATTERS.set(timeZone, f);
  }
  return f;
}

/** 把 Date 拆成指定时区下的年月日时分秒 */
export function localParts(date, timeZone) {
  const out = {};
  for (const p of formatter(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return out;
}

/** 指定时区下的日期键，形如 2026-09-25 */
export function localDateKey(date, timeZone) {
  const p = localParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 指定时区下的可读时间，形如 2026-09-25 22:46 */
export function localLabel(date, timeZone, { withSeconds = false } = {}) {
  const p = localParts(date, timeZone);
  const base = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  return withSeconds ? `${base}:${p.second}` : base;
}

/** ISO 格式的本地时间（带时区偏移），形如 2026-09-25T22:46:10+08:00 */
export function localIso(date, timeZone) {
  const p = localParts(date, timeZone);
  const offset = timeZoneOffsetMinutes(date, timeZone);
  return (
    `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}` +
    formatOffset(offset)
  );
}

/** 计算某时刻在给定时区相对 UTC 的偏移（分钟） */
export function timeZoneOffsetMinutes(date, timeZone) {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  // 抹掉毫秒影响
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

function formatOffset(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/** 人类友好的“多久以前” */
export function humanizeSince(date, now = new Date()) {
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < 90) return `${seconds} 秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  return `${days} 天前`;
}

/** 校验时区是否合法 */
export function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}
