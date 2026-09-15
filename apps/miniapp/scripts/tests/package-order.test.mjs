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
