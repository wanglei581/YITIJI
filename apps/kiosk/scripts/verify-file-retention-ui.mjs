/**
 * Kiosk 我的文档保存期限 UI 防回退验证。
 *
 * 运行: pnpm --filter @ai-job-print/kiosk verify:file-retention-ui
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = join(ROOT, '../..')
const memberAssetsPath = join(ROOT, 'src/services/api/memberAssets.ts')
const filesMockAdapterPath = join(ROOT, 'src/services/api/filesMockAdapter.ts')
const documentsPagePath = join(ROOT, 'src/pages/profile/me/MyDocumentsPage.tsx')
const sharedFileTypesPath = join(REPO_ROOT, 'packages/shared/src/types/file.ts')
const apiFileTypesPath = join(REPO_ROOT, 'services/api/src/files/file.types.ts')
const apiRetentionPolicyPath = join(REPO_ROOT, 'services/api/src/files/retention-policy.ts')
const memberAssets = readFileSync(memberAssetsPath, 'utf8')
const filesMockAdapter = readFileSync(filesMockAdapterPath, 'utf8')
const documentsPage = readFileSync(documentsPagePath, 'utf8')
const sharedFileTypes = readFileSync(sharedFileTypesPath, 'utf8')
const apiFileTypes = readFileSync(apiFileTypesPath, 'utf8')
const apiRetentionPolicy = readFileSync(apiRetentionPolicyPath, 'utf8')

let failed = 0
function pass(msg) { console.log(`  PASS ${msg}`) }
function fail(msg) { console.error(`  FAIL ${msg}`); failed++ }

function mustContain(src, marker, label) {
  if (src.includes(marker)) pass(label)
  else fail(`${label} — 缺少: ${marker}`)
}

function mustMatch(src, pattern, label) {
  if (pattern.test(src)) pass(label)
  else fail(`${label} — 未匹配: ${pattern}`)
}

function mustNotMatch(src, pattern, label) {
  if (!pattern.test(src)) pass(label)
  else fail(`${label} — 命中旧口径: ${pattern}`)
}

function extractConst(src, name) {
  return src.match(new RegExp(`export const ${name}\\s*=\\s*['"]([^'"]+)['"]`))?.[1] ?? null
}

console.log('\n=== Kiosk 我的文档保存期限 UI 验证 ===')

const sharedConsentVersion = extractConst(sharedFileTypes, 'FILE_RETENTION_CONSENT_VERSION')
const apiConsentVersion = extractConst(apiFileTypes, 'FILE_RETENTION_CONSENT_VERSION')
if (sharedConsentVersion && sharedConsentVersion === apiConsentVersion) pass('1. 前后端文件契约使用同一保存条款版本')
else fail(`1. 前后端文件契约保存条款版本不一致: shared=${sharedConsentVersion}, api=${apiConsentVersion}`)

mustContain(memberAssets, 'FILE_RETENTION_CONSENT_VERSION', '2. adapter 从契约常量收敛当前保存条款版本')
mustContain(apiRetentionPolicy, 'CURRENT_RETENTION_CONSENT_VERSION = FILE_RETENTION_CONSENT_VERSION', '3. 后端校验使用文件契约保存条款版本')
mustMatch(memberAssets, /method:\s*['"]GET['"]\s*\|\s*['"]DELETE['"]\s*\|\s*['"]PATCH['"]/, '4. call 支持 PATCH 方法')
mustMatch(memberAssets, /body\?:\s*unknown/, '5. call 支持 JSON body')
mustMatch(memberAssets, /headers\[['"]Content-Type['"]\]\s*=\s*['"]application\/json['"]/, '6. PATCH body 设置 JSON Content-Type')
mustContain(memberAssets, 'export function updateMyDocumentRetention', '7. 导出 updateMyDocumentRetention')
mustContain(memberAssets, '/retention', '8. updateMyDocumentRetention 调用 /files/:id/retention')
mustMatch(memberAssets, /retentionPolicy\s*===\s*['"]months_6['"]\s*\|\|\s*retentionPolicy\s*===\s*['"]long_term['"]/, '9. 6个月/长期自动附带 consentVersion')

mustContain(documentsPage, 'updateMyDocumentRetention', '10. MyDocumentsPage 接入保存期限更新 API')
mustContain(documentsPage, 'allowedRetentionPolicies', '11. 页面使用后端 allowedRetentionPolicies 渲染选项')
mustContain(documentsPage, '修改保存期限', '12. 文档卡片提供修改保存期限入口')
mustContain(documentsPage, '同意并保存', '13. 6个月/长期保存有确认动作')
mustContain(documentsPage, 'retentionBusy', '14. 保存期限更新纳入 pending 互斥')
mustMatch(documentsPage, /retentionBusy\?\.fileId\s*===\s*doc\.id\s*&&\s*retentionBusy\.policy\s*===\s*policy/, '15. 保存中状态精确到目标策略')
mustContain(documentsPage, 'error instanceof MemberAssetsApiError', '16. 保存期限错误透出后端可读原因')
mustContain(documentsPage, '保存期限已更新', '17. 成功后给出短提示')
mustMatch(documentsPage, /setItems\(\(prev\)\s*=>\s*prev\.map/, '18. 成功后局部回填文档卡片')
mustNotMatch(filesMockAdapter, /简历\s*1h\s*自动清理|resume_upload:\s*1\b/, '19. Mock 上传不得保留会员简历 1h 旧口径')
mustContain(filesMockAdapter, '90 * 24 * 60 * 60 * 1000', '20. Mock 会员简历类上传默认 90 天')
mustContain(filesMockAdapter, 'FILE_DEFAULT_TTL_HOURS', '21. Mock 匿名/系统短期文件复用 24h/6h/1h 常量')

if (failed > 0) {
  console.error(`\n=== FAILED (${failed} 项) ===`)
  process.exit(1)
}

console.log('\n=== ALL PASS ===')
