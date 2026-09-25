import assert from 'node:assert/strict';
import test from 'node:test';

import { parseConfig, ConfigError } from '../src/config.js';

const BASE = `
settings:
  timezone: Asia/Shanghai
items:
  - id: a
    name: 商品 A
    url: https://example.com/a
    parser: html
    parserOptions:
      priceSelector: '.price'
`;

test('合法配置能被正确解析并补全默认值', () => {
  const config = parseConfig(BASE);
  assert.equal(config.settings.timezone, 'Asia/Shanghai');
  assert.equal(config.settings.unitLabel, '元/克');
  assert.equal(config.settings.request.retries, 3);
  assert.equal(config.settings.retention.dailyRetentionDays, 400);
  assert.equal(config.items.length, 1);
  assert.equal(config.items[0].enabled, true);
  assert.equal(config.items[0].weightGrams, null);
});

test('weightGrams 可以是数字或字符串', () => {
  const config = parseConfig(`${BASE}    weightGrams: '3'\n`);
  assert.equal(config.items[0].weightGrams, 3);
});

test('非法配置会明确报错', () => {
  assert.throws(() => parseConfig('settings: {}'), ConfigError);
  assert.throws(() => parseConfig('items: []'), ConfigError);
  assert.throws(() => parseConfig('items:\n  - id: a\n    url: not-a-url\n'), ConfigError);
  assert.throws(() => parseConfig(`${BASE}    parser: no-such-parser\n`), ConfigError);
  assert.throws(() => parseConfig(`${BASE}    weightGrams: -1\n`), ConfigError);
  assert.throws(() => parseConfig('settings:\n  timezone: Bad/Zone\nitems:\n  - id: a\n    url: https://e.com\n'), ConfigError);
});

test('id 不能重复', () => {
  const text = `
items:
  - id: same
    url: https://example.com/a
  - id: same
    url: https://example.com/b
`;
  assert.throws(() => parseConfig(text), /重复/);
});

test('所有商品都被禁用时报错', () => {
  const text = `
items:
  - id: a
    url: https://example.com/a
    enabled: false
`;
  assert.throws(() => parseConfig(text), ConfigError);
});
