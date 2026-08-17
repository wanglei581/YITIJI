// pages/me/me.js
const app = getApp()
const auth = require('../../utils/auth')

Page({
  data: {
    statusBarHeight: 20,
    isLoggedIn: false,
    user: null,
    // 概览计数（真实数据接入前为占位 0，不伪造已完成状态）
    stats: [
      { key: 'resume', label: '简历', value: '—' },
      { key: 'docs',   label: '文档', value: '—' },
      { key: 'order',  label: '打印单', value: '—' },
    ],
    entries: [
      { id: 'resume',    icon: 'file-text', title: '我的简历',      sub: '本人上传与 AI 处理记录', accent: 'plum'  },
      { id: 'docs',      icon: 'folder',    title: '我的文档',      sub: '可再次发起打印',       accent: 'teal'  },
      { id: 'orders',    icon: 'printer',   title: '打印订单',      sub: '到机码与出纸状态',     accent: 'clay'  },
      { id: 'ai',        icon: 'robot',     title: 'AI 服务记录',   sub: '服务端实际任务记录',   accent: 'plum'  },
      { id: 'favorites', icon: 'inbox',     title: '我的收藏',      sub: '岗位、招聘会与政策',   accent: 'teal'  },
      { id: 'activity',  icon: 'history',   title: '浏览与跳转记录', sub: '仅记录本人浏览与跳转', accent: 'wheat' },
      { id: 'membership',icon: 'crown',     title: '我的权益',      sub: '查看本人实际权益记录', accent: 'wheat' },
      { id: 'settings',  icon: 'setting',   title: '账号设置',      sub: '手机号、隐私与登录',   accent: 'slate' },
    ],
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
    // 每次显示时刷新登录态（从 launch 登录回来时 onShow 触发）
    const loggedIn = auth.isLoggedIn()
    this.setData({ isLoggedIn: loggedIn, user: loggedIn ? auth.getUser() : null })
  },

  tapEntry(e) {
    const id = e.currentTarget.dataset.id
    const routes = {
      resume:     '/pages/resumes/resumes',
      docs:       '/pages/documents/documents',
      orders:     '/pages/orders/orders',
      ai:         '/pages/ai-records/ai-records',
      favorites:  '/pages/favorites/favorites',
      activity:   '/pages/browse-history/browse-history',
      membership: '/pages/membership/membership',
      settings:   '/pages/settings/settings',
    }
    if (routes[id]) wx.navigateTo({ url: routes[id] })
  },

  tapLogin() {
    // 开屏即进首页,登录延后到「我的」触发:打开微信登录/手机号登录页
    wx.navigateTo({ url: '/pages/launch/launch' })
  },

  tapNotify() {
    wx.navigateTo({ url: '/pages/notifications/notifications' })
  },

  onShareAppMessage() {
    return {
      title: '智引答 · 我的',
      path: '/pages/me/me',
    }
  },
})
