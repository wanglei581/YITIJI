// 简历解析页的本机会话：谁在提交、盘上是不是这一次标识、冲突时能不能释放。
// 只服务 pages/resume-parse。存储原语仍在 resume-parse-intent.js。

const storage = require('./storage')
const config = require('./config')
const intentStore = require('./resume-parse-intent')

const QUOTA_REJECTED = '今日 AI 解析次数已用完，这次没有开始新的解析。'
const QUOTA_RELEASE_FAILED = '今日 AI 解析次数已用完，但本机没能安全释放这次解析标识。请留在此页，不要开始新的解析。'
const QUOTA_MISMATCH = '今日 AI 解析次数已用完，但本机解析标识已经对不上，没有释放，也没有另起一次解析。'

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

function ownerId(auth) {
  const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null
  return user && typeof user.id === 'string' && user.id ? user.id : null
}

function captureIdentity(auth) {
  return {
    generation: auth && typeof auth.sessionGeneration === 'function' ? auth.sessionGeneration() : 0,
    ownerId: ownerId(auth),
  }
}

function sameIdentity(auth, snapshot) {
  if (!snapshot) return false
  if (auth && typeof auth.isSameSession === 'function' && !auth.isSameSession(snapshot.generation)) return false
  return ownerId(auth) === snapshot.ownerId
}

/**
 * 本页是否还握着同一次意图。
 * held:盘上就是这次的 intent、owner、payload。
 * absent:读成功且没有这一条(旧任务,或已经换了人)。
 * unreadable:读失败或形态坏了。不能据此另铸意图。
 */
function intentHold(page, auth) {
  if (!page._intent || !page._submitIdentity || !sameIdentity(auth, page._submitIdentity) || !page._intentPayload) {
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
  if (!row || row.intent !== page._intent || row.ownerId !== page._submitIdentity.ownerId) return 'absent'
  if (JSON.stringify(row.payload) !== JSON.stringify(page._intentPayload)) return 'absent'
  return 'held'
}

/** 释放前盘上必须仍是这一次的 intent、owner 和规范载荷。 */
function quotaSnapshot(page, auth, identity) {
  if (!identity || !sameIdentity(auth, identity) || intentHold(page, auth) !== 'held') return null
  let payload
  try { payload = JSON.parse(JSON.stringify(page._intentPayload)) } catch (e) { return null }
  return {
    generation: identity.generation,
    ownerId: identity.ownerId,
    intent: page._intent,
    payload,
  }
}

/** 会话代际、owner、intent、规范载荷都还是释放前那一组。不读盘。 */
function quotaMemoryMatches(page, auth, snapshot) {
  if (!snapshot || !page._intent || !page._intentPayload) return false
  const generation = auth && typeof auth.sessionGeneration === 'function' ? auth.sessionGeneration() : 0
  if (generation !== snapshot.generation || ownerId(auth) !== snapshot.ownerId) return false
  if (page._intent !== snapshot.intent) return false
  return JSON.stringify(page._intentPayload) === JSON.stringify(snapshot.payload)
}

function showQuotaBlocked(page, auth, message) {
  if (page._stopped || !page._submitIdentity || !sameIdentity(auth, page._submitIdentity)) return
  page._fail(null, { message, quotaReleaseBlocked: true })
}

/**
 * 可信额度 429：先确认四元组仍在，再清盘并回读。
 * 成功只停在拒绝页，不自动再 POST。失败留着原标识。
 */
async function releasePublicQuota(page, auth, identity) {
  const snapshot = quotaSnapshot(page, auth, identity)
  if (!snapshot || !quotaMemoryMatches(page, auth, snapshot)) {
    showQuotaBlocked(page, auth, QUOTA_MISMATCH)
    return
  }
  let released
  try {
    released = await intentStore.releaseHeld(snapshot, () => quotaMemoryMatches(page, auth, snapshot))
  } catch (e) {
    released = { ok: false, code: 'STORAGE_WRITE_FAILED' }
  }
  if (page._stopped || !sameIdentity(auth, identity) || !quotaMemoryMatches(page, auth, snapshot)) return
  if (!(released && released.ok) || intentHold(page, auth) !== 'absent') {
    const mismatched = released && (released.code === 'INTENT_NOT_HELD' || released.code === 'IDENTITY_CHANGED')
    showQuotaBlocked(page, auth, mismatched ? QUOTA_MISMATCH : QUOTA_RELEASE_FAILED)
    return
  }
  page._intent = ''
  page._intentPayload = null
  page._fail(null, { message: QUOTA_REJECTED, quotaReleased: true })
}

/**
 * 409 FILE_CONTENT_CHANGED：预检在额度之前把文件隔离。
 * 只释放回读仍匹配的本机标识，不自动再 POST，也不走额度 429 的「开始新的一次」。
 */
async function releaseFileChanged(page, auth, identity) {
  const copy = intentStore.terminalCopy('FILE_CONTENT_CHANGED')
  const snapshot = quotaSnapshot(page, auth, identity)
  if (!snapshot || !quotaMemoryMatches(page, auth, snapshot)) {
    showFileChangedBlocked(page, auth, copy.blocked)
    return
  }
  let released
  try {
    released = await intentStore.releaseHeld(snapshot, () => quotaMemoryMatches(page, auth, snapshot))
  } catch (e) {
    released = { ok: false, code: 'STORAGE_WRITE_FAILED' }
  }
  if (page._stopped || !sameIdentity(auth, identity) || !quotaMemoryMatches(page, auth, snapshot)) return
  if (!(released && released.ok) || intentHold(page, auth) !== 'absent') {
    showFileChangedBlocked(page, auth, copy.blocked)
    return
  }
  page._intent = ''
  page._intentPayload = null
  page._fail(null, { message: copy.released, fileChanged: true })
}

function showFileChangedBlocked(page, auth, message) {
  if (page._stopped || !page._submitIdentity || !sameIdentity(auth, page._submitIdentity)) return
  page._fail(null, { message, fileChangedBlocked: true })
}

function conflictLive(page, auth, snap) {
  if (!snap || !page._conflictExpected || page._conflictExpected.intent !== snap.intent) return false
  const generation = auth && typeof auth.sessionGeneration === 'function' ? auth.sessionGeneration() : 0
  if (generation !== snap.generation || ownerId(auth) !== snap.ownerId) return false
  try { return JSON.stringify(page._conflictExpected.payload) === JSON.stringify(snap.payload) } catch (e) { return false }
}

/** 判 release 时看见的任务行，写前写后都还是这一条。身份变了或行变了都不算。 */
function settledStill(auth, identity, expected, settled) {
  if (!sameIdentity(auth, identity)) return false
  if (!expected || !settled || expected.intent !== settled.settledIntent) return false
  if (ownerId(auth) !== expected.ownerId) return false
  if (typeof settled.taskId !== 'string' || !settled.taskId) return false
  const back = storage.read(storage.KEYS.RESUME_TASK)
  if (!sameIdentity(auth, identity) || ownerId(auth) !== expected.ownerId) return false
  if (!back || back.ok !== true || !back.found || !back.value || typeof back.value !== 'object') return false
  const task = back.value
  if (task.taskId !== settled.taskId || task.settledIntent !== expected.intent) return false
  const token = typeof task.accessToken === 'string' ? task.accessToken : ''
  const seen = typeof settled.accessToken === 'string' ? settled.accessToken : ''
  if (token !== seen) return false
  if (expected.ownerId === null && !token) return false
  return true
}

function markConflict(page, mode) {
  const open = mode === 'fresh' || mode === 'retry'
  page._unknown('', intentStore.conflictLead(mode), 'idle', {
    conflict: open ? mode : 'blocked',
    terminalTitle: open ? '另一次标识还在' : '不能开始这次解析',
  })
}

function intentRowHeld() {
  const read = storage.read(intentStore.STORE_KEY)
  return !!(read && read.ok === true && read.found && Array.isArray(read.value) && read.value.length === 1)
}

/**
 * 新材料遇到另一条标识。已保存结果只有在 owner、intent、payload 和任务行
 * 写前写后都还是这一条时，才用 releaseHeld 清掉并继续这次提交。
 * 对不上就不清、不 POST；别人的行和未落定的行仍要两次确认。
 */
async function takeConflict(page, auth, identity, allowRelease) {
  if (page._stopped || !sameIdentity(auth, identity)) return null
  const back = allowRelease === false ? null : storage.read(storage.KEYS.RESUME_TASK)
  const task = back && back.ok === true && back.found ? back.value : null
  let decision
  try { decision = await intentStore.assessConflict(identity.ownerId, page._payload(), task) }
  catch (e) { decision = { action: 'blocked' } }
  if (page._stopped || !sameIdentity(auth, identity)) return null
  if (decision.action === 'release') {
    if (allowRelease === false) { markConflict(page, 'blocked'); return null }
    const expected = decision.expected
    const settled = decision.settled
    if (!expected || !settled || expected.ownerId !== identity.ownerId || expected.intent !== settled.settledIntent) {
      markConflict(page, 'blocked')
      return null
    }
    let released
    try {
      released = await intentStore.releaseHeld(expected, () => settledStill(auth, identity, expected, settled))
    } catch (e) {
      released = { ok: false, code: 'STORAGE_WRITE_FAILED' }
    }
    if (page._stopped) return null
    if (!sameIdentity(auth, identity)) {
      markConflict(page, 'login')
      return null
    }
    if (released && released.ok && settledStill(auth, identity, expected, settled)) {
      try { return await intentStore.prepare(page._payload(), identity.ownerId) }
      catch (e) {
        if (!(e && e.code === 'INTENT_CONFLICT')) { markConflict(page, 'blocked'); return null }
        return takeConflict(page, auth, identity, false)
      }
    }
    if (released && released.code === 'STORAGE_WRITE_FAILED') { markConflict(page, 'retry'); return null }
    if (!intentRowHeld()) { markConflict(page, 'retry'); return null }
    return takeConflict(page, auth, identity, false)
  }
  if (decision.action === 'reuse') {
    try { return await intentStore.prepare(page._payload(), identity.ownerId) }
    catch (e) { markConflict(page, 'blocked'); return null }
  }
  if (decision.action === 'fresh' && decision.expected) {
    let payload = null
    try { payload = JSON.parse(JSON.stringify(decision.expected.payload)) } catch (e) { payload = null }
    if (payload) {
      page._conflictExpected = {
        generation: identity.generation,
        ownerId: identity.ownerId,
        intent: decision.expected.intent,
        payload,
      }
      markConflict(page, 'fresh')
      return null
    }
  }
  page._conflictExpected = null
  markConflict(page, 'blocked')
  return null
}

/** 两次确认之后才释放快照里的那一条。对不上就不清、不 POST。 */
async function releaseConflict(page, auth, identity) {
  const snap = page._conflictExpected
  const generation = auth && typeof auth.sessionGeneration === 'function' ? auth.sessionGeneration() : 0
  const drift = !!(snap && (generation !== snap.generation || ownerId(auth) !== snap.ownerId))
  if (!conflictLive(page, auth, snap) || !sameIdentity(auth, identity)) {
    page._submitting = false
    page._conflictExpected = null
    if (!page._stopped) markConflict(page, drift ? 'login' : 'blocked')
    return
  }
  let released
  try {
    released = await intentStore.releaseHeld(
      { ownerId: snap.ownerId, intent: snap.intent, payload: snap.payload },
      () => conflictLive(page, auth, snap),
    )
  } catch (e) {
    released = { ok: false, code: 'STORAGE_WRITE_FAILED' }
  }
  page._submitting = false
  if (page._stopped || !sameIdentity(auth, identity)) return
  if (released && released.ok && conflictLive(page, auth, snap)) {
    page._conflictExpected = null
    page._resubmit()
    return
  }
  if (released && released.code === 'STORAGE_WRITE_FAILED') { markConflict(page, 'fresh'); return }
  page._conflictExpected = null
  markConflict(page, released && released.code === 'IDENTITY_CHANGED' ? 'login' : 'blocked')
}

module.exports = {
  nonemptyToken,
  persistResumeTask,
  isTaskNotFound,
  isExactPublicQuotaExceeded,
  submitErrorOutcome,
  ownerId,
  captureIdentity,
  sameIdentity,
  intentHold,
  quotaSnapshot,
  quotaMemoryMatches,
  releasePublicQuota,
  releaseFileChanged,
  takeConflict,
  releaseConflict,
}
