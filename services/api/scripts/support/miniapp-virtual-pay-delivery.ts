import assert from 'node:assert/strict'
import { createCipheriv, createHash, randomBytes } from 'crypto'
import { encryptPhone, hashPhone } from '../../src/common/crypto/phone-identity'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { VIRTUAL_PAY_DIAGNOSTIC_ACTION } from '../../src/virtual-pay/virtual-pay-order.service'
import {
  VIRTUAL_PAY_CLOSED_RECOVERY_AUDIT_ACTION,
  VIRTUAL_PAY_MESSAGE_AUDIT_ACTION,
} from '../../src/virtual-pay/wechat-miniapp-message.service'

const MEMBER = 'vpay-deliver-member'
const OPEN_ID = 'openid-deliver-member'
const PRODUCT_ID = 'FAKEGOOD1'
const PRICE_CENTS = 80808
const APP_ID = 'wx-verify-appid'
const TOKEN = 'message-token-verify'
const AES_KEY = Buffer.alloc(32, 7).toString('base64').replace(/=+$/, '')

/** 测试自己封包，不调用生产加密函数。算法按核对表 4.13：32 字节块、IV 为密钥前 16 字节。 */
function seal(message: string, appId = APP_ID): string {
  const key = Buffer.from(`${AES_KEY}=`, 'base64')
  const msg = Buffer.from(message, 'utf8')
  const packed = Buffer.concat([
    randomBytes(16),
    Buffer.from([(msg.length >>> 24) & 255, (msg.length >>> 16) & 255, (msg.length >>> 8) & 255, msg.length & 255]),
    msg,
    Buffer.from(appId, 'utf8'),
  ])
  const pad = 32 - (packed.length % 32)
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16))
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(Buffer.concat([packed, Buffer.alloc(pad, pad)])), cipher.final()]).toString('base64')
}

function sha1(parts: string[]): string {
  return createHash('sha1').update([...parts].sort().join(''), 'utf8').digest('hex')
}

function applyMessageEnv(): void {
  process.env['WECHAT_MINIAPP_APPID'] = APP_ID
  process.env['WECHAT_MINIAPP_MESSAGE_TOKEN'] = TOKEN
  process.env['WECHAT_MINIAPP_MESSAGE_ENCODING_AES_KEY'] = AES_KEY
}

export async function assertVirtualPayDelivery(options: { prisma: PrismaService; base: string }): Promise<void> {
  const { prisma, base } = options
  applyMessageEnv()
  await prisma.endUser.create({
    data: {
      id: MEMBER,
      phoneHash: hashPhone('13800138002'),
      phoneEnc: encryptPhone('13800138002'),
      wxOpenId: OPEN_ID,
    },
  })
  const order = await createPending(prisma, 'vpdeliver0001')
  const echostr = 'echo<>&中文'
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = 'nonce-verify'

  const badGet = await fetch(url(base, { signature: '0'.repeat(40), timestamp, nonce, echostr }))
  const badGetText = await badGet.text()
  assert.equal(badGet.status, 401)
  assert.equal((JSON.parse(badGetText) as { error?: { code?: string } }).error?.code, 'VPAY_SIGNATURE_INVALID')
  assert.notEqual(badGetText, echostr)

  const goodGet = await fetch(url(base, { signature: sha1([TOKEN, timestamp, nonce]), timestamp, nonce, echostr }))
  assert.equal(goodGet.status, 200)
  assert.equal(await goodGet.text(), echostr)

  delete process.env['WECHAT_MINIAPP_MESSAGE_TOKEN']
  const missing = await fetch(url(base, { signature: sha1([TOKEN, timestamp, nonce]), timestamp, nonce, echostr }))
  assert.equal(missing.status, 503)
  assert.equal((await readJson(missing)).error?.code, 'VPAY_MESSAGE_CONFIG_MISSING')
  applyMessageEnv()

  const badPost = await post(base, seal(deliverJson(order.outTradeNo)), 'bad-signature')
  assert.equal(badPost.status, 401)
  assert.equal((await readJson(badPost)).error?.code, 'VPAY_SIGNATURE_INVALID')
  assert.equal(await creditCount(prisma, order.id), 0)

  const wrongApp = await post(base, seal(deliverJson(order.outTradeNo), 'wx-other-appid'))
  assert.equal(wrongApp.status, 401)
  assert.equal((await readJson(wrongApp)).error?.code, 'VPAY_APPID_MISMATCH')
  assert.equal(await creditCount(prisma, order.id), 0)

  const amount = await post(base, seal(deliverJson(order.outTradeNo, { ActualPrice: 1 })))
  assert.equal(amount.status, 200)
  assert.equal(await amount.text(), '')
  assert.equal(await creditCount(prisma, order.id), 0)
  assert.equal((await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: order.id } })).status, 'pending')
  assert.equal(await latestReason(prisma), 'amount_mismatch')

  const product = await post(base, seal(deliverJson(order.outTradeNo, { ProductId: 'OTHER_FAKE' })))
  assert.equal(product.status, 200)
  assert.equal(await product.text(), '')
  assert.equal(await creditCount(prisma, order.id), 0)
  assert.equal(await latestReason(prisma), 'product_mismatch')

  const openid = await post(base, seal(deliverJson(order.outTradeNo, { OpenId: 'openid-other' })))
  assert.equal(openid.status, 200)
  assert.equal(await openid.text(), '')
  assert.equal(await creditCount(prisma, order.id), 0)
  assert.equal(await latestReason(prisma), 'openid_mismatch')

  const paid = await post(base, seal(deliverJson(order.outTradeNo)))
  assert.equal(paid.status, 200)
  assert.equal(await paid.text(), '')
  assert.equal(await creditCount(prisma, order.id), 1)
  const paidRow = await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: order.id } })
  assert.equal(paidRow.status, 'paid')
  assert.equal(paidRow.wxOrderId, 'WXFAKEORDER1')
  const credit = await prisma.memberServiceCredit.findUniqueOrThrow({ where: { sourceOrderId: order.id } })
  assert.equal(credit.status, 'available')
  assert.equal(credit.endUserId, MEMBER)
  assert.equal(credit.consumedAt, null)

  const again = await post(base, seal(deliverJson(order.outTradeNo)))
  assert.equal(again.status, 200)
  assert.equal(await again.text(), '')
  assert.equal(await creditCount(prisma, order.id), 1)

  const otherXml = [
    '<xml>',
    '<Event><![CDATA[xpay_refund_notify]]></Event>',
    '<OpenId><![CDATA[openid-should-not-be-stored]]></OpenId>',
    '</xml>',
  ].join('')
  const other = await post(base, seal(otherXml), undefined, 'text/xml')
  assert.equal(other.status, 200)
  assert.equal(await other.text(), '')
  assert.equal(await creditCount(prisma, order.id), 1)
  const messageAudit = await prisma.auditLog.findFirstOrThrow({
    where: { action: VIRTUAL_PAY_MESSAGE_AUDIT_ACTION },
    orderBy: { createdAt: 'desc' },
  })
  assert.deepEqual(JSON.parse(messageAudit.payloadJson), { event: 'xpay_refund_notify' })
  assert.equal(messageAudit.payloadJson.includes('openid-should-not-be-stored'), false)

  const creditsBeforeMissing = await prisma.memberServiceCredit.count()
  const missingOrder = await post(base, seal(deliverJson('vpmissing0001')))
  assert.equal(missingOrder.status, 200)
  assert.equal(await missingOrder.text(), '')
  assert.equal(await prisma.memberServiceCredit.count(), creditsBeforeMissing)
  assert.equal(await latestReason(prisma), 'order_missing')

  // 第 5 条：关单后到账不丢（字段不对仍拒绝；验签且字段全对 → 记 1 条权益 + 审计「关单后到账补记」 + 告警；重复推送仍只 1 条）
  const closedOrder = await prisma.virtualPayOrder.create({
    data: {
      endUserId: MEMBER,
      openId: OPEN_ID,
      serviceKind: 'resume_optimize',
      productId: PRODUCT_ID,
      priceCents: PRICE_CENTS,
      env: 0,
      status: 'closed',
      outTradeNo: 'vpclosedpaid01',
    },
    select: { id: true, outTradeNo: true },
  })
  const closedWrongAmt = await post(base, seal(deliverJson(closedOrder.outTradeNo, { ActualPrice: 1 })))
  assert.equal(closedWrongAmt.status, 200)
  assert.equal(await creditCount(prisma, closedOrder.id), 0, '关单后收到金额不符推送仍不得记权益')
  assert.equal((await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: closedOrder.id } })).status, 'closed')
  assert.equal(await latestReason(prisma), 'amount_mismatch')

  const originalFetch = globalThis.fetch
  const prevWebhook = process.env['ALERT_WEBHOOK_URL']
  let closedAlertHits = 0
  process.env['ALERT_WEBHOOK_URL'] = 'https://alert.local.test/closed-recovery'
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = String(input)
    if (target.startsWith('https://alert.local.test/')) {
      closedAlertHits += 1
      return new Response(JSON.stringify({ errcode: 0 }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input, init)
  }) as typeof fetch
  try {
    const recovered = await post(base, seal(deliverJson(closedOrder.outTradeNo)))
    assert.equal(recovered.status, 200)
    assert.equal(await recovered.text(), '')
    assert.equal(await creditCount(prisma, closedOrder.id), 1, '关单后收到有效已付推送必须补记 1 条权益')
    assert.equal((await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: closedOrder.id } })).status, 'paid')
    const recoveryAudits = await prisma.auditLog.findMany({
      where: { action: VIRTUAL_PAY_CLOSED_RECOVERY_AUDIT_ACTION, targetId: closedOrder.outTradeNo },
    })
    assert.equal(recoveryAudits.length, 1, '关单后补记必须写 1 条审计')
    assert.equal(JSON.parse(recoveryAudits[0]!.payloadJson).summary, '关单后到账补记')
    assert.equal(closedAlertHits, 1, '关单后补记必须触发告警')

    // 重复再推一次：权益仍 1 条、审计仍 1 条、不重复告警
    const recoveredAgain = await post(base, seal(deliverJson(closedOrder.outTradeNo)))
    assert.equal(recoveredAgain.status, 200)
    assert.equal(await creditCount(prisma, closedOrder.id), 1)
    const recoveryAuditsAgain = await prisma.auditLog.findMany({
      where: { action: VIRTUAL_PAY_CLOSED_RECOVERY_AUDIT_ACTION, targetId: closedOrder.outTradeNo },
    })
    assert.equal(recoveryAuditsAgain.length, 1)
    assert.equal(closedAlertHits, 1)
  } finally {
    globalThis.fetch = originalFetch
    if (prevWebhook === undefined) delete process.env['ALERT_WEBHOOK_URL']
    else process.env['ALERT_WEBHOOK_URL'] = prevWebhook
  }

  // 第 6 条：XML 叶子值带空白、以及标签与 CDATA 之间带空白的推送都能正常记权益
  const padXmlOrder = await createPending(prisma, 'vpxmlpad00001')
  const paidTime = Math.floor(Date.now() / 1000)
  const paddedLeafXml = [
    '<xml>',
    '<Event><![CDATA[ xpay_goods_deliver_notify ]]></Event>',
    `<OpenId><![CDATA[ ${OPEN_ID} ]]></OpenId>`,
    `<OutTradeNo><![CDATA[ ${padXmlOrder.outTradeNo} ]]></OutTradeNo>`,
    '<Env>\n  0\n</Env>',
    `<WeChatPayInfo><MchOrderNo><![CDATA[ WXPAD1 ]]></MchOrderNo><PaidTime> ${paidTime} </PaidTime></WeChatPayInfo>`,
    `<GoodsInfo><ProductId><![CDATA[ ${PRODUCT_ID} ]]></ProductId><Quantity>\t1\n</Quantity><ActualPrice> ${PRICE_CENTS} </ActualPrice></GoodsInfo>`,
    '</xml>',
  ].join('\n')
  const padRes = await post(base, seal(paddedLeafXml), undefined, 'text/xml')
  assert.equal(padRes.status, 200)
  assert.equal(await padRes.text(), '')
  assert.equal(await creditCount(prisma, padXmlOrder.id), 1, 'XML 叶子带空白的推送必须正常记权益')
  assert.equal((await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: padXmlOrder.id } })).status, 'paid')

  const cdataGapOrder = await createPending(prisma, 'vpxmlcdata001')
  const cdataGapXml = [
    '<xml>',
    '  <Event>\n    <![CDATA[xpay_goods_deliver_notify]]>\n  </Event>',
    `  <OpenId>\n    <![CDATA[${OPEN_ID}]]>\n  </OpenId>`,
    `  <OutTradeNo>\n    <![CDATA[${cdataGapOrder.outTradeNo}]]>\n  </OutTradeNo>`,
    '  <Env>0</Env>',
    `  <WeChatPayInfo>\n    <MchOrderNo>\n      <![CDATA[WXCDATA1]]>\n    </MchOrderNo>\n    <PaidTime>${paidTime}</PaidTime>\n  </WeChatPayInfo>`,
    `  <GoodsInfo>\n    <ProductId>\n      <![CDATA[${PRODUCT_ID}]]>\n    </ProductId>\n    <Quantity>1</Quantity>\n    <ActualPrice>${PRICE_CENTS}</ActualPrice>\n  </GoodsInfo>`,
    '</xml>',
  ].join('\n')
  const gapEncrypt = seal(cdataGapXml)
  const gapTs = String(Math.floor(Date.now() / 1000))
  const gapNonce = 'nonce-gap'
  const gapSig = sha1([TOKEN, gapTs, gapNonce, gapEncrypt])
  const gapEnvelope = `<xml>\n  <Encrypt>\n    <![CDATA[${gapEncrypt}]]>\n  </Encrypt>\n</xml>`
  const gapRes = await fetch(url(base, { msg_signature: gapSig, timestamp: gapTs, nonce: gapNonce }), {
    method: 'POST',
    headers: { 'content-type': 'text/xml' },
    body: gapEnvelope,
  })
  assert.equal(gapRes.status, 200)
  assert.equal(await gapRes.text(), '')
  assert.equal(await creditCount(prisma, cdataGapOrder.id), 1, '标签与 CDATA 之间带空白的 XML 推送必须正常记权益')
  assert.equal((await prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: cdataGapOrder.id } })).status, 'paid')

  console.log('PASS 发货推送验签解密；重复推送只有一条权益；金额或道具不对不记权益；关单后到账补记并告警；XML 空白容错')
}

export async function assertConcurrentDelivery(options: { prisma: PrismaService; base: string }): Promise<void> {
  applyMessageEnv()
  await options.prisma.endUser.create({
    data: {
      id: 'vpay-race-member',
      phoneHash: hashPhone('13800138003'),
      phoneEnc: encryptPhone('13800138003'),
      wxOpenId: 'openid-race-member',
    },
  })
  const order = await options.prisma.virtualPayOrder.create({
    data: {
      endUserId: 'vpay-race-member',
      openId: 'openid-race-member',
      serviceKind: 'mock_interview',
      productId: PRODUCT_ID,
      priceCents: PRICE_CENTS,
      env: 0,
      status: 'pending',
      outTradeNo: 'vprace0001',
    },
  })
  const encrypt = seal(deliverJson('vprace0001', { OpenId: 'openid-race-member' }))
  const results = await Promise.all(Array.from({ length: 20 }, () => post(options.base, encrypt)))
  for (const result of results) {
    assert.equal(result.status, 200)
    assert.equal(await result.text(), '')
  }
  assert.equal(await options.prisma.memberServiceCredit.count({ where: { sourceOrderId: order.id } }), 1)
  assert.equal((await options.prisma.virtualPayOrder.findUniqueOrThrow({ where: { id: order.id } })).status, 'paid')
  console.log('PASS 并发 20 个同一发货推送只有一条权益')
}

async function createPending(prisma: PrismaService, outTradeNo: string): Promise<{ id: string; outTradeNo: string }> {
  return prisma.virtualPayOrder.create({
    data: {
      endUserId: MEMBER,
      openId: OPEN_ID,
      serviceKind: 'resume_optimize',
      productId: PRODUCT_ID,
      priceCents: PRICE_CENTS,
      env: 0,
      status: 'pending',
      outTradeNo,
    },
    select: { id: true, outTradeNo: true },
  })
}

function deliverJson(outTradeNo: string, extra: { ActualPrice?: number; ProductId?: string; OpenId?: string } = {}): string {
  const paidTime = Math.floor(Date.now() / 1000)
  return JSON.stringify({
    Event: 'xpay_goods_deliver_notify',
    OpenId: extra.OpenId ?? OPEN_ID,
    OutTradeNo: outTradeNo,
    Env: 0,
    WeChatPayInfo: { MchOrderNo: 'WXFAKEORDER1', TransactionId: 'TXFAKE1', PaidTime: paidTime },
    GoodsInfo: {
      ProductId: extra.ProductId ?? PRODUCT_ID,
      Quantity: 1,
      OrigPrice: PRICE_CENTS,
      ActualPrice: extra.ActualPrice ?? PRICE_CENTS,
      Attach: 'resume_optimize',
    },
  })
}

function url(base: string, query: Record<string, string>): string {
  return `${base}/api/v1/wechat/miniapp/message?${new URLSearchParams(query)}`
}

async function post(base: string, encrypt: string, signature?: string, contentType = 'application/json'): Promise<Response> {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = 'nonce-post'
  const msgSignature = signature ?? sha1([TOKEN, timestamp, nonce, encrypt])
  const envelope = contentType.includes('xml')
    ? `<xml><Encrypt><![CDATA[${encrypt}]]></Encrypt></xml>`
    : JSON.stringify({ ToUserName: 'gh_verify', Encrypt: encrypt })
  return fetch(url(base, { msg_signature: msgSignature, timestamp, nonce }), {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: envelope,
  })
}

async function readJson(response: Response): Promise<{ error?: { code?: string } }> {
  return JSON.parse(await response.text()) as { error?: { code?: string } }
}

function creditCount(prisma: PrismaService, orderId: string): Promise<number> {
  return prisma.memberServiceCredit.count({ where: { sourceOrderId: orderId } })
}

async function latestReason(prisma: PrismaService): Promise<string> {
  const row = await prisma.auditLog.findFirstOrThrow({
    where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION },
    orderBy: { createdAt: 'desc' },
  })
  return JSON.parse(row.payloadJson).reason as string
}
