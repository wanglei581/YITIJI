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
    wx.getSetting({
      success(res) {
        const setting = (res && res.authSetting) || {}
        if (setting['scope.record'] === true) {
          resolve(true)
          return
        }
        if (setting['scope.record'] === false) {
          resolve(false)
          return
        }
        wx.authorize({
          scope: 'scope.record',
          success() { resolve(true) },
          fail() { resolve(false) },
        })
      },
      fail() { resolve(false) },
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
