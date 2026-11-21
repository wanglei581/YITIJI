/**
 * 一体机服务次数与微信小程序虚拟支付（pages/service-credits + utils/virtual-pay-model + utils/api-virtual-pay）单测。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))
const vpayModel = requireMiniapp('./virtual-pay-model.js')
const userError = requireMiniapp('./user-error.js')

function makeAuth(userId) {
  let current = userId
  let gen = 1
  return {
    setUser(nextId) { current = nextId; gen += 1 },
    logout() { current = ''; gen += 1 },
    isLoggedIn: () => Boolean(current),
    getUser: () => (current ? { id: current, nickname: '测试用户' } : null),
    sessionGeneration: () => gen,
    canSilentResignin: () => false,
  }
}

test('可用服务次数汇总：按服务种类统计并保留购买时间，空态诚实返回 0', () => {
  const empty = vpayModel.summarizeCredits({ items: [] })
  assert.equal(empty.total, 0)
  assert.equal(empty.counts.resume_optimize, 0)
  assert.equal(empty.counts.mock_interview, 0)

  const res = vpayModel.summarizeCredits({
    items: [
      { serviceKind: 'resume_optimize', createdAt: '2026-11-21T08:00:00.000Z' },
      { serviceKind: 'mock_interview', createdAt: '2026-11-20T09:15:00.000Z' },
      { serviceKind: 'resume_optimize', createdAt: '2026-11-19T10:30:00.000Z' },
    ],
  })
  assert.equal(res.total, 3)
  assert.equal(res.counts.resume_optimize, 2)
  assert.equal(res.counts.mock_interview, 1)
  assert.equal(res.summary.length, 2)
  assert.equal(res.records.length, 3)
  assert.equal(res.records[0].title, 'AI 简历优化')
  assert.match(res.records[0].createdAtText, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
})

test('buyServiceCredit：严格先 wx.login 再下单、原样逐字节透传 signData、mode=short_series_goods、轮询查服务端确认', async () => {
  // 故意构造非规范空格与键序的 signData：任何 JSON.parse + JSON.stringify 都会破坏字节一致性！
  const rawSignData = '{  "attach" : "resume_optimize" ,  "buyQuantity":1, "outTradeNo" : "vp_order_001" , "env": 0  }'
  const events = []
  let loginSeq = 0
  const capturedPayCalls = []
  let pollCalls = 0
  const sleepDelays = []

  const wxObj = {
    login({ success }) {
      loginSeq += 1
      events.push(`wx.login#${loginSeq}`)
      success({ code: `fresh-code-${loginSeq}` })
    },
    requestVirtualPayment(opts) {
      events.push('wx.requestVirtualPayment')
      capturedPayCalls.push(opts)
      assert.equal(typeof opts.success, 'function', '必须用回调写法 success（§1.21 不支持 Promise）')
      assert.equal(typeof opts.fail, 'function', '必须用回调写法 fail')
      opts.success({ errMsg: 'requestVirtualPayment:ok' })
    },
  }

  const api = {
    createVirtualPayOrder({ serviceKind, code }) {
      events.push(`createOrder:${serviceKind}:${code}`)
      return Promise.resolve({
        outTradeNo: 'vp_order_001',
        signData: rawSignData,
        paySig: 'pay-sig-hex',
        signature: 'user-sig-hex',
        mode: 'short_series_goods',
      })
    },
    listServiceCredits() {
      pollCalls += 1
      events.push(`listCredits#${pollCalls}`)
      if (pollCalls === 1) {
        return Promise.resolve({ items: [] })
      }
      return Promise.resolve({
        items: [{ serviceKind: 'resume_optimize', createdAt: '2026-11-21T09:00:00.000Z' }],
      })
    },
  }

  const statuses = []
  const result = await vpayModel.buyServiceCredit({
    serviceKind: 'resume_optimize',
    baselineCounts: { resume_optimize: 0, mock_interview: 0 },
    wxObj,
    api,
    onStatus: (s) => statuses.push(s),
    sleep: (ms) => { sleepDelays.push(ms); return Promise.resolve() },
    maxPolls: 5,
    pollIntervalMs: 2000,
  })

  assert.equal(result.status, 'confirmed')
  assert.equal(result.attempts, 2)
  assert.equal(result.credits.counts.resume_optimize, 1)
  assert.equal(statuses[0].phase, 'confirming')
  assert.match(statuses[0].message, /支付结果确认中/)
  assert.deepEqual(events, [
    'wx.login#1',
    'createOrder:resume_optimize:fresh-code-1',
    'wx.requestVirtualPayment',
    'listCredits#1',
    'listCredits#2',
  ])
  assert.deepEqual(sleepDelays, [2000])
  assert.equal(capturedPayCalls.length, 1)
  assert.strictEqual(capturedPayCalls[0].signData, rawSignData, 'signData 必须原样逐字节透传，绝不可重序列化')
  assert.equal(capturedPayCalls[0].mode, 'short_series_goods')
  assert.equal(capturedPayCalls[0].paySig, 'pay-sig-hex')
  assert.equal(capturedPayCalls[0].signature, 'user-sig-hex')

  // 第二次购买必须再次调 wx.login 拿新 code，不复用旧 code
  pollCalls = 0
  await vpayModel.buyServiceCredit({
    serviceKind: 'mock_interview',
    baselineCounts: { resume_optimize: 1, mock_interview: 0 },
    wxObj,
    api,
    sleep: () => Promise.resolve(),
    maxPolls: 2,
    pollIntervalMs: 10,
  })
  assert.equal(loginSeq, 2, '每次下单都必须重新调 wx.login')
})

test('buyServiceCredit：支付成功但服务端 5 次查单仍未到账时绝不伪造本地权益', async () => {
  let polls = 0
  const result = await vpayModel.buyServiceCredit({
    serviceKind: 'mock_interview',
    baselineCounts: { resume_optimize: 0, mock_interview: 1 },
    wxObj: {
      login({ success }) { success({ code: 'code-1' }) },
      requestVirtualPayment({ success }) { success({}) },
    },
    api: {
      createVirtualPayOrder: () => Promise.resolve({
        outTradeNo: 'vp2',
        signData: '{"outTradeNo":"vp2"}',
        paySig: 'p',
        signature: 's',
        mode: 'short_series_goods',
      }),
      listServiceCredits: () => {
        polls += 1
        return Promise.resolve({
          items: [{ serviceKind: 'mock_interview', createdAt: '2026-11-20T00:00:00.000Z' }],
        })
      },
    },
    sleep: () => Promise.resolve(),
    maxPolls: 5,
    pollIntervalMs: 2000,
  })

  assert.equal(polls, 5, '最多轮询 5 次')
  assert.equal(result.status, 'pending_confirm')
  assert.equal(result.credits.counts.mock_interview, 1, '绝不本地伪造 +1，必须保持服务端真实数量')
})

test('基础库不支持 wx.requestVirtualPayment 时诚实降级，零外部付款引导', async () => {
  let loginCalled = 0
  let orderCalled = 0
  const res = await vpayModel.buyServiceCredit({
    serviceKind: 'resume_optimize',
    wxObj: {
      login() { loginCalled += 1 },
    },
    api: {
      createVirtualPayOrder() { orderCalled += 1; return Promise.resolve({}) },
      listServiceCredits: () => Promise.resolve({ items: [] }),
    },
  })
  assert.equal(res.status, 'unsupported')
  assert.equal(loginCalled, 0)
  assert.equal(orderCalled, 0)
  assert.match(res.message, /升级微信/)
  assert.doesNotMatch(res.message, /H5|外部|网页|App|网站|浏览器/i)
})

test('虚拟支付错误码全量映射与开关关闭诚实文案、fail 回调区分取消与错误码', async () => {
  for (const code of ['VPAY_DISABLED', 'VPAY_GOODS_UNCONFIGURED', 'VPAY_CONFIG_MISSING', 'VPAY_SANDBOX_FORBIDDEN']) {
    const shown = userError.userMessageOf({ code, message: code }, '兜底')
    assert.equal(shown, '当前暂未开放手机端购买，请在一体机现场按屏上提示使用', `${code} 必须展示诚实关闭文案`)

    const res = await vpayModel.buyServiceCredit({
      serviceKind: 'resume_optimize',
      wxObj: {
        login({ success }) { success({ code: 'c1' }) },
        requestVirtualPayment() {},
      },
      api: {
        createVirtualPayOrder: () => Promise.reject(Object.assign(new Error(shown), { code })),
        listServiceCredits: () => Promise.resolve({ items: [] }),
      },
    })
    assert.equal(res.status, 'unavailable')
    assert.equal(res.message, '当前暂未开放手机端购买，请在一体机现场按屏上提示使用')
  }

  for (const [code, serverMessage] of [
    ['VPAY_OPENID_MISMATCH', 'VPAY_OPENID_MISMATCH'],
    ['VPAY_SERVICE_KIND_INVALID', 'VPAY_SERVICE_KIND_INVALID'],
    ['WX_CODE_INVALID', '微信登录凭证无效或已过期，请重试'],
    ['WX_CODE2SESSION_FAILED', '微信登录服务异常，请稍后再试'],
  ]) {
    const shown = userError.userMessageOf({ code, message: serverMessage }, '兜底')
    assert.ok(shown && shown !== '兜底', `${code} 必须有专属中文提示`)
    assert.doesNotMatch(shown, /^[A-Z0-9_]+$/)
  }

  assert.equal(vpayModel.classifyVirtualPayFail({ errCode: -2, errMsg: 'requestVirtualPayment:fail cancel' }).outcome, 'cancelled')
  assert.equal(vpayModel.classifyVirtualPayFail({ errCode: -15002 }).outcome, 'retry_reorder')
  assert.equal(vpayModel.classifyVirtualPayFail({ errCode: -15012 }).outcome, 'retry_reorder')
  assert.equal(vpayModel.classifyVirtualPayFail({ errCode: -15007 }).outcome, 'retry_session')
  const unknown = vpayModel.classifyVirtualPayFail({ errCode: -99999, errMsg: 'raw stack internal_secret_trace' })
  assert.equal(unknown.outcome, 'failed')
  assert.doesNotMatch(unknown.message, /99999|stack|internal_secret_trace/)
})

test('页面行为：开关关时已购次数照常展示、切换用户或退出作废旧请求代次', async () => {
  const auth = makeAuth('user-A')
  const orderDeferred = deferred()
  const wx = {
    login({ success }) { success({ code: 'fresh-code' }) },
    requestVirtualPayment({ success }) { success({}) },
    stopPullDownRefresh() {},
    navigateTo() {},
    navigateBack() {},
    switchTab() {},
  }
  const vpayApi = {
    listServiceCredits: () => Promise.resolve({
      items: [{ serviceKind: 'resume_optimize', createdAt: '2026-11-21T06:00:00.000Z' }],
    }),
    createVirtualPayOrder: () => orderDeferred.promise,
  }

  const page = instantiate(loadPageDefinition('pages/service-credits/service-credits.js', {
    wx,
    modules: { auth, 'api-virtual-pay': vpayApi },
  }))
  page.onLoad()
  page.onShow()
  await flush()

  assert.equal(page.data.totalCount, 1)
  assert.equal(page.data.copy.usageNotice, '在收费的职易达一体机上登录同一账号，进入对应服务时可直接使用，不用再次扫码付款。')

  // 发起购买，在下单在途期间切换用户 → 旧购买代次立即作废
  const buyPromise = page.tapBuy({ currentTarget: { dataset: { kind: 'resume_optimize' } } })
  await flush()
  assert.equal(page.data.buyingKind, 'resume_optimize')

  auth.setUser('user-B')
  orderDeferred.resolve({
    outTradeNo: 'vp-stale',
    signData: '{"outTradeNo":"vp-stale"}',
    paySig: 'p',
    signature: 's',
    mode: 'short_series_goods',
  })
  const staleRes = await buyPromise
  await flush()
  assert.equal(staleRes.status, 'stale', '切换用户后在途下单必须作废')
  assert.equal(page.data.buyingKind, '', '切换用户后不得残留购买中状态')

  // 再次以 user-B 触发 VPAY_DISABLED：诚实切换为不可购买态，不崩溃、不放死按钮
  const vpayApiDisabled = {
    listServiceCredits: () => Promise.resolve({ items: [] }),
    createVirtualPayOrder: () => Promise.reject(Object.assign(new Error('小程序虚拟支付未开放'), { code: 'VPAY_DISABLED' })),
  }
  const page2 = instantiate(loadPageDefinition('pages/service-credits/service-credits.js', {
    wx,
    modules: { auth: makeAuth('user-B'), 'api-virtual-pay': vpayApiDisabled },
  }))
  page2.onLoad()
  page2.onShow()
  await flush()
  await page2.tapBuy({ currentTarget: { dataset: { kind: 'mock_interview' } } })
  await flush()
  assert.equal(page2.data.purchaseUnavailable, true)
  assert.equal(page2.data.purchaseUnavailableText, '当前暂未开放手机端购买，请在一体机现场按屏上提示使用')
})

test('合规与入口静态守卫：零硬编码价格/道具 ID、零外部付款引导、me 入口对齐', () => {
  for (const rel of [
    'pages/service-credits/service-credits.js',
    'pages/service-credits/service-credits.wxml',
    'utils/virtual-pay-model.js',
    'utils/api-virtual-pay.js',
  ]) {
    const src = fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(noComments, /¥\s*\d|￥\s*\d/, `${rel} 严禁硬编码真实价格`)
    assert.doesNotMatch(noComments, /去\s*H5|打开浏览器|外部网站|下载\s*App|公众号付款/i, `${rel} 严禁引导外部付款`)
    assert.doesNotMatch(noComments, /JSON\.parse\s*\(\s*signData/, `${rel} 严禁解析重序列化 signData`)
  }

  const navigated = []
  const me = instantiate(loadPageDefinition('pages/me/me.js', {
    wx: { navigateTo(o) { navigated.push(o.url) } },
    modules: { auth: makeAuth('u1'), api: {} },
  }))
  me.tapEntry({ currentTarget: { dataset: { id: 'credits' } } })
  assert.equal(navigated[0], '/pages/service-credits/service-credits')
})
