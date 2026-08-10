#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = path.join(root, '.github/workflows/deploy-preprod-bos.yml')
const helperPath = path.join(root, '.github/scripts/configure-preprod-bos-env.sh')
const releasePath = path.join(root, '.github/scripts/deploy-api-release.sh')
const workflow = fs.readFileSync(workflowPath, 'utf8')
const helper = fs.readFileSync(helperPath, 'utf8')
const release = fs.readFileSync(releasePath, 'utf8')

execFileSync('bash', ['-n', helperPath], { stdio: 'inherit' })
execFileSync('bash', ['-n', releasePath], { stdio: 'inherit' })

assert.match(workflow, /^on:\n  workflow_dispatch:/m)
assert.doesNotMatch(workflow, /^  (push|pull_request|workflow_run):/m)
assert.match(workflow, /^    environment: preprod$/m)
assert.match(workflow, /PREPROD_DEPLOY_ENABLED must be explicitly true/)
assert.match(workflow, /PREPROD_PRINT_REQUIRE_PII_SCAN must be explicitly true/)
assert.match(workflow, /checkout, runtime and backup roots must be distinct/)
assert.match(workflow, /Kiosk, Admin and Partner web roots must be distinct/)
assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/)
assert.match(workflow, /actions\/runs\/\$\{INPUT_CI_RUN_ID\}/)
assert.match(workflow, /test "\$\(jq -r '\.conclusion'/)
assert.match(workflow, /test "\$\(jq -r '\.head_sha'/)
assert.match(workflow, /VITE_ENABLE_CONTRACT_REVIEW=false/)
assert.match(workflow, /VITE_ENABLE_CONTRACT_REVIEW_REPORT_PRINT=false/)
assert.match(workflow, /BOS_LIVE_VERIFY_TARGET=preprod/)
assert.doesNotMatch(workflow, /secrets\.DEPLOY_(?!PREPROD)/)
assert.doesNotMatch(workflow, /vars\.DEPLOY_API_ENABLED/)
assert.doesNotMatch(workflow, /zyidai\.cn/)

for (const name of [
  'PREPROD_BAIDU_BOS_ACCESS_KEY_ID',
  'PREPROD_BAIDU_BOS_SECRET_ACCESS_KEY',
  'PREPROD_BAIDU_BOS_BUCKET',
  'PREPROD_BAIDU_BOS_REGION',
  'PREPROD_BAIDU_BOS_ENDPOINT',
]) {
  assert.ok(workflow.includes(name), `workflow must consume scoped ${name}`)
}

assert.match(helper, /DEPLOY_TARGET_ENV must be exactly preprod/)
assert.match(helper, /runtime path must be absolute and contain preprod/)
assert.match(helper, /database name must contain preprod or staging/)
assert.match(helper, /DEPLOYMENT_ENV=preprod before first deployment/)
assert.match(helper, /historical COS configuration is incomplete/)
assert.match(helper, /CONTRACT_REVIEW_REPORT_PRINT_ENABLED=false/)
assert.match(helper, /mv -f -- "\$ENV_TMP" "\$ENV_FILE"/)

const backupOffset = release.indexOf('cp -a "$RUNTIME_ROOT" "$BACKUP_PREFIX.runtime"')
const preprodApplyOffset = release.indexOf('configure-preprod-bos-env.sh" apply')
const migrationOffset = release.indexOf('pnpm db:pg:deploy')
assert.ok(backupOffset >= 0 && preprodApplyOffset > backupOffset)
assert.ok(migrationOffset > preprodApplyOffset)

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-preprod-deploy-'))
try {
  const runtime = path.join(sandbox, 'preprod-runtime')
  const apiDir = path.join(runtime, 'services/api')
  const binDir = path.join(sandbox, 'bin')
  const envFile = path.join(apiDir, '.env')
  const mockPsql = path.join(binDir, 'psql')
  fs.mkdirSync(apiDir, { recursive: true })
  fs.mkdirSync(binDir, { recursive: true })
  fs.writeFileSync(
    envFile,
    [
      'DEPLOYMENT_ENV=preprod',
      'DATABASE_URL=postgresql://verify:verify@127.0.0.1:5432/yitiji_preprod',
      'TENCENT_COS_SECRET_ID=legacy-id',
      'TENCENT_COS_SECRET_KEY=legacy-key',
      'TENCENT_COS_BUCKET=legacy-bucket',
      'TENCENT_COS_REGION=ap-guangzhou',
      'FILE_STORAGE_DRIVER=cos',
      'CONTRACT_REVIEW_REPORT_PRINT_ENABLED=true',
      '',
    ].join('\n'),
    { mode: 0o600 }
  )
  fs.writeFileSync(mockPsql, '#!/usr/bin/env bash\necho yitiji_preprod\n', { mode: 0o755 })

  const dynamicEnv = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    DEPLOY_TARGET_ENV: 'preprod',
    DEPLOY_API_DIR: runtime,
    DEPLOY_PM2_NAME: 'ai-job-print-api-preprod',
    DEPLOY_HEALTH_URL: 'http://127.0.0.1:3020/api/v1/health',
    PREPROD_PUBLIC_ORIGIN: 'https://preprod.example.test',
    PRINT_REQUIRE_PII_SCAN: 'true',
    BAIDU_BOS_ACCESS_KEY_ID: 'verify-access-id',
    BAIDU_BOS_SECRET_ACCESS_KEY: 'verify-secret-value',
    BAIDU_BOS_BUCKET: 'yitiji-preprod-verify',
    BAIDU_BOS_REGION: 'bj',
    BAIDU_BOS_ENDPOINT: 'https://bj.bcebos.com',
  }
  const checkOutput = execFileSync('bash', [helperPath, 'check'], {
    env: dynamicEnv,
    encoding: 'utf8',
  })
  assert.match(checkOutput, /isolated preprod runtime/)
  assert.doesNotMatch(checkOutput, /verify-secret-value/)

  const applyOutput = execFileSync('bash', [helperPath, 'apply'], {
    env: dynamicEnv,
    encoding: 'utf8',
  })
  assert.doesNotMatch(applyOutput, /verify-secret-value/)
  const applied = fs.readFileSync(envFile, 'utf8')
  assert.match(applied, /^FILE_STORAGE_DRIVER=bos$/m)
  assert.match(applied, /^FILE_STORAGE_LEGACY_DRIVER=cos$/m)
  assert.match(applied, /^BAIDU_BOS_BUCKET=yitiji-preprod-verify$/m)
  assert.match(applied, /^CONTRACT_REVIEW_REPORT_PRINT_ENABLED=false$/m)
  assert.equal((applied.match(/^FILE_STORAGE_DRIVER=/gm) ?? []).length, 1)
  assert.equal(fs.statSync(envFile).mode & 0o077, 0)

  const rejected = spawnSync('bash', [helperPath, 'check'], {
    env: { ...dynamicEnv, DEPLOY_API_DIR: '/srv/ai-job-print' },
    encoding: 'utf8',
  })
  assert.notEqual(rejected.status, 0)
  assert.match(
    rejected.stderr,
    /runtime path must be absolute and contain preprod|production default/
  )
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true })
}

console.log(
  'ALL PASS: isolated preprod deploy is explicit, CI-bound, scoped and production-distinct'
)
