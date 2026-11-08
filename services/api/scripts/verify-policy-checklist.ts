import 'reflect-metadata'
import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { FilesService } from '../src/files/files.service'
import { StorageService } from '../src/storage/storage.service'
import { extractPdfText, openPdfjsDocument } from '../src/common/pdf/pdfjs-document'
import { PolicyChecklistService, checklistFilename, publicPhoneUrl } from '../src/policies/policy-checklist.service'
import { PolicyChecklistController } from '../src/policies/policy-checklist.controller'
import { CHECKLIST_EMPTY, CHECKLIST_FOOTER, CHECKLIST_TRUNCATED, renderPolicyChecklist } from '../src/policies/policy-checklist-pdf'
import { materialCheckRequired, LEGACY_AI_GENERATED_PURPOSES } from '../src/print-jobs/material-check-policy'
import { assertPiiScanned } from '../src/print-jobs/pii-scan-gate'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { PricingService } from '../src/payment/pricing.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { UploadOptionsDto } from '../src/files/dto/upload-options.dto'
import { CreateUploadIntentDto } from '../src/files/dto/create-upload-intent.dto'
import { parseContentFileId, verifyFileSignature } from '../src/files/signing'

// 必须显式指定隔离库，早于任何 Prisma 构造；兼容 CI 的 SQLite / PostgreSQL。
assertIsolatedVerificationDatabase()
process.env['FILE_SIGNING_SECRET'] ||= 'verify-policy-checklist-secret-at-least-32-characters'
process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'

const root = resolve(__dirname, '..')
let checks = 0
function check(label: string, assertion: () => void) {
  assertion(); checks++; console.log(`  PASS ${label}`)
}
function signedFileId(value: string): string | null {
  const url = new URL(value, 'https://verification.invalid')
  const id = parseContentFileId(value)
  return id && verifyFileSignature(id, url.searchParams.get('expires')!, url.searchParams.get('sig')!) ? id : null
}
async function rejection(fn: () => Promise<unknown>, code: string, message?: string, status?: number) {
  await assert.rejects(fn, (e: { getResponse(): { error: { code: string; message: string } }; getStatus(): number }) => {
    assert.equal(e.getResponse().error.code, code)
    if (message) assert.equal(e.getResponse().error.message, message)
    if (status) assert.equal(e.getStatus(), status)
    return true
  })
  checks++
}
async function inspectPdf(buffer: Buffer) {
  const pdf = await PDFDocument.load(buffer)
  assert.equal(pdf.getPageCount(), 1)
  assert.ok(Math.abs(pdf.getPage(0).getWidth() - 595.28) < 0.1)
  assert.ok(Math.abs(pdf.getPage(0).getHeight() - 841.89) < 0.1)
  const resources = pdf.getPage(0).node.Resources()!
  const images = resources.lookupMaybe(PDFName.of('XObject'), PDFDict)?.keys().length ?? 0
  const doc = await openPdfjsDocument<{ destroy(): Promise<void> }>(new Uint8Array(buffer))
  try {
    const result = await extractPdfText(doc, { mergePages: true })
    return { text: (Array.isArray(result.text) ? result.text.join('') : result.text).replace(/\s/gu, ''), images }
  } finally { await doc.destroy() }
}

async function main() {
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const files = new FilesService(prisma, audit, storage)
  const services: PolicyChecklistService[] = []
  const makeService = () => { const service = new PolicyChecklistService(prisma, files); services.push(service); return service }
  const svc = makeService()
  const controller = new PolicyChecklistController(svc)
  const print = new PrintJobsService(prisma, audit, new PrintPageCountService(prisma, storage),
    new PricingService(prisma), new OrderStatusService(prisma, audit), new TerminalCapabilitiesService(prisma))
  const suffix = randomUUID()
  const orgId = `org_checklist_${suffix}`
  const policyId = `policy_checklist_${suffix}`
  const fileIds: string[] = []
  const priorPhoneOrigin = process.env['KIOSK_PUBLIC_BASE_URL']
  const priorScope = process.env['POLICY_SCOPE']
  try {
    delete process.env['KIOSK_PUBLIC_BASE_URL']
    process.env['POLICY_SCOPE'] = 'org' // 契约要求试点 all，不受环境默认 org 干扰。
    await prisma.organization.create({ data: {
      id: orgId, name: '门禁发布机构', type: 'public_employment_service',
      verifiedOfficialDomainsJson: JSON.stringify([{ domain: 'example.gov.cn', verifiedAt: new Date().toISOString(), verifiedBy: 'verify' }]),
    } })
    const policy = await prisma.policyPost.create({ data: {
      id: policyId, sourceOrgId: orgId, sourceName: '门禁发布机构', kind: 'policy_guide',
      title: '办事指南:/测试', reviewStatus: 'approved', publishStatus: 'published',
      whoCanApply: '按原文所列范围申请\n资格以窗口核对为准', requiredMaterials: '材料一\n材料二', whereToApply: '机构经办窗口',
      publishedDate: new Date('2026-11-01T00:00:00+08:00'), publishConfirmedAt: new Date('2026-11-05T10:00:00+08:00'),
      externalUrl: 'https://example.gov.cn/policy/1',
    }, include: { org: { select: { verifiedOfficialDomainsJson: true } } } })
    const [first, ...coldConcurrent] = await Promise.all([
      controller.generate(policyId),
      new PolicyChecklistController(makeService()).generate(policyId),
      controller.generate(policyId),
    ])
    fileIds.push(first.data.fileId)
    check('冷缓存多实例并发只生成一个文件', () => coldConcurrent.forEach((r) => assert.equal(r.data.fileId, first.data.fileId)))
    check('200 响应、全部契约字段、文件名、签名打印链接、无公网配置返回 null', () => {
      assert.equal(Reflect.getMetadata(PATH_METADATA, PolicyChecklistController), 'policies')
      assert.equal(Reflect.getMetadata(PATH_METADATA, controller.generate), ':id/checklist')
      assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, controller.generate), 200)
      assert.equal(first.success, true)
      assert.deepEqual(Object.keys(first.data).sort(), ['policyId', 'contentVersion', 'fileId', 'filename', 'pageCount', 'sizeBytes', 'printFileUrl', 'phoneUrl', 'phoneUrlExpiresAt'].sort())
      assert.equal(first.data.policyId, policyId); assert.equal(first.data.contentVersion, 1)
      assert.equal(first.data.pageCount, 1); assert.ok(first.data.sizeBytes > 0)
      assert.equal(first.data.filename, '材料清单-办事指南测试.pdf')
      assert.equal(signedFileId(first.data.printFileUrl), first.data.fileId)
      assert.equal(first.data.phoneUrl, null); assert.equal(first.data.phoneUrlExpiresAt, null)
    })
    const firstFile = await prisma.fileObject.findUniqueOrThrow({ where: { id: first.data.fileId } })
    check('文件派生类别、来源版本元数据、页数、短期保存、无用户信息', () => {
      assert.equal(firstFile.purpose, 'policy_checklist'); assert.equal(firstFile.assetCategory, 'derived')
      assert.equal(firstFile.derivationKind, 'ai_generated'); assert.equal(firstFile.pageCount, 1)
      assert.ok(firstFile.createdBy?.includes(policyId)); assert.ok(firstFile.createdBy?.includes('"contentVersion":1'))
      assert.equal(firstFile.retentionPolicy, 'system_short')
      assert.ok(firstFile.expiresAt && firstFile.expiresAt.getTime() <= Date.now() + 24 * 3600_000)
      assert.equal(firstFile.endUserId, null); assert.equal(firstFile.uploaderId, null)
      assert.equal(materialCheckRequired(firstFile), false)
      assert.ok(LEGACY_AI_GENERATED_PURPOSES.has('policy_checklist'))
    })
    const inspected = await inspectPdf((await files.readContent(first.data.fileId)).buffer)
    check('真实 PDF：一页 A4、三栏、发布日期优先、原文二维码、完整页脚', () => {
      assert.ok(inspected.text.includes(CHECKLIST_FOOTER))
      for (const t of ['政策办事清单', '谁可以申请', '要准备的材料', '去哪办', '门禁发布机构', '2026/11/01', '清单生成时间', '扫码打开原文：example.gov.cn']) assert.ok(inspected.text.includes(t), t)
      assert.equal(inspected.images, 1)
    })
    await assertPiiScanned({ prisma, fileId: first.data.fileId, requireCompleted: true, missingMessage: '', pendingMessage: '' })
    const same = await Promise.all([svc.generate(policyId), svc.generate(policyId), makeService().generate(policyId)])
    check('同版本连续 / 并发 / 新服务实例复用同一 fileId', () => same.forEach((r) => assert.equal(r.fileId, first.data.fileId)))
    process.env['KIOSK_PUBLIC_BASE_URL'] = 'https://kiosk.example.gov.cn'
    const phone = await svc.generate(policyId)
    check('复用手机上传公网配置：下载绝对地址、签名、30 分钟到期', () => {
      const url = new URL(phone.phoneUrl!)
      assert.equal(url.origin, 'https://kiosk.example.gov.cn'); assert.equal(url.searchParams.get('disposition'), 'attachment')
      assert.equal(signedFileId(phone.phoneUrl!), first.data.fileId)
      assert.ok(Math.abs(new Date(phone.phoneUrlExpiresAt!).getTime() - Date.now() - 30 * 60_000) < 5000)
      for (const origin of ['http://localhost:5173', 'https://127.0.0.1', 'https://kiosk.local', 'not-a-url']) {
        process.env['KIOSK_PUBLIC_BASE_URL'] = origin; assert.equal(publicPhoneUrl('/api/v1/files/x/content'), null)
      }
      assert.ok(checklistFilename('超长<>:/\\?*'.repeat(100)).length <= 79)
    })
    for (const [publishStatus, reviewStatus] of [['draft', 'approved'], ['unpublished', 'approved'], ['published', 'pending']]) {
      await prisma.policyPost.update({ where: { id: policyId }, data: { publishStatus, reviewStatus } })
      await rejection(() => svc.generate(policyId), 'POLICY_NOT_FOUND', '这条政策已经撤下或不在可查看范围', 404)
      await rejection(() => print.create({ fileUrl: first.data.printFileUrl }), 'POLICY_CHECKLIST_WITHDRAWN', '这条政策已经撤下，清单不能再打印。')
    }
    await rejection(() => svc.generate(`missing_${suffix}`), 'POLICY_NOT_FOUND', undefined, 404)
    // 公告没有三栏：已发布的公告按编号来要清单，也当不在可查看范围（2026-11-05 实走发现旧收藏可能存着公告编号）。
    const noticeId = `${policyId}_notice`
    await prisma.policyPost.create({ data: {
      id: noticeId, sourceOrgId: orgId, sourceName: '门禁发布机构', kind: 'notice', category: 'notice',
      title: '门禁公告', reviewStatus: 'approved', publishStatus: 'published', publishConfirmedAt: new Date(),
    } })
    try {
      await rejection(() => svc.generate(noticeId), 'POLICY_NOT_FOUND', undefined, 404)
    } finally {
      await prisma.policyPost.deleteMany({ where: { id: noticeId } })
    }
    await prisma.policyPost.update({ where: { id: policyId }, data: { publishStatus: 'published', reviewStatus: 'approved' } })
    await prisma.recruitmentEmergencyHold.create({ data: {
      targetType: 'policy', targetId: policyId, orgId, reasonCode: 'other', reasonText: '门禁紧急下架', actorId: 'verify',
    } })
    await rejection(() => svc.generate(policyId), 'POLICY_NOT_FOUND', undefined, 404)
    await rejection(() => print.create({ fileUrl: first.data.printFileUrl }), 'POLICY_CHECKLIST_WITHDRAWN', '这条政策已经撤下，清单不能再打印。')
    await prisma.recruitmentEmergencyHold.deleteMany({ where: { targetId: policyId } })
    await prisma.policyPost.update({ where: { id: policyId }, data: { category: 'recruitment' } })
    await rejection(() => svc.generate(policyId), 'POLICY_NOT_FOUND', undefined, 404)
    await rejection(() => print.create({ fileUrl: first.data.printFileUrl }), 'POLICY_CHECKLIST_WITHDRAWN')
    await prisma.policyPost.update({ where: { id: policyId }, data: { category: null, contentVersion: { increment: 1 }, requiredMaterials: '更新后的材料' } })
    await rejection(() => print.create({ fileUrl: first.data.printFileUrl }), 'POLICY_CHECKLIST_WITHDRAWN', '这条政策刚更新过，请回到政策页重新生成清单。')
    const next = await svc.generate(policyId); fileIds.push(next.fileId)
    check('内容版本 +1 必须重新生成文件', () => { assert.notEqual(next.fileId, first.data.fileId); assert.equal(next.contentVersion, 2) })
    // 实际一体机入口：有效清单穿过隐私闸门，继续要求终端；拒绝路径不落打印任务。
    await rejection(() => print.create({ fileUrl: next.printFileUrl }), 'PRINT_TERMINAL_REQUIRED')
    await prisma.fileObject.update({ where: { id: next.fileId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const regenerated = await svc.generate(policyId); fileIds.push(regenerated.fileId)
    check('过期文件不复用', () => assert.notEqual(regenerated.fileId, next.fileId))
    for (const externalUrl of [null, 'https://not-registered.example/policy', 'http://example.gov.cn/policy']) {
      const rendered = await renderPolicyChecklist({ ...policy, externalUrl, whoCanApply: null, requiredMaterials: '材料内容\n'.repeat(1000), whereToApply: null })
      const result = await inspectPdf(rendered.buffer)
      check('超长内容仍为一页；缺栏提示、截断提示、完整页脚；未核验原文不印 QR', () => {
        assert.equal(rendered.pageCount, 1); assert.equal(result.images, 0)
        assert.ok(result.text.includes(CHECKLIST_EMPTY)); assert.ok(result.text.includes(CHECKLIST_TRUNCATED))
        assert.ok(result.text.includes(CHECKLIST_FOOTER)); assert.ok(result.text.includes('发布机构没有提供可核对的原文链接'))
      })
    }
    const emptyDomains = await renderPolicyChecklist({ ...policy, publishedDate: null,
      org: { verifiedOfficialDomainsJson: null } })
    const emptyResult = await inspectPdf(emptyDomains.buffer)
    check('未登记域名不印 QR；发布日期回退 publishConfirmedAt', () => {
      assert.equal(emptyResult.images, 0); assert.ok(emptyResult.text.includes('2026/11/05'))
    })
    for (const Dto of [UploadOptionsDto, CreateUploadIntentDto]) {
      const errors = await validate(plainToInstance(Dto, { purpose: 'policy_checklist', filename: 'a.pdf', mimeType: 'application/pdf' }))
      check('清单用途不接受外部上传', () => assert.ok(errors.some((e) => e.property === 'purpose')))
    }
    check('CI、package、限流、公共路由已登记', () => {
      const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
      assert.equal(pkg.scripts['verify:policy-checklist'], 'node -r @swc-node/register scripts/verify-policy-checklist.ts')
      assert.ok(readFileSync(resolve(root, '../../.github/workflows/ci.yml'), 'utf8').includes('VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:policy-checklist'))
      assert.equal(Reflect.getMetadata('THROTTLER:LIMITdefault', controller.generate), 10)
      assert.equal(Reflect.getMetadata('__guards__', PolicyChecklistController), undefined)
    })
    console.log(`verify-policy-checklist: ${checks} assertions passed`)
  } finally {
    if (priorPhoneOrigin === undefined) delete process.env['KIOSK_PUBLIC_BASE_URL']; else process.env['KIOSK_PUBLIC_BASE_URL'] = priorPhoneOrigin
    if (priorScope === undefined) delete process.env['POLICY_SCOPE']; else process.env['POLICY_SCOPE'] = priorScope
    for (const id of fileIds) await files.systemDelete(id, 'verify-policy-checklist cleanup')
    await prisma.fileObject.deleteMany({ where: { id: { in: fileIds } } })
    await prisma.recruitmentEmergencyHold.deleteMany({ where: { targetId: policyId } })
    await prisma.policyPost.deleteMany({ where: { id: policyId } })
    await prisma.organization.deleteMany({ where: { id: orgId } })
    for (const service of services) await service.onModuleDestroy()
    await prisma.onModuleDestroy()
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
