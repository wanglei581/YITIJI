import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const routes = [
  {
    name: 'jobs',
    file: '../src/routes/jobs/index.tsx',
    key: "const PARTNER_JOBS_REFRESH_KEY = 'partner:jobs'",
  },
  {
    name: 'fairs',
    file: '../src/routes/fairs/index.tsx',
    key: "const PARTNER_FAIRS_REFRESH_KEY = 'partner:fairs'",
  },
  {
    name: 'policy',
    file: '../src/routes/policy/index.tsx',
    key: "const PARTNER_POLICIES_REFRESH_KEY = 'partner:policies'",
  },
]

const requiredTokens = [
  "from '@ai-job-print/refresh'",
  'useRefreshable(',
  'useInteractionLock(',
  'mergeById',
  'intervalMs: 60_000',
  "failPolicy: 'keep-last'",
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
  const missing = [route.key, ...requiredTokens].filter((token) => !text.includes(token))
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

if (failed) process.exit(1)
console.log('verify:partner-refresh-safe passed')
