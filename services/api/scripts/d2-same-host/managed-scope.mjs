#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join } from 'node:path'

const READY_FILE = 'managed-ready.json'
const STOP_FILE = 'managed-stop'
const NONCE = /^[0-9a-f]{32}$/
const SHA256 = /^[0-9a-f]{64}$/

function fail(code) {
  throw new Error(`D2_PRIME_${code}`)
}

function requiredEnvironment(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.length === 0 || value.includes('\n')) fail('MANAGED_SCOPE_ENV_INVALID')
  return value
}

function assertOwnedDirectory(path) {
  if (!isAbsolute(path)) fail('MANAGED_SCOPE_PATH_INVALID')
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()) {
    fail('MANAGED_SCOPE_PATH_INVALID')
  }
  return realpathSync(path)
}

function runPm2(pm2Bin, args, environment) {
  const result = spawnSync(pm2Bin, args, {
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  })
  if (result.error || result.status !== 0) fail('MANAGED_SCOPE_PM2_FAILED')
}

async function readDaemonPid(pm2Home) {
  const pidPath = join(pm2Home, 'pm2.pid')
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const raw = readFileSync(pidPath, 'utf8').trim()
      if (!/^[1-9][0-9]{0,9}$/.test(raw)) throw new Error('pid not ready')
      const pid = Number(raw)
      process.kill(pid, 0)
      return pid
    } catch {
      await wait(100)
    }
  }
  fail('MANAGED_SCOPE_DAEMON_PID_INVALID')
}

function writeReady(path, record) {
  const descriptor = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8')
  } finally {
    closeSync(descriptor)
  }
}

function assertStopMarker(path) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.size !== 0) {
    fail('MANAGED_SCOPE_STOP_INVALID')
  }
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function main() {
  const runDir = assertOwnedDirectory(requiredEnvironment('D2_RUN_DIR'))
  const home = assertOwnedDirectory(requiredEnvironment('HOME'))
  const pm2Home = assertOwnedDirectory(requiredEnvironment('PM2_HOME'))
  const nonce = requiredEnvironment('D2_NONCE')
  const expectedPm2HomeId = requiredEnvironment('D2_PM2_HOME_ID')
  const pm2Bin = requiredEnvironment('D2_PM2_BIN')
  const approvedPath = requiredEnvironment('PATH')
  if (!NONCE.test(nonce) || !SHA256.test(expectedPm2HomeId) || !isAbsolute(pm2Bin)) {
    fail('MANAGED_SCOPE_ENV_INVALID')
  }
  if (home !== join(runDir, 'managed-home') || pm2Home !== join(runDir, 'managed-pm2')) {
    fail('MANAGED_SCOPE_PATH_INVALID')
  }
  const actualPm2HomeId = createHash('sha256').update(pm2Home, 'utf8').digest('hex')
  if (actualPm2HomeId !== expectedPm2HomeId) fail('MANAGED_SCOPE_HOME_MISMATCH')

  const readyPath = join(runDir, READY_FILE)
  const stopPath = join(runDir, STOP_FILE)
  if (existsSync(readyPath) || existsSync(stopPath)) fail('MANAGED_SCOPE_MARKER_EXISTS')

  const pm2Environment = Object.freeze(Object.assign(Object.create(null), {
    PATH: approvedPath,
    HOME: home,
    PM2_HOME: pm2Home,
  }))
  let daemonStarted = false
  let stopping = false
  const requestStop = () => {
    stopping = true
  }
  process.once('SIGINT', requestStop)
  process.once('SIGTERM', requestStop)

  try {
    runPm2(pm2Bin, ['ping'], pm2Environment)
    daemonStarted = true
    const daemonPid = await readDaemonPid(pm2Home)
    writeReady(readyPath, {
      schemaVersion: 1,
      nonce,
      pm2HomeId: actualPm2HomeId,
      daemonPid,
    })

    while (!stopping && !existsSync(stopPath)) {
      await wait(100)
    }
    if (existsSync(stopPath)) assertStopMarker(stopPath)
  } finally {
    if (daemonStarted) {
      try {
        runPm2(pm2Bin, ['kill'], pm2Environment)
      } catch {
        process.exitCode = 2
      }
    }
  }
}

main().catch((error) => {
  const code = error instanceof Error && /^D2_PRIME_[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : 'D2_PRIME_MANAGED_SCOPE_FAILED'
  process.stderr.write(`${code}\n`)
  process.exitCode = 2
})
