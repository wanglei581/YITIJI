#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildEvidence,
  createFailureMeasurements,
  renderNginxConfig,
  transitionCutover,
  validateEvidence,
} from './contract.mjs'
import {
  PM2_SOCKET_PATH_MAX_BYTES,
  assertPm2SocketPathBudget,
  createSpawnAttemptTracker,
  derivePm2ControlPaths,
  isExpectedPm2DaemonIdentity,
} from './control-plane.mjs'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHA_C = 'c'.repeat(64)
const SHA_D = 'd'.repeat(64)
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const procfsRuntime = await import('./procfs.mjs').catch(() => Object.freeze({}))

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function expectContractFailure(action) {
  assert.throws(
    action,
    (error) => error instanceof Error && /^D2_PRIME_(?:CONTRACT|EVIDENCE)_INVALID$/.test(error.message),
  )
}

function expectRuntimeFailure(action, code, forbiddenFragments = []) {
  let capturedError
  assert.throws(
    action,
    (error) => {
      capturedError = error
      return error instanceof Error && error.message === `D2_PRIME_${code}`
    },
  )
  for (const fragment of forbiddenFragments) {
    assert.ok(!capturedError.message.includes(fragment), `runtime failure leaked ${fragment}`)
  }
}

function measurements() {
  return {
    recordedAt: '2026-07-30T08:00:00.000Z',
    topology: {
      legacyNetNamespaceInode: '4026531840',
      managedNetNamespaceInode: '4026531840',
      nginxNetNamespaceInode: '4026531840',
    },
    controlIsolation: {
      legacyPm2HomeId: SHA_A,
      managedPm2HomeId: SHA_B,
      legacyDaemonId: 'daemon-legacy-101',
      managedDaemonId: 'daemon-managed-202',
      legacyNameId: 'name-legacy-api',
      managedNameId: 'name-managed-api',
      legacyReleasePathsId: SHA_C,
      managedReleasePathsId: SHA_D,
      legacyLogPathsId: '1'.repeat(64),
      managedLogPathsId: '2'.repeat(64),
    },
    healthContract: {
      managedHealthUrl: 'http://127.0.0.1:3011/api/v1/health',
      legacyHealthProbeCountByReleaseTools: 0,
    },
    nginx: {
      binaryVersion: 'nginx/1.26.3',
      invalidCandidateTestExitCode: 1,
      invalidCandidateReloadAttempted: false,
      observedTargetsAfterInvalidCandidate: ['legacy'],
      targetAfterInvalidCandidate: 'legacy',
      validCandidateTestExitCode: 0,
      observedTargetsAfterValidReload: ['managed'],
      targetAfterReload: 'managed',
    },
    releaseChain: {
      genesisStatus: 'PARALLEL_SERVING_R1',
      activatedReleaseId: 'release-d2-prime-r2',
      failedReleaseError: 'RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK',
      currentAfterRollback: 'release-d2-prime-r2',
      rollbackTarget: 'managed-previous-only',
      legacyFallbackAttempted: false,
    },
    resourceIsolation: {
      cgroupVersion: 'v2',
      engine: 'systemd',
      managedControlGroupId: SHA_A,
      managedDaemonControlGroupId: SHA_A,
      managedAppControlGroupId: SHA_A,
      effectiveMemoryMaxBytes: 268_435_456,
      effectiveCpuQuotaPerSecUSec: 250_000,
      effectiveTasksMax: 64,
      effectiveLimitNOFILE: 256,
      nrThrottledBefore: 10,
      nrThrottledAfter: 11,
      legacyProbeFailuresUnderLoad: 0,
    },
    dataSafety: {
      productionCredentialsPresent: false,
      migrationExecuted: false,
      ddlExecuted: false,
      seedExecuted: false,
      secondWorkerStarted: false,
      cronOrSchedulerStarted: false,
      queueConsumerStarted: false,
    },
  }
}

function verifyNginxRenderer() {
  const common = {
    listenPort: 18_080,
    pidPath: '/tmp/d2-prime/nginx.pid',
    accessLogPath: '/tmp/d2-prime/access.log',
    errorLogPath: '/tmp/d2-prime/error.log',
  }
  const legacy = renderNginxConfig({ ...common, target: 'legacy' })
  assert.equal((legacy.match(/127\.0\.0\.1:3010/g) ?? []).length, 1)
  assert.equal(legacy.includes('127.0.0.1:3011'), false)
  assert.equal((legacy.match(/proxy_pass/g) ?? []).length, 1)
  assert.match(legacy, /listen 127\.0\.0\.1:18080;/)

  const managed = renderNginxConfig({ ...common, target: 'managed' })
  assert.equal((managed.match(/127\.0\.0\.1:3011/g) ?? []).length, 1)
  assert.equal(managed.includes('127.0.0.1:3010'), false)
  assert.equal((managed.match(/proxy_pass/g) ?? []).length, 1)
  assert.equal(/weight=|backup;|split_clients|upstream\s+\w+\s*\{[^}]*server[^}]*server/s.test(managed), false)

  const unicodePath = renderNginxConfig({
    ...common,
    target: 'managed',
    pidPath: '/tmp/求职终端/d2 prime/nginx.pid',
  })
  assert.match(unicodePath, /pid "\/tmp\/求职终端\/d2 prime\/nginx\.pid";/)

  for (const target of ['', 'mixed', '127.0.0.1:3011']) {
    expectContractFailure(() => renderNginxConfig({ ...common, target }))
  }
  expectContractFailure(() => renderNginxConfig({ ...common, target: 'legacy', listenPort: 80 }))
  expectContractFailure(() => renderNginxConfig({ ...common, target: 'legacy', pidPath: 'relative.pid' }))
  expectContractFailure(() => renderNginxConfig({ ...common, target: 'legacy', errorLogPath: '/tmp/x\nuser root;' }))
  expectContractFailure(() => renderNginxConfig({ ...common, target: 'legacy', errorLogPath: '/tmp/x"; user root;' }))
  console.log('  PASS Nginx renderer emits one loopback target and rejects mixed/unsafe inputs')
}

function verifyCutoverStateMachine() {
  assert.equal(transitionCutover('LEGACY_ACTIVE', 'candidate_validated'), 'MANAGED_CANDIDATE_VALIDATED')
  assert.equal(transitionCutover('MANAGED_CANDIDATE_VALIDATED', 'validation_failed'), 'LEGACY_ACTIVE')
  assert.equal(transitionCutover('MANAGED_CANDIDATE_VALIDATED', 'reload_failed'), 'LEGACY_ACTIVE')
  assert.equal(transitionCutover('MANAGED_CANDIDATE_VALIDATED', 'reload_succeeded'), 'MANAGED_RELOADED_UNCONFIRMED')
  assert.equal(transitionCutover('MANAGED_RELOADED_UNCONFIRMED', 'external_check_failed'), 'LEGACY_ACTIVE')
  assert.equal(transitionCutover('MANAGED_RELOADED_UNCONFIRMED', 'confirm'), 'CUTOVER_CONFIRMED')
  assert.equal(transitionCutover('CUTOVER_CONFIRMED', 'bad_managed_release'), 'MANAGED_PREVIOUS_ONLY')
  expectContractFailure(() => transitionCutover('CUTOVER_CONFIRMED', 'external_check_failed'))
  expectContractFailure(() => transitionCutover('CUTOVER_CONFIRMED', 'legacy_fallback'))
  expectContractFailure(() => transitionCutover('UNKNOWN', 'confirm'))
  console.log('  PASS cutover state machine has no post-confirm legacy transition')
}

function verifyPm2ControlPlane() {
  const nonce = '0123456789abcdef0123456789abcdef'
  const paths = derivePm2ControlPaths('/run/user/1000', nonce)
  assert.deepEqual(paths, {
    root: `/run/user/1000/d2p-${nonce}`,
    preflight: `/run/user/1000/d2p-${nonce}/p`,
    legacy: `/run/user/1000/d2p-${nonce}/l`,
    managed: `/run/user/1000/d2p-${nonce}/m`,
  })
  for (const pm2Home of [paths.preflight, paths.legacy, paths.managed]) {
    const budget = assertPm2SocketPathBudget(pm2Home)
    assert.equal(budget.maxBytes, PM2_SOCKET_PATH_MAX_BYTES)
    assert.equal(budget.ok, true)
    assert.ok(budget.pubSockBytes <= PM2_SOCKET_PATH_MAX_BYTES)
    assert.ok(budget.rpcSockBytes <= PM2_SOCKET_PATH_MAX_BYTES)
  }
  const exactBoundaryHome = `/tmp/${'a'.repeat(89)}`
  assert.equal(Buffer.byteLength(join(exactBoundaryHome, 'pub.sock'), 'utf8'), 103)
  assert.equal(assertPm2SocketPathBudget(exactBoundaryHome).ok, true)
  const overBoundaryHome = `/tmp/${'a'.repeat(90)}`
  assert.equal(Buffer.byteLength(join(overBoundaryHome, 'pub.sock'), 'utf8'), 104)
  assert.throws(() => assertPm2SocketPathBudget(overBoundaryHome), /D2_PRIME_PM2_SOCKET_PATH_INVALID/)

  assert.throws(
    () => assertPm2SocketPathBudget(`/tmp/${'a'.repeat(100)}`),
    /D2_PRIME_PM2_SOCKET_PATH_INVALID/,
  )
  assert.throws(
    () => assertPm2SocketPathBudget(`/tmp/${'求职'.repeat(17)}`),
    /D2_PRIME_PM2_SOCKET_PATH_INVALID/,
  )
  assert.throws(() => assertPm2SocketPathBudget('/tmp/pm2\0truncated'), /D2_PRIME_PM2_SOCKET_PATH_INVALID/)
  assert.throws(() => derivePm2ControlPaths('/tmp/runtime', nonce), /D2_PRIME_PM2_CONTROL_ROOT_INVALID/)
  assert.throws(() => derivePm2ControlPaths('/run/user/1000', 'bad'), /D2_PRIME_PM2_CONTROL_ROOT_INVALID/)

  const tracker = createSpawnAttemptTracker()
  assert.equal(tracker.shouldKill(), false)
  assert.equal(tracker.hasStarted(), false)
  tracker.recordAttempt()
  assert.equal(tracker.shouldKill(), true)
  assert.equal(tracker.hasStarted(), false)
  tracker.markStarted()
  assert.equal(tracker.shouldKill(), true)
  assert.equal(tracker.hasStarted(), true)
  const invalidTracker = createSpawnAttemptTracker()
  assert.throws(() => invalidTracker.markStarted(), /D2_PRIME_PM2_SPAWN_STATE_INVALID/)

  const partialStart = createSpawnAttemptTracker()
  let fakeDaemonAlive = false
  try {
    partialStart.recordAttempt()
    fakeDaemonAlive = true
    throw new Error('parent CLI failed after daemon fork')
  } catch {
    if (partialStart.shouldKill()) fakeDaemonAlive = false
  }
  assert.equal(fakeDaemonAlive, false)

  const cliReject = spawnSync(process.execPath, [join(SCRIPT_DIR, 'control-plane.mjs'), '--assert-layout'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 2_000,
  })
  assert.equal(cliReject.status, 2)
  assert.match(cliReject.stderr, /D2_PRIME_PM2_CONTROL_ARGUMENT_INVALID/)

  const identity = {
    pm2Home: paths.legacy,
    expectedUid: 1000,
    actualUid: 1000,
    environment: [`HOME=/tmp/home`, `PM2_HOME=${paths.legacy}`],
    commandLine: `PM2 v6.0.13: God Daemon (${paths.legacy})`,
  }
  assert.equal(isExpectedPm2DaemonIdentity(identity), true)
  assert.equal(isExpectedPm2DaemonIdentity({ ...identity, actualUid: 1001 }), false)
  assert.equal(isExpectedPm2DaemonIdentity({ ...identity, environment: ['PM2_HOME=/tmp/other'] }), false)
  assert.equal(isExpectedPm2DaemonIdentity({ ...identity, commandLine: 'node unrelated.js' }), false)

  const runSource = readFileSync(join(SCRIPT_DIR, 'run.sh'), 'utf8')
  assert.match(runSource, /required_commands=\([^\n]*\btimeout\b/)
  assert.match(runSource, /timeout --signal=TERM --kill-after=2s 5s[\s\S]*?\"\$PM2_BIN\" -v/)
  assert.match(runSource, /timeout --signal=TERM --kill-after=3s 8s[\s\S]*?\"\$PM2_BIN\" kill/)
  assert.match(runSource, /PM2_RUNTIME_ROOT=\"\/run\/user\/\$\(id -u\)\"/)
  assert.match(runSource, /D2_CONTROL_ROOT=\"\$PM2_CONTROL_ROOT\"/)
  assert.match(runSource, /\[\[ ! -e \"\$home\" && ! -e \"\$pm2_home\" \]\] && return 0/)
  assert.match(runSource, /control-plane\.mjs\" --terminate-daemon \"\$pm2_home\" \"\$daemon_pid\"/)

  for (const file of ['managed-scope.mjs', 'drill.mjs']) {
    const source = readFileSync(join(SCRIPT_DIR, file), 'utf8')
    const attempt = source.indexOf('.recordAttempt()')
    const ping = source.indexOf("['ping']", attempt)
    const cleanup = source.indexOf('.shouldKill()', ping)
    const kill = source.indexOf("['kill']", cleanup)
    assert.ok(attempt >= 0 && ping > attempt && cleanup > ping && kill > cleanup, `${file} cleanup ordering`)
  }
  const drillSource = readFileSync(join(SCRIPT_DIR, 'drill.mjs'), 'utf8')
  assert.match(
    drillSource,
    /try \{\s*if \(!existsSync\(stopMarker\)\) writeExclusive\(stopMarker, ''\)\s*\} catch \(error\) \{\s*if \(error\?\.code !== 'EEXIST'\) throw error\s*\}/,
  )
  console.log('  PASS PM2 control plane enforces short sockets, bounded commands, and attempted-start cleanup')
}

function verifyLinuxRuntimeHardening() {
  const runSource = readFileSync(join(SCRIPT_DIR, 'run.sh'), 'utf8')
  const drillSource = readFileSync(join(SCRIPT_DIR, 'drill.mjs'), 'utf8')

  if (typeof procfsRuntime.parseControlGroup !== 'function' || typeof procfsRuntime.controlGroup !== 'function') {
    throw new Error('D2_PRIME_PROCFS_HELPER_MISSING')
  }
  assert.strictEqual(
    procfsRuntime.parseControlGroup('11:memory:/legacy\n0::/user.slice/test.scope\n'),
    '/user.slice/test.scope',
  )
  for (const invalid of [undefined, '', '1:name:/legacy\n', '0::\n', '0::relative\n']) {
    expectRuntimeFailure(() => procfsRuntime.parseControlGroup(invalid), 'CGROUP_INVALID')
  }

  let observedProcPath = ''
  assert.strictEqual(
    procfsRuntime.controlGroup(123, {
      readFile: (path) => {
        observedProcPath = path
        return '0::/user.slice/test.scope\n'
      },
    }),
    '/user.slice/test.scope',
  )
  assert.strictEqual(observedProcPath, '/proc/123/cgroup')
  for (const invalidPid of [0, -1, 1.5, '123']) {
    expectRuntimeFailure(() => procfsRuntime.controlGroup(invalidPid), 'CGROUP_PID_INVALID')
  }
  for (const errorCode of ['ENOENT', 'EACCES']) {
    expectRuntimeFailure(
      () => procfsRuntime.controlGroup(123, {
        readFile: () => {
          throw Object.assign(new Error(`${errorCode} /private/secret/proc/123/cgroup`), { code: errorCode })
        },
      }),
      'CGROUP_UNREADABLE',
      [errorCode, '/private/secret', '/proc/123/cgroup'],
    )
  }

  assert.match(runSource, /XDG_RUNTIME_DIR_PATH="\/run\/user\/\$\(id -u\)"/)
  assert.match(
    runSource,
    /\[\[ -d "\$XDG_RUNTIME_DIR_PATH" && -O "\$XDG_RUNTIME_DIR_PATH" && ! -L "\$XDG_RUNTIME_DIR_PATH" \]\]/,
  )
  assert.match(runSource, /\[\[ "\$\(stat -c '%a' "\$XDG_RUNTIME_DIR_PATH"\)" == "700" \]\]/)
  assert.match(
    runSource,
    /\[\[ -S "\$XDG_RUNTIME_DIR_PATH\/bus" && -O "\$XDG_RUNTIME_DIR_PATH\/bus" && ! -L "\$XDG_RUNTIME_DIR_PATH\/bus" \]\]/,
  )
  assert.match(runSource, /ENV_BIN="\$\(command -v env\)"/, 'run.sh must capture the absolute env binary')
  assert.match(runSource, /SLEEP_BIN="\$\(command -v sleep\)"/, 'run.sh must capture the absolute sleep binary')
  assert.match(runSource, /SYSTEMD_RUN_BIN="\$\(command -v systemd-run\)"/)
  assert.match(
    runSource,
    /\[\[ "\$ENV_BIN" == \/\* && "\$SLEEP_BIN" == \/\* && "\$SYSTEMCTL_BIN" == \/\* && "\$SYSTEMD_RUN_BIN" == \/\* \]\] \\\s*\|\| no_go "D2_PRIME_NO_GO_ENVIRONMENT"/,
  )
  assert.match(
    runSource,
    /user_systemctl\(\) \{\s*"\$ENV_BIN" -i \\\s*PATH="\$APPROVED_PATH" \\\s*XDG_RUNTIME_DIR="\$XDG_RUNTIME_DIR_PATH" \\\s*"\$SYSTEMCTL_BIN" --user "\$@"\s*\}/,
  )
  assert.match(
    runSource,
    /user_systemd_run\(\) \{\s*"\$ENV_BIN" -i \\\s*PATH="\$APPROVED_PATH" \\\s*XDG_RUNTIME_DIR="\$XDG_RUNTIME_DIR_PATH" \\\s*"\$SYSTEMD_RUN_BIN" --user "\$@"\s*\}/,
  )
  assert.strictEqual((runSource.match(/"\$SYSTEMCTL_BIN" --user/g) ?? []).length, 1)
  assert.strictEqual((runSource.match(/"\$SYSTEMD_RUN_BIN" --user/g) ?? []).length, 1)
  assert.doesNotMatch(runSource, /(^|\n)[ \t]*(?:systemctl|systemd-run)[ \t]+--user\b/m)
  assert.doesNotMatch(runSource, /\s--setenv\b/)
  assert.match(
    runSource,
    /user_systemctl show-environment/,
  )
  const preflightStart = runSource.indexOf('PREFLIGHT_UNIT=')
  const preflightEnd = runSource.indexOf('NGINX_PORT=', preflightStart)
  assert.ok(preflightStart >= 0 && preflightEnd > preflightStart, 'preflight source boundaries')
  const preflightSource = runSource.slice(preflightStart, preflightEnd)
  assert.match(
    preflightSource,
    /user_systemd_run \\\s*--expand-environment=no \\\s*--collect \\\s*--unit "\$PREFLIGHT_UNIT"[\s\S]*?"\$ENV_BIN" -i \\\s*PATH="\$APPROVED_PATH" \\\s*"\$SLEEP_BIN" 30/,
    'preflight must disable systemd expansion and execute sleep with only the approved PATH',
  )
  assert.doesNotMatch(preflightSource, /(^|[\s;])\/usr\/bin\/sleep(?:[\s;]|$)/m)
  assert.match(
    runSource,
    /user_systemd_run \\\s*--expand-environment=no \\\s*--unit "\$UNIT_NAME"[\s\S]*?--collect \\\s*"\$ENV_BIN" -i \\\s*PATH="\$APPROVED_PATH" \\\s*HOME="\$MANAGED_HOME" \\\s*PM2_HOME="\$MANAGED_PM2_HOME" \\\s*D2_RUN_DIR="\$RUN_DIR" \\\s*D2_CONTROL_ROOT="\$PM2_CONTROL_ROOT" \\\s*D2_NONCE="\$NONCE" \\\s*D2_PM2_HOME_ID="\$MANAGED_PM2_HOME_ID" \\\s*D2_PM2_BIN="\$PM2_BIN" \\\s*"\$NODE_BIN" "\$SCRIPT_DIR\/managed-scope\.mjs"/,
  )
  assert.match(runSource, /export XDG_RUNTIME_DIR="\$XDG_RUNTIME_DIR_PATH"/)
  assert.match(
    runSource,
    /env -i[\s\S]*?XDG_RUNTIME_DIR="\$XDG_RUNTIME_DIR_PATH"[\s\S]*?"\$NODE_BIN" "\$SCRIPT_DIR\/drill\.mjs"/,
  )
  assert.match(drillSource, /ownedDirectory\(requiredEnvironment\('XDG_RUNTIME_DIR'\)\)/)
  assert.match(
    drillSource,
    /systemEnvironment = Object\.freeze\(Object\.assign\(Object\.create\(null\), \{[\s\S]*?XDG_RUNTIME_DIR: xdgRuntimeDir[\s\S]*?\}\)\)/,
  )

  const snapshot = 'const managedAppControlGroupBeforeRollback = controlGroup(managedAppPidBeforeRollback)'
  const rollback = "await activateRelease({ candidateRoot: r3.releaseRoot"
  const snapshotIndex = drillSource.indexOf(snapshot)
  const rollbackIndex = drillSource.indexOf(rollback)
  assert.ok(snapshotIndex >= 0 && rollbackIndex > snapshotIndex, 'managed cgroup snapshot must precede rollback')
  assert.strictEqual((drillSource.match(/controlGroup\(managedAppPidBeforeRollback\)/g) ?? []).length, 1)
  assert.doesNotMatch(drillSource.slice(rollbackIndex), /\bmanagedAppPidBeforeRollback\b/)
  assert.match(drillSource, /managedAppControlGroupBeforeRollback !== managedControlGroup/)
  assert.match(
    drillSource,
    /managedAppControlGroupId:\s*sha\(controlGroup\(managedAppPid\)\)/,
  )
  assert.doesNotMatch(drillSource, /\bassert\.equal\s*\(/)

  const stageIndices = []
  for (const stage of ['POST_CUTOVER', 'POST_ROLLBACK', 'EVIDENCE_VALIDATION']) {
    const stagePattern = new RegExp(`D2_PRIME_STAGE ${stage}\\\\n`, 'g')
    const matches = drillSource.match(stagePattern) ?? []
    assert.strictEqual(matches.length, 1, `${stage} stage marker count`)
    stageIndices.push(drillSource.indexOf(matches[0]))
  }
  assert.ok(
    stageIndices[0] < stageIndices[1] && stageIndices[1] < stageIndices[2],
    'stage markers must follow cutover, rollback, evidence order',
  )
  console.log('  PASS Linux runtime validates XDG, snapshots cgroups, and emits stable stages')
}

function expectEvidenceMutationFailure(evidence, mutate) {
  const candidate = clone(evidence)
  mutate(candidate)
  expectContractFailure(() => validateEvidence(candidate))
}

function verifyEvidenceContract() {
  const input = measurements()
  const evidence = buildEvidence({ ...input, ignoredSecret: 'must-not-survive' })
  assert.equal(Object.hasOwn(evidence, 'ignoredSecret'), false)
  assert.equal(evidence.verdict, 'D2_PRIME_PASS')
  assert.equal(evidence.productionF1, 'NO-GO')
  assert.equal(evidence.topology.sameNetworkNamespace, true)
  assert.equal(evidence.controlIsolation.homesDistinct, true)
  assert.equal(evidence.controlIsolation.daemonPidsDistinct, true)
  assert.equal(evidence.controlIsolation.namesDistinct, true)
  assert.equal(evidence.controlIsolation.releasePathsDistinct, true)
  assert.equal(evidence.controlIsolation.logPathsDistinct, true)
  assert.equal(evidence.nginx.allOrNoneObserved, true)
  assert.equal(evidence.resourceIsolation.cpuThrottlingObserved, true)
  assert.equal(validateEvidence(evidence).verdict, 'D2_PRIME_PASS')

  const noGo = buildEvidence({
    ...measurements(),
    topology: { ...measurements().topology, managedNetNamespaceInode: '4026531999' },
  })
  assert.equal(noGo.verdict, 'D2_PRIME_NO_GO')
  assert.equal(noGo.topology.sameNetworkNamespace, false)
  assert.equal(validateEvidence(noGo).verdict, 'D2_PRIME_NO_GO')
  const failureEvidence = buildEvidence(createFailureMeasurements('2026-07-30T08:01:00.000Z'))
  assert.equal(failureEvidence.verdict, 'D2_PRIME_NO_GO')
  assert.equal(validateEvidence(failureEvidence).verdict, 'D2_PRIME_NO_GO')

  expectEvidenceMutationFailure(evidence, (value) => { value.topology.managedEndpoint = '127.0.0.1:3010' })
  expectEvidenceMutationFailure(evidence, (value) => { value.topology.managedNetNamespaceInode = '4026531999' })
  expectEvidenceMutationFailure(evidence, (value) => { value.controlIsolation.managedPm2HomeId = value.controlIsolation.legacyPm2HomeId })
  expectEvidenceMutationFailure(evidence, (value) => { value.controlIsolation.managedDaemonId = value.controlIsolation.legacyDaemonId })
  expectEvidenceMutationFailure(evidence, (value) => { value.controlIsolation.managedNameId = value.controlIsolation.legacyNameId })
  expectEvidenceMutationFailure(evidence, (value) => { value.controlIsolation.managedReleasePathsId = value.controlIsolation.legacyReleasePathsId })
  expectEvidenceMutationFailure(evidence, (value) => { value.controlIsolation.managedLogPathsId = value.controlIsolation.legacyLogPathsId })
  expectEvidenceMutationFailure(evidence, (value) => { value.healthContract.legacyHealthProbeCountByReleaseTools = 1 })
  expectEvidenceMutationFailure(evidence, (value) => { value.nginx.binaryVersion = 'fake-nginx' })
  expectEvidenceMutationFailure(evidence, (value) => { value.nginx.invalidCandidateReloadAttempted = true })
  expectEvidenceMutationFailure(evidence, (value) => { value.nginx.observedTargetsAfterValidReload = ['legacy', 'managed'] })
  expectEvidenceMutationFailure(evidence, (value) => { value.releaseChain.rollbackTarget = 'legacy' })
  expectEvidenceMutationFailure(evidence, (value) => { value.releaseChain.legacyFallbackAttempted = true })
  expectEvidenceMutationFailure(evidence, (value) => { value.resourceIsolation.cgroupVersion = 'v1' })
  expectEvidenceMutationFailure(evidence, (value) => { value.resourceIsolation.engine = 'pm2' })
  expectEvidenceMutationFailure(evidence, (value) => { value.resourceIsolation.managedAppControlGroupId = SHA_B })
  expectEvidenceMutationFailure(evidence, (value) => { value.resourceIsolation.effectiveMemoryMaxBytes = 1 })
  expectEvidenceMutationFailure(evidence, (value) => { value.resourceIsolation.nrThrottledAfter = value.resourceIsolation.nrThrottledBefore })
  expectEvidenceMutationFailure(evidence, (value) => { value.resourceIsolation.legacyProbeFailuresUnderLoad = 1 })
  for (const field of Object.keys(evidence.dataSafety)) {
    expectEvidenceMutationFailure(evidence, (value) => { value.dataSafety[field] = true })
  }
  expectEvidenceMutationFailure(evidence, (value) => { value.productionF1 = 'GO' })
  expectEvidenceMutationFailure(evidence, (value) => { value.environment = { DATABASE_URL: 'secret' } })
  expectEvidenceMutationFailure(evidence, (value) => { value.logBody = 'sensitive log' })
  expectEvidenceMutationFailure(evidence, (value) => { value.recordedAt = 'not-an-instant' })
  expectEvidenceMutationFailure(evidence, (value) => {
    value.nginx.observedTargetsAfterInvalidCandidate = ['legacy', { log: 'must-not-survive' }]
    value.nginx.allOrNoneObserved = false
    value.verdict = 'D2_PRIME_NO_GO'
  })
  expectEvidenceMutationFailure(evidence, (value) => {
    value.nginx.binaryVersion = `nginx/${'x'.repeat(500)}`
    value.verdict = 'D2_PRIME_NO_GO'
  })
  expectEvidenceMutationFailure(evidence, (value) => { delete value.healthContract })

  for (const [section, booleanField, rawMutation] of [
    ['topology', 'sameNetworkNamespace', (value) => { value.topology.managedNetNamespaceInode = '99' }],
    ['controlIsolation', 'homesDistinct', (value) => { value.controlIsolation.managedPm2HomeId = value.controlIsolation.legacyPm2HomeId }],
    ['nginx', 'allOrNoneObserved', (value) => { value.nginx.observedTargetsAfterValidReload = ['legacy', 'managed'] }],
    ['resourceIsolation', 'cpuThrottlingObserved', (value) => { value.resourceIsolation.nrThrottledAfter = value.resourceIsolation.nrThrottledBefore }],
  ]) {
    expectEvidenceMutationFailure(evidence, (value) => {
      rawMutation(value)
      value[section][booleanField] = true
    })
  }
  console.log('  PASS evidence schema derives verdict from raw measurements and rejects spoofing')
}

function verifyEvidenceFile(args) {
  if (args.length === 0) return
  if (args.length !== 2 || args[0] !== '--evidence' || !isAbsolute(args[1])) {
    throw new Error('D2_PRIME_EVIDENCE_ARGUMENT_INVALID')
  }
  const evidencePath = args[1]
  const stat = lstatSync(evidencePath)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.size > 256 * 1024) {
    throw new Error('D2_PRIME_EVIDENCE_FILE_INVALID')
  }
  const evidence = validateEvidence(JSON.parse(readFileSync(evidencePath, 'utf8')))
  console.log(`evidenceVerdict=${evidence.verdict}`)
  console.log(`productionF1=${evidence.productionF1}`)
  if (evidence.verdict !== 'D2_PRIME_PASS') {
    throw new Error('D2_PRIME_EVIDENCE_NO_GO')
  }
  console.log('D2_PRIME_EVIDENCE_PASS')
}

function main(args = process.argv.slice(2)) {
  console.log('=== D2 prime offline contract ===')
  verifyNginxRenderer()
  verifyCutoverStateMachine()
  verifyPm2ControlPlane()
  verifyLinuxRuntimeHardening()
  verifyEvidenceContract()
  console.log('D2_PRIME_CONTRACT_ALL_PASS')
  verifyEvidenceFile(args)
}

try {
  main()
} catch (error) {
  const code = error instanceof Error && /^D2_PRIME_[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : 'D2_PRIME_EVIDENCE_REJECTED'
  console.error(code)
  process.exitCode = 2
}
