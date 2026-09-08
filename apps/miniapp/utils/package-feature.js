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
// 这三条属于上线部署与运营配置，须按 docs/device 的部署清单验收后再放开；在此之前四页
// 保持关闭，不让用户走进一条最后一步必然失败的流程。放开时删掉本文件与四处调用即可。

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
