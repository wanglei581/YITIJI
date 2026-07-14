import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const kioskRoot = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(kioskRoot, path), 'utf8')
const lineCount = (source) => source.split(/\r?\n/).length

let checks = 0
const failures = []

function check(condition, message) {
  checks += 1
  if (!condition) failures.push(message)
}

function readRequired(path) {
  const absolutePath = join(kioskRoot, path)
  check(existsSync(absolutePath), `${path} 必须存在`)
  return existsSync(absolutePath) ? read(path) : ''
}

const page = readRequired('src/pages/resume/CareerPlanPage.tsx')
const css = readRequired('src/pages/resume/careerPlan-lightflow.css')

check(page.includes("import './careerPlan-lightflow.css'"), '职业规划页必须导入 LightFlow 局部样式')
check(!page.includes('careerPlan-inkpaper.css'), '职业规划页不得导入 InkPaper 样式')
check(
  (page.match(/className="service-desk career-plan-lightflow/g) ?? []).length >= 4,
  '职业规划的前置、加载、引导和结果状态必须都有 LightFlow 根作用域',
)
check(page.includes('data-visual-theme="service-desk"'), '职业规划根节点必须声明 service-desk 视觉主题')
check(page.includes('data-ux-density="touch"'), '职业规划根节点必须声明 touch 密度')
check(page.includes('role="status"'), '职业规划加载或生成中必须提供状态播报')
check(page.includes('role="alert"'), '职业规划错误必须提供告警语义')
check(page.includes('aria-live="polite"'), '职业规划异步状态必须提供温和播报')

for (const token of [
  'getLatestCareerPlan(taskId, { token: getToken(), accessToken })',
  'generateCareerPlan(taskId, { token: getToken(), accessToken })',
  'printCareerPlan(taskId, { token: getToken(), accessToken })',
  'useBusyLock(generating || printing)',
  'if (!file.printFileUrl) throw new Error',
  'fileUrl: file.printFileUrl',
  "navigate('/print/confirm'",
  "makePrintParams({ copies: 1, duplex: 'single', color: 'bw' })",
]) {
  check(page.includes(token), `职业规划真实业务合同缺失：${token}`)
}

check(css.length > 0, '职业规划 LightFlow CSS 不得为空')
check(lineCount(css) < 300, `职业规划 LightFlow CSS 必须少于 300 行（当前 ${lineCount(css)}）`)
check(/\.career-plan-lightflow(?:[\s.{:#\[]|$)/.test(css), 'CSS 必须以 career-plan-lightflow 根作用域限定')
check(css.includes('var(--sd-color-canvas)'), 'CSS 必须复用冰蓝画布 token')
check(css.includes('var(--sd-color-surface)'), 'CSS 必须复用白色表面 token')
check(css.includes('var(--sd-color-text-strong)'), 'CSS 必须复用深海军蓝文本 token')
check(css.includes('var(--sd-color-primary)'), 'CSS 必须复用主蓝操作 token')
check(css.includes('var(--sd-control-min, 48px)'), 'CSS 必须绑定 48px 普通触控目标')
check(css.includes('var(--sd-primary-control-min, 56px)'), 'CSS 必须绑定 56px 主操作触控目标')
check(/@media[^{}]*1080px[^{}]*1920px/.test(css), 'CSS 必须覆盖 1080x1920')
check(/@media[^{}]*390px[^{}]*844px/.test(css), 'CSS 必须覆盖 390x844')
check(/@media[^{}]*390px[^{}]*700px/.test(css), 'CSS 必须覆盖 390x700')
check(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css), 'CSS 必须支持 prefers-reduced-motion')
check(!/(?:#f7f3e9|#fffdf8|#1e4c4d|Songti|SimSun|paper-texture)/i.test(css), 'CSS 不得混入 InkPaper 颜色、衬线或纸纹')
check(/\.career-plan-lightflow--guide,[\s\S]*?\.career-plan-lightflow--result\s*\{[\s\S]*?block-size:\s*100dvh[\s\S]*?overflow:\s*hidden/.test(css), '结果和引导页必须锁定视口，使内容区可独立滚动')
check(/\.career-plan-lightflow__content\s*\{[\s\S]*?overflow-y:\s*auto[\s\S]*?padding-bottom:\s*48px/.test(css), '内容区必须可滚动且为末项预留底部空间')
check(/\.career-plan-lightflow__action-bar\s*\{[\s\S]*?position:\s*sticky[\s\S]*?bottom:\s*0/.test(css), '底部生成或打印操作栏必须 sticky 且始终可达')

if (failures.length > 0) {
  console.error(`FAIL lightflow K2a career contract: ${failures.length}/${checks}`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`PASS lightflow K2a career contract: ${checks} checks`)
