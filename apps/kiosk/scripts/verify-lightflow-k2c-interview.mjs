import assert from 'node:assert/strict'
import ts from 'typescript'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const lines = (path) => read(path).split('\n').length
const withoutComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const pages = [
  'src/pages/interview/InterviewSetupPage.tsx',
  'src/pages/interview/InterviewSessionPage.tsx',
  'src/pages/interview/InterviewReportPage.tsx',
  'src/pages/interview/InterviewTipsPage.tsx',
  'src/pages/interview/InterviewReportsPage.tsx',
]
const styleParts = [
  'src/pages/interview/styles/interview-shell.css',
  'src/pages/interview/styles/interview-session.css',
  'src/pages/interview/styles/interview-report.css',
  'src/pages/interview/styles/interview-responsive.css',
]

const failures = []
let checks = 0

function check(condition, message) {
  checks += 1
  if (!condition) failures.push(message)
}

for (const path of pages) {
  const source = read(path)
  check(source.includes('data-visual-theme="service-desk"'), `${path} 缺少 LightFlow 主题作用域`)
  check(source.includes('data-ux-density="touch"'), `${path} 缺少 touch 密度作用域`)
  check(source.includes("./interview-service-desk.css"), `${path} 未接入面试域 LightFlow 样式`)
  check(!source.includes('bg-[#f5f7fa]') && !source.includes('bg-[#f8fafc]'), `${path} 仍含旧硬编码画布色`)
}

const aggregator = 'src/pages/interview/interview-service-desk.css'
check(existsSync(resolve(root, aggregator)), '缺少面试域 CSS 聚合入口')
if (existsSync(resolve(root, aggregator))) {
  const css = read(aggregator)
  for (const part of styleParts) {
    const filename = part.split('/').at(-1)
    check(css.includes(filename), `CSS 聚合入口未导入 ${filename}`)
  }
}

for (const path of styleParts) {
  check(existsSync(resolve(root, path)), `缺少样式分片 ${path}`)
  if (!existsSync(resolve(root, path))) continue
  const css = read(path)
  check(lines(path) < 300, `${path} 超过 300 行`)
  check(css.includes('--sd-'), `${path} 未复用 service-desk token`)
}

const responsivePath = styleParts.at(-1)
if (existsSync(resolve(root, responsivePath))) {
  const css = read(responsivePath)
  check(css.includes('1080px'), '缺少 1080 宽屏布局合同')
  check(css.includes('390px'), '缺少 390 宽移动布局合同')
  check(css.includes('700px') || css.includes('max-height'), '缺少 390×700 短屏合同')
  check(css.includes('prefers-reduced-motion'), '缺少 reduced-motion 合同')
}

const session = read('src/pages/interview/InterviewSessionPage.tsx')
for (const path of [
  'src/pages/interview/session/types.ts',
  'src/pages/interview/session/InterviewSessionPanels.tsx',
  'src/pages/interview/session/InterviewAnswerDock.tsx',
]) {
  check(existsSync(resolve(root, path)), `缺少会话展示拆分 ${path}`)
  if (existsSync(resolve(root, path))) check(lines(path) < 300, `${path} 超过 300 行`)
}
check(lines('src/pages/interview/InterviewSessionPage.tsx') < 500, 'InterviewSessionPage.tsx 仍超过 500 行')
check(session.includes('InterviewSessionPanels'), '会话页未使用 InterviewSessionPanels')
check(session.includes('InterviewAnswerDock'), '会话页未使用 InterviewAnswerDock')

const setup = read(pages[0])
// W-107 同类：执行设置页真实状态与开始函数，预选或漏校验必须变红。
const setupAst = ts.createSourceFile('InterviewSetupPage.tsx', setup, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function sourceNode(ast, name) {
  let found
  function visit(node) {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(ast) === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, `找不到真实源码节点 ${name}`)
  return ts.isVariableDeclaration(found) ? found.initializer.getText(ast) : found.getText(ast)
}
const executable = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
try {
  const initial = new Function('useState', 'setupDraft', 'DEFAULT_EMPLOYMENT_INDUSTRY', executable(`return [
    ${sourceNode(setupAst, '[industry, setIndustry]')},
    ${sourceNode(setupAst, '[experience, setExperience]')},
    ${sourceNode(setupAst, '[position, setPosition]')},
  ].map(([value]) => value);`))
  assert.deepEqual(initial((value) => [value], undefined, '信息传输、软件和信息技术服务业'), ['', '', ''], '行业、经验、岗位均不预选')
  const sessionSource = read('src/pages/interview/interviewWorkbenchSession.ts')
  const sessionAst = ts.createSourceFile('interviewWorkbenchSession.ts', sessionSource, ts.ScriptTarget.Latest, true)
  const parseDraft = new Function(executable(`${sourceNode(sessionAst, 'isRecord')}
    ${sourceNode(sessionAst, 'parseSetupDraft')}
    return parseSetupDraft;`))()
  const draft = { interviewerType: 'hr', industry: '制造业', position: '机械工程师', experience: 'y3_5', difficulty: 'standard', duration: 5 }
  const legacy = parseDraft(draft)
  assert.equal(legacy.industry, '', '旧草稿不能恢复无法证明由本人选择的行业')
  assert.equal(legacy.experience, '', '旧草稿不能恢复无法证明由本人选择的经验')
  const selected = parseDraft({ ...draft, directionSelectionVersion: 1 })
  assert.deepEqual(initial((value) => [value], selected), ['制造业', 'y3_5', '机械工程师'], '本人选项返回后保留')
  assert.equal(parseDraft({ ...draft, directionSelectionVersion: 1, experience: '' }).experience, '', '空经验草稿不会回填应届')
  assert.equal(parseDraft({ ...draft, directionSelectionVersion: 1, experience: 'unknown' }).experience, '', '非法经验不能代本人提交')
  assert.ok(setup.includes('directionSelectionVersion: 1'), '持久化本人选项版本')
  const clearIndustry = setup.match(/onClear=\{([^\n]+)\}/)?.[1]
  let clearedIndustry
  new Function('setIndustry', 'DEFAULT_EMPLOYMENT_INDUSTRY', executable(`return (${clearIndustry})();`))((value) => { clearedIndustry = value }, '信息传输、软件和信息技术服务业')
  assert.equal(clearedIndustry, '', '清空行业不能回填 IT')
  assert.ok(setup.includes("{industry || '尚未选择'}"), '未选行业如实显示')
  assert.ok(setup.includes('请本人填写目标岗位、选择行业和经验后再开始'), '必须选的方向在开始前说明')
  const start = new Function('context', executable(`const {
    position, industry, experience, interviewerType, difficulty, duration, resumeFile,
    setError, setCreating, setAiOutage, setStartFailed, getToken, createInterview,
    setPendingSession, startInterview, setProbed, patchInterviewWorkbenchSession, onGoStage,
  } = context; return ${sourceNode(setupAst, 'handleStart')};`))
  const noop = () => {}
  async function runStart(values) {
    const requests = []
    const errors = []
    const context = {
      ...draft, duration: 5, resumeFile: null,
      setError: (value) => errors.push(value), setCreating: noop, setAiOutage: noop,
      setStartFailed: noop, getToken: noop, setPendingSession: noop, setProbed: noop,
      patchInterviewWorkbenchSession: noop, onGoStage: noop,
      createInterview: async (input) => { requests.push(input); return { sessionId: 'real-handle', questionTarget: 6 } },
      startInterview: async () => { requests.push('start'); return { question: '问题' } },
      ...values,
    }
    await start(context)()
    return { requests, errors }
  }
  for (const [values, expected] of [
    [{ position: '', industry: '', experience: '' }, '目标岗位'],
    [{ industry: '' }, '行业'],
    [{ industry: '   ' }, '行业'],
    [{ experience: '' }, '经验'],
  ]) {
    const result = await runStart(values)
    assert.deepEqual(result.requests, [], `缺少${expected}不能创建或开始`)
    assert.ok(result.errors.at(-1)?.includes(expected), `缺少${expected}提示本人填写或选择`)
  }
  const result = await runStart({ position: '  机械工程师  ' })
  assert.deepEqual(result.requests, [{ interviewerType: 'hr', industry: '制造业', position: '机械工程师', experience: 'y3_5', difficulty: 'standard', durationMin: 5 }, 'start'], '本人选项原样创建后再开始')
  check(true, '模拟面试不预选与本人选择校验')
} catch (error) {
  check(false, `模拟面试不预选与本人选择校验：${error.message}`)
}
check(setup.indexOf('createInterview(') < setup.indexOf('startInterview('), '创建与启动面试顺序被改变')
for (const token of [
  'kioskUploadFile',
  'useBusyLock(creating || uploading || printingSheet || qrBusy || usbBusy)',
  'UploadSessionQrPanel',
  'ResumeUsbImportPanel',
  "purpose=\"resume_upload\"",
  'durationMin: duration',
  'interviewerType,',
  'position: pos',
  'accessToken: created.accessToken',
  'questionTarget: created.questionTarget',
  'firstQuestion: first.question',
  // 这里曾要求 `firstQType: first.qType`。该键在 kiosk 侧零消费点：
  // InterviewSessionPage 只读 state.firstQuestion，`firstQType` 全仓无 reader。
  // 「传了没人消费」正是 verify:kiosk-frontend-debt ② 要清的形态，
  // 由那条门禁反向钉死「不得再传」，本合同不再要求它存在。
  'className="flex h-12 w-12',
]) {
  check(setup.includes(token), `${pages[0]} — Setup 真实链路合同缺失：${token}`)
}

for (const token of [
  'answerInterview(',
  'endInterview(',
  'startWavRecorder(',
  'transcribeAnswer(',
  'fallbackToText(',
  'resetVoiceState(',
  'recorderRef.current?.cancel()',
  'clearInterval(recordTimerRef.current)',
  'stopPlayback()',
  'answerInterview(\n        state.sessionId,',
  'const report = await endInterview(state.sessionId, access, {',
  'accessToken: state.accessToken, report',
]) {
  check(session.includes(token), `${pages[1]} — Session 状态/清场合同缺失：${token}`)
}
check(
  /useEffect\(\(\) => \(\) => \{[\s\S]*?recorderRef\.current\?\.cancel\(\)[\s\S]*?clearInterval\(recordTimerRef\.current\)[\s\S]*?stopPlayback\(\)/.test(session),
  'Session 卸载时的录音、计时器和播放清场合同缺失',
)

const report = read(pages[2])
for (const token of ['printInterviewReport(', 'accessToken: state.accessToken', 'file.printFileUrl', 'fileUrl: file.printFileUrl', "throw new Error('打印链接未就绪，请稍后重试')", 'startPrint({', "origin: 'interview_report'"]) {
  check(report.includes(token), `${pages[2]} — Report 打印合同缺失：${token}`)
}
check(
  report.includes('{COMPLIANCE_COPY.INTERVIEW_PRACTICE_RESULT_DISCLAIMER}'),
  '面试报告页必须固定渲染共享免责说明',
)
check(report.includes('和目标岗位要求的对照'), '面试报告缺少「和目标岗位要求的对照」')
check(!report.includes('LEVEL_META'), '面试报告不得渲染等级徽章')
check(!report.includes('level.label'), '面试报告不得显示等级文案')
check(!report.includes('岗位匹配度参考'), '面试报告不得写岗位匹配度参考')
check(!report.includes('练习表现等级'), '面试报告不得写练习表现等级')
check(!report.includes('HR 初筛'), '面试报告不得写 HR 初筛')
check(setup.includes("label: 'HR 面试'"), '设置页面试官应为 HR 面试')
check(session.includes("hr: 'HR 面试'"), '会话页面试官应为 HR 面试')
check(!setup.includes('HR 初筛') && !session.includes('HR 初筛'), '设置页或会话页仍写 HR 初筛')
const sharedCopy = read('../../packages/shared/src/types/complianceCopy.ts')
check(
  sharedCopy.includes("'模拟练习结果，仅供练习参考，不代表任何用人单位的评价或录用意见。'"),
  '共享免责说明句子不一致',
)

const reports = read(pages[4])
for (const token of ['getMyInterviews(', 'deleteMyInterview(', '!isLoggedIn', "'loading' | 'error' | 'ready'", 'confirmId !== sessionId']) {
  check(reports.includes(token), `${pages[4]} — Reports 真实记录合同缺失：${token}`)
}

const tips = read(pages[3])
const tipsRuntime = withoutComments(tips)
check(tips.includes("navigate('/interview/setup')"), 'Tips 缺少真实面试入口')
check(!tipsRuntime.includes('window.print') && !tipsRuntime.includes('打印准备清单'), 'Tips 不得新增未接线打印能力')

const allPages = withoutComments(pages.map(read).join('\n'))
for (const forbidden of ['一键投递', '立即投递', '平台投递', '录用概率', '保证录用']) {
  check(!allPages.includes(forbidden), `出现禁止或误导文案：${forbidden}`)
}
check(allPages.includes('不代表任何招聘结果承诺'), '缺少招聘结果合规边界')
// 面试路由为顶级全屏：视口高度由 KioskFullscreenShell（h-screen）锁定；
// .interview-flow 在壳内 flex 填满，不再自设 100vh（避免与共享顶栏叠出双滚动）。
const fullscreenShell = read('src/components/kiosk-shell/KioskFullscreenShell.tsx')
const interviewShell = read('src/pages/interview/InterviewShell.tsx')
const interviewShellCss = read('src/pages/interview/styles/interview-shell.css')
check(
  fullscreenShell.includes('h-screen') || fullscreenShell.includes('100vh') || fullscreenShell.includes('100dvh'),
  'KioskFullscreenShell 未锁定完整视口高度',
)
check(interviewShell.includes('QxPageFrame'), 'InterviewShell 未接入青序流光页壳')
check(interviewShell.includes('QxAppNavbar'), 'InterviewShell 未接入共享底栏')
check(read('src/pages/interview/InterviewWorkbenchPage.tsx').includes('readInterviewWorkbenchSession'), '工作台未从 sessionStorage 复水')
check(read('src/pages/interview/InterviewWorkbenchPage.tsx').includes('replace: true'), '阶段切换必须 replace 历史')
check(read('src/pages/interview/InterviewWorkbenchPage.tsx').includes('parseInterviewStage'), '工作台必须解析 ?stage=')
check(
  /\.interview-flow\s*\{[\s\S]*?(?:height:\s*100%|flex:\s*1)/.test(interviewShellCss),
  '顶级面试页未在全屏壳内填满可用高度',
)
check(interviewShellCss.includes('var(--sd-control-min, 48px)'), '普通触控目标未绑定 48px token')
check(interviewShellCss.includes('var(--sd-primary-control-min, 56px)'), '主操作未绑定 56px token')
check(read('src/pages/interview/session/InterviewSessionPanels.tsx').includes('role="log" aria-live="polite"'), '对话新增内容缺少读屏播报合同')
check(!read('src/pages/interview/styles/interview-responsive.css').includes('.interview-session__privacy-note { display: none; }'), '短屏不得隐藏全部会话隐私说明')

const packageJson = read('package.json')
const ci = read('../../.github/workflows/ci.yml')
check(packageJson.includes('"verify:lightflow-k2c-interview"'), 'Kiosk package.json 未注册 K2c 门禁')
check(ci.includes('pnpm --filter @ai-job-print/kiosk verify:lightflow-k2c-interview'), 'CI 未注册 K2c LightFlow 门禁')

const modelTest = spawnSync(process.execPath, ['--test', resolve(root, 'scripts/tests/interview-workbench-model.test.mjs')], { encoding: 'utf8' })
check(modelTest.status === 0, `interview workbench model unit test failed: ${modelTest.stderr || modelTest.stdout}`)

if (failures.length > 0) {
  // 先逐条打印失败断言，再打汇总：CI 日志被 tail 截断时，
  // 留下来的必须是「哪一条挂了」，而不是只剩一个 N/M 数字。
  for (const failure of failures) console.error(`FAIL - ${failure}`)
  console.error(`FAIL lightflow K2c interview contract: ${failures.length}/${checks}`)
  process.exit(1)
}

console.log(`PASS lightflow K2c interview contract: ${checks} checks`)
