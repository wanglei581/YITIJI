// pages/package-code/package-code.js
const app = getApp()
const { guardPackageChain } = require('../../utils/package-feature')
const api = require('../../utils/api')

/**
 * 有效期展示。服务端下发的是 ISO 串（2026-09-09T10:29:15.155Z），直接塞进模板会让
 * 用户看到 `2026-09-09T10:` 这种半截技术串。小程序端没有 Intl 完整支持，按本地时间
 * 手工拼「MM-DD HH:mm」，解析失败时返回空串（模板里 expireTime 为空即不显示该行），
 * 绝不把原始串兜底显示出去。
 */
function formatExpire(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = n => (n < 10 ? '0' + n : String(n))
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

Page({
  data: {
    // 默认 false：模板里的「材料包创建成功」是写死的，必须等守卫放行后才允许渲染。
    ready: false,
    loading: false,
    loadError: '',
    statusBarHeight: 20,
    pickupCode: '',
    orderId: '',
    fileCount: 0,
    storeName: '',
    expireTime: '',
    totalPrice: '0.00',
  },

  onLoad(options) {
    if (guardPackageChain()) return
    const orderId = options.orderId ? decodeURIComponent(options.orderId) : ''
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      orderId,
      // storeName 只是显示补充，不是凭证；仍要等服务端确认订单存在才渲染整页。
      storeName: options.storeName ? decodeURIComponent(options.storeName) : '',
    })
    this.loadOrder()
  },

  /**
   * 到机码、金额、有效期一律向服务端查，不从 URL 读。
   *
   * `GET /orders/package/:id` 带 requireOwned 归属校验：非本人的订单返回 404
   * PACKAGE_ORDER_NOT_FOUND（连存在性都不泄漏），未登录返回 401。因此一条构造出来的
   * 链接、或一张转发给别人的卡片，都渲染不出任何到机码 —— 这正是本页此前最大的洞。
   */
  loadOrder() {
    const { orderId } = this.data
    if (!orderId) {
      this.setData({ ready: false, loading: false, loadError: '订单信息缺失，请重新下单' })
      return
    }
    this.setData({ loading: true, loadError: '' })
    api.getPackageOrder(orderId)
      .then(order => {
        this.setData({
          ready: true,
          loading: false,
          pickupCode: order.pickupCode || '',
          fileCount: Array.isArray(order.items) ? order.items.length : 0,
          expireTime: formatExpire(order.expiresAt),
          totalPrice: ((Number(order.amountCents) || 0) / 100).toFixed(2),
        })
      })
      .catch(err => {
        // 不把服务端错误体当文案（utils/user-error.js 的判据），也绝不在查不到订单时
        // 退回 URL 里的值渲染成功页 —— 那等于把洞原样留着。
        const isMissing = err && (err.statusCode === 404 || err.statusCode === 401)
        this.setData({
          ready: false,
          loading: false,
          loadError: (err && err.message) || (isMissing ? '未找到该订单，或该订单不属于当前账号' : '订单信息加载失败，请稍后重试'),
        })
      })
  },

  retryLoad() {
    this.loadOrder()
  },

  goBack() {
    wx.navigateBack()
  },

  viewOrder() {
    const { orderId } = this.data
    if (!orderId) return
    wx.navigateTo({ url: '/pages/order-detail/order-detail?orderId=' + encodeURIComponent(orderId) })
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/home' })
  },

  copyCode() {
    wx.setClipboardData({
      data: this.data.pickupCode,
      success() { wx.showToast({ title: '到机码已复制', icon: 'success' }) }
    })
  },

  copyOrderId() {
    wx.setClipboardData({
      data: this.data.orderId,
      success() { wx.showToast({ title: '订单号已复制', icon: 'success' }) }
    })
  },

  // 不提供 onShareAppMessage：这页原本可以把「材料包创建成功」当作分享标题转发出去，
  // 而收到的人打开的是一张没有任何订单支撑的成功页。功能真正开放前不恢复分享。
})
