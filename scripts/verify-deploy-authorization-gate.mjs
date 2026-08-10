#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = path.join(root, '.github/workflows/deploy.yml')
const workflow = fs.readFileSync(workflowPath, 'utf8')
const releaseScriptPath = path.join(root, '.github/scripts/deploy-api-release.sh')
const releaseScript = fs.readFileSync(releaseScriptPath, 'utf8')

const deployJob = workflow.match(/^  deploy:\n[\s\S]*$/m)?.[0]
assert.ok(deployJob, 'deploy.yml must contain the deploy job')

const explicitAuthorizationGate =
  /^    if:\s*\$\{\{\s*github\.event\.workflow_run\.conclusion\s*==\s*'success'\s*&&\s*vars\.DEPLOY_API_ENABLED\s*==\s*'true'\s*\}\}\s*$/m

assert.equal(
  (deployJob.match(/^    if:/gm) ?? []).length,
  1,
  'deploy job must have exactly one job-level if condition'
)
assert.match(
  deployJob,
  explicitAuthorizationGate,
  'deploy job must require successful CI and DEPLOY_API_ENABLED=true at job level'
)

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
assert.match(
  deployJob,
  /if \[ "\$\{API_RELEASE_ENABLED:-\}" = "true" \]; then/,
  'the remote script must retain its defense-in-depth authorization check'
)
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
const fetchOffset = deployJob.indexOf('fetch exact CI SHA attempt')
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
  /if \[ "\$\{PRINT_REQUIRE_PII_SCAN:-\}" != "true" \]; then/,
  'release script must retain a defense-in-depth PII scan gate'
)
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
assert.ok(
  releasePiiGateOffset < runtimeBackupOffset,
  'release PII gate must fail before backup/migration'
)
assert.ok(
  runtimeBackupOffset < persistPiiGateOffset && persistPiiGateOffset < migrationOffset,
  'persistent PII gate must be written after the rollback backup and before migration'
)
assert.match(
  releaseScript,
  /export PRINT_REQUIRE_PII_SCAN=true\s*\npm2 restart "\$PM2_NAME" --update-env/,
  'PM2 restart must receive the same required PII scan gate'
)

console.log('ALL PASS: deploy requires explicit authorization and persistent PII scan gating')
