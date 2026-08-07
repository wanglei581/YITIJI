// pages/privacy/privacy.js
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    // 隐私开关为本地占位状态；接后端后由 GET/PUT /api/v1/me/privacy 同步
    toggles: {
      autoClean: true,   // 敏感文件自动清理
      delSource: false,  // 打印后自动删除源文件
      aiResume: true,    // 允许 AI 使用简历优化建议
      reco: true,        // 个性化信息推荐
    },
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  toggle(e) {
    const key = e.currentTarget.dataset.key
    const toggles = { ...this.data.toggles, [key]: !this.data.toggles[key] }
    this.setData({ toggles })
    // TODO 接后端：PUT /api/v1/me/privacy
  },

  cyclePeriod() {
    // TODO 接后端：清理周期选择
    wx.showToast({ title: '清理周期设置即将上线', icon: 'none', duration: 1500 })
  },

  exportData() {
    // TODO 接后端：POST /api/v1/me/export → 生成临时签名下载链接
    wx.showToast({ title: '数据导出即将上线', icon: 'none', duration: 1500 })
  },

  deleteAccount() {
    wx.showModal({
      title: '注销账号',
      content: '注销后你的简历、文档与服务记录将被删除且不可恢复。系统将保留必要的删除日志以满足合规要求。',
      confirmText: '我要注销',
      confirmColor: '#b5643c',
      success: (r) => {
        if (r.confirm) {
          // 不伪造注销结果：真实注销需服务端多重校验
          // TODO 接后端：POST /api/v1/me/deactivate（双验证 + 删除日志）
          wx.showToast({ title: '账号注销即将上线', icon: 'none', duration: 1600 })
        }
      },
    })
  },
})
