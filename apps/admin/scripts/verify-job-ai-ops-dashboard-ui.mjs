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

console.log('\n=== Admin 岗位 AI 运营看板 UI 门禁 ===')

mustContain('package.json', ['"verify:job-ai-ops-dashboard-ui"'], 'Admin package 注册岗位 AI 运营看板 UI 门禁')
mustContain('src/services/api/types.ts', [
  'jobRecommend',
  'jobExplain',
  'jobMatch',
  'tokenUsageTotals',
  'costByOperation',
  'alerts',
  'JobSourceQualitySummary',
], 'Admin API 类型包含岗位 AI 操作、token/cost 和岗位质量摘要')
mustContain('src/services/api/aiUsage.ts', ['getAdminJobQualitySummary'], 'Admin service 暴露岗位质量摘要读取')
mustContain('src/services/api/adminAiHttpAdapter.ts', ['/admin/jobs/quality-summary'], 'Admin HTTP adapter 使用真实岗位质量摘要端点')
mustContain('src/routes/ai-services/index.tsx', [
  '岗位 AI 运营',
  '真实 token 用量',
  '成本告警',
  '岗位来源质量',
  'getAdminJobQualitySummary',
  'usage.alerts',
  'usage.tokenUsageTotals',
  'usage.costByOperation',
  'qualitySummary',
], 'Admin AI 服务页展示岗位 AI 用量、成本告警和岗位来源质量')
mustNotContain('src/routes/ai-services/index.tsx', [
  '简历原文',
  '提示词原文',
  '模型原始输出',
  '一键投递',
  '立即投递',
  '平台投递',
  '候选人筛选',
  '面试邀约',
  'Offer 管理',
], 'Admin AI 服务页不出现隐私原文或招聘闭环文案')

console.log('ALL PASS')
