/**
 * 招聘会 / 校园招聘页面尺寸防回退验证。
 *
 * 这些页面已经进入“只做零行为拆分,不得继续堆功能”的治理阶段。
 * 本脚本只检查主页面文件体积,不检查生成文件或组件文件。
 *
 * 运行: node apps/kiosk/scripts/verify-jobfair-page-size.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIMIT = 500

const FILES = [
  'src/pages/campus/CampusPage.tsx',
  'src/pages/job-fairs/JobFairDetailPage.tsx',
  'src/pages/job-fairs/FairCompanyDetailPage.tsx',
]

let failed = 0

console.log('\n=== 招聘会 / 校园招聘页面尺寸防回退验证 ===')

for (const rel of FILES) {
  const lineCount = readFileSync(join(ROOT, rel), 'utf8').split('\n').length
  if (lineCount > LIMIT) {
    failed += 1
    console.error(`  FAIL ${rel}: ${lineCount} 行,超过 ${LIMIT} 行门槛`)
  } else {
    console.log(`  PASS ${rel}: ${lineCount} 行`)
  }
}

if (failed > 0) {
  console.error(`\n=== FAILED (${failed} 个主页面仍超限) ===`)
  process.exit(1)
}

console.log('\n=== ALL PASS ===')
