/**
 * 材料包侧链回归门禁。
 *
 * 2026-09-08 首版钉的是「四页一律 fail-closed」。当时的判据成立：材料包下完单
 * **没有任何界面能再给出 orderId**，用户手上只剩一个到机码，而到机码不能反查订单 ——
 * 那条链的最后一步在代码层根本不存在，所以整体关掉是对的。
 *
 * 本版换了判据，因为缺的那一块补上了：服务端 `GET /orders/package` 提供本人材料包
 * 订单列表（游标分页，visibleCode 判据与详情一致），小程序「打印订单」页接入它，
 * 并可只带 orderId 重新进入到机码页。关闭方式于是从「前端硬编码」换成
 * 「服务端错误码运行期 fail-closed」。
 *
 * 每条断言都写明「为什么不该存在 / 必须存在」，而不是照现状抄：
 *
 * ① 硬编码守卫必须真的没了，连模块文件都不许留着等人 require 回来。
 *    留着的代价：一次 revert 就能把整条链重新关掉，而关掉的理由已经不成立。
 * ② 到机码 / 金额 / 付款令牌不得经 URL 传递或写进本机存储。
 *    为什么不该存在：到机码是去一体机取件的凭证。若它来自 URL，一条构造出来的链接、
 *    或一张转发出去的卡片，就能在别人手机上渲染出一张带码的成功页。归属校验在服务端
 *    `GET /orders/package/:id`（requireOwned）：非本人 404、未登录 401 —— 前端必须真的去问它。
 * ③ 提交载荷不得携带 filename / pageCount / totalAmount。
 *    为什么不该存在：`CreatePackageOrderDto` 是白名单校验（forbidNonWhitelisted），
 *    多带字段整单 400。这是刻意的 —— DTO 注释写明「页数、金额与文件名全部由服务端查证，
 *    前端传值不作为事实」，让前端报页数报金额本身就是错的（会成为计费口径被前端左右的入口）。
 * ④ 全链不得出现 wx.requestPayment。材料包是到机器后现场付款
 *    （pickup-order.service 接受 unpaid/paying 的到机码，出纸前才硬卡 payStatus !== 'paid'），
 *    小程序侧没有任何支付闭环，出现它就意味着有人在小程序里扣款。
 * ⑤ 运行期失败必须有**可执行的下一步**，且六态齐全。
 *    为什么：关闭判据搬到服务端之后，用户能看到的唯一东西就是错误态。
 *    只写「请稍后重试」等于把「换个服务点」「先做隐私检查」「去登录」这些真正的解法藏起来。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(MINIAPP, rel))

/** 剥注释后再做「不得出现 X」的断言：抓的是代码，不是解释为什么删掉它的那句话。 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\*)/.test(line))
  .join('\n')

let failed = 0
const assert = (cond, msg) => { if (cond) console.log(`  PASS  ${msg}`); else { failed++; console.log(`  FAIL  ${msg}`) } }

const CHAIN_PAGES = ['package-create', 'store-select', 'package-confirm', 'package-code']

const api = read('utils/api.js')
const helper = read('utils/package-order.js')
const ordersJs = read('pages/orders/orders.js')
const ordersWxml = read('pages/orders/orders.wxml')
const createJs = read('pages/package-create/package-create.js')
const createWxml = read('pages/package-create/package-create.wxml')
const storeJs = read('pages/store-select/store-select.js')
const storeWxml = read('pages/store-select/store-select.wxml')
const confirmJs = read('pages/package-confirm/package-confirm.js')
const confirmWxml = read('pages/package-confirm/package-confirm.wxml')
const codeJs = read('pages/package-code/package-code.js')
const codeWxml = read('pages/package-code/package-code.wxml')

console.log('\n=== 材料包侧链门禁 ===\n')

// ─────────────────────────────────────────────────────────────────────
console.log('① 列表端点已接入，且只对本人开放')
assert(!exists('utils/package-order.js') === false, 'utils/package-order.js 存在（材料包前端口径的唯一收敛点）')
assert(/getPackageOrders\(\{\s*cursor,\s*pageSize\s*\}\s*=\s*\{\}\)/.test(api),
  'api.js 提供 getPackageOrders({cursor,pageSize})')
assert(/request\('\/orders\/package',\s*\{\s*method:\s*'GET',\s*data,\s*needAuth:\s*true\s*\}\)/.test(api),
  'getPackageOrders 以 GET + needAuth:true 调 /orders/package（本人隔离由服务端 EndUserAuthGuard 保证）')
assert(/if \(config\.USE_MOCK\) return Promise\.reject\(mockUnavailable\('材料包订单'\)\);[\s\S]{0,200}request\('\/orders\/package',\s*\{\s*method:\s*'GET'/.test(api),
  'mock 模式下 getPackageOrders 诚实 unavailable，不返回编造的订单')
// 列表**不**下发 paymentSessionToken / items（服务端刻意如此），前端不得假装有。
assert(!/getPackageOrders[\s\S]{0,600}paymentSessionToken/.test(api),
  'getPackageOrders 不声称返回 paymentSessionToken（列表刻意不发付款令牌，避免一次暴露 N 个）')

// ─────────────────────────────────────────────────────────────────────
console.log('\n② 材料包订单可从本人打印订单重新进入（这是开放整条链的前提）')
assert(ordersJs.includes('api.getPackageOrders('), 'orders.js 调用 api.getPackageOrders')
assert(ordersWxml.includes('bindtap="openPackage"'), 'orders.wxml 有进入材料包到机码页的入口')
assert(/pkgCursor/.test(ordersJs) && /nextCursor/.test(ordersJs),
  'orders.js 为材料包保留独立游标（pkgCursor），不与单件打印的 nextCursor 混用')
// 两个游标混成一个会在触底时推错，静默丢掉一整段订单 —— 用户看到「我的订单少了」，页面一切正常。
{
  // 剥注释后再判：函数里那段「为什么不在这里推材料包游标」的说明本身提到 pkgCursor。
  const ordersCode = stripComments(ordersJs)
  // 只取 onReachBottom **自己的函数体**：固定长度窗口会漏进紧跟其后的
  // loadMorePackages（它本来就该用 pkgCursor），断言于是恒红。
  const reachStart = ordersCode.indexOf('onReachBottom()')
  const reach = ordersCode.slice(reachStart, ordersCode.indexOf('\n  },', reachStart))
  assert(!reach.includes('pkgCursor'), 'onReachBottom 不推进材料包游标（材料包有自己的「加载更多」出口）')
  assert(ordersJs.includes('loadMorePackages()'), '材料包分区有自己的加载更多实现')
}
assert(ordersJs.includes('mergePackageRows'), '材料包分页按 orderId 去重合并，不会把同一张订单渲染两次')
assert(/共 \{\{pkgTotal\}\} 笔/.test(ordersWxml),
  '材料包分区展示服务端 total，不静默截断（页内条数不冒充总数）')
for (const field of ['orderNo', 'amountText', 'fileCount', 'expiresText', 'pickupCode', 'statusDetail']) {
  assert(ordersWxml.includes(`item.${field}`), `材料包卡片展示服务端 ${field}`)
}
// 三个状态字段都要露出来：它们回答的是不同的问题（码还能不能用 / 钱付了没 / 纸出了没）。
// 只显示一个合成状态时，用户和运营都判断不出卡在哪一步。
for (const field of ['pickupStatus', 'payStatus', 'taskStatus']) {
  assert(new RegExp(`statusText\\('[a-z]+', order && order\\.${field}\\)`).test(helper),
    `statusDetail 把服务端 ${field} 也说给用户（不合并成单一状态）`)
}
// 未登记的状态取值必须原样回显 —— 编一个好看的中文等于把没理解的状态说成理解了的。
assert(/hasOwnProperty\.call\(table, raw\) \? table\[raw\] : raw/.test(helper),
  '未登记的状态取值原样回显，不编造中文标签')
// pickupStatus 的 used 是「已付款且已交给一体机」。漏了它，订单会在出纸阶段被判成
// 终态，从「打印中」筛选里整批消失（实测：used + taskStatus:'pending' 会落到兜底分支）。
assert(/pickupStatus === 'used'/.test(helper), "resolvePackageStatus 明确处理 pickupStatus === 'used'")
assert(/used: '已交付打印'/.test(helper), 'used 有自己的中文标签')

// ─────────────────────────────────────────────────────────────────────
console.log('\n③ 凭证不进 URL、不落本机存储')
{
  const openIdx = ordersJs.indexOf('openPackage(e)')
  assert(openIdx > 0, 'orders.js 有 openPackage 实现')
  const openBlock = ordersJs.slice(openIdx, openIdx + 500)
  assert(openBlock.includes('package-code?orderId='), 'openPackage 只带 orderId 进入到机码页')
  for (const field of ['pickupCode', 'amountCents', 'expiresAt', 'paymentSessionToken', 'price']) {
    assert(!openBlock.includes(`${field}=`), `openPackage 不把 ${field} 拼进 URL（转发出去就能在别人手机上渲染带码成功页）`)
  }
}
{
  const navIdx = confirmJs.indexOf("'/pages/package-code/package-code?orderId='")
  assert(navIdx > 0, 'package-confirm 建单后以 orderId 单参跳转到机码页')
  const navBlock = confirmJs.slice(navIdx, navIdx + 400)
  for (const field of ['pickupCode', 'expiresAt', 'amountCents', 'paymentSessionToken', 'storeName']) {
    assert(!navBlock.includes(`${field}=`), `建单跳转 URL 不携带 ${field}`)
  }
}
// package-code 一个凭证性字段都不从 options 读
for (const field of ['pickupCode', 'price', 'expireTime', 'expiresAt', 'fileCount', 'qrCodeUrl', 'totalPrice', 'amountCents', 'paymentSessionToken']) {
  assert(!new RegExp(`options\\.${field}\\b`).test(codeJs),
    `package-code 不从 options.${field} 取值（凭证/金额只能来自服务端）`)
}
assert(/api\.getPackageOrder\s*\(/.test(codeJs), 'package-code 调用 api.getPackageOrder 向服务端核对订单归属')
assert(/loadError/.test(codeJs), 'package-code 有失败态，查不到订单时不静默空白')
{
  const catchBlock = codeJs.slice(codeJs.indexOf('.catch('))
  assert(!/options\./.test(catchBlock), '订单查询失败的分支里不读 options（不得退回 URL 值渲染成功页）')
}
// 到机码与付款令牌都不许写进 storage，也不许在离开页面后留在内存里。
for (const page of CHAIN_PAGES) {
  const src = stripComments(read(`pages/${page}/${page}.js`))
  assert(!/setStorageSync\([^)]*pickup/i.test(src), `${page} 不把到机码写入本机存储`)
  assert(!/paymentSessionToken/.test(src), `${page} 不接触 paymentSessionToken（材料包为到机现场付款，小程序不需要它）`)
}
assert(/onHide\(\)\s*\{[\s\S]{0,120}_clearCredentials\(\)/.test(codeJs) &&
       /onUnload\(\)\s*\{[\s\S]{0,120}_clearCredentials\(\)/.test(codeJs) &&
       /_clearCredentials\(\)\s*\{[\s\S]{0,400}pickupCode:\s*''/.test(codeJs),
  'package-code 离开/切后台时清掉内存里的到机码（共用设备上不让下一位看到上一位的码）')
// 画二维码用的明文副本存在实例字段上，必须和 data 一起清 ——
// 只清 data 的话，切后台再回来那一帧会用上一位用户的码重绘出一张可扫的二维码。
assert(/_clearCredentials\(\)\s*\{[\s\S]{0,400}this\._codeRaw = ''/.test(codeJs),
  'package-code 同时清掉画码用的 _codeRaw 明文副本')
assert(/onShow\(\)\s*\{[\s\S]{0,200}this\.loadOrder\(\)/.test(codeJs),
  '回到 package-code 时重新向服务端取一次（订单可能已核销/过期/换了账号）')

// ─────────────────────────────────────────────────────────────────────
console.log('\n④ 提交载荷与服务端 DTO 一致，前端不计价不报页数')
{
  const submitIdx = confirmJs.indexOf('api.createPackageOrder')
  assert(submitIdx > 0, 'package-confirm 里能找到 api.createPackageOrder 调用点')
  const callBlock = confirmJs.slice(submitIdx, submitIdx + 600)
  for (const field of ['filename', 'pageCount', 'totalAmount', 'amountCents', 'totalPrice', 'billablePages', 'pages']) {
    assert(!new RegExp(`${field}\\s*:`).test(callBlock),
      `createPackageOrder 调用不传 ${field}（白名单 DTO 会整单 400，且计费口径不能由前端左右）`)
  }
  assert(/files\s*=\s*this\.data\.files\.map\(\(f\) => \(\{ fileId: f\.fileId \}\)\)/.test(confirmJs),
    '提交的 files 只含 fileId')
}
// 本地单价乘法在整条链上一次都不许出现（金额只能来自服务端报价 / 下单结果）。
{
  const priceMath = [
    { re: /pricePerPage/, what: 'pricePerPage 本地单价' },
    { re: /colorMode === 'bw' \? 0\.5/, what: '写死的黑白单价 0.5' },
    { re: /totalPages\s*\*\s*/, what: '页数 × 单价的本地乘法' },
  ]
  const hits = []
  for (const page of CHAIN_PAGES) {
    const src = stripComments(read(`pages/${page}/${page}.js`))
    for (const { re, what } of priceMath) if (re.test(src)) hits.push(`${page}: ${what}`)
  }
  assert(hits.length === 0, `四页均无本地计价（命中：${hits.join('；') || '无'}）`)
}
assert(!/pages\s*:\s*1\b/.test(stripComments(createJs)),
  'package-create 不再给文件编一个写死的页数（页数由服务端按真实文件核定）')
assert(createJs.includes('api.getMyDocuments('),
  'package-create 的文件来自服务端 /me/documents（不是 chooseMessageFile 的本地临时 id）')
assert(createJs.includes('api.uploadPrintFile('),
  '新增文件走真实上传拿服务端 fileId')
assert(/fileId: row\.id/.test(createJs),
  '交给下一步的 fileId 是服务端文件 id')
// 报价必须是服务端多行报价，且参数与建单口径一致，否则预览价与实收价会分叉。
assert(confirmJs.includes('api.quotePackageOrder('), 'package-confirm 使用服务端多行报价')
assert(/colorMode === 'color' \? 'color' : 'black_white'/.test(confirmJs) &&
       /duplex === 'double' \? 'double' : 'simplex'/.test(confirmJs),
  '报价参数按服务端 normalizeParams 口径归一（bw→black_white、single→simplex）')
assert(/request\('\/orders\/quote',[\s\S]{0,200}data: \{ terminalId, lines, params \}/.test(api),
  'quotePackageOrder 带 terminalId 走 lines 多行契约（彩色/双面须先证明该机验过，fail-closed）')
assert(!/quotePackageOrder\([\s\S]{0,600}\b(?:pages|billablePages|amountCents)\s*:/.test(confirmJs),
  '报价请求不提交页数或金额')

// ─────────────────────────────────────────────────────────────────────
console.log('\n⑤ 硬编码守卫已移除，关闭判据落在服务端错误码上')
assert(!exists('utils/package-feature.js'),
  'utils/package-feature.js 已删除（硬编码 fail-closed 模块留着就会被 require 回来）')
for (const page of CHAIN_PAGES) {
  const src = stripComments(read(`pages/${page}/${page}.js`))
  assert(!src.includes('guardPackageChain'), `${page} 不再无条件 guard`)
  assert(!src.includes('package-feature'), `${page} 不再引用 package-feature`)
}
// 服务端真实会抛的运行期错误码必须逐个被翻译成用户能照着做的话。
// 少一条就意味着用户在那条路径上只能看到「请稍后重试」，而真正的解法在别处。
for (const code of [
  'PRINT_TERMINAL_OFFLINE',
  'PRINT_TERMINAL_NOT_ACTIVE',
  'PRINT_TERMINAL_NOT_FOUND',
  'CAPABILITY_NOT_CONFIGURED',
  'CAPABILITY_UNAVAILABLE',
  'PRICE_CONFIG_UNAVAILABLE',
  'PRINT_PII_SCAN_REQUIRED',
  'PII_SCAN_STALE',
  'PRINT_FILE_NOT_FOUND',
  'PRINT_FILE_EXPIRED',
  'PRINT_FILE_PURPOSE_UNSUPPORTED',
  'PACKAGE_FILE_DUPLICATED',
  'PACKAGE_ORDER_NOT_FOUND',
]) {
  assert(helper.includes(code), `package-order.js 为 ${code} 准备了用户可执行的说明`)
}
assert(/statusCode === 401/.test(helper), '401 单独成一类（去登录），不混进「请稍后重试」')
assert(/recover: 'store'/.test(helper) && /recover: 'privacy'/.test(helper) &&
       /recover: 'files'/.test(helper) && /recover: 'login'/.test(helper) && /recover: 'orders'/.test(helper),
  '恢复动作覆盖换服务点 / 做隐私检查 / 重选文件 / 去登录 / 去找回订单')
assert(confirmJs.includes('recover(e)') && confirmWxml.includes('data-recover='),
  'package-confirm 把恢复动作真的接到按钮上，不是只显示一句解释')
assert(codeJs.includes('recover(e)') && codeWxml.includes('data-recover='),
  'package-code 把恢复动作真的接到按钮上')
// 服务端会重新核终端心跳与能力；前端预筛不得宣称自己是最终判据。
assert(storeJs.includes('isOnline') && storeWxml.includes('离线 · 暂不可下单'),
  'store-select 按服务端心跳标出离线服务点，不让用户走进已知会被拒的路')
assert(storeWxml.includes('下单时服务端会再核一次终端心跳与打印能力'),
  'store-select 说明服务端仍会再校验一次（前端只是预筛，不是判据）')

// ─────────────────────────────────────────────────────────────────────
console.log('\n⑥ 六态齐全：loading / empty / error / 未登录 / 分页 / 部分失败')
{
  const sixStates = [
    ['orders.wxml', ordersWxml, ['正在加载材料包订单', 'pkgState === \'error\'', '还没有材料包订单', '请先登录小程序', 'pkgLoadingMore']],
    ['package-create.wxml', createWxml, ['正在读取我的文件', 'docState === \'error\'', '还没有可放进材料包的文件', '请先登录小程序', 'docLoadingMore']],
    ['store-select.wxml', storeWxml, ['正在读取服务点', 'state === \'error\'', '本机尚未接入可用服务点', '没有可下单的材料包']],
    ['package-confirm.wxml', confirmWxml, ['正在向服务端核定页数与金额', 'quoteState === \'error\'', '没有可确认的材料包', '请先登录小程序']],
    ['package-code.wxml', codeWxml, ['正在向服务端核对订单', 'loadErrorTitle', '没有可用的到机码']],
  ]
  for (const [name, src, needles] of sixStates) {
    const missing = needles.filter((n) => !src.includes(n))
    assert(missing.length === 0, `${name} 的状态分支齐全（缺：${missing.join(',') || '无'}）`)
  }
}
// 一个来源失败不得让整页订单消失：材料包失败态只写自己的字段。
{
  const catchIdx = ordersJs.indexOf('pkgState: \'error\'')
  const block = catchIdx > 0 ? ordersJs.slice(Math.max(0, catchIdx - 400), catchIdx + 400) : ''
  assert(catchIdx > 0 && !/\borders:\s*\[\]/.test(block) && !/\bfiltered:\s*\[\]/.test(block),
    '材料包加载失败不清空单件打印订单（每个分区独立失败、独立重试）')
  assert(ordersJs.includes('retryPackages()'), '材料包分区有独立重试入口')
}
// 翻页 / 刷新失败也不许把**已经看到的**订单顶掉。
// 判据在两处：append 失败只写 pkgMoreErrorText（不碰 pkgState），
// 且模板里「已有内容」的分支排在「加载中 / 失败」之前。
{
  assert(/if \(append\) \{[\s\S]{0,200}pkgMoreErrorText: shown\.text/.test(ordersJs),
    '材料包翻页失败只写 pkgMoreErrorText，不把已加载的订单换成错误态')
  assert(ordersWxml.includes("pkgState === 'loading' && !pkgRows.length"),
    '材料包「加载中」只在还没有任何订单时整块显示（否则每次下拉刷新都会闪掉列表）')
  assert(ordersWxml.includes('{{loading && !filtered.length}}'),
    '单件打印「加载中」同样只在空列表时整块显示')
  const rowsIdx = ordersWxml.indexOf('wx:elif="{{pkgFiltered.length}}"')
  const errIdx = ordersWxml.indexOf('wx:elif="{{pkgState === \'error\'}}"')
  assert(rowsIdx > 0 && errIdx > rowsIdx, '材料包已有内容的分支排在失败分支之前')
  const singleRowsIdx = ordersWxml.indexOf('wx:elif="{{filtered.length}}"')
  const singleErrIdx = ordersWxml.indexOf('wx:elif="{{error}}"')
  assert(singleRowsIdx > 0 && singleErrIdx > singleRowsIdx, '单件打印已有内容的分支排在失败分支之前')
}
// 换用户必须清干净：共用设备上上一位的材料包列表与到机码不能留在页面数据里。
assert(/_identityKey/.test(ordersJs) && /_resetAll\(\)/.test(ordersJs),
  'orders.js 按会员 id 判断换用户并整体清空两个分区')
assert(/_identityKey/.test(createJs), 'package-create 按会员 id 判断换用户并清空文件列表与草稿')

// ─────────────────────────────────────────────────────────────────────
console.log('\n⑦ 不得出现在线支付，也不得留下只会 404 的死方法')
for (const page of CHAIN_PAGES.concat(['orders'])) {
  const src = stripComments(read(`pages/${page}/${page}.js`))
  assert(!src.includes('wx.requestPayment'), `${page} 不发起 wx.requestPayment（材料包为到机现场付款）`)
}
for (const [label, wxml] of [['package-confirm', confirmWxml], ['package-create', createWxml]]) {
  assert(!/微信支付|余额支付/.test(wxml), `${label} 不展示在线支付方式（这条链没有任何支付闭环）`)
}
assert(!/cancelPackageOrder\s*\([^)]*\)\s*\{/.test(api),
  'cancelPackageOrder 未复活（服务端 PackageOrdersController 只有 @Post()、@Get() 与 @Get(:id)，该调用必得 404）')
assert(!codeJs.includes('/pages/order-detail/order-detail'),
  'package-code 不跳 order-detail（那页读 /me/print-orders/:id，材料包被 requireOwned 过滤掉，点了只会 404）')
{
  const createDoc = api.slice(Math.max(0, api.indexOf('createPackageOrder') - 1200), api.indexOf('createPackageOrder'))
  assert(!/qrCodeUrl\s*[,}]/.test(createDoc), 'createPackageOrder 的 JSDoc 不把 qrCodeUrl 列为返回字段（服务端从不下发）')
  assert(/没有 qrCodeUrl/.test(createDoc), 'createPackageOrder 的 JSDoc 明确写出「没有 qrCodeUrl」，防止有人照旧注释加回来')
  assert(!/filename|pageCount|totalAmount/.test(createDoc.split('@param')[1] || ''),
    'createPackageOrder 的 @param 不再声称可传 filename / pageCount / totalAmount')
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n⑧ 真实边界必须写在用户眼前')
assert(/现场支付|现场付款/.test(helper), 'package-order.js 持有「现场付款」这一真实边界文案')
for (const [label, wxml] of [['package-create', createWxml], ['package-confirm', confirmWxml], ['package-code', codeWxml]]) {
  assert(wxml.includes('onsiteNotice') || /现场支付|现场付款/.test(wxml),
    `${label} 向用户写明「到机器后现场付款」`)
}
assert(confirmWxml.includes('noCancelNotice') && /不支持在线取消/.test(helper),
  '确认页写明材料包不能在线取消、未付款订单会在有效期后失效（服务端没有 cancel 端点）')
// 合规文案白名单：这条链是打印服务，不得出现招聘闭环表述。
for (const [label, wxml] of [['package-create', createWxml], ['store-select', storeWxml], ['package-confirm', confirmWxml], ['package-code', codeWxml], ['orders', ordersWxml]]) {
  const banned = ['一键投递', '立即投递', '平台投递', '企业收简历', '候选人管理', '一键打印材料包'].filter((w) => wxml.includes(w))
  assert(banned.length === 0, `${label} 无违规文案（命中：${banned.join(',') || '无'}）`)
  assert(!wxml.includes('取件码'), `${label} 不把到机码叫「取件码」（那是付款后才生成的另一个码）`)
}

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 条失败\n`)
process.exit(failed === 0 ? 0 : 1)
