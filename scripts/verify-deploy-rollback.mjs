// verify:deploy-rollback
// 发布脚本的 P0 回退门禁：既检查关键顺序/保护条件，也用 shell 桩演练
// “就绪失败 -> 回退 -> 回退后检查 -> 仍以失败结束”的不可变约束。
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const deploy = readFileSync(join(root, '.github/scripts/deploy-api-release.sh'), 'utf8')
const workflow = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8')
let failures = 0
const pass = (message) => console.log(`  PASS ${message}`)
const fail = (message) => { failures += 1; console.error(`  FAIL ${message}`) }

const requireText = (text, message) => text.includes(message) ? pass(message) : fail(`缺少：${message}`)

requireText(deploy, 'HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:3010/api/v1/health/ready}"')
requireText(deploy, 'rollback_after_health_failure')
requireText(deploy, '数据库迁移不回退')
requireText(deploy, '本次迁移记录保留在 $MIGRATION_LOG')
requireText(deploy, 'source=origin/main@$TARGET_SHA')
const healthCheckAt = deploy.indexOf('if check_ready; then')
const pointerAt = deploy.indexOf('source=origin/main@$TARGET_SHA')
if (healthCheckAt >= 0 && pointerAt > healthCheckAt) pass('DEPLOY_SOURCE 在就绪检查通过后写入')
else fail('DEPLOY_SOURCE 不得早于就绪检查')

requireText(workflow, 'full 发布必须同时配置 DEPLOY_ADMIN_WEB_ROOT 与 DEPLOY_PARTNER_WEB_ROOT')
if (workflow.includes('if [ -z "${DEPLOY_ADMIN_WEB_ROOT:-}" ] || [ -z "${DEPLOY_PARTNER_WEB_ROOT:-}" ]; then')) pass('full 发布后台目录缺失时 fail-closed')
else fail('full 发布后台目录缺失时必须 fail-closed')
requireText(workflow, 'STATIC_BACKUP_ROOT')
requireText(workflow, 'backup_static_root kiosk')
requireText(workflow, 'restore_static_roots')
if (workflow.indexOf('✅ API-only 部署完成') < workflow.indexOf('STATIC_BACKUP_ROOT')) pass('API-only 不进入 full 静态备份')
else fail('API-only 不得触碰 full 静态备份')

const fixtureDir = mkdtempSync(join(tmpdir(), 'deploy-rollback-'))
try {
  const fixture = join(fixtureDir, 'rollback.sh')
  writeFileSync(fixture, `#!/usr/bin/env bash
set -euo pipefail
root="$1"; backup="$2"; marker="$3"
check_ready() { [ "$(cat "$root/health")" = ready ]; }
rollback() {
  cp "$backup/version" "$root/version"
  cp "$backup/health" "$root/health"
  printf '%s\\n' rolled-back > "$marker"
  check_ready
  return 1
}
printf '%s\\n' broken > "$root/health"
if check_ready; then exit 0; fi
rollback
`)
  execFileSync('chmod', ['700', fixture])
  writeFileSync(join(fixtureDir, 'version'), 'previous\n')
  writeFileSync(join(fixtureDir, 'health'), 'ready\n')
  const rootDir = join(fixtureDir, 'runtime')
  const backupDir = join(fixtureDir, 'backup')
  execFileSync('mkdir', ['-p', rootDir, backupDir])
  writeFileSync(join(rootDir, 'health'), 'ready\n')
  writeFileSync(join(backupDir, 'version'), 'previous\n')
  writeFileSync(join(backupDir, 'health'), 'ready\n')
  const marker = join(fixtureDir, 'marker')
  let failed = false
  try { execFileSync(fixture, [rootDir, backupDir, marker], { stdio: 'pipe' }) } catch { failed = true }
  if (failed && readFileSync(marker, 'utf8').trim() === 'rolled-back' && readFileSync(join(rootDir, 'health'), 'utf8').trim() === 'ready') {
    pass('shell 桩演练：回退成功仍以失败结束')
  } else fail('shell 桩演练未保持回退成功但发布失败')
} finally {
  rmSync(fixtureDir, { recursive: true, force: true })
}

if (failures) process.exit(1)
console.log('deploy rollback 门禁通过')
