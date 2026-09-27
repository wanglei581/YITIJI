/** 3.14 official channels: domain, tenant, terminal, hold, audit, and old plan regression. */
import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { validateSync } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { Reflector } from '@nestjs/core'
import type { ExecutionContext } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { OfficialChannelsService } from '../src/official-channels/official-channels.service'
import { OfficialChannelsController } from '../src/official-channels/official-channels.controller'
import { CreateOfficialChannelDto, ReplaceVerifiedDomainsDto, UpdateOfficialChannelDto } from '../src/official-channels/dto/official-channel.dto'
import { RecruitmentEmergencyService } from '../src/recruitment-hosting/recruitment-emergency.service'
import { RecruitmentContentReadService } from '../src/recruitment-content/recruitment-content-read.service'
import { EmergencyTakedownDto } from '../src/recruitment-hosting/recruitment-emergency.controller'
import { RecruitmentEmergencyController } from '../src/recruitment-hosting/recruitment-emergency.controller'
import { TerminalIdentityGuard } from '../src/terminals/terminal-identity.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { verifiedDomainFromInput, verifiedHttpsUrl, hostMatchesVerifiedDomain } from '../src/official-channels/registrable-domain'
import { redactCareerPlanSystemJobTitle } from '../src/ai/resume/career-plan.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

let checks = 0
function ok(value: unknown, label: string): asserts value {
  if (!value) throw new Error(`FAIL ${label}`)
  checks++
  console.log(`  PASS ${label}`)
}
function code(error: unknown): string | undefined {
  return (error as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()?.error?.code
}
async function rejects(fn: () => Promise<unknown>, expected: string, label: string) {
  try { await fn() } catch (error) {
    ok(code(error) === expected, `${label} (${expected})`)
    return
  }
  throw new Error(`FAIL ${label}: did not reject`)
}
async function rollsBack(fn: () => Promise<unknown>, label: string) {
  let rejected = false
  try { await fn() } catch { rejected = true }
  ok(rejected, label)
}
function invalidDto<T extends object>(ctor: new () => T, value: object, label: string) {
  ok(validateSync(plainToInstance(ctor, value)).length > 0, label)
}

async function main() {
  assertIsolatedVerificationDatabase()
  const suffix = randomBytes(5).toString('hex')
  const ids = { a: `oc_a_${suffix}`, b: `oc_b_${suffix}`, admin: `oc_admin_${suffix}` }
  const actor: AuthedUser = { userId: ids.admin, role: 'admin', orgId: null }
  const partnerA: AuthedUser = { userId: `oc_pa_${suffix}`, role: 'partner', orgId: ids.a }
  const partnerB: AuthedUser = { userId: `oc_pb_${suffix}`, role: 'partner', orgId: ids.b }
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const service = new OfficialChannelsService(prisma, audit)
  const emergency = new RecruitmentEmergencyService(prisma, audit)
  const terminalA = `oc_ta_${suffix}`
  const terminalB = `oc_tb_${suffix}`
  const terminalEmpty = `oc_te_${suffix}`
  try {
    // Registered root, URL host, redirect parameter, public suffix and shared hosting matrix.
    ok(verifiedDomainFromInput(' 学校.中国. ') === 'xn--48s290a.xn--fiqs8s', 'Unicode domain is punycoded and trailing dot removed')
    ok(verifiedDomainFromInput('HTTPS://JOBS.EXAMPLE.COM.CN:443/path') === 'example.com.cn', 'registration URL resolves to canonical root')
    for (const domain of ['com.cn', 'gov.cn', 'edu.cn', 'org.cn', 'net.cn', 'ac.cn', 'sd.gov.cn', 'github.io', 'gitee.io', 'pages.dev', 'vercel.app', 'netlify.app', 'workers.dev', 'herokuapp.com', 'azurewebsites.net', 'blogspot.com', 'firebaseapp.com', 'web.app', 'cloudfront.net', 'myqcloud.com', 'aliyuncs.com', 'alice.github.io']) {
      ok(verifiedDomainFromInput(domain) === null, `forbid public/shared root ${domain}`)
    }
    ok(verifiedDomainFromInput('qingdao.sd.gov.cn') === 'qingdao.sd.gov.cn', 'provincial gov.cn suffix needs another label')
    const allowed = ['example.com.cn']
    for (const url of [
      'http://example.com.cn', 'https://user@example.com.cn', 'https://user:pass@example.com.cn',
      'https://example.com.cn:444/', 'https://127.0.0.1/', 'https://[::1]/',
      'https://evil-example.com.cn/', 'https://example.com.cn.attacker.cn/',
      'https://example.com.cn/?next=https%3A%2F%2Fevil.com%2Fx',
      'https://example.com.cn/?next=%2F%2Fevil.com%2Fx',
      'https://example.com.cn/?next=http%3A%2F%2Fevil.com%2Fx',
    ]) ok(verifiedHttpsUrl(url, allowed) === null, `reject unsafe URL ${url}`)
    ok(verifiedHttpsUrl(' HTTPS://JOBS.EXAMPLE.COM.CN.:443/path?next=https%3A%2F%2Fjobs.example.com.cn%2Fx ', allowed)?.toString().startsWith('https://jobs.example.com.cn/path?'), 'save canonical HTTPS URL and same-domain redirect')
    ok(hostMatchesVerifiedDomain('jobs.example.com.cn', 'example.com.cn'), 'verified child domain allowed')

    invalidDto(ReplaceVerifiedDomainsDto, { domains: Array(11).fill('example.com') }, 'domain registration capped at ten')
    invalidDto(ReplaceVerifiedDomainsDto, { domains: ['  '] }, 'empty domain rejected after trim')
    invalidDto(CreateOfficialChannelDto, { name: '  ', url: ' https://example.com.cn ' }, 'empty channel name rejected after trim')
    invalidDto(UpdateOfficialChannelDto, { name: '  ' }, 'empty update name rejected after trim')
    invalidDto(UpdateOfficialChannelDto, { url: ' ' }, 'empty update URL rejected after trim')
    invalidDto(CreateOfficialChannelDto, { name: 'x', url: 'https://example.com.cn', displayOrder: 1000 }, 'sort maximum 999')
    invalidDto(UpdateOfficialChannelDto, { displayOrder: 1.5 }, 'sort must be integer')
    invalidDto(UpdateOfficialChannelDto, { enabled: 'true' }, 'enabled must be boolean')

    const controller = new OfficialChannelsController(service)
    const roles = new RolesGuard(new Reflector())
    const roleContext = (handler: Function, user: AuthedUser): ExecutionContext => ({
      getHandler: () => handler, getClass: () => OfficialChannelsController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext
    await rejects(async () => roles.canActivate(roleContext(controller.replaceDomains, partnerA)), 'AUTH_ROLE_FORBIDDEN', 'partner cannot register domains')
    ok(roles.canActivate(roleContext(controller.replaceDomains, actor)), 'admin can register domains')
    invalidDto(EmergencyTakedownDto, { targetType: 'official_channel', targetId: 'x', reasonText: 'x' }, 'takedown reason code required')
    const emergencyRoles = new RolesGuard(new Reflector())
    await rejects(async () => emergencyRoles.canActivate({ ...roleContext(controller.replaceDomains, partnerA), getHandler: () => RecruitmentEmergencyController.prototype.takedown, getClass: () => RecruitmentEmergencyController } as ExecutionContext), 'AUTH_ROLE_FORBIDDEN', 'partner cannot emergency takedown')

    await prisma.organization.createMany({ data: [
      { id: ids.a, name: '机构 A', type: 'public' }, { id: ids.b, name: '机构 B', type: 'public' },
    ] })
    await prisma.user.createMany({ data: [
      { id: actor.userId, username: actor.userId, passwordHash: 'x', name: 'Admin', role: 'admin' },
      { id: partnerA.userId, username: partnerA.userId, passwordHash: 'x', name: 'Partner A', role: 'partner', orgId: ids.a },
      { id: partnerB.userId, username: partnerB.userId, passwordHash: 'x', name: 'Partner B', role: 'partner', orgId: ids.b },
    ] })
    await rejects(() => service.replaceVerifiedDomains(ids.a, ['github.io'], actor), 'VERIFIED_DOMAIN_INVALID', 'illegal registration rejected')
    const failedAudit = { writeRequired: async () => { throw new Error('injected audit failure') } } as unknown as AuditService
    const failService = new OfficialChannelsService(prisma, failedAudit)
    await rollsBack(() => failService.replaceVerifiedDomains(ids.a, ['example.com.cn'], actor), 'domain registration rolls back when audit insert fails')
    ok((await prisma.organization.findUniqueOrThrow({ where: { id: ids.a } })).verifiedOfficialDomainsJson === '[]', 'failed domain registration left no write')
    await service.replaceVerifiedDomains(ids.a, ['example.com.cn'], actor)
    await service.replaceVerifiedDomains(ids.a, ['example.com.cn', 'example.org'], actor)
    await service.replaceVerifiedDomains(ids.b, ['other.org'], actor)
    ok(await prisma.auditLog.count({ where: { action: 'organization.verified_domains_replace', targetId: ids.a } }) === 2, 'each domain replacement has audit')
    const a = await service.createForPartner(partnerA, { name: '  官网  ', url: ' HTTPS://EXAMPLE.COM.CN.:443/path ', displayOrder: 3 })
    const countBeforeFailedCreate = await prisma.onlinePlatformDirectory.count({ where: { organizationId: ids.a } })
    await rollsBack(() => failService.createForPartner(partnerA, { name: '失败创建', url: 'https://example.com.cn/' }), 'channel create rolls back when audit insert fails')
    ok(await prisma.onlinePlatformDirectory.count({ where: { organizationId: ids.a } }) === countBeforeFailedCreate, 'failed create left no channel')
    const b = await service.createForPartner(partnerB, { name: 'B 官网', url: 'https://other.org/', displayOrder: 1 })
    ok(a.name === '官网' && a.url === 'https://example.com.cn/path', 'channel saves trimmed name and canonical URL')
    const stored = await prisma.onlinePlatformDirectory.findUniqueOrThrow({ where: { id: a.id } })
    ok(stored.category === 'official_channel' && stored.operatorLegalName === '机构 A' && stored.officialDomainsJson !== '' && stored.reviewStatus === 'pending' && stored.publishStatus === 'draft', 'reused directory required fields explicitly populated')
    const legacyId = `oc_legacy_${suffix}`
    await prisma.onlinePlatformDirectory.create({ data: {
      id: legacyId, slug: legacyId, name: '原平台目录', landingUrl: 'https://legacy.example.com/', operatorLegalName: '原平台',
      officialDomainsJson: '["example.com"]', status: 'active', reviewStatus: 'approved', publishStatus: 'published',
      linkCheckStatus: 'valid', contentHash: 'verified', approvedContentHash: 'verified', hashAlgorithmVersion: '1',
    } })
    const oldDirectory = new RecruitmentContentReadService(prisma, {} as never, audit)
    const oldList = await oldDirectory.listDirectories({ page: 1, pageSize: 20 } as never)
    ok(oldList.items.some((item) => item.id === legacyId) && !oldList.items.some((item) => item.id === a.id), 'legacy admin directory excludes official channel')
    await rejects(() => oldDirectory.getDirectory(a.id), 'RECRUITMENT_DIRECTORY_NOT_FOUND', 'legacy admin detail excludes official channel')
    ok((await service.listForPartner(partnerA)).items.every((item) => item.id !== b.id), 'partner A cannot read B channel')
    await rejects(() => service.updateForPartner(partnerA, b.id, { name: 'cross' }), 'OFFICIAL_CHANNEL_NOT_FOUND', 'partner A cannot edit B')
    await rejects(() => service.archiveForPartner(partnerA, b.id), 'OFFICIAL_CHANNEL_NOT_FOUND', 'partner A cannot archive B')
    await rejects(() => service.createForPartner(partnerA, { name: 'outside', url: 'https://evil.com/' }), 'OFFICIAL_CHANNEL_DOMAIN_NOT_VERIFIED', 'off-domain channel rejected')
    await service.replaceVerifiedDomains(ids.a, [], actor)
    const reordered = await service.updateForPartner(partnerA, a.id, { displayOrder: 4, name: '新官网' })
    ok(reordered.displayOrder === 4, 'name/sort update does not revalidate old URL')
    await service.updateForPartner(partnerA, a.id, { url: ' HTTPS://EXAMPLE.COM.CN.:443/path ' })
    ok((await service.listForPartner(partnerA)).items[0]?.url === a.url, 'equivalent canonical URL does not revalidate old URL')
    await service.updateForPartner(partnerA, a.id, { enabled: false })
    await rejects(() => service.updateForPartner(partnerA, a.id, { enabled: true }), 'OFFICIAL_CHANNEL_DOMAIN_NOT_VERIFIED', 'reenable revalidates old URL')
    await service.replaceVerifiedDomains(ids.a, ['example.com.cn'], actor)
    await service.updateForPartner(partnerA, a.id, { enabled: true })

    for (const [id, orgId] of [[terminalA, ids.a], [terminalB, ids.b], [terminalEmpty, null]] as const) {
      await prisma.terminal.create({ data: { id, terminalCode: id, agentToken: `${id}_token`, deviceFingerprint: id, orgId } })
    }
    process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = 'false'
    const publicA = await service.listForTerminal(terminalA)
    ok(publicA.items.length === 1 && publicA.items[0]?.organizationName === '机构 A' && !('id' in publicA.items[0]!), 'terminal A gets only display fields for A')
    ok(!publicA.items.some((item) => item.url === b.url), 'terminal A cannot read B channel')
    ok((await service.listForTerminal(terminalB)).items[0]?.url === b.url, 'terminal B gets B channel')
    ok((await service.listForTerminal(terminalEmpty)).items.length === 0, 'unbound terminal has no channel')
    ok(publicA.legacyPlatforms.length === 0, 'hosting off returns no legacy platforms')
    process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = 'true'
    const hostingOn = await service.listForTerminal(terminalA)
    ok(hostingOn.legacyPlatforms.length === 1 && hostingOn.legacyPlatforms[0]?.name === '原平台目录', 'hosting on exposes only ready legacy directory')
    process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = 'false'
    const guard = new TerminalIdentityGuard({ validate: async (id?: string, token?: string) => {
      if (id !== terminalA || token !== 'valid') throw new Error('terminal identity rejected')
    } } as never)
    const terminalContext = (id: string): ExecutionContext => ({ switchToHttp: () => ({ getRequest: () => ({
      header: (name: string) => name === 'x-terminal-id' ? terminalA : 'valid', params: { terminalId: id },
    }) }) }) as unknown as ExecutionContext
    ok(await guard.canActivate(terminalContext(terminalA)), 'terminal identity allows its own route')
    let denied = false
    try { await guard.canActivate(terminalContext(terminalB)) } catch { denied = true }
    ok(denied, 'terminal A token cannot read terminal B route')

    await service.updateForPartner(partnerA, a.id, { enabled: false })
    ok((await service.listForTerminal(terminalA)).items.length === 0, 'disabled channel absent publicly')
    await service.updateForPartner(partnerA, a.id, { enabled: true })
    await rejects(() => emergency.takedown('official_channel', a.id, undefined, 'reason', actor), 'TAKEDOWN_REASON_REQUIRED', 'takedown requires reason code')
    const failEmergency = new RecruitmentEmergencyService(prisma, failedAudit)
    await rollsBack(() => failEmergency.takedown('official_channel', a.id, 'rights_complaint', '失败注入', actor), 'emergency takedown rolls back when audit insert fails')
    ok((await prisma.onlinePlatformDirectory.findUniqueOrThrow({ where: { id: a.id } })).status === 'active'
      && await prisma.recruitmentEmergencyHold.count({ where: { targetType: 'official_channel', targetId: a.id } }) === 0
      && await prisma.partnerOrgNotice.count({ where: { orgId: ids.a } }) === 0, 'failed takedown left no status, hold or notice')
    await emergency.takedown('official_channel', a.id, 'rights_complaint', '机构网站异常', actor)
    ok((await service.listForTerminal(terminalA)).items.length === 0, 'emergency-held channel absent publicly')
    await prisma.onlinePlatformDirectory.update({ where: { id: a.id }, data: { status: 'active' } })
    ok((await service.listForTerminal(terminalA)).items.length === 0, 'hold alone excludes a stale active row')
    await prisma.onlinePlatformDirectory.update({ where: { id: a.id }, data: { status: 'inactive' } })
    const held = (await service.listForPartner(partnerA)).items.find((item) => item.id === a.id)
    ok(held?.emergencyTakedown && held.emergencyReasonCode === 'rights_complaint' && held.emergencyReasonText === '机构网站异常', 'partner sees hold and reason')
    await rejects(() => service.updateForPartner(partnerA, a.id, { enabled: true }), 'EMERGENCY_TAKEDOWN_IRREVERSIBLE', 'hold cannot be reenabled')
    await emergency.takedown('official_channel', a.id, 'other', '重复下架', actor)
    ok(await prisma.partnerOrgNotice.count({ where: { orgId: ids.a, kind: 'recruitment_emergency_takedown' } }) === 1, 'repeat takedown creates one notice')
    ok(await prisma.recruitmentEmergencyHold.count({ where: { targetType: 'official_channel', targetId: a.id } }) === 1, 'takedown has one irreversible hold')
    ok(await prisma.auditLog.count({ where: { action: 'recruitment.emergency_takedown', targetId: a.id } }) === 2, 'each takedown attempt audited')
    await service.archiveForPartner(partnerB, b.id)
    ok((await service.listForPartner(partnerB)).items.length === 0 && (await service.listForTerminal(terminalB)).items.length === 0, 'archived channel absent from partner and terminal lists')
    ok(await prisma.auditLog.count({ where: { action: 'official_channel.archive', targetId: b.id } }) === 1, 'archive audited')
    const c = await service.createForPartner(partnerA, { name: '第二渠道', url: 'https://jobs.example.com.cn/' })
    await emergency.circuitBreak('org', ids.a, 'authority_order', '机构站点统一停用', actor)
    ok((await service.listForTerminal(terminalA)).items.length === 0
      && await prisma.recruitmentEmergencyHold.count({ where: { targetType: 'official_channel', targetId: c.id } }) === 1, 'organization circuit break holds existing official channels')
    await rejects(() => service.createForPartner(partnerA, { name: '熔断后新增', url: 'https://example.com.cn/' }), 'EMERGENCY_TAKEDOWN_IRREVERSIBLE', 'circuit break blocks new official channels')

    const plan = (title: string, source: 'system' | 'manual' = 'system') => ({
      basedOn: { resume: true as const, jobFit: title, jobFitSource: source, interview: null, selfAssessment: null },
      providerName: 'verify', payload: { summary: `我做会计工作，目标岗位：「${title}」。目标岗位：${title}。正文有销售经验。`,
        currentSnapshot: [{ point: title, evidence: `我做会计工作，目标岗位：“${title}”。` }],
        directions: [{ title: '职业方向', why: `参考《${title}》；销售经验保留。`, firstStep: '继续学习' }],
        skillPlan: [], actionChecklist: [] },
    })
    const short = redactCareerPlanSystemJobTitle(plan('会计'), '会计')
    ok(short.basedOn.jobFit === null && short.payload.summary.includes('我做会计工作') && short.payload.summary.includes('「会计」'), 'short title clears structured source without cutting prose')
    const long = redactCareerPlanSystemJobTitle(plan('高级财务会计'), '高级财务会计')
    ok(long.payload.summary.includes('「目标岗位」') && long.payload.summary.includes('目标岗位：目标岗位。') && long.payload.directions[0]?.why.includes('《目标岗位》'), 'quoted and labelled long title redacted')
    ok(long.payload.summary.includes('销售经验') && long.payload.currentSnapshot[0]?.point === '目标岗位', 'unmarked prose retained and structured exact title removed')
    const manual = redactCareerPlanSystemJobTitle(plan('高级财务会计', 'manual'), '高级财务会计')
    ok(manual.basedOn.jobFit === '高级财务会计', 'planning own manual source is retained')
    console.log(`\n=== ALL PASS (${checks} checks) ===`)
  } finally {
    await prisma.partnerOrgNotice.deleteMany({ where: { orgId: { in: [ids.a, ids.b] } } }).catch(() => undefined)
    await prisma.recruitmentEmergencyHold.deleteMany({ where: { orgId: { in: [ids.a, ids.b] } } }).catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [actor.userId, partnerA.userId, partnerB.userId] } } }).catch(() => undefined)
    await prisma.onlinePlatformDirectory.deleteMany({ where: { organizationId: { in: [ids.a, ids.b] } } }).catch(() => undefined)
    await prisma.onlinePlatformDirectory.deleteMany({ where: { id: `oc_legacy_${suffix}` } }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: { in: [terminalA, terminalB, terminalEmpty] } } }).catch(() => undefined)
    await prisma.user.deleteMany({ where: { id: { in: [actor.userId, partnerA.userId, partnerB.userId] } } }).catch(() => undefined)
    await prisma.organization.deleteMany({ where: { id: { in: [ids.a, ids.b] } } }).catch(() => undefined)
    await prisma.onModuleDestroy()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
