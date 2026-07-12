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

console.log('\n=== /me/ai-records 墨青纸感换装守卫 ===')

const aiRecords = read('src/pages/profile/me/MyAiRecordsPage.tsx')
const jobAiRecords = read('src/pages/profile/me/JobAiSessionRecords.tsx')
const detailCss = read('src/pages/profile/me/me-detail-inkpaper.css')
const routes = read('src/routes/index.tsx')
const packageJson = read('package.json')

expectMatches(routes, /path:\s*'me\/ai-records'[\s\S]{0,80}?element:\s*<MyAiRecordsPage\s*\/>/, '/me/ai-records 路由仍指向 MyAiRecordsPage')

expectIncludes(aiRecords, "import './me-detail-inkpaper.css'", 'MyAiRecordsPage 引入明细页局部 CSS')
expectIncludes(aiRecords, "useInkRipple('.me-inkdetail", 'MyAiRecordsPage 只在 .me-inkdetail 作用域启用涟漪')
expectMatches(aiRecords, /className="me-inkdetail me-inkdetail-ai-records h-full"/, 'MyAiRecordsPage 使用独立 me-inkdetail-ai-records 根作用域')
expectIncludes(aiRecords, 'KIcon', 'MyAiRecordsPage 复用 KIcon 图标系统')

expectIncludes(aiRecords, 'getMyAiRecords(token, { pageSize: 50 })', 'MyAiRecordsPage 保留本人 AI 记录真实 API 拉取')
expectIncludes(aiRecords, 'listMyJobAiSessions(token, { pageSize: 50 })', 'MyAiRecordsPage 保留岗位 AI 会话真实 API 拉取')
expectIncludes(aiRecords, 'deleteMyAiRecord(token, record.id)', 'MyAiRecordsPage 保留本人 AI 记录删除接口')
expectIncludes(aiRecords, 'deleteMyJobAiSession(token, sessionId)', 'MyAiRecordsPage 保留岗位 AI 会话删除接口')
expectIncludes(aiRecords, 'confirmId !== record.id', 'MyAiRecordsPage 保留本人 AI 记录二次确认删除')
expectIncludes(aiRecords, 'confirmJobAiSessionId !== sessionId', 'MyAiRecordsPage 保留岗位 AI 会话二次确认删除')
expectMatches(aiRecords, /record\.kind === 'parse'[\s\S]{0,260}?setItems\(\(prev\) => prev\.filter\(\(item\) => item\.taskId !== record\.taskId\)\)[\s\S]{0,260}?setJobAiSessions\(\(prev\) => prev\.filter\(\(item\) => item\.session\.resumeTaskId !== record\.taskId\)\)/, '删除 parse 时同步移除同任务的全部派生 AI 记录与会话')
expectIncludes(aiRecords, "setHint(result.deletedCount > 1 ? '记录及关联分析结果已删除' : '记录已删除')", 'MyAiRecordsPage 如实提示关联分析结果删除')
expectIncludes(aiRecords, "setHint('岗位 AI 参考记录已删除')", 'MyAiRecordsPage 保留岗位 AI 删除成功提示')
expectIncludes(aiRecords, "setHint('删除失败，记录可能已到期或被清理')", 'MyAiRecordsPage 保留删除失败诚实提示')

expectIncludes(aiRecords, '不展示简历原文、诊断正文或模型原始输出', 'MyAiRecordsPage 保留不展示原文/模型输出隐私口径')
expectIncludes(aiRecords, '仅展示本人 AI 服务元数据', 'MyAiRecordsPage 保留仅展示元数据口径')
expectIncludes(jobAiRecords, '不展示简历原文、提示词或模型原始输出', 'JobAiSessionRecords 保留不展示提示词/模型输出口径')
expectIncludes(jobAiRecords, '分析结果仅供参考', 'JobAiSessionRecords 保留分析仅供参考文案')

expectIncludes(jobAiRecords, 'onDelete(item.session.id)', 'JobAiSessionRecords 保留删除回调接线')
expectIncludes(jobAiRecords, '再次点击确认删除岗位 AI 参考记录', 'JobAiSessionRecords 保留岗位 AI 删除确认 aria 文案')
expectIncludes(jobAiRecords, 'KIcon', 'JobAiSessionRecords 复用 KIcon 图标系统')

expectMatches(detailCss, /\.me-inkdetail \.me-delete-button\s*\{/, '明细页 CSS 在局部作用域提供删除按钮样式')
expectMatches(detailCss, /\.me-inkdetail \.me-delete-button\.is-confirm/, '明细页 CSS 在局部作用域提供删除确认态样式')
expectMatches(detailCss, /\.me-inkdetail \.me-section-copy h2/, '明细页 CSS 在局部作用域提供分区说明标题样式')

expectAbsent(aiRecords, /立即投递|一键投递|平台投递|自动保存到|生成报告并保存/, 'MyAiRecordsPage 不出现招聘闭环或越界保存口径')
expectAbsent(jobAiRecords, /立即投递|一键投递|平台投递|自动保存到|生成报告并保存/, 'JobAiSessionRecords 不出现招聘闭环或越界保存口径')
expectIncludes(packageJson, '"verify:profile-ai-records-inkpaper"', 'package.json 注册 verify:profile-ai-records-inkpaper')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — /me/ai-records 墨青纸感换装守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — /me/ai-records 墨青纸感换装保持真实能力边界\n')
