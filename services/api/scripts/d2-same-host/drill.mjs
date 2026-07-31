#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync,
  renameSync, statSync, writeFileSync,
} from 'node:fs'
import { get } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createD2ReleaseFixture } from '../d2-release-fixture.mjs'
import {
  buildEvidence, createFailureMeasurements, renderNginxConfig, transitionCutover, validateEvidence,
} from './contract.mjs'
import {
  assertPm2SocketPathBudget,
  createSpawnAttemptTracker,
  derivePm2ControlPaths,
} from './control-plane.mjs'
import {
  DRILL_PHASES,
  classifyDrillFailure,
  createDrillDiagnosticError,
  formatDrillFailure,
  resolveDrillDiagnostic,
  withFailureEvidenceWriteFailure,
} from './diagnostics.mjs'

const require = createRequire(import.meta.url)
const scriptDir = dirname(fileURLToPath(import.meta.url))
const apiRoot = realpathSync(join(scriptDir, '../..'))
const { ReleaseProvenanceError } = require(join(apiRoot, 'dist/release-provenance/release-provenance.js'))
const { runReleaseGenesis } = require(join(apiRoot, 'dist/release-provenance/release-genesis.js'))
const { activateRelease } = require(join(apiRoot, 'dist/release-provenance/release-activation.js'))
const { readCurrentRelease } = require(join(apiRoot, 'dist/release-provenance/release-runtime-contract.js'))

const HEALTH_URL = 'http://127.0.0.1:3011/api/v1/health'
const NONCE = /^[0-9a-f]{32}$/
const SHA256 = /^[0-9a-f]{64}$/
const SAFE_UNIT = /^f1-d2-managed-[0-9a-f]{20}$/
let currentPhase = DRILL_PHASES.SETUP
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const sha = (value) => createHash('sha256').update(String(value), 'utf8').digest('hex')

function fail(code) {
  throw new Error(`D2_PRIME_${code}`)
}

function requiredEnvironment(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.length === 0 || value.includes('\n')) fail('ENV_INVALID')
  return value
}

function ownedDirectory(path) {
  if (!isAbsolute(path)) fail('PATH_INVALID')
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()) fail('PATH_INVALID')
  return realpathSync(path)
}

function run(binary, args, { environment = undefined, allowFailure = false, timeout = 15_000 } = {}) {
  if (!isAbsolute(binary)) fail('COMMAND_INVALID')
  const result = spawnSync(binary, args, {
    encoding: 'utf8', env: environment, stdio: ['ignore', 'pipe', 'pipe'], timeout, maxBuffer: 256 * 1024,
  })
  if (result.error || (!allowFailure && result.status !== 0)) fail('COMMAND_FAILED')
  return { status: result.status ?? 2, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function pm2Environment(home, pm2Home, approvedPath) {
  return Object.freeze(Object.assign(Object.create(null), { PATH: approvedPath, HOME: home, PM2_HOME: pm2Home }))
}

function readPidFile(path) {
  const value = readFileSync(path, 'utf8').trim()
  if (!/^[1-9][0-9]{0,9}$/.test(value)) fail('PID_INVALID')
  const pid = Number(value)
  try { process.kill(pid, 0) } catch { fail('PID_INVALID') }
  return pid
}

function pm2AppPid(pm2Bin, name, environment) {
  const result = run(pm2Bin, ['pid', name], { environment })
  const pids = result.stdout.trim().split(/\s+/).filter((value) => /^[1-9][0-9]{0,9}$/.test(value))
  if (pids.length !== 1) fail('PM2_APP_PID_INVALID')
  const pid = Number(pids[0])
  try { process.kill(pid, 0) } catch { fail('PM2_APP_PID_INVALID') }
  return pid
}

function networkNamespaceInode(pid) {
  return statSync(`/proc/${pid}/ns/net`, { bigint: true }).ino.toString()
}

function controlGroup(pid) {
  const line = readFileSync(`/proc/${pid}/cgroup`, 'utf8').split('\n').find((entry) => entry.startsWith('0::/'))
  if (!line) fail('CGROUP_INVALID')
  return line.slice(3)
}

function exactRecord(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

async function waitForManagedReady(path, nonce, pm2HomeId) {
  const deadline = Date.now() + 15_000
  while (!existsSync(path) && Date.now() < deadline) await wait(100)
  if (!existsSync(path)) fail('MANAGED_READY_TIMEOUT')
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.size > 1024) fail('MANAGED_READY_INVALID')
  const record = JSON.parse(readFileSync(path, 'utf8'))
  if (!exactRecord(record, ['schemaVersion', 'nonce', 'pm2HomeId', 'daemonPid'])) fail('MANAGED_READY_INVALID')
  if (record.schemaVersion !== 1 || record.nonce !== nonce || record.pm2HomeId !== pm2HomeId) fail('MANAGED_READY_INVALID')
  if (!Number.isSafeInteger(record.daemonPid) || record.daemonPid <= 0) fail('MANAGED_READY_INVALID')
  try { process.kill(record.daemonPid, 0) } catch { fail('MANAGED_READY_INVALID') }
  return record.daemonPid
}

function httpJson(url, timeout = 2_000) {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > 16 * 1024) request.destroy(new Error('response too large'))
        else chunks.push(chunk)
      })
      response.on('end', () => {
        try {
          resolve({ statusCode: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
        } catch { reject(new Error('invalid json')) }
      })
    })
    request.setTimeout(timeout, () => request.destroy(new Error('timeout')))
    request.on('error', reject)
  })
}

function managedSource(releaseId, healthy) {
  return `const http=require('node:http');
http.createServer((req,res)=>{
  if(req.url==='/api/v1/health'){
    res.writeHead(${healthy ? 200 : 503},{'content-type':'application/json','x-d2-target':'managed'});
    res.end(JSON.stringify({success:${healthy},data:{status:'${healthy ? 'ok' : 'degraded'}',db:'${healthy ? 'postgres' : 'down'}'}})); return;
  }
  // Keep load inside this managed API process so systemd accounts for the work.
  if(req.url==='/__d2/cpu-load'){
    const end=Date.now()+5000;while(Date.now()<end){}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({bounded:true}));return;
  }
  if(req.url==='/__d2/tag'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({target:'managed',releaseId:${JSON.stringify(releaseId)}}));return;}
  res.writeHead(404);res.end('not found');
}).listen(3011,'127.0.0.1');\n`
}

function legacySource() {
  return `const http=require('node:http');let count=0;
http.createServer((req,res)=>{
  if(req.url==='/__d2/count'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({count}));return;}
  if(req.url==='/__d2/tag'){count+=1;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({target:'legacy'}));return;}
  if(req.url==='/api/v1/health'){count+=1;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({success:true,data:{status:'ok',db:'postgres'}}));return;}
  res.writeHead(404);res.end('not found');
}).listen(3010,'127.0.0.1');\n`
}

function trackedManagedHealthProbe(counter) {
  return async (url) => {
    if (url.includes('127.0.0.1:3010')) counter.legacy += 1
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const response = await httpJson(url)
        if (response.statusCode === 200 && response.body?.success === true && response.body?.data?.status === 'ok' && response.body?.data?.db === 'postgres') return true
      } catch { /* managed process may still be starting */ }
      await wait(250)
    }
    return false
  }
}

async function observeTargets(port, count) {
  const targets = []
  const latencies = []
  for (let index = 0; index < count; index += 1) {
    const started = performance.now()
    const response = await httpJson(`http://127.0.0.1:${port}/__d2/tag`)
    latencies.push(performance.now() - started)
    if (response.statusCode !== 200 || !['legacy', 'managed'].includes(response.body?.target)) fail('NGINX_TARGET_INVALID')
    targets.push(response.body.target)
  }
  return { targets, latencies }
}

function percentile(values, percentage) {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * percentage) - 1)]
}

function systemdValue(systemctlBin, unitName, property, environment) {
  return run(systemctlBin, ['--user', 'show', unitName, `--property=${property}`, '--value'], { environment }).stdout.trim()
}

function timespanMicros(value) {
  const match = /^(\d+)(us|ms|s)$/.exec(value)
  if (!match) fail('SYSTEMD_LIMIT_INVALID')
  const factor = match[2] === 'us' ? 1 : match[2] === 'ms' ? 1_000 : 1_000_000
  return Number(match[1]) * factor
}

function throttledCount(cgroupRoot) {
  const match = /^nr_throttled\s+(\d+)$/m.exec(readFileSync(join(cgroupRoot, 'cpu.stat'), 'utf8'))
  if (!match) fail('CPU_STAT_INVALID')
  return Number(match[1])
}

function writeExclusive(path, body) {
  const descriptor = openSync(path, 'wx', 0o600)
  try { writeFileSync(descriptor, body, 'utf8') } finally { closeSync(descriptor) }
}

async function main() {
  const runDir = ownedDirectory(requiredEnvironment('D2_RUN_DIR'))
  const legacyHome = ownedDirectory(requiredEnvironment('D2_LEGACY_HOME'))
  const legacyPm2Home = ownedDirectory(requiredEnvironment('D2_LEGACY_PM2_HOME'))
  const managedPm2Home = ownedDirectory(requiredEnvironment('D2_MANAGED_PM2_HOME'))
  const controlRoot = ownedDirectory(requiredEnvironment('D2_CONTROL_ROOT'))
  const nonce = requiredEnvironment('D2_NONCE')
  const unitName = requiredEnvironment('D2_UNIT_NAME')
  const readyMarker = requiredEnvironment('D2_READY_MARKER')
  const stopMarker = requiredEnvironment('D2_STOP_MARKER')
  const evidenceOut = requiredEnvironment('D2_EVIDENCE_OUT')
  const pm2Bin = requiredEnvironment('D2_PM2_BIN')
  const nginxBin = requiredEnvironment('D2_NGINX_BIN')
  const systemctlBin = requiredEnvironment('D2_SYSTEMCTL_BIN')
  const managedPm2HomeId = requiredEnvironment('D2_MANAGED_PM2_HOME_ID')
  const approvedPath = requiredEnvironment('PATH')
  const managedHome = ownedDirectory(requiredEnvironment('HOME'))
  const xdgRuntimeDir = ownedDirectory(requiredEnvironment('XDG_RUNTIME_DIR'))
  const nginxPort = Number(requiredEnvironment('D2_NGINX_PORT'))
  if (!NONCE.test(nonce) || !SAFE_UNIT.test(unitName) || !SHA256.test(managedPm2HomeId)) fail('ENV_INVALID')
  if (
    xdgRuntimeDir !== join('/run/user', String(process.getuid())) ||
    (lstatSync(xdgRuntimeDir).mode & 0o777) !== 0o700
  ) fail('PATH_INVALID')
  const controlPaths = derivePm2ControlPaths(xdgRuntimeDir, nonce)
  if (
    controlRoot !== controlPaths.root || legacyPm2Home !== controlPaths.legacy ||
    managedPm2Home !== controlPaths.managed
  ) fail('PATH_INVALID')
  assertPm2SocketPathBudget(legacyPm2Home)
  assertPm2SocketPathBudget(managedPm2Home)
  if (readyMarker !== join(runDir, 'managed-ready.json') || stopMarker !== join(runDir, 'managed-stop')) fail('MARKER_PATH_INVALID')
  const evidenceParent = lstatSync(dirname(evidenceOut))
  if (
    !isAbsolute(evidenceOut) || existsSync(evidenceOut) || !evidenceParent.isDirectory() ||
    evidenceParent.isSymbolicLink() || evidenceParent.uid !== process.getuid()
  ) fail('EVIDENCE_PATH_INVALID')
  if (!Number.isInteger(nginxPort) || nginxPort < 1024 || nginxPort > 65535 || [3010, 3011].includes(nginxPort)) fail('NGINX_PORT_INVALID')

  const managedEnvironment = pm2Environment(managedHome, managedPm2Home, approvedPath)
  const legacyEnvironment = pm2Environment(legacyHome, legacyPm2Home, approvedPath)
  const systemEnvironment = Object.freeze(Object.assign(
    Object.create(null),
    { PATH: approvedPath, HOME: managedHome, XDG_RUNTIME_DIR: xdgRuntimeDir },
  ))
  const legacyName = `d2-legacy-${nonce.slice(0, 12)}`
  const managedName = `d2-managed-${nonce.slice(0, 12)}`
  const workspace = join(runDir, 'release-workspace')
  const nginxRoot = join(runDir, 'nginx')
  const legacyRoot = join(runDir, 'legacy-release')
  const legacyLogs = join(runDir, 'legacy-logs')
  for (const path of [workspace, nginxRoot, legacyRoot, legacyLogs]) mkdirSync(path, { recursive: false, mode: 0o700 })

  const legacyMain = join(legacyRoot, 'main.js')
  const nginxActive = join(nginxRoot, 'nginx.conf')
  const nginxCandidate = join(nginxRoot, 'nginx.conf.candidate')
  const nginxPidPath = join(nginxRoot, 'nginx.pid')
  writeFileSync(legacyMain, legacySource(), { mode: 0o600 })

  let nginxStarted = false
  const legacyDaemon = createSpawnAttemptTracker()
  let managedDaemonReady = false
  let evidenceWritten = false
  let measurements = createFailureMeasurements(new Date().toISOString())
  try {
    const managedDaemonPid = await waitForManagedReady(readyMarker, nonce, managedPm2HomeId)
    managedDaemonReady = true
    legacyDaemon.recordAttempt()
    run(pm2Bin, ['ping'], { environment: legacyEnvironment, timeout: 5_000 })
    legacyDaemon.markStarted()
    run(pm2Bin, ['start', legacyMain, '--name', legacyName, '--cwd', legacyRoot,
      '--output', join(legacyLogs, 'out.log'), '--error', join(legacyLogs, 'error.log')], { environment: legacyEnvironment })
    const legacyDaemonPid = readPidFile(join(legacyPm2Home, 'pm2.pid'))
    const legacyAppPid = pm2AppPid(pm2Bin, legacyName, legacyEnvironment)

    const fixture = createD2ReleaseFixture({
      workspace,
      runtimeEnvironmentVariables: [
        { name: 'PATH', purpose: 'Resolve approved Node.js and PM2 commands.' },
        { name: 'HOME', purpose: 'Pin the managed drill home.' },
        { name: 'PM2_HOME', purpose: 'Pin the managed PM2 daemon.' },
      ],
    })
    const r1Id = `release-d2-prime-${nonce.slice(0, 8)}-r1`
    const r2Id = `release-d2-prime-${nonce.slice(0, 8)}-r2`
    const r3Id = `release-d2-prime-${nonce.slice(0, 8)}-r3`
    const r1 = fixture.buildRelease({ releaseName: 'r1', releaseId: r1Id, mainSource: managedSource(r1Id, true) })
    const r2 = fixture.buildRelease({ releaseName: 'r2', releaseId: r2Id, previousReleaseId: r1Id, mainSource: managedSource(r2Id, true) })
    const r3 = fixture.buildRelease({ releaseName: 'r3', releaseId: r3Id, previousReleaseId: r2Id, mainSource: managedSource(r3Id, false) })
    const releaseProbeCounter = { legacy: 0 }
    const healthProbe = trackedManagedHealthProbe(releaseProbeCounter)
    const commonReleaseOptions = {
      artifactRoot: r1.artifactRoot, pm2Name: managedName, healthUrl: HEALTH_URL,
      launcherCwd: fixture.launcherCwd, launcherPath: fixture.launcherPath,
      launcherSha256: fixture.launcherSha256, runtimeEnvContractPath: fixture.runtimeEnvContractPath,
      runtimeEnvContractSha256: fixture.runtimeEnvContractSha256, healthProbe,
    }
    const genesis = await runReleaseGenesis({
      candidateRoot: r1.releaseRoot, managedCurrentLink: fixture.managedCurrentLink,
      deploymentControlRoot: fixture.controlRoot, ...commonReleaseOptions,
    })
    assert.equal(genesis.status, 'parallel-serving-r1')
    const activation = await activateRelease({ candidateRoot: r2.releaseRoot, currentLink: fixture.managedCurrentLink, ...commonReleaseOptions })
    assert.equal(activation.releaseId, r2Id)

    const managedAppPidBeforeRollback = pm2AppPid(pm2Bin, managedName, managedEnvironment)
    if (!isAbsolute(systemctlBin)) fail('SYSTEMCTL_INVALID')
    const managedControlGroup = systemdValue(systemctlBin, unitName, 'ControlGroup', systemEnvironment)
    if (!managedControlGroup.startsWith('/')) fail('CGROUP_INVALID')
    const managedCgroupRoot = join('/sys/fs/cgroup', managedControlGroup)
    const effectiveMemoryMaxBytes = Number(systemdValue(systemctlBin, unitName, 'MemoryMax', systemEnvironment))
    const effectiveCpuQuotaPerSecUSec = timespanMicros(systemdValue(systemctlBin, unitName, 'CPUQuotaPerSecUSec', systemEnvironment))
    const effectiveTasksMax = Number(systemdValue(systemctlBin, unitName, 'TasksMax', systemEnvironment))
    const effectiveLimitNOFILE = Number(systemdValue(systemctlBin, unitName, 'LimitNOFILE', systemEnvironment).split(':')[0])

    const nginxPrefix = `${nginxRoot}/`
    writeFileSync(nginxActive, renderNginxConfig({
      target: 'legacy', listenPort: nginxPort, pidPath: nginxPidPath,
      accessLogPath: join(nginxRoot, 'access.log'), errorLogPath: join(nginxRoot, 'error.log'),
    }), { mode: 0o600 })
    const nginxTestLegacy = run(nginxBin, ['-t', '-p', nginxPrefix, '-c', nginxActive], { allowFailure: true })
    if (nginxTestLegacy.status !== 0) fail('NGINX_INITIAL_CONFIG_INVALID')
    run(nginxBin, ['-p', nginxPrefix, '-c', nginxActive])
    nginxStarted = true
    for (let attempt = 0; attempt < 30 && !existsSync(nginxPidPath); attempt += 1) await wait(100)
    const nginxPid = readPidFile(nginxPidPath)
    const baseline = await observeTargets(nginxPort, 10)
    if (!baseline.targets.every((target) => target === 'legacy')) fail('NGINX_LEGACY_TARGET_INVALID')

    const invalidConfig = `${readFileSync(nginxActive, 'utf8')}\ninvalid_d2_directive;\n`
    writeFileSync(nginxCandidate, invalidConfig, { mode: 0o600 })
    const invalidTest = run(nginxBin, ['-t', '-p', nginxPrefix, '-c', nginxCandidate], { allowFailure: true })
    if (invalidTest.status === 0) fail('NGINX_INVALID_CANDIDATE_ACCEPTED')
    const observedAfterInvalid = await observeTargets(nginxPort, 10)
    if (!observedAfterInvalid.targets.every((target) => target === 'legacy')) fail('NGINX_INVALID_CANDIDATE_SWITCHED')

    const nrThrottledBefore = throttledCount(managedCgroupRoot)
    const boundedLoad = httpJson('http://127.0.0.1:3011/__d2/cpu-load', 10_000)
    await wait(100)
    let legacyProbeFailuresUnderLoad = 0
    const loadLatencies = []
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now()
      try {
        const observation = await observeTargets(nginxPort, 1)
        if (observation.targets[0] !== 'legacy') legacyProbeFailuresUnderLoad += 1
      } catch { legacyProbeFailuresUnderLoad += 1 }
      loadLatencies.push(performance.now() - started)
    }
    const loadResult = await boundedLoad
    if (loadResult.statusCode !== 200 || loadResult.body?.bounded !== true) fail('BOUNDED_LOAD_FAILED')
    const nrThrottledAfter = throttledCount(managedCgroupRoot)
    process.stdout.write(`D2_PRIME_LATENCY baseline_p50_ms=${percentile(baseline.latencies, 0.5).toFixed(2)} baseline_p95_ms=${percentile(baseline.latencies, 0.95).toFixed(2)} load_p50_ms=${percentile(loadLatencies, 0.5).toFixed(2)} load_p95_ms=${percentile(loadLatencies, 0.95).toFixed(2)}\n`)

    currentPhase = DRILL_PHASES.CUTOVER
    let cutoverState = 'LEGACY_ACTIVE'
    writeFileSync(nginxCandidate, renderNginxConfig({
      target: 'managed', listenPort: nginxPort, pidPath: nginxPidPath,
      accessLogPath: join(nginxRoot, 'access.log'), errorLogPath: join(nginxRoot, 'error.log'),
    }), { mode: 0o600 })
    const validTest = run(nginxBin, ['-t', '-p', nginxPrefix, '-c', nginxCandidate], { allowFailure: true })
    if (validTest.status !== 0) fail('NGINX_MANAGED_CANDIDATE_INVALID')
    cutoverState = transitionCutover(cutoverState, 'candidate_validated')
    cutoverState = transitionCutover(cutoverState, 'reload_succeeded')
    renameSync(nginxCandidate, nginxActive)
    run(nginxBin, ['-s', 'reload', '-p', nginxPrefix, '-c', nginxActive])
    let firstManaged = false
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        if ((await observeTargets(nginxPort, 1)).targets[0] === 'managed') { firstManaged = true; break }
      } catch { /* reload may still be settling */ }
      await wait(100)
    }
    if (!firstManaged) fail('NGINX_RELOAD_UNCONFIRMED')
    const observedAfterReload = await observeTargets(nginxPort, 20)
    if (!observedAfterReload.targets.every((target) => target === 'managed')) fail('NGINX_MIXED_TARGETS')
    cutoverState = transitionCutover(cutoverState, 'confirm')
    assert.equal(cutoverState, 'CUTOVER_CONFIRMED')
    const legacyCountAtCutover = (await httpJson('http://127.0.0.1:3010/__d2/count')).body.count

    currentPhase = DRILL_PHASES.ROLLBACK
    let failedReleaseError = ''
    try {
      await activateRelease({ candidateRoot: r3.releaseRoot, currentLink: fixture.managedCurrentLink, ...commonReleaseOptions })
      fail('R3_UNEXPECTEDLY_ACTIVATED')
    } catch (error) {
      if (!(error instanceof ReleaseProvenanceError)) throw error
      failedReleaseError = error.code
    }
    assert.equal(failedReleaseError, 'RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK')
    assert.equal(readCurrentRelease(fixture.managedCurrentLink), r2.releaseRoot)
    cutoverState = transitionCutover(cutoverState, 'bad_managed_release')
    assert.equal(cutoverState, 'MANAGED_PREVIOUS_ONLY')
    const afterRollbackTargets = await observeTargets(nginxPort, 10)
    if (!afterRollbackTargets.targets.every((target) => target === 'managed')) fail('ROLLBACK_LEFT_MANAGED')
    const legacyCountAfterRollback = (await httpJson('http://127.0.0.1:3010/__d2/count')).body.count
    if (legacyCountAfterRollback !== legacyCountAtCutover) fail('LEGACY_FALLBACK_DETECTED')

    currentPhase = DRILL_PHASES.MEASURE
    const managedAppPid = pm2AppPid(pm2Bin, managedName, managedEnvironment)
    const nginxVersionOutput = run(nginxBin, ['-v'], { allowFailure: true })
    const nginxVersion = /nginx\/(\S+)/.exec(`${nginxVersionOutput.stderr}${nginxVersionOutput.stdout}`)?.[1]
    if (!nginxVersion) fail('NGINX_VERSION_INVALID')
    measurements = {
      recordedAt: new Date().toISOString(),
      topology: {
        legacyNetNamespaceInode: networkNamespaceInode(legacyAppPid),
        managedNetNamespaceInode: networkNamespaceInode(managedAppPid),
        nginxNetNamespaceInode: networkNamespaceInode(nginxPid),
      },
      controlIsolation: {
        legacyPm2HomeId: sha(legacyPm2Home), managedPm2HomeId, legacyDaemonId: `daemon-${sha(legacyDaemonPid).slice(0, 16)}`,
        managedDaemonId: `daemon-${sha(managedDaemonPid).slice(0, 16)}`, legacyNameId: legacyName, managedNameId: managedName,
        legacyReleasePathsId: sha(legacyRoot), managedReleasePathsId: sha([r1.artifactRoot, fixture.controlRoot, fixture.launcherCwd, fixture.managedCurrentLink, fixture.runtimeEnvContractPath].join('\n')),
        legacyLogPathsId: sha(legacyLogs), managedLogPathsId: sha(join(managedPm2Home, 'logs')),
      },
      healthContract: { managedHealthUrl: HEALTH_URL, legacyHealthProbeCountByReleaseTools: releaseProbeCounter.legacy },
      nginx: {
        binaryVersion: `nginx/${nginxVersion}`, invalidCandidateTestExitCode: invalidTest.status,
        invalidCandidateReloadAttempted: false, observedTargetsAfterInvalidCandidate: observedAfterInvalid.targets,
        targetAfterInvalidCandidate: 'legacy', validCandidateTestExitCode: validTest.status,
        observedTargetsAfterValidReload: observedAfterReload.targets, targetAfterReload: 'managed',
      },
      releaseChain: {
        genesisStatus: 'PARALLEL_SERVING_R1', activatedReleaseId: r2Id, failedReleaseError,
        currentAfterRollback: r2Id, rollbackTarget: 'managed-previous-only', legacyFallbackAttempted: false,
      },
      resourceIsolation: {
        cgroupVersion: 'v2', engine: 'systemd', managedControlGroupId: sha(managedControlGroup),
        managedDaemonControlGroupId: sha(controlGroup(managedDaemonPid)), managedAppControlGroupId: sha(controlGroup(managedAppPid)),
        effectiveMemoryMaxBytes, effectiveCpuQuotaPerSecUSec, effectiveTasksMax, effectiveLimitNOFILE,
        nrThrottledBefore, nrThrottledAfter, legacyProbeFailuresUnderLoad,
      },
      dataSafety: createFailureMeasurements(new Date().toISOString()).dataSafety,
    }
    assert.equal(controlGroup(managedAppPidBeforeRollback), managedControlGroup)
    currentPhase = DRILL_PHASES.EVIDENCE
    const evidence = validateEvidence(buildEvidence(measurements))
    if (evidence.verdict !== 'D2_PRIME_PASS') fail('EVIDENCE_NO_GO')
    writeExclusive(evidenceOut, `${JSON.stringify(evidence, null, 2)}\n`)
    evidenceWritten = true
  } catch (error) {
    let diagnostic = classifyDrillFailure(error, currentPhase)
    if (!evidenceWritten) {
      if (existsSync(evidenceOut)) {
        diagnostic = withFailureEvidenceWriteFailure(diagnostic)
      } else {
        try {
          const noGoEvidence = validateEvidence(buildEvidence(createFailureMeasurements(new Date().toISOString())))
          if (noGoEvidence.verdict !== 'D2_PRIME_NO_GO') fail('FAILURE_EVIDENCE_INVALID')
          writeExclusive(evidenceOut, `${JSON.stringify(noGoEvidence, null, 2)}\n`)
          evidenceWritten = true
        } catch {
          diagnostic = withFailureEvidenceWriteFailure(diagnostic)
        }
      }
    }
    throw createDrillDiagnosticError(diagnostic)
  } finally {
    currentPhase = DRILL_PHASES.CLEANUP
    if (managedDaemonReady) {
      try { run(pm2Bin, ['delete', managedName], { environment: managedEnvironment, allowFailure: true }) } catch { /* keeper owns final daemon cleanup */ }
    }
    if (nginxStarted) {
      try { run(nginxBin, ['-s', 'quit', '-p', `${nginxRoot}/`, '-c', nginxActive], { allowFailure: true }) } catch { /* wrapper removes only this nonce workspace */ }
    }
    if (legacyDaemon.shouldKill()) {
      if (legacyDaemon.hasStarted()) {
        try { run(pm2Bin, ['delete', legacyName], { environment: legacyEnvironment, allowFailure: true }) } catch { /* continue to isolated daemon kill */ }
      }
      try { run(pm2Bin, ['kill'], { environment: legacyEnvironment, allowFailure: true, timeout: 8_000 }) } catch { /* wrapper keeps the exact control root on cleanup failure */ }
    }
    try {
      if (!existsSync(stopMarker)) writeExclusive(stopMarker, '')
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
  }
  process.stdout.write('D2_PRIME_PASS\nproductionF1=NO-GO\n')
}

main().catch((error) => {
  process.stderr.write(`${formatDrillFailure(resolveDrillDiagnostic(error, currentPhase))}\n`)
  process.exitCode = 2
})
