/**
 * verify:personal-data-retention —— 个人信息到期清理（PIPL 第十九条；律师给年限前默认不清理）
 *
 *  1. 三个配置都不填：什么都不动。
 *  2. 审计日志去标识（缺省模式）：超期行清掉 IP、浏览器标识与手机号（打码与完整的都算），动作、对象、时间保留；
 *     期内行不动；不含手机号的 payload 原样保留。
 *  3. 审计日志整行删除模式：只删超期行。
 *  4. 审计保留天数低于 180（网络安全法下限）或模式写错：拒绝执行，一行不动。
 *  5. 注销保留的同意记录：匿名化满 N 年的账号壳删；匿名化不满 N 年的不删；**在用账号再老的记录也不删**。
 *  6. 注销保留的订单与账务：同上口径，订单连同明细、支付、退款、打印任务与状态流水、提交流水、核销流水一起删。
 *  7. 每日任务已注册、删除后写一条只含条数的系统审计。
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomInt, randomUUID } from 'node:crypto'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const apiRoot = resolve(__dirname, '..')
const temporary = mkdtempSync(join(tmpdir(), 'verify-personal-data-retention-'))
const db = join(temporary, 'verify-retention.db')
closeSync(openSync(db, 'a'))
process.env['DATABASE_URL'] = `file:${db}`
process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
assertIsolatedVerificationDatabase()
execFileSync(resolve(apiRoot, 'node_modules/.bin/prisma'), ['db', 'push'], { cwd: apiRoot, env: process.env, stdio: 'pipe', timeout: 60_000 })
process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-retention-phone-secret-0123456789abcdef'

const RETENTION_ENV = ['AUDIT_LOG_RETENTION_DAYS', 'AUDIT_LOG_RETENTION_MODE', 'CLOSURE_RETAINED_ORDER_YEARS', 'CLOSURE_RETAINED_CONSENT_YEARS']
const NOW = new Date('2026-10-04T03:00:00+08:00')
const DAY = 24 * 3600_000
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)

async function main(): Promise<void> {
  for (const key of RETENTION_ENV) delete process.env[key]
  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { sweepPersonalDataRetention, PersonalDataRetentionTask, AUDIT_LOG_MIN_RETENTION_DAYS } = await import('../src/member-privacy/personal-data-retention')
  const { encryptPhone, hashPhone } = await import('../src/common/crypto/phone-identity')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const cases: string[] = []
  const check = async (label: string, run: () => Promise<void>) => {
    try { await run() } catch (error) { console.error(`FAIL ${label}`); throw error }
    cases.push(label); console.log(`PASS ${label}`)
  }
  const sweep = () => sweepPersonalDataRetention(prisma, NOW)

  // ── 夹具：三个会员——匿名化 6 年、匿名化 1 年、在用（数据同样老）──────────────────────
  const member = async (nickname: string, status: 'active' | 'anonymized' | 'disabled', anonymizedDaysAgo: number | null) => {
    const phone = `139${randomInt(10000000, 99999999)}`
    const user = await prisma.endUser.create({ data: {
      phoneHash: status === 'anonymized' ? `anonymized:${randomUUID()}` : hashPhone(phone),
      phoneEnc: status === 'anonymized' ? `anonymized:${randomUUID()}` : encryptPhone(phone),
      nickname: status === 'anonymized' ? null : nickname, status, enabled: status === 'active',
      anonymizedAt: anonymizedDaysAgo === null ? null : ago(anonymizedDaysAgo), createdAt: ago(3000),
    } })
    const task = await prisma.printTask.create({ data: { id: randomUUID(), endUserId: user.id, fileUrl: '', fileMd5: '', status: 'completed', paramsJson: '{}', createdAt: ago(2500) } })
    const order = await prisma.order.create({ data: {
      orderNo: `M${randomInt(10000000, 99999999)}${randomInt(10000000, 99999999)}`, endUserId: user.id, printTaskId: task.id,
      payStatus: 'paid', taskStatus: 'completed', pickupStatus: 'used', amountCents: 200, createdAt: ago(2500),
    } })
    await prisma.printTask.update({ where: { id: task.id }, data: { orderId: order.id } })
    await prisma.orderItem.create({ data: { orderId: order.id, seq: 1, fileId: '', colorMode: 'black_white', duplex: 'simplex', copies: 1, billablePages: 2, amountCents: 200, status: 'completed', printTaskId: task.id } })
    await prisma.printTaskStatusLog.create({ data: { taskId: task.id, fromStatus: 'printing', toStatus: 'completed' } })
    await prisma.paymentAttempt.create({ data: { orderId: order.id, channel: 'sandbox', amountCents: 200, status: 'success' } })
    await prisma.refund.create({ data: { orderId: order.id, refundNo: randomUUID(), amountCents: 50, status: 'success', channel: 'offline' } })
    await prisma.orderSubmissionLedger.create({ data: { endUserId: user.id, idempotencyKey: randomUUID(), orderKind: 'print', payloadHash: '', status: 'succeeded', orderId: order.id } })
    await prisma.redemptionRecord.create({ data: { endUserId: user.id, benefitRef: randomUUID(), kind: 'free_quota', serviceType: 'print', serviceRefId: task.id, idempotencyKey: randomUUID() } })
    await prisma.memberLegalConsent.create({ data: { endUserId: user.id, termsVersion: 'v1', privacyVersion: 'v1', source: 'sms_login', createdAt: ago(2500) } })
    await prisma.userAiConsent.create({ data: { endUserId: user.id, consentVersion: 'v1', scope: 'resume_ai' } })
    return { id: user.id, orderId: order.id, taskId: task.id }
  }
  const oldShell = await member('', 'anonymized', 6 * 365)
  const newShell = await member('', 'anonymized', 365)
  const active = await member('孙海燕', 'active', null)
  // 状态与匿名化时间对不上的账号（例如人工纠错后改回停用）：只认状态，不能因为有一个旧的匿名化时间就删它的记录。
  const inconsistent = await member('韩志强', 'disabled', 6 * 365)

  const auditRow = (days: number, extra: Record<string, unknown> = {}) => prisma.auditLog.create({ data: {
    actorRole: 'admin', action: 'feedback.view', targetType: 'FeedbackTicket', targetId: randomUUID(),
    payloadJson: JSON.stringify({ category: 'print', phoneMasked: '138****0614', note: '来电 13853219907 已回访', ...extra }),
    ipAddress: '198.51.100.23', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Edge/128', createdAt: ago(days),
  } })
  const oldAudit = await auditRow(400)
  const recentAudit = await auditRow(30)
  // 打码的证件号也带「****」但不是手机号：不该被改动，也不能被反复取到。
  const idCardOld = await prisma.auditLog.create({ data: { actorRole: 'admin', action: 'pii.finding.view', targetType: 'PiiFinding', payloadJson: JSON.stringify({ snippet: '3702**********1234' }), createdAt: ago(400) } })
  const plainOld = await prisma.auditLog.create({ data: { actorRole: 'system', action: 'ai_service_log.cleanup_expired', targetType: 'ai_service_log', payloadJson: JSON.stringify({ deletedCount: 12 }), createdAt: ago(400) } })
  const counts = async (id: string) => ({
    orders: await prisma.order.count({ where: { endUserId: id } }),
    tasks: await prisma.printTask.count({ where: { endUserId: id } }),
    ledgers: await prisma.orderSubmissionLedger.count({ where: { endUserId: id } }),
    redemptions: await prisma.redemptionRecord.count({ where: { endUserId: id } }),
    consents: await prisma.memberLegalConsent.count({ where: { endUserId: id } }) + await prisma.userAiConsent.count({ where: { endUserId: id } }),
  })
  const full = { orders: 1, tasks: 1, ledgers: 1, redemptions: 1, consents: 2 }

  try {
    await check('1 三个配置都不填：什么都不动', async () => {
      const result = await sweep()
      assert.deepEqual(result.audit, { scrubbed: 0, deleted: 0 }); assert.equal(result.consents.deleted, 0); assert.equal(result.orders.orders, 0)
      for (const who of [oldShell, newShell, active, inconsistent]) assert.deepEqual(await counts(who.id), full)
      assert.equal((await prisma.auditLog.findUniqueOrThrow({ where: { id: oldAudit.id } })).ipAddress, '198.51.100.23')
    })

    await check(`4 审计保留天数低于 ${AUDIT_LOG_MIN_RETENTION_DAYS} 或模式写错：拒绝执行，一行不动`, async () => {
      for (const [days, mode] of [['179', 'scrub'], ['30', 'delete'], ['abc', 'scrub'], ['400', 'erase']] as const) {
        process.env['AUDIT_LOG_RETENTION_DAYS'] = days; process.env['AUDIT_LOG_RETENTION_MODE'] = mode
        const result = await sweep()
        assert.ok(result.audit.skipped, `${days}/${mode} 应拒绝`)
        assert.equal(result.audit.scrubbed + result.audit.deleted, 0)
      }
      assert.equal(await prisma.auditLog.count({ where: { id: { in: [oldAudit.id, recentAudit.id, plainOld.id, idCardOld.id] } } }), 4)
      assert.equal((await prisma.auditLog.findUniqueOrThrow({ where: { id: oldAudit.id } })).ipAddress, '198.51.100.23')
    })

    await check('2 审计去标识（缺省模式）：超期行清 IP / 浏览器标识 / 手机号，期内行与无手机号的 payload 不动', async () => {
      process.env['AUDIT_LOG_RETENTION_DAYS'] = '365'; delete process.env['AUDIT_LOG_RETENTION_MODE']
      const result = await sweep()
      assert.equal(result.audit.scrubbed, 1); assert.equal(result.audit.deleted, 0)
      const old = await prisma.auditLog.findUniqueOrThrow({ where: { id: oldAudit.id } })
      assert.equal(old.ipAddress, null); assert.equal(old.userAgent, null)
      assert.ok(!old.payloadJson.includes('138****0614') && !old.payloadJson.includes('13853219907'), old.payloadJson)
      assert.equal(JSON.parse(old.payloadJson).category, 'print'); assert.equal(old.action, 'feedback.view')
      const recent = await prisma.auditLog.findUniqueOrThrow({ where: { id: recentAudit.id } })
      assert.equal(recent.ipAddress, '198.51.100.23'); assert.ok(recent.payloadJson.includes('138****0614'))
      assert.equal((await prisma.auditLog.findUniqueOrThrow({ where: { id: plainOld.id } })).payloadJson, JSON.stringify({ deletedCount: 12 }))
      assert.equal((await sweep()).audit.scrubbed, 0, '处理过的行不应被反复取到')
      assert.equal((await prisma.auditLog.findUniqueOrThrow({ where: { id: idCardOld.id } })).payloadJson, JSON.stringify({ snippet: '3702**********1234' }))
    })

    await check('3 审计整行删除模式：只删超期行', async () => {
      process.env['AUDIT_LOG_RETENTION_MODE'] = 'delete'
      const result = await sweep()
      assert.equal(result.audit.deleted, 3)
      assert.equal(await prisma.auditLog.count({ where: { id: { in: [oldAudit.id, plainOld.id, idCardOld.id] } } }), 0)
      assert.equal(await prisma.auditLog.count({ where: { id: recentAudit.id } }), 1)
      for (const key of ['AUDIT_LOG_RETENTION_DAYS', 'AUDIT_LOG_RETENTION_MODE']) delete process.env[key]
    })

    await check('5 注销保留的同意记录：只删匿名化满 N 年的账号壳；在用账号再老也不删', async () => {
      process.env['CLOSURE_RETAINED_CONSENT_YEARS'] = '5'
      const result = await sweep()
      assert.equal(result.consents.deleted, 2)
      assert.equal((await counts(oldShell.id)).consents, 0)
      assert.equal((await counts(newShell.id)).consents, 2)
      assert.equal((await counts(active.id)).consents, 2)
      assert.equal((await counts(inconsistent.id)).consents, 2, '状态不是已匿名化的账号不能删')
      assert.equal((await counts(oldShell.id)).orders, 1, '只配同意年限时订单不动')
      delete process.env['CLOSURE_RETAINED_CONSENT_YEARS']
    })

    await check('6 注销保留的订单与账务：订单连同明细、支付、退款、打印任务与流水一起删，只删到期的账号壳', async () => {
      process.env['CLOSURE_RETAINED_ORDER_YEARS'] = '5'
      const result = await sweep()
      assert.deepEqual(result.orders, { orders: 1, printTasks: 1, ledgers: 1, redemptions: 1 })
      assert.deepEqual(await counts(oldShell.id), { orders: 0, tasks: 0, ledgers: 0, redemptions: 0, consents: 0 })
      assert.equal(await prisma.orderItem.count({ where: { orderId: oldShell.orderId } }), 0)
      assert.equal(await prisma.paymentAttempt.count({ where: { orderId: oldShell.orderId } }), 0)
      assert.equal(await prisma.refund.count({ where: { orderId: oldShell.orderId } }), 0)
      assert.equal(await prisma.printTaskStatusLog.count({ where: { taskId: oldShell.taskId } }), 0)
      assert.deepEqual(await counts(newShell.id), full)
      assert.deepEqual(await counts(active.id), full)
      assert.deepEqual(await counts(inconsistent.id), full)
      assert.equal(await prisma.endUser.count({ where: { id: oldShell.id } }), 1, '账号壳本身保留')
      assert.equal(result.truncated, false)
      delete process.env['CLOSURE_RETAINED_ORDER_YEARS']
    })

    await check('7 每日任务已注册，有删除时写一条只含条数的系统审计', async () => {
      const moduleSource = readFileSync(resolve(apiRoot, 'src/member-privacy/member-privacy.module.ts'), 'utf8')
      assert.match(moduleSource, /providers:\s*\[[\s\S]*PersonalDataRetentionTask/)
      const taskSource = readFileSync(resolve(apiRoot, 'src/member-privacy/personal-data-retention.ts'), 'utf8')
      assert.match(taskSource, /@Cron\(CronExpression\.EVERY_DAY_AT_3AM\)\s*\n\s*async handleDaily/)
      const writes: Array<Record<string, unknown>> = []
      const task = new PersonalDataRetentionTask(prisma, { write: async (args: Record<string, unknown>) => { writes.push(args); return null } } as never)
      process.env['CLOSURE_RETAINED_CONSENT_YEARS'] = '1'
      const before = await prisma.memberLegalConsent.count({ where: { endUserId: newShell.id } })
      const result = await task.handleDaily()
      delete process.env['CLOSURE_RETAINED_CONSENT_YEARS']
      assert.ok(result && result.consents.deleted === before + 1, '一年前匿名化的壳在一年期限下到期')
      assert.equal(writes.length, 1); assert.equal(writes[0]['action'], 'personal_data.retention_sweep')
      assert.ok(!JSON.stringify(writes[0]).match(/1[3-9]\d{9}/u), '系统审计不含手机号')
    })
  } finally {
    for (const key of RETENTION_ENV) delete process.env[key]
    await prisma.onModuleDestroy()
    rmSync(temporary, { recursive: true, force: true })
  }
  console.log(`verify:personal-data-retention ALL PASS (${cases.length})`)
}

main().catch((error) => { console.error(error); process.exit(1) })
