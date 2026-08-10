/**
 * AI 签约风险提示预生产验收包防漂移验证。
 *
 * 只检查仓库内执行包、默认开关、Gate 0 引用和 CI 接线；不连接任何
 * PostgreSQL/Redis/对象存储/provider，不修改 env，不部署，也不操作真机。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(__dirname, '../../..')
const paths = {
  runbook: join(repoRoot, 'docs/acceptance/contract-review-preprod-acceptance-runbook.md'),
  releaseGate: join(repoRoot, 'docs/compliance/contract-review-release-gate.md'),
  currentProgress: join(repoRoot, 'docs/progress/current-progress.md'),
  nextTasks: join(repoRoot, 'docs/progress/next-tasks.md'),
  apiEnv: join(repoRoot, 'services/api/.env.example'),
  kioskEnv: join(repoRoot, 'apps/kiosk/.env.example'),
  apiPackage: join(repoRoot, 'services/api/package.json'),
  ci: join(repoRoot, '.github/workflows/ci.yml'),
}

let failed = 0

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failed += 1
  console.error(`  FAIL ${message}`)
}

function read(path: string, label: string): string {
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

function mustNotContain(source: string, markers: string[], label: string): void {
  const found = markers.filter((marker) => source.includes(marker))
  if (found.length > 0) fail(`${label} — 不应包含: ${found.join(' | ')}`)
  else pass(label)
}

function main(): void {
  console.log('\n=== AI 签约风险提示预生产验收包门禁 ===')

  const runbook = read(paths.runbook, '预生产验收执行包存在')
  const releaseGate = read(paths.releaseGate, 'Gate 0 发布门禁存在')
  const currentProgress = read(paths.currentProgress, 'current-progress 入口存在')
  const nextTasks = read(paths.nextTasks, 'next-tasks 入口存在')
  const apiEnv = read(paths.apiEnv, 'API env example 存在')
  const kioskEnv = read(paths.kioskEnv, 'Kiosk env example 存在')
  const apiPackage = read(paths.apiPackage, 'API package.json 存在')
  const ci = read(paths.ci, 'CI workflow 存在')

  mustContain(runbook, [
    'STATIC READINESS CHECK ONLY',
    '不能作为部署授权或功能开关授权',
    '不打印合同原件',
    'CR-G0 本地冻结候选门禁',
    'verify:bos',
    'verify:contract-review:preprod-readiness',
    'verify:contract-review:http',
    'verify:print-jobs',
    'test:browser:contract-review',
    'CR-G1 预生产只读就绪检查',
    'CR-G2 PostgreSQL 与法务正文',
    'CR-G3 Redis / BullMQ 真实队列',
    'CR-G4 获准境内模型与日志净化',
    'CR-G5 私有对象存储与敏感文件生命周期',
    'FILE_STORAGE_LEGACY_DRIVER=cos',
    'storageProvider=bos',
    'storageProvider=cos',
    'CR-G6 公共终端会员/匿名隐私',
    'CR-G7 Windows 奔图风险提示报告出纸',
    'contract_review_report',
    '数据库 SHA-256',
    '未支付任务不能被 Agent 领取',
    '停止条件',
    '启用顺序与回滚',
    'CR-G0 至 CR-G7 全部为 PASS',
    '统一结论为 NO-GO',
  ], '执行包覆盖全部真实依赖、隐私、打印、停止和回滚门禁')

  mustContain(runbook, [
    'VITE_ENABLE_CONTRACT_REVIEW=false',
    'VITE_ENABLE_CONTRACT_REVIEW_REPORT_PRINT=false',
    'CONTRACT_REVIEW_REPORT_PRINT_ENABLED=false',
  ], '执行包明确三个默认关闭开关')

  mustContain(releaseGate, [
    'production_default: false',
    'fail_closed: true',
    'Gate 0 获批只允许进入技术验收，不等于允许部署或打开用户入口',
  ], 'Gate 0 默认关闭与 fail-closed 边界仍存在')

  mustContain(apiEnv, ['CONTRACT_REVIEW_REPORT_PRINT_ENABLED=false'], 'API 报告打印默认关闭')
  mustContain(kioskEnv, [
    'VITE_ENABLE_CONTRACT_REVIEW=false',
    'VITE_ENABLE_CONTRACT_REVIEW_REPORT_PRINT=false',
  ], 'Kiosk 合同入口与报告打印默认关闭')

  mustContain(apiPackage, ['"verify:contract-review:preprod-readiness"'], 'API 注册预生产验收门禁命令')
  mustContain(ci, [
    'pnpm --filter @ai-job-print/api verify:contract-review:preprod-readiness',
  ], 'CI 接入预生产验收包防漂移验证')

  mustContain(currentProgress, [
    'AI签约风险提示预生产验收执行包',
    '不代表真实预生产或 Windows 真机已经通过',
  ], 'current-progress 保留代码侧交付与真实验收边界')
  mustContain(nextTasks, [
    'contract-review-preprod-acceptance-runbook.md',
    'CR-G0 至 CR-G7',
  ], 'next-tasks 指向正式执行包与剩余 Gate')

  mustNotContain(runbook, [
    '打印合同原件并',
    '自动签署合同',
    '替代律师意见',
    '无需授权即可部署',
    '一键投递',
    '平台投递',
  ], '执行包不引入合同越权、部署越权或招聘闭环')

  if (failed > 0) {
    console.error(`\n❌ ${failed} 项失败 — AI 签约风险提示预生产验收包门禁未通过\n`)
    process.exit(1)
  }

  console.log('✅ ALL PASS — AI 签约风险提示预生产验收包门禁一致\n')
}

main()
