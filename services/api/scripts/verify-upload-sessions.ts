import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-upload-sessions-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { CONTRACT_REVIEW_TTL_MS } from '../src/files/retention-policy'
import { sniffDeclaredMimeMismatch } from '../src/files/content-sniff'
import { FilesCleanupTask } from '../src/files/files.cleanup.task'
import { FilesService } from '../src/files/files.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'
import { UploadSessionsService } from '../src/upload-sessions/upload-sessions.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import {
  FakeRedis,
  ISOLATED_DATABASE,
  REAL_STORAGE_DIR,
  deferred,
  expectRejects,
  file,
  makeService,
} from './support/upload-session-verifier'

async function main(): Promise<void> {
  {
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'contract_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const beforeUpload = Date.now()
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'contract.pdf' }),
    })
    const stored = prisma.files.get(uploaded.file!.fileId)
    assert.equal(stored?.sensitiveLevel, 'highly_sensitive')
    assert.equal(stored?.retentionPolicy, 'system_short')
    assert.equal(stored?.retentionSetBy, 'system')
    assert.equal(stored?.retentionLockedReason, 'contract_review_session_only')
    assert.ok(stored?.expiresAt)
    assert.ok(
      stored!.expiresAt!.getTime() >= beforeUpload + CONTRACT_REVIEW_TTL_MS &&
        stored!.expiresAt!.getTime() <= Date.now() + CONTRACT_REVIEW_TTL_MS,
      'temporary contract upload must expire exactly two hours after upload'
    )
    const confirmed = await service.confirm(session.sessionId, session.controlToken)
    assert.match(
      confirmed.file.fileUrl ?? '',
      /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]+$/,
      'contract upload confirmation must mint a signed content URL for anonymous proof'
    )
  }

  {
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'contract_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_contract',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'contract.pdf' }),
    })
    const originalExpiry = prisma.files.get(uploaded.file!.fileId)?.expiresAt?.toISOString()
    await service.confirm(session.sessionId, session.controlToken, 'member_contract')
    const bound = prisma.files.get(uploaded.file!.fileId)
    assert.equal(bound?.endUserId, 'member_contract')
    assert.equal(bound?.ownerType, 'user')
    assert.equal(
      bound?.retentionPolicy,
      'system_short',
      'member binding must not promote contract uploads to 90 days'
    )
    assert.equal(bound?.retentionLockedReason, 'contract_review_session_only')
    assert.equal(
      bound?.expiresAt?.toISOString(),
      originalExpiry,
      'member binding must preserve the original session expiry'
    )
  }

  {
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'contract_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_missing_expiry',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'contract.pdf' }),
    })
    const stored = prisma.files.get(uploaded.file!.fileId)!
    prisma.files.set(stored.id, { ...stored, expiresAt: null })

    let caught: unknown
    try {
      await service.confirm(session.sessionId, session.controlToken, 'member_missing_expiry')
    } catch (error) {
      caught = error
    }
    assert.ok(caught instanceof BadRequestException)
    const response = caught.getResponse() as { error?: { code?: string; message?: string } }
    assert.equal(response.error?.code, 'CONTRACT_FILE_EXPIRY_MISSING')
    assert.doesNotMatch(response.error?.message ?? '', /expiresAt|null|contract/i)
    assert.equal(prisma.fileUpdateCalls.length, 0, 'missing expiry must fail before file update')
    assert.equal(prisma.files.get(stored.id)?.endUserId, null)
  }

  {
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'contract_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_concurrent',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'contract.pdf' }),
    })
    const originalExpiry = prisma.files.get(uploaded.file!.fileId)!.expiresAt!.toISOString()

    const results = await Promise.allSettled([
      service.confirm(session.sessionId, session.controlToken, 'member_concurrent'),
      service.confirm(session.sessionId, session.controlToken, 'member_concurrent'),
    ])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
    const bound = prisma.files.get(uploaded.file!.fileId)!
    assert.equal(bound.expiresAt?.toISOString(), originalExpiry)
    assert.equal(bound.retentionLockedReason, 'contract_review_session_only')
    const bindingCalls = prisma.fileUpdateCalls.filter((call) => call.data.ownerType === 'user')
    assert.ok(bindingCalls.length >= 1, 'member confirm must write user ownership')
    assert.ok(
      bindingCalls.every(
        (call) =>
          call.data.expiresAt?.toISOString() === originalExpiry &&
          call.data.retentionLockedReason === 'contract_review_session_only'
      ),
      `winning binding must preserve expiry and never clear the retention lock: ${JSON.stringify(
        bindingCalls
      )}`
    )
  }

  {
    const { service, files } = makeService()
    const session = await service.create({
      purpose: 'contract_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: '' }),
    })
    assert.equal(files.uploadCalls[0]?.filename, 'contract.pdf')
  }

  {
    const { service, prisma } = makeService()
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
    assert.equal(uploaded.status, 'uploaded')
    assert.equal(uploaded.file?.filename, 'resume.pdf')
    assert.equal('signedUrl' in uploaded.file!, false)
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.endUserId, null)
    await expectRejects(
      () => service.getStatus(session.sessionId, undefined),
      ForbiddenException,
      'status requires control token'
    )
    const status = await service.getStatus(session.sessionId, session.controlToken)
    assert.equal(status.file?.fileId, uploaded.file?.fileId)
    assert.equal('signedUrl' in status.file!, false)
  }

  {
    const { service } = makeService()
    await expectRejects(
      () =>
        service.create({
          purpose: 'resume_upload',
          mode: 'member',
          channel: 'phone_h5',
          uploadUrl: 'http://localhost:5173/upload/phone',
        }),
      UnauthorizedException,
      'member session requires kiosk member token'
    )
  }

  {
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
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.endUserId, null)
    const confirmed = await service.confirm(session.sessionId, session.controlToken, 'member_1')
    assert.equal(confirmed.status, 'confirmed')
    assert.equal('signedUrl' in confirmed.file, false)
    const bound = prisma.files.get(uploaded.file!.fileId)
    assert.equal(bound?.endUserId, 'member_1')
    assert.equal(bound?.ownerType, 'user')
    assert.equal(bound?.retentionPolicy, 'months_3')
    assert.match(
      bound?.storageKey ?? '',
      /^users\/member_1\//,
      'API-29c 绑定会员后 storageKey 必须离开 tmp/uploads',
    )
  }

  {
    const { service, prisma, files } = makeService()
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
    const result = await service.cleanupExpiredSessions(new Date(session.expiresAt).getTime() + 1)
    assert.equal(result.cleaned, 1, 'expired unread session must be collected by one scheduler run')
    assert.notEqual(prisma.files.get(uploaded.file!.fileId)?.deletedAt, null)
    assert.equal(files.storedObjects.has(uploaded.file!.fileId), false, 'expired unread storage object must be deleted')
    assert.deepEqual(files.deletionLog[0], {
      fileId: uploaded.file!.fileId,
      deletedBy: 'system',
      reason: 'upload session expired',
    })
  }

  {
    const { service, prisma, files } = makeService()
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
    const recordKey = `upload_session:${session.sessionId}`
    const raw = await (service as unknown as { redis: FakeRedis }).redis.get(recordKey)
    assert.ok(raw)
    await (service as unknown as { redis: FakeRedis }).redis.setExistingWithCurrentTtl(
      recordKey,
      JSON.stringify({ ...JSON.parse(raw!), expiresAt: new Date(Date.now() - 1).toISOString() })
    )
    const race = await Promise.allSettled([
      service.confirm(session.sessionId, session.controlToken),
      service.cleanupExpiredSessions(Date.now()),
    ])
    assert.equal(race.filter((entry) => entry.status === 'fulfilled').length, 1, 'only confirm or expiry cleanup may win')
    assert.equal(race.filter((entry) => entry.status === 'rejected').length, 1)
    assert.notEqual(prisma.files.get(uploaded.file!.fileId)?.deletedAt, null)
    assert.equal(files.deletionLog.length, 1)
  }

  {
    const { service } = makeService()
    const warnings: string[] = []
    const task = new FilesCleanupTask({} as never, service)
    ;(task as unknown as { logger: { warn(message: string): void; log(message: string): void } }).logger = {
      warn: (message) => warnings.push(message),
      log: () => undefined,
    }
    ;(service as unknown as { cleanupExpiredSessions: () => Promise<never> }).cleanupExpiredSessions = async () => {
      throw new Error('redis unavailable')
    }
    await task.handleEveryMinute()
    assert.deepEqual(warnings, ['code=UPLOAD_SESSION_CLEANUP_SKIPPED reason=redis_unavailable'])
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      terminalId: 'Terminal Display Name',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    let exception: unknown
    try {
      await service.getStatus(session.sessionId, 'bad-control-token')
    } catch (error) {
      exception = error
    }
    assert.ok(exception instanceof ForbiddenException)
    let body: unknown
    const response = {
      status: () => ({ json: (value: unknown) => { body = value } }),
    }
    new HttpExceptionFilter().catch(exception, {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          method: 'GET',
          route: { path: '/upload-sessions/:sessionId' },
          originalUrl: `/upload-sessions/${session.sessionId}`,
          headers: { authorization: `Bearer ${session.controlToken}` },
          requestId: 'verify-request',
          requestStartedAt: Date.now(),
        }),
      }),
    } as never)
    const serialized = JSON.stringify(body)
    for (const forbidden of [session.uploadToken, session.controlToken, 'Terminal Display Name', 'bad-control-token']) {
      assert.equal(serialized.includes(forbidden), false, `phone error envelope leaked ${forbidden}`)
    }
    assert.doesNotMatch(serialized, /\bat\s+.+\(/, 'phone error envelope must not expose a stack frame')
    assert.match(serialized, /UPLOAD_SESSION_CONTROL_INVALID/)
  }

  {
    const { service, prisma, files } = makeService()
    const session = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'print.pdf' }),
    })
    await service.confirm(session.sessionId, session.controlToken)
    assert.equal(
      (service as unknown as { redis: FakeRedis }).redis.hasSortedSetMember(
        'upload_session_expiry_index',
        session.sessionId,
      ),
      false,
      'confirmation must immediately remove its expiry cleanup index entry',
    )
    const result = await service.cleanupExpiredSessions(new Date(session.expiresAt).getTime() + 1)
    assert.equal(result.cleaned, 0, 'confirmed session must be removed from expiry cleanup')
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.deletedAt, null)
    assert.equal(files.storedObjects.has(uploaded.file!.fileId), true)
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_1',
    })
    await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    await expectRejects(
      () => service.confirm(session.sessionId, session.controlToken, 'member_2'),
      ForbiddenException,
      'member mismatch denied'
    )
    await expectRejects(
      () => service.confirm(session.sessionId, 'bad-control', 'member_1'),
      ForbiddenException,
      'invalid control token denied'
    )
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    await expectRejects(
      () =>
        service.uploadFile({
          sessionId: session.sessionId,
          uploadToken: session.uploadToken,
          file: file(),
        }),
      BadRequestException,
      'upload token cannot be reused'
    )
  }

  {
    const uploadEntered = deferred()
    const releaseUpload = deferred()
    const { service, prisma, files, redis } = makeService({
      beforeUpload: async (callNumber) => {
        if (callNumber === 1) {
          uploadEntered.resolve()
          await releaseUpload.promise
        }
      },
    })
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const originalGet = redis.get.bind(redis)
    const lockReadersReady = deferred()
    let lockReaders = 0
    redis.get = async (key: string) => {
      if (key === lockKey) {
        lockReaders += 1
        if (lockReaders >= 2) lockReadersReady.resolve()
      }
      return originalGet(key)
    }

    const request = () =>
      service.uploadFile({
        sessionId: session.sessionId,
        uploadToken: session.uploadToken,
        file: file(),
      })
    const first = request()
    const second = request()
    await uploadEntered.promise

    const asSettled = (promise: Promise<unknown>) =>
      promise.then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason })
      )
    try {
      const earlyResult = await Promise.race([asSettled(first), asSettled(second)])
      assert.equal(
        earlyResult.status,
        'rejected',
        'the competing request must reject while the lock holder is still uploading'
      )
    } finally {
      releaseUpload.resolve()
    }

    const results = await Promise.allSettled([first, second])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
    assert.equal(files.uploadCalls.length, 1)
    assert.equal(prisma.files.size, 1)
    assert.equal(redis.hasLiveKey(lockKey), false, 'upload lock must be cleaned after completion')
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await expectRejects(
      () =>
        service.uploadFile({
          sessionId: session.sessionId,
          uploadToken: session.uploadToken,
          file: file({ buffer: Buffer.alloc(10 * 1024 * 1024 + 1), size: 10 * 1024 * 1024 + 1 }),
        }),
      BadRequestException,
      'phone resume upload is capped at 10MB'
    )
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await expectRejects(
      () =>
        service.uploadFile({
          sessionId: session.sessionId,
          uploadToken: session.uploadToken,
          file: file({ originalname: 'resume.exe', mimetype: 'application/pdf' }),
        }),
      BadRequestException,
      'extension mismatch rejected through file validation'
    )
    // 魔数校验:文件名/声明 MIME 全对但真实字节不是 PDF(伪装 PDF)→ 服务端拒绝
    await expectRejects(
      () =>
        service.uploadFile({
          sessionId: session.sessionId,
          uploadToken: session.uploadToken,
          file: file({
            buffer: Buffer.from('this is not a pdf at all'),
            originalname: 'resume.pdf',
            mimetype: 'application/pdf',
          }),
        }),
      BadRequestException,
      'fake PDF payload rejected by content sniffing (FILE_CONTENT_MISMATCH)'
    )
    const retry = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    assert.equal(retry.status, 'uploaded')
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await expectRejects(
      () =>
        service.uploadFile({
          sessionId: session.sessionId,
          uploadToken: session.uploadToken,
          file: file({ originalname: 'resume.txt', mimetype: 'text/plain' }),
        }),
      BadRequestException,
      'plain text resume upload is rejected by server validation'
    )
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await expectRejects(
      () =>
        service.uploadFile({
          sessionId: session.sessionId,
          uploadToken: 'bad-token',
          file: file(),
        }),
      ForbiddenException,
      'invalid upload token rejected'
    )
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    await service.confirm(session.sessionId, session.controlToken)
    await expectRejects(
      () => service.cancel(session.sessionId, session.controlToken),
      BadRequestException,
      'confirmed session cannot be cancelled'
    )
  }

  {
    const { service, prisma } = makeService()
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
    await service.cancel(session.sessionId, session.controlToken)
    assert.notEqual(prisma.files.get(uploaded.file!.fileId)?.deletedAt, null)
  }

  {
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
    const current = prisma.files.get(uploaded.file!.fileId)!
    prisma.files.set(uploaded.file!.fileId, {
      ...current,
      endUserId: 'member_1',
      ownerType: 'user',
      ownerId: 'member_1',
    })
    await service.cancel(session.sessionId, session.controlToken)
    assert.equal(
      prisma.files.get(uploaded.file!.fileId)?.deletedAt,
      null,
      'bound member file must not be deleted by abandoned cleanup'
    )
  }

  {
    const { service } = makeService()
    await expectRejects(
      () =>
        service.create({
          purpose: 'admin_upload',
          mode: 'temporary',
          channel: 'phone_h5',
          uploadUrl: 'http://localhost:5173/upload/phone',
        }),
      BadRequestException,
      'unsupported purpose rejected at session creation'
    )
  }

  {
    // print_doc: confirm 必须签发本系统 HMAC 内容 URL,供打印任务创建复用(kiosk-upload 同款契约)。
    const { service } = makeService()
    const session = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'doc.pdf' }),
    })
    const confirmed = await service.confirm(session.sessionId, session.controlToken)
    assert.equal(confirmed.status, 'confirmed')
    assert.match(
      confirmed.file.fileUrl ?? '',
      /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]+$/,
      'print_doc confirm must return a signed content URL'
    )
  }

  {
    // resume_upload:confirm 签发短时内容 URL，供一体机在提交诊断前核对原文件。
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    const confirmed = await service.confirm(session.sessionId, session.controlToken)
    assert.match(
      confirmed.file.fileUrl ?? '',
      /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]+$/,
      'resume_upload confirm must return a signed preview URL'
    )
  }

  {
    // print_doc + member: 仍走同一 bindMemberFile 归属逻辑,但 print_doc 不在 90 天默认名单内,应落短 TTL。
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'print_doc',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_1',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'doc.pdf' }),
    })
    const confirmed = await service.confirm(session.sessionId, session.controlToken, 'member_1')
    assert.match(
      confirmed.file.fileUrl ?? '',
      /^\/api\/v1\/files\//,
      'print_doc member confirm must also carry a signed fileUrl'
    )
    const bound = prisma.files.get(uploaded.file!.fileId)
    assert.equal(bound?.endUserId, 'member_1')
    assert.equal(
      bound?.retentionPolicy,
      'system_short',
      'print_doc must not get the 90-day resume retention default even when bound to a member'
    )
  }

  {
    const controller = readFileSync(
      new URL('../src/upload-sessions/upload-sessions.controller.ts', import.meta.url),
      'utf8'
    )
    assert.match(
      controller,
      /@Get\(':sessionId'\)\n\s+@Throttle\(\{ default: \{ ttl: 60_000, limit: 60 \} \}\)/,
      'status polling endpoint should have a wide throttle'
    )
  }

  if (ISOLATED_DATABASE) {
    assertIsolatedVerificationDatabase()
    const prisma = new PrismaService()
    const storage = new StorageService()
    const files = new FilesService(prisma, { write: async () => null } as never, storage)
    const redis = new FakeRedis()
    const service = new UploadSessionsService(redis as never, prisma, files)
    try {
      const session = await service.create({
        purpose: 'resume_upload',
        mode: 'temporary',
        channel: 'phone_h5',
        uploadUrl: 'http://localhost:5173/upload/phone',
      })
      const uploaded = await service.uploadFile({
        sessionId: session.sessionId,
        uploadToken: session.uploadToken,
        file: file({ originalname: 'isolated-expiry.pdf' }),
      })
      const before = await prisma.fileObject.findUnique({ where: { id: uploaded.file!.fileId } })
      assert.ok(before)
      assert.ok(await storage.headObject(before.storageKey, before.bucket))

      const cleanup = await service.cleanupExpiredSessions(new Date(session.expiresAt).getTime() + 1)
      assert.equal(cleanup.cleaned, 1)
      const after = await prisma.fileObject.findUnique({ where: { id: uploaded.file!.fileId } })
      assert.ok(after?.deletedAt, 'expired unread FileObject must have a deletion tombstone')
      assert.equal(after?.deletedBy, 'system')
      assert.equal(after?.deleteReason, 'upload session expired')
      assert.ok(after?.storageDeletedAt, 'physical object deletion must be recorded')
      assert.equal(await storage.headObject(before.storageKey, before.bucket), null)
      console.log('  PASS isolated expiry cleanup removes FileObject storage and records deletion ledger')
    } finally {
      await prisma.onModuleDestroy()
      rmSync(REAL_STORAGE_DIR, { recursive: true, force: true })
    }
  }

  {
    // 场景码兑换若拿着过期快照回写，会把已经 uploaded 的会话盖回 pending，
    // 手机收到成功回执，一体机却看不到文件，清理索引也不再指向这份字节。
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const sessionKey = `upload_session:${session.sessionId}`
    const redis = (service as unknown as { redis: FakeRedis }).redis
    const originalGet = redis.get.bind(redis)
    const releaseStaleRead = deferred()
    const staleReadHeld = deferred()
    let holdSessionRead = true
    redis.get = async (key: string) => {
      if (holdSessionRead && key === sessionKey) {
        holdSessionRead = false
        const value = await originalGet(key)
        staleReadHeld.resolve()
        await releaseStaleRead.promise
        return value
      }
      return originalGet(key)
    }
    const resolving = service.resolveScene(session.sceneToken).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    await staleReadHeld.promise
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'held-resume.pdf' }),
    }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    releaseStaleRead.resolve()
    await resolving
    const status = await service.getStatus(session.sessionId, session.controlToken)
    if (uploaded.ok) {
      assert.equal(status.status, 'uploaded', 'a successful phone upload must stay uploaded after scene resolve')
      assert.equal(status.file?.fileId, uploaded.value.file?.fileId, 'scene resolve must not detach the uploaded file')
      assert.equal(prisma.files.get(uploaded.value.file!.fileId)?.deletedAt ?? null, null)
    } else {
      assert.notEqual(status.status, 'uploaded', 'rejected upload must not be reported as received')
      assert.equal(status.file, null)
    }
  }

  {
    const uploadEntered = deferred()
    const releaseUpload = deferred()
    const { service, prisma, redis } = makeService({
      beforeUpload: async (callNumber) => {
        if (callNumber === 1) {
          uploadEntered.resolve()
          await releaseUpload.promise
        }
      },
    })
    const session = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const pending = service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'slow.pdf' }),
    })
    await uploadEntered.promise
    await redis.setEx(lockKey, 30, 'successor-lock')
    releaseUpload.resolve()
    await expectRejects(
      () => pending,
      BadRequestException,
      'upload that lost its lock must not report success',
    )
    assert.equal(await redis.get(lockKey), 'successor-lock', 'finishing upload must not delete a successor lock')
    const status = await service.getStatus(session.sessionId, session.controlToken)
    assert.equal(status.file, null, 'uncommitted upload must not remain the kiosk receipt')
    for (const stored of prisma.files.values()) {
      assert.notEqual(stored.deletedAt, null, 'bytes written after the lock was lost must be deleted')
    }
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const garbled = Buffer.from('张三_简历.pdf', 'utf8').toString('latin1')
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: garbled }),
    })
    assert.equal(uploaded.file?.filename, '张三_简历.pdf', 'phone multipart UTF-8 filenames must be restored before receipt')
    const plain = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const kept = await service.uploadFile({
      sessionId: plain.sessionId,
      uploadToken: plain.uploadToken,
      file: file({ originalname: 'résumé.pdf' }),
    })
    assert.equal(kept.file?.filename, 'résumé.pdf', 'latin1 filenames without Han characters stay unchanged')
  }

  console.log('PASS upload session verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
