/** 解析器注册表 */

import { parseChinagoldcoinPandaPrice, parseChinagoldcoinPdp } from './chinagoldcoin.js';
import { parseHtml, parseJson, parseRegex } from './generic.js';

const REGISTRY = {
  'chinagoldcoin-pdp': parseChinagoldcoinPdp,
  'chinagoldcoin-panda-price': parseChinagoldcoinPandaPrice,
  html: parseHtml,
  json: parseJson,
  regex: parseRegex,
};

/**
 * 抓取并解析一个监控项
 * @returns {Promise<{name:string, price:number, weightGrams:number|null, currency:string, extra:object}>}
 */
export async function runParser(item, context) {
  const parser = REGISTRY[item.parser];
  if (!parser) throw new Error(`${item.id}：未注册的解析器 ${item.parser}`);
  const result = await parser(item, context);
  return {
    name: result.name || item.name,
    price: result.price,
    weightGrams: result.weightGrams ?? null,
    currency: result.currency || context.currency || 'CNY',
    extra: result.extra ?? {},
  };
}

export { REGISTRY };
