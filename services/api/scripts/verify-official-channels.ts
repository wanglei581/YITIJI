/** 3.14 official channels: domain, tenant, terminal, hold, audit, and old plan regression. */
import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
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
import { verifiedDomainFromInput, verifiedHttpsUrl, hostMatchesVerifiedDomain, officialChannelLinkKey } from '../src/official-channels/registrable-domain'
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
    ok(verifiedDomainFromInput('HTTPS://JOBS.EXAMPLE.COM.CN:443/path') === 'jobs.example.com.cn', 'registration URL preserves verified subdomain')
    for (const domain of ['com.cn', 'gov.cn', 'edu.cn', 'org.cn', 'net.cn', 'ac.cn', 'sd.gov.cn', 'github.io', 'gitee.io', 'pages.dev', 'vercel.app', 'netlify.app', 'workers.dev', 'herokuapp.com', 'azurewebsites.net', 'blogspot.com', 'firebaseapp.com', 'web.app', 'cloudfront.net', 'myqcloud.com', 'aliyuncs.com', 'gitlab.io', 'appspot.com', 'fly.dev', 'bitbucket.io', 'ngrok.io']) {
      ok(verifiedDomainFromInput(domain) === null, `forbid public/shared root ${domain}`)
    }
    for (const suffix of ['lhr.life', 'localhost.run', 'loca.lt', 'serveo.net', 'pagekite.me', 'github.dev', 'ngrok-free.app', 'trycloudflare.com', 'vscode.dev', 'githubcodespaces.com', 'codespaces.new', 'codespaces.github.com']) {
      ok(verifiedDomainFromInput(suffix) === null && verifiedDomainFromInput(`evil.${suffix}`) === null,
        `forbid entire tunnel/development namespace ${suffix}`)
    }
    for (const root of ['oss-cn-hangzhou.aliyuncs.com', 'oss.cn-hangzhou.aliyuncs.com', 'cos.ap-guangzhou.myqcloud.com', 'cos-ap-guangzhou.myqcloud.com', 's3-ap-southeast-1.amazonaws.com', 's3.ap-southeast-1.amazonaws.com', 'storage.googleapis.com']) {
      ok(verifiedDomainFromInput(root) === null, `storage regional root cannot be registered ${root}`)
      ok(verifiedDomainFromInput(`mybucket.${root}`) === `mybucket.${root}`
        && verifiedDomainFromInput(`deeper.mybucket.${root}`) === null
        && !hostMatchesVerifiedDomain(`evil.${root}`, `mybucket.${root}`), `storage bucket registration is narrow ${root}`)
    }
    ok(verifiedDomainFromInput('alice.github.io') === 'alice.github.io', 'private suffix tenant can verify only its own host')
    ok(verifiedDomainFromInput('qingdao.sd.gov.cn') === 'qingdao.sd.gov.cn', 'provincial gov.cn suffix needs another label')
    ok(verifiedDomainFromInput('hrss.qingdao.gov.cn') === 'hrss.qingdao.gov.cn', 'agency may register a narrow official subdomain')
    ok(hostMatchesVerifiedDomain('jobs.hrss.qingdao.gov.cn', 'hrss.qingdao.gov.cn')
      && !hostMatchesVerifiedDomain('other.qingdao.gov.cn', 'hrss.qingdao.gov.cn')
      && !hostMatchesVerifiedDomain('qingdao.gov.cn', 'hrss.qingdao.gov.cn'), 'verified subdomain excludes siblings and parent')
    ok(hostMatchesVerifiedDomain('hrss.qingdao.gov.cn', 'qingdao.gov.cn'), 'verified root permits child')
    const allowed = ['example.com.cn']
    for (const url of [
      'http://example.com.cn', 'https://user@example.com.cn', 'https://user:pass@example.com.cn',
      'https://example.com.cn:444/', 'https://127.0.0.1/', 'https://[::1]/',
      'https://evil-example.com.cn/', 'https://example.com.cn.attacker.cn/',
      'https://example.com.cn/?next=https%3A%2F%2Fevil.com%2Fx',
      'https://example.com.cn/?next=%2F%2Fevil.com%2Fx',
      'https://example.com.cn/?next=http%3A%2F%2Fevil.com%2Fx',
      'https://example.com.cn/?next=/\\evil.com', 'https://example.com.cn/?next=\\evil.com',
      'https://example.com.cn/?next=https:\\evil.com', 'https://example.com.cn/?next=%00https://evil.com',
      'https://example.com.cn/?next=javascript:alert(1)', 'https://example.com.cn/#redirect=https://evil.com',
      'https://example.com.cn/?url=https%253A%252F%252Fevil.com',
      'https://example.com.cn/?target=http://example.com.cn',
      'https://example.com.cn/?target=https://user:pass@example.com.cn:8443',
      'https://example.com.cn/#https://evil.com',
      'https://example.com.cn/#javascript:alert(1)',
      `https://example.com.cn/?next=${encodeURIComponent(encodeURIComponent(encodeURIComponent(encodeURIComponent(encodeURIComponent('https://evil.com')))))}`,
      `https://example.com.cn/?next=${Array.from({ length: 10 }).reduce((value) => encodeURIComponent(value), 'https://evil.com')}`,
      'https://example.com.cn/?next=%E2%80%8Bjavascript:alert(1)',
    ]) ok(verifiedHttpsUrl(url, allowed) === null, `reject unsafe URL ${url}`)
    ok(verifiedHttpsUrl(' HTTPS://JOBS.EXAMPLE.COM.CN.:443/path?next=https%3A%2F%2Fjobs.example.com.cn%2Fx ', allowed)?.toString().startsWith('https://jobs.example.com.cn/path?'), 'save canonical HTTPS URL and same-domain redirect')
    ok(!!verifiedHttpsUrl('https://example.com.cn/?next=/internal#section=hello', allowed), 'ordinary text and internal relative path remain valid')
    ok(officialChannelLinkKey('HTTPS://EXAMPLE.COM.CN:443/jobs/?b=2&a=1#top')
      === officialChannelLinkKey('https://example.com.cn/jobs?a=1&b=2'), 'hold identity ignores host case, default port, trailing slash, fragment and query order')
    ok(hostMatchesVerifiedDomain('jobs.example.com.cn', 'example.com.cn'), 'verified child domain allowed')
    ok(!hostMatchesVerifiedDomain('alice.github.io', 'github.io')
      && verifiedHttpsUrl('https://github.io/', ['github.io']) === null, 'public suffix cannot match or enter a channel URL')
    const controllerSource = readFileSync(`${process.cwd()}/src/official-channels/official-channels.controller.ts`, 'utf8')
    ok(!controllerSource.includes("@Query('organizationId')"), 'terminal controller has no unused organizationId parameter')
    const serviceSource = readFileSync(`${process.cwd()}/src/official-channels/official-channels.service.ts`, 'utf8')
    ok(serviceSource.includes('dto.enabled === undefined ? {} : { status:'), 'name-only update does not write status column')

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
    await rejects(async () => roles.canActivate(roleContext(controller.listForAdmin, partnerA)), 'AUTH_ROLE_FORBIDDEN', 'partner cannot read admin channel list')
    ok(roles.canActivate(roleContext(controller.listForAdmin, actor)), 'admin can read organization channel list')
    invalidDto(EmergencyTakedownDto, { targetType: 'official_channel', targetId: 'x', reasonText: 'x' }, 'takedown reason code required')
    const emergencyRoles = new RolesGuard(new Reflector())
    await rejects(async () => emergencyRoles.canActivate({ ...roleContext(controller.replaceDomains, partnerA), getHandler: () => RecruitmentEmergencyController.prototype.takedown, getClass: () => RecruitmentEmergencyController } as ExecutionContext), 'AUTH_ROLE_FORBIDDEN', 'partner cannot emergency takedown')

    await prisma.organization.createMany({ data: [
      { id: ids.a, name: '机构 A', type: 'public', contentTrustStatus: 'active' },
      { id: ids.b, name: '机构 B', type: 'public', contentTrustStatus: 'active' },
    ] })
    await prisma.user.createMany({ data: [
      { id: actor.userId, username: actor.userId, passwordHash: 'x', name: 'Admin', role: 'admin' },
      { id: partnerA.userId, username: partnerA.userId, passwordHash: 'x', name: 'Partner A', role: 'partner', orgId: ids.a },
      { id: partnerB.userId, username: partnerB.userId, passwordHash: 'x', name: 'Partner B', role: 'partner', orgId: ids.b },
    ] })
    const emptyPartner = await controller.listOwn(partnerA)
    ok(emptyPartner.success && Object.keys(emptyPartner.data).sort().join(',') === 'items,verifiedDomains'
      && emptyPartner.data.items.length === 0 && emptyPartner.data.verifiedDomains.length === 0, 'partner list has empty verifiedDomains before registration')
    try {
      await controller.listForAdmin(`missing_${suffix}`)
      throw new Error('FAIL missing organization admin list did not reject')
    } catch (error) {
      if ((error as Error).message.startsWith('FAIL ')) throw error
      ok(code(error) === 'ORG_NOT_FOUND' && (error as { getStatus?: () => number }).getStatus?.() === 404, 'admin list returns existing module 404 for missing organization')
    }
    await rejects(() => service.replaceVerifiedDomains(ids.a, ['github.io'], actor), 'VERIFIED_DOMAIN_INVALID', 'illegal registration rejected')
    const failedAudit = { writeRequired: async () => { throw new Error('injected audit failure') } } as unknown as AuditService
    const failService = new OfficialChannelsService(prisma, failedAudit)
    await rollsBack(() => failService.replaceVerifiedDomains(ids.a, ['example.com.cn'], actor), 'domain registration rolls back when audit insert fails')
    ok((await prisma.organization.findUniqueOrThrow({ where: { id: ids.a } })).verifiedOfficialDomainsJson === '[]', 'failed domain registration left no write')
    const priorRecord = { domain: 'example.com.cn', verifiedAt: '2026-01-01T00:00:00.000Z', verifiedBy: 'prior-admin' }
    let txWrite = ''
    const txReader = new OfficialChannelsService({
      organization: { findUnique: async () => ({ id: ids.a, name: 'stale', verifiedOfficialDomainsJson: '[]' }) },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        organization: {
          findUnique: async () => ({ verifiedOfficialDomainsJson: JSON.stringify([priorRecord]) }),
          update: async (args: { data: { verifiedOfficialDomainsJson: string } }) => { txWrite = args.data.verifiedOfficialDomainsJson },
        },
      }),
    } as never, { writeRequired: async () => 'audit' } as never)
    const txResult = await txReader.replaceVerifiedDomains(ids.a, ['example.com.cn'], actor)
    ok(txResult.items[0]?.verifiedBy === 'prior-admin' && txWrite.includes('prior-admin'), 'domain replacement reads latest verification inside transaction')
    await service.replaceVerifiedDomains(ids.a, ['example.com.cn'], actor)
    await rejects(() => service.createForPartner(partnerA, { name: '危险跳转', url: 'https://example.com.cn/?url=https%253A%252F%252Fevil.com' }), 'OFFICIAL_CHANNEL_DOMAIN_NOT_VERIFIED', 'encoded redirect cannot be persisted')
    await service.replaceVerifiedDomains(ids.a, ['EXAMPLE.COM.CN.', 'HTTPS://EXAMPLE.ORG:443'], actor)
    await service.replaceVerifiedDomains(ids.b, ['other.org'], actor)
    const domainsA = await controller.listOwn(partnerA)
    const domainsB = await controller.listOwn(partnerB)
    ok(JSON.stringify(domainsA.data.verifiedDomains) === JSON.stringify(['example.com.cn', 'example.org'])
      && JSON.stringify(domainsB.data.verifiedDomains) === JSON.stringify(['other.org']), 'partner sees only own registered domains in registration order')
    ok(await prisma.auditLog.count({ where: { action: 'organization.verified_domains_replace', targetId: ids.a } }) === 2, 'each domain replacement has audit')
    const a = await service.createForPartner(partnerA, { name: '  官网  ', url: ' HTTPS://EXAMPLE.COM.CN.:443/path ', displayOrder: 3 })
    const countBeforeFailedCreate = await prisma.onlinePlatformDirectory.count({ where: { organizationId: ids.a } })
    await rollsBack(() => failService.createForPartner(partnerA, { name: '失败创建', url: 'https://example.com.cn/' }), 'channel create rolls back when audit insert fails')
    ok(await prisma.onlinePlatformDirectory.count({ where: { organizationId: ids.a } }) === countBeforeFailedCreate, 'failed create left no channel')
    const b = await service.createForPartner(partnerB, { name: 'B 官网', url: 'https://other.org/', displayOrder: 1 })
    const adminInitial = await controller.listForAdmin(ids.a)
    ok(adminInitial.success && Object.keys(adminInitial.data).join(',') === 'items'
      && adminInitial.data.items.length === 1 && adminInitial.data.items[0]?.id === a.id
      && Object.keys(adminInitial.data.items[0]!).sort().join(',') === 'displayOrder,emergencyReasonCode,emergencyReasonText,emergencyTakedown,enabled,id,name,url', 'admin list exposes exact read-only channel shape')
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
    ok(!(await controller.listForAdmin(ids.a)).data.items.some((item) => item.id === legacyId), 'official admin list excludes old platform directory')
    await rejects(() => oldDirectory.getDirectory(a.id), 'RECRUITMENT_DIRECTORY_NOT_FOUND', 'legacy admin detail excludes official channel')
    ok((await service.listForPartner(partnerA)).items.every((item) => item.id !== b.id), 'partner A cannot read B channel')
    await rejects(() => service.updateForPartner(partnerA, b.id, { name: 'cross' }), 'OFFICIAL_CHANNEL_NOT_FOUND', 'partner A cannot edit B')
    await rejects(() => service.archiveForPartner(partnerA, b.id), 'OFFICIAL_CHANNEL_NOT_FOUND', 'partner A cannot archive B')
    await rejects(() => service.createForPartner(partnerA, { name: 'outside', url: 'https://evil.com/' }), 'OFFICIAL_CHANNEL_DOMAIN_NOT_VERIFIED', 'off-domain channel rejected')
    await service.replaceVerifiedDomains(ids.a, [], actor)
    ok((await controller.listOwn(partnerA)).data.verifiedDomains.length === 0
      && JSON.stringify((await controller.listOwn(partnerB)).data.verifiedDomains) === JSON.stringify(['other.org']), 'cleared partner domains are empty without changing another organization')
    const reordered = await service.updateForPartner(partnerA, a.id, { displayOrder: 4, name: '新官网' })
    ok(reordered.displayOrder === 4, 'name/sort update does not revalidate old URL')
    await service.updateForPartner(partnerA, a.id, { url: ' HTTPS://EXAMPLE.COM.CN.:443/path ' })
    ok((await service.listForPartner(partnerA)).items[0]?.url === a.url, 'equivalent canonical URL does not revalidate old URL')
    await service.updateForPartner(partnerA, a.id, { enabled: false })
    await rejects(() => service.updateForPartner(partnerA, a.id, { enabled: true }), 'OFFICIAL_CHANNEL_DOMAIN_NOT_VERIFIED', 'reenable revalidates old URL')
    await service.replaceVerifiedDomains(ids.a, ['example.com.cn'], actor)
    await service.updateForPartner(partnerA, a.id, { enabled: true })
    const dormant = await service.createForPartner(partnerA, { name: '备选渠道', url: 'https://example.com.cn/other', enabled: false, displayOrder: 1 })
    const adminSorted = (await controller.listForAdmin(ids.a)).data.items
    const partnerSorted = (await controller.listOwn(partnerA)).data.items
    ok(JSON.stringify(adminSorted.map((item) => item.id)) === JSON.stringify(partnerSorted.map((item) => item.id))
      && adminSorted[0]?.id === dormant.id && !adminSorted[0]?.enabled, 'admin list uses partner order and includes disabled channels')
    const racing = await Promise.allSettled([
      ...Array.from({ length: 25 }, (_, i) => service.updateForPartner(partnerA, a.id, { name: `并发改名 ${i}` })),
      service.updateForPartner(partnerA, a.id, { enabled: false }),
    ])
    ok(racing[25]?.status === 'fulfilled', 'concurrent disable completed')
    ok((await prisma.onlinePlatformDirectory.findUniqueOrThrow({ where: { id: a.id } })).status === 'inactive', '25 name edits cannot restore active status')
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
    await prisma.organization.update({ where: { id: ids.a }, data: { contentTrustStatus: 'suspended' } })
    ok((await service.listForTerminal(terminalA)).items.length === 0, 'untrusted organization has no public channels')
    await prisma.organization.update({ where: { id: ids.a }, data: { contentTrustStatus: 'active', archivedAt: new Date() } })
    ok((await service.listForTerminal(terminalA)).items.length === 0, 'archived organization has no public channels')
    await prisma.organization.update({ where: { id: ids.a }, data: { archivedAt: null } })
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
    await service.replaceVerifiedDomains(ids.b, ['other.org', 'example.com.cn'], actor)
    const sameA = await service.createForPartner(partnerA, { name: 'A 同链接', url: a.url })
    const sameB = await service.createForPartner(partnerB, { name: 'B 同链接', url: a.url })
    const slashA = await service.createForPartner(partnerA, { name: '斜杠变体', url: `${a.url}/` })
    const fragmentB = await service.createForPartner(partnerB, { name: '片段变体', url: `${a.url}#top` })
    ok((await service.listForTerminal(terminalA)).items.filter((item) => item.url === a.url).length === 2
      && (await service.listForTerminal(terminalA)).items.some((item) => item.url === slashA.url)
      && (await service.listForTerminal(terminalB)).items.some((item) => item.url === sameB.url)
      && (await service.listForTerminal(terminalB)).items.some((item) => item.url === fragmentB.url),
    'same destination exact and variant links are public before takedown')
    await rejects(() => emergency.takedown('official_channel', a.id, undefined, 'reason', actor), 'TAKEDOWN_REASON_REQUIRED', 'takedown requires reason code')
    const failEmergency = new RecruitmentEmergencyService(prisma, failedAudit)
    await rollsBack(() => failEmergency.takedown('official_channel', a.id, 'rights_complaint', '失败注入', actor), 'emergency takedown rolls back when audit insert fails')
    ok((await prisma.onlinePlatformDirectory.findUniqueOrThrow({ where: { id: a.id } })).status === 'active'
      && await prisma.recruitmentEmergencyHold.count({ where: { targetType: 'official_channel', targetId: a.id } }) === 0
      && (await prisma.onlinePlatformDirectory.findUniqueOrThrow({ where: { id: sameB.id } })).status === 'active'
      && await prisma.partnerOrgNotice.count({ where: { orgId: { in: [ids.a, ids.b] } } }) === 0, 'failed takedown left no status, hold or notice across organizations')
    let auditWrites = 0
    const lateFailure = new RecruitmentEmergencyService(prisma, {
      writeRequired: async (tx: never, entry: never) => {
        auditWrites++
        if (auditWrites === 3) throw new Error('late audit failure')
        return audit.writeRequired(tx, entry)
      },
    } as AuditService)
    await rollsBack(() => lateFailure.takedown('official_channel', a.id, 'rights_complaint', '后段失败', actor),
      'cross-organization takedown rolls back when a later audit fails')
    ok(await prisma.recruitmentEmergencyHold.count({ where: { targetType: 'official_channel', targetId: { in: [a.id, sameA.id, sameB.id, slashA.id, fragmentB.id] } } }) === 0
      && await prisma.partnerOrgNotice.count({ where: { orgId: { in: [ids.a, ids.b] } } }) === 0
      && await prisma.onlinePlatformDirectory.count({ where: { id: { in: [a.id, sameA.id, sameB.id, slashA.id, fragmentB.id] }, status: 'active' } }) === 5,
    'late audit failure rolls back every matching channel, hold and notice')
    await emergency.takedown('official_channel', a.id, 'rights_complaint', '机构网站异常', actor)
    ok((await prisma.recruitmentEmergencyHold.count({ where: { targetType: 'official_channel', targetId: { in: [a.id, sameA.id, sameB.id, slashA.id, fragmentB.id] } } })) === 5
      && (await prisma.onlinePlatformDirectory.count({ where: { id: { in: [a.id, sameA.id, sameB.id, slashA.id, fragmentB.id] }, status: 'inactive' } })) === 5,
    'same destination variants across organizations all receive holds and become inactive')
    ok(await prisma.partnerOrgNotice.count({ where: { orgId: ids.a } }) === 3
      && await prisma.partnerOrgNotice.count({ where: { orgId: ids.b } }) === 2, 'each affected organization receives a notice per channel')
    const adminHeld = (await controller.listForAdmin(ids.a)).data.items.find((item) => item.id === a.id)
    ok(adminHeld?.emergencyTakedown && adminHeld.emergencyReasonCode === 'rights_complaint'
      && adminHeld.emergencyReasonText === '机构网站异常', 'admin list includes complete emergency reason fields')
    ok((await service.listForTerminal(terminalA)).items.length === 0, 'emergency-held channel absent publicly')
    ok(!(await service.listForTerminal(terminalB)).items.some((item) => item.url === sameB.url), 'cross-organization duplicate absent publicly')
    await prisma.onlinePlatformDirectory.update({ where: { id: a.id }, data: { status: 'active' } })
    ok((await service.listForTerminal(terminalA)).items.length === 0, 'hold alone excludes a stale active row')
    await prisma.onlinePlatformDirectory.update({ where: { id: a.id }, data: { status: 'inactive' } })
    await prisma.onlinePlatformDirectory.update({ where: { id: sameB.id }, data: { status: 'active' } })
    ok(!(await service.listForTerminal(terminalB)).items.some((item) => item.url === sameB.url), 'global hold link key excludes stale active duplicate')
    await prisma.onlinePlatformDirectory.update({ where: { id: sameB.id }, data: { status: 'inactive' } })
    const staleId = `oc_stale_${suffix}`
    await prisma.onlinePlatformDirectory.create({ data: {
      id: staleId, slug: staleId, organizationId: ids.b, category: 'official_channel',
      name: '遗留重复链接', landingUrl: `${a.url}#late`, operatorLegalName: '机构 B', status: 'active',
    } })
    ok(!(await service.listForTerminal(terminalB)).items.some((item) => item.url === `${a.url}#late`),
      'global hold key excludes an active legacy duplicate without its own hold')
    await prisma.onlinePlatformDirectory.delete({ where: { id: staleId } })
    const held = (await service.listForPartner(partnerA)).items.find((item) => item.id === a.id)
    ok(held?.emergencyTakedown && held.emergencyReasonCode === 'rights_complaint' && held.emergencyReasonText === '机构网站异常', 'partner sees hold and reason')
    await rejects(() => service.updateForPartner(partnerA, a.id, { name: '下架后改名' }), 'EMERGENCY_TAKEDOWN_IRREVERSIBLE', 'held channel name frozen')
    await rejects(() => service.updateForPartner(partnerA, a.id, { displayOrder: 8 }), 'EMERGENCY_TAKEDOWN_IRREVERSIBLE', 'held channel sort frozen')
    await rejects(() => service.updateForPartner(partnerA, a.id, { url: 'https://example.com.cn/new' }), 'EMERGENCY_TAKEDOWN_IRREVERSIBLE', 'held channel link frozen')
    await rejects(() => service.updateForPartner(partnerA, a.id, { enabled: true }), 'EMERGENCY_TAKEDOWN_IRREVERSIBLE', 'hold cannot be reenabled')
    await rejects(() => service.createForPartner(partnerA, { name: '重建同一链接', url: a.url }), 'EMERGENCY_TAKEDOWN_IRREVERSIBLE', 'held link cannot be recreated')
    await rejects(() => service.createForPartner(partnerA, { name: '路径变体', url: `${a.url}/` }), 'EMERGENCY_TAKEDOWN_IRREVERSIBLE', 'held trailing slash cannot be recreated')
    await rejects(() => service.createForPartner(partnerA, { name: '片段变体', url: `${a.url}#top` }), 'EMERGENCY_TAKEDOWN_IRREVERSIBLE', 'held fragment cannot be recreated')
    await rejects(() => service.updateForPartner(partnerA, dormant.id, { url: `${a.url}#top` }), 'EMERGENCY_TAKEDOWN_IRREVERSIBLE', 'existing channel cannot switch to held link variant')
    await rejects(() => service.createForPartner(partnerB, { name: '跨机构重建', url: a.url }), 'EMERGENCY_TAKEDOWN_IRREVERSIBLE', 'held link blocked across organizations')
    await emergency.takedown('official_channel', a.id, 'other', '重复下架', actor)
    ok(await prisma.partnerOrgNotice.count({ where: { orgId: ids.a, kind: 'recruitment_emergency_takedown' } }) === 3, 'repeat takedown creates no duplicate notices')
    ok(await prisma.recruitmentEmergencyHold.count({ where: { targetType: 'official_channel', targetId: a.id } }) === 1, 'takedown has one irreversible hold')
    ok(await prisma.auditLog.count({ where: { action: 'recruitment.emergency_takedown', targetId: a.id } }) === 2, 'each takedown attempt audited')
    await service.archiveForPartner(partnerA, a.id)
    await service.archiveForPartner(partnerA, sameA.id)
    await service.archiveForPartner(partnerA, slashA.id)
    ok(!(await service.listForPartner(partnerA)).items.some((item) => item.id === a.id), 'held channel can be archived and leaves partner list')
    ok(!(await controller.listForAdmin(ids.a)).data.items.some((item) => item.id === a.id), 'admin list excludes archived channel')
    await service.archiveForPartner(partnerB, b.id)
    await service.archiveForPartner(partnerB, sameB.id)
    await service.archiveForPartner(partnerB, fragmentB.id)
    ok((await service.listForPartner(partnerB)).items.length === 0 && (await service.listForTerminal(terminalB)).items.length === 0, 'archived channel absent from partner and terminal lists')
    ok((await controller.listForAdmin(ids.b)).data.items.length === 0, 'admin list excludes archived channels of another organization')
    ok(await prisma.auditLog.count({ where: { action: 'official_channel.archive', targetId: b.id } }) === 1, 'archive audited')
    const c = await service.createForPartner(partnerA, { name: '第二渠道', url: 'https://jobs.example.com.cn/' })
    await emergency.circuitBreak('org', ids.a, 'authority_order', '机构站点统一停用', actor)
    ok((await service.listForTerminal(terminalA)).items.length === 0
      && await prisma.recruitmentEmergencyHold.count({ where: { targetType: 'official_channel', targetId: c.id } }) === 1, 'organization circuit break holds existing official channels')
    await prisma.onlinePlatformDirectory.create({ data: {
      id: `oc_race_${suffix}`, slug: `oc_race_${suffix}`, name: '并发遗留渠道',
      organizationId: ids.a, category: 'official_channel', status: 'active',
      landingUrl: 'https://example.com.cn/', operatorLegalName: '机构 A',
    } })
    ok((await service.listForTerminal(terminalA)).items.length === 0, 'persistent org circuit hides a concurrently created channel')
    await rejects(() => service.createForPartner(partnerA, { name: '熔断后新增', url: 'https://example.com.cn/' }), 'EMERGENCY_TAKEDOWN_IRREVERSIBLE', 'circuit break blocks new official channels')

    const plan = (title: string, source: 'system' | 'manual' = 'system') => ({
      basedOn: { resume: true as const, jobFit: title, jobFitSource: source, interview: null, selfAssessment: null },
      providerName: 'verify', payload: { summary: `我做会计工作，目标岗位：「${title}」。目标岗位：${title}。正文有销售经验。`,
        currentSnapshot: [{ point: title, evidence: `我做会计工作，目标岗位：“${title}”。` }],
        directions: [{ title: '职业方向', why: `参考《${title}》；销售经验保留。`, firstStep: '继续学习' }],
        skillPlan: [], actionChecklist: [] },
    })
    const short = redactCareerPlanSystemJobTitle(plan('会计'), '会计')
    ok(short.basedOn.jobFit === null && short.payload.summary.includes('我做会计工作') && short.payload.summary.includes('「会计」')
      && short.payload.currentSnapshot[0]?.point === '目标岗位', 'short title clears structured source without cutting prose')
    ok(redactCareerPlanSystemJobTitle(plan('高级财务会计'), '  ').payload.summary === plan('高级财务会计').payload.summary, 'blank title leaves free text untouched')
    const long = redactCareerPlanSystemJobTitle(plan('高级财务会计'), '高级财务会计')
    ok(long.payload.summary.includes('「目标岗位」') && long.payload.summary.includes('目标岗位。') && !long.payload.summary.includes('目标岗位：目标岗位') && long.payload.directions[0]?.why.includes('《目标岗位》'), 'quoted and labelled long title redacted')
    ok(long.payload.summary.includes('销售经验') && long.payload.currentSnapshot[0]?.point === '目标岗位', 'unmarked prose retained and structured exact title removed')
    const bare = plan('高级财务会计')
    bare.payload.summary = '高级财务会计'
    ok(redactCareerPlanSystemJobTitle(bare, '高级财务会计').payload.summary === '高级财务会计', 'unmarked whole prose title stays unchanged')
    const manual = redactCareerPlanSystemJobTitle(plan('高级财务会计', 'manual'), '高级财务会计')
    ok(manual.basedOn.jobFit === '高级财务会计', 'planning own manual source is retained')
    const malformed = plan('高级财务会计') as unknown as { payload: { directions: Array<unknown>; currentSnapshot: Array<unknown>; skillPlan: Array<unknown> }; basedOn: unknown }
    malformed.payload.directions = [null, 'broken', { title: '高级财务会计', why: '保留正文', firstStep: '行动' }]
    malformed.payload.currentSnapshot = [null, 2]
    malformed.payload.skillPlan = [null, false]
    const safe = redactCareerPlanSystemJobTitle(malformed as never, '高级财务会计')
    ok(safe.payload.directions.length === 1 && safe.payload.currentSnapshot.length === 0 && safe.payload.skillPlan.length === 0, 'malformed plan array entries are skipped')
    const old = plan('高级财务会计') as { basedOn: { jobFitSource?: 'system' | 'manual' } }
    delete old.basedOn.jobFitSource
    ok(redactCareerPlanSystemJobTitle(old as never, '高级财务会计').basedOn.jobFit === null, 'legacy plan with unknown source is conservatively redacted')
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
