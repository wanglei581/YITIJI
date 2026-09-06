import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const routes = [
  {
    name: 'jobs',
    file: '../src/routes/jobs/index.tsx',
    key: "const PARTNER_JOBS_REFRESH_KEY = 'partner:jobs'",
    hint: 'FRONTEND_HINT.jobs',
  },
  {
    name: 'fairs',
    file: '../src/routes/fairs/index.tsx',
    key: "const PARTNER_FAIRS_REFRESH_KEY = 'partner:fairs'",
    hint: 'FRONTEND_HINT.fairs',
  },
  {
    name: 'policy',
    file: '../src/routes/policy/index.tsx',
    key: "const PARTNER_POLICIES_REFRESH_KEY = 'partner:policies'",
    hint: 'FRONTEND_HINT.policy',
  },
]

const requiredTokens = [
  "from '@ai-job-print/refresh'",
  'useRefreshable(',
  'useInteractionLock(',
  'replaceIfChanged',
  'intervalMs: 60_000',
  "failPolicy: 'keep-last'",
  'pageSize: PAGE_SIZE',
  'ListPagination',
]

const forbiddenTokens = [
  'const load = useCallback',
  'useEffect(() => { load() }',
  'setJobs(',
  'setFairs(',
  'setRows(',
]

let failed = false

for (const route of routes) {
  const filePath = fileURLToPath(new URL(route.file, import.meta.url))
  const text = readFileSync(filePath, 'utf8')
  const missing = [route.key, route.hint, ...requiredTokens].filter((token) => !text.includes(token))
  for (const token of missing) {
    console.error(`${route.name} refresh integration missing token: ${token}`)
    failed = true
  }
  for (const token of forbiddenTokens) {
    if (text.includes(token)) {
      console.error(`${route.name} refresh integration must not use legacy state token: ${token}`)
      failed = true
    }
  }
}

const pageFile = fileURLToPath(new URL('../src/routes/Page.tsx', import.meta.url))
const pageText = readFileSync(pageFile, 'utf8')
for (const token of [
  "jobs: '对应一体机「岗位信息」/ 小程序「求职」'",
  "fairs: '对应一体机「招聘会信息」'",
  "policy: '对应一体机「政策服务」'",
  "smartCampus: '对应 Kiosk 首页「智慧校园」'",
  "profile: '对应一体机「找企业」与岗位详情来源机构'",
  "companies: '对应一体机「找企业」与岗位详情来源机构'",
  "none: '不直接对应前端页面'",
  'export function withFrontendHint',
  'export function ListPagination',
]) {
  if (!pageText.includes(token)) {
    console.error(`Page subtitle map missing token: ${token}`)
    failed = true
  }
}

const subtitlePages = [
  { name: 'smart-campus', file: '../src/routes/smart-campus/index.tsx', hint: 'FRONTEND_HINT.smartCampus' },
  { name: 'profile', file: '../src/routes/profile/index.tsx', hint: 'FRONTEND_HINT.profile' },
  { name: 'companies', file: '../src/routes/companies/index.tsx', hint: 'FRONTEND_HINT.companies' },
  { name: 'dashboard', file: '../src/routes/dashboard/index.tsx', hint: 'FRONTEND_HINT.none' },
  { name: 'sources', file: '../src/routes/sources/index.tsx', hint: 'FRONTEND_HINT.none', extra: ['不要把凭证放进地址', "'API 直连'"] },
  { name: 'sync-logs', file: '../src/routes/sync-logs/index.tsx', hint: 'FRONTEND_HINT.none' },
  { name: 'stats', file: '../src/routes/stats/index.tsx', hint: 'FRONTEND_HINT.none' },
  { name: 'account', file: '../src/routes/account/index.tsx', hint: 'FRONTEND_HINT.none' },
  { name: 'terminals', file: '../src/routes/terminals/index.tsx', hint: 'FRONTEND_HINT.none' },
]
for (const route of subtitlePages) {
  const text = readFileSync(fileURLToPath(new URL(route.file, import.meta.url)), 'utf8')
  if (!text.includes(route.hint) || !text.includes('withFrontendHint(')) {
    console.error(`${route.name} missing frontend destination subtitle`)
    failed = true
  }
  for (const token of route.extra ?? []) {
    if (!text.includes(token)) {
      console.error(`${route.name} missing token: ${token}`)
      failed = true
    }
  }
}

if (failed) process.exit(1)
console.log('verify:partner-refresh-safe passed')
