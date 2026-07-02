import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function fail(message) {
  console.error(`FAIL ${message}`)
  process.exit(1)
}

function pass(message) {
  console.log(`PASS ${message}`)
}

function read(path) {
  const full = join(root, path)
  if (!existsSync(full)) fail(`missing ${path}`)
  return readFileSync(full, 'utf8')
}

function mustContain(path, tokens, message) {
  const text = read(path)
  const missing = tokens.filter((token) => !text.includes(token))
  if (missing.length) fail(`${message}; missing=${missing.join(', ')}`)
  pass(message)
}

function mustNotContain(path, tokens, message) {
  const text = read(path)
  const hit = tokens.find((token) => text.includes(token))
  if (hit) fail(`${message}; hit=${hit}`)
  pass(message)
}

console.log('\n=== Partner 岗位质量看板 UI 门禁 ===')

mustContain('package.json', ['"verify:job-quality-dashboard-ui"'], 'Partner package 注册岗位质量看板 UI 门禁')
mustContain('src/services/api/types.ts', ['JobSourceQualitySummaryDTO', 'PartnerJobQualitySummary'], 'Partner API 类型复用 shared 岗位质量摘要契约')
mustContain('../../packages/shared/src/types/job.ts', ['JobSourceQualitySummaryDTO', 'readyJobs', 'brokenSourceUrlJobs'], 'shared 岗位质量摘要契约包含就绪与来源异常字段')
mustContain('src/services/api/partnerHttpAdapter.ts', ['/partner/jobs/quality-summary'], 'Partner HTTP adapter 使用真实岗位质量摘要端点')
mustContain('src/services/api/partnerMockAdapter.ts', ['getPartnerJobQualitySummary'], 'Partner mock adapter 明确提供质量摘要降级数据')
mustContain('src/routes/jobs/index.tsx', ['JobQualitySummaryPanel', 'getPartnerJobQualitySummary', 'qualitySummary'], 'Partner 岗位页接入质量摘要面板')
mustContain('src/routes/jobs/components/JobQualitySummaryPanel.tsx', [
  '本机构岗位质量',
  'AI 可读就绪率',
  '质量巡检待生成',
  '来源链接异常',
  '字段缺失',
  'qualitySummary',
], 'Partner 岗位质量面板展示就绪率和来源问题')
mustNotContain('src/routes/jobs/components/JobQualitySummaryPanel.tsx', [
  '简历',
  '候选人',
  '面试',
  'Offer',
  '一键投递',
  '立即投递',
  '平台投递',
], 'Partner 质量面板不展示用户侧 AI 匹配、候选人或招聘闭环文案')

console.log('ALL PASS')
