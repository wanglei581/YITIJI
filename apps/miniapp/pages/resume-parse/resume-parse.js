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
  settle: '解析结果的读取凭证已留在本机，但没能释放这一次的解析标识。请点“继续打开结果”，不要开始新的解析。',
  anonToken: '这次解析有了编号，但答复里没有匿名读取凭证。请用同一次重查，不要开始新的解析。',
  anonFailed: '服务端说这次解析没有完成，但这台手机没有拿到读取凭证，不能把它当成可以查看的结果。请用同一次重查，不要开始新的解析。',
}

function nonemptyToken(value) {
  return typeof value === 'string' && value ? value : ''
}

function sameStoredTask(saved, task) {
  return !!saved
    && saved.taskId === task.taskId
    && (saved.accessToken || '') === (task.accessToken || '')
    && (saved.settledIntent || '') === (task.settledIntent || '')
}

/** setStorageSync 不抛也可能没写进去。回读不一致就当没保存。 */
function persistResumeTask(task) {
  if (storage.set(storage.KEYS.RESUME_TASK, task) !== true) return false
  const back = storage.read(storage.KEYS.RESUME_TASK)
  return !!(back && back.ok === true && back.found && sameStoredTask(back.value, task))
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
 * 只有这一对才表示 consumeOnce 在 marker / admit / provider 之前拒绝，账本停在 quota_pending。
 * FILE_NOT_FOUND 不能走这里：预检失败和已受理后文件被删都会返回它，清标识可能再扣一次。
 */
function isExactPublicQuotaExceeded(err) {
  return !!err && err.statusCode === 429 && err.code === 'AI_PUBLIC_QUOTA_EXCEEDED'
}

const QUOTA_REJECTED = '今日 AI 解析次数已用完，这次没有开始新的解析。'
const QUOTA_RELEASE_FAILED = '今日 AI 解析次数已用完，但本机没能安全释放这次解析标识。请留在此页，不要开始新的解析。'
const QUOTA_MISMATCH = '今日 AI 解析次数已用完，但本机解析标识已经对不上，没有释放，也没有另起一次解析。'

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
    // 凭证已回读成功,但释放意图失败:只重试释放,不另起一次
    settleBlocked: false,
    // 可信额度 429 已释放本机意图：下一次必须是用户明确开始的新标识
    quotaReleased: false,
    // 额度 429 到了，但标识对不上或没写掉：留着原标识，不能另起一次
    quotaReleaseBlocked: false,
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
    if (!Array.isArray(rows)) return 'unreadable'
    if (rows.length === 0) return 'absent'
    if (rows.length !== 1) return 'unreadable'
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
      let blocked = err
      // 只释放“结果凭证已经回读成功”的那一条。进行中的意图不能被新任务清掉。
      if (blocked && blocked.code === 'INTENT_CONFLICT' && !knownTaskId && await this._releaseFinishedIntent(identity)) {
        if (!this._stopped && sameIdentity(identity)) {
          try {
            prepared = await intentStore.prepare(requestPayload, identity.ownerId)
            blocked = null
          } catch (err2) {
            blocked = err2
          }
        }
      }
      if (!prepared) {
        settle()
        if (this._stopped || !sameIdentity(identity)) return
        this._stopForIntent(knownTaskId, blocked && blocked.code === 'INTENT_CONFLICT'
          ? '本机还有另一次尚未完成的解析，不能换材料或换账号继续。'
          : '本机没能安全准备这次解析，为避免重复调用已中止。请稍后重试。')
        return
      }
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
          if (isExactPublicQuotaExceeded(err)) {
            return this._releasePublicQuota(identity)
          }
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
  async _handle(res, round, knownTaskId) {
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

    const taskId = res.taskId || knownTaskId || ''
    const status = res.status
    const terminal = status === 'completed' || status === 'failed'
    const anonymous = this._submitIdentity ? this._submitIdentity.ownerId === null : ownerId() === null
    if (res.taskId) {
      // 轮询 GET 回的是落库结果,不带 accessToken;照抄 res 会把 POST 存下的令牌清空,
      // 诊断页随即 404。同一任务沿用已存令牌;换了任务绝不继承上一条的令牌。
      const prev = storage.get(storage.KEYS.RESUME_TASK) || {}
      const keptToken = prev.taskId === res.taskId ? nonemptyToken(prev.accessToken) : ''
      const token = nonemptyToken(res.accessToken) || keptToken
      // 匿名终态没有可读令牌时不能落空凭证、不能释放意图。同一次重查才可能把令牌补回来。
      if (terminal && anonymous && !token) {
        this._unknown(res.taskId, status === 'failed' ? UNKNOWN_CAUSE.anonFailed : UNKNOWN_CAUSE.anonToken, 'idle', {
          intentReplay: this._intentHold() !== 'absent',
        })
        return
      }
      const task = {
        taskId: res.taskId,
        accessToken: token,
        fileId: res.fileId || this.data.fileId,
        fileName: this.data.fileName,
        ts: Date.now(),
      }
      if (terminal && this._intent && sameIdentity(this._submitIdentity) && (!anonymous || token)) task.settledIntent = this._intent
      if (!persistResumeTask(task)) {
        // 匿名令牌只下发这一次。写盘或回读失败时留在页实例内,不释放意图、不跳诊断页。
        this._unsavedTask = task
        this._unknown(res.taskId, UNKNOWN_CAUSE.storage)
        return
      }
      this._unsavedTask = null
    }

    if (status === 'completed') {
      // 说完成却没给编号:诊断页无从读取这一次,不能带个空编号过去碰运气。
      if (!taskId) {
        this._unknown('', UNKNOWN_CAUSE.malformed)
        return
      }
      await this._finishTerminal(taskId, null)
      return
    }

    if (status === 'failed') {
      if (!taskId) {
        this._fail(new Error(res.failReason || 'AI 解析未能完成'))
        return
      }
      await this._finishTerminal(taskId, new Error(res.failReason || 'AI 解析未能完成'))
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

  /** 释放前盘上必须仍是这一次的 intent、owner 和规范载荷。 */
  _quotaSnapshot(identity) {
    if (!identity || !sameIdentity(identity) || this._intentHold() !== 'held') return null
    let payload
    try { payload = JSON.parse(JSON.stringify(this._intentPayload)) } catch (_) { return null }
    return {
      generation: identity.generation,
      ownerId: identity.ownerId,
      intent: this._intent,
      payload,
    }
  },

  /** 会话代际、owner、intent、规范载荷都还是释放前那一组。不读盘。 */
  _quotaMemoryMatches(snapshot) {
    if (!snapshot || !this._intent || !this._intentPayload) return false
    const generation = typeof auth.sessionGeneration === 'function' ? auth.sessionGeneration() : 0
    if (generation !== snapshot.generation || ownerId() !== snapshot.ownerId) return false
    if (this._intent !== snapshot.intent) return false
    return JSON.stringify(this._intentPayload) === JSON.stringify(snapshot.payload)
  },

  _showQuotaBlocked(message) {
    if (this._stopped || !this._submitIdentity || !sameIdentity(this._submitIdentity)) return
    this._fail(null, { message, quotaReleaseBlocked: true })
  },

  /**
   * 可信额度 429：先确认四元组仍在，再清盘并回读。
   * 成功只停在拒绝页，不自动再 POST。失败留着原标识。
   */
  async _releasePublicQuota(identity) {
    const snapshot = this._quotaSnapshot(identity)
    if (!snapshot || !this._quotaMemoryMatches(snapshot)) {
      this._showQuotaBlocked(QUOTA_MISMATCH)
      return
    }
    let released
    try {
      released = await intentStore.releaseHeld(snapshot, () => this._quotaMemoryMatches(snapshot))
    } catch (e) {
      released = { ok: false, code: 'STORAGE_WRITE_FAILED' }
    }
    if (this._stopped || !sameIdentity(identity) || !this._quotaMemoryMatches(snapshot)) return
    if (!(released && released.ok) || this._intentHold() !== 'absent') {
      const mismatched = released && (released.code === 'INTENT_NOT_HELD' || released.code === 'IDENTITY_CHANGED')
      this._showQuotaBlocked(mismatched ? QUOTA_MISMATCH : QUOTA_RELEASE_FAILED)
      return
    }
    this._intent = ''
    this._intentPayload = null
    this._fail(null, { message: QUOTA_REJECTED, quotaReleased: true })
  },

  /** 只重试保存当前页已经收到的凭证;回读不一致前不发 GET 或第二次 POST。 */
  _saveUnsavedTask(taskId) {
    const task = this._unsavedTask
    if (!task || task.taskId !== taskId) return true
    if (!persistResumeTask(task)) return false
    this._unsavedTask = null
    return true
  },

  /**
   * 终态而且凭证回读成功之后才释放意图。释放失败就留在本页,不导航。
   */
  async _finishTerminal(taskId, failedError) {
    const back = storage.read(storage.KEYS.RESUME_TASK)
    const saved = back && back.ok === true && back.found ? back.value : null
    const anonymous = this._submitIdentity ? this._submitIdentity.ownerId === null : ownerId() === null
    if (!saved || saved.taskId !== taskId) {
      this._unknown(taskId, UNKNOWN_CAUSE.storage)
      return
    }
    if (anonymous && !nonemptyToken(saved.accessToken)) {
      this._unknown(taskId, failedError ? UNKNOWN_CAUSE.anonFailed : UNKNOWN_CAUSE.anonToken, 'idle', {
        intentReplay: this._intentHold() !== 'absent',
      })
      return
    }
    if (this._intent && sameIdentity(this._submitIdentity)) {
      if (saved.settledIntent !== this._intent) {
        const next = {
          taskId: saved.taskId,
          accessToken: saved.accessToken || '',
          fileId: saved.fileId || this.data.fileId,
          fileName: saved.fileName || this.data.fileName,
          ts: Date.now(),
          settledIntent: this._intent,
        }
        if (!persistResumeTask(next)) {
          this._unsavedTask = next
          this._unknown(taskId, UNKNOWN_CAUSE.storage)
          return
        }
      }
      const released = await intentStore.markSettled(this._intent, this._submitIdentity.ownerId)
      if (this._stopped || !sameIdentity(this._submitIdentity)) return
      if (!(released && (released.ok || released.code === 'INTENT_NOT_FOUND'))) {
        if (failedError) {
          this._fail(failedError)
          return
        }
        this._unknown(taskId, UNKNOWN_CAUSE.settle, 'idle', { settleBlocked: true })
        return
      }
      this._intent = ''
    }
    if (this._stopped || !sameIdentity(this._submitIdentity)) return
    if (failedError) {
      this._fail(failedError)
      return
    }
    this.setData({ phase: 'parsing', done: true, atext: '解析完成', settleBlocked: false })
    setTimeout(() => {
      if (this._stopped) return
      wx.redirectTo({
        url: `/pages/resume-diagnose/resume-diagnose?taskId=${encodeURIComponent(taskId)}`,
      })
    }, 500)
  },

  /** 凭证里记下的已完成意图才可以清。清不掉就保持原样,不铸新的。 */
  async _releaseFinishedIntent(identity) {
    if (!identity || !sameIdentity(identity)) return false
    const back = storage.read(storage.KEYS.RESUME_TASK)
    const task = back && back.ok === true && back.found ? back.value : null
    if (!task || typeof task.settledIntent !== 'string' || !task.settledIntent || typeof task.taskId !== 'string' || !task.taskId) return false
    if (identity.ownerId === null && !nonemptyToken(task.accessToken)) return false
    const rows = storage.read(intentStore.STORE_KEY)
    if (!rows || rows.ok !== true || !rows.found || !Array.isArray(rows.value) || rows.value.length !== 1) return false
    const row = rows.value[0]
    if (!row || row.intent !== task.settledIntent || row.ownerId !== identity.ownerId) return false
    const cleared = await intentStore.clear(row.intent, identity.ownerId)
    return !!(cleared && (cleared.ok || cleared.code === 'INTENT_NOT_FOUND'))
  },

  async retrySettle() {
    if (!this.data.settleBlocked || this._settling) return
    const taskId = this.data.pendingTaskId
    if (!taskId) return
    this._settling = true
    try {
      await this._finishTerminal(taskId, null)
    } finally {
      this._settling = false
    }
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
      settleBlocked: extra.settleBlocked === true,
      quotaReleased: false,
      quotaReleaseBlocked: false,
      canCheckRecords: !taskId && auth.isLoggedIn(),
    })
  },

  _fail(err, extra) {
    if (this._stopped) return
    if (this._elapsedTimer) clearInterval(this._elapsedTimer)
    if (this._pollTimer) clearTimeout(this._pollTimer)
    const note = extra || {}
    this.setData({
      phase: 'failed',
      failMsg: note.message || (err && err.message) || '解析失败,请稍后重试',
      quotaReleased: note.quotaReleased === true,
      quotaReleaseBlocked: note.quotaReleaseBlocked === true,
    })
  },

  retry() {
    if (this.data.quotaReleaseBlocked) return
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
    if (d.intentReplay || d.settleBlocked || d.quotaReleaseBlocked) return false
    return d.phase === 'unknown' && (!d.pendingTaskId || d.recheck === 'not-found')
  },

  /** 发起一次全新的解析 POST(调用方负责确认过这是用户本人的明确选择)。 */
  _resubmit() {
    if (this._submitting || this.data.quotaReleaseBlocked) return
    // 同一个 fileId 仍在有效期内(后端约 30 分钟)可直接重提;过期会由后端报错
    if (this._elapsedTimer) clearInterval(this._elapsedTimer)
    this.setData({
      phase: 'parsing', failMsg: '', elapsed: 0, done: false,
      unknownCause: '', pendingTaskId: '', recheck: 'idle', canCheckRecords: false,
      intentReplay: false, quotaReleased: false, quotaReleaseBlocked: false,
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
