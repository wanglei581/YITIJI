/**
 * 百宝箱微应用审核发布工作流防回退门禁。
 *
 * 运行: pnpm --filter @ai-job-print/api verify:toolbox-review-workflow
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeToolboxItemsForConfig,
  withTerminalToolboxConfigMutationLock,
} from '../src/terminals/terminal-toolbox.service'
import { snapshotToKioskToolboxItem, toolboxProjectionKey } from '../src/terminals/toolbox-projection'

process.env['TOOLBOX_ALLOW_EXTERNAL_URL'] = 'true'
process.env['KIOSK_EXTERNAL_APP_ALLOWED_HOSTS'] = 'trusted.example.com,assets.example.com'
process.env['KIOSK_QR_TARGET_ALLOWED_HOSTS'] = 'trusted.example.com'

const repoRoot = join(__dirname, '../../..')
const apiRoot = join(repoRoot, 'services/api')

let failed = 0

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failed += 1
  console.error(`  FAIL ${message}`)
}

function read(rel: string): string {
  return readFileSync(join(apiRoot, rel), 'utf8')
}

function mustExist(rel: string, label: string): string {
  const path = join(apiRoot, rel)
  if (!existsSync(path)) {
    fail(`${label} 缺失: ${rel}`)
    return ''
  }
  pass(label)
  return readFileSync(path, 'utf8')
}

function mustContain(source: string, markers: string[], label: string): void {
  const missing = markers.filter((marker) => !source.includes(marker))
  if (missing.length > 0) fail(`${label} 缺少: ${missing.join(' | ')}`)
  else pass(label)
}

function mustNotContain(source: string, markers: string[], label: string): void {
  const found = markers.filter((marker) => source.includes(marker))
  if (found.length > 0) fail(`${label} 不应包含: ${found.join(' | ')}`)
  else pass(label)
}

function errorCode(error: unknown): string {
  const response = (error as { getResponse?: () => unknown }).getResponse?.()
  if (response && typeof response === 'object' && 'error' in response) {
    return ((response as { error?: { code?: string } }).error?.code) ?? ''
  }
  return error instanceof Error ? error.message : ''
}

function runStaticChecks(): void {
  console.log('\n=== Phase 2B 静态结构验证 ===')
  const sqliteSchema = read('prisma/schema.prisma')
  const pgSchema = read('prisma/postgres/schema.prisma')
  const sqliteMigration = mustExist(
    'prisma/migrations/20260702002000_add_toolbox_governance/migration.sql',
    'SQLite 审核发布迁移存在',
  )
  const pgMigration = mustExist(
    'prisma/postgres/migrations/20260702002000_add_toolbox_governance/migration.sql',
    'Postgres 审核发布迁移存在',
  )

  for (const [label, source] of [['SQLite schema', sqliteSchema], ['Postgres schema', pgSchema]] as const) {
    mustContain(source, [
      'model ToolboxApp',
      'model ToolboxAppVersion',
      'model ToolboxAllowedHost',
      'snapshotJson    String',
      'createdBy  String?',
      'updatedBy  String?',
      '@@unique([appId, version])',
      '@@unique([host, purpose])',
    ], `${label} 包含三张治理表和唯一约束`)
  }

  for (const [label, source] of [['SQLite migration', sqliteMigration], ['Postgres migration', pgMigration]] as const) {
    mustContain(source, [
      'CREATE TABLE "ToolboxApp"',
      'CREATE TABLE "ToolboxAppVersion"',
      'CREATE TABLE "ToolboxAllowedHost"',
      '"snapshotJson"',
      '"createdBy"',
      '"updatedBy"',
      'ToolboxAppVersion_appId_version_key',
      'ToolboxAllowedHost_host_purpose_key',
    ], `${label} 创建治理表和关键索引`)
  }

  const service = read('src/terminals/toolbox-governance.service.ts')
  const helper = read('src/terminals/toolbox-governance.helpers.ts')
  mustContain(service, [
    'async listApps',
    'async listVersions',
    'async listAllowedHostsForAdmin',
    'snapshot: parseSnapshot',
    'assertReviewer(host.updatedBy ?? host.createdBy, reviewerId)',
    'evaluateToolboxPublishGate',
    'normalizeToolboxItemsForConfig',
    'withTerminalToolboxConfigMutationLock(\'publishVersion\'',
    'withTerminalToolboxConfigMutationLock(\'suspendApp\'',
    'snapshotToKioskToolboxItem',
    'this.prisma.$transaction(async (tx)',
    'timeout: 30_000',
    'maxWait: 10_000',
    'TOOLBOX_TERMINAL_NOT_FOUND',
    'createdBy: userId',
    'updatedBy: userId',
    'status: \'published\'',
    'status: \'suspended\'',
  ], '治理 service 复用规则、发布前 dry-run 严格校验、串行化写入 itemsJson 并使用事务')
  mustNotContain(service, [
    'take: 500',
    '?? terminalId',
  ], '治理 service 不得静默截断默认发布或为未知终端生成孤儿配置')
  mustContain(helper, [
    'canTransitionToolboxAppStatus',
    'assertDistinctToolboxReviewers',
  ], '治理 helper 复用状态机和自审批规则')
  mustNotContain(`${service}\n${helper}`, [
    'TOOLBOX_GOVERNANCE_TRANSITIONS =',
    'TOOLBOX_GOVERNANCE_FORBIDDEN_PERMISSIONS =',
  ], '治理 service/helper 不复制状态机和禁用能力规则')

  const projection = read('src/terminals/toolbox-projection.ts')
  const governance = read('src/terminals/toolbox-governance.ts')
  mustContain(governance, [
    'entryType !== \'mini_program_qr\'',
    'requiresUrlHostGate',
  ], '发布 gate 不把小程序码当作 HTTPS 域名白名单目标')
  mustContain(projection, [
    'toolboxProjectionKey',
    '`app:${appKey',
    'entryType === \'web_app\'',
    'entryType === \'mini_program_qr\'',
    'assistantIntent',
    'riskLevel: snapshot.riskLevel',
    'disclaimers: snapshot.disclaimers',
  ], '投影函数使用 app 命名空间并覆盖 web/二维码/AI skill')

  const controller = read('src/terminals/admin-toolbox.controller.ts')
  const productDoc = readFileSync(join(repoRoot, 'docs/product/toolbox-micro-app-platform.md'), 'utf8')
  mustContain(productDoc, [
    'ToolboxAllowedHost(active)',
    'KIOSK_EXTERNAL_APP_ALLOWED_HOSTS',
    'KIOSK_QR_TARGET_ALLOWED_HOSTS',
  ], '产品文档说明 DB 治理表与 env 白名单双门禁口径')

  mustContain(controller, [
    '@Get(\'admin/toolbox/apps\')',
    '@Get(\'admin/toolbox/apps/:appKey/versions\')',
    '@Get(\'admin/toolbox/allowed-hosts\')',
    '@Post(\'admin/toolbox/apps\')',
    '@Post(\'admin/toolbox/apps/:appKey/versions\')',
    '@Post(\'admin/toolbox/apps/:appKey/versions/:version/submit\')',
    '@Post(\'admin/toolbox/apps/:appKey/versions/:version/approve\')',
    '@Post(\'admin/toolbox/apps/:appKey/versions/:version/reject\')',
    '@Post(\'admin/toolbox/apps/:appKey/versions/:version/publish\')',
    '@Post(\'admin/toolbox/apps/:appKey/suspend\')',
    '@Post(\'admin/toolbox/allowed-hosts\')',
    'toolbox_app.create',
    'toolbox_version.submit',
    'toolbox_version.approve',
    'toolbox_version.reject',
    'toolbox_version.publish',
    'toolbox_app.suspend',
    'toolbox_allowed_host.upsert',
    'toolbox_allowed_host.review',
  ], 'Admin API 和 AuditLog 动作覆盖审核发布闭环')

  const prismaService = read('src/prisma/prisma.service.ts')
  const terminalToolboxService = read('src/terminals/terminal-toolbox.service.ts')
  mustContain(terminalToolboxService, [
    'withTerminalToolboxConfigMutationLock',
    'terminalToolboxConfigMutationQueue',
    'withTerminalToolboxConfigMutationLock(\'saveTerminalConfig\'',
    'mergeGovernedProjectionItems',
    'item.key.startsWith(\'app:\')',
  ], '终端手工配置保存时串行化 itemsJson 写入并保留治理发布投影项')
  mustContain(prismaService, [
    'get toolboxApp()',
    'get toolboxAppVersion()',
    'get toolboxAllowedHost()',
    'export type PrismaTransactionClient',
  ], 'PrismaService 暴露治理模型和稳定事务类型')
}

function runProjectionChecks(): void {
  console.log('\n=== Phase 2B 投影与严格校验验证 ===')
  const aiItem = snapshotToKioskToolboxItem('offer-compare', {
    id: 'offer-compare',
    title: 'Offer 对比',
    shortDescription: '候选人自用决策参考',
    riskLevel: 'medium',
    disclaimers: ['结果仅供个人决策参考。'],
    launch: {
      entryType: 'ai_skill',
      assistantIntent: 'offer_compare',
    },
  })
  if (aiItem.key !== 'app:offer-compare') fail(`AI skill 投影 key 异常: ${aiItem.key}`)
  else pass('AI skill 投影 key 使用 app 命名空间')
  if (aiItem.launchMode !== 'internal_route' || aiItem.to !== '/assistant?intent=offer_compare') {
    fail(`AI skill 投影路由异常: ${JSON.stringify(aiItem)}`)
  } else pass('AI skill 投影为站内 assistant intent')
  if (!Array.isArray(aiItem.disclaimers)) {
    fail('AI skill 投影必须保留免责声明元数据')
  } else pass('投影保留免责声明元数据')

  const webItem = snapshotToKioskToolboxItem('salary-web', {
    id: 'salary-web',
    title: '薪资谈判话术',
    shortDescription: '候选人自用沟通练习',
    launch: {
      entryType: 'web_app',
      externalUrl: 'https://trusted.example.com/salary',
      requiresHostAllowlist: true,
    },
  })
  const normalizedWeb = normalizeToolboxItemsForConfig([webItem], { strict: true })[0]
  if (normalizedWeb?.launchMode !== 'external_url') fail(`web_app 严格投影异常: ${JSON.stringify(normalizedWeb)}`)
  else pass('web_app 投影可通过外链总控和域名白名单严格校验')

  const qrItem = snapshotToKioskToolboxItem('paper-print', {
    id: 'paper-print',
    title: '试卷打印',
    shortDescription: '授权材料手机端办理入口',
    launch: {
      entryType: 'qr_code',
      qrImageUrl: 'https://assets.example.com/paper-print.png',
      qrTargetUrl: 'https://trusted.example.com/paper-print',
      requiresHostAllowlist: true,
    },
  })
  const normalizedQr = normalizeToolboxItemsForConfig([qrItem], { strict: true })[0]
  if (normalizedQr?.launchMode !== 'qr_code' || !normalizedQr.qrTargetUrl) {
    fail(`qr_code 严格投影异常: ${JSON.stringify(normalizedQr)}`)
  } else pass('qr_code 投影要求二维码图片和可审计目标地址')

  try {
    normalizeToolboxItemsForConfig([
      snapshotToKioskToolboxItem('bad-route', {
        id: 'bad-route',
        title: '非法站内路由',
        shortDescription: '应被严格校验拦截',
        launch: { entryType: 'internal_route', internalRoute: '/admin/secrets' },
      }),
    ], { strict: true })
    fail('非法站内路由必须被严格校验拒绝')
  } catch (error) {
    const code = errorCode(error)
    if (code === 'INVALID_TOOLBOX_ROUTE') pass('非法站内路由被严格校验拒绝')
    else fail(`非法站内路由错误码异常: ${code}`)
  }

  if (toolboxProjectionKey('Offer-Compare') !== 'app:offer-compare') {
    fail('toolboxProjectionKey 必须归一化大小写')
  } else pass('toolboxProjectionKey 归一化大小写')
}

async function runMutationLockChecks(): Promise<void> {
  console.log('\n=== Phase 2B itemsJson 串行化验证 ===')
  const order: string[] = []
  await Promise.all([
    withTerminalToolboxConfigMutationLock('verify-first', async () => {
      order.push('first:start')
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push('first:end')
    }),
    withTerminalToolboxConfigMutationLock('verify-second', async () => {
      order.push('second:start')
      order.push('second:end')
    }),
  ])
  const actual = order.join('|')
  const expected = 'first:start|first:end|second:start|second:end'
  if (actual !== expected) fail(`itemsJson 串行化锁顺序异常: ${actual}`)
  else pass('itemsJson 读改写通过共享串行化锁避免同进程丢更新')
}

async function main(): Promise<void> {
  runStaticChecks()
  runProjectionChecks()
  await runMutationLockChecks()

  if (failed > 0) {
    console.error(`\nverify-toolbox-review-workflow failed: ${failed}`)
    process.exit(1)
  }

  console.log('\nverify-toolbox-review-workflow passed')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
