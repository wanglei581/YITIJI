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
 * 2026-09-29：admin 外设页（/devices?tab=peripherals）与 partner 终端数据页（/terminals）
 * 已接真实接口，不再是空壳。两页改钉「读真实接口、不伪造状态」：
 *   - 外设页只读 GET /admin/terminals；无遥测的 U 盘 / 扫码枪 / 摄像头 / 读卡器写「不上报」；
 *     不提供远程解除扫描锁死的入口。
 *   - 终端数据页只读 GET /partner/terminal-operations；http 模式绝不返回演示数据，
 *     mock 示例在页面上标「演示数据」；服务人次与 AI 可用率照实写「暂不能统计」。
 * permissions、partner account 两页仍是空壳，继续按原关键字钉住。
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
    must: ['getTerminals', '不上报', '终端离线', '后台不提供远程解除', '终端程序'],
    mustNot: ['unlockScanInput', 'resetScanInput', 'clearScanLockout', 'overrideScanInput', 'forceScanInput', 'Math.random'],
  },
  {
    path: join(repoRoot, 'apps/partner/src/routes/terminals/index.tsx'),
    must: ['getPartnerTerminalOperations', "data.dataMode === 'demo'", '演示数据', '本机构还没有绑定终端'],
    mustNot: ['Math.random', 'consoleScreen'],
  },
  {
    // http 模式只走真实接口：演示数据只在 API_MODE 不是 http 时返回
    path: join(repoRoot, 'apps/partner/src/services/api/terminalOps.ts'),
    must: [
      "if (API_MODE !== 'http') return buildDemoTerminalOps(period)",
      'return fetchTerminalOps(period)',
      "return { ...body, dataMode: 'live' }",
    ],
    mustNot: ['Math.random'],
    exactCount: { 'buildDemoTerminalOps(': 2 },
  },
  {
    path: join(repoRoot, 'apps/partner/src/routes/terminals/TerminalOpsCards.tsx'),
    must: ['暂不能统计', '不等于人次', '暂不能按本机构终端统计'],
  },
  {
    path: join(repoRoot, 'apps/partner/src/routes/account/index.tsx'),
    must: ['账号与角色由平台侧统一管理', '如需增删机构账号或调整权限，请联系平台运营。'],
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
  for (const token of target.mustNot ?? []) {
    if (source.includes(token)) fail(`${target.path} 不应出现「${token}」`)
  }
  for (const [token, expected] of Object.entries(target.exactCount ?? {})) {
    const actual = source.split(token).length - 1
    if (actual !== expected) fail(`${target.path} 中「${token}」应出现 ${expected} 次，实际 ${actual} 次`)
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
