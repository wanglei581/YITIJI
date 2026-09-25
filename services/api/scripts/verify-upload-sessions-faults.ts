import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-upload-sessions-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Redis } from 'ioredis'
import { RedisService } from '../src/common/redis/redis.service'
import { FilesService } from '../src/files/files.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'
import { UploadSessionsService } from '../src/upload-sessions/upload-sessions.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { file } from './support/upload-session-verifier'

const STORAGE_DIR = path.join('/tmp', `verify-f01-fault-${process.pid}`)

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function faultsEnabled(): boolean {
  const url = process.env['DATABASE_URL']?.trim() ?? ''
  if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) return false
  process.env['VERIFICATION_DATABASE_TARGET'] ||= 'isolated'
  assertIsolatedVerificationDatabase()
  if (!process.env['REDIS_URL']?.trim()) throw new Error('REDIS_URL is required for upload fault injection')
  return true
}

async function harness(): Promise<{
  prisma: PrismaService
  redis: RedisService
  client: Redis
  storage: StorageService
  files: FilesService
  service: UploadSessionsService
}> {
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const client = new Redis(process.env['REDIS_URL']!)
  const redis = new RedisService(client)
  const storage = new StorageService()
  const files = new FilesService(prisma, { write: async () => null } as never, storage)
  const service = new UploadSessionsService(redis, prisma, files)
  return { prisma, redis, client, storage, files, service }
}

async function member(prisma: PrismaService): Promise<string> {
  const id = `eu_${randomUUID().replace(/-/g, '')}`
  await prisma.endUser.create({
    data: { id, phoneHash: `hash_${id}`, phoneEnc: 'enc' },
  })
  return id
}

async function forget(client: Redis, sessionId: string): Promise<void> {
  await client.del(
    `upload_session:${sessionId}`,
    `upload_session_upload_lock:${sessionId}`,
    `upload_session_cleanup:${sessionId}`,
  )
  await client.zrem('upload_session_expiry_index', sessionId)
}

async function assertKillAndRecover(): Promise<void> {
  const note = path.join(STORAGE_DIR, 'kill-note.json')
  const child = spawn(process.execPath, ['-r', '@swc-node/register', process.argv[1] ?? ''], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      UPLOAD_FAULT_CHILD: '1',
      UPLOAD_FAULT_NOTE: note,
      UPLOAD_FAULT_STORAGE: STORAGE_DIR,
      FILE_STORAGE_DIR: STORAGE_DIR,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const timer = setTimeout(() => child.kill('SIGKILL'), 20_000)
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (status) => resolve(status ?? 1))
  })
  clearTimeout(timer)
  assert.equal(code, 137, `kill child must exit 137 after ownership, stderr=${stderr.slice(0, 500)}`)
  const saved = JSON.parse(readFileSync(note, 'utf8')) as {
    sessionId: string
    controlToken: string
    fileId: string
    endUserId: string
  }
  const { prisma, client, storage, service } = await harness()
  try {
    const mid = await prisma.fileObject.findUnique({ where: { id: saved.fileId } })
    assert.equal(mid?.ownerType, 'user', 'ownership must survive the killed process')
    assert.equal(mid?.deletedAt ?? null, null)
    const anonymousKey = mid?.replacedStorageKey
    assert.ok(anonymousKey)
    const raw = await client.get(`upload_session:${saved.sessionId}`)
    assert.equal(JSON.parse(raw ?? '{}').status, 'uploaded', 'a killed bind must not already be confirmed')
    const cleanup = await client.get(`upload_session_cleanup:${saved.sessionId}`)
    assert.equal(cleanup?.includes(saved.fileId), true, 'cleanup snapshot must keep the file id')
    await client.del(`upload_session:${saved.sessionId}`)
    await client.del(`upload_session_upload_lock:${saved.sessionId}`)
    await service.cleanupExpiredSessions(Date.now() + 1000)
    const recovered = await prisma.fileObject.findUnique({ where: { id: saved.fileId } })
    assert.equal(recovered?.ownerType, 'user')
    assert.equal(recovered?.deletedAt ?? null, null)
    assert.equal(recovered?.replacedStorageKey ?? null, null)
    assert.match(recovered?.storageKey ?? '', new RegExp(`^users/${saved.endUserId}/`))
    assert.equal(await storage.headObject(anonymousKey, mid?.bucket), null, 'recovery must delete the anonymous object')
    assert.ok(await storage.headObject(recovered!.storageKey, recovered?.bucket), 'the member object must remain')
    const status = await service.getStatus(saved.sessionId, saved.controlToken)
    assert.equal(status.status, 'confirmed', 'recovery after the session key expired must finish the bind')
    console.log('  PASS kill during bind recovers from the cleanup snapshot')
  } finally {
    await prisma.fileObject.deleteMany({ where: { id: saved.fileId } })
    await prisma.endUser.deleteMany({ where: { id: saved.endUserId } })
    await forget(client, saved.sessionId)
    await client.quit()
    await prisma.onModuleDestroy()
  }
}

async function childKill(): Promise<void> {
  if (process.env['UPLOAD_FAULT_STORAGE']) process.env['FILE_STORAGE_DIR'] = process.env['UPLOAD_FAULT_STORAGE']
  const note = process.env['UPLOAD_FAULT_NOTE']
  if (!note) throw new Error('UPLOAD_FAULT_NOTE missing')
  const { prisma, client, files, service } = await harness()
  const endUserId = await member(prisma)
  const session = await service.create({
    purpose: 'resume_upload',
    mode: 'member',
    channel: 'phone_h5',
    uploadUrl: 'http://localhost:5173/upload/phone',
    endUserId,
  })
  const uploaded = await service.uploadFile({
    sessionId: session.sessionId,
    uploadToken: session.uploadToken,
    file: file(),
  })
  writeFileSync(note, JSON.stringify({
    sessionId: session.sessionId,
    controlToken: session.controlToken,
    fileId: uploaded.file!.fileId,
    endUserId,
  }))
  const original = prisma.fileObject.updateMany.bind(prisma.fileObject)
  prisma.fileObject.updateMany = (async (args: { data?: { ownerType?: string } }) => {
    const result = await original(args as never)
    if (args.data?.ownerType === 'user' && result.count === 1) process.exit(137)
    return result
  }) as typeof prisma.fileObject.updateMany
  await service.confirm(session.sessionId, session.controlToken, endUserId)
  await files.systemDelete(uploaded.file!.fileId, 'child did not stop').catch(() => undefined)
  await client.quit()
  await prisma.onModuleDestroy()
  process.exit(1)
}

async function assertLockExpiry(): Promise<void> {
  const { prisma, client, files, service } = await harness()
  const endUserId = await member(prisma)
  let sessionId = ''
  let fileId = ''
  try {
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId,
    })
    sessionId = session.sessionId
    const uploaded = await service.uploadFile({
      sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    fileId = uploaded.file!.fileId
    const entered = deferred()
    const release = deferred()
    const originalCopy = files.copyObjectToKey.bind(files)
    files.copyObjectToKey = async (fromKey, toKey, mimeType, bucket) => {
      entered.resolve()
      await release.promise
      return originalCopy(fromKey, toKey, mimeType, bucket)
    }
    const confirming = service.confirm(sessionId, session.controlToken, endUserId).then(
      () => 'confirmed' as const,
      () => 'rejected' as const,
    )
    await entered.promise
    await client.del(`upload_session_upload_lock:${sessionId}`)
    const cancel = await service.cancel(sessionId, session.controlToken).then(
      () => 'cancelled' as const,
      () => 'rejected' as const,
    )
    release.resolve()
    const confirm = await confirming
    const status = await service.getStatus(sessionId, session.controlToken)
    const row = await prisma.fileObject.findUnique({ where: { id: fileId } })
    const liveMember = Boolean(row && !row.deletedAt && row.ownerType === 'user')
    assert.equal(confirm === 'confirmed' && status.status !== 'confirmed', false)
    assert.equal(status.status === 'confirmed' && row?.deletedAt != null, false, 'lock expiry must not confirm a deleted file')
    assert.equal(cancel === 'cancelled' && liveMember, false, 'a cancelled session must not keep a live member file')
    if (status.status === 'confirmed') assert.equal(liveMember, true)
    console.log('  PASS lock expiry does not publish confirmed over a lost file')
  } finally {
    if (fileId) await prisma.fileObject.deleteMany({ where: { id: fileId } })
    await prisma.endUser.deleteMany({ where: { id: endUserId } })
    if (sessionId) await forget(client, sessionId)
    await client.quit()
    await prisma.onModuleDestroy()
  }
}

async function assertConcurrentConfirmCancel(): Promise<void> {
  const { prisma, client, service } = await harness()
  const endUserId = await member(prisma)
  let sessionId = ''
  let fileId = ''
  try {
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId,
    })
    sessionId = session.sessionId
    const uploaded = await service.uploadFile({
      sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    fileId = uploaded.file!.fileId
    const [confirm, cancel] = await Promise.all([
      service.confirm(sessionId, session.controlToken, endUserId).then(
        () => 'confirmed' as const,
        () => 'rejected' as const,
      ),
      service.cancel(sessionId, session.controlToken).then(
        () => 'cancelled' as const,
        () => 'rejected' as const,
      ),
    ])
    const status = await service.getStatus(sessionId, session.controlToken)
    const row = await prisma.fileObject.findUnique({ where: { id: fileId } })
    assert.equal(status.status === 'confirmed' && row?.deletedAt != null, false)
    assert.equal(confirm === 'confirmed' && cancel === 'cancelled', false, 'confirm and cancel must not both succeed')
    if (status.status === 'confirmed') {
      assert.equal(row?.ownerType, 'user')
      assert.equal(row?.deletedAt ?? null, null)
    }
    if (status.status === 'cancelled' || status.status === 'expired') {
      assert.notEqual(row?.deletedAt ?? null, null)
    }
    console.log('  PASS concurrent confirm and cancel keep one outcome')
  } finally {
    if (fileId) await prisma.fileObject.deleteMany({ where: { id: fileId } })
    await prisma.endUser.deleteMany({ where: { id: endUserId } })
    if (sessionId) await forget(client, sessionId)
    await client.quit()
    await prisma.onModuleDestroy()
  }
}

async function assertObjectDeleteFailure(): Promise<void> {
  const { prisma, client, storage, service } = await harness()
  let sessionId = ''
  let fileId = ''
  const original = storage.deleteObject.bind(storage)
  try {
    const session = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    sessionId = session.sessionId
    const uploaded = await service.uploadFile({
      sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'delete-fail.pdf' }),
    })
    fileId = uploaded.file!.fileId
    const row = await prisma.fileObject.findUnique({ where: { id: fileId } })
    assert.ok(row)
    let fail = true
    storage.deleteObject = async (objectKey, bucket) => {
      if (fail && objectKey === row.storageKey) throw new Error('injected object delete failure')
      return original(objectKey, bucket)
    }
    await assert.rejects(
      () => service.cancel(sessionId, session.controlToken),
      /injected object delete failure/,
      'cancel must surface an object delete failure',
    )
    const failed = await prisma.fileObject.findUnique({ where: { id: fileId } })
    assert.equal(failed?.deletedAt ?? null, null, 'a failed object delete must not tombstone the file row')
    assert.ok(failed?.storageDeletePendingAt, 'object delete failure must be recorded for retry')
    assert.equal(failed?.storageDeleteError, 'Error')
    assert.ok(await storage.headObject(row.storageKey, row.bucket), 'the object must still be readable')
    fail = false
    await service.cleanupExpiredSessions(new Date(session.expiresAt).getTime() + 1)
    const retried = await prisma.fileObject.findUnique({ where: { id: fileId } })
    assert.ok(retried?.deletedAt, 'retry must tombstone only after the object delete succeeds')
    assert.ok(retried?.storageDeletedAt)
    assert.equal(await storage.headObject(row.storageKey, row.bucket), null)
    console.log('  PASS object delete failure stays retryable and does not tombstone first')
  } finally {
    storage.deleteObject = original
    if (fileId) await prisma.fileObject.deleteMany({ where: { id: fileId } })
    if (sessionId) await forget(client, sessionId)
    await client.quit()
    await prisma.onModuleDestroy()
  }
}

async function assertExpiredOwnershipDoesNotConfirm(): Promise<void> {
  const { prisma, client, files, service } = await harness()
  const endUserId = await member(prisma)
  let sessionId = ''
  let fileId = ''
  try {
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId,
    })
    sessionId = session.sessionId
    const uploaded = await service.uploadFile({
      sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    fileId = uploaded.file!.fileId
    const row = await prisma.fileObject.findUnique({ where: { id: fileId } })
    assert.ok(row)
    const userKey = `users/${endUserId}/resumes/${fileId}.pdf`
    await files.copyObjectToKey(row.storageKey, userKey, row.mimeType, row.bucket)
    await prisma.fileObject.update({
      where: { id: fileId },
      data: {
        endUserId,
        ownerType: 'user',
        ownerId: endUserId,
        storageKey: userKey,
        pendingStorageKey: null,
        replacedStorageKey: row.storageKey,
      },
    })
    const sessionKey = `upload_session:${sessionId}`
    const stored = JSON.parse((await client.get(sessionKey)) ?? '{}') as Record<string, unknown>
    stored['expiresAt'] = new Date(Date.now() - 1000).toISOString()
    stored['bind'] = {
      phase: 'db-applied',
      fileId,
      endUserId,
      userKey,
      previousKey: row.storageKey,
      bucket: row.bucket,
    }
    await client.set(sessionKey, JSON.stringify(stored), 'KEEPTTL')
    await assert.rejects(
      () => service.confirm(sessionId, session.controlToken, endUserId),
      (error: unknown) => {
        const response = (error as { getResponse?: () => { error?: { code?: string; memberFileRetained?: boolean } } }).getResponse?.()
        const serialized = JSON.stringify(response ?? {})
        return response?.error?.code === 'UPLOAD_SESSION_EXPIRED'
          && response.error.memberFileRetained === true
          && !serialized.includes(row.filename)
          && !serialized.includes(fileId)
          && !serialized.includes(userKey)
      },
      'an expired session must not confirm after ownership has switched',
    )
    const status = await service.getStatus(sessionId, session.controlToken)
    assert.notEqual(status.status, 'confirmed')
    await service.cleanupExpiredSessions(Date.now())
    const afterCleanup = await service.getStatus(sessionId, session.controlToken).catch(() => null)
    assert.notEqual(afterCleanup?.status, 'confirmed', 'expiry sweep must not publish confirmed')
    const kept = await prisma.fileObject.findUnique({ where: { id: fileId } })
    assert.equal(kept?.deletedAt ?? null, null, 'an already bound member file must stay')
    assert.equal(kept?.ownerType, 'user')
    let cancelConfirmed = false
    try {
      await service.cancel(sessionId, session.controlToken)
    } catch (error) {
      const response = (error as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()
      cancelConfirmed = response?.error?.code === 'UPLOAD_SESSION_CONFIRMED'
    }
    assert.equal(cancelConfirmed, false, 'cancel must not report confirmed for an expired bind')
    const finalStatus = await service.getStatus(sessionId, session.controlToken).catch(() => null)
    assert.notEqual(finalStatus?.status, 'confirmed')
    console.log('  PASS expired ownership does not publish confirmed')
  } finally {
    if (fileId) await prisma.fileObject.deleteMany({ where: { id: fileId } })
    await prisma.endUser.deleteMany({ where: { id: endUserId } })
    if (sessionId) await forget(client, sessionId)
    await client.quit()
    await prisma.onModuleDestroy()
  }
}

async function assertStaleRevisionDoesNotOverwrite(): Promise<void> {
  const { prisma, client, redis } = await harness()
  const sessionKey = `upload_session:rev_${randomUUID().replace(/-/g, '')}`
  const lockKey = `${sessionKey}:lock`
  try {
    const current = {
      status: 'uploaded',
      revision: 4,
      file: { fileId: 'file_rev' },
      bind: { phase: 'intent' },
    }
    await client.set(sessionKey, JSON.stringify(current), 'EX', 60)
    await client.set(lockKey, 'token', 'EX', 60)
    const stale = { ...current, status: 'expired', revision: 5 }
    const result = await redis.compareAndSetSession(
      sessionKey,
      lockKey,
      'token',
      JSON.stringify(stale),
      'uploaded',
      'file_rev',
      'intent',
      null,
      3,
    )
    assert.equal(result, 'conflict', 'a stale revision must not win the compare')
    const stored = JSON.parse((await client.get(sessionKey)) ?? '{}') as { status?: string; revision?: number }
    assert.equal(stored.status, 'uploaded')
    assert.equal(stored.revision, 4)
    console.log('  PASS stale cleanup writeback does not overwrite a newer revision')
  } finally {
    await client.del(sessionKey, lockKey)
    await client.quit()
    await prisma.onModuleDestroy()
  }
}

async function main(): Promise<void> {
  if (!faultsEnabled()) {
    console.log('SKIP upload session fault injection: DATABASE_URL is not an isolated postgres database')
    return
  }
  mkdirSync(STORAGE_DIR, { recursive: true })
  process.env['FILE_STORAGE_DIR'] = STORAGE_DIR
  process.env['FILE_STORAGE_DRIVER'] = 'local'
  try {
    await assertKillAndRecover()
    await assertLockExpiry()
    await assertConcurrentConfirmCancel()
    await assertObjectDeleteFailure()
    await assertExpiredOwnershipDoesNotConfirm()
    await assertStaleRevisionDoesNotOverwrite()
    console.log('PASS upload session fault injection')
  } finally {
    rmSync(STORAGE_DIR, { recursive: true, force: true })
  }
}

if (process.env['UPLOAD_FAULT_CHILD'] === '1') {
  void childKill().catch((error) => {
    console.error(error)
    process.exit(1)
  })
} else {
  void main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
