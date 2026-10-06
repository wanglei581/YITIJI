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
        a: '小程序读不了 U 盘。U 盘里的文件请带到一体机上导入打印，步骤见「打印」页的「U盘打印指引」；也可以先把文件发到微信聊天里，再在「我的文档」上传后打印。',
      },
      {
        // 原「岗位可以在小程序内直接投递吗？」随岗位页一起停放（首发按非招聘类目提审，
        // compliance-boundary.md §1.1）；拿证恢复岗位页时一并恢复这条合规教育问题。
        id: 'ai',
        q: 'AI 生成的内容可以直接用吗？',
        a: '不建议直接用。AI 结果只是参考，可能有错误；简历里的经历、时间和数字请按你的真实情况逐条核对后再使用。AI 只帮你润色，不会替你编造经历。',
      },
      {
        id: 'model',
        q: 'AI 用的是哪个大模型？',
        a: '所用大模型的名称和备案号写在「AI 服务说明」里，首页底部和「AI 工具」页都能打开。',
      },
      {
        id: 'complain',
        q: '对 AI 生成的内容有异议怎么办？',
        a: '在「意见反馈」里选「AI 内容投诉」，写清是哪个功能、哪段内容有问题，我们在 5 个工作日内答复。',
      },
      {
        // 原答案写「不会提供给任何第三方」，与隐私政策里的受托处理不符；统一改成以隐私政策为准。
        id: 'safe',
        q: '我的简历文件安全吗？',
        a: '你的简历和文件只关联在你本人账号下，通过有时效的链接访问，可以随时删除。个人信息怎么处理、交给哪些受托方，以《隐私政策》为准。',
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
