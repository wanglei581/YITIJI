import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// verify:data-request-ui — UserDataRequest 两端诚实文案守卫（P0-3 + C-04）
//
// 与 main 后端对齐：
// - delete 创建路径拒绝账号注销（ACCOUNT_CLOSURE_NOT_AVAILABLE）
// - UI 不得暗示「全部个人数据已删除 / 账号注销成功」
// - 导出范围文案必须与 MemberDataExportMapper 白名单一致（禁止「不导出订单/文件」）
// ============================================================

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(kioskRoot, '../..')
const read = (absolutePath) => readFileSync(absolutePath, 'utf8')

let failures = 0
function pass(message) {
  console.log(`  PASS ${message}`)
}
function fail(message) {
  failures += 1
  console.error(`  FAIL ${message}`)
}
function expectIncludes(source, snippet, message) {
  if (source.includes(snippet)) pass(message)
  else fail(`${message} — missing ${snippet}`)
}
function expectMatches(source, pattern, message) {
  if (pattern.test(source)) pass(message)
  else fail(`${message} — pattern ${pattern} not found`)
}
function expectAbsent(source, pattern, message) {
  if (!pattern.test(source)) pass(message)
  else fail(`${message} — forbidden pattern ${pattern} matched`)
}

console.log('\n=== UserDataRequest 两端诚实文案守卫 ===')

const shared = read(join(repoRoot, 'packages/shared/src/types/memberPrivacy.ts'))
const mapper = read(join(repoRoot, 'services/api/src/member-privacy/member-data-export.mapper.ts'))
const kioskPage = read(join(kioskRoot, 'src/pages/profile/me/MyPrivacyRequestsPage.tsx'))
const kioskApi = read(join(kioskRoot, 'src/services/api/memberPrivacy.ts'))
const kioskRoutes = read(join(kioskRoot, 'src/routes/index.tsx'))
const kioskSettings = read(join(kioskRoot, 'src/pages/profile/me/MySettingsPage.tsx'))
const adminPagePath = join(repoRoot, 'apps/admin/src/routes/privacy-requests/index.tsx')
const adminApiPath = join(repoRoot, 'apps/admin/src/services/api/adminPrivacyRequests.ts')
const retiredAdminPagePath = join(repoRoot, 'apps/admin/src/routes/member-privacy/index.tsx')
const retiredAdminApiPath = join(repoRoot, 'apps/admin/src/services/api/memberPrivacyAdmin.ts')
const adminPage = read(adminPagePath)
const adminApi = read(adminApiPath)
const adminRoutes = read(join(repoRoot, 'apps/admin/src/routes/index.tsx'))
const adminNav = read(join(repoRoot, 'apps/admin/src/layouts/AdminLayoutWrapper.tsx'))
const backendCreate = read(join(repoRoot, 'services/api/src/member-privacy/member-data-request.service.ts'))
const kioskPkg = read(join(kioskRoot, 'package.json'))
const adminPkg = read(join(repoRoot, 'apps/admin/package.json'))
const ci = read(join(repoRoot, '.github/workflows/ci.yml'))

expectIncludes(shared, 'MEMBER_DATA_REQUEST_SCOPE', 'shared 导出范围横幅文案')
expectIncludes(shared, '账号注销暂未开放', 'shared 明确账号注销未开放')
expectIncludes(shared, '元数据清单', 'shared 说明导出为元数据清单')
expectIncludes(shared, '打印订单', 'shared 诚实披露导出含打印订单')
expectIncludes(shared, '文件清单', 'shared 诚实披露导出含文件清单')
expectIncludes(shared, '收藏', 'shared 诚实披露导出含收藏')
expectIncludes(shared, '不含文件原文二进制', 'shared 说明不含文件原文')
expectIncludes(shared, 'ADMIN_DATA_REQUEST_DELETE_COMPLETE_CONFIRM', 'shared 含管理端删除/注销诚实否定文案')
expectIncludes(shared, '不是「仅岗位 AI 会话」', 'Admin 导出说明否定过时窄范围')
// 只检查用户可见字符串常量，避免 JSDoc 误伤
const sharedStringLiterals = [...shared.matchAll(/'([^'\\]|\\.)*'/g)].map((match) => match[0]).join('\n')
expectAbsent(
  sharedStringLiterals,
  /不导出简历|不导出文档|不导出打印订单|不导出收藏|不会自动打包简历或其他个人资产/,
  'shared 用户可见文案不含过时「不导出订单/文件/收藏」表述',
)
expectAbsent(
  shared,
  /全部个人数据已删除|清空账号|账号已注销|已删除全部/,
  'shared 不含越界「全部删除/注销」肯定表述',
)

expectIncludes(mapper, 'printOrders', 'mapper 导出含 printOrders')
expectIncludes(mapper, 'files:', 'mapper 导出含 files')
expectIncludes(mapper, 'favorites', 'mapper 导出含 favorites')
expectIncludes(mapper, 'resumeResults', 'mapper 导出含 resumeResults')
expectMatches(
  mapper,
  /MEMBER_EXPORT_SCHEMA_VERSION\s*=\s*'member-data-export-v1'/,
  'mapper schema 版本锁定',
)

expectMatches(
  backendCreate,
  /requestType === 'delete'[\s\S]{0,120}ACCOUNT_CLOSURE_NOT_AVAILABLE/,
  '后端 delete 创建路径拒绝账号注销',
)
expectAbsent(
  backendCreate,
  /resume\.deleteMany|printTask\.deleteMany|memberFavorite|document\.deleteMany/,
  '后端数据请求创建路径不删简历/订单/收藏/文档',
)

expectIncludes(kioskPage, 'MEMBER_DATA_REQUEST_SCOPE', 'Kiosk 页使用 shared 范围横幅')
expectIncludes(kioskPage, '隐私与数据请求', 'Kiosk 页标题不再伪称仅岗位 AI')
expectIncludes(kioskPage, 'MyPrivacyRequestsPage', 'Kiosk 隐私请求页存在')
expectIncludes(kioskPage, 'revoke_consent', 'Kiosk 仅开放撤回授权操作')
expectIncludes(kioskApi, '/me/data-requests', 'Kiosk API 走 me/data-requests')
expectIncludes(kioskApi, 'idempotency-key', 'Kiosk 创建请求携带幂等键')
expectMatches(
  kioskRoutes,
  /path:\s*'me\/privacy-requests'[\s\S]{0,80}MyPrivacyRequestsPage/,
  'Kiosk 路由注册 /me/privacy-requests',
)
expectIncludes(kioskSettings, '/me/privacy-requests', '账号设置入口链到隐私请求页')
expectIncludes(kioskSettings, '账号注销和数据导出尚未开放', '设置页保持导出/注销未开放诚实句')
expectIncludes(kioskSettings, '业务元数据清单', '设置页说明后台导出含业务元数据')
expectAbsent(
  kioskPage,
  /全部个人数据已删除|清空账号|账号注销成功|已删除全部|删除您的简历|删除打印订单|仅限岗位 AI 咨询会话与授权/,
  'Kiosk 页不含越界删除肯定表述或过时窄范围副标题',
)

expectIncludes(adminPage, 'MEMBER_DATA_REQUEST_SCOPE', 'Admin 页展示范围横幅')
expectIncludes(adminPage, 'ADMIN_DATA_REQUEST_REJECT_HINT', 'Admin 驳回使用诚实说明')
expectIncludes(adminPage, 'ADMIN_DATA_REQUEST_EXPORT_COMPLETE_HINT', 'Admin 导出说明来自 shared')
expectIncludes(adminApi, '/admin/member-privacy/data-requests', 'Admin API 走 member-privacy 端点')
expectIncludes(adminApi, '/retry', 'Admin API 提供重试')
expectIncludes(adminApi, '/reject', 'Admin API 提供驳回')
expectMatches(adminRoutes, /path:\s*'privacy-requests'/, 'Admin 路由注册 /privacy-requests')
expectIncludes(adminNav, '数据权利工单', 'Admin 侧栏保留数据权利工单')
expectAbsent(adminRoutes, /path:\s*'member-privacy'/, 'Admin 已移除重复 /member-privacy 路由')
expectAbsent(adminNav, /会员隐私请求/, 'Admin 已移除重复会员隐私请求导航')
if (!existsSync(retiredAdminPagePath)) pass('Admin 重复 member-privacy 页面已删除')
else fail('Admin 重复 member-privacy 页面仍存在')
if (!existsSync(retiredAdminApiPath)) pass('Admin 重复 memberPrivacyAdmin 适配器已删除')
else fail('Admin 重复 memberPrivacyAdmin 适配器仍存在')
expectAbsent(
  adminPage,
  /全部个人数据已删除|清空账号|账号注销成功|已删除全部|仅处理岗位 AI 咨询会话与授权相关请求/,
  'Admin 页不含越界删除肯定表述或过时窄范围副标题',
)

expectIncludes(kioskPkg, 'verify:data-request-ui', 'Kiosk package 注册 verify:data-request-ui')
expectIncludes(adminPkg, 'verify:data-request-ui', 'Admin package 注册 verify:data-request-ui')
expectIncludes(ci, 'verify:data-request-ui', 'CI 接入 data-request-ui 守卫')

if (failures > 0) {
  console.error(`\n=== FAILED: ${failures} assertion(s) ===\n`)
  process.exit(1)
}
console.log('\n=== ALL PASS ===\n')
