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
  jobsPage: `${read('src/pages/jobs/JobsPage.tsx')}\n${readDirectory('src/pages/jobs/components')}`,
  detailPage: `${read('src/pages/jobs/JobDetailPage.tsx')}\n${readDirectory('src/pages/jobs/components')}`,
}

const required = [
  ['jobsPage', '岗位数据概览'],
  ['jobsPage', '岗位筛选助手'],
  ['jobsPage', '热门岗位标签'],
  ['jobsPage', '客户数据接入提示'],
  ['jobsPage', '字段完整度'],
  ['detailPage', '岗位摘要'],
  ['detailPage', '职责与要求'],
  ['detailPage', '来源可信区'],
  ['detailPage', '后续动作'],
  ['detailPage', '去来源平台投递'],
  ['detailPage', '扫码投递'],
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

for (const [fileKey, needle] of required) {
  if (!files[fileKey].includes(needle)) {
    failures.push(`${fileKey} missing required marker: ${needle}`)
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
