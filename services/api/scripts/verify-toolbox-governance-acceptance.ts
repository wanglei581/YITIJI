/**
 * 百宝箱微应用审核发布真实验收执行包防回退验证。
 *
 * 运行: pnpm --filter @ai-job-print/api verify:toolbox-governance-acceptance
 *
 * 注意: 本脚本只做静态文档与门禁口径检查,不连接预生产 PostgreSQL、
 * 不修改 env,不执行 migration,不操作真实管理员账号或真实终端。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(__dirname, '../../..')
const runbookPath = join(repoRoot, 'docs/acceptance/toolbox-micro-app-governance-acceptance.md')
const recordPath = join(repoRoot, 'docs/acceptance/toolbox-micro-app-governance-execution-record.md')
const productPath = join(repoRoot, 'docs/product/toolbox-micro-app-platform.md')
const nextTasksPath = join(repoRoot, 'docs/progress/next-tasks.md')
const currentProgressPath = join(repoRoot, 'docs/progress/current-progress.md')
const apiPackagePath = join(repoRoot, 'services/api/package.json')

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

function mustNotContain(source: string, markers: string[], label: string): void {
  const found = markers.filter((marker) => source.includes(marker))
  if (found.length > 0) fail(`${label} — 不应包含: ${found.join(' | ')}`)
  else pass(label)
}

function assertNoOverclaim(source: string, label: string): void {
  const risky = source
    .split('\n')
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => /百宝箱|微应用|Toolbox|toolbox/.test(line))
    .filter(({ line }) => /(生产|预生产|商用|上线|试运营)[^。\n]{0,50}(完成|通过|已完成|已通过|可上线|可商用)/.test(line))
    .filter(({ line }) => !/(不代表|不得|不能|未|待|仍需|尚未|PENDING|不等于|不可|执行包|执行清单|状态：|只有|仍不得|禁止证明|本执行包不证明)/.test(line))
  if (risky.length > 0) {
    fail(`${label} — 存在可能过度宣称的行: ${risky.map((item) => `${item.index}:${item.line.trim()}`).join(' || ')}`)
  } else {
    pass(label)
  }
}

function main(): void {
  console.log('\n=== 百宝箱微应用审核发布真实验收执行包门禁 ===')

  const runbook = mustExist(runbookPath, '微应用审核发布验收执行包存在')
  const record = mustExist(recordPath, '微应用审核发布执行记录模板存在')
  const product = mustExist(productPath, '产品方案存在')
  const nextTasks = mustExist(nextTasksPath, 'next-tasks 进度入口存在')
  const currentProgress = mustExist(currentProgressPath, 'current-progress 进度入口存在')
  const packageJson = mustExist(apiPackagePath, 'API package.json 存在')

  mustContain(runbook, [
    'STATIC DOC CHECK ONLY',
    '不代表预生产 migration、真实管理员异人审批、真实终端发布投影、熔断演练或首批微应用商用上线已经完成',
    '证据不进 Git',
    '第三方 JS / WASM / 任意外部 skill 包执行',
    '平台内一键投递',
    '候选人筛选',
    'TMG-G0 本地静态门禁',
    'verify:toolbox-micro-app-platform',
    'verify:toolbox-review-workflow',
    'verify:toolbox-review-ui',
    'verify:toolbox-governance-acceptance',
    'TMG-G1 预生产只读预检',
    'TMG-G2 PostgreSQL migration 与环境白名单复核',
    '20260702002000_add_toolbox_governance',
    'TOOLBOX_ALLOW_EXTERNAL_URL',
    'KIOSK_EXTERNAL_APP_ALLOWED_HOSTS',
    'KIOSK_QR_TARGET_ALLOWED_HOSTS',
    'TMG-G3 管理员异人审批与域名审核',
    'TOOLBOX_SELF_REVIEW_FORBIDDEN',
    'toolbox_version.submit',
    'toolbox_version.approve',
    'toolbox_allowed_host.upsert',
    'toolbox_allowed_host.review',
    'TMG-G4 发布投影、Kiosk 展示与熔断移除',
    'projectionKey=app:${appKey}',
    'Admin UI 不能编辑或删除该 `app:` 投影项',
    'TMG-G5 首批低风险微应用接线准备',
    'salary-negotiation',
    'hr-qa',
    'offer-compare',
    'contract-review',
    'legal-risk-check',
    'exam-paper-print',
    '停止条件',
    '自审批成功',
    '未审核版本发布成功',
    '白名单外 host 发布成功',
    '熔断后 Kiosk 仍展示该微应用',
    '回滚标准',
  ], '执行包覆盖 G0-G5、异人审核、投影、熔断、首批低风险候选、停止条件和回滚')

  mustContain(record, [
    '状态：PENDING',
    '尚未执行预生产 migration、真实管理员异人审批、真实终端发布投影或熔断演练',
    'TMG-G0 本地静态门禁',
    'TMG-G1 预生产只读预检',
    'TMG-G2 PostgreSQL migration 与环境白名单复核',
    'TMG-G3 管理员异人审批与域名审核',
    'TMG-G4 发布投影、Kiosk 展示与熔断移除',
    'TMG-G5 首批低风险微应用接线准备',
    'PENDING',
    '不得据此宣称百宝箱微应用平台生产上线、商用上线',
  ], '执行记录模板保持 PENDING 且覆盖全部 Gate')

  mustContain(packageJson, ['"verify:toolbox-governance-acceptance"'], 'API package 注册微应用治理验收门禁脚本')

  mustContain(product, [
    'Phase 2C Admin 审核发布 UI',
    '未执行预生产 / 生产 PostgreSQL migration',
    '未用真实管理员账号完成异人审批、发布、熔断和允许域名激活验收',
  ], '产品方案保留 Phase 2C 完成与真实验收未完成边界')

  mustContain(nextTasks, [
    '百宝箱微应用平台 Phase 2D 真实预生产执行',
    '百宝箱微应用平台首批低风险微应用接线',
    '真实管理员异人审批',
    '真实终端发布投影',
    '薪资谈判话术',
    'HR 知识问答',
    'Offer 对比',
  ], 'next-tasks 保留 Phase 2D 和低风险首批候选')

  mustContain(currentProgress, [
    'Phase 2C Admin 审核发布 UI',
    '不代表预生产 / 生产 migration、真实管理员异人审批、真实终端发布投影',
  ], 'current-progress 保留 Phase 2C 非生产完成边界')

  mustNotContain(`${runbook}\n${record}`, [
    '平台投递完成',
    '收取简历给企业',
    '自动执行第三方操作',
    '商用上线完成',
  ], '执行包不引入招聘平台闭环、第三方自动办理或上线完成宣称')

  assertNoOverclaim(`${runbook}\n${record}\n${product}\n${nextTasks}\n${currentProgress}`, '微应用治理验收文档不得过度宣称生产 / 预生产 / 商用完成')

  if (failed > 0) {
    console.error(`\n❌ ${failed} 项失败 — 百宝箱微应用审核发布真实验收执行包门禁未通过\n`)
    process.exit(1)
  }

  console.log('✅ ALL PASS — 百宝箱微应用审核发布真实验收执行包门禁一致\n')
}

main()
