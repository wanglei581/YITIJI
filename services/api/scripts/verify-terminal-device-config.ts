/**
 * 终端设备档案 + Kiosk 统一配置闭环验证。
 *
 * 覆盖:
 *   1. Terminal schema / 迁移包含 displayName、macAddress、locationLabel、enabled。
 *   2. Admin 可编辑设备档案/MAC/启停,并写 terminal.profile.update 审计。
 *   3. MAC 地址规范化、非法格式拒绝、唯一冲突拒绝。
 *   4. 停用终端仍可 heartbeat,但 claim/status 被 TERMINAL_DISABLED 拦截。
 *   5. 停用终端的 Kiosk config 强制 smartCampus/toolbox 关闭。
 *   6. 百宝箱/智慧校园应用上架按 placement 拆分,外部应用受域名白名单保护。
 *   7. 公开 Kiosk config 只返回 Kiosk 必需白名单字段,不泄露设备档案/机构字段。
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
import { TerminalToolboxService } from '../src/terminals/terminal-toolbox.service'

process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-terminal-action-secret-0123456789'
process.env['KIOSK_EXTERNAL_APP_ALLOWED_HOSTS'] ||= 'trusted.example.com,cdn.example.com'

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
  const toolboxTable = execFileSync('sqlite3', [dbPath, 'PRAGMA table_info("TerminalToolboxConfig");'], { encoding: 'utf8' })
  if (!toolboxTable.includes('|itemsJson|')) {
    const migrationSql = read('prisma/migrations/20260629123000_add_terminal_toolbox_config/migration.sql')
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
    'prisma/schema.prisma',
    ['model TerminalToolboxConfig', 'enabled     Boolean  @default(true)', 'itemsJson   String   @default("[]")'],
    'A2. SQLite schema 包含终端百宝箱配置模型',
  )
  contains(
    'prisma/postgres/schema.prisma',
    ['macAddress        String?  @unique', 'displayName       String?', 'locationLabel     String?', 'enabled           Boolean  @default(true)'],
    'B. PostgreSQL Terminal schema 包含设备档案/MAC/启停字段',
  )
  contains(
    'prisma/postgres/schema.prisma',
    ['model TerminalToolboxConfig', 'enabled     Boolean  @default(true)', 'itemsJson   String   @default("[]")'],
    'B2. PostgreSQL schema 包含终端百宝箱配置模型',
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
    'src/terminals/admin-toolbox.controller.ts',
    ["@Get('admin/toolbox/terminals')", "'toolbox_config.update'"],
    'D2. Admin 百宝箱配置接口和审计存在',
  )
  contains(
    '../../apps/kiosk/src/hooks/useSmartCampusConfig.ts',
    ['getCachedKioskTerminalConfig(terminalId)', 'getSmartCampusConfig(terminalId)'],
    'E. Kiosk 智慧校园优先走统一配置缓存并保留旧接口回退',
  )
  contains(
    '../../apps/kiosk/src/services/api/terminalConfig.ts',
    ['toolbox: { enabled: true, items: [] }', 'getCachedKioskTerminalConfig'],
    'E2. Kiosk 统一配置本地默认启用百宝箱空占位并复用缓存',
  )
  contains(
    '../../apps/kiosk/src/pages/home/HomePage.tsx',
    ['if (!config.enabled) return null', 'getCachedKioskTerminalConfig(terminalId)'],
    'E3. Kiosk 百宝箱仅显式关闭时整块隐藏且复用统一配置缓存',
  )
  notContainsSource(
    read('../../apps/kiosk/src/pages/home/HomePage.tsx'),
    ['items.length === 0) return null'],
    'E3b. Kiosk 百宝箱空配置不得作为整块隐藏条件',
  )
  contains(
    '../../apps/kiosk/src/pages/home/HomePage.tsx',
    ['待配置', '后续功能上线后将在这里展示'],
    'E4. Kiosk 首页保留百宝箱空配置占位文案',
  )
  contains(
    'src/terminals/terminal-toolbox.service.ts',
    [
      'const DEFAULT_TOOLBOX: KioskToolboxConfigView = { enabled: true, items: [] }',
      'ALLOWED_TOOLBOX_ROUTE_PATTERNS',
      'KIOSK_EXTERNAL_APP_ALLOWED_HOSTS',
      'TOOLBOX_EXTERNAL_HOST_NOT_ALLOWED',
      'smartCampusItems',
    ],
    'E5. 后端百宝箱默认启用空占位并限制 Kiosk 站内路径/外部应用白名单',
  )
  contains(
    '../../apps/admin/src/routes/toolbox/index.tsx',
    ['PLACEMENT_OPTIONS', 'LAUNCH_MODE_OPTIONS', '外部 H5', '小程序码'],
    'E6. Admin 应用上架表单支持百宝箱/智慧校园和外部应用启动方式',
  )
  contains(
    'src/smart-campus/smart-campus.module.ts',
    ["import { TerminalsModule } from '../terminals/terminals.module'", 'TerminalsModule'],
    'E7. SmartCampusModule 装配终端应用上架服务依赖',
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
    ['terminal:', 'displayName:', 'locationLabel:', 'macAddress:', 'orgId:', 'orgName:'],
    'G. 公开 Kiosk config service 不返回设备档案/机构字段',
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
    ['KioskTerminalIdentityView', 'terminal:', 'displayName:', 'locationLabel:', 'macAddress:', 'orgId:', 'orgName:'],
    'H. API Kiosk config 类型只保留白名单字段',
  )
  notContainsSource(
    read('../../packages/shared/src/types/device.ts'),
    ['KioskTerminalIdentity', 'terminal:', 'displayName:', 'locationLabel:', 'macAddress:', 'orgId:', 'orgName:'],
    'I. shared KioskTerminalConfig 类型只保留白名单字段',
  )
  notContainsSource(
    read('../../apps/kiosk/src/services/api/terminalConfig.ts'),
    ['terminal:', 'displayName:', 'locationLabel:', 'macAddress:', 'orgId:', 'orgName:'],
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
  const { SmartCampusService } = await import('../src/smart-campus/smart-campus.service')

  console.log('\n=== 终端设备配置 service/controller 级验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const toolbox = new TerminalToolboxService(prisma)
  const smartCampus = new SmartCampusService(prisma, toolbox)
  const terminals = new TerminalsService(prisma, toolbox)
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
    await prisma.terminalToolboxConfig.deleteMany({ where: { terminalId: { in: [codeA, tA, codeB, tB, macKey] } } })
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
    await prisma.terminalToolboxConfig.create({
      data: {
        terminalId: codeA,
        enabled: true,
        itemsJson: JSON.stringify([
          { key: 'verify-print', title: '验证打印', description: '站内路径', icon: 'printer', to: '/print/upload', disabled: false, sortOrder: 0 },
        ]),
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

    const defaultToolbox = await toolbox.getPublicConfig(codeB, { id: tB, terminalCode: codeB, enabled: true })
    if (defaultToolbox.enabled && defaultToolbox.items.length === 0 && defaultToolbox.smartCampusItems.length === 0) {
      pass('0a. 未配置百宝箱的启用终端默认显示首页占位且不下发应用项')
    } else {
      fail(`0a. 未配置百宝箱默认状态异常: ${JSON.stringify(defaultToolbox)}`)
    }
    await toolbox.saveTerminalConfig(codeB, { enabled: false, items: [] }, adminId)
    const disabledToolbox = await toolbox.getPublicConfig(codeB, { id: tB, terminalCode: codeB, enabled: true })
    if (!disabledToolbox.enabled && disabledToolbox.items.length === 0 && disabledToolbox.smartCampusItems.length === 0) {
      pass('0a2. 显式关闭百宝箱时整块隐藏且不下发应用项')
    } else {
      fail(`0a2. 显式关闭百宝箱状态异常: ${JSON.stringify(disabledToolbox)}`)
    }
    await expectCode(
      () => toolbox.saveTerminalConfig(codeB, {
        enabled: true,
        items: [{ key: 'bad-admin', title: '后台路径', description: '', icon: 'wrench', to: '/admin', disabled: false, sortOrder: 0 }],
      }, adminId),
      'INVALID_TOOLBOX_ROUTE',
      '0b. 百宝箱拒绝未知 Kiosk 路径',
    )
    await expectCode(
      () => toolbox.saveTerminalConfig(codeB, {
        enabled: true,
        items: [{ key: 'bad-external', title: '外部链接', description: '', icon: 'wrench', to: 'https://example.com', disabled: false, sortOrder: 0 }],
      }, adminId),
      'INVALID_TOOLBOX_ROUTE',
      '0c. 百宝箱拒绝外部 URL',
    )
    await expectCode(
      () => toolbox.saveTerminalConfig(codeB, {
        enabled: true,
        items: [{
          key: 'bad-host',
          title: '未授权外部应用',
          description: '',
          icon: 'wrench',
          to: null,
          disabled: false,
          sortOrder: 0,
          placements: ['toolbox'],
          launchMode: 'external_url',
          externalUrl: 'https://evil.example.com/app',
          qrImageUrl: null,
        }],
      }, adminId),
      'TOOLBOX_EXTERNAL_HOST_NOT_ALLOWED',
      '0d. 百宝箱拒绝未加入白名单的外部 H5 域名',
    )
    await expectCode(
      () => toolbox.saveTerminalConfig(codeB, {
        enabled: true,
        items: [{
          key: 'bad-route-slash',
          title: '反斜杠路径',
          description: '',
          icon: 'wrench',
          to: '/\\evil.example.com/app',
          disabled: false,
          sortOrder: 0,
          placements: ['toolbox'],
          launchMode: 'internal_route',
          externalUrl: null,
          qrImageUrl: null,
        }],
      }, adminId),
      'INVALID_TOOLBOX_ROUTE',
      '0e. 百宝箱拒绝反斜杠伪装站内路径',
    )
    await expectCode(
      () => toolbox.saveTerminalConfig(codeB, {
        enabled: true,
        items: [{
          key: 'bad-qr-slash',
          title: '反斜杠二维码',
          description: '',
          icon: 'help-circle',
          to: null,
          disabled: false,
          sortOrder: 0,
          placements: ['toolbox'],
          launchMode: 'qr_code',
          externalUrl: null,
          qrImageUrl: '/\\evil.example.com/qr.png',
        }],
      }, adminId),
      'INVALID_TOOLBOX_QR_URL',
      '0f. 百宝箱拒绝反斜杠伪装二维码相对路径',
    )
    const staleFieldToolbox = await toolbox.saveTerminalConfig(codeB, {
      enabled: true,
      items: [{
        key: 'stale-url',
        title: '站内页切换',
        description: '旧 URL 应忽略',
        icon: 'wrench',
        to: '/resume/source',
        disabled: false,
        sortOrder: 0,
        placements: ['toolbox'],
        launchMode: 'internal_route',
        externalUrl: 'https://evil.example.com/stale',
        qrImageUrl: 'https://evil.example.com/stale-qr.png',
      }],
    }, adminId)
    const staleItem = staleFieldToolbox.items.find((item) => item.key === 'stale-url')
    if (staleItem?.to === '/resume/source' && staleItem.externalUrl === null && staleItem.qrImageUrl === null) {
      pass('0g. 非当前启动方式的残留 URL 字段会被清理且不误拒保存')
    } else {
      fail(`0g. 残留 URL 字段清理异常: ${JSON.stringify(staleFieldToolbox)}`)
    }
    const savedToolbox = await toolbox.saveTerminalConfig(codeB, {
      enabled: true,
      items: [
        {
          key: 'resume-optimize',
          title: 'AI简历优化',
          description: '站内深链',
          icon: 'sparkles',
          to: '/resume/source?intent=optimize',
          disabled: false,
          sortOrder: 0,
          placements: ['toolbox'],
          launchMode: 'internal_route',
          externalUrl: null,
          qrImageUrl: null,
        },
        {
          key: 'campus-portal',
          title: '校园服务号',
          description: '白名单 H5',
          icon: 'book-open',
          to: null,
          disabled: false,
          sortOrder: 1,
          placements: ['smart_campus'],
          launchMode: 'external_url',
          externalUrl: 'https://trusted.example.com/campus',
          qrImageUrl: null,
        },
        {
          key: 'mini-program',
          title: '校园小程序',
          description: '扫码进入',
          icon: 'help-circle',
          to: null,
          disabled: false,
          sortOrder: 2,
          placements: ['toolbox', 'smart_campus'],
          launchMode: 'mini_program_qr',
          externalUrl: null,
          qrImageUrl: '/api/v1/assets/mini-program.png',
        },
      ],
    }, adminId)
    if (
      savedToolbox.enabled &&
      savedToolbox.items.find((item) => item.key === 'resume-optimize')?.to === '/resume/source?intent=optimize' &&
      savedToolbox.items.find((item) => item.key === 'campus-portal')?.externalUrl === 'https://trusted.example.com/campus' &&
      savedToolbox.items.find((item) => item.key === 'mini-program')?.qrImageUrl === '/api/v1/assets/mini-program.png'
    ) {
      pass('0h. 百宝箱允许站内深链、白名单外部 H5 和二维码应用配置')
    } else {
      fail(`0h. 百宝箱合法应用配置保存异常: ${JSON.stringify(savedToolbox)}`)
    }
    const originalAllowedHosts = process.env['KIOSK_EXTERNAL_APP_ALLOWED_HOSTS']
    process.env['KIOSK_EXTERNAL_APP_ALLOWED_HOSTS'] = 'cdn.example.com'
    const driftedToolbox = await toolbox.getPublicConfig(codeB, { id: tB, terminalCode: codeB, enabled: true })
    const driftedItem = driftedToolbox.smartCampusItems.find((item) => item.key === 'campus-portal')
    if (driftedItem && driftedItem.externalUrl === null) {
      pass('0i. 读取配置遇到外部域名白名单漂移时降级清理单项 URL,不打挂整份配置')
    } else {
      fail(`0i. 外部域名白名单漂移读取降级异常: ${JSON.stringify(driftedToolbox)}`)
    }
    process.env['KIOSK_EXTERNAL_APP_ALLOWED_HOSTS'] = originalAllowedHosts
    await prisma.terminalSmartCampusConfig.create({
      data: {
        terminalId: codeB,
        enabled: true,
        modulesJson: JSON.stringify({ welcome: false, bigdata: false, luggage: false, panorama: false }),
        updatedBy: adminId,
      },
    })
    const splitConfig = await terminals.getKioskTerminalConfig(codeB)
    if (
      splitConfig.toolbox.items.some((item) => item.key === 'resume-optimize') &&
      splitConfig.toolbox.items.some((item) => item.key === 'mini-program') &&
      !splitConfig.toolbox.items.some((item) => item.key === 'campus-portal') &&
      splitConfig.smartCampus.items.some((item) => item.key === 'campus-portal') &&
      splitConfig.smartCampus.items.some((item) => item.key === 'mini-program')
    ) {
      pass('0j. 统一终端配置按 placement 拆分到百宝箱和智慧校园')
    } else {
      fail(`0j. 应用 placement 拆分异常: ${JSON.stringify(splitConfig)}`)
    }
    const fallbackCampusConfig = await smartCampus.getKioskConfig(codeB)
    if (
      fallbackCampusConfig.enabled &&
      fallbackCampusConfig.items.some((item) => item.key === 'campus-portal') &&
      fallbackCampusConfig.items.some((item) => item.key === 'mini-program')
    ) {
      pass('0k. 智慧校园旧配置端点降级路径也返回后台投放项')
    } else {
      fail(`0k. 智慧校园旧配置端点投放项异常: ${JSON.stringify(fallbackCampusConfig)}`)
    }

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
    await terminals.heartbeat(
      tA,
      { printerStatus: 'ok', macAddress: 'aa-bb-cc-dd-ee-ff', agentVersion: 'verify' },
      `Bearer ${tokenA}`,
    )
    const afterConflictMacHeartbeat = await prisma.terminal.findUnique({ where: { id: tA } })
    if (afterConflictMacHeartbeat?.macAddress === 'A8:5E:45:10:00:01') {
      pass('5c. heartbeat 冲突 MAC 不打挂心跳且不覆盖 Admin 设备档案')
    } else {
      fail(`5c. heartbeat 冲突 MAC 覆盖了档案: ${afterConflictMacHeartbeat?.macAddress ?? 'null'}`)
    }

    await expectCode(
      () => terminals.claimTasks(tA, { maxTasks: 1 }, `Bearer ${tokenA}`),
      'TERMINAL_DISABLED',
      '6. 停用终端 claim 被拦截',
    )
    await expectCode(
      () => terminals.patchTaskStatus(taskId, { status: 'printing' }, `Bearer ${tokenA}`, tA),
      'TERMINAL_DISABLED',
      '6b. 停用终端 status 回传带 terminalId 被拦截',
    )
    await expectCode(
      () => terminals.patchTaskStatus(taskId, { status: 'printing' }, `Bearer ${tokenA}`, undefined),
      'TASK_TERMINAL_MISSING',
      '6c. status 回传缺少 terminalId 时不再允许 token fallback',
    )

    const kioskConfig = await terminals.getKioskTerminalConfig(codeA)
    if (
      !kioskConfig.smartCampus.enabled &&
      kioskConfig.smartCampus.modules.welcome === false &&
      !kioskConfig.toolbox.enabled &&
      kioskConfig.toolbox.items.length === 0
    ) {
      pass('7. 停用终端 Kiosk config 强制 smartCampus/toolbox 关闭')
    } else {
      fail(`7. 停用终端 Kiosk config 未关闭: ${JSON.stringify(kioskConfig)}`)
    }

    const publicBody = JSON.stringify(kioskConfig)
    const forbiddenPublicKeys = [
      '"terminal":',
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
    await prisma.terminalToolboxConfig.create({
      data: {
        terminalId: macKey,
        enabled: true,
        itemsJson: JSON.stringify([
          { key: 'mac-hit', title: '不应命中', description: '', icon: 'wrench', to: '/print/upload', disabled: false, sortOrder: 0 },
        ]),
        updatedBy: adminId,
      },
    })
    const macKeyConfig = await terminals.getKioskTerminalConfig(macKey)
    if (!macKeyConfig.smartCampus.enabled && !macKeyConfig.toolbox.enabled && macKeyConfig.toolbox.items.length === 0) {
      pass('9. 公开 Kiosk config 不接受 MAC 作为终端配置查询键')
    } else {
      fail('9. 公开 Kiosk config 仍可通过 MAC 命中终端配置')
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
