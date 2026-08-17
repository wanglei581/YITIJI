/**
 * Wave 2 — AI 简历排版/内容一键调整验证。
 *
 * 覆盖：
 *   1. DTO 只接受 action=reformat|condense，且请求体只含 resume/action/layout。
 *   2. 未配置 resume_optimize 时明确失败，不 fallback mock。
 *   3. 新增学校/公司/证书/数字会被拒绝。
 *   4. 承诺类表述会被拒绝。
 *   5. condense 只精简描述，不增加条目、不新增事实。
 *   6. 事实基线只取简历字段值，不把 JSON key 当事实。
 *   7. AiService 路由实现必须重新提取原文，提取失败硬失败，不退化为仅用 currentResume。
 *   8. 响应只包含 resume/warnings，不泄漏 token、signedUrl、密钥或原文。
 *   9. 去程（#646）：送模型的 prompt 不得含简历原始联系方式，只能是可还原占位符。
 *  10. 回程（#646）：模型产物里的占位符必须在服务端换回真值，产物无占位符残留。
 *
 * ── 桩模型必须只见得到「实际送出去的那一份」 ─────────────────────────────
 * #646 之后 adjustLayoutDraft 会先遮盖再送模型，事实串校验基线也换成了遮盖后的
 * 文本。桩若继续回一份**未遮盖**的简历（含真实手机号/邮箱），那是真实模型物理上
 * 拿不到的值，必然判「新增事实」而整单作废 —— 结果是成功路径永远红，而 3a/3b/4/3c
 * 四条防编造断言全部因为同一个联系方式不匹配而「碰巧通过」，实际什么也没验。
 *
 * 所以桩改为：解析收到的 prompt，取出服务端真正送给模型的结构化简历 JSON，
 * 在它之上只改写 summary/description（模型被允许做的加工），事实字段与联系方式
 * 原样回抄。这样负例被拒的唯一原因就是注入的那处编造。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:resume-layout-adjust
 */
import 'dotenv/config'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { readFileSync } from 'fs'
import { join } from 'path'
import { validateSync } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { Logger } from '@nestjs/common'
import { LlmResumeOptimizeService } from '../src/ai/resume/llm-resume-optimize.service'
import { ResumeLayoutAdjustDto } from '../src/ai/dto/resume-generate.dto'
import type { GeneratedResume } from '../src/ai/interfaces/ai-provider.interface'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exitCode = 1; throw new Error(m) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

const jw = (...parts: string[]) => parts.join('')

const ORIGINAL_TEXT = [
  '姓名 Alex Chen  电话 13800000000  邮箱 alex@example.com',
  '求职意向 前端开发工程师',
  '教育经历 Sample University Computer Science Bachelor 2020-2024',
  '工作经历 Acme Cloud Frontend Intern 2024 负责组件库维护 将首屏加载时间从4秒降到1.8秒',
  '项目经历 Hiring Dashboard Developer 负责岗位看板性能优化',
  '技能 React TypeScript',
  '证书 CET-6',
].join('\n')

const baseResume: GeneratedResume = {
  basic: { name: 'Alex Chen', phone: '13800000000', email: 'alex@example.com' },
  intention: { position: '前端开发工程师' },
  summary: '具备前端开发实习经验，熟悉 React 与 TypeScript，关注页面性能。',
  education: [
    {
      school: 'Sample University',
      major: 'Computer Science',
      degree: 'Bachelor',
      period: '2020-2024',
      description: '完成计算机核心课程学习。',
    },
  ],
  experience: [
    {
      company: 'Acme Cloud',
      role: 'Frontend Intern',
      period: '2024',
      description: '负责组件库维护与页面性能优化，将首屏加载时间从4秒降到1.8秒。',
    },
  ],
  projects: [
    {
      name: 'Hiring Dashboard',
      role: 'Developer',
      description: '负责岗位看板性能优化。',
    },
  ],
  skills: ['React', 'TypeScript'],
  certificates: ['CET-6'],
}

/** 遮盖占位符形态，与 pii-masker 的 placeholderFor 输出一致。 */
const PLACEHOLDER_TOKEN = /\[(?:劳动者|用人单位|身份证|手机号|银行卡|邮箱|详细地址|统一社会信用代码)_\d+\]/u

/** 注入到「模型看到的那份简历」之上的编造点；null = 老老实实回抄。 */
type StubMutate = ((resume: GeneratedResume) => void) | null
let responseQueue: StubMutate[] = []
let llmCallCount = 0
/** 桩自身出问题（队列耗尽 / prompt 解析不出 JSON）时记在这里，必须显性红。 */
let stubFault = ''
let lastUserPrompt = ''
const setResponses = (arr: StubMutate[]) => { responseQueue = arr.slice(); llmCallCount = 0; stubFault = '' }
const assertStubHealthy = () => { if (stubFault) fail(stubFault) }

/**
 * 模拟一个守规矩的模型：它只见过 masked 那一份，因此回包必须由 masked 派生。
 * 允许它做的只有改写 summary / description；事实字段与联系方式一律原样回抄。
 * warnings 里刻意回抄一次它看到的手机号占位符，用于验证服务端回程还原。
 */
function modelReply(masked: GeneratedResume, mutate: StubMutate): string {
  const resume: GeneratedResume = {
    ...masked,
    summary: '前端开发实习背景，熟悉 React 与 TypeScript，能围绕页面性能持续优化。',
    education: masked.education.map((item) => ({ ...item })),
    experience: masked.experience.map((item) => ({
      ...item,
      description: '维护组件库并优化页面性能，首屏加载时间从4秒降到1.8秒。',
    })),
    projects: masked.projects.map((item) => ({ ...item, description: '优化岗位看板性能。' })),
    skills: [...masked.skills],
    certificates: [...masked.certificates],
  }
  const warnings = ['已精简经历描述，未新增事实。', `联系方式 ${masked.basic.phone ?? ''} 已保留。`]
  mutate?.(resume)
  return JSON.stringify({ resume, warnings })
}

function configured(baseURL: string, enabled = true) {
  return {
    getApiKey: (feature?: string) => (enabled && feature === 'resume_optimize' ? 'stub-key' : null),
    getConfig: (feature?: string) => ({
      vendor: 'deepseek',
      model: 'stub',
      baseURL,
      systemPrompt: '',
      roleScope: '',
      forbiddenWords: [] as string[],
      temperature: 0.3,
      enabled: enabled && feature === 'resume_optimize',
    }),
    isReady: (feature?: string) => enabled && feature === 'resume_optimize',
  }
}

async function main(): Promise<void> {
  console.log('\n=== Wave 2 AI 简历排版/内容一键调整验证 ===')
  Logger.overrideLogger({ log: () => {}, error: () => {}, warn: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} })

  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk as Buffer))
    req.on('end', () => {
      llmCallCount++
      const reject = (fault: string) => {
        stubFault ||= fault
        res.statusCode = 503
        res.setHeader('Content-Type', 'application/json')
        res.end('{"error":"stub"}')
      }
      // 队列耗尽说明真实调用次数与用例预期不符（例如重试次数被改动）。
      // 这里必须让门禁红，不能悄悄放行一份「干净回包」把负例变成假通过。
      if (responseQueue.length === 0) return reject(`桩队列耗尽：第 ${llmCallCount} 次 LLM 调用超出用例预置`)
      const mutate = responseQueue.shift() as StubMutate
      let masked: GeneratedResume
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
          messages?: Array<{ role?: string; content?: string }>
        }
        lastUserPrompt = body.messages?.find((m) => m.role === 'user')?.content ?? ''
        masked = JSON.parse(
          lastUserPrompt.slice(lastUserPrompt.indexOf('{'), lastUserPrompt.lastIndexOf('}') + 1),
        ) as GeneratedResume
        if (!masked?.basic || !Array.isArray(masked.experience)) throw new Error('shape')
      } catch {
        return reject('桩无法从 prompt 中还原出服务端实际送模型的结构化简历 JSON')
      }
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: modelReply(masked, mutate) } }] }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`

  try {
    const invalidAction = plainToInstance(ResumeLayoutAdjustDto, { action: 'rewrite', resume: baseResume })
    if (validateSync(invalidAction).length === 0) fail('1. action 应只允许 reformat|condense')
    const exportOnlyField = plainToInstance(ResumeLayoutAdjustDto, { action: 'condense', resume: baseResume, format: 'pdf' })
    if (validateSync(exportOnlyField, { whitelist: true, forbidNonWhitelisted: true }).length === 0) {
      fail('1. layout-adjust DTO 不应接受导出专用 format 字段')
    }
    pass('1. DTO action 与字段白名单收紧')

    const off = new LlmResumeOptimizeService(configured(baseURL, false) as never)
    try {
      await off.adjustLayoutDraft({ currentResume: baseResume, originalText: ORIGINAL_TEXT, action: 'condense' })
      fail('2. 未配置时不应成功')
    } catch (e) {
      if (errCode(e) !== 'AI_PROVIDER_NOT_CONFIGURED') fail(`2. 期望 AI_PROVIDER_NOT_CONFIGURED，实际 ${errCode(e)}`)
    }
    pass('2. 未配置 resume_optimize → 明确失败，不 fallback mock')

    const svc = new LlmResumeOptimizeService(configured(baseURL) as never)

    const fabricateSchool: StubMutate = (resume) => {
      resume.education[0] = { ...resume.education[0], school: 'Fabricated University' }
    }
    setResponses([fabricateSchool, fabricateSchool])
    try {
      await svc.adjustLayoutDraft({ currentResume: baseResume, originalText: ORIGINAL_TEXT, action: 'reformat' })
      fail('3. 新增学校应被拒绝')
    } catch (e) {
      if (errCode(e) !== 'AI_LAYOUT_ADJUST_INVALID_OUTPUT') fail(`3. 期望 AI_LAYOUT_ADJUST_INVALID_OUTPUT，实际 ${errCode(e)}`)
    }
    assertStubHealthy()
    pass('3a. 新增学校/事实串 → 拒绝')

    const keyAsFact: StubMutate = (resume) => { resume.certificates = ['summary'] }
    setResponses([keyAsFact, keyAsFact])
    try {
      await svc.adjustLayoutDraft({ currentResume: baseResume, originalText: ORIGINAL_TEXT, action: 'reformat' })
      fail('3/6. JSON key 被当作事实时会误通过，此处必须拒绝')
    } catch (e) {
      if (errCode(e) !== 'AI_LAYOUT_ADJUST_INVALID_OUTPUT') fail(`6. 期望 AI_LAYOUT_ADJUST_INVALID_OUTPUT，实际 ${errCode(e)}`)
    }
    assertStubHealthy()
    pass('3b+6. 事实基线只取字段值，JSON key 不可作为事实')

    const promising: StubMutate = (resume) => { resume.summary = `优秀候选人，${jw('保', '录用')}` }
    setResponses([promising, promising])
    try {
      await svc.adjustLayoutDraft({ currentResume: baseResume, originalText: ORIGINAL_TEXT, action: 'reformat' })
      fail('4. 承诺词应被拒绝')
    } catch (e) {
      if (errCode(e) !== 'AI_LAYOUT_ADJUST_INVALID_OUTPUT') fail(`4. 期望 AI_LAYOUT_ADJUST_INVALID_OUTPUT，实际 ${errCode(e)}`)
    }
    assertStubHealthy()
    pass('4. 承诺类表述 → 拒绝')

    const newNumber: StubMutate = (resume) => {
      resume.experience[0] = { ...resume.experience[0], description: '新增覆盖 9 个业务模块。' }
    }
    setResponses([newNumber, newNumber])
    try {
      await svc.adjustLayoutDraft({ currentResume: baseResume, originalText: ORIGINAL_TEXT, action: 'condense' })
      fail('3. 新增数字应被拒绝')
    } catch (e) {
      if (errCode(e) !== 'AI_LAYOUT_ADJUST_INVALID_OUTPUT') fail(`3. 期望 AI_LAYOUT_ADJUST_INVALID_OUTPUT，实际 ${errCode(e)}`)
    }
    assertStubHealthy()
    pass('3c. 新增数字 → 拒绝')

    setResponses([null])
    const result = await svc.adjustLayoutDraft({
      currentResume: baseResume,
      originalText: ORIGINAL_TEXT,
      action: 'condense',
      layout: { columns: 2, fontScale: 'compact', lineSpacing: 'compact', margin: 'narrow', accent: 'slate' },
    })
    assertStubHealthy()
    if (result.resume.experience.length !== baseResume.experience.length) fail('5. condense 不应增加经历条目')
    if (result.resume.experience[0].description.length >= baseResume.experience[0].description.length) fail('5. condense 应精简经历描述')
    const keys = Object.keys(result).sort().join(',')
    if (keys !== 'resume,warnings') fail(`8. 响应字段应仅 resume,warnings，实际 ${keys}`)
    const responseText = JSON.stringify(result)
    for (const leak of ['accessToken', 'signedUrl', 'stub-key', ORIGINAL_TEXT]) {
      if (responseText.includes(leak)) fail(`8. 响应泄漏 ${leak}`)
    }
    pass('5+8. condense 精简成功，响应只含 resume/warnings 且无敏感泄漏')

    // 9/10 守 #646：去程只出占位符、回程必须换回真值。任何一侧被摘掉都必须红。
    if (lastUserPrompt.includes(baseResume.basic.phone!)) fail('9. 出站 prompt 泄漏简历原始手机号')
    if (lastUserPrompt.includes(baseResume.basic.email!)) fail('9. 出站 prompt 泄漏简历原始邮箱')
    if (!/\[手机号_\d+\]/u.test(lastUserPrompt) || !/\[邮箱_\d+\]/u.test(lastUserPrompt)) {
      fail('9. 出站 prompt 未按可还原占位符形态遮盖联系方式')
    }
    pass('9. 去程：简历原始联系方式不出境，prompt 只含可还原占位符')

    if (result.resume.basic.phone !== baseResume.basic.phone) fail(`10. basic.phone 未还原为真值，实际 ${result.resume.basic.phone}`)
    if (result.resume.basic.email !== baseResume.basic.email) fail(`10. basic.email 未还原为真值，实际 ${result.resume.basic.email}`)
    // 模型自己写出来的文本里的占位符也必须被还原，否则用户简历上会印着 [手机号_1]
    if (!result.warnings.some((w) => w.includes(baseResume.basic.phone!))) {
      fail('10. 模型文本中的占位符未被还原为真值')
    }
    if (PLACEHOLDER_TOKEN.test(responseText)) fail('10. 产物残留遮盖占位符，用户会看到 [手机号_1] 这类文本')
    pass('10. 回程：占位符在服务端还原为真值，产物无占位符残留')

    const aiServiceSource = readFileSync(join(process.cwd(), 'src/ai/ai.service.ts'), 'utf-8')
    if (!aiServiceSource.includes('adjustResumeLayout')) fail('7. AiService 缺少 adjustResumeLayout')
    if (!aiServiceSource.includes('resumeExtraction.extractResumeText')) fail('7. layout-adjust 必须重新提取原文')
    if (!aiServiceSource.includes('AI_RESUME_SOURCE_UNAVAILABLE')) fail('7. 提取失败必须硬失败并返回明确错误码')
    pass('7. AiService layout-adjust 重新提取原文，提取失败不 fallback currentResume')

    console.log('\n=== ALL PASS ===')
  } finally {
    server.close()
  }
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e.message)
  process.exit(1)
})
