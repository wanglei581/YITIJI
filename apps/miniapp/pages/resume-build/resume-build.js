const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const storage = require('../../utils/storage')
const model = require('../../utils/resume-build-model')
const view = require('./resume-build-view')

/** 三段可重复条目的规格。key 就是 data 里的数组名，wxml 通过 data-group 指过来。 */
const ROWS = {
  eduRows: { label: '教育经历', max: model.MAX_EDUCATION, make: model.emptyEducation },
  expRows: { label: '实习 / 工作经历', max: model.MAX_EXPERIENCE, make: model.emptyExperience },
  projRows: { label: '项目经历', max: model.MAX_PROJECTS, make: model.emptyProject },
}

/**
 * 从零建一份简历。
 *
 * 给**没有简历**的人用：现有链路是「上传 → 诊断 → 优化」，一份都没有的应届生
 * 根本进不来。
 *
 * 这一页的红线（后端 DTO 注释原文：「输入只是求职者本人提供的简历资料；
 * AI 只润色，不编造」，契约在 service 层强制）在前端的对应物是三条：
 *
 *   1. **这是表单，不是聊天。** 页面上没有、也不会有「帮你写一段实习经历」
 *      「帮你想几个亮点」这类入口。AI 拿到的只有用户自己敲进去的字。
 *   2. **没填的段落在结果里可见地留空**（渲染成「（未填写：项目经历）」），
 *      再叠加服务端确定性算出的 missingHints。任何位置都不出现「已为你补全」。
 *   3. **AI 失败时必须给出退路**：draft:true 导出把用户填的内容原样排版成文件
 *      （服务端据此把 PDF 元数据标成 AIGenerated='false'）。用户站在一台打印
 *      终端前，不能因为模型挂了就一张纸都拿不走，更不能转圈假装成功。
 *
 * 刻意没有的东西：进度百分比（POST 同步返回，服务端不给进度，只显示真实已用秒数）、
 * 「预计还剩」、任何关于录用或面试结果的表述。
 */
Page({
  data: {
    statusBarHeight: 20,

    /**
     * 页面阶段。单一取值，不要再加并行布尔：
     *   form     分段填写中（6 段）
     *   running  已提交，正在等服务端返回。POST /resume/generate 是同步的——
     *            没有「已受理」这个中间里程碑可以上报，硬分出 submitting 就是编进度
     *   loading  正在读取历史结果（从「我的 · AI 服务记录」带 ?taskId= 进来）
     *   done     拿到真实结果
     *   failed   失败，出口由 failKind 决定
     */
    phase: 'form',
    /** failed 的三种出口：retry 可重试 / refill 回去改填写 / login 需登录 */
    failKind: 'retry',
    failMsg: '',
    /** 历史结果只读展示：不重新调用 AI，也不在这一页覆盖它 */
    historyMode: false,
    /** 从语音向导交接过来：失败态文案走「按你说的原话」，缺项最多展示 3 条 */
    fromVoice: false,

    step: 0,
    steps: view.steps(),

    basic: { name: '', phone: '', email: '', city: '' },
    intention: { position: '', city: '', jobType: '', salary: '' },
    eduRows: [],
    expRows: [],
    projRows: [],
    skillsText: '',
    certsText: '',
    selfIntro: '',
    skillChips: [],
    certChips: [],

    LEN: model.LEN,
    maxEdu: model.MAX_EDUCATION,
    maxExp: model.MAX_EXPERIENCE,
    maxProj: model.MAX_PROJECTS,
    maxSkills: model.MAX_SKILLS,
    maxCerts: model.MAX_CERTIFICATES,

    elapsed: 0,
    result: null,
    exporting: false,

    format: 'pdf',
    // 排版默认值与 ResumeLayoutDto 的服务端缺省一致；页面上选中的就是会提交的那一份
    layout: { fontScale: 'standard', lineSpacing: 'standard', margin: 'normal', columns: 1, accent: 'blue' },
    optionGroups: [],
  },

  onLoad(options) {
    this.setData({ statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20 })
    this._syncOptions()

    const historyTaskId = (options && options.taskId) || ''
    if (historyTaskId) {
      this._taskId = historyTaskId
      // 匿名结果的读取凭证只在提交时下发一次。这里只在「storage 里那条任务
      // 恰好就是要看的这条」时才拿来用；对不上就传空串走会员登录态。
      // 注意 RESUME_TASK 存的是**解析**任务，诊断/优化/岗位匹配/职业规划/自我探索
      // 五个页面都在读它——所以这一页只读不写，写进去会把那五页指到 kind 不对的任务上。
      const saved = storage.get(storage.KEYS.RESUME_TASK) || {}
      this._token = saved.taskId === historyTaskId ? (saved.accessToken || '') : ''
      this.setData({ historyMode: true, phase: 'loading' })
      this._loadHistory()
      return
    }

    this._token = ''
    this._taskId = ''
    if (options && options.from === 'voice' && this._hydrateFromVoice()) return
    // 首屏就给一条教育、一条经历，省掉「先点加号」这一步；留空不填也能提交。
    this.setData({ eduRows: [model.emptyEducation()], expRows: [model.emptyExperience()] })
  },

  onUnload() {
    this._gone = true
    this._stopElapsed()
  },

  /** 登录页是 navigateTo 压栈的，登录完 navigateBack 回来，表单内容原样还在 */
  onShow() {
    if (!this._waitingForLogin || !auth.isLoggedIn()) return
    this._waitingForLogin = false
    const pending = this._pendingExport
    this._pendingExport = null
    if (pending) this._export(pending.draft)
  },

  // ── 表单录入 ─────────────────────────────────────────────────

  /**
   * 基本信息 / 求职意向：group 是 data 里的对象名，key 是 DTO 字段名。
   * 只写回改动的那一个路径——整对象 setData 会让同屏其他输入框一起重渲染。
   */
  onFlat(e) {
    const ds = e.currentTarget.dataset
    if (!ds.group || !ds.key) return
    this.setData({ [`${ds.group}.${ds.key}`]: e.detail.value })
  },

  /** 三段可重复条目共用：group 是数组名，index 是行号，key 是 DTO 字段名。 */
  onRow(e) {
    const ds = e.currentTarget.dataset
    if (!ds.group || !ds.key) return
    this.setData({ [`${ds.group}[${ds.index}].${ds.key}`]: e.detail.value })
  },

  /** chip 预览就是将要提交的那一份，让分隔符的解析结果当场可见，不做静默改写 */
  onSkills(e) {
    const text = e.detail.value
    this.setData({ skillsText: text, skillChips: model.parseList(text) })
  },

  onCerts(e) {
    const text = e.detail.value
    this.setData({ certsText: text, certChips: model.parseList(text) })
  },

  onSelfIntro(e) { this.setData({ selfIntro: e.detail.value }) },

  addRow(e) {
    const group = e.currentTarget.dataset.group
    const spec = ROWS[group]
    if (!spec) return
    const rows = this.data[group]
    // 上限是 DTO 的 @ArrayMaxSize，超了后端直接 400；在按钮这里就挡住
    if (rows.length >= spec.max) {
      wx.showToast({ title: `${spec.label}最多 ${spec.max} 条`, icon: 'none' })
      return
    }
    this.setData({ [group]: rows.concat([spec.make()]) }, () => this._syncSteps())
  },

  /** 删除会丢掉用户已经敲进去的字，问一句再删 */
  removeRow(e) {
    const ds = e.currentTarget.dataset
    const rows = this.data[ds.group]
    const i = Number(ds.index)
    if (!rows || !(i >= 0) || i >= rows.length) return
    wx.showModal({
      title: '删除这一条',
      content: '这一条里已填的内容会一起删掉。',
      confirmText: '删除',
      cancelText: '保留',
      success: (r) => {
        if (!r.confirm) return
        this.setData({ [ds.group]: rows.slice(0, i).concat(rows.slice(i + 1)) }, () => this._syncSteps())
      },
    })
  },

  // ── 分段导航 ─────────────────────────────────────────────────

  prevStep() { this._gotoStep(this.data.step - 1) },
  nextStep() { this._gotoStep(this.data.step + 1) },
  goStep(e) { this._gotoStep(Number(e.currentTarget.dataset.step)) },

  _gotoStep(index) {
    const next = Math.max(0, Math.min(this.data.steps.length - 1, index))
    this.setData({ step: next }, () => this._syncSteps())
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  /**
   * 步骤条上的「已填」标记。只在切段/增删条目时重算：当前段永远显示为 on，
   * 段内逐字重算等于每敲一个键就整数组 setData 一次，换不来任何用户可见的差别。
   */
  _syncSteps() {
    this.setData({ steps: view.markFilled(this.data.steps, this._form()) })
  },

  // ── 生成 ─────────────────────────────────────────────────────

  submit() {
    if (this.data.phase === 'running') return
    const form = this._form()
    const errors = model.validate(form)
    if (errors.length) {
      wx.showModal({
        title: '还差几项',
        content: errors.slice(0, 4).join('\n') + (errors.length > 4 ? `\n…另有 ${errors.length - 4} 项` : ''),
        showCancel: false,
        confirmText: '去修改',
      })
      return
    }

    const seq = (this._seq = (this._seq || 0) + 1)
    this.setData({ phase: 'running', elapsed: 0, failMsg: '' })
    this._startElapsed()

    api.submitResumeGenerate(model.buildGeneratePayload(form), this._token)
      .then((res) => {
        this._stopElapsed()
        if (this._gone || seq !== this._seq) return
        // 匿名令牌只在这一次响应里出现，丢了就只能重新生成（再花一次模型调用）
        if (res && res.accessToken) this._token = res.accessToken
        if (res && res.taskId) this._taskId = res.taskId
        // 失败是 200 + status:'failed'，不是 HTTP 错误码，必须显式判
        if (!res || res.status === 'failed' || !res.resume) {
          this._fail((res && res.failReason) || '服务端没有返回可展示的简历内容', 'retry')
          return
        }
        this._resumeRaw = res.resume
        this.setData({ phase: 'done', result: this._resultView(res) })
        wx.pageScrollTo({ scrollTop: 0, duration: 200 })
      })
      .catch((err) => {
        this._stopElapsed()
        if (this._gone || seq !== this._seq) return
        this._failFromError(err, 'AI 简历生成没有成功')
      })
  },

  tapRegenerate() {
    if (this.data.historyMode) {
      wx.showToast({ title: '历史结果只读，请从头填写后再生成', icon: 'none' })
      return
    }
    wx.showModal({
      title: '重新生成',
      content: '会按当前填写的内容再调用一次 AI，覆盖现在这份结果。',
      confirmText: '重新生成',
      cancelText: '取消',
      success: (r) => { if (r.confirm) this.submit() },
    })
  },

  /**
   * 401 之后的出口。登录页是压栈打开的，回来后由用户自己点「重试一次」——
   * 不自动重发：那是一次真花钱的模型调用，不该在用户没按的情况下发生。
   */
  goLogin() {
    wx.navigateTo({
      url: '/pages/launch/launch',
      fail() { wx.showToast({ title: '登录页面打开失败', icon: 'none' }) },
    })
  },

  retry() {
    if (this.data.historyMode) {
      this.setData({ phase: 'loading', failMsg: '' })
      this._loadHistory()
      return
    }
    this.submit()
  },

  backToForm() {
    if (this.data.historyMode) {
      // 历史记录里只有生成结果，没有当时的填写内容（服务端不留原始输入），
      // 退回表单只能是空白的。说清楚再走，不要让用户以为原来填的那份还在。
      wx.showModal({
        title: '从头填写',
        content: '历史记录里只保存了生成结果，没有当时的填写内容。继续会打开一份空白表单。',
        confirmText: '继续',
        cancelText: '返回',
        success: (r) => {
          if (!r.confirm) return
          this._resumeRaw = null
          this._taskId = ''
          this.setData({ historyMode: false, phase: 'form', step: 0, result: null, failMsg: '' })
        },
      })
      return
    }
    this.setData({ phase: 'form' })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  _loadHistory() {
    api.getResumeGenerate(this._taskId, this._token)
      .then((res) => {
        if (this._gone) return
        if (!res || res.status === 'failed' || !res.resume) {
          this._fail((res && res.failReason) || '这条生成记录没有可展示的结果', 'refill')
          return
        }
        this._resumeRaw = res.resume
        this.setData({ phase: 'done', result: this._resultView(res) })
      })
      .catch((err) => {
        if (this._gone) return
        if (err && err.statusCode === 404) {
          this._fail('这条记录已过期或不存在。简历派生结果按隐私策略到期自动清理。', 'refill')
          return
        }
        this._failFromError(err, '历史结果读取失败')
      })
  },

  _failFromError(err, fallbackMsg) {
    const f = view.classifyFailure(err, fallbackMsg)
    this._fail(f.msg, f.kind)
  },

  _fail(msg, kind) {
    this.setData({ phase: 'failed', failMsg: msg, failKind: kind || 'retry' })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  // 已用秒数是真实计时。服务端不上报进度，所以这里没有百分比，也没有「预计还剩」。
  _startElapsed() {
    this._stopElapsed()
    this._t0 = Date.now()
    this._timer = setInterval(() => {
      if (this._gone) { this._stopElapsed(); return }
      this.setData({ elapsed: Math.floor((Date.now() - this._t0) / 1000) })
    }, 1000)
  },

  _stopElapsed() {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
  },

  // ── 导出 ─────────────────────────────────────────────────────

  /** 导出格式与 5 个排版参数共用一个分段选择器；opt 是字段名，val 是取值 */
  pickOption(e) {
    const ds = e.currentTarget.dataset
    if (!ds.opt) return
    if (ds.opt === 'format') {
      this.setData({ format: String(ds.val) }, () => this._syncOptions())
      return
    }
    // columns 的 DTO 是 @IsIn([1, 2])，全局 ValidationPipe 没开 enableImplicitConversion，
    // 传字符串 '1' 会被判 400，必须是数字。
    const value = ds.opt === 'columns' ? Number(ds.val) : String(ds.val)
    this.setData({ [`layout.${ds.opt}`]: value }, () => this._syncOptions())
  },

  _syncOptions() {
    this.setData({ optionGroups: model.syncOptionGroups(model.optionGroups(), this.data.format, this.data.layout) })
  },

  tapExport() { this._export(false) },

  /**
   * 原样草稿导出：内容逐字来自用户填写，未经模型润色。
   * 这是 AI 不可用时的退路——功能退化成「按你填的排版」，不是转圈假装成功，
   * 也不是干脆不给导出。
   */
  tapExportDraft() { this._export(true) },

  _export(draft) {
    if (this.data.exporting) return
    // 草稿走的是表单原文，没经过提交那一遍校验，这里补上——否则会拿一份
    // 后端必然 400 的 body 去换一次白等
    if (draft) {
      const errors = model.validate(this._form())
      if (errors.length) {
        wx.showModal({ title: '还差几项', content: errors.slice(0, 4).join('\n'), showCancel: false, confirmText: '去修改' })
        return
      }
    }
    const source = draft ? model.formAsResume(this._form()) : this._resumeRaw
    if (!source || !String((source.basic && source.basic.name) || '').trim()) {
      wx.showToast({ title: '没有可导出的内容', icon: 'none' })
      return
    }
    // 导出的文件要挂在本人账号下才会进「我的文档」，也才换得到打印用的签名链接；
    // 匿名导出的文件 endUserId 为空，走到打印页必吃 403。与其让用户白等一次，
    // 不如在这里说清楚。
    if (!auth.isLoggedIn()) {
      this._askLogin(draft)
      return
    }

    const format = this.data.format
    const body = model.buildExportPayload(source, {
      format,
      taskId: this._taskId,
      draft,
      layout: this.data.layout,
    })

    this.setData({ exporting: true })
    wx.showLoading({ title: draft ? '正在排版…' : '正在生成文件…', mask: true })
    api.exportGeneratedResume(body, this._token)
      .then((res) => {
        wx.hideLoading()
        if (this._gone) return
        this.setData({ exporting: false })
        const fileId = (res && res.fileId) || ''
        if (!fileId) {
          this._exportFailed('服务端没有返回可用文件，请稍后重试。')
          return
        }
        const filename = (res && res.filename) || `简历.${format}`
        if (format !== 'pdf') {
          // 打印链路只收 PDF/JPG/PNG，docx/txt/md 进不了打印页。文件确实已经落到
          // 本人账号下，就说到这里为止，不顺嘴说成「可以去打印」。
          wx.showModal({
            title: '文件已生成',
            content: `${filename} 已存入你的「我的文档」。打印只接受 PDF，需要打印请把格式改成 PDF 再导出一次。`,
            confirmText: '去我的文档',
            cancelText: '知道了',
            success: (r) => { if (r.confirm) wx.navigateTo({ url: '/pages/documents/documents' }) },
          })
          return
        }
        // 产出文件归属本人（endUserId 已绑定），走普通 fileId 路径，
        // 不传 printFileUrl——那条旁路只给招聘会共享派生文件用。
        const name = encodeURIComponent(filename)
        const fid = encodeURIComponent(fileId)
        const pages = (res && res.pageCount) || ''
        wx.navigateTo({ url: `/pages/print-upload/print-upload?name=${name}&fileId=${fid}&pages=${pages}` })
      })
      .catch((err) => {
        wx.hideLoading()
        if (this._gone) return
        this.setData({ exporting: false })
        if (err && err.statusCode === 401) {
          this._askLogin(draft)
          return
        }
        this._exportFailed((err && err.message) || '请稍后重试')
      })
  },

  _exportFailed(msg) {
    wx.showModal({ title: '未能生成文件', content: msg, showCancel: false, confirmText: '知道了' })
  },

  _askLogin(draft) {
    this._pendingExport = { draft }
    wx.showModal({
      title: '需要登录',
      content: '导出的简历要归到你本人账号，才能进「我的文档」并用于打印。登录后会回到这一页，已填内容不会丢。',
      confirmText: '去登录',
      cancelText: '再想想',
      success: (r) => {
        if (!r.confirm) {
          this._pendingExport = null
          return
        }
        this._waitingForLogin = true
        wx.navigateTo({
          url: '/pages/launch/launch',
          fail: () => {
            this._waitingForLogin = false
            this._pendingExport = null
            wx.showToast({ title: '登录页面打开失败', icon: 'none' })
          },
        })
      },
    })
  },

  _form() {
    const d = this.data
    return {
      basic: d.basic,
      intention: d.intention,
      eduRows: d.eduRows,
      expRows: d.expRows,
      projRows: d.projRows,
      skillsText: d.skillsText,
      certsText: d.certsText,
      selfIntro: d.selfIntro,
    }
  },

  goBack() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },

  goVoice() {
    const form = this._form()
    const dirty = Boolean(String((form.basic && form.basic.name) || '').trim()
      || String((form.intention && form.intention.position) || '').trim())
    const open = () => {
      wx.navigateTo({
        url: '/pages/resume-voice/resume-voice',
        fail() { wx.showToast({ title: '页面打开失败', icon: 'none' }) },
      })
    }
    if (!dirty) { open(); return }
    wx.showModal({
      title: '改用语音填写',
      content: '语音是从头一题一问，这边已经填的内容不会带过去。文字入口仍在。',
      confirmText: '去语音',
      cancelText: '留下',
      success: (r) => { if (r.confirm) open() },
    })
  },

  _resultView(res) {
    const result = view.toResultView(res)
    if (this.data.fromVoice && result.missingHints && result.missingHints.length > 3) {
      result.missingHints = result.missingHints.slice(0, 3)
    }
    return result
  },

  _hydrateFromVoice() {
    const handoff = storage.get(storage.KEYS.RESUME_VOICE_HANDOFF)
    storage.remove(storage.KEYS.RESUME_VOICE_HANDOFF)
    if (!handoff || !handoff.form) return false
    const form = handoff.form
    this.setData({
      fromVoice: true,
      basic: form.basic || { name: '', phone: '', email: '', city: '' },
      intention: form.intention || { position: '', city: '', jobType: '', salary: '' },
      eduRows: (form.eduRows && form.eduRows.length) ? form.eduRows : [model.emptyEducation()],
      expRows: (form.expRows && form.expRows.length) ? form.expRows : [model.emptyExperience()],
      projRows: form.projRows || [],
      skillsText: form.skillsText || '',
      certsText: form.certsText || '',
      selfIntro: form.selfIntro || '',
      skillChips: model.parseList(form.skillsText),
      certChips: model.parseList(form.certsText),
    }, () => {
      this._syncSteps()
      this.submit()
    })
    return true
  },
})
