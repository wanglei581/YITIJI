/**
 * 一体机统一配置上的「本机不接新单」字段。
 *
 * GET /api/v1/terminals/:terminalId/config
 *   maintenance / maintenanceMessage
 *
 * 运行: pnpm --filter @ai-job-print/api verify:kiosk-terminal-maintenance
 */
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UnauthorizedException } from '@nestjs/common'
import { kioskTerminalMaintenanceNotice } from '../src/terminals/kiosk-terminal-maintenance'

const MAINTENANCE_MESSAGE = '这台机器正在维护，暂时不能打印和扫描，请稍后再来'
const PAUSED_MESSAGE = '这台机器暂停服务，请稍后再来'
const NOT_STARTED_MESSAGE = '这台机器还没有开始服务'
const INTERNAL_NOTE = '打印机鼓粉盒更换中，联系供应商'

function pass(message: string): void { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(`FAIL ${message}`) }

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof UnauthorizedException)) return undefined
  const response = error.getResponse() as { error?: { code?: string } }
  return response.error?.code
}

async function expectCode(label: string, expected: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action()
  } catch (error) {
    if (codeOf(error) === expected) {
      pass(label)
      return
    }
    fail(`${label}: expected ${expected}, got ${codeOf(error) ?? String(error)}`)
  }
  fail(`${label}: unexpectedly succeeded`)
}

function prepareTempDatabase(): { previousUrl: string | undefined; dir: string } {
  const source = join(process.cwd(), 'prisma/dev.db')
  const dir = join(tmpdir(), `kiosk-terminal-maintenance-${randomBytes(4).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, 'verify.db')
  copyFileSync(source, dbPath)
  const tableInfo = execFileSync('sqlite3', [dbPath, 'PRAGMA table_info("Terminal");'], { encoding: 'utf8' })
  if (!tableInfo.includes('|lifecycleStatus|') || !tableInfo.includes('|enabled|')) {
    throw new Error('临时库 Terminal 缺少 lifecycleStatus 或 enabled，不能验维护字段')
  }
  const previousUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = `file:${dbPath}`
  return { previousUrl, dir }
}

function cleanupTempDatabase(prepared: { previousUrl: string | undefined; dir: string }): void {
  if (prepared.previousUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = prepared.previousUrl
  rmSync(prepared.dir, { recursive: true, force: true })
}

function assertNotice(
  label: string,
  actual: { maintenance: boolean; maintenanceMessage: string | null },
  maintenance: boolean,
  message: string | null,
): void {
  if (actual.maintenance !== maintenance || actual.maintenanceMessage !== message) {
    fail(`${label}: got ${JSON.stringify(actual)}`)
  }
  const body = JSON.stringify(actual)
  if (body.includes(INTERNAL_NOTE)) fail(`${label}: 响应带上了管理员备注`)
  pass(label)
}

function assertPureMatrix(): void {
  console.log('\n=== 本机维护字段（纯函数）===')
  assertNotice(
    'active + enabled → false / null',
    kioskTerminalMaintenanceNotice({ identityVerified: true, enabled: true, lifecycleStatus: 'active' }),
    false,
    null,
  )
  assertNotice(
    'maintenance → 维护文案',
    kioskTerminalMaintenanceNotice({ identityVerified: true, enabled: true, lifecycleStatus: 'maintenance' }),
    true,
    MAINTENANCE_MESSAGE,
  )
  assertNotice(
    'suspended → 暂停文案',
    kioskTerminalMaintenanceNotice({ identityVerified: true, enabled: true, lifecycleStatus: 'suspended' }),
    true,
    PAUSED_MESSAGE,
  )
  assertNotice(
    'commissioning → 还没有开始服务',
    kioskTerminalMaintenanceNotice({ identityVerified: true, enabled: true, lifecycleStatus: 'commissioning' }),
    true,
    NOT_STARTED_MESSAGE,
  )
  assertNotice(
    'planned → 还没有开始服务',
    kioskTerminalMaintenanceNotice({ identityVerified: true, enabled: true, lifecycleStatus: 'planned' }),
    true,
    NOT_STARTED_MESSAGE,
  )
  assertNotice(
    'retired → 还没有开始服务',
    kioskTerminalMaintenanceNotice({ identityVerified: true, enabled: false, lifecycleStatus: 'retired' }),
    true,
    NOT_STARTED_MESSAGE,
  )
  assertNotice(
    'enabled=false 且仍是 active → 暂停文案',
    kioskTerminalMaintenanceNotice({ identityVerified: true, enabled: false, lifecycleStatus: 'active' }),
    true,
    PAUSED_MESSAGE,
  )
  assertNotice(
    '无终端会话 → false / null，即使这台机器正在维护',
    kioskTerminalMaintenanceNotice({ identityVerified: false, enabled: false, lifecycleStatus: 'maintenance' }),
    false,
    null,
  )
  const source = readFileSync(join(process.cwd(), 'src/terminals/kiosk-terminal-maintenance.ts'), 'utf8')
  if (source.includes(INTERNAL_NOTE) || source.includes('工作人员')) {
    fail('维护文案源码写进了管理员备注或「工作人员」')
  }
  pass('文案源码没有管理员备注，也没有「工作人员」')
}

async function assertConfigRoundTrip(): Promise<void> {
  console.log('\n=== 配置接口读库（无服务端缓存）===')
  const prepared = prepareTempDatabase()
  try {
  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { AuditService } = await import('../src/audit/audit.service')
  const { TerminalToolboxService } = await import('../src/terminals/terminal-toolbox.service')
  const { TerminalAgentService } = await import('../src/terminals/terminals-agent.service')
  const { TerminalAdminService } = await import('../src/terminals/terminals-admin.service')
  const { TerminalsService } = await import('../src/terminals/terminals.service')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const toolbox = new TerminalToolboxService(prisma)
  const agent = new TerminalAgentService(prisma, audit)
  const admin = new TerminalAdminService(prisma, agent, toolbox)
  const terminals = new TerminalsService(agent, admin)

  const suffix = randomBytes(4).toString('hex')
  const adminId = `usr_ktm_${suffix}`
  const terminalId = `term_ktm_${suffix}`
  const terminalCode = `KTM-${suffix}`
  const note = `${INTERNAL_NOTE} ${suffix}`

  async function cleanup(): Promise<void> {
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { startsWith: `term_ktm_${suffix}` } } })
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } })
    // 退役行有删除触发器，临时库整文件会删掉，这里只清能删的。
    await prisma.terminal.deleteMany({
      where: { id: { startsWith: `term_ktm_${suffix}` }, lifecycleStatus: { not: 'retired' } },
    })
    await prisma.user.deleteMany({ where: { id: adminId } })
  }

  async function readNotice(ref: string, label: string, maintenance: boolean, message: string | null) {
    const config = await terminals.getKioskTerminalConfig(ref)
    assertNotice(label, config, maintenance, message)
    if (JSON.stringify(config).includes(INTERNAL_NOTE) || JSON.stringify(config).includes(adminId) || JSON.stringify(config).includes('"lifecycleStatus"')) {
      fail(`${label}: 配置响应泄露了管理员备注、操作人或生命周期原值`)
    }
  }

  try {
    await cleanup()
    await prisma.user.create({
      data: { id: adminId, username: `ktm_${suffix}`, passwordHash: 'x', name: '维护字段验证', role: 'admin' },
    })
    await prisma.terminal.create({
      data: {
        id: terminalId,
        terminalCode,
        agentToken: `ktm-token-${suffix}`,
        deviceFingerprint: `fp-ktm-${suffix}`,
        enabled: true,
        lifecycleStatus: 'active',
      },
    })
    await prisma.terminalHeartbeat.create({
      data: { terminalId, createdAt: new Date(Date.now() - 10 * 60 * 1000), printerStatus: 'ok' },
    })
    const heartbeat = await prisma.terminalHeartbeat.findFirst({ where: { terminalId } })
    if (!heartbeat || Date.now() - heartbeat.createdAt.getTime() < 5 * 60 * 1000) {
      fail('心跳夹具没有超过 5 分钟')
    }

    await readNotice(terminalCode, '心跳已过期但 active + enabled → false / null', false, null)

    const before = Date.now()
    await admin.updateTerminalLifecycle(terminalCode, 'maintenance', {
      actorId: adminId,
      actorRole: 'admin',
      reason: note,
    }, { expectedStatus: 'active', expectedVersion: 0 })
    await readNotice(terminalCode, '后台改为维护中后，下一次配置读取即为维护文案', true, MAINTENANCE_MESSAGE)
    if (Date.now() - before > 5_000) fail('后台改状态后读取超过 5 秒，不能当作「下一次请求」')
    pass('配置响应没有管理员备注、操作人或生命周期原值')

    await admin.updateTerminalLifecycle(terminalCode, 'suspended', {
      actorId: adminId,
      actorRole: 'admin',
      reason: note,
    }, { expectedStatus: 'maintenance', expectedVersion: 1 })
    await readNotice(terminalId, 'suspended → 配置接口', true, PAUSED_MESSAGE)

    const commissioningId = `${terminalId}_c`
    await prisma.terminal.create({
      data: {
        id: commissioningId,
        terminalCode: `${terminalCode}-C`,
        agentToken: `ktm-token-${suffix}-c`,
        deviceFingerprint: `fp-ktm-${suffix}-c`,
        enabled: true,
        lifecycleStatus: 'commissioning',
      },
    })
    await readNotice(commissioningId, 'commissioning → 配置接口', true, NOT_STARTED_MESSAGE)

    const plannedId = `${terminalId}_p`
    await prisma.terminal.create({
      data: {
        id: plannedId,
        terminalCode: `${terminalCode}-P`,
        agentToken: `planned$${suffix}`,
        credentialGeneration: 0,
        deviceFingerprint: `fp-ktm-${suffix}-p`,
        enabled: true,
        lifecycleStatus: 'planned',
      },
    })
    await readNotice(plannedId, 'planned → 配置接口', true, NOT_STARTED_MESSAGE)

    const retiredCode = `${terminalCode}-R`
    const retiredId = `${terminalId}_r`
    await prisma.terminal.create({
      data: {
        id: retiredId,
        terminalCode: retiredCode,
        agentToken: `ktm-token-${suffix}-r`,
        deviceFingerprint: `fp-ktm-${suffix}-r`,
        enabled: true,
        lifecycleStatus: 'active',
      },
    })
    await admin.updateTerminalLifecycle(retiredCode, 'maintenance', {
      actorId: adminId,
      actorRole: 'admin',
      reason: note,
    }, { expectedStatus: 'active', expectedVersion: 0 })
    await admin.updateTerminalLifecycle(retiredCode, 'retired', {
      actorId: adminId,
      actorRole: 'admin',
      reason: note,
      confirmationText: retiredCode,
    }, { expectedStatus: 'maintenance', expectedVersion: 1 })
    await readNotice(retiredId, 'retired → 配置接口', true, NOT_STARTED_MESSAGE)

    const disabledId = `${terminalId}_off`
    await prisma.terminal.create({
      data: {
        id: disabledId,
        terminalCode: `${terminalCode}-OFF`,
        agentToken: `ktm-token-${suffix}-off`,
        deviceFingerprint: `fp-ktm-${suffix}-off`,
        enabled: false,
        lifecycleStatus: 'active',
      },
    })
    await readNotice(disabledId, 'enabled=false → 配置接口', true, PAUSED_MESSAGE)

    const restoredId = `${terminalId}_on`
    await prisma.terminal.create({
      data: {
        id: restoredId,
        terminalCode: `${terminalCode}-ON`,
        agentToken: `ktm-token-${suffix}-on`,
        deviceFingerprint: `fp-ktm-${suffix}-on`,
        enabled: true,
        lifecycleStatus: 'active',
      },
    })
    await readNotice(restoredId, '恢复 active + enabled → 配置接口', false, null)

    await readNotice(`missing-${suffix}`, '找不到终端时不报维护', false, null)
  } finally {
    await cleanup().catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
  }
  } finally {
    cleanupTempDatabase(prepared)
  }
}

async function assertDisabledSessionCanRead(): Promise<void> {
  console.log('\n=== 停用后的本机会话仍可过配置守卫；没有会话则 401 ===')
  const data = new Map<string, string>()
  const redis = {
    async get(key: string) { return data.get(key) ?? null },
    async getDel(key: string) { const value = data.get(key) ?? null; data.delete(key); return value },
    async setEx(key: string, _ttl: number, value: string) { data.set(key, value) },
  }
  const rows = new Map<string, { enabled: boolean; credentialGeneration: number }>([
    ['term_ktm_a', { enabled: true, credentialGeneration: 3 }],
    ['term_ktm_b', { enabled: true, credentialGeneration: 3 }],
  ])
  const prisma = {
    terminal: {
      async findUnique(input: { where: { id: string } }) { return rows.get(input.where.id) ?? null },
    },
  }
  const { TerminalSessionService } = await import('../src/terminals/terminal-session.service')
  const { TerminalIdentityGuard } = await import('../src/terminals/terminal-identity.guard')
  const sessions = new TerminalSessionService(redis as never, prisma as never, { async validateTerminalToken() { return undefined } })
  const boot = await sessions.createBootTicket('term_ktm_a', 'Bearer fixture')
  const session = await sessions.exchangeBootTicket(boot.bootTicket)
  rows.get('term_ktm_a')!.enabled = false

  await expectCode('停用后，普通校验仍拒绝旧会话', 'TERMINAL_SESSION_INVALID', () => sessions.validate('term_ktm_a', session.sessionToken))
  await sessions.validate('term_ktm_a', session.sessionToken, { allowDisabled: true })
  pass('配置读取允许已停用终端的本机有效会话')

  const context = (terminalId: string | undefined, sessionToken: string | undefined, routeTerminalId: string) => ({
    getHandler: () => 'config',
    getClass: () => 'terminals',
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) => name === 'x-terminal-id' ? terminalId : sessionToken,
        params: { terminalId: routeTerminalId },
        body: {},
      }),
    }),
  })
  const allowing = new TerminalIdentityGuard(sessions, { getAllAndOverride: () => true } as never)
  if (await allowing.canActivate(context('term_ktm_a', session.sessionToken, 'term_ktm_a') as never) !== true) {
    fail('配置守卫没有放行已停用终端的本机会话')
  }
  pass('配置守卫放行已停用终端的本机会话')

  await expectCode(
    '无终端会话仍是 401，不到达配置正文',
    'TERMINAL_SESSION_INVALID',
    () => allowing.canActivate(context('term_ktm_a', undefined, 'term_ktm_a') as never),
  )
  await expectCode(
    'A 机会话不能读 B 机配置',
    'TERMINAL_SESSION_INVALID',
    () => allowing.canActivate(context('term_ktm_a', session.sessionToken, 'term_ktm_b') as never),
  )

  const controller = readFileSync(join(process.cwd(), 'src/terminals/terminals.controller.ts'), 'utf8')
  const start = controller.indexOf("@Get('terminals/:terminalId/config')")
  const end = controller.indexOf("@Post('terminals/:terminalId/toolbox-events')")
  const block = start >= 0 && end > start ? controller.slice(start, end) : ''
  if (!block.includes('@AllowDisabledTerminalIdentity()') || !block.includes('@UseGuards(TerminalIdentityGuard)')) {
    fail('配置路由必须同时挂终端会话守卫和停用可读标记')
  }
  pass('配置路由挂着终端会话守卫和停用可读标记')

  const pickup = readFileSync(join(process.cwd(), 'src/print-jobs/pickup-order.service.ts'), 'utf8')
  if (!pickup.includes('PRINT_TERMINAL_NOT_READY') || !pickup.includes('5 * 60 * 1000')) {
    fail('确认打印的终端就绪拦截被改动了')
  }
  pass('确认打印的 PRINT_TERMINAL_NOT_READY 拦截保持原样')
}

async function main(): Promise<void> {
  assertPureMatrix()
  await assertConfigRoundTrip()
  await assertDisabledSessionCanRead()
  console.log('\n✅ ALL PASS — 一体机配置里的本机维护字段\n')
}

main().catch((error: unknown) => {
  console.error(`\n❌ ${(error as Error).message}\n`)
  process.exit(1)
})
