/**
 * 终端设备档案 + Kiosk 统一配置闭环验证。
 *
 * 覆盖:
 *   1. Terminal schema / 迁移包含 displayName、macAddress、locationLabel、enabled。
 *   2. Admin 可编辑设备档案/MAC/启停,并写 terminal.profile.update 审计。
 *   3. MAC 地址规范化、非法格式拒绝、唯一冲突拒绝。
 *   4. 停用终端仍可 heartbeat,但 claim 被 TERMINAL_DISABLED 拦截。
 *   5. 停用终端的 Kiosk config 强制 smartCampus.enabled=false。
 *   6. 公开 Kiosk config 只返回 Kiosk 必需白名单字段,不泄露设备档案/机构字段。
 *
 * 运行: pnpm --filter @ai-job-print/api verify:terminal-device-config
 */
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'

process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-terminal-action-secret-0123456789'

let staticFailures = 0

function pass(msg: string): void { console.log(`  PASS ${msg}`) }
function fail(msg: string): never { throw new Error(`FAIL ${msg}`) }
function staticPass(msg: string): void { pass(msg) }
function staticFail(msg: string): void { console.error(`  FAIL ${msg}`); staticFailures++ }

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
}

function contains(rel: string, markers: string[], label: string): void {
  const src = read(rel)
  const missing = markers.filter((m) => !src.includes(m))
  if (missing.length) staticFail(`${label} 缺少: ${missing.join(' | ')}`)
  else staticPass(label)
}

function notContainsSource(src: string, markers: string[], label: string): void {
  const found = markers.filter((m) => src.includes(m))
  if (found.length) staticFail(`${label} 不应包含: ${found.join(' | ')}`)
  else staticPass(label)
}

function section(rel: string, start: string, end: string): string {
  const src = read(rel)
  const a = src.indexOf(start)
  const b = src.indexOf(end, a + start.length)
  if (a < 0 || b < 0) {
    staticFail(`无法定位 ${rel} 区块: ${start} → ${end}`)
    return ''
  }
  return src.slice(a, b)
}

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } }
    | undefined
  return resp?.error?.code
}

function prepareTempDatabase(): { previousUrl: string | undefined; dbPath: string } {
  const source = join(process.cwd(), 'prisma/dev.db')
  const dir = join(tmpdir(), `terminal-device-config-${randomBytes(4).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, 'verify.db')
  copyFileSync(source, dbPath)

  const tableInfo = execFileSync('sqlite3', [dbPath, 'PRAGMA table_info("Terminal");'], { encoding: 'utf8' })
  if (!tableInfo.includes('|enabled|')) {
    const migrationSql = read('prisma/migrations/20260629120000_add_terminal_device_profile/migration.sql')
    execFileSync('sqlite3', [dbPath], { input: migrationSql, encoding: 'utf8' })
  }

  const previousUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = `file:${dbPath}`
  return { previousUrl, dbPath }
}

function cleanupTempDatabase(prepared: { previousUrl: string | undefined; dbPath: string }): void {
  if (prepared.previousUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = prepared.previousUrl
  rmSync(join(prepared.dbPath, '..'), { recursive: true, force: true })
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望抛 ${code},但未抛`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(`${label} → ${code}`)
    else fail(`${label} — 期望 ${code},实际: ${c ?? (e as Error).message}`)
  }
}

function runStaticChecks(): void {
  console.log('\n=== 终端设备配置底座静态边界验证 ===')

  contains(
    'prisma/schema.prisma',
    ['macAddress        String?  @unique', 'displayName       String?', 'locationLabel     String?', 'enabled           Boolean  @default(true)'],
    'A. SQLite Terminal schema 包含设备档案/MAC/启停字段',
  )
  contains(
    'prisma/postgres/schema.prisma',
    ['macAddress        String?  @unique', 'displayName       String?', 'locationLabel     String?', 'enabled           Boolean  @default(true)'],
    'B. PostgreSQL Terminal schema 包含设备档案/MAC/启停字段',
  )
  contains(
    'src/terminals/admin-terminals.controller.ts',
    ["@Patch(':terminalId/profile')", "'terminal.profile.update'"],
    'C. Admin 设备档案编辑接口和审计存在',
  )
  contains(
    'src/terminals/terminals.controller.ts',
    ["@Get('terminals/:terminalId/config')", 'getKioskTerminalConfig(terminalId)'],
    'D. Kiosk 统一终端配置端点存在',
  )
  contains(
    '../../apps/kiosk/src/hooks/useSmartCampusConfig.ts',
    ['getKioskTerminalConfig(terminalId)', 'getSmartCampusConfig(terminalId)'],
    'E. Kiosk 智慧校园优先走统一配置并保留旧接口回退',
  )
  contains(
    '../../apps/admin/src/routes/terminals/index.tsx',
    ['updateTerminalProfile', 'MAC 地址', '启用终端'],
    'F. Admin 终端页支持设备档案/MAC/启停编辑',
  )

  const publicConfigService = section(
    'src/terminals/terminals.service.ts',
    'async getKioskTerminalConfig',
    '/**\n   * Admin 打印机页真实数据源。',
  )
  notContainsSource(
    publicConfigService,
    ['terminal:', 'toolbox:', 'displayName:', 'locationLabel:', 'macAddress:', 'orgId:', 'orgName:'],
    'G. 公开 Kiosk config service 不返回设备档案/机构/预留工具箱字段',
  )
  const publicConfigLookup = section(
    'src/terminals/terminals.service.ts',
    'private async findSmartCampusConfigByTerminalRef',
    'private async resetExpiredClaims',
  )
  notContainsSource(
    publicConfigLookup,
    ['macAddress'],
    'G2. 公开 Kiosk config 查找链路不把 MAC 作为查询键',
  )
  notContainsSource(
    read('src/terminals/terminal-config.types.ts'),
    ['KioskTerminalIdentityView', 'terminal:', 'toolbox:', 'displayName:', 'locationLabel:', 'macAddress:', 'orgId:', 'orgName:'],
    'H. API Kiosk config 类型只保留白名单字段',
  )
  notContainsSource(
    read('../../packages/shared/src/types/device.ts'),
    ['KioskTerminalIdentity', 'KioskToolboxConfig', 'terminal:', 'toolbox:', 'displayName:', 'locationLabel:', 'macAddress:', 'orgId:', 'orgName:'],
    'I. shared KioskTerminalConfig 类型只保留白名单字段',
  )
  notContainsSource(
    read('../../apps/kiosk/src/services/api/terminalConfig.ts'),
    ['terminal:', 'toolbox:', 'displayName:', 'locationLabel:', 'macAddress:', 'orgId:', 'orgName:'],
    'J. Kiosk 本地 OFF_CONFIG 不声明公开配置外字段',
  )
  contains(
    'src/terminals/terminals.service.ts',
    ['allowDisabled: true', 'TERMINAL_DISABLED', 'tryNormalizeMacAddress(dto.macAddress)'],
    'K. 停用终端禁止任务操作,心跳仍可上报且坏 MAC 不打挂心跳',
  )
  const updateProfileLookup = section(
    'src/terminals/terminals.service.ts',
    'async updateTerminalProfile',
    'async getKioskTerminalConfig',
  )
  notContainsSource(
    updateProfileLookup,
    ['?? undefined'],
    'L. Admin 终端档案查找不把 undefined 塞进 Prisma OR',
  )

  if (staticFailures > 0) {
    throw new Error(`静态边界验证失败 ${staticFailures} 项`)
  }
}

async function runServiceChecks(): Promise<void> {
  const { TerminalsService } = await import('../src/terminals/terminals.service')
  const { AdminTerminalsController } = await import('../src/terminals/admin-terminals.controller')

  console.log('\n=== 终端设备配置 service/controller 级验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const terminals = new TerminalsService(prisma)
  const adminController = new AdminTerminalsController(terminals, audit)

  const suffix = randomBytes(6).toString('hex')
  const adminId = `usr_vtd_${suffix}`
  const tA = `term_vtd_${suffix}_a`
  const tB = `term_vtd_${suffix}_b`
  const codeA = `VTD-${suffix}-A`
  const codeB = `VTD-${suffix}-B`
  const tokenA = `vtd-token-a-${suffix}`
  const taskId = `ptask_vtd_${suffix}`
  const macKey = 'A8:5E:45:10:00:01'

  async function cleanup(): Promise<void> {
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId } })
    await prisma.printTask.deleteMany({ where: { id: taskId } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { in: [tA, tB] } } })
    await prisma.terminalSmartCampusConfig.deleteMany({ where: { terminalId: { in: [codeA, tA, codeB, tB, macKey] } } })
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } })
    await prisma.terminal.deleteMany({ where: { id: { in: [tA, tB] } } })
    await prisma.user.deleteMany({ where: { id: adminId } })
  }

  try {
    await cleanup()
    await prisma.user.create({
      data: {
        id: adminId,
        username: `vtd_${suffix}`,
        passwordHash: 'x',
        name: '终端设备验证管理员',
        role: 'admin',
      },
    })
    await prisma.terminal.create({
      data: { id: tA, terminalCode: codeA, agentToken: tokenA, deviceFingerprint: `fp-a-${suffix}` },
    })
    await prisma.terminal.create({
      data: {
        id: tB,
        terminalCode: codeB,
        agentToken: `vtd-token-b-${suffix}`,
        deviceFingerprint: `fp-b-${suffix}`,
        macAddress: 'AA:BB:CC:DD:EE:FF',
      },
    })
    await prisma.terminalSmartCampusConfig.create({
      data: {
        terminalId: codeA,
        enabled: true,
        modulesJson: JSON.stringify({ welcome: true, bigdata: true, luggage: true, panorama: false }),
        updatedBy: adminId,
      },
    })
    await prisma.printTask.create({
      data: {
        id: taskId,
        fileUrl: '/api/v1/test/sample-visible.pdf',
        fileMd5: 'sha256-vtd',
        status: 'pending',
        paramsJson: '{}',
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    })
    pass('夹具已创建')

    const user = { userId: adminId, role: 'admin' as const, orgId: null }
    const req = { headers: { 'user-agent': 'verify-terminal-device-config' }, ip: '127.0.0.1', requestId: `req-${suffix}` }
    const updated = await adminController.updateProfile(
      codeA,
      {
        displayName: '一号打印服务终端',
        macAddress: 'a85e45100001',
        locationLabel: '就业中心一楼',
        enabled: false,
      },
      user,
      req,
    )
    if (
      updated.data.terminalCode === codeA &&
      updated.data.displayName === '一号打印服务终端' &&
      updated.data.macAddress === 'A8:5E:45:10:00:01' &&
      updated.data.locationLabel === '就业中心一楼' &&
      updated.data.enabled === false
    ) {
      pass('1. Admin profile 编辑落库并规范化 MAC')
    } else {
      fail(`1. Admin profile 返回异常: ${JSON.stringify(updated.data)}`)
    }

    const auditRow = await prisma.auditLog.findFirst({
      where: { actorId: adminId, action: 'terminal.profile.update', targetType: 'terminal', targetId: codeA },
    })
    if (auditRow && JSON.parse(auditRow.payloadJson).macAddress === 'A8:5E:45:10:00:01') {
      pass('2. terminal.profile.update 审计落库')
    } else {
      fail('2. terminal.profile.update 审计未落库或 payload 异常')
    }

    await expectCode(
      () => terminals.updateTerminalProfile(codeA, { macAddress: 'bad-mac' }),
      'INVALID_MAC_ADDRESS',
      '3. 非法 MAC 地址拒绝',
    )
    await expectCode(
      () => terminals.updateTerminalProfile(`VTD-${suffix}-MISSING`, { displayName: '不应写入任何终端' }),
      'TERMINAL_NOT_FOUND',
      '3b. 未知终端引用不会因空 OR 分支误更新其它终端',
    )
    await expectCode(
      () => terminals.updateTerminalProfile(codeA, { macAddress: 'aa-bb-cc-dd-ee-ff' }),
      'MAC_ALREADY_BOUND',
      '4. MAC 唯一冲突拒绝',
    )

    await terminals.heartbeat(
      tA,
      { printerStatus: 'ok', macAddress: 'bad-mac', agentVersion: 'verify' },
      `Bearer ${tokenA}`,
    )
    const afterHeartbeat = await prisma.terminal.findUnique({ where: { id: tA } })
    if (afterHeartbeat?.macAddress === 'A8:5E:45:10:00:01') {
      pass('5. 停用终端 heartbeat 仍可上报,坏 MAC 不覆盖原档案')
    } else {
      fail(`5. heartbeat 后 MAC 异常: ${afterHeartbeat?.macAddress ?? 'null'}`)
    }
    await terminals.heartbeat(
      tA,
      { printerStatus: 'ok', macAddress: '   ', agentVersion: 'verify' },
      `Bearer ${tokenA}`,
    )
    const afterBlankMacHeartbeat = await prisma.terminal.findUnique({ where: { id: tA } })
    if (afterBlankMacHeartbeat?.macAddress === 'A8:5E:45:10:00:01') {
      pass('5b. heartbeat 空白 MAC 不清空 Admin 设备档案')
    } else {
      fail(`5b. heartbeat 空白 MAC 清空或覆盖了档案: ${afterBlankMacHeartbeat?.macAddress ?? 'null'}`)
    }

    await expectCode(
      () => terminals.claimTasks(tA, { maxTasks: 1 }, `Bearer ${tokenA}`),
      'TERMINAL_DISABLED',
      '6. 停用终端 claim 被拦截',
    )

    const kioskConfig = await terminals.getKioskTerminalConfig(codeA)
    if (!kioskConfig.smartCampus.enabled && kioskConfig.smartCampus.modules.welcome === false) {
      pass('7. 停用终端 Kiosk config 强制 smartCampus 关闭')
    } else {
      fail(`7. 停用终端 Kiosk config 未关闭: ${JSON.stringify(kioskConfig.smartCampus)}`)
    }

    const publicBody = JSON.stringify(kioskConfig)
    const forbiddenPublicKeys = [
      '"terminal":',
      '"toolbox":',
      '"displayName":',
      '"locationLabel":',
      '"macAddress":',
      '"orgId":',
      '"orgName":',
    ]
    const leaked = forbiddenPublicKeys.filter((key) => publicBody.includes(key))
    if (leaked.length === 0) {
      pass('8. 公开 Kiosk config 未泄露设备档案/机构字段')
    } else {
      fail(`8. 公开 Kiosk config 泄露字段: ${leaked.join(', ')}`)
    }

    await prisma.terminalSmartCampusConfig.create({
      data: {
        terminalId: macKey,
        enabled: true,
        modulesJson: JSON.stringify({ welcome: true, bigdata: false, luggage: false, panorama: false }),
        updatedBy: adminId,
      },
    })
    const macKeyConfig = await terminals.getKioskTerminalConfig(macKey)
    if (!macKeyConfig.smartCampus.enabled) {
      pass('9. 公开 Kiosk config 不接受 MAC 作为终端配置查询键')
    } else {
      fail('9. 公开 Kiosk config 仍可通过 MAC 命中智慧校园配置')
    }
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }
}

async function main(): Promise<void> {
  runStaticChecks()
  const prepared = prepareTempDatabase()
  try {
    await runServiceChecks()
  } finally {
    cleanupTempDatabase(prepared)
  }
  console.log('\n✅ ALL PASS — 终端设备档案 + Kiosk 统一配置闭环验证通过\n')
}

main().catch((error: unknown) => {
  console.error(`\n❌ ${(error as Error).message}\n`)
  if ((error as Error).stack) console.error((error as Error).stack)
  process.exit(1)
})
