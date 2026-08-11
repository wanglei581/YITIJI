// 我的权益：只读服务端本人权益，不展示未配置的套餐、折扣或虚构会员身份。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')

const STATUS = {
  active: '可用',
  used_up: '已用完',
  expired: '已过期',
  revoked: '已撤销',
}

function toView(item) {
  const total = item.quantityTotal
  const remaining = item.quantityRemaining
  const quantity = total == null ? '按权益规则使用' : `剩余 ${remaining == null ? '—' : remaining} / ${total}`
  const validUntil = item.validUntil ? new Date(item.validUntil) : null
  const validText = validUntil && !Number.isNaN(validUntil.getTime())
    ? `有效至 ${validUntil.getFullYear()}-${String(validUntil.getMonth() + 1).padStart(2, '0')}-${String(validUntil.getDate()).padStart(2, '0')}`
    : '有效期以服务端规则为准'
  return {
    id: item.id,
    title: item.title || '未命名权益',
    description: item.description || '暂无说明',
    status: STATUS[item.status] || item.status || '未知',
    statusKey: item.status || 'unknown',
    quantity,
    validText,
  }
}

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    loadError: '',
    benefits: [],
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/launch/launch' })
      return
    }
    this.loadBenefits()
  },

  loadBenefits() {
    this.setData({ loading: true, loadError: '' })
    api.getMyBenefits({ pageSize: 50 })
      .then((items) => this.setData({ benefits: (items || []).map(toView), loading: false }))
      .catch((err) => this.setData({
        loading: false,
        loadError: (err && err.message) || '加载权益失败，请稍后重试',
      }))
  },

  back() { wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
