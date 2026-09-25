/**
 * 极简测试入口。
 *
 * 之所以不用 `node --test`：不同 Node 版本的测试运行器参数不一致
 * （例如进程隔离开关在 22.x 叫 --experimental-test-isolation，24.x 叫 --test-isolation），
 * 而 node:test 在被直接 import 时会自动执行注册的用例并设置退出码。
 * 这样 `npm test` 在任何 Node 20+ 上都能跑。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs
  .readdirSync(dir)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

if (files.length === 0) {
  console.error('没有找到任何测试文件');
  process.exit(1);
}

console.log(`运行 ${files.length} 个测试文件：${files.join(', ')}\n`);
for (const file of files) {
  await import(`./${file}`);
}
