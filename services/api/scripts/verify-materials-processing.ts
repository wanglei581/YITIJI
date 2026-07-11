/**
 * Phase A-2 — Materials document-processing skeleton verification.
 *
 * Purpose:
 *   Verify that materials tasks bind to EndUser-owned files, anonymous files
 *   remain usable, simulated PII findings are generated without storing full
 *   raw text, and cross-user reads / decisions are rejected.
 *
 * Run:
 *   pnpm --filter @ai-job-print/api verify:materials-processing
 */
import 'dotenv/config'
import zlib from 'node:zlib'
import { randomUUID } from 'crypto'
import { createCanvas } from '@napi-rs/canvas'
import { BadRequestException, ForbiddenException, GoneException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { MaterialsService } from '../src/materials/materials.service'
import type { OcrService } from '../src/ai/resume/ocr/ocr.service'
import { StorageService } from '../src/storage/storage.service'
import { LOCAL_BUCKET_SENTINEL, LOCAL_REGION_SENTINEL } from '../src/storage/storage.interface'

function pass(message: string) {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

async function expectForbidden(label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (error) {
    if (error instanceof ForbiddenException) {
      pass(label)
      return
    }
    fail(`${label}: expected ForbiddenException, got ${(error as Error).message}`)
  }
  fail(`${label}: expected ForbiddenException`)
}

async function expectGone(label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (error) {
    if (error instanceof GoneException) {
      pass(label)
      return
    }
    fail(`${label}: expected GoneException, got ${(error as Error).message}`)
  }
  fail(`${label}: expected GoneException`)
}

async function expectBadRequest(label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (error) {
    if (error instanceof BadRequestException) {
      pass(label)
      return
    }
    fail(`${label}: expected BadRequestException, got ${(error as Error).message}`)
  }
  fail(`${label}: expected BadRequestException`)
}

async function main() {
  console.log('\n=== Phase A-2 materials document-processing verification ===')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const storage = new StorageService()
  // 共享实例只用于不涉及真实抽取的路径（inspection/normalize_a4/pii_redact/ownership 等）；
  // 若某条路径意外触发 OCR，立即在这里失败，而不是悄悄返回貌似合理的假结果。
  const strictNoOcr: Pick<OcrService, 'recognize'> = {
    recognize: async () =>
      fail('unexpected OCR call on the shared materials instance (a specific test path should have used its own FakeOcrService)'),
  }
  const materials = new MaterialsService(prisma, storage, strictNoOcr as unknown as OcrService)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const ownerId = `eu_mat_owner_${suffix}`
  const otherId = `eu_mat_other_${suffix}`
  const ownedFileId = `file_mat_owned_${suffix}`
  const anonymousFileId = `file_mat_anon_${suffix}`
  const imageFileId = `file_mat_image_${suffix}`
  const pdfFileId = `file_mat_pdf_${suffix}`
  const unknownPdfFileId = `file_mat_pdf_unknown_${suffix}`
  const degradedOcrImageFileId = `file_mat_degraded_${suffix}`
  const unsupportedFormatFileId = `file_mat_unsupported_${suffix}`
  const docxFileId = `file_mat_docx_${suffix}`
  const blankImageFileId = `file_mat_blank_${suffix}`
  const nonBlankImageFileId = `file_mat_nonblank_${suffix}`
  const testFileIds = [
    ownedFileId,
    anonymousFileId,
    imageFileId,
    pdfFileId,
    unknownPdfFileId,
    degradedOcrImageFileId,
    unsupportedFormatFileId,
    docxFileId,
    blankImageFileId,
    nonBlankImageFileId,
  ]
  const ownedObjectKey = `verify/materials/${ownedFileId}.png`
  const imageObjectKey = `verify/materials/${imageFileId}.png`
  const pdfObjectKey = `verify/materials/${pdfFileId}.pdf`
  const unknownPdfObjectKey = `verify/materials/${unknownPdfFileId}.pdf`
  const degradedOcrImageObjectKey = `verify/materials/${degradedOcrImageFileId}.png`
  const unsupportedFormatObjectKey = `verify/materials/${unsupportedFormatFileId}.doc`
  const docxObjectKey = `verify/materials/${docxFileId}.docx`
  const blankImageObjectKey = `verify/materials/${blankImageFileId}.png`
  const nonBlankImageObjectKey = `verify/materials/${nonBlankImageFileId}.png`
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000)
  const textSample = '请联系 13800138000 或 zhangsan@example.com，身份证 110101199001011234，地址 青岛市市南区测试路 1 号。'
  const sensitiveParams = {
    textSample,
    phone: '13900139000',
    email: 'leak@example.com',
    address: '青岛市市南区测试路 1 号',
    idNumber: '110101199001011234',
    nested: { content: '完整原文不应落库 13800138000' },
  }

  try {
    await prisma.piiFinding.deleteMany({ where: { task: { sourceFileId: { in: testFileIds } } } })
    await prisma.documentProcessTask.deleteMany({ where: { sourceFileId: { in: testFileIds } } })
    await prisma.fileObject.deleteMany({ where: { id: { in: testFileIds } } })
    await prisma.endUser.deleteMany({ where: { id: { in: [ownerId, otherId] } } })

    await prisma.endUser.createMany({
      data: [
        { id: ownerId, phoneHash: `mat-owner-hash-${suffix}`, phoneEnc: `mat-owner-enc-${suffix}` },
        { id: otherId, phoneHash: `mat-other-hash-${suffix}`, phoneEnc: `mat-other-enc-${suffix}` },
      ],
    })
    pass('EndUsers created')

    // M2: ownedFileId 现在需要真实落盘的字节 —— pii_scan 走 extractTextForPiiScan 真实读文件，
    // 不再吃 params.textSample。这里用一张真实（哪怕内容无意义）的 PNG 承载，交由 FakeOcrService
    // 的 recognize() 返回 textSample 文本，驱动真实的正则匹配/去重流程（只 fake OCR 这一层边界）。
    const ownedPngBytes = makeBlankWhitePng(4, 4)
    const ownedPut = await storage.putObject(ownedObjectKey, ownedPngBytes, 'image/png', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: ownedFileId,
        storageKey: ownedObjectKey,
        bucket: LOCAL_BUCKET_SENTINEL,
        region: LOCAL_REGION_SENTINEL,
        filename: 'resume-13800138000.png',
        mimeType: 'image/png',
        sizeBytes: ownedPut.sizeBytes,
        sha256: ownedPut.sha256,
        purpose: 'resume_upload',
        sensitiveLevel: 'sensitive',
        expiresAt,
        endUserId: ownerId,
        ownerType: 'user',
        ownerId,
      },
    })
    await prisma.fileObject.create({
      data: {
        id: anonymousFileId,
        storageKey: `verify/materials/${anonymousFileId}.pdf`,
        filename: 'anonymous-print.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 128,
        sha256: 'd'.repeat(64),
        purpose: 'print_doc',
        sensitiveLevel: 'normal',
        expiresAt,
        endUserId: null,
        ownerType: 'system',
        ownerId: null,
      },
    })
    // M3: 之前用的 buildPngHeader() 只有 IHDR chunk（无 IDAT/IEND），Task 3 引入
    // detectBlankPages() 后，inspection/normalize_a4 会真实调用 @napi-rs/canvas 的 loadImage()
    // 去解码它 —— 这类截断 PNG 会导致原生层直接 SIGSEGV（进程崩溃，JS try/catch 完全拦不住），
    // 而不是 briefing 假设的"抛出可捕获异常后 fail-open"。改用真实、完整、可解码的 PNG
    // （宽高不变，不影响下面既有的 800×600 / low-DPI 断言）。
    const imageBytes = makeNonBlankPng(800, 600)
    const imagePut = await storage.putObject(imageObjectKey, imageBytes, 'image/png', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: imageFileId,
        storageKey: imageObjectKey,
        bucket: LOCAL_BUCKET_SENTINEL,
        region: LOCAL_REGION_SENTINEL,
        filename: 'anonymous-print-image.png',
        mimeType: 'image/png',
        sizeBytes: imagePut.sizeBytes,
        sha256: imagePut.sha256,
        purpose: 'print_doc',
        sensitiveLevel: 'normal',
        expiresAt,
        endUserId: null,
        ownerType: 'system',
        ownerId: null,
      },
    })
    const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n2 0 obj\n<< /Type /Page >>\nendobj\n%%EOF\n')
    const pdfPut = await storage.putObject(pdfObjectKey, pdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    const unknownPdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')
    const unknownPdfPut = await storage.putObject(unknownPdfObjectKey, unknownPdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: pdfFileId,
        storageKey: pdfObjectKey,
        bucket: LOCAL_BUCKET_SENTINEL,
        region: LOCAL_REGION_SENTINEL,
        filename: 'anonymous-print-two-pages.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdfPut.sizeBytes,
        sha256: pdfPut.sha256,
        purpose: 'print_doc',
        sensitiveLevel: 'normal',
        expiresAt,
        endUserId: null,
        ownerType: 'system',
        ownerId: null,
      },
    })
    await prisma.fileObject.create({
      data: {
        id: unknownPdfFileId,
        storageKey: unknownPdfObjectKey,
        bucket: LOCAL_BUCKET_SENTINEL,
        region: LOCAL_REGION_SENTINEL,
        filename: 'anonymous-print-unknown-pages.pdf',
        mimeType: 'application/pdf',
        sizeBytes: unknownPdfPut.sizeBytes,
        sha256: unknownPdfPut.sha256,
        purpose: 'print_doc',
        sensitiveLevel: 'normal',
        expiresAt,
        endUserId: null,
        ownerType: 'system',
        ownerId: null,
      },
    })
    pass('FileObjects created')

    // 专用 MaterialsService 实例：只 fake OCR 这一层边界，真实走 extractTextForPiiScan →
    // buildPiiFindingsFromPages 正则匹配/去重管线（与 verify-scan-tasks.ts 的 FakeFilesService
    // 同一原则：fake the boundary, not the logic）。
    const textSampleOcr = makeFakeOcr(async () => ({ ok: true, text: textSample, confidence: 'high' as const }))
    const materialsRealOcr = new MaterialsService(prisma, storage, textSampleOcr.ocr)

    const task = await materialsRealOcr.createTask(
      { kind: 'pii_scan', sourceFileId: ownedFileId, params: sensitiveParams },
      { kind: 'member', endUserId: ownerId },
    )
    if (task.endUserId === ownerId) pass('PII scan task inherited EndUser ownership')
    else fail('PII scan task did not inherit EndUser ownership')
    if (task.status === 'completed') pass('PII scan task completes synchronously in skeleton mode')
    else fail(`PII scan task expected completed, got ${task.status}`)
    const findingTypes = new Set((task.piiFindings ?? []).map((finding) => finding.type))
    if (
      findingTypes.has('phone') &&
      findingTypes.has('email') &&
      findingTypes.has('id_card') &&
      findingTypes.has('address')
    ) pass('PII scan generated real phone/email/id-card/address findings via extractTextForPiiScan + fake-OCR boundary')
    else fail(`Expected phone/email/id-card/address PII findings, got ${JSON.stringify([...findingTypes])}`)
    if (task.result?.['mode'] === 'real') pass('PII scan resultJson.mode === "real" for a real, successfully-scanned document')
    else fail(`Expected resultJson.mode === 'real', got ${JSON.stringify(task.result)}`)
    if (textSampleOcr.calls() >= 1) pass('PII scan on ownedFileId actually invoked the fake OCR boundary')
    else fail('Expected the fake OCR to have been called for ownedFileId pii_scan')
    if (task.piiFindings?.every((f) => !f.snippet || f.snippet.length <= 32)) pass('PII snippets are capped at 32 chars')
    else fail('PII finding snippet exceeded 32 chars')

    // M1: snippet 必须在服务端落库前掩码，DB 与 API 都不含完整 PII 原文。
    const storedFindings = await prisma.piiFinding.findMany({ where: { taskId: task.id }, select: { snippet: true } })
    const storedSnippets = storedFindings.map((f) => f.snippet ?? '').join('\n')
    const apiSnippets = (task.piiFindings ?? []).map((f) => f.snippet ?? '').join('\n')
    const fullPiiValues = ['13800138000', 'zhangsan@example.com', 'zhangsan', '110101199001011234', '测试路', '市南区']
    const dbLeak = fullPiiValues.filter((v) => storedSnippets.includes(v))
    const apiLeak = fullPiiValues.filter((v) => apiSnippets.includes(v))
    if (dbLeak.length === 0) pass('PiiFinding.snippet 落库已掩码，不含完整手机号/邮箱/身份证/地址原文')
    else fail(`PiiFinding.snippet 落库仍含完整 PII: ${dbLeak.join(', ')}`)
    if (apiLeak.length === 0) pass('PII findings API 返回 snippet 不含完整 PII 原文')
    else fail(`PII findings API 返回 snippet 仍含完整 PII: ${apiLeak.join(', ')}`)
    if (storedSnippets.includes('****')) pass('PiiFinding.snippet 已应用掩码标记')
    else fail('PiiFinding.snippet 未检测到掩码标记，掩码可能未生效')

    const rawTask = await prisma.documentProcessTask.findUnique({ where: { id: task.id } })
    if (rawTask && !rawTask.paramsJson.includes(textSample)) pass('Full textSample is not stored in paramsJson')
    else fail('paramsJson stored the full raw textSample')
    if (
      rawTask &&
      !rawTask.paramsJson.includes('13900139000') &&
      !rawTask.paramsJson.includes('leak@example.com') &&
      !rawTask.paramsJson.includes('青岛市市南区') &&
      !rawTask.paramsJson.includes('110101199001011234')
    ) pass('Non-whitelisted sensitive params are not persisted')
    else fail('paramsJson stored non-whitelisted sensitive params')

    await expectForbidden('Cross-user task query is rejected', () =>
      materials.getTask(task.id, { kind: 'member', endUserId: otherId }),
    )

    const firstFindingId = task.piiFindings?.[0]?.id
    if (!firstFindingId) fail('Missing finding id for decision verification')
    await expectForbidden('Cross-user PII decision is rejected', () =>
      materials.decidePiiFindings(
        task.id,
        { decisions: [{ findingId: firstFindingId, action: 'redact' }] },
        { kind: 'member', endUserId: otherId },
      ),
    )

    const decided = await materials.decidePiiFindings(
      task.id,
      { decisions: [{ findingId: firstFindingId, action: 'redact' }] },
      { kind: 'member', endUserId: ownerId },
    )
    if (decided.piiFindings?.find((f) => f.id === firstFindingId)?.action === 'redact') {
      pass('Owner can update PII finding decision')
    } else {
      fail('Owner PII decision was not persisted')
    }

    const settled = await materials.decidePiiFindings(
      task.id,
      {
        decisions: (task.piiFindings ?? []).map((finding) => ({
          findingId: finding.id,
          action: finding.id === firstFindingId ? 'redact' : 'keep',
        })),
      },
      { kind: 'member', endUserId: ownerId },
    )
    const redactionTask = await materials.createTask(
      { kind: 'pii_redact', sourceFileId: ownedFileId, params: { decisionTaskId: settled.id } },
      { kind: 'member', endUserId: ownerId },
    )
    const redactionChecks = (redactionTask.result?.['checks'] ?? {}) as Record<string, unknown>
    if (
      redactionChecks['canRedact'] === true &&
      redactionChecks['redactedFileId'] === null &&
      redactionChecks['resultFileCreated'] === false &&
      redactionChecks['findingCount'] === settled.piiFindings?.length &&
      redactionChecks['redactedCount'] === 1 &&
      redactionChecks['pendingCount'] === 0
    ) {
      pass('PII redact evaluation summarizes decisions without creating a fake file')
    } else {
      fail(`PII redact evaluation expected settled decisions and no output file, got ${JSON.stringify(redactionChecks)}`)
    }

    const pendingPiiTask = await materialsRealOcr.createTask(
      { kind: 'pii_scan', sourceFileId: ownedFileId, params: sensitiveParams },
      { kind: 'member', endUserId: ownerId },
    )
    const pendingRedactionTask = await materials.createTask(
      { kind: 'pii_redact', sourceFileId: ownedFileId, params: { decisionTaskId: pendingPiiTask.id } },
      { kind: 'member', endUserId: ownerId },
    )
    const pendingRedactionChecks = (pendingRedactionTask.result?.['checks'] ?? {}) as Record<string, unknown>
    if (
      pendingRedactionChecks['canRedact'] === false &&
      Number(pendingRedactionChecks['pendingCount'] ?? 0) > 0 &&
      Array.isArray(pendingRedactionChecks['warnings']) &&
      pendingRedactionChecks['warnings'].includes('PII_DECISIONS_PENDING')
    ) {
      pass('PII redact evaluation is blocked while findings are pending')
    } else {
      fail(`Pending PII redact evaluation expected canRedact=false, got ${JSON.stringify(pendingRedactionChecks)}`)
    }

    await prisma.documentProcessTask.delete({ where: { id: task.id } })
    const deletedFinding = await prisma.piiFinding.findUnique({ where: { id: firstFindingId } })
    if (!deletedFinding) pass('Deleting material task cascades PII findings')
    else fail('Deleting material task did not cascade PII findings')

    const anonymousTask = await materials.createTask(
      { kind: 'inspection', sourceFileId: anonymousFileId, params: { purpose: 'print_check' } },
      { kind: 'anonymous' },
    )
    if (anonymousTask.endUserId === null) pass('Anonymous material task can be created')
    else fail('Anonymous material task should keep null endUserId')
    if (anonymousTask.accessToken) pass('Anonymous material task returns one-time access token')
    else fail('Anonymous material task should return access token')
    await expectForbidden('Anonymous material task without token is rejected', () =>
      materials.getTask(anonymousTask.id, { kind: 'anonymous' }),
    )
    await expectForbidden('Anonymous material task with wrong token is rejected', () =>
      materials.getTask(anonymousTask.id, { kind: 'anonymous', accessToken: 'wrong-token' }),
    )
    const anonymousRead = await materials.getTask(anonymousTask.id, {
      kind: 'anonymous',
      accessToken: anonymousTask.accessToken,
    })
    if (anonymousRead.id === anonymousTask.id) pass('Anonymous material task can be queried by id')
    else fail('Anonymous material task query returned wrong task')
    const unavailableChecks = (anonymousTask.result?.['checks'] ?? {}) as Record<string, unknown>
    if (
      unavailableChecks['canPrint'] === false &&
      Array.isArray(unavailableChecks['warnings']) &&
      unavailableChecks['warnings'].includes('SOURCE_FILE_BYTES_UNAVAILABLE')
    ) {
      pass('Unavailable PDF bytes are marked not printable')
    } else {
      fail(`Expected unavailable PDF to set canPrint=false, got ${JSON.stringify(unavailableChecks)}`)
    }

    // M2: anonymousFileId 故意保持"字节不可用"（用于上面的 SOURCE_FILE_BYTES_UNAVAILABLE 断言），
    // 不能再借它做真实 PII 抽取。改用同样匿名归属、但已有真实落盘字节的 imageFileId，
    // 经 materialsRealOcr（fake OCR 返回 textSample）驱动真实抽取管线，同时保留匿名 token 授权语义验证。
    const anonymousPiiTask = await materialsRealOcr.createTask(
      { kind: 'pii_scan', sourceFileId: imageFileId, params: {} },
      { kind: 'anonymous' },
    )
    if (!anonymousPiiTask.accessToken) fail('Anonymous PII scan should return access token')
    if (anonymousPiiTask.result?.['mode'] === 'real' && (anonymousPiiTask.piiFindings?.length ?? 0) > 0) {
      pass('Anonymous PII scan on real image content produced real findings (mode=real)')
    } else {
      fail(`Anonymous PII scan expected mode=real with findings, got ${JSON.stringify(anonymousPiiTask.result)}`)
    }
    const anonymousPiiDecisions = (anonymousPiiTask.piiFindings ?? []).map((finding, index) => ({
      findingId: finding.id,
      action: index === 0 ? 'redact' as const : 'keep' as const,
    }))
    const anonymousPiiSettled = await materials.decidePiiFindings(
      anonymousPiiTask.id,
      { decisions: anonymousPiiDecisions },
      { kind: 'anonymous', accessToken: anonymousPiiTask.accessToken },
    )
    await expectForbidden('Anonymous PII redact without decision task token is rejected', () =>
      materials.createTask(
        { kind: 'pii_redact', sourceFileId: imageFileId, params: { decisionTaskId: anonymousPiiSettled.id } },
        { kind: 'anonymous' },
      ),
    )
    await expectForbidden('Anonymous PII redact with wrong decision task token is rejected', () =>
      materials.createTask(
        { kind: 'pii_redact', sourceFileId: imageFileId, params: { decisionTaskId: anonymousPiiSettled.id } },
        { kind: 'anonymous', accessToken: 'wrong-token' },
      ),
    )
    const anonymousRedactionTask = await materials.createTask(
      { kind: 'pii_redact', sourceFileId: imageFileId, params: { decisionTaskId: anonymousPiiSettled.id } },
      { kind: 'anonymous', accessToken: anonymousPiiTask.accessToken },
    )
    const anonymousRedactionChecks = (anonymousRedactionTask.result?.['checks'] ?? {}) as Record<string, unknown>
    if (
      anonymousRedactionChecks['canRedact'] === true &&
      anonymousRedactionChecks['redactedFileId'] === null &&
      anonymousRedactionChecks['redactedCount'] === 1
    ) {
      pass('Anonymous PII redact requires the original decision task token')
    } else {
      fail(`Anonymous PII redact expected authorized summary, got ${JSON.stringify(anonymousRedactionChecks)}`)
    }

    const unavailableNormalizeTask = await materials.createTask(
      { kind: 'normalize_a4', sourceFileId: anonymousFileId, params: { targetPaperSize: 'A4' } },
      { kind: 'anonymous' },
    )
    const unavailableNormalizeChecks = (unavailableNormalizeTask.result?.['checks'] ?? {}) as Record<string, unknown>
    if (
      unavailableNormalizeChecks['targetPaperSize'] === 'A4' &&
      unavailableNormalizeChecks['canNormalize'] === false &&
      unavailableNormalizeChecks['normalizedFileId'] === null &&
      Array.isArray(unavailableNormalizeChecks['warnings']) &&
      unavailableNormalizeChecks['warnings'].includes('SOURCE_FILE_BYTES_UNAVAILABLE')
    ) {
      pass('Unavailable PDF bytes are marked not normalizable')
    } else {
      fail(`Expected unavailable PDF normalize_a4 to set canNormalize=false, got ${JSON.stringify(unavailableNormalizeChecks)}`)
    }

    const imageInspectionTask = await materials.createTask(
      { kind: 'inspection', sourceFileId: imageFileId, params: { purpose: 'print_check' } },
      { kind: 'anonymous' },
    )
    const imageChecks = (imageInspectionTask.result?.['checks'] ?? {}) as Record<string, unknown>
    if (
      imageChecks['pageCount'] === 1 &&
      imageChecks['pageCountSource'] === 'image_single_page' &&
      imageChecks['canPrint'] === true
    ) {
      pass('Image inspection infers a single printable page')
    } else {
      fail(`Image inspection expected pageCount=1 and canPrint=true, got ${JSON.stringify(imageChecks)}`)
    }
    if (Array.isArray(imageChecks['messages']) && imageChecks['messages'].length >= 1) {
      pass('Image inspection returns user-facing status messages')
    } else {
      fail(`Image inspection expected status messages, got ${JSON.stringify(imageChecks)}`)
    }
    const imageQuality = imageChecks['imageQuality'] as Record<string, unknown> | undefined
    if (
      imageQuality?.['widthPx'] === 800 &&
      imageQuality?.['heightPx'] === 600 &&
      imageQuality?.['quality'] === 'low' &&
      Array.isArray(imageChecks['warnings']) &&
      imageChecks['warnings'].includes('IMAGE_RESOLUTION_LOW_FOR_A4')
    ) {
      pass('Image inspection estimates A4 print clarity from real image bytes')
    } else {
      fail(`Image inspection expected low-resolution A4 estimate, got ${JSON.stringify(imageChecks)}`)
    }

    const imageNormalizeTask = await materials.createTask(
      { kind: 'normalize_a4', sourceFileId: imageFileId, params: { targetPaperSize: 'A4' } },
      { kind: 'anonymous' },
    )
    const imageNormalizeChecks = (imageNormalizeTask.result?.['checks'] ?? {}) as Record<string, unknown>
    if (
      imageNormalizeChecks['targetPaperSize'] === 'A4' &&
      imageNormalizeChecks['canNormalize'] === true &&
      imageNormalizeChecks['normalizedFileId'] === null &&
      imageNormalizeChecks['pageCount'] === 1 &&
      imageNormalizeChecks['pageCountSource'] === 'image_single_page'
    ) {
      pass('Image normalize_a4 returns A4 evaluation without fake output file')
    } else {
      fail(`Image normalize_a4 expected canNormalize=true and no result file, got ${JSON.stringify(imageNormalizeChecks)}`)
    }
    await expectBadRequest('Non-A4 normalize_a4 target is rejected', () =>
      materials.createTask(
        { kind: 'normalize_a4', sourceFileId: imageFileId, params: { targetPaperSize: 'A3' } },
        { kind: 'anonymous' },
      ),
    )

    const pdfInspectionTask = await materials.createTask(
      { kind: 'inspection', sourceFileId: pdfFileId, params: { purpose: 'print_check' } },
      { kind: 'anonymous' },
    )
    const pdfChecks = (pdfInspectionTask.result?.['checks'] ?? {}) as Record<string, unknown>
    if (
      pdfChecks['pageCount'] === 2 &&
      pdfChecks['pageCountSource'] === 'pdf_lightweight_scan' &&
      pdfChecks['canPrint'] === true
    ) {
      pass('PDF inspection reads local object bytes and infers page count')
    } else {
      fail(`PDF inspection expected pageCount=2 and canPrint=true, got ${JSON.stringify(pdfChecks)}`)
    }

    const pdfNormalizeTask = await materials.createTask(
      { kind: 'normalize_a4', sourceFileId: pdfFileId, params: { targetPaperSize: 'A4' } },
      { kind: 'anonymous' },
    )
    const pdfNormalizeChecks = (pdfNormalizeTask.result?.['checks'] ?? {}) as Record<string, unknown>
    if (
      pdfNormalizeChecks['targetPaperSize'] === 'A4' &&
      pdfNormalizeChecks['canNormalize'] === true &&
      pdfNormalizeChecks['normalizedFileId'] === null &&
      pdfNormalizeChecks['pageCount'] === 2 &&
      pdfNormalizeChecks['pageCountSource'] === 'pdf_lightweight_scan'
    ) {
      pass('PDF normalize_a4 reads local object bytes and returns A4 evaluation')
    } else {
      fail(`PDF normalize_a4 expected pageCount=2 and canNormalize=true, got ${JSON.stringify(pdfNormalizeChecks)}`)
    }

    const unknownPdfNormalizeTask = await materials.createTask(
      { kind: 'normalize_a4', sourceFileId: unknownPdfFileId, params: { targetPaperSize: 'A4' } },
      { kind: 'anonymous' },
    )
    const unknownPdfNormalizeChecks = (unknownPdfNormalizeTask.result?.['checks'] ?? {}) as Record<string, unknown>
    if (
      unknownPdfNormalizeChecks['targetPaperSize'] === 'A4' &&
      unknownPdfNormalizeChecks['canNormalize'] === false &&
      unknownPdfNormalizeChecks['normalizedFileId'] === null &&
      unknownPdfNormalizeChecks['pageCount'] === null &&
      Array.isArray(unknownPdfNormalizeChecks['warnings']) &&
      unknownPdfNormalizeChecks['warnings'].includes('PDF_PAGE_COUNT_NOT_DETECTED')
    ) {
      pass('PDF normalize_a4 does not mark unknown page count as normalizable')
    } else {
      fail(`Unknown-page PDF normalize_a4 expected canNormalize=false, got ${JSON.stringify(unknownPdfNormalizeChecks)}`)
    }

    // ── pii_scan 四态覆盖：real / skipped_non_document / degraded / unsupported_format ──────

    // A. 非高风险用途 + contentCategory=photo → 直接跳过，OCR 绝不应被调用（复用 imageFileId，
    //    走共享 strict-no-ocr 的 materials 实例；若误触发 OCR，strictNoOcr 会立即 fail() 退出）。
    const skippedTask = await materials.createTask(
      { kind: 'pii_scan', sourceFileId: imageFileId, params: { contentCategory: 'photo' } },
      { kind: 'anonymous' },
    )
    if (skippedTask.result?.['mode'] === 'skipped_non_document' && skippedTask.result?.['findingCount'] === 0) {
      pass('A. Non-high-risk purpose + contentCategory=photo → mode=skipped_non_document, OCR never invoked')
    } else {
      fail(`A. Expected mode=skipped_non_document/findingCount=0, got ${JSON.stringify(skippedTask.result)}`)
    }

    // B. 高风险用途即使传 contentCategory=photo 也不能跳过（覆盖 HIGH_RISK_PII_PURPOSES 的
    //    永久回归测试；此前只在 Task 2 code review 时人工验证过一次，这里落成可执行断言）。
    const highRiskPhotoTask = await materialsRealOcr.createTask(
      { kind: 'pii_scan', sourceFileId: ownedFileId, params: { contentCategory: 'photo' } },
      { kind: 'member', endUserId: ownerId },
    )
    if (highRiskPhotoTask.result?.['mode'] === 'real') {
      pass('B. High-risk purpose overrides contentCategory=photo skip — real scan still attempted')
    } else {
      fail(`B. Expected high-risk purpose to bypass the photo skip, got ${JSON.stringify(highRiskPhotoTask.result)}`)
    }

    // C. OCR 失败 → mode=degraded，绝不伪造 0 命中以外的任何结果，不落库任何 finding。
    const degradedOcrPngBytes = makeBlankWhitePng(4, 4)
    const degradedPut = await storage.putObject(degradedOcrImageObjectKey, degradedOcrPngBytes, 'image/png', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: degradedOcrImageFileId,
        storageKey: degradedOcrImageObjectKey,
        bucket: LOCAL_BUCKET_SENTINEL,
        region: LOCAL_REGION_SENTINEL,
        filename: 'degraded-ocr.png',
        mimeType: 'image/png',
        sizeBytes: degradedPut.sizeBytes,
        sha256: degradedPut.sha256,
        purpose: 'print_doc',
        sensitiveLevel: 'normal',
        expiresAt,
        endUserId: null,
        ownerType: 'system',
        ownerId: null,
      },
    })
    const failingOcr = makeFakeOcr(async () => ({ ok: false, errorCode: 'OCR_FAILED', errorMessage: 'mock OCR provider failure' }))
    const materialsFailingOcr = new MaterialsService(prisma, storage, failingOcr.ocr)
    const degradedTask = await materialsFailingOcr.createTask(
      { kind: 'pii_scan', sourceFileId: degradedOcrImageFileId, params: {} },
      { kind: 'anonymous' },
    )
    const degradedFindings = await prisma.piiFinding.findMany({ where: { taskId: degradedTask.id } })
    if (
      degradedTask.result?.['mode'] === 'degraded' &&
      degradedTask.result?.['findingCount'] === 0 &&
      degradedFindings.length === 0
    ) {
      pass('C. OCR failure → mode=degraded, zero findings persisted (never fabricated)')
    } else {
      fail(`C. Expected mode=degraded/findingCount=0/no persisted findings, got ${JSON.stringify(degradedTask.result)} (${degradedFindings.length} persisted)`)
    }

    // D. 完全没有提取路径的格式（如旧版 .doc）→ mode=unsupported_format，OCR 绝不应被调用。
    const unsupportedBytes = Buffer.from('this pretends to be a legacy .doc binary payload', 'utf8')
    const unsupportedPut = await storage.putObject(unsupportedFormatObjectKey, unsupportedBytes, 'application/msword', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: unsupportedFormatFileId,
        storageKey: unsupportedFormatObjectKey,
        bucket: LOCAL_BUCKET_SENTINEL,
        region: LOCAL_REGION_SENTINEL,
        filename: 'legacy-resume.doc',
        mimeType: 'application/msword',
        sizeBytes: unsupportedPut.sizeBytes,
        sha256: unsupportedPut.sha256,
        purpose: 'resume_upload',
        sensitiveLevel: 'sensitive',
        expiresAt,
        endUserId: null,
        ownerType: 'system',
        ownerId: null,
      },
    })
    const unsupportedTask = await materials.createTask(
      { kind: 'pii_scan', sourceFileId: unsupportedFormatFileId, params: {} },
      { kind: 'anonymous' },
    )
    const unsupportedFindings = await prisma.piiFinding.findMany({ where: { taskId: unsupportedTask.id } })
    if (
      unsupportedTask.result?.['mode'] === 'unsupported_format' &&
      unsupportedTask.result?.['findingCount'] === 0 &&
      unsupportedFindings.length === 0
    ) {
      pass('D. Legacy .doc (no extraction path) → mode=unsupported_format, OCR never invoked, zero findings')
    } else {
      fail(`D. Expected mode=unsupported_format/findingCount=0, got ${JSON.stringify(unsupportedTask.result)}`)
    }

    // E. DOCX 真实支持：走真实 mammoth.extractRawText() 提取路径（不 mock mammoth 模块本身，
    //    只手搓一份 mammoth 真正能解析的最小合法 docx），全程不需要 OCR。
    const docxPiiPhone = '13711112222'
    const docxBytes = buildDocx([
      `姓名：李四`,
      `联系电话：${docxPiiPhone}`,
      '求职意向：后端工程师',
    ])
    const docxPut = await storage.putObject(
      docxObjectKey,
      docxBytes,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      LOCAL_BUCKET_SENTINEL,
    )
    await prisma.fileObject.create({
      data: {
        id: docxFileId,
        storageKey: docxObjectKey,
        bucket: LOCAL_BUCKET_SENTINEL,
        region: LOCAL_REGION_SENTINEL,
        filename: 'resume.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: docxPut.sizeBytes,
        sha256: docxPut.sha256,
        purpose: 'resume_upload',
        sensitiveLevel: 'sensitive',
        expiresAt,
        endUserId: null,
        ownerType: 'system',
        ownerId: null,
      },
    })
    const docxTask = await materials.createTask(
      { kind: 'pii_scan', sourceFileId: docxFileId, params: {} },
      { kind: 'anonymous' },
    )
    const docxFindingTypes = new Set((docxTask.piiFindings ?? []).map((finding) => finding.type))
    if (docxTask.result?.['mode'] === 'real' && docxFindingTypes.has('phone')) {
      pass('E. DOCX real mammoth.extractRawText() path finds real phone PII, mode=real, no OCR needed')
    } else {
      fail(`E. Expected mode=real with a phone finding from real DOCX text, got ${JSON.stringify(docxTask.result)}`)
    }

    // ── 空白页检测：真实、可解码的 PNG（非法/最小 stub 会在 canvas 解码阶段静默 fail-open）──────

    const blankPngBytes = makeBlankWhitePng(64, 64)
    const blankPut = await storage.putObject(blankImageObjectKey, blankPngBytes, 'image/png', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: blankImageFileId,
        storageKey: blankImageObjectKey,
        bucket: LOCAL_BUCKET_SENTINEL,
        region: LOCAL_REGION_SENTINEL,
        filename: 'blank-page.png',
        mimeType: 'image/png',
        sizeBytes: blankPut.sizeBytes,
        sha256: blankPut.sha256,
        purpose: 'print_doc',
        sensitiveLevel: 'normal',
        expiresAt,
        endUserId: null,
        ownerType: 'system',
        ownerId: null,
      },
    })
    const nonBlankPngBytes = makeNonBlankPng(64, 64)
    const nonBlankPut = await storage.putObject(nonBlankImageObjectKey, nonBlankPngBytes, 'image/png', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: nonBlankImageFileId,
        storageKey: nonBlankImageObjectKey,
        bucket: LOCAL_BUCKET_SENTINEL,
        region: LOCAL_REGION_SENTINEL,
        filename: 'non-blank-page.png',
        mimeType: 'image/png',
        sizeBytes: nonBlankPut.sizeBytes,
        sha256: nonBlankPut.sha256,
        purpose: 'print_doc',
        sensitiveLevel: 'normal',
        expiresAt,
        endUserId: null,
        ownerType: 'system',
        ownerId: null,
      },
    })

    const blankInspectionTask = await materials.createTask(
      { kind: 'inspection', sourceFileId: blankImageFileId, params: { purpose: 'print_check' } },
      { kind: 'anonymous' },
    )
    const blankChecks = (blankInspectionTask.result?.['checks'] ?? {}) as Record<string, unknown>
    const blankMessages = Array.isArray(blankChecks['messages']) ? (blankChecks['messages'] as Array<Record<string, unknown>>) : []
    if (blankMessages.some((m) => m['code'] === 'BLANK_PAGE_SUSPECTED') && blankChecks['canPrint'] === true) {
      pass('F. Blank white PNG inspection surfaces a BLANK_PAGE_SUSPECTED message without blocking canPrint')
    } else {
      fail(`F. Expected a BLANK_PAGE_SUSPECTED message for a blank white PNG, got ${JSON.stringify(blankChecks)}`)
    }

    const nonBlankInspectionTask = await materials.createTask(
      { kind: 'inspection', sourceFileId: nonBlankImageFileId, params: { purpose: 'print_check' } },
      { kind: 'anonymous' },
    )
    const nonBlankChecks = (nonBlankInspectionTask.result?.['checks'] ?? {}) as Record<string, unknown>
    const nonBlankMessages = Array.isArray(nonBlankChecks['messages']) ? (nonBlankChecks['messages'] as Array<Record<string, unknown>>) : []
    if (!nonBlankMessages.some((m) => m['code'] === 'BLANK_PAGE_SUSPECTED')) {
      pass('G. Fully black (non-blank) PNG inspection does not report BLANK_PAGE_SUSPECTED')
    } else {
      fail(`G. Non-blank PNG unexpectedly reported BLANK_PAGE_SUSPECTED, got ${JSON.stringify(nonBlankChecks)}`)
    }

    await prisma.documentProcessTask.update({
      where: { id: anonymousTask.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })
    await expectGone('Expired material task is rejected', () =>
      materials.getTask(anonymousTask.id, { kind: 'anonymous', accessToken: anonymousTask.accessToken }),
    )
    const cleanup = await materials.cleanupExpired(new Date())
    if (cleanup.deletedTasks >= 1) pass('Expired material tasks are cleaned up')
    else fail('Expected cleanup to delete at least one expired material task')
  } finally {
    await prisma.piiFinding.deleteMany({ where: { task: { sourceFileId: { in: testFileIds } } } })
    await prisma.documentProcessTask.deleteMany({ where: { sourceFileId: { in: testFileIds } } })
    await prisma.fileObject.deleteMany({ where: { id: { in: testFileIds } } })
    await prisma.endUser.deleteMany({ where: { id: { in: [ownerId, otherId] } } })
    await storage.deleteObject(ownedObjectKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await storage.deleteObject(imageObjectKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await storage.deleteObject(pdfObjectKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await storage.deleteObject(unknownPdfObjectKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await storage.deleteObject(degradedOcrImageObjectKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await storage.deleteObject(unsupportedFormatObjectKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await storage.deleteObject(docxObjectKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await storage.deleteObject(blankImageObjectKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await storage.deleteObject(nonBlankImageObjectKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})

function buildPngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(33)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(header, 0)
  header.writeUInt32BE(13, 8)
  header.write('IHDR', 12, 'ascii')
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  header[24] = 8
  header[25] = 2
  header[26] = 0
  header[27] = 0
  header[28] = 0
  return header
}

// ── fake OCR 边界（只 fake ocr.recognize，materials.service 真实抽取/正则匹配逻辑不受影响）──

type FakeOcrResult = {
  ok: boolean
  text?: string
  confidence?: 'high' | 'medium' | 'low'
  errorCode?: string
  errorMessage?: string
}

function makeFakeOcr(
  impl: (input: { buffer: Buffer; mimeType: string }) => Promise<FakeOcrResult>,
): { ocr: OcrService; calls: () => number } {
  let count = 0
  const recognize = async (input: { buffer: Buffer; mimeType: string }): Promise<FakeOcrResult> => {
    count += 1
    return impl(input)
  }
  return { ocr: { recognize } as unknown as OcrService, calls: () => count }
}

// ── 真实、可被 @napi-rs/canvas 解码的 PNG（用于空白页检测测试；不可复用 buildPngHeader，
//    后者只有 IHDR chunk、没有 IDAT/IEND，真实 canvas 解码会直接抛错）─────────────────────

function makeBlankWhitePng(width: number, height: number): Buffer {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  return canvas.toBuffer('image/png')
}

function makeNonBlankPng(width: number, height: number): Buffer {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, height)
  return canvas.toBuffer('image/png')
}

// ── 手搓最小 DOCX（stored ZIP，CRC32 用 Node 内置 zlib.crc32）——与
//    verify-resume-extraction.ts 的 buildDocx 同一实现，供 mammoth.extractRawText 真实解析 ──

function crc32(buf: Buffer): number {
  return zlib.crc32(buf) >>> 0
}

function buildZip(entries: { name: string; data: Buffer }[]): Buffer {
  const localChunks: Buffer[] = []
  const centralChunks: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const data = e.data
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    localChunks.push(local, nameBuf, data)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(0, 10) // stored
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)
    centralChunks.push(cd, nameBuf)

    offset += 30 + nameBuf.length + data.length
  }
  const centralStart = offset
  const centralSize = centralChunks.reduce((n, c) => n + c.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralStart, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...localChunks, ...centralChunks, eocd])
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildDocx(paragraphs: string[]): Buffer {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(p)}</w:t></w:r></w:p>`)
    .join('')
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}</w:body></w:document>`
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`
  return buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
  ])
}
