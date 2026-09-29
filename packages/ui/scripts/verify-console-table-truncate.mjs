#!/usr/bin/env node
/**
 * 证明 ConsoleTable 的截断在 table-layout: auto 下生效。
 * 截断类必须在单元格内的 div 上。直接写在 td 上时，无宽度约束的表会按内容撑开。
 *
 * 用法：node packages/ui/scripts/verify-console-table-truncate.mjs [截图路径]
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '../../..')
const shotPath = process.argv[2]

const tableSrc = readFileSync(join(repoRoot, 'packages/ui/src/components/ConsoleTable.tsx'), 'utf8')
if (!tableSrc.includes("column.truncate && 'max-w-64 truncate'")) {
  console.error('ConsoleTable 没有把 max-w-64 truncate 放在内层 div')
  process.exit(1)
}
if (/column\.truncate && 'max-w-\[16rem\] truncate'/.test(tableSrc)) {
  console.error('截断仍写着任意宽度 max-w-[16rem]')
  process.exit(1)
}

const playwrightPkg = join(repoRoot, 'node_modules/.pnpm/playwright@1.55.1/node_modules/playwright/package.json')
if (!existsSync(playwrightPkg)) {
  console.error('找不到 playwright，无法在浏览器里证明截断')
  process.exit(1)
}
const { chromium } = createRequire(playwrightPkg)('playwright')

const long = '简历优化对照稿-'.repeat(24)
const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; font: 14px/1.4 sans-serif; }
  .frame { width: 640px; overflow: auto; }
  table { border-collapse: collapse; }
  td { padding: 12px 16px; border-bottom: 1px solid #ddd; }
  .max-w-64 { max-width: 16rem; }
  .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
<div class="frame" id="inner">
  <table>
    <tr>
      <td>订单</td>
      <td title="${long}"><div id="wrap" class="max-w-64 truncate">${long}</div></td>
      <td>操作</td>
    </tr>
  </table>
</div>
<div class="frame" id="bare">
  <table>
    <tr>
      <td>订单</td>
      <td id="direct" class="max-w-64 truncate">${long}</td>
      <td>操作</td>
    </tr>
  </table>
</div>`

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 900, height: 320 } })
await page.setContent(html)
const measure = (id) => page.$eval(`#${id}`, (el) => ({
  client: el.clientWidth,
  scroll: el.scrollWidth,
}))
const frame = await measure('inner')
const wrap = await measure('wrap')
const direct = await measure('direct')
if (shotPath) await page.screenshot({ path: shotPath, fullPage: true })
await browser.close()

const wrapTruncates = wrap.scroll > wrap.client + 1 && wrap.client <= 256
const frameHolds = frame.scroll <= frame.client
if (!wrapTruncates || !frameHolds) {
  console.error(JSON.stringify({ frame, wrap, direct, wrapTruncates, frameHolds }))
  process.exit(1)
}
console.log(JSON.stringify({
  frame,
  wrap,
  direct,
  wrapTruncates,
  frameHolds,
  directWiderThanCap: direct.client > 256,
}))
console.log('PASS 内层 div 在 table-layout:auto 下截断，表格没有撑出 640px 容器')
