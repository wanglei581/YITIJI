// ============================================================================
// 门禁：思考模式在线探针的离线自检（verify:llm-thinking-live-gate）
//
// 为什么单独一个文件，不写进 check-llm-thinking-live.ts：
//   那个脚本是运维在服务器上跑的在线探针，有密钥时会访问模型。
//   本门禁进 CI，必须零网络。断言放进在线脚本会让 CI 要么真去打模型，
//   要么在缺密钥时把探针本身跑成「跳过也算通过」——正是要挡住的事。
//
// 覆盖：
//   1. 槽位和 .env 都没有密钥 → 退出码非 0，打印「未验证：DeepSeek」，不发起请求。
//   2. --allow-skip → 退出码 0，仍打印「未验证」。
//   3. --tts 且没有腾讯密钥 → 「未验证：音色」，没有 --allow-skip 时退出码非 0。
//   4. 假密钥只放在后台槽位文件，或只放在 dotenv 文件（都不放进 process.env）
//      → 探针用到了该密钥（预加载的 fetch 桩记下用的是哪一把），输出不含这串假密钥，
//      也不含它的头尾片段。
//   5. 槽位和 .env 各有一把不同的假密钥 → 实际发出的是槽位那把。
//   6. 有密钥但上游失败，即使带了 --allow-skip 也是非 0（--allow-skip 只放过「未验证」）。
//
// 反向变异：缺密钥改回退出 0 → 红在 1；把密钥打到 stdout → 红在 4。
// fetch 桩写在临时目录，用 node -r 在探针之前换掉全局 fetch，请求不会出网。
// ============================================================================
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { encryptSecret } from '../src/common/crypto/secret-cipher'

const TEST_ENC = 'verify-llm-thinking-live-gate-key-0123456789'
process.env['SECRET_ENCRYPTION_KEY'] = TEST_ENC

const API_ROOT = join(__dirname, '..')
const PROBE = join(__dirname, 'check-llm-thinking-live.ts')
const SLOT_KEY = 'probe-slot-fake-7e1c9b2d4a6f8035'
const ENV_KEY = 'probe-env-fake-91ab33c0d5e64728aa'
const SECRET_MARKS = [SLOT_KEY, ENV_KEY, SLOT_KEY.slice(0, 16), ENV_KEY.slice(0, 15), SLOT_KEY.slice(-8), ENV_KEY.slice(-8)]

const FETCH_STUB = `'use strict'
const fs = require('fs')
const marker = process.env.LLM_THINKING_PROBE_FETCH_MARKER
const slot = process.env.LLM_THINKING_PROBE_SLOT_KEY || ''
const envKey = process.env.LLM_THINKING_PROBE_ENV_KEY || ''
const status = Number(process.env.LLM_THINKING_PROBE_FETCH_STATUS || 200)
global.fetch = async function (_url, init) {
  const headers = (init && init.headers) || {}
  const auth = String(headers.Authorization || headers.authorization || '')
  let which = 'other'
  if (slot && auth.includes(slot)) which = 'slot'
  else if (envKey && auth.includes(envKey)) which = 'env'
  if (marker) fs.appendFileSync(marker, which + '\\n')
  const body = status >= 200 && status < 300
    ? { choices: [{ message: { content: '好' } }], usage: { completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 0 } } }
    : { error: { code: 'ProbeStub', message: 'upstream rejected' } }
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
`

process.exitCode = 1
let passed = 0
let failed = 0
const trash: string[] = []

function redactGate(text: string): string {
  let out = text
  for (const mark of SECRET_MARKS) out = out.split(mark).join('[REDACTED]')
  return out
}

function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${label}`)
    return
  }
  failed += 1
  console.log(`  FAIL  ${label}${detail ? ` —— ${redactGate(detail).slice(0, 500)}` : ''}`)
}

function leaked(text: string): boolean {
  return SECRET_MARKS.some((mark) => mark.length >= 8 && text.includes(mark))
}

interface Fixture {
  dir: string
  dotenvPath: string
  dataDir: string
  marker: string
}

function makeFixture(envBody: string, slotKey?: string): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'llm-thinking-probe-'))
  trash.push(dir)
  const dataDir = join(dir, 'data')
  mkdirSync(dataDir)
  const dotenvPath = join(dir, 'dotenv')
  writeFileSync(dotenvPath, envBody.endsWith('\n') ? envBody : `${envBody}\n`)
  const marker = join(dir, 'fetch-marker')
  writeFileSync(marker, '')
  writeFileSync(join(dir, 'fetch-stub.cjs'), FETCH_STUB)
  if (slotKey) {
    writeFileSync(join(dataDir, 'ai-model-configs.json'), JSON.stringify({
      assistant_chat: {
        vendor: 'deepseek',
        model: 'deepseek-flash',
        baseURL: 'https://api.deepseek.com/v1',
        enabled: true,
        explicitlyConfigured: true,
        apiKeyEncrypted: encryptSecret(slotKey),
      },
    }))
  }
  return { dir, dotenvPath, dataDir, marker }
}

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  marker: string
}

function runProbe(fixture: Fixture, args: string[], opts: { slot?: string; env?: string; status?: string } = {}): RunResult {
  const res = spawnSync(process.execPath, [
    '-r', join(fixture.dir, 'fetch-stub.cjs'),
    '-r', '@swc-node/register',
    PROBE,
    ...args,
  ], {
    cwd: API_ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
      TMPDIR: process.env['TMPDIR'] ?? '/tmp',
      LANG: 'C.UTF-8',
      SECRET_ENCRYPTION_KEY: TEST_ENC,
      DOTENV_CONFIG_PATH: fixture.dotenvPath,
      FILE_STORAGE_DIR: fixture.dataDir,
      LLM_THINKING_PROBE_FETCH_MARKER: fixture.marker,
      LLM_THINKING_PROBE_SLOT_KEY: opts.slot ?? '',
      LLM_THINKING_PROBE_ENV_KEY: opts.env ?? '',
      LLM_THINKING_PROBE_FETCH_STATUS: opts.status ?? '200',
    },
  })
  return {
    code: res.status,
    stdout: res.stdout ?? '',
    stderr: `${res.stderr ?? ''}${res.error ? `\n${res.error.name}` : ''}`,
    marker: readFileSync(fixture.marker, 'utf8'),
  }
}

function outputOf(result: RunResult): string {
  return `${result.stdout}\n${result.stderr}`
}

function markerLines(result: RunResult): string[] {
  return result.marker.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
}

try {
  console.log('── 1 缺密钥不得当成通过 ──')
  {
    const result = runProbe(makeFixture(''), [])
    const text = outputOf(result)
    check(result.code !== 0, '缺密钥退出码非 0', `实际 ${String(result.code)}`)
    check(result.stdout.includes('未验证：DeepSeek'), '缺密钥打印「未验证：DeepSeek」', result.stdout)
    check(result.stdout.includes('后台 AI 槽位与服务 .env 都没有可用密钥'), '缺密钥说明槽位和 .env 都没有', result.stdout)
    check(!result.stdout.includes('跳过 DeepSeek') && !result.stdout.includes('跳过音色'), '不再打印「跳过也算过」的旧文案', result.stdout)
    check(markerLines(result).length === 0, '缺密钥不发起请求', result.marker)
    check(!leaked(text), '缺密钥的输出不含假密钥', text)
  }

  console.log('── 2 --allow-skip 仍要标明未验证 ──')
  {
    const result = runProbe(makeFixture(''), ['--allow-skip'])
    check(result.code === 0, '--allow-skip 退出码 0', `实际 ${String(result.code)} ${result.stderr}`)
    check(result.stdout.includes('未验证'), '--allow-skip 仍打印「未验证」', result.stdout)
    check(result.stdout.includes('未验证：DeepSeek'), '--allow-skip 写明未验证的是 DeepSeek', result.stdout)
    check(!leaked(outputOf(result)), '--allow-skip 的输出不含假密钥')
  }

  console.log('── 3 音色被跳过同样不算通过 ──')
  {
    const missing = runProbe(makeFixture(''), ['--tts'])
    check(missing.code !== 0, '--tts 缺密钥退出码非 0', `实际 ${String(missing.code)}`)
    check(missing.stdout.includes('未验证：音色'), '--tts 缺密钥打印「未验证：音色」', missing.stdout)
    check(missing.stdout.includes('未验证：DeepSeek'), '--tts 同时缺模型密钥也打印 DeepSeek', missing.stdout)
    const allowed = runProbe(makeFixture(''), ['--tts', '--allow-skip'])
    check(allowed.code === 0, '--tts --allow-skip 退出码 0', `实际 ${String(allowed.code)} ${allowed.stderr}`)
    check(allowed.stdout.includes('未验证：音色') && allowed.stdout.includes('未验证：DeepSeek'), '--tts --allow-skip 两项都标明未验证', allowed.stdout)
  }

  console.log('── 4 用到的假密钥不得出现在输出里 ──')
  {
    const slot = runProbe(makeFixture('', SLOT_KEY), [], { slot: SLOT_KEY })
    const slotText = outputOf(slot)
    check(slot.code === 0, '只有槽位密钥时核对完成、退出码 0', `实际 ${String(slot.code)} ${slot.stderr}`)
    check(!slot.stdout.includes('未验证：DeepSeek'), '槽位密钥不算未验证', slot.stdout)
    check(slot.stdout.includes('密钥来源：后台 AI 槽位 assistant_chat'), '输出来源写的是后台槽位', slot.stdout)
    check(markerLines(slot).length === 2 && markerLines(slot).every((line) => line === 'slot'), '两次请求用的都是槽位密钥', slot.marker)
    check(!leaked(slotText), '槽位密钥及其片段不在输出里', slotText)

    const envOnly = runProbe(makeFixture(`AI_LLM_API_KEY=${ENV_KEY}\n`), [], { env: ENV_KEY })
    const envText = outputOf(envOnly)
    check(envOnly.code === 0, '只有 .env 密钥时核对完成、退出码 0', `实际 ${String(envOnly.code)} ${envOnly.stderr}`)
    check(!envOnly.stdout.includes('未验证：DeepSeek'), '.env 密钥不算未验证', envOnly.stdout)
    check(envOnly.stdout.includes('密钥来源：服务 .env AI_LLM_API_KEY'), '输出来源写的是服务 .env', envOnly.stdout)
    check(markerLines(envOnly).length === 2 && markerLines(envOnly).every((line) => line === 'env'), '两次请求用的都是 .env 密钥', envOnly.marker)
    check(!leaked(envText), '.env 密钥及其片段不在输出里', envText)
  }

  console.log('── 5 槽位优先于 .env ──')
  {
    const both = runProbe(makeFixture(`AI_LLM_API_KEY=${ENV_KEY}\n`, SLOT_KEY), [], { slot: SLOT_KEY, env: ENV_KEY })
    check(both.code === 0, '两处都有密钥时退出码 0', `实际 ${String(both.code)} ${both.stderr}`)
    check(both.stdout.includes('密钥来源：后台 AI 槽位 assistant_chat'), '来源标明槽位而不是 .env', both.stdout)
    check(markerLines(both).every((line) => line === 'slot') && markerLines(both).length === 2, '发出的是槽位密钥', both.marker)
    check(!leaked(outputOf(both)), '两把密钥都不在输出里', outputOf(both))
  }

  console.log('── 6 上游失败不是跳过 ──')
  {
    const failedCall = runProbe(makeFixture(`AI_LLM_API_KEY=${ENV_KEY}\n`), ['--allow-skip'], { env: ENV_KEY, status: '401' })
    check(failedCall.code !== 0, '上游失败时 --allow-skip 仍然非 0', `实际 ${String(failedCall.code)}`)
    check(failedCall.stdout.includes('未通过：DeepSeek'), '上游失败打印「未通过：DeepSeek」', failedCall.stdout)
    check(!failedCall.stdout.includes('未验证：DeepSeek'), '已经发起的核对不叫未验证', failedCall.stdout)
    check(!leaked(outputOf(failedCall)), '失败输出也不含密钥', outputOf(failedCall))
  }

  console.log('── 7 只跳过音色时整次仍未通过 ──')
  {
    const voice = runProbe(makeFixture(`AI_LLM_API_KEY=${ENV_KEY}\n`), ['--tts'], { env: ENV_KEY })
    check(voice.code !== 0, '模型核对完成但音色被跳过 → 非 0', `实际 ${String(voice.code)}`)
    check(voice.stdout.includes('未验证：音色'), '打印「未验证：音色」', voice.stdout)
    check(!voice.stdout.includes('未验证：DeepSeek'), '已核对的 DeepSeek 不标成未验证', voice.stdout)
    check(!leaked(outputOf(voice)), '这条输出也不含密钥')
  }
} finally {
  for (const dir of trash) rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${passed} PASS / ${failed} FAIL`)
if (failed === 0) process.exitCode = 0
