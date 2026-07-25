import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const paths = {
  page: join(root, 'src/routes/users/index.tsx'),
  drawer: join(root, 'src/routes/users/UserDetailDrawer.tsx'),
  presentation: join(root, 'src/routes/users/userPresentation.ts'),
  service: join(root, 'src/services/api/adminUsers.ts'),
  shared: join(root, '../../packages/shared/src/types/adminUsers.ts'),
  drawerPrimitive: join(root, '../../packages/ui/src/components/Drawer.tsx'),
}

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

console.log('\n=== Admin 用户管理 UI 验证 ===')

for (const [name, path] of Object.entries(paths)) {
  if (!existsSync(path)) fail(`${name} 文件不存在: ${path}`)
}

const page = readFileSync(paths.page, 'utf8')
const drawer = readFileSync(paths.drawer, 'utf8')
const presentation = readFileSync(paths.presentation, 'utf8')
const service = readFileSync(paths.service, 'utf8')
const shared = readFileSync(paths.shared, 'utf8')
const drawerPrimitive = readFileSync(paths.drawerPrimitive, 'utf8')
const runtime = `${page}\n${drawer}\n${presentation}\n${service}\n${shared}`

if (
  service.includes("'/admin/users'") &&
  service.includes('`/admin/users/${encodeURIComponent(endUserId)}`') &&
  !/\b(POST|PATCH|PUT|DELETE)\b|mockAdapter|MOCK_/.test(service)
) {
  pass('API 适配器仅提供真实 GET 列表与详情')
} else {
  fail('API 适配器必须是无 mock、无写方法的 HTTP-only GET 服务')
}

const pageTokens = [
  '用户管理',
  '完整手机号',
  'registeredFrom',
  'registeredTo',
  'enabled',
  '查询',
  '重置',
  '刷新',
  '查看详情',
  'Pagination',
  '暂无注册用户',
  '未找到符合条件的用户',
]
for (const token of pageTokens) {
  if (!page.includes(token) && !presentation.includes(token)) fail(`用户页缺少能力或文案: ${token}`)
}
pass('页面包含搜索、状态、日期、分页与完整列表状态')

for (const token of ['safePage', 'lastPage', 'handlePageSizeChange', 'retryable', 'maxLength={50}']) {
  if (!page.includes(token)) fail(`用户页缺少质量收口行为: ${token}`)
}
pass('页面收敛非法/越界页码、页大小切换与 4xx 错误语义')

const drawerTokens = [
  'UserDetailDrawer',
  'fileCount',
  'printTaskCount',
  'aiResultCount',
  'browseCount',
  'externalJumpCount',
  'recentActivities',
  'retentionNotice',
  'ADMIN_USER_NOT_FOUND',
  '重试',
]
for (const token of drawerTokens) {
  if (!drawer.includes(token)) fail(`详情抽屉缺少能力或状态: ${token}`)
}
pass('详情抽屉包含五项统计、最近活动、留存说明与局部失败处理')

for (const token of ['ariaLabel="用户详情"', 'onKeyDown', 'role="status"', 'role="alert"']) {
  if (!drawer.includes(token)) fail(`详情抽屉缺少模态可访问性行为: ${token}`)
}
if (!drawerPrimitive.includes('ariaLabel?: string') || !drawerPrimitive.includes("aria-label={ariaLabel ?? title ?? '抽屉'}")) {
  fail('公共 Drawer 缺少无重复标题场景的准确可访问名称')
}
pass('详情抽屉具备准确可访问名称、焦点圈定与状态播报')

const sharedTokens = [
  'AdminUserListQuery',
  'AdminUserListItem',
  'AdminUserListResult',
  'AdminUserActivityItem',
  'AdminUserDetailResult',
]
for (const token of sharedTokens) {
  if (!shared.includes(token) || !service.includes(token)) fail(`共享契约未被适配器消费: ${token}`)
}
pass('前端适配器消费 packages/shared 契约 SSOT')

const transpiledPresentation = ts.transpileModule(presentation, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: paths.presentation,
}).outputText
const presentationModule = await import(
  `data:text/javascript;base64,${Buffer.from(transpiledPresentation).toString('base64')}`
)
const phoneQuery = presentationModule.buildAdminUserQuery(
  { search: '13912345678', enabled: 'all', registeredFrom: '', registeredTo: '' },
  1,
  20,
)
const keywordQuery = presentationModule.buildAdminUserQuery(
  { search: '验证会员', enabled: 'disabled', registeredFrom: '2026-07-01', registeredTo: '2026-07-01' },
  2,
  50,
)
if (phoneQuery.phone !== '13912345678' || phoneQuery.keyword !== undefined) fail('完整手机号未正确分流到 phone')
if (keywordQuery.keyword !== '验证会员' || keywordQuery.enabled !== false) fail('昵称/状态筛选映射错误')
const expectedStart = new Date(2026, 6, 1, 0, 0, 0, 0).toISOString()
const expectedEnd = new Date(2026, 6, 1, 23, 59, 59, 999).toISOString()
if (keywordQuery.registeredFrom !== expectedStart || keywordQuery.registeredTo !== expectedEnd) {
  fail('注册日期没有映射为本地整日起止边界')
}
pass('实际展示 helper 通过手机号分流、状态与本地整日边界行为验证')

const forbidden = [
  '功能建设中',
  'phoneEnc',
  'phoneHash',
  'filename',
  'fileUrl',
  'payloadJson',
  'sourceUrl',
  '一键投递',
  '立即投递',
  '封禁用户',
  '解封用户',
  '删除用户',
  '导出用户',
  '重置账号',
]
for (const token of forbidden) {
  if (runtime.includes(token)) fail(`UI 或适配器包含禁止字段/操作: ${token}`)
}
pass('UI 与适配器不含敏感字段、招聘闭环文案或用户写操作')

if (page.includes('UserDetailDrawer') && !page.includes('UsersIcon')) {
  pass('占位页已替换为表格 + 右侧详情抽屉')
} else {
  fail('用户页仍可能是占位实现')
}

console.log('\nALL PASS')
