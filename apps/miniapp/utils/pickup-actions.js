// utils/pickup-actions.js
// 到机码的三个动作：复制、分享给代取人、作废换新码（产品负责人 9/25 拍板第 5 条：
// 取件码可以给别人代取，一次性、7 天有效、可以作废重发）。单件打印取件页与材料包到机码页共用。
//
// 边界：
//   - 复制与分享的都是**原始码**（未分组的 8 位）。服务端核销只 trim + 大写、不去分隔符，
//     带横杠的串到别处粘贴会核不上（见 package-code.js copyCode 的注释）。
//   - 分享图上只有：码、二维码、网点名、有效期、怎么取。不放文件名、姓名、手机号、金额 ——
//     与服务端订单详情的 share 载荷同一口径（member-print-order-create.service.ts）。
//   - 分享不经过我们的服务器：图在本机画好，由微信自己的分享菜单发给好友。
//   - 作废换新码走 POST /me/print-orders/:orderId/reissue-pickup-code（单件与材料包同一端点），
//     旧码立即失效，截止时间不变；能不能换由服务端判定，页面只如实转述。

const api = require('./api')
const { createPickupQrMatrix, normalizePickupCode } = require('./pickup-qrcode')
const { userMessageOf } = require('./user-error')

const CARD_W = 600
const CARD_H = 840

/** 在 2d 画布上画一张码（白底 + 深色模块，留 4 格静区）。页面上的码和分享图共用这一份。 */
function paintQr(context, matrix, size, x, y) {
  const ox = x || 0
  const oy = y || 0
  context.fillStyle = '#FFFFFF'
  context.fillRect(ox, oy, size, size)
  const quietZone = 4
  const cellSize = Math.floor(size / (matrix.length + quietZone * 2))
  const drawSize = cellSize * (matrix.length + quietZone * 2)
  const offset = Math.floor((size - drawSize) / 2)
  context.fillStyle = '#15100C'
  matrix.forEach((row, r) => row.forEach((dark, c) => {
    if (dark) {
      context.fillRect(ox + offset + (c + quietZone) * cellSize, oy + offset + (r + quietZone) * cellSize, cellSize, cellSize)
    }
  }))
}

function grouped(raw) {
  const groups = String(raw || '').match(/.{1,2}/g)
  return groups ? groups.join('-') : ''
}

/** 给代取人的一段话（分享图画不出来时复制这段，用户自己粘到微信里）。 */
function shareText(info) {
  const lines = [`职易达到机码：${info.code}`]
  if (info.outlet) lines.push(`取件网点：${info.outlet}`)
  if (info.expiresText) lines.push(`${info.expiresText}前有效，用一次就失效`)
  lines.push('到一体机首页点「到机码核销」，输入上面的码或扫码取件。')
  return lines.join('\n')
}

function copyCode(raw) {
  const code = normalizePickupCode(raw)
  if (!code) return
  wx.setClipboardData({
    data: code,
    success() { wx.showToast({ title: '到机码已复制', icon: 'success' }) },
  })
}

function copyShareText(info) {
  wx.setClipboardData({
    data: shareText(info),
    success() {
      wx.showModal({
        title: '代取说明已复制',
        content: '去微信里粘贴发给代取人。拿到码的人就能取件；不想让对方取了，回这一页作废换新码。',
        showCancel: false,
        confirmText: '知道了',
      })
    },
  })
}

function drawCard(page, info) {
  return new Promise((resolve, reject) => {
    wx.createSelectorQuery().in(page).select('#pickup-share-card').fields({ node: true, size: true }).exec((res) => {
      const target = res && res[0]
      if (!target || !target.node) { reject(new Error('share canvas missing')); return }
      const canvas = target.node
      const ctx = canvas.getContext('2d')
      canvas.width = CARD_W
      canvas.height = CARD_H
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, CARD_W, CARD_H)
      ctx.fillStyle = '#2354E6'
      ctx.fillRect(0, 0, CARD_W, 12)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = '#131A2A'
      ctx.font = 'bold 34px sans-serif'
      ctx.fillText('职易达 · 到机取件码', CARD_W / 2, 78)
      ctx.font = 'bold 60px sans-serif'
      ctx.fillText(grouped(info.code), CARD_W / 2, 164)
      paintQr(ctx, createPickupQrMatrix(info.code), 360, (CARD_W - 360) / 2, 200)
      ctx.fillStyle = '#5A6478'
      ctx.font = '26px sans-serif'
      let y = 610
      if (info.outlet) { ctx.fillText(`取件网点：${info.outlet}`, CARD_W / 2, y); y += 44 }
      if (info.expiresText) { ctx.fillText(`${info.expiresText}前有效，用一次就失效`, CARD_W / 2, y); y += 44 }
      ctx.fillText('到一体机首页点「到机码核销」', CARD_W / 2, y); y += 40
      ctx.fillText('把二维码对准扫码器，或手动输入上面的码', CARD_W / 2, y)
      wx.canvasToTempFilePath({
        canvas,
        fileType: 'png',
        success: (r) => resolve(r.tempFilePath),
        fail: () => reject(new Error('取件图没有生成，请再试一次')),
      })
    })
  })
}

/**
 * 分享给代取人：画一张取件图，用微信的分享图片菜单发给好友；画不出来或微信版本太旧，
 * 就退回「复制代取说明」，不假装分享成功。
 * @param page 页面实例（分享图画在页面里一块藏在屏幕外的 2d 画布上）
 * @param info {{ code: string, outlet?: string, expiresText?: string }} code 为原始码
 */
function shareToProxy(page, info) {
  const code = normalizePickupCode(info && info.code)
  if (!code) return
  const payload = { code, outlet: info.outlet || '', expiresText: info.expiresText || '' }
  if (typeof wx.showShareImageMenu !== 'function') { copyShareText(payload); return }
  wx.showLoading({ title: '正在生成', mask: true })
  drawCard(page, payload).then((path) => {
    wx.hideLoading()
    wx.showShareImageMenu({ path, fail(e) {
      // 用户自己关掉菜单不算失败
      if (e && e.errMsg && e.errMsg.indexOf('cancel') >= 0) return
      copyShareText(payload)
    } })
  }, () => {
    wx.hideLoading()
    copyShareText(payload)
  })
}

/**
 * 作废当前到机码、换一个新码。先让用户确认后果，再请服务端换。
 * @returns {Promise<object|null>} 服务端回的最新订单详情；用户取消返回 null；失败 reject（带用户话）
 */
function reissue(orderId) {
  return new Promise((resolve) => {
    wx.showModal({
      title: '作废并换新码',
      content: '旧码马上失效，已经发给别人的也不能再用。新码的有效期和原来一样，不会延长。',
      confirmText: '换新码',
      cancelText: '先不换',
      success: (r) => resolve(!!(r && r.confirm)),
      fail: () => resolve(false),
    })
  }).then((go) => {
    if (!go) return null
    wx.showLoading({ title: '正在换码', mask: true })
    return api.reissuePickupCode(orderId).then((order) => {
      wx.hideLoading()
      wx.showToast({ title: '已换成新码', icon: 'success' })
      return order
    }, (err) => {
      wx.hideLoading()
      const e = new Error(err && err.code === 'PICKUP_CODE_NOT_REISSUABLE'
        ? '这张码现在不能换：可能已在机器上核销、已开始出纸或已过期。页面会重新读取最新状态。'
        : userMessageOf(err, '这一次没换成，旧码仍然有效。请稍后再试。'))
      e.code = err && err.code
      throw e
    })
  })
}

module.exports = { paintQr, shareText, copyCode, shareToProxy, reissue }
