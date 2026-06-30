/**
 * AI 简历扫码上传 HTTP 端到端验证。
 *
 * 前置：
 * - API 已在本机运行：默认 http://localhost:3010/api/v1
 * - 运行命令必须显式使用本地存储，例如：
 *   FILE_STORAGE_DRIVER=local UPLOAD_SESSION_HTTP_BASE=http://localhost:3010/api/v1 pnpm --filter @ai-job-print/api verify:upload-sessions:http
 *
 * 覆盖：
 * create session -> control token gate -> phone multipart upload -> kiosk status
 * -> kiosk confirm/cancel，以及关键安全错误码。
 *
 * 默认不触发 /resume/parse，避免误耗 OCR / AI 配额；需要验证上传 fileId
 * 进入解析入口时，显式设置 UPLOAD_SESSION_HTTP_INCLUDE_PARSE=1。
 */
import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { JwtService } from '@nestjs/jwt'
import { Redis } from 'ioredis'
import { memberSessionKey } from '../src/common/guards/end-user-auth.guard'
import { resolveJwtSecret } from '../src/common/jwt-verifier.module'
import { PrismaService } from '../src/prisma/prisma.service'

const BASE = process.env['UPLOAD_SESSION_HTTP_BASE'] ?? 'http://localhost:3010/api/v1'
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')

interface ApiEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string; details?: string[] }
}

interface CreateSessionResponse {
  sessionId: string
  uploadToken: string
  controlToken: string
  uploadUrl: string
  expiresAt: string
}

interface FileView {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256?: string
  fileExpiresAt?: string | null
}

interface SessionStatusResponse {
  sessionId: string
  status: 'pending' | 'uploading' | 'uploaded' | 'confirmed' | 'cancelled' | 'expired'
  purpose: string
  mode: string
  expiresAt: string
  requiresKioskConfirmation?: boolean
  file: FileView | null
}

interface CancelResponse {
  sessionId: string
  status: 'cancelled'
}

interface ResumeParseResponse {
  taskId?: string
  status?: 'completed' | 'failed' | 'processing'
  failReason?: string
  providerName?: string
  fileId?: string
}

const createdFileIds: string[] = []
const createdAiTaskIds: string[] = []
const createdEndUserIds: string[] = []
const createdMemberSessionKeys: string[] = []

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`HTTP ${res.status} returned non-JSON body: ${text.slice(0, 200)}`)
  }
}

async function requestJson<T>(route: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${route}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  return { status: res.status, body: await readJson<T>(res) }
}

function expectStatus(actual: number, expected: number, label: string): void {
  assert.equal(actual, expected, `${label}: expected HTTP ${expected}, got ${actual}`)
  console.log(`  PASS ${label} -> ${actual}`)
}

function expectOkData<T>(status: number, envelope: ApiEnvelope<T>, label: string): T {
  assert.ok(status >= 200 && status < 300, `${label}: expected 2xx, got HTTP ${status} ${JSON.stringify(envelope)}`)
  assert.equal(envelope.success, true, `${label}: envelope.success must be true`)
  assert.ok(envelope.data, `${label}: envelope.data is required`)
  console.log(`  PASS ${label} -> ${status}`)
  return envelope.data
}

function expectError(
  status: number,
  envelope: ApiEnvelope<unknown>,
  expectedStatus: number,
  expectedCode: string,
  label: string,
): void {
  assert.equal(status, expectedStatus, `${label}: expected HTTP ${expectedStatus}, got ${status} ${JSON.stringify(envelope)}`)
  assert.equal(envelope.success, false, `${label}: envelope.success must be false`)
  assert.equal(envelope.error?.code, expectedCode, `${label}: expected error.code=${expectedCode}, got ${envelope.error?.code}`)
  console.log(`  PASS ${label} -> ${status} ${expectedCode}`)
}

function assertNoSignedUrl(file: FileView | null | undefined, label: string): void {
  assert.ok(file, `${label}: file is required`)
  const allowed = new Set(['fileId', 'filename', 'sizeBytes', 'mimeType', 'sha256', 'fileExpiresAt'])
  const unexpected = Object.keys(file).filter((key) => !allowed.has(key))
  assert.deepEqual(unexpected, [], `${label}: unexpected file fields exposed: ${unexpected.join(', ')}`)
  assert.ok(file.sha256, `${label}: sha256 is required`)
  assert.equal(Object.prototype.hasOwnProperty.call(file, 'fileExpiresAt'), true, `${label}: fileExpiresAt contract field is required`)
}

function assertLocalOnly(): void {
  const baseUrl = new URL(BASE)
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname),
    `UPLOAD_SESSION_HTTP_BASE must point to localhost, got ${BASE}`,
  )

  const nodeEnv = process.env['NODE_ENV']?.trim().toLowerCase()
  assert.notEqual(nodeEnv, 'production', 'NODE_ENV=production is not allowed for this local HTTP verifier')

  const storageDriver = process.env['FILE_STORAGE_DRIVER']?.trim().toLowerCase() || 'local'
  assert.equal(storageDriver, 'local', 'FILE_STORAGE_DRIVER must be local for this HTTP verifier')

  const databaseUrl = process.env['DATABASE_URL']?.trim()
  assert.ok(databaseUrl, 'DATABASE_URL is required for cleanup guard')
  if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
    const db = new URL(databaseUrl)
    assert.ok(
      ['localhost', '127.0.0.1', '[::1]'].includes(db.hostname),
      `DATABASE_URL must point to a local database for this verifier, got host=${db.hostname}`,
    )
  } else {
    assert.ok(
      databaseUrl.startsWith('file:') || databaseUrl.startsWith('libsql:'),
      `Only local SQLite/libsql or localhost Postgres DATABASE_URL is allowed, got ${databaseUrl.slice(0, 24)}...`,
    )
  }
}

async function uploadFile(args: {
  sessionId: string
  uploadToken: string
  filename: string
  mimeType: string
}): Promise<{ status: number; body: ApiEnvelope<SessionStatusResponse> }> {
  const form = new FormData()
  form.append('uploadToken', args.uploadToken)
  form.append('file', new Blob([new Uint8Array(PDF_BYTES)], { type: args.mimeType }), args.filename)
  return requestJson<ApiEnvelope<SessionStatusResponse>>(`/upload-sessions/${args.sessionId}/files`, {
    method: 'POST',
    body: form,
  })
}

async function createTemporarySession(terminalId: string): Promise<CreateSessionResponse> {
  const createRes = await requestJson<ApiEnvelope<CreateSessionResponse>>('/upload-sessions', {
    method: 'POST',
    body: JSON.stringify({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      terminalId,
    }),
  })
  const created = expectOkData(createRes.status, createRes.body, `create temporary upload session (${terminalId})`)
  assert.ok(created.sessionId, 'create: sessionId is required')
  assert.ok(created.uploadToken, 'create: uploadToken is required')
  assert.ok(created.controlToken, 'create: controlToken is required')
  assert.ok(created.uploadUrl.includes('/upload/phone'), 'create: uploadUrl must point to phone upload page')
  assert.ok(!created.uploadUrl.includes(created.controlToken), 'create: uploadUrl must not leak controlToken')
  assert.ok(!created.uploadUrl.includes('controlToken'), 'create: uploadUrl must not include controlToken query key')
  return created
}

async function createMemberSession(terminalId: string, token: string): Promise<CreateSessionResponse> {
  const createRes = await requestJson<ApiEnvelope<CreateSessionResponse>>('/upload-sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      terminalId,
    }),
  })
  const created = expectOkData(createRes.status, createRes.body, `create member upload session (${terminalId})`)
  assert.ok(created.sessionId, 'member create: sessionId is required')
  assert.ok(created.uploadToken, 'member create: uploadToken is required')
  assert.ok(created.controlToken, 'member create: controlToken is required')
  return created
}

async function createLocalMemberToken(): Promise<{ endUserId: string; token: string }> {
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379')
  try {
    const unique = randomUUID()
    const user = await prisma.endUser.create({
      data: {
        phoneHash: `http-e2e-member-${unique}`,
        phoneEnc: `http-e2e-member-${unique}`,
        lastLoginAt: new Date(),
      },
      select: { id: true },
    })
    createdEndUserIds.push(user.id)

    const sessionId = randomUUID()
    const sessionKey = memberSessionKey(sessionId)
    await redis.set(sessionKey, user.id, 'EX', 1_800)
    createdMemberSessionKeys.push(sessionKey)

    const jwt = new JwtService({
      secret: resolveJwtSecret(),
      signOptions: { expiresIn: '30m', audience: 'enduser' },
    })
    return { endUserId: user.id, token: jwt.sign({ sub: user.id }, { jwtid: sessionId }) }
  } finally {
    await redis.quit()
    await prisma.onModuleDestroy()
  }
}

async function runVerifier(): Promise<void> {
  console.log(`\n=== AI 简历扫码上传 HTTP 端到端验证 (${BASE}) ===`)
  assertLocalOnly()

  const health = await requestJson<ApiEnvelope<{ status?: string; db?: string }>>('/health')
  expectStatus(health.status, 200, `health ok db=${health.body.data?.db ?? 'unknown'}`)

  const invalidCreate = await requestJson<ApiEnvelope<unknown>>('/upload-sessions', {
    method: 'POST',
    body: JSON.stringify({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      terminalId: 'http-e2e-invalid',
      candidateEmail: 'must-not-be-accepted@example.test',
    }),
  })
  expectError(invalidCreate.status, invalidCreate.body, 400, 'VALIDATION_FAILED', 'create rejects non-whitelisted fields')

  const memberNoAuth = await requestJson<ApiEnvelope<unknown>>('/upload-sessions', {
    method: 'POST',
    body: JSON.stringify({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      terminalId: 'http-e2e-member',
    }),
  })
  expectError(memberNoAuth.status, memberNoAuth.body, 401, 'MEMBER_AUTH_REQUIRED', 'member session without auth is denied')

  const member = await createLocalMemberToken()
  const memberCreated = await createMemberSession('http-e2e-member-success', member.token)
  const memberUploaded = await uploadFile({
    sessionId: memberCreated.sessionId,
    uploadToken: memberCreated.uploadToken,
    filename: 'http-e2e-member-resume.pdf',
    mimeType: 'application/pdf',
  })
  const memberUploadedData = expectOkData(memberUploaded.status, memberUploaded.body, 'member phone multipart upload succeeds')
  assert.equal(memberUploadedData.status, 'uploaded', 'member upload: session status should be uploaded')
  assertNoSignedUrl(memberUploadedData.file, 'member upload response')
  createdFileIds.push(memberUploadedData.file!.fileId)

  const memberConfirmAnonymous = await requestJson<ApiEnvelope<unknown>>(`/upload-sessions/${memberCreated.sessionId}/confirm`, {
    method: 'POST',
    headers: { 'x-upload-session-control': memberCreated.controlToken },
  })
  expectError(
    memberConfirmAnonymous.status,
    memberConfirmAnonymous.body,
    403,
    'UPLOAD_SESSION_MEMBER_MISMATCH',
    'member confirm without member token is denied',
  )

  const otherMember = await createLocalMemberToken()
  const memberConfirmWrongUser = await requestJson<ApiEnvelope<unknown>>(`/upload-sessions/${memberCreated.sessionId}/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${otherMember.token}`,
      'x-upload-session-control': memberCreated.controlToken,
    },
  })
  expectError(
    memberConfirmWrongUser.status,
    memberConfirmWrongUser.body,
    403,
    'UPLOAD_SESSION_MEMBER_MISMATCH',
    'member confirm with different member token is denied',
  )

  const memberConfirmed = await requestJson<ApiEnvelope<SessionStatusResponse>>(`/upload-sessions/${memberCreated.sessionId}/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${member.token}`,
      'x-upload-session-control': memberCreated.controlToken,
    },
  })
  const memberConfirmedData = expectOkData(memberConfirmed.status, memberConfirmed.body, 'member confirm binds file to end user')
  assert.equal(memberConfirmedData.status, 'confirmed')
  assert.equal(memberConfirmedData.file?.fileId, memberUploadedData.file?.fileId)
  const memberFile = await findFileOwner(memberConfirmedData.file!.fileId)
  assert.equal(memberFile?.endUserId, member.endUserId, 'member file should bind endUserId')
  assert.equal(memberFile?.ownerType, 'user', 'member file should bind ownerType=user')
  assert.equal(memberFile?.ownerId, member.endUserId, 'member file should bind ownerId=endUserId')

  const missing = await requestJson<ApiEnvelope<unknown>>('/upload-sessions/not-a-real-session', {
    headers: { 'x-upload-session-control': 'irrelevant' },
  })
  expectError(missing.status, missing.body, 404, 'UPLOAD_SESSION_NOT_FOUND', 'missing session returns contract 404')

  const created = await createTemporarySession('http-e2e-main')
  console.log('  PASS create returns separated phone uploadToken and kiosk controlToken')

  const noControl = await requestJson<ApiEnvelope<unknown>>(`/upload-sessions/${created.sessionId}`)
  expectError(noControl.status, noControl.body, 403, 'UPLOAD_SESSION_CONTROL_INVALID', 'status without control token is denied')

  const badControl = await requestJson<ApiEnvelope<unknown>>(`/upload-sessions/${created.sessionId}`, {
    headers: { 'x-upload-session-control': 'bad-control-token' },
  })
  expectError(badControl.status, badControl.body, 403, 'UPLOAD_SESSION_CONTROL_INVALID', 'status with bad control token is denied')

  const initialStatus = await requestJson<ApiEnvelope<SessionStatusResponse>>(`/upload-sessions/${created.sessionId}`, {
    headers: { 'x-upload-session-control': created.controlToken },
  })
  const initialData = expectOkData(initialStatus.status, initialStatus.body, 'status with control token succeeds before upload')
  assert.equal(initialData.status, 'pending')
  assert.equal(initialData.file, null)

  const confirmBeforeUpload = await requestJson<ApiEnvelope<unknown>>(`/upload-sessions/${created.sessionId}/confirm`, {
    method: 'POST',
    headers: { 'x-upload-session-control': created.controlToken },
  })
  expectError(confirmBeforeUpload.status, confirmBeforeUpload.body, 400, 'UPLOAD_SESSION_NOT_READY', 'confirm before upload is denied')

  const badUploadToken = await uploadFile({
    sessionId: created.sessionId,
    uploadToken: 'bad-upload-token',
    filename: 'http-e2e-resume.pdf',
    mimeType: 'application/pdf',
  })
  expectError(badUploadToken.status, badUploadToken.body, 403, 'UPLOAD_TOKEN_INVALID', 'upload with bad phone token is denied')

  const invalidFile = await uploadFile({
    sessionId: created.sessionId,
    uploadToken: created.uploadToken,
    filename: 'http-e2e-resume.exe',
    mimeType: 'application/pdf',
  })
  expectError(invalidFile.status, invalidFile.body, 400, 'FILE_EXT_MISMATCH', 'invalid file extension is rejected')

  const uploaded = await uploadFile({
    sessionId: created.sessionId,
    uploadToken: created.uploadToken,
    filename: 'http-e2e-resume.pdf',
    mimeType: 'application/pdf',
  })
  const uploadedData = expectOkData(uploaded.status, uploaded.body, 'valid phone multipart upload succeeds')
  assert.equal(uploadedData.status, 'uploaded', 'upload: session status should be uploaded')
  assertNoSignedUrl(uploadedData.file, 'upload response')
  assert.equal(uploadedData.file?.filename, 'http-e2e-resume.pdf')
  assert.equal(uploadedData.file?.mimeType, 'application/pdf')
  createdFileIds.push(uploadedData.file!.fileId)

  const secondUpload = await uploadFile({
    sessionId: created.sessionId,
    uploadToken: created.uploadToken,
    filename: 'http-e2e-resume.pdf',
    mimeType: 'application/pdf',
  })
  expectError(secondUpload.status, secondUpload.body, 400, 'UPLOAD_SESSION_NOT_PENDING', 'upload token cannot be reused after upload')

  const status = await requestJson<ApiEnvelope<SessionStatusResponse>>(`/upload-sessions/${created.sessionId}`, {
    headers: { 'x-upload-session-control': created.controlToken },
  })
  const statusData = expectOkData(status.status, status.body, 'kiosk status with control token succeeds after upload')
  assert.equal(statusData.status, 'uploaded')
  assert.equal(statusData.file?.fileId, uploadedData.file?.fileId)
  assertNoSignedUrl(statusData.file, 'status response')

  const confirmNoControl = await requestJson<ApiEnvelope<unknown>>(`/upload-sessions/${created.sessionId}/confirm`, {
    method: 'POST',
  })
  expectError(confirmNoControl.status, confirmNoControl.body, 403, 'UPLOAD_SESSION_CONTROL_INVALID', 'confirm without control token is denied')

  const confirmBadControl = await requestJson<ApiEnvelope<unknown>>(`/upload-sessions/${created.sessionId}/confirm`, {
    method: 'POST',
    headers: { 'x-upload-session-control': 'bad-control-token' },
  })
  expectError(confirmBadControl.status, confirmBadControl.body, 403, 'UPLOAD_SESSION_CONTROL_INVALID', 'confirm with bad control token is denied')

  const confirmed = await requestJson<ApiEnvelope<SessionStatusResponse>>(`/upload-sessions/${created.sessionId}/confirm`, {
    method: 'POST',
    headers: { 'x-upload-session-control': created.controlToken },
  })
  const confirmedData = expectOkData(confirmed.status, confirmed.body, 'confirm with control token succeeds')
  assert.equal(confirmedData.status, 'confirmed')
  assert.equal(confirmedData.file?.fileId, uploadedData.file?.fileId)
  assertNoSignedUrl(confirmedData.file, 'confirm response')

  const cancelConfirmed = await requestJson<ApiEnvelope<unknown>>(`/upload-sessions/${created.sessionId}`, {
    method: 'DELETE',
    headers: { 'x-upload-session-control': created.controlToken },
  })
  expectError(cancelConfirmed.status, cancelConfirmed.body, 400, 'UPLOAD_SESSION_CONFIRMED', 'confirmed session cannot be cancelled')

  if (process.env['UPLOAD_SESSION_HTTP_INCLUDE_PARSE'] === '1') {
    // 该开关用于证明上传后的 fileId 能进入解析入口；若换成真实可解析 PDF 并产生
    // completed 结果，后续派生的优化 / 岗位匹配等数据需按对应验证脚本另行清理。
    const parsed = await requestJson<ResumeParseResponse>('/resume/parse', {
      method: 'POST',
      body: JSON.stringify({
        fileId: confirmedData.file?.fileId,
        fileName: confirmedData.file?.filename,
        fileFormat: 'pdf',
        source: 'upload',
      }),
    })
    assert.ok(parsed.status === 200 || parsed.status === 201, `resume parse: expected 2xx, got HTTP ${parsed.status} ${JSON.stringify(parsed.body)}`)
    assert.equal(parsed.body.fileId, confirmedData.file?.fileId, 'resume parse: response should reference uploaded fileId')
    assert.ok(parsed.body.status === 'completed' || parsed.body.status === 'failed', `resume parse: unexpected status ${parsed.body.status}`)
    if (parsed.body.taskId) createdAiTaskIds.push(parsed.body.taskId)
    if (parsed.body.status === 'failed') {
      assert.ok(parsed.body.failReason, 'resume parse failed response must include failReason')
      console.log(`  PASS resume/parse accepts uploaded fileId and returns honest failure via ${parsed.body.providerName ?? 'unknown'} provider: ${parsed.body.failReason}`)
    } else {
      console.log(`  PASS resume/parse accepts uploaded fileId and completes via ${parsed.body.providerName ?? 'unknown'} provider task=${parsed.body.taskId}`)
    }
  } else {
    console.log('  SKIP resume/parse handoff (set UPLOAD_SESSION_HTTP_INCLUDE_PARSE=1 to include OCR/AI entrypoint)')
  }

  const cancellable = await createTemporarySession('http-e2e-cancel')
  const cancelNoControl = await requestJson<ApiEnvelope<unknown>>(`/upload-sessions/${cancellable.sessionId}`, {
    method: 'DELETE',
  })
  expectError(cancelNoControl.status, cancelNoControl.body, 403, 'UPLOAD_SESSION_CONTROL_INVALID', 'cancel without control token is denied')

  const cancelled = await requestJson<ApiEnvelope<CancelResponse>>(`/upload-sessions/${cancellable.sessionId}`, {
    method: 'DELETE',
    headers: { 'x-upload-session-control': cancellable.controlToken },
  })
  const cancelledData = expectOkData(cancelled.status, cancelled.body, 'cancel with control token succeeds')
  assert.equal(cancelledData.status, 'cancelled')

  console.log('\nALL PASS')
}

async function findFileOwner(fileId: string): Promise<{ endUserId: string | null; ownerType: string | null; ownerId: string | null } | null> {
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  try {
    return await prisma.fileObject.findUnique({
      where: { id: fileId },
      select: { endUserId: true, ownerType: true, ownerId: true },
    })
  } finally {
    await prisma.onModuleDestroy()
  }
}

async function cleanup(): Promise<void> {
  if (
    createdFileIds.length === 0 &&
    createdAiTaskIds.length === 0 &&
    createdEndUserIds.length === 0 &&
    createdMemberSessionKeys.length === 0
  ) return
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379')
  try {
    const files = await prisma.fileObject.findMany({
      where: { id: { in: createdFileIds } },
      select: { id: true, storageKey: true },
    })
    const storageRoot = path.resolve(process.env['FILE_STORAGE_DIR']?.trim() || path.resolve(process.cwd(), 'storage'))
    for (const file of files) {
      const fullPath = path.resolve(storageRoot, file.storageKey)
      assert.ok(
        fullPath === storageRoot || fullPath.startsWith(`${storageRoot}${path.sep}`),
        `cleanup refused storage path outside local root: ${file.storageKey}`,
      )
      await fs.unlink(fullPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          console.warn(`  WARN cleanup local file already missing: ${file.storageKey}`)
          return
        }
        console.warn(`  WARN cleanup local file failed: ${file.storageKey}: ${error.message}`)
      })
    }
    if (createdAiTaskIds.length > 0) {
      await prisma.aiResumeResult.deleteMany({ where: { taskId: { in: createdAiTaskIds } } })
    }
    await prisma.fileObject.deleteMany({ where: { id: { in: createdFileIds } } })
    if (createdEndUserIds.length > 0) {
      await prisma.endUser.deleteMany({ where: { id: { in: createdEndUserIds } } })
    }
    if (createdMemberSessionKeys.length > 0) {
      await redis.del(...createdMemberSessionKeys)
    }
  } finally {
    await redis.quit()
    await prisma.onModuleDestroy()
  }
}

async function main(): Promise<void> {
  let primaryError: unknown
  try {
    await runVerifier()
  } catch (error) {
    primaryError = error
  }

  try {
    await cleanup()
  } catch (cleanupError) {
    if (primaryError) {
      console.warn('\nCleanup failed after verifier failure:', cleanupError)
    } else {
      throw cleanupError
    }
  }

  if (primaryError) throw primaryError
}

void main().catch((error) => {
    console.error('\nHTTP E2E failed:', error)
    process.exit(1)
  })
