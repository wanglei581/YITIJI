const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')

/** 后端真实 kind → 展示与现有结果页。没有结果页的类型保持诚实状态展示。 */
const KIND_META = {
  parse:           { type: 'resume',  title: '简历诊断',   icon: 'i-file-search', tone: 'plum', route: '/pages/resume-diagnose/resume-diagnose' },
  optimize:        { type: 'resume',  title: '简历优化',   icon: 'i-edit',        tone: 'teal', route: '/pages/resume-optimize/resume-optimize' },
  generate:        { type: 'resume',  title: 'AI 生成简历', icon: 'i-file-text',  tone: 'plum', route: '' },
  job_fit:         { type: 'job',     title: '岗位匹配',   icon: 'i-link',        tone: 'teal', route: '/pages/job-fit/job-fit' },
  career_plan:     { type: 'career',  title: '职业规划',   icon: 'i-compass',     tone: 'plum', route: '/pages/career-plan/career-plan' },
  fair_visit_plan: { type: 'career',  title: '招聘会规划',  icon: 'i-calendar',    tone: 'wheat', route: '' },
  self_assessment: { type: 'career',  title: '自我评估',   icon: 'i-form',        tone: 'wheat', route: '' },
}

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
  return {
    id: String(item.id || ''),
    taskId: String(item.taskId || ''),
    kind: item.kind || '',
    type: meta.type,
    title: meta.title,
    day: dayLabel(item.createdAt),
    time: timeLabel(item.createdAt),
    status,
    statusLabel: STATUS_LABEL[status] || status || '状态未知',
    icon: meta.icon,
    tone: meta.tone,
    route: meta.route,
    canOpen,
    actionLabel: canOpen ? '查看结果' : '查看状态',
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
      { key: 'job', label: '岗位匹配' },
      { key: 'career', label: '规划评估' },
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

  async _load() {
    if (!auth.isLoggedIn()) {
      this._all = []
      this.setData({ loginRequired: true, groups: [], loading: false, loadError: '' })
      return
    }
    this.setData({ loginRequired: false, loading: true, loadError: '' })
    try {
      const list = await api.getMyAiRecords({ pageSize: 50 })
      this._all = (list || []).map(mapRecord)
      this._applyFilter(this.data.activeFilter)
      this.setData({ loading: false })
    } catch (err) {
      if (err && err.statusCode === 401) {
        this._all = []
        this.setData({ loginRequired: true, groups: [], loading: false })
      } else {
        this.setData({ loading: false, loadError: (err && err.message) || '加载记录失败，请稍后重试' })
      }
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
      wx.navigateTo({ url: `${record.route}?taskId=${encodeURIComponent(record.taskId)}` })
      return
    }
    const reason = record.status !== 'completed'
      ? `任务状态：${record.statusLabel}`
      : '当前版本没有注册这类结果的独立回看页面，记录仍保留在你的账户中。'
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
        const cascadeNote = record.kind === 'parse' ? '删除诊断记录会同时删除这次任务的优化、匹配与规划等派生结果。' : ''
        wx.showModal({
          title: '删除 AI 记录',
          content: `确认删除“${record.title}”？${cascadeNote}该操作删除账户内结果，已生成到“我的文档”的文件仍需单独删除。`,
          confirmText: '删除',
          confirmColor: '#b5643c',
          success: (modal) => {
            if (!modal.confirm) return
            wx.showLoading({ title: '正在删除…', mask: true })
            api.deleteMyAiRecord(record.id)
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
