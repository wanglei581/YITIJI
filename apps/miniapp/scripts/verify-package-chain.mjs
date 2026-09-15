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
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// page-guard.js 是纯函数模块（不依赖 wx / auth），可以在本门禁里**真跑一遍**。
// 正则只能证明"某段守卫代码存在"，证明不了状态机的判定本身是对的。
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))
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
{
  // 定长窗口 `[\s\S]{0,200}` 在这里第二次咬人了：onShow 里多写几行注释就会把
  // `loadOrder()` 顶出窗口，断言在一段没变坏的代码上转红。取配对闭合的函数体。
  const bare = stripComments(codeJs)
  const at = bare.indexOf('onShow() {')
  const body = at < 0 ? '' : bare.slice(at, bare.indexOf('\n  },', at))
  assert(body.includes('this.loadOrder()'),
    '回到 package-code 时重新向服务端取一次（订单可能已核销/过期/换了账号）')
  // 但身份**只判一次**：判完还无条件再调一次 loadOrder，会让 loadOrder 自己那次判定
  // 对上"快照已清空"，把 B 判成 'ok'，于是拿**上一位的 orderId** 用 B 的 token 发请求
  //（服务端 requireOwned 必然 404），并把刚写好的「账号已切换」覆盖成 loading。
  assert(/_enforceIdentity\(\) === 'changed'\) return/.test(body),
    'package-code onShow 判成换人就到此为止，不得再调 loadOrder')
}

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
// ⚠ 本条 2026-09-15 改写。它此前钉的是
//   `/duplex === 'double' \? 'double' : 'simplex'/`
// —— 也就是把缺陷本身当成了验收标准：`'double'` 在服务端**两个 DTO 里都不存在**
// （报价 PrintJobParamsDto ∈ simplex|duplex_long_edge|duplex_short_edge，
//  建单 PackagePrintParamsDto 额外多一个 single），选了双面的材料包在报价那一步
// 就必然 400。门禁照着现状抄，于是这条链一边红都不红地坏了整整一轮。
// 现在改钉「必须经同一个 wire 映射出去」，并在 ⑩ 段正面禁掉 'double'。
assert(/colorMode: pkg\.toWireColorMode\(/.test(confirmJs) && /duplex: pkg\.toWireDuplex\(/.test(confirmJs),
  '报价参数经 pkg.toWireColorMode / toWireDuplex 归一到服务端 DTO 真正接受的取值')
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
assert(/_identityKey\(\)/.test(ordersJs) && /_resetAll\(\)/.test(ordersJs),
  'orders.js 按会员 id 判断换用户并整体清空两个分区')
assert(/_identityKey\(\)/.test(createJs) && /_resetForIdentity\(\)/.test(createJs),
  'package-create 按会员 id 判断换用户并清空文件列表与草稿')

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

// ─────────────────────────────────────────────────────────────────────
// ⑨ 身份生命周期与请求代次：迟到的响应不得污染新身份、不得复活已清掉的凭证
//
// 本段钉的是**机制存在**，真正证明"旧响应写不进来"的是
// scripts/tests/page-lifecycle.test.mjs（真跑页面生命周期与乱序 resolve）。
// 两者缺一不可：静态断言防止有人把守卫顺手删掉，真执行测试防止守卫写了但不生效。
//
// 为什么必须有这一层（2026-09-15 修的 P1/P2）：
//   - `loading` 布尔锁只能挡"并发发起第二次"，挡不住"迟到的第一次"——
//     请求发出时锁是开的，回调执行时早被别的路径清掉了。
//   - package-code 的 onHide 已经清了凭证，但在途的 getPackageOrder 回来时
//     页面已重新 activate，它会把刚清掉的到机码原样写回去，码就这么"复活"。
//   - 同一条链重复刷新时旧响应晚到，会把已经核销的终态改回"待到机"，
//     用户拿着一张作废的码去机器前。
console.log('\n⑨ 身份快照 + 请求代次 + 生命周期：迟到的响应不得落地')
{
  const GUARDED_PAGES = ['orders', 'package-create', 'package-confirm', 'package-code']
  // 会显示到机码 / 会落一张带钱订单的页：判据必须是账号状态机，不能是"上一次读到的身份键"。
  // 后者把「同一个人的 JWT 自然过期」（getToken() 过期时先 clearSession，'u:A' → ''）
  // 与「主动登出」判成同一件事 —— 前者当场清码且一个请求都不发，静默补签永远跑不到；
  // 建单页更狠：订单已在服务端建成，页面却不锁 orderId 还解开按钮 = 第二张订单、第二笔钱。
  const ACCOUNT_STATE_PAGES = ['package-code']
  assert(exists('utils/page-guard.js'),
    'utils/page-guard.js 存在（三层判据的唯一实现：身份快照 / 代次 / 逐通道序号）')
  const guardSrc = read('utils/page-guard.js')
  for (const api of ['setIdentity', 'deactivate', 'issue', 'accepts', 'isActive']) {
    assert(new RegExp(`\\b${api}\\s*\\(`).test(guardSrc), `page-guard 提供 ${api}()`)
  }
  // deactivate 必须 +1 代次。只置 active=false 不够：切回来会重新 activate，
  // 后台期间发出的响应就又"合法"了 —— 到机码正是这么复活的。
  assert(/deactivate\(\)\s*\{[\s\S]{0,200}generation \+= 1/.test(guardSrc),
    'page-guard.deactivate() 递增代次（只置 active=false 挡不住切回前台后的迟到响应）')
  assert(/setIdentity\([\s\S]{0,400}generation \+= 1/.test(guardSrc),
    'page-guard.setIdentity() 变化时递增代次（换人即作废上一位的在途请求）')
  // 逐通道 latest-wins：重复刷新时旧响应不得覆盖新响应。
  assert(/latest\[token\.channel\] !== token\.seq/.test(guardSrc),
    'page-guard.accepts() 只认本通道最新一次请求（latest-wins，旧响应不得覆盖终态）')
  // 身份这一层必须**在回调执行那一刻重读**，不能只依赖 onHide 先触发 ——
  // 会话被后端判失效时页面还停在前台，onHide 根本不会来。
  assert(/arguments\.length > 1 && normalize\(currentIdentity\) !== token\.identity/.test(guardSrc),
    'page-guard.accepts() 逐字比对回调时刻的当前身份（不依赖任何生命周期回调先触发）')

  // ── R5：账号状态机。把「同一个人的 JWT 自然过期」与「主动登出 / 换人」分开 ──
  //
  // 这两件事在 token 维度上完全同形（getToken() 过期时先 clearSession，token 与 user
  // 一起没）。唯一能分开它们的是 RESIGNIN_ELIGIBLE：clearSession() 不动它，只有
  // auth.logout() 撤销它。判据一旦退回"有没有 token"或"身份键变没变"，两个方向都会错：
  //   合成"都算登出" → 取件页当场清掉一张服务端还认的码，且一个请求都不发（补签跑不到）；
  //   合成"都算过期" → 主动登出的人会被自动登回来（共用设备上的隐私问题）。
  for (const api of ['resolveAccountState', 'sameAccount', 'adoptIdentity']) {
    assert(new RegExp(`\\b${api}\\s*\\(`).test(guardSrc), `page-guard 提供 ${api}()`)
  }
  assert(/function resolveAccountState[\s\S]{0,900}auth\.canSilentResignin\(\)/.test(guardSrc),
    "resolveAccountState 用 canSilentResignin（RESIGNIN_ELIGIBLE）区分自然过期与主动登出")
  assert(/function resolveAccountState[\s\S]{0,900}getToken\(/.test(guardSrc) === false,
    'resolveAccountState 不拿 token 当判据（token 在两种情况下同形）')
  {
    // 真执行一遍：静态正则证明不了状态机本身是对的。
    const guard = requireMiniapp('./page-guard.js')
    const authOf = (id, eligible) => ({
      isLoggedIn: () => !!id,
      getUser: () => (id ? { id } : null),
      canSilentResignin: () => eligible,
    })
    const cases = [
      ['自然过期（快照仍是本人、补签资格还在）', authOf(null, true), 'u:A', 'resignable', 'u:A'],
      ['主动登出（补签资格已撤销）', authOf(null, false), 'u:A', 'changed', ''],
      ['换了人', authOf('B', true), 'u:A', 'changed', ''],
      ['补签成功后写回同一位', authOf('A', true), 'u:A', 'ok', 'u:A'],
      ['过期时打开页面（还没显示过任何本人数据）', authOf(null, true), '', 'resignable', ''],
      ['从没登录过', authOf(null, false), '', 'unusable', ''],
    ]
    for (const [label, a, snapshot, state, account] of cases) {
      const got = guard.resolveAccountState(a, snapshot)
      assert(got.state === state && got.account === account,
        `resolveAccountState：${label} → ${state}/${account || "''"}（实得 ${got.state}/${got.account || "''"}）`)
    }
    // 登录着却拿不到会员 id：一律不给补签资格（那是一个认不出人的会话）。
    const idless = { isLoggedIn: () => true, getUser: () => ({}), canSilentResignin: () => true }
    assert(guard.resolveAccountState(idless, 'u:A').state === 'changed'
      && guard.resolveAccountState(idless, '').state === 'unusable',
    'resolveAccountState：登录了却没有会员 id 一律 fail-closed，不许补签')
    // sameAccount 只放行"发起时没会话 → 回调时补签成功"这一个方向。
    assert(guard.sameAccount('', 'u:A') && guard.sameAccount('u:A', 'u:A')
      && !guard.sameAccount('u:A', 'u:B') && !guard.sameAccount('u:A', ''),
    'sameAccount 只放行 "" → u:<id> 这一种升级，不放行反向与换人')
    // adoptIdentity 只在 '' → u:<id> 时不 +1 代次；其余一律退回 setIdentity。
    const g1 = guard.createLifecycleGuard()
    g1.activate()
    const gen0 = g1.generation()
    assert(g1.adoptIdentity('u:A') === true && g1.generation() === gen0,
      'adoptIdentity：补签升级不得 +1 代次（作废掉的正是那条刚被救回来的响应）')
    assert(g1.adoptIdentity('u:B') === true && g1.generation() === gen0 + 1,
      'adoptIdentity：换人时必须退回 setIdentity 并 +1 代次，不许被当成升级')
  }

  for (const page of GUARDED_PAGES) {
    const src = stripComments(read(`pages/${page}/${page}.js`))
    assert(src.includes("require('../../utils/page-guard')"), `${page} 接入 page-guard`)
    assert(/_guard\.issue\(/.test(src), `${page} 发请求前领代次令牌`)
    assert(/_accepts\(token\)|_sameIdentity\(token\)/.test(src), `${page} 在回调里用令牌判定能不能写 data`)
    // 只取函数**自己的**函数体。用固定长度窗口会漏进紧跟其后的 onUnload，
    // 于是"把 onHide 里的 deactivate 删掉"这条变异检测不出来（2026-09-15 实测过：
    // 删掉后本断言仍然 PASS，只有真执行测试判红）。
    for (const hook of ['onHide', 'onUnload']) {
      const start = src.indexOf(`${hook}() {`)
      const body = start < 0 ? '' : src.slice(start, src.indexOf('\n  },', start))
      assert(body.includes('_guard.deactivate()'), `${page} ${hook} 作废在途请求`)
    }
    // 身份判据只许有 page-guard 那一份实现。凭证页 / 建单页走的是它上面那层
    // **账号状态机**（resolveAccountState），别的页仍直接用 memberIdentityKey。
    // 两者都在 page-guard 里，不得每页再抄一份。
    assert(ACCOUNT_STATE_PAGES.includes(page)
      ? /resolveAccountState\(auth, this\._account\)/.test(src)
      : /_identityKey\(\)\s*\{[\s\S]{0,200}memberIdentityKey\(auth\)/.test(src),
    `${page} 的身份快照走 page-guard 的唯一实现（三态 fail-closed）`)
  }

  // package-code：凭证页的判定比别人多两条 —— 必须认订单，必须先 deactivate 再清。
  {
    const src = stripComments(codeJs)
    assert(/_accepts\(token\)\s*\{[\s\S]{0,300}token\.orderId !== this\.data\.orderId/.test(src),
      'package-code 的令牌带 orderId，另一张订单的响应覆盖不了当前这张')
    const hideIdx = src.indexOf('onHide()')
    const hideBlock = src.slice(hideIdx, src.indexOf('\n  },', hideIdx))
    assert(hideBlock.indexOf('_guard.deactivate()') < hideBlock.indexOf('_clearCredentials()'),
      'package-code onHide 先 deactivate 再清凭证（否则迟到的响应会把刚清掉的码写回来）')
    // setData 的回调在下一帧，这中间可能已经 onHide：动 _codeRaw 之前必须再核一次。
    assert(/if \(!this\._accepts\(token\)\) return\s*\n\s*this\._codeRaw =/.test(src),
      'package-code 在 setData 回调里再核一次才写 _codeRaw（画码用的明文副本）')
    assert(/exec\(\(result\) => \{[\s\S]{0,200}_guard\.isActive\(\)/.test(src),
      'package-code 画码的 exec 回调也检查页面是否仍在前台（不在就不画、也不报 ready）')
  }

  // 草稿必须绑定稳定身份：temp_package_data 是本机存储，同一台手机上谁都读得到。
  {
    const create = stripComments(createJs)
    assert(/setStorageSync\('temp_package_data',\s*\{[\s\S]{0,200}ownerKey/.test(create),
      'package-create 写草稿时绑定 ownerKey（派生自 auth.getUser().id）')
    assert(/setStorageSync\('temp_package_data',\s*\{[\s\S]{0,200}draftId/.test(create),
      'package-create 写草稿时带 draftId（让已选服务点能跟这份草稿对上）')
    assert(/_resetForIdentity\(\)\s*\{[\s\S]{0,700}removeStorageSync\('temp_package_data'\)[\s\S]{0,200}removeStorageSync\('temp_selected_store'\)/.test(create),
      '换用户时草稿与已选服务点一起清（只清一半会留下带着上一位文件名的半截草稿）')

    const confirm = stripComments(confirmJs)
    // 未登录一律不解析草稿：否则深链直进本页就能把上一位留下的文件名渲染出来。
    assert(/_loadOrderData\(\)\s*\{[\s\S]{0,500}const identity = this\._identityKey\(\)[\s\S]{0,300}if \(!isMemberIdentity\(identity\)\)[\s\S]{0,200}return/.test(confirm),
      'package-confirm 先验身份可用再碰草稿（未登录、或登录但无 id，都不解析、不渲染文件名）')
    assert(/ownerKey !== identity[\s\S]{0,300}removeStorageSync\('temp_package_data'\)/.test(confirm),
      'package-confirm 发现草稿不属于本人时**同步删除**（留着等于把洞原样留给下一次打开）')
    assert(/storeData\.draftId[\s\S]{0,120}packageData\.draftId/.test(confirm),
      'package-confirm 核对服务点与草稿的 draftId（不把上一份草稿选的机器接到这一份上）')
    assert(/_clearDraftView\(\)\s*\{[\s\S]{0,600}files: \[\]/.test(confirm),
      'package-confirm 进 missing 时把 files 一起清空（只改 draftState 仍可能渲染出旧文件名）')

    const store = stripComments(storeJs)
    assert(/setStorageSync\('temp_selected_store',\s*\{[\s\S]{0,240}ownerKey/.test(store),
      'store-select 写服务点时绑定 ownerKey')
    assert(/setStorageSync\('temp_selected_store',\s*\{[\s\S]{0,240}draftId/.test(store),
      'store-select 写服务点时绑定 draftId')
    assert(/draft\.ownerKey \|\| ''\) !== identity/.test(store),
      'store-select 不把服务点接到不属于当前这位的草稿上')
  }

  // 真执行测试必须存在并接线。少了它，上面全部退化成"代码长得像"。
  assert(exists('scripts/tests/page-lifecycle.test.mjs'),
    '生命周期/竞态的真执行测试存在（静态断言证明不了"旧响应真的写不进来"）')
  {
    const pkgJson = JSON.parse(read('package.json'))
    assert(/page-lifecycle\.test\.mjs/.test(pkgJson.scripts['verify:page-lifecycle'] || ''),
      'verify:page-lifecycle 指向该测试')
    assert(/verify:page-lifecycle/.test(pkgJson.scripts['verify:static'] || ''),
      'verify:page-lifecycle 串在 verify:static 里（CI 直接跑 verify:static）')
  }
}


// ─────────────────────────────────────────────────────────────────────
// ⑩ 打印参数：发出去的取值必须是服务端 DTO 真正接受的那一组
//
// 判据不取自本仓库前端的现状，取自服务端两个 @IsIn 白名单：
//   报价 services/api/src/print-jobs/dto/create-print-job.dto.ts
//        duplex ∈ simplex | duplex_long_edge | duplex_short_edge
//        colorMode ∈ black_white | color
//   建单 services/api/src/member-print-orders/dto/create-package-order.dto.ts
//        duplex ∈ single | simplex | duplex_long_edge | duplex_short_edge
//        colorMode ∈ bw | black_white | color
// 交集就是这里钉的那一组。UI 的 'double' / 'bw' 只能活在页面 data 里，不许上线路。
console.log('\n⑩ 打印参数取值与服务端 DTO 白名单一致')
{
  const WIRE_DUPLEX = ['simplex', 'duplex_long_edge', 'duplex_short_edge']
  assert(/const PACKAGE_WIRE_DUPLEX_MODES = \['simplex', 'duplex_long_edge', 'duplex_short_edge'\]/.test(helper),
    `package-order.js 登记的 wire 取值就是服务端白名单的交集（${WIRE_DUPLEX.join(' / ')}）`)
  assert(/toWireDuplex\(uiDuplex\)[\s\S]{0,300}'double' \? 'duplex_long_edge' : 'simplex'/.test(helper),
    'toWireDuplex 把 UI 的 double 映射成 duplex_long_edge（口径来自 packages/shared 的 normalizeDuplex，不是本文件新定的）')
  assert(/toWireColorMode\(uiColorMode\)[\s\S]{0,200}'color' \? 'color' : 'black_white'/.test(helper),
    'toWireColorMode 归一到 black_white / color（报价 DTO 不接受 bw）')

  // 报价与建单必须同源：各写一份映射迟早会出现「按一种参数报价、按另一种参数计价」。
  const confirmCode = stripComments(confirmJs)
  const quoteIdx = confirmCode.indexOf('function quoteParams(')
  const quoteBlock = quoteIdx >= 0 ? confirmCode.slice(quoteIdx, confirmCode.indexOf('\n}', quoteIdx)) : ''
  assert(quoteBlock.includes('pkg.toWireDuplex(') && quoteBlock.includes('pkg.toWireColorMode('),
    '报价参数经同一对 wire 映射函数出去')
  const createIdx = confirmCode.indexOf('api.createPackageOrder(')
  const createBlock = createIdx >= 0 ? confirmCode.slice(createIdx, createIdx + 700) : ''
  assert(createBlock.includes('pkg.toWireDuplex(') && createBlock.includes('pkg.toWireColorMode('),
    '建单参数经**同一对**函数出去（与报价逐字同源）')

  // 正面禁令：四页的代码里不许再出现把 UI 取值直接当 wire 值发的写法。
  for (const page of CHAIN_PAGES) {
    const src = stripComments(read(`pages/${page}/${page}.js`))
    assert(!/duplex:\s*'double'/.test(src), `${page} 不把 'double' 当打印参数发出去（服务端两个 DTO 都不接受）`)
    assert(!/duplex:\s*(this\.)?_packageData\.duplex/.test(src),
      `${page} 不把 UI 的单双面取值原样透传给服务端`)
  }
}

// ─────────────────────────────────────────────────────────────────────
// ⑪ 身份三态：登录了但拿不到会员 id 一律 fail-closed
//
// `'u:' + (user.id || '')` 会在 id 缺失时退化成 `'u:'` —— 一个**所有 id 缺失会话
// 共享**的键。共用设备上两个人先后遇到这种会话，第二个人会拿第一个人的 ownerKey
// 对上草稿，直接读到别人的文件名；请求代次也会认为「没换人」，于是上一位在途的
// 响应照常写进来。所以 id 缺失必须与「未登录」、与任何真实会员都不相等。
console.log('\n⑪ 身份三态 fail-closed（未登录 / 无 id / 正常）')
{
  const guardSrc = read('utils/page-guard.js')
  assert(/function memberIdentityKey\(auth\)/.test(guardSrc), 'page-guard 提供 memberIdentityKey(auth)')
  // 判据是会员 id 而不是 token：token 每次登录都换，同一个人重登不该被判成换人。
  assert(/function memberIdentityKey\(auth\)[\s\S]{0,400}auth\.getUser\(\)/.test(guardSrc),
    '身份快照取自 auth.getUser().id（不是 token —— 同一个人重登不该清空他自己的数据）')
  assert(!/function memberIdentityKey\(auth\)[\s\S]{0,400}getToken\(/.test(guardSrc),
    'memberIdentityKey 不拿 token 当身份')
  assert(/if \(!id\) return IDENTITY_UNUSABLE/.test(guardSrc),
    'id 缺失时返回不可用哨兵，而不是退化成所有人共享的 "u:"')
  assert(/function isMemberIdentity\(key\)[\s\S]{0,240}key\.length > 2/.test(guardSrc),
    'isMemberIdentity 拒绝空串、哨兵与裸 u:')
  for (const page of ['orders', 'package-create', 'package-confirm', 'store-select']) {
    const src = stripComments(read(`pages/${page}/${page}.js`))
    assert(/memberIdentityKey\(auth\)/.test(src), `${page} 的身份键来自 page-guard.memberIdentityKey`)
    assert(!/'u:' \+ String\(/.test(src), `${page} 不再自己拼 'u:' + id（那会在 id 缺失时退化成共享键）`)
    assert(/isMemberIdentity\(/.test(src), `${page} 用 isMemberIdentity 判定身份能不能用`)
  }
  const pickupSrc = stripComments(read('pages/print-pickup/print-pickup.js'))
  assert(/resolveAccountState\(auth, this\._account\)/.test(pickupSrc) && /isMemberIdentity\(/.test(pickupSrc),
    'print-pickup 也按同一套身份判据（账号状态机 + 三态身份键，都在 page-guard 里）')
  // 到机码页与建单页都不得自己制造补签资格，也不得把账号快照落地。
  for (const [label, rel] of [['print-pickup', 'pages/print-pickup/print-pickup.js'],
    ['package-code', 'pages/package-code/package-code.js'],
    ['print-pay', 'pages/print-pay/print-pay.js']]) {
    const src = stripComments(read(rel))
    assert(!/RESIGNIN_ELIGIBLE|resignin_eligible/.test(src),
      `${label} 不得直接碰补签资格标记（它是 auth 的持久判据，页面造得出来就等于自己给自己发通行证）`)
    assert(/this\._account/.test(src) && !/storage\.set\(|setStorageSync/.test(src),
      `${label} 的账号快照只放内存，不落本机存储`)
  }
}

// ─────────────────────────────────────────────────────────────────────
// ⑫ 单件取件页：到机码与金额不经 URL（与材料包同一口径）
console.log('\n⑫ 单件取件页只带 orderId')
{
  const ordersCode = stripComments(ordersJs)
  const primaryIdx = ordersCode.indexOf('primary(e)')
  const primaryBlock = primaryIdx >= 0 ? ordersCode.slice(primaryIdx, ordersCode.indexOf('\n  },', primaryIdx)) : ''
  assert(primaryBlock.includes('print-pickup?'), 'orders.js 有进入取件页的实现')
  for (const field of ['pickupCode', 'amountCents', 'expiresAt', 'taskStatus', 'orderNo', 'paymentSessionToken']) {
    assert(!primaryBlock.includes(`${field}=`), `进入取件页的 URL 不携带 ${field}`)
  }
  assert(/orderId=\$\{encodeURIComponent\(item\.orderId\)\}&source=orders/.test(primaryBlock),
    '只带 orderId（source 只是返回路径提示，不是凭证也不是状态）')

  const pickupSrc = stripComments(read('pages/print-pickup/print-pickup.js'))
  for (const field of ['pickupCode', 'expiresAt', 'amountCents', 'taskStatus', 'orderNo', 'paymentSessionToken']) {
    assert(!new RegExp(`q\\.${field}\\b`).test(pickupSrc),
      `print-pickup 不从 URL 读 ${field}（凭证与本人订单状态只能来自服务端）`)
  }
  assert(/api\.getCloudPrintOrder\(/.test(pickupSrc),
    'print-pickup 带登录态向服务端回读本人订单（GET /me/print-orders/:orderId，requireOwned）')
  assert(/normalizePickupCode\(order\.pickupCode\)/.test(pickupSrc),
    '码只认服务端这一次给的值（|| this.data.codeRaw 会让已撤码的订单继续显示旧码）')
}

// ─────────────────────────────────────────────────────────────────────
// ⑬ 守卫不得制造解不开的锁，也不得替用户预先同意协议
console.log('\n⑬ 锁状态、草稿归属与协议同意')
{
  const createCode = stripComments(createJs)
  const confirmCode = stripComments(confirmJs)

  assert(/isMemberIdentity\(previous\) && previous !== identity/.test(createCode),
    'package-create 只在「从另一个确定会员身份切换」时才清空（首次进入 / 刚登录不算换人）')
  assert(/_dropForeignDraft\(\)/.test(createCode),
    'package-create 另有一条只清「别人的草稿」的路径，不误伤本人的')
  assert(/function draftFingerprint\(/.test(createCode) && /draftId = draftFingerprint\(/.test(createCode),
    'draftId 由内容指纹算出（时间戳会让「退回来再继续」每次都丢掉已选服务点）')
  assert(/previousStore\.draftId \|\| ''\) !== draftId/.test(createCode),
    '只在服务点确实对不上当前草稿时才清它')
  assert(/if \(append\) \{[\s\S]{0,260}docMoreErrorText: shown\.text/.test(createCode),
    'package-create 翻页失败只写 docMoreErrorText，不把 docState 打成 error（那会顶掉整段文件列表）')
  assert(read('pages/package-create/package-create.wxml').includes('docMoreErrorText'),
    '模板真的渲染了 docMoreErrorText（只写进 data 不渲染等于没说）')
  assert(/docLoadingMore && !this\._guard\.accepts\(this\._docsToken\)/.test(createCode),
    '切后台作废翻页请求后，回前台要解开 docLoadingMore（否则「加载更多」永远点不动）')

  const sameIdIdx = confirmCode.indexOf('if (!this._sameIdentity(token)) return')
  const afterSameId = sameIdIdx >= 0 ? confirmCode.slice(sameIdIdx, sameIdIdx + 400) : ''
  assert(sameIdIdx >= 0 && afterSameId.includes("removeStorageSync('temp_package_data')"),
    '建单成功后**先判身份再清草稿**（换人时不得删掉当前这位的草稿）')
  assert(/fail: \(\) => this\._lockAfterCreated\(orderId\)/.test(confirmCode),
    'redirectTo 失败有兜底（不接住的话页面永远停在「提交中…」，而订单其实已经建好了）')
  assert(/_lockAfterCreated\(orderId\)\s*\{[\s\S]{0,700}submitting: false/.test(confirmCode),
    '兜底状态解开 submitting')
  assert(/if \(this\._createdOrderId\) \{ this\._lockAfterCreated\(this\._createdOrderId\); return \}/.test(confirmCode),
    '已建过单就不再 POST 第二次（服务端 CreatePackageOrder 没有幂等键）')
  assert(/_loadQuote\(\)\s*\{[\s\S]{0,240}if \(this\._createdOrderId\) return/.test(confirmCode),
    '建单之后不再核价（再变 ready 等于把「确认下单」重新点亮）')
  assert(/quoteState === 'loading'\s*\n\s*&& !this\._guard\.accepts\(this\._quoteToken\)/.test(confirmCode),
    'onShow 只在「在途报价确已作废」时才重发（只看 quoteState 会让首次进入连报两次价）')

  assert(/_sameIdentity\(token\)/.test(stripComments(ordersJs)),
    'orders 的取消链按身份判定（用 active 判定会把这一行锁死在「取消中…」）')

  assert(/agreedToTerms: false/.test(confirmCode),
    '《打印服务协议》默认不勾选（本仓库同类口径：pages/launch/launch.js 的 agreed: false）')
  assert(confirmWxml.includes('我已阅读并同意') && confirmWxml.includes('viewTerms'),
    '模板确实是一份「已阅读并同意 + 可查看原文」的法律同意，不是普通确认')

  const codeCode = stripComments(codeJs)
  assert(/_enforceIdentity\(\)\s*\{[\s\S]{0,500}this\._clearCredentials\(\)/.test(codeCode),
    'package-code 发现身份变化时当场清掉凭证（request.js 续签失败会 auth.logout()，全程没有生命周期回调）')
  assert(/_accepts\(token\)\s*\{\s*const state = this\._enforceIdentity\(\)/.test(codeCode),
    '每个异步回调都先**执行**一遍身份判定（不是只查询它）')
  assert(/state === 'changed' \|\| state === 'unusable'\) \{/.test(codeCode),
    "只有 'changed' / 'unusable' 才拒收；'resignable'（同一个人的 JWT 自然过期）必须放行，否则补签救回来的响应也进不来")
  // 补签**失败**那条路：request.js 补签不成时 auth.logout() 撤销资格，回调这一刻从
  // 'resignable' 掉成 'unusable'。这一跳里快照始终是 ''，**不算换人**，所以 changed
  // 分支不会执行 —— 没有任何人把 loading 写回 false，屏幕上留下一个既没有请求在跑
  // 也没有出口的圈。
  assert(/if \(state === 'unusable'\) this\._failClosedForIdentity\(token\)/.test(codeCode),
    "package-code 'unusable' 时必须把页面从 loading 里解出来，不能只 return")
  assert(/_failClosedForIdentity\(token\)\s*\{\s*if \(token && !this\._guard\.accepts\(token\)\) return/.test(codeCode),
    '只在这条请求仍是本页当前那一条时才写错误态（切后台与 latest-wins 各有接手路径，写了会顶掉人家的 loading）')
  assert(/loading: false/.test(codeCode) && /loadRecover: 'login'/.test(codeCode),
    'fail-closed 态写 loading:false 并给出可执行的登录出口')
  assert(/sameAccount\(token\.identity, this\._account\)/.test(codeCode),
    '账号那一层走 page-guard.sameAccount（逐字比对会把"发起时刚过期、回调时补签成功"判成换人）')
  assert(/identityState === 'unusable'/.test(codeCode) && !/identityState !== 'ok'/.test(codeCode),
    "loadOrder 不得把 'resignable' 和 'unusable' 一起拦掉（那是一页转不完的 loading）")
  assert(/loading: true, ready: false/.test(codeCode),
    '重新加载时把 ready 打回 false（模板里 loading 与成功块是两个独立 wx:if，会同时显示）')
  assert(/this\._codeRaw !== code\) return/.test(codeCode),
    '画码的 exec 回调绑定当时那个码（迟到的回调不得把旧码的画布说成新码已就绪）')
  assert(/data: this\._codeRaw,/.test(codeCode),
    '复制的是原始到机码（服务端 claim 只 trim().toUpperCase()，不去分隔符）')
}

// ⑫ R4 收口：三处「代码看着都在、顺序一换就漏」的守卫
//
// 这一组每条都对应一个真实可复现的后果，不是照现状抄：
console.log('\n⑫ R4 身份 / 代次收口')
{
  const createCode = stripComments(createJs)
  const confirmCode = stripComments(confirmJs)

  // ① 选择一变，在途的隐私检查与逐条确认必须当场作废。
  //    只把 piiPhase 打回 idle 挡不住已经发出去的那两条递归链：它们照常跑到最后
  //    并把 piiPhase 写成 'ready'，于是新加勾的文件从没扫过，createPackage 的
  //    `piiPhase !== 'ready'` 闸门却直接放行 —— 一个会被服务端拒的"已就绪"。
  assert(/_syncSelection\(\)\s*\{[\s\S]{0,400}issue\('pii'\)[\s\S]{0,120}issue\('pii-decide'\)/.test(createCode),
    '选择变化时同通道重新 issue，作废在途的 pii / pii-decide（latest-wins）')
  assert(/_syncSelection\(\)\s*\{[\s\S]{0,600}piiSubmitting: false/.test(createCode),
    '作废确认链的同时解开 piiSubmitting（被作废的链不会再走到解锁那一行）')

  // ② 建单成功 / 失败的迟到响应都必须**先判身份**。顺序反过来，
  //    A 的订单号会写进 B 的 _createdOrderId，把 B 的页面永久锁成「订单已创建」。
  // 只看 submitOrder 那条链，不看全文件：`_lockAfterCreated` 里也有一条同样的赋值，
  // 按全文件判会永远命中它，断言就变成恒真（那是一条测不出任何东西的门禁）。
  const createIdx = confirmCode.indexOf('api.createPackageOrder(')
  const chain = createIdx >= 0 ? confirmCode.slice(createIdx, createIdx + 1200) : ''
  const guardIdx = chain.indexOf('if (!this._sameIdentity(token)) return')
  const assignIdx = chain.indexOf('this._createdOrderId = orderId')
  assert(createIdx >= 0 && guardIdx > 0 && assignIdx > guardIdx,
    '建单成功回调里 `_createdOrderId = orderId` 排在身份判定之后（换人时一个字节都不写）')
  assert(/catch\(\(err\) => \{[\s\S]{0,400}if \(!this\._sameIdentity\(token\)\) return[\s\S]{0,200}if \(this\._createdOrderId\)/.test(confirmCode),
    '建单失败回调同样先判身份再谈锁（迟到的失败不得锁死新用户）')
  assert(/_resetForIdentity\(\)\s*\{[\s\S]{0,200}this\._createdOrderId = null[\s\S]{0,200}submitting: false[\s\S]{0,120}agreedToTerms: false/.test(confirmCode),
    '身份切换时建单锁 / 提交锁 / 协议同意一起复位（协议同意是本人行为，不得继承）')
  assert(/setIdentity\(this\._identityKey\(\)\)\) \{[\s\S]{0,200}this\._resetForIdentity\(\)/.test(confirmCode),
    'onShow 发现身份变化时真的调用了 _resetForIdentity（写了不接线等于没写）')

  // ③ 《打印服务协议》：链接不得靠 label 冒充勾选，按钮 disabled 与提交守卫一致。
  //    label 包住 checkbox 时，label 内任意点击都会切换它 —— "点开协议看一眼"
  //    会被同时记成"我已阅读并同意"，而这份同意用户从没做过。
  const labelBlock = /<label class="agreement-label">[\s\S]*?<\/label>/.exec(confirmWxml)
  assert(!!labelBlock && !labelBlock[0].includes('viewTerms'),
    '《打印服务协议》链接在 <label> 之外（label 内点击会把同意一起勾上）')
  assert(confirmWxml.includes('bindtap="viewTerms"'),
    '协议原文仍然可查看（不能因为挪出 label 就把入口弄丢）')
  assert(/disabled="\{\{quoteState !== 'ready' \|\| !agreedToTerms \|\| submitting\}\}"/.test(confirmWxml),
    '提交按钮 disabled 与 submitOrder 守卫逐条对齐（报价就绪 + 已同意 + 不在提交中）')
  assert(/if \(!this\.data\.agreedToTerms\)/.test(confirmCode),
    'submitOrder 里的协议守卫仍在（按钮变灰不是唯一防线）')
  assert(confirmWxml.includes('agreement-hint'),
    '未勾协议时说清主按钮为什么是灰的（disabled 后 bindtap 不触发，没有提示用户只会反复点）')
}

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 条失败\n`)
process.exit(failed === 0 ? 0 : 1)
