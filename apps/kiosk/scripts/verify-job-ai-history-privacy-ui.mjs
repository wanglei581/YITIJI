import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url))
let failed = 0

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function readWorkspace(relativePath) {
  return readFileSync(join(workspaceRoot, relativePath), 'utf8')
}

function mustExist(relativePath, label) {
  const path = join(root, relativePath)
  if (!existsSync(path)) {
    fail(`${label} missing: ${relativePath}`)
    return ''
  }
  pass(label)
  return read(relativePath)
}

function mustContain(source, markers, label) {
  const missing = markers.filter((marker) => !source.includes(marker))
  if (missing.length > 0) fail(`${label} missing: ${missing.join(' | ')}`)
  else pass(label)
}

function mustNotContain(source, patterns, label) {
  const found = patterns.filter(({ pattern }) => pattern.test(source)).map(({ label: item }) => item)
  if (found.length > 0) fail(`${label} contains forbidden: ${found.join(' | ')}`)
  else pass(label)
}

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  failed += 1
  console.error(`  FAIL ${message}`)
}

console.log('\n=== Kiosk 岗位 AI 历史回看 / 隐私授权门禁 ===')

const sharedAi = readWorkspace('packages/shared/src/types/ai.ts')
const jobAiService = mustExist('src/services/api/jobAi.ts', 'Job AI Kiosk service 存在')
const jobAiHttp = mustExist('src/services/api/jobAiHttpAdapter.ts', 'Job AI HTTP adapter 存在')
const recordsPage = mustExist('src/pages/profile/me/MyAiRecordsPage.tsx', 'AI 服务记录页存在')
const jobAiSessionRecords = mustExist('src/pages/profile/me/JobAiSessionRecords.tsx', '岗位 AI 历史组件存在')
const settingsPage = mustExist('src/pages/profile/me/MySettingsPage.tsx', '账号设置页存在')
const packageJson = read('package.json')
const ci = readWorkspace('.github/workflows/ci.yml')

mustContain(
  sharedAi,
  [
    'JobAiSessionListItem',
    'session: JobAiSessionDTO',
    'recommendationCount: number',
  ],
  'shared 暴露岗位 AI 会话列表契约',
)

mustContain(
  jobAiService,
  [
    'listMyJobAiSessions',
    'deleteMyJobAiSession',
    'revokeJobAiConsent',
    'EMPTY_JOB_AI_SESSION_PAGE',
    'JOB_AI_MOCK_DISABLED',
  ],
  'Job AI service 暴露历史会话和授权撤回接口，并禁用 mock 假结果',
)

mustContain(
  jobAiHttp,
  [
    'listMyJobAiSessions',
    'deleteMyJobAiSession',
    'revokeJobAiConsent',
    '/me/job-ai-sessions',
    '/me/ai-consents/${encodeURIComponent(scope)}/revoke',
    "method: 'DELETE'",
    'Authorization',
    'Bearer',
    'x-terminal-id',
  ],
  'Job AI HTTP adapter 使用真实本人会话 / 撤权端点和 header 凭证',
)

mustContain(
  `${recordsPage}\n${jobAiSessionRecords}`,
  [
    'listMyJobAiSessions',
    'deleteMyJobAiSession',
    '岗位 AI 参考记录',
    'recommendationCount',
    '仅展示岗位 AI 会话元数据',
    '不展示简历原文',
    '分析结果仅供参考',
  ],
  'AI 服务记录页展示岗位 AI 历史回看且只展示元数据',
)

mustContain(
  settingsPage,
  [
    'getJobAiConsentStatus',
    'revokeJobAiConsent',
    '隐私与 AI 授权管理',
    '岗位 AI 辅助',
    '已授权',
    '未授权',
    '撤回授权',
    '确认撤回',
  ],
  '账号设置页提供岗位 AI 授权状态与撤回入口',
)

mustContain(packageJson, ['"verify:job-ai-history-privacy-ui"'], 'package.json 注册 verify:job-ai-history-privacy-ui')
mustContain(ci, ['verify:job-ai-history-privacy-ui'], 'CI 接入岗位 AI 历史 / 隐私 UI 门禁')

mustNotContain(
  [jobAiService, jobAiHttp, recordsPage, jobAiSessionRecords, settingsPage].join('\n'),
  [
    { label: '一键投递', pattern: /一键投递/ },
    { label: '立即投递', pattern: /立即投递/ },
    { label: '投递成功', pattern: /投递成功/ },
    { label: '帮你投递', pattern: /帮你投递/ },
    { label: '录用概率', pattern: /录用概率/ },
    { label: '通过率', pattern: /通过率/ },
    { label: '匹配百分比', pattern: /匹配度\s*\d|\d+(?:\.\d+)?\s*%/ },
    { label: '候选人筛选', pattern: /候选人筛选/ },
    { label: '面试邀约', pattern: /面试邀约/ },
    { label: 'Offer', pattern: /Offer/i },
    { label: 'token query', pattern: /[?&](?:accessToken|token)=/ },
  ],
  '岗位 AI 历史 / 隐私 UI 不出现招聘闭环、概率化评分或 token query',
)

if (failed > 0) {
  console.error(`\n❌ ${failed} 项失败 — Kiosk 岗位 AI 历史 / 隐私闭环未完成\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — Kiosk 岗位 AI 历史 / 隐私闭环门禁一致\n')
