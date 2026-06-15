/**
 * Partner 智慧校园开关联动 MVP — service 层隔离 / 合规 / Kiosk 联动验证。
 *
 * 覆盖（对应任务 5 个验收点 + 学校类型门 + 空模块归零）：
 *   1. partner 只能看到本 org 终端（看不到其它 org 的终端）。
 *   2. partner 不能保存其它 org 终端 → 403 TERMINAL_NOT_IN_ORG。
 *   3. partner 保存 enabled/modules 后，Kiosk 免鉴权读取端点返回对应配置。
 *   4. bigdata 本期冻结：partner 传 bigdata=true 也强制落 false。
 *   5. orgId 为空拒绝 → 403 PARTNER_ORG_REQUIRED（list + save 都拒）。
 *   6. 非学校机构 partner 调智慧校园 → 403 PARTNER_NOT_SCHOOL。
 *   7. enabled=true 但无任何子模块 → 落 enabled=false，Kiosk 读到整张关闭。
 *
 * Admin 终端归属 → partner 可见性联动（本 Sprint 新增）：
 *   8.  未绑定终端 partner 不可见；admin 绑定到 A 校后 partner(A) 可见。
 *   9.  admin 改绑到 B 校后 partner(A) 不可见。
 *   10. admin 解绑（orgId=null）后 partner(A) 不可见。
 *   11. admin 归属错误：终端不存在→TERMINAL_NOT_FOUND、机构不存在→ORG_NOT_FOUND、机构停用→ORG_DISABLED。
 *
 * 高校版模板联动（codex/smart-campus-template-link）：
 *   12. 共享契约：SCENE_DEFAULT_MODULES.school 含 smart_campus、MODULE_LABELS.smart_campus=智慧校园。
 *   13. API enabledModules 白名单放行 smart_campus：admin 保存后能读回（未被 sanitizeModules 剔除）。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:partner-smart-campus
 *
 * 纯 service 层 + 真实 prisma（dev.db）：创建独立 test- 前缀夹具，跑完即清理，
 * 不污染 seed 数据、不依赖 HTTP server、不 reset dev.db。
 */
import 'dotenv/config'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
// 直接从 shared 源码相对路径取契约常量（脚本经 swc-node 运行，api 运行期不解析
// @ai-job-print/shared 别名——其源码仅用 import type；partner.ts 为纯类型+常量，无外部依赖）。
import { SCENE_DEFAULT_MODULES, MODULE_LABELS } from '../../../packages/shared/src/types/partner'
import { PrismaService } from '../src/prisma/prisma.service'
import { SmartCampusService } from '../src/smart-campus/smart-campus.service'
import { TerminalsService } from '../src/terminals/terminals.service'
import { AdminOrgsService } from '../src/orgs/admin-orgs.service'
import { AuditService } from '../src/audit/audit.service'
import { SaveSmartCampusConfigDto } from '../src/smart-campus/dto/save-smart-campus-config.dto'
import type { SaveSmartCampusConfigInput } from '../src/smart-campus/smart-campus.types'

function pass(m: string): void { console.log(`  PASS ${m}`) }
function fail(m: string): never { throw new Error(`FAIL ${m}`) }

/** 从 NestJS HttpException 取结构化错误 code（{ error: { code } }）。 */
function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } }
    | undefined
  return resp?.error?.code
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望抛错 ${code}，但调用通过（未拦截）`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(`${label} → ${code}`)
    else fail(`${label} — 期望 ${code}，实际: ${c ?? (e as Error).message}`)
  }
}

async function validateSmartCampusDto(body: unknown): Promise<string[]> {
  const dto = plainToInstance(SaveSmartCampusConfigDto, body)
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true })
  return errors.map((e) => JSON.stringify(e.constraints ?? e.children?.map((c) => c.constraints ?? {})))
}

const SCHOOL_A = 'test-sc-org-school-a'
const SCHOOL_B = 'test-sc-org-school-b'
const NONSCHOOL = 'test-sc-org-nonschool'
const DISABLED_ORG = 'test-sc-org-disabled'
const T_A = 'TEST-SC-KSK-A'
const T_B = 'TEST-SC-KSK-B'
const T_ADMIN = 'TEST-SC-KSK-ADMIN' // 归属可变终端，admin 归属用例专用

function onlyWelcome(): SaveSmartCampusConfigInput {
  return { enabled: true, modules: { welcome: true, bigdata: false, luggage: false, panorama: false } }
}

const ADMIN_USER_ID = 'test-sc-admin'

async function cleanup(prisma: PrismaService): Promise<void> {
  await prisma.terminalSmartCampusConfig.deleteMany({ where: { terminalId: { in: [T_A, T_B, T_ADMIN] } } })
  await prisma.terminal.deleteMany({ where: { id: { in: [T_A, T_B, T_ADMIN] } } })
  await prisma.auditLog.deleteMany({ where: { actorId: ADMIN_USER_ID } })
  await prisma.user.deleteMany({ where: { id: ADMIN_USER_ID } })
  await prisma.organization.deleteMany({ where: { id: { in: [SCHOOL_A, SCHOOL_B, NONSCHOOL, DISABLED_ORG] } } })
}

async function main(): Promise<void> {
  console.log('\n=== Partner 智慧校园开关联动 MVP 验证 ===')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const svc = new SmartCampusService(prisma)
  const terminals = new TerminalsService(prisma) // 仅用 assignTerminalOrg，不调 onModuleInit（避免播种打印任务）
  const adminOrgs = new AdminOrgsService(prisma, new AuditService(prisma)) // 高校版模板联动：smart_campus 白名单保存验证

  let ok = true
  try {
    await cleanup(prisma) // 预清理：上次异常退出的残留夹具

    // 夹具：两所学校 + 一个非学校机构 + 一个停用机构；A、B 各一台终端，另加一台归属可变终端。
    await prisma.organization.create({ data: { id: SCHOOL_A, name: '测试学校A就业中心', type: 'school_employment_center' } })
    await prisma.organization.create({ data: { id: SCHOOL_B, name: '测试学校B就业中心', type: 'school_employment_center' } })
    await prisma.organization.create({ data: { id: NONSCHOOL, name: '测试市人才中心', type: 'public_employment_service' } })
    await prisma.organization.create({ data: { id: DISABLED_ORG, name: '测试停用机构', type: 'school_employment_center', enabled: false } })
    await prisma.terminal.create({ data: { id: T_A, terminalCode: T_A, agentToken: 'test-sc-token-a', deviceFingerprint: 'test-sc-fp-a', orgId: SCHOOL_A } })
    await prisma.terminal.create({ data: { id: T_B, terminalCode: T_B, agentToken: 'test-sc-token-b', deviceFingerprint: 'test-sc-fp-b', orgId: SCHOOL_B } })
    await prisma.terminal.create({ data: { id: T_ADMIN, terminalCode: T_ADMIN, agentToken: 'test-sc-token-admin', deviceFingerprint: 'test-sc-fp-admin', orgId: null } })
    // 平台管理员夹具：仅用于 Case13 admin 写操作的审计 actor 外键（跑完清理）。
    await prisma.user.create({ data: { id: ADMIN_USER_ID, username: 'test-sc-admin', passwordHash: 'x', name: '验证用管理员', role: 'admin' } })

    const userA = { userId: 'test-sc-user-a', orgId: SCHOOL_A }
    const seesAdminTerminal = async (): Promise<boolean> =>
      (await svc.listPartnerSmartCampusTerminals(SCHOOL_A)).some((t) => t.terminalCode === T_ADMIN)

    // Case 1: partner 只能看到本 org 终端
    const listA = await svc.listPartnerSmartCampusTerminals(SCHOOL_A)
    const codesA = listA.map((t) => t.terminalCode)
    if (codesA.includes(T_A) && !codesA.includes(T_B)) pass(`Case1 本 org 列表含 ${T_A}、不含 ${T_B}`)
    else fail(`Case1 列表隔离错误：${JSON.stringify(codesA)}`)
    if (listA.length > 0 && listA.every((t) => t.orgId === SCHOOL_A)) pass('Case1 列表全部 orgId=本校')
    else fail('Case1 列表混入了其它机构终端或为空')

    // Case 5: orgId 为空拒绝（list + save）
    await expectCode(() => svc.listPartnerSmartCampusTerminals(null), 'PARTNER_ORG_REQUIRED', 'Case5 list orgId 空')
    await expectCode(() => svc.savePartnerTerminalConfig(T_A, onlyWelcome(), { userId: 'x', orgId: null }), 'PARTNER_ORG_REQUIRED', 'Case5 save orgId 空')

    // Case 6: 非学校机构拒绝
    await expectCode(() => svc.listPartnerSmartCampusTerminals(NONSCHOOL), 'PARTNER_NOT_SCHOOL', 'Case6 非学校 list')
    await expectCode(() => svc.savePartnerTerminalConfig(T_A, onlyWelcome(), { userId: 'x', orgId: NONSCHOOL }), 'PARTNER_NOT_SCHOOL', 'Case6 非学校 save')

    // Case 2: 不能保存其它 org 终端
    await expectCode(() => svc.savePartnerTerminalConfig(T_B, onlyWelcome(), userA), 'TERMINAL_NOT_IN_ORG', 'Case2 跨机构 save')

    // Case 4: bigdata 强制 false
    const savedBig = await svc.savePartnerTerminalConfig(
      T_A,
      { enabled: true, modules: { welcome: true, bigdata: true, luggage: false, panorama: false } },
      userA,
    )
    if (savedBig.modules.bigdata === false) pass('Case4 bigdata 被强制落 false')
    else fail('Case4 bigdata 未冻结')

    // Case 3: 保存后 Kiosk 免鉴权端点返回对应配置
    await svc.savePartnerTerminalConfig(
      T_A,
      { enabled: true, modules: { welcome: true, bigdata: false, luggage: true, panorama: false } },
      userA,
    )
    const kiosk = await svc.getKioskConfig(T_A)
    if (kiosk.enabled && kiosk.modules.welcome && kiosk.modules.luggage && !kiosk.modules.panorama && !kiosk.modules.bigdata) {
      pass('Case3 Kiosk 读到 welcome+luggage 开、panorama/bigdata 关')
    } else {
      fail(`Case3 Kiosk 配置不符: ${JSON.stringify(kiosk)}`)
    }

    // Case 7: enabled=true 但无任何子模块 → enabled 落 false，Kiosk 整张关闭
    const savedNone = await svc.savePartnerTerminalConfig(
      T_A,
      { enabled: true, modules: { welcome: false, bigdata: false, luggage: false, panorama: false } },
      userA,
    )
    if (savedNone.enabled === false) pass('Case7 无子模块时 enabled 归零')
    else fail('Case7 空模块仍 enabled=true')
    const kioskOff = await svc.getKioskConfig(T_A)
    if (!kioskOff.enabled) pass('Case7 Kiosk 读到整张关闭')
    else fail('Case7 Kiosk 仍 enabled')

    // ── Admin 终端归属 → partner 可见性联动 ────────────────────────────────────
    // Case 8: 未绑定不可见；绑定到 A 校后 partner(A) 可见
    if (!(await seesAdminTerminal())) pass('Case8 未绑定终端 partner(A) 不可见')
    else fail('Case8 未绑定终端却对 partner(A) 可见')
    const bindA = await terminals.assignTerminalOrg(T_ADMIN, SCHOOL_A)
    if (bindA.oldOrgId === null && bindA.newOrgId === SCHOOL_A) pass('Case8 admin 绑定返回 old=null new=A')
    else fail(`Case8 绑定返回异常: ${JSON.stringify(bindA)}`)
    if (await seesAdminTerminal()) pass('Case8 绑定到 A 校后 partner(A) 可见')
    else fail('Case8 绑定到 A 校后 partner(A) 仍不可见')

    // Case 9: 改绑到 B 校后 partner(A) 不可见
    const bindB = await terminals.assignTerminalOrg(T_ADMIN, SCHOOL_B)
    if (bindB.oldOrgId === SCHOOL_A && bindB.newOrgId === SCHOOL_B) pass('Case9 admin 改绑返回 old=A new=B')
    else fail(`Case9 改绑返回异常: ${JSON.stringify(bindB)}`)
    if (!(await seesAdminTerminal())) pass('Case9 改绑到 B 校后 partner(A) 不可见')
    else fail('Case9 改绑到 B 校后 partner(A) 仍可见')

    // Case 10: 解绑后 partner(A) 不可见
    const unbind = await terminals.assignTerminalOrg(T_ADMIN, null)
    if (unbind.oldOrgId === SCHOOL_B && unbind.newOrgId === null) pass('Case10 admin 解绑返回 old=B new=null')
    else fail(`Case10 解绑返回异常: ${JSON.stringify(unbind)}`)
    if (!(await seesAdminTerminal())) pass('Case10 解绑后 partner(A) 不可见')
    else fail('Case10 解绑后 partner(A) 仍可见')

    // Case 11: admin 归属错误分支
    await expectCode(() => terminals.assignTerminalOrg('TEST-SC-KSK-NOPE', SCHOOL_A), 'TERMINAL_NOT_FOUND', 'Case11 终端不存在')
    await expectCode(() => terminals.assignTerminalOrg(T_ADMIN, 'test-sc-org-nope'), 'ORG_NOT_FOUND', 'Case11 机构不存在')
    await expectCode(() => terminals.assignTerminalOrg(T_ADMIN, DISABLED_ORG), 'ORG_DISABLED', 'Case11 机构已停用')

    // ── 高校版模板联动（codex/smart-campus-template-link）─────────────────────
    // Case 12: 共享契约——学校场景默认含 smart_campus、且有中文标签「智慧校园」。
    if (SCENE_DEFAULT_MODULES.school.includes('smart_campus')) pass('Case12 SCENE_DEFAULT_MODULES.school 含 smart_campus')
    else fail(`Case12 学校默认模板缺 smart_campus: ${JSON.stringify(SCENE_DEFAULT_MODULES.school)}`)
    if (MODULE_LABELS.smart_campus === '智慧校园') pass('Case12 MODULE_LABELS.smart_campus = 智慧校园')
    else fail(`Case12 MODULE_LABELS.smart_campus 异常: ${MODULE_LABELS.smart_campus}`)

    // Case 13: API enabledModules 白名单允许保存 smart_campus（学校机构写入后能读回，未被白名单剔除）。
    const adminUser = { userId: ADMIN_USER_ID, role: 'admin' as const, orgId: null }
    await adminOrgs.updateOrg(SCHOOL_A, { enabledModules: ['resume_service', 'smart_campus'] }, adminUser)
    const detailA = await adminOrgs.getOrgDetail(SCHOOL_A)
    if (detailA.enabledModules.includes('smart_campus')) pass('Case13 admin 保存 smart_campus 模块成功（白名单放行、读回保留）')
    else fail(`Case13 smart_campus 未被保存: ${JSON.stringify(detailA.enabledModules)}`)

    // Case 14: DTO 边界——模块字段允许缺失（按 false 处理），但传入时必须是 boolean；未知字段直接拒绝。
    const validDtoErrors = await validateSmartCampusDto({ enabled: true, modules: { welcome: true } })
    if (validDtoErrors.length === 0) pass('Case14 DTO 允许 partial boolean modules（缺失字段由 service 视为 false）')
    else fail(`Case14 合法 DTO 被拒绝: ${validDtoErrors.join('; ')}`)
    const stringBoolErrors = await validateSmartCampusDto({ enabled: true, modules: { welcome: 'false' } })
    if (stringBoolErrors.length > 0) pass('Case14 DTO 拒绝字符串布尔值，避免 "false" 被 !! 强转为 true')
    else fail('Case14 DTO 未拒绝 modules.welcome="false"')
    const extraKeyErrors = await validateSmartCampusDto({ enabled: true, modules: { welcome: true, studentCount: 42 } })
    if (extraKeyErrors.length > 0) pass('Case14 DTO 拒绝未知 modules 字段（forbidNonWhitelisted）')
    else fail('Case14 DTO 未拒绝未知 modules.studentCount')

    console.log('\n✅ ALL PASS — 智慧校园闭环（Partner 开关 + Admin 终端归属 + 高校版模板联动）验证通过\n')
  } catch (e) {
    ok = false
    console.error(`\n❌ ${(e as Error).message}\n`)
  } finally {
    await cleanup(prisma)
    await prisma.onModuleDestroy()
  }
  process.exit(ok ? 0 : 1)
}

void main()
