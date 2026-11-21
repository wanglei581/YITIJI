import assert from 'node:assert/strict'
import { createCipheriv, randomBytes } from 'node:crypto'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { VirtualPayCreditRedeemService } from '../../src/virtual-pay/virtual-pay-credit-redeem.service'
import { VirtualPayReconcileService } from '../../src/virtual-pay/virtual-pay-reconcile.service'
import { VirtualPayRefundService } from '../../src/virtual-pay/virtual-pay-refund.service'
import { calcPaySig } from '../../src/virtual-pay/virtual-pay-sign'
import {
  VIRTUAL_PAY_REFUND_ERRCODE_CONSUMED,
  VIRTUAL_PAY_REFUND_ERRCODE_IN_PROGRESS,
  VIRTUAL_PAY_REFUND_FAILED_AUDIT_ACTION,
  VIRTUAL_PAY_REFUND_INITIATED_AUDIT_ACTION,
  VIRTUAL_PAY_REFUND_SUCCEEDED_AUDIT_ACTION,
  VIRTUAL_PAY_REFUND_URI,
} from '../../src/virtual-pay/virtual-pay-xpay-refund'
import { wechatSha1Signature } from '../../src/virtual-pay/wechat-message-crypto'
import { PERSONAL_CHARGE_SETTING_KEY } from '../../src/payment/terminal-charge.contract'

const TEST_APP_ID = 'wx-p2-verify-appid'
const TEST_TOKEN = 'p2-msg-token'
const TEST_AES_KEY = Buffer.alloc(32, 9).toString('base64').replace(/=+$/, '')
const TEST_SANDBOX_KEY = 'p2-sandbox-app-key-secret'

export function configureVirtualPayRefundEnv(): void {
  process.env['WECHAT_MINIAPP_APPID'] = TEST_APP_ID
  process.env['WECHAT_MINIAPP_APPSECRET'] = 'p2-verify-secret'
  process.env['WECHAT_MINIAPP_VPAY_OFFER_ID'] = 'p2-offer-id'
  process.env['WECHAT_MINIAPP_VPAY_ENV'] = '1'
  process.env['WECHAT_MINIAPP_VPAY_SANDBOX_APP_KEY'] = TEST_SANDBOX_KEY
  process.env['WECHAT_MINIAPP_VPAY_APP_KEY'] = 'p2-prod-app-key-secret'
  process.env['WECHAT_MINIAPP_MESSAGE_TOKEN'] = TEST_TOKEN
  process.env['WECHAT_MINIAPP_MESSAGE_ENCODING_AES_KEY'] = TEST_AES_KEY
}

function encryptWechatPayload(plain: string): { body: string; query: string } {
  const aesKey = Buffer.from(`${TEST_AES_KEY}=`, 'base64')
  const iv = aesKey.subarray(0, 16)
  const msgBuf = Buffer.from(plain, 'utf8')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(msgBuf.length, 0)
  const raw = Buffer.concat([randomBytes(16), lenBuf, msgBuf, Buffer.from(TEST_APP_ID, 'utf8')])
  const pad = 32 - (raw.length % 32)
  const padded = Buffer.concat([raw, Buffer.alloc(pad, pad)])
  const cipher = createCipheriv('aes-256-cbc', aesKey, iv)
  cipher.setAutoPadding(false)
  const encrypt = Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64')
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomBytes(6).toString('hex')
  const msgSignature = wechatSha1Signature([TEST_TOKEN, timestamp, nonce, encrypt])
  return {
    body: JSON.stringify({ Encrypt: encrypt }),
    query: `timestamp=${timestamp}&nonce=${nonce}&msg_signature=${msgSignature}`,
  }
}

async function seedOrder(
  prisma: PrismaService,
  overrides: Partial<{
    endUserId: string | null
    openId: string | null
    serviceKind: string
    priceCents: number
    status: string
    paidAt: Date | null
    creditStatus: string | null
    refundOrderId: string | null
  }> = {},
) {
  const outTradeNo = `vp${randomBytes(12).toString('hex')}`
  const order = await prisma.virtualPayOrder.create({
    data: {
      endUserId: overrides.endUserId ?? null,
      openId: overrides.openId === undefined ? `wx-open-${randomBytes(4).toString('hex')}` : overrides.openId,
      serviceKind: overrides.serviceKind ?? 'resume_optimize',
      productId: 'FAKE_GOOD_P2',
      priceCents: overrides.priceCents ?? 200,
      env: 1,
      status: overrides.status ?? 'paid',
      outTradeNo,
      wxOrderId: `wxord_${randomBytes(6).toString('hex')}`,
      paidAt: overrides.paidAt === undefined ? new Date() : overrides.paidAt,
      refundOrderId: overrides.refundOrderId ?? null,
    },
  })
  const creditStatus = overrides.creditStatus === undefined ? 'available' : overrides.creditStatus
  const credit = creditStatus
    ? await prisma.memberServiceCredit.create({
        data: {
          endUserId: overrides.endUserId ?? null,
          serviceKind: order.serviceKind,
          sourceOrderId: order.id,
          status: creditStatus,
        },
      })
    : null
  return { order, credit }
}

function makeFakeFetch(handlers: {
  queryOrder: (reqBody: Record<string, unknown>) => Record<string, unknown>
  refundOrder?: (reqBody: Record<string, unknown>, rawBody: string, url: URL) => Record<string, unknown>
}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    if (url.pathname.includes('/cgi-bin/stable_token')) {
      return new Response(JSON.stringify({ access_token: 'fake-access-token', expires_in: 7200 }), { status: 200 })
    }
    const rawBody = typeof init?.body === 'string' ? init.body : ''
    const parsed = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
    if (url.pathname === '/xpay/query_order') {
      const expectedSig = calcPaySig('/xpay/query_order', rawBody, TEST_SANDBOX_KEY)
      assert.equal(url.searchParams.get('pay_sig'), expectedSig, 'query_order pay_sig 必须签实际 body')
      return new Response(JSON.stringify(handlers.queryOrder(parsed)), { status: 200 })
    }
    if (url.pathname === VIRTUAL_PAY_REFUND_URI) {
      const expectedSig = calcPaySig(VIRTUAL_PAY_REFUND_URI, rawBody, TEST_SANDBOX_KEY)
      assert.equal(url.searchParams.get('pay_sig'), expectedSig, 'refund_order pay_sig 必须签实际 body')
      assert.equal(typeof parsed['refund_reason'], 'string', 'refund_reason 必须为字符串')
      assert.equal(typeof parsed['req_from'], 'string', 'req_from 必须为字符串')
      assert.equal(parsed['req_from'], '2', '商户发起 req_from 必须为字符串 2')
      const res = handlers.refundOrder
        ? handlers.refundOrder(parsed, rawBody, url)
        : { errcode: 0, refund_wx_order_id: 'wx_rfd_default' }
      return new Response(JSON.stringify(res), { status: 200 })
    }
    throw new Error(`Unexpected fetch URL: ${url.toString()}`)
  }) as typeof fetch
}

async function ensureAdminUser(prisma: PrismaService, id: string): Promise<void> {
  await prisma.user.upsert({
    where: { id },
    create: { id, username: `u_${id}`, passwordHash: 'x', name: id, role: 'admin' },
    update: {},
  })
}

export async function assertVirtualPayRefundAndAdmin(deps: {
  prisma: PrismaService
  refunds: VirtualPayRefundService
  reconcile: VirtualPayReconcileService
  redeem: VirtualPayCreditRedeemService
  baseUrl: string
  adminHeaders: Record<string, string>
  partnerHeaders: Record<string, string>
}): Promise<void> {
  const { prisma, refunds, reconcile, redeem, baseUrl, adminHeaders, partnerHeaders } = deps
  configureVirtualPayRefundEnv()

  const member = await prisma.endUser.create({
    data: {
      phoneHash: `p2-rfd-hash-${randomBytes(6).toString('hex')}`,
      phoneEnc: 'enc-rfd',
      wxOpenId: 'wx-open-rfd-owner',
      status: 'active',
      enabled: true,
    },
  })
  const termId = `term-rfd-${randomBytes(4).toString('hex')}`
  await prisma.terminal.create({
    data: {
      id: termId,
      terminalCode: `CODE-${termId.toUpperCase()}`,
      agentToken: `tok-${termId}`,
      deviceFingerprint: `fp-${termId}`,
      userChargeMode: 'user_pays',
    },
  })
  await prisma.terminalServicePrice.create({
    data: { terminalId: termId, serviceKey: 'resume_optimize', unitCents: 200 },
  })
  await ensureAdminUser(prisma, 'admin-1')
  const ksId = `ksess-${termId}`
  await prisma.kioskSession.create({ data: { terminalId: termId, clientSessionId: ksId, expiresAt: new Date(Date.now() + 3_600_000) } })
  await prisma.platformSetting.upsert({
    where: { key: PERSONAL_CHARGE_SETTING_KEY },
    create: { key: PERSONAL_CHARGE_SETTING_KEY, value: 'true' },
    update: { value: 'true' },
  })

  // 1. 发起退款全链：先 query_order 取 left_fee → 锁权益 refunding → 签实际 body 调 /xpay/refund_order → 保持 refunding → 在途拦核销 → xpay_refund_notify 收敛
  const s1 = await seedOrder(prisma, { endUserId: member.id, openId: member.wxOpenId, priceCents: 200 })
  const callSeq: string[] = []
  let capturedRefundBody: Record<string, unknown> | null = null
  const fetchOk = makeFakeFetch({
    queryOrder: () => {
      callSeq.push('query_order')
      return { errcode: 0, order: { status: 4, paid_fee: 200, left_fee: 200, env_type: 2 } }
    },
    refundOrder: (body) => {
      callSeq.push('refund_order')
      capturedRefundBody = body
      return { errcode: 0, refund_order_id: body['refund_order_id'], refund_wx_order_id: 'wxr_accept_001' }
    },
  })
  const afterInit = await refunds.initiateRefund(
    s1.order.id,
    { confirm: true, reason: '用户未用申请退款', operatorId: 'admin-1' },
    { fetchImpl: fetchOk },
  )
  assert.deepEqual(callSeq, ['query_order', 'refund_order'], '发起退款前必须先调 query_order 取 left_fee')
  assert.equal(afterInit.status, 'refunding', 'refund_order 受理成功必须保持 refunding，绝不直接标 refunded')
  assert.equal(afterInit.wxRefundId, 'wxr_accept_001')
  assert.match(afterInit.refundOrderId ?? '', /^vpr[0-9a-f]{24}$/)
  assert.equal(afterInit.credit?.status, 'refunding')
  assert.equal((capturedRefundBody as Record<string, unknown> | null)?.['left_fee'], 200)
  assert.equal((capturedRefundBody as Record<string, unknown> | null)?.['refund_fee'], 200)
  assert.equal(await prisma.auditLog.count({ where: { action: VIRTUAL_PAY_REFUND_INITIATED_AUDIT_ACTION, targetId: s1.order.outTradeNo } }), 1)

  // 在途锁权益防并发核销
  await assert.rejects(
    () => redeem.redeem(termId, member.id, { serviceKey: 'resume_optimize', kioskSessionId: ksId }),
    (err: { getResponse?: () => { error?: { code?: string } } }) =>
      err.getResponse?.().error?.code === 'VPAY_CREDIT_UNAVAILABLE',
  )

  // xpay_refund_notify 金额错不改态
  const badFeeEnc = encryptWechatPayload(JSON.stringify({
    Event: 'xpay_refund_notify',
    MchOrderId: s1.order.outTradeNo,
    WxOrderId: s1.order.wxOrderId,
    MchRefundId: afterInit.refundOrderId,
    WxRefundId: 'wxr_accept_001',
    RefundFee: 199,
    RetCode: 0,
  }))
  const badNotifyRes = await fetch(`${baseUrl}/api/v1/wechat/miniapp/message?${badFeeEnc.query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: badFeeEnc.body,
  })
  assert.equal(badNotifyRes.status, 200)
  assert.equal((await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: s1.order.id } })).status, 'refunding')

  // xpay_refund_notify RetCode === 0 → 订单与权益收敛为 refunded
  const okNotifyEnc = encryptWechatPayload(JSON.stringify({
    Event: 'xpay_refund_notify',
    MchOrderId: s1.order.outTradeNo,
    WxOrderId: s1.order.wxOrderId,
    MchRefundId: afterInit.refundOrderId,
    WxRefundId: 'wxr_final_001',
    RefundFee: 200,
    RetCode: 0,
    RefundFinishTimestamp: Math.floor(Date.now() / 1000),
  }))
  const okNotifyRes = await fetch(`${baseUrl}/api/v1/wechat/miniapp/message?${okNotifyEnc.query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: okNotifyEnc.body,
  })
  assert.equal(okNotifyRes.status, 200)
  assert.equal(await okNotifyRes.text(), '')
  const settled1 = await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: s1.order.id }, include: { credit: true } })
  assert.equal(settled1.status, 'refunded')
  assert.equal(settled1.wxRefundId, 'wxr_final_001')
  assert.ok(settled1.refundedAt)
  assert.equal(settled1.credit?.status, 'refunded')
  assert.ok(settled1.credit?.refundedAt)
  assert.equal(await prisma.auditLog.count({ where: { action: VIRTUAL_PAY_REFUND_SUCCEEDED_AUDIT_ACTION, targetId: s1.order.outTradeNo } }), 1)

  // 2. xpay_refund_notify RetCode !== 0 → refund_failed 且不解锁权益
  const sFailNotify = await seedOrder(prisma, {
    status: 'refunding',
    creditStatus: 'refunding',
    refundOrderId: `vpr${randomBytes(12).toString('hex')}`,
  })
  const failNotifyEnc = encryptWechatPayload(JSON.stringify({
    Event: 'xpay_refund_notify',
    MchOrderId: sFailNotify.order.outTradeNo,
    WxOrderId: sFailNotify.order.wxOrderId,
    MchRefundId: sFailNotify.order.refundOrderId,
    WxRefundId: 'wxr_fail_001',
    RefundFee: 200,
    RetCode: -1,
    RetMsg: 'bank rejected',
  }))
  await fetch(`${baseUrl}/api/v1/wechat/miniapp/message?${failNotifyEnc.query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: failNotifyEnc.body,
  })
  const afterFailNotify = await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: sFailNotify.order.id }, include: { credit: true } })
  assert.equal(afterFailNotify.status, 'refund_failed')
  assert.equal(afterFailNotify.credit?.status, 'refunding', '退款失败绝不能盲目解锁权益回 available')
  assert.equal(await prisma.auditLog.count({ where: { action: VIRTUAL_PAY_REFUND_FAILED_AUDIT_ACTION, targetId: sFailNotify.order.outTradeNo } }), 1)

  // 3. 定时查单收敛（5 继续等、6 收敛 refunded、8 标 refund_failed、单笔抛错不阻断批次）
  const rWait = await seedOrder(prisma, { status: 'refunding', creditStatus: 'refunding', refundOrderId: `vpr${randomBytes(12).toString('hex')}` })
  const rDone = await seedOrder(prisma, { status: 'refunding', creditStatus: 'refunding', refundOrderId: `vpr${randomBytes(12).toString('hex')}` })
  const rErr = await seedOrder(prisma, { status: 'refunding', creditStatus: 'refunding', refundOrderId: `vpr${randomBytes(12).toString('hex')}` })
  const rThrow = await seedOrder(prisma, { status: 'refunding', creditStatus: 'refunding', refundOrderId: `vpr${randomBytes(12).toString('hex')}` })
  const batchFetch = makeFakeFetch({
    queryOrder: (body) => {
      const id = String(body['order_id'])
      if (id === rThrow.order.outTradeNo) throw new Error('network boom')
      if (id === rWait.order.outTradeNo) return { errcode: 0, order: { status: 5, left_fee: 200, env_type: 2 } }
      if (id === rDone.order.outTradeNo) return { errcode: 0, order: { status: 6, left_fee: 0, env_type: 2, wx_refund_id: 'wxr_rec_done' } }
      if (id === rErr.order.outTradeNo) return { errcode: 0, order: { status: 8, left_fee: 200, env_type: 2 } }
      return { errcode: 0, order: { status: 5, left_fee: 200, env_type: 2 } }
    },
  })
  await reconcile.reconcileOnce(new Date(), batchFetch)
  assert.equal((await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: rWait.order.id } })).status, 'refunding')
  const doneRec = await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: rDone.order.id }, include: { credit: true } })
  assert.equal(doneRec.status, 'refunded')
  assert.equal(doneRec.credit?.status, 'refunded')
  assert.equal((await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: rErr.order.id } })).status, 'refund_failed')
  assert.equal((await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: rThrow.order.id } })).status, 'refunding')

  // 4. 各种拦拒：365 天过期、已核销、注销无 openId、268490013、268490014 + 同 refundOrderId 幂等复发
  const old366 = await seedOrder(prisma, { paidAt: new Date(Date.now() - 366 * 24 * 60 * 60 * 1000) })
  await assert.rejects(
    () => refunds.initiateRefund(old366.order.id, { confirm: true, operatorId: 'admin-1' }, { fetchImpl: fetchOk }),
    (err: { getResponse?: () => { error?: { code?: string } } }) => err.getResponse?.().error?.code === 'VPAY_REFUND_WINDOW_EXPIRED',
  )
  const consumed = await seedOrder(prisma, { creditStatus: 'consumed' })
  await assert.rejects(
    () => refunds.initiateRefund(consumed.order.id, { confirm: true, operatorId: 'admin-1' }, { fetchImpl: fetchOk }),
    (err: { getResponse?: () => { error?: { code?: string } } }) => err.getResponse?.().error?.code === 'VPAY_CREDIT_CONSUMED',
  )
  const noOpenId = await seedOrder(prisma, { openId: null })
  await assert.rejects(
    () => refunds.initiateRefund(noOpenId.order.id, { confirm: true, operatorId: 'admin-1' }, { fetchImpl: fetchOk }),
    (err: { getResponse?: () => { error?: { code?: string } } }) => err.getResponse?.().error?.code === 'VPAY_REFUND_OPENID_MISSING',
  )

  // 268490013 → refund_failed 不解锁权益
  const err013 = await seedOrder(prisma)
  const res013 = await refunds.initiateRefund(
    err013.order.id,
    { confirm: true, operatorId: 'admin-1' },
    {
      fetchImpl: makeFakeFetch({
        queryOrder: () => ({ errcode: 0, order: { status: 4, paid_fee: 200, left_fee: 200, env_type: 2 } }),
        refundOrder: () => ({ errcode: VIRTUAL_PAY_REFUND_ERRCODE_CONSUMED, errmsg: 'consumed' }),
      }),
    },
  )
  assert.equal(res013.status, 'refund_failed')
  assert.equal(res013.credit?.status, 'refunding')

  // 268490014 保持 refunding + 保留同 refundOrderId；经 sync 确认未退恢复 paid 后再次发起必须复发同 refundOrderId
  const s014 = await seedOrder(prisma)
  const seenRefundIds: string[] = []
  const first014 = await refunds.initiateRefund(
    s014.order.id,
    { confirm: true, operatorId: 'admin-1' },
    {
      fetchImpl: makeFakeFetch({
        queryOrder: () => ({ errcode: 0, order: { status: 4, paid_fee: 200, left_fee: 200, env_type: 2 } }),
        refundOrder: (body) => {
          seenRefundIds.push(String(body['refund_order_id']))
          return { errcode: VIRTUAL_PAY_REFUND_ERRCODE_IN_PROGRESS, errmsg: 'in progress' }
        },
      }),
    },
  )
  assert.equal(first014.status, 'refunding')
  assert.equal(first014.credit?.status, 'refunding')
  assert.equal(first014.lastDiagnosticReason, 'refund_in_progress_268490014')

  // 同号复发场景：另一单首调网络失败变 refund_failed（持久化 refundOrderId）→ sync 确认微信侧未退恢复 paid → 重发必须同 refundOrderId
  const sRetry = await seedOrder(prisma)
  const retryIds: string[] = []
  const failedAttempt = await refunds.initiateRefund(
    sRetry.order.id,
    { confirm: true, operatorId: 'admin-1' },
    {
      fetchImpl: makeFakeFetch({
        queryOrder: () => ({ errcode: 0, order: { status: 4, paid_fee: 200, left_fee: 200, env_type: 2 } }),
        refundOrder: (body) => {
          retryIds.push(String(body['refund_order_id']))
          throw new Error('timeout')
        },
      }),
    },
  )
  assert.equal(failedAttempt.status, 'refund_failed')
  const syncedBack = await refunds.syncOrder(sRetry.order.id, 'admin-1', {
    fetchImpl: makeFakeFetch({
      queryOrder: () => ({ errcode: 0, order: { status: 4, paid_fee: 200, left_fee: 200, env_type: 2 } }),
    }),
  })
  assert.equal(syncedBack.order.status, 'paid')
  assert.equal(syncedBack.order.credit?.status, 'available')
  assert.equal(syncedBack.order.refundOrderId, failedAttempt.refundOrderId)

  const secondAttempt = await refunds.initiateRefund(
    sRetry.order.id,
    { confirm: true, operatorId: 'admin-1' },
    {
      fetchImpl: makeFakeFetch({
        queryOrder: () => ({ errcode: 0, order: { status: 4, paid_fee: 200, left_fee: 200, env_type: 2 } }),
        refundOrder: (body) => {
          retryIds.push(String(body['refund_order_id']))
          return { errcode: 0, refund_wx_order_id: 'wxr_retry_same_id' }
        },
      }),
    },
  )
  assert.equal(retryIds.length, 2)
  assert.equal(retryIds[0], retryIds[1], '同单重发退款必须复用同一个 refundOrderId 满足 268490014 幂等规则')
  assert.equal(secondAttempt.status, 'refunding')

  // 5. 管理员 HTTP 接口：非 admin 403、confirm!==true 400、零原始 openId 泄露
  const partnerList = await fetch(`${baseUrl}/api/v1/admin/billing/miniapp-virtual-pay/orders`, { headers: partnerHeaders })
  assert.equal(partnerList.status, 403)
  const partnerRefund = await fetch(`${baseUrl}/api/v1/admin/billing/miniapp-virtual-pay/orders/${s1.order.id}/refund`, {
    method: 'POST',
    headers: { ...partnerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  })
  assert.equal(partnerRefund.status, 403)

  const listRes = await fetch(`${baseUrl}/api/v1/admin/billing/miniapp-virtual-pay/orders?status=refunded`, { headers: adminHeaders })
  assert.equal(listRes.status, 200)
  const listRaw = await listRes.text()
  assert.equal(listRaw.includes('wx-open-rfd-owner'), false, '列表绝不能泄露原始 openId')
  const listJson = JSON.parse(listRaw) as { items: Array<{ id: string }>; total: number }
  assert.ok(listJson.total >= 1)

  const detailRes = await fetch(`${baseUrl}/api/v1/admin/billing/miniapp-virtual-pay/orders/${s1.order.id}`, { headers: adminHeaders })
  assert.equal(detailRes.status, 200)
  const detailRaw = await detailRes.text()
  assert.equal(detailRaw.includes('wx-open-rfd-owner'), false, '详情绝不能泄露原始 openId')

  const unconfirmedRefund = await fetch(`${baseUrl}/api/v1/admin/billing/miniapp-virtual-pay/orders/${s1.order.id}/refund`, {
    method: 'POST',
    headers: { ...adminHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: false }),
  })
  assert.equal(unconfirmedRefund.status, 400)
  const unconfirmedJson = (await unconfirmedRefund.json()) as { error?: { code?: string } }
  assert.equal(unconfirmedJson.error?.code, 'VPAY_REFUND_CONFIRM_REQUIRED')

  console.log('PASS P2 官方退款全链、推送收敛、定时查单收敛、365天/注销/已核销/268490014、后台鉴权与零 openId 泄露')
}

/**
 * PostgreSQL 退款发起 vs 一体机核销并发竞态（多轮验证绝不同时成功）。
 */
export async function assertRefundVsRedeemRace(deps: {
  prisma: PrismaService
  refunds: VirtualPayRefundService
  redeem: VirtualPayCreditRedeemService
}): Promise<void> {
  const { prisma, refunds, redeem } = deps
  configureVirtualPayRefundEnv()
  await prisma.platformSetting.upsert({
    where: { key: PERSONAL_CHARGE_SETTING_KEY },
    create: { key: PERSONAL_CHARGE_SETTING_KEY, value: 'true' },
    update: { value: 'true' },
  })
  const termId = `term-race-${randomBytes(4).toString('hex')}`
  await prisma.terminal.create({
    data: {
      id: termId,
      terminalCode: `CODE-${termId.toUpperCase()}`,
      agentToken: `tok-${termId}`,
      deviceFingerprint: `fp-${termId}`,
      userChargeMode: 'user_pays',
    },
  })
  await prisma.terminalServicePrice.create({
    data: { terminalId: termId, serviceKey: 'resume_optimize', unitCents: 200 },
  })
  await ensureAdminUser(prisma, 'admin-1')
  const ksId = `ksess-${termId}`
  await prisma.kioskSession.create({ data: { terminalId: termId, clientSessionId: ksId, expiresAt: new Date(Date.now() + 3_600_000) } })

  await ensureAdminUser(prisma, 'admin-race')
  for (let round = 0; round < 10; round += 1) {
    const member = await prisma.endUser.create({
      data: {
        phoneHash: `p2-race-m-${round}-${randomBytes(4).toString('hex')}`,
        phoneEnc: 'enc-race',
        wxOpenId: `wx-race-${round}-${randomBytes(4).toString('hex')}`,
        status: 'active',
        enabled: true,
      },
    })
    const seeded = await seedOrder(prisma, { endUserId: member.id, openId: member.wxOpenId, priceCents: 200 })
    const fakeFetch = makeFakeFetch({
      queryOrder: () => ({ errcode: 0, order: { status: 4, paid_fee: 200, left_fee: 200, env_type: 2 } }),
      refundOrder: (body) => ({ errcode: 0, refund_order_id: body['refund_order_id'], refund_wx_order_id: `wxr_race_${round}` }),
    })

    const [refundRes, redeemRes] = await Promise.allSettled([
      refunds.initiateRefund(seeded.order.id, { confirm: true, operatorId: 'admin-race' }, { fetchImpl: fakeFetch }),
      redeem.redeem(termId, member.id, { serviceKey: 'resume_optimize', kioskSessionId: ksId }),
    ])
    const refundWon = refundRes.status === 'fulfilled'
    const redeemWon = redeemRes.status === 'fulfilled'
    assert.notEqual(refundWon && redeemWon, true, `第 ${round + 1} 轮：退款与核销绝不能同时成功！`)
    assert.equal(refundWon || redeemWon, true, `第 ${round + 1} 轮：退款与核销应至少有一方成功`)

    const credit = await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: seeded.credit!.id } })
    if (refundWon) {
      assert.equal(credit.status, 'refunding')
      assert.equal(credit.consumedServiceOrderId, null)
    } else {
      assert.equal(credit.status, 'consumed')
      assert.ok(credit.consumedServiceOrderId)
    }
  }
  console.log('PASS PostgreSQL 10 轮退款发起 vs 一体机核销并发竞态：绝不同时成功')
}
