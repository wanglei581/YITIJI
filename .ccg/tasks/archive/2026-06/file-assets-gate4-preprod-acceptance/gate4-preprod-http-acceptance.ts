import 'dotenv/config'
import { createHash } from 'crypto'
import * as bcrypt from 'bcryptjs'
import Redis from 'ioredis'
import { createPrismaClient } from '../../../services/api/src/prisma/create-client'
import { hashPhone } from '../../../services/api/src/common/crypto/phone-identity'

const API_BASE = process.env['GATE4_API_BASE'] ?? 'http://127.0.0.1:3010/api/v1'
const CONSENT_VERSION = 'file-retention-v1'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function digest(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12)
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}****${phone.slice(7)}`
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 160) }
  }
}

async function request(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  return { status: res.status, body: await readJson(res) }
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

function pdfFixture(label: string): Blob {
  const body = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >> endobj',
    `4 0 obj << /Length 44 >> stream\nBT /F1 12 Tf 40 80 Td (${label}) Tj ET\nendstream endobj`,
    'xref',
    '0 5',
    '0000000000 65535 f ',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n')
  return new Blob([Buffer.from(body)], { type: 'application/pdf' })
}

async function loginMember(redis: Redis, phone: string, deviceId: string): Promise<{ token: string; userId: string }> {
  let res = await request('/member/auth/sms-code', {
    method: 'POST',
    body: JSON.stringify({ phone, deviceId }),
  })
  assert(res.status === 201 || res.status === 200, `send sms failed: ${res.status}`)
  const code = await redis.get(`member:sms:code:${hashPhone(phone)}`)
  assert(code && /^\d{6}$/.test(code), 'sms code not found in Redis')
  res = await request('/member/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, code, deviceId }),
  })
  assert(res.status === 201 || res.status === 200, `member login failed: ${res.status}`)
  assert(res.body?.data?.token && res.body?.data?.user?.id, 'member login response missing token/user')
  return { token: res.body.data.token, userId: res.body.data.user.id }
}

async function uploadFile(token: string, purpose: string, filename: string, label: string): Promise<string> {
  const form = new FormData()
  form.set('purpose', purpose)
  form.set('file', pdfFixture(label), filename)
  const res = await request('/files/kiosk-upload', {
    method: 'POST',
    headers: auth(token),
    body: form,
  })
  assert(res.status === 201 || res.status === 200, `upload ${filename} failed: ${res.status}`)
  assert(res.body?.data?.fileId, `upload ${filename} missing fileId`)
  return res.body.data.fileId
}

async function expectOk(path: string, token: string, label: string): Promise<any> {
  const res = await request(path, { headers: auth(token) })
  assert(res.status === 200, `${label} expected 200, got ${res.status}`)
  assert(res.body?.success === true, `${label} response not success`)
  return res.body.data
}

async function expectDenied(path: string, token: string, label: string): Promise<number> {
  const res = await request(path, { headers: auth(token) })
  assert([401, 403, 404].includes(res.status), `${label} expected denied, got ${res.status}`)
  return res.status
}

async function setRetention(token: string, fileId: string, retentionPolicy: string): Promise<any> {
  const res = await request(`/files/${fileId}/retention`, {
    method: 'PATCH',
    headers: auth(token),
    body: JSON.stringify({ retentionPolicy, consentVersion: CONSENT_VERSION }),
  })
  assert(res.status === 200, `retention ${retentionPolicy} failed: ${res.status}`)
  return res.body.data
}

async function main() {
  assert(process.env['DATABASE_URL'], 'DATABASE_URL missing')
  assert(process.env['REDIS_URL'], 'REDIS_URL missing')
  assert(process.env['SMS_PROVIDER'] === 'log', 'SMS_PROVIDER must be log for Gate 4 option B')
  assert(process.env['FILE_STORAGE_DRIVER'] === 'cos', 'FILE_STORAGE_DRIVER must be cos')

  const { client: prisma, kind } = createPrismaClient(process.env['DATABASE_URL'])
  const redis = new Redis(process.env['REDIS_URL'])
  const suffix = Date.now().toString().slice(-8)
  const phoneA = `139${suffix}`
  const phoneB = `138${suffix}`
  const deviceA = `gate4-device-a-${suffix}`
  const deviceB = `gate4-device-b-${suffix}`
  const adminUsername = `gate4_admin_${suffix}`
  const adminPassword = `Gate4-${suffix}-${createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 10)}`
  const touchedFileIds: string[] = []
  const evidence: Record<string, unknown> = {
    database: kind,
    smsProvider: 'log',
    storageDriver: 'cos',
    apiBaseDigest: digest(API_BASE),
    bucketDigest: digest(process.env['TENCENT_COS_BUCKET'] ?? ''),
    users: { a: maskPhone(phoneA), b: maskPhone(phoneB) },
  }

  try {
    const health = await request('/health')
    assert(health.status === 200 && health.body?.data?.db === 'postgres', 'health/db check failed')

    const memberA = await loginMember(redis, phoneA, deviceA)
    const memberB = await loginMember(redis, phoneB, deviceB)
    evidence.memberLogin = {
      a: { userIdDigest: digest(memberA.userId), phone: maskPhone(phoneA) },
      b: { userIdDigest: digest(memberB.userId), phone: maskPhone(phoneB) },
    }

    const rawFileId = await uploadFile(memberA.token, 'resume_upload', `gate4-original-${suffix}.pdf`, `gate4 original ${suffix}`)
    touchedFileIds.push(rawFileId)
    const rawRow = await prisma.fileObject.findUnique({ where: { id: rawFileId } })
    assert(rawRow, 'raw file row missing')
    assert(rawRow.endUserId === memberA.userId, 'raw file owner mismatch')
    assert(rawRow.bucket === process.env['TENCENT_COS_BUCKET'], 'raw file bucket mismatch')
    assert(rawRow.region === process.env['TENCENT_COS_REGION'], 'raw file region mismatch')
    assert(rawRow.assetCategory === 'original', 'raw file category not original')
    assert(rawRow.retentionPolicy === 'months_3', 'raw default retention not months_3')

    const rawSixMonth = await setRetention(memberA.token, rawFileId, 'months_6')
    assert(rawSixMonth.file.retentionPolicy === 'months_6', 'raw retention did not become months_6')

    const rawLongTermDenied = await request(`/files/${rawFileId}/retention`, {
      method: 'PATCH',
      headers: auth(memberA.token),
      body: JSON.stringify({ retentionPolicy: 'long_term', consentVersion: CONSENT_VERSION }),
    })
    assert(rawLongTermDenied.status === 400, `raw long_term should be rejected, got ${rawLongTermDenied.status}`)

    const preview = await expectOk(`/files/${rawFileId}/preview-url`, memberA.token, 'self preview')
    assert(preview?.url && preview.disposition === 'inline', 'preview-url payload invalid')
    const download = await expectOk(`/files/${rawFileId}/download-url`, memberA.token, 'self download')
    assert(download?.url && download.disposition === 'attachment', 'download-url payload invalid')
    const previewFetch = await fetch(preview.url)
    assert(previewFetch.status >= 200 && previewFetch.status < 300, `signed preview fetch failed: ${previewFetch.status}`)
    await previewFetch.arrayBuffer()

    const deniedPreview = await expectDenied(`/files/${rawFileId}/preview-url`, memberB.token, 'cross-account preview')
    const deniedDelete = await request(`/files/${rawFileId}?reason=gate4-cross-delete-${suffix}`, {
      method: 'DELETE',
      headers: auth(memberB.token),
    })
    assert([403, 404].includes(deniedDelete.status), `cross-account delete expected denied, got ${deniedDelete.status}`)

    const optimizedFileId = await uploadFile(memberA.token, 'cover_letter', `gate4-optimized-${suffix}.pdf`, `gate4 optimized ${suffix}`)
    touchedFileIds.push(optimizedFileId)
    await prisma.fileObject.update({
      where: { id: optimizedFileId },
      data: { assetCategory: 'optimized', sourceFileId: rawFileId },
    })
    const optimizedLongTerm = await setRetention(memberA.token, optimizedFileId, 'long_term')
    assert(optimizedLongTerm.file.retentionPolicy === 'long_term', 'optimized fixture did not become long_term')
    assert(optimizedLongTerm.file.expiresAt === null, 'long_term optimized fixture must have null expiresAt')

    const expiredFileId = await uploadFile(memberA.token, 'resume_scan', `gate4-expired-${suffix}.pdf`, `gate4 expired ${suffix}`)
    touchedFileIds.push(expiredFileId)
    await prisma.fileObject.update({
      where: { id: expiredFileId },
      data: { expiresAt: new Date(Date.now() - 60_000), retentionPolicy: 'months_3' },
    })

    const activeExpiredOthers = await prisma.fileObject.count({
      where: {
        deletedAt: null,
        expiresAt: { lt: new Date() },
        id: { notIn: [expiredFileId] },
      },
    })
    assert(activeExpiredOthers === 0, `cleanup would touch non-test expired files: ${activeExpiredOthers}`)

    const adminHash = await bcrypt.hash(adminPassword, 10)
    const admin = await prisma.user.create({
      data: {
        username: adminUsername,
        passwordHash: adminHash,
        name: `Gate4 Admin ${suffix}`,
        role: 'admin',
        enabled: true,
      },
    })
    const adminLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: adminUsername, password: adminPassword }),
    })
    assert(adminLogin.status === 201 || adminLogin.status === 200, `admin login failed: ${adminLogin.status}`)
    const adminToken = adminLogin.body?.data?.token
    assert(adminToken, 'admin token missing')

    const lifecycleBefore = await expectOk('/files/lifecycle-summary', adminToken, 'lifecycle before cleanup')
    const cleanup = await request('/files/cleanup-expired', {
      method: 'POST',
      headers: auth(adminToken),
    })
    assert(cleanup.status === 201 || cleanup.status === 200, `cleanup failed: ${cleanup.status}`)
    assert(cleanup.body?.data?.deletedCount === 1, `cleanup expected 1, got ${cleanup.body?.data?.deletedCount}`)
    assert(cleanup.body?.data?.deletedFileIds?.[0] === expiredFileId, 'cleanup deleted unexpected file')
    const lifecycleAfter = await expectOk('/files/lifecycle-summary', adminToken, 'lifecycle after cleanup')
    const adminFiles = await expectOk('/files?includeDeleted=true&limit=20', adminToken, 'admin file list')
    assert(Array.isArray(adminFiles), 'admin file list is not an array')

    const deleted = await request(`/files/${rawFileId}?reason=gate4-member-delete-${suffix}`, {
      method: 'DELETE',
      headers: auth(memberA.token),
    })
    assert(deleted.status === 200, `member delete raw failed: ${deleted.status}`)
    const rawAfterDelete = await prisma.fileObject.findUnique({ where: { id: rawFileId } })
    assert(rawAfterDelete?.status === 'deleted' && rawAfterDelete.deletedAt, 'raw file not marked deleted')
    await expectDenied(`/files/${rawFileId}/preview-url`, memberA.token, 'deleted file preview')

    const documents = await expectOk('/me/documents?pageSize=20', memberA.token, 'member documents')
    assert(Array.isArray(documents.items), 'member documents missing items')
    assert(documents.items.some((item: any) => item.id === optimizedFileId), 'optimized long-term fixture missing from member documents')
    assert(!documents.items.some((item: any) => item.id === rawFileId), 'deleted raw file still visible in member documents')

    const auditCounts = await prisma.auditLog.groupBy({
      by: ['action'],
      where: {
        targetId: { in: touchedFileIds },
        action: { in: ['file.upload', 'file.retention_update', 'file.delete'] },
      },
      _count: { _all: true },
    })
    const cleanupAudit = await prisma.auditLog.count({
      where: {
        action: 'file.cleanup_expired',
        payloadJson: { contains: expiredFileId },
      },
    })

    await prisma.user.update({
      where: { id: admin.id },
      data: {
        enabled: false,
        passwordHash: await bcrypt.hash(`disabled-${adminPassword}`, 10),
      },
    })

    evidence.files = {
      raw: { idDigest: digest(rawFileId), category: 'original', finalStatus: rawAfterDelete.status },
      optimizedFixture: { idDigest: digest(optimizedFileId), category: 'optimized', retention: 'long_term' },
      expiredCleanup: { idDigest: digest(expiredFileId), deletedCount: cleanup.body.data.deletedCount },
      crossAccountDenied: { previewStatus: deniedPreview, deleteStatus: deniedDelete.status },
    }
    evidence.admin = {
      tempAdminDigest: digest(admin.id),
      tempAdminDisabled: true,
      lifecycleBefore: {
        totalActive: lifecycleBefore.totalActive,
        longTermCount: lifecycleBefore.longTermCount,
        expiredPendingCleanup: lifecycleBefore.expiredPendingCleanup,
      },
      lifecycleAfter: {
        totalActive: lifecycleAfter.totalActive,
        longTermCount: lifecycleAfter.longTermCount,
        expiredPendingCleanup: lifecycleAfter.expiredPendingCleanup,
      },
      listObserved: adminFiles.length,
    }
    evidence.audit = {
      perAction: auditCounts.map((row: any) => ({ action: row.action, count: row._count._all })),
      cleanupAuditCount: cleanupAudit,
    }

    console.log(JSON.stringify({ ok: true, suffix, evidence }, null, 2))
  } finally {
    await redis.quit().catch(() => undefined)
    await prisma.$disconnect().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
  process.exit(1)
})
