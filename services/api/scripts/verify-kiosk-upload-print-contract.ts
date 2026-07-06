/**
 * Kiosk 上传 → 打印建单 URL 契约验证。
 *
 * 预生产 COS 配置下，FilesService.upload() 会返回 COS 外部预签名 URL；
 * 但 /print/jobs 与 PrintPageCountService 只接受本系统 HMAC content URL。
 * 本脚本用 mocked FilesService 复现 COS 返回值，断言 /files/kiosk-upload
 * 对 Kiosk 响应转换为 `/api/v1/files/:id/content?expires&sig`。
 *
 * Run: pnpm --filter @ai-job-print/api verify:kiosk-upload-print-contract
 */
import 'dotenv/config'

process.env['FILE_SIGNING_SECRET'] ||= 'verify-kiosk-upload-print-contract-secret-0123456789'

import { FilesController } from '../src/files/files.controller'
import type { FilesService } from '../src/files/files.service'
import type { AuditService } from '../src/audit/audit.service'
import type { JwtService } from '@nestjs/jwt'
import type { RedisService } from '../src/common/redis/redis.service'
import { verifyFileSignature } from '../src/files/signing'
import type { FileUploadResponse } from '../src/files/file.types'

let passed = 0
function pass(msg: string) {
  passed++
  console.log(`  PASS ${msg}`)
}
function fail(msg: string): never {
  console.error(`  FAIL ${msg}`)
  process.exit(1)
}
function ok(cond: boolean, msg: string) {
  cond ? pass(msg) : fail(msg)
}

async function main() {
  console.log('\n=== Kiosk 上传 → 打印 URL 契约验证 ===')

  const fileId = 'file_verify_kiosk_print_contract'
  const cosSignedUrl =
    'https://yitiji-prod-private-1257025684.cos.ap-guangzhou.myqcloud.com/users/u1/print-files/file.pdf' +
    '?q-signature=deadbeef&q-key-time=1700000000%3B1700001800'
  const cosExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  const uploaded: FileUploadResponse = {
    fileId,
    filename: 'resume.pdf',
    sizeBytes: 1234,
    mimeType: 'application/pdf',
    sha256: 'a'.repeat(64),
    signedUrl: cosSignedUrl,
    signedUrlExpiresAt: cosExpiresAt,
    fileExpiresAt: null,
  }

  const filesStub: Partial<FilesService> = {
    upload: async () => uploaded,
  }
  const auditStub: Partial<AuditService> = {
    write: async () => undefined,
  }
  const controller = new FilesController(
    filesStub as FilesService,
    auditStub as AuditService,
    {} as JwtService,
    {} as RedisService,
  )

  const response = await controller.kioskUpload(
    {
      buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
      originalname: 'resume.pdf',
      mimetype: 'application/pdf',
    } as Express.Multer.File,
    { purpose: 'print_doc' },
    {
      requestId: 'verify-kiosk-upload-print-contract',
      headers: {
        'user-agent': 'verify',
        'x-forwarded-for': '127.0.0.1',
      },
    } as Express.Request & { requestId?: string; headers: Record<string, string | string[] | undefined> },
  )

  const data = response.data
  ok(data.fileId === fileId && data.sha256 === uploaded.sha256, '上传元数据保持不变')
  ok(data.signedUrl !== cosSignedUrl, 'kiosk-upload 不把 COS 外部签名 URL 交给打印流')
  ok(data.signedUrl.startsWith(`/api/v1/files/${fileId}/content?`), 'signedUrl 为内部 files content URL')

  const parsed = new URL(data.signedUrl, 'http://internal.local')
  const expires = parsed.searchParams.get('expires')
  const sig = parsed.searchParams.get('sig')
  ok(Boolean(expires && sig), '内部 URL 带 expires + sig')
  ok(verifyFileSignature(fileId, expires ?? '', sig ?? ''), '内部 URL HMAC 签名有效且未过期')
  const ttlMs = Number(expires) - Date.now()
  ok(ttlMs > 25 * 60 * 1000 && ttlMs <= 30 * 60 * 1000 + 5_000, '内部 URL TTL 保持约 30 分钟')
  ok(new Date(data.signedUrlExpiresAt).getTime() === Number(expires), 'signedUrlExpiresAt 同步为内部 HMAC URL 的过期时间')

  console.log(`\nALL PASS (${passed} checks)`)
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
