/**
 * 百宝箱 AI skill intent 接线防回退验证。
 *
 * 运行: pnpm --filter @ai-job-print/api verify:toolbox-ai-skill-intents
 *
 * 本脚本只做本地静态链路检查：不连接真实大模型、不连接预生产数据库、
 * 不修改 env、不执行 migration。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { AssistantChatRequestDto } from '../src/ai/dto/assistant-chat.dto'

const repoRoot = join(__dirname, '../../..')
const sharedAiTypesPath = join(repoRoot, 'packages/shared/src/types/ai.ts')
const apiAiInterfacePath = join(repoRoot, 'services/api/src/ai/interfaces/ai-provider.interface.ts')
const assistantDtoPath = join(repoRoot, 'services/api/src/ai/dto/assistant-chat.dto.ts')
const llmChatPath = join(repoRoot, 'services/api/src/ai/llm/llm-chat.service.ts')
const apiMockProviderPath = join(repoRoot, 'services/api/src/ai/providers/mock.provider.ts')
const kioskAssistantPath = join(repoRoot, 'apps/kiosk/src/pages/assistant/AssistantPage.tsx')
const kioskMockAdapterPath = join(repoRoot, 'apps/kiosk/src/services/api/aiMockAdapter.ts')
const toolboxTypesPath = join(repoRoot, 'packages/shared/src/types/toolboxMicroApp.ts')
const apiPackagePath = join(repoRoot, 'services/api/package.json')
const productDocPath = join(repoRoot, 'docs/product/toolbox-micro-app-platform.md')
const currentProgressPath = join(repoRoot, 'docs/progress/current-progress.md')
const nextTasksPath = join(repoRoot, 'docs/progress/next-tasks.md')

const firstBatchIntents = ['offer_compare', 'salary_negotiation', 'hr_qa']
const extendedIntents = [
  'self_intro_gen',
  'material_checklist',
  'jd_analysis',
  'interview_questions',
  'career_explore',
  'cover_letter_gen',
  'resume_jd_match',
  'company_research',
]
const allSkillIntents = [...firstBatchIntents, ...extendedIntents]
const forbiddenLaunchCopy = ['一键投递', '立即投递', '平台投递', '候选人推荐给企业', '企业端 Offer 管理']

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

function mustNotContainUnsafeForbiddenCopy(source: string, markers: string[], label: string): void {
  const unsafeLines = source
    .split('\n')
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => markers.some((marker) => line.includes(marker)))
    .filter(({ line }) => !/(不出现|禁止|不得|不能|不做|不引入|合规约束|合规边界)/.test(line))
  if (unsafeLines.length > 0) {
    fail(`${label} — 存在未带禁止语境的风险文案: ${unsafeLines.map((item) => `${item.index}:${item.line.trim()}`).join(' || ')}`)
  } else {
    pass(label)
  }
}

function main(): void {
  console.log('\n=== 百宝箱 AI skill intent 接线门禁 ===')

  const sharedAiTypes = mustExist(sharedAiTypesPath, '共享 AI 类型存在')
  const apiAiInterface = mustExist(apiAiInterfacePath, 'API AI provider 接口存在')
  const assistantDto = mustExist(assistantDtoPath, '助手聊天 DTO 存在')
  const llmChat = mustExist(llmChatPath, 'LLM chat 服务存在')
  const apiMockProvider = mustExist(apiMockProviderPath, 'API mock provider 存在')
  const kioskAssistant = mustExist(kioskAssistantPath, 'Kiosk AssistantPage 存在')
  const kioskMockAdapter = mustExist(kioskMockAdapterPath, 'Kiosk mock adapter 存在')
  const toolboxTypes = mustExist(toolboxTypesPath, '百宝箱内置微应用类型存在')
  const packageJson = mustExist(apiPackagePath, 'API package.json 存在')
  const productDoc = mustExist(productDocPath, '百宝箱产品文档存在')
  const currentProgress = mustExist(currentProgressPath, 'current-progress 存在')
  const nextTasks = mustExist(nextTasksPath, 'next-tasks 存在')

  mustContain(sharedAiTypes, [...allSkillIntents, 'export type AssistantSkill', 'skill?: AssistantSkill'], '共享类型包含全部 AI skill 和请求字段')
  mustContain(apiAiInterface, [...allSkillIntents, 'export type AssistantSkill', 'skill?: AssistantSkill'], 'API provider 接口镜像包含全部 AI skill 和请求字段')
  mustContain(assistantDto, [...allSkillIntents, '@IsIn(ASSISTANT_SKILLS)', 'skill?:'], 'DTO 对 skill 做白名单校验（全部 11 项）')

  const rejectedSkills = allSkillIntents.filter((skill) => (
    validateSync(plainToInstance(AssistantChatRequestDto, { message: '测试', skill })).length > 0
  ))
  if (rejectedSkills.length > 0) fail(`DTO 运行时接受全部合法 skill — 被拒绝: ${rejectedSkills.join(' | ')}`)
  else pass('DTO 运行时接受全部合法 skill')

  const invalidSkillErrors = validateSync(plainToInstance(AssistantChatRequestDto, {
    message: '测试',
    skill: 'unknown_skill',
  }))
  if (invalidSkillErrors.some((error) => error.property === 'skill')) pass('DTO 运行时拒绝未知 skill')
  else fail('DTO 运行时拒绝未知 skill — 非法 skill 未触发校验错误')

  mustContain(kioskAssistant, [
    'useSearchParams',
    'TOOLBOX_ASSISTANT_SCENES',
    'normalizeToolboxSkill',
    'skill: toolboxSkill',
    'source: \'toolbox_ai_skill\'',
    ...allSkillIntents,
    '不构成录用、入职或法律意见',
    '不构成涨薪或录用承诺',
    '不构成正式法律意见或官方政策承诺',
  ], 'Kiosk 助手页读取全部 URL intent、展示场景文案并透传请求')

  mustContain(llmChat, [
    'SKILL_SCOPED_PROMPTS',
    'buildSkillScopedSystemPrompt',
    'skill ? SKILL_ACTIONS[skill] : INTENT_ROUTES[intent]',
    ...allSkillIntents,
    '不得承诺录用结果',
    '不得承诺涨薪成功',
    '不得对具体争议给出确定法律结论',
    '不得编造用户未提供的学历、经历、成果、数据、证书或技能',
    '不得虚构招聘方未公开的筛选规则、面试题或录用标准',
    '不得输出确定的录用概率、适配结论或招聘方内部评分',
    '不得虚构企业内部流程、面试风格、薪酬、题库或招聘结论',
  ], 'LLM 服务为全部 intent 注入场景合规 prompt 和白名单动作')

  mustContain(`${apiMockProvider}\n${kioskMockAdapter}`, [
    ...allSkillIntents,
    '仅供个人参考',
    '不承诺涨薪或录用结果',
    '官方人社窗口',
    '不代表招聘方评价标准',
    '不构成职业、心理或医疗建议',
    '不保证录用结果',
    '不构成企业官方说明',
  ], '前后端 mock 模式具备全部 skill 的场景化演示回复')

  mustContain(toolboxTypes, [
    'offer-compare',
    'salary-negotiation',
    'hr-qa',
    '/assistant?intent=offer_compare',
    '/assistant?intent=salary_negotiation',
    '/assistant?intent=hr_qa',
  ], '百宝箱内置首批 AI skill 入口仍指向受控 Assistant intent')

  mustContain(packageJson, ['"verify:toolbox-ai-skill-intents"'], 'API package 注册 AI skill intent 门禁脚本')

  mustContain(productDoc, [
    '首批低风险 AI skill intent 接线',
    'Offer 对比',
    '薪资谈判话术',
    'HR 知识问答',
    '预生产 TAS-G2 真实模型边界探针已通过但仍带注意事项',
    '不代表真实 Kiosk 浏览器验收、公共终端隐私验收或微应用商用上线完成',
  ], '产品文档记录首批低风险 AI skill 接线范围、TAS-G2 和未完成边界')

  mustContain(`${currentProgress}\n${nextTasks}`, [
    '首批低风险 AI skill intent 接线',
    'Offer 对比',
    '薪资谈判话术',
    'HR 知识问答',
  ], '进度文档记录本地代码侧接线结果和下一步边界')

  mustNotContainUnsafeForbiddenCopy(
    `${kioskAssistant}\n${llmChat}\n${apiMockProvider}\n${kioskMockAdapter}`,
    forbiddenLaunchCopy,
    'AI skill 接线不引入招聘平台闭环文案',
  )

  if (failed > 0) {
    console.error(`\n❌ ${failed} 项失败 — 百宝箱 AI skill intent 接线门禁未通过\n`)
    process.exit(1)
  }

  console.log('✅ ALL PASS — 百宝箱全部 AI skill intent 接线一致\n')
}

main()
