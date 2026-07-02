/**
 * 百宝箱首批低风险 AI skill 真实验收执行包防回退验证。
 *
 * 运行: pnpm --filter @ai-job-print/api verify:toolbox-ai-skill-real-acceptance
 *
 * 注意: 本脚本只做静态文档与门禁口径检查,不连接真实 LLM、
 * 不连接预生产 PostgreSQL、不修改 env、不执行 migration。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(__dirname, '../../..')
const runbookPath = join(repoRoot, 'docs/acceptance/toolbox-ai-skill-real-acceptance.md')
const recordPath = join(repoRoot, 'docs/acceptance/toolbox-ai-skill-real-execution-record.md')
const productPath = join(repoRoot, 'docs/product/toolbox-micro-app-platform.md')
const nextTasksPath = join(repoRoot, 'docs/progress/next-tasks.md')
const currentProgressPath = join(repoRoot, 'docs/progress/current-progress.md')
const apiPackagePath = join(repoRoot, 'services/api/package.json')
const aiSkillVerifyPath = join(repoRoot, 'services/api/scripts/verify-toolbox-ai-skill-intents.ts')

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
    fail(`${label} — 文件缺失: ${path.replace(`${repoRoot}/`, '')}`)
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

function mustNotContainUnsafe(source: string, markers: string[], label: string): void {
  const unsafeLines = source
    .split('\n')
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => markers.some((marker) => line.includes(marker)))
    .filter(({ line }) => !/(不得|不能|不做|不引入|不承诺|不输出|不出现|未出现|未命中|禁止|停止条件|回滚标准|不应包含|不代表)/.test(line))
  if (unsafeLines.length > 0) {
    fail(`${label} — 存在未带禁止语境的风险文案: ${unsafeLines.map((item) => `${item.index}:${item.line.trim()}`).join(' || ')}`)
  } else {
    pass(label)
  }
}

function assertNoOverclaim(source: string, label: string): void {
  const risky = source
    .split('\n')
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => /百宝箱|AI skill|toolbox-ai-skill/i.test(line))
    .filter(({ line }) => /(生产|预生产|商用|上线|试运营|真实模型|真机|Windows 真机)[^。\n]{0,60}(完成|通过|已完成|已通过|可上线|可商用)/.test(line))
    .filter(({ line }) => !/(不代表|不得|不能|未|待|仍需|尚未|PENDING|不等于|不可|执行包|只有|仍不得|禁止证明|本执行包不证明|代码侧|只读预检|后续 Gate|阻断后续)/.test(line))
    .filter(({ line }) => !/^\| (TAS|SEC)-G[0-9].*\| PASS_WITH_NOTES \|/.test(line))
  if (risky.length > 0) {
    fail(`${label} — 存在可能过度宣称的行: ${risky.map((item) => `${item.index}:${item.line.trim()}`).join(' || ')}`)
  } else {
    pass(label)
  }
}

function main(): void {
  console.log('\n=== 百宝箱首批低风险 AI skill 真实验收执行包门禁 ===')

  const runbook = mustExist(runbookPath, 'AI skill 真实验收执行包存在')
  const record = mustExist(recordPath, 'AI skill 真实验收执行记录模板存在')
  const product = mustExist(productPath, '产品方案存在')
  const nextTasks = mustExist(nextTasksPath, 'next-tasks 进度入口存在')
  const currentProgress = mustExist(currentProgressPath, 'current-progress 进度入口存在')
  const packageJson = mustExist(apiPackagePath, 'API package.json 存在')
  const aiSkillVerify = mustExist(aiSkillVerifyPath, 'AI skill intent 接线门禁存在')

  mustContain(runbook, [
    'STATIC DOC CHECK ONLY',
    '不代表预生产真实模型联调、真实 Kiosk 浏览器验收、真实终端验收或首批 AI skill 商用上线已经完成',
    'Offer 对比',
    '薪资谈判话术',
    'HR 知识问答',
    '/assistant?intent=offer_compare',
    '/assistant?intent=salary_negotiation',
    '/assistant?intent=hr_qa',
    'TAS-G0 本地静态门禁',
    'verify:toolbox-ai-skill-intents',
    'verify:toolbox-ai-skill-real-acceptance',
    'TAS-G1 预生产只读预检',
    'admin/ai-config',
    'apiKeyConfigured',
    'assistant_chat.enabled=true',
    'TAS-G2 真实 LLM 连通性和边界探针',
    'verify:llm-connectivity -- --feature=assistant_chat',
    '不承诺录用或入职',
    '不承诺涨薪',
    '只做常识说明',
    'TAS-G3 Kiosk 浏览器真实链路验收',
    '非法 intent',
    'TAS-G4 公共终端隐私与竞态验收',
    '旧场景回复不回写新场景',
    '不使用 localStorage 保存聊天内容',
    'TAS-G5 证据复核与上线阻断项',
    '停止条件',
    'assistant_chat` 未启用或 `apiKeyConfigured=false',
    'HR 问答输出确定法律意见',
    '场景切换出现旧消息或旧回复串味',
    '回滚标准',
  ], '执行包覆盖 G0-G5、真实模型、Kiosk 浏览器、隐私竞态、停止条件和回滚')

  mustContain(record, [
    '状态：TAS-G2 PASSED WITH NOTES',
    '尚未执行 Windows 真机、正式自有域名 HTTPS、试运营或首批 AI skill 商用上线',
    'TAS-G0 本地静态门禁',
    'TAS-G1 预生产只读预检',
    'TAS-G2 真实 LLM 连通性和边界探针',
    'TAS-G3 Kiosk 浏览器真实链路验收',
    'TAS-G4 公共终端隐私与竞态验收',
    'TAS-G5 证据复核与上线阻断项',
    'TAS-G1 预生产只读预检 | PASS_WITH_NOTES',
    'TAS-G2-20260702-llm-boundary-probe',
    'TAS-G3 Kiosk 浏览器真实链路验收 | PASS',
    'TAS-G4 公共终端隐私与竞态验收 | PASS',
    'TAS-G5 证据复核与上线阻断项 | PASS_WITH_NOTES',
    'TAS-G3-G4-20260702-browser-privacy-8329b7ea36a1',
    'assistant_chat.enabled=true',
    'apiKeyConfigured=true',
    'vendor=deepseek',
    'model=deepseek-chat',
    'root 密码和管理员 token 曾在聊天中暴露',
    '二次边界复核：PASS',
    '完整 prompt、完整模型输出、sessionId、cookie、token、HAR 均未写入仓库',
    'localStorageCount=0',
    'PENDING',
    '不得据此宣称百宝箱首批 AI skill 正式生产上线、商用上线',
  ], '执行记录允许 TAS-G2 脱敏通过且覆盖全部 TAS Gate')

  mustContain(packageJson, ['"verify:toolbox-ai-skill-real-acceptance"'], 'API package 注册 AI skill 真实验收门禁脚本')

  mustContain(aiSkillVerify, [
    'verify:toolbox-ai-skill-intents',
    'AssistantSkill',
    'DTO 对 skill 做白名单校验',
    'AI skill 接线不引入招聘平台闭环文案',
  ], '真实验收执行包依赖的接线门禁仍覆盖 skill、DTO 和合规文案')

  mustContain(product, [
    '首批低风险 AI skill intent 接线已落地范围',
    '首批低风险 AI skill 真实验收执行包',
    '预生产 TAS-G2 真实模型边界探针已通过但仍带注意事项',
    'TAS-G3 至 TAS-G5 继续保持 `PENDING`',
    'TAS-G3-G4-20260702-browser-privacy-8329b7ea36a1',
    'TAS-G3 / TAS-G4 PASS',
    '未用 Windows 一体机真机完成三类 skill 问答验收',
  ], '产品方案记录代码侧接线、TAS-G2、TAS-G3/TAS-G4 和后续真实验收边界')

  mustContain(nextTasks, [
    '百宝箱微应用平台首批低风险 AI skill 真实验收',
    'verify:toolbox-ai-skill-real-acceptance',
    'TAS-G2 真实 LLM 边界探针',
    'TAS-G3 Kiosk 浏览器真实链路',
    'TAS-G4 公共终端隐私竞态',
    'TAS-G5 证据复核',
    'TAS-G3-G4-20260702-browser-privacy-8329b7ea36a1',
    '正式自有域名 HTTPS',
    'TAS-G3 Kiosk 浏览器真实链路',
    'TAS-G4 公共终端隐私竞态验收',
  ], 'next-tasks 保留 TAS-G2/G3/G4/G5 事实、剩余边界和防回退门禁')

  mustContain(currentProgress, [
    '首批低风险 AI skill 真实验收执行包',
    'TAS-G2 真实 LLM 边界探针',
    '未出现录用 / 入职承诺、保证涨薪、夸大经历、威胁式谈判、确定个案法律意见或平台投递闭环',
    '不得宣称首批 AI skill 商用上线完成',
  ], 'current-progress 保留 TAS-G2 事实和未上线边界')

  mustNotContainUnsafe(`${runbook}\n${record}\n${product}\n${nextTasks}\n${currentProgress}`, [
    '平台投递完成',
    '收取简历给企业',
    '保证录用',
    '保证涨薪',
    '商用上线完成',
    '正式法律意见完成',
  ], '执行包不引入招聘平台闭环、承诺性话术或上线完成宣称')

  assertNoOverclaim(`${runbook}\n${record}\n${product}\n${nextTasks}\n${currentProgress}`, 'AI skill 真实验收文档不得过度宣称生产 / 预生产 / 商用完成')

  if (failed > 0) {
    console.error(`\n❌ ${failed} 项失败 — 百宝箱 AI skill 真实验收执行包门禁未通过\n`)
    process.exit(1)
  }

  console.log('✅ ALL PASS — 百宝箱首批低风险 AI skill 真实验收执行包门禁一致\n')
}

main()
