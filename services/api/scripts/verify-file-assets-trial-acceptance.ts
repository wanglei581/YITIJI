/**
 * 用户文件与简历资产生产/试运营验收证据包防回退验证。
 *
 * 运行: pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance
 *
 * 注意: 本脚本只做静态文档与门禁口径检查,不连接生产 PostgreSQL、Redis 或 COS。
 */
import { strict as assert } from 'assert'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const repoRoot = join(__dirname, '../../..')
const acceptancePath = join(repoRoot, 'docs/acceptance/user-file-assets-trial-acceptance.md')
const checklistPath = join(repoRoot, 'docs/device/production-deployment-and-windows-host-checklist.md')
const progressPath = join(repoRoot, 'docs/progress/current-progress.md')
const nextTasksPath = join(repoRoot, 'docs/progress/next-tasks.md')
const filesServicePath = join(repoRoot, 'services/api/src/files/files.service.ts')
const filesCleanupTaskPath = join(repoRoot, 'services/api/src/files/files.cleanup.task.ts')
const filesModulePath = join(repoRoot, 'services/api/src/files/files.module.ts')
const appModulePath = join(repoRoot, 'services/api/src/app.module.ts')

assert.ok(existsSync(acceptancePath), 'must create docs/acceptance/user-file-assets-trial-acceptance.md')

const acceptance = readFileSync(acceptancePath, 'utf8')
const checklist = readFileSync(checklistPath, 'utf8')
const progress = readFileSync(progressPath, 'utf8')
const nextTasks = readFileSync(nextTasksPath, 'utf8')
const filesService = readFileSync(filesServicePath, 'utf8')
const filesCleanupTask = readFileSync(filesCleanupTaskPath, 'utf8')
const filesModule = readFileSync(filesModulePath, 'utf8')
const appModule = readFileSync(appModulePath, 'utf8')

for (const marker of [
  'STATIC DOC CHECK ONLY',
  '本证据包就绪不等于生产/试运营已完成',
  '尚未执行生产验收',
  '不得声称生产已完成',
  '[ ] PENDING REAL-EVIDENCE',
  'PostgreSQL',
  'COS 私有桶',
  '会员账号',
  '上传原始文件',
  '上传优化后或修改后文件',
  '90 天',
  '180 天',
  '长期保存',
  'retentionConsentVersion',
  'retentionConsentAt',
  'expiresAt = null',
  '重登查看',
  '跨账号越权否定测试',
  '删除三态一致',
  'COS HEAD 404',
  'ActivityLog',
  '过期清理',
  'long_term 防误删',
  '签名 URL TTL',
  'TTL <= 30min',
  '手机号脱敏',
  'token 脱敏',
  '签名 URL 脱敏',
  '腾讯云控制台生命周期规则截图',
  '禁止配置 Bucket 全局过期规则',
  'users/',
  'tmp/',
  '不得覆盖长期保存对象',
  'verify:production-runtime-gates',
  'verify:production-db-guard',
  'verify:cos-lifecycle-policy',
  'verify:cos:live',
  'verify:member-assets-c2d',
  '停止/回滚',
]) {
  assert.ok(acceptance.includes(marker), `acceptance evidence pack must mention: ${marker}`)
}

for (const marker of [
  'user-file-assets-trial-acceptance.md',
  '用户文件与简历资产证据包',
  '不得以本地 SQLite/local storage verify 代替 PostgreSQL + COS + 会员账号真实验收',
]) {
  assert.ok(checklist.includes(marker), `production checklist must reference file assets acceptance: ${marker}`)
}

assert.ok(
  progress.includes('codex/file-assets-trial-acceptance') && progress.includes('非生产/试运营验收完成'),
  'current-progress must record this branch as evidence-pack only, not production completion',
)
assert.ok(
  nextTasks.includes('用户文件与简历资产证据包') && nextTasks.includes('真实生产/试运营执行'),
  'next-tasks must keep real production/trial execution pending',
)

for (const line of acceptance.split('\n')) {
  const completionClaim = /(?:生产验收已完成|试运营已完成|已正式上线|生产就绪已通过)/.test(line)
  const negativeContext = /(?:不得|禁止|不等于|不能|不可|没有证据)/.test(line)
  assert.ok(!completionClaim || negativeContext, `acceptance doc must not claim production/trial completion: ${line}`)
}
assert.doesNotMatch(
  acceptance,
  /- \[x\].*(?:PENDING REAL-EVIDENCE|生产|COS|PostgreSQL|重登|过期清理|删除三态)/,
  'manual production evidence rows must remain unchecked in the template',
)

assert.match(filesService, /where:\s*\{\s*deletedAt:\s*null,\s*expiresAt:\s*\{\s*lt:\s*now\s*\}/, 'cleanupExpired must select only expired non-deleted rows')
assert.match(filesService, /await this\.storage\.deleteObject\(f\.storageKey,\s*f\.bucket\)/, 'cleanupExpired must delete storage object before marking the row deleted')
assert.match(filesService, /action:\s*'file\.cleanup_expired'/, 'cleanupExpired cron path must write audit log')
assert.match(filesCleanupTask, /@Cron\(CronExpression\.EVERY_HOUR\)/, 'FilesCleanupTask must remain hourly cron based')
assert.match(filesModule, /providers:\s*\[\s*FilesService,\s*FilesCleanupTask\s*\]/, 'FilesCleanupTask must remain registered in FilesModule')
assert.match(appModule, /ScheduleModule\.forRoot\(\)/, 'ScheduleModule must remain enabled in AppModule')

console.warn('[STATIC DOC CHECK ONLY] This verification does NOT prove production/trial acceptance.')
console.warn('[静态文档检查] 本脚本通过不代表生产/试运营验收已完成；仍需人工执行生产清单并留存截图、日志和审计查询。')
console.log('verify:file-assets-trial-acceptance passed')
