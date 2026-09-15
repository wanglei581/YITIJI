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
const { createLifecycleGuard, memberIdentityKey, isMemberIdentity } = require('../../utils/page-guard')

const DOC_PAGE_SIZE = 20

/**
 * 草稿指纹。**内容变了才算新草稿。**
 *
 * 用它当 draftId 而不是 `Date.now()`，解决的是一对互相拉扯的要求：
 *   - 不能串草稿：上一份草稿选好的服务点不许接到这一份上（换了文件或参数，
 *     那台机器可能根本没验过新参数要的能力）。
 *   - 不能无故丢选择：用户从确认页退回来看一眼又继续，选择完全没变，
 *     却被迫重选一次服务点 —— 那是纯粹的能力退化。
 * 指纹让这两件事自然成立：内容没变 → id 不变 → 服务点绑定照常有效；
 * 改了任何一个文件或参数 → id 变 → 旧绑定自动失效，确认页会要求重选。
 */
function draftFingerprint(ownerKey, files, colorMode, duplex, copies) {
  return [
    ownerKey,
    colorMode,
    duplex,
    String(copies),
    files.map((row) => row.id).join(','),
  ].join('|')
}

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
    // 「加载更多」失败单独成一个字段：写进 docState 会让整段已加载的文件被错误态顶掉。
    docMoreErrorText: '',

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
    this._guard = createLifecycleGuard()
    this._guard.activate()
  },

  /**
   * 当前身份的稳定快照。三态：`''` 未登录 / `'!'` 登录但无 id（不可用）/ `'u:<id>'`。
   * 不可用时本页不拉文件列表、不写草稿 —— 见 page-guard.memberIdentityKey。
   */
  _identityKey() {
    return memberIdentityKey(auth)
  },

  /** 当前身份能不能用来读写本人数据。 */
  _identityUsable() {
    return isMemberIdentity(this._identityKey())
  },

  /** 这个响应还能不能回写文件状态：身份没变 + 页面在前台 + 是本通道最新一次请求。 */
  _accepts(token) {
    return this._guard.accepts(token, this._identityKey())
  },

  onShow() {
    this._guard.activate()
    const previous = this._guard.identity()
    const identity = this._identityKey()
    const usable = isMemberIdentity(identity)
    // setIdentity 变化时 +1 代次：上一位在途的文档请求、上传链、隐私检查一并作废，
    // 它们的迟到响应不会把上一位的文件名再写回来。
    if (this._guard.setIdentity(identity)) {
      // **只有从另一个确定的会员身份切过来才算换人。**
      // 首次进入（''→本人）和刚登录（未登录→本人）都不是换人 —— 此前这里一律当成
      // 换人并 removeStorageSync，于是用户从服务点/确认页用 redirectTo 兜底回到本页时，
      // 自己刚做好的草稿会被自己的"登录"顺手删掉。
      if (isMemberIdentity(previous) && previous !== identity) this._resetForIdentity()
    }
    // 不管换没换人，都确认一次 storage 里那份草稿确实属于当前这位。
    // 本人的草稿原样保留；别人的（或身份不可用时的任何草稿）直接清掉。
    this._dropForeignDraft()
    this.setData({ isLoggedIn: usable })
    // 切后台会作废在途的翻页请求，docLoadingMore 会一直停在 true，
    // 「加载更多文件」从此点不动。回到前台先把这个按钮锁解开。
    if (this.data.docLoadingMore && !this._guard.accepts(this._docsToken)) {
      this.setData({ docLoadingMore: false })
    }
    // 切后台会作废在途的隐私检查与逐条确认链。回来后必须把它们从「进行中」拉回来：
    // 否则页面会一直显示「文件仍在隐私检查中」，而其实一个请求都没有在跑，
    // 用户既等不到结果也点不了下一步。回到 idle 是 fail-closed 的方向 ——
    // 重新扫一遍，而不是替服务端宣布已经扫过。
    if (this.data.piiPhase === 'scanning' || this.data.piiSubmitting) {
      this.setData({ piiPhase: 'idle', piiSubmitting: false, piiGroups: [], piiFindingCount: 0, piiError: '' })
    }
    // docState 还停在 'loading'，说明上一次请求在切后台时被作废了。这里必须重发，
    // 否则页面会永远卡在「正在读取我的文件」——重发的新令牌序号更大，旧响应即使
    // 之后到达也覆盖不了新结果。
    // docState 还停在 'loading' **且那次请求确实已经作废**时才重发：
    // 只看 docState 会在同一轮里把刚发出的那次重发一遍。
    if (usable && (this.data.docState === 'idle'
      || (this.data.docState === 'loading' && !this._guard.accepts(this._docsToken)))) this._loadDocs()
  },

  /**
   * 只清理**不属于**当前这位的草稿；本人的原样保留。
   *
   * 与 `_resetForIdentity()` 的分工：那个是"换人了，屏幕上的一切都要换掉"；
   * 这个是"屏幕不动，只把本机 storage 里别人的东西清走"。混成一个就会出现
   * 本轮修的那个缺陷 —— 用户自己的登录把自己的草稿删了。
   */
  _dropForeignDraft() {
    const draft = wx.getStorageSync('temp_package_data')
    if (!draft) return
    const identity = this._identityKey()
    const ownerKey = draft && draft.ownerKey ? String(draft.ownerKey) : ''
    if (!isMemberIdentity(identity) || ownerKey !== identity) {
      wx.removeStorageSync('temp_package_data')
      wx.removeStorageSync('temp_selected_store')
    }
  },

  onHide() {
    this._guard.deactivate()
  },

  onUnload() {
    this._guard.deactivate()
  },

  /**
   * 身份变化（含首次进入、登出、换账号）：清空上一位的文件列表、勾选、隐私检查结论，
   * 并把草稿整份作废。
   *
   * 草稿与已选服务点**必须一起清**：只清一半会让下一位在 package-confirm 上看到
   * 「有服务点没文件」或反过来的半截草稿，而那半截里就带着上一位的文件名。
   */
  _resetForIdentity() {
    this.setData({
      docs: [], docCursor: null, docState: 'idle', docLoadingMore: false,
      docErrorTitle: '', docErrorText: '', docMoreErrorText: '', uploading: false,
      selectedCount: 0, piiPhase: 'idle', piiGroups: [], piiFindingCount: 0, piiError: '',
      piiSubmitting: false,
    })
    wx.removeStorageSync('temp_package_data')
    wx.removeStorageSync('temp_selected_store')
  },

  /**
   * 本人文档列表。失败给可重试的失败态，空给「去上传」的空态 —— 两者补救动作不同，
   * 不能合成一句（docs/product/content-onboarding-runbook.md §5C）。
   */
  _loadDocs(append = false) {
    if (!this._identityUsable()) return Promise.resolve()
    if (append && !this.data.docCursor) return Promise.resolve()
    const token = this._guard.issue('docs')
    this._docsToken = token
    const cursor = append ? this.data.docCursor : null
    this.setData(append
      ? { docLoadingMore: true, docMoreErrorText: '' }
      : { docState: 'loading', docErrorTitle: '', docErrorText: '', docMoreErrorText: '' })
    return api.getMyDocuments({ pageSize: DOC_PAGE_SIZE, ...(cursor ? { cursor } : {}) })
      .then((page) => {
        // 迟到的响应到此为止：换了人、切了后台，或本通道已被重新发起过一次。
        if (!this._accepts(token)) return
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
          docErrorTitle: '', docErrorText: '', docMoreErrorText: '',
        })
        this._syncSelection()
      })
      .catch((err) => {
        if (!this._accepts(token)) return
        const shown = pkg.describePackageError(err, '文件列表加载失败，请稍后重试。')
        // 翻页失败只写 docMoreErrorText，**不碰 docState**：模板里 docState === 'error'
        // 那一支会把整段文件列表换成错误卡片，用户已经勾好的文件会连同列表一起消失，
        // 而失败的其实只是下一页。首屏 / 重试失败才进 docState=error（此时本来也没有
        // 可保留的内容）。与「打印订单」页材料包分区的 pkgMoreErrorText 同一口径。
        if (append) {
          this.setData({ docLoadingMore: false, docMoreErrorText: shown.text })
          return
        }
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

  retryMoreDocs() {
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
    if (!this._identityUsable()) { this.toLogin(); return }
    wx.chooseMessageFile({
      count: 9,
      type: 'file',
      extension: ['pdf', 'doc', 'docx'],
      success: (res) => {
        const picked = (res.tempFiles || []).filter((f) => f && f.path)
        if (!picked.length) return
        this.setData({ uploading: true })
        // 上传链自己一个通道：整条链（含上传后的列表刷新与自动勾选）都按这个令牌判定。
        // 换了人或离开了本页之后，剩下的文件不再上传，也不回写任何文件状态 ——
        // 否则 B 的界面上会冒出 A 刚上传的文件名，并且已经被自动勾选。
        const token = this._guard.issue('upload')
        wx.showLoading({ title: `正在上传 1/${picked.length}…`, mask: true })
        const uploadedIds = []
        const failures = []
        const step = (index) => {
          if (!this._accepts(token)) {
            wx.hideLoading()
            // uploading 是本页的按钮锁，不是上一位用户的数据 —— 必须解开，
            // 否则切后台再回来时「从微信聊天添加」会永久失灵。
            this.setData({ uploading: false })
            return Promise.resolve()
          }
          if (index >= picked.length) {
            wx.hideLoading()
            this.setData({ uploading: false })
            return this._loadDocs().then(() => {
              if (!this._accepts(token)) return
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
    // 隐私检查结论直接决定「能不能下单」。换了人之后它必须回到未做，
    // 绝不能让上一位扫过的结论替当前这位放行。
    const token = this._guard.issue('pii')
    const groups = []
    const step = (index) => {
      if (!this._accepts(token)) return
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
          if (!this._accepts(token)) return
          const findings = Array.isArray(task && task.piiFindings)
            ? task.piiFindings.filter((f) => f.action === 'pending')
            : []
          if (findings.length) groups.push({ taskId: (task && task.id) || '', fileName: row.name, findings })
          step(index + 1)
        })
        .catch((err) => {
          if (!this._accepts(token)) return
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
    const token = this._guard.issue('pii-decide')
    const step = (index) => {
      if (!this._accepts(token)) return
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
          if (!this._accepts(token)) return
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
    if (!this._identityUsable()) { this.toLogin(); return }
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
    // 草稿绑定到稳定的会员身份 + 一个本次草稿的 id。
    //
    // 不绑的话，`temp_package_data` 就是一份**谁都能读**的本机数据：共用设备上
    // A 走到一半离开，B 登录后深链打开 package-confirm，会直接看到 A 的文件名。
    // package-confirm 读取前会逐字核对 ownerKey，不匹配就同步删掉再进失败态。
    //
    // draftId 让「已选服务点」能跟这份草稿对上 —— 服务点是另一个 storage key，
    // 没有这个绑定就可能把上一份草稿选的机器接到这一份上。
    const ownerKey = this._identityKey()
    // draftId 是**内容指纹**，不是时间戳：同样的文件与参数再按一次「继续」，
    // 算出来的还是同一个 id，于是上一次选好的服务点仍然对得上、不用重选；
    // 改了任何一个文件或参数，id 自然就变了，旧的服务点绑定随之失效。
    const draftId = draftFingerprint(ownerKey, selected, this.data.colorMode, this.data.duplex, this.data.copies)
    wx.setStorageSync('temp_package_data', {
      ownerKey,
      draftId,
      files: selected.map((row) => ({ fileId: row.id, name: row.name })),
      colorMode: this.data.colorMode,
      duplex: this.data.duplex,
      copies: this.data.copies,
    })
    // 只在**确实对不上**时才清已选服务点。
    // 无条件清会让"退回来看一眼再继续"的用户每次都重选一台机器 —— 那是纯粹的能力退化；
    // 完全不清又会把上一份草稿选的机器接到这一份上，而那台机器未必验过新参数要的能力。
    const previousStore = wx.getStorageSync('temp_selected_store') || {}
    if (String(previousStore.ownerKey || '') !== ownerKey || String(previousStore.draftId || '') !== draftId) {
      wx.removeStorageSync('temp_selected_store')
    }
    wx.navigateTo({ url: '/pages/store-select/store-select?from=package-create' })
  },

  // 不提供 onShareAppMessage：这条链上的每一页都只对本人有意义（文件、到机码、订单
  // 都绑在登录账号上），转发出去对收到的人只会是一页失败态。
})
