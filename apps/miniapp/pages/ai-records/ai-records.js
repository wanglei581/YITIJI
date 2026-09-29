const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const qa = require('./qa-records')

/** 后端真实 kind → 展示与现有结果页。没有结果页的类型保持诚实状态展示。 */
const KIND_META = {
  parse:           { type: 'resume',  title: '简历诊断',   icon: 'i-file-search', tone: 'plum', route: '/pages/resume-diagnose/resume-diagnose' },
  optimize:        { type: 'resume',  title: '简历优化',   icon: 'i-edit',        tone: 'teal', route: '/pages/resume-optimize/resume-optimize' },
  generate:        { type: 'resume',  title: 'AI 生成简历', icon: 'i-file-text',  tone: 'plum', route: '/pages/resume-build/resume-build' },
  job_fit:         { type: 'job',     title: '简历对照',   icon: 'i-link',        tone: 'teal', route: '/pages/job-fit/job-fit' },
  career_plan:     { type: 'career',  title: '职业规划',   icon: 'i-compass',     tone: 'plum', route: '/pages/career-plan/career-plan' },
  self_assessment: { type: 'career',  title: '自我探索',   icon: 'i-form',        tone: 'wheat', route: '/pages/self-explore/self-explore' },
}

// 一体机上生成的「招聘会规划」记录在小程序里不展示：招聘会页已停放，
// 小程序首发按非招聘类目提审（compliance-boundary.md §1.1）。记录仍在账户里，
// 一体机「我的」照常可看；拿证恢复招聘会页时把它加回 KIND_META。
const HIDDEN_KINDS = ['fair_visit_plan']

const STATUS_LABEL = {
  completed: '已完成',
  failed: '未完成',
  pending: '等待处理',
  processing: '处理中',
}

function dayLabel(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '日期未知'
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((today - target) / 86400000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays > 1 && diffDays < 7) return `${diffDays} 天前`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function timeLabel(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function mapRecord(item) {
  const meta = KIND_META[item.kind] || { type: 'other', title: item.kind || 'AI 服务', icon: 'i-robot', tone: 'wheat', route: '' }
  const status = item.status || ''
  const canOpen = status === 'completed' && Boolean(meta.route)
  const title = meta.title
  return {
    id: String(item.id || ''),
    taskId: String(item.taskId || ''),
    kind: item.kind || '',
    type: meta.type,
    title,
    day: dayLabel(item.createdAt),
    time: timeLabel(item.createdAt),
    createdAt: item.createdAt || '',
    status,
    statusLabel: STATUS_LABEL[status] || status || '状态未知',
    icon: meta.icon,
    tone: meta.tone,
    route: meta.route,
    canOpen,
    noRouteReason: meta.noRouteReason || '',
    actionLabel: canOpen ? '查看结果' : '查看状态',
    source: 'ai',
  }
}

function mapInterview(item) {
  return {
    id: `interview:${item.sessionId}`,
    sessionId: String(item.sessionId || ''),
    kind: 'mock_interview',
    type: 'interview',
    title: item.position ? `模拟面试 · ${item.position}` : '模拟面试',
    day: dayLabel(item.createdAt),
    time: timeLabel(item.createdAt),
    createdAt: item.createdAt || '',
    status: item.hasReport ? 'completed' : 'failed',
    statusLabel: item.hasReport ? '已完成' : '无报告',
    icon: 'i-form',
    tone: 'plum',
    route: '/pages/interview-result/interview-result',
    canOpen: Boolean(item.hasReport && item.sessionId),
    noRouteReason: '',
    actionLabel: item.hasReport ? '查看报告' : '查看状态',
    source: 'interview',
  }
}

function group(list) {
  const map = {}
  const order = []
  list.forEach((record) => {
    if (!map[record.day]) {
      map[record.day] = []
      order.push(record.day)
    }
    map[record.day].push(record)
  })
  return order.map((day) => ({ day, items: map[day] }))
}

Page({
  data: {
    statusBarHeight: 20,
    activeFilter: 'all',
    filters: [
      { key: 'all', label: '全部' },
      { key: 'resume', label: '简历服务' },
      { key: 'job', label: '简历对照' },
      // 这一组装的是职业规划 / 自我探索，没有一项是「评估」。
      { key: 'career', label: '规划探索' },
      { key: 'interview', label: '模拟面试' },
      qa.FILTER,
    ],
    groups: [],
    loginRequired: false,
    loading: false,
    loadError: '',
  },

  _all: [],
  _records: [],
  _qa: [],
  _interviews: [],
  _nextCursor: null,
  _qaNextCursor: null,
  _accountKeySeen: '',
  _loadGen: 0,
  _loadingMore: false,

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    this._load()
  },

  onReachBottom() {
    this._load(true)
  },

  _accountKey() {
    if (!auth.isLoggedIn()) return ''
    const gen = typeof auth.sessionGeneration === 'function' ? String(auth.sessionGeneration()) : ''
    const user = typeof auth.getUser === 'function' ? auth.getUser() : null
    const id = user && user.id != null && String(user.id) ? String(user.id) : ''
    if (id) return `u:${id}:${gen}`
    const token = typeof auth.getToken === 'function' ? String(auth.getToken() || '') : ''
    return token ? `t:${token}:${gen}` : (gen ? `in:${gen}` : 'in')
  },

  _clearLoggedOut() {
    this._records = []
    this._qa = []
    this._interviews = []
    this._all = []
    this._nextCursor = null
    this._qaNextCursor = null
    this._accountKeySeen = ''
    this.setData({ loginRequired: true, groups: [], loading: false, loadError: '' })
  },

  _publish() {
    this._all = qa.combine(this._records || [], this._qa || [], this._interviews || [])
    this._applyFilter(this.data.activeFilter)
  },

  _stale(gen, key) {
    return this._loadGen !== gen || this._accountKey() !== key
  },

  async _load(append = false) {
    const keyAtStart = this._accountKey()
    if (!keyAtStart) {
      this._loadGen = (this._loadGen || 0) + 1
      this._clearLoggedOut()
      this._loadingMore = false
      return
    }
    if (this._accountKeySeen && this._accountKeySeen !== keyAtStart) {
      append = false
      this._records = []
      this._qa = []
      this._interviews = []
      this._all = []
      this._nextCursor = null
      this._qaNextCursor = null
      this.setData({ groups: [], loginRequired: false, loadError: '' })
    }
    const recordCursor = append ? (this._nextCursor || '') : ''
    const qaCursor = append ? (this._qaNextCursor || '') : ''
    if (append && ((!recordCursor && !qaCursor) || this._loadingMore)) return
    const gen = ++this._loadGen
    this._accountKeySeen = keyAtStart
    this._loadingMore = !!append
    try {
      // append 时不进整页 loading：那会把已渲染的列表打回加载态闪一下
      this.setData(append ? { loginRequired: false } : { loginRequired: false, loading: true, loadError: '' })
      // 首页这一次 GET /me/ai-records 的响应里已经带着 qaRecords。
      // 翻页才把各自的 cursor / qaCursor 带上；只翻其中一边时，另一边响应里的第一页不要再并进来。
      const params = { pageSize: 50 }
      if (recordCursor) params.cursor = recordCursor
      if (qaCursor) params.qaCursor = qaCursor
      const list = await api.getMyAiRecords(params)
      if (this._stale(gen, keyAtStart)) return
      const recordsRequested = !append || !!recordCursor
      const qaRequested = !append || !!qaCursor
      if (recordsRequested) {
        const page = (list || []).filter((item) => !HIDDEN_KINDS.includes(item && item.kind)).map(mapRecord)
        this._records = append ? [...(this._records || []), ...page] : page
        this._nextCursor = (list && list.nextCursor) || null
      }
      if (qaRequested) {
        const bundle = qa.readQaBundle(list)
        const mapped = bundle.records.map(qa.mapQaRecord).filter(Boolean)
        this._qa = append ? qa.appendQa(this._qa || [], mapped) : mapped
        this._qaNextCursor = bundle.nextCursor
      }
      if (!append) {
        try {
          const iv = await api.getMyMockInterviews({ pageSize: 50 })
          if (this._stale(gen, keyAtStart)) return
          this._interviews = (iv || []).map(mapInterview)
        } catch (_) {
          if (this._stale(gen, keyAtStart)) return
          this._interviews = []
        }
      }
      this._publish()
      this.setData({ loading: false, loadError: '' })
    } catch (err) {
      if (this._stale(gen, keyAtStart)) return
      if (err && err.statusCode === 401) {
        this._clearLoggedOut()
      } else if (append) {
        this.setData({ loading: false })
        if (typeof wx.showToast === 'function') {
          wx.showToast({ title: (err && err.message) || '加载更多失败', icon: 'none' })
        }
      } else {
        this.setData({ loading: false, loadError: (err && err.message) || '加载记录失败，请稍后重试' })
      }
    } finally {
      // 必须在 finally 复位：未登录的提前 return 和失败分支原先都不复位，
      // 于是「加载更多」失败一次之后，_loadingMore 会把后续每一次静默吞掉。
      // 换账号后旧请求的 gen 对不上，不能把新请求的闸门清掉。
      if (this._loadGen === gen) this._loadingMore = false
    }
  },

  _applyFilter(key) {
    const all = this._all || []
    const list = key === 'all' ? all : all.filter((record) => record.type === key)
    this.setData({ groups: group(list) })
  },

  setFilter(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ activeFilter: key })
    this._applyFilter(key)
  },

  _find(id) {
    return (this._all || []).find((item) => item.id === String(id || ''))
  },

  _showQa(record) {
    const owner = this._accountKey()
    const show = (lines, mode) => {
      if (this._accountKey() !== owner) return
      wx.showModal({
        title: record.title || '小青问答要点',
        content: qa.modalContent(record, lines, mode),
        showCancel: false,
        confirmText: '知道了',
      })
    }
    const cached = record.points || []
    if (cached.length) {
      show(cached, 'points')
      return
    }
    if (!record.sessionId || typeof api.getAdvisorSession !== 'function') {
      show([], 'metadata')
      return
    }
    api.getAdvisorSession(record.sessionId)
      .then((session) => {
        if (this._accountKey() !== owner) return
        const lines = qa.pointsFromSession(session, record.artifactId)
        show(lines, lines.length ? 'points' : 'empty')
      })
      .catch(() => {
        if (this._accountKey() !== owner) return
        show([], 'unavailable')
      })
  },

  openRecord(e) {
    const record = this._find(e.currentTarget.dataset.id)
    if (!record) return
    if (record.source === 'qa') {
      this._showQa(record)
      return
    }
    if (record.canOpen) {
      if (record.source === 'interview') {
        wx.navigateTo({ url: `${record.route}?sessionId=${encodeURIComponent(record.sessionId)}` })
        return
      }
      wx.navigateTo({ url: `${record.route}?taskId=${encodeURIComponent(record.taskId)}` })
      return
    }
    const reason = record.status !== 'completed'
      ? `任务状态：${record.statusLabel}`
      // 有专属原因就说专属的，没有才用通用说明。
      : (record.noRouteReason || '当前版本没有注册这类结果的独立回看页面，记录仍保留在你的账户中。')
    wx.showModal({
      title: record.title,
      content: `${reason}\n创建时间：${record.day} ${record.time}`,
      showCancel: false,
      confirmText: '知道了',
    })
  },

  moreRecord(e) {
    const record = this._find(e.currentTarget.dataset.id)
    if (!record) return
    // 问答要点的 id 不是 AI 记录 id，不能走 deleteMyAiRecord。这里只读，不删。
    if (record.source === 'qa') {
      this._showQa(record)
      return
    }
    wx.showActionSheet({
      itemList: ['删除记录'],
      success: (res) => {
        if (res.tapIndex !== 0) return
        const cascadeNote = record.kind === 'parse' ? '删除诊断记录会同时删除这次任务的优化、对照与规划等派生结果。' : ''
        wx.showModal({
          title: '删除 AI 记录',
          content: `确认删除“${record.title}”？${cascadeNote}该操作删除账户内结果，已生成到“我的文档”的文件仍需单独删除。`,
          confirmText: '删除',
          confirmColor: '#b5643c',
          success: (modal) => {
            if (!modal.confirm) return
            wx.showLoading({ title: '正在删除…', mask: true })
            const del = record.source === 'interview'
              ? api.deleteMyMockInterview(record.sessionId)
              : api.deleteMyAiRecord(record.id)
            del
              .then(() => {
                wx.hideLoading()
                wx.showToast({ title: '已删除', icon: 'success' })
                this._load()
              })
              .catch((err) => {
                wx.hideLoading()
                wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
              })
          },
        })
      },
    })
  },

  retryLoad() {
    this._load()
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' })
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },
})
