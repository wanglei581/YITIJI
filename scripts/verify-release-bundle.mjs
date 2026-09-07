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
  assert.ok((releaseJob.match(/continue-on-error: true/g) ?? []).length >= 2, 'all BOS steps must be best-effort')
  assert.ok(!/echo[^\n]*(BOS_RELEASE_ACCESS_KEY|BOS_RELEASE_SECRET_KEY)/.test(releaseJob), 'CI must not echo BOS credentials')

  assert.ok(!/^import\s+(?!assert from 'node:|.*from 'node:)/m.test(client), 'BOS client may import only node built-ins')
  assert.ok(!/console\.log\([^\n]*(SECRET|Authorization)/i.test(client), 'BOS client must not log secrets or Authorization')
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
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stderr }))
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
function runGit(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
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

    const verified = await runGit(['bundle', 'verify', bundle], src)
    if (verified.code !== 0) fail(`生成的 bundle 校验失败：${verified.err.trim()}`)

    // 部署脚本按 SHA 从 bundle 取回目标提交，这里复现同一动作。
    const dst = join(dir, 'dst')
    await runGit(['clone', '-q', '--no-local', '--depth=1', '--branch', 'main', src, dst], dir)
    await runGit(['reset', '-q', '--hard', baseSha], dst).catch(() => undefined)
    const fetched = await runGit(['fetch', '--no-tags', bundle, releaseSha], dst)
    if (fetched.code !== 0) fail(`部署侧无法从 bundle 取回目标 SHA：${fetched.err.trim().split('\n').pop()}`)
    const has = await runGit(['cat-file', '-t', releaseSha], dst)
    if (has.out.trim() !== 'commit') fail('从 bundle 取回后目标 SHA 仍不可达，部署会回退到 GitHub 拉取')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

try {
  await verifyStaticContracts()
  await verifyMutations()
  await verifyLoopbackBos()
  await verifyRealBundleRoundTrip()
  console.log('ALL PASS: release bundle contracts, mutations, loopback BOS round-trip, and a real git bundle round-trip')
} catch (error) {
  console.error(`FAIL: ${error.message}`)
  process.exit(1)
}
