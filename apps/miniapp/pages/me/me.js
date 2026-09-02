// pages/me/me.js
const app = getApp()
const auth = require('../../utils/auth')
const api = require('../../utils/api')

function countFromResult(res) {
  if (!res) return '—'
  if (typeof res.total === 'number') return String(res.total)
  if (Array.isArray(res)) return String(res.length)
  if (Array.isArray(res.items)) return String(res.items.length)
  return '—'
}

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
      { id: 'ai',        icon: 'robot',     title: 'AI 服务记录',   sub: '服务端实际任务记录',   accent: 'cyan'  },
      { id: 'favorites', icon: 'inbox',     title: '我的收藏',      sub: '岗位、招聘会与政策',   accent: 'teal'  },
      { id: 'reminders', icon: 'bell',      title: '招聘会提醒',    sub: '仅保存在本机，换设备不同步', accent: 'clay'  },
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
    const loggedIn = auth.isLoggedIn()
    this.setData({ isLoggedIn: loggedIn, user: loggedIn ? auth.getUser() : null })
    if (loggedIn) {
      Promise.all([
        api.getMyResumes({ pageSize: 1 }).catch(() => null),
        api.getMyDocuments({ pageSize: 1 }).catch(() => null),
        api.getMyPrintOrders({ pageSize: 1 }).catch(() => null),
      ]).then(function(results) {
        this.setData({
          stats: [
            { key: 'resume', label: '简历',   value: countFromResult(results[0]) },
            { key: 'docs',   label: '文档',   value: countFromResult(results[1]) },
            { key: 'order',  label: '打印单', value: countFromResult(results[2]) },
          ],
        })
      }.bind(this)).catch(function() {})
    } else {
      this.setData({
        stats: [
          { key: 'resume', label: '简历',   value: '—' },
          { key: 'docs',   label: '文档',   value: '—' },
          { key: 'order',  label: '打印单', value: '—' },
        ],
      })
    }
  },

  tapEntry(e) {
    const id = e.currentTarget.dataset.id
    const routes = {
      resume:     '/pages/resumes/resumes',
      docs:       '/pages/documents/documents',
      orders:     '/pages/orders/orders',
      ai:         '/pages/ai-records/ai-records',
      favorites:  '/pages/favorites/favorites',
      reminders:  '/pages/fair-reminders/fair-reminders',
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
      title: '职易达 · 我的',
      path: '/pages/me/me',
    }
  },
})
