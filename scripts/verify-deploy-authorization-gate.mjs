#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = path.join(root, '.github/workflows/deploy.yml')
const workflow = fs.readFileSync(workflowPath, 'utf8')
const releaseScriptPath = path.join(root, '.github/scripts/deploy-api-release.sh')
const releaseScript = fs.readFileSync(releaseScriptPath, 'utf8')
const restoreScriptPath = path.join(root, '.github/scripts/deploy-api-restore.sh')
const restoreScript = fs.readFileSync(restoreScriptPath, 'utf8')
const cleanupWorkflowPath = path.join(root, '.github/workflows/server-cleanup.yml')
const cleanupWorkflow = fs.readFileSync(cleanupWorkflowPath, 'utf8')
const staleCleanupWorkflowPath = path.join(root, '.github/workflows/cleanup-stale-releases.yml')
const staleCleanupWorkflow = fs.readFileSync(staleCleanupWorkflowPath, 'utf8')
const deployPrecheckWorkflowPath = path.join(root, '.github/workflows/deploy-precheck.yml')
const deployPrecheckWorkflow = fs.readFileSync(deployPrecheckWorkflowPath, 'utf8')
const retentionScriptPath = path.join(root, '.github/scripts/deploy-backup-retention.sh')
const retentionScript = fs.readFileSync(retentionScriptPath, 'utf8')
const staticReleaseScriptPath = path.join(root, '.github/scripts/deploy-static-release.sh')
const staticReleaseScript = fs.readFileSync(staticReleaseScriptPath, 'utf8')
const wholeReleaseClassifierPath = path.join(root, '.github/scripts/classify-whole-release-state.sh')
const wholeReleaseClassifier = fs.readFileSync(wholeReleaseClassifierPath, 'utf8')
const workflowDirectory = path.join(root, '.github/workflows')

const approvedActionRefs = new Set([
  'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
  'actions/setup-dotnet@67a3573c9a986a3f9c594539f4ab511d57bb3ce9',
  'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  'appleboy/scp-action@917f8b81dfc1ccd331fef9e2d61bdc6c8be94634',
  'appleboy/ssh-action@029f5b4aeeeb58fdfe1410a5d17f967dacf36262',
  'pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa',
])

function assertApprovedActionRef(actionRef, sourceName) {
  assert.match(
    actionRef,
    /^[^/@\s]+\/[^@\s]+@[0-9a-f]{40}$/,
    `${sourceName} must pin every external Action to a full commit or annotated-tag object SHA: ${actionRef}`
  )
  assert.ok(
    approvedActionRefs.has(actionRef),
    `${sourceName} uses an unapproved or mismatched Action ref: ${actionRef}`
  )
}

function extractYamlActionRefs(contents, sourceName) {
  const ruby = String.raw`
require 'json'
require 'yaml'

source = STDIN.read
document = begin
  YAML.safe_load(source, permitted_classes: [], permitted_symbols: [], aliases: true)
rescue ArgumentError
  YAML.safe_load(source, [], [], true)
end

refs = []
walk = nil
walk = lambda do |value|
  case value
  when Hash
    value.each do |key, child|
      refs << child if key.to_s == 'uses'
      walk.call(child)
    end
  when Array
    value.each { |child| walk.call(child) }
  end
end
walk.call(document)
STDOUT.write(JSON.generate(refs))
`
  const result = spawnSync('ruby', ['-e', ruby], {
    cwd: root,
    encoding: 'utf8',
    input: contents,
  })
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('Ruby is required for structured workflow Action validation but was not found')
    }
    throw result.error
  }
  assert.equal(result.status, 0, `${sourceName} could not be parsed as safe YAML: ${result.stderr.trim()}`)
  const actionRefs = JSON.parse(result.stdout)
  for (const actionRef of actionRefs) {
    assert.equal(typeof actionRef, 'string', `${sourceName} contains a non-string uses value`)
  }
  return actionRefs
}

assert.throws(
  () => assertApprovedActionRef('actions/upload-artifact@v4', 'self-test'),
  /must pin every external Action/,
  'immutable Action gate must reject mutable tags'
)
assert.throws(
  () => assertApprovedActionRef('actions/upload-artifact@b906affcce14559ad1aafd4ab0e942779e9f58b1', 'self-test'),
  /unapproved or mismatched Action ref/,
  'immutable Action gate must reject a valid SHA that belongs to another Action repository'
)
assert.throws(
  () => {
    for (const actionRef of extractYamlActionRefs('- { "uses": attacker/example@v1 }\n', 'self-test.yml')) {
      assertApprovedActionRef(actionRef, 'self-test.yml')
    }
  },
  /must pin every external Action/,
  'immutable Action gate must parse and reject YAML flow mappings with quoted uses keys'
)

const deployJob = workflow.match(/^  deploy:\n[\s\S]*$/m)?.[0]
assert.ok(deployJob, 'deploy.yml must contain the deploy job')

const explicitAuthorizationGate =
  /^    if:\s*\$\{\{\s*github\.event\.workflow_run\.conclusion\s*==\s*'success'\s*&&\s*github\.event\.workflow_run\.event\s*==\s*'push'\s*&&\s*github\.event\.workflow_run\.head_branch\s*==\s*'main'\s*&&\s*github\.event\.workflow_run\.head_repository\.full_name\s*==\s*github\.repository\s*&&\s*vars\.DEPLOY_API_ENABLED\s*==\s*'true'\s*\}\}\s*$/m

assert.equal(
  (deployJob.match(/^    if:/gm) ?? []).length,
  1,
  'deploy job must have exactly one job-level if condition'
)
assert.match(
  deployJob,
  explicitAuthorizationGate,
  'deploy job must require a successful trusted same-repository main push and DEPLOY_API_ENABLED=true at job level'
)
for (const [name, contents] of [
  ['deploy workflow', workflow],
  ['server cleanup workflow', cleanupWorkflow],
  ['stale release cleanup workflow', staleCleanupWorkflow],
]) {
  assert.match(contents, /concurrency:\s*\n\s+group: production-maintenance\s*\n\s+cancel-in-progress: false/, `${name} must share the non-cancelling production maintenance concurrency group`)
  assert.match(contents, /flock -n 9/, `${name} must also acquire the host-level production maintenance lock`)
}

const workflowFiles = fs.readdirSync(workflowDirectory)
  .filter((file) => /\.ya?ml$/.test(file))
  .sort()
let actionInventoryCount = 0
for (const file of workflowFiles) {
  const contents = fs.readFileSync(path.join(workflowDirectory, file), 'utf8')
  const actionRefs = extractYamlActionRefs(contents, file)
  actionInventoryCount += actionRefs.length
  for (const actionRef of actionRefs) {
    assertApprovedActionRef(actionRef, file)
  }
}
assert.equal(actionInventoryCount, 21, 'workflow Action inventory changed; review every new or removed Action ref')
const ciWorkflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
assert.match(ciWorkflow, /^permissions:\s*\n\s+contents:\s*read\s*$/m, 'CI workflow must grant only repository contents read permission')
assert.match(workflow, /^permissions:\s*\{\}\s*$/m, 'deploy workflow must declare no GitHub token permissions')
assert.match(deployPrecheckWorkflow, /^permissions:\s*\{\}\s*$/m, 'deploy precheck workflow must declare no GitHub token permissions')
assert.match(staleCleanupWorkflow, /^permissions:\s*\{\}\s*$/m, 'stale cleanup workflow must declare no GitHub token permissions')
assert.match(cleanupWorkflow, /^permissions:\s*\n\s+contents:\s*read\s*$/m, 'server cleanup workflow must grant only checkout read permission')

const gateOffset = deployJob.search(explicitAuthorizationGate)
const sshOffset = deployJob.indexOf('uses: appleboy/ssh-action@')
assert.ok(sshOffset > gateOffset, 'explicit authorization gate must run before the SSH action')
assert.equal(
  (deployJob.match(/uses:\s*appleboy\/ssh-action@/g) ?? []).length,
  1,
  'deploy workflow must have exactly one SSH action guarded by the job-level condition'
)
assert.match(
  deployJob,
  /API_RELEASE_ENABLED:\s*\$\{\{\s*vars\.DEPLOY_API_ENABLED\s*\}\}/,
  'the remote release script must receive the same repository authorization variable'
)
assert.doesNotMatch(deployJob, /API 发布未启用/, 'deploy workflow must not retain an unreachable API-disabled release branch')
assert.match(deployJob, /fetch --no-tags --depth=1 origin \\\n+\s+\+refs\/heads\/main:refs\/remotes\/origin\/main/, 'server release must fetch only the trusted origin main ref')
assert.match(deployJob, /TRUSTED_MAIN_SHA="\$\(git rev-parse refs\/remotes\/origin\/main\)"/, 'server release must resolve the trusted origin main tip')
assert.match(deployJob, /if \[ "\$TRUSTED_MAIN_SHA" != "\$EXPECTED_SHA" \]; then/, 'server release must reject workflow SHAs that are not the trusted origin main tip')
assert.doesNotMatch(deployJob, /fetch --no-tags --depth=1 origin "\$EXPECTED_SHA"/, 'server release must not fetch an event-controlled SHA directly')
assert.match(deployJob, /DEPLOY_PATH_REAL=.*pwd -P[\s\S]*RUNTIME_ROOT_REAL=.*pwd -P[\s\S]*DEPLOY_PATH must be separate from the production runtime root/, 'deployment source must be a real Git worktree outside the production runtime root')
assert.match(
  deployJob,
  /KIOSK_TERMINAL_AGENT_BRIDGE_TOKEN:\s*\$\{\{\s*secrets\.KIOSK_TERMINAL_AGENT_BRIDGE_TOKEN\s*\}\}/,
  'deploy must receive the Kiosk local bridge token from a GitHub secret'
)
assert.match(
  deployJob,
  /envs:[^\n]*KIOSK_TERMINAL_AGENT_BRIDGE_TOKEN/,
  'SSH action must forward the Kiosk local bridge token to the remote build'
)
assert.match(
  deployJob,
  /envs:[^\n]*PRINT_REQUIRE_PII_SCAN/,
  'SSH action must forward the production PII scan gate'
)
assert.match(
  deployJob,
  /PRINT_REQUIRE_PII_SCAN:\s*\$\{\{\s*vars\.PRINT_REQUIRE_PII_SCAN\s*\}\}/,
  'deploy must source the PII scan gate from an explicit repository variable'
)
const piiGateOffset = deployJob.indexOf('if [ "${PRINT_REQUIRE_PII_SCAN:-}" != "true" ]; then')
const fetchOffset = deployJob.indexOf('fetch trusted origin/main attempt')
assert.ok(piiGateOffset > gateOffset, 'production PII scan gate must follow deploy authorization')
assert.ok(
  fetchOffset > piiGateOffset,
  'production PII scan gate must fail before server fetch/build'
)
assert.match(
  deployJob,
  /VITE_TERMINAL_AGENT_BRIDGE_TOKEN="\$KIOSK_TERMINAL_AGENT_BRIDGE_TOKEN"[\s\S]*pnpm build:kiosk:production/,
  'remote Kiosk build must inject and verify the local bridge token'
)
assert.match(
  releaseScript,
  /if \[ "\$\{API_RELEASE_ENABLED:-\}" != "true" \]; then/,
  'the API release helper must retain its defense-in-depth authorization check'
)
assert.match(
  releaseScript,
  /if \[ "\$\{PRINT_REQUIRE_PII_SCAN:-\}" != "true" \]; then/,
  'release script must retain a defense-in-depth PII scan gate'
)
assert.ok(
  releaseScript.includes('/^[[:space:]]*(export[[:space:]]+)?NODE_ENV[[:space:]]*=/ {'),
  'release script must canonicalize NODE_ENV entries'
)
assert.match(releaseScript, /print "NODE_ENV=production"/, 'release script must persist NODE_ENV=production')
assert.ok(
  releaseScript.includes(
    '/^[[:space:]]*(export[[:space:]]+)?PRINT_REQUIRE_PII_SCAN[[:space:]]*=/ {'
  ),
  'release script must canonicalize exact, spaced, exported, and duplicate PII gate entries'
)
assert.match(
  releaseScript,
  /print "PRINT_REQUIRE_PII_SCAN=true"/,
  'release script must persist the required PII scan gate without printing the protected env file'
)
const releasePiiGateOffset = releaseScript.indexOf(
  'if [ "${PRINT_REQUIRE_PII_SCAN:-}" != "true" ]; then'
)
const runtimeBackupOffset = releaseScript.indexOf('cp -a "$RUNTIME_ROOT" "$BACKUP_PREFIX.runtime"')
const persistPiiGateOffset = releaseScript.indexOf('ENV_FILE="$API_DIR/.env"')
const migrationOffset = releaseScript.indexOf('pnpm db:pg:deploy')
const oldShaOffset = releaseScript.indexOf('OLD_SHA="$(sed -n')
assert.ok(
  releasePiiGateOffset < runtimeBackupOffset,
  'release PII gate must fail before backup/migration'
)
assert.ok(oldShaOffset > 0 && oldShaOffset < runtimeBackupOffset, 'the previous active SHA must be captured before deployment writes')
assert.match(releaseScript, /trap finish_release EXIT/, 'API release must install one unified exit handler')
assert.match(releaseScript, /handle_release_signal\(\)[\s\S]*trap - HUP INT TERM[\s\S]*exit "\$signal_code"/, 'API release must convert signals into explicit nonzero exits')
assert.match(releaseScript, /trap 'handle_release_signal 129' HUP[\s\S]*trap 'handle_release_signal 130' INT[\s\S]*trap 'handle_release_signal 143' TERM/, 'API release must route HUP, INT and TERM through its EXIT recovery')
assert.match(releaseScript, /if \[ "\$status" -ne 0 \] && \[ "\$rollback_armed" = true \]/, 'the unified exit handler must run recovery only for an armed failed release')
assert.equal(
  [...releaseScript.matchAll(/^\s*trap (?!-)\S+ EXIT$/gm)].length,
  1,
  'API release must contain exactly one active EXIT handler'
)
assert.doesNotMatch(releaseScript, /trap cleanup_(env|provenance)_tmp EXIT/, 'temporary-file cleanup must not overwrite the rollback trap')
assert.match(releaseScript, /deploy-api-restore\.sh/, 'API failure recovery must use the reviewed shared restore helper')
assert.match(restoreScript, /rsync -a --delete[\s\S]*--exclude 'services\/api\/storage'[\s\S]*"\$RUNTIME_BACKUP\/" "\$RUNTIME_ROOT\/"/, 'API failure recovery must restore the prior runtime without overwriting mutable local storage')
assert.match(restoreScript, /--exclude '\.STATIC_RELEASE_STATUS-\*'/, 'API restore must preserve the whole-release state record until recovery finishes')
assert.match(restoreScript, /--exclude 'API_DEPLOY_SOURCE\.txt'[\s\S]*--exclude '\.API_DEPLOY_SOURCE\.\*'/, 'API restore must preserve current-attempt provenance until recovery succeeds')
assert.match(restoreScript, /production API restore requires an attempt-scoped marker/, 'production API restore must not run without durable attempt provenance')
assert.match(restoreScript, /env -i[\s\S]*COMMIT="\$OLD_SHA"[\s\S]*pm2 start/, 'API failure recovery must restart the previous commit from a narrow environment')
assert.match(restoreScript, /restored PM2 commit does not match the old SHA/, 'API failure recovery must verify restored PM2 provenance')
assert.match(restoreScript, /restored PM2 contains forbidden deployment environment keys/, 'API failure recovery must verify that deployment controls were not persisted')
assert.match(releaseScript, /dump\.pm2\.bak/, 'API release must account for the PM2 backup dump')
assert.match(restoreScript, /dump\.pm2\.bak/, 'API restore must account for the PM2 backup dump')
for (const [name, script] of [['API release', releaseScript], ['API restore', restoreScript]]) {
  assert.match(script, /chmod 0600/, `${name} must restrict PM2 dump files to mode 0600`)
  assert.match(script, /not a regular file/, `${name} must reject non-regular PM2 backup dumps`)
  assert.match(script, /set -euo pipefail/, `${name} must propagate chmod failures instead of continuing`)
}
assert.match(releaseScript, /PM2 backup dump is a symlink/, 'API release must reject a symlinked PM2 backup dump')
assert.match(restoreScript, /PM2 backup dump is a symlink/, 'API restore must reject a symlinked PM2 backup dump')
assert.match(restoreScript, /"status":"ok"[\s\S]*"status":"ready"/, 'API recovery must verify liveness and readiness')
assert.match(restoreScript, /status=api-rolled-back[\s\S]*restored_source=origin\/main@\$OLD_SHA/, 'API recovery must persist an attempt-scoped completed rollback marker')
assert.match(releaseScript, /database migrations were not reversed/, 'API recovery must not pretend to reverse additive database migrations')
assert.ok(
  runtimeBackupOffset < persistPiiGateOffset && persistPiiGateOffset < migrationOffset,
  'persistent PII gate must be written after the rollback backup and before migration'
)
assert.match(
  releaseScript,
  /DOTENV_CONFIG_PATH="\$ENV_FILE" DOTENV_CONFIG_OVERRIDE=true[\s\S]*assertProductionRuntimeGates\(process\.env\)/,
  'release script must run production gates against the real runtime env before migration'
)
assert.match(releaseScript, /env -i[\s\S]*NODE_ENV=production/, 'PM2 restart must explicitly receive NODE_ENV=production through the allowlist')
assert.match(releaseScript, /env -i[\s\S]*PRINT_REQUIRE_PII_SCAN=true/, 'PM2 restart must explicitly receive the PII gate through the allowlist')
assert.match(releaseScript, /env\.NODE_ENV !== "production"/, 'release must verify PM2 NODE_ENV')
assert.match(releaseScript, /env\.COMMIT !== sha/, 'release must verify PM2 commit provenance')
assert.match(releaseScript, /env\.PRINT_REQUIRE_PII_SCAN/, 'release must verify PM2 PII gate')
assert.match(releaseScript, /env\.status !== "online"/, 'release must verify PM2 online state')
assert.match(releaseScript, /"status":"ok"[\s\S]*"status":"ready"/, 'release must require both liveness and readiness')

assert.doesNotMatch(workflow, /rm -rf\s+\$\{\{\s*secrets\.DEPLOY_WEB_ROOT/, 'deploy must never interpolate the web-root secret into rm -rf')
assert.doesNotMatch(workflow, /DEPLOY_(ADMIN_|PARTNER_)?WEB_ROOT/, 'fixed production web roots must not be controlled by SSH secrets')
assert.match(workflow, /deploy-static-release\.sh/, 'all three static sites must use the atomic static release helper')
assert.match(workflow, /trap restore_incomplete_whole_release EXIT/, 'whole release must arm API/runtime recovery before release work')
assert.doesNotMatch(workflow, /WHOLE_RELEASE_API_READY/, 'whole-release recovery must not depend on an in-memory API-ready flag')
assert.match(workflow, /classify-whole-release-state\.sh/, 'whole-release recovery must classify durable current-attempt provenance')
assert.match(workflow, /RELEASE_ATTEMPT: \$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/, 'deploy reruns must receive a distinct release attempt id')
assert.match(workflow, /STATIC_STATUS_FILE=.*RELEASE_ATTEMPT[\s\S]*printf '%s\\n' 'not-switched'[\s\S]*WHOLE_RELEASE_ATTEMPT_STARTED=true/, 'workflow must persist attempt-scoped not-switched state before the API release starts')
assert.match(workflow, /command -v setsid[\s\S]*setsid is required/, 'release must require process-group isolation before production writes')
assert.match(workflow, /run_release_helper\(\)[\s\S]*setsid "\$@" &[\s\S]*ACTIVE_RELEASE_GROUP=\$![\s\S]*wait "\$ACTIVE_RELEASE_GROUP"/, 'release helpers must run in a tracked isolated process group')
assert.match(workflow, /kill -s "\$signal" -- "-\$ACTIVE_RELEASE_GROUP"[\s\S]*wait "\$ACTIVE_RELEASE_GROUP"/, 'parent signals must terminate and reap the complete release helper process group')
assert.match(workflow, /trap 'forward_release_signal HUP 129' HUP[\s\S]*trap 'forward_release_signal INT 130' INT[\s\S]*trap 'forward_release_signal TERM 143' TERM/, 'SSH interruption signals must flow through child rollback and whole-release recovery')
assert.equal((workflow.match(/run_release_helper env/g) ?? []).length, 2, 'both API and static release helpers must use signal-forwarding process groups')
const wholeReleaseAttemptOffset = workflow.indexOf('WHOLE_RELEASE_ATTEMPT_STARTED=true')
const apiReleaseOffset = workflow.indexOf('bash .github/scripts/deploy-api-release.sh')
const wholeReleaseCommitOffset = workflow.indexOf('WHOLE_RELEASE_COMMITTED=true')
const staticReleaseOffset = workflow.indexOf('bash .github/scripts/deploy-static-release.sh')
assert.ok(wholeReleaseAttemptOffset > 0 && wholeReleaseAttemptOffset < apiReleaseOffset, 'whole-release recovery must be armed before the API release starts')
assert.ok(wholeReleaseCommitOffset > staticReleaseOffset, 'whole release must remain recoverable until static release succeeds')
assert.match(workflow, /WHOLE_RELEASE_STATE.*committed[\s\S]*automatic restore is not required/, 'whole-release recovery must not undo an already committed current attempt')
assert.match(wholeReleaseClassifier, /status=api-ready-static-pending/, 'whole-release recovery must only act on the current incomplete API release marker')
assert.match(wholeReleaseClassifier, /\^\(not-switched\|rolled-back\)\$/, 'whole-release recovery must only restore the API when static assets are unchanged or fully rolled back')
assert.match(wholeReleaseClassifier, /release_attempt=\$RELEASE_ATTEMPT/, 'whole-release classification must bind provenance to the current deploy run attempt')
assert.match(wholeReleaseClassifier, /status=api-rolled-back[\s\S]*printf '%s\\n' restored/, 'whole-release classification must suppress duplicate API restore after a completed rollback')
assert.match(workflow, /whole release state is incomplete or unknown; automatic API restore refused/, 'whole-release recovery must fail closed on unknown or incomplete static state')
assert.match(workflow, /RUNTIME_BACKUP="\$RUNTIME_BACKUP"[\s\S]*deploy-api-restore\.sh/, 'whole-release recovery must use the API backup recorded for the attempted release')
assert.match(workflow, /WHOLE_RELEASE_OLD_SHA="\$\(sed -n[\s\S]*active production provenance does not contain a valid old SHA/, 'whole release must freeze and validate the old SHA before deployment writes')
assert.match(workflow, /BACKUP_OLD_SHA=.*RUNTIME_BACKUP\/DEPLOY_SOURCE\.txt[\s\S]*BACKUP_OLD_SHA.*WHOLE_RELEASE_OLD_SHA[\s\S]*automatic restore refused/, 'whole-release recovery must cross-check the frozen old SHA against backup provenance')
assert.match(workflow, /OLD_SHA="\$WHOLE_RELEASE_OLD_SHA"/, 'whole-release recovery must never derive the old PM2 commit from mutable active provenance')
assert.match(workflow, /trap - EXIT HUP INT TERM/, 'successful full release must disarm every whole-release trap')
assert.match(staticReleaseScript, /rollback_static/, 'static release must support rollback after a partial switch')
assert.match(staticReleaseScript, /trap release_failure EXIT/, 'static release must rollback any failure after switching begins')
const staticTrapOffset = staticReleaseScript.indexOf('trap release_failure EXIT')
const staticSwitchOffset = staticReleaseScript.indexOf('for app in $APPS; do', staticReleaseScript.indexOf('release_failure()'))
assert.ok(staticTrapOffset > 0 && staticTrapOffset < staticSwitchOffset, 'static rollback trap must be armed before the first production directory switch')
assert.match(staticReleaseScript, /switched_apps="\$app \$switched_apps"\s+mv -- "\$target_dir" "\$rollback_dir"\s+if \[ "\$\{DEPLOY_STATIC_TEST_MODE:-false\}" = true \][\s\S]*DEPLOY_STATIC_TEST_TERM_AFTER_BACKUP_APP/, 'the current app must enter the rollback set before its production directory moves, and fault injection must stay test-only')
assert.match(staticReleaseScript, /status=full-ready[\s\S]*release_committed=true[\s\S]*STATIC_ROLLBACK_STATUS=incomplete[\s\S]*STATIC_ROLLBACK_STATUS=ready/, 'static failure handling must trust committed on-disk provenance and report rollback status')
assert.match(staticReleaseScript, /grep -Fxq "release_attempt=\$RELEASE_ATTEMPT" "\$RUNTIME_ROOT\/DEPLOY_SOURCE\.txt"/, 'static committed recovery must bind full-ready provenance to the current release attempt')
assert.match(staticReleaseScript, /\.STATIC_RELEASE_STATUS-\$TARGET_SHA-\$RELEASE_ATTEMPT/, 'static release must persist an attempt-scoped rollback state')
for (const status of ['not-switched', 'switching', 'rolled-back', 'incomplete', 'committed']) {
  assert.ok(staticReleaseScript.includes(`'${status}'`), `static release must record ${status} state`)
}
assert.match(staticReleaseScript, /current static target could not be preserved; rollback anchor was left untouched/, 'static rollback must not move the old anchor into a still-active target directory')
const finalSourceOffset = staticReleaseScript.indexOf('mv -f -- "$SOURCE_COMMIT_TMP" "$RUNTIME_ROOT/DEPLOY_SOURCE.txt"')
const nginxOffset = staticReleaseScript.indexOf('nginx -s reload')
const finalReadyOffset = staticReleaseScript.lastIndexOf('health/ready')
assert.ok(finalSourceOffset > nginxOffset && finalSourceOffset > finalReadyOffset, 'full release provenance must be committed only after nginx and final readiness checks')
for (const appPort of ['kiosk:80', 'admin:8081', 'partner:8082']) {
  assert.ok(staticReleaseScript.includes(appPort), `static release must verify the served ${appPort} index against disk`)
}
assert.match(staticReleaseScript, /status=full-ready/, 'full release provenance must record full-ready status')
assert.doesNotMatch(releaseScript, /mv -f -- "\$PROVENANCE_TMP" "\$RUNTIME_ROOT\/DEPLOY_SOURCE\.txt"/, 'API-only script must not claim the full release before static deployment')
assert.match(releaseScript, /\.DEPLOY_SOURCE\.pending-\$TARGET_SHA/, 'API script must leave a target-SHA pending provenance file')
assert.match(releaseScript, /API_DEPLOY_SOURCE\.txt/, 'API script must publish separate API provenance before the static release')
assert.match(releaseScript, /RUNTIME_ROOT="\/srv\/ai-job-print"/, 'API release must use the fixed production runtime root')
for (const app of ['kiosk', 'admin', 'partner']) {
  assert.ok(releaseScript.includes(`--exclude 'apps/${app}/dist'`), `API runtime sync must not switch ${app} static assets before readiness`)
}
for (const provenancePath of [
  '/DEPLOY_SOURCE.txt',
  '/API_DEPLOY_SOURCE.txt',
  '/.DEPLOY_SOURCE.*',
  '/.API_DEPLOY_SOURCE.*',
  '/.STATIC_RELEASE_STATUS-*',
]) {
  assert.ok(releaseScript.includes(`--exclude '${provenancePath}'`), `API runtime sync must preserve ${provenancePath}`)
}
assert.match(workflow, /RUNTIME_ROOT=\/srv\/ai-job-print/, 'deploy workflow must use the fixed production runtime root')
assert.doesNotMatch(releaseScript, /pm2 restart "\$PM2_NAME" --update-env/, 'PM2 must not inherit the SSH deployment environment')
assert.match(releaseScript, /env -i[\s\S]*NODE_ENV=production[\s\S]*pm2 start/, 'PM2 must be recreated from a narrow environment allowlist')
assert.match(releaseScript, /DEPLOY_\.\+/, 'PM2 verification must reject every forwarded DEPLOY_* key')
assert.match(releaseScript, /forbidden deployment environment keys/, 'PM2 verification must reject forwarded deployment secrets and controls')

assert.match(retentionScript, /DEPLOY_BACKUP_KEEP-3/, 'backup keep defaults only when the variable is unset, not when explicitly empty')
assert.match(retentionScript, /\^pre-\[0-9a-f\]\{40\}-\[0-9\]\{8\}T\[0-9\]\{6\}Z/, 'backup retention must require exact release stems')
assert.match(retentionScript, /DEPLOY_SOURCE_FILE/, 'backup retention must protect current production rollback anchors')
assert.match(retentionScript, /backup identity changed after planning/, 'backup retention must re-check planned object identity before deletion')
assert.doesNotMatch(retentionScript, /for stem in \$DEL_LIST/, 'backup deletion plans must not use whitespace-split strings')
const runtimeDeleteOffset = retentionScript.indexOf('rm -rf -- "$runtime_path"')
const dumpDeleteOffset = retentionScript.indexOf('rm -f -- "$dump_path"')
assert.ok(runtimeDeleteOffset > 0 && dumpDeleteOffset > runtimeDeleteOffset, 'backup retention must remove runtime data before the database backup')
assert.ok(retentionScript.indexOf('planned runtime backup still exists', runtimeDeleteOffset) < dumpDeleteOffset, 'backup retention must confirm runtime deletion before removing the database backup')
assert.doesNotMatch(cleanupWorkflow, /"\$BK"\/"\$stem"\*/, 'server cleanup must not use broad stem globs')
const cleanupRunStep = cleanupWorkflow.match(/- name: Run cleanup via SSH[\s\S]*?(?=\n\s+- name:|$)/)?.[0]
assert.ok(cleanupRunStep, 'server cleanup must contain its SSH execution step')
for (const variable of ['DRY_RUN', 'KEEP', 'PRUNE_PNPM', 'VACUUM_JOURNAL']) {
  assert.match(cleanupRunStep, new RegExp(`\\n\\s+${variable}: \\$\\{\\{ inputs\\.`), `server cleanup execution step must receive ${variable} from workflow inputs`)
}
assert.match(cleanupRunStep, /envs: DRY_RUN,KEEP,PRUNE_PNPM,VACUUM_JOURNAL/, 'server cleanup execution step must forward every validated input')

console.log('ALL PASS: deploy authorization, provenance, runtime, static-root and retention safety')
