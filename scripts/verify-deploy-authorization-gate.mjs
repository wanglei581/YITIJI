#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = path.join(root, '.github/workflows/deploy.yml')
const workflow = fs.readFileSync(workflowPath, 'utf8')

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
  /VITE_TERMINAL_AGENT_BRIDGE_TOKEN="\$KIOSK_TERMINAL_AGENT_BRIDGE_TOKEN"[\s\S]*pnpm build:kiosk:production/,
  'remote Kiosk build must inject and verify the local bridge token'
)

console.log('ALL PASS: deploy requires explicit repository authorization before SSH')
