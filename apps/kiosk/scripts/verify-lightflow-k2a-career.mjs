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

// ── P22 AI 接线合同（接线矩阵 §3.7 / S2-6）────────────────────────────────
// 每条都对应一处「做错会让用户被骗或被挡死」的规则，不是关键字凑数。

// 1) resumeTaskId 前置：后端 AI_TASK_NOT_FOUND 必须挡在门控页。
//    读回失败整体吞掉，会让带着过期/不属于自己的 taskId 的用户落到生成页，
//    点一次生成再吃一次同样的失败，且没有任何解释。
check(page.includes("code === 'AI_TASK_NOT_FOUND'"), '前置校验必须识别后端 AI_TASK_NOT_FOUND')
check(page.includes("code === 'CAREER_PLAN_NOT_FOUND'"), '「还没生成过」必须与「简历任务不存在」分开处理')
check(!/\.catch\(\(\) => undefined\)/.test(page), '规划读回失败不得整体吞成「无记录是正常态」')
check(/rejectedTask \? 'rejected'/.test(page), '后端否认 taskId 后必须进入前置门控而不是继续渲染生成入口')

// 2) AI 可用性必须来自真实信号。写死 available 会在 AI 挂掉时把按钮渲染成可用。
check(
  /const availability: AiAvailability = aiOutage \? 'unavailable' : probed \? 'available' : 'unknown'/.test(page),
  'availability 必须由真实往返与真实故障码派生（未探测时 fail-closed 到 unknown）',
)
check(page.includes('AI_OUTAGE_CODES'), '能力级故障码必须与可重试的一次性失败分开')
check(!/pending:\s*true/.test(page), 'pending 只能来自真实生成中状态，不得写死')

// 3) 前端不得自行推进 AI 任务状态（原型接线要求 1/3：进度条不许空转）。
check(
  !/\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/.test(page),
  '本页不得用计时器推进 AI 任务状态或兜底把 running 变成 done',
)

// 4) 三类降级：blocked / result-unavailable 用上，manual 刻意不用。
//    职业规划没有「自己一步步做也能拿到同一份结果」的路径，套 manual 等于伪造等价手动路径。
check(page.includes("mode: 'blocked'"), 'AI 能力级不可用必须走 blocked（入口置灰 + 常驻原因）')
check(page.includes("mode: 'result-unavailable'"), '模型跑了但没出结果必须走 result-unavailable')
check(!page.includes("mode: 'manual'"), '职业规划不得声明等价手动路径（无同等产出的手动替代）')
check(page.includes('reason: aiOutage ??'), '降级原因必须优先透出后端真实 message，不得只写「AI 暂不可用」')
check(
  /blockedActionLabel: plan \? '重新生成职业规划' : '生成职业规划建议'/.test(page),
  'AI 挂掉时入口必须置灰保留并写明是哪个入口，不得整块消失',
)

// 5) 置灰一律 aria-disabled。原生 disabled 会退出 Tab 序列、读屏跳过，
//    触屏又没有 hover，用户永远读不到为什么点不动。
check(
  !/(?<![-\w])disabled(\s*=|\s*\}|\s*\/|\s*>)/.test(page),
  '本页不得使用原生 disabled 属性（触屏无 hover + 读屏跳过 = 用户读不到原因）',
)
check((page.match(/aria-disabled=/g) ?? []).length >= 2, '打印与生成两个按钮的忙态都必须用 aria-disabled')

// 6) 非 AI 能力在 AI 挂掉时保持可用：打印只受打印自身状态影响。
check(
  /className="career-plan-lightflow__print-action" aria-disabled=\{printing\}/.test(page),
  '打印按钮不得被 AI 可用性门控（出纸不依赖 AI）',
)

// 7) 证据分级与 AIGC 标识（矩阵实测 P22 连「仅供参考」都没有）。
check((page.match(/<AigcMark/g) ?? []).length === 1, 'AIGC 可见标识必须每页恰好一次')
check(page.includes('EvidenceBadge level="E3"'), 'AI 结论必须标 E3')
check(page.includes('EvidenceBadge level="E1"'), '简历原文依据必须标 E1')
check(page.includes('<EvidenceLegend'), '带 AI 结论的页面必须给三档证据图例')
check(page.includes('<AiConclusion'), '规划结论必须走统一 E3 结论组件')

// 8) 边界与兜底话术照抄原型（22-career-plan.html），不重新发明也不升级成承诺。
check(page.includes('不预测薪资'), '必须保留「不预测前景 / 不预测薪资」边界声明')
check(page.includes('由你自己决定'), '必须保留「是否转方向、是否考证由你自己决定」边界声明')
check(
  page.includes('这三条是通用建议，不是针对你这份简历的'),
  'ai-down 自查三条必须如实说明它不是针对本人简历的结论',
)

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
check(/@keyframes career-plan-lightflow-sweep/.test(css), '生成中进度动效必须定义在本页作用域内')
check(/\[aria-disabled='true'\]/.test(css), 'aria-disabled 置灰必须自己画禁用外观（原生 disabled 的样式不会生效）')
check(
  /\.career-plan-lightflow \.kiosk-ev\s*\{[^}]*display:\s*inline-flex/.test(css),
  '证据徽章不得被本页的 span 块级规则压成块级，否则 E1/E3 标记会撑断卡片排版',
)

if (failures.length > 0) {
  console.error(`FAIL lightflow K2a career contract: ${failures.length}/${checks}`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`PASS lightflow K2a career contract: ${checks} checks`)
