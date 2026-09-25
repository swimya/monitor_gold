#!/usr/bin/env node
/**
 * 价格监控主流程
 *   1. 读配置 → 2. 抓价格 → 3. 存历史 → 4. 算日环比 → 5. 生成静态页
 *
 * 用法：
 *   node src/index.js                    正常抓取 + 生成页面
 *   node src/index.js --skip-fetch       只用已有历史数据重新生成页面
 *   node src/index.js --config=a.yml --out=dist --data=data/history.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

import { loadConfig } from './config.js';
import { buildReport, summarize } from './report.js';
import { compactHistory, countPoints, emptyHistory, loadHistory, recordFailure, recordSample, saveHistory } from './history.js';
import { runParser } from './parsers/index.js';
import { writeSite } from './site/render.js';
import { localIso } from './util/time.js';
import { mapLimit } from './util/parse.js';

const ROOT = path.resolve(import.meta.dirname, '..');

function parseArgs(argv) {
  const args = {
    config: path.join(ROOT, 'config', 'monitor.config.yml'),
    data: path.join(ROOT, 'data', 'history.json'),
    out: path.join(ROOT, 'dist'),
    skipFetch: false,
    open: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg === '--skip-fetch' || arg === '--no-fetch') args.skipFetch = true;
    else if (arg === '--open') args.open = true;
    else if (arg.startsWith('--config=')) args.config = path.resolve(arg.slice(9));
    else if (arg.startsWith('--data=')) args.data = path.resolve(arg.slice(7));
    else if (arg.startsWith('--out=')) args.out = path.resolve(arg.slice(6));
    else if (arg === '--help' || arg === '-h') args.help = true;
    else console.warn(`⚠️ 忽略未知参数：${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`价格监控\n\n` +
    `  node src/index.js [选项]\n\n` +
    `  --config=<路径>   配置文件，默认 config/monitor.config.yml\n` +
    `  --data=<路径>     历史数据，默认 data/history.json\n` +
    `  --out=<目录>      页面输出目录，默认 dist/\n` +
    `  --skip-fetch      不抓取，只用现有历史数据重新生成页面\n` +
    `  --open            生成后用浏览器打开\n`);
}

function rel(file) {
  return path.relative(ROOT, file) || file;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function appendStepSummary(markdown) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  try {
    fs.appendFileSync(target, `${markdown}\n`, 'utf8');
  } catch {
    /* 摘要写不进去不影响主流程 */
  }
}

async function collectSamples(config, now) {
  const enabled = config.items.filter((item) => item.enabled);
  const context = {
    currency: config.settings.currency,
    request: config.settings.request,
    timezone: config.settings.timezone,
  };

  const results = await mapLimit(enabled, config.settings.request.concurrency, async (item) => {
    const startedAt = Date.now();
    const parsed = await runParser(item, context);
    return { item, parsed, durationMs: Date.now() - startedAt };
  });

  return enabled.map((item, index) => {
    const result = results[index];
    if (result.status === 'fulfilled') return { item, ok: true, ...result.value };
    return { item, ok: false, error: result.reason };
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const startedAt = Date.now();
  const now = new Date();

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║        价格监控 · Price Monitor              ║');
  console.log('╚══════════════════════════════════════════════╝');

  const config = loadConfig(args.config);
  const enabled = config.items.filter((item) => item.enabled);
  console.log(`📄 配置文件：${rel(args.config)}`);
  console.log(`📦 监控商品：${enabled.length} 个启用 / 共 ${config.items.length} 个`);
  console.log(`🕒 时区：${config.settings.timezone} · 当前时间 ${localIso(now, config.settings.timezone)}`);
  console.log('');

  let history = fs.existsSync(args.data) ? loadHistory(args.data) : emptyHistory();

  const fetchResults = [];
  if (args.skipFetch) {
    console.log('⏭️  已指定 --skip-fetch，跳过抓取，直接使用现有历史数据\n');
  } else {
    const samples = await collectSamples(config, now);
    for (const entry of samples) {
      const timestamp = Date.now();
      if (entry.ok) {
        // 用户在配置里写了 name 就用用户的；没写才用网站返回的标题
        const displayName = entry.item.hasCustomName ? entry.item.name : entry.parsed.name || entry.item.name;
        recordSample(history, entry.item, {
          timestamp,
          name: displayName,
          price: entry.parsed.price,
          weightGrams: entry.parsed.weightGrams,
        }, { unitLabel: config.settings.unitLabel });

        const unit = entry.parsed.weightGrams
          ? ` · 单价 ${(entry.parsed.price / entry.parsed.weightGrams).toFixed(2)} ${config.settings.unitLabel}`
          : '';
        console.log(
          `✅ ${entry.item.name}\n   价格 ${entry.parsed.price} 元${unit}　克重 ${
            entry.parsed.weightGrams ?? '未知'
          }　耗时 ${entry.durationMs}ms`,
        );
        fetchResults.push({ item: entry.item, ok: true, price: entry.parsed.price });
      } else {
        const message = entry.error?.message ?? String(entry.error);
        recordFailure(history, entry.item, entry.error, timestamp);
        console.log(`❌ ${entry.item.name}\n   ${message}`);
        fetchResults.push({ item: entry.item, ok: false, error: message });
      }
    }
    console.log('');
  }

  const compact = compactHistory(history, {
    now,
    timeZone: config.settings.timezone,
    fullResolutionDays: config.settings.retention.fullResolutionDays,
    dailyRetentionDays: config.settings.retention.dailyRetentionDays,
  });
  history.updatedAt = new Date().toISOString();

  if (!args.skipFetch) {
    const size = saveHistory(args.data, history);
    console.log(`💾 历史数据：${rel(args.data)} · ${countPoints(history)} 个数据点 · ${formatBytes(size)}`);
    if (compact.removed > 0) console.log(`🧹 历史压缩：合并/清理了 ${compact.removed} 个冗余数据点`);
  } else {
    console.log(`💾 历史数据（只读）：${rel(args.data)} · ${countPoints(history)} 个数据点`);
  }

  const report = buildReport(history, config, new Date());
  const summary = summarize(report);
  console.log('');
  console.log('─'.repeat(56));
  console.log(summary);
  console.log('─'.repeat(56));

  const siteBaseUrl = process.env.SITE_BASE_URL || config.settings.siteBaseUrl || '';
  const { files } = writeSite(args.out, {
    report,
    config,
    history,
    siteBaseUrl,
    buildInfo: {
      runUrl:
        process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
          ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
          : '',
      commit: process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 8) : '',
    },
  });

  const indexPath = path.join(args.out, 'index.html');
  const indexSize = fs.statSync(indexPath).size;
  console.log('');
  console.log(`🌐 页面已生成：${rel(indexPath)}（${formatBytes(indexSize)}）`);
  for (const file of files) console.log(`   · ${rel(file)}`);
  if (siteBaseUrl) console.log(`🔗 固定网址：${siteBaseUrl}`);

  const dropText = report.drops.length
    ? report.drops
        .map((i) => `- **${i.name}**：${i.change.toFixed(2)} 元（${i.changePct?.toFixed(2)}%）${
          i.unitChange !== null ? `，单价 ${i.referenceUnit} → ${i.latestUnit} ${i.unitLabel}` : ''
        }`)
        .join('\n')
    : '- 无降价商品';
  appendStepSummary(
    `## 价格监控结果\n\n抓取时间：${report.generatedAtLabel}（${report.timeZone}）\n\n` +
      `### 降价商品\n${dropText}\n\n` +
      `| 商品 | 最新价 | 上一日 | 变化 | 单价 |\n| --- | ---: | ---: | ---: | ---: |\n` +
      report.items
        .map((i) =>
          i.hasData
            ? `| ${i.name} | ${i.latestPrice} | ${i.referencePrice ?? '—'} | ${i.change ?? '—'} | ${
                i.latestUnit ?? '—'
              } |`
            : `| ${i.name} | 无数据 | — | — | — |`,
        )
        .join('\n'),
  );

  const failed = fetchResults.filter((r) => !r.ok);
  console.log(`⏱️  总耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  if (args.open) {
    const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    execFile(opener, [indexPath], () => {});
  }

  // 全部商品都抓取失败时以非 0 退出，让 GitHub Actions 变红提醒
  if (!args.skipFetch && failed.length === fetchResults.length && fetchResults.length > 0) {
    console.error('❌ 所有商品抓取失败，请检查配置或网络。');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ 运行失败：', error?.stack ?? error);
  process.exit(1);
});
