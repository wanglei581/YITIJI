// pages/ai/ai.js
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    tools: [
      { id: 'diagnose', icon: 'file-search', title: '简历诊断', desc: '逐条给出问题与依据', accent: 'plum' },
      { id: 'optimize', icon: 'edit',        title: '简历优化', desc: '改写前后对照可选用', accent: 'teal' },
      { id: 'interview', icon: 'comment',    title: '模拟面试', desc: '按岗位出题并复盘', accent: 'clay' },
      { id: 'plan',      icon: 'compass',    title: '职业规划', desc: '方向建议仅供参考', accent: 'wheat' },
      { id: 'match',     icon: 'link',       title: '岗位匹配', desc: '三档参考，不代表录用结果', accent: 'plum' },
    ],
    services: [
      { id: 'print',     icon: 'printer', title: '打印服务', desc: '选本人文档、终端与打印参数' },
      { id: 'documents', icon: 'folder',  title: '我的文档', desc: '管理材料并再次发起打印' },
      { id: 'usb',       icon: 'printer', title: 'U盘打印指引', desc: '查看现场导入与打印步骤' },
      { id: 'orders',    icon: 'history', title: '打印订单', desc: '查看到机码与出纸状态' },
      { id: 'kiosk',     icon: 'scan',    title: '扫码登录一体机', desc: '快速连接现场服务终端' },
    ],
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
  },

  tapTool(e) {
    const { id } = e.currentTarget.dataset
    const routes = {
      diagnose:  '/pages/resume-diagnose/resume-diagnose',
      optimize:  '/pages/resume-optimize/resume-optimize',
      interview: '/pages/interview-entry/interview-entry',
      plan:      '/pages/career-plan/career-plan',
      match:     '/pages/job-fit/job-fit',
    }
    const url = routes[id]
    if (url) {
      wx.navigateTo({ url })
    }
  },

  tapChat() {
    wx.navigateTo({ url: '/pages/assistant/assistant' })
  },

  tapService(e) {
    const { id } = e.currentTarget.dataset
    const routes = {
      print:     '/pages/print/print',
      documents: '/pages/documents/documents',
      usb:       '/pages/usb-import/usb-import',
      orders:    '/pages/orders/orders',
      kiosk:     '/pages/kiosk-login/kiosk-login',
    }
    const url = routes[id]
    if (url) wx.navigateTo({ url })
  },

  toRecords() {
    wx.navigateTo({ url: '/pages/ai-records/ai-records' })
  },

  onShareAppMessage() {
    return {
      title: 'AI百宝箱 · 求职与材料工具',
      path: '/pages/ai/ai',
    }
  },
})
