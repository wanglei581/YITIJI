/**
 * 一体机按次付款：生效价大于 0 才建单，开始前占用，没做成退款，子调用不扣每日次数。
 * 临时 SQLite，真实 Nest HTTP。断言按收费口径写，不按当前实现迁就。
 * 并发、价变和少收多退用例在 verify-service-orders-concurrency.ts。
 * 建单到占用、清场到退款两段在同目录的 charge / settle 文件里，仍由本脚本一次跑完。
 */
/**
 * 密钥必须写在任何 import 之前。swc 会把 import 提前。
 */
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-service-orders-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-service-orders-terminal-action-secret-0123456789'
process.env['ADMIN_IP_ALLOWLIST'] = ''
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['NODE_ENV'] = 'test'
process.env['PAYMENT_PROVIDER'] = 'sandbox'
process.env['SANDBOX_PAYMENT_SECRET'] = 'verify-service-orders-sandbox-secret'
process.env['JWT_SECRET'] = 'verify-service-orders-jwt-secret-0123456789'

import assert from 'node:assert/strict'
import { HttpException, HttpStatus } from '@nestjs/common'
import { SERVICE_ORDER_KEYS as SHARED_KEYS, SERVICE_ORDER_NAMES as SHARED_NAMES } from '@ai-job-print/shared'
import { executeResumeCharge } from '../src/ai/quota/ai-resume-charge'
import { chargeComputeResumeOptimize } from '../src/ai/quota/ai-resume-charge-steps'
import type { ResumeChargeBindings } from '../src/ai/quota/ai-resume-charge'
import {
  SERVICE_ORDER_KEYS,
  SERVICE_ORDER_NAMES,
  classifyServiceOutcome,
} from '../src/payment/service-order.policy'
import {
  MEMBER,
  pass,
  withServiceOrderFixture,
} from './support/service-order-verify-fixture'
import { verifyServiceOrderChargeCases } from './verify-service-orders-charge'
import { verifyServiceOrderSettleCases } from './verify-service-orders-settle'

async function main(): Promise<void> {
  assert.deepEqual([...SERVICE_ORDER_KEYS], [...SHARED_KEYS])
  assert.deepEqual(SERVICE_ORDER_NAMES, SHARED_NAMES)
  assert.equal(classifyServiceOutcome('resume_optimize', 'optimize_completed'), 'made')
  assert.equal(classifyServiceOutcome('resume_optimize', 'optimize_failed'), 'not_made')
  assert.equal(classifyServiceOutcome('mock_interview', 'interview_opened'), 'made')
  assert.equal(classifyServiceOutcome('mock_interview', 'interview_not_opened'), 'not_made')
  assert.equal(classifyServiceOutcome('mock_interview', 'interview_followup_failed'), 'made')
  assert.equal(classifyServiceOutcome('scan', 'scan_file_produced'), 'made')
  assert.equal(classifyServiceOutcome('scan', 'scan_no_file'), 'not_made')
  assert.equal(classifyServiceOutcome('resume_optimize', 'layout_failed'), 'layout_only')
  pass('服务单键名与「做没做成」判据和共享类型一致')

  let quotaReserves = 0
  const quota = {
    async reserve() {
      quotaReserves += 1
      throw new HttpException({
        error: { code: 'AI_QUOTA_EXHAUSTED', message: '今天的 AI 次数用完了，明天 0 点恢复' },
      }, HttpStatus.TOO_MANY_REQUESTS)
    },
    async release() {},
    async commit() {},
    async remaining() { return [] },
  }
  const skipped = await executeResumeCharge(quota as never, {
    skipDailyQuota: true,
    endUserId: MEMBER,
    operationKey: 'svc-order-skip',
    work: async () => 'done',
    saveResult: async () => 'ref',
  }, { bucket: 'ai_resume', runWithAiQuota: async () => { throw new Error('不应扣每日次数') } })
  assert.equal(skipped, 'done')
  assert.equal(quotaReserves, 0, '付过的这一趟不应预占每日次数')

  let beforeGenerateCalls = 0
  const cached = await chargeComputeResumeOptimize(
    { providerName: 'rules', load: async () => ({ taskId: 'cached', status: 'completed' }) } as unknown as ResumeChargeBindings,
    'cached',
    { endUserId: null, accessToken: null },
    undefined,
    async () => { throw new Error('缓存不应再生成') },
    undefined,
    async () => { beforeGenerateCalls += 1; return true },
  )
  assert.equal(cached.status, 'completed')
  assert.equal(beforeGenerateCalls, 0, '缓存命中不能占用付款单')
  const noReport = await chargeComputeResumeOptimize(
    {
      providerName: 'rules',
      load: async (_taskId: string, kind: string) => kind === 'parse'
        ? { taskId: 'noreport', status: 'failed', report: null }
        : null,
    } as unknown as ResumeChargeBindings,
    'noreport',
    { endUserId: null, accessToken: null },
    undefined,
    async () => { throw new Error('诊断失败不应再生成') },
    undefined,
    async () => { beforeGenerateCalls += 1; return true },
  )
  assert.equal(noReport.status, 'failed')
  assert.equal(beforeGenerateCalls, 0, '诊断没成功不能收这一次的钱')
  let n8Extracts = 0
  let n8Thrown = 0
  await assert.rejects(
    () => chargeComputeResumeOptimize(
      {
        providerName: 'llm',
        load: async (_taskId: string, kind: string) => kind === 'parse'
          ? { taskId: 'n8', status: 'completed', report: { score: 1 }, fileId: 'file-n8' }
          : null,
        extract: async () => { n8Extracts += 1; return { ok: true, text: '原文' } },
        log: { optimizeThrown() { n8Thrown += 1 } },
      } as unknown as ResumeChargeBindings,
      'n8',
      { endUserId: null, accessToken: null },
      undefined,
      async () => { throw new Error('不应生成') },
      undefined,
      async () => {
        throw new HttpException({ error: { code: 'SERVICE_PAYMENT_REQUIRED', message: '请先付款' } }, HttpStatus.PAYMENT_REQUIRED)
      },
    ),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 402,
  )
  assert.equal(n8Extracts, 0, '要付款时不能先抽原文')
  assert.equal(n8Thrown, 0, '要付款不能记成一次 AI 失败')
  pass('缓存和诊断失败都不占用付款单；要付款不记 AI 失败')
  await withServiceOrderFixture(async (fx) => {
    const consumedOrderId = await verifyServiceOrderChargeCases(fx)
    await verifyServiceOrderSettleCases(fx, consumedOrderId)
  })
  pass('服务单收钱、占用、退款和后台查看')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
