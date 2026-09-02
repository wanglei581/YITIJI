const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const storage = require('../../utils/storage')

/**
 * AI 参会准备单（场次未结束）/ AI 参会回顾（场次已结束）。
 *
 * 这一页有三处特别容易造假，都不许碰：
 *
 * 1. mode 是服务端按招聘会 endAt 判定的事实（FairVisitPlanResponse.mode），
 *    已生成的结果一律读它。生成前没有结果可读，才用招聘会自身的状态挑
 *    「准备单 / 回顾」这几个字——它只影响标题和按钮文案，不影响任何已生成内容。
 *    服务端在读取旧结果时还会校验形态是否已经过期（FAIR_VISIT_PLAN_STALE_MODE），
 *    所以前端不需要、也不该自己判定一份已有结果算准备还是回顾。
 *
 * 2. localRecords 不是到场记录。系统只知道「本人在本机打开过哪些参展企业的来源
 *    投递入口」，不知道用户到没到过现场、投没投出去、在现场拿到了什么。
 *    requiresLogin=true 时必须说「未登录，无法关联你的记录」；写成「无记录」
 *    等于替系统断言一件它根本不知道的事。
 *
 * 3. 生成是真花钱的模型调用（限流 6 次/分钟）。所以进页面先 GET 读已有结果，
 *    只有服务端明确说「没有」才落到可生成态；读取本身失败时**不**静默当成
 *    「还没生成过」，否则用户会为一次网络抖动重复付一次费。
 */

// 两种形态各自的用词。已结束的场次里出现「出发前 / 现场带什么」是语义错误，
// 不是文案不够好——所以两套词分开写死，不做字符串拼接。
const COPY = {
  preparation: {
    navTitle: 'AI 参会准备单',
    lead: '结合你的简历方向与本场招聘会的公开信息，生成一份参会准备参考',
    generate: '生成参会准备单',
    print: '生成准备单去打印',
    printing: '正在生成准备单…',
    companies: '可优先了解的企业',
    highlights: '本场看点',
    checklist: '参会前准备清单',
    questions: '现场可咨询的问题',
  },
  review: {
    navTitle: 'AI 参会回顾',
    lead: '本场招聘会已结束，以下内容用于后续跟进参考',
    generate: '生成参会回顾',
    print: '生成回顾单去打印',
    printing: '正在生成回顾单…',
    companies: '仍可继续跟进的企业',
    highlights: '本场概况',
    checklist: '现在就能做的跟进动作',
    questions: '下次同类活动可提前准备的问题',
  },
}

function textList(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string' && item.trim())
}

/** priorityCompanies：没有企业名的条目直接丢掉；sourceUrl 缺失就是缺失，不补占位。 */
function companyList(value) {
  if (!Array.isArray(value)) return []
  const out = []
  value.forEach((item, index) => {
    const name = item && typeof item.companyName === 'string' ? item.companyName.trim() : ''
    if (!name) return
    out.push({
      key: `${index}-${name}`,
      companyName: name,
      reason: item && typeof item.reason === 'string' ? item.reason : '',
      sourceUrl: item && typeof item.sourceUrl === 'string' ? item.sourceUrl : '',
    })
  })
  return out
}

/** basedOn 缺失时不能显示 0：0 是「一家企业都没有」，缺失是「不知道」，两回事。 */
function countText(value) {
  return typeof value === 'number' && isFinite(value) ? String(value) : '暂无数据'
}

function normalizePlan(res) {
  if (!res || typeof res !== 'object') return null
  const mode = res.mode === 'review' ? 'review' : 'preparation'
  const isReview = mode === 'review'
  const basedOn = res.basedOn || null
  const fair = res.fair || null
  const local = res.localRecords || null
  const plan = {
    mode,
    isReview,
    summary: typeof res.summary === 'string' ? res.summary : '',
    fairName: (basedOn && basedOn.fairName) || (fair && fair.title) || '',
    sourceName: (fair && fair.sourceName) || '',
    companyCountText: countText(basedOn && basedOn.companyCount),
    positionCountText: countText(basedOn && basedOn.positionCount),
    highlights: textList(res.fairHighlights),
    companies: companyList(res.priorityCompanies),
    checklist: textList(isReview ? res.followUpActions : res.preparationChecklist),
    questions: textList(isReview ? res.nextTimeQuestions : res.questionsToAsk),
    // 现场提醒只属于未结束的场次：活动都结束了再说「现场注意什么」没有意义。
    onsiteTips: isReview ? [] : textList(res.onsiteTips),
    // 回顾态才有本机记录区。服务端没给这个对象就整块不渲染——
    // 拿一个不存在的对象渲染成「没有记录」，等于凭空断言。
    hasLocalRecords: isReview && !!local,
    localRequiresLogin: !!(local && local.requiresLogin),
    localCompanies: local ? textList(local.openedCompanySourceEntries) : [],
  }
  plan.hasContent = !!(plan.summary || plan.highlights.length || plan.companies.length
    || plan.checklist.length || plan.questions.length || plan.onsiteTips.length)
  return plan
}

Page({
  // 非响应式实例状态。_seq 必须有初值：++undefined 是 NaN，
  // NaN !== NaN 会让每个回调都以为自己已经被作废，结果一条也回写不了。
  _seq: 0,
  _token: '',
  _timer: null,
  _t0: 0,
  _stopped: false,
  _waitingForLogin: false,

  data: {
    statusBarHeight: 20,
    // loading   正在读「是否已经生成过」，避免用户重复付费
    // no-fair   没有 fairId，定位不到招聘会
    // no-resume 本机没有已解析的简历任务，这个能力用不了
    // ready     可生成（含服务端明确回「暂无准备单」这一正常空态）
    // running   生成中，只显示真实已用秒数
    // done      拿到服务端返回的真实结果
    // failed    失败，按 failKind 给不同出口
    phase: 'loading',
    // retry 可直接重试生成 | reupload 必须重新上传简历 | reload 需要重新读取本页 | login 需要先登录
    failKind: 'retry',
    failMsg: '',
    fairId: '',
    taskId: '',
    resumeName: '',
    fair: null,
    fairError: '',
    // 招聘会是否已结束只在生成前决定 copy 用哪一套词，本身不进 data：
    // 已生成结果的形态一律读 plan.mode，页面不该有第二个可被误读的形态来源。
    copy: COPY.preparation,
    // 服务端说旧结果形态已失效时的原话，原样转达，不改写成一句「请重试」
    staleNote: '',
    elapsed: 0,
    plan: null,
    printing: false,
  },

  onLoad(opts) {
    // query 参数由微信解码后交到 onLoad，这里不再 decodeURIComponent 一次：
    // 对已解码的值再解一次，遇到含 % 的串会抛 URIError，整个 onLoad 断在第一行，页面全白。
    const o = opts || {}
    const fairId = o.fairId || ''
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      fairId,
    })
    if (!fairId) {
      this.setData({ phase: 'no-fair' })
      return
    }

    const saved = storage.get(storage.KEYS.RESUME_TASK) || {}
    const askedTaskId = o.taskId || ''
    const taskId = askedTaskId || saved.taskId || ''
    if (!taskId) {
      this._loadFair()
      this.setData({ phase: 'no-resume' })
      return
    }
    // accessToken 是「这一个简历任务」的匿名读取凭证。URL 指定了别的任务时它不适用，
    // 只能靠会员登录态去读；读不到就让服务端诚实报错，不拿不属于该任务的 token 去撞。
    const ownSession = !askedTaskId || askedTaskId === saved.taskId
    this._token = ownSession ? (saved.accessToken || '') : ''
    this.setData({ taskId, resumeName: ownSession ? (saved.fileName || '') : '' })
    this._init()
  },

  onShow() {
    if (!this._waitingForLogin || !auth.isLoggedIn()) return
    this._waitingForLogin = false
    this._init()
  },

  onUnload() {
    this._stopped = true
    this._stopElapsed()
  },

  _init() {
    this._stopped = false
    this.setData({ phase: 'loading', failMsg: '', staleNote: '', fairError: '' })
    this._loadFair()
    this._loadExisting()
  },

  /**
   * 招聘会信息只用于展示与文案取舍，取不到不拦生成：真正的权威判定在服务端，
   * POST 会先校验招聘会已审核已发布，校验不过在调模型之前就 404，不会白花模型钱。
   */
  _loadFair() {
    api.getFairDetail(this.data.fairId).then((res) => {
      if (this._stopped || !res) return
      const ended = res.tag === '已结束'
      this.setData({
        fair: {
          title: res.title || '',
          when: res.startTime || '',
          venue: [res.city, res.venue].filter(Boolean).join(' · '),
          source: res.sourceOrg || '',
          tag: res.tag || '',
        },
        fairError: '',
        // 已生成的结果以 plan.mode 为准，这里只在还没有结果时决定标题和按钮怎么写
        copy: this.data.plan ? this.data.copy : (ended ? COPY.review : COPY.preparation),
      })
    }).catch((err) => {
      if (this._stopped) return
      this.setData({ fair: null, fairError: (err && err.message) || '招聘会信息暂时读取不到' })
    })
  },

  _loadExisting() {
    const seq = ++this._seq
    api.getFairVisitPlan(this.data.fairId, this.data.taskId, this._token).then((res) => {
      if (this._stopped || seq !== this._seq) return
      if (res && res.status === 'failed') {
        this._fail(res.failReason || '上次生成没有成功，请重新生成', 'retry')
        return
      }
      const plan = normalizePlan(res)
      if (plan && plan.hasContent) {
        this._showPlan(plan)
        return
      }
      this.setData({ phase: 'ready' })
    }).catch((err) => {
      if (this._stopped || seq !== this._seq) return
      const code = err && err.code
      // 「还没有生成过」是正常空态，不是错误
      if (code === 'FAIR_VISIT_PLAN_NOT_FOUND') {
        this.setData({ phase: 'ready' })
        return
      }
      // 旧结果和当前活动状态对不上（结束前生成、结束后才来看）：服务端不再返回它。
      // 把原话转达给用户，他才知道为什么要重新生成。
      if (code === 'FAIR_VISIT_PLAN_STALE_MODE') {
        this.setData({ phase: 'ready', staleNote: (err && err.message) || '' })
        return
      }
      if (code === 'AI_TASK_NOT_FOUND') {
        this._fail((err && err.message) || '简历任务已失效，请重新上传简历', 'reupload')
        return
      }
      if (err && err.statusCode === 401) {
        this._fail((err && err.message) || '登录已失效，请重新登录后查看', 'login')
        return
      }
      // 读取失败不能当成「还没生成过」：那会让用户为一次网络抖动重复付费生成。
      this._fail((err && err.message) || '读取失败，请重试', 'reload')
    })
  },

  tapGenerate() {
    if (this.data.phase === 'running') return
    const fairId = this.data.fairId
    const taskId = this.data.taskId
    if (!fairId || !taskId) return
    const seq = ++this._seq
    this.setData({ phase: 'running', elapsed: 0, failMsg: '', staleNote: '' })
    this._startElapsed()
    api.generateFairVisitPlan(fairId, taskId, this._token).then((res) => {
      this._stopElapsed()
      if (this._stopped || seq !== this._seq) return
      // 200 + status:'failed'：简历原文已按隐私策略清理，重试多少次都是同一个结果
      if (res && res.status === 'failed') {
        this._fail(res.failReason || '简历原文已不可用，请重新上传简历后再生成', 'reupload')
        return
      }
      const plan = normalizePlan(res)
      if (!plan || !plan.hasContent) {
        this._fail('这次没有生成出可展示的内容，请稍后重试', 'retry')
        return
      }
      this._showPlan(plan)
    }).catch((err) => {
      this._stopElapsed()
      if (this._stopped || seq !== this._seq) return
      const code = err && err.code
      if (code === 'AI_TASK_NOT_FOUND') {
        this._fail((err && err.message) || '简历任务已失效，请重新上传简历', 'reupload')
        return
      }
      if (code === 'FAIR_NOT_FOUND') {
        this._fail((err && err.message) || '招聘会不存在或已下线', 'reload')
        return
      }
      if (err && err.statusCode === 401) {
        this._fail((err && err.message) || '登录已失效，请重新登录后再生成', 'login')
        return
      }
      // 503 这类模型侧失败：可以手动重试，不必重新上传简历
      this._fail((err && err.message) || '生成失败，请稍后重试', 'retry')
    })
  },

  /** 重新生成会再花一次模型调用，先让用户确认 */
  tapRegenerate() {
    wx.showModal({
      title: '重新生成',
      content: '将重新调用 AI 生成一份新的内容，覆盖当前结果。',
      confirmText: '重新生成',
      cancelText: '取消',
      success: (r) => { if (r.confirm) this.tapGenerate() },
    })
  },

  _showPlan(plan) {
    this.setData({ phase: 'done', plan, copy: COPY[plan.mode] || COPY.preparation })
  },

  _fail(msg, kind) {
    this.setData({ phase: 'failed', failMsg: msg, failKind: kind || 'retry' })
  },

  // 已用时长是真实计时。后端不返回进度，所以不显示任何百分比，也不编造「还剩几秒」。
  _startElapsed() {
    this._stopElapsed()
    this._t0 = Date.now()
    this._timer = setInterval(() => {
      if (this._stopped) return
      this.setData({ elapsed: Math.floor((Date.now() - this._t0) / 1000) })
    }, 1000)
  },

  _stopElapsed() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  },

  /**
   * 把结果渲染成 PDF 再进打印下单流程（登录会员的这份文件同时落进「我的文档」，
   * 匿名 token 用户服务端不挂 endUserId，不会出现在文档列表里）。
   * 拿到文件响应只等于「已生成」——到出纸之间还隔着选门店、到机核销和打印队列，
   * 所以按钮和提示只能说「生成…去打印」。
   */
  tapPrint() {
    if (this.data.printing) return
    this.setData({ printing: true })
    wx.showLoading({ title: this.data.copy.printing, mask: true })
    api.printFairVisitPlan(this.data.fairId, this.data.taskId, this._token).then((res) => {
      wx.hideLoading()
      this.setData({ printing: false })
      if (this._stopped) return
      const name = encodeURIComponent((res && res.filename) || '参会准备单.pdf')
      const fid = encodeURIComponent((res && res.fileId) || '')
      const pages = (res && res.pageCount) || ''
      wx.navigateTo({ url: `/pages/print-upload/print-upload?name=${name}&fileId=${fid}&pages=${pages}` })
    }).catch((err) => {
      wx.hideLoading()
      this.setData({ printing: false })
      wx.showModal({
        title: '生成打印版失败',
        content: (err && err.message) || '请稍后重试',
        showCancel: false,
        confirmText: '知道了',
      })
    })
  },

  /**
   * 小程序打不开外部网页，只能把来源链接交到用户手里。
   * 复制只是复制：系统不知道他之后有没有真的打开、有没有投递，
   * 所以这里既不上报跳转记录，也不在任何地方把它算成「已投递」。
   */
  tapCopySource(e) {
    const url = e.currentTarget.dataset.url
    if (!url) {
      wx.showToast({ title: '来源链接暂不可用', icon: 'none' })
      return
    }
    wx.setClipboardData({ data: url })
  },

  tapUpload() {
    wx.navigateTo({ url: '/pages/resume-upload/resume-upload' })
  },

  tapLogin() {
    this._waitingForLogin = true
    wx.navigateTo({
      url: '/pages/launch/launch',
      fail: () => {
        this._waitingForLogin = false
        wx.showToast({ title: '登录页面打开失败', icon: 'none' })
      },
    })
  },

  reload() {
    if (!this.data.fairId || !this.data.taskId) return
    this._init()
  },

  goBack() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },
})
