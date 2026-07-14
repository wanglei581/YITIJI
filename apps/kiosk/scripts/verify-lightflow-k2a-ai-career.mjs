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
const referenceServiceNav = read('src/components/lightflow/ReferenceServiceNav.tsx')
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
const serviceDeskRoutes = [...serviceDeskRouteList.matchAll(/['\"]([^'\"]+)['\"]/g)].map((match) => match[1])
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
expectIncludes(assistantPage, "import { ReferenceServiceNav } from '../../components/lightflow/ReferenceServiceNav'", '助手页导入共享服务分类导航')
expectIncludes(referenceServiceNav, 'export function ReferenceServiceNav()', '共享服务分类导航组件存在')
expectIncludes(assistantPage, 'className="kassist kassist-lightflow"', '助手页使用局部 LightFlow 根命名空间')
expectMatches(
  assistantPage,
  /<main className="kassist kassist-lightflow" aria-labelledby="assistant-page-title">[\s\S]*?<h1 id="assistant-page-title" className="kassist-sr-only">AI助手<\/h1>/,
  '页面名称仅以无障碍标题保留',
)
expect(
  !/<h[1-6](?![^>]*kassist-sr-only)[^>]*>[\s\S]*?AI助手[\s\S]*?<\/h[1-6]>/.test(assistantPage),
  '视觉顶部不重复显示 AI助手 标题',
)
for (const [token, label] of [
  ['<ReferenceServiceNav />', '共享顶部服务分类导航'],
  ['className="lf-reference-panel assistant-session-panel"', '当前会话共享面板'],
  ['className="lf-reference-group-head"', '当前会话共享分组标题'],
  ['lf-reference-pair', '文字与语音共享配对布局'],
  ['lf-reference-primary call', '语音通话首要操作'],
  ['lf-reference-primary text', '文字对话首要操作'],
  ['className="lf-reference-panel assistant-support-panel"', '快捷任务、FAQ 与结果的共享面板'],
  ['lf-reference-secondary quick', '快捷任务次入口'],
  ['className="lf-reference-secondary faq"', 'FAQ 次入口'],
  ['className="assistant-support-divider"', 'FAQ 与结果之间的分隔线'],
]) {
  expectIncludes(assistantPage, token, `助手 4188 参考布局包含：${label}`)
}
for (const legacyToken of [
  'className="a-hero assistant-service-intro"',
  'className="assistant-service-desk"',
  'className="assistant-workbench"',
  'className="assistant-service-catalog"',
  'className="assistant-catalog-section',
  'lf-reference-primary-grid',
  'lf-reference-group lf-reference-secondary',
]) {
  expect(!assistantPage.includes(legacyToken), `助手不保留旧 Hero 或左右栏骨架：${legacyToken}`)
}
expectMatches(
  assistantPage,
  /<section className="lf-reference-panel assistant-session-panel"[\s\S]*?<div className="lf-reference-group-head">\s*<span className="lf-reference-icon"[^>]*>[\s\S]*?assistant-session-note/,
  '当前会话使用共享分组标题，图标容器为第一个直接子元素并保留会话说明',
)
expectMatches(
  assistantPage,
  /className=\{callActive \? 'lf-reference-primary call on' : 'lf-reference-primary call'\}[\s\S]*?>\s*<span className="lf-reference-icon">/,
  '语音主操作的第一个直接子元素为图标容器',
)
expectMatches(
  assistantPage,
  /className=\{callActive \? 'lf-reference-primary text' : 'lf-reference-primary text on'\}[\s\S]*?>\s*<span className="lf-reference-icon">/,
  '文字主操作的第一个直接子元素为图标容器',
)
expectMatches(
  assistantPage,
  /<section className="lf-reference-panel assistant-support-panel"[\s\S]*?assistant-quick-tasks[\s\S]*?assistant-faqs[\s\S]*?assistant-result-guide/,
  '快捷任务、FAQ 与结果去向合并在同一共享面板内',
)
expectMatches(
  assistantPage,
  /assistant-quick-tasks[\s\S]*?assistant-support-divider[\s\S]*?assistant-faqs[\s\S]*?assistant-support-divider[\s\S]*?assistant-result-guide/,
  'FAQ 与结果去向以分隔线的次级内容顺序呈现',
)
const referenceNavIndex = assistantPage.indexOf('<ReferenceServiceNav />')
const referencePanelIndex = assistantPage.indexOf('className="lf-reference-panel assistant-session-panel"')
const primaryIndex = assistantPage.indexOf('lf-reference-pair')
const chatIndex = assistantPage.indexOf('className="panel"')
const supportPanelIndex = assistantPage.indexOf('className="lf-reference-panel assistant-support-panel"')
const quickTasksIndex = assistantPage.indexOf('assistant-quick-tasks')
const faqsIndex = assistantPage.indexOf('assistant-faqs')
const resultGuideIndex = assistantPage.indexOf('assistant-result-guide')
expect(
  referenceNavIndex >= 0
    && referenceNavIndex < referencePanelIndex
    && referencePanelIndex < primaryIndex
    && primaryIndex < chatIndex
    && chatIndex < supportPanelIndex
    && supportPanelIndex < quickTasksIndex
    && quickTasksIndex < faqsIndex
    && faqsIndex < resultGuideIndex,
  '助手内容按导航、当前会话、模式、聊天、合并次入口、FAQ、结果说明顺序组织',
)
expectIncludes(assistantPage, 'src="/assets/ai-advisor.png"', '助手页继续使用既有小青图片')
expect(!assistantPage.includes('ai-advisor-transparent'), '助手页不引用透明版小青资源')
const advisorImageMatches = [...assistantPage.matchAll(/src="\/assets\/ai-advisor\.png"/g)]
expect(
  advisorImageMatches.length === 1 && (advisorImageMatches[0]?.index ?? -1) > assistantPage.indexOf('function ChatBubble'),
  '小青图片只在对话内容气泡中出现',
)

for (const [token, label] of [
  ['const ALLOWED_ROUTE_PREFIXES', '路由白名单'],
  ['function isAllowedRoute(route: string): boolean', '白名单校验'],
  ['const LazyCallPanel = USE_VOICE_CALL', '条件式 TRTC 懒加载'],
  ["import('./AssistantCallPanel')", 'TRTC 面板导入'],
  ['const sessionIdRef = useRef(newSessionId())', '每次进入的新会话'],
  ['const requestTokenRef = useRef(0)', '请求令牌锁'],
  ['sessionId: requestSessionId', '请求会话标识'],
  ['requestTokenRef.current !== requestToken', '旧请求回写拦截'],
  ['chatWithAssistant({', '真实对话接口调用'],
  ['<KioskKeyboard', '页内触控键盘'],
  [".lf-reference-primary, .kassist .lf-reference-secondary", '共享首要与次要入口涟漪反馈'],
  ['role="log"', '消息列表日志语义'],
  ['role="status"', '回复中状态语义'],
  ['role="alert"', '错误消息告警语义'],
  ['aria-label="输入咨询问题"', '咨询输入框名称'],
]) {
  expectIncludes(assistantPage, token, `助手对话合同保留：${label}`)
}

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
  ['.kassist.kassist-lightflow .assistant-session-panel .lf-reference-group-head {', '当前会话业务标题样式'],
  ['.kassist.kassist-lightflow .assistant-support-divider {', '合并次入口的分隔线样式'],
  ['.kassist.kassist-lightflow .assistant-result-row {', '结果去向文本样式'],
  ['--kassist-control-min: 48px', '48px 常规触控目标'],
  ['--kassist-primary-control-min: 56px', '56px 主操作触控目标'],
  ['@media (max-width: 900px)', '小屏单列回退'],
  ['@media (prefers-reduced-motion: reduce)', '减少动效支持'],
]) {
  expectIncludes(assistantCss, token, `助手 4188 样式保留：${label}`)
}
for (const legacyToken of [
  '.a-hero',
  '.assistant-service-desk',
  '.assistant-workbench',
  '.assistant-service-catalog',
  '.assistant-catalog-section',
  '.lf-reference-primary-grid',
  '.lf-reference-group {',
  '.lf-reference-panel {',
  '.lf-reference-primary {',
  '.lf-reference-secondary {',
  'min-height: 88px',
  'min-height: 78px',
]) {
  expect(!assistantCss.includes(legacyToken), `局部样式不保留旧 Hero 或左右栏规则：${legacyToken}`)
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
expect(
  !/(?:^|\n)\s*(?:html|body|:root)\b/m.test(assistantCss),
  '局部样式不覆写 html、body 或 :root',
)

const selectors = [...assistantCss.matchAll(/(?:^|})\s*([^@}][^{]+)\{/g)]
  .map((match) => match[1] ?? '')
  .filter((selector) => selector.trim())
expect(
  selectors.every(isLocalAssistantSelector),
  '所有实际样式选择器均限定在 .kassist 命名空间',
)
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
