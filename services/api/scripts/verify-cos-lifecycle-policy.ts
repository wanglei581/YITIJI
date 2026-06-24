/**
 * COS 生命周期防误删验收文档防回退验证。
 *
 * 运行: pnpm --filter @ai-job-print/api verify:cos-lifecycle-policy
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { strict as assert } from 'assert'

const repoRoot = join(__dirname, '../../..')
const compliancePath = join(repoRoot, 'docs/compliance/file-retention-and-cos-lifecycle.md')
const cosObjectStoragePath = join(repoRoot, 'docs/api/cos-object-storage.md')
const checklistPath = join(repoRoot, 'docs/device/production-deployment-and-windows-host-checklist.md')
const runbookPath = join(repoRoot, 'docs/device/production-deployment-runbook.md')
const cosBackendPath = join(repoRoot, 'services/api/src/storage/cos-storage.backend.ts')

assert.ok(existsSync(compliancePath), 'must create docs/compliance/file-retention-and-cos-lifecycle.md')

const compliance = readFileSync(compliancePath, 'utf8')
const cosObjectStorage = readFileSync(cosObjectStoragePath, 'utf8')
const checklist = readFileSync(checklistPath, 'utf8')
const runbook = readFileSync(runbookPath, 'utf8')
const cosBackend = readFileSync(cosBackendPath, 'utf8')
const docs = [compliance, cosObjectStorage, checklist, runbook].join('\n')

for (const marker of [
  '禁止配置 Bucket 全局过期规则',
  'long_term',
  'expiresAt = null',
  '人工验收',
  '截图存档',
  '90 天',
  '180 天',
  '长期保存',
  '保存条款版本',
]) {
  assert.ok(docs.includes(marker), `COS lifecycle docs must mention: ${marker}`)
}

for (const marker of [
  'users/',
  'tmp/',
  '不得覆盖长期保存对象',
]) {
  assert.ok(compliance.includes(marker), `compliance doc must include prefix guard: ${marker}`)
}

assert.doesNotMatch(cosBackend, /putBucketLifecycle|deleteBucketLifecycle|BucketLifecycle/i, 'API backend must not write bucket lifecycle rules')
assert.doesNotMatch(cosObjectStorage, /简历\s*1h|简历\s*1\s*小时/, 'COS object storage doc must not claim member resumes are 1h files')
assert.ok(cosObjectStorage.includes('登录会员原始简历') && cosObjectStorage.includes('90 天/180 天'), 'COS object storage doc must mention member resume retention policy')

console.log('verify:cos-lifecycle-policy passed')
