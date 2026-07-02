/**
 * 百宝箱预生产验收执行包防回退验证。
 *
 * 运行: pnpm --filter @ai-job-print/api verify:toolbox-preprod-acceptance
 *
 * 注意: 本脚本只做静态文档与门禁口径检查,不连接预生产 PostgreSQL、
 * 不修改 env,不执行 migration,也不操作真实 Kiosk / Admin / Terminal Agent。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(__dirname, '../../..')
const runbookPath = join(repoRoot, 'docs/acceptance/toolbox-preprod-acceptance-runbook.md')
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
    .filter(({ line }) => /百宝箱|Toolbox|toolbox|智慧校园/.test(line))
    .filter(({ line }) => /(生产|预生产|商用|上线|试运营)[^。\n]{0,50}(完成|通过|已完成|已通过|可上线|可商用)/.test(line))
    .filter(({ line }) => !/(不代表|不得|不能|未|待|仍需|尚未|PENDING|不等于|不可|执行清单|状态：)/.test(line))
  if (risky.length > 0) {
    fail(`${label} — 存在可能过度宣称的行: ${risky.map((item) => `${item.index}:${item.line.trim()}`).join(' || ')}`)
  } else {
    pass(label)
  }
}

function main(): void {
  console.log('\n=== 百宝箱预生产验收执行包门禁 ===')

  const runbook = mustExist(runbookPath, '百宝箱预生产验收执行包存在')
  const nextTasks = mustExist(nextTasksPath, 'next-tasks 进度入口存在')
  const currentProgress = mustExist(currentProgressPath, 'current-progress 进度入口存在')
  const packageJson = mustExist(apiPackagePath, 'API package.json 存在')

  mustContain(runbook, [
    'STATIC DOC CHECK ONLY',
    '不代表预生产 migration、真实终端配置、Kiosk 操作或 Admin 统计抽样已经完成',
    '证据不进 Git',
    '第三方页面办理结果回传',
    '完整外部 URL',
    'token',
    '平台内一键投递',
    '候选人筛选',
    '外部 skill / 小程序运行沙箱',
    'TB-G0 本地静态门禁',
    'verify:toolbox-launch-events',
    'verify:toolbox-preprod-acceptance',
    'verify:terminal-device-config',
    'db:pg:sync:check',
    'TB-G1 预生产只读预检',
    'TB-G2 PostgreSQL migration',
    '整库备份不得写入证据目录',
    'DB_BACKUP_DIR="/srv/ai-job-print-db-backups"',
    'TB-G2-01-backup-sha256.log',
    'KIOSK_EXTERNAL_APP_ALLOWED_HOSTS',
    'KIOSK_QR_TARGET_ALLOWED_HOSTS',
    'TB-G3 Admin 真实终端配置验收',
    'TOOLBOX_EXTERNAL_HOST_NOT_ALLOWED',
    'toolbox_config.update',
    'TB-G4 Kiosk 真实终端交互与 Admin 统计抽样',
    'ToolboxLaunchEvent',
    'show_qr',
    'open_external_notice',
    'open_external_confirmed',
    'cancel_external',
    'targetHost',
    '二维码展示数',
    '停止条件',
    'Admin 统计接口未鉴权即可访问',
    '白名单外部域名被保存成功',
    '未知终端或停用终端仍能写入事件',
    '回滚标准',
    '不得在 TB-G2~TB-G4 均通过前宣称百宝箱生产/预生产验收完成',
  ], '执行包覆盖本地门禁、预生产、迁移、真实配置、统计、停止条件和回滚')

  mustContain(nextTasks, [
    '百宝箱匿名使用事件与 Admin 基础统计代码侧闭环',
    '生产验收仍需执行 migration、真实终端配置、白名单环境变量复核和 Admin 统计口径抽样',
  ], 'next-tasks 保留百宝箱生产验收待办边界')

  mustContain(currentProgress, [
    '百宝箱匿名使用事件与 Admin 基础统计闭环',
    '不代表第三方小程序执行、skill 技能包平台、第三方结果回传或生产环境迁移已完成',
  ], 'current-progress 保留百宝箱代码侧完成与生产未完成边界')

  mustContain(packageJson, ['"verify:toolbox-preprod-acceptance"'], 'API package 注册百宝箱预生产验收门禁脚本')

  mustNotContain(runbook, [
    '平台投递完成',
    '候选人推荐给企业',
    '收取简历给企业',
    '自动执行第三方操作',
  ], '执行包不引入招聘平台闭环或第三方自动办理能力')

  assertNoOverclaim(`${runbook}\n${nextTasks}\n${currentProgress}`, '百宝箱验收文档不得过度宣称生产 / 预生产 / 商用完成')

  if (failed > 0) {
    console.error(`\n❌ ${failed} 项失败 — 百宝箱预生产验收执行包门禁未通过\n`)
    process.exit(1)
  }

  console.log('✅ ALL PASS — 百宝箱预生产验收执行包门禁一致\n')
}

main()
