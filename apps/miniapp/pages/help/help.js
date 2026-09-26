// pages/help/help.js
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    faqs: [
      {
        id: 'pickup',
        q: '打印后多久能取件？',
        a: '文件提交后会生成到机码；到所选终端选择「到机码核销」扫码或手输核销，终端确认打印任务后开始出纸，出纸完成即可现场取走。',
      },
      {
        id: 'usb',
        q: '手机能直接读取 U 盘吗？',
        a: '部分安卓手机支持 OTG 读取 U 盘。iOS 设备需使用闪存卡读卡器或通过微信文件传输到终端。',
      },
      {
        // 原「岗位可以在小程序内直接投递吗？」随岗位页一起停放（首发按非招聘类目提审，
        // compliance-boundary.md §1.1）；拿证恢复岗位页时一并恢复这条合规教育问题。
        id: 'ai',
        q: 'AI 生成的内容可以直接用吗？',
        a: '不建议直接用。AI 结果只是参考，可能有错误；简历里的经历、时间和数字请按你的真实情况逐条核对后再使用。AI 只帮你润色，不会替你编造经历。',
      },
      {
        id: 'safe',
        q: '我的简历文件安全吗？',
        a: '你的简历与文件仅保存在你的账户中，使用临时签名 URL 访问，不会提供给任何第三方，可随时删除。',
      },
    ],
    openId: null,
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  back() { wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },

  toggleFaq(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ openId: this.data.openId === id ? null : id })
  },

  askAI() {
    // 跳到 AI 助手 tab
    wx.switchTab({ url: '/pages/ai/ai' })
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' })
  },

  onShareAppMessage() {
    return {
      title: '使用帮助',
      path: '/pages/help/help',
    }
  },
})
