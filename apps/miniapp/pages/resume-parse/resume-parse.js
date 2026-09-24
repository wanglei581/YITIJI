const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const config = require('../../utils/config')
const storage = require('../../utils/storage')
const intentStore = require('../../utils/resume-parse-intent')

/**
 * 本次解析包含的环节。
 * 合规:后端只返回 pending/processing/completed/failed 一个总状态,
 * **不返回分阶段进度**。所以这里只作为"AI 会检查什么"的说明列出,
 * 绝不逐项标"已完成"——那是伪造进度。
 */
const STAGE_DEFS = [
  { id: 'ocr', label: '文字识别', desc: '从 PDF / 图片中抽取文本' },
  { id: 'struct', label: '结构解析', desc: '识别基本信息、经历、技能等分区' },
  { id: 'understand', label: '内容理解', desc: '理解经历表述与成果描述' },
  { id: 'assess', label: '维度评估', desc: '按 6 个维度给出得分与建议' },
]

// 轮询节奏:后端实测常同步返回 completed;异步时按 3s 一次,最多约 2 分钟
const POLL_INTERVAL = 3000
const POLL_MAX = 40

/**
 * 「结果未知」时说明发生了什么。这些都只说明**这台手机没拿到可信的最终答复**,
 * 不说明服务端没做:服务端先落库解析结果(ai.service.ts persistResult),再写审计、
 * 再回包(ai.controller.ts),回包这一步出问题时结果可能早已存在。
 */
const UNKNOWN_CAUSE = {
  noReply: '提交解析后网络中断、等待超时或服务端出错,这台手机没收到完整答复。',
  malformed: '服务端的答复不完整,这台手机没能确认这一次解析的结果。',
  pollError: '解析已经提交并拿到了编号,但查询结果时网络或服务出了问题。',
  pollExhausted: '解析已经提交并拿到了编号,等了约 2 分钟仍没有最终结果。',
  pollMalformed: '解析已经提交并拿到了编号,但收到的答复不完整。',
  notFound: '解析已经提交并拿到了编号,但以这台手机当前的登录状态和读取凭证,查不到这一次的结果。',
  notReady: '解析已经提交并拿到了编号,但结果还没有写入完成,这台手机暂时读不到。请用同一次重查,不要开始新的解析。',
  storage: '本机暂时无法保存这次解析的读取凭证。请留在此页,点“查询本次结果”重试保存并查询;退出后匿名结果可能无法找回。',
}

/**
 * GET /resume/records 对「行尚未写入 / 已清理 / 令牌不符 / 不是本人」一律 404 + AI_TASK_NOT_FOUND。
 * 本页若还握着同一 owner 与同一材料的未落定意图,这是结果未就绪(解析行 kind=parse 还没落下),
 * 只能同一次重查,不能当成任务失踪去另起一次。盘上确认没有这次意图时,才走旧的身份核对。
 * 断网 / 5xx / 无错误码的 404 仍算暂时失败。
 */
function isTaskNotFound(err) {
  return !!err && err.statusCode === 404 && err.code === 'AI_TASK_NOT_FOUND'
}

/**
 * POST /resume/parse 被拒时,这一次在服务端到底跑没跑完?(与 Kiosk ResumeParsePage 同一口径)
 * - 断网 / 超时(request.js 统一给 statusCode -1)、任何 5xx(哪怕带 API 错误信封)、
 *   2xx 却被判成失败的响应体、以及其它没有状态码的异常:只说明没拿到可信答复 → 未知。
 * - 有 API 错误码的 4xx 才能确认是业务拒绝(校验、授权、限流、文件失效等)→ 明确失败。
 *   无错误码的 4xx 可能是网关代答;408 是等待超时,都算未知。
 * - 演示数据模式根本不发请求(api.js mockUnavailable)→ 明确失败。
 */
function submitErrorOutcome(err) {
  if (config.USE_MOCK) return 'failed'
  if (err && err.statusCode === 409 && err.code === 'RESUME_PARSE_OUTCOME_UNKNOWN') return 'unknown'
  if (err && err.statusCode === 404 && err.code === 'AI_TASK_NOT_FOUND') return 'unknown'
  const code = err && err.statusCode
  if (typeof code === 'number' && code >= 400 && code < 500 && code !== 408 && err.code) return 'failed'
  return 'unknown'
}

function ownerId() {
  const user = typeof auth.getUser === 'function' ? auth.getUser() : null
  return user && typeof user.id === 'string' && user.id ? user.id : null
}

function captureIdentity() {
  return {
    generation: typeof auth.sessionGeneration === 'function' ? auth.sessionGeneration() : 0,
    ownerId: ownerId(),
  }
}

function sameIdentity(snapshot) {
  if (!snapshot) return false
  if (typeof auth.isSameSession === 'function' && !auth.isSameSession(snapshot.generation)) return false
  return ownerId() === snapshot.ownerId
}

function parseJsonOption(value, fallback) {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(decodeURIComponent(value))
    return parsed
  } catch (_) {
    return fallback
  }
}

Page({
  data: {
    statusBarHeight: 20,
    phase: 'parsing', // parsing | failed | unknown | missing
    elapsed: 0,
    atext: '正在提交解析…',
    stages: STAGE_DEFS,
    done: false,
    failMsg: '',
    // 结果未知(phase=unknown):没拿到可信答复,不能说失败,也不自动再提交。
    unknownCause: '',
    // 手里有这一次的编号时可按同一编号只读再查;令牌只在本地存储里,不进 data、不进 URL。
    pendingTaskId: '',
    // not-found:盘上没有本次意图时,当前身份/令牌下查不到;仍可按同一编号再查,另给确认后的新一次
    recheck: 'idle', // idle | checking | not-ready | error | malformed | not-found
    // 未落定意图还在时,已知编号的 GET 404 只允许同一次 POST 重查,不开放新意图
    intentReplay: false,
    // 没有编号但已登录:这一次若已完成会进「我的 - AI 服务记录」,可去那里核对。
    canCheckRecords: false,
    // 解析参数,重试用
    fileId: '',
    fileName: '',
    fileFormat: '',
    source: 'upload',
    selectedDimensions: [],
    targetContext: { skipped: true },
  },

  onLoad(options) {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })

    const fileId = options.fileId || ''
    const fileName = options.fileName ? decodeURIComponent(options.fileName) : ''
    const fileFormat = options.fileFormat ? decodeURIComponent(options.fileFormat) : ''
    const source = options.source || 'upload'
    const dimensions = parseJsonOption(options.selectedDimensions, [])
    const target = parseJsonOption(options.targetContext, null)
    const selectedDimensions = Array.isArray(dimensions) ? dimensions : []
    const targetContext = target && typeof target === 'object'
      ? target
      : { skipped: true }

    // 没有 fileId 说明不是从上传流程进来的。后端解析必须有真实文件,
    // 不允许在这里凭空开始一段"解析"动画。
    if (!fileId) {
      this.setData({
        phase: 'missing',
        atext: '缺少待解析的简历文件',
      })
      return
    }

    this.setData({ fileId, fileName, fileFormat, source, selectedDimensions, targetContext })
    this._startElapsed()
    this._submit()
  },

  onUnload() {
    this._stopped = true
    this._unsavedTask = null
    if (this._elapsedTimer) clearInterval(this._elapsedTimer)
    if (this._pollTimer) clearTimeout(this._pollTimer)
  },

  /** 已用时长是真实计时,可以显示;百分比不是,不显示。 */
  _startElapsed() {
    this._elapsedTimer = setInterval(() => {
      if (this._stopped) return
      this.setData({ elapsed: this.data.elapsed + 1 })
    }, 1000)
  },

  _payload() {
    const payload = {
      fileId: this.data.fileId,
      fileName: this.data.fileName || `resume.${this.data.fileFormat || 'pdf'}`,
      fileFormat: this.data.fileFormat || 'pdf',
      source: this.data.source === 'scan' ? 'scan' : 'upload',
      targetContext: this.data.targetContext,
    }
    if (this.data.selectedDimensions.length) payload.selectedDimensions = this.data.selectedDimensions
    return payload
  },

  /**
   * 本页是否还握着同一次意图。
   * held:盘上就是这次的 intent、owner、payload。
   * absent:读成功且没有这一条(旧任务,或已经换了人)。
   * unreadable:读失败或形态坏了。不能据此另铸意图。
   */
  _intentHold() {
    if (!this._intent || !this._submitIdentity || !sameIdentity(this._submitIdentity) || !this._intentPayload) {
      return 'absent'
    }
    const read = storage.read(intentStore.STORE_KEY)
    if (!read || read.ok !== true) return 'unreadable'
    if (!read.found) return 'absent'
    const rows = read.value
    if (!Array.isArray(rows) || rows.length !== 1) return 'unreadable'
    const row = rows[0]
    if (!row || row.intent !== this._intent || row.ownerId !== this._submitIdentity.ownerId) return 'absent'
    if (JSON.stringify(row.payload) !== JSON.stringify(this._intentPayload)) return 'absent'
    return 'held'
  },

  /** 已知编号的重查失败时留在同一次意图上;没有编号时保持原来的未知态。 */
  _stopForIntent(knownTaskId, cause, recheck = 'not-ready') {
    if (knownTaskId && this._intentHold() !== 'absent') {
      this._unknown(knownTaskId, cause, recheck, { intentReplay: true })
      return
    }
    this._unknown(knownTaskId, cause)
  },

  async _submit() {
    // 同一时刻最多一次解析 POST:连点「重试」、确认框回调重入都只发一次。
    if (this._submitting) return
    this._submitting = true
    const knownTaskId = this._replayTaskId || ''
    this._replayTaskId = ''
    const settle = () => {
      this._submitting = false
      this._replayArmed = false
    }
    const identity = captureIdentity()
    this._submitIdentity = identity
    this.setData({ atext: '正在解析简历,请勿离开…' })
    const requestPayload = this._payload()
    let prepared
    try {
      prepared = await intentStore.prepare(requestPayload, identity.ownerId)
    } catch (err) {
      settle()
      if (this._stopped || !sameIdentity(identity)) return
      this._stopForIntent(knownTaskId, err && err.code === 'INTENT_CONFLICT'
        ? '本机还有另一次尚未完成的解析，不能换材料或换账号继续。'
        : '本机没能安全准备这次解析，为避免重复调用已中止。请稍后重试。')
      return
    }
    if (this._stopped || !sameIdentity(identity)) {
      settle()
      return
    }
    const intent = prepared.headers[intentStore.INTENT_HEADER]
    // 已知编号的重查只允许原来的那一对请求头。prepare 若铸了新的,不能发出去。
    if (knownTaskId && intent !== this._intent) {
      settle()
      await intentStore.clear(intent, identity.ownerId)
      if (this._stopped || !sameIdentity(identity)) return
      this._stopForIntent(knownTaskId, '这次重查没能沿用原来的解析标识，没有另起一次解析。')
      return
    }
    this._intent = intent
    this._intentPayload = prepared.payload
    const payload = prepared.payload
    api.parseResume(payload, prepared.headers)
      .then(
        (res) => {
          settle()
          if (this._stopped || !sameIdentity(identity)) return
          this._handle(res, 0, knownTaskId)
        },
        (err) => {
          settle()
          if (this._stopped || !sameIdentity(identity)) return
          if (submitErrorOutcome(err) === 'unknown') {
            this._stopForIntent(knownTaskId, err && err.code === 'RESUME_PARSE_OUTCOME_UNKNOWN'
              ? '这次解析是否已经完成无法确认。请用同一次重查，不要开始新的解析。'
              : UNKNOWN_CAUSE.noReply)
          } else this._fail(err)
        },
      )
      // 已收到 2xx 之后本页自己出了异常:服务端那边可能已经完成,同样只能说未知。
      .catch(() => this._stopForIntent(knownTaskId, UNKNOWN_CAUSE.malformed))
  },

  /**
   * 处理解析响应(裸响应:顶层直接是 taskId/status/report)。
   * accessToken 只在提交时下发一次,必须先落地再做任何跳转,
   * 否则页面被切走就永久丢失读取权限。
   * @param {string} knownTaskId 轮询 / 再查时本来就知道的编号;POST 首答传空串
   */
  _handle(res, round, knownTaskId) {
    if (this._stopped) return
    if (this._submitIdentity && !sameIdentity(this._submitIdentity)) return
    // 2xx 却没有可用的响应体(空包、截断成字符串):服务端可能已经跑完,只是答复没到齐。
    if (!res || typeof res !== 'object') {
      this._stopForIntent(knownTaskId, knownTaskId ? UNKNOWN_CAUSE.pollMalformed : UNKNOWN_CAUSE.malformed)
      return
    }
    // 已知编号的重查若指向另一编号，不能把别人的令牌或结果落到本机，也不能另铸意图。
    if (knownTaskId && res.taskId && res.taskId !== knownTaskId) {
      this._stopForIntent(knownTaskId, UNKNOWN_CAUSE.pollMalformed, 'malformed')
      return
    }

    if (res.taskId) {
      // 轮询 GET 回的是落库结果,不带 accessToken;照抄 res 会把 POST 存下的令牌清空,
      // 诊断页随即 404。同一任务沿用已存令牌;换了任务绝不继承上一条的令牌。
      const prev = storage.get(storage.KEYS.RESUME_TASK) || {}
      const keptToken = prev.taskId === res.taskId ? (prev.accessToken || '') : ''
      const task = {
        taskId: res.taskId,
        accessToken: res.accessToken || keptToken,
        fileId: res.fileId || this.data.fileId,
        fileName: this.data.fileName,
        ts: Date.now(),
      }
      if (!storage.set(storage.KEYS.RESUME_TASK, task)) {
        // 匿名令牌只下发这一次。写盘失败时留在页实例内,不跳诊断页、也不再 POST。
        this._unsavedTask = task
        this._unknown(res.taskId, UNKNOWN_CAUSE.storage)
        return
      }
      this._unsavedTask = null
    }

    const taskId = res.taskId || knownTaskId || ''
    const status = res.status

    if (status === 'completed') {
      // 说完成却没给编号:诊断页无从读取这一次,不能带个空编号过去碰运气。
      if (!taskId) {
        this._unknown('', UNKNOWN_CAUSE.malformed)
        return
      }
      this.setData({ phase: 'parsing', done: true, atext: '解析完成' })
      if (this._intent && sameIdentity(this._submitIdentity)) {
        intentStore.markSettled(this._intent, this._submitIdentity.ownerId)
      }
      setTimeout(() => {
        if (this._stopped) return
        wx.redirectTo({
          url: `/pages/resume-diagnose/resume-diagnose?taskId=${encodeURIComponent(taskId)}`,
        })
      }, 500)
      return
    }

    if (status === 'failed') {
      if (taskId && this._intent && sameIdentity(this._submitIdentity)) {
        intentStore.markSettled(this._intent, this._submitIdentity.ownerId)
      }
      this._fail(new Error(res.failReason || 'AI 解析未能完成'))
      return
    }

    // 只有 pending / processing 才是「还在跑」;其它取值是答复不完整,不当成进度。
    if (status !== 'pending' && status !== 'processing') {
      this._unknown(taskId, taskId ? UNKNOWN_CAUSE.pollMalformed : UNKNOWN_CAUSE.malformed)
      return
    }

    // 已登记却没给编号:没有可查的接口,只能如实说未知。
    if (!taskId) {
      this._unknown('', UNKNOWN_CAUSE.malformed)
      return
    }

    // 等久了不等于失败:编号还在,交给用户按同一编号再查。
    if (round >= POLL_MAX) {
      this._unknown(taskId, UNKNOWN_CAUSE.pollExhausted)
      return
    }

    this.setData({ atext: '正在解析简历,请勿离开…' })
    this._pollTimer = setTimeout(() => {
      if (this._stopped) return
      api.getResumeRecord(taskId, this._taskToken(taskId))
        .then(
          (r) => this._handle(r, round + 1, taskId),
          (err) => {
            if (this._stopped || (this._submitIdentity && !sameIdentity(this._submitIdentity))) return
            this._onRecordError(taskId, err)
          },
        )
        .catch(() => this._unknown(taskId, UNKNOWN_CAUSE.pollMalformed))
    }, POLL_INTERVAL)
  },

  /**
   * 意图还在时,已知编号的 404 只说明解析行还没可读:停在同一次重查,不再空转轮询,也不另铸意图。
   * 盘上没有这次意图的旧任务,仍按身份/令牌核对。
   */
  _onRecordError(taskId, err) {
    if (isTaskNotFound(err) && this._intentHold() !== 'absent') {
      this._unknown(taskId, UNKNOWN_CAUSE.notReady, 'not-ready', { intentReplay: true })
      return
    }
    if (isTaskNotFound(err)) this._unknown(taskId, UNKNOWN_CAUSE.notFound, 'not-found')
    else this._unknown(taskId, UNKNOWN_CAUSE.pollError)
  },

  /** 本机为这一编号存下的一次性令牌;别的任务的令牌一律不给(会员读取不需要令牌)。 */
  _taskToken(taskId) {
    const saved = storage.get(storage.KEYS.RESUME_TASK) || {}
    return saved.taskId === taskId ? (saved.accessToken || '') : ''
  },

  /** 只重试保存当前页已经收到的凭证;未保存成功前不发 GET 或第二次 POST。 */
  _saveUnsavedTask(taskId) {
    const task = this._unsavedTask
    if (!task || task.taskId !== taskId) return true
    if (!storage.set(storage.KEYS.RESUME_TASK, task)) return false
    this._unsavedTask = null
    return true
  },

  /**
   * 结果未知:只停下本机等待,不说失败、不自动再提交(再提交是一次新的 AI 调用)。
   * @param {string} taskId 有编号时给出「按同一编号再查」;没有时说明为什么查不到
   * @param {string} [recheck] 'not-found' = 当前身份/令牌下查不到这个编号
   */
  _unknown(taskId, cause, recheck = 'idle', extra = {}) {
    if (this._stopped) return
    if (this._elapsedTimer) clearInterval(this._elapsedTimer)
    if (this._pollTimer) clearTimeout(this._pollTimer)
    this.setData({
      phase: 'unknown',
      done: false,
      unknownCause: cause,
      pendingTaskId: taskId || '',
      recheck,
      intentReplay: extra.intentReplay === true,
      canCheckRecords: !taskId && auth.isLoggedIn(),
    })
  },

  _fail(err) {
    if (this._stopped) return
    if (this._elapsedTimer) clearInterval(this._elapsedTimer)
    this.setData({
      phase: 'failed',
      failMsg: (err && err.message) || '解析失败,请稍后重试',
    })
  },

  retry() {
    if (this.data.phase === 'missing') {
      wx.redirectTo({ url: '/pages/resume-upload/resume-upload' })
      return
    }
    // 只有「明确失败」才直接重提。结果未知时刚才那次可能已经完成,
    // 再提交必须走 confirmResubmit:标明是新的一次,并先让用户确认。
    if (this.data.phase !== 'failed') return
    this._resubmit()
  },

  /** 没有任务编号时，用已经保存的同一对请求头再提交一次，不另铸意图。 */
  replaySame() {
    if (this.data.phase !== 'unknown' || this.data.pendingTaskId || this.data.intentReplay || this._submitting) return
    if (this._elapsedTimer) clearInterval(this._elapsedTimer)
    this.setData({
      phase: 'parsing', failMsg: '', elapsed: 0, done: false,
      unknownCause: '', pendingTaskId: '', recheck: 'idle', canCheckRecords: false,
      intentReplay: false,
    })
    this._stopped = false
    this._startElapsed()
    this._submit()
  },

  /**
   * 已有编号、意图仍在、GET 还读不到结果:再 POST 同一对请求头。
   * 返回的编号必须还是这一个;对不上就留下原编号,不收下另一条结果,也不另铸意图。
   */
  replayKnown() {
    const taskId = this.data.pendingTaskId
    if (this.data.phase !== 'unknown' || !this.data.intentReplay || !taskId || this._submitting || this._replayArmed) return
    const hold = this._intentHold()
    if (hold !== 'held') {
      if (hold === 'absent') this._unknown(taskId, UNKNOWN_CAUSE.notFound, 'not-found')
      else this._unknown(taskId, '本机读不到这一次的解析标识，没有重新提交。', 'not-ready', { intentReplay: true })
      return
    }
    this._replayArmed = true
    this._replayTaskId = taskId
    if (this._elapsedTimer) clearInterval(this._elapsedTimer)
    this.setData({
      phase: 'parsing', failMsg: '', elapsed: 0, done: false,
      unknownCause: '', pendingTaskId: '', recheck: 'idle', canCheckRecords: false,
      intentReplay: false,
    })
    this._stopped = false
    this._startElapsed()
    this._submit()
  },

  /**
   * 结果未知时的「重新提交(新的一次)」。有编号时一般不提供(按同一编号再查即可),
   * 除非当前身份/令牌下查不到它(recheck=not-found);确认框打开期间、POST 在途时都不接受第二次。
   * 必须连续确认两次，并且成功清除本机未落定意图之后，才允许新的一对请求头。
   */
  confirmResubmit() {
    if (!this._resubmitAllowed()) return
    if (this._submitting || this._confirming) return
    this._confirming = true
    wx.showModal({
      title: '重新提交是新的一次',
      content: '刚才那次解析可能已经完成。重新提交会再调用一次 AI,生成新的一次解析,不会取消或覆盖刚才那次;如果刚才那次其实已经完成,就等于重复解析了一次。确定重新提交吗?',
      confirmText: '重新提交',
      cancelText: '先不提交',
      success: (r) => {
        if (!(r && r.confirm) || this._stopped || !this._resubmitAllowed()) {
          this._confirming = false
          return
        }
        wx.showModal({
          title: '再次确认',
          content: '将清除本机这一次未完成的解析标识，并开始新的一次 AI 解析。',
          confirmText: '开始新的一次',
          cancelText: '先不提交',
          success: (r2) => {
            this._confirming = false
            if (r2 && r2.confirm && !this._stopped && this._resubmitAllowed()) this._startFresh()
          },
          fail: () => { this._confirming = false },
        })
      },
      fail: () => { this._confirming = false },
    })
  },

  async _startFresh() {
    if (this._submitting) return
    this._submitting = true
    const identity = captureIdentity()
    const intent = this._intent
    if (!intent || !sameIdentity(identity)) {
      this._submitting = false
      this._unknown('', '登录状态已变化，没有开始新的一次解析。')
      return
    }
    const cleared = await intentStore.clear(intent, identity.ownerId)
    if (this._stopped || !sameIdentity(identity)) {
      this._submitting = false
      return
    }
    if (!cleared || (!cleared.ok && cleared.code !== 'INTENT_NOT_FOUND')) {
      this._submitting = false
      this._unknown('', '本机没能清除上一次未完成的解析，没有开始新的一次。')
      return
    }
    this._intent = ''
    this._submitting = false
    this._resubmit()
  },

  /** 新一次 POST 只在两种未知态开放:没有编号;或有编号但当前身份/令牌下查不到。意图重查态不开放。 */
  _resubmitAllowed() {
    const d = this.data
    if (d.intentReplay) return false
    return d.phase === 'unknown' && (!d.pendingTaskId || d.recheck === 'not-found')
  },

  /** 发起一次全新的解析 POST(调用方负责确认过这是用户本人的明确选择)。 */
  _resubmit() {
    if (this._submitting) return
    // 同一个 fileId 仍在有效期内(后端约 30 分钟)可直接重提;过期会由后端报错
    if (this._elapsedTimer) clearInterval(this._elapsedTimer)
    this.setData({
      phase: 'parsing', failMsg: '', elapsed: 0, done: false,
      unknownCause: '', pendingTaskId: '', recheck: 'idle', canCheckRecords: false,
      intentReplay: false,
    })
    this._stopped = false
    this._startElapsed()
    this._submit()
  },

  /** 按同一编号只读再查一次(既有 GET,凭本人会员身份或本机存下的一次性令牌),不会重新解析。 */
  recheck() {
    const taskId = this.data.pendingTaskId
    if (this.data.phase !== 'unknown' || !taskId || this._rechecking) return
    if (!this._saveUnsavedTask(taskId)) {
      this.setData({ unknownCause: UNKNOWN_CAUSE.storage, recheck: 'error' })
      return
    }
    this._rechecking = true
    this.setData({ recheck: 'checking' })
    const settle = () => { this._rechecking = false }
    api.getResumeRecord(taskId, this._taskToken(taskId))
      .then(
        (res) => {
          settle()
          if (this._stopped) return
          // 只有最终结果才交给 _handle;仍在跑就原地告诉用户,不偷偷转回自动轮询。
          if (res && typeof res === 'object' && res.taskId && res.taskId !== taskId) {
            this.setData({ recheck: 'malformed' })
            return
          }
          if (res && typeof res === 'object' && (res.status === 'completed' || res.status === 'failed')) {
            this._handle(res, POLL_MAX, taskId)
            return
          }
          this.setData({
            recheck: res && typeof res === 'object' && (res.status === 'pending' || res.status === 'processing') ? 'not-ready' : 'malformed',
            intentReplay: false,
          })
        },
        (err) => {
          settle()
          if (this._stopped) return
          if (isTaskNotFound(err) && this._intentHold() !== 'absent') {
            this.setData({ recheck: 'not-ready', intentReplay: true, unknownCause: UNKNOWN_CAUSE.notReady })
            return
          }
          if (isTaskNotFound(err)) this.setData({ recheck: 'not-found', intentReplay: false, unknownCause: UNKNOWN_CAUSE.notFound })
          else this.setData({ recheck: 'error', intentReplay: false })
        },
      )
  },

  /** 没有编号但已登录:这一次若已完成,会出现在本人的 AI 服务记录里。 */
  toAiRecords() {
    wx.navigateTo({ url: '/pages/ai-records/ai-records' })
  },

  toUpload() {
    wx.redirectTo({ url: '/pages/resume-upload/resume-upload' })
  },

  back() {
    this._stopped = true
    this._unsavedTask = null
    if (this._elapsedTimer) clearInterval(this._elapsedTimer)
    if (this._pollTimer) clearTimeout(this._pollTimer)
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },
})
