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
  required(releaseJob, /release-bundle mode=\$1 reason=\$2/, 'CI must log pack mode and reason')
  required(releaseJob, />> "\$GITHUB_STEP_SUMMARY"/, 'CI must write pack mode to the step summary')
  required(releaseJob, /git bundle create "\$BUNDLE" refs\/release\/target\s*$/m, 'invalid baseline must create a self-contained bundle')
  required(releaseJob, /bos-object\.mjs head "\$BUNDLE"/, 'CI must confirm the uploaded bundle is readable')
  required(releaseJob, /bos-object\.mjs head "\$CHECKSUM"/, 'CI must confirm the uploaded checksum is readable')
  const bundleHead = releaseJob.indexOf('bos-object.mjs head "$BUNDLE"')
  const checksumHead = releaseJob.indexOf('bos-object.mjs head "$CHECKSUM"')
  const uploaded = releaseJob.indexOf('echo "release-bundle uploaded=')
  assert.ok(bundleHead < checksumHead && checksumHead < uploaded, 'uploaded marker must follow both successful HEAD commands')
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
    const missingHead = await runNode(['scripts/release-bundle/bos-object.mjs', 'head', 'missing.bin'], env)
    assert.equal(missingHead.code, 3, 'local BOS HEAD must reject an absent object')
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
// 从 CI 标记之间提取完整打包 shell（不含 BOS put），在临时仓库执行。
// 接收端不得预先持有目标提交；存在性只看 git cat-file -e 的退出码。
function runCmd(command, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.once('error', reject)
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('close', (code) => resolve({ code, out, err }))
  })
}

function runGit(args, cwd) {
  return runCmd('git', args, cwd)
}

function extractPackShell(ci) {
  const begin = '# release-bundle-pack:begin'
  const end = '# release-bundle-pack:end'
  const start = ci.indexOf(begin)
  const stop = ci.indexOf(end)
  if (start < 0 || stop <= start) fail('release-bundle pack markers missing or unordered')
  if (ci.indexOf(begin, start + begin.length) >= 0 || ci.indexOf(end, stop + end.length) >= 0) fail('release-bundle pack markers must be unique')
  const lines = ci.slice(start + begin.length, stop).split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n').trim()
  if (!lines.startsWith('set -euo pipefail')) fail('pack shell indent boundary is wrong or fail-closed mode is missing')
  if (/\bexit 0\b/.test(lines)) fail('pack shell must not skip a missing baseline')
  if (/bos-object\.mjs/.test(lines)) fail('pack shell must not upload to BOS')
  const creates = lines.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('git bundle create '))
  if (creates.length !== 2
    || !creates.includes('git bundle create "$BUNDLE" refs/release/target "^$BASE_SHA"')
    || !creates.includes('git bundle create "$BUNDLE" refs/release/target')) {
    fail('pack shell must create one strict incremental bundle and one self-contained full bundle')
  }
  if (/git bundle create\s+"\$BUNDLE"\s+"\$RELEASE_SHA"/.test(lines)) fail('raw SHA bundle create is forbidden')
  if (!lines.includes('git update-ref refs/release/target "$RELEASE_SHA"')) fail('pack shell must pin refs/release/target')
  if (!lines.includes('git bundle verify "$BUNDLE"')) fail('pack shell must verify the bundle')
  if (!lines.includes('sha256sum "$BUNDLE"')) fail('pack shell must checksum the bundle')
  const after = ci.slice(stop + end.length)
  if (!after.includes('bos-object.mjs put "$BUNDLE" "$BUNDLE"') || !after.includes('bos-object.mjs put "$CHECKSUM" "$CHECKSUM"')) {
    fail('BOS upload must stay after the pack block')
  }
  return `${lines}\n`
}

async function gitOk(args, cwd) {
  const result = await runGit(args, cwd)
  assert.equal(result.code, 0, `git ${args.join(' ')} failed: ${result.err.trim()}`)
  return result
}

async function objectAbsent(repo, sha) {
  const result = await runGit(['cat-file', '-e', `${sha}^{commit}`], repo)
  assert.notEqual(result.code, 0, `${sha} must be absent before fetch`)
}

async function runPackTwice(scriptPath, src, dir, name, releaseSha, base, mode, reason) {
  const line = `release-bundle mode=${mode} reason=${reason}`
  let checksum = ''
  for (const pass of [1, 2]) {
    const summaryPath = join(dir, `${name}-${pass}.summary`)
    const result = await runCmd('bash', [scriptPath], src, {
      GITHUB_SHA: releaseSha,
      BASE_SHA: base,
      GITHUB_STEP_SUMMARY: summaryPath,
    })
    assert.equal(result.code, 0, `${name} pack ${pass} failed: ${result.err.trim()}`)
    assert.equal(result.out.includes(line), true, `${name} log missing ${line}`)
    assert.equal(await readFile(summaryPath, 'utf8'), `${line}\n`)
    const next = await readFile(join(src, `release-${releaseSha}.sha256`), 'utf8')
    if (!/^[0-9a-f]{64}  release\.bundle\n$/.test(next)) fail(`${name} checksum must name release.bundle`)
    if (pass === 2) assert.equal(next, checksum, `${name} same SHA rerun must keep the checksum`)
    checksum = next
  }
  const bundle = join(dir, `${name}.bundle`)
  const sumPath = join(dir, `${name}.sha256`)
  await writeFile(bundle, await readFile(join(src, `release-${releaseSha}.bundle`)))
  await writeFile(sumPath, checksum)
  return { bundle, sumPath }
}

async function proveReceiver(dir, src, name, packed, releaseSha, kind) {
  const repo = join(dir, `recv-${name}`)
  await gitOk(['init', '-q', '--initial-branch=main', repo], dir)
  if (kind === 'base') {
    const baseBundle = join(dir, 'base-only.bundle')
    await gitOk(['bundle', 'create', baseBundle, 'verify-base'], src)
    await gitOk(['fetch', '--no-tags', baseBundle, 'verify-base:refs/heads/base'], repo)
    await gitOk(['checkout', '-q', '--detach', 'base'], repo)
  }
  await writeFile(join(repo, 'release.bundle'), await readFile(packed.bundle))
  await writeFile(join(repo, 'release.sha256'), await readFile(packed.sumPath))
  const sum = await runCmd('sha256sum', ['-c', 'release.sha256'], repo)
  assert.equal(sum.code, 0, `${name} checksum failed: ${sum.err.trim()}`)
  const verified = await runGit(['bundle', 'verify', 'release.bundle'], repo)
  assert.equal(verified.code, 0, `${name} bundle verify failed: ${verified.err.trim()}`)
  await objectAbsent(repo, releaseSha)
  const fetched = await runGit(['fetch', '--no-tags', join(repo, 'release.bundle'), releaseSha], repo)
  assert.equal(fetched.code, 0, `${name} exact SHA fetch failed: ${fetched.err.trim()}`)
  await gitOk(['checkout', '-q', '--detach', releaseSha], repo)
  const present = await runGit(['cat-file', '-e', `${releaseSha}^{commit}`], repo)
  assert.equal(present.code, 0, `${name} target absent after checkout`)
  const head = await gitOk(['rev-parse', 'HEAD'], repo)
  assert.equal(head.out.trim(), releaseSha)
}

async function proveChecksumRejects(dir, packed) {
  const repo = join(dir, 'corrupt')
  await gitOk(['init', '-q', '--initial-branch=main', repo], dir)
  await writeFile(join(repo, 'release.bundle'), await readFile(packed.bundle))
  await writeFile(join(repo, 'release.sha256'), `${'0'.repeat(64)}  release.bundle\n`)
  const result = await runCmd('sha256sum', ['-c', 'release.sha256'], repo)
  assert.notEqual(result.code, 0, 'corrupt checksum must be rejected')
}

async function provePrerequisiteRejects(dir, packed, releaseSha) {
  const repo = join(dir, 'noprereq')
  await gitOk(['init', '-q', '--initial-branch=main', repo], dir)
  await objectAbsent(repo, releaseSha)
  await writeFile(join(repo, 'release.bundle'), await readFile(packed.bundle))
  const verified = await runGit(['bundle', 'verify', 'release.bundle'], repo)
  assert.notEqual(verified.code, 0, 'incremental bundle must be rejected without its prerequisite')
  const fetched = await runGit(['fetch', '--no-tags', join(repo, 'release.bundle'), releaseSha], repo)
  assert.notEqual(fetched.code, 0, 'exact fetch must be rejected without its prerequisite')
}

async function verifyRealBundleRoundTrip() {
  const packShell = extractPackShell(await read('.github/workflows/ci.yml'))
  const dir = await mkdtemp(join(tmpdir(), 'qx-bundle-'))
  const src = join(dir, 'src')
  try {
    await writeFile(join(dir, 'pack.sh'), packShell)
    await gitOk(['init', '-q', '--initial-branch=main', src], dir)
    await gitOk(['config', 'user.email', 'verify@example.invalid'], src)
    await gitOk(['config', 'user.name', 'verify'], src)
    const shas = []
    for (const n of [1, 2]) {
      await writeFile(join(src, `f${n}.txt`), `content ${n}\n`)
      await gitOk(['add', '-A'], src)
      await gitOk(['commit', '-q', '-m', `commit ${n}`], src)
      shas.push((await gitOk(['rev-parse', 'HEAD'], src)).out.trim())
    }
    const [baseSha, releaseSha] = shas
    await gitOk(['branch', 'verify-base', baseSha], src)
    await gitOk(['tag', '-a', 'verify-tag', '-m', 'not a commit checkpoint', releaseSha], src)
    const tagSha = (await gitOk(['rev-parse', 'verify-tag'], src)).out.trim()
    await gitOk(['checkout', '-q', '--orphan', 'side'], src)
    await writeFile(join(src, 'side.txt'), 'side\n')
    await gitOk(['add', '-A'], src)
    await gitOk(['commit', '-q', '-m', 'side'], src)
    const sideSha = (await gitOk(['rev-parse', 'HEAD'], src)).out.trim()
    await gitOk(['checkout', '-q', 'main'], src)
    const cases = [
      ['incremental', baseSha, 'incremental', 'strict-ancestor', 'base'],
      ['missing', '', 'full', 'baseline-missing', 'empty'],
      ['invalid', 'not-a-sha', 'full', 'baseline-invalid', 'empty'],
      ['unavailable', 'a'.repeat(40), 'full', 'baseline-unavailable', 'empty'],
      ['not-ancestor', sideSha, 'full', 'baseline-not-ancestor', 'empty'],
      ['equal', releaseSha, 'full', 'target-equals-baseline', 'empty'],
      ['upper', baseSha.toUpperCase(), 'full', 'baseline-invalid', 'empty'],
      ['tag', tagSha, 'full', 'baseline-unavailable', 'empty'],
    ]
    let incremental = null
    for (const [name, base, mode, reason, receiver] of cases) {
      const packed = await runPackTwice(join(dir, 'pack.sh'), src, dir, name, releaseSha, base, mode, reason)
      if (name === 'incremental') incremental = packed
      await proveReceiver(dir, src, name, packed, releaseSha, receiver)
    }
    await proveChecksumRejects(dir, incremental)
    await provePrerequisiteRejects(dir, incremental, releaseSha)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

try {
  await verifyStaticContracts()
  await verifyMutations()
  await verifyLoopbackBos()
  await verifyRealBundleRoundTrip()
  console.log('ALL PASS: release bundle contracts, mutations, loopback BOS, and incremental/full bundle round-trips')
} catch (error) {
  console.error(`FAIL: ${error.message}`)
  process.exit(1)
}
