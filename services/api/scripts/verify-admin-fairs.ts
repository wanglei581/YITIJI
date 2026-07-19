/**
 * 阶段1A — Admin 招聘会管理(内容运营)验证。
 *
 * 覆盖(对应需求验收点):
 *   1.  列表 + 计数:listFairs 返回测试招聘会,companies/zones/materials 计数正确。
 *   2.  基本信息编辑:updateFairInfo 落库;来源字段(sourceName/externalId/sourceUrl)不被改动;
 *       startAt >= endAt → INVALID_TIME_RANGE 拒绝。
 *   3.  参展企业 CRUD:create → detail 可见 → update 生效 → delete 后消失;
 *       不存在 fair → FAIR_NOT_FOUND;跨 fair 操作 → COMPANY_NOT_FOUND。
 *   4.  展区 CRUD:同企业,跨 fair → ZONE_NOT_FOUND。
 *   5.  资料上传:合法 PDF 落 storage(storageKey 非 pending、对象可读回);
 *       伪装 MIME / 非法格式 → MATERIAL_TYPE_UNSUPPORTED;超大 → MATERIAL_TOO_LARGE。
 *   6.  Kiosk 可见性:draft 不出现在公开列表;publish 后出现(fair 须 approved+published);
 *       unpublish 后消失;fair 下架后公开列表为空。
 *   7.  响应不暴露存储路径:公开/管理资料 DTO 无 storageKey/sha256,previewUrl 为签名短时 URL。
 *   8.  签名:正确签名通过;错误签名 / 过期拒绝。
 *   9.  删除资料:软删 + 公开列表消失 + readMaterialContent → MATERIAL_NOT_FOUND。
 *   10. 审计:fair.update / fair.material.upload 等动作落 AuditLog。
 *   11. 统计:getAdminStats 计数与真实行数一致。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:admin-fairs
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'

// 签名密钥:验证脚本独立运行,若 .env 未配则给测试值(仅本进程内存,不落盘)。
if (!process.env['FILE_SIGNING_SECRET'] || process.env['FILE_SIGNING_SECRET'].length < 32) {
  process.env['FILE_SIGNING_SECRET'] = 'verify-admin-fairs-test-secret-0123456789abcdef'
}
// 验证脚本强制本地存储,绝不把测试文件写入生产 COS。
process.env['FILE_STORAGE_DRIVER'] = 'local'

import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { FilesService } from '../src/files/files.service'
import { verifyFileSignature } from '../src/files/signing'
import { AdminFairsService } from '../src/jobs/admin-fairs.service'
import { FairCompanyZoneService } from '../src/jobs/fair-company-zone.service'
import { FairMaterialService } from '../src/jobs/fair-material.service'
import { FairVenueGuideService } from '../src/jobs/fair-venue-guide.service'
import { JobsService } from '../src/jobs/jobs.service'
import { FairMaterialPrintBridgeService } from '../src/jobs/fair-material-print-bridge.service'
import { JobQualityService } from '../src/job-ai/job-quality.service'
import { signFairMaterialUrl, verifyFairMaterialSignature } from '../src/jobs/fair-material-signing'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { PricingService } from '../src/payment/pricing.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import { cleanFairVerifyResidue } from './lib/verify-fair-residue'

// 稳定且唯一的残留标记(跨运行不变):嵌进机构 id 与管理员 username,开始前预清 + finally 再清。
const RESIDUE_TAG = 'vresidadminfairs'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望错误 ${code},但调用成功`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code},实际: ${c ?? (e as Error).message}`)
  }
}

/** 最小合法 PDF 字节(%PDF magic + EOF),足够通过魔数校验。 */
function tinyPdf(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1')
}

function sizedPdf(sizeBytes: number, marker = 0x20): Buffer {
  const header = Buffer.from('%PDF-1.4\n', 'latin1')
  const footer = Buffer.from('\n%%EOF\n', 'latin1')
  if (sizeBytes < header.length + footer.length) throw new Error('PDF fixture size too small')
  return Buffer.concat([header, Buffer.alloc(sizeBytes - header.length - footer.length, marker), footer])
}

async function cleanBridgeResidue(
  prisma: PrismaService,
  storage: StorageService,
  tag: string,
): Promise<void> {
  const orgs = await prisma.organization.findMany({ where: { id: { contains: tag } }, select: { id: true } })
  const orgIds = orgs.map((org) => org.id)
  if (orgIds.length > 0) {
    const materials = await prisma.fairMaterial.findMany({
      where: { jobFair: { sourceOrgId: { in: orgIds } } },
      select: { id: true },
    })
    const materialIds = materials.map((material) => material.id)
    if (materialIds.length > 0) {
      const bridges = await prisma.fairMaterialPrintBridge.findMany({
        where: { materialId: { in: materialIds } },
        include: { fileObject: true },
      })
      for (const bridge of bridges) {
        if (bridge.fileObject) {
          await storage.deleteObject(bridge.fileObject.storageKey, bridge.fileObject.bucket).catch(() => undefined)
        }
      }
      const fileIds = bridges.flatMap((bridge) => bridge.fileObjectId ? [bridge.fileObjectId] : [])
      await prisma.fairMaterialPrintBridge.deleteMany({ where: { materialId: { in: materialIds } } })
      if (fileIds.length > 0) await prisma.fileObject.deleteMany({ where: { id: { in: fileIds } } })
    }
  }
  await cleanFairVerifyResidue(prisma, tag)
}

async function main() {
  console.log('\n=== 阶段1A Admin 招聘会管理(内容运营)验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const files = new FilesService(prisma, audit, storage)
  const bridge = new FairMaterialPrintBridgeService(prisma, storage, files)
  const companyZone = new FairCompanyZoneService(prisma, audit)
  const materialSvc = new FairMaterialService(prisma, audit, storage, bridge)
  const venueGuide = new FairVenueGuideService(prisma, audit)
  const svc = new AdminFairsService(prisma, audit, companyZone, materialSvc, venueGuide)
  const jobs = new JobsService(prisma, audit, new JobQualityService(prisma), bridge)

  // 预清:收掉上一次被强杀/锁超时漏删的本脚本残留(按稳定 tag)。
  await cleanBridgeResidue(prisma, storage, RESIDUE_TAG)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const orgId = `org_vaf_${RESIDUE_TAG}_${suffix}`

  // AuditLog.actorId 有 FK → User,须建真实测试管理员行(脚本结束清理)。username 含稳定 tag 便于残留清理。
  const adminRow = await prisma.user.create({
    data: { username: `${RESIDUE_TAG}_admin_${suffix}`, passwordHash: 'x', name: '验证管理员', role: 'admin' },
  })
  const adminUser: AuthedUser = { userId: adminRow.id, role: 'admin', orgId: null }

  // ── 测试数据:机构 + 两场招聘会(一场已发布、一场待审核)────────────────
  await prisma.organization.create({ data: { id: orgId, name: `验证机构_${suffix}`, type: 'gov' } })
  const fairPublished = await prisma.jobFair.create({
    data: {
      sourceOrgId: orgId, externalId: `VAF-PUB-${suffix}`, sourceName: '验证来源', sourceUrl: 'https://example.org/f1',
      title: '验证招聘会(已发布)', theme: 'general',
      startAt: new Date(Date.now() + 86400_000), endAt: new Date(Date.now() + 90000_000),
      venue: '验证展馆', city: '验证市',
      reviewStatus: 'approved', publishStatus: 'published',
    },
  })
  const fairDraft = await prisma.jobFair.create({
    data: {
      sourceOrgId: orgId, externalId: `VAF-DRAFT-${suffix}`, sourceName: '验证来源', sourceUrl: 'https://example.org/f2',
      title: '验证招聘会(待审核)', theme: 'campus',
      startAt: new Date(Date.now() + 86400_000), endAt: new Date(Date.now() + 90000_000),
      venue: '验证展馆2', city: '验证市',
      reviewStatus: 'pending', publishStatus: 'draft',
    },
  })

  // 按稳定 tag 清理:机构名下 fair(级联删 FairMaterial 等子表)+ 该 tag 的管理员及审计日志 + 机构。
  const cleanup = async () => cleanBridgeResidue(prisma, storage, RESIDUE_TAG)

  try {
    // ── 1. 列表 + 计数 ─────────────────────────────────────────────────────
    {
      const list = await svc.listFairs()
      const hit = list.find((f) => f.id === fairPublished.id)
      if (!hit) fail('1. listFairs 未包含测试招聘会')
      if (hit.counts.companies !== 0 || hit.counts.zones !== 0 || hit.counts.materials !== 0) {
        fail(`1. 初始计数应全 0,实际 ${JSON.stringify(hit.counts)}`)
      }
      pass('1. listFairs 返回测试招聘会,初始计数为 0')
    }

    // ── 2. 基本信息编辑 ────────────────────────────────────────────────────
    {
      const updated = await svc.updateFairInfo(fairPublished.id, { title: '验证招聘会(改名)', venue: '新展馆' }, adminUser)
      if (updated.title !== '验证招聘会(改名)' || updated.venue !== '新展馆') fail('2. 编辑未生效')
      if (updated.sourceName !== '验证来源' || updated.externalId !== `VAF-PUB-${suffix}`) fail('2. 来源字段被意外改动')
      pass('2a. 基本信息编辑落库,来源字段不变')

      await expectCode(
        () => svc.updateFairInfo(fairPublished.id, { startAt: new Date(Date.now() + 90000_000).toISOString(), endAt: new Date(Date.now() + 86400_000).toISOString() }, adminUser),
        'INVALID_TIME_RANGE',
        '2b. startAt >= endAt 被拒绝',
      )
    }

    // ── 3. 参展企业 CRUD ───────────────────────────────────────────────────
    let companyId: string
    {
      const created = await svc.createCompany(fairPublished.id, { name: '验证企业', industry: '软件', hiringTags: '校招,实习', jobsCount: 3 }, adminUser)
      companyId = created.id
      if (created.hiringTags.join(',') !== '校招,实习') fail('3. hiringTags 映射错误')

      const updated = await svc.updateCompany(fairPublished.id, companyId, { name: '验证企业(改)', jobsCount: 5 }, adminUser)
      if (updated.name !== '验证企业(改)' || updated.jobsCount !== 5) fail('3. 企业编辑未生效')

      const detail = await svc.getFairDetail(fairPublished.id)
      if (!detail.companies.some((c) => c.id === companyId)) fail('3. detail 未包含新企业')
      pass('3a. 企业 create/update/detail 可见')

      await expectCode(() => svc.createCompany('no_such_fair', { name: 'x' }, adminUser), 'FAIR_NOT_FOUND', '3b. 不存在的招聘会 → FAIR_NOT_FOUND')
      await expectCode(() => svc.updateCompany(fairDraft.id, companyId, { name: 'x' }, adminUser), 'COMPANY_NOT_FOUND', '3c. 跨招聘会企业操作 → COMPANY_NOT_FOUND')

      await svc.deleteCompany(fairPublished.id, companyId, adminUser)
      const after = await svc.getFairDetail(fairPublished.id)
      if (after.companies.some((c) => c.id === companyId)) fail('3. 删除后企业仍存在')
      pass('3d. 企业删除生效')
    }

    // ── 4. 展区 CRUD ───────────────────────────────────────────────────────
    {
      const created = await svc.createZone(fairPublished.id, { name: 'A区 验证', category: 'innovation', sortOrder: 1 }, adminUser)
      const updated = await svc.updateZone(fairPublished.id, created.id, { name: 'A区 验证(改)', sortOrder: 2 }, adminUser)
      if (updated.name !== 'A区 验证(改)' || updated.sortOrder !== 2) fail('4. 展区编辑未生效')
      await expectCode(() => svc.updateZone(fairDraft.id, created.id, { name: 'x' }, adminUser), 'ZONE_NOT_FOUND', '4a. 跨招聘会展区操作 → ZONE_NOT_FOUND')
      await svc.deleteZone(fairPublished.id, created.id, adminUser)
      const detail = await svc.getFairDetail(fairPublished.id)
      if (detail.zones.length !== 0) fail('4. 删除后展区仍存在')
      pass('4b. 展区 create/update/delete 生效')
    }

    // ── 5. 资料上传(校验 + 落地)─────────────────────────────────────────
    let materialId: string
    {
      const created = await svc.uploadMaterial({
        fairId: fairPublished.id, buffer: tinyPdf(), declaredMime: 'application/pdf',
        name: '验证日程', type: 'schedule', pageCount: 2, user: adminUser,
      })
      materialId = created.id
      const row = await prisma.fairMaterial.findUnique({ where: { id: materialId } })
      if (!row || row.storageKey.startsWith('pending:')) fail('5. storageKey 未落正式键')
      if (!row.sha256 || row.sha256.length < 16) fail('5. sha256 未计算')
      const readBack = await storage.getObject(row.storageKey)
      if (!readBack.subarray(0, 4).equals(Buffer.from('%PDF', 'latin1'))) fail('5. 对象读回内容不符')
      pass('5a. PDF 上传落 storage,sha256 已计算,对象可读回')

      await expectCode(
        () => svc.uploadMaterial({ fairId: fairPublished.id, buffer: Buffer.from('plain text not pdf'), declaredMime: 'application/pdf', name: 'x', user: adminUser }),
        'MATERIAL_TYPE_UNSUPPORTED',
        '5b. 伪装 PDF 的文本文件被拒(魔数校验)',
      )
      await expectCode(
        () => svc.uploadMaterial({ fairId: fairPublished.id, buffer: Buffer.alloc(21 * 1024 * 1024, 0x25), declaredMime: 'application/pdf', name: 'x', user: adminUser }),
        'MATERIAL_TOO_LARGE',
        '5c. 超过 20MB 被拒',
      )
    }

    // ── 6+7. Kiosk 可见性 + 不暴露存储路径 ────────────────────────────────
    {
      const before = await svc.getPublishedFairMaterials(fairPublished.id, 1, 20)
      if (before.data.some((m) => m.id === materialId)) fail('6. draft 资料不应出现在公开列表')
      pass('6a. draft 资料不出现在 Kiosk 公开列表')

      await svc.publishMaterial(fairPublished.id, materialId, 'publish', adminUser)
      const after = await svc.getPublishedFairMaterials(fairPublished.id, 1, 20)
      const item = after.data.find((m) => m.id === materialId)
      if (!item) fail('6. publish 后资料未出现在公开列表')
      pass('6b. publish 后资料出现在 Kiosk 公开列表')

      const raw = JSON.stringify(item)
      if (raw.includes('storageKey') || raw.includes('sha256') || raw.includes('partners/')) fail('7. 公开 DTO 泄露存储信息')
      if (!item.previewUrl || !item.previewUrl.includes('expires=') || !item.previewUrl.includes('sig=')) fail('7. previewUrl 不是签名 URL')
      pass('7. 公开 DTO 不含存储路径,previewUrl 为签名短时 URL')

      // ── 7a. 打印桥接:内部 intent 校验、完整性、复用、single-flight、撤销与回收。 ──
      const printCountBefore = (await prisma.fairMaterial.findUniqueOrThrow({ where: { id: materialId } })).printCount
      const printable = await svc.prepareFairMaterialPrint(fairPublished.id, materialId)
      if (printable.fileId === materialId) fail('7a. 不得把 FairMaterial id 冒充 FileObject id')
      const printUrl = new URL(printable.printFileUrl, 'http://internal.local')
      const expires = printUrl.searchParams.get('expires')
      const sig = printUrl.searchParams.get('sig')
      if (!expires || !sig || !verifyFileSignature(printable.fileId, expires, sig)) fail('7a. printFileUrl 必须是有效内部 HMAC URL')
      const printFile = await prisma.fileObject.findUnique({ where: { id: printable.fileId } })
      if (!printFile || printFile.assetCategory !== 'derived' || printFile.retentionPolicy !== 'system_short' || !printFile.expiresAt) {
        fail('7a. 打印桥接必须创建 derived + system_short 的短期 FileObject')
      }
      const ttlMs = printFile.expiresAt.getTime() - Date.now()
      if (ttlMs < 59 * 60_000 || ttlMs > 61 * 60_000) fail(`7a. bridge FileObject TTL 应明确为约60分钟,实际 ${ttlMs}ms`)
      if (printFile.mimeType !== 'application/pdf' || printFile.sizeBytes !== Buffer.byteLength(tinyPdf())) {
        fail('7a. 打印桥接 FileObject 元数据不符')
      }
      const serialReuse = await svc.prepareFairMaterialPrint(fairPublished.id, materialId)
      if (serialReuse.fileId !== printable.fileId) fail('7a. 同一 materialId+sourceSha256 串行请求必须复用同一 FileObject')
      const printCountAfter = (await prisma.fairMaterial.findUniqueOrThrow({ where: { id: materialId } })).printCount
      if (printCountAfter !== printCountBefore) fail('7a. 准备打印不得计入 FairMaterial.printCount')
      pass('7a. 有效HMAC URL + 60分钟derived/system_short FileObject + 串行复用且不计printCount')

      const proxyOversize = sizedPdf(15 * 1024 * 1024 + 1)
      await expectCode(
        () => files.upload({
          buffer: proxyOversize,
          filename: 'proxy-oversize.pdf',
          mimeType: 'application/pdf',
          purpose: 'fair_material',
          uploaderId: null,
          createdBy: null,
        }),
        'FILE_TOO_LARGE',
        '7b. 外部 proxy 仍拒绝 15MiB+1',
      )

      const bridge15 = await svc.uploadMaterial({
        fairId: fairPublished.id,
        buffer: proxyOversize,
        declaredMime: 'application/pdf',
        name: '15MiB+1 bridge fixture.pdf',
        type: 'brochure',
        user: adminUser,
      })
      await svc.publishMaterial(fairPublished.id, bridge15.id, 'publish', adminUser)
      const bridge15Print = await svc.prepareFairMaterialPrint(fairPublished.id, bridge15.id)
      if (bridge15Print.sizeBytes !== proxyOversize.length) fail('7c. 15MiB+1 bridge 大小不符')
      pass('7c. 15MiB+1 内部 bridge 使用 intent 校验并成功')

      const maxPdf = sizedPdf(20 * 1024 * 1024, 0x21)
      const concurrentMaterial = await svc.uploadMaterial({
        fairId: fairPublished.id,
        buffer: maxPdf,
        declaredMime: 'application/pdf',
        name: '20MiB single-flight fixture.pdf',
        type: 'brochure',
        user: adminUser,
      })
      await svc.publishMaterial(fairPublished.id, concurrentMaterial.id, 'publish', adminUser)
      const concurrentRow = await prisma.fairMaterial.findUniqueOrThrow({ where: { id: concurrentMaterial.id } })
      const originalGetObject = storage.getObject.bind(storage)
      let releaseRead!: () => void
      const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
      storage.getObject = async (objectKey: string, bucket?: string | null) => {
        if (objectKey === concurrentRow.storageKey) await readGate
        return originalGetObject(objectKey, bucket)
      }
      try {
        const leader = svc.prepareFairMaterialPrint(fairPublished.id, concurrentMaterial.id)
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const creating = await prisma.fairMaterialPrintBridge.findFirst({
            where: { materialId: concurrentMaterial.id, status: 'creating' },
          })
          if (creating) break
          await new Promise((resolve) => setTimeout(resolve, 10))
          if (attempt === 99) fail('7d. single-flight leader 未取得数据库 lease')
        }
        const followers = await Promise.allSettled(
          Array.from({ length: 4 }, () => svc.prepareFairMaterialPrint(fairPublished.id, concurrentMaterial.id)),
        )
        for (const follower of followers) {
          if (follower.status !== 'rejected' || errCode(follower.reason) !== 'MATERIAL_PRINT_PREPARING') {
            fail(`7d. 创建中的并发请求必须409 MATERIAL_PRINT_PREPARING,实际 ${follower.status}`)
          }
        }
        releaseRead()
        const leaderResult = await leader
        if (leaderResult.sizeBytes !== maxPdf.length) fail('7d. 20MiB bridge 大小不符')
        const reused = await Promise.all(
          Array.from({ length: 4 }, () => svc.prepareFairMaterialPrint(fairPublished.id, concurrentMaterial.id)),
        )
        if (reused.some((result) => result.fileId !== leaderResult.fileId)) fail('7d. 并发后复用出现多个 fileId')
        const activeBridges = await prisma.fairMaterialPrintBridge.findMany({
          where: { materialId: concurrentMaterial.id, status: 'ready', revokedAt: null },
        })
        const activeFiles = await prisma.fileObject.count({
          where: { id: { in: activeBridges.flatMap((row) => row.fileObjectId ? [row.fileObjectId] : []) }, deletedAt: null },
        })
        if (activeBridges.length !== 1 || activeFiles !== 1) fail('7d. single-flight 产生了多个活跃 bridge/FileObject')
        pass('7d. 20MiB bridge 成功；并发single-flight仅一个活跃FileObject，创建中返回409')
      } finally {
        releaseRead()
        storage.getObject = originalGetObject
      }

      const tampered = await svc.uploadMaterial({
        fairId: fairPublished.id,
        buffer: tinyPdf(),
        declaredMime: 'application/pdf',
        name: 'integrity fixture.pdf',
        type: 'schedule',
        user: adminUser,
      })
      await svc.publishMaterial(fairPublished.id, tampered.id, 'publish', adminUser)
      const tamperedRow = await prisma.fairMaterial.findUniqueOrThrow({ where: { id: tampered.id } })
      await storage.putObject(tamperedRow.storageKey, sizedPdf(tamperedRow.sizeBytes, 0x41), tamperedRow.mimeType)
      await expectCode(
        () => svc.prepareFairMaterialPrint(fairPublished.id, tampered.id),
        'MATERIAL_INTEGRITY_FAILED',
        '7e. 源对象SHA-256篡改被拒绝',
      )
      const tamperedBridge = await prisma.fairMaterialPrintBridge.findFirst({ where: { materialId: tampered.id } })
      if (tamperedBridge?.fileObjectId) fail('7e. 完整性失败不得生成 FileObject')

      await expectCode(
        () => svc.prepareFairMaterialPrint(fairDraft.id, materialId),
        'MATERIAL_NOT_PRINTABLE',
        '7f. 未发布招聘会资料不得桥接打印',
      )
      await svc.updateMaterial(fairPublished.id, materialId, { allowPrint: false }, adminUser)
      await expectCode(
        () => svc.prepareFairMaterialPrint(fairPublished.id, materialId),
        'MATERIAL_NOT_PRINTABLE',
        '7g. allowPrint=false 不得桥接打印',
      )
      const revokedForAllowPrint = await prisma.fairMaterialPrintBridge.findFirst({
        where: { materialId, fileObjectId: printable.fileId },
        include: { fileObject: true },
      })
      if (!revokedForAllowPrint?.revokedAt || revokedForAllowPrint.status !== 'revoked' || !revokedForAllowPrint.fileObject?.deletedAt) {
        fail('7g. allowPrint=false 必须立即撤销bridge并清理无活跃任务的FileObject')
      }
      await svc.updateMaterial(fairPublished.id, materialId, { allowPrint: true }, adminUser)

      const fairDelivery = await svc.prepareFairMaterialPrint(fairPublished.id, materialId)
      await jobs.publishFairSource(fairPublished.id, 'unpublish', adminUser)
      const revokedForFair = await prisma.fairMaterialPrintBridge.findFirst({
        where: { materialId, fileObjectId: fairDelivery.fileId },
      })
      if (!revokedForFair?.revokedAt || revokedForFair.status !== 'revoked') {
        fail('7h. 招聘会整体下架必须立即撤销其资料 bridge')
      }
      const printJobsForFair = new PrintJobsService(
        prisma,
        audit,
        new PrintPageCountService(prisma, storage),
        new PricingService(prisma),
        new OrderStatusService(prisma, audit),
    new TerminalCapabilitiesService(prisma),
  )
      await expectCode(
        () => printJobsForFair.create({ fileUrl: fairDelivery.printFileUrl }, { terminalId: 'not-reached-for-revoked-fair' }),
        'PRINT_FILE_REVOKED',
        '7h. 招聘会整体下架后旧 HMAC URL 不得创建新任务',
      )
      await jobs.publishFairSource(fairPublished.id, 'publish', adminUser)

      const activeDelivery = await svc.prepareFairMaterialPrint(fairPublished.id, materialId)
      const task = await prisma.printTask.create({
        data: {
          id: `pt_vaf_${suffix}`,
          fileUrl: activeDelivery.printFileUrl,
          fileMd5: 'verify-only',
          status: 'pending',
        },
      })
      await svc.publishMaterial(fairPublished.id, materialId, 'unpublish', adminUser)
      const retained = await prisma.fileObject.findUniqueOrThrow({ where: { id: activeDelivery.fileId } })
      if (retained.deletedAt) fail('7h. 有pending任务时下架不得破坏履约FileObject')
      const printJobs = new PrintJobsService(
        prisma,
        audit,
        new PrintPageCountService(prisma, storage),
        new PricingService(prisma),
        new OrderStatusService(prisma, audit),
    new TerminalCapabilitiesService(prisma),
  )
      await expectCode(
        () => printJobs.create({ fileUrl: activeDelivery.printFileUrl }, { terminalId: 'not-reached-for-revoked-file' }),
        'PRINT_FILE_REVOKED',
        '7h. 下架后旧 HMAC URL 不得借履约保留窗口创建新任务',
      )
      await prisma.printTask.update({ where: { id: task.id }, data: { status: 'completed', completedAt: new Date() } })
      await bridge.cleanupStaleBridges()
      const reclaimed = await prisma.fileObject.findUniqueOrThrow({ where: { id: activeDelivery.fileId } })
      if (!reclaimed.deletedAt) fail('7h. 任务终态后清理任务必须回收已撤销bridge FileObject')
      await prisma.printTask.delete({ where: { id: task.id } })
      await svc.publishMaterial(fairPublished.id, materialId, 'publish', adminUser)
      pass('7h. 下架立即撤销；活跃任务保留履约文件，终态后回收')

      // 未发布的招聘会:公开列表恒为空
      const draftFairList = await svc.getPublishedFairMaterials(fairDraft.id, 1, 20)
      if (draftFairList.total !== 0) fail('6. 未发布招聘会的公开资料列表应为空')
      pass('6c. 未发布招聘会的公开资料列表为空')
    }

    // ── 8. 签名验证 ────────────────────────────────────────────────────────
    {
      const { url } = signFairMaterialUrl(materialId)
      const u = new URL(`http://localhost${url.replace('/api/v1', '')}`)
      const expires = u.searchParams.get('expires')!
      const sig = u.searchParams.get('sig')!
      if (!verifyFairMaterialSignature(materialId, expires, sig)) fail('8. 正确签名应通过')
      if (verifyFairMaterialSignature(materialId, expires, sig.replace(/^./, sig[0] === 'a' ? 'b' : 'a'))) fail('8. 错误签名应拒绝')
      if (verifyFairMaterialSignature(materialId, String(Date.now() - 1000), sig)) fail('8. 过期签名应拒绝')
      pass('8. 签名验证:正确通过 / 篡改拒绝 / 过期拒绝')
    }

    // ── 9. 删除资料(软删 + 物理删对象)───────────────────────────────────
    {
      const row = await prisma.fairMaterial.findUnique({ where: { id: materialId } })
      const deleteBridge = await svc.prepareFairMaterialPrint(fairPublished.id, materialId)
      await svc.deleteMaterial(fairPublished.id, materialId, adminUser)
      const deleted = await prisma.fairMaterial.findUnique({ where: { id: materialId } })
      if (!deleted?.deletedAt) fail('9. 删除应为软删(保留删除线索)')
      const revokedBridge = await prisma.fairMaterialPrintBridge.findFirst({
        where: { materialId, fileObjectId: deleteBridge.fileId },
        include: { fileObject: true },
      })
      if (!revokedBridge?.revokedAt || revokedBridge.status !== 'revoked' || !revokedBridge.fileObject?.deletedAt) {
        fail('9. 删除资料必须立即撤销bridge并清理无活跃任务的FileObject')
      }
      const pub = await svc.getPublishedFairMaterials(fairPublished.id, 1, 20)
      if (pub.data.some((m) => m.id === materialId)) fail('9. 删除后仍出现在公开列表')
      await expectCode(() => svc.readMaterialContent(materialId), 'MATERIAL_NOT_FOUND', '9a. 删除后内容流 → MATERIAL_NOT_FOUND')
      let objectGone = false
      try {
        await storage.getObject(row!.storageKey)
      } catch {
        objectGone = true
      }
      if (!objectGone) fail('9. 物理对象未删除')
      pass('9b. 删除资料:软删留痕 + 源对象物理删除 + bridge撤销回收')
    }

    // ── 10. 审计 ───────────────────────────────────────────────────────────
    {
      const logs = await prisma.auditLog.findMany({ where: { actorId: adminUser.userId } })
      const actions = new Set(logs.map((l) => l.action))
      for (const expected of ['fair.update', 'fair.company.create', 'fair.company.delete', 'fair.zone.create', 'fair.material.upload', 'fair.material.publish', 'fair.material.delete']) {
        if (!actions.has(expected)) fail(`10. 缺少审计动作 ${expected};实际: ${[...actions].join(', ')}`)
      }
      pass('10. 全部写操作落 AuditLog')
    }

    // ── 11. 统计 ───────────────────────────────────────────────────────────
    {
      await svc.createCompany(fairPublished.id, { name: '统计企业A' }, adminUser)
      await svc.createCompany(fairPublished.id, { name: '统计企业B' }, adminUser)
      await svc.createZone(fairPublished.id, { name: '统计展区' }, adminUser)
      const stats = await svc.getAdminStats(fairPublished.id)
      if (stats.companyTotal !== 2 || stats.zoneTotal !== 1) fail(`11. 统计与行数不一致: ${JSON.stringify(stats)}`)
      const liveMaterialCount = await prisma.fairMaterial.count({ where: { jobFairId: fairPublished.id, deletedAt: null } })
      if (stats.materialTotal !== liveMaterialCount) fail('11. 软删资料不应计入统计')
      pass('11. 统计聚合与真实行数一致(软删不计入)')
    }

    console.log('\n=== ALL PASS ===')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e)
  process.exit(1)
})
