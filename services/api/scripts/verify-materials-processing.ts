/**
 * Phase A-2 — Materials document-processing skeleton verification.
 *
 * Purpose:
 *   Verify that materials tasks bind to EndUser-owned files, anonymous files
 *   remain usable, simulated PII findings are generated without storing full
 *   raw text, and cross-user reads / decisions are rejected.
 *
 * Run:
 *   pnpm verify:materials-processing
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { ForbiddenException, GoneException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { MaterialsService } from '../src/materials/materials.service'
import { StorageService } from '../src/storage/storage.service'

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
  const testFileIds = [ownedFileId, anonymousFileId, imageFileId]
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
    await prisma.fileObject.create({
      data: {
        id: imageFileId,
        storageKey: `verify/materials/${imageFileId}.png`,
        filename: 'anonymous-print-image.png',
        mimeType: 'image/png',
        sizeBytes: 64,
        sha256: 'e'.repeat(64),
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

    const imageInspectionTask = await materials.createTask(
      { kind: 'inspection', sourceFileId: imageFileId, params: { purpose: 'print_check' } },
      { kind: 'anonymous' },
    )
    const imageChecks = (imageInspectionTask.result?.['checks'] ?? {}) as Record<string, unknown>
    if (imageChecks['pageCount'] === 1 && imageChecks['pageCountSource'] === 'image_single_page') {
      pass('Image inspection infers a single printable page')
    } else {
      fail(`Image inspection expected pageCount=1, got ${JSON.stringify(imageChecks)}`)
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
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
