#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import * as diagnosticModule from './diagnostics.mjs'
import { verifyCleanupContract as verifyReconciledCleanupContract } from './verify-cleanup-contract.mjs'
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
import {
  DRILL_ERROR_CLASSES,
  DRILL_PHASES,
  FAILURE_EVIDENCE_CODE,
  classifyDrillFailure,
  createDrillDiagnosticError,
  formatDrillFailure,
  resolveDrillDiagnostic,
  withFailureEvidenceWriteFailure,
} from './diagnostics.mjs'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHA_C = 'c'.repeat(64)
const SHA_D = 'd'.repeat(64)
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const RUNBOOK_PATH = join(SCRIPT_DIR, '../../../../docs/device/f1-d2-same-host-dual-port-runbook.md')
const FRESH_RETAKE_COMMAND = `env -i \\
  PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \\
  HOME="$HOME" \\
  LANG=C.UTF-8 \\
  D2_APPROVED_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \\
  D2_GOVERNANCE_ROOT="$D2_GOVERNANCE_ROOT" \\
  D2_GOVERNANCE_RESERVATION_ID="$D2_GOVERNANCE_RESERVATION_ID" \\
  pnpm --filter @ai-job-print/api drill:d2-same-host`
const FRESH_CLONE_PROVENANCE_SEQUENCE = Object.freeze([
  'set -euo pipefail',
  "readonly D2_APPROVED_PATH='/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'",
  'D2_SOURCE_ROOT="$(cd -P -- "$D2_SOURCE_REPOSITORY" && pwd -P)"',
  '[[ "$(git rev-parse --show-toplevel)" == "$D2_SOURCE_ROOT" ]]',
  '[[ "$(git rev-parse HEAD)" == "$D2_BASELINE_OID" ]]',
  '[[ -z "$(git status --porcelain=v2 --untracked-files=all)" ]]',
  '[[ ! -e "$D2_CLONE_ROOT" && ! -L "$D2_CLONE_ROOT" ]]',
  'D2_CLONE_PHYSICAL_TARGET="$(cd -P -- "$D2_CLONE_PARENT" && pwd -P)/$D2_CLONE_NAME"',
  '[[ "$D2_CLONE_ROOT" == "$D2_CLONE_PHYSICAL_TARGET" ]]',
  'git clone --no-local -- "$D2_SOURCE_ROOT" "$D2_CLONE_ROOT"',
  'git switch -c "$D2_BRANCH" "$D2_BASELINE_OID"',
  '[[ "$(git rev-parse --show-toplevel)" == "$D2_CLONE_ROOT" ]]',
  '[[ "$(git rev-parse --git-dir)" == \'.git\' && -d .git && ! -L .git ]]',
  '[[ "$(git rev-parse HEAD)" == "$D2_BASELINE_OID" ]]',
  '[[ "$(git symbolic-ref --quiet --short HEAD)" == "$D2_BRANCH" ]]',
  '[[ -z "$(git status --porcelain=v2 --untracked-files=all)" ]]',
  'pnpm --filter @ai-job-print/api build',
  'pnpm --filter @ai-job-print/api verify:d2-same-host-governance',
  'pnpm --filter @ai-job-print/api verify:d2-same-host-contract',
  'node services/api/scripts/d2-same-host/governance.mjs reserve',
  'pnpm --filter @ai-job-print/api drill:d2-same-host',
])

function executableSource(source) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source)
  const noise = new Set([
    ts.SyntaxKind.SingleLineCommentTrivia, ts.SyntaxKind.MultiLineCommentTrivia,
    ts.SyntaxKind.StringLiteral, ts.SyntaxKind.RegularExpressionLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail,
  ])
  const templateBraceDepths = []
  let result = ''
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (templateBraceDepths.length > 0 && token === ts.SyntaxKind.OpenBraceToken) {
      templateBraceDepths[templateBraceDepths.length - 1] += 1
    } else if (templateBraceDepths.length > 0 && token === ts.SyntaxKind.CloseBraceToken) {
      const templateIndex = templateBraceDepths.length - 1
      if (templateBraceDepths[templateIndex] === 0) {
        token = scanner.reScanTemplateToken(false)
        if (token === ts.SyntaxKind.TemplateTail) templateBraceDepths.pop()
      } else {
        templateBraceDepths[templateIndex] -= 1
      }
    }
    const text = scanner.getTokenText()
    result += noise.has(token) ? text.replace(/[^\r\n]/g, ' ') : text
    if (token === ts.SyntaxKind.TemplateHead) templateBraceDepths.push(0)
  }
  assert.equal(templateBraceDepths.length, 0)
  return result
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function replaceOccurrence(source, fragment, occurrence, replacement) {
  let fragmentIndex = -1
  for (let current = 0; current <= occurrence; current += 1) {
    fragmentIndex = source.indexOf(fragment, fragmentIndex + 1)
    assert.notEqual(fragmentIndex, -1)
  }
  return `${source.slice(0, fragmentIndex)}${replacement}${source.slice(fragmentIndex + fragment.length)}`
}

function expectContractFailure(action) {
  assert.throws(
    action,
    (error) => error instanceof Error && /^D2_PRIME_(?:CONTRACT|EVIDENCE)_INVALID$/.test(error.message),
  )
}

function assertExecutionEntryContract(runSource, runbookSource) {
  const shellSource = runSource.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')
  const approvedPathGuard = '[[ "$path_part" != "$ROOT" && "$path_part" != "$ROOT/"* ]]'
  const physicalPathGuard = '[[ "$path_part_physical" != "$ROOT" && "$path_part_physical" != "$ROOT/"* ]]'
  const explicitGovernanceGuard = '[[ -n "${D2_GOVERNANCE_ROOT:-}" && -n "${D2_GOVERNANCE_RESERVATION_ID:-}" ]]'
  assert.ok(shellSource.includes(approvedPathGuard))
  assert.ok(shellSource.includes(physicalPathGuard))
  assert.ok(shellSource.includes(explicitGovernanceGuard))
  const approvedPathBlock = shellSource.slice(shellSource.indexOf('APPROVED_PATH='), shellSource.indexOf('export PATH="$APPROVED_PATH"'))
  assert.doesNotMatch(approvedPathBlock, /no_go "(?!D2_PRIME_NO_GO_APPROVED_PATH")/)
  assert.doesNotMatch(shellSource, /D2_PRIME_NO_GO_ENVIRONMENT/)
  assert.match(
    shellSource,
    /command -v "\$required_command"[^\n]+no_go "D2_PRIME_NO_GO_APPROVED_PATH_COMMAND"/,
  )
  const allowedCodes = new Set([
    'D2_PRIME_CLEANUP_FAILED', 'D2_PRIME_EVIDENCE_REJECTED', 'D2_PRIME_RUNTIME_FAILURE',
    'D2_PRIME_NO_GO_APPROVED_PATH', 'D2_PRIME_NO_GO_APPROVED_PATH_COMMAND',
    'D2_PRIME_NO_GO_BUILD_INPUT', 'D2_PRIME_NO_GO_CGROUP_DELEGATION',
    'D2_PRIME_NO_GO_EVIDENCE_EXISTS', 'D2_PRIME_NO_GO_EVIDENCE_PATH', 'D2_PRIME_NO_GO_KERNEL',
    'D2_PRIME_NO_GO_GIT_IDENTITY',
    'D2_PRIME_NO_GO_GOVERNANCE_STATE', 'D2_PRIME_NO_GO_MANIFEST',
    'D2_PRIME_NO_GO_MANAGED_SCOPE', 'D2_PRIME_NO_GO_NONCE', 'D2_PRIME_NO_GO_PATH',
    'D2_PRIME_NO_GO_PM2_PREFLIGHT', 'D2_PRIME_NO_GO_PORT', 'D2_PRIME_NO_GO_PRODUCTION_ENV',
    'D2_PRIME_NO_GO_RUNTIME_DIR', 'D2_PRIME_NO_GO_TOOLCHAIN', 'D2_PRIME_NO_GO_USER_MANAGER',
    'D2_PRIME_NO_GO_WORKSPACE',
  ])
  const calls = [...shellSource.matchAll(/\bno_go\s+("[A-Z0-9_]+")/g)].map((match) => match[1].slice(1, -1))
  assert.ok(calls.length > 0 && calls.every((code) => allowedCodes.has(code)))
  assert.equal((shellSource.match(/\bno_go\s+/g) ?? []).length, calls.length)

  const startMarker = '<!-- D2_FRESH_RETAKE_COMMAND_START -->'
  const endMarker = '<!-- D2_FRESH_RETAKE_COMMAND_END -->'
  assert.equal(runbookSource.split(startMarker).length, 2)
  assert.equal(runbookSource.split(endMarker).length, 2)
  const marked = runbookSource.slice(
    runbookSource.indexOf(startMarker) + startMarker.length,
    runbookSource.indexOf(endMarker),
  ).trim()
  assert.equal(marked, `\`\`\`bash\n${FRESH_RETAKE_COMMAND}\n\`\`\``)
  assert.equal((runbookSource.match(/drill:d2-same-host/g) ?? []).length, 1)
  let provenanceCursor = -1
  for (const fragment of FRESH_CLONE_PROVENANCE_SEQUENCE) {
    provenanceCursor = runbookSource.indexOf(fragment, provenanceCursor + 1)
    assert.notEqual(provenanceCursor, -1)
    provenanceCursor += fragment.length - 1
  }
  const expectedOccurrences = new Map()
  for (const fragment of FRESH_CLONE_PROVENANCE_SEQUENCE) {
    expectedOccurrences.set(fragment, (expectedOccurrences.get(fragment) ?? 0) + 1)
  }
  for (const [fragment, expected] of expectedOccurrences) {
    assert.equal(runbookSource.split(fragment).length - 1, expected)
  }
}

function verifyExecutionEntryContract() {
  const runSource = readFileSync(join(SCRIPT_DIR, 'run.sh'), 'utf8')
  const runbookSource = readFileSync(RUNBOOK_PATH, 'utf8')
  assertExecutionEntryContract(runSource, runbookSource)
  const guard = '[[ "$path_part" != "$ROOT" && "$path_part" != "$ROOT/"* ]]'
  const physicalGuard = '[[ "$path_part_physical" != "$ROOT" && "$path_part_physical" != "$ROOT/"* ]]'
  const governanceGuard = '[[ -n "${D2_GOVERNANCE_ROOT:-}" && -n "${D2_GOVERNANCE_RESERVATION_ID:-}" ]]'
  const markedCommand = `\`\`\`bash\n${FRESH_RETAKE_COMMAND}\n\`\`\``
  const mutateMarkedCommand = (from, to) => runbookSource.replace(
    markedCommand, markedCommand.replace(from, to),
  )
  assert.throws(() => assertExecutionEntryContract(runSource.replace(guard, ':'), runbookSource))
  assert.throws(() => assertExecutionEntryContract(`# ${guard}\n${runSource.replace(guard, ':')}`, runbookSource))
  assert.throws(() => assertExecutionEntryContract(runSource.replace(physicalGuard, ':'), runbookSource))
  assert.throws(() => assertExecutionEntryContract(runSource.replace(governanceGuard, ':'), runbookSource))
  assert.throws(() => assertExecutionEntryContract(runSource.replace('D2_PRIME_NO_GO_APPROVED_PATH', 'D2_PRIME_NO_GO_PATH'), runbookSource))
  assert.throws(() => assertExecutionEntryContract(runSource.replace('command -v "$required_command"', ':'), runbookSource))
  assert.throws(() => assertExecutionEntryContract(runSource.replace('D2_PRIME_NO_GO_APPROVED_PATH_COMMAND', 'D2_PRIME_NO_GO_ENVIRONMENT'), runbookSource))
  assert.throws(() => assertExecutionEntryContract(`${runSource}\nno_go "D2_PRIME_NO_GO_UNLISTED"\n`, runbookSource))
  assert.throws(() => assertExecutionEntryContract(runSource, mutateMarkedCommand('D2_GOVERNANCE_ROOT=', 'D2_GOVERNANCE_STATE_ROOT=')))
  assert.throws(() => assertExecutionEntryContract(runSource, mutateMarkedCommand('D2_GOVERNANCE_RESERVATION_ID=', 'D2_GOVERNANCE_ID=')))
  for (const fragment of new Set(FRESH_CLONE_PROVENANCE_SEQUENCE)) {
    const occurrences = FRESH_CLONE_PROVENANCE_SEQUENCE.filter((item) => item === fragment).length
    for (let occurrence = 0; occurrence < occurrences; occurrence += 1) {
      assert.throws(() => assertExecutionEntryContract(
        runSource,
        replaceOccurrence(runbookSource, fragment, occurrence, 'D2_FRESH_CLONE_PROVENANCE_MUTATION'),
      ))
    }
  }
  console.log('  PASS D2 fresh-retake entry rejects repository PATH and locks one canonical command')
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
  assert.match(runSource, /PM2_RUNTIME_ROOT="\$XDG_RUNTIME_DIR"/)
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

function assertUserSystemdEnvironmentContract(runSource, drillSource) {
  const deriveXdg = runSource.match(/^XDG_RUNTIME_DIR="\/run\/user\/\$\(id -u\)"$/m)?.index ?? -1
  const directoryCheck = runSource.match(
    /^\[\[ -d "\$XDG_RUNTIME_DIR" && -O "\$XDG_RUNTIME_DIR" && ! -L "\$XDG_RUNTIME_DIR" \]\] \\\n  \|\| no_go "D2_PRIME_NO_GO_RUNTIME_DIR"$/m,
  )
  const modeCheck = runSource.match(
    /^\[\[ "\$\(stat -c '%a' "\$XDG_RUNTIME_DIR"\)" == "700" && "\$\(realpath "\$XDG_RUNTIME_DIR"\)" == "\$XDG_RUNTIME_DIR" \]\] \\\n  \|\| no_go "D2_PRIME_NO_GO_RUNTIME_DIR"$/m,
  )
  const exportXdg = runSource.match(/^export XDG_RUNTIME_DIR$/m)?.index ?? -1
  const firstUserSystemd = runSource.match(/^[ \t]*(?:systemctl|systemd-run)[ \t]+--user\b/m)?.index ?? -1
  assert.ok(
    deriveXdg >= 0 &&
      directoryCheck?.index > deriveXdg &&
      modeCheck?.index > directoryCheck.index &&
      exportXdg > modeCheck.index &&
      firstUserSystemd > exportXdg,
    'run.sh must derive, validate, and export trusted XDG before its first user-systemd call',
  )
  assert.match(runSource, /^PM2_RUNTIME_ROOT="\$XDG_RUNTIME_DIR"$/m)

  const drillInvocationStart = runSource.indexOf('set +e\nenv -i')
  const drillInvocationEnd = runSource.indexOf('DRILL_STATUS=$?', drillInvocationStart)
  assert.ok(
    drillInvocationStart >= 0 && drillInvocationEnd > drillInvocationStart,
    'run.sh must retain a bounded env -i drill invocation',
  )
  const drillInvocation = runSource.slice(drillInvocationStart, drillInvocationEnd)
  assert.match(drillInvocation, /^  XDG_RUNTIME_DIR="\$XDG_RUNTIME_DIR" \\$/m)
  assert.match(drillInvocation, /^  "\$NODE_BIN" "\$SCRIPT_DIR\/drill\.mjs"$/m)

  assert.match(
    drillSource,
    /^  const xdgRuntimeDir = ownedDirectory\(requiredEnvironment\('XDG_RUNTIME_DIR'\)\)$/m,
  )
  assert.match(
    drillSource,
    /xdgRuntimeDir !== join\('\/run\/user', String\(process\.getuid\(\)\)\)/,
  )
  assert.match(drillSource, /\(lstatSync\(xdgRuntimeDir\)\.mode & 0o777\) !== 0o700/)
  assert.match(
    drillSource,
    /systemEnvironment = Object\.freeze\(Object\.assign\(\s*Object\.create\(null\),\s*\{ PATH: approvedPath, HOME: managedHome, XDG_RUNTIME_DIR: xdgRuntimeDir \},?\s*\)\)/,
  )
  const systemdValueCalls = drillSource
    .split('\n')
    .filter((line) => line.includes('systemdValue(') && !line.trimStart().startsWith('function '))
  assert.equal(systemdValueCalls.length, 5)
  for (const call of systemdValueCalls) assert.match(call, /,\s*systemEnvironment\)/)

  const forbiddenBusCoupling = /DBUS_SESSION_BUS_ADDRESS|\/run\/user\/[^"'\n]*\/bus\b|["']bus["']/
  assert.doesNotMatch(runSource, forbiddenBusCoupling)
  assert.doesNotMatch(drillSource, forbiddenBusCoupling)
}

function verifyUserSystemdEnvironmentContract() {
  const runSource = readFileSync(join(SCRIPT_DIR, 'run.sh'), 'utf8')
  const drillSource = readFileSync(join(SCRIPT_DIR, 'drill.mjs'), 'utf8')
  assertUserSystemdEnvironmentContract(runSource, drillSource)

  const commentDecoy = runSource.replace(
    'XDG_RUNTIME_DIR="/run/user/$(id -u)"',
    '# XDG_RUNTIME_DIR="/run/user/$(id -u)"\nXDG_RUNTIME_DIR="${XDG_RUNTIME_DIR}"',
  )
  assert.throws(() => assertUserSystemdEnvironmentContract(commentDecoy, drillSource))

  for (const command of [
    '  systemctl --user status >/dev/null',
    'systemctl  --user status >/dev/null',
    'systemctl\t--user status >/dev/null',
  ]) {
    const earlySystemdCall = runSource.replace(
      'XDG_RUNTIME_DIR="/run/user/$(id -u)"',
      `${command}\nXDG_RUNTIME_DIR="/run/user/$(id -u)"`,
    )
    assert.throws(() => assertUserSystemdEnvironmentContract(earlySystemdCall, drillSource))
  }

  const validationStart = runSource.indexOf('[[ -d "$XDG_RUNTIME_DIR"')
  const validationEnd = runSource.indexOf('export XDG_RUNTIME_DIR')
  const validationBlock = runSource.slice(validationStart, validationEnd)
  const checksAfterSystemd = runSource
    .replace(validationBlock, '')
    .replace(
      /^(systemctl --user show-environment >\/dev\/null 2>&1 \\\n  \|\| no_go "D2_PRIME_NO_GO_USER_MANAGER")$/m,
      `$1\n${validationBlock.trimEnd()}`,
    )
  assert.throws(() => assertUserSystemdEnvironmentContract(checksAfterSystemd, drillSource))

  const missingInnerXdg = runSource.replace('  XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \\\n', '')
  assert.throws(() => assertUserSystemdEnvironmentContract(missingInnerXdg, drillSource))

  const wrongSystemEnvironment = drillSource.replace(
    "'ControlGroup', systemEnvironment",
    "'ControlGroup', managedEnvironment",
  )
  assert.throws(() => assertUserSystemdEnvironmentContract(runSource, wrongSystemEnvironment))

  for (const busCoupling of [
    '\nDBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/1000/bus"\n',
    '\nBUS_PATH="/run/user/1000/bus"\n',
    '\nBUS_PATH="/run/user/$(id -u)/bus"\n',
  ]) {
    assert.throws(() => assertUserSystemdEnvironmentContract(`${runSource}${busCoupling}`, drillSource))
  }
  console.log('  PASS user-systemd environment derives and propagates trusted XDG without DBUS coupling')
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

function verifyDrillDiagnosticContract() {
  const { MEASURE_STEPS } = diagnosticModule
  assert.deepEqual(Object.values(MEASURE_STEPS ?? {}), [
    'NONE', 'MANAGED_PID', 'NGINX_VERSION', 'TOPOLOGY', 'CONTROL_ISOLATION',
    'RESOURCE_ISOLATION', 'CGROUP_CONSISTENCY',
  ])
  assert.equal(Object.isFrozen(MEASURE_STEPS), true)
  assert.deepEqual(Object.values(DRILL_PHASES), [
    'SETUP', 'CUTOVER', 'ROLLBACK', 'MEASURE', 'EVIDENCE', 'CLEANUP',
  ])
  assert.deepEqual(Object.values(DRILL_ERROR_CLASSES), [
    'NAMED', 'ASSERTION', 'SYSTEM', 'SYNTAX', 'TYPE', 'ERROR', 'UNKNOWN',
  ])
  assert.equal(Object.isFrozen(DRILL_PHASES), true)
  assert.equal(Object.isFrozen(DRILL_ERROR_CLASSES), true)

  const named = classifyDrillFailure(
    new Error('RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK'),
    DRILL_PHASES.ROLLBACK,
  )
  assert.deepEqual(named, {
    phase: 'ROLLBACK', errorClass: 'NAMED', code: 'RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK',
    measureStep: 'NONE', failureEvidenceCode: null,
  })
  assert.equal(formatDrillFailure(named),
    'D2_PRIME_NO_GO phase=ROLLBACK class=NAMED code=RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK step=NONE')

  const injectedSecret = 'db-password-must-not-survive'
  const injectedPath = '/var/lib/private/runtime/secret.json'
  const injectedNonce = 'aabbccddaabbccddaabbccddaabbccdd'
  const injectedHostname = 'production-db-01.internal.example'
  const injectedPid = 'pid=424242'
  const injectedEvidence = '{"DATABASE_URL":"postgres://admin:secret@production-db-01"}'
  const injectedStack = `Error: ${injectedSecret}\n    at ${injectedPath}:42:7`
  const injectedCause = new Error(`${injectedHostname} ${injectedEvidence}`)
  const unknown = classifyDrillFailure(
    Object.assign(new Error(`${injectedSecret} ${injectedPath} ${injectedNonce}`), {
      stack: injectedStack,
      cause: injectedCause,
      hostname: injectedHostname,
      pid: injectedPid,
      evidence: injectedEvidence,
    }),
    DRILL_PHASES.CUTOVER,
  )
  const unknownOutput = formatDrillFailure(unknown)
  assert.equal(unknownOutput, 'D2_PRIME_NO_GO phase=CUTOVER class=ERROR code=D2_PRIME_DRILL_FAILED step=NONE')
  for (const forbidden of [
    injectedSecret, injectedPath, injectedNonce, injectedHostname, injectedPid, injectedEvidence,
  ]) {
    assert.doesNotMatch(unknownOutput, new RegExp(forbidden.replaceAll('/', '\\/')))
  }

  const prefixShapedSecret = 'D2_PRIME_DATABASE_PASSWORD_SUPERSECRET'
  const prefixOutput = formatDrillFailure(classifyDrillFailure(
    new Error(prefixShapedSecret),
    DRILL_PHASES.SETUP,
  ))
  assert.equal(prefixOutput, 'D2_PRIME_NO_GO phase=SETUP class=ERROR code=D2_PRIME_DRILL_FAILED step=NONE')
  assert.doesNotMatch(prefixOutput, /DATABASE_PASSWORD|SUPERSECRET/)

  const throwingGetter = Object.create(Error.prototype, {
    message: { get() { throw new Error(injectedSecret) } },
    code: { get() { throw new Error(injectedPath) } },
  })
  assert.doesNotThrow(() => classifyDrillFailure(throwingGetter, DRILL_PHASES.SETUP))
  assert.equal(classifyDrillFailure(throwingGetter, DRILL_PHASES.SETUP).code, 'D2_PRIME_DRILL_FAILED')
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  assert.doesNotThrow(() => classifyDrillFailure(revoked.proxy, DRILL_PHASES.SETUP))
  assert.equal(classifyDrillFailure(revoked.proxy, DRILL_PHASES.SETUP).errorClass, 'UNKNOWN')
  assert.doesNotThrow(() => resolveDrillDiagnostic(revoked.proxy, DRILL_PHASES.CLEANUP))

  const assertion = classifyDrillFailure(new assert.AssertionError({
    message: `${injectedPath}:${injectedNonce}`,
    actual: injectedSecret,
    expected: 'safe',
    operator: 'strictEqual',
  }), DRILL_PHASES.MEASURE, MEASURE_STEPS.CGROUP_CONSISTENCY)
  assert.equal(assertion.errorClass, 'ASSERTION')
  assert.equal(assertion.measureStep, 'CGROUP_CONSISTENCY')
  assert.doesNotMatch(formatDrillFailure(assertion), /secret|private|aabbccdd/)

  const systemError = Object.assign(new Error(`${injectedSecret}:${injectedPath}`), {
    code: 'EPERM', path: injectedPath, syscall: 'open',
  })
  assert.equal(classifyDrillFailure(systemError, DRILL_PHASES.EVIDENCE).errorClass, 'SYSTEM')
  const measuredSystem = classifyDrillFailure(
    systemError, DRILL_PHASES.MEASURE, MEASURE_STEPS.RESOURCE_ISOLATION,
  )
  assert.equal(measuredSystem.measureStep, 'RESOURCE_ISOLATION')
  assert.equal(formatDrillFailure(measuredSystem),
    'D2_PRIME_NO_GO phase=MEASURE class=SYSTEM code=D2_PRIME_DRILL_FAILED step=RESOURCE_ISOLATION')
  assert.throws(
    () => classifyDrillFailure(systemError, DRILL_PHASES.MEASURE),
    /D2_PRIME_DIAGNOSTIC_CONTRACT_INVALID/,
  )
  assert.equal(
    classifyDrillFailure(systemError, DRILL_PHASES.EVIDENCE, injectedPath).measureStep,
    MEASURE_STEPS.NONE,
  )
  const arbitraryErrno = Object.assign(new Error(injectedSecret), { code: `E_${injectedNonce}` })
  assert.equal(classifyDrillFailure(arbitraryErrno, DRILL_PHASES.EVIDENCE).errorClass, 'ERROR')

  const evidenceFailure = withFailureEvidenceWriteFailure(unknown)
  assert.equal(evidenceFailure.failureEvidenceCode, FAILURE_EVIDENCE_CODE)
  assert.equal(
    formatDrillFailure(evidenceFailure),
    `D2_PRIME_NO_GO phase=CUTOVER class=ERROR code=D2_PRIME_DRILL_FAILED step=NONE evidence=${FAILURE_EVIDENCE_CODE}`,
  )
  const wrapped = createDrillDiagnosticError(evidenceFailure)
  assert.deepEqual(resolveDrillDiagnostic(wrapped, DRILL_PHASES.CLEANUP), evidenceFailure)
  assert.equal(resolveDrillDiagnostic(new TypeError(injectedSecret), DRILL_PHASES.CLEANUP).errorClass, 'TYPE')

  for (const invalid of [
    { ...unknown, phase: 'SECRET' },
    { ...unknown, errorClass: injectedSecret },
    { ...unknown, code: injectedNonce },
    { ...unknown, errorClass: 'NAMED', code: prefixShapedSecret },
    { ...unknown, errorClass: 'NAMED', code: 'RELEASE_PROVENANCE_PASSWORD_SUPERSECRET' },
    { ...unknown, measureStep: injectedNonce },
    { ...unknown, phase: 'MEASURE' },
    { ...unknown, measureStep: 'TOPOLOGY' },
    { ...unknown, failureEvidenceCode: 'EACCES' },
    { ...unknown, extra: injectedPath },
  ]) assert.throws(() => formatDrillFailure(invalid), /D2_PRIME_DIAGNOSTIC_CONTRACT_INVALID/)
  const accessorDiagnostic = Object.defineProperties({}, {
    phase: { enumerable: true, get() { return `SETUP\n${injectedSecret}` } },
    errorClass: { enumerable: true, value: 'ERROR' },
    code: { enumerable: true, value: 'D2_PRIME_DRILL_FAILED' },
    measureStep: { enumerable: true, get() { return injectedNonce } },
    failureEvidenceCode: { enumerable: true, value: null },
  })
  assert.throws(
    () => formatDrillFailure(accessorDiagnostic),
    /D2_PRIME_DIAGNOSTIC_CONTRACT_INVALID/,
  )
  const revokedDiagnostic = Proxy.revocable({ ...unknown }, {})
  revokedDiagnostic.revoke()
  assert.throws(
    () => formatDrillFailure(revokedDiagnostic.proxy),
    /D2_PRIME_DIAGNOSTIC_CONTRACT_INVALID/,
  )
  let phaseDescriptorReads = 0
  const changingDiagnostic = new Proxy({ ...unknown, phase: 'SETUP' }, {
    getOwnPropertyDescriptor(target, property) {
      if (property !== 'phase') return Reflect.getOwnPropertyDescriptor(target, property)
      phaseDescriptorReads += 1
      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value: phaseDescriptorReads >= 3 ? `SETUP\n${injectedSecret}` : 'SETUP',
      }
    },
  })
  assert.equal(
    formatDrillFailure(changingDiagnostic),
    'D2_PRIME_NO_GO phase=SETUP class=ERROR code=D2_PRIME_DRILL_FAILED step=NONE',
  )

  const genericEvidence = JSON.stringify(buildEvidence({
    ...createFailureMeasurements('2026-07-31T03:30:00.000Z'),
    message: injectedSecret,
    path: injectedPath,
    nonce: injectedNonce,
    hostname: injectedHostname,
    pid: injectedPid,
    stack: injectedStack,
    cause: injectedCause,
    evidence: injectedEvidence,
  }))
  for (const forbidden of [
    injectedSecret, injectedPath, injectedNonce, injectedHostname, injectedPid, injectedEvidence,
  ]) assert.equal(genericEvidence.includes(forbidden), false)
  console.log('  PASS drill diagnostics preserve fixed phase/class/code/step without sensitive-value leakage')
}

function assertDrillDiagnosticWiring(source) {
  assert.match(source, /from '\.\/diagnostics\.mjs'/)
  const executable = executableSource(source)
  assert.match(executable, /let currentPhase = DRILL_PHASES\.SETUP/)
  assert.match(executable, /let currentMeasureStep = MEASURE_STEPS\.NONE/)
  for (const [phase, anchor] of [
    ['CUTOVER', 'let cutoverState ='],
    ['ROLLBACK', 'let failedReleaseError ='],
    ['MEASURE', 'const managedAppPid = pm2AppPid'],
    ['EVIDENCE', 'const evidence = validateEvidence'],
    ['CLEANUP', 'if (managedDaemonReady)'],
  ]) {
    const assignment = executable.indexOf(`currentPhase = DRILL_PHASES.${phase}`)
    const operation = executable.indexOf(anchor)
    assert.ok(assignment >= 0 && operation > assignment, `${phase} phase must precede ${anchor}`)
  }
  for (const [step, anchor] of [
    ['MANAGED_PID', 'const managedAppPid = pm2AppPid'],
    ['NGINX_VERSION', 'const nginxVersionOutput = run'],
    ['TOPOLOGY', 'const topology = {'],
    ['CONTROL_ISOLATION', 'const controlIsolation = {'],
    ['RESOURCE_ISOLATION', 'const resourceIsolation = {'],
    ['CGROUP_CONSISTENCY', 'if (processStartTimeTicks(managedAppPid) !== managedAppPidTicks) fail('],
  ]) {
    const assignment = `currentMeasureStep = MEASURE_STEPS.${step}`
    assert.equal(executable.split(assignment).length - 1, 1)
    const adjacency = `${assignment}\n    ${anchor}`
    assert.ok(executable.includes(adjacency), `${step} must immediately precede ${anchor}`)
  }
  const innerCatch = executable.slice(executable.indexOf('  } catch (error) {'), executable.indexOf('  } finally {'))
  assert.match(innerCatch, /let diagnostic = classifyDrillFailure\(error, currentPhase, currentMeasureStep\)/)
  const partialEvidenceBranch = innerCatch.slice(
    innerCatch.indexOf('if (existsSync(evidenceOut)) {'),
    innerCatch.indexOf('} else {'),
  )
  assert.match(partialEvidenceBranch, /diagnostic = withFailureEvidenceWriteFailure\(diagnostic\)/)
  const writeFailureCatch = innerCatch.slice(
    innerCatch.indexOf('        } catch {'),
    innerCatch.indexOf('        }\n      }', innerCatch.indexOf('        } catch {')),
  )
  assert.match(writeFailureCatch, /diagnostic = withFailureEvidenceWriteFailure\(diagnostic\)/)
  assert.match(innerCatch, /throw createDrillDiagnosticError\(diagnostic\)/)
  const topLevelCatch = executable.slice(executable.lastIndexOf('main().catch'))
  assert.match(topLevelCatch, /formatDrillFailure\(resolveDrillDiagnostic\(error, currentPhase, currentMeasureStep\)\)/)
  assert.doesNotMatch(topLevelCatch, /error\.(?:message|stack|cause|code|path|syscall)/)
  assert.doesNotMatch(topLevelCatch, /JSON\.stringify\(error|String\(error\)/)
}

function verifyDrillDiagnosticWiring() {
  const source = readFileSync(join(SCRIPT_DIR, 'drill.mjs'), 'utf8')
  assertDrillDiagnosticWiring(source)
  for (const unsafeMutation of [
    source.replace('currentPhase = DRILL_PHASES.CUTOVER', '// phase removed'),
    source.replace('if (existsSync(evidenceOut)) {', 'if (false) {'),
    source.replace(
      /if \(existsSync\(evidenceOut\)\) \{\s*diagnostic = withFailureEvidenceWriteFailure\(diagnostic\)/,
      'if (existsSync(evidenceOut)) { // partial marker removed',
    ),
    source.replace(
      /} catch \{\s*diagnostic = withFailureEvidenceWriteFailure\(diagnostic\)/,
      '} catch { // write marker removed',
    ),
    source.replace(
      'process.stderr.write(`${formatDrillFailure(resolveDrillDiagnostic(error, currentPhase, currentMeasureStep))}\\n`)',
      'process.stderr.write(`${error.message}\\n`)',
    ),
    source.replace(
      "if (processStartTimeTicks(managedAppPid) !== managedAppPidTicks) fail('MANAGED_APP_PID_STALE')\n    ",
      '',
    ),
  ]) assert.throws(() => assertDrillDiagnosticWiring(unsafeMutation))
  const assignment = 'currentMeasureStep = MEASURE_STEPS.TOPOLOGY'
  const anchor = 'const topology = {'
  for (const unsafeMutation of [
    source.replace(assignment, `// ${assignment}`),
    source.replace(assignment, 'currentMeasureStep = process.env.D2_MEASURE_STEP'),
    source.replace(`${assignment}\n    ${anchor}`, `${anchor}\n    ${assignment}`),
  ]) assert.throws(() => assertDrillDiagnosticWiring(unsafeMutation))
  console.log('  PASS drill wiring captures phases and fixed measure steps before cleanup')
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

async function main(args = process.argv.slice(2)) {
  console.log('=== D2 prime offline contract ===')
  verifyNginxRenderer()
  verifyCutoverStateMachine()
  verifyPm2ControlPlane()
  try {
    verifyExecutionEntryContract()
  } catch {
    throw new Error('D2_PRIME_EXECUTION_ENTRY_CONTRACT_INVALID')
  }
  try {
    verifyUserSystemdEnvironmentContract()
  } catch {
    throw new Error('D2_PRIME_USER_SYSTEMD_CONTRACT_INVALID')
  }
  try {
    verifyReconciledCleanupContract()
  } catch {
    throw new Error('D2_PRIME_CLEANUP_CONTRACT_INVALID')
  }
  verifyEvidenceContract()
  verifyDrillDiagnosticContract()
  verifyDrillDiagnosticWiring()
  console.log('D2_PRIME_CONTRACT_ALL_PASS')
  verifyEvidenceFile(args)
}

try {
  await main()
} catch (error) {
  const code = error instanceof Error && /^D2_PRIME_[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : 'D2_PRIME_EVIDENCE_REJECTED'
  console.error(code)
  process.exitCode = 2
}
