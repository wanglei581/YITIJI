import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const root = mkdtempSync(join(tmpdir(), 'terminal-agent-singleton-'))
const state = join(root, 'AIJobPrintAgent')
mkdirSync(state, { recursive: true })
writeFileSync(join(state, 'instance-id'), 'verify-machine-001')
const source = (hold) => hold ? `require('./src/agent/instance-lock').acquireLock().then(() => setTimeout(() => {}, 60000)).catch(e => { console.error(e.message); process.exit(2) })` : `require('./src/agent/instance-lock').acquireLock().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(2) })`
const env = { ...process.env, PROGRAMDATA: root }
const child = (hold = true) => spawn(process.execPath, ['-r', 'ts-node/register', '-e', source(hold)], { cwd: join(process.cwd()), env, stdio: ['ignore', 'pipe', 'pipe'] })
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
try {
  const first = child()
  let firstStderr = ''
  first.stderr.on('data', (chunk) => { firstStderr += String(chunk) })
  await wait(600)
  assert.equal(first.exitCode, null, `first instance must stay alive\n${firstStderr}`)
  const second = child()
  const secondCode = await new Promise((resolve) => second.once('exit', (code) => resolve(code)))
  assert.notEqual(secondCode, 0, 'second instance must be rejected while first owns the endpoint')
  first.kill('SIGKILL')
  await new Promise((resolve) => first.once('exit', resolve))
  const afterKill = child()
  await wait(600)
  assert.equal(afterKill.exitCode, null, 'a new instance must start after SIGKILL')
  afterKill.kill('SIGKILL')
  await new Promise((resolve) => afterKill.once('exit', resolve))
  const contenders = [child(false), child(false)]
  const results = await Promise.all(contenders.map((p) => new Promise((resolve) => p.once('exit', (code) => resolve(code)))))
  assert.equal(results.filter((code) => code === 0).length, 1, 'exactly one contender must acquire')
  assert.equal(results.filter((code) => code !== 0).length, 1, 'the losing contender must be rejected')
  writeFileSync(join(root, 'agent.pid'), '999999\n')
  const pidLeftover = child()
  await wait(600)
  assert.equal(pidLeftover.exitCode, null, 'leftover agent.pid must not block startup')
  pidLeftover.kill('SIGKILL')
  await new Promise((resolve) => pidLeftover.once('exit', resolve))
  console.log('verify-singleton-process: ok')
} finally {
  rmSync(root, { recursive: true, force: true })
}
