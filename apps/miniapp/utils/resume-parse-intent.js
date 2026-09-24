// 首次 POST /resume/parse 之前准备两个请求头。
// 只使用 wx.getRandomValues。读不到、写不回、随机数不可用时失败，调用方不得发无头请求。

const storage = require('./storage')

const STORE_KEY = storage.KEYS.RESUME_PARSE_INTENT
const INTENT_HEADER = 'x-resume-parse-intent'
const PROOF_HEADER = 'x-resume-parse-proof'
const RANDOM_TIMEOUT_MS = 8000
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

let tail = Promise.resolve()

function fail(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function enqueue(work) {
  const run = tail.then(work, work)
  tail = run.then(() => undefined, () => undefined)
  return run
}

function encodeBase64Url(bytes) {
  let out = ''
  let i = 0
  while (i + 3 <= bytes.length) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63]
    i += 3
  }
  if (i < bytes.length) {
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const n = (bytes[i] << 16) | (b1 << 8)
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63]
    if (i + 1 < bytes.length) out += B64[(n >>> 6) & 63]
  }
  return out
}

function indexOf(ch) {
  return B64.indexOf(ch)
}

function decodeCanonical(text) {
  if (typeof text !== 'string' || text.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(text)) return null
  const out = new Uint8Array(32)
  let o = 0
  for (let i = 0; i < 40; i += 4) {
    const a = indexOf(text[i])
    const b = indexOf(text[i + 1])
    const c = indexOf(text[i + 2])
    const d = indexOf(text[i + 3])
    if (a < 0 || b < 0 || c < 0 || d < 0) return null
    const n = (a << 18) | (b << 12) | (c << 6) | d
    out[o] = (n >>> 16) & 255
    out[o + 1] = (n >>> 8) & 255
    out[o + 2] = n & 255
    o += 3
  }
  const a = indexOf(text[40])
  const b = indexOf(text[41])
  const c = indexOf(text[42])
  if (a < 0 || b < 0 || c < 0) return null
  const n = (a << 18) | (b << 12) | (c << 6)
  out[30] = (n >>> 16) & 255
  out[31] = (n >>> 8) & 255
  return encodeBase64Url(out) === text ? out : null
}

function canonicalPayload(payload) {
  if (!payload || typeof payload !== 'object') return null
  if (typeof payload.fileId !== 'string' || !payload.fileId) return null
  if (typeof payload.fileName !== 'string' || !payload.fileName) return null
  if (typeof payload.fileFormat !== 'string' || !payload.fileFormat) return null
  if (payload.source !== 'upload' && payload.source !== 'scan' && payload.source !== 'manual') return null
  const dims = []
  if (payload.selectedDimensions != null) {
    if (!Array.isArray(payload.selectedDimensions)) return null
    for (const item of payload.selectedDimensions) {
      if (typeof item !== 'string') return null
      dims.push(item)
    }
    dims.sort()
  }
  let targetContext = null
  if (payload.targetContext != null) {
    const t = payload.targetContext
    if (typeof t !== 'object') return null
    if (t.skipped != null && typeof t.skipped !== 'boolean') return null
    const text = (value) => (typeof value === 'string' ? value : null)
    targetContext = {
      industry: text(t.industry),
      targetJob: text(t.targetJob),
      experience: text(t.experience),
      scene: text(t.scene),
      major: text(t.major),
      degree: text(t.degree),
      skipped: typeof t.skipped === 'boolean' ? t.skipped : null,
    }
  }
  return {
    fileId: payload.fileId,
    fileName: payload.fileName,
    fileFormat: payload.fileFormat,
    source: payload.source,
    selectedDimensions: dims,
    targetContext,
  }
}

function samePayload(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function validRecord(row) {
  return !!row && typeof row === 'object'
    && (row.ownerId === null || (typeof row.ownerId === 'string' && row.ownerId !== ''))
    && canonicalPayload(row.payload)
    && samePayload(canonicalPayload(row.payload), row.payload)
    && !!decodeCanonical(row.intent)
    && !!decodeCanonical(row.proof)
    && row.intent !== row.proof
    && typeof row.ts === 'number' && Number.isFinite(row.ts)
}

function loadRecords() {
  const result = storage.read(STORE_KEY)
  if (!result.ok) return { error: 'STORAGE_UNREADABLE' }
  if (!result.found) return { records: [] }
  if (!Array.isArray(result.value) || result.value.some((row) => !validRecord(row))) {
    return { error: 'STORAGE_CORRUPT' }
  }
  return { records: result.value }
}

function writeRecords(records) {
  if (storage.set(STORE_KEY, records) !== true) return false
  const back = storage.read(STORE_KEY)
  if (!back.ok || !back.found || !Array.isArray(back.value)) return false
  return JSON.stringify(back.value) === JSON.stringify(records)
}

function toBytes(randomValues) {
  let view
  try {
    view = new Uint8Array(randomValues)
  } catch (e) {
    return null
  }
  if (view.length < 32) return null
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i += 1) out[i] = view[i]
  return out
}

function random32() {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || typeof wx.getRandomValues !== 'function') {
      reject(fail('RANDOM_UNAVAILABLE'))
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(fail('RANDOM_TIMEOUT'))
    }, RANDOM_TIMEOUT_MS)
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    try {
      wx.getRandomValues({
        length: 32,
        success: (res) => {
          const bytes = toBytes(res && res.randomValues)
          const encoded = bytes && encodeBase64Url(bytes)
          if (!encoded || !decodeCanonical(encoded)) finish(fail('RANDOM_FAILED'))
          else finish(null, encoded)
        },
        fail: () => finish(fail('RANDOM_FAILED')),
        complete: () => finish(fail('RANDOM_FAILED')),
      })
    } catch (e) {
      finish(fail('RANDOM_FAILED'))
    }
  })
}

function headersOf(row) {
  return {
    payload: row.payload,
    headers: {
      [INTENT_HEADER]: row.intent,
      [PROOF_HEADER]: row.proof,
    },
  }
}

async function prepareBody(payload, ownerIdentity) {
  const loaded = loadRecords()
  if (loaded.error) throw fail(loaded.error)
  const ownerId = ownerIdentity === null ? null : ownerIdentity
  if (ownerId !== null && (typeof ownerId !== 'string' || !ownerId)) throw fail('OWNER_INVALID')
  const canonical = canonicalPayload(payload)
  if (!canonical) throw fail('PAYLOAD_INVALID')
  const match = loaded.records.find((row) => row.ownerId === ownerId && samePayload(row.payload, canonical))
  if (match) return headersOf(match)
  if (loaded.records.length > 0) throw fail('INTENT_CONFLICT')
  const intent = await random32()
  const proof = await random32()
  if (intent === proof) throw fail('RANDOM_NOT_INDEPENDENT')
  const row = { ownerId, payload: canonical, intent, proof, ts: Date.now() }
  if (!writeRecords(loaded.records.concat([row]))) throw fail('STORAGE_WRITE_FAILED')
  return headersOf(row)
}

function prepare(payload, ownerIdentity) {
  return enqueue(() => prepareBody(payload, ownerIdentity))
}

function removeMatching(intent, ownerIdentity) {
  const loaded = loadRecords()
  if (loaded.error) return { ok: false, code: loaded.error }
  const ownerId = ownerIdentity === null ? null : ownerIdentity
  if (!decodeCanonical(intent) || (ownerId !== null && (typeof ownerId !== 'string' || !ownerId))) {
    return { ok: false, code: 'INTENT_NOT_FOUND' }
  }
  const next = loaded.records.filter((row) => !(row.intent === intent && row.ownerId === ownerId))
  if (next.length === loaded.records.length) return { ok: false, code: 'INTENT_NOT_FOUND' }
  const previous = loaded.records
  if (!writeRecords(next)) {
    storage.set(STORE_KEY, previous)
    return { ok: false, code: 'STORAGE_WRITE_FAILED' }
  }
  return { ok: true }
}

function markSettled(intent, ownerIdentity) {
  return removeMatching(intent, ownerIdentity)
}

function clear(intent, ownerIdentity) {
  return removeMatching(intent, ownerIdentity)
}

module.exports = {
  STORE_KEY,
  INTENT_HEADER,
  PROOF_HEADER,
  prepare,
  markSettled,
  clear,
}
