import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { constants as fsConstants, promises as fs } from 'node:fs'
import path from 'node:path'
import { Redis } from 'ioredis'
import { PrismaService } from '../../src/prisma/prisma.service'

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')

interface ApiEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string; details?: string[] }
}

interface RaceSession {
  sessionId: string
  uploadToken: string
  controlToken: string
}

interface RaceStatus {
  status: string
  file: { fileId: string } | null
}

interface RaceDeps {
  createLocalMemberToken(): Promise<{ endUserId: string; token: string }>
  createMemberSession(terminalId: string, token: string): Promise<RaceSession>
  uploadFile(args: { sessionId: string; uploadToken: string; filename: string; mimeType: string }): Promise<{ status: number; body: ApiEnvelope<RaceStatus> }>
  expectOkData<T>(status: number, envelope: ApiEnvelope<T>, label: string): T
  requestJson<T>(route: string, init?: RequestInit): Promise<{ status: number; body: T }>
  expectError(status: number, envelope: ApiEnvelope<unknown>, expectedStatus: number, expectedCode: string, label: string): void
  createdFileIds: string[]
  sweepSessions(): Promise<{ scanned: number; cleaned: number; skipped: number; failed: number }>
}

async function deadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([work, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: deadline exceeded`)), ms)
    })])
  } finally { if (timer) clearTimeout(timer) }
}
type FifoHandle = Awaited<ReturnType<typeof fs.open>>

/**
 * confirm 若在读端打开前返回，写端 fs.open 会停在 libuv 线程池里。
 * 这种状态下事件循环不空，process.exit 也不会返回。
 * 非阻塞读端把这次 open 唤醒，随后关闭句柄并删除 FIFO。
 */
async function releaseBlockedFifoWriter(fifo: string, writerOpen: Promise<FifoHandle>): Promise<void> {
  const release = await fs.open(fifo, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK).catch(() => undefined)
  if (!release) return
  try {
    const opened = await writerOpen
    await opened.close()
  } catch {
    // 写端已失败时没有句柄可关；调用方仍抛出原来的 confirm 错误。
  } finally {
    await release.close().catch(() => undefined)
  }
  await fs.unlink(fifo).catch(() => undefined)
}

export async function raceMemberConfirmAgainstCancel(deps: RaceDeps): Promise<void> {
  const { createLocalMemberToken, createMemberSession, uploadFile, expectOkData, requestJson, expectError, createdFileIds, sweepSessions } = deps
  const round = 1
  const member = await createLocalMemberToken()
  const created = await createMemberSession('http-e2e-lease-race', member.token)
  const uploaded = await uploadFile({
    sessionId: created.sessionId, uploadToken: created.uploadToken,
    filename: 'http-e2e-lease-race.pdf', mimeType: 'application/pdf',
  })
  const fileId = expectOkData(uploaded.status, uploaded.body, 'race: member upload').file!.fileId
  createdFileIds.push(fileId)
  const root = path.resolve(process.env['FILE_STORAGE_DIR']?.trim() || path.resolve(process.cwd(), 'storage'))
  const initial = await readRaceFile(fileId)
  assert.ok(initial?.storageKey, 'race: storageKey missing')
  const source = storagePath(root, initial.storageKey)
  await fs.unlink(source)
  await new Promise<void>((resolve, reject) => {
    execFile('mkfifo', [source], (error) => (error ? reject(error) : resolve()))
  })
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379')
  const lockKey = `upload_session_upload_lock:${created.sessionId}`
  const confirm = requestJson<ApiEnvelope<SessionStatusResponse>>(`/upload-sessions/${created.sessionId}/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${member.token}`, 'x-upload-session-control': created.controlToken },
  })
  const writerOpen = fs.open(source, 'w')
  void writerOpen.catch(() => undefined)
  let writer: FifoHandle | undefined
  let takeoverWriterOpen: Promise<FifoHandle> | undefined
  try {
    writer = await deadline(writerOpen, 5_000, 'race: first copy open')
    const stagedKey = (await readRaceFile(fileId))?.pendingStorageKey
    assert.ok(stagedKey, 'race: pendingStorageKey missing')
    const firstToken = await redis.get(lockKey)
    assert.ok(firstToken, 'race: lock missing at copy start')
    const beyondOriginalTtl = Date.now() + 30_500
    while (Date.now() < beyondOriginalTtl) await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(await redis.get(lockKey), firstToken, 'race: live confirm lock was not renewed')
    const cancel = await requestJson<ApiEnvelope<unknown>>(`/upload-sessions/${created.sessionId}`, {
      method: 'DELETE', headers: { 'x-upload-session-control': created.controlToken },
    })
    expectError(cancel.status, cancel.body, 400, 'UPLOAD_SESSION_ACTION_IN_PROGRESS', 'cancel during live copy')
    const timedOut = await deadline(confirm, 40_000, 'race: bounded confirm')
    expectError(timedOut.status, timedOut.body, 400, 'UPLOAD_SESSION_ACTION_IN_PROGRESS', 'bounded copy')
    assert.equal(await redis.get(lockKey), firstToken, 'race: timed-out confirm released lock before copy settled')
    const skipped = await deadline(sweepSessions(), 5_000, 'race: live-copy cleanup skip')
    assert.equal(skipped.skipped, 1, 'race: live-copy cleanup must skip this session')
    assert.equal((await readRaceFile(fileId))?.pendingStorageKey, stagedKey, 'race: cleanup changed pending copy')
    assert.equal(await redis.get(lockKey), firstToken, 'race: cleanup displaced live-copy lock')
    await writer.write(PDF_BYTES)
    await writer.close()
    writer = undefined
    const releaseDeadline = Date.now() + 5_000
    while (await redis.exists(lockKey)) {
      assert.ok(Date.now() < releaseDeadline, 'race: lease did not release after copy settled')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const takeover = sweepSessions()
    takeoverWriterOpen = fs.open(source, 'w')
    const takeoverWriter = await deadline(takeoverWriterOpen, 5_000, 'race: cleanup copy open')
    const cleanupCancel = await requestJson<ApiEnvelope<unknown>>(`/upload-sessions/${created.sessionId}`, {
      method: 'DELETE', headers: { 'x-upload-session-control': created.controlToken },
    })
    expectError(cleanupCancel.status, cleanupCancel.body, 400, 'UPLOAD_SESSION_ACTION_IN_PROGRESS', 'cancel during cleanup copy')
    await takeoverWriter.write(PDF_BYTES)
    await takeoverWriter.close()
    await deadline(takeover, 10_000, 'race: cleanup takeover')
    const retryDeadline = Date.now() + 5_000
    while (await redis.exists(lockKey)) {
      assert.ok(Date.now() < retryDeadline, 'race: cleanup lock did not release before retry')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const retry = await requestJson<ApiEnvelope<SessionStatusResponse>>(`/upload-sessions/${created.sessionId}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${member.token}`, 'x-upload-session-control': created.controlToken },
    })
    assert.equal(expectOkData(retry.status, retry.body, 'race: confirmed after cleanup').status, 'confirmed')
    await assertRaceTerminal(round, member.endUserId, created.sessionId, fileId, root)
    console.log('  PASS live renewal, busy cancel, bounded failure, cleanup lock, confirmed terminal state')
  } finally {
    if (writer) { await writer.write(PDF_BYTES).catch(() => undefined); await writer.close().catch(() => undefined) }
    else await releaseBlockedFifoWriter(source, writerOpen)
    if (takeoverWriterOpen) await releaseBlockedFifoWriter(source, takeoverWriterOpen)
    await redis.quit()
  }
}

function storagePath(root: string, key: string): string {
  const full = path.resolve(root, key)
  assert.ok(full === root || full.startsWith(`${root}${path.sep}`), `storage key escaped: ${key}`)
  return full
}

async function readRaceFile(fileId: string) {
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  try {
    return await prisma.fileObject.findUnique({
      where: { id: fileId },
      select: {
        storageKey: true, pendingStorageKey: true, replacedStorageKey: true,
        ownerType: true, ownerId: true, endUserId: true, deletedAt: true,
      },
    })
  } finally {
    await prisma.onModuleDestroy()
  }
}

async function assertRaceTerminal(
  round: number, endUserId: string, sessionId: string, fileId: string, root: string,
): Promise<void> {
  const row = await readRaceFile(fileId)
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379')
  let keys: string[] = [row?.storageKey, row?.pendingStorageKey, row?.replacedStorageKey].filter((key): key is string => Boolean(key))
  try {
    const raw = await redis.get(`upload_session:${sessionId}`)
    const session = raw
      ? JSON.parse(raw) as { status?: string; bind?: { userKey?: string; previousKey?: string } | null }
      : null
    const status = session?.status ?? 'missing'
    keys = [...new Set([
      ...keys,
      session?.bind?.userKey,
      session?.bind?.previousKey,
    ].filter((key): key is string => Boolean(key)))]
    const present: string[] = []
    let live: Buffer | null = null
    for (const key of keys) {
      const bytes = await fs.readFile(storagePath(root, key)).catch((error: NodeJS.ErrnoException) => (
        error.code === 'ENOENT' ? null : Promise.reject(error)
      ))
      if (!bytes) continue
      present.push(key)
      if (key === row?.storageKey) live = bytes
    }
    if (status === 'confirmed') {
      assert.equal(await redis.zscore('upload_session_expiry_index', sessionId), null, 'race: cleanup index remains')
      assert.ok(row && !row.deletedAt, `race ${round}: confirmed file deleted`)
      assert.equal(row?.ownerType, 'user')
      assert.equal(row?.ownerId, endUserId)
      assert.equal(row?.endUserId, endUserId)
      assert.equal(row?.pendingStorageKey, null)
      assert.equal(row?.replacedStorageKey, null)
      assert.ok(live?.equals(PDF_BYTES), `race ${round}: confirmed object unreadable`)
      assert.deepEqual(present.filter((key) => key !== row?.storageKey), [])
      return
    }
    assert.ok(status === 'cancelled' || status === 'expired', `race ${round}: redis ${status}`)
    assert.ok(row?.deletedAt, `race ${round}: live file after ${status}`)
    assert.deepEqual(present, [], `race ${round}: objects left after ${status}: ${present.join(',')}`)
  } finally {
    await redis.quit()
    for (const key of keys) await fs.unlink(storagePath(root, key)).catch(() => undefined)
  }
}

