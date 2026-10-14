import 'reflect-metadata'
import assert from 'node:assert/strict'
import { casBind, driveMemberBind, memberObjectKey, type MemberBindHost, type StoredUploadSession } from '../src/upload-sessions/upload-session-member-bind'
import { startUploadSessionLease } from '../src/upload-sessions/upload-session-lock-lease'
import { FakeRedis, deferred, file, makeService } from './support/upload-session-verifier'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const prefix = 'upload_session_upload_lock:'
const index = 'upload_session_expiry_index'

async function memberFixture() {
  const { service, prisma, files, redis } = makeService()
  const session = await service.create({
    purpose: 'resume_upload', mode: 'member', channel: 'phone_h5',
    uploadUrl: 'http://localhost:5173/upload/phone', endUserId: 'member_1',
  })
  const uploaded = await service.uploadFile({ sessionId: session.sessionId, uploadToken: session.uploadToken, file: file() })
  const stored = JSON.parse((await redis.get(`upload_session:${session.sessionId}`))!) as StoredUploadSession
  const host = (service as unknown as { memberBind: MemberBindHost }).memberBind
  host.lockTtlSeconds = 0.12
  host.copyTimeoutMs = 160
  return { service, prisma, files, redis, session, uploaded, stored, host }
}

async function main() {
  {
    const redis = new FakeRedis()
    assert.equal(await redis.setNxEx('lease:renew', 'mine', 0.12), true)
    const lease = startUploadSessionLease(redis as never, 'lease:renew', 'mine', 0.12, { renewIntervalMs: 25, maxHoldMs: 500 })
    await wait(170)
    assert.equal(await redis.get('lease:renew'), 'mine', 'renewal must retain the same token beyond original TTL')
    lease.assertActive()
    await lease.release()
    assert.equal(await redis.get('lease:renew'), null)
    console.log('PASS short TTL renewal')
  }
  {
    const redis = new FakeRedis()
    await redis.setNxEx('lease:successor', 'mine', 0.12)
    const lease = startUploadSessionLease(redis as never, 'lease:successor', 'mine', 0.12, { renewIntervalMs: 25, maxHoldMs: 500 })
    await wait(40)
    await redis.del('lease:successor')
    await redis.setNxEx('lease:successor', 'successor', 0.08)
    await wait(140)
    assert.equal(await redis.get('lease:successor'), null, 'renewal must not extend a successor token')
    assert.throws(() => lease.assertActive(), { name: 'BadRequestException' })
    await lease.release()
    console.log('PASS successor token cannot be renewed or deleted')
  }
  {
    const redis = new FakeRedis()
    await redis.setNxEx('lease:maximum', 'mine', 0.12)
    const lease = startUploadSessionLease(redis as never, 'lease:maximum', 'mine', 0.12, { renewIntervalMs: 25, maxHoldMs: 90 })
    const releaseWork = deferred()
    const bounded = lease.runBounded(() => releaseWork.promise, 500).then(
      () => false, () => true,
    )
    await wait(110)
    assert.equal(await bounded, true, 'maximum hold must fail blocked work')
    assert.equal(await redis.get('lease:maximum'), null, 'maximum hold must release the lock')
    releaseWork.resolve()
    await lease.release()
    console.log('PASS total hold maximum')
  }
  {
    const { service, prisma, files, redis, session, stored, host, uploaded } = await memberFixture()
    const lockKey = `${prefix}${session.sessionId}`
    await redis.setNxEx(lockKey, 'holder', 0.12)
    const lease = startUploadSessionLease(redis as never, lockKey, 'holder', 0.12, { renewIntervalMs: 25, maxHoldMs: 500 })
    const entered = deferred()
    const releaseCopy = deferred()
    let copies = 0
    files.copyObjectToKey = async () => {
      copies += 1
      if (copies === 1) { entered.resolve(); await releaseCopy.promise }
    }
    const binding = driveMemberBind(host, stored, lease, 'member_1').then(
      () => false, (error: unknown) => {
        assert.equal((error as { getResponse(): { error: { code: string } } }).getResponse().error.code, 'UPLOAD_SESSION_ACTION_IN_PROGRESS')
        return true
      },
    ).finally(() => lease.release())
    await entered.promise
    await wait(135)
    assert.equal(await redis.get(lockKey), 'holder', 'scanner must see the live lease after original TTL')
    const scan = await service.cleanupExpiredSessions(Date.now())
    assert.equal(scan.skipped, 1, 'whole-minute scan must skip the live binding')
    assert.equal(copies, 1, 'scan must not start a second copy')
    assert.equal(await Promise.race([binding, wait(300).then(() => { throw new Error('copy timeout did not bound the request') })]), true, 'copy timeout must fail the request')
    const row = prisma.files.get(uploaded.file!.fileId)!
    assert.notEqual(row.ownerType, 'user', 'timed-out copy must not apply ownership')
    assert.ok(row.pendingStorageKey && !row.replacedStorageKey, 'copy remains staged without ownership switch')
    assert.equal(await redis.get(lockKey), 'holder', 'lease stays until late copy settles')
    releaseCopy.resolve()
    const deadline = Date.now() + 500
    while (await redis.get(lockKey)) {
      assert.ok(Date.now() < deadline, 'lease was not released after late copy')
      await wait(10)
    }
    const takeover = await service.cleanupExpiredSessions(Date.now())
    assert.equal(takeover.cleaned, 1)
    const final = await service.getStatus(session.sessionId, session.controlToken)
    assert.equal(final.status, 'confirmed')
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.ownerType, 'user')
    assert.equal(redis.hasSortedSetMember(index, session.sessionId), false)
    console.log('PASS bounded copy, scan skip, late settle, and terminal takeover')
  }
  {
    const { service, prisma, redis, session, uploaded, stored, host } = await memberFixture()
    const lockKey = `${prefix}${session.sessionId}`
    await redis.setNxEx(lockKey, 'dead-holder', 0.12)
    const row = prisma.files.get(uploaded.file!.fileId)!
    const intent = {
      phase: 'intent' as const, fileId: row.id, endUserId: 'member_1',
      userKey: memberObjectKey(row as never, 'member_1'), previousKey: row.storageKey, bucket: row.bucket,
    }
    await casBind(host, stored, { lockKey, lockToken: 'dead-holder' }, intent, '')
    assert.equal((await service.cleanupExpiredSessions(Date.now())).skipped, 1)
    await wait(140)
    assert.equal((await service.cleanupExpiredSessions(Date.now())).cleaned, 1)
    assert.equal((await service.getStatus(session.sessionId, session.controlToken)).status, 'confirmed')
    assert.equal(prisma.files.get(row.id)?.ownerType, 'user')
    console.log('PASS dead holder expiry and takeover')
  }
  {
    const { service, prisma, files, redis, session, uploaded, stored, host } = await memberFixture()
    const lockKey = `${prefix}${session.sessionId}`
    const row = prisma.files.get(uploaded.file!.fileId)!
    const intent = {
      phase: 'intent' as const, fileId: row.id, endUserId: 'member_1',
      userKey: memberObjectKey(row as never, 'member_1'), previousKey: row.storageKey, bucket: row.bucket,
    }
    await redis.setNxEx(lockKey, 'expired-holder', 0.12)
    await casBind(host, stored, { lockKey, lockToken: 'expired-holder' }, intent, '')
    await redis.del(lockKey)
    const entered = deferred()
    const releaseCopy = deferred()
    files.copyObjectToKey = async () => { entered.resolve(); await releaseCopy.promise }
    const cleanup = service.cleanupExpiredSessions(Date.now())
    await entered.promise
    await wait(150)
    const token = await redis.get(lockKey)
    assert.ok(token, 'cleanup must retain its token beyond the original short TTL')
    await assert.rejects(service.cancel(session.sessionId, session.controlToken), (error: unknown) => {
      assert.equal((error as { getResponse(): { error: { code: string } } }).getResponse().error.code, 'UPLOAD_SESSION_ACTION_IN_PROGRESS')
      return true
    })
    assert.equal(await redis.get(lockKey), token, 'cancel must not replace cleanup holder')
    releaseCopy.resolve()
    assert.equal((await cleanup).cleaned, 1)
    console.log('PASS cleanup renews binding lock and rejects cancel past short TTL')
  }
  {
    const { service, prisma, files, redis, session, uploaded, host } = await memberFixture()
    host.backgroundCopyTimeoutMs = 400
    const lockKey = `${prefix}${session.sessionId}`
    const firstEntered = deferred()
    const releaseFirst = deferred()
    let copies = 0
    files.copyObjectToKey = async () => {
      copies += 1
      if (copies === 1) { firstEntered.resolve(); await releaseFirst.promise }
      else await wait(220)
    }
    const confirm = service.confirm(session.sessionId, session.controlToken, 'member_1')
    await firstEntered.promise
    await assert.rejects(confirm, (error: unknown) => {
      assert.equal((error as { getResponse(): { error: { code: string } } }).getResponse().error.code, 'UPLOAD_SESSION_ACTION_IN_PROGRESS')
      return true
    })
    assert.ok(await redis.get(lockKey), 'interactive timeout retains the lock until copy settles')
    releaseFirst.resolve()
    const deadline = Date.now() + 500
    while (await redis.get(lockKey)) {
      assert.ok(Date.now() < deadline, 'interactive lock must release after late copy')
      await wait(10)
    }
    const cleanup = await service.cleanupExpiredSessions(Date.now())
    assert.equal(cleanup.cleaned, 1, 'background copy must finish after interactive timeout')
    assert.equal(copies, 2)
    assert.equal((await service.getStatus(session.sessionId, session.controlToken)).status, 'confirmed')
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.ownerType, 'user')
    assert.equal(redis.hasSortedSetMember(index, session.sessionId), false)
    console.log('PASS background copy exceeds interactive bound and completes within background bound')
  }
  {
    const { service, prisma, files, redis, session, uploaded, stored, host } = await memberFixture()
    host.backgroundCopyTimeoutMs = 90
    const lockKey = `${prefix}${session.sessionId}`
    const row = prisma.files.get(uploaded.file!.fileId)!
    const intent = {
      phase: 'intent' as const, fileId: row.id, endUserId: 'member_1',
      userKey: memberObjectKey(row as never, 'member_1'), previousKey: row.storageKey, bucket: row.bucket,
    }
    await redis.setNxEx(lockKey, 'expired-holder', 0.12)
    await casBind(host, stored, { lockKey, lockToken: 'expired-holder' }, intent, '')
    await redis.del(lockKey)
    const entered = deferred()
    const releaseCopy = deferred()
    files.copyObjectToKey = async () => { entered.resolve(); await releaseCopy.promise }
    const cleanup = service.cleanupExpiredSessions(Date.now())
    await entered.promise
    try {
      const outcome = await Promise.race([
        cleanup,
        wait(280).then(() => { throw new Error('background copy exceeded its bounded timeout') }),
      ])
      assert.equal(outcome.failed, 1, 'background timeout must fail this sweep')
      assert.equal(prisma.files.get(row.id)?.ownerType, 'system')
      assert.equal((await service.getStatus(session.sessionId, session.controlToken)).status, 'uploaded')
      assert.equal(redis.hasSortedSetMember(index, session.sessionId), true)
    } finally {
      releaseCopy.resolve()
    }
    assert.equal(prisma.files.get(row.id)?.ownerType, 'system', 'late copy must not apply ownership')
    console.log('PASS bounded background copy fails without later side effects')
  }
  {
    const { prisma, files, redis, session, uploaded, stored, host } = await memberFixture()
    const lockKey = `${prefix}${session.sessionId}`
    await redis.setNxEx(lockKey, 'original', 0.12)
    const lease = startUploadSessionLease(redis as never, lockKey, 'original', 0.12, { renewIntervalMs: 25, maxHoldMs: 500 })
    const entered = deferred()
    const releaseCopy = deferred()
    files.copyObjectToKey = async () => { entered.resolve(); await releaseCopy.promise }
    const binding = driveMemberBind(host, stored, lease, 'member_1').then(
      () => false, () => true,
    ).finally(() => lease.release())
    await entered.promise
    await redis.del(lockKey)
    await redis.setNxEx(lockKey, 'successor', 0.3)
    await wait(45)
    releaseCopy.resolve()
    assert.equal(await binding, true, 'lost holder must fail after late copy')
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.ownerType, 'system')
    assert.equal(await redis.get(lockKey), 'successor', 'lost holder must not release successor')
    console.log('PASS lost lease prevents ownership and commit')
  }
  {
    const { prisma, redis, session, uploaded, stored, host } = await memberFixture()
    const lockKey = `${prefix}${session.sessionId}`
    await redis.setNxEx(lockKey, 'original', 0.12)
    const lease = startUploadSessionLease(redis as never, lockKey, 'original', 0.12, { renewIntervalMs: 25, maxHoldMs: 500 })
    const commit = host.commitSession.bind(host)
    host.commitSession = async (...args) => {
      const outcome = await commit(...args)
      if (args[0].bind?.phase === 'copied' && outcome === 'updated') await redis.del(lockKey)
      return outcome
    }
    const failed = await driveMemberBind(host, stored, lease, 'member_1').then(() => false, () => true)
    await lease.release()
    assert.equal(failed, true)
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.ownerType, 'system', 'lost lease must stop before ownership update')
    console.log('PASS loss immediately before ownership blocks side effects')
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1 })
