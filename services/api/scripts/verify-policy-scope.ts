import './support/verify-policy-scope-env.cjs'
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { HTTP_CODE_METADATA, MODULE_METADATA } from '@nestjs/common/constants'
import type { Redis } from 'ioredis'
import { PoliciesModule } from '../src/policies/policies.module'
import { PoliciesController } from '../src/policies/policies.controller'
import { PolicyChecklistController } from '../src/policies/policy-checklist.controller'
import { CommunityModule } from '../src/community/community.module'
import { MemberFavoritesController } from '../src/member-favorites/member-favorites.controller'
import { MeActivityController } from '../src/activity/me-activity.controller'
import { PolicyScopeService, resolvePolicyScope, scopeForVerifiedCaller } from '../src/policies/policy-scope.service'
import { PolicyChecklistService } from '../src/policies/policy-checklist.service'
import { assertPolicyChecklistPrintable, checklistMetadata } from '../src/policies/policy-checklist-metadata'
import { AssistantPolicyContextService } from '../src/ai/llm/assistant-policy-context'
import { ANONYMOUS_AI_CALLER, lazyAiRequestContext, runWithAiRequestContext } from '../src/ai/usage/ai-usage-context'
import { FilesService } from '../src/files/files.service'
import { StorageService } from '../src/storage/storage.service'
import { publicPolicyWhere, policyScopeMode } from '../src/policies/policy-public-visibility'
import { COMMUNITY_FEED_CACHE_PREFIX, CommunityService, communityFeedCacheKey } from '../src/community/community.service'
import { DAILY_BRIEF_CITY_CACHE_PREFIX, DailyBriefService, type DailyReport } from '../src/assistant/daily-brief.service'
import { AdminOrgContentTrustService, RedisPublicContentCache } from '../src/orgs/admin-org-content-trust.service'
import type { RedisService } from '../src/common/redis/redis.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

async function main() {
const held = [] as string[]
const a = publicPolicyWhere({ id: 'policy-a' }, held, { mode: 'org', orgId: 'org-a', state: 'bound' })
const b = publicPolicyWhere({ id: 'policy-a' }, held, { mode: 'org', orgId: 'org-b', state: 'bound' })
assert.match(JSON.stringify(a), /org-a/)
assert.doesNotMatch(JSON.stringify(a), /org-b/)
assert.match(JSON.stringify(b), /org-b/)
const unbound = publicPolicyWhere({ id: 'policy-a' }, held, { mode: 'org', orgId: null, state: 'unbound' })
assert.match(JSON.stringify(unbound), /no_public_terminal/)
const fakeTerminalSessions = { validate: async (terminalId: string, token: string) => {
  if (!((terminalId === 'terminal-a' && token === 'valid-a') || (terminalId === 'terminal-b' && token === 'valid-b'))) throw new Error('invalid')
} }
const fakePrisma = { terminal: { findUnique: async ({ where }: { where: { id: string } }) => ({ orgId: where.id === 'terminal-a' ? 'org-a' : null }) } }
process.env['POLICY_SCOPE'] = 'org'
const resolver = new PolicyScopeService(fakeTerminalSessions as never, fakePrisma as never)
assert.deepEqual(await resolver.resolve({ headers: { 'x-terminal-id': 'terminal-a', 'x-terminal-session-token': 'valid-a' } }), { mode: 'org', orgId: 'org-a', state: 'bound' })
assert.deepEqual(await resolver.resolve({ headers: { 'x-terminal-id': 'terminal-b', 'x-terminal-session-token': 'valid-b' } }), { mode: 'org', orgId: null, state: 'unbound' })
assert.deepEqual(await resolver.resolve({ headers: {} }), { mode: 'org', orgId: null, state: 'missing' })
assert.deepEqual(await resolver.resolve({ headers: { 'x-terminal-id': 'terminal-a', 'x-terminal-session-token': 'forged' } }), { mode: 'org', orgId: null, state: 'missing' }, '终端会话令牌验不过要判缺失，不能按终端编号直接取机构')
// 政策、社区两个控制器上 PolicyScopeService 是可选注入（方便门禁手动构造）；生产装配必须真的提供它，
// 否则 POLICY_SCOPE=org 会被悄悄当成 all。读 Nest 模块元数据核对，不搜源码字符串。
for (const [label, mod] of [['PoliciesModule', PoliciesModule], ['CommunityModule', CommunityModule]] as const) {
  const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, mod) ?? []) as unknown[]
  assert.ok(providers.includes(PolicyScopeService), `${label} 必须提供 PolicyScopeService`)
}
// D4 拍板（2026-09-28）：会员本人的收藏、浏览与跳转记录照常显示，不按终端机构过滤；
// 只有公开的政策列表、详情、条件核对与社区动态按机构过滤（打开详情时再按终端机构判断）。
// 阳性对照：政策控制器确实注入了它；读不出来说明没有装饰器元数据，下面的「不依赖」断言会恒真
assert.ok(((Reflect.getMetadata('design:paramtypes', PoliciesController) ?? []) as unknown[]).includes(PolicyScopeService), '读不到 PoliciesController 的构造参数元数据（阳性对照失败）')
assert.ok(((Reflect.getMetadata('design:paramtypes', PolicyChecklistService) ?? []) as unknown[]).includes(PolicyScopeService), '办事清单必须注入 PolicyScopeService，否则 POLICY_SCOPE=org 时仍按 all 生成')
for (const [label, ctor] of [['MemberFavoritesController', MemberFavoritesController], ['MeActivityController', MeActivityController]] as const) {
  const deps = (Reflect.getMetadata('design:paramtypes', ctor) ?? []) as unknown[]
  assert.ok(!deps.includes(PolicyScopeService), `${label} 不应按终端机构过滤本人记录（D4：本人记录照常显示）`)
}
assert.notEqual(
  communityFeedCacheKey('closed', { mode: 'org', orgId: 'org-a', state: 'bound' }, undefined, 20),
  communityFeedCacheKey('closed', { mode: 'org', orgId: 'org-b', state: 'bound' }, undefined, 20),
)
delete process.env['POLICY_SCOPE']
assert.equal(policyScopeMode(), 'all', 'POLICY_SCOPE 缺省必须是 all（今天的行为）')
assert.equal(JSON.stringify(publicPolicyWhere({ id: 'policy-a' }, held)), JSON.stringify(publicPolicyWhere({ id: 'policy-a' }, held, { mode: 'all' })), '缺省范围的查询条件与 all 一致')
assert.doesNotMatch(JSON.stringify(publicPolicyWhere({ id: 'policy-a' }, held)), /sourceOrgId/, '缺省范围不加机构过滤')
const trustedWhere = JSON.stringify(publicPolicyWhere({ publishStatus: 'published' }, held))
assert.match(trustedWhere, /"enabled":true/, '公开读取要求来源机构仍启用')
assert.match(trustedWhere, /"archivedAt":null/, '公开读取要求来源机构未归档')
assert.match(trustedWhere, /"contentTrustStatus":"active"/, '公开读取要求内容可信仍是 active，撤销后不再公开')
assert.deepEqual(await resolvePolicyScope(undefined, { headers: {} }), { mode: 'all' }, '控制器没拿到服务时按 all')
process.env['POLICY_SCOPE'] = 'all'
assert.equal(policyScopeMode(), 'all')
process.env['POLICY_SCOPE'] = 'org'
assert.equal(policyScopeMode(), 'org')
delete process.env['POLICY_SCOPE']
const kioskPolicies = readFileSync(join(__dirname, '../../../apps/kiosk/src/services/api/policies.ts'), 'utf8')
assert.match(kioskPolicies, /terminalAttributedFetch\(`\$\{API_BASE_URL\}\/policies\$\{/, '政策列表要带终端身份')
assert.match(kioskPolicies, /terminalAttributedFetch\(`\$\{API_BASE_URL\}\/policies\/\$\{encodeURIComponent\(trimmed\)\}`/, '政策详情要带终端身份')
const checklistClient = readFileSync(join(__dirname, '../../../apps/kiosk/src/services/api/policyChecklist.ts'), 'utf8')
assert.match(checklistClient, /terminalAttributedFetch\(`\$\{API_BASE_URL\}\/policies\/\$\{encodeURIComponent\(id\)\}\/checklist`/, '办事清单要带终端身份，才能和列表同一范围')
assert.deepEqual(scopeForVerifiedCaller(null), { mode: 'all' })
await assertRevokedOrDisabledOrgPolicyLeavesPublicRead()
console.log('verify:policy-scope passed (A/B isolation, unbound empty, all default, trust gate, org split)')
}

/** 撤销可信或停用机构后，公开列表和详情都看不到；恢复后又能看到。 */
async function assertRevokedOrDisabledOrgPolicyLeavesPublicRead(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'verify-policy-trust-'))
  const databasePath = join(dir, 'verify-policy-trust.db')
  const databaseUrl = `file:${databasePath}`
  process.env['DATABASE_URL'] = databaseUrl
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  if (process.env['NODE_ENV']?.trim().toLowerCase() === 'production') process.env['NODE_ENV'] = 'test'
  assertIsolatedVerificationDatabase()
  closeSync(openSync(databasePath, 'wx'))
  const apiRoot = join(__dirname, '..')
  execFileSync(process.execPath, [
    join(apiRoot, 'node_modules/prisma/build/index.js'),
    'db', 'push', '--url', databaseUrl, '--accept-data-loss',
  ], { cwd: apiRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit' })
  process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-policy-scope-terminal-admin-secret'
  process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-policy-scope-terminal-action-secret'
  const { PoliciesService } = await import('../src/policies/policies.service')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  try {
    const orgId = 'org-trust-gate'
    const policyId = 'policy-trust-gate'
    await prisma.organization.create({
      data: {
        id: orgId,
        name: '可信机构',
        type: 'public_employment_service',
        enabled: true,
        contentTrustStatus: 'active',
        archivedAt: null,
      },
    })
    await prisma.policyPost.create({
      data: {
        id: policyId,
        sourceOrgId: orgId,
        sourceName: '可信机构',
        title: '还能看的政策',
        reviewStatus: 'approved',
        publishStatus: 'published',
      },
    })
    const svc = new PoliciesService(prisma, new AuditService(prisma))
    const listed = async () => (await svc.getPublishedPolicies()).data.some((row) => row.id === policyId)
    const detailVisible = async () => {
      const detail = await svc.getPublishedPolicyById(policyId)
      return detail.data.id === policyId
    }
    const hidden = async () => {
      assert.equal(await listed(), false)
      await assert.rejects(() => svc.getPublishedPolicyById(policyId), NotFoundException)
    }
    assert.equal(await listed(), true)
    assert.equal(await detailVisible(), true)
    await prisma.organization.update({ where: { id: orgId }, data: { contentTrustStatus: 'revoked' } })
    await hidden()
    await prisma.organization.update({ where: { id: orgId }, data: { contentTrustStatus: 'active', enabled: false } })
    await hidden()
    await prisma.organization.update({ where: { id: orgId }, data: { enabled: true, archivedAt: new Date() } })
    await hidden()
    await prisma.organization.update({ where: { id: orgId }, data: { enabled: true, archivedAt: null, contentTrustStatus: 'active' } })
    assert.equal(await listed(), true)
    assert.equal(await detailVisible(), true)
    await assertOrgScopeMatchesListChecklistAndAssistant(prisma, dir)
    await assertRevokingTrustDropsCachedFeeds(prisma)
  } finally {
    await prisma.onModuleDestroy?.()
    rmSync(dir, { recursive: true, force: true })
  }
}
/** all 下两个机构都能看；org 下列表、详情、小青、办事清单、打印再核对用同一套范围。 */
async function assertOrgScopeMatchesListChecklistAndAssistant(prisma: PrismaService, dir: string): Promise<void> {
  const priorScope = process.env['POLICY_SCOPE']
  const priorStorage = process.env['FILE_STORAGE_DIR']
  const priorSigning = process.env['FILE_SIGNING_SECRET']
  const orgA = 'org-scope-a'
  const orgB = 'org-scope-b'
  const guideA = 'policy-scope-guide-a'
  const guideB = 'policy-scope-guide-b'
  const terminalA = 'terminal-scope-a'
  const terminalB = 'terminal-scope-b'
  const terminalUnbound = 'terminal-scope-unbound'
  process.env['FILE_SIGNING_SECRET'] ||= 'verify-policy-scope-secret-at-least-32-characters'
  process.env['FILE_STORAGE_DIR'] = join(dir, 'files')
  process.env['FILE_STORAGE_DRIVER'] = 'local'
  const sessions = {
    validate: async (terminalId: string, token: string) => {
      if (token !== `ok:${terminalId}`) throw new Error('invalid')
    },
  }
  const { PoliciesService } = await import('../src/policies/policies.service')
  const scopeSvc = new PolicyScopeService(sessions as never, prisma)
  const policies = new PoliciesService(prisma, new AuditService(prisma))
  const files = new FilesService(prisma, new AuditService(prisma), new StorageService())
  const checklist = new PolicyChecklistService(prisma, files, scopeSvc)
  const assistant = new AssistantPolicyContextService(prisma)
  const headersFor = (terminalId: string) => ({
    headers: { 'x-terminal-id': terminalId, 'x-terminal-session-token': `ok:${terminalId}` },
  })
  const caller = (orgId: string | null, terminalVerified: boolean) => lazyAiRequestContext(async () => ({
    ...ANONYMOUS_AI_CALLER,
    terminalId: terminalVerified ? terminalA : null,
    terminalVerified,
    orgId,
  }))
  try {
    await prisma.organization.create({
      data: { id: orgA, name: '范围机构甲', type: 'public_employment_service', enabled: true, contentTrustStatus: 'active', archivedAt: null },
    })
    await prisma.organization.create({
      data: { id: orgB, name: '范围机构乙', type: 'public_employment_service', enabled: true, contentTrustStatus: 'active', archivedAt: null },
    })
    await prisma.policyPost.create({
      data: { id: guideA, sourceOrgId: orgA, sourceName: '范围机构甲', kind: 'policy_guide', title: '甲的办事指南', reviewStatus: 'approved', publishStatus: 'published' },
    })
    await prisma.policyPost.create({
      data: { id: guideB, sourceOrgId: orgB, sourceName: '范围机构乙', kind: 'policy_guide', title: '乙的办事指南', reviewStatus: 'approved', publishStatus: 'published' },
    })
    const boundAt = new Date('2026-11-01T00:00:00Z')
    await prisma.terminal.create({
      data: { id: terminalA, terminalCode: 'scope-a', agentToken: 'scope-token-a', deviceFingerprint: 'fp-scope-a', orgId: orgA, orgBoundAt: boundAt },
    })
    await prisma.terminal.create({
      data: { id: terminalB, terminalCode: 'scope-b', agentToken: 'scope-token-b', deviceFingerprint: 'fp-scope-b', orgId: orgB, orgBoundAt: boundAt },
    })
    await prisma.terminal.create({
      data: { id: terminalUnbound, terminalCode: 'scope-unbound', agentToken: 'scope-token-unbound', deviceFingerprint: 'fp-scope-unbound', orgId: null, orgBoundAt: null },
    })
    delete process.env['POLICY_SCOPE']
    const allScope = await scopeSvc.resolve(headersFor(terminalA))
    assert.deepEqual(allScope, { mode: 'all' })
    const allList = await policies.getPublishedPolicies({ scope: allScope })
    assert.equal(allList.scope, undefined)
    assert.ok(allList.data.some((row) => row.id === guideA) && allList.data.some((row) => row.id === guideB), 'POLICY_SCOPE 缺省 all：两个机构的政策都在列表里')
    assert.equal((await policies.getPublishedPolicyById(guideB, allScope)).data.id, guideB)
    const allPrompt = await runWithAiRequestContext(caller(orgA, true), () => assistant.read(guideB))
    assert.ok(allPrompt?.includes('乙的办事指南'), 'all 下小青仍能读到其它机构的政策')
    await assertPolicyChecklistPrintable(prisma, { purpose: 'policy_checklist', createdBy: checklistMetadata(guideB, 1) })

    process.env['POLICY_SCOPE'] = 'org'
    const bound = await scopeSvc.resolve(headersFor(terminalA))
    assert.deepEqual(bound, { mode: 'org', orgId: orgA, state: 'bound' })
    const boundList = await policies.getPublishedPolicies({ scope: bound })
    assert.equal(boundList.scope, 'bound')
    assert.deepEqual(boundList.data.map((row) => row.id).sort(), [guideA].sort(), '绑定机构的终端只看到本机构政策')
    assert.equal((await policies.getPublishedPolicyById(guideA, bound)).data.id, guideA)
    await assert.rejects(() => policies.getPublishedPolicyById(guideB, bound), NotFoundException)
    const unbound = await scopeSvc.resolve(headersFor(terminalUnbound))
    assert.deepEqual(unbound, { mode: 'org', orgId: null, state: 'unbound' })
    const unboundList = await policies.getPublishedPolicies({ scope: unbound })
    assert.equal(unboundList.scope, 'unbound')
    assert.equal(unboundList.data.length, 0, '没绑定机构的终端列表为空')
    await assert.rejects(() => policies.getPublishedPolicyById(guideA, unbound), NotFoundException)
    const missing = await scopeSvc.resolve({ headers: {} })
    assert.deepEqual(missing, { mode: 'org', orgId: null, state: 'missing' })
    assert.equal((await policies.getPublishedPolicies({ scope: missing })).data.length, 0, '认不出终端时列表为空')

    const ownPrompt = await runWithAiRequestContext(caller(orgA, true), () => assistant.read(guideA))
    const otherPrompt = await runWithAiRequestContext(caller(orgA, true), () => assistant.read(guideB))
    assert.ok(ownPrompt?.includes('甲的办事指南'), 'org 下小青能讲本机构政策')
    assert.equal(otherPrompt, null, 'org 下小青读不到其它机构的政策')
    assert.equal(await runWithAiRequestContext(caller(null, false), () => assistant.read(guideA)), null, '认不出终端时小青不讲政策')
    assert.equal(await runWithAiRequestContext(caller(null, true), () => assistant.read(guideA)), null, '未绑定机构时小青不讲政策')

    const printable = { purpose: 'policy_checklist', createdBy: checklistMetadata(guideB, 1) }
    await runWithAiRequestContext(caller(orgB, true), () => assertPolicyChecklistPrintable(prisma, printable))
    await assert.rejects(
      () => runWithAiRequestContext(caller(orgA, true), () => assertPolicyChecklistPrintable(prisma, printable)),
      (error: ConflictException) => error instanceof ConflictException,
      '其它机构的终端不能再打印这份清单',
    )
    await assert.rejects(
      () => runWithAiRequestContext(caller(null, false), () => assertPolicyChecklistPrintable(prisma, { purpose: 'policy_checklist', createdBy: checklistMetadata(guideA, 1) })),
      (error: ConflictException) => error instanceof ConflictException,
    )

    const made = await checklist.generate(guideA, headersFor(terminalA))
    assert.equal(made.policyId, guideA)
    await assert.rejects(() => checklist.generate(guideB, headersFor(terminalA)), NotFoundException)
    await assert.rejects(() => checklist.generate(guideA, headersFor(terminalUnbound)), NotFoundException)
    await assert.rejects(() => checklist.generate(guideA, { headers: {} }), NotFoundException)
    assert.equal(
      Reflect.getMetadata(HTTP_CODE_METADATA, PolicyChecklistController.prototype.generate),
      200,
      '办事清单走控制器成功时必须是 200',
    )
    const checklistController = new PolicyChecklistController(checklist)
    const ownViaController = await checklistController.generate(guideA, terminalA, `ok:${terminalA}`)
    assert.equal(ownViaController.data.policyId, guideA, 'org 模式下控制器带本机构终端头，本机构清单成功')
    await assert.rejects(
      () => checklistController.generate(guideB, terminalA, `ok:${terminalA}`),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException, 'org 模式下控制器带终端头，跨机构清单必须 404')
        assert.equal(error.getStatus(), 404)
        return true
      },
    )
    delete process.env['POLICY_SCOPE']
    const across = await checklist.generate(guideB, headersFor(terminalA))
    assert.equal(across.policyId, guideB, '回到 all 后，绑定甲的终端仍能生成乙的清单')
  } finally {
    if (priorScope === undefined) delete process.env['POLICY_SCOPE']
    else process.env['POLICY_SCOPE'] = priorScope
    if (priorStorage === undefined) delete process.env['FILE_STORAGE_DIR']
    else process.env['FILE_STORAGE_DIR'] = priorStorage
    if (priorSigning === undefined) delete process.env['FILE_SIGNING_SECRET']
    else process.env['FILE_SIGNING_SECRET'] = priorSigning
  }
}

/** 社区动态和早报缓存 15 分钟。撤销或恢复内容可信后，下一次请求不能再看见旧结果。 */
async function assertRevokingTrustDropsCachedFeeds(prisma: PrismaService): Promise<void> {
  const keys = new Map<string, string>()
  const redis = {
    async get(key: string) { return keys.get(key) ?? null },
    async setEx(key: string, _ttlSeconds: number, value: string) { keys.set(key, value) },
  }
  const client = {
    async scan(cursor: string, matchWord: string, pattern: string, countWord: string, count: number): Promise<[string, string[]]> {
      assert.equal(matchWord, 'MATCH')
      assert.equal(countWord, 'COUNT')
      assert.equal(count, 200)
      if (cursor !== '0') return ['0', []]
      const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern
      return ['0', [...keys.keys()].filter((key) => key.startsWith(prefix))]
    },
    async del(...found: string[]) {
      for (const key of found) keys.delete(key)
      return found.length
    },
  }
  const community = new CommunityService(prisma, redis as unknown as RedisService)
  const brief = new DailyBriefService(prisma, redis as unknown as RedisService)
  const trust = new AdminOrgContentTrustService(prisma, new AuditService(prisma), new RedisPublicContentCache(client as unknown as Redis))
  const orgA = 'org-scope-a'
  const guideA = `policy:${'policy-scope-guide-a'}`
  const city = '缓存失效验证市'
  const adminId = 'admin-cache-bust'
  await prisma.user.create({
    data: { id: adminId, username: adminId, passwordHash: 'fixture', name: '缓存验证管理员', role: 'admin' },
  })
  const admin = { userId: adminId, role: 'admin' as const, orgId: null }
  const containsGuide = (page: { items: Array<{ id: string }> }) => page.items.some((item) => item.id === guideA)
  const policyCount = (report: DailyReport) => {
    const row = report.modules.find((item) => item.type === 'city_new')
    return row?.type === 'city_new' ? row.newPolicies : 0
  }
  const hasPrefix = (prefix: string) => [...keys.keys()].some((key) => key.startsWith(prefix))

  const beforeFeed = await community.list()
  assert.equal(containsGuide(beforeFeed), true, '撤销前社区动态含该机构政策')
  const beforeCount = policyCount(await brief.create('cache-bust-user', city))
  assert.ok(beforeCount >= 1, '撤销前早报计入了已发布政策')
  assert.equal(hasPrefix(COMMUNITY_FEED_CACHE_PREFIX), true, '社区动态结果已进缓存')
  assert.equal(hasPrefix(DAILY_BRIEF_CITY_CACHE_PREFIX), true, '早报结果已进缓存')

  await trust.setContentTrust(orgA, { status: 'revoked', reason: '授权到期' }, admin)
  assert.equal(hasPrefix(COMMUNITY_FEED_CACHE_PREFIX), false, '撤销后社区动态缓存已清')
  assert.equal(hasPrefix(DAILY_BRIEF_CITY_CACHE_PREFIX), false, '撤销后早报缓存已清')
  const afterFeed = await community.list()
  assert.equal(containsGuide(afterFeed), false, '撤销后马上请求的社区动态不再含该机构政策')
  const afterCount = policyCount(await brief.create('cache-bust-user', city))
  assert.equal(afterCount, beforeCount - 1, '撤销后马上请求的早报不再计入该机构政策')

  await trust.setContentTrust(orgA, { status: 'active', reason: '重新核验通过' }, admin)
  assert.equal(containsGuide(await community.list()), true, '恢复可信后社区动态重新含该机构政策')
  assert.equal(policyCount(await brief.create('cache-bust-user', city)), beforeCount, '恢复可信后早报重新计入该机构政策')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
