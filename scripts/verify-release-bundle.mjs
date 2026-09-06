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

try {
  await verifyStaticContracts()
  await verifyMutations()
  await verifyLoopbackBos()
  console.log('ALL PASS: release bundle contracts, mutations, and loopback BOS round-trip')
} catch (error) {
  console.error(`FAIL: ${error.message}`)
  process.exit(1)
}
