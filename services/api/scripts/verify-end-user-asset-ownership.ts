/**
 * Phase A-1 — EndUser asset ownership verification.
 *
 * Purpose:
 *   Verify that C-end EndUser can own uploaded files, AI resume results, and
 *   print tasks, while anonymous assets remain supported with null endUserId.
 *
 * Run:
 *   pnpm verify:end-user-assets
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'

function pass(message: string) {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

async function main() {
  console.log('\n=== Phase A-1 EndUser asset ownership verification ===')
  const prisma = new PrismaService()
  await prisma.onModuleInit()

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const endUserId = `eu_asset_${suffix}`
  const ownedFileId = `file_owned_${suffix}`
  const anonymousFileId = `file_anon_${suffix}`
  const aiTaskId = `ai_task_${suffix}`
  const printTaskId = `ptask_asset_${suffix}`
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000)

  try {
    await prisma.printTask.deleteMany({ where: { id: printTaskId } })
    await prisma.aiResumeResult.deleteMany({ where: { taskId: aiTaskId } })
    await prisma.fileObject.deleteMany({ where: { id: { in: [ownedFileId, anonymousFileId] } } })
    await prisma.endUser.deleteMany({ where: { id: endUserId } })

    await prisma.endUser.create({
      data: {
        id: endUserId,
        phoneHash: `asset-hash-${suffix}`,
        phoneEnc: `asset-enc-${suffix}`,
        nickname: '资产归属验证用户',
      },
    })
    pass('EndUser created')

    await prisma.fileObject.create({
      data: {
        id: ownedFileId,
        storageKey: `verify/${ownedFileId}.pdf`,
        filename: 'resume.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 128,
        sha256: 'a'.repeat(64),
        purpose: 'resume_upload',
        sensitiveLevel: 'highly_sensitive',
        expiresAt,
        endUserId,
      },
    })
    await prisma.fileObject.create({
      data: {
        id: anonymousFileId,
        storageKey: `verify/${anonymousFileId}.pdf`,
        filename: 'anonymous.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 128,
        sha256: 'b'.repeat(64),
        purpose: 'print_doc',
        sensitiveLevel: 'normal',
        expiresAt,
        endUserId: null,
      },
    })

    const ownedFile = await prisma.fileObject.findUnique({ where: { id: ownedFileId } })
    const anonymousFile = await prisma.fileObject.findUnique({ where: { id: anonymousFileId } })
    if (ownedFile?.endUserId === endUserId) pass('FileObject can be owned by EndUser')
    else fail('FileObject endUserId was not persisted')
    if (anonymousFile?.endUserId === null) pass('Anonymous FileObject remains supported')
    else fail('Anonymous FileObject should keep null endUserId')

    await prisma.aiResumeResult.create({
      data: {
        taskId: aiTaskId,
        kind: 'parse',
        status: 'completed',
        payloadJson: JSON.stringify({ taskId: aiTaskId, status: 'completed' }),
        provider: 'mock',
        expiresAt,
        endUserId,
      },
    })
    const aiResult = await prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId: aiTaskId, kind: 'parse' } },
    })
    if (aiResult?.endUserId === endUserId) pass('AiResumeResult can be owned by EndUser')
    else fail('AiResumeResult endUserId was not persisted')

    await prisma.printTask.create({
      data: {
        id: printTaskId,
        fileUrl: `/api/v1/files/${ownedFileId}/content?expires=1&sig=test`,
        fileMd5: 'a'.repeat(64),
        paramsJson: '{}',
        status: 'pending',
        endUserId,
      },
    })
    const printTask = await prisma.printTask.findUnique({ where: { id: printTaskId } })
    if (printTask?.endUserId === endUserId) pass('PrintTask can be owned by EndUser')
    else fail('PrintTask endUserId was not persisted')

    const owner = await prisma.endUser.findUnique({
      where: { id: endUserId },
      include: {
        files: true,
        aiResumeResults: true,
        printTasks: true,
      },
    })
    if (owner?.files.length === 1) pass('EndUser.files relation works')
    else fail(`EndUser.files relation expected 1, got ${owner?.files.length ?? 'null'}`)
    if (owner?.aiResumeResults.length === 1) pass('EndUser.aiResumeResults relation works')
    else fail(`EndUser.aiResumeResults relation expected 1, got ${owner?.aiResumeResults.length ?? 'null'}`)
    if (owner?.printTasks.length === 1) pass('EndUser.printTasks relation works')
    else fail(`EndUser.printTasks relation expected 1, got ${owner?.printTasks.length ?? 'null'}`)
  } finally {
    await prisma.printTask.deleteMany({ where: { id: printTaskId } })
    await prisma.aiResumeResult.deleteMany({ where: { taskId: aiTaskId } })
    await prisma.fileObject.deleteMany({ where: { id: { in: [ownedFileId, anonymousFileId] } } })
    await prisma.endUser.deleteMany({ where: { id: endUserId } })
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
