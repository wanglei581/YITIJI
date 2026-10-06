// 本门禁要验证「同一手机号重新注册后读不到旧数据」，读取接口里有招聘类收藏；按托管打开跑，
// 免得列表因为托管关闭恒为空而让这条断言空过。
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'true'
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { Redis } from 'ioredis'
import { AdminUsersController } from '../src/admin-users/admin-users.controller'
import { AdminUsersService } from '../src/admin-users/admin-users.service'
import { AuditService } from '../src/audit/audit.service'
import { encryptPhone, hashPhone, decryptPhone } from '../src/common/crypto/phone-identity'
import { EndUserAuthGuard } from '../src/common/guards/end-user-auth.guard'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { MemberDataExportRedisService } from '../src/common/redis/member-data-export-redis.service'
import { FilesService } from '../src/files/files.service'
import { MemberAssetsService } from '../src/member-assets/member-assets.service'
import { MemberAuthService } from '../src/member-auth/member-auth.service'
import { MemberStepUpService } from '../src/member-auth/member-step-up.service'
import { MemberPrintOrdersService } from '../src/member-print-orders/member-print-orders.service'
import { MemberClosureService, CLOSURE_DELETE_MODELS, type MemberClosureInput } from '../src/member-privacy/member-closure.service'
import { MemberClosureRedisService } from '../src/member-privacy/member-closure-redis.service'
import { newClosurePhoneIdentity, readClosureRetentionYears } from '../src/member-privacy/member-closure-retention'
import { MemberDataRequestService } from '../src/member-privacy/member-data-request.service'
import { MemberDataRequestController } from '../src/member-privacy/member-privacy.controller'
import { PrismaService } from '../src/prisma/prisma.service'
import { createPrismaClient } from '../src/prisma/create-client'
import { StorageService } from '../src/storage/storage.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { ClosureMemoryRedis, scanClosureDatabase, scanClosureRedis, type ClosureScanIdentity } from './support/member-closure-verification'

// 不允许把外部未标记的库偷偷替换成临时库来绕过保护。
assertIsolatedVerificationDatabase()
const apiRoot = resolve(__dirname, '..')
const temporary = mkdtempSync(join(tmpdir(), 'verify-member-closure-'))
const usesPostgres = /^postgres(?:ql)?:/.test(process.env['DATABASE_URL']!)
if (!usesPostgres) {
  const database = join(temporary, 'verify-member-closure.db')
  closeSync(openSync(database, 'a'))
  process.env['DATABASE_URL'] = `file:${database}`
  assertIsolatedVerificationDatabase()
  try {
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { cwd: apiRoot, env: process.env, stdio: 'pipe' })
  } catch (error) { rmSync(temporary, { recursive: true, force: true }); throw error }
}
process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-member-closure-secret-01234567890123456789'
process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['FILE_STORAGE_DIR'] = join(temporary, 'objects')
const realRedis = process.env['MEMBER_CLOSURE_REAL_REDIS'] === '1'
if (realRedis) {
  assert.equal(process.env['VERIFICATION_REDIS_TARGET'], 'isolated', '真 Redis 必须显式声明隔离')
  const target = new URL(process.env['REDIS_URL']!)
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), '真 Redis 仅允许隔离 loopback')
}
assertIsolatedVerificationDatabase()
const prisma = new PrismaService()
const scanClient = createPrismaClient(process.env['DATABASE_URL']!).client
const memory = new ClosureMemoryRedis()
const client = realRedis ? new Redis(process.env['REDIS_URL']!, { maxRetriesPerRequest: 1, connectTimeout: 1000 }) : memory
const redis = realRedis ? new RedisService(client as Redis) : memory as unknown as RedisService
const exportRedis = realRedis ? new MemberDataExportRedisService(client as Redis) : memory as unknown as MemberDataExportRedisService
const audit = new AuditService(prisma)
const stepUp = new MemberStepUpService(prisma, redis, audit, { send: async () => undefined } as never)
const requests = new MemberDataRequestService(prisma, stepUp, audit, redis)
const storage = new StorageService()
const files = new FilesService(prisma, audit, storage)
const closureRedis = new MemberClosureRedisService(client as Redis, redis, exportRedis, prisma)
const closure = new MemberClosureService(prisma, files, closureRedis, audit)
const jwt = new JwtService({ secret: 'member-closure-verification-jwt-secret', signOptions: { audience: 'enduser', expiresIn: '30m' } })
const auth = new MemberAuthService(prisma, redis, jwt, { send: async () => undefined } as never)
const guard = new EndUserAuthGuard(jwt, redis, prisma)
const adminUsers = new AdminUsersService(prisma, audit)
const tag = randomUUID().replace(/-/g, '')
const admin = { userId: `closure-admin-${tag}`, role: 'admin' as const, orgId: null }
const auditContext = { actorId: admin.userId, actorRole: 'admin', ipAddress: null, userAgent: null, requestId: null }
const created: Array<{ model: string; id: string }> = []
const memberIds: string[] = []
const redisKeys: string[] = []
const cases: string[] = []

async function put(model: string, data: Record<string, unknown>) {
  const delegate = (prisma as unknown as Record<string, { create(input: unknown): Promise<any> }>)[model]!
  const row = await delegate.create({ data })
  created.push({ model, id: row.id }); return row
}
async function key(keyName: string, value: string) {
  redisKeys.push(keyName); await redis.setEx(keyName, 600, value)
}
function code(error: any) { return error.getResponse?.()?.error?.code }
async function expectError(wanted: string, operation: () => Promise<unknown>) {
  try { await operation(); assert.fail(`期望 ${wanted}，实际成功`) }
  catch (error) { assert.equal(code(error), wanted); return error as any }
}
async function check(label: string, operation: () => Promise<void>) {
  try { await operation() } catch (error) { console.error(`FAIL ${label}`); throw error }
  cases.push(label); console.log(`PASS ${label}`)
}
function context(token: string) {
  return { switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }) } as never
}
async function grant(id: string, action = 'close_account') {
  const token = randomBytes(32).toString('base64url')
  const user = await prisma.endUser.findUniqueOrThrow({ where: { id } })
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await redis.registerMemberStepUpGrant(id, tokenHash, 300, JSON.stringify({ endUserId: id, action, deviceDigest: null,
    statusChangedAt: user.statusChangedAt?.toISOString() ?? null }))
  redisKeys.push(`member:step-up:grant:${tokenHash}`, `member:user-step-up-grants:${id}`)
  return token
}

async function member(nickname: string) {
  const phone = `139${randomInt(10000000, 99999999)}`
  const identity: ClosureScanIdentity = { phone, phoneHash: hashPhone(phone), phoneEnc: encryptPhone(phone),
    wxOpenId: `wx-${randomUUID()}`, nickname: `${nickname}·${tag.slice(0, 6)}-${memberIds.length}` }
  const row = await put('endUser', { ...identity, phone: undefined, status: 'active', enabled: true })
  memberIds.push(row.id); return { id: row.id as string, identity }
}

async function fixture(id: string, identity: ClosureScanIdentity) {
  const expiresAt = new Date(Date.now() + 86400_000)
  const terminalId = `closure-terminal-${id}`
  await put('terminal', { id: terminalId, terminalCode: terminalId, agentToken: randomUUID(), deviceFingerprint: randomUUID(), displayName: '市民服务中心东厅' })
  const fileIds: string[] = []; const objectKeys: string[] = []
  for (const purpose of ['resume_upload', 'print_doc', 'contract_upload', 'contract_review_report', 'resume_scan', 'member_data_export']) {
    const storageKey = `users/${id}/${randomUUID()}.pdf`
    const buffer = Buffer.from(`%PDF-1.4\n${identity.nickname} ${identity.phone} 求职材料`)
    await storage.putObject(storageKey, buffer, 'application/pdf')
    const file = await put('fileObject', { storageKey, filename: `${identity.nickname}的求职材料.pdf`, bucket: 'local-fs', region: 'local', mimeType: 'application/pdf',
      sizeBytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'), purpose, endUserId: id,
      ownerType: 'user', ownerId: id, status: 'active', expiresAt })
    fileIds.push(file.id); objectKeys.push(storageKey)
  }
  // 覆盖历史 ownerId 归属、无 endUserId 的派生文件和尚未绑定的上传会话。
  for (const kind of ['owner_alias', 'derived', 'upload_pending']) {
    const storageKey = `temporary/${randomUUID()}.pdf`
    const buffer = Buffer.from(`%PDF-1.4 ${identity.nickname} ${identity.phone}`)
    await storage.putObject(storageKey, buffer, 'application/pdf')
    const file = await put('fileObject', { storageKey, filename: `${identity.nickname}的扫描材料.pdf`, bucket: 'local-fs', region: 'local',
      mimeType: 'application/pdf', sizeBytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'),
      purpose: 'resume_upload', status: 'active', expiresAt,
      ...(kind === 'owner_alias' ? { ownerType: 'user', ownerId: id } : {}),
      ...(kind === 'derived' ? { sourceFileId: fileIds[0] } : {}) })
    fileIds.push(file.id); objectKeys.push(storageKey)
    if (kind === 'upload_pending') {
      const sessionId = randomUUID()
      await key(`upload_session:${sessionId}`, JSON.stringify({ sessionId, endUserId: id, file: { fileId: file.id } }))
    }
  }
  const task = await put('printTask', { id: randomUUID(), terminalId, endUserId: id, fileUrl: `/files/${fileIds[0]}/content`, fileId: fileIds[0], fileMd5: identity.phoneHash,
    status: 'completed', paramsJson: JSON.stringify({ fileName: `${identity.nickname}.pdf`, phone: identity.phone, copies: 1 }) })
  const order = await put('order', { orderNo: `M${randomInt(10000000, 99999999)}${randomInt(10000000, 99999999)}`, endUserId: id, terminalId,
    printTaskId: task.id, payStatus: 'paid', taskStatus: 'completed', pickupStatus: 'used', amountCents: 200,
    sourceFileId: fileIds[0], sourceFileName: `${identity.nickname}.pdf`, sourceFileSha256: identity.phoneHash,
    printParamsJson: JSON.stringify({ phone: identity.phone }), itemsJson: JSON.stringify([{ nickname: identity.nickname }]),
    refundReason: `用户 ${identity.nickname} 补印`, pickupCodeEnc: identity.phoneEnc, idempotencyPayloadHash: identity.phoneHash })
  await prisma.printTask.update({ where: { id: task.id }, data: { orderId: order.id } })
  await put('orderItem', { orderId: order.id, seq: 1, fileId: fileIds[0], colorMode: 'black_white', duplex: 'simplex', copies: 1, billablePages: 2, amountCents: 200, status: 'completed', printTaskId: task.id })
  await put('printTaskStatusLog', { taskId: task.id, fromStatus: 'printing', toStatus: 'completed', errorCode: null })
  await put('orderSubmissionLedger', { endUserId: id, idempotencyKey: randomUUID(), orderKind: 'print', payloadHash: identity.phoneHash, status: 'succeeded', orderId: order.id })
  await put('paymentAttempt', { orderId: order.id, channel: 'sandbox', amountCents: 200, status: 'success', prepayId: identity.wxOpenId,
    qrCodeContent: `sandboxpay://${identity.phone}`, channelTxnNo: randomUUID(), failReason: identity.nickname })
  await put('refund', { orderId: order.id, refundNo: randomUUID(), amountCents: 50, status: 'success', reason: `${identity.nickname} ${identity.phone} 多付`, channel: 'offline' })
  const activity = await put('benefitActivity', { title: '秋季求职材料公益打印', benefitType: 'free_quota' })
  const benefit = await put('benefitGrant', { endUserId: id, benefitType: 'free_quota', title: `${identity.nickname}的打印权益`, quantityTotal: 10, quantityRemaining: 8, status: 'active', description: identity.phone })
  await put('benefitClaim', { endUserId: id, benefitGrantId: benefit.id, activityId: activity.id })
  await put('redemptionRecord', { endUserId: id, benefitRef: benefit.id, kind: 'free_quota', serviceType: 'print', serviceRefId: task.id, idempotencyKey: randomUUID() })
  const interview = await put('mockInterviewSession', { endUserId: id, interviewerType: 'hr', industry: '软件服务', position: '产品助理', experience: 'fresh', difficulty: 'standard', expiresAt, resumeDigest: identity.nickname })
  await put('mockInterviewTurn', { sessionId: interview.id, idx: 1, role: 'candidate', content: `${identity.nickname} ${identity.phone}`, transcriptText: identity.nickname })
  await put('mockInterviewReport', { sessionId: interview.id, payloadJson: JSON.stringify({ candidate: identity.nickname }), expiresAt })
  const advisor = await put('advisorSession', { endUserId: id, skill: 'qa', topic: `我是${identity.nickname}，电话${identity.phone}`, expiresAt })
  await put('advisorPin', { sessionId: advisor.id, idx: 1, content: identity.nickname, evidenceLevel: 'E2' })
  await put('advisorArtifact', { sessionId: advisor.id, kind: 'qa_pins', provider: 'fallback', payloadJson: JSON.stringify({ phone: identity.phone }), fileId: fileIds[1], expiresAt })
  await put('aiResumeResult', { taskId: randomUUID(), endUserId: id, kind: 'parse', status: 'completed', provider: 'fallback', payloadJson: JSON.stringify({ nickname: identity.nickname }), expiresAt })
  await put('jobAiSession', { endUserId: id, operation: 'job_fit', status: 'completed', intentJson: JSON.stringify({ nickname: identity.nickname }), expiresAt })
  const doc = await put('documentProcessTask', { endUserId: id, kind: 'pii', sourceFileId: fileIds[1], resultFileId: fileIds[1], expiresAt })
  await put('piiFinding', { taskId: doc.id, type: 'phone', label: '电话', snippet: identity.phone })
  await put('contractReviewTask', { endUserId: id, sourceFileId: fileIds[2], resultFileId: fileIds[3], contractType: 'labor', consentVersion: 'v1', consentedAt: new Date(), consentScopeHash: identity.phoneHash,
    disclaimerVersion: 'v1', rulePackVersion: 'v1', schemaVersion: 'v1', resultJson: JSON.stringify({ name: identity.nickname }), expiresAt })
  await put('scanTask', { terminalId, endUserId: id, scanType: 'resume', status: 'expired', fileId: fileIds[4], expiresAt })
  await put('browseLog', { endUserId: id, targetType: 'policy', targetId: randomUUID(), targetTitle: identity.nickname, expiresAt })
  await put('externalJumpLog', { endUserId: id, targetType: 'policy', targetId: randomUUID(), action: 'external_open', targetTitle: identity.nickname, expiresAt })
  await put('favorite', { endUserId: id, targetType: 'policy', targetId: randomUUID(), title: identity.nickname })
  await put('jobApplication', { endUserId: id, companyName: '青岛海岸软件服务有限公司', positionTitle: '产品助理', note: identity.phone, channel: 'external_self_reported' })
  // H2-3：托管打开时期留下的「关联系统岗位」的求职进度。托管关闭后列表把它整条隐藏，但库里还在，注销时同样要删。
  const linkOrg = await put('organization', { id: `closure-org-${id}`, name: '崂山区公共就业服务中心', type: 'licensed_hr_agency' })
  const linkedJob = await put('job', { sourceOrgId: linkOrg.id, externalId: `closure-job-${id}`, sourceName: '崂山区公共就业服务中心',
    sourceUrl: 'https://example.com/jobs/warehouse', title: '仓库理货员', company: '青岛崂山某配送服务有限公司', city: '青岛',
    reviewStatus: 'approved', publishStatus: 'published' })
  await put('jobApplication', { endUserId: id, jobId: linkedJob.id, companyName: '青岛崂山某配送服务有限公司', positionTitle: '仓库理货员', channel: 'external_self_reported' })
  await put('userNotification', { memberId: id, type: 'legacy', title: '打印材料通知', content: identity.nickname })
  await put('kioskSession', { memberId: id, terminalId, orgId: null, clientSessionId: randomUUID(), categoriesJson: JSON.stringify([identity.nickname]), expiresAt })
  await put('memberNotification', { endUserId: id, title: '材料已打印', content: identity.nickname })
  // AI 按人次数账本：每日计数键是 `member:<id>`，预占记录存原始会员号。
  await prisma.aiQuotaDaily.create({ data: { endUserId: `member:${id}`, bucket: 'ai_resume', day: '2026-10-03', used: 3 } })
  await prisma.aiQuotaReservation.create({ data: { operationKey: randomBytes(32).toString('hex'), endUserId: id, bucket: 'ai_resume',
    source: 'daily', day: '2026-10-03', status: 'committed', resultRef: `resume-${randomUUID()}` } })
  await prisma.aiQuotaReservation.create({ data: { operationKey: randomBytes(32).toString('hex'), endUserId: id, bucket: 'ai_assistant',
    source: 'daily', day: '2026-10-03', status: 'reserved' } })
  const broadcast = await put('systemBroadcast', { title: '东厅打印机维护通知', content: '下午开放使用' })
  await put('broadcastReadState', { endUserId: id, broadcastId: broadcast.id })
  const ticket = await put('feedbackTicket', { endUserId: id, terminalId, category: 'print', content: `${identity.nickname} ${identity.phone} 尾号 ${identity.phone.slice(-4)} 请处理`, contactPhoneEnc: identity.phoneEnc })
  await put('feedbackReply', { ticketId: ticket.id, senderType: 'admin', content: `已联系 ${identity.nickname} ${identity.phone} 并处理` })
  await put('memberLegalConsent', { endUserId: id, termsVersion: 'v1', privacyVersion: 'v1', source: 'sms_login', ipAddress: '198.51.100.19' })
  await put('userAiConsent', { endUserId: id, consentVersion: 'v1', scope: 'resume_ai', terminalId })
  await put('userDataRequest', { endUserId: id, requestType: 'export', status: 'ready', exportFileId: fileIds[5], exportExpiresAt: expiresAt, progressJson: JSON.stringify({ nickname: identity.nickname }) })
  await put('aiUsageRecord', { endUserId: id, featureKey: 'resume_parse', dayKey: new Date().toISOString().slice(0, 10), vendor: 'fallback', status: 'ok', terminalId, terminalVerified: true, costCny: 0.12, costMeasured: true })
  await put('aiServiceLog', { endUserId: id, operation: 'resume_parse', status: 'ok', terminalId, tokenUsageJson: JSON.stringify({ phone: identity.phone }), errorCode: identity.nickname })
  await put('auditLog', { actorRole: 'end_user', action: 'member.phone.rebind', targetType: 'EndUser', targetId: id,
    payloadJson: JSON.stringify({ oldPhoneMasked: `${identity.phone.slice(0, 3)}****${identity.phone.slice(-4)}` }) })
  for (const prefix of ['code', 'attempt', 'cooldown', 'daily']) await key(`member:sms:${prefix}:${identity.phoneHash}`, '1')
  await key(`member:step-up:challenge:${randomUUID()}:meta`, JSON.stringify({ endUserId: id }))
  await key(`member:qr:${randomUUID()}`, JSON.stringify({ user: { id, nickname: identity.nickname, phoneMasked: `${identity.phone.slice(0, 3)}****${identity.phone.slice(-4)}` } }))
  return { orderId: order.id as string, taskId: task.id as string, fileIds, objectKeys, terminalId }
}

async function main() {
  await prisma.onModuleInit()
  if (realRedis) await (client as Redis).ping()
  await put('user', { id: admin.userId, username: `closure-admin-${tag}`, name: '运营管理员', passwordHash: 'not-a-login-password', role: 'admin' })
  const owned = await member('林知远'); const other = await member('沈嘉宁')
  const ownedFixture = await fixture(owned.id, owned.identity); const otherFixture = await fixture(other.id, other.identity)
  // 阳性对照：会员号以本人会员号开头的另一行（等值删不会碰它，前缀删会误删它）。
  await prisma.aiQuotaDaily.create({ data: { endUserId: `member:${owned.id}9`, bucket: 'ai_resume', day: '2026-10-03', used: 1 } })
  await prisma.aiQuotaReservation.create({ data: { operationKey: randomBytes(32).toString('hex'), endUserId: `${owned.id}9`, bucket: 'ai_resume',
    source: 'daily', day: '2026-10-03', status: 'committed', resultRef: 'resume-prefix-control' } })
  const input: MemberClosureInput = { source: 'offline', offlineEvidenceNo: `ZX-${tag.slice(0, 8)}`, reasonText: '本人到场申请注销', phoneLast4: owned.identity.phone.slice(-4) }
  const page = { cursor: null, pageSize: 20 }
  const beforeOther = new Map<string, number>()
  for (const model of CLOSURE_DELETE_MODELS) beforeOther.set(model, await (prisma[model] as any).count({ where: { endUserId: other.id } }))
  beforeOther.set('fileObject', await prisma.fileObject.count({ where: { endUserId: other.id } }))
  const otherRetained = new Map<string, string>()
  for (const model of ['order', 'printTask', 'orderSubmissionLedger', 'redemptionRecord', 'benefitGrant', 'benefitClaim', 'feedbackTicket', 'memberLegalConsent', 'userAiConsent', 'aiServiceLog', 'aiUsageRecord', 'userDataRequest']) {
    otherRetained.set(model, JSON.stringify(await (prisma as any)[model].findMany({ where: { endUserId: other.id } })))
  }
  const session = await auth.issueLoginForUser({ id: owned.id, phoneMasked: '***', nickname: owned.identity.nickname })
  const oldGrant = await grant(owned.id)
  const otherSession = await auth.issueLoginForUser({ id: other.id, phoneMasked: '***', nickname: other.identity.nickname })
  await check('6 身份、来源、三要素、尾号错误及非管理员均拒绝', async () => {
    await expectError('CLOSURE_REQUEST_REQUIRED', () => closure.execute(owned.id, { ...input, source: 'member_request' }, admin))
    for (const [field, expected] of [['offlineEvidenceNo', 'CLOSURE_EVIDENCE_REQUIRED'], ['reasonText', 'CLOSURE_REASON_REQUIRED'], ['phoneLast4', 'CLOSURE_PHONE_REQUIRED']] as const) {
      await expectError(expected, () => closure.execute(owned.id, { ...input, [field]: '' }, admin))
    }
    const wrong = owned.identity.phone.slice(-4) === '0000' ? '9999' : '0000'
    const error = await expectError('CLOSURE_PHONE_MISMATCH', () => closure.execute(owned.id, { ...input, phoneLast4: wrong }, admin))
    assert.ok(!JSON.stringify(error.getResponse()).includes(owned.identity.phone.slice(-4)))
    await expectError('FORBIDDEN', () => closure.execute(owned.id, input, { ...admin, role: 'partner' }))
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, AdminUsersController), [JwtAuthGuard, RolesGuard])
    const roleGuard = new RolesGuard(new Reflector())
    assert.throws(() => roleGuard.canActivate({ getHandler: () => AdminUsersController.prototype.closure, getClass: () => AdminUsersController,
      switchToHttp: () => ({ getRequest: () => ({ user: { ...admin, role: 'partner' } }) }) } as never))
  })
  await check('10 本人申请须 step-up，重复幂等、不排队、不停用，只能本人撤回', async () => {
    await expectError('STEP_UP_TOKEN_INVALID', () => requests.create(owned.id, 'delete', randomUUID(), null, null))
    const row = await requests.create(owned.id, 'delete', randomUUID(), await grant(owned.id), null)
    const replay = await requests.create(owned.id, 'delete', randomUUID(), await grant(owned.id), null)
    assert.equal(row.id, replay.id); assert.equal(row.status, 'pending')
    const stored = await prisma.userDataRequest.findUniqueOrThrow({ where: { id: row.id } }); assert.equal(stored.workerJobId, null)
    assert.equal((await prisma.endUser.findUniqueOrThrow({ where: { id: owned.id } })).status, 'active')
    assert.equal(await guard.canActivate(context(session.token)), true)
    assert.equal((await adminUsers.list({ page: 1, pageSize: 20, closure: 'requested' }, auditContext)).items.some((item) => item.id === owned.id), true)
    await expectError('DATA_REQUEST_NOT_FOUND', () => requests.cancel(other.id, row.id))
    await requests.cancel(owned.id, row.id)
    await expectError('CLOSURE_REQUEST_REQUIRED', () => closure.execute(owned.id, { ...input, source: 'member_request' }, admin))
  })
  await check('5 在途订单/退款/非终态打印均拒绝并只返回订单号与状态', async () => {
    for (const change of [{ pickupStatus: 'pending' }, { payStatus: 'partial_refunded', pickupStatus: 'pending' }, { payStatus: 'refunding' }, { taskStatus: 'printing' }]) {
      await prisma.order.update({ where: { id: ownedFixture.orderId }, data: change })
      const error = await expectError('CLOSURE_BLOCKED_BY_OPEN_ORDERS', () => closure.execute(owned.id, input, admin))
      assert.equal(error.getResponse().error.orders.length, 1)
      assert.deepEqual(Object.keys(error.getResponse().error.orders[0]).sort(), ['orderNo', 'status'])
      await prisma.order.update({ where: { id: ownedFixture.orderId }, data: { payStatus: 'paid', taskStatus: 'completed', pickupStatus: 'used' } })
    }
    await prisma.printTask.update({ where: { id: ownedFixture.taskId }, data: { status: 'printing' } })
    await expectError('CLOSURE_BLOCKED_BY_OPEN_ORDERS', () => closure.execute(owned.id, input, admin))
    await prisma.printTask.update({ where: { id: ownedFixture.taskId }, data: { status: 'completed' } })
  })
  await check('5b 放弃过的订单（未付款已关闭、过期未取、明细停在待处理）不挡注销', async () => {
    // 材料包订单过期时只改订单状态、不改明细；明细停在 pending 不能算在途。
    const abandoned = await put('order', { orderNo: `M${randomInt(10000000, 99999999)}${randomInt(10000000, 99999999)}`, endUserId: owned.id,
      payStatus: 'closed', taskStatus: 'expired', pickupStatus: 'expired', amountCents: 0 })
    await put('orderItem', { orderId: abandoned.id, seq: 1, fileId: randomUUID(), colorMode: 'black_white', duplex: 'simplex', copies: 1, billablePages: 3, amountCents: 0, status: 'pending' })
    const unpaid = await put('order', { orderNo: `M${randomInt(10000000, 99999999)}${randomInt(10000000, 99999999)}`, endUserId: owned.id,
      payStatus: 'unpaid', taskStatus: 'pending', pickupStatus: 'none', amountCents: 300 })
    await put('orderItem', { orderId: unpaid.id, seq: 1, fileId: randomUUID(), colorMode: 'black_white', duplex: 'simplex', copies: 1, billablePages: 3, amountCents: 0, status: 'pending' })
    // 直接跑在途检查（尾号核验排在它前面，走 execute 会被别的错误遮住）；后面的第 7、9 组再带着这两张订单真执行一次。
    await (closure as any).assertNoOpenOrders(prisma, owned.id)
    // 对照：同一张已付款订单，明细停在待处理且取件未过期 → 仍然要挡。
    await prisma.order.update({ where: { id: abandoned.id }, data: { payStatus: 'paid', taskStatus: 'completed', pickupStatus: 'used' } })
    await expectError('CLOSURE_BLOCKED_BY_OPEN_ORDERS', () => (closure as any).assertNoOpenOrders(prisma, owned.id))
    await prisma.order.update({ where: { id: abandoned.id }, data: { payStatus: 'closed', taskStatus: 'expired', pickupStatus: 'expired' } })
  })
  // 通过真实数据库方法注入一次中途失败；不在业务代码保留故障开关。
  const originalTransaction = prisma.$transaction.bind(prisma)
  let injected = true
  ;(prisma as any).$transaction = (operation: any, options: any) => originalTransaction((tx: any) => operation(new Proxy(tx, {
    get(target, name) {
      if (name !== 'browseLog') return Reflect.get(target, name)
      return new Proxy(target.browseLog, { get(delegate, method) {
        if (method !== 'deleteMany') return Reflect.get(delegate, method)
        return async (args: any) => { if (injected) { injected = false; throw new Error('injected') }; return delegate.deleteMany(args) }
      } })
    }
  })), options)
  await check('7 中途失败停在 closing，记录失败步骤', async () => {
    await expectError('CLOSURE_EXECUTION_FAILED', () => closure.execute(owned.id, input, admin))
    assert.equal((await prisma.endUser.findUniqueOrThrow({ where: { id: owned.id } })).status, 'closing')
    const failure = await prisma.auditLog.findFirstOrThrow({ where: { targetId: owned.id, action: 'member.closure.failed' } })
    assert.equal(JSON.parse(failure.payloadJson).step, 'delete')
  })
  ;(prisma as any).$transaction = originalTransaction
  const deleting = storage.deleteObject.bind(storage); let failedObject = false
  storage.deleteObject = async (keyName, bucket) => {
    if (!failedObject && keyName === ownedFixture.objectKeys[0]) { failedObject = true; throw new Error('object unavailable') }
    return deleting(keyName, bucket)
  }
  await check('9 对象删除失败不阻断注销', async () => { await closure.execute(owned.id, input, admin) })
  storage.deleteObject = deleting
  await check('1 全部个人表硬删/权益撤销、级联清理，另一会员不受影响', async () => {
    for (const model of CLOSURE_DELETE_MODELS) {
      assert.equal(await (prisma[model] as any).count({ where: { endUserId: owned.id } }), 0, `漏删 ${model}`)
      assert.equal(await (prisma[model] as any).count({ where: { endUserId: other.id } }), beforeOther.get(model), `误删另一会员 ${model}`)
    }
    assert.equal(await prisma.fileObject.count({ where: { endUserId: owned.id } }), 0)
    // AI 次数账本：本人每日计数与预占（含还在预占中的）都删；另一会员与「会员号以本人会员号开头」的那一个都一条不动。
    assert.equal(await prisma.aiQuotaDaily.count({ where: { endUserId: `member:${owned.id}` } }), 0, '漏删 AI 每日计数')
    assert.equal(await prisma.aiQuotaReservation.count({ where: { endUserId: owned.id } }), 0, '漏删 AI 预占记录')
    assert.equal(await prisma.aiQuotaDaily.count({ where: { endUserId: `member:${other.id}` } }), 1, '误删另一会员的 AI 每日计数')
    assert.equal(await prisma.aiQuotaReservation.count({ where: { endUserId: other.id } }), 2, '误删另一会员的 AI 预占')
    assert.equal(await prisma.aiQuotaDaily.count({ where: { endUserId: `member:${owned.id}9` } }), 1, '按前缀误删了 member:<本人号>9')
    assert.equal(await prisma.aiQuotaReservation.count({ where: { endUserId: `${owned.id}9` } }), 1, '按前缀误删了 <本人号>9 的预占')
    // H2-3：关联系统岗位、托管关闭时被列表隐藏的那类求职进度也删了（不止删能看到的那几条）。
    assert.equal(await prisma.jobApplication.count({ where: { endUserId: owned.id, jobId: { not: null } } }), 0, '关联岗位的求职进度没删')
    assert.equal(await prisma.fileObject.count({ where: { endUserId: other.id } }), beforeOther.get('fileObject'))
    assert.equal(await prisma.userNotification.count({ where: { memberId: owned.id } }), 0)
    assert.equal(await prisma.userNotification.count({ where: { memberId: other.id } }), 1)
    assert.equal(await prisma.kioskSession.count({ where: { memberId: owned.id } }), 0)
    assert.equal(await prisma.kioskSession.count({ where: { memberId: other.id } }), 1)
    for (const objectKey of otherFixture.objectKeys) assert.notEqual(await storage.headObject(objectKey, 'local-fs'), null)
    assert.equal(await prisma.benefitGrant.count({ where: { endUserId: owned.id, status: 'active' } }), 0)
    for (const [model, rows] of otherRetained) assert.equal(JSON.stringify(await (prisma as any)[model].findMany({ where: { endUserId: other.id } })), rows, `误改另一会员 ${model}`)
    for (const model of ['mockInterviewTurn', 'mockInterviewReport', 'advisorPin', 'advisorArtifact', 'piiFinding']) {
      assert.equal(await (prisma as any)[model].count(), 1, `级联或另一会员隔离失败 ${model}`)
    }
  })
  await check('2 金额/任务/流水/同意记录保留，账号壳及行内无原手机号', async () => {
    const shell = await prisma.endUser.findUniqueOrThrow({ where: { id: owned.id } })
    assert.equal(shell.status, 'anonymized'); assert.notEqual(shell.phoneHash, owned.identity.phoneHash)
    assert.equal(shell.nickname, null); assert.equal(shell.wxOpenId, null); assert.equal(shell.lastLoginAt, null)
    assert.throws(() => decryptPhone(shell.phoneEnc)); assert.equal(shell.enabled, false)
    const order = await prisma.order.findUniqueOrThrow({ where: { id: ownedFixture.orderId } })
    assert.ok(!JSON.stringify(order).includes(owned.identity.phoneHash), '订单保留手机号哈希')
    assert.ok(!JSON.stringify(order).includes(owned.identity.phoneEnc), '订单保留手机号密文')
    assert.equal(order.amountCents, 200); assert.equal(order.endUserId, owned.id); assert.equal(order.sourceFileName, null)
    // 终端号是我们自己的设备标识，不是个人信息：订单、打印任务、AI 成本账上必须留着，按终端的统计才不丢行。
    assert.equal(order.terminalId, ownedFixture.terminalId, '订单的终端号被清掉了')
    assert.equal((await prisma.printTask.findUniqueOrThrow({ where: { id: ownedFixture.taskId } })).terminalId, ownedFixture.terminalId)
    assert.equal(await prisma.aiUsageRecord.count({ where: { terminalId: ownedFixture.terminalId, endUserId: null } }), 1, 'AI 成本账的终端号被清掉了')
    // 未结的反馈随注销关闭，管理员不会再对着已注销账号回复。
    assert.equal(await prisma.feedbackTicket.count({ where: { endUserId: owned.id, status: { not: 'closed' } } }), 0)
    for (const model of ['printTask', 'orderSubmissionLedger', 'redemptionRecord', 'benefitClaim', 'benefitGrant', 'feedbackTicket', 'memberLegalConsent', 'userAiConsent']) {
      assert.equal(await (prisma as any)[model].count({ where: { endUserId: owned.id } }), 1, `留存丢行 ${model}`)
    }
    assert.equal(await prisma.aiUsageRecord.count({ where: { endUserId: null, featureKey: 'resume_parse' } }), 1)
    assert.equal(await prisma.aiServiceLog.count({ where: { endUserId: null, operation: 'resume_parse' } }), 1)
    assert.equal((await prisma.memberLegalConsent.findFirstOrThrow({ where: { endUserId: owned.id } })).ipAddress, null)
  })
  await check('3 旧 token/session/step-up 失效，另一会员仍可使用', async () => {
    await expectError('MEMBER_SESSION_EXPIRED', () => guard.canActivate(context(session.token)))
    await expectError('STEP_UP_TOKEN_INVALID', () => stepUp.consumeGrant(owned.id, 'close_account', oldGrant))
    assert.equal(await guard.canActivate(context(otherSession.token)), true)
  })
  await check('7 重入成功且重复执行没有第二条 executed 审计，计数不丢', async () => {
    assert.equal((await closure.execute(owned.id, input, admin)).changed, false)
    assert.equal(await prisma.auditLog.count({ where: { targetId: owned.id, action: 'member.closure.executed' } }), 1)
    const saved = await prisma.auditLog.findFirstOrThrow({ where: { targetId: owned.id, action: 'member.closure.executed' } })
    const p = JSON.parse(saved.payloadJson); for (const model of CLOSURE_DELETE_MODELS) assert.equal(p.deleted[model], model === 'jobApplication' ? 2 : 1, `删除计数 ${model}`)
    assert.equal(p.deleted.fileObject, ownedFixture.fileIds.length)
  })
  await check('8 注销审计无手机号/尾号，offline=true 可筛选且详情含 closureRequest', async () => {
    const saved = await prisma.auditLog.findFirstOrThrow({ where: { targetId: owned.id, action: 'member.closure.executed' } })
    assert.ok(!saved.payloadJson.includes(owned.identity.phone))
    assert.ok(!new RegExp(`(?<![A-Za-z0-9])${owned.identity.phone.slice(-4)}(?![A-Za-z0-9])`).test(saved.payloadJson))
    assert.deepEqual(Object.keys(JSON.parse(saved.payloadJson)).sort(), ['deleted', 'endUserId', 'objectStorageFailures', 'offline', 'offlineEvidenceNo', 'reasonText', 'retained', 'source'].sort())
    assert.equal(JSON.parse(saved.payloadJson).offline, true)
    const list = await adminUsers.list({ page: 1, pageSize: 20, closure: 'offline_executed' }, auditContext)
    assert.equal(list.items.some((row) => row.id === owned.id), true)
    assert.equal(list.items.find((row) => row.id === owned.id)?.closureRequest?.source, 'offline')
    assert.equal((await adminUsers.getDetail(owned.id, auditContext)).user.closureRequest?.source, 'offline')
  })
  await check('9 成功对象 headObject 为空；失败对象排队、审计计数、对账后消失', async () => {
    assert.equal(failedObject, true)
    assert.notEqual(await storage.headObject(ownedFixture.objectKeys[0]!, 'local-fs'), null)
    for (const objectKey of ownedFixture.objectKeys.slice(1)) assert.equal(await storage.headObject(objectKey, 'local-fs'), null)
    assert.equal(await prisma.storageDeletion.count({ where: { storageKey: ownedFixture.objectKeys[0] } }), 1)
    const saved = await prisma.auditLog.findFirstOrThrow({ where: { targetId: owned.id, action: 'member.closure.executed' } })
    assert.equal(JSON.parse(saved.payloadJson).objectStorageFailures, 1)
    await files.reconcileStorageDeletions('manual')
    assert.equal(await storage.headObject(ownedFixture.objectKeys[0]!, 'local-fs'), null)
    assert.equal(await prisma.storageDeletion.count({ where: { storageKey: ownedFixture.objectKeys[0] } }), 0)
  })
  await check('11 全 Prisma 字符串/JSON列反查零命中；手机号相关 Redis 零命中', async () => {
    const scan = await scanClosureDatabase(scanClient, owned.identity)
    const metadata = (scanClient as any)._runtimeDataModel.models
    const actualModels = Object.entries(metadata).filter(([, model]: any) => model.fields.some((field: any) => field.name === 'endUserId')).map(([name]) => name).sort()
    const expectedModels = [...CLOSURE_DELETE_MODELS, 'fileObject', 'order', 'printTask', 'orderSubmissionLedger', 'redemptionRecord', 'benefitGrant', 'benefitClaim', 'feedbackTicket', 'memberLegalConsent', 'userAiConsent', 'userDataRequest', 'aiUsageRecord', 'aiServiceLog', 'aiQuotaDaily', 'aiQuotaReservation'].map((name) => name[0].toUpperCase() + name.slice(1)).sort()
    assert.deepEqual(actualModels, expectedModels, '新增会员模型必须显式纳入注销处置')
    const platformSetting = metadata.PlatformSetting
    assert.ok(platformSetting, 'PlatformSetting 必须存在')
    assert.equal(
      platformSetting.fields.some((field: { name: string }) => field.name === 'endUserId'),
      false,
      '新增会员模型必须显式纳入注销处置',
    )
    assert.deepEqual(scan.hits, [], `全库遗留身份: ${scan.hits.join(',')}`)
    assert.ok(scan.columns > 200)
    assert.equal(scan.exempted.length, 1)
    console.log(`INFO 扫描 ${scan.columns} 列；显式豁免 ${scan.exempted.join('; ')}`)
    assert.deepEqual(await scanClosureRedis(client as never, owned.identity, owned.id), [])
    const first = newClosurePhoneIdentity(); const second = newClosurePhoneIdentity()
    assert.notEqual(first.phoneHash, second.phoneHash); assert.notEqual(first.phoneEnc, second.phoneEnc)
    const source = readFileSync(join(apiRoot, 'src/member-privacy/member-closure-retention.ts'), 'utf8')
    const body = source.slice(source.indexOf('export function newClosurePhoneIdentity'), source.indexOf('export function closureTextScrubber'))
    assert.ok(!/hashPhone|createHash|createHmac|phone\.slice|phoneHash\s*\+/.test(body), '墓碑禁止由原手机号派生')
    const executorSource = readFileSync(join(apiRoot, 'src/member-privacy/member-closure.service.ts'), 'utf8')
    const finalBlock = executorSource.slice(executorSource.indexOf('...newClosurePhoneIdentity()'), executorSource.indexOf('if (changed.count !== 1)', executorSource.indexOf('...newClosurePhoneIdentity()')))
    assert.ok(!/phoneHash\s*:|phoneEnc\s*:|hashPhone|initial\./.test(finalBlock), '墓碑不得使用原身份派生值覆盖')
    assert.deepEqual(readClosureRetentionYears(), { orders: null, consents: null })
  })
  await check('TerminalCommand 无会员字段且不进注销清单', async () => {
    const models = (scanClient as { _runtimeDataModel: { models: Record<string, { fields: Array<{ name: string }> }> } })._runtimeDataModel.models
    const command = models['TerminalCommand']
    assert.ok(command, 'TerminalCommand 必须存在')
    const names = command.fields.map((field) => field.name)
    for (const forbidden of ['endUserId', 'memberId', 'phone', 'phoneHash', 'phoneEnc', 'nickname', 'orderId', 'fileId']) {
      assert.equal(names.includes(forbidden), false, forbidden)
    }
    assert.equal((CLOSURE_DELETE_MODELS as readonly string[]).includes('terminalCommand'), false)
    assert.equal(names.includes('endUserId'), false)
  })
  let newId = ''
  await check('4 原手机号重新登录产生新 id，本人文件/订单/AI列表全部为空', async () => {
    await key(`member:sms:code:${owned.identity.phoneHash}`, '864209')
    const newUser = await auth.verifySmsCodeForUser(owned.identity.phone, '864209')
    newId = newUser.id; memberIds.push(newId); created.push({ model: 'endUser', id: newId })
    assert.notEqual(newId, owned.id)
    const assets = new MemberAssetsService(prisma)
    assert.equal((await assets.listDocuments(newId, page)).items.length, 0)
    assert.equal((await new MemberPrintOrdersService(prisma).list(newId, page)).items.length, 0)
    assert.equal((await assets.listAiRecords(newId, page)).items.length, 0)
    const login = await auth.issueLoginForUser(newUser)
    assert.equal(await guard.canActivate(context(login.token)), true)
  })
  await check('已注销账号禁止迟到的个人数据写入与身份换绑', async () => {
    await assert.rejects(() => prisma.aiResumeResult.create({ data: { taskId: randomUUID(), kind: 'generate', status: 'completed', provider: 'fallback', endUserId: owned.id, payloadJson: '{}' } }))
    await assert.rejects(() => prisma.endUser.update({ where: { id: owned.id }, data: { phoneHash: owned.identity.phoneHash, phoneEnc: owned.identity.phoneEnc } }))
  })
  await check('12 新账号与旧壳不在同一行共现，创建/审计不含旧壳 id', async () => {
    const scan = await scanClosureDatabase(scanClient, owned.identity, [newId, owned.id])
    assert.deepEqual(scan.links, [], `新旧账号关联: ${scan.links.join(',')}`)
    const newer = await prisma.endUser.findUniqueOrThrow({ where: { id: newId } }); assert.ok(!JSON.stringify(newer).includes(owned.id))
    const audits = await prisma.auditLog.findMany({ where: { targetId: newId } }); assert.ok(!JSON.stringify(audits).includes(owned.id))
  })
  await check('本人申请执行成功、completed回执与执行筛选，禁用会员也可线下注销', async () => {
    const another = await member('许亦舟')
    const request = await requests.create(another.id, 'delete', randomUUID(), await grant(another.id), null)
    const result = await closure.execute(another.id, { source: 'member_request', reasonText: '本人申请注销', phoneLast4: another.identity.phone.slice(-4) }, admin)
    assert.equal(result.changed, true)
    assert.equal((await prisma.userDataRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'completed')
    const all = await adminUsers.list({ page: 1, pageSize: 20, closure: 'executed' }, auditContext)
    assert.equal(all.items.some((item) => item.id === another.id), true)
    const offline = await adminUsers.list({ page: 1, pageSize: 20, closure: 'offline_executed' }, auditContext)
    assert.equal(offline.items.some((item) => item.id === another.id), false)
    const disabled = await member('陆清和')
    await prisma.endUser.update({ where: { id: disabled.id }, data: { status: 'disabled', enabled: false } })
    assert.equal((await closure.execute(disabled.id, { ...input, phoneLast4: disabled.identity.phone.slice(-4) }, admin)).changed, true)
  })
  if (process.argv.includes('--http')) await verifyHttp(newId, input)
  console.log(`PASS verify-member-closure (${usesPostgres ? 'PostgreSQL' : 'SQLite'}, Redis=${realRedis ? 'real' : 'memory'}, HTTP=${process.argv.includes('--http') ? 'passed' : 'not-run'}, ${cases.length} groups)`)
}

/** 协调方可在隔离库运行 --http；实际 Nest 路由、鉴权、错误过滤和三个读取接口。 */
async function verifyHttp(newId: string, oldInput: MemberClosureInput) {
  const { Module, ValidationPipe } = await import('@nestjs/common')
  const { NestFactory } = await import('@nestjs/core')
  const { HttpExceptionFilter } = await import('../src/common/filters/http-exception.filter')
  const { MemberAssetsController } = await import('../src/member-assets/member-assets.controller')
  const { MemberPrintOrdersController } = await import('../src/member-print-orders/member-print-orders.controller')
  const { MemberPrintOrderCreateService } = await import('../src/member-print-orders/member-print-order-create.service')
  const { PickupCodeReissueService } = await import('../src/member-print-orders/pickup-code-reissue.service')
  const { MemberOrderTimelineService } = await import('../src/member-print-orders/member-order-timeline.service')
  const { MemberOrderClaimHereService } = await import('../src/member-print-orders/member-order-claim-here.service')
  const { TerminalIdentityGuard } = await import('../src/terminals/terminal-identity.guard')
  const { TerminalSessionService } = await import('../src/terminals/terminal-session.service')
  @Module({ controllers: [AdminUsersController, MemberDataRequestController, MemberAssetsController, MemberPrintOrdersController], providers: [
    { provide: MemberAssetsService, useValue: new MemberAssetsService(prisma) },
    { provide: AuditService, useValue: audit }, { provide: MemberPrintOrdersService, useValue: new MemberPrintOrdersService(prisma) },
    ...[MemberPrintOrderCreateService, PickupCodeReissueService, MemberOrderTimelineService, MemberOrderClaimHereService].map((provide) => ({ provide, useValue: {} })),
    { provide: TerminalIdentityGuard, useValue: { canActivate: () => false } },
    // 守卫由 Nest 按类实例化，上面的替身不生效；给它的依赖一个空壳，本门禁不走终端身份路径。
    { provide: TerminalSessionService, useValue: {} },
    { provide: AdminUsersService, useValue: adminUsers }, { provide: MemberClosureService, useValue: closure },
    { provide: MemberDataRequestService, useValue: requests },
    { provide: (await import('../src/member-privacy/member-data-export-download.service')).MemberDataExportDownloadService, useValue: {} },
    { provide: PrismaService, useValue: prisma }, { provide: RedisService, useValue: redis }, { provide: JwtService, useValue: jwt },
    { provide: EndUserAuthGuard, useValue: guard }, JwtAuthGuard, RolesGuard,
  ] }) class HttpModule {}
  const app = await NestFactory.create(HttpModule, { logger: false, abortOnError: false })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  app.useGlobalFilters(new HttpExceptionFilter())
  try {
    await app.listen(0, '127.0.0.1')
    const base = await app.getUrl()
    const memberUser = await prisma.endUser.findUniqueOrThrow({ where: { id: newId } })
    const session = await auth.issueLoginForUser({ id: newId, nickname: null, phoneMasked: '***' })
    const call = (path: string, method = 'GET', body?: unknown, token = session.token, extra = {}) => fetch(`${base}/${path}`, { method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) })
    for (const path of ['me/documents', 'me/print-orders', 'me/ai-records']) {
      const res = await call(path); assert.equal(res.status, 200); assert.equal((await res.json() as any).data.items.length, 0)
    }
    assert.equal((await call('admin/users')).status, 401)
    const adminToken = new JwtService({ secret: 'member-closure-verification-jwt-secret' }).sign({ sub: admin.userId, role: 'admin', ver: 0 })
    const closureInput = { ...oldInput, phoneLast4: decryptPhone(memberUser.phoneEnc).slice(-4), source: 'member_request' }
    assert.equal((await call(`admin/users/${newId}/closure`, 'POST', closureInput, adminToken)).status, 409)
    assert.equal((await call('me/data-requests', 'POST', { requestType: 'delete' }, session.token, { 'idempotency-key': randomUUID() })).status, 401)
    const response = await call('me/data-requests', 'POST', { requestType: 'delete' }, session.token,
      { 'idempotency-key': randomUUID(), 'x-member-step-up-token': await grant(newId) })
    assert.equal(response.status, 201); const row = (await response.json() as any).data
    assert.equal((await call(`me/data-requests/${row.id}/cancel`, 'POST')).status, 201)
    assert.equal((await call(`admin/users/${newId}/closure`, 'POST', closureInput, adminToken)).status, 409)
    const order = await put('order', { endUserId: newId, orderNo: `HTTP-${randomUUID()}`, payStatus: 'paid', taskStatus: 'completed', pickupStatus: 'pending', amountCents: 100 })
    const offlineInput = { ...closureInput, source: 'offline', offlineEvidenceNo: `HTTP-${tag}` }
    const blocked = await call(`admin/users/${newId}/closure`, 'POST', offlineInput, adminToken)
    assert.equal(blocked.status, 409)
    const blockedBody = await blocked.json() as any
    assert.equal(blockedBody.error.code, 'CLOSURE_BLOCKED_BY_OPEN_ORDERS')
    assert.deepEqual(blockedBody.error.orders, [{ orderNo: order.orderNo, status: 'pickup_pending' }])
    await prisma.order.update({ where: { id: order.id }, data: { pickupStatus: 'used' } })
    const executed = await call(`admin/users/${newId}/closure`, 'POST', offlineInput, adminToken)
    assert.equal(executed.status, 200); assert.equal((await executed.json() as any).status, 'anonymized')
    console.log('PASS HTTP 请求/撤回/执行鉴权与文件/订单/AI记录读取')
  } finally {
    // 只关监听端口：app.close() 会连带销毁共用的 Redis / Prisma 实例，后面的清场还要用它们。
    await new Promise<void>((done) => app.getHttpServer().close(() => done()))
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => {
  try {
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: admin.userId }, { targetId: { in: memberIds } },
      { targetId: { in: (await prisma.userDataRequest.findMany({ where: { endUserId: { in: memberIds } }, select: { id: true } })).map((row) => row.id) } }] } })
    await prisma.userDataRequest.deleteMany({ where: { endUserId: { in: memberIds } } })
    for (const { model, id } of created.reverse()) await (prisma as any)[model].deleteMany({ where: { id } })
    for (const id of memberIds) { await redis.revokeMemberSessions(id); await redis.revokeMemberStepUpGrants(id) }
    for (const name of redisKeys) await client.del(name)
  } finally {
    if (realRedis) (client as Redis).disconnect()
    await scanClient.$disconnect(); await prisma.onModuleDestroy(); rmSync(temporary, { recursive: true, force: true })
  }
})
