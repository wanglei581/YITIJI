// 小程序录音：wx.getRecorderManager → 16kHz 单声道 WAV。
//
// 一体机那边是 getUserMedia + 线性重采样（apps/kiosk/src/utils/wavRecorder.ts）。
// 小程序没有 AudioContext 采集，不能照抄那份；RecorderManager 原生就支持
// format:'wav' + sampleRate:16000 + numberOfChannels:1，后端 isWavBuffer 只认
// RIFF/WAVE 魔数，这条路径对齐的是产出格式，不是采集实现。
//
// start(maxMs) 的 Promise 在录音结束时 resolve（手动 stop / 到点自动停）。
// cancel() 会丢掉这一段，resolve(null)。

const QUESTION_MAX_MS = 58000
const PROBE_MAX_MS = 10000

let recorder = null
let bound = false
let inflight = null
let discarded = false
let stopping = false

function classifyRecorderError(msg) {
  const s = String(msg || '')
  if (s.indexOf('auth deny') >= 0 || s.indexOf('authorize') >= 0 || s.indexOf('permission') >= 0) {
    return 'permission-denied'
  }
  if (s.indexOf('NotFound') >= 0 || s.indexOf('not found') >= 0) return 'no-device'
  if (s.indexOf('busy') >= 0 || s.indexOf('is recording') >= 0) return 'busy'
  return 'unknown'
}

function fail(code, message) {
  const e = new Error(message)
  e.code = code
  return e
}

function getRecorder() {
  if (typeof wx === 'undefined' || typeof wx.getRecorderManager !== 'function') return null
  if (recorder) return recorder
  recorder = wx.getRecorderManager()
  if (bound) return recorder
  recorder.onStop((res) => {
    const job = inflight
    inflight = null
    stopping = false
    const drop = discarded
    discarded = false
    if (!job) return
    if (drop) job.resolve(null)
    else job.resolve(res || null)
  })
  recorder.onError((err) => {
    const job = inflight
    inflight = null
    stopping = false
    discarded = false
    if (!job) return
    const msg = (err && (err.errMsg || err.message)) || '录音失败'
    job.reject(fail(classifyRecorderError(msg), msg))
  })
  bound = true
  return recorder
}

function ensureRecordAuth() {
  return new Promise((resolve) => {
    if (typeof wx === 'undefined' || typeof wx.getSetting !== 'function') {
      resolve(false)
      return
    }
    // getSetting 不弹框、正常几十毫秒就回。但当公众平台「用户隐私保护指引」
    // 没把麦克风列入采集清单时，微信底层可能把隐私相关调用整个挡下——
    // 观察到的形态不止 fail，还有 success/fail 都不触发。那样这个 Promise
    // 永不落定，调用方的 .then 不执行，用户点完「同意并试音」原地没反应。
    // 挂住必须退化成「当作没授权」，走整场手打；不能让人对着不动的页面等。
    // 只给 getSetting 设时限：authorize 会弹系统框等用户按，给它设时限
    // 会在用户还在读弹框时误判成拒绝。
    let settled = false
    const finish = (v) => { if (!settled) { settled = true; resolve(v) } }
    const guard = setTimeout(() => finish(false), 5000)
    wx.getSetting({
      success(res) {
        clearTimeout(guard)
        if (settled) return
        const setting = (res && res.authSetting) || {}
        if (setting['scope.record'] === true) {
          finish(true)
          return
        }
        if (setting['scope.record'] === false) {
          finish(false)
          return
        }
        wx.authorize({
          scope: 'scope.record',
          success() { finish(true) },
          fail() { finish(false) },
        })
      },
      fail() { clearTimeout(guard); finish(false) },
    })
  })
}

function settleCurrent(asCancel) {
  if (!inflight) return Promise.resolve(null)
  discarded = Boolean(asCancel)
  stopping = true
  try { getRecorder().stop() } catch (_) {}
  return new Promise((resolve) => {
    const prev = inflight
    if (!prev) {
      discarded = false
      stopping = false
      resolve(null)
      return
    }
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve(null)
    }
    inflight = {
      resolve(res) { prev.resolve(asCancel ? null : res); finish() },
      reject() { prev.resolve(null); finish() },
    }
    setTimeout(() => {
      if (done) return
      inflight = null
      stopping = false
      prev.resolve(null)
      finish()
    }, 1500)
  })
}

function start(maxMs) {
  const rec = getRecorder()
  if (!rec) return Promise.reject(fail('unsupported', '当前基础库不支持录音，请改用文字输入'))
  return settleCurrent(true).then(() => new Promise((resolve, reject) => {
    inflight = { resolve, reject }
    discarded = false
    stopping = false
    const duration = Math.max(1000, Math.min(QUESTION_MAX_MS, Number(maxMs) || QUESTION_MAX_MS))
    try {
      rec.start({
        duration,
        sampleRate: 16000,
        numberOfChannels: 1,
        format: 'wav',
      })
    } catch (err) {
      inflight = null
      reject(fail('unknown', (err && err.message) || '无法开始录音'))
    }
  }))
}

function stop() {
  if (!inflight || stopping) return Promise.resolve(null)
  stopping = true
  discarded = false
  try { getRecorder().stop() } catch (err) {
    const job = inflight
    inflight = null
    stopping = false
    if (job) job.reject(err)
    return Promise.reject(err)
  }
  return Promise.resolve(null)
}

function cancel() {
  return settleCurrent(true)
}

module.exports = {
  QUESTION_MAX_MS,
  PROBE_MAX_MS,
  ensureRecordAuth,
  start,
  stop,
  cancel,
}
