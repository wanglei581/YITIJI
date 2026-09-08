/**
 * 材料包侧链回归门禁（2026-09-08 走查实测后落地）。
 *
 * 钉死两件事，都是实测出来的，不是照现状写的断言：
 *
 * ① package-code 不得从 URL query 读取任何凭证性字段再渲染。
 *    为什么不该存在：到机码是拿去一体机取件的凭证。若它来自 URL，一条构造出来的
 *    链接、或一张转发出去的「创建成功」卡片，就能在别人手机上渲染出一张带码的成功页。
 *    实测（本地真实后端）：改前伪造链接能渲染出 88888888；改后同一条链接显示
 *    「材料包订单不存在」，到机码为空。归属校验在服务端 GET /orders/package/:id
 *    （requireOwned）：非本人 404、未登录 401 —— 前端必须真的去问它。
 *
 * ② package-confirm 提交的 files 不得携带 filename / pageCount。
 *    为什么不该存在：服务端 CreatePackageOrderDto 是白名单校验（forbidNonWhitelisted），
 *    多带字段整单 400。这不是接口疏漏而是刻意的 —— DTO 注释写明「页数、金额与文件名
 *    全部由服务端查证，前端传值不作为事实」，让前端报页数报金额本身就是错的（会成为
 *    计费口径被前端左右的入口）。实测：带 filename/pageCount/totalAmount 调用返回
 *    VALIDATION_FAILED，三个字段逐个被点名。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')

let failed = 0
const assert = (cond, msg) => { if (cond) console.log(`  PASS  ${msg}`); else { failed++; console.log(`  FAIL  ${msg}`) } }

console.log('\n=== 材料包侧链门禁 ===\n')

// ① package-code 的数据来源
console.log('① package-code 只认服务端，不认 URL')
const code = read('pages/package-code/package-code.js')
for (const field of ['pickupCode', 'price', 'expireTime', 'fileCount', 'qrCodeUrl', 'totalPrice', 'amountCents']) {
  const re = new RegExp(`options\\.${field}\\b`)
  assert(!re.test(code), `package-code.js 不从 options.${field} 取值（凭证/金额只能来自服务端）`)
}
assert(/api\.getPackageOrder\s*\(/.test(code), 'package-code.js 调用 api.getPackageOrder 向服务端核对订单')
assert(/loadError/.test(code), 'package-code.js 有失败态，查不到订单时不静默空白')
// 查不到订单时绝不能回退 URL 值
const catchBlock = code.slice(code.indexOf('.catch('))
assert(!/options\./.test(catchBlock), '订单查询失败的分支里不读 options（不得退回 URL 值渲染成功页）')

// ② package-confirm 的提交载荷
console.log('\n② package-confirm 提交载荷与服务端 DTO 一致')
const confirm = read('pages/package-confirm/package-confirm.js')
// 锚点必须落在**提交路径**那个 files 上：本文件里 `const files =` 出现多次，
// 取第一处会检到只做展示统计的那个块，断言就成了摆设（这条门禁自己踩过）。
const submitIdx = confirm.indexOf('api.createPackageOrder')
assert(submitIdx > 0, 'package-confirm.js 里能找到 api.createPackageOrder 调用点')
const filesIdx = confirm.lastIndexOf('const files =', submitIdx)
assert(filesIdx > 0 && submitIdx - filesIdx < 1200, '提交调用前能定位到它使用的 files 构造块')
const filesBlock = confirm.slice(filesIdx, submitIdx)
for (const field of ['filename', 'pageCount', 'totalAmount']) {
  assert(!new RegExp(`${field}\\s*:`).test(filesBlock), `提交的 files 不含 ${field}（服务端白名单会整单 400，且金额页数须由服务端查证）`)
}
// 提交调用体本身也不得夹带这些字段
const callBlock = confirm.slice(submitIdx, submitIdx + 500)
for (const field of ['totalAmount', 'amountCents', 'totalPrice']) {
  assert(!new RegExp(`${field}\\s*:`).test(callBlock), `createPackageOrder 调用不传 ${field}（计费口径不能由前端左右）`)
}
// 跳转 URL 不得携带凭证
const navBlock = confirm.slice(confirm.indexOf("'/pages/package-code/package-code'"), confirm.indexOf("'/pages/package-code/package-code'") + 600)
for (const field of ['pickupCode', 'expireTime', 'price', 'qrCodeUrl']) {
  assert(!navBlock.includes(field + '='), `跳转 package-code 的 URL 不携带 ${field}（下一页自己去服务端查）`)
}

// ③ 不得留下只会 404 的死方法
console.log('\n③ api.js 不留指向不存在端点的方法')
const api = read('utils/api.js')
const cancelCall = /cancelPackageOrder\s*\([^)]*\)\s*\{/.test(api)
assert(!cancelCall, 'cancelPackageOrder 已移除（服务端 PackageOrdersController 只有 @Post() 与 @Get(:id)，该调用必得 404）')
// 只禁「把 qrCodeUrl 当成返回字段列出来」这种形态（`qrCodeUrl,` / `qrCodeUrl }`），
// 不禁 JSDoc 里那句「注意没有 qrCodeUrl」的否定说明 —— 那句正是要留下的。
const createDoc = api.slice(Math.max(0, api.indexOf('createPackageOrder') - 1200), api.indexOf('createPackageOrder'))
assert(!/qrCodeUrl\s*[,}]/.test(createDoc), 'createPackageOrder 的 JSDoc 不把 qrCodeUrl 列为返回字段（服务端从不下发）')
assert(/没有 qrCodeUrl/.test(createDoc), 'createPackageOrder 的 JSDoc 明确写出「没有 qrCodeUrl」，防止有人照旧注释加回来')
assert(!/filename|pageCount|totalAmount/.test(createDoc.split('@param')[1] || ''), 'createPackageOrder 的 @param 不再声称可传 filename / pageCount / totalAmount')

// ④ 守卫仍在，且不再谎称接口不存在
console.log('\n④ 守卫状态与文案')
const guard = read('utils/package-feature.js')
assert(/function guardPackageChain/.test(guard), '守卫仍然存在（开放还需终端联机/隐私检查/价目配置三个运行期条件）')
assert(!/下单接口尚未上线/.test(guard.split('const PACKAGE_UNAVAILABLE_REASON')[1] || ''), '守卫给用户的文案不再谎称「服务端下单接口尚未上线」（该端点实测可用）')
for (const p of ['package-create', 'store-select', 'package-confirm', 'package-code']) {
  assert(/guardPackageChain/.test(read(`pages/${p}/${p}.js`)), `${p} 仍在 onLoad 调用守卫`)
}

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 条失败\n`)
process.exit(failed === 0 ? 0 : 1)
