// pages/help/help.js
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    faqs: [
      {
        id: 'pickup',
        q: '打印后多久能取件？',
        a: '文件提交后终端设备确认打印任务，出纸完成后可凭取件码到指定终端取回。',
      },
      {
        id: 'usb',
        q: '手机能直接读取 U 盘吗？',
        a: '部分安卓手机支持 OTG 读取 U 盘。iOS 设备需使用闪存卡读卡器或通过微信文件传输到终端。',
      },
      {
        id: 'apply',
        // 合规教育问题：必须明确告知不支持平台内投递
        q: '岗位可以在小程序内直接投递吗？',
        a: '不可以。本平台为求职材料服务与信息入口，不提供平台内投递功能。请复制真实来源链接后，前往来源平台完成投递。',
      },
      {
        id: 'safe',
        q: '我的简历文件安全吗？',
        a: '你的简历与文件仅保存在你的账户中，使用临时签名 URL 访问，不会提供给任何第三方或招聘方，可随时删除。',
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

  onShareAppMessage() {
    return {
      title: '使用帮助',
      path: '/pages/help/help',
    }
  },
})
