/** 配置加载与校验 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import { isValidTimeZone } from './util/time.js';

export const SUPPORTED_PARSERS = [
  'chinagoldcoin-pdp',
  'chinagoldcoin-panda-price',
  'html',
  'json',
  'regex',
];

const DEFAULT_SETTINGS = {
  title: '黄金 / 金币价格监控',
  timezone: 'Asia/Shanghai',
  currency: 'CNY',
  currencySymbol: '¥',
  unitLabel: '元/克',
  request: {
    timeoutMs: 20000,
    retries: 3,
    concurrency: 4,
  },
  retention: {
    fullResolutionDays: 3,
    dailyRetentionDays: 400,
  },
};

export class ConfigError extends Error {}

function mergeSettings(raw = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    request: { ...DEFAULT_SETTINGS.request, ...(raw.request || {}) },
    retention: { ...DEFAULT_SETTINGS.retention, ...(raw.retention || {}) },
  };
}

function requireString(value, what, context) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`${context}：${what} 必须是非空字符串`);
  }
  return value.trim();
}

/**
 * 解析配置文件文本
 * @param {string} text
 * @param {string} source 仅用于报错提示
 */
export function parseConfig(text, source = 'config') {
  let raw;
  try {
    raw = YAML.parse(text);
  } catch (error) {
    throw new ConfigError(`${source} 不是合法的 YAML：${error.message}`);
  }
  if (!raw || typeof raw !== 'object') {
    throw new ConfigError(`${source} 内容为空或格式不正确`);
  }

  const settings = mergeSettings(raw.settings || {});
  if (!isValidTimeZone(settings.timezone)) {
    throw new ConfigError(`${source}：settings.timezone "${settings.timezone}" 不是合法时区`);
  }
  if (!Number.isFinite(settings.request.timeoutMs) || settings.request.timeoutMs <= 0) {
    throw new ConfigError(`${source}：settings.request.timeoutMs 必须是正数`);
  }
  if (!Number.isInteger(settings.request.retries) || settings.request.retries < 1) {
    throw new ConfigError(`${source}：settings.request.retries 必须是不小于 1 的整数`);
  }
  if (!Number.isInteger(settings.request.concurrency) || settings.request.concurrency < 1) {
    throw new ConfigError(`${source}：settings.request.concurrency 必须是不小于 1 的整数`);
  }

  const rawItems = raw.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ConfigError(`${source}：items 必须是非空数组（至少配置一个监控商品）`);
  }

  const seen = new Set();
  const items = rawItems.map((entry, index) => {
    const where = `${source} items[${index}]`;
    if (!entry || typeof entry !== 'object') throw new ConfigError(`${where} 必须是对象`);
    const id = requireString(entry.id, 'id', where);
    if (!/^[A-Za-z0-9._-]+$/.test(id)) {
      throw new ConfigError(`${where}：id "${id}" 只能包含字母、数字、点、下划线和连字符`);
    }
    if (seen.has(id)) throw new ConfigError(`${where}：id "${id}" 重复`);
    seen.add(id);

    const url = requireString(entry.url, 'url', where);
    try {
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      throw new ConfigError(`${where}：url "${url}" 不是合法网址`);
    }

    const parser = entry.parser === undefined ? 'html' : requireString(entry.parser, 'parser', where);
    if (!SUPPORTED_PARSERS.includes(parser)) {
      throw new ConfigError(
        `${where}：不支持的 parser "${parser}"，可用值：${SUPPORTED_PARSERS.join(' / ')}`,
      );
    }

    let weightGrams = entry.weightGrams ?? null;
    if (weightGrams !== null) {
      weightGrams = Number(weightGrams);
      if (!Number.isFinite(weightGrams) || weightGrams <= 0) {
        throw new ConfigError(`${where}：weightGrams 必须是正数或留空`);
      }
    }

    return {
      id,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id,
      // 用户是否自己写了名字。写了就以用户的为准，没写才用网站返回的标题。
      hasCustomName: typeof entry.name === 'string' && entry.name.trim() !== '',
      url,
      enabled: entry.enabled !== false,
      parser,
      parserOptions: entry.parserOptions && typeof entry.parserOptions === 'object' ? entry.parserOptions : {},
      weightGrams,
      tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
      note: typeof entry.note === 'string' ? entry.note : '',
    };
  });

  if (!items.some((item) => item.enabled)) {
    throw new ConfigError(`${source}：没有任何 enabled 的商品可供监控`);
  }

  return { settings, items, source };
}

export function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    throw new ConfigError(`找不到配置文件：${resolved}`);
  }
  return parseConfig(fs.readFileSync(resolved, 'utf8'), path.relative(process.cwd(), resolved) || resolved);
}
