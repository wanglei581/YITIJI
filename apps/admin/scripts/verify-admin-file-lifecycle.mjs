/**
 * Admin 文件生命周期运营视图防回退验证。
 *
 * 运行: pnpm --filter @ai-job-print/admin verify:admin-file-lifecycle-ui
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const filesApiPath = join(ROOT, 'src/services/api/files.ts')
const filesRouteDir = join(ROOT, 'src/routes/files')
const indexPath = join(filesRouteDir, 'index.tsx')
const requiredFiles = [
  'fileMeta.ts',
  'retentionMeta.ts',
  'RetentionSummary.tsx',
  'FileTable.tsx',
]

const filesApi = readFileSync(filesApiPath, 'utf8')
const indexSrc = readFileSync(indexPath, 'utf8')
const fileMetaSrc = readFileSync(join(filesRouteDir, 'fileMeta.ts'), 'utf8')
const fileTableSrc = readFileSync(join(filesRouteDir, 'FileTable.tsx'), 'utf8')
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
  else fail(`${label} — 命中禁止模式: ${pattern}`)
}

console.log('\n=== Admin 文件生命周期运营视图验证 ===')

for (const field of [
  'status',
  'assetCategory',
  'ownerType',
  'ownerId',
  'retentionPolicy',
  'retentionSetBy',
  'retentionConsentAt',
  'retentionConsentVersion',
  'retentionLockedReason',
]) {
  mustContain(filesApi, `${field}:`, `AdminFileRecord 包含 ${field}`)
}

mustMatch(filesApi, /export\s+(interface|type)\s+AdminFileLifecycleSummary/, 'Admin adapter 暴露 lifecycle summary 类型')
mustContain(filesApi, 'getFileLifecycleSummary', 'Admin adapter 暴露 getFileLifecycleSummary')
mustContain(filesApi, '/files/lifecycle-summary', 'Admin adapter 调用只读 lifecycle summary endpoint')

for (const file of requiredFiles) {
  const full = join(filesRouteDir, file)
  if (existsSync(full)) pass(`存在 ${file}`)
  else fail(`缺少 ${file}`)
}

mustContain(indexSrc, 'RetentionSummary', 'FilesPage 集成 RetentionSummary')
mustContain(indexSrc, 'FileTable', 'FilesPage 集成 FileTable')
mustContain(indexSrc, 'getFileLifecycleSummary', 'FilesPage 读取全局生命周期统计')
mustMatch(fileMetaSrc, /function fmtDate\(iso: string \| null, fallback = '-'\)/, 'fmtDate 默认空值为中性占位')
mustContain(fileMetaSrc, "expiresAt: fmtDate(f.expiresAt, '长期保存')", '仅到期时间空值显示长期保存')
mustContain(fileTableSrc, "fmtDate(v.raw.retentionConsentAt, '-')", '同意时间空值不显示长期保存')
mustContain(indexSrc, 'const [now, setNow] = useState(() => Date.now())', 'FilesPage 固定生命周期计算时间基准')
mustContain(indexSrc, 'setNow(Date.now())', 'FilesPage 仅在重新加载数据时刷新时间基准')
mustContain(indexSrc, "signedUrl.startsWith('http://') || signedUrl.startsWith('https://')", 'FilesPage 兼容 COS 绝对签名 URL')

const routeSource = readdirSync(filesRouteDir)
  .filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'))
  .map((name) => readFileSync(join(filesRouteDir, name), 'utf8'))
  .join('\n')
const uiMutationPattern = /updateRetention|onChange=\{[^}]*retention|<select[^>]*retention|保存期限.*修改|修改保存期限|同意并保存/
mustNotMatch(routeSource, uiMutationPattern, 'Admin 文件生命周期 UI 不提供保存期限修改入口')

if (failed > 0) {
  console.error(`\n=== FAILED (${failed} 项) ===`)
  process.exit(1)
}

console.log('\n=== ALL PASS ===')
