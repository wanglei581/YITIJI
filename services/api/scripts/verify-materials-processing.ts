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
import { randomUUID } from 'crypto'
import { BadRequestException, ForbiddenException, GoneException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { MaterialsService } from '../src/materials/materials.service'
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
  const materials = new MaterialsService(prisma, storage)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const ownerId = `eu_mat_owner_${suffix}`
  const otherId = `eu_mat_other_${suffix}`
  const ownedFileId = `file_mat_owned_${suffix}`
  const anonymousFileId = `file_mat_anon_${suffix}`
  const imageFileId = `file_mat_image_${suffix}`
  const pdfFileId = `file_mat_pdf_${suffix}`
  const unknownPdfFileId = `file_mat_pdf_unknown_${suffix}`
  const testFileIds = [ownedFileId, anonymousFileId, imageFileId, pdfFileId, unknownPdfFileId]
  const imageObjectKey = `verify/materials/${imageFileId}.png`
  const pdfObjectKey = `verify/materials/${pdfFileId}.pdf`
  const unknownPdfObjectKey = `verify/materials/${unknownPdfFileId}.pdf`
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000)
  const textSample = '请联系 13800138000 或 zhangsan@example.com 领取打印材料。'
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

    await prisma.fileObject.create({
      data: {
        id: ownedFileId,
        storageKey: `verify/materials/${ownedFileId}.pdf`,
        filename: 'resume-13800138000.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 256,
        sha256: 'c'.repeat(64),
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
    const imageBytes = buildPngHeader(800, 600)
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

    const task = await materials.createTask(
      { kind: 'pii_scan', sourceFileId: ownedFileId, params: sensitiveParams },
      { kind: 'member', endUserId: ownerId },
    )
    if (task.endUserId === ownerId) pass('PII scan task inherited EndUser ownership')
    else fail('PII scan task did not inherit EndUser ownership')
    if (task.status === 'completed') pass('PII scan task completes synchronously in skeleton mode')
    else fail(`PII scan task expected completed, got ${task.status}`)
    if ((task.piiFindings?.length ?? 0) >= 2) pass('PII scan generated simulated findings')
    else fail(`Expected at least 2 PII findings, got ${task.piiFindings?.length ?? 0}`)
    if (task.piiFindings?.every((f) => !f.snippet || f.snippet.length <= 32)) pass('PII snippets are capped at 32 chars')
    else fail('PII finding snippet exceeded 32 chars')

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

    const pendingPiiTask = await materials.createTask(
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

    const anonymousPiiTask = await materials.createTask(
      { kind: 'pii_scan', sourceFileId: anonymousFileId, params: { textSample } },
      { kind: 'anonymous' },
    )
    if (!anonymousPiiTask.accessToken) fail('Anonymous PII scan should return access token')
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
        { kind: 'pii_redact', sourceFileId: anonymousFileId, params: { decisionTaskId: anonymousPiiSettled.id } },
        { kind: 'anonymous' },
      ),
    )
    await expectForbidden('Anonymous PII redact with wrong decision task token is rejected', () =>
      materials.createTask(
        { kind: 'pii_redact', sourceFileId: anonymousFileId, params: { decisionTaskId: anonymousPiiSettled.id } },
        { kind: 'anonymous', accessToken: 'wrong-token' },
      ),
    )
    const anonymousRedactionTask = await materials.createTask(
      { kind: 'pii_redact', sourceFileId: anonymousFileId, params: { decisionTaskId: anonymousPiiSettled.id } },
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
    await storage.deleteObject(imageObjectKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await storage.deleteObject(pdfObjectKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await storage.deleteObject(unknownPdfObjectKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
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
