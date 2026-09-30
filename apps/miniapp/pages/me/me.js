// pages/me/me.js
const app = getApp()
const auth = require('../../utils/auth')
const api = require('../../utils/api')

function countFromResult(res) {
  if (!res) return '—'
  if (typeof res.display === 'string') return res.display
  if (typeof res.total === 'number') return String(res.total)
  if (Array.isArray(res)) return String(res.length)
  if (Array.isArray(res.items)) return String(res.items.length)
  return '—'
}

function countNumber(res) {
  if (!res) return null
  if (typeof res.total === 'number') return res.total
  if (Array.isArray(res)) return res.length
  if (Array.isArray(res.items)) return res.items.length
  return null
}

// 服务端 listCloud 一次最多回这么多条手机单，且不带总数。
const CLOUD_ORDER_LIST_CAP = 50

/**
 * 打印单 = 取件后的打印任务（getMyPrintOrders，有 total）+ 还没到机的手机单（getMyCloudPrintOrders）。
 * 两段互不重叠：服务端 listCloud 只列 printTaskId 为空的单，取件后就只在前一段里。
 * 只数前一段时，手机下了单还没去取、或过期没取的人会看到「打印单 0」，而订单页里明明有（走查 9/30，王堃）。
 * 手机单那段满上限时不装精确，写成「N+」。任一段没读到就整项失败，不拿半个数冒充总数。
 */
function loadOrderCount() {
  return Promise.all([api.getMyPrintOrders({ pageSize: 1 }), api.getMyCloudPrintOrders()]).then(function(r) {
    const tasks = countNumber(r[0])
    const cloud = countNumber(r[1])
    if (tasks == null || cloud == null) throw new Error('打印单数量读取不完整')
    const sum = tasks + cloud
    return { display: cloud >= CLOUD_ORDER_LIST_CAP ? sum + '+' : String(sum) }
  })
}

const STAT_DEFS = [
  { key: 'resume', label: '简历',   load: function() { return api.getMyResumes({ pageSize: 1 }) } },
  { key: 'docs',   label: '文档',   load: function() { return api.getMyDocuments({ pageSize: 1 }) } },
  { key: 'order',  label: '打印单', load: loadOrderCount },
]

function blankStats() {
  return STAT_DEFS.map(function(d) { return { key: d.key, label: d.label, value: '—' } })
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
    // 概览计数：「—」= 还不知道（读取中或没读到），不写成 0。
    stats: blankStats(),
    statsFailed: false,
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
      this.loadStats(STAT_DEFS.map(function(d) { return d.key }))
    } else {
      this._statsSeq = (this._statsSeq || 0) + 1
      this._failedStatKeys = []
      this.setData({ stats: blankStats(), statsFailed: false })
    }
  },

  // 读取失败与「还没读到」以前同样显示「—」，用户分不清要不要等（9/04 评审遗留，第 12 件）。
  // 现在：失败的那几项仍显示「—」（不知道就不写数），计数卡下方说明「没读到」并给重试；
  // 重试只重读失败的几项。序号挡住旧请求晚到时覆盖新结果（切走再回来会重新读一次）。
  loadStats(keys) {
    const seq = (this._statsSeq || 0) + 1
    this._statsSeq = seq
    const page = this
    const wanted = STAT_DEFS.filter(function(d) { return keys.indexOf(d.key) >= 0 })
    this.setData({ statsFailed: false })
    return Promise.all(wanted.map(function(d) {
      return d.load().then(
        function(res) { return { key: d.key, ok: true, value: countFromResult(res) } },
        function() { return { key: d.key, ok: false } }
      )
    })).then(function(results) {
      if (page._statsSeq !== seq) return
      const failed = results.filter(function(r) { return !r.ok }).map(function(r) { return r.key })
      const byKey = {}
      // 失败项一律回到「—」：上次读到的数此刻已不能确认，不留着冒充当前值。
      results.forEach(function(r) { byKey[r.key] = r.ok ? r.value : '—' })
      page._failedStatKeys = failed
      page.setData({
        stats: page.data.stats.map(function(s) {
          return Object.prototype.hasOwnProperty.call(byKey, s.key)
            ? { key: s.key, label: s.label, value: byKey[s.key] }
            : s
        }),
        statsFailed: failed.length > 0,
      })
    })
  },

  retryStats() {
    const keys = this._failedStatKeys && this._failedStatKeys.length
      ? this._failedStatKeys
      : STAT_DEFS.map(function(d) { return d.key })
    this.loadStats(keys)
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

  tapPrivacyPolicy() {
    wx.navigateTo({ url: '/pages/legal/legal?type=privacy_policy' })
  },

  onShareAppMessage() {
    return {
      title: '职易达 · 我的',
      path: '/pages/me/me',
    }
  },
})
