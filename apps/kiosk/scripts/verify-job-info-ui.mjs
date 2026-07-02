import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function readDirectory(relativePath) {
  return readdirSync(join(root, relativePath), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
    .map((entry) => read(join(relativePath, entry.name)))
    .join('\n')
}

const files = {
  jobsPage: read('src/pages/jobs/JobsPage.tsx'),
  detailPage: read('src/pages/jobs/JobDetailPage.tsx'),
  components: readDirectory('src/pages/jobs/components'),
  jobHttpAdapter: read('src/services/api/jobHttpAdapter.ts'),
}

const required = [
  ['components', '岗位数据概览'],
  ['jobsPage', 'JobOverviewPanel'],
  ['components', '岗位筛选助手'],
  ['jobsPage', 'JobFilterAssistant'],
  ['components', '热门岗位标签'],
  ['jobsPage', 'TopTagsPanel'],
  ['components', '客户数据接入提示'],
  ['jobsPage', 'DataReadinessPanel'],
  ['components', '字段完整度'],
  ['jobsPage', /searchParams\.get\(['"]sourceOrgId['"]\)\?\.trim\(\)/],
  ['jobsPage', /useState\(\s*\(\s*\)\s*=>\s*sourceOrgIdParam\s*\)/],
  ['jobsPage', /setSourceOrgId\(\s*sourceOrgIdParam\s*\)/],
  ['jobsPage', /hasServerFilter[^\n]*sourceOrgId/],
  ['jobsPage', /getJobs\(\{[\s\S]*?sourceOrgId:\s*sourceOrgId\s*\|\|\s*undefined[\s\S]*?pageSize:\s*100/],
  ['jobHttpAdapter', /query\.sourceOrgId\s*=\s*params\.sourceOrgId/],
  ['components', '岗位摘要'],
  ['components', '职责与要求'],
  ['components', '来源可信区'],
  ['components', '后续动作'],
  ['components', '去来源平台投递'],
  ['components', '扫码投递'],
  ['detailPage', 'openSourcePlatform'],
  ['detailPage', 'isTerminalKiosk'],
  ['detailPage', 'getTerminalId'],
  ['components', 'SourceUrlQr value={job.sourceUrl}'],
  ['components', '放大二维码'],
]

const forbidden = [
  { label: '一键投递', pattern: /一键投递/ },
  { label: '立即投递', pattern: /立即投递/ },
  { label: '非来源语境的平台投递', pattern: /(?<!来源)平台投递/ },
  { label: '投递简历', pattern: /投递简历/ },
  { label: '企业收简历', pattern: /企业收简历/ },
  { label: '候选人管理', pattern: /候选人管理/ },
]

const failures = []

function markerLabel(marker) {
  return marker instanceof RegExp ? marker.toString() : marker
}

function hasMarker(content, marker) {
  return marker instanceof RegExp ? marker.test(content) : content.includes(marker)
}

for (const [fileKey, marker] of required) {
  if (!hasMarker(files[fileKey], marker)) {
    failures.push(`${fileKey} missing required marker: ${markerLabel(marker)}`)
  }
}

for (const [fileKey, content] of Object.entries(files)) {
  for (const { label, pattern } of forbidden) {
    if (pattern.test(content)) {
      failures.push(`${fileKey} contains forbidden compliance copy: ${label}`)
    }
  }
}

if (failures.length > 0) {
  console.error('verify-job-info-ui failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('verify-job-info-ui passed')
