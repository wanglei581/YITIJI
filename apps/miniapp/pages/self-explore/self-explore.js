const app = getApp()
// 雷达绘制抽到同目录 radar.js：主文件越过 §8 的 500 行评估阈值，
// 而绘制只依赖画布/数据/尺寸，是天然接缝。
const radar = require('./radar')
const RADAR_COLORS = radar.RADAR_COLORS
const DIM_COUNT_EXPECTED = radar.DIM_COUNT_EXPECTED
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const N = require('../../utils/normalize')
const storage = require('../../utils/storage')

/**
 * 自我探索 · 倾向参考。
 *
 * 命名不是措辞偏好。评定口吻的那一类词（把作答说成对人的评定、把结果说成对岗位的
 * 适配结论）在本页一律不出现：这里做的是对本人本次作答的倾向描述，不是对人的判定。
 * 口径与服务端 services/api/src/ai/resume/self-assessment-questions.ts 一致。
 *
 * 三条来自服务端源码的事实，页面必须照着做，不能凭观感发挥：
 *
 *   1. strength 是纯函数评分（self-assessment-scoring.ts：把本人所选 choice.weight
 *      累加后截断到 0..5），**与 LLM 无关**。LLM 只写 note 与 summary；模型不可用或
 *      命中合规词时服务端一律回 `{...d, note: null}`，strength 原样保留。
 *      所以雷达图只画 strength，绝不能拿 note 反推分数，note 缺失时也不补分。
 *
 *   2. 发给模型的只有「维度名（key）：强度 N/5」五行（llm-self-assessment.service.ts
 *      的 callLlm）。答案原文既不入库也不出网，落库的只有 SHA-256(answers) 摘要 +
 *      五维强度 + 解读文字。同意书里这么写，是因为代码就是这么做的。
 *
 *   3. status:'rejected' 时服务端**不签发 accessToken**，会员分支更是整条记录都不落库。
 *      也就是说拒答那次拿不到打印 / 撤回的凭证 —— 与其让用户点了才吃 403/404，
 *      不如当面说清，并且照常展示那五个真实算出来的强度。
 */

/** 雷达图配色。canvas 读不到 CSS 变量，这里是 app.wxss 里 --teal 系与 --line 系的取值副本。 */

/**
 * 知情同意条目。逐条对应服务端已实现的行为，用户勾的就是这几句原文。
 * 与一体机 apps/kiosk/src/pages/resume/selfAssessmentSession.ts 的 CONSENT_ITEMS 同源，
 * 另把「答案原文不入库、不送模型」这条数据流事实单独写出来 —— 那是用户决定要不要
 * 作答时唯一真正关心的一条，藏在「不留存」三个字里说不清楚。
 *
 * 版本号不写死在这里：consentVersion 一律用 questions 接口下发的值。写死会在
 * 同意书改版时静默失配（服务端会回 SELF_ASSESSMENT_CONSENT_VERSION_STALE）。
 */
const CONSENT_ITEMS = [
  '本工具基于你本人的作答给出倾向参考，不是临床、心理或人格诊断。',
  '结果只对你本人可见，不向企业、合作机构或任何第三方推送。',
  '答案原文不入库、也不发给 AI：服务端只保存作答摘要（哈希）、五维强度与解读文字，发给模型的只有五个维度名与对应强度分值。',
  '本工具不判断你是否胜任某个岗位或职业，也不构成能力证明。',
  '五维强度由固定权重累加算出，不经过 AI；五段解读由 AI 生成，仅供参考。',
  '作答后可在结果页撤回：服务端会删除该次结果，并留下一条删除审计记录。',
]


function trimmed(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

Page({
  /** 非响应式实例状态：不进 data，避免无意义的重渲染。 */
  _pageReady: false,
  _gone: false,
  _seq: 0,
  /** 结果访问凭证。匿名提交时服务端只在响应里给一次，页面卸载即失效。 */
  _token: '',

  data: {
    statusBarHeight: 20,
    /**
     * loading    题目 / 历史结果加载中
     * consent    未同意（先出示同意书，两个勾选分开）
     * ask        答题中（5 维 × 5 题，按维度分组翻页）
     * submitting 提交中
     * result     有结果
     * error      出错
     */
    phase: 'loading',
    errMsg: '',
    errCanRestart: false,
    historyMode: false,
    taskId: '',

    // ── 同意书 ──
    consentItems: CONSENT_ITEMS,
    consentVersion: '',
    agreeNonSensitive: false,
    agreeSensitive: false,
    /** 题库里被标为敏感的题数，按下发的题目真值算，不写死。v1 实测 0 题。 */
    sensitiveCount: 0,
    consentTip: '',

    // ── 题目 ──
    dims: [],
    groupIdx: 0,
    totalCount: 0,
    requiredCount: 0,
    answeredCount: 0,
    answeredRequired: 0,
    /** 还差几题必答。在 js 里算好，避免 WXML 属性里写 `<` 比较（XML 里那是标签起始符）。 */
    missingRequired: 0,
    submitReady: false,
    groupDone: [],
    isLastGroup: false,

    // ── 提交 ──
    elapsed: 0,

    // ── 结果 ──
    result: null,
    radarPx: 300,
    radarHeightPx: 276,
    radarCanvasPx: 208,
    radarCanvasHeightPx: 215,
    // 维度名排在 canvas 外面；坐标与绘制共用 radar.labelAnchors()，见 radar.js 顶部说明
    radarLabels: [],
    radarDrawable: false,
    radarStatus: 'pending', // pending | ready | error
    canManage: false,
    manageBlockedReason: '',
    printing: false,
    withdrawing: false,
  },

  onLoad(options) {
    const opts = options || {}
    // 简历会话凭证只是个种子：自我探索不依赖简历，本次结果的真凭证由提交响应下发。
    // 取不到就留空，走会员登录态。
    const saved = storage.get(storage.KEYS.RESUME_TASK) || {}
    this._token = saved.accessToken || ''

    const windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : { windowWidth: 375 }
    // 画布宽度必须减掉**整条容器链**的横向占用，不是拍一个 48。
    // 链路（canvas 在 .radar-wrap > .card.card-inner 里，三层都是 border-box）：
    //   .card       margin: 0 16px      → 32
    //   .card       border: 1px         →  2
    //   .card-inner padding: 16px       → 32
    // 合计 66；卡片内容盒 = windowWidth - 66。
    //
    // 删掉这个减数（回到 -48）会怎样：375/390/393pt——也就是主流 iPhone 全部——
    // 画布比内容盒宽 13~18px。.radar-wrap 是 align-items:center，超出的部分从两侧
    // 各吃掉一半内边距，16px 余量掉到 7px，雷达图几乎贴住卡片描边。
    // 它**不会**被裁掉（.card overflow:hidden 的裁切线在 windowWidth-34），
    // 所以既不报错也不留痕，纯靠肉眼才看得出来——没有门禁盯这个。
    const RADAR_CARD_CHROME_PX = 16 * 2 + 1 * 2 + 16 * 2
    const radarAvailPx = (windowInfo.windowWidth || 375) - RADAR_CARD_CHROME_PX
    // 上限 340 不变。下限不再写死 260：固定下限一旦大于内容盒（windowWidth < 326pt
    // 的窄机）就是把同一个 bug 原样搬回来。窄屏按内容盒缩即可——五个数值在下面的
    // 等价文字列表里始终可读，图形本来就是冗余表达。
    const radarPx = Math.round(Math.max(0, Math.min(340, radarAvailPx)))

    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      radarPx,
      radarHeightPx: Math.round(radarPx * 0.82),
      // 画布比舞台窄：标签排在画布**外面**的余量里。
      // 画布铺满舞台的话，形状顶点和标签会重叠，标签还会顶到卡片边缘。
      radarCanvasPx: Math.round(radarPx * 0.62),
      radarCanvasHeightPx: Math.round(radarPx * 0.82 * 0.78),
    })

    const taskId = trimmed(opts.taskId)
    if (taskId) {
      this.setData({ historyMode: true, taskId, phase: 'loading' })
      this._loadExisting(taskId)
      return
    }
    this._loadQuestions()
  },

  onReady() {
    this._pageReady = true
    if (this.data.phase === 'result') this._drawRadar()
  },

  onUnload() {
    this._gone = true
    this._seq += 1
    this._stopElapsed()
  },

  // ══════════ 题目 ══════════

  _loadQuestions() {
    const seq = ++this._seq
    this.setData({ phase: 'loading', errMsg: '' })
    api.getSelfAssessmentQuestions()
      .then((res) => {
        if (this._gone || seq !== this._seq) return
        const view = this._toQuestionsView(res)
        if (!view.dims.length) {
          this._fail('暂时取不到题目，请稍后重试', false)
          return
        }
        this.setData({
          phase: 'consent',
          dims: view.dims,
          consentVersion: view.consentVersion,
          sensitiveCount: view.sensitiveCount,
          totalCount: view.totalCount,
          requiredCount: view.requiredCount,
          answeredCount: 0,
          answeredRequired: 0,
          missingRequired: view.requiredCount,
          submitReady: view.requiredCount === 0,
          groupIdx: 0,
          groupDone: view.dims.map(() => false),
          isLastGroup: view.dims.length === 1,
        })
      })
      .catch((err) => {
        if (this._gone || seq !== this._seq) return
        this._fail((err && err.message) || '题目加载失败，请稍后重试', false)
      })
  },

  /**
   * 服务端下发的 choices 是 { key, label, weight } 三元组，提交时只回 choice.key
   * （scoreSelfAssessment 用 `c.key === a.choice` 匹配）。weight 在这里被丢掉：
   * 页面拿到权重也不许自己算分，算分是服务端纯函数的职责，两处各算一遍必然漂移。
   */
  _toQuestionsView(res) {
    const raw = (res && Array.isArray(res.dimensions)) ? res.dimensions : []
    let totalCount = 0
    let requiredCount = 0
    let sensitiveCount = 0
    const dims = []
    raw.forEach((d) => {
      const questions = (d && Array.isArray(d.questions)) ? d.questions : []
      const items = []
      questions.forEach((q) => {
        const choices = (q && Array.isArray(q.choices)) ? q.choices : []
        const opts = choices
          .map((c) => ({ key: trimmed(c && c.key), label: trimmed(c && c.label) }))
          .filter((c) => c.key && c.label)
        if (!opts.length) return
        const sensitive = q.sensitive === true
        totalCount += 1
        if (sensitive) sensitiveCount += 1
        else requiredCount += 1
        items.push({ idx: q.idx, prompt: trimmed(q.prompt), sensitive, choices: opts, picked: '' })
      })
      if (items.length) dims.push({ key: trimmed(d.key), label: trimmed(d.label) || trimmed(d.key), questions: items })
    })
    return { dims, totalCount, requiredCount, sensitiveCount, consentVersion: trimmed(res && res.consentVersion) }
  },

  reload() {
    if (this.data.historyMode && this.data.taskId) {
      this.setData({ phase: 'loading', errMsg: '' })
      this._loadExisting(this.data.taskId)
      return
    }
    this._loadQuestions()
  },

  // ══════════ 同意 ══════════

  toggleNonSensitive() {
    this.setData({ agreeNonSensitive: !this.data.agreeNonSensitive })
  },

  toggleSensitive() {
    this.setData({ agreeSensitive: !this.data.agreeSensitive })
  },

  startAsk() {
    // 同意前不得进入答题：这不是表单校验，是服务端也会拒的合规闸门
    // （nonSensitive 为 false → SELF_ASSESSMENT_CONSENT_REQUIRED）。
    if (!this.data.agreeNonSensitive) {
      wx.showToast({ title: '请先勾选第一项同意', icon: 'none', duration: 2000 })
      return
    }
    this.setData({ phase: 'ask', groupIdx: 0, isLastGroup: this.data.dims.length === 1, consentTip: '' })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  // ══════════ 答题 ══════════

  tapChoice(e) {
    const ds = e.currentTarget.dataset
    const g = Number(ds.g)
    const q = Number(ds.q)
    const choice = ds.c
    const dim = this.data.dims[g]
    if (!dim || !dim.questions[q] || !choice) return

    // 敏感题标了「可以不选」就必须真的能不选：再点一次同一项即取消。
    // 非敏感题不做取消，避免误触把已答项悄悄清空而用户毫无察觉。
    const cur = dim.questions[q].picked
    const sensitive = dim.questions[q].sensitive
    const next = (sensitive && cur === choice) ? '' : choice

    this.setData({ [`dims[${g}].questions[${q}].picked`]: next }, () => this._recount())
  },

  _recount() {
    let answered = 0
    let answeredRequired = 0
    const groupDone = this.data.dims.map((dim) => {
      let pending = 0
      dim.questions.forEach((q) => {
        if (q.picked) {
          answered += 1
          if (!q.sensitive) answeredRequired += 1
        } else if (!q.sensitive) {
          pending += 1
        }
      })
      return pending === 0
    })
    const missingRequired = Math.max(0, this.data.requiredCount - answeredRequired)
    this.setData({
      answeredCount: answered,
      answeredRequired,
      missingRequired,
      submitReady: missingRequired === 0,
      groupDone,
    })
  },

  prevGroup() {
    if (this.data.groupIdx <= 0) {
      this.setData({ phase: 'consent' })
      wx.pageScrollTo({ scrollTop: 0, duration: 200 })
      return
    }
    const groupIdx = this.data.groupIdx - 1
    this.setData({ groupIdx, isLastGroup: groupIdx === this.data.dims.length - 1 })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  nextGroup() {
    const groupIdx = this.data.groupIdx + 1
    if (groupIdx >= this.data.dims.length) return
    this.setData({ groupIdx, isLastGroup: groupIdx === this.data.dims.length - 1 })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  tapStep(e) {
    const g = Number(e.currentTarget.dataset.g)
    if (!(g >= 0) || g >= this.data.dims.length) return
    this.setData({ groupIdx: g, isLastGroup: g === this.data.dims.length - 1 })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  // ══════════ 提交 ══════════

  submit() {
    if (this.data.phase === 'submitting') return
    if (!this.data.agreeNonSensitive) {
      wx.showToast({ title: '请先勾选第一项同意', icon: 'none', duration: 2000 })
      return
    }
    const missing = this.data.missingRequired
    if (missing > 0) {
      // 漏答的题在服务端按权重 0 计入，会算出一个偏低的强度 —— 那看起来像
      // 「这个倾向弱」，实际是「这题没答」。两者不是一回事，所以必须答完再提交。
      wx.showToast({ title: `还有 ${missing} 题未选`, icon: 'none', duration: 2000 })
      return
    }

    const answers = []
    this.data.dims.forEach((dim) => {
      dim.questions.forEach((q) => {
        if (q.picked) answers.push({ dim: dim.key, idx: q.idx, choice: q.picked })
      })
    })

    const consent = { nonSensitive: true, sensitive: this.data.agreeSensitive === true }
    // 版本号原样回传服务端下发的那个值；下发为空时不补造，服务端会如实记为「未版本化同意」。
    if (this.data.consentVersion) consent.consentVersion = this.data.consentVersion

    const seq = ++this._seq
    this.setData({ phase: 'submitting', elapsed: 0, errMsg: '' })
    this._startElapsed()

    api.submitSelfAssessment(answers, consent, this._token)
      .then((res) => {
        this._stopElapsed()
        if (this._gone || seq !== this._seq) return
        // 匿名提交时这是唯一一次拿到访问凭证的机会，后续打印 / 撤回全靠它。
        if (res && res.accessToken) this._token = res.accessToken
        this._applyResult(res)
      })
      .catch((err) => {
        this._stopElapsed()
        if (this._gone || seq !== this._seq) return
        // 同意书已改版：服务端拒绝用旧版本的同意放行，页面必须请用户重新读一遍，
        // 不能把旧勾选当成对新说明的同意。
        if (err && err.code === 'SELF_ASSESSMENT_CONSENT_VERSION_STALE') {
          this.setData({
            agreeNonSensitive: false,
            agreeSensitive: false,
            consentTip: (err && err.message) || '知情同意说明已更新，请重新阅读并确认后再提交',
          })
          this._loadQuestions()
          return
        }
        this.setData({ phase: 'ask' })
        wx.showModal({
          title: '未能提交',
          content: (err && err.message) || '请稍后重试',
          showCancel: false,
          confirmText: '知道了',
        })
      })
  },

  // 已用时长是真实计时；服务端不给进度，所以不显示任何百分比
  _startElapsed() {
    this._stopElapsed()
    this._t0 = Date.now()
    this._timer = setInterval(() => {
      if (this._gone) return
      this.setData({ elapsed: Math.floor((Date.now() - this._t0) / 1000) })
    }, 1000)
  },

  _stopElapsed() {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
  },

  // ══════════ 结果 ══════════

  _loadExisting(taskId) {
    const seq = ++this._seq
    api.getSelfAssessment(taskId, this._token)
      .then((res) => {
        if (this._gone || seq !== this._seq) return
        this._applyResult(res)
      })
      .catch((err) => {
        if (this._gone || seq !== this._seq) return
        if (err && err.code === 'SELF_ASSESSMENT_WITHDRAWN') {
          this._fail('这次结果已撤回，服务端已删除，无法再查看。', true)
          return
        }
        if (err && err.statusCode === 404) {
          this._fail('没有找到这次自我探索的结果，可能已过期或已撤回。', true)
          return
        }
        if (err && err.statusCode === 401) {
          this._fail('登录已失效，请重新登录后再查看历史结果。', true)
          return
        }
        this._fail((err && err.message) || '结果读取失败，请稍后重试', true)
      })
  },

  _applyResult(res) {
    const view = this._toResultView(res)
    if (!view.dims.length) {
      this._fail('这次自我探索没有可展示的结果。', true)
      return
    }
    // 拒答那次服务端不签发凭证（会员分支整条记录都没落库），打印 / 撤回必然失败。
    const hasCredential = auth.isLoggedIn() || !!this._token
    const canManage = view.status === 'completed' && hasCredential
    let blocked = ''
    if (!canManage) {
      blocked = view.status === 'rejected'
        ? '本次 AI 解读整体未通过，服务端没有返回可用于打印或撤回的凭证；下面的五维强度仍是本次真实算出的结果，记录会在到期后自动清理。'
        : '本次没有拿到结果访问凭证，无法生成打印件或撤回。'
    }

    this.setData({
      phase: 'result',
      taskId: view.taskId,
      result: view,
      radarDrawable: view.radarDrawable,
      radarStatus: 'pending',
      canManage,
      manageBlockedReason: blocked,
    }, () => {
      wx.pageScrollTo({ scrollTop: 0, duration: 200 })
      this._drawRadar()
    })
  },

  /**
   * 结果视图。strength 非法时**不兜 0** —— 0 是一个真实存在的分值，
   * 拿它顶替「服务端没给」会把缺数据画成「这个倾向为零」。这种情况整张雷达图
   * 不画（少一个顶点的五边形没有意义），下面的列表逐项显示「暂无数据」。
   */
  _toResultView(res) {
    const raw = (res && Array.isArray(res.dimensions)) ? res.dimensions : []
    let drawable = raw.length === DIM_COUNT_EXPECTED
    const dims = raw.map((d) => {
      const s = (typeof d.strength === 'number' && isFinite(d.strength) && d.strength >= 0 && d.strength <= 5)
        ? Math.round(d.strength)
        : null
      if (s === null) drawable = false
      const evidence = Array.isArray(d.evidenceQuestionIdx)
        ? d.evidenceQuestionIdx.map((i) => i + 1).join('、')
        : ''
      return {
        key: trimmed(d.key),
        label: trimmed(d.label) || trimmed(d.key),
        strength: s,
        // WXML 里不写 `x === null`：null 在模板表达式里的行为按版本而异，
        // 判定放在 js 里做完，模板只读布尔。
        hasScore: s !== null,
        strengthText: s === null ? '暂无数据' : `${s}/5`,
        pct: s === null ? 0 : s * 20,
        note: trimmed(d.note),
        evidence,
      }
    })

    const status = (res && res.status === 'rejected') ? 'rejected' : 'completed'
    return {
      taskId: trimmed(res && res.taskId) || this.data.taskId,
      status,
      failReason: trimmed(res && res.failReason),
      summary: trimmed(res && res.summary),
      // 服务端明说模型这次调不通时才是 llm_unavailable，不拿它猜别的失败原因
      providerUnavailable: !!(res && res.providerName === 'llm_unavailable'),
      noteCount: dims.filter((d) => d.note).length,
      consentVersion: trimmed(res && res.consentVersion),
      consentedAt: N.dateTime(res && res.consentedAt) || '',
      // consentCurrent 为 false 含两种情况：同意书已改版，或本条是未版本化的旧同意
      consentStale: !!(res && res.consentCurrent === false),
      expiresAt: N.dateTime(res && res.expiresAt) || '',
      dims,
      radarDrawable: drawable,
    }
  },

  _fail(msg, canRestart) {
    this._stopElapsed()
    this.setData({ phase: 'error', errMsg: msg, errCanRestart: !!canRestart })
  },

  // ══════════ 雷达图 ══════════

  /**
   * 五维雷达图。写法照 pages/print-pickup/print-pickup.js 的到机码二维码：
   * `type="2d"` + createSelectorQuery().node() + 按 pixelRatio 放大画布再整体缩放，
   * 那是本仓唯一的 canvas 先例（旧的 wx.createCanvasContext 已废弃，不要回头用）。
   *
   * 画的只有 strength。canvas 是纯冗余表达：读屏用户、取不到画布节点、低端机
   * 渲染失败，全都要能从下面那份文字 / 条形列表拿到同样的五个数字，
   * 所以列表不是「降级方案」而是常驻的主信息。
   */
  _drawRadar() {
    if (!this._pageReady || this._gone) return
    if (this.data.phase !== 'result' || !this.data.radarDrawable) return
    const dims = (this.data.result && this.data.result.dims) || []
    if (dims.length !== DIM_COUNT_EXPECTED) return

    wx.createSelectorQuery().in(this).select('#radar').fields({ node: true, size: true }).exec((result) => {
      if (this._gone) return
      const target = result && result[0]
      if (!target || !target.node) {
        this.setData({ radarStatus: 'error' })
        return
      }
      try {
        radar.paintRadar(target.node, dims, { width: this.data.radarCanvasPx, height: this.data.radarCanvasHeightPx })
        // 标签位置和顶点角度同源：radar.labelAnchors() 与 paintRadar 内部用的是同一个 angleOf。
        // 分开各算一套的话，改了顶点起始角度、文字就会和形状错开。
        const anchors = radar.labelAnchors()
        this.setData({
          radarStatus: 'ready',
          radarLabels: dims.map((d, i) => ({ key: d.key || String(i), label: d.label, ...anchors[i] })),
        })
      } catch (_) {
        this.setData({ radarStatus: 'error' })
      }
    })
  },


  // ══════════ 结果页操作 ══════════

  /** 长解读在卡片里会被截断，点开看全文 */
  tapNote(e) {
    const ds = e.currentTarget.dataset
    if (!ds.text) return
    wx.showModal({ title: ds.title || '解读', content: ds.text, showCancel: false, confirmText: '知道了' })
  },

  /**
   * 生成报告 PDF 交给打印流程。
   * 拿到响应只代表文件已生成并进了「我的文档」，**不等于已打印**，所以按钮与提示
   * 只说「生成并去打印」。自我探索报告是本人文件，走 fileId 换本人预览链接的原路径，
   * 不透传服务端签名直链（那条旁路只给招聘会那两类共享派生文件）。
   */
  tapPrint() {
    if (this.data.printing || !this.data.canManage || !this.data.taskId) return
    this.setData({ printing: true })
    wx.showLoading({ title: '正在生成报告…', mask: true })
    api.printSelfAssessment(this.data.taskId, this._token)
      .then((res) => {
        wx.hideLoading()
        if (this._gone) return
        this.setData({ printing: false })
        const name = encodeURIComponent(trimmed(res && res.filename) || '自我探索倾向参考.pdf')
        const fid = encodeURIComponent(trimmed(res && res.fileId))
        const pages = (res && res.pageCount) || ''
        wx.navigateTo({ url: `/pages/print-upload/print-upload?name=${name}&fileId=${fid}&pages=${pages}` })
      })
      .catch((err) => {
        wx.hideLoading()
        if (this._gone) return
        this.setData({ printing: false })
        wx.showModal({
          title: '生成报告失败',
          content: (err && err.message) || '请稍后重试',
          showCancel: false,
          confirmText: '知道了',
        })
      })
  },

  tapWithdraw() {
    if (this.data.withdrawing || !this.data.canManage || !this.data.taskId) return
    wx.showModal({
      title: '撤回本次结果',
      content: '撤回后服务端会删除这次的五维强度与解读，并留下一条删除审计记录。删除不可恢复。',
      confirmText: '确认撤回',
      cancelText: '取消',
      success: (r) => { if (r.confirm) this._doWithdraw() },
    })
  },

  _doWithdraw() {
    this.setData({ withdrawing: true })
    wx.showLoading({ title: '正在撤回…', mask: true })
    api.withdrawSelfAssessment(this.data.taskId, this._token)
      .then(() => {
        wx.hideLoading()
        if (this._gone) return
        this._token = ''
        this.setData({ withdrawing: false, result: null, taskId: '', canManage: false, historyMode: false })
        this._resetToConsent('上次结果已撤回，服务端已删除该次的五维强度与解读，并留有删除审计记录。')
      })
      .catch((err) => {
        wx.hideLoading()
        if (this._gone) return
        this.setData({ withdrawing: false })
        wx.showModal({
          title: '撤回失败',
          content: (err && err.message) || '请稍后重试',
          showCancel: false,
          confirmText: '知道了',
        })
      })
  },

  restart() {
    this._token = ''
    this.setData({ result: null, taskId: '', canManage: false, historyMode: false })
    this._resetToConsent('')
  },

  /** 重新作答要连同意一起重来：同意是针对「这一次作答」的，不跨次继承。 */
  _resetToConsent(tip) {
    const dims = this.data.dims.map((dim) => ({
      key: dim.key,
      label: dim.label,
      questions: dim.questions.map((q) => ({
        idx: q.idx, prompt: q.prompt, sensitive: q.sensitive, choices: q.choices, picked: '',
      })),
    }))
    if (!dims.length) {
      this.setData({ agreeNonSensitive: false, agreeSensitive: false, consentTip: tip || '' })
      this._loadQuestions()
      return
    }
    this.setData({
      phase: 'consent',
      dims,
      groupIdx: 0,
      isLastGroup: dims.length === 1,
      answeredCount: 0,
      answeredRequired: 0,
      missingRequired: this.data.requiredCount,
      submitReady: this.data.requiredCount === 0,
      groupDone: dims.map(() => false),
      agreeNonSensitive: false,
      agreeSensitive: false,
      consentTip: tip || '',
      radarStatus: 'pending',
      radarDrawable: false,
    })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  goBack() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
