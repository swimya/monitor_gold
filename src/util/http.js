/** 带超时与重试的 HTTP 客户端 */

import { sleep } from './parse.js';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export class HttpError extends Error {
  constructor(message, { status, url, body } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/**
 * 发起请求并返回 { status, text, headers, url }
 * @param {string} url
 * @param {object} options
 */
export async function request(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 20000,
    retries = 3,
    retryDelayMs = 1200,
    expectJson = false,
    label = url,
  } = options;

  let lastError;
  for (let attempt = 1; attempt <= Math.max(1, retries); attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          ...(expectJson ? { Accept: 'application/json, text/plain, */*' } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'follow',
      });
      const text = await response.text();

      if (!response.ok) {
        // 4xx 基本都是配置/接口问题，重试意义不大；5xx 与 429 值得重试
        const retryable = response.status >= 500 || response.status === 429;
        const error = new HttpError(
          `${label} 返回 HTTP ${response.status}${text ? `：${text.slice(0, 200)}` : ''}`,
          { status: response.status, url, body: text },
        );
        if (!retryable || attempt === Math.max(1, retries)) throw error;
        lastError = error;
      } else {
        return { status: response.status, text, headers: response.headers, url: response.url };
      }
    } catch (error) {
      if (error instanceof HttpError) {
        lastError = error;
      } else {
        const reason = error?.name === 'AbortError' ? `请求超时（${timeoutMs}ms）` : error?.message || String(error);
        lastError = new HttpError(`${label} 请求失败：${reason}`, { url });
      }
      if (attempt === Math.max(1, retries)) throw lastError;
    } finally {
      clearTimeout(timer);
    }
    await sleep(retryDelayMs * attempt);
  }
  throw lastError ?? new HttpError(`${label} 请求失败`, { url });
}

export async function requestJson(url, options = {}) {
  const { text } = await request(url, { ...options, expectJson: true });
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(`${options.label ?? url} 返回的不是合法 JSON：${text.slice(0, 200)}`, { url });
  }
}

export function joinUrl(base, path) {
  if (/^https?:\/\//i.test(path)) return path;
  const trimmedBase = String(base).replace(/\/+$/, '');
  const trimmedPath = String(path).replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedPath}`;
}

export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}
