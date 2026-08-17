// pages/job-tracker/job-tracker.js
const STORAGE_KEY = 'zyd_job_tracker'

const STATUSES = [
  { key: 'intention',   label: '意向',   color: 'wheat' },
  { key: 'applied',     label: '已投递', color: 'teal'  },
  { key: 'interviewing',label: '面试中', color: 'plum'  },
  { key: 'offered',     label: '已拿Offer', color: 'green' },
  { key: 'rejected',    label: '已拒绝', color: 'slate' },
]

const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    columns: [],
    total: 0,
    // 新增/编辑弹窗
    showModal: false,
    editing: null,        // null = 新增，非null = 编辑中的条目id
    form: {
      company:  '',
      position: '',
      status:   'intention',
      salary:   '',
      note:     '',
    },
    statusOptions: STATUSES,
    statusIdx: 0,
    pickingId: null,
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    this._refresh()
  },

  _refresh() {
    const all = this._loadAll()
    const columns = STATUSES.map(s => ({
      key:   s.key,
      label: s.label,
      color: s.color,
      items: all.filter(item => item.status === s.key)
                .sort((a, b) => b.updatedAt - a.updatedAt),
    }))
    const total = all.length
    this.setData({ columns, total })
  },

  _loadAll() {
    try {
      return wx.getStorageSync(STORAGE_KEY) || []
    } catch (e) { return [] }
  },

  _saveAll(list) {
    try { wx.setStorageSync(STORAGE_KEY, list) } catch (e) {}
  },

  goBack() {
    wx.navigateBack()
  },

  // ── 新增 ────────────────────────────────────
  openAdd() {
    this.setData({
      showModal: true,
      editing: null,
      statusIdx: 0,
      form: { company: '', position: '', status: 'intention', salary: '', note: '' },
    })
  },

  // ── 编辑 ────────────────────────────────────
  openEdit(e) {
    const id = e.currentTarget.dataset.id
    const item = this._loadAll().find(i => i.id === id)
    if (!item) return
    this.setData({
      showModal: true,
      editing: id,
      statusIdx: STATUSES.findIndex(function(s) { return s.key === item.status }) || 0,
      form: {
        company:  item.company,
        position: item.position,
        status:   item.status,
        salary:   item.salary || '',
        note:     item.note   || '',
      },
    })
  },

  // ── 表单字段输入 ─────────────────────────────
  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },

  // picker 选状态
  onStatusChange(e) {
    const idx = parseInt(e.detail.value)
    this.setData({ statusIdx: idx, 'form.status': STATUSES[idx].key })
  },

  // ── 保存（新增 or 编辑）─────────────────────
  saveForm() {
    const { form, editing } = this.data
    if (!form.company.trim() || !form.position.trim()) {
      wx.showToast({ title: '公司名和岗位不能为空', icon: 'none' })
      return
    }
    const list = this._loadAll()
    const now = Date.now()
    if (editing) {
      const idx = list.findIndex(i => i.id === editing)
      if (idx >= 0) {
        list[idx] = Object.assign({}, list[idx], {
          company:  form.company.trim(),
          position: form.position.trim(),
          status:   form.status,
          salary:   form.salary.trim(),
          note:     form.note.trim(),
          updatedAt: now,
        })
      }
    } else {
      list.push({
        id:        'jt_' + now + '_' + Math.random().toString(36).slice(2, 6),
        company:   form.company.trim(),
        position:  form.position.trim(),
        status:    form.status,
        salary:    form.salary.trim(),
        note:      form.note.trim(),
        createdAt: now,
        updatedAt: now,
      })
    }
    this._saveAll(list)
    this.setData({ showModal: false })
    this._refresh()
  },

  closeModal() {
    this.setData({ showModal: false })
  },

  // ── 长按快速改状态 ──────────────────────────
  longPressCard(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ showStatusPicker: true, pickingId: id })
  },

  pickStatus(e) {
    const key = e.currentTarget.dataset.key
    const id = this.data.pickingId
    if (!id || !key) { this.setData({ showStatusPicker: false }); return }
    const list = this._loadAll()
    const idx = list.findIndex(i => i.id === id)
    if (idx >= 0) {
      list[idx].status    = key
      list[idx].updatedAt = Date.now()
    }
    this._saveAll(list)
    this.setData({ showStatusPicker: false, pickingId: null })
    this._refresh()
  },

  closeStatusPicker() {
    this.setData({ showStatusPicker: false, pickingId: null })
  },

  // ── 删除 ────────────────────────────────────
  deleteItem(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定吗？',
      confirmText: '删除',
      confirmColor: '#e74c3c',
      success: (res) => {
        if (!res.confirm) return
        const list = this._loadAll().filter(i => i.id !== id)
        this._saveAll(list)
        this._refresh()
      }
    })
  },

  onShareAppMessage() {
    return { title: '求职进度看板 · 职易达', path: '/pages/job-tracker/job-tracker' }
  },
})
