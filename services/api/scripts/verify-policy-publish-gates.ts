/** 政策最小闭环契约 §3–5：真实 SQLite/PG 落库 + 与 HTTP 相同的 DTO 校验。 */
import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { BadRequestException, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { PoliciesService, type PolicyPostDto } from '../src/policies/policies.service'
import { CreatePolicyPostDto, PolicyDraftCheckDto, SaveAndPublishPolicyDto, UpdatePolicyPostDto } from '../src/policies/dto/policy.dto'
import { saveAndPublishPartnerPolicy } from '../src/policies/policy-save-and-publish'
import { assertOrgContentTrustActive, type OrgTrustReader } from '../src/common/content-trust'
import { POLICY_PUBLISH_ISSUES } from '../src/policies/policy-source-link'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { POLICY_PUBLISH_FIXTURE, POLICY_VERIFIED_DOMAINS_FIXTURE } from './support/policy-publish-fixture'

process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = 'false'

const handlingFields = ['whoCanApply', 'requiredMaterials', 'whereToApply'] as const
const clearableFields = ['summary', 'content', 'externalUrl', 'externalId', 'publishedDate', ...handlingFields] as const
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })
async function input<T extends object>(metatype: new () => T, value: object): Promise<T> {
  return pipe.transform(value, { type: 'body', metatype })
}
let passed = 0
function pass(label: string) { passed++; console.log(`PASS ${label}`) }
async function denied(fn: () => Promise<unknown>, code: string, message?: string) {
  await assert.rejects(fn, (e: unknown) => {
    assert(e instanceof BadRequestException, '必须是 HTTP 400')
    assert.equal(e.getStatus(), 400)
    const error = (e.getResponse() as { error: { code: string; message: string } }).error
    assert.equal(error.code, code)
    if (message) assert.equal(error.message, message)
    return true
  })
}

async function main() {
  assertIsolatedVerificationDatabase()
  // 不读取部署或硬件；所有写入只属于带随机后缀的本轮夹具。
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const svc = new PoliciesService(prisma, new AuditService(prisma))
  const suffix = randomUUID()
  const orgId = `policy_gate_org_${suffix}`
  const otherOrgId = `policy_gate_org_b_${suffix}`
  const userId = `policy_gate_user_${suffix}`
  const otherUserId = `policy_gate_user_b_${suffix}`
  const user: AuthedUser = { userId, role: 'partner', orgId }
  const publish = (id: string) => svc.publishPolicy(id, 'publish', user, { responsibilityAcknowledged: true })
  const guideInput = { kind: 'policy_guide', title: '门禁验证政策', audience: 'graduate', ...POLICY_PUBLISH_FIXTURE }
  async function create(extra: object = {}, approve = true) {
    const post = await svc.createPartnerPolicy(await input(CreatePolicyPostDto, { ...guideInput, ...extra }), user)
    if (approve) await svc.reviewPolicy(post.id, 'approve', undefined, user)
    return post
  }
  async function assertVerified(id: string, expected: boolean) {
    const detail = (await svc.getPublishedPolicyById(id)).data
    assert.equal(detail.externalUrlVerified, expected, '公开详情动态核验')
    const list = (await svc.getPublishedPolicies()).data
    assert.equal(list.find((p) => p.id === id)?.externalUrlVerified, expected, '公开列表动态核验')
    for (const field of handlingFields) assert.equal(list.find((p) => p.id === id)?.[field], detail[field])
    for (const query of [undefined, { page: 1, pageSize: 200 }]) {
      const partner = await svc.getPartnerPolicies(user, query)
      const rows = Array.isArray(partner) ? partner : partner.data
      assert.equal(rows.find((p) => p.id === id)?.externalUrlVerified, expected, '机构列表动态核验')
      for (const field of handlingFields) assert.equal(rows.find((p) => p.id === id)?.[field], detail[field])
    }
    return detail
  }
  try {
    await prisma.organization.create({ data: {
      id: orgId, name: '政策门禁验证机构', type: 'public_employment_service', contentTrustStatus: 'active',
      verifiedOfficialDomainsJson: POLICY_VERIFIED_DOMAINS_FIXTURE,
    } })
    await prisma.user.create({ data: { id: userId, username: userId, passwordHash: 'fixture', name: '验证员', role: 'partner', orgId } })

    for (const metatype of [CreatePolicyPostDto, UpdatePolicyPostDto]) {
      for (const field of handlingFields) {
        await input(metatype, { ...guideInput, [field]: '字'.repeat(2000) })
        await assert.rejects(() => input(metatype, { ...guideInput, [field]: '字'.repeat(2001) }), BadRequestException)
        await assert.rejects(() => input(metatype, { ...guideInput, [field]: 123 }), BadRequestException)
      }
    }
    assert.equal((await input(CreatePolicyPostDto, { ...guideInput, externalUrl: '' })).externalUrl, undefined)
    assert.equal((await input(UpdatePolicyPostDto, { externalUrl: '' })).externalUrl, null)
    await assert.rejects(() => input(UpdatePolicyPostDto, { publishedDate: '非日期' }), BadRequestException)
    pass('DTO 三栏字符串/2000字边界、Create/Update 空链接差异及日期校验')

    for (const type of ['public_employment_service', 'school_employment_center', 'gig_worker_home', 'employment_service_station']) {
      await prisma.organization.update({ where: { id: orgId }, data: { type } })
      await create({}, false)
    }
    await prisma.organization.update({ where: { id: orgId }, data: { type: 'hr_company' } })
    await denied(() => create(), 'ORG_TYPE_NOT_ALLOWED_FOR_POLICY', '仅公共就业服务机构、高校就业中心、零工之家、就业服务站可发布政策内容')
    await prisma.organization.update({ where: { id: orgId }, data: { type: 'public_employment_service' } })
    pass('四类机构可以录入；其它类型被拒且文案列全四类')

    const blank = await create({ whoCanApply: '', requiredMaterials: '  ', whereToApply: '\n' }, false)
    const blankRow = await prisma.policyPost.findUniqueOrThrow({ where: { id: blank.id } })
    for (const field of handlingFields) assert.equal(blankRow[field], null)
    pass('创建三栏空白写 null')

    // 每轮先发布，再经真实 DTO 清空；反查持久值、审计和发布确认，避免只检查返回体。
    for (const value of [null, '', '  \n']) {
      const seeded = await create({ summary: '旧摘要', content: '旧正文', externalId: '旧编号', publishedDate: '2026-11-05' })
      await publish(seeded.id)
      const before = await prisma.policyPost.findUniqueOrThrow({ where: { id: seeded.id } })
      await svc.updatePartnerPolicy(seeded.id, await input(UpdatePolicyPostDto,
        Object.fromEntries(clearableFields.map((field) => [field, value]))), user)
      const after = await prisma.policyPost.findUniqueOrThrow({ where: { id: seeded.id } })
      for (const field of clearableFields) assert.equal(after[field], null, `${field} 必须清空`)
      assert.equal(after.reviewStatus, 'pending')
      assert.equal(after.publishStatus, 'draft')
      assert.equal(after.contentVersion, before.contentVersion + 1)
      assert.equal(after.publishConfirmedBy, null)
      assert.equal(after.publishConfirmedAt, null)
      assert.equal(after.publishConfirmedContentVersion, null)
      const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'policy.partner_update', targetId: seeded.id } })
      assert.deepEqual(JSON.parse(log.payloadJson!).changedFields.sort(), [...clearableFields].sort())
      await denied(() => publish(seeded.id), 'PUBLISH_REQUIRES_APPROVAL')
    }
    pass('null、空串、纯空白清空八字段；审计含清空字段，编辑重审/版本/确认规则保留')

    const kept = await create({ summary: '摘要', content: '正文', externalId: '编号', publishedDate: '2026-11-05' })
    const keptBefore = await prisma.policyPost.findUniqueOrThrow({ where: { id: kept.id } })
    await svc.updatePartnerPolicy(kept.id, await input(UpdatePolicyPostDto, { title: '只改标题', summary: undefined }), user)
    const keptAfter = await prisma.policyPost.findUniqueOrThrow({ where: { id: kept.id } })
    for (const field of clearableFields) assert.deepEqual(keptAfter[field], keptBefore[field])
    await svc.updatePartnerPolicy(kept.id, await input(UpdatePolicyPostDto, { summary: ' 新摘要 ', content: ' 新正文 ', externalId: ' 新编号 ' }), user)
    const trimmed = await prisma.policyPost.findUniqueOrThrow({ where: { id: kept.id } })
    assert.equal(trimmed.summary, '新摘要'); assert.equal(trimmed.content, '新正文'); assert.equal(trimmed.externalId, '新编号')
    pass('undefined 不动；非空修改去首尾空白')

    for (const field of handlingFields) {
      for (const value of [null, '', '  ']) {
        const post = await create({ [field]: value, externalUrl: undefined })
        await denied(() => publish(post.id), 'POLICY_HANDLING_FIELDS_REQUIRED', POLICY_PUBLISH_ISSUES.handlingFieldsRequired.message)
        assert.equal((await prisma.policyPost.findUniqueOrThrow({ where: { id: post.id } })).publishStatus, 'draft')
      }
    }
    pass('三栏任一缺失先报 POLICY_HANDLING_FIELDS_REQUIRED，拒绝后仍为 draft')
    const noLink = await create({ externalUrl: undefined })
    await denied(() => publish(noLink.id), 'POLICY_SOURCE_URL_REQUIRED', POLICY_PUBLISH_ISSUES.sourceUrlRequired.message)
    pass('三栏齐但无链接 → POLICY_SOURCE_URL_REQUIRED')

    await prisma.organization.update({ where: { id: orgId }, data: { verifiedOfficialDomainsJson: '[]' } })
    const valid = await create({ whoCanApply: '  条件第一行\n条件第二行  ' })
    await denied(() => publish(valid.id), 'POLICY_SOURCE_DOMAINS_NOT_REGISTERED', POLICY_PUBLISH_ISSUES.sourceDomainsNotRegistered.message)
    // notice 不带链接，即使机构没登记域名，也必须放行。
    const notice = await create({ kind: 'notice', category: 'notice', externalUrl: undefined, ...Object.fromEntries(handlingFields.map((f) => [f, undefined])) })
    assert.equal((await publish(notice.id)).publishStatus, 'published')
    await assertVerified(notice.id, false)
    await prisma.organization.update({ where: { id: orgId }, data: { verifiedOfficialDomainsJson: POLICY_VERIFIED_DOMAINS_FIXTURE } })
    pass('无域名有链接拦截；无链接公告无需域名可发布且核验标记 false')

    for (const externalUrl of ['https://other.gov.cn/policy/1', 'http://example.gov.cn/policy/1']) {
      for (const kind of ['policy_guide', 'notice']) {
        const post = await create({ kind, category: 'notice', externalUrl })
        await denied(() => publish(post.id), 'POLICY_SOURCE_URL_NOT_VERIFIED', POLICY_PUBLISH_ISSUES.sourceUrlNotVerified.message)
      }
    }
    pass('政策/公告外站或 http 均被 POLICY_SOURCE_URL_NOT_VERIFIED 拦截')

    // 前置闸门的顺序：审核 → 责任 → 信任 → 三栏 → 链接。
    await prisma.organization.update({ where: { id: orgId }, data: { contentTrustStatus: null } })
    const untrusted = await create({ whoCanApply: undefined }, false)
    await denied(() => publish(untrusted.id), 'PUBLISH_REQUIRES_APPROVAL')
    await svc.reviewPolicy(untrusted.id, 'approve', undefined, user)
    await denied(() => svc.publishPolicy(untrusted.id, 'publish', user), 'POLICY_RESPONSIBILITY_ACK_REQUIRED')
    await denied(() => publish(untrusted.id), 'ORG_CONTENT_TRUST_REQUIRED')
    for (const status of [null, 'pending', 'suspended', 'revoked', 'active']) {
      await prisma.organization.update({ where: { id: orgId }, data: { contentTrustStatus: status, archivedAt: status === 'active' ? new Date() : null } })
      try { await publish(untrusted.id); assert.fail('未核验或归档必须拒绝') } catch (e) {
        assert(e instanceof BadRequestException)
        const error = (e.getResponse() as { error: { code: string; message: string } }).error
        assert.equal(error.code, 'ORG_CONTENT_TRUST_REQUIRED')
        assert(!/contentTrustStatus|archivedAt|sourceOrgId|\/api\/|PATCH|\{|null|active|fail-closed/.test(error.message))
        assert(error.message.includes('平台管理员'))
      }
    }
    // 没有来源机构、来源机构不存在也不能把接口字段露给人看。
    for (const sourceOrgId of [null, `missing_${suffix}`]) {
      await assert.rejects(() => assertOrgContentTrustActive(prisma as unknown as OrgTrustReader, sourceOrgId,
        { contentType: 'job', contentId: 'hidden-id' }), (e: unknown) => {
        assert(e instanceof BadRequestException)
        const error = (e.getResponse() as { error: { code: string; message: string } }).error
        assert.equal(error.code, 'ORG_CONTENT_TRUST_REQUIRED')
        assert(!/sourceOrgId|\/api\/|PATCH|\{|job|hidden-id/.test(error.message))
        return true
      })
    }
    await prisma.organization.update({ where: { id: orgId }, data: { contentTrustStatus: 'active', archivedAt: null } })
    pass('前置闸门顺序保留；所有信任拒绝消息均为人话且错误码不变')

    const published = await publish(valid.id)
    assert.equal(published.publishStatus, 'published')
    const detail = await assertVerified(valid.id, true)
    assert.equal(detail.whoCanApply, '条件第一行\n条件第二行')
    for (const field of ['requiredMaterials', 'whereToApply'] as const) assert.equal(detail[field], POLICY_PUBLISH_FIXTURE[field])
    for (const field of handlingFields) assert.equal(detail[field], (await prisma.policyPost.findUniqueOrThrow({ where: { id: valid.id } }))[field])
    await prisma.organization.update({ where: { id: orgId }, data: { verifiedOfficialDomainsJson: '[]' } })
    const afterRemoval: PolicyPostDto = await assertVerified(valid.id, false)
    assert.equal(afterRemoval.publishStatus, 'published', '域名变化只改变核验标记，不改可见性')
    pass('满足契约可发布；三栏原样读出；管理员移除域名后公开/机构读取即时变 false')

    await prisma.organization.update({ where: { id: orgId }, data: {
      verifiedOfficialDomainsJson: POLICY_VERIFIED_DOMAINS_FIXTURE, contentTrustStatus: 'active', archivedAt: null,
    } })
    const warningPrefix = '发布时会被拒，原因是：'
    const httpDraft = await svc.createPartnerPolicy(await input(CreatePolicyPostDto, { ...guideInput, externalUrl: 'http://example.gov.cn/policy/1', title: 'http 草稿' }), user)
    assert.match(httpDraft.publishWarning ?? '', new RegExp(`^${warningPrefix}`))
    assert.match(httpDraft.publishWarning ?? '', new RegExp(POLICY_PUBLISH_ISSUES.sourceUrlNotVerified.message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.equal(httpDraft.reviewStatus, 'pending')
    assert.equal(httpDraft.publishStatus, 'draft')
    const goodDraft = await svc.createPartnerPolicy(await input(CreatePolicyPostDto, { ...guideInput, title: '链接可用' }), user)
    assert.equal(goodDraft.publishWarning, null)
    const wrongHost = await svc.updatePartnerPolicy(goodDraft.id, await input(UpdatePolicyPostDto, { externalUrl: 'https://other.gov.cn/policy/1' }), user)
    assert.match(wrongHost.publishWarning ?? '', new RegExp(`^${warningPrefix}`))
    assert.equal(wrongHost.publishStatus, 'draft')
    const noticeBare = await svc.createPartnerPolicy(await input(CreatePolicyPostDto, { kind: 'notice', category: 'notice', title: '无链接公告' }), user)
    assert.equal(noticeBare.publishWarning, null)
    const noticeHttp = await svc.createPartnerPolicy(await input(CreatePolicyPostDto, { kind: 'notice', category: 'notice', title: 'http 公告', externalUrl: 'http://example.gov.cn/policy/1' }), user)
    assert.match(noticeHttp.publishWarning ?? '', new RegExp(`^${warningPrefix}`))
    const preview = await svc.previewPolicyDraft(user, await input(PolicyDraftCheckDto, { kind: 'notice', externalUrl: 'http://example.gov.cn/p' }))
    assert.equal(preview.checklistReady, true)
    assert.deepEqual(preview.columns, [])
    assert.equal(preview.publishWarning, noticeHttp.publishWarning)
    const publicDetail = await svc.getPublishedPolicyById(valid.id)
    assert.equal('publishWarning' in publicDetail.data, false)
    const editable = await input(SaveAndPublishPolicyDto, {
      ...guideInput, title: '可清空再发', summary: null, content: null, externalId: null, publishedDate: null, responsibilityAcknowledged: true,
    })
    assert.equal(editable.summary, null)
    assert.equal(editable.responsibilityAcknowledged, true)
    await assert.rejects(() => input(SaveAndPublishPolicyDto, { ...guideInput, responsibilityAcknowledged: false }), BadRequestException)
    pass('保存草稿提前提示发布会被拒的原因，不拦保存；公开读取不带这条提示')

    async function policyActions(id: string) {
      const logs = await prisma.auditLog.findMany({ where: { targetType: 'policy', targetId: id }, orderBy: { createdAt: 'asc' } })
      return logs.map((log) => log.action)
    }
    const beforeCount = await prisma.policyPost.count({ where: { sourceOrgId: orgId } })
    const acknowledgedDto = await input(SaveAndPublishPolicyDto, { ...guideInput, responsibilityAcknowledged: true })
    await denied(
      () => saveAndPublishPartnerPolicy(svc, user, acknowledgedDto, { responsibilityAcknowledged: false }),
      'POLICY_RESPONSIBILITY_ACK_REQUIRED',
      '发布前必须确认对本条政策内容负责',
    )
    assert.equal(await prisma.policyPost.count({ where: { sourceOrgId: orgId } }), beforeCount)
    const admin: AuthedUser = { userId: `policy_gate_admin_${suffix}`, role: 'admin' }
    await assert.rejects(
      () => saveAndPublishPartnerPolicy(svc, admin, acknowledgedDto, { responsibilityAcknowledged: true }),
      (e: unknown) => {
        assert(e instanceof ForbiddenException)
        const error = (e.getResponse() as { error: { code: string; message: string } }).error
        assert.equal(error.code, 'ADMIN_POLICY_PUBLISH_DISABLED')
        assert.match(error.message, /管理员/)
        return true
      },
    )
    assert.equal(await prisma.policyPost.count({ where: { sourceOrgId: orgId } }), beforeCount)
    pass('没勾选责任、管理员代发都不落库')

    const released = await saveAndPublishPartnerPolicy(svc, user, await input(SaveAndPublishPolicyDto, { ...guideInput, title: '一次发布', responsibilityAcknowledged: true }), { responsibilityAcknowledged: true })
    assert.equal(released.publishStatus, 'published')
    assert.equal('publishWarning' in released, false)
    assert.deepEqual(await policyActions(released.id), ['policy.create', 'policy.review', 'policy.publish'])
    const revised = await saveAndPublishPartnerPolicy(svc, user, await input(SaveAndPublishPolicyDto, { ...guideInput, title: '改完一次发布', responsibilityAcknowledged: true }), { id: goodDraft.id, responsibilityAcknowledged: true })
    assert.equal(revised.id, goodDraft.id)
    assert.equal(revised.publishStatus, 'published')
    assert.deepEqual(await policyActions(goodDraft.id), ['policy.create', 'policy.partner_update', 'policy.partner_update', 'policy.review', 'policy.publish'])
    pass('保存并发布一次走完，新建和编辑都留下三步审计')

    await prisma.organization.create({ data: {
      id: otherOrgId, name: '另一家验证机构', type: 'public_employment_service', contentTrustStatus: 'active',
      verifiedOfficialDomainsJson: POLICY_VERIFIED_DOMAINS_FIXTURE,
    } })
    await prisma.user.create({ data: { id: otherUserId, username: otherUserId, passwordHash: 'fixture', name: '别人', role: 'partner', orgId: otherOrgId } })
    const owned = await svc.createPartnerPolicy(await input(CreatePolicyPostDto, { ...guideInput, title: '只属于这家' }), user)
    const foreignDto = await input(SaveAndPublishPolicyDto, { ...guideInput, title: '别人来改', responsibilityAcknowledged: true })
    await assert.rejects(
      () => saveAndPublishPartnerPolicy(svc, { userId: otherUserId, role: 'partner', orgId: otherOrgId }, foreignDto, { id: owned.id, responsibilityAcknowledged: true }),
      (e: unknown) => {
        assert(e instanceof NotFoundException)
        const error = (e.getResponse() as { error: { code: string; message: string; stoppedAt: string; policyId?: string } }).error
        assert.equal(error.code, 'POLICY_NOT_FOUND')
        assert.equal(error.stoppedAt, 'save')
        assert.equal(error.policyId, undefined)
        assert.match(error.message, /这一步没有完成/)
        return true
      },
    )
    const ownedRow = await prisma.policyPost.findUniqueOrThrow({ where: { id: owned.id } })
    assert.equal(ownedRow.reviewStatus, 'pending')
    assert.equal(ownedRow.publishStatus, 'draft')
    pass('别的机构不能代为保存并发布，原记录停在保存前')

    async function stoppedAtPublish(extra: object, code: string, reason: RegExp) {
      try {
        await saveAndPublishPartnerPolicy(svc, user, await input(SaveAndPublishPolicyDto, { ...guideInput, ...extra, responsibilityAcknowledged: true }), { responsibilityAcknowledged: true })
        assert.fail('这一步应该停在发布')
      } catch (e) {
        assert(e instanceof BadRequestException)
        const error = (e.getResponse() as { error: { code: string; message: string; stoppedAt: string; policyId: string } }).error
        assert.equal(error.code, code)
        assert.equal(error.stoppedAt, 'publish')
        assert.match(error.message, /^内容已保存并通过审核，停在发布。/)
        assert.match(error.message, reason)
        const row = await prisma.policyPost.findUniqueOrThrow({ where: { id: error.policyId } })
        assert.equal(row.reviewStatus, 'approved')
        assert.equal(row.publishStatus, 'draft')
        const actions = await policyActions(error.policyId)
        assert.deepEqual(actions, ['policy.create', 'policy.review'])
        assert.ok(!actions.includes('policy.publish'))
      }
    }
    await stoppedAtPublish({ externalUrl: 'http://example.gov.cn/policy/1', title: 'http 停在发布' }, 'POLICY_SOURCE_URL_NOT_VERIFIED', /原文链接不在本机构登记的官方网站内/)
    await prisma.organization.update({ where: { id: orgId }, data: { verifiedOfficialDomainsJson: '[]' } })
    await stoppedAtPublish({ title: '没登记域名' }, 'POLICY_SOURCE_DOMAINS_NOT_REGISTERED', /还没有登记官方网站/)
    await prisma.organization.update({ where: { id: orgId }, data: { verifiedOfficialDomainsJson: POLICY_VERIFIED_DOMAINS_FIXTURE, contentTrustStatus: null } })
    await stoppedAtPublish({ title: '机构未核验' }, 'ORG_CONTENT_TRUST_REQUIRED', /平台管理员/)
    await prisma.organization.update({ where: { id: orgId }, data: { contentTrustStatus: 'active', archivedAt: null } })
    pass('发布被拒就停在发布：前面的保存和审核留下，原因用中文说明')

    console.log(`ALL PASS (${passed} groups)`)
  } finally {
    await prisma.policyPost.deleteMany({ where: { sourceOrgId: { in: [orgId, otherOrgId] } } })
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [userId, otherUserId] } } })
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } })
    await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } })
    await prisma.onModuleDestroy()
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
