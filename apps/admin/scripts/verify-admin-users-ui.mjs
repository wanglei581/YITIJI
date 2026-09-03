/**
 * Admin 用户管理 UI 验证。
 *
 * ── 边界变更记录 ───────────────────────────────────────────────────────────
 * 2026-09-02：本脚本原先断言适配器「无任何写方法」，即用户管理面全只读。
 * 该断言咬的是**当时还没做**，不是永远不做：
 *   - docs/product/feature-scope.md:216 把「用户列表、封禁、查看记录」列为 P1
 *   - docs/product/commercial-grade-feature-plan-2026-07.md:234 原文是
 *     「只读 GET /admin/users（…**封禁开关后置**），访问写审计」——「后置」是排期
 *   - docs/product/user-center-commercial-closure-plan-2026-07.md:115 的状态图
 *     直接写着 `Active --> Disabled: 管理员封禁`
 * 现在补齐该 P1 能力，只读边界随之挪到 **disable / restore 两条写路径**：
 * 适配器仍不得出现第三条写路径或 PATCH/PUT/DELETE，且停用必须走二次确认、
 * 必须填原因、后果文案必须与实际代码行为一致。边界是挪位置，不是撤掉。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const paths = {
  page: join(root, 'src/routes/users/index.tsx'),
  drawer: join(root, 'src/routes/users/UserDetailDrawer.tsx'),
  statusDialog: join(root, 'src/routes/users/UserStatusDialog.tsx'),
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
const statusDialog = readFileSync(paths.statusDialog, 'utf8')
const presentation = readFileSync(paths.presentation, 'utf8')
const service = readFileSync(paths.service, 'utf8')
const shared = readFileSync(paths.shared, 'utf8')
const drawerPrimitive = readFileSync(paths.drawerPrimitive, 'utf8')
const runtime = `${page}\n${drawer}\n${statusDialog}\n${presentation}\n${service}\n${shared}`

// 适配器写边界：只读两条 GET + disable / restore 两条写路径，此外一条都不许有。
// 想加第三条写路径必须先改这里，顺带被迫回答「后端写不写审计、要不要二次确认」。
const exportedFns = [...service.matchAll(/export function (\w+)\(/g)].map((match) => match[1]).sort()
const httpVerbs = [...service.matchAll(/method:\s*'([A-Z]+)'/g)].map((match) => match[1])
const writeVerbs = httpVerbs.filter((verb) => verb !== 'GET')
if (
  service.includes("'/admin/users'") &&
  service.includes('`/admin/users/${encodeURIComponent(endUserId)}`') &&
  service.includes('`/admin/users/${encodeURIComponent(endUserId)}/disable`') &&
  service.includes('`/admin/users/${encodeURIComponent(endUserId)}/restore`') &&
  JSON.stringify(exportedFns) === JSON.stringify(['disable', 'getDetail', 'list', 'restore']) &&
  writeVerbs.length === 1 && writeVerbs[0] === 'POST' &&
  !/\b(PATCH|PUT|DELETE)\b|mockAdapter|MOCK_/.test(service)
) {
  pass('API 适配器：真实 GET 列表/详情 + disable/restore 两条写路径，无 mock、无其它写方法')
} else {
  fail('API 适配器只允许 GET 列表/详情与 disable/restore 两条写路径（单一 POST 通道，禁 PATCH/PUT/DELETE）')
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

// ── 停用 / 恢复：二次确认与文案诚实性 ────────────────────────────────────────

for (const token of ['canDisableUser', 'canRestoreUser', 'UserStatusDialog', 'statusNotice']) {
  if (!page.includes(token)) fail(`用户页缺少停用/恢复接线: ${token}`)
}
// 可否恢复必须按 status 判断。closing / anonymized 同样是 enabled=false，
// 但服务端对它们一律 409；按 !enabled 判断会摆出一个必然失败的按钮。
if (/!\s*user\.enabled/.test(page)) fail('用户页用 !user.enabled 判断可恢复性，应改用 canRestoreUser(status)')
if (!presentation.includes("user.status === 'disabled'")) fail('canRestoreUser 未按 status==disabled 收敛')
pass('列表按 status 分别渲染停用/恢复入口，并挂载确认弹窗')

const statusDialogTokens = [
  'role="dialog"',
  'aria-modal="true"',
  'role="alert"',
  '确认停用',
  '确认恢复',
  '停用原因',
  '恢复原因',
  'trimmedReason',
  '记入审计日志',
]
for (const token of statusDialogTokens) {
  if (!statusDialog.includes(token)) fail(`停用/恢复确认弹窗缺少能力或文案: ${token}`)
}
// 二次确认不能被绕过：原因为空时提交按钮必须禁用。
if (!/disabled=\{busy \|\| !trimmedReason\}/.test(statusDialog)) {
  fail('确认弹窗未在原因为空时禁用提交按钮')
}
pass('停用/恢复走独立确认弹窗，必填原因且具备模态可访问性')

// 后果文案必须与代码实际行为一致（CLAUDE.md §9「不伪造能力」）：
//   会话失效时机 → common/guards/end-user-auth.guard.ts:61-71 是「每请求实时查库」，
//     所以只能写「下一次操作时失效」，不能写「立即断开」。
//   已付款订单   → print-jobs.controller.ts:33 的取件链路不查用户状态，纸照出，
//     所以必须明确提示管理员，不能沉默。
if (!statusDialog.includes('下一次操作时失效')) fail('停用后果未如实说明会话失效时机')
if (!statusDialog.includes('已付款的订单不受影响')) fail('停用后果未提示已付款订单仍可取件')
for (const overclaim of ['立即断开', '立刻断开', '立即下线', '会话立即终止']) {
  if (statusDialog.includes(overclaim)) fail(`停用后果文案夸大了实际行为: ${overclaim}`)
}
pass('停用后果文案与 guard / 取件链路的真实行为一致，未夸大为「立即断开」')

const sharedTokens = [
  'AdminUserListQuery',
  'AdminUserListItem',
  'AdminUserListResult',
  'AdminUserActivityItem',
  'AdminUserDetailResult',
  'AdminUserStatusChangeResult',
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

// 仍然禁止的字段与动作。
//
// 「封禁用户 / 解封用户」刻意**保留在禁用名单里**：本次上线的动作叫「停用 / 恢复」，
// 与库里的 status='disabled' 和列表既有的「已停用」标签同名。放开这两个词只会让
// 后来者把同一个动作改写成更重的「封禁」措辞，产生「UI 说封禁、库里叫 disabled、
// 审计里是 admin.user.disable」的三处口径漂移。
// 「删除用户 / 导出用户 / 重置账号」对应的能力至今不存在，出现即为伪造能力。
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
pass('UI 与适配器不含敏感字段、招聘闭环文案，也未把停用改写成更重的封禁措辞')

if (page.includes('UserDetailDrawer') && !page.includes('UsersIcon')) {
  pass('占位页已替换为表格 + 右侧详情抽屉')
} else {
  fail('用户页仍可能是占位实现')
}

console.log('\nALL PASS')
