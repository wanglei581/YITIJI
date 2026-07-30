#!/usr/bin/env node
import { lstatSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Linux permits 107 pathname bytes plus NUL; keep four bytes of headroom for PM2's core pub/rpc sockets.
// This drill never invokes `pm2 link`, so no interactor socket participates in its control plane.
export const PM2_SOCKET_PATH_MAX_BYTES = 103

const NONCE = /^[0-9a-f]{32}$/
const RUNTIME_ROOT = /^\/run\/user\/(?:0|[1-9][0-9]*)$/

function invalid(code) {
  throw new Error(`D2_PRIME_${code}`)
}

export function derivePm2ControlPaths(runtimeRoot, nonce) {
  if (
    typeof runtimeRoot !== 'string' || !isAbsolute(runtimeRoot) || resolve(runtimeRoot) !== runtimeRoot ||
    !RUNTIME_ROOT.test(runtimeRoot) || !NONCE.test(nonce)
  ) invalid('PM2_CONTROL_ROOT_INVALID')

  const root = join(runtimeRoot, `d2p-${nonce}`)
  return Object.freeze({
    root,
    preflight: join(root, 'p'),
    legacy: join(root, 'l'),
    managed: join(root, 'm'),
  })
}

export function assertPm2SocketPathBudget(pm2Home) {
  if (
    typeof pm2Home !== 'string' || !isAbsolute(pm2Home) || resolve(pm2Home) !== pm2Home ||
    /[\0\n]/.test(pm2Home)
  ) invalid('PM2_SOCKET_PATH_INVALID')

  const pubSockBytes = Buffer.byteLength(join(pm2Home, 'pub.sock'), 'utf8')
  const rpcSockBytes = Buffer.byteLength(join(pm2Home, 'rpc.sock'), 'utf8')
  if (pubSockBytes > PM2_SOCKET_PATH_MAX_BYTES || rpcSockBytes > PM2_SOCKET_PATH_MAX_BYTES) {
    invalid('PM2_SOCKET_PATH_INVALID')
  }
  return Object.freeze({
    ok: true,
    maxBytes: PM2_SOCKET_PATH_MAX_BYTES,
    pubSockBytes,
    rpcSockBytes,
  })
}

export function createSpawnAttemptTracker() {
  let attempted = false
  let started = false
  return Object.freeze({
    recordAttempt() {
      attempted = true
    },
    markStarted() {
      if (!attempted) invalid('PM2_SPAWN_STATE_INVALID')
      started = true
    },
    shouldKill() {
      return attempted
    },
    hasStarted() {
      return started
    },
  })
}

export function isExpectedPm2DaemonIdentity({
  pm2Home,
  expectedUid,
  actualUid,
  environment,
  commandLine,
} = {}) {
  if (
    typeof pm2Home !== 'string' || !Number.isSafeInteger(expectedUid) ||
    !Number.isSafeInteger(actualUid) || !Array.isArray(environment) ||
    typeof commandLine !== 'string'
  ) return false

  const expectedTitleSuffix = `: God Daemon (${pm2Home})`
  const titlePrefix = commandLine.endsWith(expectedTitleSuffix)
    ? commandLine.slice(0, -expectedTitleSuffix.length)
    : ''
  return actualUid === expectedUid &&
    environment.includes(`PM2_HOME=${pm2Home}`) &&
    /^PM2 v[0-9]+(?:\.[0-9]+){1,3}$/.test(titlePrefix)
}

function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

function readPm2DaemonIdentity(pid, pm2Home) {
  const processRoot = `/proc/${pid}`
  const processStat = lstatSync(processRoot)
  const environment = readFileSync(join(processRoot, 'environ'))
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
  const commandLine = readFileSync(join(processRoot, 'cmdline'))
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .join(' ')
  return {
    pm2Home,
    expectedUid: process.getuid(),
    actualUid: processStat.uid,
    environment,
    commandLine,
  }
}

async function waitForExit(pid) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!processExists(pid)) return true
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  return !processExists(pid)
}

async function terminateExpectedPm2Daemon(pm2Home, rawPid) {
  assertPm2SocketPathBudget(pm2Home)
  if (!/^[1-9][0-9]{0,9}$/.test(rawPid)) invalid('PM2_DAEMON_PID_INVALID')
  const pid = Number(rawPid)
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) invalid('PM2_DAEMON_PID_INVALID')
  if (!processExists(pid)) return

  let identity
  try {
    identity = readPm2DaemonIdentity(pid, pm2Home)
  } catch (error) {
    if (error?.code === 'ENOENT' && !processExists(pid)) return
    throw error
  }
  if (!isExpectedPm2DaemonIdentity(identity)) invalid('PM2_DAEMON_IDENTITY_INVALID')

  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if (error?.code === 'ESRCH') return
    throw error
  }
  if (await waitForExit(pid)) return

  let currentIdentity
  try {
    currentIdentity = readPm2DaemonIdentity(pid, pm2Home)
  } catch (error) {
    if (error?.code === 'ENOENT' && !processExists(pid)) return
    throw error
  }
  if (!isExpectedPm2DaemonIdentity(currentIdentity)) invalid('PM2_DAEMON_IDENTITY_INVALID')
  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    if (error?.code === 'ESRCH') return
    throw error
  }
  if (!await waitForExit(pid)) invalid('PM2_DAEMON_TERMINATION_FAILED')
}

async function main(args) {
  if (args[0] === '--terminate-daemon' && args.length === 3) {
    await terminateExpectedPm2Daemon(args[1], args[2])
    return
  }
  if (args.length !== 7 || args[0] !== '--assert-layout') invalid('PM2_CONTROL_ARGUMENT_INVALID')
  const [, runtimeRoot, nonce, expectedRoot, preflight, legacy, managed] = args
  const actual = derivePm2ControlPaths(runtimeRoot, nonce)
  if (
    actual.root !== expectedRoot || actual.preflight !== preflight ||
    actual.legacy !== legacy || actual.managed !== managed
  ) invalid('PM2_CONTROL_ROOT_INVALID')
  for (const pm2Home of [preflight, legacy, managed]) assertPm2SocketPathBudget(pm2Home)
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main(process.argv.slice(2))
  } catch (error) {
    const code = error instanceof Error && /^D2_PRIME_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'D2_PRIME_PM2_CONTROL_REJECTED'
    process.stderr.write(`${code}\n`)
    process.exitCode = 2
  }
}
