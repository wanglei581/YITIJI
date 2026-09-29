/**
 * 对时钟偏移的 API（默认 4301）做一小套正常接口回放。
 * 不打印终端令牌、会话令牌、绑定码、短信验证码、JWT、签名 URL。
 *
 * 用法：
 *   node clock-shift-replay.mjs
 * 环境：
 *   WALK_API=http://127.0.0.1:4301/api/v1
 *   SIM_AGENT_DIR=~/.cache/walk0929/sim-agent-099
 *   WALK_PHONE=13800000991
 *   WALK_EVIDENCE_DIR=~/.cache/walk0929/evidence/d3-clock
 */
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const API = (process.env.WALK_API ?? 'http://127.0.0.1:4301/api/v1').replace(/\/$/, '')
const AGENT_DIR = process.env.SIM_AGENT_DIR ?? join(homedir(), '.cache/walk0929/sim-agent-099')
const PHONE = process.env.WALK_PHONE ?? '13800000991'
const LOG = process.env.WALK_API_LOG ?? join(homedir(), '.cache/walk0929/logs/api-4301.log')
const EVIDENCE = process.env.WALK_EVIDENCE_DIR ?? join(homedir(), '.cache/walk0929/evidence/d3-clock')
const FILE_NAME = '示例-时钟验证.pdf'

function maskPhone(phone) {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

function redact(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[jwt]')
    .replace(/(sig|token|bootTicket|bindCode|authorization|terminalToken|sessionToken|accessToken|paymentSessionToken)=([^&\s"]+)/gi, '$1=[redacted]')
    .replace(/("(?:token|bootTicket|bindCode|signedUrl|authorization|terminalToken|sessionToken|accessToken|paymentSessionToken|code|password|sig)"\s*:\s*")[^"]*/gi, '$1[redacted]')
    .replace(/验证码:\s*\d{4,8}/g, '验证码: [redacted]')
    .replace(/1[3-9]\d{9}/g, (m) => maskPhone(m))
}

async function api(path, { method = 'GET', headers = {}, body, form } = {}) {
  const init = { method, headers: { ...headers } }
  if (form) init.body = form
  else if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`${API}${path}`, init)
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status} ${redact(text).slice(0, 800)}`)
    err.status = res.status
    err.body = json
    throw err
  }
  return json
}

function dataOf(payload) {
  if (payload && typeof payload === 'object' && payload.success === true && 'data' in payload) return payload.data
  return payload
}

function minimalPdf(text) {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET\n`
  const objects = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n',
    '2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n',
    `4 0 obj<</Length ${Buffer.byteLength(stream)}>>stream\n${stream}endstream\nendobj\n`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body))
    body += obj
  }
  const xrefAt = Buffer.byteLength(body)
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`
  return Buffer.from(body + xref + trailer)
}

function loadCredential() {
  const raw = JSON.parse(readFileSync(join(AGENT_DIR, 'credential.json'), 'utf8'))
  for (const key of ['terminalId', 'terminalCode', 'terminalToken', 'apiBaseUrl']) {
    if (typeof raw[key] !== 'string' || !raw[key].trim()) throw new Error(`凭证缺少 ${key}`)
  }
  return raw
}

function psql(sql) {
  return execFileSync('psql', [
    '-h', '127.0.0.1', '-p', '4332', '-U', 'walk', '-d', 'walk_dev_0929',
    '-v', 'ON_ERROR_STOP=1', '-X', '-A', '-F', '\t', '-c', sql,
  ], { encoding: 'utf8' })
}

function jwtTimes(token) {
  const part = String(token).split('.')[1] ?? ''
  const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
  return {
    iat: payload.iat ?? null,
    exp: payload.exp ?? null,
    iatIso: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
    expIso: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
    aud: payload.aud ?? null,
  }
}

function readSmsCode(sinceBytes) {
  const text = readFileSync(LOG, 'utf8')
  const fresh = text.slice(sinceBytes)
  const masked = maskPhone(PHONE)
  const re = new RegExp(`${masked.replace(/\*/g, '\\*')} 验证码: (\\d{6})`, 'g')
  let code = null
  for (const match of fresh.matchAll(re)) code = match[1]
  if (!code) throw new Error(`4301 日志里没有 ${masked} 的新验证码`)
  return code
}

const PRINT_PARAMS = {
  copies: 1,
  colorMode: 'black_white',
  duplex: 'simplex',
  paperSize: 'A4',
  orientation: 'portrait',
  quality: 'standard',
  scale: 'fit',
  pagesPerSheet: 1,
}

async function main() {
  mkdirSync(EVIDENCE, { recursive: true })
  const realStart = new Date().toISOString()
  const health = dataOf(await api('/health'))
  const shiftedNow = health.time
  const credential = loadCredential()
  if (!credential.apiBaseUrl.startsWith('http://127.0.0.1:4301/')) {
    throw new Error(`模拟终端凭证指向的不是 4301（${credential.apiBaseUrl}），拒绝继续`)
  }

  const boot = await api('/terminals/boot-ticket', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credential.terminalToken}`,
      'x-terminal-id': credential.terminalId,
    },
  })
  const session = await api('/terminals/session-token', {
    method: 'POST',
    body: { bootTicket: boot.bootTicket },
  })
  const terminalHeaders = {
    'x-terminal-id': credential.terminalId,
    'x-terminal-session-token': session.sessionToken,
  }

  const clientSessionId = randomUUID()
  const started = dataOf(await api('/kiosk/session/start', {
    method: 'POST',
    headers: terminalHeaders,
    body: { clientSessionId, wokeAt: shiftedNow, category: 'print' },
  }))

  const pdf = minimalPdf('Clock sample only')
  const form = new FormData()
  form.append('purpose', 'print_doc')
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), FILE_NAME)
  const uploaded = dataOf(await api('/files/kiosk-upload', { method: 'POST', form }))
  const sha256 = createHash('sha256').update(pdf).digest('hex')
  if (uploaded.sha256 !== sha256) throw new Error('上传响应的 sha256 与本地文件不一致')

  let material = dataOf(await api('/materials/tasks', {
    method: 'POST',
    body: { kind: 'pii_scan', sourceFileId: uploaded.fileId },
  }))
  const pending = (material.piiFindings ?? []).filter((item) => item.action === 'pending')
  if (pending.length > 0) {
    material = dataOf(await api(`/materials/tasks/${material.id}/pii-findings/decisions`, {
      method: 'POST',
      headers: { 'x-material-task-token': material.accessToken },
      body: { decisions: pending.map((item) => ({ findingId: item.id, action: 'keep' })) },
    }))
  }

  const quote = await api('/orders/quote', {
    method: 'POST',
    body: { fileUrl: uploaded.signedUrl, terminalId: credential.terminalId, params: PRINT_PARAMS },
  })
  const created = await api('/print/jobs', {
    method: 'POST',
    headers: terminalHeaders,
    body: {
      fileUrl: uploaded.signedUrl,
      fileMd5: uploaded.sha256,
      fileName: FILE_NAME,
      params: PRINT_PARAMS,
      quotedAmountCents: quote.amountCents,
    },
  })

  let lastStatus = null
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    lastStatus = await api(`/print/jobs/${created.taskId}`)
    if (lastStatus.status === 'completed' || lastStatus.status === 'failed' || lastStatus.status === 'cancelled') break
    await new Promise((resolve) => setTimeout(resolve, 400))
  }

  const ended = dataOf(await api('/kiosk/session/end', {
    method: 'POST',
    headers: terminalHeaders,
    body: { clientSessionId, endedAt: shiftedNow, endReason: 'user_exit' },
  }))

  const logBytes = readFileSync(LOG).byteLength
  const sms = dataOf(await api('/member/auth/sms-code', {
    method: 'POST',
    body: { phone: PHONE, deviceId: 'clock-shift-replay' },
  }))
  const code = readSmsCode(logBytes)
  const terms = dataOf(await api('/kiosk/legal/terms_of_service')).version
  const privacy = dataOf(await api('/kiosk/legal/privacy_policy')).version
  const login = dataOf(await api('/member/auth/login', {
    method: 'POST',
    body: { phone: PHONE, code, termsVersion: terms, privacyVersion: privacy, deviceId: 'clock-shift-replay' },
  }))
  const jwt = jwtTimes(login.token)

  const queries = {
    order: `SELECT "orderNo","payStatus","amountCents","createdAt","paidAt","updatedAt" FROM "Order" WHERE id = '${created.orderId}';`,
    task: `SELECT status,"errorCode","createdAt","updatedAt","claimedAt","claimExpiry","completedAt" FROM "PrintTask" WHERE id = '${created.taskId}';`,
    file: `SELECT purpose,"retentionPolicy","createdAt","updatedAt","expiresAt","deletedAt" FROM "FileObject" WHERE id = '${uploaded.fileId}';`,
    kiosk: `SELECT "startedAt","lastActiveAt","endedAt","expiresAt","createdAt","updatedAt","isExpired" FROM "KioskSession" WHERE "clientSessionId" = '${clientSessionId}';`,
    material: `SELECT kind,status,"createdAt","updatedAt","expiresAt" FROM "DocumentProcessTask" WHERE id = '${material.id}';`,
    audit: `SELECT action,"targetType","createdAt" FROM "AuditLog" WHERE "targetId" IN ('${uploaded.fileId}','${created.taskId}','${created.orderId}') ORDER BY "createdAt";`,
    terminal: `SELECT "terminalCode","lifecycleStatus","registeredAt","createdAt","updatedAt","lastSeenAt" FROM "Terminal" WHERE id = '${credential.terminalId}';`,
    credential: `SELECT "issuedAt","expiresAt","createdAt","updatedAt","revokedAt" FROM "TerminalCredential" WHERE "terminalId" = '${credential.terminalId}' ORDER BY "createdAt";`,
    heartbeat: `SELECT "createdAt","printerStatus" FROM "TerminalHeartbeat" WHERE "terminalId" = '${credential.terminalId}' ORDER BY "createdAt" DESC LIMIT 3;`,
    dbNow: 'SELECT now();',
  }
  const tables = {}
  for (const [name, statement] of Object.entries(queries)) {
    try {
      tables[name] = psql(statement).trim()
    } catch (error) {
      tables[name] = `ERROR ${redact(error.stderr?.toString?.() || error.message)}`
    }
  }

  const defaults = psql(`
    SELECT table_name || '.' || column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_default IS NOT NULL
      AND (column_default ILIKE '%now()%' OR column_default ILIKE '%current_timestamp%')
    ORDER BY 1;
  `).trim().split('\n').slice(1).filter(Boolean)

  const result = {
    realStart,
    realEnd: new Date().toISOString(),
    apiHealth: { status: health.status, db: health.db, time: health.time },
    terminalCode: credential.terminalCode,
    clientSessionId,
    kioskStartRecorded: started.recorded ?? started,
    kioskEndRecorded: ended.recorded ?? ended,
    file: {
      fileId: uploaded.fileId,
      sha256Prefix: uploaded.sha256.slice(0, 12),
      signedUrlExpiresAt: uploaded.signedUrlExpiresAt,
      signedUrlHostless: String(uploaded.signedUrl).startsWith('/'),
    },
    material: {
      id: material.id,
      status: material.status,
      pendingAfter: (material.piiFindings ?? []).filter((item) => item.action === 'pending').length,
      createdAt: material.createdAt,
      expiresAt: material.expiresAt,
    },
    quote: { amountCents: quote.amountCents, billablePages: quote.billablePages },
    job: {
      taskId: created.taskId,
      orderId: created.orderId,
      orderNo: created.orderNo,
      createStatus: created.status,
      createCreatedAt: created.createdAt,
      payStatus: created.payStatus,
      amountCents: created.amountCents,
      final: lastStatus && {
        status: lastStatus.status,
        errorCode: lastStatus.errorCode ?? null,
        completedAt: lastStatus.completedAt ?? null,
        fileExpiresAt: lastStatus.fileExpiresAt ?? null,
        fileDeletedAt: lastStatus.fileDeletedAt ?? null,
      },
    },
    sms: { sent: sms.sent, expiresInSeconds: sms.expiresInSeconds, phoneMasked: maskPhone(PHONE) },
    login: {
      phoneMasked: login.user?.phoneMasked ?? null,
      userId: login.user?.id ?? null,
      jwt,
      realNowIso: new Date().toISOString(),
    },
    timestamps: tables,
    dbDefaultNowColumns: defaults,
  }
  const out = join(EVIDENCE, 'replay-result.json')
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`${JSON.stringify({
    ok: true,
    orderNo: result.job.orderNo,
    taskStatus: result.job.final?.status ?? null,
    errorCode: result.job.final?.errorCode ?? null,
    healthTime: result.apiHealth.time,
    createCreatedAt: result.job.createCreatedAt,
    jwtIat: jwt.iatIso,
    jwtExp: jwt.expIso,
    fileExpiresAt: result.job.final?.fileExpiresAt ?? null,
    evidence: out,
  }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${redact(error.stack || error.message)}\n`)
  process.exit(1)
})
