/**
 * 我的页商用闭环第一批 P0b 预生产验收执行包防回退验证。
 *
 * 运行: pnpm --filter @ai-job-print/api verify:profile-commercial-first-batch-acceptance
 *
 * 注意: 本脚本只做静态文档与门禁口径检查,不连接预生产 PostgreSQL、
 * 不修改 env,不执行 migration,不造验收夹具,也不操作真实 Kiosk / Admin / Terminal Agent。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(__dirname, '../../..')
const runbookPath = join(repoRoot, 'docs/acceptance/profile-commercial-preprod-redeploy-and-acceptance.md')
const nextTasksPath = join(repoRoot, 'docs/progress/next-tasks.md')
const currentProgressPath = join(repoRoot, 'docs/progress/current-progress.md')
const apiPackagePath = join(repoRoot, 'services/api/package.json')
const ciPath = join(repoRoot, '.github/workflows/ci.yml')

let failed = 0

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failed += 1
  console.error(`  FAIL ${message}`)
}

function mustExist(path: string, label: string): string {
  if (!existsSync(path)) {
    fail(`${label} — 文件缺失: ${path.replace(`${repoRoot}/`, '')}`)
    return ''
  }
  pass(label)
  return readFileSync(path, 'utf8')
}

function mustContain(source: string, markers: string[], label: string): void {
  const missing = markers.filter((marker) => !source.includes(marker))
  if (missing.length > 0) fail(`${label} — 缺少: ${missing.join(' | ')}`)
  else pass(label)
}

function mustNotContainUnsafe(source: string, markers: string[], label: string): void {
  const unsafeLines = source
    .split('\n')
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => markers.some((marker) => line.includes(marker)))
    .filter(({ line }) => !/(不得|不代表|不能|未|禁止|红线|排除|不接|不真机|不作为)/.test(line))
  if (unsafeLines.length > 0) {
    fail(`${label} — 存在未带禁止语境的风险文案: ${unsafeLines.map((item) => `${item.index}:${item.line.trim()}`).join(' || ')}`)
  } else {
    pass(label)
  }
}

function assertNoOverclaim(source: string, label: string): void {
  const risky = source
    .split('\n')
    .flatMap((line, lineIndex) => line
      .split(/[。；;|]/)
      .map((sentence) => ({ sentence: sentence.trim(), lineIndex: lineIndex + 1 }))
      .filter(({ sentence }) => sentence.length > 0))
    .filter(({ sentence }) => /我的页|P0b|C5-1|C5-2|C5-3|P1|支付|核销|打印订单|RedemptionRecord|PaymentAttempt/.test(sentence))
    .filter(({ sentence }) => /(预生产|正式生产|商用|上线|真机|出纸|live)[^。\n]{0,70}(完成|通过|已完成|已通过|可上线|可商用|可用)/.test(sentence))
    .filter(({ sentence }) => !/(不代表|不得|不能|未|待|仍需|尚未|不可|禁止|草案|只做基础健康|不作为本 runbook 的验收结论|代码 \+ 本地 verify 级|门禁就绪)/.test(sentence))
  if (risky.length > 0) {
    fail(`${label} — 存在可能过度宣称的句子: ${risky.map((item) => `${item.lineIndex}:${item.sentence}`).join(' || ')}`)
  } else {
    pass(label)
  }
}

function pickRelevantProgress(source: string): string {
  return source
    .split('\n')
    .filter((line) => /P0b 验收执行包静态门禁|profile-commercial-first-batch-acceptance|我的页商用闭环第一批 P0b/.test(line))
    .join('\n')
}

function main(): void {
  console.log('\n=== 我的页商用闭环第一批 P0b 预生产验收执行包门禁 ===')

  const runbook = mustExist(runbookPath, 'P0b 预生产验收 runbook 存在')
  const nextTasks = mustExist(nextTasksPath, 'next-tasks 进度入口存在')
  const currentProgress = mustExist(currentProgressPath, 'current-progress 进度入口存在')
  const packageJson = mustExist(apiPackagePath, 'API package.json 存在')
  const ci = mustExist(ciPath, 'GitHub CI 配置存在')

  mustContain(runbook, [
    '状态：**草案（待审阅）**',
    '不代表任何部署 / 迁移 / 验收已执行',
    '每一个写操作（部署、切软链、migrate、重启 PM2、造夹具）都必须先备份、再经用户显式确认后执行',
    '预生产（staging）',
    '不是正式生产',
    '不接 live 支付、不真机出纸',
    'C5-1',
    'P0b',
    'P1',
    'C5-2（线上沙箱）',
    'C5-3（Kiosk 收银 UI）',
    'C5-4 起（退款 / Order 抵扣核销）',
    'C5-6（live 微信 / 支付宝）',
    '只做基础健康 / 回归确认',
    '不作为本 runbook 的验收结论',
    'paymentSource',
    'offline / free / manual_confirmed',
    'wechat/alipay/benefit/sandbox',
    '无真实资金',
    '不得据本 runbook 任一步宣称商用上线',
  ], 'runbook 锁定 C5-1/P0b/P1 范围和支付红线')

  mustContain(runbook, [
    '当前**不可验收**',
    '软链 / PM2 进程 / DB migration / Kiosk dist 四者错位',
    'P1/C5-2 表缺失',
    'TARGET_COMMIT',
    'CI（`build-and-verify` + `postgres-readiness`）**双 job 全绿',
    'f8bd3028',
    '单一 commit 原则',
    'DEPLOY_SOURCE.txt',
    'PostgreSQL 全库备份',
    'pg_dump',
    'pg_restore -l',
    'pm2 jlist',
    'nginx -T',
    'git worktree add /tmp/deploy-<TARGET_COMMIT>',
    'pnpm install --frozen-lockfile',
    'db:pg:generate',
    'VITE_API_MODE=http',
    'VITE_TERMINAL_ID=KSK-001',
    'ln -sfn "$REL" /srv/ai-job-print',
    'db:pg:deploy',
    'db:pg:sync:check',
    'pm2 startOrReload',
  ], 'runbook 锁定干净重部署、备份、迁移和 PM2 切换步骤')

  mustContain(runbook, [
    'PriceConfig',
    'PaymentAttempt',
    'RedemptionRecord',
    'BenefitGrant',
    'subsidy_eligibility_hint',
    '/me/print-orders',
    'pickupCode',
    '暂无支付信息',
    'verify:order',
    'verify:pricing',
    'verify:member-print-orders',
    'verify:member-print-orders-ui',
    'verify:benefit-redemption',
    'verify:benefit-activities',
    'verify:member-benefits-admin',
    'Cache-Control: no-store',
    '不得称「真机出纸 / 取件验收完成」',
    '不得称「live 微信 / 支付宝可用」',
    '不得称「正式生产验收 / 商用上线完成」',
  ], 'runbook 覆盖 C5-1/P0b/P1 验收项、防回退 verify 和禁止过度宣称')

  mustContain(runbook, [
    '证据',
    '证据原文不入仓',
    '文件原文',
    '签名 URL',
    '取件码',
    '手机号',
    '不含**文件原文 / 签名 URL / `errorCode` / `errorMessage` / `endUserId` / `terminalId`',
    '验收判负',
    '回滚',
  ], 'runbook 锁定证据脱敏、停止条件和回滚边界')

  mustContain(nextTasks, [
    '我的页商用闭环第一批 P0a 静态守卫',
    'P0b 验收执行包静态门禁',
    'verify:profile-commercial-first-batch-acceptance',
    'verify:benefit-redemption fallback DB',
    '不代表预生产部署、迁移、造数、真机出纸或商用上线完成',
  ], 'next-tasks 记录 P0b 静态门禁且不误宣称验收完成')

  mustContain(currentProgress, [
    '我的页商用闭环第一批 P0b 验收执行包静态门禁',
    'verify:profile-commercial-first-batch-acceptance',
    'verify:benefit-redemption fallback DB',
    '只代表 runbook 静态边界和 CI 防回退门禁就绪',
    '不代表预生产已重部署、数据库已迁移、验收夹具已创建、真实 Kiosk 浏览器验收、Windows 真机出纸或商用上线完成',
  ], 'current-progress 记录 P0b 静态门禁和未完成边界')

  mustContain(packageJson, [
    '"verify:profile-commercial-first-batch-acceptance"',
  ], 'API package 注册 P0b 验收执行包门禁脚本')

  mustContain(ci, [
    'pnpm --filter @ai-job-print/kiosk verify:profile-commercial-first-batch',
    'pnpm --filter @ai-job-print/api verify:profile-commercial-first-batch-acceptance',
  ], 'CI Verify suites 接入 P0a 与 P0b 门禁')

  mustNotContainUnsafe(runbook, [
    '一键投递',
    '平台投递',
    '候选人推荐给企业',
    '企业端候选人筛选',
    'live 微信支付已通过',
    '正式生产验收通过',
    '商用上线完成',
  ], 'runbook 不引入招聘平台闭环或上线完成宣称')

  assertNoOverclaim(`${runbook}\n${pickRelevantProgress(nextTasks)}\n${pickRelevantProgress(currentProgress)}`, 'P0b 验收执行包不得过度宣称预生产 / 真机 / 商用完成')

  if (failed > 0) {
    console.error(`\n❌ ${failed} 项失败 — 我的页商用闭环第一批 P0b 验收执行包门禁未通过\n`)
    process.exit(1)
  }

  console.log('✅ ALL PASS — 我的页商用闭环第一批 P0b 预生产验收执行包门禁一致\n')
}

main()
