#!/usr/bin/env node
// Static release-bundle contract plus a local HTTP BOS round-trip. No network
// service beyond the loopback stub is used, and fake credentials stay local.

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFile(join(root, relativePath), 'utf8')
const fail = (message) => { throw new Error(message) }

function required(text, expression, message) {
  if (!expression.test(text)) fail(message)
}

function verifyStaticContractsFromSources({ deploy, ci, client }) {
  const bundleOffset = deploy.indexOf('尝试从 BOS 拉取增量 bundle')
  const fetchOffset = deploy.indexOf('fetch exact CI SHA attempt')
  assert.ok(bundleOffset >= 0 && bundleOffset < fetchOffset, 'deploy BOS path must precede the GitHub exact-SHA loop')
  required(deploy, /sha256sum -c release\.sha256/, 'deploy must verify the bundle checksum')
  required(deploy, /git bundle verify \/tmp\/release\.bundle/, 'deploy must verify the Git bundle')
  required(deploy, /BOS bundle 不可用或校验失败，走 GitHub 拉取[\s\S]*?for ATTEMPT in 1 2/, 'deploy must retain GitHub fallback after BOS failure')
  const envs = deploy.match(/^\s*envs:\s*(.+)$/m)?.[1] ?? ''
  assert.ok(!envs.includes('BOS_RELEASE_SECRET_KEY'), 'BOS secret must not cross GitHub SSH env forwarding')
  required(deploy, /put latest-deployed\.txt \/tmp\/latest\.txt/, 'deploy must best-effort write deployed baseline')

  required(ci, /^  release-bundle:\n/m, 'CI must define release-bundle job')
  required(ci, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/, 'release-bundle must be restricted to main pushes')
  required(ci, /needs: \[build-and-verify, postgres-readiness, kiosk-browser-smoke\]/, 'release-bundle must wait for all verified CI jobs')
  const releaseJob = ci.slice(ci.indexOf('  release-bundle:'))
  assert.ok((releaseJob.match(/continue-on-error: true/g) ?? []).length >= 3, 'all BOS steps must be best-effort')
  assert.ok(!/echo[^\n]*(BOS_RELEASE_ACCESS_KEY|BOS_RELEASE_SECRET_KEY)/.test(releaseJob), 'CI must not echo BOS credentials')
  const diagnoseStep = releaseJob.slice(releaseJob.indexOf('Diagnose BOS access'), releaseJob.indexOf('Read BOS deployed baseline'))
  assert.match(diagnoseStep, /continue-on-error:\s*true[\s\S]*bos-object\.mjs diagnose/, 'CI must diagnose BOS before reading the baseline, without failing the job')
  assert.equal(releaseJob.includes('无可用基线，本次发布将回退到 GitHub 拉取'), false, 'missing baseline must still create a bundle')
  assert.equal(/^\s*exit 0\s*$/m.test(releaseJob), false, 'release-bundle must not skip bundle creation')
  for (const label of ['基线来源：latest-deployed', '基线来源：14 天前兜底', '基线来源：完整包']) {
    if (!releaseJob.includes(label)) fail(`release-bundle must print ${label}`)
  }
  required(releaseJob, /git rev-list -1 --before="14 days ago" "\$RELEASE_SHA"/, 'fallback baseline is the commit from 14 days ago')

  const tryAt = deploy.indexOf('尝试从 BOS 拉取增量 bundle')
  const serverDiagnose = deploy.indexOf('bos-object.mjs diagnose')
  const getAt = deploy.indexOf('bos-object.mjs get "release-$EXPECTED_SHA.bundle"')
  assert.ok(tryAt >= 0 && serverDiagnose > tryAt && serverDiagnose < getAt, 'deploy must diagnose BOS after choosing the bundle path and before the GET')
  required(deploy, /bos-object\.mjs diagnose[\s\S]{0,220}BOS diagnose 未通过（不影响本次发布）/, 'diagnose failure must not block deploy')
  const writebackAt = deploy.indexOf('latest-deployed.txt 回写失败')
  const catAt = deploy.indexOf('cat "$WRITEBACK_LOG"', writebackAt)
  assert.ok(writebackAt >= 0 && catAt > writebackAt && catAt - writebackAt < 300, 'writeback failure must print the client error line')

  assert.ok(!/^import\s+(?!assert from 'node:|.*from 'node:)/m.test(client), 'BOS client may import only node built-ins')
  assert.ok(!/console\.log\([^\n]*(SECRET|Authorization)/i.test(client), 'BOS client must not log secrets or Authorization')
  required(client, /ERROR_BODY_MAX_BYTES = 2048/, 'error body read must stop at 2048 bytes')
  required(client, /ERROR_BODY_MAX_MS = 3000/, 'error body read must stop after 3 seconds')
}

async function verifyStaticContracts() {
  return verifyStaticContractsFromSources({
    deploy: await read('.github/workflows/deploy.yml'),
    ci: await read('.github/workflows/ci.yml'),
    client: await read('scripts/release-bundle/bos-object.mjs'),
  })
}

async function verifyMutations() {
  const sources = {
    deploy: await read('.github/workflows/deploy.yml'),
    ci: await read('.github/workflows/ci.yml'),
    client: await read('scripts/release-bundle/bos-object.mjs'),
  }
  const mutations = [
    {
      name: 'delete sha256sum -c',
      sources: { ...sources, deploy: sources.deploy.replace('sha256sum -c release.sha256', 'true # checksum removed') },
      message: /checksum/,
    },
    {
      name: 'remove continue-on-error',
      sources: { ...sources, ci: sources.ci.replace('continue-on-error: true', 'continue-on-error: false') },
      message: /best-effort/,
    },
    {
      name: 'forward BOS secret through SSH',
      sources: { ...sources, deploy: sources.deploy.replace('PRINT_REQUIRE_PII_SCAN', 'PRINT_REQUIRE_PII_SCAN,BOS_RELEASE_SECRET_KEY') },
      message: /must not cross GitHub SSH/,
    },
  ]
  for (const mutation of mutations) {
    assert.throws(() => verifyStaticContractsFromSources(mutation.sources), mutation.message, `mutation must fail: ${mutation.name}`)
    console.log(`MUTATION PASS: ${mutation.name} is rejected`)
  }
}

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const killer = setTimeout(() => child.kill(), 12_000)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(killer)
      resolve({ code, stdout, stderr, text: `${stdout}\n${stderr}`, elapsed: Date.now() - started })
    })
  })
}

async function verifyLoopbackBos() {
  const objects = new Map()
  const server = createServer((request, response) => {
    const authorization = request.headers.authorization || ''
    if (!/^bce-auth-v1\/fake-access\/.+\/host;x-bce-date\/[0-9a-f]{64}$/.test(authorization)) {
      response.writeHead(401).end('invalid Authorization')
      return
    }
    const key = request.url
    if (request.method === 'PUT') {
      const chunks = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', () => { objects.set(key, Buffer.concat(chunks)); response.writeHead(200).end() })
      return
    }
    if (request.method === 'HEAD') {
      response.writeHead(objects.has(key) ? 200 : 404).end()
      return
    }
    if (request.method === 'GET' && objects.has(key)) {
      response.writeHead(200).end(objects.get(key))
      return
    }
    response.writeHead(404).end()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const { port } = server.address()
  const directory = await mkdtemp(join(tmpdir(), 'release-bundle-'))
  const input = join(directory, 'input.bin')
  const output = join(directory, 'output.bin')
  const env = {
    BOS_RELEASE_SCHEME: 'http',
    BOS_RELEASE_ENDPOINT: `127.0.0.1:${port}`,
    BOS_RELEASE_BUCKET: 'test-release',
    BOS_RELEASE_ACCESS_KEY: 'fake-access',
    BOS_RELEASE_SECRET_KEY: 'fake-secret',
  }
  try {
    await writeFile(input, 'release-bundle loopback payload\n')
    for (const args of [
      ['scripts/release-bundle/bos-object.mjs', 'put', 'roundtrip.bin', input],
      ['scripts/release-bundle/bos-object.mjs', 'head', 'roundtrip.bin'],
      ['scripts/release-bundle/bos-object.mjs', 'get', 'roundtrip.bin', output],
    ]) {
      const result = await runNode(args, env)
      assert.equal(result.code, 0, `local BOS ${args[1]} must pass: ${result.stderr}`)
    }
    assert.equal(await readFile(output, 'utf8'), await readFile(input, 'utf8'), 'GET output must equal PUT input')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 真跑一次 CI 的 bundle 生成命令。静态断言抓不到这一类：2026-09-07 之前
// ci.yml 用 `git bundle create "$BUNDLE" "$RELEASE_SHA" ^"$BASE_SHA"` 传裸 SHA，
// git 以 "Refusing to create empty bundle." 退出 128；该步骤 continue-on-error，
// 于是 job 一直显示成功，而桶里从来没有过任何 bundle。
// 这里从 ci.yml 里把命令抽出来，在临时仓库上真执行，再从 bundle 取回目标 SHA。
// ─────────────────────────────────────────────────────────────────────────────
function runGit(args, cwd, options = {}) {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      env: { ...process.env, ...(options.env || {}) },
      stdio: [options.input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    if (options.input != null) child.stdin.end(options.input)
    let out = ''
    let err = ''
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', (c) => { err += c })
    child.on('close', (code) => resolve({ code, out, err }))
  })
}

async function verifyRealBundleRoundTrip() {
  const ci = await read('.github/workflows/ci.yml')
  const createLine = ci.split('\n').map((line) => line.trim()).find((line) => line.startsWith('git bundle create'))
  if (!createLine) fail('ci.yml 里找不到 git bundle create 命令')
  if (/git bundle create\s+"\$BUNDLE"\s+"\$RELEASE_SHA"/.test(createLine)) {
    fail('git bundle create 不能直接传裸 SHA：git 会以 "Refusing to create empty bundle." 退出 128。必须先 update-ref 成具名 ref（或用 HEAD）。')
  }
  required(ci, /git update-ref refs\/release\/target "\$RELEASE_SHA"/, 'ci.yml 必须先把发布 SHA 写成具名 ref 再打 bundle')
  required(ci, /git bundle verify "\$BUNDLE"/, 'ci.yml 打完 bundle 必须立即 verify，别把坏包传上去')

  const dir = await mkdtemp(join(tmpdir(), 'qx-bundle-'))
  try {
    const src = join(dir, 'src')
    await runGit(['init', '-q', '--initial-branch=main', src], dir)
    await runGit(['config', 'user.email', 'verify@example.invalid'], src)
    await runGit(['config', 'user.name', 'verify'], src)
    const shas = []
    for (const n of [1, 2, 3]) {
      await writeFile(join(src, `f${n}.txt`), `content ${n}\n`)
      await runGit(['add', '-A'], src)
      await runGit(['commit', '-q', '-m', `commit ${n}`], src)
      const rev = await runGit(['rev-parse', 'HEAD'], src)
      shas.push(rev.out.trim())
    }
    const [baseSha, , releaseSha] = shas
    const bundle = join(dir, 'release.bundle')

    // 逐字替换 ci.yml 里那条命令的变量后真执行。
    const argv = createLine
      .replace('git bundle create ', '')
      .replaceAll('"$BUNDLE"', bundle)
      .replaceAll('"^$BASE_SHA"', `^${baseSha}`)
      .replaceAll('"$RELEASE_SHA"', releaseSha)
      .replaceAll('"$BASE_SHA"', baseSha)
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => token.replaceAll('"', ''))
    await runGit(['update-ref', 'refs/release/target', releaseSha], src)
    const created = await runGit(['bundle', 'create', ...argv], src)
    if (created.code !== 0) fail(`ci.yml 的 bundle 命令实跑失败（exit ${created.code}）：${created.err.trim().split('\n').pop()}`)

    const empty = join(dir, 'empty')
    await runGit(['init', '-q', empty], dir)
    const missing = await runGit(['bundle', 'verify', bundle], empty)
    assert.notEqual(missing.code, 0, 'server without the prerequisite must reject an incremental bundle')

    const verified = await runGit(['bundle', 'verify', bundle], src)
    if (verified.code !== 0) fail(`生成的 bundle 校验失败：${verified.err.trim()}`)

    // 部署脚本按 SHA 从 bundle 取回目标提交，这里复现同一动作。
    const dst = join(dir, 'dst')
    await runGit(['branch', 'baseline', baseSha], src)
    const cloned = await runGit(['clone', '-q', '--no-local', '--depth=1', '--branch', 'baseline', src, dst], dir)
    assert.equal(cloned.code, 0, cloned.err)
    const before = await runGit(['cat-file', '-e', releaseSha], dst)
    assert.notEqual(before.code, 0, 'destination must not already contain the release commit')
    const prerequisites = await runGit(['bundle', 'verify', bundle], dst)
    assert.equal(prerequisites.code, 0, prerequisites.err)
    const fetched = await runGit(['fetch', '--no-tags', bundle, releaseSha], dst)
    if (fetched.code !== 0) fail(`部署侧无法从 bundle 取回目标 SHA：${fetched.err.trim().split('\n').pop()}`)
    const has = await runGit(['cat-file', '-t', releaseSha], dst)
    if (has.out.trim() !== 'commit') fail('从 bundle 取回后目标 SHA 仍不可达，部署会回退到 GitHub 拉取')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const DIAGNOSTIC_SECRET = 'bos-test-secret-do-not-print'

function assertNoSecrets(result, authorizations) {
  if (result.text.includes(DIAGNOSTIC_SECRET)) fail('secretKey leaked into BOS client output')
  if (/authorization\s*[:=]/i.test(result.text)) fail('Authorization label leaked into BOS client output')
  for (const authorization of authorizations) {
    if (authorization && result.text.includes(authorization)) fail('Authorization value leaked into BOS client output')
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

async function verifyErrorDiagnostics() {
  const state = { mode: 'json-403', objects: new Map(), authorizations: [], deleteStatus: 204, failMethod: '' }
  const server = createServer((request, response) => {
    request.on('error', () => {})
    if (request.headers.authorization) state.authorizations.push(request.headers.authorization)
    readIncoming(request).then((body) => {
      const headers = {
        Date: new Date(Date.now() - (state.dateOffsetMs || 2000)).toUTCString(),
        'x-bce-request-id': state.requestId || 'x',
        'content-type': 'application/json',
      }
      if (state.mode === 'slow') {
        response.writeHead(403, { ...headers, 'x-bce-request-id': 'slow-req' })
        response.flushHeaders()
        response.write('{"code":"AccessDenied"}')
        const timer = setTimeout(() => {
          try { response.end(JSON.stringify({ code: 'AccessDenied', message: 'secret detail' })) } catch { /* client already left */ }
        }, 15_000)
        timer.unref()
        request.on('close', () => clearTimeout(timer))
        return
      }
      if (state.mode === 'text') {
        response.writeHead(502, headers)
        response.end('not-json secret detail')
        return
      }
      if (state.mode === 'oversize') {
        response.writeHead(403, headers)
        response.end(JSON.stringify({ code: 'AccessDenied', message: 'secret detail', pad: 'a'.repeat(3000) }))
        return
      }
      if (state.mode === 'invalid-code') {
        response.writeHead(403, headers)
        response.end(JSON.stringify({ code: 'not valid!', message: 'secret detail' }))
        return
      }
      if (state.mode === 'json-403') {
        response.writeHead(403, headers)
        response.end(JSON.stringify({ code: 'AccessDenied', message: 'secret detail', requestId: 'x' }))
        return
      }
      if (state.failMethod && request.method === state.failMethod) {
        response.writeHead(403, headers)
        response.end(JSON.stringify({ code: 'AccessDenied', message: 'secret detail', requestId: 'x' }))
        return
      }
      if (request.method === 'PUT') {
        state.objects.set(request.url, body)
        response.writeHead(200, headers)
        response.end()
        return
      }
      if (request.method === 'HEAD') {
        response.writeHead(state.objects.has(request.url) ? 200 : 404, headers)
        response.end()
        return
      }
      if (request.method === 'GET') {
        if (!state.objects.has(request.url)) {
          response.writeHead(404, headers)
          response.end(JSON.stringify({ code: 'NoSuchKey', message: 'secret detail' }))
          return
        }
        response.writeHead(200, { ...headers, 'content-type': 'text/plain' })
        response.end(state.objects.get(request.url))
        return
      }
      if (request.method === 'DELETE') {
        if (state.deleteStatus >= 200 && state.deleteStatus < 300) state.objects.delete(request.url)
        response.writeHead(state.deleteStatus, headers)
        if (state.deleteStatus === 405) response.end(JSON.stringify({ code: 'MethodNotAllowed', message: 'secret detail' }))
        else response.end()
        return
      }
      response.writeHead(400, headers)
      response.end()
    }).catch(() => response.destroy())
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
    BOS_RELEASE_SECRET_KEY: DIAGNOSTIC_SECRET,
  }
  const directory = await mkdtemp(join(tmpdir(), 'release-bundle-diag-'))
  const input = join(directory, 'in.bin')
  const output = join(directory, 'out.bin')
  await writeFile(input, 'payload')
  try {
    state.mode = 'json-403'
    for (const args of [
      ['scripts/release-bundle/bos-object.mjs', 'get', 'probe.txt', output],
      ['scripts/release-bundle/bos-object.mjs', 'put', 'probe.txt', input],
      ['scripts/release-bundle/bos-object.mjs', 'head', 'probe.txt'],
    ]) {
      const result = await runNode(args, env)
      if (result.code === 0) fail(`${args[1]} 403 must fail`)
      if (result.text.includes('secret detail')) fail(`${args[1]} printed the BOS message field`)
      if (!new RegExp(`BOS ${args[1].toUpperCase()} failed for probe\\.txt: HTTP 403`).test(result.stderr)) {
        fail(`${args[1]} error shape mismatch: ${result.stderr}`)
      }
      if (args[1] === 'head') {
        if (!/requestId=x/.test(result.stderr)) fail(`HEAD error missing requestId: ${result.stderr}`)
      } else if (!/code=AccessDenied/.test(result.stderr) || !/requestId=x/.test(result.stderr)) {
        fail(`${args[1]} error missing code or requestId: ${result.stderr}`)
      }
      assertNoSecrets(result, state.authorizations)
    }

    state.mode = 'invalid-code'
    const invalid = await runNode(['scripts/release-bundle/bos-object.mjs', 'get', 'probe.txt', output], env)
    if (invalid.stderr.includes('code=')) fail(`invalid code was kept: ${invalid.stderr}`)
    if (invalid.text.includes('secret detail')) fail('invalid-code response printed message')
    assertNoSecrets(invalid, state.authorizations)

    state.mode = 'oversize'
    const oversize = await runNode(['scripts/release-bundle/bos-object.mjs', 'get', 'probe.txt', output], env)
    if (oversize.elapsed >= 6000) fail(`oversized body hung for ${oversize.elapsed}ms`)
    if (oversize.stderr.includes('code=')) fail(`oversized body yielded a code: ${oversize.stderr}`)
    if (oversize.text.includes('secret detail')) fail('oversized body printed message')
    if (!/HTTP 403/.test(oversize.stderr)) fail(`oversized body dropped the HTTP error: ${oversize.stderr}`)
    assertNoSecrets(oversize, state.authorizations)

    state.mode = 'text'
    const text = await runNode(['scripts/release-bundle/bos-object.mjs', 'get', 'probe.txt', output], env)
    if (text.stderr.includes('code=')) fail(`non-JSON body yielded a code: ${text.stderr}`)
    if (text.text.includes('secret detail')) fail('non-JSON body was copied into the error')
    if (!/HTTP 502/.test(text.stderr)) fail(`non-JSON body dropped the HTTP error: ${text.stderr}`)
    assertNoSecrets(text, state.authorizations)

    state.mode = 'slow'
    const slow = await runNode(['scripts/release-bundle/bos-object.mjs', 'get', 'probe.txt', output], env)
    if (slow.elapsed >= 6000) fail(`slow body hung for ${slow.elapsed}ms`)
    if (slow.stderr.includes('code=')) fail(`slow body yielded a code: ${slow.stderr}`)
    if (slow.text.includes('secret detail')) fail('slow body printed message')
    if (!/HTTP 403/.test(slow.stderr)) fail(`slow body dropped the HTTP error: ${slow.stderr}`)
    assertNoSecrets(slow, state.authorizations)

    state.mode = 'diagnose'
    state.failMethod = ''
    state.deleteStatus = 204
    state.objects = new Map([['/latest-deployed.txt', Buffer.from('baseline\n')]])
    const passed = await runNode(['scripts/release-bundle/bos-object.mjs', 'diagnose'], env)
    if (passed.code !== 0) fail(`diagnose must pass: ${passed.text}`)
    for (const step of ['HEAD', 'PUT', 'GET', 'DELETE']) {
      if (!new RegExp(`步骤=${step} .*结果=通过`).test(passed.stdout)) fail(`diagnose missing passing ${step}: ${passed.stdout}`)
    }
    if (!/时钟差=-?\d+s/.test(passed.stdout)) fail(`diagnose missing clock skew: ${passed.stdout}`)
    if (passed.text.includes('secret detail')) fail('diagnose printed message')
    assertNoSecrets(passed, state.authorizations)

    console.log(`LOCAL DIAGNOSE SAMPLE:\n${passed.stdout.trim()}`)

    state.objects.delete('/latest-deployed.txt')
    const missing = await runNode(['scripts/release-bundle/bos-object.mjs', 'diagnose'], env)
    assert.equal(missing.code, 1, 'diagnose HEAD 404 must fail')
    assert.match(missing.stdout, /步骤=HEAD .*结果=失败 .*HTTP=404/)
    assertNoSecrets(missing, state.authorizations)
    state.objects.set('/latest-deployed.txt', Buffer.from('baseline'))

    state.failMethod = 'PUT'
    const partial = await runNode(['scripts/release-bundle/bos-object.mjs', 'diagnose'], env)
    if (partial.code === 0) fail('diagnose must fail when PUT is denied')
    if (!/步骤=PUT .*结果=失败 .*HTTP=403 code=AccessDenied/.test(partial.stdout)) fail(`diagnose partial output: ${partial.stdout}`)
    if (partial.text.includes('secret detail')) fail('diagnose failure printed message')
    assertNoSecrets(partial, state.authorizations)

    state.failMethod = ''
    state.deleteStatus = 405
    const unsupported = await runNode(['scripts/release-bundle/bos-object.mjs', 'diagnose'], env)
    if (unsupported.code !== 0) fail(`unsupported delete must not fail the round trip: ${unsupported.text}`)
    if (!/步骤=DELETE .*结果=不支持 .*说明=对象留在桶内，需人工删除/.test(unsupported.stdout)) {
      fail(`diagnose did not explain the leftover object: ${unsupported.stdout}`)
    }
    if (unsupported.text.includes('secret detail')) fail('unsupported delete printed message')
    assertNoSecrets(unsupported, state.authorizations)
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
}

function extractBaselineScript(ci) {
  const start = ci.indexOf('RELEASE_SHA="$GITHUB_SHA"')
  const marker = 'git bundle verify "$BUNDLE"'
  const end = ci.indexOf(marker, start)
  if (start < 0 || end < 0) fail('ci.yml 缺少可实测的基线脚本')
  return `${ci.slice(start, end + marker.length)}\n`
}

function runBash(script, cwd, env) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-e', '-o', 'pipefail'], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.stdin.end(script)
    child.on('close', (code) => resolve({ code, out, err }))
  })
}

async function commitFile(src, name, content, message, when) {
  await writeFile(join(src, name), content)
  const added = await runGit(['add', name], src)
  if (added.code !== 0) fail(added.err)
  const committed = await runGit(['commit', '-q', '-m', message], src, when ? {
    env: { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  } : {})
  if (committed.code !== 0) fail(committed.err || committed.out)
  const rev = await runGit(['rev-parse', 'HEAD'], src)
  return rev.out.trim()
}

async function runBaselineCase(script, src, githubSha, baseSha) {
  const bundle = join(src, `release-${githubSha}.bundle`)
  await rm(bundle, { force: true })
  const result = await runBash(script, src, { GITHUB_SHA: githubSha, BASE_SHA: baseSha })
  if (result.code !== 0) fail(`基线脚本失败（exit ${result.code}）：${result.err}\n${result.out}`)
  const verified = await runGit(['bundle', 'verify', bundle], src)
  if (verified.code !== 0) fail(`生成的 bundle 不能 verify：${verified.err || verified.out}`)
  return { ...result, report: `${verified.out}\n${verified.err}` }
}

async function verifyBaselineFallback() {
  const ci = await read('.github/workflows/ci.yml')
  const script = extractBaselineScript(ci)
  const dir = await mkdtemp(join(tmpdir(), 'qx-baseline-'))
  try {
    const src = join(dir, 'src')
    await runGit(['init', '-q', '--initial-branch=main', src], dir)
    await runGit(['config', 'user.email', 'verify@example.invalid'], src)
    await runGit(['config', 'user.name', 'verify'], src)
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    await commitFile(src, 'root.txt', 'root\n', 'root', daysAgo(40))
    const earliest = await commitFile(src, 'early.txt', 'early\n', 'early', daysAgo(30))
    const fallback = await commitFile(src, 'fallback.txt', 'fallback\n', 'fallback', daysAgo(20))
    const release = await commitFile(src, 'tip.txt', 'tip\n', 'tip')
    const tree = await runGit(['mktree'], src, { input: '' })
    if (tree.code !== 0) fail(tree.err)
    const unrelated = await runGit(['commit-tree', tree.out.trim(), '-m', 'unrelated'], src)
    if (unrelated.code !== 0) fail(unrelated.err)
    const side = unrelated.out.trim()

    const withBaseline = await runBaselineCase(script, src, release, earliest)
    if (!withBaseline.out.includes('基线来源：latest-deployed')) fail(`有基线却没有标明来源：${withBaseline.out}`)
    if (!withBaseline.report.includes(earliest)) fail('有基线时 bundle 的前置提交不是给定基线')

    const withoutBaseline = await runBaselineCase(script, src, release, '')
    if (!withoutBaseline.out.includes('基线来源：14 天前兜底')) fail(`无基线却没有走 14 天兜底：${withoutBaseline.out}`)
    if (!withoutBaseline.report.includes(fallback)) fail(`无基线时没有用 14 天前的提交当前置：${withoutBaseline.report}`)
    if (withoutBaseline.report.includes(earliest)) fail('无基线时用了更早的提交，14 天前兜底没有生效')

    const notAncestor = await runBaselineCase(script, src, release, side)
    if (!notAncestor.out.includes('基线来源：14 天前兜底')) fail(`基线不是祖先时没有兜底：${notAncestor.out}`)
    if (!notAncestor.report.includes(fallback)) fail('基线不是祖先时 bundle 没有落到 14 天前的提交')
    if (notAncestor.out.includes('基线来源：latest-deployed')) fail('不是祖先的基线被当成 latest-deployed')

    const recent = join(dir, 'recent')
    await runGit(['init', '-q', '--initial-branch=main', recent], dir)
    await runGit(['config', 'user.email', 'verify@example.invalid'], recent)
    await runGit(['config', 'user.name', 'verify'], recent)
    await commitFile(recent, 'a.txt', 'a\n', 'a')
    const recentMiddle = await commitFile(recent, 'b.txt', 'b\n', 'b')
    const recentTip = await commitFile(recent, 'c.txt', 'c\n', 'c')
    const recentFallback = await runBaselineCase(script, recent, recentTip, '')
    if (!recentFallback.out.includes('基线来源：14 天前兜底')) fail(`14 天内的历史没有改用最早的非根提交：${recentFallback.out}`)
    if (!recentFallback.report.includes(recentMiddle)) fail('根提交之外的最早提交没有成为 bundle 前置')
    if (recentFallback.report.includes('complete history')) fail('还有非根提交时不应打完整包')

    const solo = join(dir, 'solo')
    await runGit(['init', '-q', '--initial-branch=main', solo], dir)
    await runGit(['config', 'user.email', 'verify@example.invalid'], solo)
    await runGit(['config', 'user.name', 'verify'], solo)
    const only = await commitFile(solo, 'only.txt', 'only\n', 'only')
    const full = await runBaselineCase(script, solo, only, '')
    if (!full.out.includes('基线来源：完整包')) fail(`无法取得非根基线时没有打完整包：${full.out}`)
    if (!/完整包大小：\d+ 字节/.test(full.out)) fail(`完整包没有打印大小：${full.out}`)
    if (!full.report.includes('complete history')) fail('完整包仍带有前置提交')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

try {
  await verifyStaticContracts()
  await verifyMutations()
  await verifyRealBundleRoundTrip()
  await verifyBaselineFallback()
  console.log('PASS: real git bundle round-trip and all baseline fallback cases')
  await verifyLoopbackBos()
  await verifyErrorDiagnostics()
  console.log('ALL PASS: release bundle contracts, mutations, loopback BOS round-trip, error diagnostics, baseline fallback, and a real git bundle round-trip')
} catch (error) {
  console.error(`FAIL: ${error.message}`)
  process.exit(1)
}
