/**
 * 通用解析器：让用户可以用配置文件监控“任意网站”的价格。
 *   html  —— 用 CSS 选择器从网页里取值
 *   json  —— 调用网站自己的 JSON 接口并按字段路径取值
 *   regex —— 直接在响应文本里用正则取值
 */

import * as cheerio from 'cheerio';

import { request, requestJson } from '../util/http.js';
import { getByPath, parseNumber } from '../util/parse.js';
import { weightFromName } from './chinagoldcoin.js';

function pickNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return parseNumber(value);
}

function buildHeaders(item, extra = {}) {
  return {
    Referer: item.url,
    ...(item.parserOptions?.headers ?? {}),
    ...extra,
  };
}

function baseRequestOptions(item, context) {
  return {
    timeoutMs: context.request.timeoutMs,
    retries: context.request.retries,
    headers: buildHeaders(item),
  };
}

function finalize(item, { name, price, weightGrams, extra = {} }) {
  if (price === null || !Number.isFinite(price) || price <= 0) {
    throw new Error(`${item.id}：未解析出有效价格（得到 ${JSON.stringify(price)}），请检查 parserOptions`);
  }
  return {
    name: name || item.name,
    price,
    weightGrams: item.weightGrams ?? weightGrams ?? null,
    currency: 'CNY',
    extra,
  };
}

/** CSS 选择器方式 */
export async function parseHtml(item, context) {
  const opts = item.parserOptions ?? {};
  if (!opts.priceSelector) throw new Error(`${item.id}：parser=html 时必须提供 parserOptions.priceSelector`);

  const { text } = await request(item.url, {
    ...baseRequestOptions(item, context),
    label: `${item.id} 页面`,
  });

  const $ = cheerio.load(text);
  const pick = (selector) => {
    if (!selector) return null;
    const node = $(selector).first();
    if (node.length === 0) return null;
    const attr = opts.attribute;
    if (attr) return node.attr(attr) ?? null;
    return node.text();
  };

  const priceText = pick(opts.priceSelector);
  if (priceText === null) {
    throw new Error(`${item.id}：页面上找不到选择器 "${opts.priceSelector}" 对应的元素`);
  }

  const nameText = pick(opts.nameSelector);
  const weightText = pick(opts.weightSelector);
  const weightPattern = opts.weightPattern ? new RegExp(opts.weightPattern) : null;
  const weightFromText = weightText
    ? weightPattern
      ? parseNumber(weightText.match(weightPattern)?.[1])
      : parseNumber(weightText)
    : null;

  return finalize(item, {
    name: nameText ? nameText.trim().replace(/\s+/g, ' ') : item.name,
    price: pickNumber(priceText),
    weightGrams: weightFromText ?? weightNameFallback(opts, nameText ?? item.name),
    extra: {
      priceText: String(priceText).trim(),
      pageTitle: $('title').first().text().trim() || null,
    },
  });
}

function weightNameFallback(opts, name) {
  if (opts.weightFromName === false) return null;
  return weightFromName(name);
}

/** JSON 接口方式 */
export async function parseJson(item, context) {
  const opts = item.parserOptions ?? {};
  if (!opts.pricePath) throw new Error(`${item.id}：parser=json 时必须提供 parserOptions.pricePath`);

  const endpoint = opts.endpoint || item.url;
  const method = (opts.method || 'GET').toUpperCase();
  const payload = await requestJson(endpoint, {
    method,
    body: opts.body,
    headers: {
      ...buildHeaders(item),
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    timeoutMs: context.request.timeoutMs,
    retries: context.request.retries,
    label: `${item.id} 接口`,
  });

  const price = pickNumber(getByPath(payload, opts.pricePath));
  const name = opts.namePath ? getByPath(payload, opts.namePath) : null;
  const weight = opts.weightPath ? pickNumber(getByPath(payload, opts.weightPath)) : null;

  return finalize(item, {
    name: name ? String(name) : item.name,
    price,
    weightGrams: weight,
    extra: { endpoint, pricePath: opts.pricePath },
  });
}

/** 正则方式 */
export async function parseRegex(item, context) {
  const opts = item.parserOptions ?? {};
  if (!opts.pricePattern) throw new Error(`${item.id}：parser=regex 时必须提供 parserOptions.pricePattern`);

  const { text } = await request(item.url, {
    ...baseRequestOptions(item, context),
    label: `${item.id} 页面`,
  });

  const matchNumber = (pattern, flags) => {
    if (!pattern) return null;
    const m = text.match(new RegExp(pattern, flags ?? ''));
    if (!m) return null;
    return parseNumber(m[1] ?? m[0]);
  };

  const nameMatch = opts.namePattern ? text.match(new RegExp(opts.namePattern, opts.flags ?? '')) : null;

  return finalize(item, {
    name: nameMatch ? String(nameMatch[1] ?? nameMatch[0]).trim() : item.name,
    price: matchNumber(opts.pricePattern, opts.flags),
    weightGrams: matchNumber(opts.weightPattern, opts.flags),
    extra: { pageLength: text.length },
  });
}
