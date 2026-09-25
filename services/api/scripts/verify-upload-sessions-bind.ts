import 'reflect-metadata'
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { FakeRedis, deferred, expectRejects, file, makeService } from './support/upload-session-verifier'

async function main(): Promise<void> {
  {
    // A 读到自己的锁之后、写入 uploaded 之前，锁过期。B 完成上传。
    // A 若仍用非原子 SET 回写，两部手机都收到成功，一体机只留下后写的那一份。
    const { service, prisma, redis } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const sessionKey = `upload_session:${session.sessionId}`
    const cleanupKey = `upload_session_cleanup:${session.sessionId}`
    const originalCommit = redis.compareAndSetSession.bind(redis)
    let armed = true
    let winnerId = ''
    redis.compareAndSetSession = async (key, heldLock, lockToken, nextValue, expectedStatus) => {
      if (armed && key === sessionKey && expectedStatus === 'uploading') {
        const parsed = JSON.parse(nextValue) as { status?: string }
        if (parsed.status === 'uploaded') {
          armed = false
          await redis.del(heldLock)
          const winner = await service.uploadFile({
            sessionId: session.sessionId,
            uploadToken: session.uploadToken,
            file: file({ originalname: 'winner.pdf' }),
          })
          winnerId = winner.file!.fileId
          // 锁值又变回 A，只核对锁就会盖掉 B 已经写成的收据。
          await redis.setEx(heldLock, 30, lockToken)
        }
      }
      return originalCommit(key, heldLock, lockToken, nextValue, expectedStatus)
    }
    let loserOk = true
    try {
      await service.uploadFile({
        sessionId: session.sessionId,
        uploadToken: session.uploadToken,
        file: file({ originalname: 'loser.pdf' }),
      })
    } catch {
      loserOk = false
    }
    const status = await service.getStatus(session.sessionId, session.controlToken)
    const cleanup = JSON.parse((await redis.get(cleanupKey)) ?? '{}') as { file?: { fileId?: string } | null }
    const loserFile = [...prisma.files.values()].find((item) => item.filename === 'loser.pdf')
    assert.equal(loserOk, false, 'upload whose lock expired before commit must not report success')
    assert.equal(status.status, 'uploaded')
    assert.equal(status.file?.fileId, winnerId, 'kiosk receipt must stay with the upload that committed under the lock')
    assert.equal(cleanup.file?.fileId, winnerId, 'expiry cleanup record must name the same file as the receipt')
    assert.equal(prisma.files.get(winnerId)?.deletedAt ?? null, null)
    assert.ok(loserFile?.deletedAt, 'loser may delete only its own bytes')
  }

  {
    const { service, prisma, redis } = makeService()
    const session = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const sessionKey = `upload_session:${session.sessionId}`
    const cleanupKey = `upload_session_cleanup:${session.sessionId}`
    const originalCommit = redis.compareAndSetSession.bind(redis)
    let armed = true
    let winnerId = ''
    redis.compareAndSetSession = async (key, heldLock, lockToken, nextValue, expectedStatus) => {
      if (armed && key === sessionKey && expectedStatus === 'uploading') {
        const parsed = JSON.parse(nextValue) as { status?: string }
        if (parsed.status === 'uploaded') {
          armed = false
          await redis.del(heldLock)
          const winner = await service.uploadFile({
            sessionId: session.sessionId,
            uploadToken: session.uploadToken,
            file: file({ originalname: 'kept.pdf' }),
          })
          winnerId = winner.file!.fileId
          await redis.setEx(heldLock, 30, 'successor-lock')
        }
      }
      return originalCommit(key, heldLock, lockToken, nextValue, expectedStatus)
    }
    await expectRejects(
      () => service.uploadFile({
        sessionId: session.sessionId,
        uploadToken: session.uploadToken,
        file: file({ originalname: 'dropped.pdf' }),
      }),
      BadRequestException,
      'stale upload must not overwrite the successor receipt',
    )
    const status = await service.getStatus(session.sessionId, session.controlToken)
    const cleanup = JSON.parse((await redis.get(cleanupKey)) ?? '{}') as { file?: { fileId?: string } | null }
    assert.equal(await redis.get(`upload_session_upload_lock:${session.sessionId}`), 'successor-lock')
    assert.equal(status.file?.fileId, winnerId)
    assert.equal(cleanup.file?.fileId, winnerId)
    assert.equal(prisma.files.get(winnerId)?.deletedAt ?? null, null)
    const dropped = [...prisma.files.values()].find((item) => item.filename === 'dropped.pdf')
    assert.ok(dropped?.deletedAt, 'dropped upload deletes its own file')
  }

  {
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const sessionKey = `upload_session:${session.sessionId}`
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const redis = (service as unknown as { redis: FakeRedis }).redis
    const originalGet = redis.get.bind(redis)
    const releaseRead = deferred()
    const readHeld = deferred()
    let holdRead = true
    redis.get = async (key: string) => {
      if (holdRead && key === sessionKey) {
        holdRead = false
        const value = await originalGet(key)
        readHeld.resolve()
        await releaseRead.promise
        return value
      }
      return originalGet(key)
    }
    const resolving = service.resolveScene(session.sceneToken).then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const }),
    )
    await readHeld.promise
    await redis.del(lockKey)
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'during-resolve.pdf' }),
    })
    releaseRead.resolve()
    const resolved = await resolving
    const status = await service.getStatus(session.sessionId, session.controlToken)
    assert.equal(resolved.ok, false, 'scene resolve must not mint a token after its lock timed out')
    assert.equal(status.status, 'uploaded')
    assert.equal(status.file?.fileId, uploaded.file?.fileId, 'scene resolve must not rewind an uploaded receipt')
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null, null)
  }

  {
    // A 拿到锁并读到 pending 后、写入 uploading 前锁过期。B 已原子提交。
    // 普通 persist 会把 B 的收据盖成 uploading 且没有文件，B 的字节脱离会话。
    const { service, prisma, redis, files } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const sessionKey = `upload_session:${session.sessionId}`
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const cleanupKey = `upload_session_cleanup:${session.sessionId}`
    const originalGet = redis.get.bind(redis)
    let armed = true
    let winnerId = ''
    redis.get = async (key: string) => {
      const value = await originalGet(key)
      if (armed && key === sessionKey && value?.includes('"status":"pending"')) {
        armed = false
        await redis.del(lockKey)
        const winner = await service.uploadFile({
          sessionId: session.sessionId,
          uploadToken: session.uploadToken,
          file: file({ originalname: 'winner-before-uploading.pdf' }),
        })
        winnerId = winner.file!.fileId
      }
      return value
    }
    let loserOk = true
    try {
      await service.uploadFile({
        sessionId: session.sessionId,
        uploadToken: session.uploadToken,
        file: file({ originalname: 'loser-before-uploading.pdf' }),
      })
    } catch {
      loserOk = false
    }
    const status = await service.getStatus(session.sessionId, session.controlToken)
    const cleanup = JSON.parse((await redis.get(cleanupKey)) ?? '{}') as { file?: { fileId?: string } | null }
    assert.equal(loserOk, false, 'A must not report success after its lock expired before uploading')
    assert.equal(status.status, 'uploaded')
    assert.equal(status.file?.fileId, winnerId, 'B receipt must survive A resuming the uploading write')
    assert.equal(cleanup.file?.fileId, winnerId)
    assert.equal(prisma.files.get(winnerId)?.deletedAt ?? null, null)
    assert.equal(files.uploadCalls.length, 1, 'A must not store a file after the uploading transition loses the lock')
    assert.equal(files.uploadCalls[0]?.filename, 'winner-before-uploading.pdf')
  }

  {
    // 会员确认在绑定文件时锁过期。取消先删文件再标 cancelled。
    // 旧确认恢复后普通 persist(confirmed)，对已删除文件返回成功。
    const { service, prisma, redis, files } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_1',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const entered = deferred()
    const release = deferred()
    const originalCopy = files.copyObjectToKey.bind(files)
    files.copyObjectToKey = async (fromKey: string, toKey: string, mimeType: string, bucket?: string | null) => {
      entered.resolve()
      await release.promise
      return originalCopy(fromKey, toKey, mimeType, bucket)
    }
    const confirming = service.confirm(session.sessionId, session.controlToken, 'member_1').then(
      () => ({ ok: true as const }),
      () => ({ ok: false as const }),
    )
    await entered.promise
    await redis.del(lockKey)
    await service.cancel(session.sessionId, session.controlToken)
    release.resolve()
    const confirmed = await confirming
    const status = await service.getStatus(session.sessionId, session.controlToken)
    assert.equal(confirmed.ok, false, 'confirm must not succeed after cancel committed during member bind')
    assert.equal(status.status, 'cancelled')
    assert.notEqual(prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null, null)
  }

  {
    // 取消读到 uploaded 后锁过期，确认先完成。旧取消仍会删除已确认文件。
    const { service, prisma, redis } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    const sessionKey = `upload_session:${session.sessionId}`
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const originalGet = redis.get.bind(redis)
    const held = deferred()
    const release = deferred()
    let armed = true
    redis.get = async (key: string) => {
      const value = await originalGet(key)
      if (armed && key === sessionKey && value?.includes('"status":"uploaded"')) {
        armed = false
        held.resolve()
        await release.promise
        return value
      }
      return value
    }
    const cancelling = service.cancel(session.sessionId, session.controlToken).then(
      () => ({ ok: true as const }),
      () => ({ ok: false as const }),
    )
    await held.promise
    await redis.del(lockKey)
    const confirmed = await service.confirm(session.sessionId, session.controlToken)
    release.resolve()
    await cancelling
    const status = await service.getStatus(session.sessionId, session.controlToken)
    assert.equal(confirmed.status, 'confirmed')
    assert.equal(status.status, 'confirmed')
    assert.equal(status.file?.fileId, confirmed.file.fileId)
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null, null, 'stale cancel must not delete a confirmed file')
  }

  {
    // 确认还在绑文件时会话到期。过期清扫若先删文件再写 expired，确认仍可能返回成功。
    const { service, prisma, redis, files } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_1',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    const sessionKey = `upload_session:${session.sessionId}`
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const entered = deferred()
    const release = deferred()
    const originalCopy = files.copyObjectToKey.bind(files)
    files.copyObjectToKey = async (fromKey: string, toKey: string, mimeType: string, bucket?: string | null) => {
      entered.resolve()
      await release.promise
      return originalCopy(fromKey, toKey, mimeType, bucket)
    }
    const confirming = service.confirm(session.sessionId, session.controlToken, 'member_1').then(
      () => ({ ok: true as const }),
      () => ({ ok: false as const }),
    )
    await entered.promise
    const raw = await redis.get(sessionKey)
    assert.ok(raw)
    const parsed = JSON.parse(raw) as { expiresAt: string }
    parsed.expiresAt = new Date(Date.now() - 1000).toISOString()
    await redis.setExistingWithCurrentTtl(sessionKey, JSON.stringify(parsed))
    await redis.zadd('upload_session_expiry_index', Date.now() - 1000, session.sessionId)
    await redis.del(lockKey)
    await service.cleanupExpiredSessions(Date.now())
    release.resolve()
    const confirmed = await confirming
    const status = await service.getStatus(session.sessionId, session.controlToken)
    assert.equal(confirmed.ok, false, 'confirm must not succeed after expiry cleanup committed')
    assert.notEqual(status.status, 'confirmed')
    assert.notEqual(prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null, null)
  }

  {
    // 比较先把 file 写成 null，随后 systemDelete 失败。重试清扫只看见空文件指针，对象泄漏。
    const { service, prisma, redis, files } = makeService()
    const session = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'delete-once.pdf' }),
    })
    let failDelete = true
    const originalDelete = files.systemDelete.bind(files)
    files.systemDelete = async (fileId: string, reason: string) => {
      if (failDelete) {
        failDelete = false
        throw new Error('storage delete failed once')
      }
      return originalDelete(fileId, reason)
    }
    await expectRejects(
      () => service.cancel(session.sessionId, session.controlToken),
      Error,
      'cancel must not succeed when the object delete fails',
    )
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null, null)
    await service.cleanupExpiredSessions(new Date(session.expiresAt).getTime() + 1)
    assert.notEqual(
      prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null,
      null,
      'retry cleanup must delete the object the failed cancel still owns',
    )
    assert.equal(
      redis.hasSortedSetMember('upload_session_expiry_index', session.sessionId),
      false,
      'expiry index stays until the object delete succeeds',
    )
  }

  {
    // 会员归属在最终比较前已经写上。取消看到 ownerType=user 就跳过删除，确认比较失败，留下已取消会话的会员文件。
    const { service, prisma, redis } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_1',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const entered = deferred()
    const release = deferred()
    const originalUpdate = prisma.fileObject.update.bind(prisma.fileObject)
    prisma.fileObject.update = async (args) => {
      const updated = await originalUpdate(args)
      if (args.data.ownerType === 'user') {
        entered.resolve()
        await release.promise
      }
      return updated
    }
    const confirming = service.confirm(session.sessionId, session.controlToken, 'member_1').then(
      () => ({ ok: true as const }),
      () => ({ ok: false as const }),
    )
    await entered.promise
    await redis.del(lockKey)
    let cancelOk = true
    try {
      await service.cancel(session.sessionId, session.controlToken)
    } catch {
      cancelOk = false
    }
    release.resolve()
    const confirmed = await confirming
    const status = await service.getStatus(session.sessionId, session.controlToken)
    const stored = prisma.files.get(uploaded.file!.fileId)
    const liveMember = Boolean(stored && !stored.deletedAt && (stored.ownerType === 'user' || stored.endUserId))
    if (status.status === 'cancelled' || status.status === 'expired') {
      assert.equal(liveMember, false, 'a cancelled upload must not leave a live member-owned file')
    }
    if (confirmed.ok) {
      assert.equal(status.status, 'confirmed')
      assert.equal(stored?.deletedAt ?? null, null)
    } else {
      assert.notEqual(status.status, 'confirmed')
    }
    assert.equal(cancelOk && liveMember && status.status === 'cancelled', false)
  }

  {
    // 确认比较已经写成 confirmed，随后会员归属的数据库更新失败。
    // 调用方收到错误，但一体机读到的仍是 confirmed，而且不能再重试绑定。
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_1',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    const originalUpdate = prisma.fileObject.update.bind(prisma.fileObject)
    let failUpdate = true
    prisma.fileObject.update = async (args) => {
      if (failUpdate && args.data.ownerType === 'user') {
        failUpdate = false
        throw new Error('member bind update failed')
      }
      return originalUpdate(args)
    }
    await expectRejects(
      () => service.confirm(session.sessionId, session.controlToken, 'member_1'),
      Error,
      'confirm must not succeed when member ownership update fails',
    )
    const during = await service.getStatus(session.sessionId, session.controlToken)
    assert.notEqual(during.status, 'confirmed', 'kiosk must not observe success after the failed confirm')
    const row = prisma.files.get(uploaded.file!.fileId)
    assert.equal(row?.deletedAt ?? null, null, 'failed ownership update must not drop the original file')
    assert.notEqual(row?.ownerType, 'user')
    const retried = await service.confirm(session.sessionId, session.controlToken, 'member_1')
    assert.equal(retried.status, 'confirmed')
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.ownerType, 'user')
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null, null)
  }

  {
    // 复制已经落到会员 key，比较失败后 deleteObjectAtKey 也失败。这份复制不能留下。
    const { service, prisma, redis, files } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_1',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const objects = new Set<string>()
    let stagedKey = ''
    let failStagedDelete = true
    const entered = deferred()
    const release = deferred()
    files.copyObjectToKey = async (_from: string, to: string) => {
      objects.add(to)
      stagedKey = to
      entered.resolve()
      await release.promise
    }
    files.deleteObjectAtKey = async (key: string) => {
      if (failStagedDelete && key === stagedKey) {
        failStagedDelete = false
        throw new Error('staged object delete failed')
      }
      objects.delete(key)
    }
    const confirming = service.confirm(session.sessionId, session.controlToken, 'member_1').then(
      () => ({ ok: true as const }),
      () => ({ ok: false as const }),
    )
    await entered.promise
    await redis.del(lockKey)
    await service.cancel(session.sessionId, session.controlToken)
    release.resolve()
    const confirmed = await confirming
    assert.equal(confirmed.ok, false, 'confirm must not succeed after the compare loses')
    assert.notEqual(prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null, null)
    await redis.del(`upload_session:${session.sessionId}`)
    await service.cleanupExpiredSessions(new Date(session.expiresAt).getTime() + 1)
    assert.equal(objects.has(stagedKey), false, 'staged member object must be removed after the compare loses')
  }

  {
    // 取消时对象删除失败。主会话键先过期后，清理记录仍要留着 fileId，重试才能删掉对象。
    const { service, prisma, redis, files } = makeService()
    const session = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'cleanup-pointer.pdf' }),
    })
    const originalDelete = files.systemDelete.bind(files)
    let failDelete = true
    files.systemDelete = async (fileId: string, reason: string) => {
      if (failDelete) {
        failDelete = false
        throw new Error('storage delete failed once')
      }
      return originalDelete(fileId, reason)
    }
    await expectRejects(
      () => service.cancel(session.sessionId, session.controlToken),
      Error,
      'cancel must not succeed when delete fails',
    )
    await redis.del(`upload_session:${session.sessionId}`)
    const cleanupRaw = await redis.get(`upload_session_cleanup:${session.sessionId}`)
    assert.equal(cleanupRaw?.includes(uploaded.file!.fileId), true, 'cleanup record must keep the file id after the session key expires')
    await service.cleanupExpiredSessions(new Date(session.expiresAt).getTime() + 1)
    assert.notEqual(prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null, null)
  }

  {
    // 一批过期会话里有一条删除失败时，后面的会话也必须在同一次清扫里被处理。
    const { service, prisma, redis, files } = makeService()
    const first = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const firstUpload = await service.uploadFile({
      sessionId: first.sessionId,
      uploadToken: first.uploadToken,
      file: file({ originalname: 'batch-first.pdf' }),
    })
    const second = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const secondUpload = await service.uploadFile({
      sessionId: second.sessionId,
      uploadToken: second.uploadToken,
      file: file({ originalname: 'batch-second.pdf' }),
    })
    for (const id of [first.sessionId, second.sessionId]) {
      const raw = await redis.get(`upload_session:${id}`)
      assert.ok(raw)
      const parsed = JSON.parse(raw) as { expiresAt: string }
      parsed.expiresAt = new Date(1).toISOString()
      await redis.setExistingWithCurrentTtl(`upload_session:${id}`, JSON.stringify(parsed))
      const cleanupRaw = await redis.get(`upload_session_cleanup:${id}`)
      if (cleanupRaw) {
        const cleanup = JSON.parse(cleanupRaw) as { expiresAt: string }
        cleanup.expiresAt = new Date(1).toISOString()
        await redis.setEx(`upload_session_cleanup:${id}`, 24 * 60 * 60, JSON.stringify(cleanup))
      }
    }
    await redis.zadd('upload_session_expiry_index', 1, first.sessionId)
    await redis.zadd('upload_session_expiry_index', 2, second.sessionId)
    const originalDelete = files.systemDelete.bind(files)
    files.systemDelete = async (fileId: string, reason: string) => {
      if (fileId === firstUpload.file!.fileId) throw new Error('poison session delete')
      return originalDelete(fileId, reason)
    }
    const result = await service.cleanupExpiredSessions(10)
    assert.equal(prisma.files.get(firstUpload.file!.fileId)?.deletedAt ?? null, null)
    assert.notEqual(prisma.files.get(secondUpload.file!.fileId)?.deletedAt ?? null, null, 'one poison session must not abort the rest of the batch')
    assert.equal(redis.hasSortedSetMember('upload_session_expiry_index', first.sessionId), true)
    assert.ok((result as { failed?: number }).failed && (result as { failed?: number }).failed! >= 1)
  }

  {
    // 进程在会员归属写入之前被杀掉。公开状态不能是 confirmed，恢复后必须绑定且不留下匿名键。
    const { service, prisma, redis } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_1',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    const fileId = uploaded.file!.fileId
    const originalCommit = redis.compareAndSetSession.bind(redis)
    let stopped = false
    redis.compareAndSetSession = async (...args: Parameters<FakeRedis['compareAndSetSession']>) => {
      const result = await originalCommit(...args)
      const next = JSON.parse(args[3]) as { status?: string; bind?: { phase?: string } | null }
      const row = prisma.files.get(fileId)
      const bound = Boolean(row && row.ownerType === 'user' && row.storageKey.startsWith('users/'))
      const crossedIntent = next.status === 'confirmed' || next.bind?.phase === 'intent' || next.bind?.phase === 'copied'
      if (!stopped && result === 'updated' && !bound && crossedIntent) {
        stopped = true
        throw new Error('HARD_STOP before ownership')
      }
      return result
    }
    await expectRejects(
      () => service.confirm(session.sessionId, session.controlToken, 'member_1'),
      Error,
      'hard stop before ownership',
    )
    assert.notEqual(
      (await service.getStatus(session.sessionId, session.controlToken)).status,
      'confirmed',
      'kiosk must not observe confirmed before the row is bound',
    )
    await redis.del(`upload_session:${session.sessionId}`)
    const cleanupRaw = await redis.get(`upload_session_cleanup:${session.sessionId}`)
    assert.equal(cleanupRaw?.includes(fileId), true, 'cleanup record must still name the file after the session key is gone')
    await service.cleanupExpiredSessions(Date.now() + 1000)
    const recovered = prisma.files.get(fileId)
    assert.equal(recovered?.ownerType, 'user')
    assert.match(recovered?.storageKey ?? '', /^users\/member_1\//)
    assert.equal(recovered?.deletedAt ?? null, null)
    assert.equal(recovered?.pendingStorageKey ?? null, null)
    assert.equal(recovered?.replacedStorageKey ?? null, null)
  }

  {
    // 锁过期时数据库已经写成会员，但匿名键还在。此时公开状态不能已经是 confirmed。
    const { service, prisma, redis, files } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_1',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    const fileId = uploaded.file!.fileId
    const previousKey = prisma.files.get(fileId)!.storageKey
    const objects = new Set<string>([previousKey])
    files.copyObjectToKey = async (_from: string, to: string) => {
      objects.add(to)
    }
    files.deleteObjectAtKey = async (key: string) => {
      objects.delete(key)
    }
    const entered = deferred()
    const release = deferred()
    let paused = false
    const originalUpdate = prisma.fileObject.update.bind(prisma.fileObject)
    prisma.fileObject.update = async (args) => {
      const updated = await originalUpdate(args)
      if (!paused && args.data.ownerType === 'user') {
        paused = true
        entered.resolve()
        await release.promise
      }
      return updated
    }
    const confirming = service.confirm(session.sessionId, session.controlToken, 'member_1').then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    await entered.promise
    await redis.del(`upload_session_upload_lock:${session.sessionId}`)
    const mid = await service.getStatus(session.sessionId, session.controlToken)
    if (mid.status === 'confirmed') {
      assert.equal(objects.has(previousKey), false, 'public confirmed while the obsolete anonymous key still exists')
    }
    await service.cleanupExpiredSessions(Date.now() + 1000)
    release.resolve()
    const confirmed = await confirming
    const finalStatus = await service.getStatus(session.sessionId, session.controlToken)
    assert.equal(finalStatus.status, 'confirmed')
    assert.equal(confirmed.ok, true)
    assert.equal(objects.has(previousKey), false, 'lock expiry recovery must delete the anonymous key')
    assert.equal(prisma.files.get(fileId)?.deletedAt ?? null, null)
    assert.match(prisma.files.get(fileId)?.storageKey ?? '', /^users\/member_1\//)
  }

  {
    // 归属更新已经提交，旧键删除和随后的 Redis 写入都失败。不能退回 uploaded，取消也不能删掉会员文件。
    const { service, prisma, redis, files } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_1',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    const fileId = uploaded.file!.fileId
    const previousKey = prisma.files.get(fileId)!.storageKey
    const objects = new Set<string>([previousKey])
    let failDelete = true
    let failRedisWrite = true
    files.copyObjectToKey = async (_from: string, to: string) => {
      objects.add(to)
    }
    files.deleteObjectAtKey = async (key: string) => {
      if (failDelete && key === previousKey) throw new Error('old key delete failed')
      objects.delete(key)
    }
    const originalSetEx = redis.setEx.bind(redis)
    redis.setEx = async (key: string, ttlSeconds: number, value: string) => {
      if (failRedisWrite && key.startsWith('upload_session_cleanup:') && value.includes(previousKey)) {
        throw new Error('cleanup redis write failed')
      }
      return originalSetEx(key, ttlSeconds, value)
    }
    const originalCommit = redis.compareAndSetSession.bind(redis)
    redis.compareAndSetSession = async (...args: Parameters<FakeRedis['compareAndSetSession']>) => {
      if (failRedisWrite && args[3].includes('"status":"confirmed"')) {
        throw new Error('confirm redis write failed')
      }
      return originalCommit(...args)
    }
    await expectRejects(
      () => service.confirm(session.sessionId, session.controlToken, 'member_1'),
      Error,
      'confirm must not succeed when the obsolete key or the confirm write fails',
    )
    assert.notEqual((await service.getStatus(session.sessionId, session.controlToken)).status, 'confirmed')
    const bound = prisma.files.get(fileId)
    assert.equal(bound?.ownerType, 'user')
    assert.match(bound?.storageKey ?? '', /^users\/member_1\//)
    assert.equal(objects.has(bound?.storageKey ?? ''), true, 'the live member object must stay')
    let cancelDeleted = false
    const originalSystemDelete = files.systemDelete.bind(files)
    files.systemDelete = async (id: string, reason: string) => {
      if (id === fileId) cancelDeleted = true
      return originalSystemDelete(id, reason)
    }
    try {
      await service.cancel(session.sessionId, session.controlToken)
    } catch {
      // 已经归属的会话应拒绝取消，或在删掉旧键前失败。两种都不能删会员文件。
    }
    assert.equal(cancelDeleted, false, 'cancel must not delete the live member object')
    assert.equal(prisma.files.get(fileId)?.deletedAt ?? null, null)
    failDelete = false
    failRedisWrite = false
    await service.cleanupExpiredSessions(Date.now() + 60_000)
    try {
      await service.confirm(session.sessionId, session.controlToken, 'member_1')
    } catch {
      // 清扫已经完成时，再次确认会看到 confirmed。
    }
    const recovered = prisma.files.get(fileId)
    assert.equal(recovered?.ownerType, 'user')
    assert.equal(recovered?.deletedAt ?? null, null)
    assert.equal(objects.has(previousKey), false, 'recovery must delete the anonymous key')
    assert.equal((await service.getStatus(session.sessionId, session.controlToken)).status, 'confirmed')
  }

  {
    // 归属切换前行已被墓碑，pendingStorageKey 仍指着会员复制件。
    // 第一次删复制件失败后指针必须还在；重试删掉复制件，且不碰仍在使用的会员对象。
    const { service, prisma, files } = makeService()
    const anonymousKey = 'tmp/uploads/file_orphan/file_orphan.pdf'
    const copiedKey = 'users/member_1/resumes/file_orphan.pdf'
    const liveKey = 'users/member_live/resumes/file_live.pdf'
    const base = {
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4,
      sha256: 'sha',
      bucket: 'local-fs',
      purpose: 'resume_upload' as const,
      sensitiveLevel: 'sensitive',
      expiresAt: null,
      retentionPolicy: null,
      retentionSetBy: null,
      retentionConsentAt: null,
      retentionConsentVersion: null,
      retentionLockedReason: null,
      replacedStorageKey: null,
      updatedAt: new Date(),
    }
    prisma.files.set('file_orphan', {
      ...base,
      id: 'file_orphan',
      storageKey: anonymousKey,
      endUserId: null,
      ownerType: 'system',
      ownerId: null,
      deletedAt: new Date(),
      pendingStorageKey: copiedKey,
    })
    prisma.files.set('file_live', {
      ...base,
      id: 'file_live',
      storageKey: liveKey,
      endUserId: 'member_live',
      ownerType: 'user',
      ownerId: 'member_live',
      deletedAt: null,
      pendingStorageKey: liveKey,
    })
    const objects = new Set<string>([anonymousKey, copiedKey, liveKey])
    let failCopiedKey = true
    files.deleteObjectAtKey = async (key: string) => {
      if (failCopiedKey && key === copiedKey) throw new Error('pending copy delete failed')
      objects.delete(key)
    }
    await service.cleanupExpiredSessions(Date.now())
    assert.equal(prisma.files.get('file_orphan')?.pendingStorageKey, copiedKey, 'failed delete must keep the durable pointer')
    assert.equal(objects.has(copiedKey), true)
    failCopiedKey = false
    await service.cleanupExpiredSessions(Date.now())
    assert.equal(prisma.files.get('file_orphan')?.pendingStorageKey ?? null, null)
    assert.equal(objects.has(copiedKey), false, 'retry must delete the tombstoned pending copy')
    assert.equal(prisma.files.get('file_orphan')?.storageKey, anonymousKey)
    assert.equal(objects.has(anonymousKey), true)
    assert.equal(objects.has(liveKey), true, 'a live member object must not be deleted')
    assert.equal(prisma.files.get('file_live')?.deletedAt ?? null, null)
    assert.equal(prisma.files.get('file_live')?.storageKey, liveKey)
    assert.equal(prisma.files.get('file_live')?.pendingStorageKey, liveKey)
  }

  {
    // 未过期的 uploaded 会话已经写下 bind，但文件行已被墓碑。
    // 清扫不能每分钟再去 driveMemberBind 并抛 FILE_NOT_FOUND。
    const { service, prisma, redis } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_1',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    const fileId = uploaded.file!.fileId
    const row = prisma.files.get(fileId)!
    row.deletedAt = new Date()
    row.pendingStorageKey = 'users/member_1/resumes/tombstoned.pdf'
    prisma.files.set(fileId, row)
    const sessionKey = `upload_session:${session.sessionId}`
    const raw = JSON.parse((await redis.get(sessionKey)) ?? '{}') as Record<string, unknown>
    raw['bind'] = {
      phase: 'intent',
      fileId,
      endUserId: 'member_1',
      userKey: row.pendingStorageKey,
      previousKey: row.storageKey,
      bucket: row.bucket,
    }
    await redis.setExistingWithCurrentTtl(sessionKey, JSON.stringify(raw))
    await redis.zadd('upload_session_expiry_index', Date.now() - 1, session.sessionId)
    const first = await service.cleanupExpiredSessions(Date.now())
    const after = JSON.parse((await redis.get(sessionKey)) ?? '{}') as { status?: string }
    assert.equal(first.failed, 0, 'a tombstoned bind must be finished without a retryable error')
    assert.equal(after.status, 'expired')
    assert.notEqual(prisma.files.get(fileId)?.deletedAt ?? null, null)
    assert.notEqual(prisma.files.get(fileId)?.ownerType, 'user')
    const second = await service.cleanupExpiredSessions(Date.now() + 120_000)
    assert.equal(second.failed, 0, 'the next sweep must not throw FILE_NOT_FOUND again')
  }

  {
    // 100 条删除一直失败的行不能永远挡住第 101 条可恢复的行。
    const { service, prisma, files } = makeService()
    const objects = new Set<string>()
    files.deleteObjectAtKey = async (key: string) => {
      if (key.startsWith('poison/')) throw new Error('poison delete')
      objects.delete(key)
    }
    const stamp = new Date(0)
    for (let index = 0; index < 100; index += 1) {
      const id = `p${String(index).padStart(3, '0')}`
      const pending = `poison/${id}`
      objects.add(pending)
      prisma.files.set(id, {
        id,
        filename: 'resume.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4,
        sha256: 'sha',
        storageKey: `tmp/${id}.pdf`,
        bucket: 'local-fs',
        purpose: 'resume_upload',
        sensitiveLevel: 'sensitive',
        endUserId: null,
        ownerType: 'system',
        ownerId: null,
        deletedAt: new Date(0),
        expiresAt: null,
        pendingStorageKey: pending,
        replacedStorageKey: null,
        updatedAt: stamp,
        retentionPolicy: null,
        retentionSetBy: null,
        retentionConsentAt: null,
        retentionConsentVersion: null,
        retentionLockedReason: null,
      })
    }
    objects.add('healthy/copy')
    prisma.files.set('p100', {
      id: 'p100',
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4,
      sha256: 'sha',
      storageKey: 'tmp/p100.pdf',
      bucket: 'local-fs',
      purpose: 'resume_upload',
      sensitiveLevel: 'sensitive',
      endUserId: null,
      ownerType: 'system',
      ownerId: null,
      deletedAt: new Date(0),
      expiresAt: null,
      pendingStorageKey: 'healthy/copy',
      replacedStorageKey: null,
      updatedAt: stamp,
      retentionPolicy: null,
      retentionSetBy: null,
      retentionConsentAt: null,
      retentionConsentVersion: null,
      retentionLockedReason: null,
    })
    await service.cleanupExpiredSessions(0)
    assert.equal(prisma.files.get('p100')?.pendingStorageKey, 'healthy/copy')
    await service.cleanupExpiredSessions(60_000)
    assert.equal(prisma.files.get('p100')?.pendingStorageKey ?? null, null, 'the second time page must reach the healthy row')
    assert.equal(objects.has('healthy/copy'), false)
    assert.equal(prisma.files.get('p000')?.pendingStorageKey, 'poison/p000')
  }


  console.log('PASS upload session bind fault verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
