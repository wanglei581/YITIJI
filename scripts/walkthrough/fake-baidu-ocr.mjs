#!/usr/bin/env node
// ============================================================
// 走查用假百度 OCR。只用于本机全链路走查，不得用于任何部署环境。
//
//   node scripts/walkthrough/fake-baidu-ocr.mjs
//   API 侧：BAIDU_OCR_BASE_URL=http://127.0.0.1:4341  BAIDU_OCR_API_KEY=任意  BAIDU_OCR_SECRET_KEY=任意
//
// 对齐 services/api/src/ai/resume/ocr/baidu-ocr.provider.ts 实际调用的两个端点（全仓只有这两个）：
//   POST /oauth/2.0/token?grant_type=client_credentials&client_id=..&client_secret=..
//        → { access_token, expires_in, ... }
//   POST /rest/2.0/ocr/v1/accurate_basic?access_token=..   表单 image=<base64>&probability=true
//        → { words_result:[{ words, probability:{ average, min, variance } }], words_result_num, log_id }
// （ASR 的换 token 也走同一个 /oauth/2.0/token，这里一并能答；ASR 识别端点不在本假服务范围内。）
//
// 模式：${FAKE_OCR_STATE_DIR:-~/.cache/walk0929/fake-ocr}/mode，逐请求读取：
//   ok | lowconf（average 0.4）| empty（0 行）| error（=error17）| error17（日配额用尽）
//   | error18（QPS 超限）| timeout（挂住 200 秒）
// 同目录放 text.txt 可替换默认识别文本（每行一条）。
// 请求逐行记到 requests.jsonl（不记图片内容，只记字节数）。
// ============================================================

import { createServer } from 'node:http'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const PORT = Number(process.env.FAKE_OCR_PORT || 4341)
const STATE_DIR = process.env.FAKE_OCR_STATE_DIR || join(homedir(), '.cache', 'walk0929', 'fake-ocr')
const MODES = new Set(['ok', 'lowconf', 'empty', 'error', 'error17', 'error18', 'timeout'])
const HANG_MS = 200_000

mkdirSync(STATE_DIR, { recursive: true })
const LOG_FILE = join(STATE_DIR, 'requests.jsonl')

/** 走查测试简历：虚构人物、测试号段，不对应任何真实个人。 */
const DEFAULT_LINES = [
  '个人简历',
  '姓名：测试·张建国',
  '性别：男    年龄：45岁',
  '联系电话：13800000001',
  '电子邮箱：walk.test.zhang@example.com',
  '现居城市：山东省青岛市',
  '求职意向',
  '意向岗位：仓库管理员',
  '期望城市：青岛',
  '教育经历',
  '1996.09-1999.07  青岛市测试职业中等专业学校  机电技术应用  中专',
  '工作经历',
  '2016.03-2025.12  青岛测试机械制造有限公司  装配车间班组长',
  '负责装配车间12人班组的日常排班和生产进度跟踪',
  '带领班组完成新产线的设备调试与试生产',
  '推行工位5S现场管理，车间物料摆放更加规范',
  '2002.07-2016.02  青岛测试五金厂  装配工',
  '从事五金配件装配和成品检验工作',
  '熟悉来料检验、首件检验和巡检流程',
  '技能与证书',
  '叉车操作证、低压电工作业证',
  '会用Excel整理生产日报表',
  '熟悉ERP系统的出入库操作',
  '自我评价',
  '工作踏实肯干，有多年一线生产和班组管理经验',
  '愿意学习新设备和新系统，能接受倒班',
]

function readMode() {
  try {
    const raw = readFileSync(join(STATE_DIR, 'mode'), 'utf8').trim()
    return MODES.has(raw) ? raw : 'ok'
  } catch {
    return 'ok'
  }
}

function readLines() {
  try {
    const lines = readFileSync(join(STATE_DIR, 'text.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    return lines.length > 0 ? lines : DEFAULT_LINES
  } catch {
    return DEFAULT_LINES
  }
}

function shanghaiIso(date = new Date()) {
  return new Date(date.getTime() + 8 * 3600_000).toISOString().replace('Z', '+08:00')
}

function log(entry) {
  try {
    appendFileSync(LOG_FILE, `${JSON.stringify({ time: shanghaiIso(), ...entry })}\n`)
  } catch (error) {
    process.stderr.write(`[fake-ocr] 写日志失败: ${error.message}\n`)
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const logId = () => Number(BigInt(`0x${randomBytes(6).toString('hex')}`))

/** 确定性伪随机（按行号），让同一份文本每次得到同样的置信度。 */
function probabilityFor(index, low) {
  if (low) {
    const avg = 0.36 + ((index * 7) % 9) / 100 // 0.36–0.44，均值约 0.4
    return { average: Number(avg.toFixed(4)), min: Number((avg - 0.12).toFixed(4)), variance: 0.0213 }
  }
  const avg = 0.9 + ((index * 37) % 10) / 100 // 0.90–0.99
  return { average: Number(avg.toFixed(4)), min: Number((avg - 0.08).toFixed(4)), variance: 0.0012 }
}

const TOKENS = new Set()

function handleToken(url, res) {
  const clientId = url.searchParams.get('client_id')
  const clientSecret = url.searchParams.get('client_secret')
  if (url.searchParams.get('grant_type') !== 'client_credentials' || !clientId || !clientSecret) {
    log({ endpoint: 'token', outcome: 'invalid_client' })
    return sendJson(res, 401, { error: 'invalid_client', error_description: 'unknown client id' })
  }
  const token = `24.walk${randomBytes(12).toString('hex')}.2592000.fake`
  TOKENS.add(token)
  log({ endpoint: 'token', outcome: 'ok' })
  return sendJson(res, 200, {
    refresh_token: `25.walk${randomBytes(12).toString('hex')}.315360000.fake`,
    expires_in: 2592000,
    session_key: 'walk-fake-session',
    access_token: token,
    scope: 'public brain_all_scope brain_ocr_accurate_basic',
    session_secret: 'walk-fake-secret',
  })
}

async function handleOcr(url, req, res) {
  const form = new URLSearchParams(await readBody(req))
  const image = form.get('image') ?? form.get('pdf_file') ?? ''
  const imageBytes = image ? Buffer.from(image, 'base64').length : 0
  const mode = readMode()
  const entry = { endpoint: 'accurate_basic', mode, imageBytes, probability: form.get('probability') === 'true' }

  const token = url.searchParams.get('access_token')
  if (!token) {
    log({ ...entry, outcome: 'no_token' })
    return sendJson(res, 200, { error_code: 110, error_msg: 'Access token invalid or no longer valid', log_id: logId() })
  }
  if (!TOKENS.has(token)) {
    // 假服务重启后旧 token 失效：按百度口径回 111，provider 会作废缓存重新换一次。
    log({ ...entry, outcome: 'token_expired' })
    return sendJson(res, 200, { error_code: 111, error_msg: 'Access token expired', log_id: logId() })
  }
  if (mode === 'timeout') {
    log({ ...entry, outcome: 'hang' })
    const timer = setTimeout(() => res.destroy(), HANG_MS)
    res.on('close', () => clearTimeout(timer))
    return
  }
  if (mode === 'error' || mode === 'error17') {
    log({ ...entry, outcome: 'error17' })
    return sendJson(res, 200, { error_code: 17, error_msg: 'Open api daily request limit reached', log_id: logId() })
  }
  if (mode === 'error18') {
    log({ ...entry, outcome: 'error18' })
    return sendJson(res, 200, { error_code: 18, error_msg: 'Open api qps request limit reached', log_id: logId() })
  }
  if (imageBytes === 0) {
    log({ ...entry, outcome: 'empty_image' })
    return sendJson(res, 200, { error_code: 216200, error_msg: 'empty image', log_id: logId() })
  }
  if (mode === 'empty') {
    log({ ...entry, outcome: 'empty', lines: 0 })
    return sendJson(res, 200, { words_result: [], words_result_num: 0, log_id: logId() })
  }
  const low = mode === 'lowconf'
  const lines = readLines()
  const words = lines.map((words, i) => ({ words, ...(entry.probability ? { probability: probabilityFor(i, low) } : {}) }))
  log({ ...entry, outcome: low ? 'lowconf' : 'ok', lines: words.length })
  return sendJson(res, 200, { words_result: words, words_result_num: words.length, direction: 0, log_id: logId() })
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true, mode: readMode() })
  if (req.method === 'POST' && url.pathname === '/oauth/2.0/token') return handleToken(url, res)
  if (req.method === 'POST' && url.pathname === '/rest/2.0/ocr/v1/accurate_basic') {
    handleOcr(url, req, res).catch((error) => {
      log({ endpoint: 'accurate_basic', outcome: 'handler_error', error: String(error?.message ?? error) })
      if (!res.headersSent) sendJson(res, 500, { error_code: 282000, error_msg: 'internal error' })
    })
    return
  }
  log({ endpoint: url.pathname, outcome: 'unsupported' })
  return sendJson(res, 404, { error_code: 3, error_msg: 'Unsupported openapi method' })
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`[fake-ocr] 走查假百度 OCR 已启动 http://127.0.0.1:${PORT}  状态目录 ${STATE_DIR}  当前模式 ${readMode()}\n`)
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.closeAllConnections()
    server.close(() => process.exit(0))
  })
}
