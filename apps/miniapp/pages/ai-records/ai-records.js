const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')

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
    ],
    groups: [],
    loginRequired: false,
    loading: false,
    loadError: '',
  },

  _all: [],

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    this._load()
  },

  onReachBottom() {
    this._load(true)
  },

  async _load(append = false) {
    if (append && (!this._nextCursor || this._loadingMore)) return
    this._loadingMore = append
    try {
      if (!auth.isLoggedIn()) {
        this._all = []
        this.setData({ loginRequired: true, groups: [], loading: false, loadError: '' })
        return
      }
      // append 时不进整页 loading：那会把已渲染的列表打回加载态闪一下
      this.setData(append ? { loginRequired: false } : { loginRequired: false, loading: true, loadError: '' })
      // 2026-09-03：同 documents 的「50 条静默截断」——nextCursor 一直被丢弃，
      // 第 51 条起永远不显示。分页写法对照 orders.js / documents.js。
      const cursor = append ? this._nextCursor : null
      const list = await api.getMyAiRecords({ pageSize: 50, ...(cursor ? { cursor } : {}) })
      const page = (list || []).filter((item) => !HIDDEN_KINDS.includes(item && item.kind)).map(mapRecord)
      let interviews = this._interviews || []
      if (!append) {
        try {
          const iv = await api.getMyMockInterviews({ pageSize: 50 })
          interviews = (iv || []).map(mapInterview)
        } catch (_) {
          interviews = []
        }
        this._interviews = interviews
      }
      const merged = append ? [...this._all.filter((r) => r.source !== 'interview'), ...page] : page
      this._all = [...merged, ...interviews]
      this._nextCursor = (list && list.nextCursor) || null
      this._applyFilter(this.data.activeFilter)
      this.setData({ loading: false })
    } catch (err) {
      if (err && err.statusCode === 401) {
        this._all = []
        this.setData({ loginRequired: true, groups: [], loading: false })
      } else {
        this.setData({ loading: false, loadError: (err && err.message) || '加载记录失败，请稍后重试' })
      }
    } finally {
      // 必须在 finally 复位：未登录的提前 return 和两个 catch 分支原先都不复位，
      // 于是「加载更多」失败一次之后，上面那道 _loadingMore guard 会把后续每一次
      // 加载更多静默吞掉——列表永久停在 50 条，且不再报任何错。
      // 本页是全仓唯一用实例字段（而非 data）做加载闸的列表页，
      // documents / notifications / orders 都在 catch 里复位了 data.loadingMore。
      this._loadingMore = false
    }
  },

  _applyFilter(key) {
    const list = key === 'all' ? this._all : this._all.filter((record) => record.type === key)
    this.setData({ groups: group(list) })
  },

  setFilter(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ activeFilter: key })
    this._applyFilter(key)
  },

  openRecord(e) {
    const record = this._all.find((item) => item.id === String(e.currentTarget.dataset.id || ''))
    if (!record) return
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
    const record = this._all.find((item) => item.id === String(e.currentTarget.dataset.id || ''))
    if (!record) return
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
