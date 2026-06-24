/**
 * Kiosk 隐私与文件留存文案防回退验证。
 *
 * 运行: pnpm --filter @ai-job-print/kiosk verify:legal-retention-copy
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(ROOT, '../..')
const files = [
  join(ROOT, 'src/pages/legal/LegalDocPage.tsx'),
  join(ROOT, 'src/pages/help/HelpCenterPage.tsx'),
  join(repoRoot, 'packages/shared/src/types/complianceCopy.ts'),
  join(repoRoot, 'docs/compliance/launch-review-submissions.md'),
]

let failed = 0

function pass(msg) { console.log(`  PASS ${msg}`) }
function fail(msg) { console.error(`  FAIL ${msg}`); failed++ }

function mustContain(src, marker, label) {
  if (src.includes(marker)) pass(label)
  else fail(`${label} — 缺少: ${marker}`)
}

function mustNotMatch(src, pattern, label) {
  if (!pattern.test(src)) pass(label)
  else fail(`${label} — 命中旧口径: ${pattern}`)
}

const combined = files.map((file) => readFileSync(file, 'utf8')).join('\n')

console.log('\n=== Kiosk 隐私与文件留存文案验证 ===')

for (const marker of ['90 天', '180 天', '长期保存', '短期', '不进入简历库', '不转发任何第三方']) {
  mustContain(combined, marker, `文案包含 ${marker}`)
}

mustContain(combined, '原始简历与求职材料默认保存 90 天', '隐私政策说明原始材料默认 90 天')
mustContain(combined, '延长至 180 天需确认保存条款', '隐私政策说明原始材料延长至 180 天需确认')
mustContain(combined, '优化后或派生成果物可由用户确认后长期保存', '隐私政策说明长期保存仅适用于优化/派生成果物')
mustContain(combined, '可在「我的文档」中调整保存期限或随时删除', '采集点说明用户可自主管理保存期限')

mustNotMatch(combined, /分析完成后\s*1\s*小时内自动删除/, '不得把会员简历通用承诺为 1 小时删除')
mustNotMatch(combined, /通常\s*1\s*小时内/, '不得保留旧通常 1 小时口径')
mustNotMatch(combined, /默认\s*24\s*小时/, '不得保留旧默认 24 小时口径')
mustNotMatch(combined, /原始简历[^。；;\n]*长期保存/, '不得暗示原始简历可长期保存')
mustNotMatch(combined, /简历和求职材料[^。；;\n]*长期保存/, '不得把简历和求职材料统称为可长期保存')

if (failed > 0) {
  console.error(`\n=== FAILED (${failed} 项) ===`)
  process.exit(1)
}

console.log('\n=== ALL PASS ===')
