// pages/ai-records/ai-records.js
const app = getApp()
const api = require('../../utils/api')
const storage = require('../../utils/storage')

/**
 * 后端 MemberAiRecordItem.kind → 页面显示元数据映射。
 * kind: parse | optimize | generate | job_fit | career_plan | fair_visit_plan
 */
const KIND_META = {
  parse:           { type: 'diagnose',  title: '简历诊断',   icon: 'i-file-search', tone: 'plum'  },
  optimize:        { type: 'optimize',  title: '简历优化',   icon: 'i-edit',        tone: 'teal'  },
  generate:        { type: 'generate',  title: 'AI 生成简历', icon: 'i-file-text',  tone: 'plum'  },
  job_fit:         { type: 'job_fit',   title: '岗位匹配',   icon: 'i-briefcase',   tone: 'teal'  },
  career_plan:     { type: 'career',    title: '职业规划',   icon: 'i-compass',     tone: 'plum'  },
  fair_visit_plan: { type: 'fair',      title: '招聘会规划',  icon: 'i-calendar',   tone: 'wheat' },
}

function dayLabel(iso) {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffDays = Math.floor((now - d) / 86400000)
    if (diffDays === 0) return '今天'
    if (diffDays === 1) return '昨天'
    if (diffDays < 7) return diffDays + ' 天前'
    return (d.getMonth() + 1) + '月' + d.getDate() + '日'
  } catch (_) { return '' }
}

function timeLabel(iso) {
  try {
    const d = new Date(iso)
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  } catch (_) { return '' }
}

/**
 * 将后端 MemberAiRecordItem 映射到 WXML 所需字段。
 * 后端字段: { id, taskId, kind, status, provider, createdAt, expiresAt }
 * WXML 期待: { id, type, title, sub, day, time, score, icon, tone }
 */
function mapRecord(item) {
  const meta = KIND_META[item.kind] || { type: item.kind, title: item.kind, icon: 'i-robot', tone: 'slate' }
  return {
    id: item.id,
    taskId: item.taskId,
    type: meta.type,
    title: meta.title,
    sub: '',   // 列表端点不含文件名，详情页展示
    day: dayLabel(item.createdAt),
    time: timeLabel(item.createdAt),
    status: item.status || '',
    score: '', // 列表端点不含得分
    icon: meta.icon,
    tone: meta.tone,
  }
}

// 按 day 分组；后端已按 createdAt DESC 返回，保留插入顺序即可
function group(list) {
  const map = {}
  const order = []
  list.forEach(r => {
    if (!map[r.day]) { map[r.day] = []; order.push(r.day) }
    map[r.day].push(r)
  })
  return order.map(day => ({ day, items: map[day] }))
}

Page({
  data: {
    statusBarHeight: 20,
    activeFilter: 'all',
    filters: [
      { key: 'all',       label: '全部' },
      { key: 'diagnose',  label: '简历诊断' },
      { key: 'optimize',  label: '简历优化' },
      { key: 'interview', label: '模拟面试' },
      { key: 'career',    label: '职业规划' },
    ],
    groups: [],
    loginRequired: false,
  },

  _all: [], // 原始列表，客户端筛选用

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    this._load()
  },

  async _load() {
    const token = storage.get(storage.KEYS.TOKEN)
    if (!token) {
      this.setData({ loginRequired: true, groups: [] })
      return
    }
    this.setData({ loginRequired: false })
    wx.showLoading({ title: '加载中…', mask: true })
    try {
      const list = await api.getMyAiRecords({ pageSize: 50 })
      this._all = (list || []).map(mapRecord)
      this._applyFilter(this.data.activeFilter)
    } catch (e) {
      if (e.statusCode === 401) {
        this.setData({ loginRequired: true, groups: [] })
      } else {
        wx.showToast({ title: e.message || '加载失败', icon: 'none', duration: 2000 })
      }
    } finally {
      wx.hideLoading()
    }
  },

  _applyFilter(key) {
    const list = key === 'all' ? this._all : this._all.filter(r => r.type === key)
    this.setData({ groups: group(list) })
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  setFilter(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ activeFilter: key })
    this._applyFilter(key)
  },

  openRecord(e) {
    const id = e.currentTarget.dataset.id
    const record = this._all.find((item) => item.id === id)
    if (!record) return
    const status = record.status || '未知'
    wx.showModal({
      title: record.title,
      content: `创建时间：${record.day} ${record.time}\n任务状态：${status}`,
      showCancel: false,
      confirmText: '知道了',
    })
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' })
  },
})
