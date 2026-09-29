/**
 * 冻结占位页诚实文案守卫：禁止再写「功能建设中 / 敬请期待」假进度，
 * 并锁定 Admin / Partner 四页与定稿一致的诚实说明关键字。
 *
 * 2026-08-16（C1）：`apps/partner/src/routes/stats/index.tsx` 已接上真实
 * `GET /partner/stats`，不再是空壳，故从本清单摘除。
 * 该页自身的诚实性改由 `pnpm --filter @ai-job-print/partner verify:partner-stats-contract` 守：
 * 它断言页面不伪造漏斗、不把曝光/跳转写成投递/预约。
 * 2026-09-29：`apps/admin/src/routes/permissions/index.tsx` 从说明空态改为
 * 真实内部账号名册（对接后端 admin-internal-accounts 模块），同样从占位钉子
 * 摘除，改为「已接真实接口」的正向断言（页面必须调用 internalAccounts 适配器，
 * 不得退回占位空态）；诚实性由 verify:admin-internal-accounts-ui 守。
 * 其余三页（admin peripherals、partner terminals / account）继续钉住。
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
    path: join(repoRoot, 'apps/partner/src/routes/terminals/index.tsx'),
    must: ['终端明细暂由平台统一运营', '伪状态'],
  },
  {
    path: join(repoRoot, 'apps/partner/src/routes/account/index.tsx'),
    must: ['账号与角色由平台侧统一管理', '半套 RBAC'],
  },
]

// 已接真实接口的页面：正向断言（不再钉占位文案，但也不许退回占位空态）。
const wired = [
  {
    path: join(adminRoot, 'src/routes/permissions/index.tsx'),
    must: ["from '../../services/api/internalAccounts'", '内部账号名册'],
    forbidden: ['账号与角色由平台侧统一管理'],
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

for (const target of wired) {
  if (!existsSync(target.path)) fail(`文件不存在: ${target.path}`)
  const source = readFileSync(target.path, 'utf8')
  for (const token of forbidden) {
    if (source.includes(token)) fail(`${target.path} 仍含禁止文案「${token}」`)
  }
  for (const token of target.must) {
    if (!source.includes(token)) fail(`${target.path} 缺少接真实接口关键字「${token}」`)
  }
  for (const token of target.forbidden ?? []) {
    if (source.includes(token)) fail(`${target.path} 退回了占位文案「${token}」`)
  }
  pass(`${target.path.replace(repoRoot + '/', '')} 已接真实接口`)
}

console.log('\nALL PASS')
