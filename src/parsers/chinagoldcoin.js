/**
 * 中国金币网 / 金币云商（chinagoldcoin.net）内置解析器
 *
 * 该站点是 Vue/React 单页应用，HTML 里没有价格，必须调用它自己的 JSON 接口：
 *   1) 商品静态信息（名称、克重）： /api/item/v2/render/static/basic
 *   2) 商品实时价格：             /api/item/v2/render/dynamic
 *   3) 熊猫金币实时报价（多条）： /api/trade/panda/chngc/price/panda/realTimePrice
 */

import { originOf, requestJson } from '../util/http.js';
import { parseNumber } from '../util/parse.js';

const DEFAULT_BASE = 'https://www.chinagoldcoin.net';

function apiBase(item) {
  const configured = item.parserOptions?.apiBase;
  if (configured) return String(configured).replace(/\/+$/, '');
  return originOf(item.url) || DEFAULT_BASE;
}

function extractWeightFromExtra(extra) {
  if (!extra || typeof extra !== 'object') return null;
  const direct = parseNumber(extra.totalGramWeight);
  if (direct) return direct;
  if (typeof extra.__trantorExtendFields === 'string') {
    try {
      const extended = JSON.parse(extra.__trantorExtendFields);
      const fromJson = parseNumber(extended.totalGramWeight);
      if (fromJson) return fromJson;
    } catch {
      /* 忽略：扩展字段不是合法 JSON 时走别的兜底 */
    }
  }
  return null;
}

/** 从 "1克封装金币" / "15克封装金币" 这样的名称里取克重 */
export function weightFromName(name) {
  if (!name) return null;
  const m = String(name).match(/(\d+(?:\.\d+)?)\s*(?:克|g|G|gram|grams)/);
  return m ? parseNumber(m[1]) : null;
}

function assertPositivePrice(price, item, source) {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`${item.name}（${item.id}）未取到有效价格：${source} 返回 ${JSON.stringify(price)}`);
  }
}

/**
 * 单个商品（SPU）详情页价格
 * 页面：https://www.chinagoldcoin.net/products/<itemId>
 */
export async function parseChinagoldcoinPdp(item, context) {
  const base = apiBase(item);
  const opts = item.parserOptions ?? {};
  const itemId = String(opts.itemId ?? extractItemIdFromUrl(item.url) ?? '');
  if (!itemId) throw new Error(`${item.id}：parserOptions.itemId 缺失，且无法从 url 推断`);

  const sellerId = Number(opts.sellerId ?? 1);
  const channelId = Number(opts.channelId ?? 1);
  const spuId = String(opts.spuId ?? itemId);
  const provinceId = Number(opts.provinceId ?? 1);
  const cityId = Number(opts.cityId ?? 1);
  const regionId = Number(opts.regionId ?? 1);

  const common = new URLSearchParams({ sellerId: String(sellerId), channelId: String(channelId) });
  const staticQuery = new URLSearchParams(common);
  staticQuery.set('itemId', itemId);
  staticQuery.set('spuId', spuId);

  const dynamicQuery = new URLSearchParams(common);
  dynamicQuery.set('itemId', itemId);
  dynamicQuery.set('spuId', spuId);
  dynamicQuery.set('provinceId', String(provinceId));
  dynamicQuery.set('cityId', String(cityId));
  dynamicQuery.set('regionId', String(regionId));

  const requestOptions = {
    timeoutMs: context.request.timeoutMs,
    retries: context.request.retries,
    headers: {
      Referer: item.url,
      ...(opts.headers ?? {}),
    },
  };

  const [staticResponse, dynamicResponse] = await Promise.all([
    requestJson(`${base}/api/item/v2/render/static/basic?${staticQuery}`, {
      ...requestOptions,
      label: `${item.id} 商品信息`,
    }),
    requestJson(`${base}/api/item/v2/render/dynamic?${dynamicQuery}`, {
      ...requestOptions,
      label: `${item.id} 实时价格`,
    }),
  ]);

  const staticData = staticResponse?.data ?? {};
  const detail = staticData.item ?? {};
  const dynamicData = dynamicResponse?.data ?? {};

  const price = parseNumber(dynamicData.price ?? dynamicData.campaignPrice);
  assertPositivePrice(price, item, 'render/dynamic');

  const name = detail.name || staticData.name || item.name;
  const weightGrams = item.weightGrams ?? extractWeightFromExtra(detail.extra);

  return {
    name,
    price,
    weightGrams,
    currency: 'CNY',
    extra: {
      itemId,
      itemCode: detail.itemCode ?? null,
      unit: detail.unit ?? null,
      shelfStatus: detail.shelfStatus ?? null,
      onSaleStatus: detail.onSaleStatus ?? null,
      purchaseLimit: parseNumber(dynamicData.purchaseLimit),
      campaignPrice: parseNumber(dynamicData.campaignPrice),
      serverTime: dynamicData.currentTime ?? null,
      shopName: detail.shopName ?? null,
    },
  };
}

/**
 * 熊猫金币实时报价（一个接口返回多条不同克重的金币）
 * parserOptions: { code | name, defaultWeightGrams }
 */
export async function parseChinagoldcoinPandaPrice(item, context) {
  const base = apiBase(item);
  const opts = item.parserOptions ?? {};
  const code = opts.code ? String(opts.code) : null;
  const wantedName = opts.name ? String(opts.name) : null;

  const response = await requestJson(`${base}/api/trade/panda/chngc/price/panda/realTimePrice`, {
    timeoutMs: context.request.timeoutMs,
    retries: context.request.retries,
    headers: { Referer: item.url, ...(opts.headers ?? {}) },
    label: `${item.id} 熊猫金币实时价`,
  });

  const result = response?.data?.result ?? response?.result ?? {};
  const lines = Array.isArray(result.lines) ? result.lines : [];
  if (lines.length === 0) {
    throw new Error(`${item.id}：接口未返回任何报价（lines 为空）`);
  }

  let line = null;
  if (code) line = lines.find((l) => String(l.code) === code) ?? null;
  if (!line && wantedName) line = lines.find((l) => String(l.name).includes(wantedName)) ?? null;
  if (!line) {
    const available = lines.map((l) => `${l.code}:${l.name}`).join('、');
    throw new Error(`${item.id}：在报价列表里找不到 ${code ?? wantedName}，可用项：${available}`);
  }

  const price = parseNumber(line.price);
  assertPositivePrice(price, item, 'realTimePrice');

  const weightGrams = item.weightGrams ?? parseNumber(opts.defaultWeightGrams) ?? weightFromName(line.name);

  return {
    name: line.name || item.name,
    price,
    weightGrams,
    currency: 'CNY',
    extra: {
      code: line.code ?? null,
      basicGoldPrice: parseNumber(result.basicGoldPrice),
      baseMetalPricePerGram: parseNumber(result.basicGoldPrice),
    },
  };
}

export function extractItemIdFromUrl(url) {
  const m = String(url).match(/\/products\/(\d+)/);
  return m ? m[1] : null;
}
