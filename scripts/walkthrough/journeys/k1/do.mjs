// 交互式走查一步：node do.mjs <kiosk|phone> <脚本文件或 - 从 stdin>
// 脚本体是 async 函数体，可用变量：page ctx lib（本目录 lib.mjs 全部导出）
import fs from 'node:fs';
import * as lib from './lib.mjs';

const which = process.argv[2] ?? 'kiosk';
const src = process.argv[3] && process.argv[3] !== '-' ? fs.readFileSync(process.argv[3], 'utf8') : fs.readFileSync(0, 'utf8');
const { browser, ctx, page } = await lib.connect(which);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
try {
  const fn = new AsyncFunction('page', 'ctx', 'lib', src);
  const out = await fn(page, ctx, lib);
  if (out !== undefined) console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
} catch (e) {
  console.error('STEP ERROR:', e.message.split('\n').slice(0, 6).join('\n'));
  process.exitCode = 1;
} finally {
  // 只断开 CDP 连接，不关浏览器
  await browser.close().catch(() => {});
}
