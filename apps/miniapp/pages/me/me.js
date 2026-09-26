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
    // 胶囊右让。2026-09-03 实测：本页顶栏右侧按钮**整个落在微信胶囊矩形内**
    // （390pt 上胶囊 [296,383]，按钮 [329,374]），用户点不到，而模拟器截图看不出来
    // ——胶囊是系统绘制的另一层。值由 app.js 运行时按 getMenuButtonBoundingClientRect 算，
    // 不能在 wxss 里写死：胶囊位置随机型与系统版本变。
    capsuleInsetRight: 94,
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
      // 我的收藏 / 招聘会提醒 / 浏览与跳转记录只装岗位、招聘会、企业、政策四类内容，
      // 「我的权益」首发不对 AI 收费、先收起：四页随岗位招聘会政策页一起停放
      // （首发按非招聘类目提审，compliance-boundary.md §1.1）。
      { id: 'feedback',  icon: 'comment',   title: '意见反馈与投诉', sub: '提交后可看处理进度',   accent: 'cyan'  },
      { id: 'settings',  icon: 'setting',   title: '账号设置',      sub: '手机号、隐私与登录',   accent: 'slate' },
    ],
  },

  onLoad() {
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      capsuleInsetRight: app.globalData.capsuleInsetRight || 94,
    })
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
      feedback:   '/pages/feedback/feedback',
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
