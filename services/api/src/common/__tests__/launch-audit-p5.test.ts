import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { validate } from 'class-validator'
import { AuditService } from '../../audit/audit.service'
import { AuditLogQueryDto } from '../../audit/dto/audit-log-query.dto'
import { AuthService } from '../../auth/auth.service'
import { FilesController } from '../../files/files.controller'
import { UpdateResponseConfigDto } from '../../job-sync/dto/response-config.dto'
import { isPrivateOrReserved } from '../../job-sync/ssrf-guard'
import { MemberAuthService } from '../../member-auth/member-auth.service'
import { TrtcController } from '../../trtc/trtc.controller'
import type { Request } from 'express'

test('API-01 rejects mapped, translated, 6to4 and multicast addresses', () => {
  for (const address of [
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '64:ff9b::7f00:1',
    '64:ff9b:1::7f00:1',
    '::ffff:0:7f00:1',
    '2002:7f00:1::',
    'ff02::1',
  ]) {
    assert.equal(isPrivateOrReserved(address), true, address)
  }
  assert.equal(isPrivateOrReserved('8.8.8.8'), false)
  assert.equal(isPrivateOrReserved('2606:4700:4700::1111'), false)
})

test('API-23 audit query DTO rejects NaN pagination and invalid dates', async () => {
  const dto = Object.assign(new AuditLogQueryDto(), {
    limit: Number.NaN,
    offset: Number.NaN,
    startAt: 'not-a-date',
  })
  const errors = await validate(dto)
  assert.ok(errors.some((error) => error.property === 'limit'))
  assert.ok(errors.some((error) => error.property === 'offset'))
  assert.ok(errors.some((error) => error.property === 'startAt'))
})

test('API-16 response config DTO rejects non-string and unsupported mappings', async () => {
  const dto = Object.assign(new UpdateResponseConfigDto(), {
    dataType: 'job',
    fields: { title: 42, unknownField: 'source' },
  })
  const errors = await validate(dto)
  assert.ok(errors.some((error) => error.property === 'fields'))
})

test('API-04 EndUser audit stores actorId null and endUserId in payload', async () => {
  let created: Record<string, unknown> | undefined
  const prisma = {
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created = data
        return { id: 'audit-1' }
      },
    },
  }
  const audit = new AuditService(prisma as never)
  await audit.write({
    actorId: null,
    actorRole: 'member',
    action: 'test.member_action',
    targetType: 'file',
    targetId: 'file-1',
    payload: { endUserId: 'end-user-1' },
  })
  assert.equal(created?.actorId, null)
  assert.deepEqual(JSON.parse(String(created?.payloadJson)), { endUserId: 'end-user-1' })
})

test('API-05 admin anonymous file access writes required audit before returning URL', async () => {
  const calls: string[] = []
  const files = {
    getAccessUrl: async () => {
      calls.push('url')
      return {
        response: { fileId: 'file-1', url: '/signed', printFileUrl: '/print', expiresAt: new Date().toISOString(), disposition: 'inline' },
        record: { purpose: 'id_scan', ownerType: 'system' },
        needsAdminAudit: false,
      }
    },
  }
  const audit = {
    writeRequired: async (_tx: unknown, args: { action: string; payload?: Record<string, unknown> }) => {
      calls.push('audit')
      assert.equal(args.action, 'file.admin_access')
      assert.equal(args.payload?.ownerType, 'system')
      return 'audit-1'
    },
  }
  const controller = new FilesController(files as never, audit as never, {} as never, {} as never, {} as never)
  ;(controller as unknown as { resolveRequester: () => Promise<unknown> }).resolveRequester = async () => ({
    kind: 'user', userId: 'admin-1', role: 'admin', orgId: null,
  })
  const response = await controller.previewUrl('file-1', { headers: {}, ip: '127.0.0.1' } as Request & { requestId?: string })
  assert.equal(response.success, true)
  assert.deepEqual(calls, ['url', 'audit'])
})

test('API-05 legacy admin signed URL also requires audit success', async () => {
  const calls: string[] = []
  const files = {
    getSignedUrl: async () => {
      calls.push('url')
      return { fileId: 'file-1', url: '/signed', expiresAt: new Date().toISOString(), purpose: 'id_scan' }
    },
  }
  const audit = {
    writeRequired: async (_tx: unknown, args: { action: string }) => {
      calls.push('audit')
      assert.equal(args.action, 'file.get_signed_url')
      return 'audit-1'
    },
    write: async () => { throw new Error('soft audit must not be used for admin') },
  }
  const controller = new FilesController(files as never, audit as never, {} as never, {} as never, {} as never)
  const response = await controller.signedUrl(
    'file-1',
    { userId: 'admin-1', role: 'admin', orgId: null, sessionId: 'session-1' },
    { headers: {}, ip: '127.0.0.1' } as Request & { requestId?: string },
  )
  assert.equal(response.success, true)
  assert.deepEqual(calls, ['url', 'audit'])
})

test('API-06 same openid can log in with a phone already registered by SMS', async () => {
  process.env.SECRET_ENCRYPTION_KEY = 'launch-audit-p5-test-key-32-bytes-minimum'
  const openid = 'openid-1'
  const phone = '13800138000'
  const oldUser = { id: 'old-user', phoneHash: 'old', phoneEnc: 'old', wxOpenId: openid, nickname: null, enabled: true, status: 'active' }
  const phoneUser = { id: 'phone-user', phoneHash: 'new', phoneEnc: 'new', wxOpenId: null, nickname: null, enabled: true, status: 'active' }
  const updates: Array<{ id: string; data: Record<string, unknown> }> = []
  const endUser = {
    findUnique: async ({ where }: { where: Record<string, string> }) => {
      if (where.wxOpenId) return oldUser
      if (where.phoneHash) return phoneUser
      if (where.id === phoneUser.id) return { enabled: true, status: 'active' }
      return null
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      updates.push({ id: where.id, data })
      return where.id === phoneUser.id ? { ...phoneUser, ...data } : { ...oldUser, ...data }
    },
  }
  const prisma = {
    legalDocVersion: { findFirst: async ({ where }: { where: { docType: string } }) => ({ id: where.docType, version: 'v1' }) },
    endUser,
    memberLegalConsent: { create: async () => ({}) },
    $transaction: async (operation: (tx: { endUser: typeof endUser }) => Promise<unknown>) => operation({ endUser }),
  }
  const redis = { registerMemberSession: async () => undefined, unregisterMemberSession: async () => undefined }
  const jwt = { sign: () => 'token' }
  const service = new MemberAuthService(prisma as never, redis as never, jwt as never, {} as never)
  ;(service as unknown as { fetchWxOpenId: () => Promise<string> }).fetchWxOpenId = async () => openid
  ;(service as unknown as { fetchWxPhone: () => Promise<string> }).fetchWxPhone = async () => phone
  const result = await service.wxLogin('code', 'phone-code', { termsVersion: 'v1', privacyVersion: 'v1' }, '127.0.0.1')
  assert.equal(result.user.id, phoneUser.id)
  assert.equal(updates[0]?.id, oldUser.id)
  assert.equal(updates[0]?.data.wxOpenId, null)
  assert.equal(updates[1]?.id, phoneUser.id)
  assert.equal(updates[1]?.data.wxOpenId, openid)
})

test('API-19 account failure bucket locks password login across requests', async () => {
  let failures = 0
  const redis = {
    get: async () => String(failures),
    incrWithTtl: async () => ++failures,
    del: async () => 1,
  }
  const prisma = { user: { findFirst: async () => null } }
  const auth = new AuthService({ sign: () => 'token' } as never, prisma as never, redis as never, {} as never, {} as never)
  for (let attempt = 0; attempt < 5; attempt++) {
    await assert.rejects(() => auth.login('admin-name', 'wrong', 'admin'))
  }
  await assert.rejects(
    () => auth.login('admin-name', 'wrong', 'admin'),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
  )
})

test('API-19 account lock cannot be bypassed with another login alias', async () => {
  const counters = new Map<string, number>()
  const redis = {
    get: async (key: string) => String(counters.get(key) ?? 0),
    incrWithTtl: async (key: string) => {
      const value = (counters.get(key) ?? 0) + 1
      counters.set(key, value)
      return value
    },
    del: async (key: string) => counters.delete(key) ? 1 : 0,
  }
  const user = {
    id: 'admin-1', username: 'admin-name', passwordHash: await bcrypt.hash('correct', 4),
    passwordProofState: 'owner_managed', name: 'Admin', role: 'admin', orgId: null, enabled: true,
    phoneHash: null, phoneEnc: null, phoneVerifiedAt: null,
    emailHash: 'email-hash', emailEnc: 'email-enc', emailVerifiedAt: new Date(), emailVerifyMethod: 'admin_manual',
    tokenVersion: 0, deletedAt: null,
  }
  const prisma = { user: { findFirst: async () => user } }
  const auth = new AuthService({ sign: () => 'token' } as never, prisma as never, redis as never, {} as never, {} as never)
  for (let attempt = 0; attempt < 5; attempt++) {
    await assert.rejects(() => auth.login('admin-name', 'wrong', 'admin'))
  }
  await assert.rejects(
    () => auth.login('admin@example.com', 'wrong', 'admin'),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
  )
})

test('API-30 TRTC exposes random stop capability and preserves it when stop fails', async () => {
  const values = new Map<string, string>()
  const redis = {
    setEx: async (key: string, _ttl: number, value: string) => { values.set(key, value) },
    get: async (key: string) => values.get(key) ?? null,
    del: async (key: string) => values.delete(key) ? 1 : 0,
  }
  let stopTaskId = ''
  let shouldFail = true
  const trtc = {
    startSession: async () => ({ sdkAppId: 1, userId: 'u', userSig: 'sig', roomId: 'room', taskId: 'tencent-task' }),
    stopSession: async (taskId: string) => {
      stopTaskId = taskId
      if (shouldFail) throw new Error('provider unavailable')
    },
  }
  const controller = new TrtcController(trtc as never, redis as never)
  const request = { headers: {}, ip: '127.0.0.1' } as Request
  const started = await controller.startSession({ userId: 'u' }, request, 'terminal-1')
  assert.notEqual(started.taskId, 'tencent-task')
  assert.equal(values.get(`trtc:owner:${started.taskId}`), 'tencent-task')
  await assert.rejects(() => controller.stopSession({ taskId: started.taskId }, request, 'terminal-1'))
  assert.equal(values.has(`trtc:owner:${started.taskId}`), true)
  shouldFail = false
  await controller.stopSession({ taskId: started.taskId }, request, 'terminal-1')
  assert.equal(stopTaskId, 'tencent-task')
  assert.equal(values.has(`trtc:owner:${started.taskId}`), false)
})
