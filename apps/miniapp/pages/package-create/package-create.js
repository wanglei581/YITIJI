// pages/package-create/package-create.js
//
// 材料包第一步：从**本人服务端文件**里挑材料 + 设打印参数 + 过打印隐私检查。
//
// 这页此前的实现是 `wx.chooseMessageFile` 选本地文件，给每个文件编一个
// `local_<时间戳>` 的 id 和写死的 `pages: 1`，再把这个 id 当 fileId 提交。
// 服务端 `CreatePackageOrderDto` 收到的是一个不存在的文件 id，必回
// PRINT_FILE_NOT_FOUND —— 也就是说那条链**最后一步必然失败**，这正是
// `guardPackageChain()` 当初把四页整体关掉的原因之一。
//
// 现在改成真实路径：
//   - 列表来自 `GET /me/documents`（本人 FileObject 元数据，游标分页），
//     只保留服务端 ALLOWED_PURPOSES 允许进材料包的用途，且服务端标了
//     `reprintable: false` 的高敏报告一律不列出（它们禁止进打印链路）。
//   - 「从微信聊天添加」走 `api.uploadPrintFile`，拿服务端返回的真实 fileId，
//     不再本地编号。
//   - 页数与金额本页**一个数字都不给**：服务端在下单时按真实文件核页数、按价目表计价
//     （CLAUDE.md §9「不伪造能力」）。此前这里按「黑白 0.5 元/页」本地算总价，
//     那两个单价既不读价目接口、也对不上仓库里的价目，等于把编出来的金额给用户看。
//   - 打印隐私检查在本页完成：服务端 `assertPiiReady` 对 print_doc / resume_upload /
//     resume_scan 硬性要求先扫过且无待决 finding，不做就在下单那一步被拒。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const pkg = require('../../utils/package-order')

const DOC_PAGE_SIZE = 20

/** 服务端文档行 → 本页展示行。不补任何服务端没给的字段（尤其是页数）。 */
function toDocRow(doc) {
  return {
    id: doc.id,
    name: doc.filename || '未命名文件',
    sizeText: pkg.formatFileSize(doc.sizeBytes),
    purposeLabel: pkg.purposeLabel(doc.purpose),
    needsPii: pkg.needsPiiScan(doc),
    selected: false,
    // 隐私检查状态逐文件独立：idle | scanning | review | ready | error
    piiStatus: pkg.needsPiiScan(doc) ? 'idle' : 'ready',
    piiError: '',
  }
}

Page({
  data: {
    statusBarHeight: 20,
    isLoggedIn: false,

    docState: 'idle',     // idle | loading | ready | error
    docErrorTitle: '',
    docErrorText: '',
    docs: [],
    docCursor: null,
    docLoadingMore: false,

    uploading: false,

    selectedCount: 0,
    colorMode: 'bw',
    duplex: 'single',
    copies: 1,

    piiPhase: 'idle',     // idle | scanning | review | ready | error
    piiGroups: [],        // [{ taskId, fileName, findings: [...] }]
    piiFindingCount: 0,
    piiError: '',
    piiSubmitting: false,

    onsiteNotice: pkg.PACKAGE_ONSITE_NOTICE,
    noCancelNotice: pkg.PACKAGE_NO_CANCEL_NOTICE,
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    const loggedIn = auth.isLoggedIn()
    // 换用户后不能残留上一位的文件列表与选择。判据是会员 id。
    const identityKey = loggedIn ? String((auth.getUser() || {}).id || '') : ''
    if (identityKey !== this._identityKey) {
      this._identityKey = identityKey
      this.setData({
        docs: [], docCursor: null, docState: 'idle',
        selectedCount: 0, piiPhase: 'idle', piiGroups: [], piiFindingCount: 0, piiError: '',
      })
      wx.removeStorageSync('temp_package_data')
    }
    this.setData({ isLoggedIn: loggedIn })
    if (loggedIn && this.data.docState === 'idle') this._loadDocs()
  },

  /**
   * 本人文档列表。失败给可重试的失败态，空给「去上传」的空态 —— 两者补救动作不同，
   * 不能合成一句（docs/product/content-onboarding-runbook.md §5C）。
   */
  _loadDocs(append = false) {
    if (!auth.isLoggedIn()) return Promise.resolve()
    if (append && !this.data.docCursor) return Promise.resolve()
    const cursor = append ? this.data.docCursor : null
    this.setData(append ? { docLoadingMore: true } : { docState: 'loading', docErrorTitle: '', docErrorText: '' })
    return api.getMyDocuments({ pageSize: DOC_PAGE_SIZE, ...(cursor ? { cursor } : {}) })
      .then((page) => {
        const raw = Array.isArray(page && page.items) ? page.items : (Array.isArray(page) ? page : [])
        const usable = raw.filter((doc) => pkg.isPackagePrintable(doc)).map(toDocRow)
        const kept = new Map(this.data.docs.map((row) => [row.id, row]))
        const docs = append ? [...this.data.docs] : []
        for (const row of usable) {
          if (append && kept.has(row.id)) continue
          // 非追加（首屏 / 重试 / 上传后刷新）也必须把已勾选状态带过来。
          // 不带的话，用户勾了 A 再上传 B，A 的勾选会在刷新里被悄悄丢掉，
          // 而界面只显示 B 被选中 —— 他会以为 A 还在包里。
          const previous = kept.get(row.id)
          docs.push(previous ? Object.assign({}, row, { selected: previous.selected }) : row)
        }
        this.setData({
          docs,
          docCursor: (page && page.nextCursor) || null,
          docState: 'ready',
          docLoadingMore: false,
        })
        this._syncSelection()
      })
      .catch((err) => {
        const shown = pkg.describePackageError(err, '文件列表加载失败，请稍后重试。')
        this.setData({
          docState: 'error',
          docLoadingMore: false,
          docErrorTitle: shown.title,
          docErrorText: shown.text,
        })
      })
  },

  retryDocs() {
    this._loadDocs()
  },

  loadMoreDocs() {
    if (!this.data.docLoadingMore) this._loadDocs(true)
  },

  toLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' })
  },

  goBack() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  /** 勾选 / 取消勾选。任何选择变动都会作废已完成的隐私检查结论。 */
  toggleDoc(e) {
    const { id } = e.currentTarget.dataset
    const docs = this.data.docs.map((row) => row.id === id ? Object.assign({}, row, { selected: !row.selected }) : row)
    this.setData({ docs })
    this._syncSelection()
  },

  /**
   * 选择变了就把隐私检查打回未做。
   *
   * 不这么做会出现一种假成功：用户勾了 A、扫完 A、再加勾 B，页面仍显示「隐私检查已完成」，
   * 而 B 从没扫过 —— 下单会被服务端拒，用户却已经被告知一切就绪。
   */
  _syncSelection() {
    const selected = this.data.docs.filter((row) => row.selected)
    this.setData({
      selectedCount: selected.length,
      piiPhase: 'idle',
      piiGroups: [],
      piiFindingCount: 0,
      piiError: '',
    })
  },

  setColorMode(e) {
    this.setData({ colorMode: e.currentTarget.dataset.mode })
  },

  setDuplex(e) {
    this.setData({ duplex: e.currentTarget.dataset.mode })
  },

  decreaseCopies() {
    this.setData({ copies: Math.max(1, this.data.copies - 1) })
  },

  increaseCopies() {
    this.setData({ copies: Math.min(10, this.data.copies + 1) })
  },

  /**
   * 从微信聊天选文件并真实上传，拿服务端 fileId 后刷新列表并自动勾上。
   *
   * 保留改版前的 `count: 9` 多选（材料包本来就是「一次备齐多份材料」，
   * 改成一次一个是实打实的能力退化）。上传逐个串行：微信上传本身是单文件接口，
   * 并发只会放大失败面，而且失败时说不清是哪一个没上去。
   * 部分成功如实反映：已上传的留下并自动勾上，失败的逐个点名。
   */
  addFile() {
    if (this.data.uploading) return
    if (!auth.isLoggedIn()) { this.toLogin(); return }
    wx.chooseMessageFile({
      count: 9,
      type: 'file',
      extension: ['pdf', 'doc', 'docx'],
      success: (res) => {
        const picked = (res.tempFiles || []).filter((f) => f && f.path)
        if (!picked.length) return
        this.setData({ uploading: true })
        wx.showLoading({ title: `正在上传 1/${picked.length}…`, mask: true })
        const uploadedIds = []
        const failures = []
        const step = (index) => {
          if (index >= picked.length) {
            wx.hideLoading()
            this.setData({ uploading: false })
            return this._loadDocs().then(() => {
              if (uploadedIds.length) {
                const docs = this.data.docs.map((row) => uploadedIds.indexOf(row.id) >= 0
                  ? Object.assign({}, row, { selected: true })
                  : row)
                this.setData({ docs })
                this._syncSelection()
              }
              if (failures.length) {
                wx.showModal({
                  title: uploadedIds.length ? '部分文件未上传' : '上传失败',
                  content: failures.join('\n'),
                  showCancel: false,
                  confirmText: '知道了',
                })
              }
            })
          }
          wx.showLoading({ title: `正在上传 ${index + 1}/${picked.length}…`, mask: true })
          return api.uploadPrintFile(picked[index].path, picked[index].name)
            .then((uploaded) => {
              const fileId = uploaded && (uploaded.fileId || uploaded.id)
              if (fileId) uploadedIds.push(fileId)
              return step(index + 1)
            })
            .catch((err) => {
              const shown = pkg.describePackageError(err, '上传失败，请稍后重试。')
              failures.push(`${picked[index].name || '文件'}：${shown.text}`)
              return step(index + 1)
            })
        }
        step(0)
      },
      fail: (err) => {
        if (err.errCode !== -2) wx.showToast({ title: '文件选择失败', icon: 'none' })
      },
    })
  },

  /**
   * 对所有需要检查的已选文件依次跑打印隐私检查。
   *
   * 逐个串行而不是并发：检查是模型/规则调用，并发只会把失败面放大，而这一步不赶时间。
   * 任何一个文件失败就整体进失败态 —— 服务端是**逐文件**硬校验的，剩下的做完也过不了。
   */
  runPrivacyScan() {
    const targets = this.data.docs.filter((row) => row.selected && row.needsPii)
    if (!this.data.selectedCount) {
      wx.showToast({ title: '请先选择文件', icon: 'none' })
      return
    }
    if (!targets.length) {
      this.setData({ piiPhase: 'ready', piiGroups: [], piiFindingCount: 0, piiError: '' })
      return
    }
    this.setData({ piiPhase: 'scanning', piiGroups: [], piiFindingCount: 0, piiError: '' })
    const groups = []
    const step = (index) => {
      if (index >= targets.length) {
        const count = groups.reduce((sum, g) => sum + g.findings.length, 0)
        this.setData({
          piiGroups: groups,
          piiFindingCount: count,
          piiPhase: count ? 'review' : 'ready',
        })
        return
      }
      const row = targets[index]
      api.createPrintPiiScan(row.id)
        .then((task) => {
          const findings = Array.isArray(task && task.piiFindings)
            ? task.piiFindings.filter((f) => f.action === 'pending')
            : []
          if (findings.length) groups.push({ taskId: (task && task.id) || '', fileName: row.name, findings })
          step(index + 1)
        })
        .catch((err) => {
          const shown = pkg.describePackageError(err, '隐私检查失败，请稍后重试。')
          this.setData({ piiPhase: 'error', piiError: `${row.name}：${shown.text}` })
        })
    }
    step(0)
  },

  retryPrivacy() {
    this.runPrivacyScan()
  },

  /** 一次性对所有待决 finding 提交「原样保留」的本人决定。 */
  confirmPrivacy() {
    if (this.data.piiSubmitting) return
    const groups = this.data.piiGroups.filter((g) => g.taskId && g.findings.length)
    if (!groups.length) { this.setData({ piiPhase: 'ready' }); return }
    this.setData({ piiSubmitting: true })
    const step = (index) => {
      if (index >= groups.length) {
        this.setData({ piiSubmitting: false, piiPhase: 'ready', piiGroups: [], piiFindingCount: 0 })
        wx.showToast({ title: '已确认', icon: 'success' })
        return
      }
      const group = groups[index]
      const decisions = group.findings.map((f) => ({ findingId: f.id, action: 'keep' }))
      api.decidePrintPiiFindings(group.taskId, decisions)
        .then(() => step(index + 1))
        .catch((err) => {
          const shown = pkg.describePackageError(err, '确认失败，请稍后重试。')
          this.setData({ piiSubmitting: false })
          wx.showModal({ title: shown.title, content: shown.text, showCancel: false })
        })
    }
    step(0)
  },

  /**
   * 进入服务点选择。只把**服务端 fileId** 和打印参数交给下一步，不带任何金额或页数。
   */
  createPackage() {
    if (!auth.isLoggedIn()) { this.toLogin(); return }
    const selected = this.data.docs.filter((row) => row.selected)
    if (!selected.length) {
      wx.showToast({ title: '请先选择文件', icon: 'none' })
      return
    }
    if (this.data.piiPhase !== 'ready') {
      wx.showModal({
        title: '还不能继续',
        content: this.data.piiPhase === 'scanning'
          ? '文件仍在隐私检查中，请稍候。'
          : '服务端要求材料包内每个文件都先完成打印隐私检查，请先完成再继续。',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    wx.setStorageSync('temp_package_data', {
      files: selected.map((row) => ({ fileId: row.id, name: row.name })),
      colorMode: this.data.colorMode,
      duplex: this.data.duplex,
      copies: this.data.copies,
    })
    wx.navigateTo({ url: '/pages/store-select/store-select?from=package-create' })
  },

  // 不提供 onShareAppMessage：这条链上的每一页都只对本人有意义（文件、到机码、订单
  // 都绑在登录账号上），转发出去对收到的人只会是一页失败态。
})
