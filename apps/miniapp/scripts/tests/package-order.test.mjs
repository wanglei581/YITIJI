/**
 * utils/package-order.js 的纯函数行为测试（node:test）。
 *
 * 为什么要有它：材料包侧链的门禁是**静态断言**，只能证明某段代码存在，证明不了它算得对。
 * 而这里有三条真正会伤到用户的算法：
 *   - 到机码该不该显示（服务端已经用 visibleCode 判过一次，前端不能再放宽）；
 *   - 分页去重（重复渲染同一张订单 = 用户以为自己下了两单）；
 *   - 错误码 → 可执行的下一步（判错就只剩「请稍后重试」）。
 * 这些都只能真的跑一遍才知道。
 *
 * 放在 scripts/tests/ 是刻意的：scripts/project-graph/gates.mjs 把
 * `/scripts/tests/` 排除在「门禁脚本」之外，所以本文件不会被
 * verify-ci-gate-coverage 当成「写完没接线的门禁」。它由
 * `pnpm --filter @ai-job-print/miniapp verify:package-helpers` 拉起，
 * 并串在 verify:static 里进 CI。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))
const pkg = requireMiniapp('./package-order.js')

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0)
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString()

test('金额：0 分是真的免费，缺失是「待核定」，两者不能混', () => {
  assert.equal(pkg.formatAmount(0), '免费')
  assert.equal(pkg.formatAmount(150), '¥1.50')
  assert.equal(pkg.formatAmount(100), '¥1.00')
  // 缺失 / 非法值绝不显示成 ¥0.00 —— 那会让用户以为这单不要钱。
  assert.equal(pkg.formatAmount(null), '待服务端核定')
  assert.equal(pkg.formatAmount(undefined), '待服务端核定')
  assert.equal(pkg.formatAmount(''), '待服务端核定')
  assert.equal(pkg.formatAmount(-1), '待服务端核定')
  assert.equal(pkg.formatAmount('abc'), '待服务端核定')
})

test('到机码分组：异常输入不得中断整页渲染', () => {
  assert.equal(pkg.formatPickupCode('12345678'), '12-34-56-78')
  assert.equal(pkg.formatPickupCode('12-34-56-78'), '12-34-56-78')
  assert.equal(pkg.formatPickupCode(''), '')
  assert.equal(pkg.formatPickupCode(null), '')
  // 纯空白：replace 后为空串，match 返回 null。原始实现在这里 THROW，
  // 一行异常数据就会让整个订单列表白屏。
  assert.equal(pkg.formatPickupCode('   '), '')
  // 数字入参同理（String() 包装）。
  assert.equal(pkg.formatPickupCode(12345678), '12-34-56-78')
})

test('有效期：解析失败返回空串，绝不把 ISO 原始串兜底给用户', () => {
  assert.equal(pkg.formatExpireAt(''), '')
  assert.equal(pkg.formatExpireAt(null), '')
  assert.equal(pkg.formatExpireAt('not-a-date'), '')
  const shown = pkg.formatExpireAt(iso(0))
  assert.match(shown, /^\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.ok(!shown.includes('T'), '不得出现半截技术串')
})

test('状态：未付款是材料包的常态，不能被归成「待付款」而从待取件里消失', () => {
  const pending = pkg.resolvePackageStatus(
    { pickupStatus: 'pending', payStatus: 'unpaid', taskStatus: 'pending_release', expiresAt: iso(3600e3) },
    NOW,
  )
  assert.equal(pending.key, 'waiting')
  assert.match(pending.label, /现场付款/)
})

test('状态：到机码过期按过期算，即使服务端 pickupStatus 还是 pending', () => {
  const expired = pkg.resolvePackageStatus(
    { pickupStatus: 'pending', payStatus: 'unpaid', taskStatus: 'pending_release', expiresAt: iso(-1000) },
    NOW,
  )
  assert.equal(expired.key, 'done')
  assert.match(expired.label, /过期/)
})

test('状态：核销后按付款情况分流，完成/失败落到终态', () => {
  assert.equal(pkg.resolvePackageStatus({ pickupStatus: 'claimed', payStatus: 'unpaid', taskStatus: 'awaiting_payment' }, NOW).key, 'printing')
  assert.match(pkg.resolvePackageStatus({ pickupStatus: 'claimed', payStatus: 'unpaid', taskStatus: 'awaiting_payment' }, NOW).label, /待现场付款/)
  assert.equal(pkg.resolvePackageStatus({ pickupStatus: 'claimed', payStatus: 'paid', taskStatus: 'printing' }, NOW).key, 'printing')
  assert.equal(pkg.resolvePackageStatus({ pickupStatus: 'claimed', payStatus: 'paid', taskStatus: 'completed' }, NOW).key, 'done')
  assert.equal(pkg.resolvePackageStatus({ pickupStatus: 'claimed', payStatus: 'paid', taskStatus: 'failed' }, NOW).tone, 'danger')
})

test('状态：used 是已付款交付打印，不能落到终态兜底分支', () => {
  // pickup-order.service 在释放打印任务的同一事务里写 pickupStatus:'used' + taskStatus:'pending'。
  // 漏掉 used 时这一组会落到兜底分支，被判成 key:'done'、label:'pending'（英文串），
  // 于是订单在真正出纸的阶段从「打印中」筛选里整批消失。
  const queued = pkg.resolvePackageStatus({ pickupStatus: 'used', payStatus: 'paid', taskStatus: 'pending' }, NOW)
  assert.equal(queued.key, 'printing')
  assert.match(queued.label, /排队出纸/)

  const claimedByAgent = pkg.resolvePackageStatus({ pickupStatus: 'used', payStatus: 'paid', taskStatus: 'claimed' }, NOW)
  assert.equal(claimedByAgent.key, 'printing')

  const printing = pkg.resolvePackageStatus({ pickupStatus: 'used', payStatus: 'paid', taskStatus: 'printing' }, NOW)
  assert.equal(printing.key, 'printing')
  assert.equal(printing.label, '正在打印')

  // 终态仍然优先：出纸有结论时那就是用户最关心的事实。
  assert.equal(pkg.resolvePackageStatus({ pickupStatus: 'used', payStatus: 'paid', taskStatus: 'completed' }, NOW).key, 'done')
  assert.equal(pkg.resolvePackageStatus({ pickupStatus: 'used', payStatus: 'paid', taskStatus: 'failed' }, NOW).tone, 'danger')
})

/**
 * terminalPackageReason 决定的不是"显示什么标签"，而是**能不能让用户就这一份材料包
 * 再下一张单、再付一次钱**。所以它的默认值必须和 resolvePackageStatus 相反：
 * 认不出来的状态一律当"还活着"。下面每一条都对着服务端的真实写入点。
 */
test('终态判据：服务端确实会写的五种终态，每一种都给得出一句能给用户看的原因', () => {
  const reasons = [
    { taskStatus: 'completed' },   // package-order-fulfillment.service.ts:43
    { taskStatus: 'failed' },      // terminals-agent.service.ts:866
    { taskStatus: 'abandoned' },   // admin-print-jobs-abandon.service.ts
    { taskStatus: 'cancelled' },   // 管理端处置
    { taskStatus: 'expired' },     // package-order.service.ts:310/314
    { pickupStatus: 'cancelled' },
    { pickupStatus: 'expired' },
  ].map((order) => pkg.terminalPackageReason(order))
  for (const reason of reasons) assert.ok(reason && typeof reason === 'string', '终态必须给得出原因')
  // 原因是给用户看的一句话，不是状态码原样回显。
  for (const reason of reasons) assert.ok(!/^[a-z_]+$/.test(reason), `不能把状态码当文案：${reason}`)
})

test('终态判据：still-live 的三种绝不能算终态（算进去 = 同一份材料包打两遍、收两次钱）', () => {
  // pickup-order.service.ts:123 —— 一体机领走了这一单，用户正站在机器前付款。
  // 它还是可逆的：online-payment.service.ts:800 关单时会把 claimed 退回 pending。
  assert.equal(pkg.terminalPackageReason({ pickupStatus: 'claimed', taskStatus: 'awaiting_payment', payStatus: 'unpaid' }), '')
  assert.equal(pkg.terminalPackageReason({ pickupStatus: 'claimed', taskStatus: 'awaiting_payment', payStatus: 'paid' }), '')
  // pickup-order.service.ts:221 —— used 是和 taskStatus:'pending' + printTaskId 一起写的，
  // 且 CAS 要求 payStatus:'paid'：钱已付、任务刚进队列。
  assert.equal(pkg.terminalPackageReason({ pickupStatus: 'used', taskStatus: 'pending', payStatus: 'paid' }), '')
  assert.equal(pkg.terminalPackageReason({ pickupStatus: 'used', taskStatus: 'printing', payStatus: 'paid' }), '')
  // 刚建成，码还活着。
  assert.equal(pkg.terminalPackageReason({ pickupStatus: 'pending', taskStatus: 'pending_release', payStatus: 'unpaid' }), '')
  // payStatus 单独 closed：online-payment.service.ts:799 关掉付款的同时把 claimed 退回
  // pending，并注明"迟到回调若取件窗口仍开仍可入账履约"—— 码可能还活着。
  assert.equal(pkg.terminalPackageReason({ pickupStatus: 'pending', taskStatus: 'pending_release', payStatus: 'closed' }), '')
  // 但 used 一旦走到真正的终态，就该算终态了（终态信号在 taskStatus 上）。
  assert.ok(pkg.terminalPackageReason({ pickupStatus: 'used', taskStatus: 'completed', payStatus: 'paid' }))
})

test('终态判据：认不出来的状态 fail-closed，而 resolvePackageStatus 对同一个值是 done —— 两者默认值相反是有意的', () => {
  const weird = { pickupStatus: 'quantum', taskStatus: 'schrodinger', payStatus: 'maybe' }
  assert.equal(pkg.terminalPackageReason(weird), '', '将来新增的服务端状态不得被默认解释成"这单作废了"')
  assert.equal(pkg.resolvePackageStatus(weird).key, 'done', '显示那一档仍然把它归到 done（原样回显，对显示是安全的）')
  // 空 / 脏输入同样不得被当成终态。
  for (const bad of [null, undefined, {}, { taskStatus: '' }, { taskStatus: 0 }, []]) {
    assert.equal(pkg.terminalPackageReason(bad), '')
  }
})

test('终态判据：本地时钟不参与 —— 到机码看着过期也要等服务端说 expired', () => {
  // 服务端 detail 每次都先跑 expireIfNeeded 再回读；前端按本地时钟抢答，只会在时钟
  // 不准时把一张还能用的码判死。注意 resolvePackageStatus（显示用）确实会看本地时间。
  const looksExpired = { pickupStatus: 'pending', taskStatus: 'pending_release', expiresAt: new Date(NOW - 1000).toISOString() }
  assert.equal(pkg.terminalPackageReason(looksExpired), '')
  assert.equal(pkg.resolvePackageStatus(looksExpired, NOW).label, '到机码已过期')
})

test('状态：未登记的服务端状态原样回显，不编一个好看的标签', () => {
  const unknown = pkg.resolvePackageStatus({ pickupStatus: 'weird_state', payStatus: 'paid', taskStatus: '' }, NOW)
  assert.equal(unknown.label, 'weird_state')
})

test('状态三连：登记过的给中文，没登记的原样回显', () => {
  assert.equal(pkg.statusText('pickup', 'pending'), '待到机核销')
  assert.equal(pkg.statusText('pickup', 'used'), '已交付打印')
  assert.equal(pkg.statusText('pay', 'unpaid'), '未付款')
  assert.equal(pkg.statusText('task', 'pending_release'), '等待到机释放')
  // 未登记取值：原样回显。编一个中文会把没理解的状态说成理解了的。
  assert.equal(pkg.statusText('pay', 'brand_new_state'), 'brand_new_state')
  assert.equal(pkg.statusText('task', ''), '—')
  const detail = pkg.statusDetail({ pickupStatus: 'used', payStatus: 'paid', taskStatus: 'printing' })
  assert.equal(detail, '取件 已交付打印 · 付款 已付款 · 任务 打印中')
  // 三个字段都必须出现：它们回答的是三个不同的问题。
  for (const part of ['取件', '付款', '任务']) assert.ok(detail.includes(part))
})

test('列表行：到机码只在服务端下发且仍处 waiting 时展示', () => {
  const visible = pkg.toPackageRow(
    { orderId: 'o1', orderNo: 'ORD-1', pickupCode: '12345678', pickupStatus: 'pending', payStatus: 'unpaid', taskStatus: 'pending_release', amountCents: 150, itemCount: 2, expiresAt: iso(3600e3) },
    NOW,
  )
  assert.equal(visible.hasPickupCode, true)
  assert.equal(visible.pickupCode, '12-34-56-78')
  assert.equal(visible.fileCount, 2)
  assert.equal(visible.amountText, '¥1.50')

  // 已核销：服务端本来就不再下发码，但即便下发了，前端也不许继续展示 ——
  // 那张码已经被用掉，显示它会让用户拿着废码跑一趟。
  const claimed = pkg.toPackageRow(
    { orderId: 'o2', pickupCode: '12345678', pickupStatus: 'claimed', payStatus: 'paid', taskStatus: 'printing', amountCents: 150, itemCount: 1 },
    NOW,
  )
  assert.equal(claimed.hasPickupCode, false)
  assert.equal(claimed.pickupCode, '')

  // 已过期同理。
  const expired = pkg.toPackageRow(
    { orderId: 'o3', pickupCode: '12345678', pickupStatus: 'pending', payStatus: 'unpaid', taskStatus: 'pending_release', amountCents: 0, itemCount: 1, expiresAt: iso(-1) },
    NOW,
  )
  assert.equal(expired.hasPickupCode, false)
  assert.equal(expired.amountText, '免费')
})

test('列表行：脏数据不抛异常（一行坏数据不能打掉整页）', () => {
  const row = pkg.toPackageRow(undefined, NOW)
  assert.equal(row.orderId, '')
  assert.equal(row.fileCount, 0)
  assert.equal(row.amountText, '待服务端核定')
  const noCount = pkg.toPackageRow({ orderId: 'o4', itemCount: 'x', pickupStatus: 'pending', expiresAt: iso(1000) }, NOW)
  assert.equal(noCount.fileCount, 0)
})

test('分页合并：同一 orderId 不重复渲染，且用后到的那份覆盖', () => {
  const first = [
    pkg.toPackageRow({ orderId: 'a', orderNo: 'A', pickupStatus: 'pending', amountCents: 100, itemCount: 1, expiresAt: iso(1000) }, NOW),
    pkg.toPackageRow({ orderId: 'b', orderNo: 'B', pickupStatus: 'pending', amountCents: 100, itemCount: 1, expiresAt: iso(1000) }, NOW),
  ]
  const second = [
    // 并发写入时游标翻页会重复返回 b；它的状态可能已经变了。
    pkg.toPackageRow({ orderId: 'b', orderNo: 'B', pickupStatus: 'claimed', payStatus: 'paid', taskStatus: 'completed', amountCents: 100, itemCount: 1 }, NOW),
    pkg.toPackageRow({ orderId: 'c', orderNo: 'C', pickupStatus: 'pending', amountCents: 100, itemCount: 1, expiresAt: iso(1000) }, NOW),
  ]
  const merged = pkg.mergePackageRows(first, second)
  assert.deepEqual(merged.map((r) => r.orderId), ['a', 'b', 'c'], '顺序不跳动，且无重复')
  assert.equal(merged[1].statusKey, 'done', '重复行用后到的那份（更新）')
  // 缺 orderId 的行直接丢掉：它点不进详情，渲染出来只是一张点不动的卡片。
  assert.equal(pkg.mergePackageRows([], [{ orderId: '' }, null]).length, 0)
})

test('错误码 → 可执行的下一步：每条都不是「请稍后重试」', () => {
  const cases = [
    ['PRINT_TERMINAL_OFFLINE', 'store'],
    ['PRINT_TERMINAL_NOT_ACTIVE', 'store'],
    ['CAPABILITY_NOT_CONFIGURED', 'store'],
    ['CAPABILITY_UNAVAILABLE', 'store'],
    ['PRICE_CONFIG_UNAVAILABLE', 'none'],
    ['PRINT_PII_SCAN_REQUIRED', 'privacy'],
    ['PII_SCAN_STALE', 'privacy'],
    ['PRINT_FILE_NOT_FOUND', 'files'],
    ['PRINT_FILE_EXPIRED', 'files'],
    ['PACKAGE_FILE_DUPLICATED', 'files'],
    ['PACKAGE_ORDER_NOT_FOUND', 'orders'],
    ['VALIDATION_FAILED', 'files'],
    // 按终端逐台判定的彩色 / 自动双面门禁（terminal-capabilities.service.ts 的
    // assertPrintParamsAllowed，未登记即拒绝）。放行路径只有一条 —— 管理员在那台机器
    // 真机验过后把 color_print / duplex_print 配成 available，所以恢复动作是换服务点。
    ['PRINT_COLOR_NOT_VERIFIED_ON_TERMINAL', 'store'],
    ['PRINT_DUPLEX_NOT_VERIFIED_ON_TERMINAL', 'store'],
    // 打印机这一个部件出不了纸（离线 / 缺纸 / 故障）。与上面三类都不是一回事，
    // 见下一条测试对 recover 取值的说明。
    ['PRINTER_UNAVAILABLE', 'retry'],
  ]
  for (const [code, recover] of cases) {
    const shown = pkg.describePackageError({ code, statusCode: 400, message: '' }, '兜底句')
    assert.equal(shown.recover, recover, `${code} 的恢复动作`)
    assert.ok(shown.title && shown.text, `${code} 必须有标题与说明`)
    assert.notEqual(shown.text, '兜底句', `${code} 不该落到兜底句`)
  }
})

test('错误码：彩色/双面未在该机验过，必须说清是「这台机器」而不是「稍后重试」', () => {
  // 服务端为这两个码写的是 403 ForbiddenException。它们与 CAPABILITY_* 不是同一回事：
  // 那两条说的是「这台机器开不开放文档打印」，这两条说的是「这台机器的彩色/双面没验过」。
  // 没有映射时它们会落到 describePackageError 末尾的「操作未完成 / 请稍后重试」——
  // 而这件事重试一万次也不会变，用户只会反复点同一个按钮。
  for (const [code, keyword] of [
    ['PRINT_COLOR_NOT_VERIFIED_ON_TERMINAL', '彩色'],
    ['PRINT_DUPLEX_NOT_VERIFIED_ON_TERMINAL', '双面'],
  ]) {
    const shown = pkg.describePackageError({ code, statusCode: 403, message: '' }, '创建订单失败，请稍后重试。')
    assert.equal(shown.recover, 'store', `${code} 的恢复动作必须是换服务点`)
    assert.match(shown.title, new RegExp(keyword), `${code} 的标题要点名是哪一项能力`)
    assert.ok(shown.text.includes('服务点'), `${code} 的说明必须指向「换一个服务点」这个按钮真正会做的事`)
    assert.notEqual(shown.title, '操作未完成', `${code} 不得落到未知码兜底`)
  }
})

test('错误码：打印机出不了纸时说的是「可以处理完再来」，不是「请稍后重试」，也不吐机器码', () => {
  // 服务端 terminals/printer-availability.ts 在报价与建单同口径 fail-closed：
  // 最近 5 分钟没心跳 / 从未上报 / 心跳里的 printerStatus ∈ {offline, error, paper_empty}
  // → 400 PRINTER_UNAVAILABLE。这个码此前在本表里**没有映射**，于是用户看到的是
  // describePackageError 末尾那句「操作未完成 / 请稍后重试」——而三种成因里有两种
  // （缺纸、卡纸故障）是现场工作人员当场就能处理的，处理完回来重新核价就能过。
  const shown = pkg.describePackageError({ code: 'PRINTER_UNAVAILABLE', statusCode: 400, message: '' }, '创建订单失败，请稍后重试。')
  assert.notEqual(shown.title, '操作未完成', '不得落到未知码兜底')
  assert.notEqual(shown.text, '创建订单失败，请稍后重试。')
  // recover 是 'retry'（按钮就在本页，文案「重新核价」），不是 'store'：
  // CAPABILITY_* 要管理员登记、PRINT_TERMINAL_OFFLINE 是整台终端联系不上，那两类用户等不来；
  // 这一条是终端在线、只是打印机此刻出不了纸，**可能**当场恢复。
  assert.equal(shown.recover, 'retry')
  assert.match(shown.text, /工作人员/, '必须说出那条唯一可执行的下一步')
  assert.match(shown.text, /服务点/, '也要留一条走得通的退路（它也可能是真的坏了）')
  // 不把机器码摊到用户脸上（user-error.js 的 fail-closed 只管服务端 message，
  // 本表自己的中文同样不许夹带）。
  assert.ok(!shown.title.includes('PRINTER_UNAVAILABLE') && !shown.text.includes('PRINTER_UNAVAILABLE'))

  // 这个码**必须**真的是服务端会抛的那一个，且不在 message 透传白名单里 ——
  // 服务端那句原文写的是「本机打印机…」，那是写给站在一体机前的人的；
  // 透传到手机上，「本机」会被读成用户自己的手机。
  const apiSrc = fs.readFileSync(path.join(MINIAPP, '../../services/api/src/terminals/printer-availability.ts'), 'utf8')
  assert.match(apiSrc, /code: 'PRINTER_UNAVAILABLE'/, '服务端仍然抛这个码（改名了本表要跟着改）')
  const userError = requireMiniapp('./user-error.js')
  assert.ok(!userError.PASSTHROUGH_MESSAGE_CODES.includes('PRINTER_UNAVAILABLE'),
    '不透传服务端原文（它面向一体机现场，「本机」在手机上会被读成用户自己的手机）')
})

test('错误码：401 单独成一类，去登录而不是重试', () => {
  for (const err of [
    { statusCode: 401 },
    { statusCode: 401, code: 'MEMBER_SESSION_EXPIRED' },
    { statusCode: 400, code: 'MEMBER_MISSING_TOKEN' },
    { statusCode: 400, code: 'AUTH_REQUIRED' },
  ]) {
    assert.equal(pkg.describePackageError(err, '兜底句').recover, 'login')
  }
})

test('错误码：未登记的码 fail-closed 到调用方兜底句，不宣称成功', () => {
  const unknown = pkg.describePackageError({ statusCode: 400, code: 'SOME_NEW_CODE', message: '' }, '创建订单失败，请稍后重试。')
  assert.equal(unknown.text, '创建订单失败，请稍后重试。')
  assert.equal(unknown.recover, 'retry')
  // request.js 已把可展示的服务端中文留在 message 上（透传白名单），有就优先用它。
  const passthrough = pkg.describePackageError({ statusCode: 400, code: 'PRINT_TERMINAL_OFFLINE', message: '目标终端当前离线，请稍后重试' }, '兜底句')
  assert.equal(passthrough.text, '目标终端当前离线，请稍后重试')
  // 断网是 statusCode -1（request.js 的约定），要说的是网络而不是业务。
  assert.match(pkg.describePackageError({ statusCode: -1 }, '兜底句').title, /网络/)
})

test('文件准入：与服务端 ALLOWED_PURPOSES / PII 要求同源', () => {
  assert.equal(pkg.isPackagePrintable({ id: 'f1', purpose: 'print_doc' }), true)
  assert.equal(pkg.isPackagePrintable({ id: 'f2', purpose: 'cover_letter' }), true)
  // 服务端 ALLOWED_PURPOSES 之外的一律不列出，列了用户选完只会在下单时被拒。
  assert.equal(pkg.isPackagePrintable({ id: 'f3', purpose: 'id_scan' }), false)
  assert.equal(pkg.isPackagePrintable({ id: 'f4', purpose: 'contract_upload' }), false)
  // 服务端标了禁止进打印链路的高敏报告同样不列出。
  assert.equal(pkg.isPackagePrintable({ id: 'f5', purpose: 'print_doc', reprintable: false }), false)
  assert.equal(pkg.isPackagePrintable({ purpose: 'print_doc' }), false, '没有 id 的行不可用')

  // PII 判据要跟着服务端 assertPiiScanned 走：派生件直接放行，否则会让用户
  // 白做一次服务端根本不看的检查。
  assert.equal(pkg.needsPiiScan({ purpose: 'print_doc', assetCategory: 'original' }), true)
  assert.equal(pkg.needsPiiScan({ purpose: 'resume_scan', assetCategory: 'original' }), true)
  assert.equal(pkg.needsPiiScan({ purpose: 'print_doc', assetCategory: 'derived' }), false)
  assert.equal(pkg.needsPiiScan({ purpose: 'print_doc', assetCategory: 'optimized' }), false)
  assert.equal(pkg.needsPiiScan({ purpose: 'cover_letter', assetCategory: 'original' }), false)
})

test('真实边界文案：现场付款与不可在线取消都必须说出来', () => {
  assert.match(pkg.PACKAGE_ONSITE_NOTICE, /现场支付|现场付款/)
  assert.match(pkg.PACKAGE_NO_CANCEL_NOTICE, /不支持在线取消/)
  assert.match(pkg.PACKAGE_NO_CANCEL_NOTICE, /有效期/)
})
