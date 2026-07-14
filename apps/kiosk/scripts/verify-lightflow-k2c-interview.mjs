import { existsSync, readFileSync } from 'node:fs'
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
check(setup.indexOf('createInterview(') < setup.indexOf('startInterview('), '创建与启动面试顺序被改变')
for (const token of [
  'kioskUploadFile',
  'useBusyLock(creating || uploading)',
  'durationMin: duration',
  'interviewerType,',
  'position: pos',
  'accessToken: created.accessToken',
  'questionTarget: created.questionTarget',
  'firstQuestion: first.question',
  'firstQType: first.qType',
  'className="flex h-12 w-12',
]) {
  check(setup.includes(token), `Setup 真实链路合同缺失：${token}`)
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
  'const report = await endInterview(state.sessionId, access)',
  'accessToken: state.accessToken, report',
]) {
  check(session.includes(token), `Session 状态/清场合同缺失：${token}`)
}
check(
  /useEffect\(\(\) => \(\) => \{[\s\S]*?recorderRef\.current\?\.cancel\(\)[\s\S]*?clearInterval\(recordTimerRef\.current\)[\s\S]*?stopPlayback\(\)/.test(session),
  'Session 卸载时的录音、计时器和播放清场合同缺失',
)

const report = read(pages[2])
for (const token of ['printInterviewReport(', 'accessToken: state.accessToken', 'file.printFileUrl', 'fileUrl: file.printFileUrl', "throw new Error('打印链接未就绪，请稍后重试')", "navigate('/print/confirm'", "makePrintParams({ copies: 1, duplex: 'single', color: 'bw' })"]) {
  check(report.includes(token), `Report 打印合同缺失：${token}`)
}

const reports = read(pages[4])
for (const token of ['getMyInterviews(', 'deleteMyInterview(', '!isLoggedIn', "'loading' | 'error' | 'ready'", 'confirmId !== sessionId']) {
  check(reports.includes(token), `Reports 真实记录合同缺失：${token}`)
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
check(read('src/pages/interview/styles/interview-shell.css').includes('height: 100vh'), '顶级面试页未锁定完整视口高度')
check(read('src/pages/interview/styles/interview-shell.css').includes('var(--sd-control-min, 48px)'), '普通触控目标未绑定 48px token')
check(read('src/pages/interview/styles/interview-shell.css').includes('var(--sd-primary-control-min, 56px)'), '主操作未绑定 56px token')
check(read('src/pages/interview/session/InterviewSessionPanels.tsx').includes('role="log" aria-live="polite"'), '对话新增内容缺少读屏播报合同')
check(!read('src/pages/interview/styles/interview-responsive.css').includes('.interview-session__privacy-note { display: none; }'), '短屏不得隐藏全部会话隐私说明')

const packageJson = read('package.json')
const ci = read('../../.github/workflows/ci.yml')
check(packageJson.includes('"verify:lightflow-k2c-interview"'), 'Kiosk package.json 未注册 K2c 门禁')
check(ci.includes('pnpm --filter @ai-job-print/kiosk verify:lightflow-k2c-interview'), 'CI 未注册 K2c LightFlow 门禁')

if (failures.length > 0) {
  console.error(`FAIL lightflow K2c interview contract: ${failures.length}/${checks}`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`PASS lightflow K2c interview contract: ${checks} checks`)
