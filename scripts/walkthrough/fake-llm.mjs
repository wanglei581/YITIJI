#!/usr/bin/env node
// ============================================================
// 走查用假模型服务（OpenAI 兼容 Chat Completions）。只用于本机全链路走查，
// 不得用于任何部署环境，也不得把它的输出当作真实 AI 能力的证据。
//
//   node scripts/walkthrough/fake-llm.mjs
//
// 端口：FAKE_LLM_PORT（默认 4340），只监听 127.0.0.1。
// 端点：POST /v1/chat/completions（以及任何以 /chat/completions 结尾的路径）、GET /v1/models。
// 鉴权：必须带 `Authorization: Bearer <非空>`，否则 401（OpenAI 错误体）。
//
// 故障模式（两种控制方式，逐请求读取）：
//   1. 状态文件 ${FAKE_LLM_STATE_DIR:-~/.cache/walk0929/fake-llm}/mode，内容为下列之一：
//      ok | timeout | http500 | badjson | blocked | slow
//   2. 请求任意消息里带标记【走查故障:timeout】（冒号全角半角都认），只影响这一次请求，
//      优先级高于状态文件 —— 方便测试者直接在自由文本框里输入。
//   timeout = 挂住连接 200 秒不回；http500 = 500 + OpenAI 错误体；
//   badjson = 200 但内容不是合法 JSON（纯文本功能则回空内容）；
//   blocked = 400 + 内容安全拦截错误体（DashScope / DeepSeek 风格）；slow = 25 秒后正常回。
//
// 每个请求写一行 JSON 到 ${FAKE_LLM_STATE_DIR}/requests.jsonl（上海时间、识别出的功能、
// 模型、模式、prompt 字数、最后一条 user 消息前 200 字 —— 供协调方检查 PII 遮盖）。
// ============================================================

import { createServer } from 'node:http'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { TEXT_FEATURES, badContent, detectFeature, generateContent } from './fake-llm-features.mjs'

const PORT = Number(process.env.FAKE_LLM_PORT || 4340)
const STATE_DIR = process.env.FAKE_LLM_STATE_DIR || join(homedir(), '.cache', 'walk0929', 'fake-llm')
const MODES = new Set(['ok', 'timeout', 'http500', 'badjson', 'blocked', 'slow'])
const HANG_MS = 200_000
const SLOW_MS = 25_000
const MARKER_RE = /【走查故障[:：]\s*(ok|timeout|http500|badjson|blocked|slow)\s*】/

mkdirSync(STATE_DIR, { recursive: true })
const LOG_FILE = join(STATE_DIR, 'requests.jsonl')

function readFileMode() {
  try {
    const raw = readFileSync(join(STATE_DIR, 'mode'), 'utf8').trim()
    return MODES.has(raw) ? raw : 'ok'
  } catch {
    return 'ok'
  }
}

/** 上海时间 ISO（带 +08:00），不依赖系统时区设置。 */
function shanghaiIso(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 3600_000)
  return shifted.toISOString().replace('Z', '+08:00')
}

function log(entry) {
  try {
    appendFileSync(LOG_FILE, `${JSON.stringify({ time: shanghaiIso(), ...entry })}\n`)
  } catch (error) {
    process.stderr.write(`[fake-llm] 写日志失败: ${error.message}\n`)
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

function openAiError(res, status, message, type, code) {
  sendJson(res, status, { error: { message, type, param: null, code } })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const contentText = (content) => (typeof content === 'string'
  ? content
  : Array.isArray(content) ? content.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('') : '')

/** 粗略 token 估算：中文约 1 字 0.7 token，够走查看成本落账是否非零即可。 */
const tokensOf = (chars) => Math.max(1, Math.ceil(chars * 0.7))

function completionBody(model, content, promptChars) {
  const promptTokens = tokensOf(promptChars)
  const completionTokens = tokensOf(content.length)
  return {
    id: `chatcmpl-walk-${randomBytes(8).toString('hex')}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    system_fingerprint: 'fake-walkthrough',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  }
}

/** stream:true 的最小实现（目前 services/api 没有调用方用流式，留作兼容）。 */
function sendStream(res, model, content, promptChars) {
  const id = `chatcmpl-walk-${randomBytes(8).toString('hex')}`
  const created = Math.floor(Date.now() / 1000)
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const chunk = (delta, finish = null, extra = {}) => res.write(`data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra,
  })}\n\n`)
  chunk({ role: 'assistant', content: '' })
  for (let i = 0; i < content.length; i += 24) chunk({ content: content.slice(i, i + 24) })
  const usage = completionBody(model, content, promptChars).usage
  chunk({}, 'stop', { usage })
  res.write('data: [DONE]\n\n')
  res.end()
}

async function handleChat(req, res, path) {
  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    return openAiError(res, 400, 'We could not parse the JSON body of your request.', 'invalid_request_error', 'invalid_json')
  }
  const messages = Array.isArray(body?.messages) ? body.messages : []
  if (messages.length === 0) {
    return openAiError(res, 400, "'messages' must be a non-empty array.", 'invalid_request_error', 'invalid_messages')
  }
  const model = typeof body.model === 'string' && body.model ? body.model : 'fake-walkthrough'
  const system = messages.filter((m) => m?.role === 'system').map((m) => contentText(m.content)).join('\n')
  const userMessages = messages.filter((m) => m?.role === 'user').map((m) => contentText(m.content))
  const lastUser = userMessages[userMessages.length - 1] ?? ''
  const allText = messages.map((m) => contentText(m?.content)).join('\n')
  const promptChars = allText.length
  const feature = detectFeature(system)

  const marker = allText.match(MARKER_RE)?.[1]
  const mode = marker ?? readFileMode()
  const entry = {
    feature, model, mode, modeSource: marker ? 'marker' : 'file', path, stream: body.stream === true,
    promptChars, lastUser200: lastUser.slice(0, 200),
  }

  if (mode === 'timeout') {
    log({ ...entry, outcome: 'hang' })
    const timer = setTimeout(() => res.destroy(), HANG_MS)
    res.on('close', () => clearTimeout(timer))
    return
  }
  if (mode === 'http500') {
    log({ ...entry, outcome: 'http500' })
    return openAiError(res, 500, '走查故障模拟：The server had an error while processing your request.', 'server_error', 'internal_error')
  }
  if (mode === 'blocked') {
    log({ ...entry, outcome: 'blocked' })
    return sendJson(res, 400, {
      error: { code: 'data_inspection_failed', message: 'Output data may contain inappropriate content.', type: 'data_inspection_failed', param: null },
      request_id: `walk-${randomBytes(6).toString('hex')}`,
    })
  }
  if (mode === 'slow') await new Promise((r) => setTimeout(r, SLOW_MS))
  // 注意不能看 req.destroyed：请求体读完后 IncomingMessage 会自动销毁，那不代表客户端走了。
  if (res.destroyed || !res.socket || res.socket.destroyed) {
    log({ ...entry, outcome: 'client_gone' })
    return
  }

  let content
  try {
    content = mode === 'badjson' ? badContent(feature) : generateContent(feature, { system, user: lastUser, messages, body })
  } catch (error) {
    // 生成器自己出错属于假模型的 bug：如实回 500，并把错误写进日志供排查。
    log({ ...entry, outcome: 'generator_error', error: String(error?.stack ?? error).slice(0, 500) })
    return openAiError(res, 500, `fake-llm generator error: ${error?.message ?? error}`, 'server_error', 'fake_generator_error')
  }
  log({ ...entry, outcome: mode === 'badjson' ? 'badjson' : 'ok', textFeature: TEXT_FEATURES.has(feature), contentChars: content.length })
  if (body.stream === true) return sendStream(res, model, content, promptChars)
  return sendJson(res, 200, completionBody(model, content, promptChars))
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const auth = req.headers.authorization ?? ''
  const bearer = /^Bearer\s+(\S+)/i.exec(auth)?.[1]
  if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true, mode: readFileMode() })
  if (!bearer) {
    log({ feature: 'auth', path: url.pathname, outcome: 'unauthorized' })
    return openAiError(res, 401, 'Incorrect API key provided. You can find your API key at the provider console.', 'invalid_request_error', 'invalid_api_key')
  }
  if (req.method === 'GET' && /\/models\/?$/.test(url.pathname)) {
    const created = Math.floor(Date.now() / 1000)
    return sendJson(res, 200, {
      object: 'list',
      data: ['deepseek-v4-flash', 'deepseek-v4-pro', 'qwen-plus', 'fake-walkthrough'].map((id) => ({ id, object: 'model', created, owned_by: 'fake-walkthrough' })),
    })
  }
  if (req.method === 'POST' && /\/chat\/completions\/?$/.test(url.pathname)) {
    handleChat(req, res, url.pathname).catch((error) => {
      log({ feature: 'unknown', path: url.pathname, outcome: 'handler_error', error: String(error?.message ?? error) })
      if (!res.headersSent) openAiError(res, 500, 'fake-llm handler error', 'server_error', 'fake_handler_error')
    })
    return
  }
  return openAiError(res, 404, `Unknown path ${url.pathname}`, 'invalid_request_error', 'unknown_url')
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`[fake-llm] 走查假模型已启动 http://127.0.0.1:${PORT}/v1  状态目录 ${STATE_DIR}  当前模式 ${readFileMode()}\n`)
})
// timeout 模式会挂住连接，退出时要主动断掉，否则 close 要等 200 秒。
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.closeAllConnections()
    server.close(() => process.exit(0))
  })
}
