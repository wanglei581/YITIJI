#!/usr/bin/env node
// 门禁：发布时从 GitHub 拉取超时或被打断，不得留下进程占住 SSH 会话。
//
// 2026-11-09 run 42578558995：BOS 上没有包，发布改走 GitHub 拉取，两次各 600 秒超时后脚本已经退出，
// 但 `timeout --foreground` 只杀了 git，它经 ssh 起的子进程还活着、占着会话的 stdout/stderr，
// 「Deploy via SSH」一直显示在跑，最后手动取消（不取消要挂满 45 分钟的 command_timeout）。
//
// 本门禁从 deploy.yml 原样取出拉取段，换上假 git 真跑（只把 600 秒换成 2 秒、重试间隔换成 0）。
// 假 git 会留下三种进程：像 ssh 的普通子进程、不理 TERM 的子进程、逃出进程组还占着输出的进程。
// 要求：拉取段按时结束、会话不被占住；前两种进程被清掉；git 的输出照样回显；临时日志删掉；
// 拉取途中脚本收到 TERM 时，清理函数把在跑的那一组拉取进程一起收掉。
// 再对拉取段做三处反向改动（加回 --foreground、去掉输出重定向、去掉整组 KILL），每一处都必须被演练抓到。
//
// 时序：机器忙时假 git 可能还没起好子进程就到点了（11/12 本机实测 1 秒预算五次红一次，红的那次
// 是「只登记到 1 个、没有一个活着」）。所以先跑成功路径预热假 git，超时预算给 2 秒，逃出进程组的
// 进程用 bash 的 `set -m` 就地生成；每类进程至少登记到 1 个，登记到的必须全部被清掉。
//
// 只用 node 内置模块（CI 在 pnpm install 之前跑）。需要 GNU coreutils 的 timeout 和 mktemp（服务器与 CI 都是）。

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const deploy = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8')
const SHA = 'a'.repeat(40)
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? `\n    ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function block(startMarker, endMarker) {
  const lines = deploy.split('\n')
  const start = lines.findIndex((line) => line.includes(startMarker))
  const end = lines.findIndex((line, index) => index > start && line.includes(endMarker))
  if (start < 0 || end < 0) throw new Error(`deploy.yml 里找不到片段：${startMarker} → ${endMarker}`)
  const picked = lines.slice(start, end + 1)
  const indent = picked[0].match(/^\s*/)[0].length
  return picked.map((line) => line.slice(Math.min(indent, line.match(/^\s*/)[0].length))).join('\n')
}

function swap(text, from, to) {
  if (!text.includes(from)) throw new Error(`拉取段里找不到「${from}」：deploy.yml 改了写法，本门禁的锚点要一起改`)
  return text.split(from).join(to)
}

const fetchBlock = block('FETCH_LOG="$(mktemp', 'rm -f -- "$FETCH_LOG"')
const cleanupBlock = block('cleanup_control_plane_helper() {', "trap 'on_control_plane_signal 141' PIPE")

console.log('一、静态')
check('拉取不带 --foreground（超时信号要发给整个进程组）', !/timeout\s+--foreground/.test(deploy))
check('拉取输出先进日志文件，不直通 SSH 会话', fetchBlock.includes('</dev/null >"$FETCH_LOG" 2>&1 &'))
check('timeout 退出后对整组补一次 KILL', fetchBlock.includes('kill -KILL -- "-$FETCH_PID" 2>/dev/null || true'))
check('被信号打断时，清理函数也收掉在跑的拉取组', cleanupBlock.includes('kill -KILL -- "-$FETCH_PID" 2>/dev/null || true'))

const tools = spawnSync('bash', ['-c', 'timeout --version; mktemp --version'], { encoding: 'utf8' })
if (!/timeout \(GNU coreutils\)/.test(tools.stdout) || !/mktemp \(GNU coreutils\)/.test(tools.stdout)) {
  console.error('FAIL: 演练需要 GNU coreutils 的 timeout 和 mktemp（服务器与 CI 都是；macOS 先 brew install coreutils，把 gnubin 放进 PATH）')
  process.exit(1)
}

const work = mkdtempSync(join(tmpdir(), 'deploy-fetch-drill-'))
const bin = join(work, 'bin')
mkdirSync(bin)
writeFileSync(join(bin, 'git'), `#!/bin/bash
# 假 git：ok 模式马上成功；hang 模式留下三种进程后自己卡住，等 timeout 来收。
echo "fake-git: $*" >&2
if [ "$FAKE_GIT_MODE" = ok ]; then echo 'fake-git: fetched'; exit 0; fi
set -m
sleep 60 &
echo "escaped $!" >> "$DRILL_PIDS"
set +m
sleep 60 &
echo "plain $!" >> "$DRILL_PIDS"
( trap '' TERM; exec sleep 60 ) &
echo "stubborn $!" >> "$DRILL_PIDS"
exec sleep 60
`, { mode: 0o755 })

const allPids = new Set()
const readPids = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '')
  .split('\n').filter(Boolean).map((line) => {
    const [kind, pid] = line.split(' ')
    allPids.add(Number(pid))
    return { kind, pid: Number(pid) }
  })
// 已退出但还没被回收的僵尸进程不算活着。
const alive = (pid) => {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat[stat.lastIndexOf(')') + 2] !== 'Z'
  } catch {
    const state = (spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? '').trim()
    return state !== '' && !state.startsWith('Z')
  }
}
// 被杀的进程要等新父进程回收，给 3 秒。
async function allDead(pids) {
  for (let waited = 0; waited < 3000; waited += 100) {
    if (!pids.some(alive)) return true
    await sleep(100)
  }
  return false
}
const leftLogs = () => readdirSync(work).filter((name) => name.startsWith('deploy-fetch-'))
const drill = (text, budget = '2s') => swap(swap(swap(text,
  'timeout --kill-after=10s 600s', `timeout --kill-after=1s ${budget}`),
  'sleep "$((ATTEMPT * 5))"', 'sleep 0'),
  'mktemp /tmp/deploy-fetch-', `mktemp ${work}/deploy-fetch-`)
const drillEnv = (mode, pids) => ({ ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_GIT_MODE: mode, DRILL_PIDS: pids })

async function runFetch(name, text, mode) {
  const pidsFile = join(work, `${name}.pids`)
  const script = join(work, `${name}.sh`)
  writeFileSync(script, `set -euo pipefail\nEXPECTED_SHA=${SHA}\nFETCH_OK=0\n${text}\necho "FETCH_OK=$FETCH_OK"\n`)
  const started = Date.now()
  // 正常两次各 2 秒；会话被占住时要等到这个上限才返回，所以假 git 留下的进程都睡 60 秒。
  const result = spawnSync('bash', [script], { encoding: 'utf8', timeout: 12000, env: drillEnv(mode, pidsFile) })
  const seconds = (Date.now() - started) / 1000
  const pids = readPids(pidsFile)
  const of = (kind) => pids.filter((entry) => entry.kind === kind).map((entry) => entry.pid)
  const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const problems = []
  if (result.error || result.status !== 0) problems.push(`拉取段没有按时结束（会话被占住）：status=${result.status} error=${result.error?.code ?? '-'} 用时 ${seconds}s`)
  if (mode === 'hang') {
    for (const [kind, message] of [['plain', '像 ssh 的普通子进程没有随整组被收掉'], ['stubborn', '不理 TERM 的子进程没有被整组 KILL 收掉']]) {
      const recorded = of(kind)
      if (recorded.length < 1 || !(await allDead(recorded))) problems.push(`${message}（登记 ${recorded.length} 个，仍活着：${recorded.filter(alive).join(',') || '无'}）`)
    }
    if ((out.match(/fetch 失败，退出码 124/g) ?? []).length !== 2 || !out.includes('FETCH_OK=0')) problems.push('两次超时没有按退出码 124 记失败')
  } else if (!out.includes('fake-git: fetched') || !out.includes('fetch 成功') || !out.includes('FETCH_OK=1')) {
    problems.push('成功路径没有回显 git 输出或没有记成功')
  }
  if (!out.includes(`fake-git: -c http.version=HTTP/1.1 fetch --no-tags --depth=1 origin ${SHA}`)) problems.push('git 的输出没有回显到发布日志')
  if (leftLogs().length) problems.push(`临时日志没删：${leftLogs().join(', ')}`)
  return problems
}

let exitCode = 1
try {
  console.log('二、演练（假 git，超时 2 秒）')
  // 先走成功路径：顺带把假 git 预热一遍（新写出的脚本第一次执行可能慢），预算放宽，不测超时。
  const ok = await runFetch('ok', drill(fetchBlock, '30s'), 'ok')
  check('成功：回显 git 输出并记成功', ok.length === 0, ok.join('；'))
  const hang = await runFetch('hang', drill(fetchBlock), 'hang')
  check('超时：按时结束，普通与不理 TERM 的子进程都被收掉，输出照样回显，日志删掉', hang.length === 0, hang.join('；'))

  // 拉取途中脚本收到 TERM：清理函数要把在跑的拉取组一起收掉，并以 143 退出。
  const pidsFile = join(work, 'signal.pids')
  const helper = join(work, 'helper.sh')
  writeFileSync(helper, 'helper\n')
  const script = join(work, 'signal.sh')
  writeFileSync(script, `set -euo pipefail\nCONTROL_PLANE_HELPER=${helper}\n${swap(cleanupBlock, '/tmp/release.bundle', `${work}/release.bundle`)}\nEXPECTED_SHA=${SHA}\nFETCH_OK=0\n${drill(fetchBlock, '30s')}\necho "FETCH_OK=$FETCH_OK"\n`)
  const child = spawn('bash', [script], { env: drillEnv('hang', pidsFile), stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  const closed = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })))
  for (let waited = 0; waited < 10000 && !readPids(pidsFile).some((entry) => entry.kind === 'stubborn'); waited += 50) await sleep(50)
  await sleep(200)
  child.kill('SIGTERM')
  const ended = await Promise.race([closed, sleep(5000).then(() => null)])
  if (!ended) child.kill('SIGKILL')
  const fetchPids = readPids(pidsFile).filter((entry) => entry.kind !== 'escaped').map((entry) => entry.pid)
  check('拉取途中收到 TERM：以 143 退出，拉取组被收掉，日志和 helper 删掉',
    ended?.code === 143 && fetchPids.length === 2 && (await allDead(fetchPids)) && !leftLogs().length && !existsSync(helper) && !output.includes('FETCH_OK='),
    `结束=${JSON.stringify(ended)} 拉取进程=${fetchPids.join(',')} 日志=${leftLogs().join(',')} helper 还在=${existsSync(helper)}\n${output}`)

  console.log('三、反向改动必须被演练抓到')
  const drilled = drill(fetchBlock)
  const mutations = [
    ['加回 --foreground', swap(drilled, 'timeout --kill-after=1s 2s', 'timeout --foreground --kill-after=1s 2s')],
    ['去掉输出重定向', swap(drilled, '</dev/null >"$FETCH_LOG" 2>&1 &', '&')],
    ['去掉整组 KILL', swap(drilled, 'kill -KILL -- "-$FETCH_PID" 2>/dev/null || true\n', '')],
  ]
  for (const [index, [name, text]] of mutations.entries()) {
    const problems = await runFetch(`mutation-${index}`, text, 'hang')
    check(`反向改动「${name}」被抓到：${problems.join('；')}`, problems.length > 0, '改坏后演练仍然全部通过，本门禁失去作用')
    for (const file of leftLogs()) rmSync(join(work, file), { force: true })
  }
  exitCode = failures === 0 ? 0 : 1
} catch (error) {
  failures += 1
  console.error(`FAIL（中止）: ${error.message}`)
} finally {
  for (const pid of allPids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // 已经不在了
    }
  }
  rmSync(work, { recursive: true, force: true })
}
console.log(exitCode === 0 ? '\nALL PASS: 发布拉取超时或被打断后不留进程占住 SSH 会话' : `\n❌ ${failures} 项失败`)
process.exit(exitCode)
