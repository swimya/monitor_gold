import assert from 'node:assert/strict';
import test from 'node:test';

import { getByPath, mapLimit, parseNumber, formatPercent, formatSigned, round } from '../src/util/parse.js';
import { localDateKey, localIso, isValidTimeZone } from '../src/util/time.js';

test('parseNumber 能从各种文本里抽出数字', () => {
  assert.equal(parseNumber('￥2,967.00'), 2967);
  assert.equal(parseNumber('2967.000000000'), 2967);
  assert.equal(parseNumber('1,330.00 元'), 1330);
  assert.equal(parseNumber('50克'), 50);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber(null), null);
  assert.equal(parseNumber('暂无报价'), null);
  assert.equal(parseNumber(-12.5), -12.5);
});

test('getByPath 支持点号与数组下标', () => {
  const data = { data: { result: { lines: [{ code: 'A', price: '1' }, { code: 'B', price: '2' }] } } };
  assert.equal(getByPath(data, 'data.result.lines[1].price'), '2');
  assert.equal(getByPath(data, 'data.result.nope'), undefined);
  assert.equal(getByPath(data, ''), data);
});

test('格式化函数', () => {
  assert.equal(formatSigned(-30, 2), '-30.00');
  assert.equal(formatSigned(30, 2), '+30.00');
  assert.equal(formatPercent(-1.006, 2), '-1.01%');
  assert.equal(round(0.1 + 0.2, 2), 0.3);
});

test('mapLimit 限制并发并逐个返回结果', async () => {
  let running = 0;
  let peak = 0;
  const results = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
    if (n === 4) throw new Error('boom');
    return n * 2;
  });
  assert.ok(peak <= 3, `并发峰值 ${peak} 超过限制`);
  assert.equal(results.length, 7);
  assert.equal(results[0].value, 2);
  assert.equal(results[3].status, 'rejected');
  assert.equal(results[6].value, 14);
});

test('时区工具：按 Asia/Shanghai 切天', () => {
  assert.ok(isValidTimeZone('Asia/Shanghai'));
  assert.ok(!isValidTimeZone('Not/AZone'));
  // UTC 2026-09-25T16:30Z == 北京时间 2026-09-26 00:30
  const date = new Date('2026-09-25T16:30:00Z');
  assert.equal(localDateKey(date, 'Asia/Shanghai'), '2026-09-26');
  assert.equal(localDateKey(date, 'UTC'), '2026-09-25');
  assert.equal(localIso(date, 'Asia/Shanghai'), '2026-09-26T00:30:00+08:00');
});
