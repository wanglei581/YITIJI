// pages/job-tracker/job-tracker.js
// 本人求职备忘本（compliance-boundary.md §4.4A）：
// 纯本人手动记事，仅本人可见，不从第三方回流，不向任何企业或机构回传。

const app = getApp()
const auth = require('../../utils/auth')
const trackerApi = require('../../utils/api-job-tracker')
const {
  createLifecycleGuard,
  memberIdentityKey,
  isMemberIdentity,
} = require('../../utils/page-guard')
const { userErrorMessage } = require('../../utils/user-error')

const PAGE_SIZE = 20

const STATUS_META = {
  intention:    { key: 'intention',    label: '意向',       next: 'applied',      nextLabel: '记为已投' },
  applied:      { key: 'applied',      label: '已自填投递', next: 'interviewing', nextLabel: '进入面试' },
  interviewing: { key: 'interviewing', label: '面试中',     next: 'offered',      nextLabel: '记录录用' },
  offered:      { key: 'offered',      label: '录用意向',   next: '',             nextLabel: '' },
  rejected:     { key: 'rejected',     label: '已结束',     next: '',             nextLabel: '' },
}

const FILTER_TABS = [
  { key: '',             label: '全部' },
  { key: 'intention',    label: '意向' },
  { key: 'applied',      label: '已自填投递' },
  { key: 'interviewing', label: '面试中' },
  { key: 'offered',      label: '录用意向' },
  { key: 'rejected',     label: '已结束' },
]

const FORM_STATUSES = [
  { key: 'intention',    label: '意向' },
  { key: 'applied',      label: '已自填投递' },
  { key: 'interviewing', label: '面试中' },
  { key: 'offered',      label: '录用意向' },
  { key: 'rejected',     label: '已结束' },
]

function formatDateText(iso) {
  if (!iso) return ''
  const str = String(iso)
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(str)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

function dateToIso(dateStr) {
  const s = String(dateStr || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  return `${s}T00:00:00.000Z`
}

function decorateItem(raw) {
  if (!raw || !raw.id) return null
  const meta = STATUS_META[raw.status] || STATUS_META.intention
  const dateText = formatDateText(raw.selfReportedAt)
  const updatedText = formatDateText(raw.updatedAt || raw.createdAt)
  return {
    id: String(raw.id),
    companyName: String(raw.companyName || ''),
    positionTitle: String(raw.positionTitle || ''),
    status: meta.key,
    statusLabel: meta.label,
    nextStatus: meta.next,
    nextLabel: meta.nextLabel,
    note: raw.note ? String(raw.note) : '',
    selfReportedDate: dateText,
    updatedText,
    sourceBadge: '本人自填',
  }
}

function mergeById(existing, incoming) {
  const seen = {}
  const out = []
  ;(existing || []).forEach((item) => {
    if (!item || !item.id || seen[item.id]) return
    seen[item.id] = true
    out.push(item)
  })
  ;(incoming || []).forEach((item) => {
    if (!item || !item.id || seen[item.id]) return
    seen[item.id] = true
    out.push(item)
  })
  return out
}

function emptyForm() {
  return {
    id: '',
    companyName: '',
    positionTitle: '',
    status: 'intention',
    selfReportedDate: '',
    note: '',
  }
}

function isTimeoutLike(err) {
  if (!err) return false
  const code = String(err.code || '').toUpperCase()
  const msg = String(err.message || '').toLowerCase()
  return code === 'NETWORK_ERROR' || code === 'TIMEOUT' || msg.includes('timeout') || msg.includes('超时')
}

Page({
  data: {
    statusBarHeight: 20,
    isLoggedIn: false,
    filterTabs: FILTER_TABS,
    formStatuses: FORM_STATUSES,
    activeFilter: '',
    activeFilterLabel: '全部记录',
    items: [],
    total: null,
    nextCursor: null,
    loading: false,
    loadingMore: false,
    loadError: '',
    busyMap: {},
    sheetOpen: false,
    sheetMode: 'create',
    saving: false,
    uncertainSubmit: false,
    form: emptyForm(),
  },

  onLoad() {
    this._guard = createLifecycleGuard()
    this._inFlightItems = {}
    this.setData({
      statusBarHeight: (app && app.globalData && app.globalData.statusBarHeight) || 20,
    })
    if (typeof auth.subscribeSessionChange === 'function') {
      this._unsubSession = auth.subscribeSessionChange(() => {
        this._resetPersonalState()
      })
    }
  },

  onShow() {
    this._guard.activate()
    const key = memberIdentityKey(auth)
    const changed = this._guard.setIdentity(key)
    const loggedIn = isMemberIdentity(key)
    if (!loggedIn) {
      this._resetPersonalState()
      return
    }
    if (changed) {
      this._clearDataKeepLogin()
    } else if (!this.data.isLoggedIn) {
      this.setData({ isLoggedIn: true })
    }
    this.loadList({ append: false })
  },

  onHide() {
    this._guard.deactivate()
    this._inFlightItems = {}
    if (this.data.loading || this.data.loadingMore || this.data.saving) {
      this.setData({ loading: false, loadingMore: false, saving: false, busyMap: {} })
    }
  },

  onUnload() {
    this._guard.deactivate()
    this._inFlightItems = {}
    if (typeof this._unsubSession === 'function') {
      this._unsubSession()
      this._unsubSession = null
    }
  },

  _clearDataKeepLogin() {
    this._inFlightItems = {}
    this.setData({
      isLoggedIn: true,
      items: [],
      total: null,
      nextCursor: null,
      loading: false,
      loadingMore: false,
      loadError: '',
      busyMap: {},
      sheetOpen: false,
      saving: false,
      uncertainSubmit: false,
      form: emptyForm(),
    })
  },

  _resetPersonalState() {
    if (this._guard) this._guard.setIdentity('')
    this._inFlightItems = {}
    this.setData({
      isLoggedIn: false,
      items: [],
      total: null,
      nextCursor: null,
      loading: false,
      loadingMore: false,
      loadError: '',
      busyMap: {},
      sheetOpen: false,
      saving: false,
      uncertainSubmit: false,
      form: emptyForm(),
    })
  },

  goBack() {
    wx.navigateBack({
      fail() { wx.switchTab({ url: '/pages/me/me' }) },
    })
  },

  tapLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' })
  },

  tapFilter(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || ''
    if (key === this.data.activeFilter && !this.data.loadError) return
    const tab = FILTER_TABS.find((t) => t.key === key) || FILTER_TABS[0]
    this.setData({
      activeFilter: key,
      activeFilterLabel: key ? tab.label : '全部记录',
      items: [],
      total: null,
      nextCursor: null,
      loadError: '',
      uncertainSubmit: false,
    })
    if (this.data.isLoggedIn) this.loadList({ append: false })
  },

  reloadList() {
    if (!isMemberIdentity(memberIdentityKey(auth))) {
      this._resetPersonalState()
      return
    }
    this.setData({ uncertainSubmit: false })
    this.loadList({ append: false })
  },

  onReachBottom() {
    if (!this.data.isLoggedIn) return
    if (this.data.loading || this.data.loadingMore || !this.data.nextCursor) return
    this.loadList({ append: true })
  },

  loadList(opts = {}) {
    const append = opts && opts.append === true
    const currentKey = memberIdentityKey(auth)
    if (!isMemberIdentity(currentKey)) {
      this._resetPersonalState()
      return Promise.resolve()
    }
    if (append && (this.data.loading || this.data.loadingMore || !this.data.nextCursor)) {
      return Promise.resolve()
    }

    const filterStatus = this.data.activeFilter
    const cursor = append ? this.data.nextCursor : undefined
    const token = this._guard.issue('list', { append, filterStatus })
    this.setData(append
      ? { loadingMore: true }
      : { loading: true, loadingMore: false, loadError: '' })

    return trackerApi.listJobApplications({
      status: filterStatus || undefined,
      cursor,
      pageSize: PAGE_SIZE,
    }).then((res) => {
      if (!this._guard.accepts(token, memberIdentityKey(auth))) return
      const decorated = (res.items || []).map(decorateItem).filter(Boolean)
      const nextItems = append ? mergeById(this.data.items, decorated) : decorated
      this.setData({
        items: nextItems,
        total: typeof res.total === 'number' ? res.total : nextItems.length,
        nextCursor: res.nextCursor || null,
        loading: false,
        loadingMore: false,
        loadError: '',
      })
    }).catch((err) => {
      if (!this._guard.accepts(token, memberIdentityKey(auth))) return
      const msg = userErrorMessage(err, '暂时没读到备忘记录，请稍后重试')
      if (append) {
        this.setData({ loadingMore: false })
        wx.showToast({ title: msg, icon: 'none' })
      } else {
        this.setData({ loading: false, loadingMore: false, loadError: msg })
      }
    })
  },

  openCreate() {
    if (!isMemberIdentity(memberIdentityKey(auth))) {
      this.tapLogin()
      return
    }
    const presetStatus = this.data.activeFilter || 'intention'
    this.setData({
      sheetOpen: true,
      sheetMode: 'create',
      saving: false,
      uncertainSubmit: false,
      form: Object.assign(emptyForm(), { status: presetStatus }),
    })
  },

  openEdit(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id
    const item = (this.data.items || []).find((row) => row.id === id)
    if (!item || this._inFlightItems[id]) return
    this.setData({
      sheetOpen: true,
      sheetMode: 'edit',
      saving: false,
      uncertainSubmit: false,
      form: {
        id: item.id,
        companyName: item.companyName,
        positionTitle: item.positionTitle,
        status: item.status,
        selfReportedDate: item.selfReportedDate || '',
        note: item.note || '',
      },
    })
  },

  closeSheet() {
    if (this.data.saving) return
    this.setData({ sheetOpen: false, uncertainSubmit: false })
  },

  noop() {},

  onCompanyInput(e) {
    this.setData({ 'form.companyName': (e && e.detail && e.detail.value) || '' })
  },

  onPositionInput(e) {
    this.setData({ 'form.positionTitle': (e && e.detail && e.detail.value) || '' })
  },

  onNoteInput(e) {
    this.setData({ 'form.note': (e && e.detail && e.detail.value) || '' })
  },

  tapFormStatus(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key
    if (!STATUS_META[key]) return
    this.setData({ 'form.status': key })
  },

  onDateChange(e) {
    const val = (e && e.detail && e.detail.value) || ''
    this.setData({ 'form.selfReportedDate': val })
  },

  clearDate() {
    this.setData({ 'form.selfReportedDate': '' })
  },

  submitForm() {
    if (this.data.saving) return
    const currentKey = memberIdentityKey(auth)
    if (!isMemberIdentity(currentKey)) {
      this._resetPersonalState()
      this.tapLogin()
      return
    }
    const f = this.data.form || emptyForm()
    const companyName = String(f.companyName || '').trim()
    const positionTitle = String(f.positionTitle || '').trim()
    if (!companyName) {
      wx.showToast({ title: '请填写目标公司名称', icon: 'none' })
      return
    }
    if (!positionTitle) {
      wx.showToast({ title: '请填写目标岗位名称', icon: 'none' })
      return
    }

    const isEdit = this.data.sheetMode === 'edit' && !!f.id
    const isoDate = f.selfReportedDate ? dateToIso(f.selfReportedDate) : ''
    const payload = {
      companyName,
      positionTitle,
      status: f.status || 'intention',
      note: String(f.note || '').trim(),
      selfReportedAt: isEdit ? (isoDate || null) : (isoDate || undefined),
    }

    const token = this._guard.issue('submit')
    this.setData({ saving: true, uncertainSubmit: false })

    const req = isEdit
      ? trackerApi.updateJobApplication(f.id, payload)
      : trackerApi.createJobApplication(payload)

    return req.then(() => {
      if (!this._guard.accepts(token, memberIdentityKey(auth))) return
      this.setData({ saving: false, sheetOpen: false, uncertainSubmit: false, form: emptyForm() })
      wx.showToast({ title: isEdit ? '已更新备忘' : '已记入备忘本', icon: 'success' })
      this.loadList({ append: false })
    }).catch((err) => {
      if (!this._guard.accepts(token, memberIdentityKey(auth))) return
      if (!isEdit && isTimeoutLike(err)) {
        // POST 没有服务端幂等键：超时结果未明时绝不自动重发，请先刷新核对避免重复记账
        this.setData({ saving: false, sheetOpen: false, uncertainSubmit: true })
        wx.showToast({ title: '提交超时，请先刷新核对是否已记上', icon: 'none', duration: 2800 })
        this.loadList({ append: false })
        return
      }
      this.setData({ saving: false })
      wx.showToast({ title: userErrorMessage(err, isEdit ? '更新失败，请重试' : '保存失败，请重试'), icon: 'none' })
    })
  },

  tapAdvance(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const id = ds.id
    const nextStatus = ds.next
    if (!id || !STATUS_META[nextStatus] || this._inFlightItems[id]) return
    const currentKey = memberIdentityKey(auth)
    if (!isMemberIdentity(currentKey)) {
      this._resetPersonalState()
      return
    }

    this._inFlightItems[id] = true
    const busyMap = Object.assign({}, this.data.busyMap, { [id]: true })
    const token = this._guard.issue(`item:${id}`)
    this.setData({ busyMap })

    return trackerApi.updateJobApplication(id, { status: nextStatus }).then(() => {
      if (!this._guard.accepts(token, memberIdentityKey(auth))) return
      delete this._inFlightItems[id]
      const nextBusy = Object.assign({}, this.data.busyMap)
      delete nextBusy[id]
      this.setData({ busyMap: nextBusy })
      wx.showToast({ title: `已更新为「${STATUS_META[nextStatus].label}」`, icon: 'none' })
      this.loadList({ append: false })
    }).catch((err) => {
      if (!this._guard.accepts(token, memberIdentityKey(auth))) return
      delete this._inFlightItems[id]
      const nextBusy = Object.assign({}, this.data.busyMap)
      delete nextBusy[id]
      this.setData({ busyMap: nextBusy })
      wx.showToast({ title: userErrorMessage(err, '状态更新失败，请重试'), icon: 'none' })
    })
  },

  tapDelete(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id
    const item = (this.data.items || []).find((row) => row.id === id)
    if (!item || this._inFlightItems[id]) return
    wx.showModal({
      title: '删除这条备忘？',
      content: `删除后将从你的个人求职备忘本移除「${item.companyName} · ${item.positionTitle}」，不可恢复。`,
      confirmText: '删除',
      confirmColor: '#C63D3A',
      success: (res) => {
        if (!res || !res.confirm) return
        this._confirmDelete(id)
      },
    })
  },

  _confirmDelete(id) {
    if (!id || this._inFlightItems[id]) return
    const currentKey = memberIdentityKey(auth)
    if (!isMemberIdentity(currentKey)) {
      this._resetPersonalState()
      return
    }
    this._inFlightItems[id] = true
    const busyMap = Object.assign({}, this.data.busyMap, { [id]: true })
    const token = this._guard.issue(`item:${id}`)
    this.setData({ busyMap })

    return trackerApi.deleteJobApplication(id).then(() => {
      if (!this._guard.accepts(token, memberIdentityKey(auth))) return
      delete this._inFlightItems[id]
      const nextBusy = Object.assign({}, this.data.busyMap)
      delete nextBusy[id]
      this.setData({ busyMap: nextBusy })
      wx.showToast({ title: '已删除', icon: 'none' })
      this.loadList({ append: false })
    }).catch((err) => {
      if (!this._guard.accepts(token, memberIdentityKey(auth))) return
      delete this._inFlightItems[id]
      const nextBusy = Object.assign({}, this.data.busyMap)
      delete nextBusy[id]
      this.setData({ busyMap: nextBusy })
      wx.showToast({ title: userErrorMessage(err, '删除失败，请重试'), icon: 'none' })
    })
  },

  tapGoPrint() {
    wx.navigateTo({ url: '/pages/documents/documents' })
  },

  tapQuickInterview(e) {
    const position = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.position) || ''
    const q = position ? `?position=${encodeURIComponent(position)}&quick=1` : '?quick=1'
    wx.navigateTo({ url: `/pages/interview-entry/interview-entry${q}` })
  },
})
