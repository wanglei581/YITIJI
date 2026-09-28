import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import net from 'node:net'

// 进程级验证：用真实子进程抢同一个单实例端点（Windows 命名管道 / POSIX 套接字）。
// 不预写 instance-id：Windows 上首次启动必须自己生成它，否则新版 Agent 在任何机器上都起不来
// （2026-09-28 验收时发现过只读不写的版本，预写标识的测试把这个缺陷盖住了）。
const root = mkdtempSync(join(tmpdir(), 'terminal-agent-singleton-'))
const state = join(root, 'AIJobPrintAgent')
mkdirSync(state, { recursive: true })
const lockSource = (hold) => hold
  ? `require('./src/agent/instance-lock').acquireLock().then(() => { console.log('HELD'); setTimeout(() => {}, 600000) }).catch(e => { console.error(e.message); process.exit(2) })`
  : `require('./src/agent/instance-lock').acquireLock().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(2) })`
const identitySource = `try { console.log(require('./src/agent/instance-lock').__readMachineIdentityForTests()) } catch (e) { console.error(e.message); process.exit(3) }`

// 持有者一直活到被测试显式结束（CI 慢时 60 秒不够，自己到时退出会被误判成锁丢了）；收尾统一强杀。
const spawned = []
function run(source, programData) {
  const proc = spawn(process.execPath, ['-r', 'ts-node/register', '-e', source], {
    cwd: process.cwd(),
    env: { ...process.env, PROGRAMDATA: programData },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const out = { stdout: '', stderr: '', code: undefined }
  proc.stdout.on('data', (chunk) => { out.stdout += String(chunk) })
  proc.stderr.on('data', (chunk) => { out.stderr += String(chunk) })
  out.exited = new Promise((resolve) => proc.once('exit', (code) => { out.code = code; resolve(code) }))
  out.proc = proc
  spawned.push(proc)
  return out
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// 等子进程明确报「已持有」或已经退出，不用固定时长猜（慢机器上 ts-node 启动可能超过 1 秒）。
async function settle(child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.stdout.includes('HELD')) return 'held'
    if (child.code !== undefined) return 'exited'
    await wait(50)
  }
  return 'timeout'
}
const kill = async (child) => { child.proc.kill('SIGKILL'); await child.exited }
// 成批「连上即断」：持有者回令牌时撞上已关闭的连接（EPIPE / ECONNRESET），必须活下来。
// 逐个探测要几百次才碰上一次，成批并发在前几批就能打挂没修的版本（2026-09-29 本机校准）；
// Windows 命名管道的空闲实例少，并发取小一些，免得客户端卡在管道忙等待里。
async function hammerEarlyDisconnect(endpoint, owner) {
  const width = process.platform === 'win32' ? 4 : 20
  for (let round = 0; round < 50 && owner.code === undefined; round += 1) {
    await Promise.all(Array.from({ length: width }, () => new Promise((resolve) => {
      const socket = net.createConnection(endpoint)
      socket.once('connect', () => { socket.destroy(); resolve() })
      socket.once('error', () => resolve())
    })))
  }
  await wait(300)
}
const endpointOf = (child) => child.stdout.match(/instance-lock: acquired \((.+)\)/)?.[1]

try {
  // ── 机器标识：缺文件就生成、再次读取不变、并发生成结果一致、被改坏则拒绝 ──
  const idRoot = mkdtempSync(join(tmpdir(), 'terminal-agent-identity-'))
  try {
    const idFile = join(idRoot, 'AIJobPrintAgent', 'instance-id')
    const first = run(identitySource, idRoot)
    assert.equal(await first.exited, 0, `missing instance-id must be created, not fail\n${first.stderr}`)
    const created = first.stdout.trim()
    assert.match(created, /^[0-9a-f]{32}$/, 'created identity is 128-bit random hex')
    assert.equal(readFileSync(idFile, 'utf8').trim(), created, 'identity is persisted to the state directory')
    const again = run(identitySource, idRoot)
    assert.equal(await again.exited, 0)
    assert.equal(again.stdout.trim(), created, 'identity is stable across starts')

    const raceRoot = mkdtempSync(join(tmpdir(), 'terminal-agent-identity-race-'))
    const racers = [run(identitySource, raceRoot), run(identitySource, raceRoot)]
    await Promise.all(racers.map((r) => r.exited))
    assert.deepEqual(racers.map((r) => r.code), [0, 0], `concurrent first starts must both succeed\n${racers.map((r) => r.stderr).join('\n')}`)
    assert.equal(racers[0].stdout.trim(), racers[1].stdout.trim(), 'concurrent first starts must agree on one identity')
    rmSync(raceRoot, { recursive: true, force: true })

    writeFileSync(idFile, 'bad id with spaces\n')
    const tampered = run(identitySource, idRoot)
    assert.notEqual(await tampered.exited, 0, 'tampered identity must fail closed')
    assert.match(tampered.stderr, /machine_identity_invalid/, 'tampered identity must be reported as invalid, not silently replaced')
  } finally {
    rmSync(idRoot, { recursive: true, force: true })
  }

  // ── 单实例：持有期间第二个被拒、强杀后可立即启动、同时启动只有一个成功、残留 agent.pid 不阻止 ──
  // 状态目录里放一份带假令牌的 agent.token：被拒时写出的诊断文件不得带出它。
  const tokenCanary = 'SENSITIVE_AGENT_TOKEN_CANARY_XYZ'
  writeFileSync(join(state, 'agent.token'), `${tokenCanary}\n`)
  const diagnosticPath = join(state, 'last-startup-diagnostic.json')
  const holder = run(lockSource(true), root)
  assert.equal(await settle(holder), 'held', `first instance must acquire and stay alive\n${holder.stderr}`)
  if (process.platform === 'win32') {
    assert.ok(existsSync(join(state, 'instance-id')), 'Windows first start must create instance-id')
  }
  const holderEndpoint = endpointOf(holder)
  assert.ok(holderEndpoint, `holder must report the endpoint it owns\n${holder.stdout}`)
  await hammerEarlyDisconnect(holderEndpoint, holder)
  assert.equal(holder.code, undefined, `lock holder must survive clients that disconnect early (EPIPE must not crash the Agent)\n${holder.stderr}`)
  const second = run(lockSource(false), root)
  assert.notEqual(await second.exited, 0, 'second instance must be rejected while first owns the endpoint')
  assert.match(second.stderr, /DUPLICATE_INSTANCE/, `second instance must be rejected as a duplicate, not crash for another reason\n${second.stderr}`)
  assert.match(second.stderr, /do not delete agent\.pid/, 'operator message must not invite deleting the lock')
  // 现场按诊断文件排障：被拒必须留下失败记录，且只含错误码与脱敏后的原因。
  assert.ok(existsSync(diagnosticPath), 'lock fail-closed must write last-startup-diagnostic.json')
  const diagnosticText = readFileSync(diagnosticPath, 'utf8')
  const diagnostic = JSON.parse(diagnosticText)
  assert.equal(diagnostic.schemaVersion, 1)
  assert.equal(diagnostic.state, 'failed')
  assert.equal(diagnostic.code, 'DUPLICATE_INSTANCE')
  assert.equal(diagnostic.lock?.reason, 'duplicate')
  assert.equal('token' in diagnostic, false, 'diagnostic must not carry a token field')
  for (const leaked of [tokenCanary, 'agentToken', 'adminSecret', 'bindCode']) {
    assert.equal(diagnosticText.includes(leaked), false, `diagnostic must not persist ${leaked}`)
  }
  // 诊断写不出来（路径被目录占住）也照样拒绝，并如实说诊断不可用。
  rmSync(diagnosticPath, { force: true })
  mkdirSync(diagnosticPath)
  const secondNoDiagnostic = run(lockSource(false), root)
  assert.notEqual(await secondNoDiagnostic.exited, 0, 'duplicate must still be rejected when the diagnostic cannot be written')
  assert.match(secondNoDiagnostic.stderr, /DUPLICATE_INSTANCE/)
  assert.match(secondNoDiagnostic.stderr, /AGENT_DIAGNOSTIC_UNAVAILABLE/, `diagnostic write failure must be reported\n${secondNoDiagnostic.stderr}`)
  rmSync(diagnosticPath, { recursive: true, force: true })
  assert.equal(holder.code, undefined, `duplicates probing the endpoint must not crash the holder\n${holder.stderr}`)
  await kill(holder)

  const afterKill = run(lockSource(true), root)
  assert.equal(await settle(afterKill), 'held', `a new instance must start after SIGKILL\n${afterKill.stderr}`)
  await kill(afterKill)

  // 竞争者拿到后必须一直持有：拿到就退出的话，A 退出后 B 合法地再拿一次，测不出互斥。
  const contenders = [run(lockSource(true), root), run(lockSource(true), root)]
  const outcomes = await Promise.all(contenders.map((c) => settle(c)))
  assert.equal(outcomes.filter((o) => o === 'held').length, 1, `exactly one contender must acquire and hold\n${contenders.map((c) => c.stderr).join('\n')}`)
  const loser = contenders[outcomes.indexOf('exited')]
  assert.ok(loser, 'the other contender must exit')
  assert.match(loser.stderr, /DUPLICATE_INSTANCE/, `the losing contender must be rejected as a duplicate\n${loser.stderr}`)
  await kill(contenders[outcomes.indexOf('held')])

  writeFileSync(join(state, 'agent.pid'), '999999\n')
  const pidLeftover = run(lockSource(true), root)
  assert.equal(await settle(pidLeftover), 'held', `leftover agent.pid must not block startup\n${pidLeftover.stderr}`)
  await kill(pidLeftover)
  console.log('verify-singleton-process: ok')
} finally {
  for (const proc of spawned) { if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL') }
  rmSync(root, { recursive: true, force: true })
}
