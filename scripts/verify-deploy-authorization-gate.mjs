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

// 2026-09-07：新增 workflow_dispatch 手动补发（原因见 deploy.yml 的注释：多 lane 并行时
// 发布前 CI 几乎抢不到窗口）。本门禁守的不变量**没有放宽**，只是拆成两半各自钉死：
//   ① job 级仍必须同时要求「CI 成功 或 手动补发」与 DEPLOY_API_ENABLED=true；
//   ② 手动补发这条路径必须由 resolve 步骤逐项校验所给运行号（CI 工作流 / main 分支 /
//      conclusion=success），且发布用的 SHA 只能来自该步骤输出 —— 见下方 dispatch 段断言。
// 二者合起来仍等价于「只发布 CI 已验证的精确提交」。
const explicitAuthorizationGate =
  /^    if:\s*\$\{\{\s*\(github\.event_name\s*==\s*'workflow_dispatch'\s*\|\|\s*github\.event\.workflow_run\.conclusion\s*==\s*'success'\)\s*&&\s*vars\.DEPLOY_API_ENABLED\s*==\s*'true'\s*\}\}\s*$/m

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

// ── 手动补发路径：必须逐项校验运行号，且目标 SHA 只能来自校验后的输出 ──────────
assert.match(
  deployJob,
  /EXPECTED_SHA='\$\{\{ steps\.target\.outputs\.sha \}\}'/,
  'deploy must take the target SHA from the validated resolve step, never straight from a dispatch input'
)
assert.doesNotMatch(
  deployJob,
  /EXPECTED_SHA='\$\{\{ (inputs|github\.event\.inputs)\./,
  'a dispatch input must never be used as the deploy target SHA without validation'
)
for (const [pattern, message] of [
  [/\.name'\)"?\s*$/m, 'resolve step must read the run workflow name'],
  [/if \[ "\$NAME" != "CI" \] \|\| \[ "\$BRANCH" != "main" \] \|\| \[ "\$CONCL" != "success" \]/, 'dispatch path must reject runs that are not a successful main CI'],
  [/grep -Eq '\^\[0-9a-f\]\{40\}\$'/, 'resolved SHA must be validated as a 40-hex commit id'],
]) {
  assert.match(workflow, pattern, message)
}

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
// 3b 自 #829 起按 REQUIRED_PRODUCTION_GATES 数组循环持久化（PII + 打印机在线两道闸门），
// awk 以 -v key= 传键名；下面三条断言守住的仍是同一件事：PII 闸门必在清单里、
// 精确/带空格/export/重复写法全部归一、写入值恰为 KEY=true 且不回显受保护的 .env。
const requiredGatesArray = releaseScript.match(/REQUIRED_PRODUCTION_GATES=\(([\s\S]*?)\)/)
assert.ok(requiredGatesArray, 'release script must declare REQUIRED_PRODUCTION_GATES=( ... )')
assert.match(
  requiredGatesArray[1],
  /^\s*PRINT_REQUIRE_PII_SCAN\s*$/m,
  'REQUIRED_PRODUCTION_GATES must still contain the PII scan gate'
)
assert.ok(
  releaseScript.includes(
    '$0 ~ ("^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*=") {'
  ),
  'release script must canonicalize exact, spaced, exported, and duplicate gate entries for every required key'
)
assert.match(
  releaseScript,
  /print key "=true"/,
  'release script must persist each required gate as KEY=true without printing the protected env file'
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
