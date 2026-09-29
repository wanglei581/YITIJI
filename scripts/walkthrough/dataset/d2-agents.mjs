// 用模拟 Agent 绑定 WALK-002/003/004 并脱离终端常驻。
// 绑定码从标准输入送进 sim-agent（--code -），避免出现在进程参数里。
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { TERMINALS } from './d2-catalog.mjs'
import { API_BASE, EVID, ROOT, SECRET, SIM_AGENT, logOffline, shanghaiIso, writePrivate } from './d2-lib.mjs'

const PYTHON = String.raw`
import os, sys
log_path = sys.argv[1]
cmd = sys.argv[2:]
pid = os.fork()
if pid > 0:
    print(pid, flush=True)
    raise SystemExit(0)
os.setsid()
fd = os.open(log_path, os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o644)
os.dup2(fd, 1)
os.dup2(fd, 2)
os.close(fd)
devnull = os.open('/dev/null', os.O_RDONLY)
os.dup2(devnull, 0)
os.close(devnull)
os.execvp(cmd[0], cmd)
`

function agentDir(code) {
  return join(homedir(), '.cache/walk0929', `sim-agent-${code.slice(-3)}`)
}

function readBindCode(code) {
  const path = join(SECRET, `bind-${code}.txt`)
  if (!existsSync(path)) throw new Error(`没有 ${path}`)
  const codeText = readFileSync(path, 'utf8').trim()
  if (!codeText) throw new Error(`绑定码文件是空的 ${code}`)
  return codeText
}

function redact(text, secret) {
  return String(text ?? '').split(secret).join('<绑定码>')
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function readRunPid(dir) {
  const path = join(dir, 'run.json')
  if (!existsSync(path)) return null
  try {
    const pid = JSON.parse(readFileSync(path, 'utf8')).pid
    return pidAlive(pid) ? pid : null
  } catch {
    return null
  }
}

function bindAgent(terminal) {
  const dir = agentDir(terminal.code)
  if (existsSync(join(dir, 'credential.json'))) return { dir, bound: '已有凭证，跳过 bind' }
  const secret = readBindCode(terminal.code)
  const result = spawnSync(process.execPath, [SIM_AGENT, 'bind', '--api', API_BASE, '--code', '-'], {
    input: `${secret}\n`,
    env: { ...process.env, SIM_AGENT_DIR: dir },
    encoding: 'utf8',
    timeout: 30000,
  })
  const output = redact(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, secret)
  if (result.status !== 0) throw new Error(`bind ${terminal.code} 失败：${output.slice(0, 400)}`)
  return { dir, bound: output.replace(/\s+/g, ' ').slice(0, 240) }
}

function startAgent(terminal, dir) {
  const existing = readRunPid(dir)
  if (existing) return existing
  const logPath = join(ROOT, 'logs', `sim-agent-${terminal.code.slice(-3)}.log`)
  const started = spawnSync('python3', ['-c', PYTHON, logPath, process.execPath, SIM_AGENT, 'run', '--api', API_BASE, '--bridge-port', String(terminal.port), '--kiosk-origin', terminal.origin], {
    env: { ...process.env, SIM_AGENT_DIR: dir },
    encoding: 'utf8',
    timeout: 15000,
  })
  if (started.status !== 0) throw new Error(`脱离启动失败 ${terminal.code}：${started.stderr || started.stdout}`)
  const pid = Number(String(started.stdout).trim().split(/\s+/)[0])
  if (!pidAlive(pid)) throw new Error(`模拟终端进程没有留下来 ${terminal.code} pid=${started.stdout}`)
  return pid
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export async function startSimAgents(h) {
  const lines = [`# dataset v2 sim agents ${shanghaiIso()}`]
  const summary = []
  for (const terminal of TERMINALS.filter((item) => !item.existing)) {
    const { dir, bound } = bindAgent(terminal)
    const pid = startAgent(terminal, dir)
    lines.push(`${terminal.code} pid=${pid} bridge=${terminal.port} dir=${dir}`)
    summary.push(`${terminal.code} pid=${pid} 网桥 ${terminal.port}；${bound}`)
    const line = { action: '模拟终端绑定并常驻', input: `${terminal.code} 网桥 ${terminal.port}`, result: `pid ${pid}；${bound}` }
    if (h) await h.log(line)
    else logOffline({ side: '模拟终端', url: `http://127.0.0.1:${terminal.port}/local/panel`, ...line })
  }
  sleepSync(2000)
  for (const terminal of TERMINALS.filter((item) => !item.existing)) {
    if (!pidAlive(Number(lines.find((line) => line.startsWith(terminal.code))?.match(/pid=(\d+)/)?.[1]))) {
      throw new Error(`${terminal.code} 启动后很快退出，见 logs/sim-agent-${terminal.code.slice(-3)}.log`)
    }
  }
  const path = join(homedir(), '.cache/walk0929/pids-v2.txt')
  writePrivate(path.startsWith('/') ? path : path, `${lines.join('\n')}\n`)
  // writePrivate 对绝对路径会 chmod 0600。pids 不是密钥，改回 0644 方便查看。
  spawnSync('chmod', ['644', path])
  return { path, summary, evidence: EVID }
}
