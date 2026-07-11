import 'dotenv/config'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { createClient } from '@libsql/client'
import { AuditService } from '../src/audit/audit.service'
import { FilesService } from '../src/files/files.service'
import { JobMaterialPdfService } from '../src/job-materials/job-material-pdf.service'
import { JobMaterialsService } from '../src/job-materials/job-materials.service'
import { MemberAssetsService } from '../src/member-assets/member-assets.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'

const root = process.cwd()
const fallbackDbName = process.env['DATABASE_URL'] ? null : `verify-job-materials-${randomUUID().slice(0, 8)}.db`
if (fallbackDbName) process.env['DATABASE_URL'] = `file:./prisma/${fallbackDbName}`
process.env['FILE_SIGNING_SECRET'] ??= 'verify-job-materials-file-signing-secret-0123456789'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function read(path: string): string {
  const full = join(root, path)
  if (!existsSync(full)) fail(`Missing required file: ${path}`)
  return readFileSync(full, 'utf8')
}

function assertContains(path: string, pattern: string | RegExp, message: string): void {
  const content = read(path)
  const ok = typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content)
  if (!ok) fail(`${message} (${path})`)
  pass(message)
}

function assertNotContains(path: string, patterns: Array<string | RegExp>, message: string): void {
  const content = read(path)
  for (const pattern of patterns) {
    const hit = typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content)
    if (hit) fail(`${message} (${path})`)
  }
  pass(message)
}

console.log('\n=== Job materials commercial closure verification ===')

assertContains('package.json', '"verify:job-materials"', 'API package exposes verify:job-materials script')
assertContains('../../packages/shared/src/index.ts', './types/jobMaterials', 'Shared jobMaterials contract is exported')
assertContains('src/app.module.ts', 'JobMaterialsModule', 'AppModule imports JobMaterialsModule')
assertContains('src/job-materials/job-materials.module.ts', 'JobMaterialsController', 'JobMaterialsModule is wired')
assertContains('src/job-materials/job-materials.controller.ts', "@Controller('job-materials')", 'Public job-materials controller exists')
assertContains('src/job-materials/job-materials.controller.ts', "@Controller('admin/job-materials')", 'Admin job-materials controller exists')
assertContains('src/job-materials/job-materials.controller.ts', 'EndUserAuthGuard', 'Generation endpoint requires EndUserAuthGuard')
assertContains('src/job-materials/job-materials.controller.ts', 'JwtAuthGuard', 'Admin summary requires JwtAuthGuard')
assertContains('src/job-materials/job-materials.service.ts', "purpose: 'cover_letter'", 'Generated materials use member-retained cover_letter purpose')
assertContains('src/job-materials/job-materials.service.ts', "assetCategory: 'derived'", 'Generated materials are derived assets')
assertContains('src/job-materials/job-materials.service.ts', 'previewUrlPath', 'Generation response includes previewUrlPath')
assertContains('src/job-materials/job-materials.service.ts', 'fileObject.count', 'Admin summary uses database counts instead of loading all generated files')
assertContains('src/job-materials/job-materials.service.ts', 'createdAt: { gte: oldestDate }', 'Admin 7-day trend only loads recent generated files')
assertContains('src/job-materials/job-materials.service.ts', 'toLocalDateKey', 'Admin 7-day trend uses one local date key format')
assertContains('src/job-materials/job-materials.service.ts', 'payloadJson: { contains:', 'Template aggregate uses bounded count queries per built-in template')
assertContains('src/job-materials/job-material-pdf.service.ts', 'PDFDocument', 'PDF renderer uses pdfkit')
assertContains('src/job-materials/job-material-pdf.service.ts', 'JOB_MATERIAL_PDF_FONT_NOT_FOUND', 'PDF renderer fails honestly when CJK font is unavailable')
assertNotContains(
  'src/job-materials/job-materials.service.ts',
  [
    '一键投递',
    '立即投递',
    '平台投递',
    '发送给企业',
    /storageKey\s*:/,
    /select:\s*\{\s*id:\s*true,\s*status:\s*true,\s*deletedAt:\s*true,\s*createdAt:\s*true\s*\}/,
    /\.toISOString\(\)\.slice\(0,\s*10\)/,
  ],
  'Job materials service avoids forbidden wording, storage key leaks, unbounded file scans, and UTC/local date drift',
)

async function verifyRuntimeClosure(): Promise<void> {
  if (fallbackDbName) await initFallbackDb()
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const storage = new StorageService()
  const audit = new AuditService(prisma)
  const files = new FilesService(prisma, audit, storage)
  const pdf = new JobMaterialPdfService()
  const service = new JobMaterialsService(files, pdf, prisma, audit)
  const memberAssets = new MemberAssetsService(prisma)
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const endUserId = `eu_job_material_${suffix}`
  let fileId: string | null = null
  let objectKey: string | null = null
  let bucket: string | null = null

  try {
    await prisma.endUser.create({
      data: {
        id: endUserId,
        phoneHash: `job-material-hash-${suffix}`,
        phoneEnc: `job-material-enc-${suffix}`,
      },
    })
    pass('Runtime EndUser created')

    const generated = await service.generate({
      templateId: 'campus-cover-letter',
      applicantName: '测试用户',
      targetRole: '前端开发工程师',
      targetOrganization: '测试单位',
      keyStrengths: 'React 项目经验；数据分析能力',
      notes: '语气正式，适合招聘会现场材料',
    }, {
      endUserId,
      ipAddress: '127.0.0.1',
      userAgent: 'verify-job-materials',
      requestId: `verify-${suffix}`,
    })
    fileId = generated.fileId
    if (
      generated.signedUrl &&
      /^\/api\/v1\/files\/[^/]+\/content\?expires=\d+&sig=[0-9a-f]+$/.test(generated.printFileUrl ?? '') &&
      generated.previewUrlPath === `/files/${fileId}/preview-url`
    ) {
      pass('Runtime generation returns download URL, internal HMAC print URL and preview path')
    } else {
      fail(`Runtime generation returned unsafe metadata: ${JSON.stringify(generated)}`)
    }
    if (generated.pageCount >= 1 && generated.mimeType === 'application/pdf') {
      pass('Runtime generation creates a PDF with page count')
    } else {
      fail(`Expected generated PDF metadata, got ${JSON.stringify(generated)}`)
    }

    const file = await prisma.fileObject.findUnique({ where: { id: fileId } })
    if (!file) fail('Generated FileObject was not created')
    objectKey = file.storageKey
    bucket = file.bucket
    if (
      file.endUserId === endUserId &&
      file.purpose === 'cover_letter' &&
      file.assetCategory === 'derived' &&
      file.retentionPolicy === 'months_3' &&
      file.createdBy === 'job_material_generate' &&
      file.status === 'active'
    ) {
      pass('Generated FileObject has member owner, cover_letter purpose, derived category, and 90-day retention')
    } else {
      fail(`Generated FileObject contract mismatch: ${JSON.stringify({
        endUserId: file.endUserId,
        purpose: file.purpose,
        assetCategory: file.assetCategory,
        retentionPolicy: file.retentionPolicy,
        createdBy: file.createdBy,
        status: file.status,
      })}`)
    }

    const documents = await memberAssets.listDocuments(endUserId, { cursor: null, pageSize: 50 })
    if (documents.items.some((item) => item.id === fileId && item.previewUrlPath === `/files/${fileId}/preview-url`)) {
      pass('Generated job material appears in member MyDocuments list')
    } else {
      fail(`Generated job material missing from MyDocuments: ${JSON.stringify(documents.items)}`)
    }

    const summary = await service.adminSummary()
    if (summary.generatedFileCount >= 1 && summary.templates.some((item) => item.id === 'campus-cover-letter' && item.generatedCount >= 1)) {
      pass('Admin summary includes generated job material aggregate without personal details')
    } else {
      fail(`Admin summary missing generated aggregate: ${JSON.stringify(summary)}`)
    }
    const todayKey = toLocalDateKey(new Date())
    const todayTrend = summary.last7DaysGenerated.find((item) => item.date === todayKey)
    if (summary.last7DaysGenerated.length === 7 && todayTrend && todayTrend.count >= 1) {
      pass('Admin summary 7-day trend includes today local bucket after generation')
    } else {
      fail(`Admin summary 7-day trend missing today local bucket: ${JSON.stringify(summary.last7DaysGenerated)}`)
    }

    const auditRows = await prisma.auditLog.findMany({ where: { targetId: fileId }, select: { payloadJson: true } })
    const auditPayload = auditRows.map((row) => row.payloadJson).join('\n')
    if (
      auditPayload.includes('campus-cover-letter') &&
      !auditPayload.includes('React 项目经验') &&
      !auditPayload.includes('测试用户')
    ) {
      pass('Audit payload stores generation summary without material body')
    } else {
      fail(`Audit payload leaked material body or missing template summary: ${auditPayload}`)
    }
  } finally {
    if (fileId) {
      await prisma.auditLog.deleteMany({ where: { targetId: fileId } })
      await prisma.fileObject.deleteMany({ where: { id: fileId } })
    }
    await prisma.endUser.deleteMany({ where: { id: endUserId } })
    if (objectKey && bucket) await storage.deleteObject(objectKey, bucket).catch(() => undefined)
    await prisma.onModuleDestroy()
    cleanupFallbackDb()
  }
}

verifyRuntimeClosure()
  .then(() => {
    console.log('\nALL PASS')
  })
  .catch((error: unknown) => {
    console.error('\nFatal error:', (error as Error).message)
    console.error((error as Error).stack)
    process.exit(1)
  })

function cleanupFallbackDb(): void {
  if (!fallbackDbName) return
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`prisma/${fallbackDbName}${suffix}`, { force: true })
  }
}

async function initFallbackDb(): Promise<void> {
  const client = createClient({ url: process.env['DATABASE_URL']! })
  try {
    await client.batch([
      `CREATE TABLE "EndUser" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "phoneHash" TEXT NOT NULL,
        "phoneEnc" TEXT NOT NULL,
        "nickname" TEXT,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "lastLoginAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX "EndUser_phoneHash_key" ON "EndUser"("phoneHash")`,
      `CREATE TABLE "FileObject" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "storageKey" TEXT NOT NULL,
        "bucket" TEXT NOT NULL DEFAULT 'local-fs',
        "region" TEXT NOT NULL DEFAULT 'local',
        "filename" TEXT NOT NULL,
        "mimeType" TEXT NOT NULL,
        "sizeBytes" INTEGER NOT NULL,
        "sha256" TEXT NOT NULL,
        "uploaderId" TEXT,
        "endUserId" TEXT,
        "ownerType" TEXT,
        "ownerId" TEXT,
        "purpose" TEXT NOT NULL,
        "sensitiveLevel" TEXT NOT NULL DEFAULT 'normal',
        "visibility" TEXT NOT NULL DEFAULT 'private',
        "status" TEXT NOT NULL DEFAULT 'active',
        "createdBy" TEXT,
        "expiresAt" DATETIME,
        "deletedAt" DATETIME,
        "deletedBy" TEXT,
        "deleteReason" TEXT,
        "assetCategory" TEXT NOT NULL DEFAULT 'original',
        "sourceFileId" TEXT,
        "retentionPolicy" TEXT,
        "retentionSetBy" TEXT,
        "retentionConsentAt" DATETIME,
        "retentionConsentVersion" TEXT,
        "retentionLockedReason" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX "FileObject_storageKey_key" ON "FileObject"("storageKey")`,
      `CREATE INDEX "FileObject_endUserId_idx" ON "FileObject"("endUserId")`,
      `CREATE INDEX "FileObject_purpose_idx" ON "FileObject"("purpose")`,
      `CREATE INDEX "FileObject_status_idx" ON "FileObject"("status")`,
      `CREATE INDEX "FileObject_expiresAt_idx" ON "FileObject"("expiresAt")`,
      `CREATE INDEX "FileObject_deletedAt_idx" ON "FileObject"("deletedAt")`,
      `CREATE TABLE "AuditLog" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "actorId" TEXT,
        "actorRole" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "targetType" TEXT NOT NULL,
        "targetId" TEXT,
        "payloadJson" TEXT NOT NULL DEFAULT '{}',
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "requestId" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action")`,
      `CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType","targetId")`,
      `CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt")`,
    ])
  } finally {
    client.close()
  }
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
