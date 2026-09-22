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
const materials = readRequired('src/pages/resume/components/career-plan/CareerPlanExistingMaterials.tsx')
const section = readRequired('src/pages/resume/components/career-plan/CareerPlanSection.tsx')
// 2026-09-23 迁入青序流光（稿 46-resume-decision-workspace.html?screen=career-plan）。
// 视觉锚点从 LightFlow 根作用域改钉宿主 46 的青序壳；下面的业务 / AI 接线 / 打印合同一条未删。
const css = readRequired('src/pages/resume/resume-decision-qx.css')
const kit = readRequired('src/pages/resume/jobFit/jobFitQxKit.tsx')
const careerUi = `${page}\n${materials}\n${section}`

check(page.includes("import './job-fit-qx.css'"), '职业规划页必须导入宿主 46 的共用青序样式')
check(page.includes("import './resume-decision-qx.css'"), '职业规划页必须导入宿主 46 的四栏样式')
check(!/careerPlan-(?:inkpaper|lightflow)\.css/.test(page), '职业规划页不得再导入 InkPaper / LightFlow 样式')
check(!/KioskFullscreenShell|KioskPageFrame|service-desk/.test(page), '职业规划页不再混入旧壳与旧色系')
check(page.includes('<JobFitStage>'), '职业规划页挂宿主 46 的共用舞台（1080×1920 定高 + 手机/横屏流式）')
check((page.match(/<QxPageFrame/g) ?? []).length === 1, '全部状态共用一层 QxPageFrame，不按屏各挂一个壳')
check(page.includes('data-kiosk-screen="resume-career-plan"'), '职业规划保留稳定 landmark')
check(page.includes('data-state={screen}'), '职业规划把当前状态铺到 DOM 上供断言')
check(page.includes('<Waiting') && kit.includes('role="status" aria-live="polite"'), '职业规划读取与生成中必须提供状态播报（Waiting 自带 status + polite）')
check(page.includes('role="alert"'), '职业规划错误必须提供告警语义')
check(page.includes('className="qx-scroll"') && page.includes('ctabar={view.cta}'), '内容区独立滚动，出口按钮留在滚动区之外的操作条上')

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
  /blockedActionLabel: plan \? '重新生成求职方案' : '生成求职方案'/.test(page),
  'AI 挂掉时入口必须置灰保留并写明是哪个入口，不得整块消失',
)

check(page.includes('<CareerPlanExistingMaterials'), '求职方案结果必须挂上已有材料栏，不得新开路由')
check(page.includes("title: '求职方案'"), '页头必须把这一页收口为求职方案')
check(page.includes('<CareerPlanColumns plan={plan} />'), '结果屏必须挂上三栏正文（呈现件在 CareerPlanSection.tsx）')
check(section.includes('title="目标与方向"'), '四栏必须包含目标与方向')
check(section.includes('title="尚需准备"'), '四栏必须包含尚需准备')
check(section.includes('title="执行计划"'), '四栏必须包含执行计划')
check(page.includes('依据：本人简历'), 'basedOn 依据文案必须保留，不得与已有材料混写')
check(materials.includes('getMyResumes('), '已有材料必须复用 getMyResumes，不得新写 fetch')
check(materials.includes('getMyDocuments('), '已有材料必须复用 getMyDocuments，不得新写 fetch')
check(!/\bfetch\s*\(/.test(materials), '已有材料不得新写 fetch')
check(materials.includes('登录后可看到你已保存的材料'), '匿名必须如实提示登录后可见已保存材料')
check(materials.includes("navigate('/me/documents')"), '已有材料必须给出「我的文档」既有出口')
check(materials.includes('if (!isLoggedIn)'), '未登录必须先挡在会员端点之前')
check(
  materials.indexOf('if (!isLoggedIn)') < materials.indexOf('getMyResumes('),
  '未登录分支必须出现在 getMyResumes 之前，避免空列表冒充已查询',
)
check(materials.includes('页头「依据」'), '已有材料必须把文件清单与 basedOn 依据区分开')
check(section.includes('data-career-plan-column={column}'), '四栏必须有稳定 column 地标供失败隔离断言')
check(!careerUi.includes('一键投递'), '求职方案页不得出现一键投递')

// 5) 置灰一律 aria-disabled。原生 disabled 会退出 Tab 序列、读屏跳过，
//    触屏又没有 hover，用户永远读不到为什么点不动。
check(
  !/(?<![-\w])disabled(\s*=|\s*\}|\s*\/|\s*>)/.test(page),
  '本页不得使用原生 disabled 属性（触屏无 hover + 读屏跳过 = 用户读不到原因）',
)
check((page.match(/aria-disabled=/g) ?? []).length >= 2, '打印与生成两个按钮的忙态都必须用 aria-disabled')

// 6) 非 AI 能力在 AI 挂掉时保持可用：打印只受打印自身状态影响。
check(
  /data-career-plan-print="true" aria-disabled=\{printing\}/.test(page),
  '打印按钮不得被 AI 可用性门控（出纸不依赖 AI）',
)

// 7) 证据分级与 AIGC 标识（矩阵实测 P22 连「仅供参考」都没有）。
check((page.match(/<AigcMark/g) ?? []).length === 1, 'AIGC 可见标识必须每页恰好一次')
check(careerUi.includes('EvidenceBadge level="E3"'), 'AI 结论必须标 E3')
check(careerUi.includes('EvidenceBadge level="E1"'), '简历原文依据必须标 E1')
check(page.includes('<EvidenceLegend'), '带 AI 结论的页面必须给三档证据图例')
check(page.includes('<AiConclusion'), '规划结论必须走统一 E3 结论组件')

// 8) 边界与兜底话术照抄原型（22-career-plan.html），不重新发明也不升级成承诺。
check(page.includes('不预测薪资'), '必须保留「不预测前景 / 不预测薪资」边界声明')
check(page.includes('由你自己决定'), '必须保留「是否转方向、是否考证由你自己决定」边界声明')
check(
  section.includes('这三条是通用建议，不是针对你这份简历的'),
  'ai-down 自查三条必须如实说明它不是针对本人简历的结论',
)
check(/aiOutage \? 'ai-down'/.test(page) && page.includes('<CareerPlanSelfCheck />'), 'ai-down 自查三条只在真的 ai-down 屏出现')

check(css.length > 0, '宿主 46 四栏样式不得为空')
check(lineCount(css) < 300, `宿主 46 四栏样式必须少于 300 行（当前 ${lineCount(css)}）`)
{
  // 自作用域：每条规则的选择器都必须以 .rdq- 开头，否则会外溢到 51 页共用的青序壳层。
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = [...bare.matchAll(/^\s*([^@\s{}][^{}]*)\{/gm)]
    .flatMap((match) => match[1].split(',').map((selector) => selector.trim()))
    .filter((selector) => selector && !/^(?:to|from|\d+%)$/.test(selector))
  const escaped = selectors.filter((selector) => !selector.startsWith('.rdq-'))
  check(escaped.length === 0, `宿主 46 四栏样式全部自作用域（外溢：${escaped.join(' / ') || '无'}）`)
}
check(!/#[0-9a-f]{3,8}\b/i.test(css), '宿主 46 四栏样式不写死色值，一律取 --qx-* 令牌')
check(css.includes('var(--qx-'), '宿主 46 四栏样式消费青序令牌')
check(!/(^|\n)\s*(?:html|body)\s*\{/.test(css), '宿主 46 四栏样式不污染全局页面')
check(css.includes('min-height: var(--qx-tap-min)'), '新增可点控件绑定 48px 触控下限令牌')
check(/@media\s*\(max-width:\s*760px\)/.test(css), '宿主 46 四栏样式覆盖手机真实视口')
check(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css), '宿主 46 四栏样式支持 prefers-reduced-motion')
check(/\.rdq-aria-btn\[aria-disabled='true'\]/.test(css), 'aria-disabled 置灰必须自己画禁用外观（原生 disabled 的样式不会生效）')
check(
  !/\.rdq-(?:item|direction|col)\s+span\s*\{/.test(css),
  '证据徽章所在容器不得有后代 span 规则，否则 E1/E3 标记会被压成块级撑断排版',
)

if (failures.length > 0) {
  console.error(`FAIL lightflow K2a career contract: ${failures.length}/${checks}`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`PASS lightflow K2a career contract: ${checks} checks`)
