import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url))
let failed = 0

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
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

console.log('\n=== Kiosk 岗位 AI 授权 / 推荐 / 解读 UI 门禁 ===')

const jobAiService = mustExist('src/services/api/jobAi.ts', 'Job AI Kiosk service 已创建')
const jobAiHttp = mustExist('src/services/api/jobAiHttpAdapter.ts', 'Job AI HTTP adapter 已创建')
const consentModal = mustExist('src/pages/jobs/components/JobAiConsentModal.tsx', 'Job AI 授权确认弹窗已创建')
const resumeModal = mustExist('src/pages/jobs/components/ResumeSelectModal.tsx', 'Job AI 简历选择弹窗已创建')
const resultPanel = mustExist('src/pages/jobs/components/JobAiResultPanel.tsx', 'Job AI 结果面板已创建')
const jobsPage = read('src/pages/jobs/JobsPage.tsx')
const detailPage = read('src/pages/jobs/JobDetailPage.tsx')
const detailSections = read('src/pages/jobs/components/JobDetailSections.tsx')
const index = read('src/services/api/index.ts')
const packageJson = read('package.json')
const ci = readFileSync(join(workspaceRoot, '.github/workflows/ci.yml'), 'utf8')

mustContain(
  jobAiService,
  [
    'JobAiServiceInterface',
    'getJobAiConsentStatus',
    'grantJobAiConsent',
    'getJobAiRecommendations',
    'explainJobWithAi',
    'matchJobWithAi',
    'JOB_AI_MOCK_DISABLED',
  ],
  'Job AI service 暴露真实接口并禁用 mock 假结果',
)

mustContain(
  jobAiHttp,
  [
    'Authorization',
    'Bearer',
    'x-terminal-id',
    '/me/ai-consents/status',
    '/me/ai-consents',
    '/jobs/ai/recommendations',
    '/jobs/${encodeURIComponent(jobId)}/ai/explain',
    '/jobs/${encodeURIComponent(jobId)}/ai/match',
    'ApiHttpError',
  ],
  'Job AI HTTP adapter 使用 header 凭证和真实后端端点',
)

mustContain(
  consentModal,
  [
    'JobAiConsentModal',
    '仅供求职参考',
    '绝不向企业共享或推荐您的简历',
    '同意并继续',
    '取消',
  ],
  '授权确认弹窗包含隐私与合规承诺',
)

mustContain(
  resumeModal,
  [
    'ResumeSelectModal',
    'getMyResumes',
    "item.kind === 'parse'",
    "item.status === 'completed'",
    '去上传简历',
  ],
  '简历选择弹窗只允许选择已完成解析简历',
)

mustContain(
  resultPanel,
  [
    'JobAiResultPanel',
    '仅供参考',
    '不代表录用结果',
    'matchPoints',
    'gapPoints',
    'actionChecklist',
    'preparationTips',
    '退出 AI 推荐',
  ],
  '结果面板展示参考建议并带免责声明',
)

mustContain(
  jobsPage,
  [
    'AI岗位推荐',
    'getJobAiRecommendations',
    'JobAiConsentModal',
    'ResumeSelectModal',
    'JOB_AI_QUOTA_EXCEEDED',
  ],
  'JobsPage 接入 AI 推荐、授权、简历选择和配额错误态',
)

mustContain(
  `${detailPage}\n${detailSections}`,
  [
    'AI岗位解读',
    '岗位匹配参考',
    'explainJobWithAi',
    'matchJobWithAi',
    'JobAiResultPanel',
    'JobAiConsentModal',
    'ResumeSelectModal',
    'JOB_AI_QUOTA_EXCEEDED',
  ],
  'JobDetailPage 接入 AI 解读 / 匹配参考闭环',
)

mustContain(index, ["export * from './jobAi'"], 'services/api/index 导出 Job AI service')
mustContain(packageJson, ['"verify:job-ai-ui"'], 'package.json 注册 verify:job-ai-ui')
mustContain(ci, ['verify:job-ai-ui'], 'CI 接入 Kiosk Job AI UI 门禁')

mustNotContain(
  [jobAiService, jobAiHttp, consentModal, resumeModal, resultPanel, jobsPage, detailPage, detailSections].join('\n'),
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
  '岗位 AI UI 不出现招聘闭环、概率化评分或 token query',
)

if (failed > 0) {
  console.error(`\n❌ ${failed} 项失败 — Kiosk 岗位 AI UI 未形成商用闭环\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — Kiosk 岗位 AI UI 授权 / 推荐 / 解读门禁一致\n')
