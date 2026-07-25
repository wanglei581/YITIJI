/**
 * 冻结占位页诚实文案守卫：禁止再写「功能建设中 / 敬请期待」假进度，
 * 并锁定 Admin / Partner 五页与定稿一致的诚实说明关键字。
 *
 * Run: pnpm --filter @ai-job-print/admin verify:honest-placeholders
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(adminRoot, '..', '..')

const targets = [
  {
    path: join(adminRoot, 'src/routes/peripherals/index.tsx'),
    must: ['本阶段不开放外设独立管理', 'Terminal Agent'],
  },
  {
    path: join(adminRoot, 'src/routes/permissions/index.tsx'),
    must: ['账号与角色由平台侧统一管理', 'RBAC'],
  },
  {
    path: join(repoRoot, 'apps/partner/src/routes/terminals/index.tsx'),
    must: ['终端明细暂由平台统一运营', '伪状态'],
  },
  {
    path: join(repoRoot, 'apps/partner/src/routes/stats/index.tsx'),
    must: ['统计报表本阶段不开放', '假报表'],
  },
  {
    path: join(repoRoot, 'apps/partner/src/routes/account/index.tsx'),
    must: ['账号与角色由平台侧统一管理', '半套 RBAC'],
  },
]

const forbidden = ['功能建设中', '敬请期待']

function fail(message) {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function pass(message) {
  console.log(`  PASS ${message}`)
}

console.log('\n=== 冻结占位页诚实文案验证 ===')

for (const target of targets) {
  if (!existsSync(target.path)) fail(`文件不存在: ${target.path}`)
  const source = readFileSync(target.path, 'utf8')
  for (const token of forbidden) {
    if (source.includes(token)) fail(`${target.path} 仍含禁止文案「${token}」`)
  }
  for (const token of target.must) {
    if (!source.includes(token)) fail(`${target.path} 缺少诚实关键字「${token}」`)
  }
  pass(`${target.path.replace(repoRoot + '/', '')} 文案诚实`)
}

console.log('\nALL PASS')
