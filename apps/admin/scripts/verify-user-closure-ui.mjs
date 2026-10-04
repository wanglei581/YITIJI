import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

/** 由 verify-admin-users-ui 调用：执行真实 helper、适配器和对话框的 JSX/事件。 */
export async function verifyUserClosure({ root, pass, fail, presentationModule }) {
  const read = (path) => readFileSync(join(root, path), 'utf8')
  const page = read('src/routes/users/index.tsx'), drawer = read('src/routes/users/UserDetailDrawer.tsx')
  const dialog = read('src/routes/users/UserClosureDialog.tsx'), helper = read('src/routes/users/userClosurePresentation.ts')
  const service = read('src/services/api/adminUsers.ts')
  const check = (ok, message) => { if (!ok) fail(message) }
  const load = (source, deps, globals = {}) => {
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText
    const exports = {}
    vm.runInNewContext(js, { exports, require: (id) => {
      if (!(id in deps)) throw Error(`未登记运行依赖 ${id}`)
      return deps[id]
    }, ...globals })
    return exports
  }
  class ApiHttpError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status } }
  const calls = []
  let reply = { ok: true, json: async () => ({ changed: true, status: 'anonymized' }) }
  const adapterDeps = { '../auth': { authHeader: () => ({}), redirectToLogin: () => {} }, './client': { API_MODE: 'http', API_BASE_URL: '/api/v1', ApiHttpError } }
  const adapter = load(service, adapterDeps, { URLSearchParams, fetch: async (url, options) => { calls.push({ url, options }); return reply } })
  const messages = load(helper, {
    '../../services/api/client': { ApiHttpError }, '../../services/api/adminUsers': adapter,
    '../../services/api/userErrorMessage': { userMessageOf: (e, fallback) => e instanceof ApiHttpError ? `状态${e.status}` : fallback },
    '../orders/orderDisplay': load(read('src/routes/orders/orderDisplay.ts'), {
      '@ai-job-print/shared': {}, './orderHonestyCopy': {}, '../../services/api/adminOrdersReadonly': {},
    }),
  })
  const valid = { source: 'offline', reasonText: '本人到场申请', phoneLast4: '1234', offlineEvidenceNo: 'OFF-1' }
  check(Object.keys(messages.validateClosure(valid)).length === 0, '有效线下申请通过校验')
  for (const phoneLast4 of ['', '123', '12345', '12a4', '１２３４']) check(messages.validateClosure({ ...valid, phoneLast4 }).phoneLast4, '尾号只接受四位数字')
  for (const offlineEvidenceNo of ['', '   ', 'x'.repeat(65)]) check(messages.validateClosure({ ...valid, offlineEvidenceNo }).offlineEvidenceNo, '线下来源必须填 1–64 字凭据')
  for (const reasonText of ['', ' ', 'x'.repeat(201)]) check(messages.validateClosure({ ...valid, reasonText }).reasonText, '事由必须为 1–200 字')
  check(!messages.validateClosure({ ...valid, source: 'member_request', offlineEvidenceNo: undefined }).offlineEvidenceNo, '本人申请不要求线下凭据')
  for (const closure of ['requested', 'offline_executed', 'executed']) {
    const query = presentationModule.buildAdminUserQuery({ search: '', enabled: 'all', registeredFrom: '', registeredTo: '', closure }, 1, 20)
    check(query.closure === closure && presentationModule.hasUserFilters({ ...query, search: '', enabled: 'all' }), `closure=${closure} 正向查询映射`)
    await adapter.list(query)
    check(new URL(calls.at(-1).url, 'https://test.invalid').searchParams.get('closure') === closure, `HTTP 发送 closure=${closure}`)
    check(page.includes(`value="${closure}"`), `页面提供 ${closure} 选项`)
  }
  check(/next\.set\('page', '1'\)/.test(page) && page.includes("next.set('closure', value)") && page.includes('useTableState'), '注销筛选写 URL 并回第一页')
  const baseUser = { id: 'u1', maskedPhone: '138****1234', status: 'active', closureRequest: { source: 'member_request', requestedAt: '2026-10-04T00:00:00Z' } }
  check(presentationModule.hasPendingClosure(baseUser), '本人待处理申请有徽章')
  for (const status of ['closing', 'anonymized']) check(!presentationModule.hasPendingClosure({ ...baseUser, status }), '处理中/已注销不伪称待处理')
  const closed = { ...baseUser, status: 'anonymized' }
  check(!presentationModule.canDisableUser(closed) && !presentationModule.canRestoreUser(closed) && !presentationModule.canCloseUser(closed), '已注销账号无状态操作')
  check(presentationModule.userPhone(closed) === '***' && page.includes('userPhone(user)') && drawer.includes('userPhone(detail.user)'), '已注销手机号列表/详情均为 ***')
  check(drawer.includes("getUser()?.role === 'admin' && canCloseUser(detail.user)"), '抽屉注销按钮同时限制 admin 与账号状态')
  check(drawer.includes('USER_STATUS_LABELS[detail.user.status]') && drawer.includes('该会员已申请注销，等待管理员执行'), '详情按真实状态映射并提示待执行')
  check(!/window\.(confirm|alert)|(?:localStorage|sessionStorage)\.setItem/.test(dialog + helper + service), '页内对话框，无原生确认与敏感持久化')
  check(dialog.includes("replace(/\\D/g, '').slice(0, 4)") && dialog.includes('maxLength={4}') && dialog.includes('inputMode="numeric"'), '尾号输入过滤数字且限四位')
  check(dialog.includes('disabled={!memberSourceAvailable}'), '无待处理本人申请禁选对应来源')
  const expected = [
    ['CLOSURE_PHONE_MISMATCH', '手机尾号与该账号不一致，请向会员本人核对后重填。'],
    ['CLOSURE_REQUEST_REQUIRED', '该会员没有待处理的注销申请。如会员到场办理，请改选「凭线下申请办理」并填写凭据编号。'],
    ['CLOSURE_BLOCKED_BY_OPEN_ORDERS', '该会员还有未完成的订单，暂不能注销。请先处理完下列订单：'],
    ['CLOSURE_IN_PROGRESS', '该账号正在注销中，请稍后刷新查看结果。'],
    ['CLOSURE_CONTEXT_MISMATCH', '该账号上一次注销没有完成。重试时办理来源、事由、凭据编号必须与上一次完全相同。'],
    ['CLOSURE_EXECUTION_FAILED', '注销没有完成，账号停在注销中。请用相同的来源、事由、凭据编号再提交一次；仍失败请联系技术人员。'],
    ['CLOSURE_SOURCE_INVALID', '请选择办理来源。'], ['CLOSURE_REASON_REQUIRED', '请填写 1–200 字事由。'],
    ['CLOSURE_PHONE_REQUIRED', '请填写四位数字手机尾号。'], ['CLOSURE_EVIDENCE_REQUIRED', '请填写 1–64 字线下凭据编号。'],
  ]
  for (const [code, message] of expected) {
    const error = new adapter.AdminUserClosureError(code, 400)
    error.message = 'expected 9876 / 13800139876'; error.expectedPhoneLast4 = '9876'
    const failure = messages.closureFailure(error)
    check(failure.message === message && !JSON.stringify(failure).includes('9876'), `${code} 中文提示逐字且不回显正确尾号`)
  }
  for (const code of ['CLOSURE_SOURCE_INVALID', 'CLOSURE_REASON_REQUIRED', 'CLOSURE_PHONE_REQUIRED', 'CLOSURE_EVIDENCE_REQUIRED']) {
    check(Object.keys(messages.closureFailure(new adapter.AdminUserClosureError(code, 400)).fields).length === 1, `${code} 定位字段提示`)
  }
  check(messages.closureOrderStatus('refunding') === '退款中' && messages.closureOrderStatus('pickup_pending') === '待取件' && messages.closureOrderStatus('printing') === '打印中', '订单状态消费本后台现有中文映射')
  const expectedLists = [
    ['会删除，无法恢复：', '简历与 AI 生成的简历结果；上传的文件、扫描件及其衍生文件；模拟面试、AI 顾问、岗位 AI 的会话与报告；合同审查与材料检查记录；浏览、收藏、打开来源平台的记录；本人自填的求职进度；站内通知。'],
    ['会保留（已去掉能认出本人的信息）：', '订单、支付与退款流水（金额与订单号保留）；打印任务的状态记录；权益发放与兑换流水；意见反馈的处理记录；已同意的协议版本与时间；AI 调用的计量记录和服务日志；隐私请求记录。'],
    ['按原样保留：', '操作审计和安全日志（其中手机号只有部分数字）。'],
    ['另外：', '有未办完的订单时不能执行，要先办完；未使用的权益会作废；未处理完的意见反馈会关闭；该手机号以后重新注册是一个新账号，看不到以上任何记录；执行后不能撤销。'],
  ]
  check(JSON.stringify(messages.CLOSURE_CONSEQUENCES) === JSON.stringify(expectedLists), '确认清单逐字一致')
  reply = { ok: false, status: 409, json: async () => ({ error: { code: 'CLOSURE_BLOCKED_BY_OPEN_ORDERS', message: 'raw expected 9876', orders: [{ orderNo: 'ORD-1', status: 'refunding' }] } }) }
  let blocking
  try { await adapter.closeUserAccount('u1', valid) } catch (error) { blocking = error }
  check(blocking?.orders?.[0]?.orderNo === 'ORD-1' && !blocking.message.includes('9876'), '适配器保留阻塞订单并丢弃原始错误文本')
  const last = calls.at(-1)
  check(last.url === '/api/v1/admin/users/u1/closure' && last.options.method === 'POST' && JSON.stringify(JSON.parse(last.options.body)) === JSON.stringify(valid), '注销 DTO 与 POST 路径一致')
  const mock = load(service, { ...adapterDeps, './client': { ...adapterDeps['./client'], API_MODE: 'mock' } })
  let mockError
  try { await mock.closeUserAccount('u1', valid) } catch (error) { mockError = error }
  check(mockError?.code === 'DEMO_MODE_READONLY' && mockError.message.includes('演示模式不执行'), 'mock 明确拒绝注销')

  const jsx = (type, props) => ({ type, props })
  const walk = (node, predicate) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map((child) => walk(child, predicate)).find(Boolean) ?? null
    if (predicate(node)) return node
    return walk(node.props?.children, predicate)
  }
  const text = (node) => {
    if (node == null || typeof node === 'boolean') return ''
    if (typeof node !== 'object') return String(node)
    if (Array.isArray(node)) return node.map(text).join('')
    if (typeof node.type === 'function') return text(node.type(node.props))
    return text(node.props?.children)
  }
  const harness = (request) => {
    const states = [], refs = []; let stateIndex = 0, refIndex = 0
    const component = load(dialog, {
      'react/jsx-runtime': { jsx, jsxs: jsx }, react: {
        useState: (initial) => { const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], (value) => { states[i] = typeof value === 'function' ? value(states[i]) : value }] },
        useRef: (initial) => { const i = refIndex++; return refs[i] ??= { current: initial } }, useEffect: () => {},
      }, '../../services/api/adminUsers': { closeUserAccount: request }, './userClosurePresentation': messages, './userPresentation': presentationModule,
    }).UserClosureDialog
    let successes = 0
    const render = () => { stateIndex = 0; refIndex = 0; return component({ user: baseUser, onClose: () => {}, onSuccess: () => successes++ }) }
    return { states, render, successes: () => successes }
  }
  const button = (tree, label) => walk(tree, (node) => node.type === 'button' && text(node) === label)
  const input = (tree, id) => walk(tree, (node) => node.props?.id === id)
  let submits = 0, release
  const h = harness(async () => { submits++; await new Promise((resolve) => { release = resolve }); return { changed: true } })
  h.states[0] = valid
  button(h.render(), '下一步').props.onClick()
  check(text(h.render()).includes('注销后会发生什么') && button(h.render(), '确认注销').props.disabled, '第二步未勾选不能确认注销')
  button(h.render(), '确认注销').props.onClick()
  check(submits === 0, '事件提交也拦截未勾选状态')
  walk(h.render(), (node) => node.props?.type === 'checkbox').props.onChange({ target: { checked: true } })
  const submitButton = button(h.render(), '确认注销')
  submitButton.props.onClick(); submitButton.props.onClick()
  check(submits === 1 && button(h.render(), '提交中…').props.disabled, '提交锁防重复并禁用按钮')
  release(); await new Promise((resolve) => setTimeout(resolve, 0))
  check(h.successes() === 1, '仅成功响应回调成功')
  for (const code of ['CLOSURE_EXECUTION_FAILED', 'CLOSURE_BLOCKED_BY_OPEN_ORDERS']) {
    const f = harness(async () => { throw new adapter.AdminUserClosureError(code, code === 'CLOSURE_EXECUTION_FAILED' ? 503 : 409, [{ orderNo: 'ORD-1', status: 'refunding' }]) })
    f.states[0] = valid; button(f.render(), '下一步').props.onClick()
    walk(f.render(), (node) => node.props?.type === 'checkbox').props.onChange({ target: { checked: true } })
    button(f.render(), '确认注销').props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0))
    const tree = f.render()
    check(f.successes() === 0 && input(tree, 'closure-reason').props.value === valid.reasonText && input(tree, 'closure-phone').props.value === valid.phoneLast4 && input(tree, 'closure-evidence').props.value === valid.offlineEvidenceNo, `${code} 失败不报成功且保留内容`)
    if (code === 'CLOSURE_BLOCKED_BY_OPEN_ORDERS') check(text(tree).includes('ORD-1') && text(tree).includes('退款中'), '阻塞提示实际列出订单号与中文状态')
  }
  const sharedNow = read('../../packages/shared/src/types/memberPrivacy.ts')
  check(read('src/routes/privacy-requests/index.tsx').includes('ADMIN_DATA_REQUEST_DELETE_COMPLETE_CONFIRM as ADMIN_MEMBER_DATA_REQUEST_SCOPE') && sharedNow.includes('账号注销由管理员在用户管理页执行'), '隐私工单采用管理员专用新事实文案')
  pass('注销筛选、隐私、字段校验、页内二次确认、错误/订单、真实 POST、mock 拒绝与失败保留内容行为')
}
