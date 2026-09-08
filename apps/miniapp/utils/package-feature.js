// 材料包侧链的统一 fail-closed 守卫。
//
// ⚠️ 2026-09-08 走查更正：本文件原注释称「服务端 POST /orders/package 至今不存在」，
// 这个说法**已经不成立**。实测（本地真实后端 + 真实上传的 PDF）该端点完整可用：
// 隐私检查 → 建单 → 服务端按真实文件核定页数（3页+2页=5页）→ 按价目表算金额（150 分）
// → 签发到机码，GET /orders/package/:id 还有 requireOwned 归属校验（非本人 404、
// 未登录 401）。缺的是 cancel 端点，不是下单能力。
//
// 同轮走查修掉的两个真实缺陷（见 fix/miniapp-package-chain）：
//   1. package-confirm 发的 files 带 filename / pageCount，而服务端 DTO 是白名单校验，
//      必定 400 —— 也就是说这条链此前即便放开也走不通。已改为只发 fileId / pageRange。
//   2. package-code 把到机码、订单号、金额全部从 URL query 读出来就渲染，一条构造出来的
//      链接或一张转发出去的卡片就能显示带到机码的成功页。已改为凭登录态向服务端查，
//      查不到就走失败态，绝不退回 URL 值。
//
// 那么为什么守卫还留着：开放这四页还需要三个**运行期**条件，都不是代码问题，服务端已经
// 各自 fail-closed 地挡着（PRINT_TERMINAL_OFFLINE / PRINT_PII_SCAN_REQUIRED /
// PRICE_CONFIG_UNAVAILABLE）：
//   a. 目标终端 5 分钟内有心跳且本地任务库可用；
//   b. 材料包内每个文件都已完成打印隐私检查；
//   c. 生产环境已配置 print_bw_page / print_color_page 价目。
// 这三条属于上线部署与运营配置，须按 docs/device 的部署清单验收后再放开。
//
// 还有第四条，性质不同 —— 它是**代码缺口**，不是配置：
//   d. 材料包订单目前没有任何列表入口，用户下完单一旦离开就找不回来。
//
// 2026-09-08 实测（本地真实后端，同一会员账号下真单后逐个查）：
//   GET /me/print-orders            → 0 条（查的是 PrintTask 表；材料包订单在派发前
//                                      printTaskId 为 null，因此不在其中）
//   GET /me/print-orders/cloud      → []  （where 带 `sourceFileId: { not: null }`，
//                                      而材料包是多文件、该字段本就为 null）
//   GET /me/print-orders/:orderId   → PRINT_ORDER_NOT_FOUND（requireOwned 同一条过滤）
//   GET /orders/package/:id         → 正常返回（唯一能拿到的入口，但要先有 orderId）
//   PackageOrdersController 只有 @Post() 与 @Get(':id')，**没有 list**。
//
// 这不是 listCloud 写错了：那几个端点是单文件云打印订单的口径，材料包有自己的一套
// （多文件 orderItems、逐文件报价）。两套订单面共用 Order 表但互不可见，缺的是材料包
// 自己的列表端点。
//
// 唯一的例外是「今日提醒」：daily-brief 的 pickupExpiring 不按 sourceFileId 过滤，
// 所以**已付款**且 24 小时内到期的材料包单会出现在那里。**未付款的在任何地方都看不到。**
//
// 为什么这条必须在开闸前解决：package-code 已改成凭 orderId 向服务端查（见
// fix/miniapp-package-chain），用户返回上一页或关掉小程序后，没有任何界面能再给出
// 那个 orderId —— 他手上只剩一个到机码，而到机码不能反查订单。
//
// 在此之前四页保持关闭，不让用户走进一条最后一步必然失败、或者失败后找不回来的流程。
// 放开时：先补材料包订单列表端点与「我的」入口，再删掉本文件与四处调用。

const PACKAGE_UNAVAILABLE_TITLE = '材料包 · 尚未开放'
const PACKAGE_UNAVAILABLE_REASON =
  '材料包在线下单还在等一体机现场配置就绪（打印价目与设备联机），现在下单会在最后一步失败，所以这些页面暂不开放。配置完成后会直接开放。'

/**
 * 命中即拦截并回首页。调用方必须在 onLoad 首行 `if (guardPackageChain()) return`，
 * 让后续 setData 一律不执行 —— 页面不能带着 URL 参数渲染出任何看起来已下单的内容。
 */
function guardPackageChain() {
  wx.showModal({
    title: PACKAGE_UNAVAILABLE_TITLE,
    content: PACKAGE_UNAVAILABLE_REASON,
    showCancel: false,
    confirmText: '知道了',
    complete() {
      // 深链 / 分享进来时没有上一页可退，reLaunch 才能保证一定离开这条链。
      wx.reLaunch({ url: '/pages/home/home' })
    },
  })
  return true
}

module.exports = {
  guardPackageChain,
  PACKAGE_UNAVAILABLE_TITLE,
  PACKAGE_UNAVAILABLE_REASON,
}
