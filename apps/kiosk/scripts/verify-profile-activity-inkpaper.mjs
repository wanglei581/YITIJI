import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

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

console.log('\n=== /me/activity 墨青纸感换装守卫 ===')

const activity = read('src/pages/profile/me/MyActivityPage.tsx')
const detailCss = read('src/pages/profile/me/me-detail-inkpaper.css')
const api = read('src/services/api/activity.ts')
const routes = read('src/routes/index.tsx')
const packageJson = read('package.json')

expectMatches(routes, /path:\s*'me\/activity'[\s\S]{0,80}?element:\s*<MyActivityPage\s*\/>/, '/me/activity 路由仍指向 MyActivityPage')
expectIncludes(activity, "import './me-detail-inkpaper.css'", 'MyActivityPage 引入明细页局部 CSS')
expectIncludes(activity, "useInkRipple('.me-inkdetail", 'MyActivityPage 只在 .me-inkdetail 作用域启用涟漪')
expectMatches(activity, /className="me-inkdetail me-inkdetail-activity h-full"/, 'MyActivityPage 使用独立 me-inkdetail-activity 根作用域')
expectIncludes(activity, 'KIcon', 'MyActivityPage 复用 KIcon 图标系统')

expectIncludes(activity, 'getMyBrowseLogs(token, { pageSize: 50 })', 'MyActivityPage 保留浏览记录真实 API 拉取')
expectIncludes(activity, 'getMyJumpLogs(token, { pageSize: 50 })', 'MyActivityPage 保留外部跳转记录真实 API 拉取')
expectIncludes(activity, "searchParams.get('tab') === 'jump' ? 'jump' : 'browse'", 'MyActivityPage 保留 tab 查询参数切换')
expectIncludes(activity, "setSearchParams(next === 'jump' ? { tab: 'jump' } : {}, { replace: true })", 'MyActivityPage 保留 tab replace 导航行为')
expectIncludes(activity, 'detailRoute(it.targetType, it.targetId, it.externalId)', 'MyActivityPage 保留详情跳转路由计算')
expectIncludes(activity, 'actionLabel(it.action, it.targetType)', 'MyActivityPage 保留外部跳转动作中性文案映射')
expectIncludes(activity, '岗位来源入口', 'MyActivityPage 保留来源入口中性文案')
expectIncludes(activity, '招聘会来源入口', 'MyActivityPage 保留招聘会来源入口文案')
expectIncludes(activity, '官方入口', 'MyActivityPage 保留官方入口文案')
expectIncludes(activity, '投递 / 预约结果以来源平台为准，本系统不记录', 'MyActivityPage 保留投递/预约结果边界文案')

expectIncludes(api, 'getMyBrowseLogs', 'activity API 保留浏览记录查询函数')
expectIncludes(api, 'getMyJumpLogs', 'activity API 保留跳转记录查询函数')
expectIncludes(api, 'deleteMyBrowseLog', 'activity API 仍保留浏览记录删除能力（本页不新增入口）')
expectIncludes(api, 'deleteMyJumpLog', 'activity API 仍保留跳转记录删除能力（本页不新增入口）')
expectIncludes(api, '本系统不记录也不参与投递/预约流程', 'activity API 保留合规边界说明')

expectMatches(detailCss, /\.me-detail-summary\s*\{/, '明细页 CSS 提供概览卡样式')
expectMatches(detailCss, /\.me-tabbar\s*\{/, '明细页 CSS 提供 tabbar 样式')
expectMatches(detailCss, /\.me-detail-row\s*\{/, '明细页 CSS 提供记录行样式')
expectMatches(detailCss, /\.me-legal-note\s*\{/, '明细页 CSS 提供合规说明样式')

expectAbsent(activity, /一键投递|立即投递|平台投递|投递成功|预约成功|签到凭证|自动保存到|生成报告并保存/, 'MyActivityPage 不出现招聘闭环或越界保存口径')
expectAbsent(activity, /deleteMyBrowseLog|deleteMyJumpLog|确认删除|清空记录/, 'MyActivityPage 不新增删除/清空入口')
expectIncludes(packageJson, '"verify:profile-activity-inkpaper"', 'package.json 注册 verify:profile-activity-inkpaper')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — /me/activity 墨青纸感换装守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — /me/activity 墨青纸感换装保持真实能力边界\n')
