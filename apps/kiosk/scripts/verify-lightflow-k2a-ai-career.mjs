import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => {
  const path = join(root, relativePath)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

let failures = 0

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  failures += 1
  console.error(`  FAIL ${message}`)
}

function expect(condition, message) {
  if (condition) pass(message)
  else fail(message)
}

function expectIncludes(source, token, message) {
  expect(source.includes(token), `${message}${source.includes(token) ? '' : ` — missing ${token}`}`)
}

function expectMatches(source, pattern, message) {
  expect(pattern.test(source), `${message}${pattern.test(source) ? '' : ` — missing ${pattern}`}`)
}

function isLocalAssistantSelector(selector) {
  const trimmed = selector.trim().replace(/^}+\s*/, '')
  if (!trimmed || trimmed.startsWith('@')) return true
  if (/^(?:from|to|\d+%(?:\s*,\s*\d+%)*)$/.test(trimmed)) return true
  return trimmed.includes('.kassist')
}

console.log('\n=== K2a AI 助手青序 LightFlow 静态合同 ===')

const packageJson = read('package.json')
const kioskRoot = read('src/layouts/KioskRoot.tsx')
const assistantPage = read('src/pages/assistant/AssistantPage.tsx')
const assistantCssEntry = read('src/pages/assistant/assistant-inkpaper.css')
const assistantCssPaths = [
  'src/pages/assistant/assistant-lightflow-shell.css',
  'src/pages/assistant/assistant-lightflow-call.css',
  'src/pages/assistant/assistant-lightflow-chat.css',
  'src/pages/assistant/assistant-lightflow-content.css',
]
const assistantCssParts = assistantCssPaths.map((path) => ({ path, source: read(path) }))
const assistantCss = [assistantCssEntry, ...assistantCssParts.map(({ source }) => source)].join('\n')

expectIncludes(
  packageJson,
  '"verify:lightflow-k2a-ai-career": "node scripts/verify-lightflow-k2a-ai-career.mjs"',
  'package.json 注册 K2a 静态 verify',
)

const serviceDeskRouteList = kioskRoot.split('const SERVICE_DESK_EXACT_ROUTES: readonly string[] = [')[1]?.split(']')[0] ?? ''
const expectedServiceDeskRoutes = [
  '/',
  '/help',
  '/assistant',
  '/profile',
  '/resume/source',
  '/resume/parse',
  '/resume/report',
  '/resume/generate',
  '/resume/generate/preview',
  '/resume/optimize',
  '/resume/templates',
  '/resume/materials',
  '/resume/export',
]
const serviceDeskRoutes = [...serviceDeskRouteList.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1])
expectIncludes(kioskRoot, 'const SERVICE_DESK_EXACT_ROUTES: readonly string[] = [', '服务台页壳声明精确路由白名单')
expect(
  serviceDeskRoutes.length === expectedServiceDeskRoutes.length
    && new Set(serviceDeskRoutes).size === expectedServiceDeskRoutes.length
    && expectedServiceDeskRoutes.every((route) => serviceDeskRoutes.includes(route)),
  '服务台页壳白名单严格等于已批准的 13 条 LightFlow 路由（含我的主入口）',
)
for (const route of expectedServiceDeskRoutes) {
  expectIncludes(serviceDeskRouteList, `'${route}'`, `服务台页壳保留 ${route}`)
}
expect(!kioskRoot.includes("startsWith('/resume')"), '服务台页壳不宽泛匹配简历路径')
expect(serviceDeskRoutes.every((route) => !route.startsWith('/me')), '服务台页壳不包含 /me/* 资料明细页')

expectIncludes(assistantPage, "import './assistant-inkpaper.css'", '助手页继续导入局部样式')
expectIncludes(assistantPage, 'className="kassist kassist-lightflow"', '助手页使用局部 LightFlow 根命名空间')
expectMatches(
  assistantPage,
  /<section className="kassist kassist-lightflow" aria-labelledby="assistant-page-title">[\s\S]*?<h1 id="assistant-page-title" className="kassist-sr-only">AI助手<\/h1>/,
  '页面名称仅以无障碍标题保留',
)
expect(
  !/<h[1-6](?![^>]*kassist-sr-only)[^>]*>[\s\S]*?AI助手[\s\S]*?<\/h[1-6]>/.test(assistantPage),
  '左上角及视觉顶部不显示 AI助手 标题',
)
expect(!assistantPage.includes('ReferenceServiceNav'), '助手页移除首页服务分类导航')
expect(!assistantPage.includes('lf-reference-'), '助手页移除首页 lf-reference 服务卡骨架')

for (const [token, label] of [
  ['className="assistant-workbench"', '980px 单列咨询工作台'],
  ['className="assistant-task-picker"', '任务选择器'],
  ['className="assistant-task-grid"', '两列任务网格'],
  ['className="assistant-task"', '任务按钮'],
  ['className="assistant-task-icon"', '任务图标'],
  ['className="assistant-task-copy"', '任务说明'],
  ['className="assistant-direct-question"', '直接提问入口'],
  ['className="assistant-conversation"', '真实对话区'],
  ['className="assistant-composer"', '独立输入区'],
  ['className="assistant-quick-questions"', '输入区快捷问题'],
  ['className="assistant-tool-button assistant-voice-trigger"', '输入区语音入口'],
]) {
  expectIncludes(assistantPage, token, `助手 4188 页面语法包含：${label}`)
}

for (const forbiddenToken of [
  'assistant-support-panel',
  'assistant-support-divider',
  'assistant-result-guide',
  'assistant-service-desk',
  'assistant-service-catalog',
  'assistant-catalog-section',
]) {
  expect(!assistantPage.includes(forbiddenToken), `助手不保留第二服务面板或旧目录骨架：${forbiddenToken}`)
}

const taskGridIndex = assistantPage.indexOf('className="assistant-task-grid"')
const conversationIndex = assistantPage.indexOf('className="assistant-conversation"')
const composerIndex = assistantPage.indexOf('className="assistant-composer"')
expect(
  taskGridIndex >= 0
    && taskGridIndex < conversationIndex
    && conversationIndex < composerIndex,
  '助手按任务选择、真实对话、独立输入区顺序组织',
)
expectIncludes(assistantPage, 'src="/assets/ai-advisor.png"', '助手页继续使用既有小青图片')
expect(!assistantPage.includes('ai-advisor-transparent'), '助手页不引入新的透明版资源依赖')

for (const [token, label] of [
  ['const ALLOWED_ROUTE_PREFIXES', '路由白名单'],
  ['function isAllowedRoute(route: string): boolean', '白名单校验'],
  ['const LazyCallPanel = USE_VOICE_CALL', '条件式 TRTC 懒加载'],
  ["import('./AssistantCallPanel')", 'TRTC 面板导入'],
  ['const sessionIdRef = useRef(newSessionId())', '每次进入的新会话'],
  ['useState<Message[]>(() => [welcomeMessage])', '首次进入按 URL intent 初始化欢迎语'],
  ['const requestTokenRef = useRef(0)', '请求令牌锁'],
  ['sessionId: requestSessionId', '请求会话标识'],
  ['requestTokenRef.current !== requestToken', '旧请求回写拦截'],
  ['chatWithAssistant({', '真实对话接口调用'],
  ['<KioskKeyboard', '页内触控键盘'],
  ['role="log"', '消息列表日志语义'],
  ['aria-busy={loading}', '消息列表加载语义'],
  ['role="status"', '回复中状态语义'],
  ['role="alert"', '错误消息告警语义'],
  ['aria-label="输入咨询问题"', '咨询输入框名称'],
  ['if (messages.length <= 1 && !loading) return', '首屏不被初始欢迎语自动滚动跳过'],
]) {
  expectIncludes(assistantPage, token, `助手对话合同保留：${label}`)
}
expectMatches(
  assistantPage,
  /const ALLOWED_ROUTE_PREFIXES\s*=\s*\[[^\]]*['"]\/interview['"]/,
  'AI 返回的模拟面试 action 通过助手安全路由白名单',
)

for (const [route, label] of [
  ["/resume/source", '简历服务'],
  ["/print/upload", '打印文件'],
  ["/jobs", '岗位信息'],
  ["/job-fairs", '招聘会'],
  ["/renshi?tab=policy", '政策服务'],
]) {
  expectIncludes(assistantPage, `route: '${route}'`, `任务咨询保留原有真实直达入口：${label}`)
}
expectIncludes(
  assistantPage,
  'serviceActions: readonly AssistantAction[]',
  '咨询任务以真实 AssistantAction 声明后续服务入口',
)
expectIncludes(
  assistantPage,
  'const visibleActions = contextActions?.length ? contextActions : selectedTask?.serviceActions',
  '后端未返回 action 时仍展示当前任务的真实服务入口',
)
expectIncludes(
  assistantPage,
  'const assistantRequestMessage = selectedTask',
  '真实 AI 请求按当前咨询任务组装上下文消息',
)
expectIncludes(
  assistantPage,
  '`当前咨询主题：${selectedTask.label}\\n用户问题：${text}`',
  '真实 AI 请求正文携带用户选择的咨询主题',
)
expectIncludes(assistantPage, 'message: assistantRequestMessage', '真实 AI 请求发送带主题的消息正文')
expectMatches(
  assistantPage,
  /context:\s*toolboxSkill[\s\S]*?consultationTaskId:\s*selectedTask\.id[\s\S]*?consultationTaskLabel:\s*selectedTask\.label/,
  '真实 AI 请求 context 同步携带咨询任务 id 与标签',
)
expectIncludes(
  assistantPage,
  'const ASSISTANT_USER_MESSAGE_MAX_LENGTH = 1800',
  '助手为主题前缀预留后端 2000 字符契约空间',
)
expectIncludes(
  assistantPage,
  'raw.slice(0, ASSISTANT_USER_MESSAGE_MAX_LENGTH).trim()',
  '发送边界再次截断用户问题，避免绕过输入框上限',
)
expectIncludes(
  assistantPage,
  'maxLength={ASSISTANT_USER_MESSAGE_MAX_LENGTH}',
  '咨询输入框公开 1800 字符上限',
)
expectIncludes(
  assistantPage,
  'setInput(event.target.value.slice(0, ASSISTANT_USER_MESSAGE_MAX_LENGTH))',
  '原生输入更新受相同字符上限约束',
)
expectIncludes(
  assistantPage,
  'onChange={(value) => setInput(value.slice(0, ASSISTANT_USER_MESSAGE_MAX_LENGTH))}',
  '虚拟键盘更新受相同字符上限约束',
)

for (const token of [
  '--sd-canvas',
  '--sd-surface',
  '--sd-text-strong',
  '--sd-text',
  '--sd-primary',
  '--sd-line',
  '--sd-control-min',
  '--sd-primary-control-min',
]) {
  expectIncludes(assistantCss, token, `局部样式使用 ${token} 令牌`)
}
expectIncludes(assistantCss, '.kassist.kassist-lightflow {', '局部样式根绑定 kassist-lightflow')
for (const [token, label] of [
  ['.kassist.kassist-lightflow .assistant-workbench {', '980px 工作台样式'],
  ['width: min(100%, 980px)', '原型 980px 内容轨'],
  ['.kassist.kassist-lightflow .assistant-task-grid {', '任务网格样式'],
  ['grid-template-columns: repeat(2, minmax(0, 1fr))', '宽屏两列任务'],
  ['.kassist.kassist-lightflow .assistant-conversation {', '开放式对话区样式'],
  ['.kassist.kassist-lightflow .assistant-composer {', '独立输入卡样式'],
  ['--kassist-control-min: 48px', '48px 常规触控目标'],
  ['--kassist-primary-control-min: 56px', '56px 主操作触控目标'],
  ['@media (max-width: 520px)', '窄屏断点'],
  ['@media (prefers-reduced-motion: reduce)', '减少动效支持'],
]) {
  expectIncludes(assistantCss, token, `助手 4188 样式保留：${label}`)
}
expectMatches(
  assistantCss,
  /@media \(max-width: 520px\)[\s\S]*?\.kassist\.kassist-lightflow \.assistant-task-grid\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
  '窄屏任务选择器回退为单列',
)
for (const forbiddenToken of [
  '.lf-reference-',
  '.assistant-support-panel',
  '.assistant-result-guide',
  '.assistant-service-desk',
  '.assistant-service-catalog',
]) {
  expect(!assistantCss.includes(forbiddenToken), `局部样式不保留首页服务卡或第二服务面板：${forbiddenToken}`)
}
for (const { path, source } of assistantCssParts) {
  const fileName = path.split('/').at(-1) ?? path
  expect(source.length > 0, `局部样式分片存在：${fileName}`)
  expect(source.length > 0 && source.split('\n').length < 300, `局部样式分片小于 300 行：${fileName}`)
}
for (const path of assistantCssPaths) {
  const fileName = path.split('/').at(-1) ?? path
  expectIncludes(assistantCssEntry, `@import './${fileName}';`, `聚合入口导入 ${fileName}`)
}
expect(!/(?:^|\n)\s*(?:html|body|:root)\b/m.test(assistantCss), '局部样式不覆写 html、body 或 :root')

const selectors = [...assistantCss.matchAll(/(?:^|})\s*([^@}][^{]+)\{/g)]
  .map((match) => match[1] ?? '')
  .filter((selector) => selector.trim())
expect(selectors.every(isLocalAssistantSelector), '所有实际样式选择器均限定在 .kassist 命名空间')
expect(
  [...assistantCss.matchAll(/@keyframes\s+([\w-]+)/g)].every((match) => match[1]?.startsWith('kassist-lightflow-')),
  '局部动效名称均使用 kassist-lightflow 前缀',
)
for (const legacyToken of [
  '#f4f1e8', '#efeadd', '#fffdf8', '#10302b', '#1f9e86', '#157a67', '#a9781f', '#7a5a86',
  'Noto Serif', 'Source Han Serif', 'Songti SC', 'SimSun', 'repeating-linear-gradient',
]) {
  expect(!assistantCss.includes(legacyToken), `局部样式不回退 InkPaper 视觉：${legacyToken}`)
}

if (failures > 0) {
  console.error(`\n${failures} K2a 静态合同检查失败`)
  process.exit(1)
}

console.log('\nALL PASS K2a AI 助手青序 LightFlow 静态合同')
