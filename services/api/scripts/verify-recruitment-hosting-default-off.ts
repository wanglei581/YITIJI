/**
 * 全新环境未设置 RECRUITMENT_CONTENT_HOSTING_ENABLED 时必须关闭。
 * 不靠验证脚本路径或 VERIFICATION_DATABASE_TARGET 打开。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:recruitment-hosting-default-off
 */
import 'dotenv/config'
import { spawnSync } from 'child_process'
import { createHmac, randomBytes } from 'crypto'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { JwtService } from '@nestjs/jwt'
import type { Response } from 'express'
import { AuditService } from '../src/audit/audit.service'
import { RedisService } from '../src/common/redis/redis.service'
import { StorageService } from '../src/storage/storage.service'
import { CompaniesService } from '../src/companies/companies.service'
import { PartnerFairsController } from '../src/jobs/partner-fairs.controller'
import { AdminFairsController } from '../src/jobs/admin-fairs.controller'
import { AdminFairsService } from '../src/jobs/admin-fairs.service'
import { FairCompanyZoneService } from '../src/jobs/fair-company-zone.service'
import { FairMaterialService } from '../src/jobs/fair-material.service'
import { FairMaterialPrintBridgeService } from '../src/jobs/fair-material-print-bridge.service'
import { FairVenueGuideService } from '../src/jobs/fair-venue-guide.service'
import { signFairMaterialUrl, signFairMaterialPreviewUrl } from '../src/jobs/fair-material-signing'
import { ActivityService } from '../src/activity/activity.service'
import { ActivityController } from '../src/activity/activity.controller'
import { MeActivityController } from '../src/activity/me-activity.controller'
import { JobApplicationsService } from '../src/job-applications/job-applications.service'
import { JobApplicationsController } from '../src/job-applications/job-applications.controller'
import { KioskJobBoardService } from '../src/terminals/kiosk-job-board.service'
import { SyncService } from '../src/sync/sync.service'
import { JobsService } from '../src/jobs/jobs.service'
import { JobsPartnerService } from '../src/jobs/jobs-partner.service'
import { JobQualityService } from '../src/job-ai/job-quality.service'
import { encryptSecret } from '../src/common/crypto/secret-cipher'
import { DailyBriefService } from '../src/assistant/daily-brief.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { isRecruitmentContentHostingEnabled } from '../src/recruitment-hosting/recruitment-hosting'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

function pass(message: string) { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(`FAIL ${message}`) }

async function main() {
  assertIsolatedVerificationDatabase()
  const sniffed = isRecruitmentContentHostingEnabled(
    { VERIFICATION_DATABASE_TARGET: 'isolated' },
    ['node', 'scripts/verify-recruitment-hosting-default-off.ts'],
  )
  if (sniffed) fail('1. 未设置变量时，验证入口或 isolated 标记仍被当成打开')
  pass('1. 未设置变量时，验证入口和 isolated 标记都不打开托管')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const sfx = randomBytes(4).toString('hex')
  const orgId = `org_def_${sfx}`
  const jobId = `job_def_${sfx}`
  async function cleanup() {
    await prisma.job.deleteMany({ where: { id: jobId } }).catch(() => undefined)
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => undefined)
  }
  try {
    await cleanup()
    await prisma.organization.create({
      data: { id: orgId, name: '滨海就业服务中心（隔离验证）', type: 'school', contentTrustStatus: 'active' },
    })
    await prisma.job.create({
      data: {
        id: jobId, sourceOrgId: orgId, externalId: `def-${sfx}`, sourceName: '滨海就业服务中心',
        sourceUrl: 'https://example.com/default-off', title: '设备维护工程师', company: '海岚智能设备有限公司', city: '青岛',
        reviewStatus: 'approved', publishStatus: 'published',
      },
    })
    const env = { ...process.env }
    delete env.RECRUITMENT_CONTENT_HOSTING_ENABLED
    const child = spawnSync(
      process.execPath,
      ['-r', '@swc-node/register', 'scripts/lib/recruitment-hosting-default-probe.ts', jobId],
      { cwd: process.cwd(), env, encoding: 'utf8' },
    )
    const output = `${child.stdout ?? ''}\n${child.stderr ?? ''}`
    if (child.status !== 0 || !output.includes('PROBE_OK')) {
      fail(`2. 干净子进程未证明列表为空且详情/写入 403：${output.slice(-800)}`)
    }
    pass('2. 干净子进程：列表为空，详情与写入 403')
    await verifySevenLeaks(prisma, orgId, jobId, sfx)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }
  console.log('\nALL PASS')
}

/** 真实隔离库 + 直接构造控制器；不启动 HTTP，不依赖监听端口。 */
async function verifySevenLeaks(prisma: PrismaService, orgId: string, jobId: string, sfx: string) {
  const savedHosting = process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED
  const savedSigning = process.env.FILE_SIGNING_SECRET
  const savedEncryption = process.env.SECRET_ENCRYPTION_KEY
  process.env.FILE_SIGNING_SECRET = 'hosting-gate-signing-secret-32-characters'
  process.env.SECRET_ENCRYPTION_KEY ??= 'hosting-gate-encryption-key-32-characters'
  const hosting = (open: boolean) => { process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = String(open) }
  const fake = <T>(value: object): T => value as T
  const audit = fake<AuditService>({ write: async () => undefined })
  const user = { endUserId: `member_def_${sfx}`, sessionId: `session_def_${sfx}` }
  const partner = { userId: 'hosting-gate-partner', role: 'partner' as const, orgId }
  const companyId = `company_def_${sfx}`
  const fairId = `fair_def_${sfx}`
  const materialId = `material_def_${sfx}`
  const policyId = `policy_def_${sfx}`
  const sourceId = `source_def_${sfx}`
  const failures: string[] = []
  async function check(label: string, run: () => Promise<void>) {
    try { await run(); pass(label) }
    catch (error) {
      const message = `FAIL ${label}: ${(error as Error).message.split('\n')[0]}`
      console.error(message)
      failures.push(message)
    }
  }
  async function denied(run: () => Promise<unknown>, status = 403, code = 'RECRUITMENT_HOSTING_DISABLED') {
    let caught: unknown
    try { await run() } catch (error) { caught = error }
    assert.ok(caught, `应拒绝 ${status} ${code}，实际成功`)
    const e = caught as { getStatus(): number; getResponse(): { error: { code: string; message: string } } }
    assert.equal(e.getStatus(), status)
    assert.equal(e.getResponse().error.code, code)
    if (status === 401) assert.equal(e.getResponse().error.message, '签名无效或已过期')
  }
  try {
    await prisma.organization.update({ where: { id: orgId }, data: { type: 'school_employment_center' } })
    await prisma.endUser.create({ data: { id: user.endUserId, phoneHash: sfx, phoneEnc: 'isolated-gate', enabled: true, status: 'active' } })
    await prisma.companyProfile.create({ data: {
      id: companyId, sourceOrgId: orgId, externalId: sfx, sourceName: '滨海就业服务中心',
      name: '海岚智能设备有限公司', sourceUrl: 'https://example.com/hailan', reviewStatus: 'approved', publishStatus: 'published',
    } })
    await prisma.jobFair.create({ data: {
      id: fairId, sourceOrgId: orgId, externalId: sfx, sourceName: '滨海就业服务中心', sourceUrl: 'https://example.com/fair',
      title: '滨海装备制造专场', startAt: new Date(Date.now() + 86400000), endAt: new Date(Date.now() + 90000000),
      venue: '滨海公共服务大厅', city: '青岛', reviewStatus: 'approved', publishStatus: 'published',
    } })
    const fairCompany = await prisma.fairCompany.create({ data: { jobFairId: fairId, name: '海岚智能设备有限公司', sourceUrl: 'https://example.com/hailan' } })
    await prisma.fairZone.create({ data: { jobFairId: fairId, name: '装备制造展区' } })
    await prisma.fairMaterial.create({ data: {
      id: materialId, jobFairId: fairId, name: '装备制造专场参会指南', storageKey: `hosting-gate/${sfx}.pdf`,
      mimeType: 'application/pdf', sizeBytes: 18, sha256: 'a'.repeat(64), publishStatus: 'published',
    } })
    await prisma.fairVenueGuide.create({ data: { jobFairId: fairId, venueName: '滨海公共服务大厅' } })
    await prisma.policyPost.create({ data: {
      id: policyId, sourceOrgId: orgId, sourceName: '滨海就业服务中心', title: '技能培训补贴申领指南',
      externalUrl: 'https://example.com/policy', category: 'training', reviewStatus: 'approved', publishStatus: 'published',
    } })
    const companies = new CompaniesService(prisma, audit)
    const zones = new FairCompanyZoneService(prisma, audit)
    let storageReads = 0
    const storage = fake<StorageService>({ getObject: async () => { storageReads++; return Buffer.from('%PDF-gate-guide') } })
    const materials = new FairMaterialService(prisma, audit, storage, fake<FairMaterialPrintBridgeService>({}))
    const venue = new FairVenueGuideService(prisma, audit)
    const fairs = new AdminFairsService(prisma, audit, zones, materials, venue)
    const admin = new AdminFairsController(fairs)
    const partnerFairs = new PartnerFairsController(prisma, zones, materials, venue)

    await check('[1] 机构企业列表关闭为空；打开与管理员读取不变', async () => {
      hosting(false)
      assert.equal((await companies.partnerList(orgId)).length, 0, '关闭仍返回企业资料')
      assert.ok((await companies.adminList({})).some(row => row.id === companyId))
      assert.equal((await companies.adminGet(companyId)).id, companyId)
      hosting(true)
      assert.equal((await companies.partnerList(orgId))[0]?.id, companyId)
    })
    await check('[2] 机构子资源关闭为空且不签链接；管理员与打开行为不变', async () => {
      // 先记录打开时的真实响应；关闭时不能调用共享服务（也不能签管理员预览）。
      hosting(true)
      const expectedZones = await partnerFairs.getZones(fairId, partner)
      const expectedMaterials = await partnerFairs.getMaterials(fairId, partner)
      const expectedVenue = await partnerFairs.getVenueGuide(fairId, partner)
      assert.equal(expectedZones.data.length, 1)
      assert.equal(expectedMaterials.data.length, 1)
      assert.ok(expectedMaterials.data[0]?.previewUrl)
      assert.equal(expectedVenue.data?.venueName, '滨海公共服务大厅')
      const originalList = materials.listMaterials.bind(materials)
      let listCalls = 0
      materials.listMaterials = async id => { listCalls++; return originalList(id) }
      try {
        hosting(false)
        assert.deepEqual(await partnerFairs.getZones(fairId, partner), { data: [] }, '关闭仍返回展区')
        assert.deepEqual(await partnerFairs.getMaterials(fairId, partner), { data: [] })
        assert.deepEqual(await partnerFairs.getVenueGuide(fairId, partner), { data: null })
        assert.equal(listCalls, 0, '关闭签发了资料预览链接')
        // 机构的身份/所有权校验仍保留。
        await denied(() => partnerFairs.getZones(fairId, { ...partner, orgId: 'other-org' }), 404, 'FAIR_NOT_FOUND')
        const detail = await admin.getFairDetail(fairId)
        assert.deepEqual(detail.zones, expectedZones.data)
        assert.equal(detail.materials.length, 1)
        assert.ok(detail.materials[0]?.previewUrl)
        assert.deepEqual(await admin.getVenueGuide(fairId), expectedVenue)
        assert.equal((await zones.listZones(fairId)).length, 1)
        assert.equal((await materials.listMaterials(fairId)).length, 1)
      } finally { materials.listMaterials = originalList }
    })

    const jobBoard = new KioskJobBoardService(prisma)
    const activity = new ActivityService(prisma)
    const jwt = new JwtService({ secret: 'isolated-hosting-member-jwt' })
    const redisSession = fake<RedisService>({ get: async () => user.endUserId })
    const recorder = new ActivityController(activity, jwt, redisSession, prisma, jobBoard)
    const me = new MeActivityController(activity, audit, jobBoard)
    const req = { headers: { authorization: `Bearer ${jwt.sign({ sub: user.endUserId, jti: user.sessionId }, { audience: 'enduser' })}` } }
    const targets = [
      { type: 'company_profile', id: companyId, action: 'external_open' },
      { type: 'fair_company', id: fairCompany.id, action: 'external_apply' },
      { type: 'job', id: jobId, action: 'external_apply' },
      { type: 'job_fair', id: fairId, action: 'external_appointment' },
      { type: 'policy', id: policyId, action: 'external_open' },
    ]
    await check('[3] 四类招聘足迹关闭禁报禁查并排除；政策和打开不变', async () => {
      hosting(true)
      for (const target of targets) {
        assert.equal((await recorder.browse({ targetType: target.type, targetId: target.id }, req)).data?.recorded, true)
        assert.equal((await recorder.externalJump({ targetType: target.type, targetId: target.id, action: target.action }, req)).data?.recorded, true)
        assert.equal((await me.browseLogs(user, undefined, '50', target.type)).data?.items.length, 1)
        assert.equal((await me.jumpLogs(user, undefined, '50', target.type)).data?.items.length, 1)
      }
      hosting(false)
      for (const target of targets.filter(t => t.type !== 'policy')) {
        await denied(() => recorder.browse({ targetType: target.type, targetId: target.id }, req))
        await denied(() => recorder.externalJump({ targetType: target.type, targetId: target.id, action: target.action }, req))
        await denied(() => me.browseLogs(user, undefined, '50', target.type))
        await denied(() => me.jumpLogs(user, undefined, '50', target.type))
      }
      assert.equal((await recorder.browse({ targetType: 'policy', targetId: policyId }, req)).data?.recorded, true)
      assert.equal((await recorder.externalJump({ targetType: 'policy', targetId: policyId, action: 'external_open' }, req)).data?.recorded, true)
      for (const list of [me.browseLogs.bind(me), me.jumpLogs.bind(me)]) {
        const page = (await list(user, undefined, '50')).data!
        assert.ok(page.items.length > 0)
        assert.ok(page.items.every(item => item.targetType === 'policy'))
        assert.ok((await list(user, undefined, '50', 'policy')).data!.items.length > 0)
      }
    })

    const applications = new JobApplicationsController(new JobApplicationsService(prisma), jobBoard)
    await check('[4-self] 关闭时自填新建、列表、修改、删除不受影响；打开不变', async () => {
      for (const open of [false, true]) {
        hosting(open)
        const row = (await applications.create(user, { companyName: '海岚智能设备有限公司', positionTitle: '设备维护工程师' })).data!
        assert.equal(row.jobId, null)
        assert.ok((await applications.list(user)).data!.items.some(item => item.id === row.id))
        assert.equal((await applications.update(user, row.id, { status: 'interviewing' })).data!.status, 'interviewing')
        assert.equal((await applications.remove(user, row.id)).data!.removed, true)
      }
    })
    await check('[4] 关闭拒绝关联岗位新建且早于板块检查；列表隐藏旧关联行；打开不变', async () => {
      hosting(true)
      const linked = (await applications.create(user, { jobId })).data!
      assert.equal(linked.jobId, jobId)
      assert.ok((await applications.list(user)).data!.items.some(item => item.id === linked.id))
      const originalAssert = jobBoard.assertOpen.bind(jobBoard)
      let boardCalls = 0
      jobBoard.assertOpen = async () => { boardCalls++ }
      try {
        hosting(false)
        await denied(() => applications.create(user, { jobId }))
        assert.equal(boardCalls, 0, '托管判断晚于岗位板块检查')
        assert.ok(!(await applications.list(user)).data!.items.some(item => item.id === linked.id))
        assert.equal((await prisma.jobApplication.findUnique({ where: { id: linked.id } }))?.jobId, jobId)
      } finally { jobBoard.assertOpen = originalAssert }
    })

    await check('[5] 旧一体机链接关闭失效；管理员签名可读；伪造 scope 拒绝；打开兼容', async () => {
      hosting(true)
      const kioskUrl = new URL(signFairMaterialUrl(materialId).url, 'https://example.com')
      const previewUrl = new URL(signFairMaterialPreviewUrl(materialId), 'https://example.com')
      assert.ok(Number(kioskUrl.searchParams.get('expires')) - Date.now() > 29 * 60 * 1000)
      assert.ok(Number(previewUrl.searchParams.get('expires')) - Date.now() <= 10 * 60 * 1000)
      const response = fake<Response>({ setHeader: () => undefined, send: () => undefined })
      const serve = (url: URL) => admin.serveMaterialContent(materialId, url.searchParams.get('expires')!, url.searchParams.get('sig')!, response, url.searchParams.get('scope') ?? undefined)
      await serve(kioskUrl)
      await serve(previewUrl)
      hosting(false)
      const reads = storageReads
      await denied(() => serve(kioskUrl), 401, 'MATERIAL_SIGNATURE_INVALID')
      assert.equal(storageReads, reads, '签名拒绝后仍读取存储')
      assert.equal(previewUrl.searchParams.get('scope'), 'admin')
      await serve(previewUrl)
      assert.equal(storageReads, reads + 1)
      kioskUrl.searchParams.set('scope', 'admin')
      await denied(() => serve(kioskUrl), 401, 'MATERIAL_SIGNATURE_INVALID')
      hosting(true)
      await denied(() => serve(kioskUrl), 401, 'MATERIAL_SIGNATURE_INVALID')
      previewUrl.searchParams.delete('scope')
      await denied(() => serve(previewUrl), 401, 'MATERIAL_SIGNATURE_INVALID')
    })

    const webhookSecret = 'isolated-source-webhook-secret'
    await prisma.jobSource.create({ data: {
      id: sourceId, orgId, name: '滨海装备制造岗位源', sourceKind: 'school', accessMode: 'webhook',
      webhookSecret: encryptSecret(webhookSecret), lastSyncAt: new Date('2026-09-01T00:00:00Z'), lastSyncStatus: 'success',
    } })
    let nonces = 0
    const syncRedis = fake<RedisService>({ setNxEx: async () => { nonces++; return true } })
    const jobsPartner = new JobsPartnerService(prisma, audit, fake<JobQualityService>({ refreshJobQualitySnapshots: async () => undefined }))
    const jobs = new JobsService(undefined!, undefined!, jobsPartner, undefined!)
    const sync = new SyncService(prisma, jobs, audit, syncRedis)
    const webhook = () => {
      const parsed = { items: [{ externalId: `webhook-${sfx}`, title: '设备维护工程师', company: '海岚智能设备有限公司', city: '青岛', sourceUrl: 'https://example.com/maintenance' }] }
      const rawBody = JSON.stringify(parsed)
      const ts = String(Math.floor(Date.now() / 1000))
      return { sourceId, timestampHeader: ts, nonceHeader: `nonce-${sfx}-${nonces}`, signatureHeader: createHmac('sha256', webhookSecret).update(`${ts}.${rawBody}`).digest('hex'), rawBody, parsed, ip: null, userAgent: null, requestId: null }
    }
    await check('[6] Webhook 关闭拒绝且来源/日志/时间/nonce 零写入；打开正常导入', async () => {
      hosting(false)
      const before = { source: await prisma.jobSource.findUnique({ where: { id: sourceId } }), sources: await prisma.jobSource.count(), logs: await prisma.syncLog.count(), jobs: await prisma.job.count() }
      await denied(() => sync.handleWebhook(webhook()))
      assert.deepEqual(await prisma.jobSource.findUnique({ where: { id: sourceId } }), before.source, '关闭仍更新 lastSyncAt/lastSyncStatus')
      assert.equal(await prisma.jobSource.count(), before.sources)
      assert.equal(await prisma.syncLog.count(), before.logs, '关闭仍新增 syncLog')
      assert.equal(await prisma.job.count(), before.jobs)
      assert.equal(nonces, 0, '关闭仍消费 Redis nonce')
      hosting(true)
      assert.equal((await sync.handleWebhook(webhook())).imported, 1)
      assert.equal(nonces, 1)
      assert.equal(await prisma.syncLog.count(), before.logs + 1)
      assert.equal(await prisma.job.count(), before.jobs + 1)
      assert.equal((await prisma.jobSource.findUnique({ where: { id: sourceId } }))?.lastSyncStatus, 'success')
    })

    await check('[7] 早报关闭不查岗位且政策路由正确；打开计数和岗位路由不变', async () => {
      assert.ok(existsSync(resolve(__dirname, '../../../apps/miniapp/pages/policies/policies.js')))
      const count = prisma.job.count.bind(prisma.job)
      let jobQueries = 0
      prisma.job.count = ((...args: Parameters<typeof count>) => { jobQueries++; return count(...args) }) as typeof prisma.job.count
      const daily = new DailyBriefService(prisma, fake<RedisService>({ get: async () => null, setEx: async () => undefined }))
      try {
        hosting(false)
        const closed = await daily.create(user.endUserId, '青岛')
        assert.equal(jobQueries, 0, '关闭仍查询岗位表')
        const city = closed.modules.find(module => module.type === 'city_new')!
        assert.equal(city.type, 'city_new')
        if (city.type !== 'city_new') throw new Error('缺少城市早报')
        assert.equal(city.newJobs, 0)
        assert.ok(city.newPolicies > 0)
        assert.equal(city.route, '/pages/policies/policies')
        assert.ok(!JSON.stringify(closed).includes('/pages/jobs/'))
        hosting(true)
        const opened = await daily.create(user.endUserId, '青岛')
        assert.equal(jobQueries, 1)
        const openCity = opened.modules.find(module => module.type === 'city_new')!
        assert.equal(openCity.type, 'city_new')
        if (openCity.type !== 'city_new') throw new Error('缺少城市早报')
        assert.ok(openCity.newJobs > 0)
        assert.equal(openCity.route, '/pages/jobs/jobs')
      } finally { prisma.job.count = count }
    })
  } finally {
    await prisma.browseLog.deleteMany({ where: { endUserId: user.endUserId } })
    await prisma.externalJumpLog.deleteMany({ where: { endUserId: user.endUserId } })
    await prisma.jobApplication.deleteMany({ where: { endUserId: user.endUserId } })
    await prisma.endUser.deleteMany({ where: { id: user.endUserId } })
    await prisma.syncLog.deleteMany({ where: { sourceId } })
    await prisma.job.deleteMany({ where: { sourceId } })
    await prisma.jobSource.deleteMany({ where: { id: sourceId } })
    await prisma.policyPost.deleteMany({ where: { id: policyId } })
    await prisma.jobFair.deleteMany({ where: { id: fairId } })
    await prisma.companyProfile.deleteMany({ where: { id: companyId } })
    for (const [key, value] of Object.entries({ RECRUITMENT_CONTENT_HOSTING_ENABLED: savedHosting, FILE_SIGNING_SECRET: savedSigning, SECRET_ENCRYPTION_KEY: savedEncryption })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  if (failures.length) fail(`${failures.length} 项招聘托管漏点断言失败`)
}

main().catch((error: unknown) => {
  console.error((error as Error).message)
  process.exit(1)
})
