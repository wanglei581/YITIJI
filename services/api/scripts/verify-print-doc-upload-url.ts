/**
 * Verifies the COS print-upload contract without requiring a live COS bucket.
 *
 * Run:
 *   pnpm --filter @ai-job-print/api verify:print-doc-upload-url
 */
import 'dotenv/config'

process.env['FILE_SIGNING_SECRET'] ||= 'verify-print-doc-upload-url-secret-0123456789'

import { BadRequestException } from '@nestjs/common'
import { FilesService } from '../src/files/files.service'
import { verifyFileSignature, signFileUrl } from '../src/files/signing'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import type { PrismaService } from '../src/prisma/prisma.service'
import type { AuditService } from '../src/audit/audit.service'
import type { StorageService } from '../src/storage/storage.service'
import type { DownloadUrlArgs } from '../src/storage/storage.interface'

type FileObjectCreateArgs = {
  data: Record<string, unknown>
}

type CreatedRecord = Record<string, unknown> & {
  id: string
  storageKey: string
  bucket: string
  filename: string
  mimeType: string
  purpose: string
}

let passed = 0

function pass(message: string): void {
  passed += 1
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function ok(condition: boolean, message: string): void {
  condition ? pass(message) : fail(message)
}

function extractSignatureParts(url: string): { fileId: string; expires: string; sig: string } {
  const parsed = new URL(url, 'http://internal.local')
  const match = parsed.pathname.match(/\/api\/v1\/files\/([^/]+)\/content$/)
  const fileId = match?.[1]
  const expires = parsed.searchParams.get('expires')
  const sig = parsed.searchParams.get('sig')
  if (!fileId || !expires || !sig) {
    fail(`Signed URL has unexpected shape: ${url}`)
  }
  return { fileId, expires, sig }
}

function tamperSig(url: string): string {
  const parsed = new URL(url, 'http://internal.local')
  const sig = parsed.searchParams.get('sig')
  if (!sig) fail('Cannot tamper URL without sig')
  const last = sig.at(-1)
  const replacement = last === '0' ? '1' : '0'
  parsed.searchParams.set('sig', `${sig.slice(0, -1)}${replacement}`)
  return `${parsed.pathname}?${parsed.searchParams.toString()}`
}

function errorCode(error: unknown): string | undefined {
  const ex = error as { getResponse?: () => unknown; response?: unknown }
  const response = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } }
    | undefined
  return response?.error?.code
}

async function expectPrintJobReject(
  printJobs: PrintJobsService,
  fileUrl: string,
  label: string,
): Promise<void> {
  try {
    await printJobs.create({ fileUrl }, { terminalId: 't_verify' })
    fail(`${label}: expected PRINT_INVALID_FILE_URL`)
  } catch (error) {
    if (error instanceof BadRequestException && errorCode(error) === 'PRINT_INVALID_FILE_URL') {
      pass(label)
      return
    }
    fail(`${label}: expected PRINT_INVALID_FILE_URL, got ${errorCode(error) ?? (error as Error).message}`)
  }
}

async function main(): Promise<void> {
  console.log('\n=== print_doc upload URL contract verification ===')

  const createdRecords: CreatedRecord[] = []
  const downloadUrlCalls: DownloadUrlArgs[] = []

  const prisma = {
    fileObject: {
      create: async ({ data }: FileObjectCreateArgs): Promise<CreatedRecord> => {
        const record = {
          ...data,
          createdAt: new Date(),
          deletedAt: null,
          deletedBy: null,
          deleteReason: null,
        } as CreatedRecord
        createdRecords.push(record)
        return record
      },
    },
  } as unknown as PrismaService

  const storage = {
    defaultBucket: 'cos-verify-bucket',
    defaultRegion: 'ap-guangzhou',
    signTtlSeconds: 300,
    putObject: async (_objectKey: string, buffer: Buffer) => ({
      sizeBytes: buffer.length,
      sha256: 'a'.repeat(64),
    }),
    getDownloadUrl: (args: DownloadUrlArgs) => {
      downloadUrlCalls.push(args)
      return {
        url: `https://cos.example.test/${encodeURIComponent(args.objectKey)}?cos-signature=verify`,
        expiresAt: new Date(Date.now() + args.ttlSeconds * 1000),
      }
    },
  } as unknown as StorageService

  const files = new FilesService(prisma, {} as AuditService, storage)

  const printUpload = await files.upload({
    buffer: Buffer.from('%PDF-1.4 print document'),
    filename: 'print.pdf',
    mimeType: 'application/pdf',
    purpose: 'print_doc',
    uploaderId: null,
    endUserId: null,
  })
  const printParts = extractSignatureParts(printUpload.signedUrl)
  ok(printParts.fileId === printUpload.fileId, 'print_doc returns an API-owned /files/:id/content URL')
  ok(
    verifyFileSignature(printParts.fileId, printParts.expires, printParts.sig),
    'print_doc signedUrl has a valid FILE_SIGNING_SECRET HMAC signature',
  )
  ok(downloadUrlCalls.length === 0, 'print_doc upload does not return a storage/COS presigned URL')

  const resumeUpload = await files.upload({
    buffer: Buffer.from('%PDF-1.4 resume document'),
    filename: 'resume.pdf',
    mimeType: 'application/pdf',
    purpose: 'resume_upload',
    uploaderId: null,
    endUserId: null,
  })
  ok(
    resumeUpload.signedUrl.startsWith('https://cos.example.test/'),
    'non-print upload purpose still uses the storage backend download URL',
  )
  ok(downloadUrlCalls.length === 1, 'storage download URL path is still used exactly once for non-print upload')
  ok(createdRecords.length === 2, 'verify fixture created exactly two file records')

  const printJobs = new PrintJobsService({} as PrismaService, {} as AuditService)
  await expectPrintJobReject(
    printJobs,
    'https://cos.example.test/private/print.pdf?cos-signature=verify',
    '/print/jobs rejects external COS presigned URLs',
  )
  await expectPrintJobReject(
    printJobs,
    `/api/v1/files/${printUpload.fileId}/content`,
    '/print/jobs rejects internal file URLs without signature params',
  )
  const valid = signFileUrl(`file_verify_${Date.now()}`, 5 * 60 * 1000)
  await expectPrintJobReject(
    printJobs,
    tamperSig(valid.url),
    '/print/jobs rejects tampered API-owned signatures',
  )

  console.log(`\nALL PASS (${passed} checks)`)
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
