/**
 * 自助开票中心（pages/invoice-center + utils/invoice-model + utils/api-invoice）单元测试与页面沙箱回归。
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
const invoiceModel = requireMiniapp('./invoice-model.js')
const userError = requireMiniapp('./user-error.js')

const VALID_USCC = '91000000000000001N'

function makeWxSpy(overrides = {}) {
  const storageWrites = []
  const toasts = []
  const navigated = []
  const wx = {
    setStorageSync(k, v) { storageWrites.push({ api: 'setStorageSync', k, v }) },
    setStorage(o) { storageWrites.push({ api: 'setStorage', o }) },
    getStorageSync: () => '',
    removeStorageSync() {},
    showToast(o) { toasts.push(o) },
    showModal() {},
    stopPullDownRefresh() {},
    navigateTo(o) { navigated.push(o.url) },
    navigateBack() {},
    switchTab() {},
    ...overrides,
  }
  return { wx, storageWrites, toasts, navigated }
}

function makeAuth(userId) {
  let current = userId
  let gen = 1
  return {
    setUser(nextId) { current = nextId; gen += 1 },
    isLoggedIn: () => Boolean(current),
    getUser: () => (current ? { id: current, nickname: '测试用户' } : null),
    sessionGeneration: () => gen,
    canSilentResignin: () => false,
  }
}

test('开票表单校验：个人抬头不带 taxId、拒绝填税号；单位校验 18 位统一社会信用代码与邮箱', () => {
  const personalOk = invoiceModel.validateInvoiceForm({
    orderKind: 'print',
    orderId: 'ord-100',
    titleType: 'personal',
    title: ' 张三 ',
    taxId: '',
    email: ' zhang@example.com ',
  })
  assert.equal(personalOk.ok, true)
  assert.equal(personalOk.payload.title, '张三')
  assert.equal(personalOk.payload.email, 'zhang@example.com')
  assert.equal('taxId' in personalOk.payload, false, '个人抬头请求体不得携带 taxId')

  const personalWithTax = invoiceModel.validateInvoiceForm({
    orderKind: 'print',
    orderId: 'ord-100',
    titleType: 'personal',
    title: '张三',
    taxId: VALID_USCC,
    email: 'zhang@example.com',
  })
  assert.equal(personalWithTax.ok, false)
  assert.equal(personalWithTax.field, 'taxId')
  assert.match(personalWithTax.message, /个人不用填税号/)

  const companyOk = invoiceModel.validateInvoiceForm({
    orderKind: 'service',
    orderId: 'svc-200',
    titleType: 'company',
    title: '测试科技有限公司',
    taxId: VALID_USCC.toLowerCase(),
    email: 'finance@example.com',
  })
  assert.equal(companyOk.ok, true)
  assert.equal(companyOk.payload.taxId, VALID_USCC, '单位税号自动规范为大写')

  for (const badTax of ['', '910000000000001', '91000000000000001', '91000000000000001000', '910000000000000010', '9100000000000000IN']) {
    const res = invoiceModel.validateInvoiceForm({
      orderKind: 'print',
      orderId: 'ord-100',
      titleType: 'company',
      title: '测试公司',
      taxId: badTax,
      email: 'finance@example.com',
    })
    assert.equal(res.ok, false, `非法税号「${badTax}」必须被拦截`)
    assert.equal(res.field, 'taxId')
  }

  for (const badEmail of ['', 'not-an-email', 'a@b', `${'a'.repeat(115)}@example.com`]) {
    const res = invoiceModel.validateInvoiceForm({
      orderKind: 'print',
      orderId: 'ord-100',
      titleType: 'personal',
      title: '张三',
      taxId: '',
      email: badEmail,
    })
    assert.equal(res.ok, false, `非法邮箱「${badEmail}」必须被拦截`)
    assert.equal(res.field, 'email')
  }

  const longTitle = invoiceModel.validateInvoiceForm({
    orderKind: 'print',
    orderId: 'ord-100',
    titleType: 'personal',
    title: '甲'.repeat(81),
    taxId: '',
    email: 'ok@example.com',
  })
  assert.equal(longTitle.ok, false)
  assert.equal(longTitle.field, 'title')
})

test('订单列表与申请详情序列化：仅消费服务端打码 taxIdMasked / emailMasked，退回可重提', () => {
  const orderRow = invoiceModel.toInvoiceOrderView({
    orderKind: 'service',
    orderId: 'svc-1',
    amountCents: 1500,
    canRequest: true,
    blockCode: null,
    blockMessage: '',
    invoiceStatus: 'returned',
    requestId: 'req-9',
  })
  assert.equal(orderRow.orderKindLabel, 'AI 服务单')
  assert.equal(orderRow.amountText, '¥15.00')
  assert.equal(orderRow.statusLabel, '已退回')
  assert.equal(orderRow.canViewDetail, true)
  assert.equal(orderRow.requestButtonLabel, '重新申请开票')

  const detail = invoiceModel.toInvoiceRequestDetailView({
    id: 'req-9',
    orderKind: 'service',
    orderId: 'svc-1',
    titleType: 'company',
    title: '测试单位',
    taxIdMasked: '9100**********001N',
    emailMasked: 'f***@example.com',
    amountCents: 1500,
    status: 'returned',
    issuedAt: null,
    invoiceNo: null,
    returnReason: '抬头与付款方不一致',
    createdAt: '2026-11-20T08:30:00.000Z',
  })
  assert.equal(detail.taxIdMasked, '9100**********001N')
  assert.equal(detail.emailMasked, 'f***@example.com')
  assert.equal('taxId' in detail, false)
  assert.equal('email' in detail, false)
  assert.equal(detail.canResubmit, true)
  assert.equal(detail.returnReason, '抬头与付款方不一致')
  assert.match(detail.createdAtText, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
})

test('开票错误码映射：409 / 404 / 403 / 401 均收敛为中文，不外泄机器码', () => {
  const notAllowed = userError.userMessageOf(
    { code: 'INVOICE_NOT_ALLOWED', message: '已退款的单，开不了发票。', statusCode: 409 },
    '兜底句',
  )
  assert.equal(notAllowed, '已退款的单，开不了发票。')

  const notAllowedMachine = invoiceModel.describeInvoiceError(
    { code: 'INVOICE_NOT_ALLOWED', message: 'INVOICE_NOT_ALLOWED', statusCode: 409 },
    '兜底句',
  )
  assert.equal(notAllowedMachine, '这一单当前不能申请开票')

  const already = userError.userMessageOf(
    { code: 'INVOICE_ALREADY_REQUESTED', message: 'INVOICE_ALREADY_REQUESTED', statusCode: 409 },
    '兜底句',
  )
  assert.equal(already, '这一单已经提交过开票申请')

  const notFound = userError.userMessageOf(
    { code: 'INVOICE_REQUEST_NOT_FOUND', message: 'INVOICE_REQUEST_NOT_FOUND', statusCode: 404 },
    '兜底句',
  )
  assert.equal(notFound, '没有找到这份开票申请')

  const acct = invoiceModel.describeInvoiceError(
    { code: 'ACCOUNT_UNAVAILABLE', message: 'ACCOUNT_UNAVAILABLE', statusCode: 403 },
    '兜底句',
  )
  assert.equal(acct, '当前账号暂不可用，请确认账号状态后再试')
  assert.doesNotMatch(acct, /^[A-Z0-9_]+$/)
})

test('页面行为：提交成功与离页（onHide / onUnload）立即清空表单且零 storage 写入', async () => {
  const { wx, storageWrites, toasts } = makeWxSpy()
  const auth = makeAuth('user-A')
  const submittedPayloads = []
  let listCalls = 0
  const invoiceApi = {
    listInvoiceOrders: () => {
      listCalls += 1
      return Promise.resolve({
        items: [{
          orderKind: 'print',
          orderId: 'ord-paid-1',
          amountCents: 600,
          canRequest: listCalls === 1,
          blockCode: listCalls === 1 ? null : 'already_requested',
          blockMessage: listCalls === 1 ? '' : '这一单已经提交过开票申请。',
          invoiceStatus: listCalls === 1 ? 'none' : 'submitted',
          requestId: listCalls === 1 ? null : 'inv-req-1',
        }],
        nextCursor: null,
      })
    },
    submitInvoiceRequest: (payload) => {
      submittedPayloads.push(payload)
      return Promise.resolve({
        id: 'inv-req-1',
        orderKind: payload.orderKind,
        orderId: payload.orderId,
        status: 'submitted',
        amountCents: 600,
      })
    },
    getInvoiceRequest: (id) => Promise.resolve({
      id,
      orderKind: 'print',
      orderId: 'ord-paid-1',
      titleType: 'company',
      title: '测试企业',
      taxIdMasked: '9100**********001N',
      emailMasked: 'a***@example.com',
      amountCents: 600,
      status: 'submitted',
      issuedAt: null,
      invoiceNo: null,
      returnReason: null,
      createdAt: '2026-11-21T08:00:00.000Z',
    }),
  }

  const page = instantiate(loadPageDefinition('pages/invoice-center/invoice-center.js', {
    wx,
    modules: { auth, 'api-invoice': invoiceApi },
  }))
  page.onLoad({ orderKind: 'print', orderId: 'ord-paid-1' })
  page.onShow()
  await flush()

  assert.equal(page.data.orders.length, 1)
  assert.equal(page.data.selectedOrder.orderId, 'ord-paid-1', '带参进入应自动预选可开票订单')

  page.selectTitleType({ currentTarget: { dataset: { type: 'company' } } })
  page.onFormInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '测试企业' } })
  page.onFormInput({ currentTarget: { dataset: { field: 'taxId' } }, detail: { value: VALID_USCC } })
  page.onFormInput({ currentTarget: { dataset: { field: 'email' } }, detail: { value: 'acct@example.com' } })

  // 先测 onHide 清空
  page.onHide()
  assert.equal(page.data.form.taxId, '', 'onHide 必须清空税号')
  assert.equal(page.data.form.email, '', 'onHide 必须清空邮箱')
  assert.equal(page.data.selectedOrder, null, 'onHide 必须收起表单')
  assert.equal(storageWrites.length, 0, '严禁将税号或邮箱写入本地 storage')

  // 重新打开并真正提交
  listCalls = 0
  page.onShow()
  await flush()
  page.openForm({ currentTarget: { dataset: { key: 'print:ord-paid-1' } } })
  page.selectTitleType({ currentTarget: { dataset: { type: 'company' } } })
  page.onFormInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '测试企业' } })
  page.onFormInput({ currentTarget: { dataset: { field: 'taxId' } }, detail: { value: VALID_USCC } })
  page.onFormInput({ currentTarget: { dataset: { field: 'email' } }, detail: { value: 'acct@example.com' } })
  page.submitForm()
  await flush()

  assert.equal(submittedPayloads.length, 1)
  assert.equal(submittedPayloads[0].taxId, VALID_USCC)
  assert.equal(page.data.form.taxId, '', '提交成功后必须立清内存税号')
  assert.equal(page.data.form.email, '', '提交成功后必须立清内存邮箱')
  assert.equal(page.data.selectedOrder, null)
  assert.equal(page.data.detail.taxIdMasked, '9100**********001N')
  assert.equal(page.data.detail.emailMasked, 'a***@example.com')
  assert.equal(toasts.length, 1)
  assert.equal(storageWrites.length, 0, '全程不得调用 wx.setStorageSync / wx.setStorage')

  // onUnload 清理内存引用
  page.onUnload()
  assert.equal(page.data.form.taxId, '')
  assert.equal(page.data.detail, null)
  assert.equal(page.data.orders.length, 0)
})

test('页面行为：空态诚实文案、翻页游标、切换账号作废在途请求', async () => {
  const { wx } = makeWxSpy()
  const auth = makeAuth('user-A')
  const slowPage = deferred()
  let call = 0
  const invoiceApi = {
    listInvoiceOrders: ({ cursor }) => {
      call += 1
      if (call === 1) return Promise.resolve({ items: [], nextCursor: null })
      if (call === 2) {
        return Promise.resolve({
          items: [{ orderKind: 'print', orderId: 'o1', amountCents: 100, canRequest: true, invoiceStatus: 'none', requestId: null }],
          nextCursor: 'cur-2',
        })
      }
      if (cursor === 'cur-2') return slowPage.promise
      return Promise.resolve({ items: [], nextCursor: null })
    },
    submitInvoiceRequest: () => Promise.resolve({}),
    getInvoiceRequest: () => Promise.resolve({}),
  }

  const page = instantiate(loadPageDefinition('pages/invoice-center/invoice-center.js', {
    wx,
    modules: { auth, 'api-invoice': invoiceApi },
  }))
  page.onLoad({})
  page.onShow()
  await flush()
  assert.equal(page.data.orders.length, 0)
  assert.equal(page.data.copy.emptyDesc, '目前没有需要开发票的付费订单。免费订单或已退款订单不能开票。')

  // 第二次刷出一条带游标，再翻页中途切换账号
  page.retryLoad()
  await flush()
  assert.equal(page.data.orders.length, 1)
  assert.equal(page.data.nextCursor, 'cur-2')

  page.loadMore()
  auth.setUser('user-B')
  slowPage.resolve({
    items: [{ orderKind: 'print', orderId: 'o-stale-A', amountCents: 200, canRequest: true, invoiceStatus: 'none', requestId: null }],
    nextCursor: null,
  })
  await flush()
  assert.equal(page.data.orders.length, 0, '切换账号后 A 的数据必须被清空且迟到分页不得写入')
})

test('隐私静态守卫与入口接线：零 setStorage 写入、me 与 orders 入口齐全', () => {
  for (const rel of [
    'pages/invoice-center/invoice-center.js',
    'utils/invoice-model.js',
    'utils/api-invoice.js',
  ]) {
    const src = fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(noComments, /\bsetStorage(?:Sync)?\b/, `${rel} 严禁调用 setStorage/setStorageSync 持久化开票信息`)
    assert.doesNotMatch(noComments, /\/k\/i\//, `${rel} 不得硬编码一体机开票码路径 /k/i/`)
  }

  const { wx, navigated } = makeWxSpy()
  const me = instantiate(loadPageDefinition('pages/me/me.js', {
    wx,
    modules: { auth: makeAuth('u1'), api: {} },
  }))
  me.tapEntry({ currentTarget: { dataset: { id: 'invoice' } } })
  assert.equal(navigated[0], '/pages/invoice-center/invoice-center')

  const orders = instantiate(loadPageDefinition('pages/orders/orders.js', {
    wx,
    modules: { auth: makeAuth('u1'), api: {} },
  }))
  orders.toOrderInvoice({ currentTarget: { dataset: { id: 'ord-77' } } })
  assert.equal(navigated[1], '/pages/invoice-center/invoice-center?orderKind=print&orderId=ord-77')
})
