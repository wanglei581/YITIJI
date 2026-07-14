/**
 * Kiosk 招聘会来源签到入口防回退验证。
 *
 * 只验证真实来源入口闭环：
 * - 首页“扫码签到”必须进入 /job-fairs/checkin。
 * - /job-fairs/checkin 只能读取真实 getJobFairs 并筛选 checkinUrl，不展示假码。
 * - 详情页只能用 fair.checkinUrl 展示来源二维码，并记录 external_checkin_open。
 * - 页面不得出现签到结果、确认签到、平台签到等闭环文案。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0
function pass(message) { console.log(`  PASS ${message}`) }
function fail(message) { failed += 1; console.error(`  FAIL ${message}`) }

function read(rel) {
  const p = join(ROOT, rel)
  if (!existsSync(p)) {
    fail(`文件缺失: ${rel}`)
    return ''
  }
  return readFileSync(p, 'utf8')
}

function mustContain(rel, markers, label) {
  const src = read(rel)
  const missing = markers.filter((marker) => !src.includes(marker))
  if (missing.length > 0) fail(`${label}: 缺少 ${missing.join(' | ')}`)
  else pass(label)
}

function mustNotContain(rel, words, label) {
  const src = read(rel)
  const hits = words.filter((word) => src.includes(word))
  if (hits.length > 0) fail(`${label}: 命中 ${hits.join(' | ')}`)
  else pass(label)
}

console.log('\n=== Kiosk 招聘会来源签到入口防回退验证 ===')

mustContain(
  'src/pages/home/serviceGroups.ts',
  ["title: '扫码签到'", "to: '/job-fairs/checkin'"],
  '首页扫码签到入口进入来源签到列表',
)

mustContain(
  'src/routes/index.tsx',
  ['JobFairCheckinPage', "path: 'job-fairs/checkin'"],
  '路由注册 /job-fairs/checkin',
)

mustContain(
  'src/pages/job-fairs/JobFairCheckinPage.tsx',
  [
    'getJobFairs',
    'fair.checkinUrl',
    '扫码前往来源平台签到',
    '本系统不记录签到结果',
    'navigate(`/job-fairs/${fair.id}`',
  ],
  '来源签到列表只筛选真实 checkinUrl 并跳详情',
)

mustContain(
  'src/pages/job-fairs/JobFairDetailPage.tsx',
  [
    "kind: 'checkin'",
    'fair.checkinUrl',
    'external_checkin_open',
    '扫码前往来源平台签到',
    '本系统不记录签到结果',
  ],
  '招聘会详情页使用 checkinUrl 展示来源签到二维码并记录打开动作',
)

mustContain(
  'src/services/api/activity.ts',
  ['ActivityJumpAction', 'recordExternalJump'],
  'Kiosk 行为记录沿用 shared ActivityJumpAction',
)

for (const rel of [
  'src/pages/home/serviceGroups.ts',
  'src/pages/job-fairs/JobFairCheckinPage.tsx',
  'src/pages/job-fairs/JobFairDetailPage.tsx',
]) {
  mustNotContain(rel, ['签到成功', '确认签到', '平台内签到', '入场成功', '报名成功'], `Kiosk 不出现签到结果文案 ${rel}`)
}

if (failed > 0) {
  console.error(`\n=== FAILED (${failed} 项) ===`)
  process.exit(1)
}

console.log('\n=== ALL PASS ===')
