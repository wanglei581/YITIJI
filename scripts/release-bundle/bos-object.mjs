#!/usr/bin/env node
// Baidu BOS BCE authentication v1. Algorithm source: Baidu Cloud BOS API
// authentication documentation (bce-auth-v1 canonical request signing).
// This client intentionally uses only Node.js built-ins so it can run before
// package installation in CI and on the production host.

import { createHmac } from 'node:crypto'
import { createReadStream, createWriteStream, statSync } from 'node:fs'
import { mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { PassThrough, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const DEFAULT_ENDPOINT = 'bj.bcebos.com'
const DEFAULT_BUCKET = 'ai-job-print-release'
const AUTH_EXPIRE_SECONDS = 1800
const REQUEST_TIMEOUT_MS = 60_000
const ERROR_BODY_MAX_BYTES = 2048
const ERROR_BODY_MAX_MS = 3000
const SKEW_WARN_SECONDS = 15 * 60
const CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

export function canonicalUriForKey(key) {
  if (!key || key.startsWith('/') || key.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('BOS key must be a non-empty relative path without dot segments')
  }
  return `/${key.split('/').map(encodeRfc3986).join('/')}`
}

function canonicalHeaders(headers, signedHeaderNames) {
  return signedHeaderNames
    .map((name) => {
      const value = headers[name]
      if (value === undefined) throw new Error(`missing signed header: ${name}`)
      return `${encodeRfc3986(name)}:${encodeRfc3986(String(value).trim().replace(/\s+/g, ' '))}`
    })
    .join('\n')
}

function hmacSha256(key, value, encoding) {
  return createHmac('sha256', key).update(value).digest(encoding)
}

/** Creates a BCE v1 Authorization header without exposing secret values. */
export function createAuthorization({ accessKey, secretKey, method, host, canonicalUri, date, expireSeconds = AUTH_EXPIRE_SECONDS }) {
  const signedHeaders = ['host', 'x-bce-date']
  const authStringPrefix = `bce-auth-v1/${accessKey}/${date}/${expireSeconds}`
  const headers = { host, 'x-bce-date': date }
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    '',
    canonicalHeaders(headers, signedHeaders),
  ].join('\n')
  // BCE 认证 v1：SigningKey 是 HMAC-SHA256(sk, authStringPrefix) 的**十六进制字符串**，
  // 再以该字符串（不是原始字节）作为密钥对 CanonicalRequest 做 HMAC。传原始 Buffer 会得到
  // 一个稳定但错误的签名（服务端回 SignatureDoesNotMatch），2026-09-07 生产首次接入实测踩坑。
  const signingKey = hmacSha256(secretKey, authStringPrefix, 'hex')
  const signature = hmacSha256(signingKey, canonicalRequest, 'hex')
  return `${authStringPrefix}/${signedHeaders.join(';')}/${signature}`
}

function readConfig(missingExitCode = 2) {
  const accessKey = process.env.BOS_RELEASE_ACCESS_KEY
  const secretKey = process.env.BOS_RELEASE_SECRET_KEY
  if (!accessKey || !secretKey) {
    console.error('BOS credentials are not configured')
    process.exit(missingExitCode)
  }

  const scheme = process.env.BOS_RELEASE_SCHEME || 'https'
  if (scheme !== 'https' && scheme !== 'http') throw new Error('BOS_RELEASE_SCHEME must be https or http')
  const endpoint = process.env.BOS_RELEASE_ENDPOINT || DEFAULT_ENDPOINT
  const bucket = process.env.BOS_RELEASE_BUCKET || DEFAULT_BUCKET
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(bucket)) throw new Error('BOS_RELEASE_BUCKET is invalid')
  return { accessKey, secretKey, scheme, endpoint, bucket }
}

function bceDate(now = new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function requestForKey(method, key, config) {
  const canonicalUri = canonicalUriForKey(key)
  const objectHost = `${config.bucket}.${config.endpoint}`
  const endpointUrl = new URL(`${config.scheme}://${config.endpoint}`)
  const date = bceDate()
  const authorization = createAuthorization({
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    method,
    host: objectHost,
    canonicalUri,
    date,
  })
  return {
    transport: endpointUrl.protocol === 'https:' ? https : http,
    options: {
      method,
      // 真实 BOS 走虚拟主机域名（bucket.endpoint），TLS SNI 与 Host 一致；http 仅供本地桩测试，桩监听的是 endpoint 本身。
      hostname: endpointUrl.protocol === 'https:' ? objectHost : endpointUrl.hostname,
      port: endpointUrl.port || undefined,
      path: canonicalUri,
      headers: { host: objectHost, 'x-bce-date': date, Authorization: authorization },
      timeout: REQUEST_TIMEOUT_MS,
    },
  }
}

function safeToken(value, pattern) {
  const text = value
  return typeof text === 'string' && text.match(pattern)?.[0] === text ? text : ''
}

// 只解析完整 JSON 的 code。不合字符集、超长、截断或非 JSON 都不带 code。
// message 不读取进错误文本（可能含桶名以外的细节）。
function fieldsFromBody(body) {
  if (!body || body.length === 0) return { code: '', requestId: '' }
  try {
    const parsed = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { code: '', requestId: '' }
    return {
      code: safeToken(parsed.code, CODE_PATTERN),
      requestId: safeToken(parsed.requestId, REQUEST_ID_PATTERN),
    }
  } catch {
    return { code: '', requestId: '' }
  }
}

function bosFailure({ method, key, status, headers, body }) {
  const fromBody = fieldsFromBody(body)
  const requestId = safeToken(headers?.['x-bce-request-id'], REQUEST_ID_PATTERN) || fromBody.requestId
  const code = fromBody.code
  const error = new Error(
    `BOS ${method} failed for ${key}: HTTP ${status}${code ? ` code=${code}` : ''}${requestId ? ` requestId=${requestId}` : ''}`,
  )
  error.statusCode = status
  error.bosCode = code
  error.requestId = requestId
  error.headers = headers || {}
  return error
}

// 失败响应只取前 2048 字节，最多等 3 秒。读体失败或超时仍抛原来的 HTTP 错误。
function readErrorBody(response) {
  return new Promise((resolve) => {
    const chunks = []
    let received = 0
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      response.removeListener('data', onData)
      response.removeListener('end', onEnd)
      response.removeListener('error', onError)
      response.removeListener('aborted', onError)
      response.removeListener('close', onError)
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), ERROR_BODY_MAX_MS)
    const onData = (chunk) => {
      const room = ERROR_BODY_MAX_BYTES - received
      if (chunk.length > room) {
        finish(null)
        return
      }
      chunks.push(chunk)
      received += chunk.length
    }
    const onEnd = () => finish(Buffer.concat(chunks, received))
    const onError = () => finish(null)
    response.on('data', onData)
    response.on('end', onEnd)
    response.on('error', onError)
    response.on('aborted', onError)
    response.on('close', onError)
  })
}

async function responseStatus(response, key, method) {
  if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) return
  const status = response.statusCode || 0
  let body = null
  try {
    body = await readErrorBody(response)
  } catch {
    body = null
  }
  throw bosFailure({ method, key, status, headers: response.headers, body })
}

function consumeResponse(response, meta, finish) {
  response.on('error', (error) => finish(error))
  response.on('end', () => finish(null, meta))
  response.resume()
}

function sendRequest(method, key, config, { inputFile, onResponse } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    let pendingHttpFailure = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(value)
    }
    const { transport, options } = requestForKey(method, key, config)
    if (inputFile) options.headers['content-length'] = String(statSync(inputFile).size)
    const request = transport.request(options, (response) => {
      // 保持 error 监听到请求销毁，避免失败响应中断变成未处理事件。
      response.on('error', () => {})
      const meta = { statusCode: response.statusCode || 0, headers: response.headers }
      pendingHttpFailure = meta.statusCode < 200 || meta.statusCode >= 300
      responseStatus(response, key, method).then(() => onResponse(response, meta, finish)).catch((error) => {
        finish(error)
        request.destroy()
      })
    })
    request.on('timeout', () => {
      const error = new Error('BOS request timed out after 60s')
      error.statusCode = 0
      request.destroy()
      finish(error)
    })
    request.on('error', (error) => {
      // 已有 HTTP 失败时，以有界读体后的 HTTP 错误为准，不能被连接中断覆盖。
      if (pendingHttpFailure) return
      if (typeof error.statusCode !== 'number') error.statusCode = 0
      finish(error)
    })
    if (inputFile) createReadStream(inputFile).on('error', (error) => finish(error)).pipe(request)
    else request.end()
  })
}

async function putObject(key, inputFile, config) {
  return sendRequest('PUT', key, config, { inputFile, onResponse: consumeResponse })
}

async function getObject(key, outputFile, config) {
  const tempFile = `${outputFile}.partial-${process.pid}`
  try {
    const meta = await sendRequest('GET', key, config, {
      onResponse(response, responseMeta, finish) {
        const output = createWriteStream(tempFile, { flags: 'w' })
        output.on('error', (error) => finish(error))
        output.on('finish', () => finish(null, responseMeta))
        response.on('error', (error) => finish(error)).pipe(output)
      },
    })
    await rename(tempFile, outputFile)
    return meta
  } catch (error) {
    await unlink(tempFile).catch(() => {})
    throw error
  }
}

async function headObject(key, config) {
  try {
    await sendRequest('HEAD', key, config, { onResponse: consumeResponse })
  } catch (error) {
    if (error.statusCode !== 404) throw error
    console.error(error.message)
    process.exitCode = 3
  }
}

async function deleteObject(key, config) {
  return sendRequest('DELETE', key, config, { onResponse: consumeResponse })
}

function clockSkewSeconds(dateHeader, nowMs = Date.now()) {
  const raw = Array.isArray(dateHeader) ? dateHeader[0] : dateHeader
  if (!raw) return null
  const parsed = Date.parse(String(raw))
  if (Number.isNaN(parsed)) return null
  return Math.round((nowMs - parsed) / 1000)
}

function formatSkew(seconds) {
  if (seconds === null) return '时钟差=未知'
  const text = `时钟差=${seconds}s`
  if (Math.abs(seconds) > SKEW_WARN_SECONDS) return `${text} 警告=时钟偏差超过15分钟，签名会被拒绝`
  return text
}

async function observe(run) {
  try {
    const meta = await run()
    return {
      ok: true,
      status: meta?.statusCode || 0,
      code: '',
      requestId: safeToken(meta?.headers?.['x-bce-request-id'], REQUEST_ID_PATTERN),
      headers: meta?.headers || {},
      network: false,
    }
  } catch (error) {
    if (error && typeof error.statusCode === 'number') {
      return {
        ok: false,
        status: error.statusCode,
        code: error.bosCode || '',
        requestId: error.requestId || '',
        headers: error.headers || {},
        network: false,
      }
    }
    return { ok: false, status: 0, code: '', requestId: '', headers: {}, network: true }
  }
}

function logStep(log, step, objectKey, result, outcome, note) {
  log([
    'diagnose',
    `步骤=${step}`,
    `对象=${objectKey}`,
    `结果=${result}`,
    `HTTP=${outcome.status}`,
    `code=${outcome.code || '-'}`,
    `requestId=${outcome.requestId || '-'}`,
    formatSkew(clockSkewSeconds(outcome.headers?.date)),
    note ? `说明=${note}` : '',
  ].filter(Boolean).join(' '))
}

// HEAD latest-deployed.txt、PUT/GET 比对诊断对象、能删则删。全过返回 true。
// 基线 HEAD 404 仍是失败；405/501 的 DELETE 作为不支持跳过，对象留在桶里。
async function diagnose(config, log = console.log) {
  const stamp = `${Date.now()}-${process.pid}`
  const probeKey = `diagnose-${stamp}.txt`
  const payload = `bos-diagnose ${stamp}\n`
  const directory = await mkdtemp(join(tmpdir(), 'bos-diagnose-'))
  const input = join(directory, 'in.txt')
  const output = join(directory, 'out.txt')
  await writeFile(input, payload)
  let passed = true
  const say = (step, objectKey, result, outcome, note = '') => {
    if (result === '失败') passed = false
    const networkNote = outcome.network ? '请求失败' : note
    logStep(log, step, objectKey, result, outcome, networkNote)
  }
  try {
    const head = await observe(() => sendRequest('HEAD', 'latest-deployed.txt', config, { onResponse: consumeResponse }))
    const headOk = head.ok
    say('HEAD', 'latest-deployed.txt', headOk ? '通过' : '失败', head)

    const put = await observe(() => putObject(probeKey, input, config))
    say('PUT', probeKey, put.ok ? '通过' : '失败', put)

    const got = await observe(() => getObject(probeKey, output, config))
    let getResult = '失败'
    let getNote = ''
    if (got.ok) {
      const actual = await readFile(output).catch(() => Buffer.alloc(0))
      if (Buffer.from(payload).equals(actual)) getResult = '通过'
      else getNote = '内容与写入不一致'
    }
    say('GET', probeKey, getResult, got, getNote)

    const deleted = await observe(() => deleteObject(probeKey, config))
    const unsupported = deleted.status === 405 || deleted.status === 501
      || deleted.code === 'MethodNotAllowed' || deleted.code === 'NotImplemented'
    let deleteResult = '失败'
    let deleteNote = '对象留在桶内，需人工删除'
    if (deleted.ok) {
      deleteResult = '通过'
      deleteNote = ''
    } else if (deleted.status === 404) {
      deleteResult = '通过'
      deleteNote = '桶内没有这个诊断对象'
    } else if (unsupported) {
      deleteResult = '不支持'
    }
    say('DELETE', probeKey, deleteResult, deleted, deleteNote)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  return passed
}

async function main() {
  const [command, key, file] = process.argv.slice(2)
  if (command === 'diagnose') {
    if (key || file) {
      console.error('usage: bos-object.mjs diagnose')
      process.exit(1)
    }
    const config = readConfig(1)
    const ok = await diagnose(config)
    if (!ok) process.exitCode = 1
    return
  }
  if (!['get', 'put', 'head'].includes(command) || !key || (command !== 'head' && !file)) {
    console.error('usage: bos-object.mjs get <key> <outfile> | put <key> <infile> | head <key> | diagnose')
    process.exit(1)
  }
  const config = readConfig()
  if (command === 'get') await getObject(key, file, config)
  if (command === 'put') await putObject(key, file, config)
  if (command === 'head') await headObject(key, config)
}

const isNodeTest = Boolean(process.env.NODE_TEST_CONTEXT)
if (isNodeTest) {
  const SECRET = 'bos-test-secret-do-not-print'
  const SCRIPT = fileURLToPath(import.meta.url)

  function runCli(args, env) {
    return new Promise((resolve) => {
      const childEnv = { ...process.env, ...env }
      delete childEnv.NODE_TEST_CONTEXT
      const started = Date.now()
      const child = spawn(process.execPath, [SCRIPT, ...args], {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      const killer = setTimeout(() => child.kill(), 12_000)
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.stderr.on('data', (chunk) => { stderr += chunk })
      child.on('close', (code) => {
        clearTimeout(killer)
        resolve({ code, stdout, stderr, text: `${stdout}\n${stderr}`, elapsed: Date.now() - started })
      })
    })
  }

  function assertNoSecrets(result, seen) {
    assert.equal(result.text.includes(SECRET), false, 'secretKey leaked')
    assert.equal(/authorization\s*[:=]/i.test(result.text), false, 'Authorization label leaked')
    for (const authorization of seen.authorizations) {
      assert.equal(result.text.includes(authorization), false, 'Authorization value leaked')
    }
  }

  async function withStub(handler, fn) {
    const seen = { authorizations: [] }
    const server = http.createServer((request, response) => {
      request.on('error', () => {})
      if (request.headers.authorization) seen.authorizations.push(request.headers.authorization)
      handler(request, response)
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const { port } = server.address()
    const env = {
      BOS_RELEASE_SCHEME: 'http',
      BOS_RELEASE_ENDPOINT: `127.0.0.1:${port}`,
      BOS_RELEASE_BUCKET: 'test-release',
      BOS_RELEASE_ACCESS_KEY: 'fake-access',
      BOS_RELEASE_SECRET_KEY: SECRET,
    }
    try {
      await fn(env, seen)
    } finally {
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
    }
  }

  function readIncoming(request) {
    return new Promise((resolve) => {
      const chunks = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', () => resolve(Buffer.concat(chunks)))
      request.on('error', () => resolve(Buffer.concat(chunks)))
    })
  }

  function writeJson(response, status, body, extraHeaders = {}) {
    response.writeHead(status, {
      'content-type': 'application/json',
      'x-bce-request-id': 'x',
      Date: new Date().toUTCString(),
      ...extraHeaders,
    })
    response.end(body)
  }

  test('BCE v1 authorization fixed vector', () => {
    assert.equal(
      createAuthorization({
        accessKey: 'AKIDEXAMPLE',
        secretKey: 'fake-secret-for-test-only',
        method: 'GET',
        host: 'ai-job-print-release.bj.bcebos.com',
        canonicalUri: '/release-abc.bundle',
        date: '2026-09-06T12:00:00Z',
      }),
      'bce-auth-v1/AKIDEXAMPLE/2026-09-06T12:00:00Z/1800/host;x-bce-date/cc3c4bc3d040dd1e537db28e8389b9464c390086343ddd4c1f8aae5dca76bab9',
    )
  })

  test('HEAD failure includes code when a body is available and never includes message', () => {
    const error = bosFailure({
      method: 'HEAD',
      key: 'latest-deployed.txt',
      status: 403,
      headers: { 'x-bce-request-id': 'x' },
      body: Buffer.from('{"code":"AccessDenied","message":"secret detail","requestId":"x"}'),
    })
    assert.equal(error.message, 'BOS HEAD failed for latest-deployed.txt: HTTP 403 code=AccessDenied requestId=x')
    assert.equal(error.message.includes('secret detail'), false)
  })

  test('code accepts only scalar strings matching the bounded allowlist', () => {
    for (const code of [['AccessDenied'], 403, 'a'.repeat(65), 'has space', 'line\nbreak', 'AccessDenied\n']) {
      assert.equal(fieldsFromBody(JSON.stringify({ code })).code, '')
    }
    assert.equal(fieldsFromBody('{"code":"A_b.c-1"}').code, 'A_b.c-1')
  })

  test('bounded body reader rejects oversize, stalled JSON prefixes and aborted bodies', async () => {
    const oversized = new PassThrough()
    const tooLarge = readErrorBody(oversized)
    oversized.end(JSON.stringify({ code: 'AccessDenied', pad: 'x'.repeat(3000) }))
    assert.equal(await tooLarge, null)

    const aborted = new PassThrough()
    const broken = readErrorBody(aborted)
    aborted.write('{"code":"AccessDenied"}')
    aborted.destroy()
    assert.equal(await broken, null)

    const stalled = new PassThrough()
    const started = Date.now()
    const slow = readErrorBody(stalled)
    stalled.write('{"code":"AccessDenied"}')
    assert.equal(await slow, null)
    assert.ok(Date.now() - started < 3500, 'error body budget must be at most 3 seconds plus scheduling overhead')
    stalled.destroy()
  })

  test('bounded body reader accepts complete JSON up to exactly 2048 bytes', async () => {
    const response = new PassThrough()
    const pending = readErrorBody(response)
    response.end('{"code":"AccessDenied"}'.padEnd(2048, ' '))
    assert.equal(fieldsFromBody(await pending).code, 'AccessDenied')
  })

  test('403 JSON error carries code and requestId but not message', async () => {
    const body = JSON.stringify({ code: 'AccessDenied', message: 'secret detail', requestId: 'x' })
    await withStub(async (request, response) => {
      await readIncoming(request)
      writeJson(response, 403, body)
    }, async (env, seen) => {
      const directory = await mkdtemp(join(tmpdir(), 'bos-err-'))
      try {
        const input = join(directory, 'in.bin')
        const output = join(directory, 'out.bin')
        await writeFile(input, 'payload')
        for (const args of [
          ['get', 'probe.txt', output],
          ['put', 'probe.txt', input],
          ['head', 'probe.txt'],
        ]) {
          const result = await runCli(args, env)
          assert.notEqual(result.code, 0, args[0])
          assert.equal(result.text.includes('secret detail'), false, result.text)
          assert.match(result.stderr, new RegExp(`BOS ${args[0].toUpperCase()} failed for probe\\.txt: HTTP 403`))
          assertNoSecrets(result, seen)
          if (args[0] === 'head') {
            // node:http 不把 HEAD 响应体交给应用，code 只能在体真的送达时出现。
            assert.match(result.stderr, /requestId=x/)
          } else {
            assert.match(result.stderr, /code=AccessDenied/)
            assert.match(result.stderr, /requestId=x/)
          }
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  })

  test('invalid code is omitted and message is still hidden', async () => {
    await withStub(async (request, response) => {
      await readIncoming(request)
      writeJson(response, 403, JSON.stringify({ code: 'not valid!', message: 'secret detail' }))
    }, async (env, seen) => {
      const directory = await mkdtemp(join(tmpdir(), 'bos-err-'))
      const output = join(directory, 'out.bin')
      try {
        const result = await runCli(['get', 'probe.txt', output], env)
        assert.equal(result.code, 1)
        assert.equal(result.stderr.includes('code='), false, result.stderr)
        assert.equal(result.text.includes('secret detail'), false)
        assertNoSecrets(result, seen)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  })

  test('oversized error body does not hang and does not yield code', async () => {
    const body = JSON.stringify({ code: 'AccessDenied', message: 'secret detail', pad: 'a'.repeat(3000) })
    assert.ok(body.length > 2048)
    await withStub(async (request, response) => {
      await readIncoming(request)
      writeJson(response, 403, body)
    }, async (env, seen) => {
      const directory = await mkdtemp(join(tmpdir(), 'bos-err-'))
      const output = join(directory, 'out.bin')
      try {
        const result = await runCli(['get', 'probe.txt', output], env)
        assert.ok(result.elapsed < 6000, `elapsed ${result.elapsed}`)
        assert.equal(result.stderr.includes('code='), false, result.stderr)
        assert.equal(result.text.includes('secret detail'), false)
        assert.match(result.stderr, /HTTP 403/)
        assertNoSecrets(result, seen)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  })

  test('non-JSON error body does not hang and does not yield code', async () => {
    await withStub(async (request, response) => {
      await readIncoming(request)
      writeJson(response, 502, 'not-json secret detail')
    }, async (env, seen) => {
      const directory = await mkdtemp(join(tmpdir(), 'bos-err-'))
      const output = join(directory, 'out.bin')
      try {
        const result = await runCli(['get', 'probe.txt', output], env)
        assert.equal(result.code, 1)
        assert.equal(result.stderr.includes('code='), false, result.stderr)
        assert.equal(result.text.includes('secret detail'), false)
        assert.match(result.stderr, /HTTP 502/)
        assertNoSecrets(result, seen)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  })

  test('slow error body times out without code and without hanging', async () => {
    await withStub((request, response) => {
      response.writeHead(403, {
        'content-type': 'application/json',
        'x-bce-request-id': 'slow-req',
        Date: new Date().toUTCString(),
      })
      response.flushHeaders()
      response.write('{"code":"AccessDenied"}')
      const timer = setTimeout(() => {
        try { response.end(JSON.stringify({ code: 'AccessDenied', message: 'secret detail' })) } catch { /* client already left */ }
      }, 15_000)
      timer.unref()
      request.on('close', () => clearTimeout(timer))
      request.resume()
    }, async (env, seen) => {
      const directory = await mkdtemp(join(tmpdir(), 'bos-err-'))
      const output = join(directory, 'out.bin')
      try {
        const result = await runCli(['get', 'probe.txt', output], env)
        assert.ok(result.elapsed < 6000, `elapsed ${result.elapsed}`)
        assert.equal(result.stderr.includes('code='), false, result.stderr)
        assert.equal(result.text.includes('secret detail'), false)
        assert.match(result.stderr, /HTTP 403/)
        assertNoSecrets(result, seen)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  })

  function diagnoseStub({ failMethod = '', deleteStatus = 204, dateOffsetMs = 2000, seedBaseline = true, mismatch = false } = {}) {
    const objects = new Map()
    if (seedBaseline) objects.set('/latest-deployed.txt', Buffer.from('baseline\n'))
    return async (request, response) => {
      const body = await readIncoming(request)
      const headers = {
        Date: new Date(Date.now() - dateOffsetMs).toUTCString(),
        'x-bce-request-id': 'diag-req',
        'content-type': 'application/json',
      }
      if (failMethod && request.method === failMethod) {
        response.writeHead(403, headers)
        response.end(JSON.stringify({ code: 'AccessDenied', message: 'secret detail', requestId: 'x' }))
        return
      }
      if (request.method === 'PUT') {
        objects.set(request.url, body)
        response.writeHead(200, headers)
        response.end()
        return
      }
      if (request.method === 'HEAD') {
        response.writeHead(objects.has(request.url) ? 200 : 404, headers)
        response.end()
        return
      }
      if (request.method === 'GET') {
        if (!objects.has(request.url)) {
          response.writeHead(404, headers)
          response.end(JSON.stringify({ code: 'NoSuchKey', message: 'secret detail' }))
          return
        }
        response.writeHead(200, { ...headers, 'content-type': 'text/plain' })
        response.end(mismatch ? 'different payload' : objects.get(request.url))
        return
      }
      if (request.method === 'DELETE') {
        if (deleteStatus >= 200 && deleteStatus < 300) objects.delete(request.url)
        response.writeHead(deleteStatus, headers)
        if (deleteStatus === 405) response.end(JSON.stringify({ code: 'MethodNotAllowed', message: 'secret detail' }))
        else response.end()
        return
      }
      response.writeHead(400, headers)
      response.end()
    }
  }

  test('diagnose without credentials exits 1 and exposes no secrets', async () => {
    const result = await runCli(['diagnose'], { BOS_RELEASE_ACCESS_KEY: '', BOS_RELEASE_SECRET_KEY: '' })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /BOS credentials are not configured/)
    assertNoSecrets(result, { authorizations: [] })
  })

  test('diagnose transport-stream simulation covers success, failure and secret-free logs', async (t) => {
    const config = { scheme: 'http', endpoint: '127.0.0.1:1', bucket: 'test-release', accessKey: 'fake-access', secretKey: SECRET }
    const logs = []
    const authorizations = []
    const objects = new Map([['/latest-deployed.txt', Buffer.from('baseline')]])
    let denied = ''
    let brokenBody = false
    t.mock.method(console, 'log', (line) => logs.push(String(line)))
    t.mock.method(http, 'request', (options, callback) => {
      authorizations.push(options.headers.Authorization)
      const chunks = []
      return new Writable({
        write(chunk, encoding, done) { chunks.push(chunk); done() },
        final(done) {
          const response = new PassThrough()
          response.headers = { date: new Date().toUTCString(), 'x-bce-request-id': 'stream-req' }
          response.statusCode = options.method === denied ? 403 : 200
          let body = Buffer.alloc(0)
          if (response.statusCode === 403) body = Buffer.from('{"code":"AccessDenied","message":"secret detail"}')
          else if (options.method === 'PUT') objects.set(options.path, Buffer.concat(chunks))
          else if (options.method === 'GET') body = objects.get(options.path) || Buffer.alloc(0)
          else if (options.method === 'DELETE') { objects.delete(options.path); response.statusCode = 204 }
          callback(response)
          queueMicrotask(() => {
            if (brokenBody) {
              response.destroy(new Error('secret detail'))
              this.emit('error', new Error('secret transport detail'))
            } else response.end(body)
          })
          done()
        },
      })
    })
    assert.equal(await diagnose(config), true)
    for (const step of ['HEAD', 'PUT', 'GET', 'DELETE']) assert.ok(logs.some((line) => line.includes(`步骤=${step}`) && line.includes('结果=通过')))
    denied = 'PUT'
    assert.equal(await diagnose(config), false)
    assert.ok(logs.some((line) => /步骤=PUT .*结果=失败 .*HTTP=403 code=AccessDenied/.test(line)))
    brokenBody = true
    denied = 'GET'
    await assert.rejects(sendRequest('GET', 'probe.txt', config, { onResponse: consumeResponse }), (error) => {
      assert.match(error.message, /BOS GET failed for probe.txt: HTTP 403 requestId=stream-req/)
      assert.equal(error.message.includes('secret detail'), false)
      return true
    })
    const text = logs.join('\n')
    assert.equal(text.includes('secret detail'), false)
    assertNoSecrets({ text }, { authorizations })
    t.diagnostic(`transport-stream sample:\n${logs.slice(0, 4).join('\n')}`)
  })

  test('diagnose passes on a stub that supports delete', async () => {
    await withStub(diagnoseStub(), async (env, seen) => {
      const result = await runCli(['diagnose'], env)
      assert.equal(result.code, 0, result.text)
      for (const step of ['HEAD', 'PUT', 'GET', 'DELETE']) {
        assert.match(result.stdout, new RegExp(`步骤=${step} .*结果=通过`))
      }
      assert.match(result.stdout, /时钟差=-?\d+s/)
      assert.equal(result.stdout.includes('警告=时钟偏差超过15分钟'), false)
      assert.equal(result.text.includes('secret detail'), false)
      assertNoSecrets(result, seen)
    })
  })

  test('diagnose fails a denied step without printing message', async () => {
    await withStub(diagnoseStub({ failMethod: 'PUT' }), async (env, seen) => {
      const result = await runCli(['diagnose'], env)
      assert.equal(result.code, 1, result.text)
      assert.match(result.stdout, /步骤=HEAD .*结果=通过/)
      assert.match(result.stdout, /步骤=PUT .*结果=失败 .*HTTP=403 code=AccessDenied/)
      assert.equal(result.text.includes('secret detail'), false)
      assertNoSecrets(result, seen)
    })
  })

  test('diagnose fails for a missing baseline, content mismatch, or denied DELETE', async () => {
    for (const options of [{ seedBaseline: false }, { mismatch: true }, { failMethod: 'DELETE' }]) {
      await withStub(diagnoseStub(options), async (env, seen) => {
        const result = await runCli(['diagnose'], env)
        assert.equal(result.code, 1, result.text)
        if (options.seedBaseline === false) assert.match(result.stdout, /步骤=HEAD .*结果=失败 .*HTTP=404/)
        if (options.mismatch) assert.match(result.stdout, /步骤=GET .*结果=失败 .*说明=内容与写入不一致/)
        if (options.failMethod) assert.match(result.stdout, /步骤=DELETE .*结果=失败 .*HTTP=403 code=AccessDenied/)
        assertNoSecrets(result, seen)
      })
    }
  })

  test('diagnose leaves the object when delete is unsupported and still passes', async () => {
    await withStub(diagnoseStub({ deleteStatus: 405 }), async (env, seen) => {
      const result = await runCli(['diagnose'], env)
      assert.equal(result.code, 0, result.text)
      assert.match(result.stdout, /步骤=DELETE .*结果=不支持 .*HTTP=405 code=MethodNotAllowed .*说明=对象留在桶内，需人工删除/)
      assert.equal(result.text.includes('secret detail'), false)
      assertNoSecrets(result, seen)
    })
  })

  test('diagnose reports clock skew over 15 minutes', async () => {
    await withStub(diagnoseStub({ dateOffsetMs: 16 * 60 * 1000 }), async (env, seen) => {
      const result = await runCli(['diagnose'], env)
      assert.equal(result.code, 0, result.text)
      assert.match(result.stdout, /时钟差=\d+s 警告=时钟偏差超过15分钟，签名会被拒绝/)
      assertNoSecrets(result, seen)
    })
  })
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`BOS operation failed: ${error.message}`)
    process.exit(1)
  })
}
