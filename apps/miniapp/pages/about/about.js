// pages/about/about.js
const app = getApp()

// 四份文档都在后台「法务文档」发布，法务页按类型读取（C1）。
const LEGAL_TYPES = {
  terms: 'terms_of_service',
  privacy: 'privacy_policy',
  ai: 'ai_disclaimer',
  operator: 'operator_info',
}

Page({
  data: {
    statusBarHeight: 20,
    links1: [
      { id: 'terms',   title: '用户服务协议' },
      { id: 'privacy', title: '隐私政策' },
    ],
    links2: [
      { id: 'ai',       title: 'AI 服务说明', sub: '所用模型与备案情况' },
      { id: 'operator', title: '经营者信息', sub: '名称、证照与联系方式' },
    ],
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  back() { wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },

  tapLink(e) {
    const type = LEGAL_TYPES[e.currentTarget.dataset.id]
    if (type) wx.navigateTo({ url: `/pages/legal/legal?type=${type}` })
  },

  onShareAppMessage() {
    return {
      title: '关于职易达',
      path: '/pages/about/about',
    }
  },
})
