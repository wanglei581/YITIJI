import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const sha256 = (path) => createHash('sha256').update(read(path)).digest('hex')
let failures = 0
const check = (condition, message) => {
  if (condition) console.log(`PASS ${message}`)
  else { failures += 1; console.error(`FAIL ${message}`) }
}
const includes = (path, marker, message) => check(read(path).includes(marker), `${message}: ${marker}`)

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
}

function cssRuleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return stripCssComments(source).match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

function splitSelectorList(source) {
  const selectors = []
  let current = ''
  let quote = ''
  let escaped = false
  let parens = 0
  let brackets = 0
  for (const char of source) {
    if (escaped) { escaped = false; current += char; continue }
    if (char === '\\') { escaped = true; current += char; continue }
    if (quote) { if (char === quote) quote = ''; current += char; continue }
    if (char === '"' || char === "'") { quote = char; current += char; continue }
    if (char === '(') parens += 1
    else if (char === ')') parens = Math.max(0, parens - 1)
    else if (char === '[') brackets += 1
    else if (char === ']') brackets = Math.max(0, brackets - 1)
    if (char === ',' && parens === 0 && brackets === 0) {
      if (current.trim()) selectors.push(current.trim())
      current = ''
    } else current += char
  }
  if (current.trim()) selectors.push(current.trim())
  return selectors
}

function collectCssSelectors(source) {
  const css = stripCssComments(source)
  const selectors = []
  let preamble = ''
  let quote = ''
  let escaped = false
  let keyframeDepth = -1
  let depth = 0
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index]
    if (escaped) { escaped = false; preamble += char; continue }
    if (char === '\\') { escaped = true; preamble += char; continue }
    if (quote) { if (char === quote) quote = ''; preamble += char; continue }
    if (char === '"' || char === "'") { quote = char; preamble += char; continue }
    if (char === ';' && depth === 0) { preamble = ''; continue }
    if (char === '{') {
      const head = preamble.trim()
      const isAtRule = head.startsWith('@')
      const isKeyframes = /^@(?:-\w+-)?keyframes\b/i.test(head)
      if (isKeyframes) keyframeDepth = depth + 1
      else if (!isAtRule && keyframeDepth < 0 && head) {
        selectors.push(...splitSelectorList(head))
      }
      depth += 1
      preamble = ''
      continue
    }
    if (char === '}') {
      if (keyframeDepth === depth) keyframeDepth = -1
      depth = Math.max(0, depth - 1)
      preamble = ''
      continue
    }
    preamble += char
  }
  check(depth === 0 && !quote, 'CSS scanner ends with balanced braces and strings')
  return selectors
}

const routes = [
  '/resume', '/resume/upload', '/resume/source', '/resume/generate',
  '/resume/generate/preview', '/resume/parse', '/resume/report',
  '/resume/optimize', '/resume/export', '/resume/templates',
  '/resume/materials', '/resume/job-fit', '/resume/career-plan',
  '/assistant', '/interview', '/interview/setup', '/interview/session',
  '/interview/report', '/interview/tips', '/interview/reports',
]
check(routes.length === 20 && new Set(routes).size === 20, 'W3 route inventory is exactly 20 unique patterns')
const manifest = read('tests/visual/route-manifest.ts')
for (const route of routes) check(manifest.includes(`'${route}'`), `manifest retains ${route}`)

const frozen = {
  // 2026-08-18 重新冻结（PR #598 手机扫码上传公共界面收口）：刷新二维码时先 await 撤销
  // 旧会话再签发新码（旧码此前刷新后仍可被旁人用来上传），且「手机端已上传」状态下刷新
  // 按钮不可点（此前一次误触即丢弃已上传文件）。冻结契约不放宽，仍逐字节校验；新行为由
  // verify:resume-phone-upload-ui 的两条 AST 断言反向钉死。
  // 旧哈希 c7757306daa80f82ce58adb188dce73b68ea9840e9cff8312f54a2af63b72f50。
  // 2026-09-29 重新冻结：确认使用这份简历后面板卸载，原先只在依赖变化时上报忙碌，
  // 卸载不补 onBusyChange(false)，来源页一直停在「接收中」，开始诊断和更换文件一直不可点。
  // 卸载时补报不忙。刷新仍先撤销旧会话，已上传时刷新按钮仍不可点。
  // 冻结契约不放宽，仍逐字节校验。卸载清理由 verify:resume-phone-upload-ui 断言。
  // 旧哈希 6e9fdb90b7a2876583598258f6e266f00acc093ec784ad794f5b2c9239f3f3c0。
  // 2026-09-29 重新冻结（W-81）：简历来源页传入 busyWhen="received"，等人扫、还没收到文件时不报忙；
  // 手机已传上或正在确认才报忙。其它调用方不传该参数，仍按会话还在（含等人扫）报忙。卸载仍补报不忙。
  // 旧哈希 1a825bc768c4dde9329542396c19766e2a1742b1103d353fccb7af6ca140b02f。
  // 2026-10-28 重新冻结（触屏版简历三条主路）：新增三个可选属性 onCancelled / onReceivedChange / confirmRef，
  // 供简历来源页在自己的版面里画「已取消」说明、文件卡和底栏「确认使用这份文件」；
  // 不传时行为与此前逐字节同一（取消、确认、报忙、刷新先撤销旧会话、已上传时刷新不可点都不变）。
  // 冻结契约不放宽，仍逐字节校验；手机上传的既有行为由 verify:resume-phone-upload-ui 的 AST 断言继续钉住。
  // 旧哈希 9a3c4e09d4acc5c7912de7bf56ccb4ef9da6b0d8cb24fd6f39f44ee1203242bb。
  // 2026-10-28 再次重新冻结（简历三条主路返工）：confirmRef 换成 onConfirmReady。原先把确认函数在渲染期写进 ref，
  // 确认一开始父页不重渲染，页面读到的还是确认前的旧闭包，底栏仍写「确认使用这份文件」、没禁用，双击会把
  // /confirm 发两遍。现在面板在 effect 里把确认函数交给页面（有文件且不在确认中才交，确认中与卸载交 null），
  // 页面放进 state，底栏随之写「正在确认…」并禁用；面板里另加不随渲染变的在途标记，同一帧内的两次点击也只发一次。
  // 仍是可选属性，不传时行为不变。冻结契约不放宽，仍逐字节校验；既有行为由 verify:resume-phone-upload-ui 继续钉住，
  // 新行为由它新加的几条断言和 W3 的手机确认用例钉住。
  // 旧哈希 97a46d6d5dc1ef8aaafdc1ff99de267d673bb992bac1de6a7ebfa64be8453c82。
  // 2026-10-29 重新冻结（一体机手机码改短链）：出码调用换成 buildPhoneUploadQrUrl，import 同步换名；面板其余逐字未动。
  // 旧哈希 9a3c4e09d4acc5c7912de7bf56ccb4ef9da6b0d8cb24fd6f39f44ee1203242bb。
  // 2026-10-29 重新冻结（触屏版集成：并入第一包新头里 #1519 的出码调用换名）：触屏版简历三条主路（上面 10/28 两次）和 #1519
  // （一体机手机码改短链，上一条）各自改了这个文件，改动互不相交——前者加可选属性与 onConfirmReady，后者只换 import 与一处出码调用；
  // 合并后的文件就是两者之和，没有别的改动。冻结契约不放宽，仍逐字节校验。
  // 旧哈希 cc895ab96ceea8b511bbbb638c669e38dd0414cb9e8a53636258229806a3b32a（第四包终稿）、1e0e0b9256304a822d4b075394ed3aa855f47689594a391be7fa6d057a3ff56f（#1519）。
  // 2026-10-29 重新冻结（#1519 留给触屏版第四包的面板接线）：码旁说明、手机传来文件后的来源与提醒三处文案都从
  // copy/miniappLinkCopy.ts 取（phoneUploadScanHint(contact) 非空串时换掉原句「请用手机微信或浏览器扫码」，空串＝小程序未发布或读不到联系方式，
  // 保持原句；已收到文件后在文件名下加 uploadedFileSourceLine(文件来源)（读不到来源不写）与 notYourFileHint()）。联系方式用 useSupportContact()。
  // 只多两行 import、一行 hook、三行取句子、两行 JSX，二维码、轮询、取消、确认、报忙、刷新先撤销旧会话、已上传时刷新不可点都逐字未动。
  // 冻结契约不放宽，仍逐字节校验；新行为由 scripts/tests/miniapp-link-copy.test.mjs 的接线断言和 fusion-w3 / fusion-w2 的浏览器用例钉住。
  // 旧哈希 98691610ccd48ff766ff7d28256ed8814afb024ad454305f9de6345c0639db14。
  'src/pages/upload/components/UploadSessionQrPanel.tsx': '7f0cacce1e2b505548a4a141e2b63c71517c8ec5fe5d47fc827732a461f3e524',
  'src/pages/resume/aiResumeSession.ts': '5d023ee2388ecb12a3ba84a6b2b28c21e54ad65dece16eccc019f9dc43b5b164',
  'src/pages/resume/jobMaterialDraft.ts': '4a2404627c392c55cd39a6f525c522ce27cfec669f91d3b6ad5bb79f0de358ce',
  'src/pages/resume/hooks/useResumeLayout.ts': '2ef1c554e949344ce9d66430c521b986f5419db8627c4fcde1ef78d5927555e7',
  // 2026-08-17 重新冻结：删掉了路由 state 类型里的 `firstQType?: string`。
  // 该键全仓 reader 数为 0（InterviewSessionPage 只读 firstQuestion），
  // 属本批次「跨页上下文：要么消费，要么别传」清理的一部分；
  // 由 verify:kiosk-frontend-debt ② 反向钉死「不得再传 / 不得再声明」。
  // 旧哈希 f3139d5375df69db492fc9428a3b4d99cc2ab389c081b50093418f71d3d0f369。
  'src/pages/interview/session/types.ts': '76a8a9770e1132b416b74586039e07e4410fa4cf97ac2e7ad4ec1c56bf5d1374',
  // 2026-09-29 重新冻结（W-16）：语音会话在写成「正在连接」之前先完成使用声明。
  // 未同意就不发创建请求，也不把画面停在连接中。停止接口仍是 keepalive fetch。
  // 旧哈希 365da6215997c51c4f8d4a2f41ca623302431fefe2e463864c42c06c760c3a29。
  // 2026-09-30 产品负责人授权：单次通话截止及文字降级；原有身份/声明/退出门禁仍由 assistant-trtc-guard 钉住。
  // 2026-10-06 重新冻结：live 后若一直没有远端音量也没有字幕，12 秒提示、30 秒结束会话并转文字。
  // 身份、声明、停止与到点降级仍由 assistant-trtc-guard 钉住。冻结仍是逐字节校验，没有删断言。
  // 旧哈希 7f4c697aca220e1c48f3a9df2f450800d0aec72b4c391488fed62caff797d0c6。
  // 2026-10-28 重新冻结（触屏版第 5 包）：机器没有终端编号时的错误句，从「请联系现场工作人员」
  // 换成无人值守标准句 machineUnusableLine()（现场没有人可联系）。只多一行 import、一行调用、一行注释，
  // 通话逻辑零改动；下面「无人值守」那组断言钉死这个文件里不得再出现「工作人员」。冻结仍是逐字节校验，没有删断言。
  // 旧哈希 9843b115f8bec2868e4f5c961ac3a3ab9cd3f5f77b5c2cd623ec3af82a65bfe4。
  'src/hooks/useAiAdvisorCallSession.ts': '59c5d239bb209a5906111fd15e05abb3e49bd2a6c5c1402044f6b378a5607f25',
}
for (const [path, hash] of Object.entries(frozen)) check(sha256(path) === hash, `${path} remains frozen`)

const cssFiles = [
  'src/pages/resume/styles/resume-fusion-common.css',
  'src/pages/resume/styles/resume-fusion-diagnosis.css',
  'src/pages/resume/styles/resume-fusion-authoring.css',
  'src/pages/resume/styles/resume-fusion-library.css',
  'src/pages/resume/styles/resume-fusion-job-fit.css',
]
for (const path of cssFiles) check(existsSync(join(ROOT, path)), `${path} exists`)
const selectorOwners = new Map()
for (const path of cssFiles) {
  const source = read(path)
  check(!/@import\s/.test(source), `${path} does not import a peer leaf`)
  for (const selector of collectCssSelectors(source)) {
    const owners = selectorOwners.get(selector) ?? new Set()
    owners.add(path)
    selectorOwners.set(selector, owners)
  }
}
for (const [selector, owners] of selectorOwners) check(owners.size === 1, `selector has one owner: ${selector}`)
const jobFitSelectors = collectCssSelectors(read('src/pages/resume/styles/resume-fusion-job-fit.css'))
check(jobFitSelectors.every((selector) => selector.startsWith('.job-fit-inkpaper')), 'job-fit selectors are fully scoped')
const resumeEntrypoint = stripCssComments(read('src/pages/resume/resume-fusion-youth.css'))
const expectedResumeImports = [
  './styles/resume-fusion-common.css',
  './styles/resume-fusion-diagnosis.css',
  './styles/resume-fusion-authoring.css',
  './styles/resume-fusion-library.css',
]
const actualResumeImports = [...resumeEntrypoint.matchAll(/@import\s+['"]([^'"]+)['"]\s*;/g)].map((match) => match[1])
check(JSON.stringify(actualResumeImports) === JSON.stringify(expectedResumeImports), 'resume compatibility entrypoint retains exactly four ordered imports')
check(
  JSON.stringify(collectCssSelectors(resumeEntrypoint)) === JSON.stringify([
    "[data-kiosk-presentation='fusion-youth'] .fusion-w3--resume > .ui-kiosk-page-content",
    "[data-kiosk-presentation='fusion-youth'] .resume-source-direction h2",
    "[data-kiosk-presentation='fusion-youth'] .resume-source-split",
    "[data-kiosk-presentation='fusion-youth'] .resume-source-side",
  ]),
  'resume compatibility entrypoint permits only the frame and source-layout repair rules',
)
check(read('src/pages/resume/jobFit-inkpaper.css') === "@import './styles/resume-fusion-job-fit.css';\n", 'job-fit compatibility entrypoint is import-only')

for (const [path, frameClass] of [
  ['src/pages/resume/resume-fusion-youth.css', 'resume'],
  ['src/pages/interview/styles/interview-shell.css', 'interview'],
]) check(
  /(?:^|;)\s*padding:\s*0\s*;?/.test(cssRuleBody(read(path), `[data-kiosk-presentation='fusion-youth'] .fusion-w3--${frameClass} > .ui-kiosk-page-content`)),
  `${frameClass} frame neutralizes the shared content gutter`,
)

const screens = new Map([
  ['src/pages/resume/ResumeSourcePage.tsx', 'resume-source'],
  ['src/pages/resume/ResumeParsePage.tsx', 'resume-parse'],
  ['src/pages/resume/ResumeReportPage.tsx', 'resume-report'],
  ['src/pages/resume/ResumeGeneratePage.tsx', 'resume-generate'],
  ['src/pages/resume/ResumeGeneratePreviewPage.tsx', 'resume-generate-preview'],
  ['src/pages/resume/ResumeOptimizePage.tsx', 'resume-optimize'],
  ['src/pages/resume/ResumeTemplateLibraryPage.tsx', 'resume-templates'],
  ['src/pages/resume/JobMaterialLibraryPage.tsx', 'resume-materials'],
  ['src/pages/resume/JobFitPage.tsx', 'resume-job-fit'],
  ['src/pages/resume/CareerPlanPage.tsx', 'resume-career-plan'],
  ['src/pages/assistant/AssistantPage.tsx', 'assistant'],
  ['src/pages/interview/InterviewSetupPage.tsx', 'interview-setup'],
  ['src/pages/interview/InterviewSessionPage.tsx', 'interview-session'],
  ['src/pages/interview/InterviewReportPage.tsx', 'interview-report'],
  ['src/pages/interview/InterviewTipsPage.tsx', 'interview-tips'],
  ['src/pages/interview/InterviewReportsPage.tsx', 'interview-reports'],
  ['src/pages/ai-plan/AiPlanPage.tsx', 'advisor-artifact'],
])
const qxScreens = new Set([
  // 稿 21-resume-triage 同一工作台的两条 route，2026-09-23 迁入。
  'src/pages/resume/ResumeSourcePage.tsx',
  'src/pages/resume/ResumeParsePage.tsx',
  // 稿 25-material-workshop（/resume/materials），2026-09-23 迁入。
  'src/pages/resume/JobMaterialLibraryPage.tsx',
  // 稿 46-resume-decision-workspace.html 宿主的四条 route：job-fit 2026-09-22 迁入，
  // career-plan / templates 2026-09-23 迁入（actions 不在 W3 20 条清单内，下方单独断言）。
  'src/pages/resume/JobFitPage.tsx',
  'src/pages/resume/CareerPlanPage.tsx',
  'src/pages/resume/ResumeTemplateLibraryPage.tsx',
  'src/pages/resume/ResumeReportPage.tsx',
  'src/pages/resume/ResumeGeneratePage.tsx',
  'src/pages/resume/ResumeGeneratePreviewPage.tsx',
  'src/pages/resume/ResumeOptimizePage.tsx',
  'src/pages/ai-plan/AiPlanPage.tsx',
  // 稿 05-ai-cockpit（/assistant），2026-09-24 迁入。
  'src/pages/assistant/AssistantPage.tsx',
])
const touchResume = new Set([
  'src/pages/resume/ResumeSourcePage.tsx',
  'src/pages/resume/ResumeParsePage.tsx',
  'src/pages/resume/ResumeReportPage.tsx',
  'src/pages/resume/ResumeOptimizePage.tsx',
])
const touchResumeScreens = new Set([
  'src/pages/resume/JobMaterialLibraryPage.tsx',
  'src/pages/resume/JobFitPage.tsx',
  'src/pages/resume/CareerPlanPage.tsx',
  'src/pages/resume/ResumeTemplateLibraryPage.tsx',
  'src/pages/resume/ResumeGeneratePage.tsx',
  'src/pages/resume/ResumeGeneratePreviewPage.tsx',
])
for (const [path, screen] of screens) {
  const isInterview = path.includes('/interview/')
  const frame = touchResume.has(path)
    ? 'ResumeTouchPage'
    : touchResumeScreens.has(path)
      ? 'ResumeTouchFrame'
      : path.endsWith('/AssistantPage.tsx')
        ? 'PublicTouchFrame'
        : qxScreens.has(path)
          ? 'QxPageFrame'
          : isInterview
            ? 'InterviewShell'
            : 'KioskPageFrame'
  includes(path, frame, `${screen} consumes the frozen W1 frame`)
  includes(path, `data-kiosk-screen="${screen}"`, `${screen} exposes its stable landmark`)
}
includes('src/pages/interview/InterviewShell.tsx', 'QxTouchScreen', 'interview shell uses Qingxu touch screen')
includes('src/pages/interview/InterviewShell.tsx', 'QxTouchNav', 'interview shell uses shared Qingxu touch nav')
includes('src/pages/interview/InterviewWorkbenchPage.tsx', 'readInterviewWorkbenchSession', 'interview workbench rehydrates from sessionStorage')
includes('src/pages/interview/InterviewWorkbenchPage.tsx', 'replace: true', 'interview stage changes replace history')
includes('src/pages/interview/InterviewWorkbenchPage.tsx', 'parseInterviewStage', 'interview workbench parses ?stage=')
includes('src/layouts/KioskRoot.tsx', "'/interview'", 'interview workbench is registered as Qingxu-migrated')
includes('src/routes/index.tsx', '<Navigate to="/interview?stage=setup" replace />', 'legacy /interview/setup redirects with stage')
includes('src/routes/index.tsx', '<Navigate to="/interview?stage=session" replace />', 'legacy /interview/session redirects with stage')
includes('src/routes/index.tsx', '<Navigate to="/interview?stage=report" replace />', 'legacy /interview/report redirects with stage')
includes('src/routes/index.tsx', '<Navigate to="/interview?stage=tips" replace />', 'legacy /interview/tips redirects with stage')
includes('src/routes/index.tsx', '<Navigate to="/interview?stage=reports" replace />', 'legacy /interview/reports redirects with stage')

const fullscreenShell = read('src/components/kiosk-shell/KioskFullscreenShell.tsx')
check(fullscreenShell.includes('KioskStageFit'), 'fullscreen kiosk chrome uses the fixed 1080x1920 stage')
check(/viewport\s*===\s*['"]kiosk['"]/.test(fullscreenShell), 'stage-fit is limited to the kiosk viewport')
// /resume/job-fit 仍是 KioskRoot 之外的整屏路由（fusion-w6 的 expectedFullScreen 钉着 depth=2），
// 所以迁进青序流光之后舞台缩放必须自己挂 KioskStageFit —— QxPageFrame 本身不缩放，
// 少挂这一层，1080×1920 的稿在别的分辨率上会直接溢出屏幕。
includes('src/pages/resume/JobFitPage.tsx', 'KioskStageFit', 'job-fit keeps the fixed 1080x1920 stage after the Qingxu migration')
check(!read('src/pages/resume/JobFitPage.tsx').includes('KioskFullscreenShell'), 'job-fit has left the V6 fullscreen chrome')
// 宿主 46 的另外两条整屏 route 复用 JobFitPage 导出的同一个舞台（缩放判据只有一份）；
// /resume/templates 在 KioskRoot 之内，舞台由 KioskRoot 负责，页面不得再挂第二层缩放。
for (const path of ['src/pages/resume/CareerPlanPage.tsx', 'src/pages/resume/JobFitActionsPage.tsx']) {
  includes(path, '<JobFitStage>', `${path} keeps the fixed 1080x1920 host stage after the Qingxu migration`)
  includes(path, 'ResumeTouchFrame', `${path} uses the touch page frame`)
  check(!/KioskFullscreenShell|KioskPageFrame|job-fit-inkpaper|service-desk/.test(read(path)), `${path} has left the V6/LightFlow chrome`)
}
includes('src/pages/resume/JobFitActionsPage.tsx', 'data-kiosk-screen="resume-job-fit-actions"', 'resume-job-fit-actions exposes its stable landmark')
check(!/KioskPageFrame|fusion-w3--assistant/.test(read('src/pages/assistant/AssistantPage.tsx')), 'assistant has left the V6 blue page frame')
// 顾问页实际在用的样式：页面直接 import 的 css，加上它们各自 @import 的分片。按导入关系取，
// 不写死文件名 —— 2026-09-28 换成青序样式后，这条曾经还在查一份已经没人引用的旧 shell css。
const assistantDir = 'src/pages/assistant'
const assistantCss = [...read(`${assistantDir}/AssistantPage.tsx`).matchAll(/import '\.\/([\w-]+\.css)'/g)].map((m) => m[1])
const assistantActiveCss = [...new Set(assistantCss.flatMap((file) => [
  file,
  ...[...read(`${assistantDir}/${file}`).matchAll(/@import '\.\/([\w-]+\.css)'/g)].map((m) => m[1]),
]))]
check(assistantActiveCss.length > 0, 'assistant page imports its own stylesheet')
check(
  assistantActiveCss.every((file) => !read(`${assistantDir}/${file}`).includes('.ui-kiosk-page-content')),
  `assistant CSS in use (${assistantActiveCss.join(', ')}) does not patch the V6 frame gutter`,
)
includes('src/layouts/KioskRoot.tsx', "'/assistant'", 'assistant route is registered as Qingxu-migrated')
includes('src/layouts/KioskRoot.tsx', "'/resume/templates'", 'templates route is registered as Qingxu-migrated')
check(!read('src/pages/resume/ResumeTemplateLibraryPage.tsx').includes('KioskStageFit'), 'templates does not scale the stage a second time inside KioskRoot')
for (const path of ['src/pages/resume/JobFitPage.tsx', 'src/pages/resume/CareerPlanPage.tsx']) {
  check(!read(path).includes('standalone'), `${path} does not bypass the fixed stage with a standalone frame`)
}

// 触屏版把方向设置收成「诊断方向」一步。来源三列、卡片下限、可改设置在只读维度前面（稿：范围 → 两条路 → 六维只读）、路径标题不折行，按稿保留，不放宽。
// 样式在 touch/source.css（来源卡）与 touch/direction.css（诊断方向），版面在 touch/ResumeSourceWhere.tsx 与 DiagnosisDirectionForm.tsx。
const resumeSource = read('src/pages/resume/ResumeSourcePage.tsx')
const resumeSourceCss = stripCssComments(read('src/pages/resume/touch/source.css'))
const resumeDirectionCss = stripCssComments(read('src/pages/resume/touch/direction.css'))
const directionForm = read('src/pages/resume/components/DiagnosisDirectionForm.tsx')
const directionPane = directionForm.slice(directionForm.indexOf('qxt-form-focus'))
check(/(?:^|;)\s*min-height:\s*148px\s*;?/.test(cssRuleBody(resumeSourceCss, "[data-qx-page='resume-src'] .qxt-src")), 'resume source cards keep a 148px minimum')
check(!resumeSource.includes('lg:w-[348px]'), 'resume source removes the undersized 348px direction rail')
check(/grid-template-columns:\s*1fr 1fr 1fr/.test(cssRuleBody(resumeSourceCss, "[data-qx-page='resume-src'] .qxt-srcs")), 'resume source cards stay in three columns')
check(directionPane.indexOf('className="qxt-modes"') >= 0 && directionPane.indexOf('className="qxt-modes"') < directionPane.indexOf('qxt-see'), 'editable direction settings precede the read-only summary')
check(directionForm.includes('aria-label="诊断方向设置"'), 'direction settings remain accessible on the direction step')
check(/(?:^|;)\s*white-space:\s*nowrap\s*;?/.test(cssRuleBody(resumeDirectionCss, "[data-qx-page='resume-direction'] .qxt-intent b")), 'resume direction title cannot wrap character by character')
for (const route of ['/resume/source', '/resume/parse']) includes('src/layouts/KioskRoot.tsx', `'${route}'`, `${route} is registered as Qingxu-migrated`)
// 稿 25-material-workshop 迁入青序流光（2026-09-23）：此前这里钉的是「materials 不在本批」，
// 迁入后改为正向断言——登记进 QX_MIGRATED_ROUTES、舞台由 KioskRoot 缩放、旧 LightFlow 壳全部退出。
includes('src/layouts/KioskRoot.tsx', "'/resume/materials'", 'materials route (design 25) is registered as Qingxu-migrated')
check(!/KioskStageFit|KioskPageFrame|resume-lightflow/.test(read('src/pages/resume/JobMaterialLibraryPage.tsx')), 'materials has left the LightFlow frame and does not scale the stage a second time')

const interviewSetup = read('src/pages/interview/InterviewSetupPage.tsx')
includes('src/pages/interview/InterviewSetupPage.tsx', 'interview-setup__stack', 'interview setup uses the prototype vertical stack')
includes('src/pages/interview/InterviewSetupPage.tsx', 'interview-setup__interviewer', 'interview setup keeps interviewer and difficulty in one vertical card')
check(!interviewSetup.includes('interview-setup__summary'), 'interview setup removes the non-prototype summary rail')
check(!interviewSetup.includes('SummaryRow'), 'interview setup removes duplicate summary rows')
const interviewCss = read('src/pages/interview/styles/interview-shell.css')
check(/(?:^|;)\s*display:\s*flex\s*;?/.test(cssRuleBody(interviewCss, '.interview-setup__stack')), 'interview setup stack is flex')
check(/(?:^|;)\s*flex-direction:\s*column\s*;?/.test(cssRuleBody(interviewCss, '.interview-setup__stack')), 'interview setup stack is vertical')

includes('src/pages/interview/InterviewReportsPage.tsx', 'InterviewShell', 'interview reports keeps bottom navigation via InterviewShell')
check(/<nav\s+aria-label=["']\u4e3b\u5bfc\u822a["']\s+className=["']ui-kiosk-nav["']>/.test(fullscreenShell), 'fullscreen bottom navigation retains main-nav semantics')
for (const destination of ['/', '/assistant', '/profile']) {
  check(fullscreenShell.includes(`path: '${destination}'`), `fullscreen bottom navigation wires ${destination}`)
}


includes('src/pages/resume/ResumeSourcePage.tsx', 'UploadSessionQrPanel', 'resume source keeps the shared upload session')
includes('src/pages/resume/ResumeParsePage.tsx', 'submitResumeParse(', 'resume parse keeps the real AI/OCR request')
includes('src/pages/resume/ResumeReportPage.tsx', 'extractionNotice', 'resume report keeps OCR provenance')
includes('src/pages/assistant/AssistantPage.tsx', 'chatWithAssistant({', 'assistant keeps the real text request')
includes('src/pages/assistant/AssistantPage.tsx', "import('./AssistantCallPanel')", 'assistant keeps TRTC lazy loading')
includes('src/pages/interview/InterviewSessionPage.tsx', 'transcribeAnswer(', 'interview keeps real ASR review')
// 下一题请求挪到 interviewTurnActions.ts（会话页 500 行门禁）。断言仍要求真实 answerInterview，并要求会话页还走这条提交。
includes('src/pages/interview/session/interviewTurnActions.ts', 'answerInterview(', 'interview keeps question progression')
includes('src/pages/interview/InterviewSessionPage.tsx', 'submitInterviewAnswer(', 'interview page still submits answers through the extracted turn')
includes('src/pages/resume/ResumeSourcePage.tsx', 'useBusyLock(sourceBusy)', 'upload busy lock remains')
includes('src/pages/resume/ResumeSourcePage.tsx', "navigate('/resume/parse'", 'source keeps parse handoff')
includes('src/pages/resume/ResumeParsePage.tsx', 'saveAiResumeSession({ taskId: result.taskId, accessToken: result.accessToken })', 'anonymous session remains minimal')
includes('src/pages/resume/ResumeReportPage.tsx', 'getResumeRecord(taskId, { token: getToken(), accessToken })', 'report read remains credential gated')
// 提示语从「一律说走了 OCR」改成「按真实来源组织」后，warnings 仍照常转述，
// 只是不再写死成 `extractionNotice.warnings` 这一个字面表达式。
// 这里改断真实契约：①提示进得了渲染列表 ②warnings 被原样转述
// ③「经 OCR 提取」这句必须以真实 textSource 为条件——否则就是对用户谎报处理方式。
includes('src/pages/resume/ResumeReportPage.tsx', 'buildExtractionNotice(extractionNotice)', 'extraction notice reaches the notice list')
includes('src/pages/resume/ResumeReportPage.tsx', 'notice.warnings', 'extraction warnings remain transcribed')
includes('src/pages/resume/ResumeReportPage.tsx', "notice.textSource === 'image_ocr'", 'OCR claim is gated on real OCR source')
includes('src/pages/resume/ResumeGeneratePage.tsx', 'submitResumeGenerate(input, getToken())', 'generation keeps real submission')
includes('src/pages/resume/ResumeGeneratePreviewPage.tsx', 'exported?.printFileUrl', 'preview prints only a real file URL')
includes('src/pages/resume/ResumeOptimizePage.tsx', 'confirmLeave', 'optimization keeps dirty-leave protection')
includes('src/pages/resume/ResumeOptimizePage.tsx', 'useBusyLock(exporting || printNavigating || Boolean(adjusting))', 'optimization keeps busy lock')
includes('src/pages/resume/ResumeOptimizePage.tsx', 'setExported(null)', 'content/layout changes invalidate stale export')
includes('src/layouts/KioskRoot.tsx', "'/resume/optimize'", 'optimize route is registered as Qingxu-migrated')
includes('src/layouts/KioskRoot.tsx', "'/resume/optimize/compare'", 'optimize compare route is registered as Qingxu-migrated')
includes('src/layouts/KioskRoot.tsx', "'/resume/generate'", 'generate route is registered as Qingxu-migrated')
includes('src/layouts/KioskRoot.tsx', "'/resume/generate/preview'", 'generate preview route is registered as Qingxu-migrated')
includes('src/layouts/KioskRoot.tsx', "'/ai/plan'", 'advisor artifact route is registered as Qingxu-migrated')
check(!read('src/pages/ai-plan/AiPlanPage.tsx').includes('KioskPageFrame'), 'ai-plan has left the V6 frame')
check(!read('src/pages/ai-plan/AiPlanPage.tsx').includes('DEFAULT_PLAN'), 'ai-plan no longer ships a hardcoded plan')
check(!read('src/pages/ai-plan/AiPlanPage.tsx').includes('prototype-v1.css'), 'ai-plan has left prototype-v1')
includes('src/pages/assistant/AssistantSessionSummaryBar.tsx', 'navigate(`/ai/plan?', 'saving session highlights navigates to the advisor artifact page')
includes('src/pages/ai-plan/AdvisorArtifactPanels.tsx', 'data-testid="advisor-artifact-quote"', 'covered evidence is rendered as a quotation landmark')
includes('src/pages/ai-plan/AdvisorArtifactPanels.tsx', '<blockquote className="aa-quote"', 'covered evidence uses a blockquote, not an AI voice')
includes('src/pages/ai-plan/AiPlanPage.tsx', 'printAdvisorArtifact', 'artifact page prints through the existing print endpoint')
includes('src/pages/ai-plan/AdvisorTakeaway.tsx', 'data-testid="advisor-artifact-kinds"', 'empty and expired states name the three jobs')
includes('src/pages/ai-plan/AdvisorTakeaway.tsx', 'data-testid="advisor-artifact-take"', 'takeaway block keeps its test id')
includes('src/pages/ai-plan/AdvisorTakeaway.tsx', 'data-testid="advisor-artifact-print-unavailable"', 'print-unavailable warning keeps its test id')
includes('src/pages/ai-plan/AdvisorTakeaway.tsx', '正文照常可看，打印按钮先不放出来。等打印恢复后回到这里再打。', 'print-unavailable warning keeps the body and drops the on-site half sentence')
includes('src/pages/ai-plan/advisorArtifactModel.ts', '这份可以打印带走', 'content states say the page can be printed and taken')
includes('src/pages/ai-plan/advisorArtifactModel.ts', '还没有可带走的内容', 'empty and expired say nothing is ready to take')
includes('src/pages/ai-plan/advisorArtifactModel.ts', "statusLabel: '正在读取'", 'loading pill says it is reading')
includes('src/pages/ai-plan/advisorArtifactModel.ts', "statusLabel: '这次没读到'", 'error pill says this read failed')
includes('src/pages/ai-plan/AiPlanPage.tsx', "isContentState(derivedState) || derivedState === 'print-unavailable'", 'print-unavailable keeps the legend with the body')
includes('src/pages/ai-plan/AiPlanPage.tsx', '打开我的 AI 记录', 'empty state opens AI records with the design label')
includes('src/pages/ai-plan/AiPlanPage.tsx', 'data-testid="advisor-artifact-cta-redo"', 'expired state has a redo button')
includes('src/pages/ai-plan/AiPlanPage.tsx', '回去重做一次', 'expired redo uses the design label')
includes('src/pages/ai-plan/styles/advisor-artifact-qx.css', 'justify-content: space-evenly', 'body spreads leftover space as gaps')
includes('src/pages/ai-plan/styles/advisor-artifact-qx.css', 'font-size: 42px', 'hero sentence uses the 2.0 size')
check(!read('src/pages/ai-plan/AiPlanPage.tsx').includes('qx-grow'), 'artifact page no longer stretches cards with qx-grow')
for (const file of [
  'src/pages/ai-plan/AiPlanPage.tsx',
  'src/pages/ai-plan/AdvisorArtifactPanels.tsx',
  'src/pages/ai-plan/AdvisorTakeaway.tsx',
  'src/pages/ai-plan/advisorArtifactModel.ts',
  'src/pages/ai-plan/styles/advisor-artifact-qx.css',
]) {
  check(!read(file).includes('工作人员'), `${file} does not ask for on-site staff`)
  check(!read(file).includes('服务台'), `${file} does not mention a service desk`)
}
// 2026-10-28 触屏版第 5 包：问小青页的「按住说话」与语音通话的错误句都不得叫人去找现场的人（现场没有人）。
// 求助只给服务电话（标准句，读不到号码就不写）；机器没有终端编号时用标准句 3。清场遮罩那一条在 verify-scan-session-truth。
for (const file of [
  'src/pages/assistant/AssistantHoldToTalk.tsx',
  'src/pages/assistant/AssistantCallPanel.tsx',
  'src/hooks/useAiAdvisorCallSession.ts',
]) {
  check(!read(file).includes('工作人员'), `${file} does not ask for on-site staff`)
}
includes('src/hooks/useAiAdvisorCallSession.ts', 'setErrMsg(machineUnusableLine())', 'call without a terminal id uses the unattended standard line')
includes('src/pages/assistant/AssistantHoldToTalk.tsx', 'micReason(mic, helpLine)', 'hold-to-talk mic reason goes through the page copy with the visible help line')
check(
  /if \(mic === 'permission-denied'\) \{[\s\S]{0,160}?helpLine \? `\$\{base\}\$\{helpLine\}` : base/.test(read('src/pages/assistant/AssistantHoldToTalk.tsx')),
  'permission-denied reason adds only the service-phone line, and only when the number is readable',
)
check(!existsSync(join(ROOT, 'src/pages/resume/ResumeExportPage.tsx')), 'AI-07 ResumeExportPage is deleted')
includes('src/routes/index.tsx', 'path: \'resume/export\'', 'AI-07 keeps /resume/export as a compatibility route')
includes('src/routes/index.tsx', '<Navigate to="/resume/optimize" replace />', 'AI-07 /resume/export redirects to real optimize export')
includes('src/pages/resume/ResumeTemplateLibraryPage.tsx', 'getResumeTemplates()', 'templates keep real loading')
includes('src/pages/resume/JobMaterialLibraryPage.tsx', 'readJobMaterialDraft()', 'materials keep draft recovery')
includes('src/pages/resume/JobMaterialLibraryPage.tsx', 'generated.printFileUrl', 'materials print only real output')
includes('src/pages/resume/JobFitPage.tsx', 'analyzeJobFit(', 'job-fit keeps real analysis')
includes('src/pages/resume/JobFitPage.tsx', 'getLatestJobFit(', 'job-fit keeps refresh recovery')
includes('src/pages/resume/JobFitPage.tsx', 'printJobFit(', 'job-fit keeps real PDF output')
includes('src/pages/resume/CareerPlanPage.tsx', 'generateCareerPlan(', 'career plan keeps real generation')
includes('src/pages/resume/CareerPlanPage.tsx', 'printCareerPlan(', 'career plan keeps real print output')
includes('src/pages/assistant/AssistantPage.tsx', 'requestTokenRef.current', 'assistant ignores stale responses')
includes('src/pages/assistant/AssistantPage.tsx', 'sessionIdRef.current = newSessionId()', 'assistant resets shared-terminal sessions')
includes('src/pages/assistant/AssistantPage.tsx', 'safeActions', 'assistant filters returned actions')
includes('src/pages/assistant/AssistantPage.tsx', 'ASSISTANT_USER_MESSAGE_MAX_LENGTH', 'assistant retains input limit')
includes('src/pages/assistant/AssistantCallPanel.tsx', 'data-kiosk-screen="assistant-call"', 'assistant call exposes its sub-state landmark')
for (const marker of ['startCall', 'resumePlay', 'toggleMute', 'endCall', 'needResume', 'micBlocked']) includes('src/pages/assistant/AssistantCallPanel.tsx', marker, `assistant call retains ${marker}`)
// 3.5c：横幅改以共享 AI 标识开头（审计表一「模拟面试报告（一体机）」）。原断言钉的两件事都还在：
// 「只给本人复盘」由共享句逐字承担，「不会发给企业」留在页面上。
includes('src/pages/interview/InterviewReportPage.tsx', '<b>{AI_LABEL_COPY.INTERVIEW_REPORT}。</b>', 'interview report banner leads with the shared user-only AI label')
includes('../../packages/shared/src/types/complianceCopy.ts', "INTERVIEW_REPORT: 'AI 生成，仅供参考，只用于本人练习复盘'", 'interview report label keeps the user-only practice wording')
includes('src/pages/interview/InterviewReportPage.tsx', '也不会发送给任何企业。', 'interview report keeps the user-only privacy boundary')
includes('src/pages/interview/InterviewReportPage.tsx', '{COMPLIANCE_COPY.INTERVIEW_PRACTICE_RESULT_DISCLAIMER}', 'interview report renders the shared practice disclaimer')
includes('src/pages/interview/InterviewReportPage.tsx', '和目标岗位要求的对照', 'interview report uses the C9 comparison title')
check(!read('src/pages/interview/InterviewReportPage.tsx').includes('LEVEL_META'), 'interview report must not render LEVEL_META')
check(!read('src/pages/interview/InterviewReportPage.tsx').includes('岗位匹配度参考'), 'interview report must not say 岗位匹配度参考')
check(!read('src/pages/interview/InterviewReportPage.tsx').includes('练习表现等级'), 'interview report must not say 练习表现等级')
includes('src/pages/interview/InterviewSetupPage.tsx', "label: 'HR 面试'", 'setup interviewer label is HR 面试')
includes('src/pages/interview/InterviewSessionPage.tsx', "hr: 'HR 面试'", 'session interviewer label is HR 面试')
const jobGuidancePresentation = `${read('src/pages/resume/JobFitPage.tsx')}\n${read('src/pages/resume/CareerPlanPage.tsx')}\n${read('src/pages/resume/components/career-plan/CareerPlanExistingMaterials.tsx')}`
for (const forbidden of ['录用概率', '保证录用', '一键投递', '立即投递']) check(!jobGuidancePresentation.includes(forbidden), `job guidance rejects ${forbidden}`)
for (const forbidden of ['localStorage', 'sessionStorage']) check(!read('src/pages/assistant/AssistantPage.tsx').includes(forbidden), `assistant avoids ${forbidden}`)
// 其他页交来的问题（v2 草稿约定）只经 services/assistantDraft 读一次就删；顾问页自己不写存储，
// 所以它只许用收取的那个 hook，不许把用户输入交给写入函数。
check(read('src/pages/assistant/AssistantPage.tsx').includes('useAssistantDraftHandoff(setInput, ASSISTANT_USER_MESSAGE_MAX_LENGTH)'), 'assistant takes a handed-over draft through the read-once hook')
check(!read('src/pages/assistant/AssistantPage.tsx').includes('rememberAssistantDraft'), 'assistant never writes its own input to the draft key')

if (existsSync(join(ROOT, 'playwright.w3.config.ts'))) {
  const config = read('playwright.w3.config.ts')
  const spec = read('tests/visual/fusion-w3.spec.ts')
  const selfAssessmentSpec = read('tests/visual/fusion-self-assessment-flow.spec.ts')
  includes('playwright.w3.config.ts', 'testMatch: /(?:fusion-w3|fusion-self-assessment-flow|w16-ai-declaration)\\.spec\\.ts$/', 'W3 browser config collects W3, the sensitive self-assessment preview, and the W-16 declaration scenario')
  includes('playwright.w3.config.ts', "port 4183 --strictPort", 'W3 browser config owns port 4183')
  for (const env of ['VITE_API_MODE=http', 'VITE_API_BASE_URL=/api/v1', 'VITE_USE_TRTC_CALL=true', 'VITE_ALLOW_TEXT_ONLY_ASSISTANT=false', 'VITE_TERMINAL_ID=KSK-001', 'VITE_TERMINAL_AGENT_BRIDGE_TOKEN=w3-synthetic-bridge-token']) check(config.includes(env), `W3 browser build pins ${env}`)
  for (const name of ['resume upload → parse → OCR report', 'USB resume keeps its purpose and reaches AI parsing', 'resume preview recovers after replacing a failed file', 'resume parse failure remains honest', 'assistant filters actions and survives service failure', 'assistant refuses to present mock fallback as an AI answer', 'TRTC explicit gate fails back to text safely', 'interview setup → text answer → report', 'advisor artifact eight proto states fit the kiosk stage', 'advisor artifact renders covered evidence as a quotation', 'advisor artifact print-unavailable state has no print button', 'advisor artifact print waits for the server receipt', 'advisor artifact no-artifact shows the three jobs and opens AI records', 'advisor artifact expired offers only a redo', 'advisor artifact content state opens my documents']) check(spec.includes(name), `W3 browser scenario exists: ${name}`)
  check(selfAssessmentSpec.includes('自评 PDF 在隐私根内预览且不打开新标签页 @w3-kiosk'), 'W3 browser scenario exists: self-assessment PDF stays inside the privacy root')
  for (const forbidden of ['addInitScript', 'localStorage', 'sessionStorage', 'waitForTimeout']) check(!spec.includes(forbidden), `W3 browser spec avoids ${forbidden}`)
}

if (failures) process.exit(1)
console.log('ALL PASS W3 fusion contract')
