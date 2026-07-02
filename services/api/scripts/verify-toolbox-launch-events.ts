/**
 * 百宝箱匿名启动事件闭环验证。
 *
 * 覆盖:
 *   1. SQLite/PostgreSQL 双 schema 与迁移包含 ToolboxLaunchEvent。
 *   2. 公开 Kiosk 写入端点限流,只接 itemKey/action/placement。
 *   3. 后端从终端配置派生 launchMode/title/targetHost,不信任客户端 URL/host。
 *   4. Admin 汇总接口走既有 admin guard,并返回最近 7 天基础统计。
 *   5. Kiosk 使用 sendBeacon 保障外部 H5 确认事件,Admin 文案使用“二维码展示数”。
 *
 * 运行: pnpm --filter @ai-job-print/api verify:toolbox-launch-events
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0

function pass(msg: string): void { console.log(`  PASS ${msg}`) }
function fail(msg: string): void { console.error(`  FAIL ${msg}`); failures++ }

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
}

function contains(rel: string, markers: string[], label: string): void {
  const src = read(rel)
  const missing = markers.filter((marker) => !src.includes(marker))
  if (missing.length) fail(`${label} 缺少: ${missing.join(' | ')}`)
  else pass(label)
}

function notContains(rel: string, markers: string[], label: string): void {
  const src = read(rel)
  const found = markers.filter((marker) => src.includes(marker))
  if (found.length) fail(`${label} 不应包含: ${found.join(' | ')}`)
  else pass(label)
}

console.log('\n=== 百宝箱匿名启动事件闭环验证 ===')

for (const schema of ['prisma/schema.prisma', 'prisma/postgres/schema.prisma']) {
  contains(schema, [
    'model ToolboxLaunchEvent',
    'terminalId String',
    'itemKey    String',
    'launchMode String',
    'action     String',
    'targetHost String?',
    '@@index([terminalId, createdAt])',
    '@@index([itemKey, createdAt])',
    '@@index([action, createdAt])',
    '@@index([createdAt])',
    '@@index([expiresAt])',
  ], `${schema} 声明匿名事件模型和索引`)
}

for (const migration of [
  'prisma/migrations/20260701123000_add_toolbox_launch_events/migration.sql',
  'prisma/postgres/migrations/20260701123000_add_toolbox_launch_events/migration.sql',
]) {
  contains(migration, [
    'CREATE TABLE "ToolboxLaunchEvent"',
    '"terminalId"',
    '"itemKey"',
    '"targetHost"',
    'ToolboxLaunchEvent_terminalId_createdAt_idx',
    'ToolboxLaunchEvent_createdAt_idx',
    'ToolboxLaunchEvent_expiresAt_idx',
  ], `${migration} 创建匿名事件表`)
}

contains('src/terminals/dto/record-toolbox-launch-event.dto.ts', [
  'RecordToolboxLaunchEventDto',
  "'show_qr'",
  "'open_external_notice'",
  "'open_external_confirmed'",
  "'cancel_external'",
  'TOOLBOX_PLACEMENTS',
], 'Kiosk 事件 DTO 仅允许动作和投放位置白名单')
notContains('src/terminals/dto/record-toolbox-launch-event.dto.ts', ['targetHost', 'externalUrl', 'qrTargetUrl'], 'Kiosk 事件 DTO 不接收 URL/host 字段')

contains('src/terminals/terminals.controller.ts', [
  "@Post('terminals/:terminalId/toolbox-events')",
  '@Throttle({ default: { ttl: 60_000, limit: 60 } })',
  'recordLaunchEvent(terminalId, dto)',
], '公开 Kiosk 事件端点存在并限流')

contains('src/terminals/admin-toolbox.controller.ts', [
  '@UseGuards(JwtAuthGuard, RolesGuard)',
  "@Get('admin/toolbox/launch-summary')",
  'getLaunchSummary({ days, terminalId })',
], 'Admin 百宝箱统计接口复用 admin guard')

contains('src/terminals/terminal-toolbox.service.ts', [
  'TOOLBOX_EVENT_RETENTION_DAYS = 90',
  'targetHostFromItem(item)',
  'terminal?.enabled',
  'findConfigByTerminalRef(terminal.terminalCode, terminal)',
  'actionAllowedForItem(input.action, item)',
  'toolboxLaunchEvent.create',
  'toolboxLaunchEvent.groupBy',
  'cleanupExpiredLaunchEvents',
], 'TerminalToolboxService 服务端派生可信事件字段并支持汇总/清理')
notContains('src/terminals/terminal-toolbox.service.ts', ['input.targetHost', 'input.externalUrl', 'audit.write'], '事件记录不信任客户端 host/URL 且不写 AuditLog')

contains('../../apps/kiosk/src/services/api/toolboxLaunchEvents.ts', [
  'recordToolboxLaunchEvent',
  'recordToolboxLaunchEventBeforeUnload',
  'navigator.sendBeacon',
  'keepalive: true',
  "credentials: 'omit'",
  "API_MODE !== 'http'",
  'getTerminalId()',
], 'Kiosk 百宝箱事件 fire-and-forget 上报服务存在')

contains('../../apps/kiosk/src/pages/home/components/ToolboxLaunchModals.tsx', [
  "action: 'show_qr'",
  "action: 'open_external_notice'",
  "action: 'open_external_confirmed'",
  "action: 'cancel_external'",
  'recordToolboxLaunchEventBeforeUnload',
], 'Kiosk 二维码和外部 H5 弹窗接入匿名事件')

contains('../../apps/admin/src/services/api/toolbox.ts', [
  'getLaunchSummary',
  '/admin/toolbox/launch-summary',
  'ToolboxLaunchSummary',
], 'Admin service 接入百宝箱统计接口')

contains('../../apps/admin/src/routes/toolbox/index.tsx', [
  'ToolboxLaunchSummaryCard',
  '二维码展示数',
  '外部确认打开',
  'Top 功能项',
  'toolboxService.getLaunchSummary({ days: 7 })',
], 'Admin 百宝箱页面展示基础统计且文案不误称真实扫码')

console.log('')
if (failures > 0) {
  console.error(`FAIL ${failures} 项失败:百宝箱匿名启动事件闭环验证未通过\n`)
  process.exit(1)
}
console.log('ALL PASS:百宝箱匿名启动事件闭环符合预期\n')
