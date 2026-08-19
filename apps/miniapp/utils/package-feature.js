// 材料包侧链的统一 fail-closed 守卫。
//
// package-create / store-select / package-confirm / package-code 这四页在 2026-08-18 随
// 职业生活圈改版一起进仓库（a1a771252），但服务端 `POST /orders/package` 至今不存在。
// 正常点击流会在最后一步 404，弹「提交失败」，走不到成功页 —— 入口侧（pages/ai/ai.js 的
// pending 列表）也已经诚实标注未开放。
//
// 真正的洞在页面这一侧：这些页面被深链或分享卡片直接打开时不校验任何东西。
// package-code 把到机码、订单号、金额全部从 URL query 读出来就渲染，于是一条构造出来的
// 链接（或一张转发出去的「创建成功」卡片）就能显示一张带到机码的成功页；用户拿这个码
// 去一体机，只会得到 PICKUP_CODE_INVALID。
//
// 因此守卫放在每页 onLoad 首行，而不是靠入口不放链接。开放条件是服务端下单接口上线，
// 届时删掉本文件与四处调用即可，页面业务逻辑不用动。

const PACKAGE_UNAVAILABLE_TITLE = '材料包 · 尚未开放'
const PACKAGE_UNAVAILABLE_REASON =
  '服务端下单接口尚未上线，现在无法真实创建材料包订单，也无法生成可用的到机码，所以这些页面暂不开放。接口上线后会直接开放。'

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
