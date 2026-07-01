/**
 * 岗位信息 AI 真实验收证据包防回退验证。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:job-info-ai-real-acceptance
 *
 * 注意：本脚本只做静态文档与门禁口径检查，不连接预生产 PostgreSQL、
 * Redis、COS、LLM、OCR，也不执行 Windows 一体机真机动作。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(__dirname, '../../..')

const acceptancePath = join(repoRoot, 'docs/acceptance/job-info-ai-real-acceptance.md')
const executionRecordPath = join(repoRoot, 'docs/acceptance/job-info-ai-preprod-execution-record.md')
const nextTasksPath = join(repoRoot, 'docs/progress/next-tasks.md')
const currentProgressPath = join(repoRoot, 'docs/progress/current-progress.md')
const apiPackagePath = join(repoRoot, 'services/api/package.json')
const ciPath = join(repoRoot, '.github/workflows/ci.yml')

let failed = 0

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failed += 1
  console.error(`  FAIL ${message}`)
}

function mustExist(path: string, label: string): string {
  if (!existsSync(path)) {
    fail(`${label} — 文件缺失: ${path.replace(repoRoot + '/', '')}`)
    return ''
  }
  pass(label)
  return readFileSync(path, 'utf8')
}

function mustContain(source: string, markers: string[], label: string): void {
  const missing = markers.filter((marker) => !source.includes(marker))
  if (missing.length > 0) fail(`${label} — 缺少: ${missing.join(' | ')}`)
  else pass(label)
}

function mustNotContain(source: string, markers: string[], label: string): void {
  const found = markers.filter((marker) => source.includes(marker))
  if (found.length > 0) fail(`${label} — 不应包含: ${found.join(' | ')}`)
  else pass(label)
}

function assertNoOverclaim(source: string, label: string): void {
  const risky = source
    .split('\n')
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => /岗位信息 AI|Job AI|job_ai/.test(line))
    .filter(({ line }) => /(生产|商用|试运营|预生产|真机)[^。\n]{0,40}(完成|通过|已完成|已通过|可上线|可商用)/.test(line))
    .filter(({ line }) => !/(不代表|不得|不能|未|待|仍需|尚未|PENDING|不等于|不可)/.test(line))
  if (risky.length > 0) {
    fail(`${label} — 存在可能过度宣称的行: ${risky.map((item) => `${item.index}:${item.line.trim()}`).join(' || ')}`)
  } else {
    pass(label)
  }
}

function main(): void {
  console.log('\n=== 岗位信息 AI 真实验收证据包门禁 ===')

  const acceptance = mustExist(acceptancePath, '真实验收证据包文档存在')
  const executionRecord = mustExist(executionRecordPath, '预生产执行记录模板存在')
  const nextTasks = mustExist(nextTasksPath, 'next-tasks 进度入口存在')
  const currentProgress = mustExist(currentProgressPath, 'current-progress 进度入口存在')
  const packageJson = mustExist(apiPackagePath, 'API package.json 存在')
  const ci = mustExist(ciPath, 'CI workflow 存在')

  mustContain(acceptance, [
    'STATIC DOC CHECK ONLY',
    '[ ] PENDING REAL-EVIDENCE',
    '本证据包就绪不等于岗位信息 AI 生产商用完成',
    '证据不进 Git',
    '客户真实岗位样本',
    'sourceOrgId',
    'externalId',
    'sourceName',
    'sourceUrl',
    'Excel',
    'API',
    'Webhook',
    'JobDataQualitySnapshot',
    'Admin',
    'Partner',
    'Kiosk',
    '预生产公网浏览器',
    '真实会员',
    '真实简历',
    '真实 LLM',
    '百度 OCR',
    'PostgreSQL',
    'Redis',
    'COS',
    'SESSION-A_REAL_SMS',
    'SESSION-B_REDIS_TEST_CODE',
    'SESSION-C_CONTROLLED_SESSION',
    'job_ai',
    'JobAiSession',
    'JobAiRecommendation',
    'AiServiceLog',
    'BrowseLog',
    'ExternalJumpLog',
    '只记录 external_apply 打开动作',
    '不记录投递结果',
    'Windows Terminal Agent',
    'terminalId',
    'Pantum',
    '真实出纸',
    'PrintTask',
    'FileObject',
    '手机号脱敏',
    'token 脱敏',
    '签名 URL 脱敏',
    '停止条件',
    '一键投递',
    '立即投递',
    '平台投递',
    '候选人筛选',
    '面试邀约',
    'Offer 管理',
    '向企业推荐候选人',
    '推荐结果仅供参考',
  ], '真实验收文档覆盖客户样本、预生产、真机、隐私和合规边界')

  mustContain(executionRecord, [
    'PENDING REAL-EVIDENCE',
    'Environment Snapshot',
    'Customer Job Sample Gate',
    'Preproduction Browser Gate',
    'Hardware Gate',
    'Evidence Index',
    'Residual Risks',
    'Not Passed Yet',
    'JAI-G0',
    'JAI-G1',
    'JAI-G2',
    'JAI-G3',
    'JAI-H1',
    'JAI-H2',
    'JAI-H3',
    '不得填写真实手机号明文、验证码、cookie、JWT、签名 URL、简历正文或密钥',
  ], '预生产执行记录模板包含环境、客户样本、浏览器、真机和证据编号')

  mustContain(nextTasks, [
    '岗位信息 AI 商用闭环下一阶段',
    '客户真实岗位样本授权 / 展示口径',
    '真实会员 AI 浏览器验收',
    '一体机真机验收',
    '腾讯真实岗位样本预生产隔离导入 Gate',
    '岗位信息页客户数据普通浏览验收',
    '不得对外宣称 AI 推荐或岗位匹配达到生产商用完成',
  ], 'next-tasks 明确剩余真实验收且禁止过度宣称')

  mustContain(currentProgress, [
    'Task 8 Admin AI 用量 / 成本 / 告警 / 岗位来源质量看板',
    '腾讯真实岗位样本预生产隔离导入 Gate',
    'Kiosk 公网普通岗位浏览证据已补齐',
    '后续必须补真实客户岗位样本、真实会员 + 已解析简历 + LLM/OCR 的岗位 AI 浏览器 E2E，以及 Windows 一体机 / Terminal Agent / Pantum 真机验收',
  ], 'current-progress 保留 Task 8 后续真实验收边界')

  mustNotContain(acceptance + executionRecord, [
    '候选人名单',
    '企业收简历',
    '平台内投递完成',
    '投递状态追踪',
    '录用概率',
    '保面试',
    '保录用',
  ], '验收文档不引入招聘平台闭环能力')

  assertNoOverclaim(acceptance + '\n' + executionRecord + '\n' + nextTasks + '\n' + currentProgress, '岗位信息 AI 文档不得过度宣称生产 / 试运营 / 真机完成')

  mustContain(packageJson, ['"verify:job-info-ai-real-acceptance"'], 'API package 注册真实验收门禁脚本')
  mustContain(ci, ['verify:job-info-ai-real-acceptance'], 'CI 接入岗位信息 AI 真实验收门禁')

  if (failed > 0) {
    console.error(`\n❌ ${failed} 项失败 — 岗位信息 AI 真实验收证据包门禁未通过\n`)
    process.exit(1)
  }

  console.log('✅ ALL PASS — 岗位信息 AI 真实验收证据包门禁一致\n')
}

main()
