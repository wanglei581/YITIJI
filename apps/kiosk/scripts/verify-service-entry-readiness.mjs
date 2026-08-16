import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

let failures = 0
function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`)
  else {
    failures += 1
    console.error(`  FAIL ${message}`)
  }
}

console.log('\n=== Kiosk 入口服务真实性守卫 ===')

const readinessHook = read('src/hooks/useApiReadiness.ts')
for (const marker of [
  "'checking' | 'ready' | 'unavailable'",
  'AbortController',
  "cache: 'no-store'",
  '/health',
  'READINESS_TIMEOUT_MS',
]) {
  check(readinessHook.includes(marker), `在线服务探测保留 ${marker}`)
}

const readinessStrip = read('src/components/ServiceReadinessStrip.tsx')
for (const copy of ['正在确认在线服务', '在线服务已连接', '在线服务暂不可用', '重新检测']) {
  check(readinessStrip.includes(copy), `状态条包含「${copy}」`)
}
check(!/AI.*已连接/.test(readinessStrip), '健康检查不扩大声明为 AI 能力已连接')

const hubs = [
  'src/pages/resume/ResumeServiceHubPage.tsx',
  'src/pages/jobs/JobsServiceHubPage.tsx',
  'src/pages/job-fairs/FairsServiceHubPage.tsx',
  'src/pages/interview/InterviewServiceHubPage.tsx',
  'src/pages/policy/PolicyServiceHubPage.tsx',
]
for (const hub of hubs) {
  const source = read(hub)
  check(source.includes('useApiReadiness'), `${hub} 使用入口级在线服务探测`)
  check(source.includes('ServiceReadinessStrip'), `${hub} 展示真实检查状态`)
  check(source.includes("apiStatus !== 'ready'"), `${hub} 检查中和不可用均 fail-closed`)
  check(/disabled=\{(?:apiBlocked|blocked)\}/.test(source), `${hub} 在线工作流有 disabled 门禁`)
}

const jobsHub = read('src/pages/jobs/JobsServiceHubPage.tsx')
const interviewHub = read('src/pages/interview/InterviewServiceHubPage.tsx')
const policyHub = read('src/pages/policy/PolicyServiceHubPage.tsx')
check(
  /key: 'online-platforms'[\s\S]*?requiresApi: false/.test(jobsHub),
  '线上招聘平台保留离线二维码入口'
)
check(/key: 'tips'[\s\S]*?requiresApi: false/.test(interviewHub), '面试技巧保留离线阅读入口')
for (const key of ['social-insurance', 'archive']) {
  check(
    new RegExp(`key: '${key}'[\\s\\S]*?requiresApi: false`).test(policyHub),
    `${key} 保留离线指引入口`
  )
}

const printScanHome = read('src/pages/print-scan/PrintScanHomePage.tsx')
check(printScanHome.includes('loadConfiguredCapabilities'), '打印扫描首页保留能力加载状态')
check(!printScanHome.includes('getConfiguredCapabilities'), '打印扫描首页不再吞掉能力加载失败')
// P39 迁移（V6 纵切第一刀）把「能力是否已确认」从行内三元收成
// toProbeStatus() + confirmed 两步，断言随结构改写，**不变量一字未变**：
// 只有探测结果不是 error 才判定为已确认，其余一律 fail-closed。
check(
  /function toProbeStatus[\s\S]*?load\.status === 'error' \? 'error' : 'ok'/.test(printScanHome),
  '能力探测失败一律判为未确认（不得把 error 当成可放行）'
)
check(
  /const confirmed = probe === 'ok'/.test(printScanHome),
  '只有能力配置读取成功才放行任务入口'
)
check(/available: false,[\s\S]*?to: ''/.test(printScanHome), '能力未确认时正式任务入口 fail-closed')
for (const forbidden of ['AI 就绪', '自动双面打印', '一次最多 50 页', '固定输出 PDF']) {
  check(!printScanHome.includes(forbidden), `打印扫描首页不再显示未证明断言「${forbidden}」`)
}

const capabilityApi = read('src/services/api/printScanCapabilities.ts')
for (const marker of ['AbortController', "cache: 'no-store'", 'CAPABILITY_TIMEOUT_MS']) {
  check(capabilityApi.includes(marker), `能力配置请求保留 ${marker}`)
}

const home = read('src/pages/home/HomePage.tsx')
check(home.includes('useTerminalDeviceStatus'), '首页本机卡使用真实打印机状态')
for (const forbidden of ['文档打印就绪', '材料扫描就绪', '自动双面可用']) {
  check(!home.includes(forbidden), `首页不再硬编码「${forbidden}」`)
}

const upload = read('src/pages/print/PrintUploadPage.tsx')
check(!upload.includes('生产 Kiosk 将切换为 Agent 文件中转'), '打印上传页不显示内部实现横幅')
check(!upload.includes('import { API_MODE }'), '打印上传页移除仅供开发横幅使用的 API_MODE import')

console.log('')
if (failures > 0) {
  console.error(`=== FAILED: ${failures} assertion(s) ===\n`)
  process.exit(1)
}
console.log('=== ALL PASS ===\n')
