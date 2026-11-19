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
 * 授权 11 / 11g / 12 / 13 在 verify-resume-layout-adjust-consent.ts，两条都进 CI。
 */
import 'dotenv/config'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { readFileSync } from 'fs'
import { join } from 'path'
import { validateSync } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { Logger, ValidationPipe } from '@nestjs/common'
import { layoutTokenPattern } from '../src/ai/resume/layout-adjust-digit-cover'
import { stripLayoutTokensForFacts } from '../src/ai/resume/layout-adjust-mask'
import { LAYOUT_ADJUST_SYSTEM_PROMPT, LlmResumeOptimizeService } from '../src/ai/resume/llm-resume-optimize.service'
import { ResumeGenerateExportDto, ResumeLayoutAdjustDto } from '../src/ai/dto/resume-generate.dto'
import { ResumePdfService } from '../src/ai/resume/resume-pdf.service'
import { extractPdfText, openUnpdfDocument } from '../src/common/pdf/pdfjs-document'
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

  // 真模型解析路径也接受漏抽的意向，即使原文有意向，也没有服务端回补保证。
  const parser = new LlmResumeOptimizeService({} as never) as unknown as {
    parseAndValidate(raw: string, text: string, forbidden: string[]): { optimizedResume: GeneratedResume } | null
  }
  const parsed = parser.parseAndValidate(JSON.stringify({ resume: {
    basic: baseResume.basic, summary: '', education: [], experience: [], projects: [], skills: [], certificates: [],
  }, modules: [] }), ORIGINAL_TEXT, [])
  if (!parsed || parsed.optimizedResume.intention.position !== '') fail('W-116. 真模型漏抽意向应归一为空，不能编造')

  // W-116：必须经过真实嵌套 DTO 校验，直接调用 renderer 会漏掉线上 400。
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })
  for (const intention of [{ position: '' }, {}, undefined]) {
    const input: Record<string, unknown> = { ...baseResume, intention, format: 'pdf' }
    if (intention === undefined) delete input['intention']
    const dto = await pipe.transform(input, {
      type: 'body', metatype: ResumeGenerateExportDto,
    }) as ResumeGenerateExportDto
    if (dto.intention.position !== '') fail('W-116. 无求职意向不得被编造为一个岗位')
    const { buffer, pageCount } = await new ResumePdfService().render(dto, { contentId: 'verify-w116-no-intention' })
    if (buffer.subarray(0, 4).toString() !== '%PDF' || pageCount < 1) fail('W-116. 无求职意向也必须能导出 PDF')
    const document = await openUnpdfDocument<{ destroy(): Promise<void> }>(new Uint8Array(buffer))
    try {
      const extracted = await extractPdfText(document, { mergePages: true })
      const text = Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text
      if (!text.includes(baseResume.basic.name) || text.includes('求职意向') || text.includes('意向城市')) {
        fail('W-116. PDF 必须保留姓名，且不得印空的求职意向标题')
      }
    } finally { await document.destroy() }
  }
  for (const position of [123, '岗'.repeat(61)]) {
    const invalid = plainToInstance(ResumeGenerateExportDto, { ...baseResume, intention: { position } })
    if (validateSync(invalid).length === 0) fail('W-116. 可选意向仍必须校验字符串类型和长度')
  }
  pass('W-116. 无求职意向也能通过导出 DTO 校验并生成 PDF，不印空标题、不编造岗位')
  // 只跑 W-116 的无数据库回归，供无法监听本地桩服务的沙箱执行；默认仍跑完整门禁。
  if (process.argv.includes('--export-only')) return

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

    // 事实核对只能去掉本次真正发出的标记。伪造的同形占位符里的数字仍是新数字。
    const forgedToken: StubMutate = (resume) => {
      resume.experience[0] = { ...resume.experience[0], description: '新增覆盖 ⦃abcdef:9⦄ 个模块。' }
    }
    setResponses([forgedToken, forgedToken])
    try {
      await svc.adjustLayoutDraft({ currentResume: baseResume, originalText: ORIGINAL_TEXT, action: 'condense' })
      fail('3. 伪造占位符带新数字应被拒绝')
    } catch (e) {
      if (errCode(e) !== 'AI_LAYOUT_ADJUST_INVALID_OUTPUT') fail(`3. 期望 AI_LAYOUT_ADJUST_INVALID_OUTPUT，实际 ${errCode(e)}`)
    }
    assertStubHealthy()
    pass('3d. 伪造占位符夹带新数字 → 拒绝')

    // 用户原文里本来就写着的形似占位符，不是本次标记，比对时里面的数字仍是事实。
    const userLiteralText = `${ORIGINAL_TEXT}\n备注 编号⦃a1b2c3:42⦄结束`
    const useLiteralNumber: StubMutate = (resume) => {
      resume.experience[0] = { ...resume.experience[0], description: '编号42，负责组件库维护。' }
    }
    setResponses([useLiteralNumber])
    const literalKept = await svc.adjustLayoutDraft({ currentResume: baseResume, originalText: userLiteralText, action: 'reformat' })
    assertStubHealthy()
    if (literalKept.resume.experience[0].description !== '编号42，负责组件库维护。') {
      fail('3e. 用户原文形似占位符里的数字应仍是事实，描述应保留')
    }
    pass('3e. 用户原文形似占位符里的数字仍是事实，比对不误拒')

    // 去标记只删本次集合里的标记，删处留空格，不把左右数字粘成新数字。
    {
      const issued = new Set(['⦃a1b2c3:1⦄'])
      if (stripLayoutTokensForFacts('123⦃a1b2c3:1⦄456', issued) !== '123 456') fail('3f. 去标记应留空格，避免数字粘连')
      if (stripLayoutTokensForFacts('⦃abcdef:9⦄', issued) !== '⦃abcdef:9⦄') fail('3f. 伪造标记不应被删除')
      if (stripLayoutTokensForFacts('⦃a1b2c3:42⦄', issued) !== '⦃a1b2c3:42⦄') fail('3f. 用户原文里的同形字不应被删除')
      if (stripLayoutTokensForFacts('电话⦃a1b2c3:1⦄123', issued) !== '电话 123') fail('3f. 标记紧挨数字时留空格分隔')
    }
    pass('3f. 事实核对只去本次真正发出的标记，删处留空格')

    // 走完整条排版：标记两边紧挨数字，去成空串会把 4 和 1.8 粘成原文没有的 41.8。
    const glued: StubMutate = (resume) => {
      resume.experience[0] = { ...resume.experience[0], description: `首屏从4${resume.basic.phone ?? ''}1.8秒。` }
    }
    setResponses([glued])
    const gluedKept = await svc.adjustLayoutDraft({ currentResume: baseResume, originalText: ORIGINAL_TEXT, action: 'reformat' })
    assertStubHealthy()
    if (gluedKept.resume.experience[0].description !== `首屏从4${baseResume.basic.phone}1.8秒。`) fail('3g. 标记紧挨数字的合法输出被误拒或没还原')
    pass('3g. 标记紧挨数字的合法输出不被误拒，号码照常还原')

    // 证书里的编号被遮成本次标记。字段值和原文按同一份去标记文本比，原样回抄不能被当成编造。
    const certNo = '软件设计师 证书编号 0123456789012'
    setResponses([null])
    const certKept = await svc.adjustLayoutDraft({
      currentResume: { ...baseResume, certificates: [...baseResume.certificates, certNo] },
      originalText: `${ORIGINAL_TEXT}\n证书 ${certNo}`,
      action: 'reformat',
    })
    assertStubHealthy()
    if (!lastUserPrompt.includes('软件设计师 证书编号 ⦃') || lastUserPrompt.includes('0123456789012')) fail('3h. 证书编号应以本次标记出站')
    if (!certKept.resume.certificates.includes(certNo)) fail('3h. 字段值夹着本次标记时被误拒或没还原')
    pass('3h. 字段值夹着本次标记，按同一份去标记文本比对，不误拒')

    // 14. 只写了公司、没写职务的经历（11/08 包 2 并入 B8 ② 时补）：版式调整照样保留，职务留空，也不许补出职务。
    if (!LAYOUT_ADJUST_SYSTEM_PROMPT.includes('只有公司没有职务的经历,role 留空字符串,仍保留该条经历,不得编造职务')) {
      fail('14c. 版式调整提示词必须写明：只有公司没有职务时 role 留空、保留该条、不得编造职务')
    }
    pass('14c. 提示词写明空职务留空、保留该条、不得编造')
    const COMPANY_ONLY_TEXT = `${ORIGINAL_TEXT}\n兼职经历 Bright Print Studio 2023 负责门店资料整理`
    const companyOnlyResume: GeneratedResume = {
      ...baseResume,
      experience: [
        ...baseResume.experience,
        { company: 'Bright Print Studio', role: '', period: '2023', description: '负责门店资料整理。' },
      ],
    }
    setResponses([null])
    const kept = await svc.adjustLayoutDraft({ currentResume: companyOnlyResume, originalText: COMPANY_ONLY_TEXT, action: 'reformat' })
    assertStubHealthy()
    const keptRow = kept.resume.experience.find((e) => e.company === 'Bright Print Studio')
    if (kept.resume.experience.length !== 2 || !keptRow) fail('14a. 只写公司的经历不得被版式调整丢掉')
    if (keptRow.role !== '') fail(`14a. 空职务应保持为空，实际 ${keptRow.role}`)
    pass('14a. 只写公司、没写职务的经历 → 保留，职务留空')

    // 求职意向里的岗位名在原文里，事实比对拦不住；要靠按公司名对回原条目那一道。
    const borrowRole: StubMutate = (resume) => { resume.experience[1] = { ...resume.experience[1], role: '前端开发工程师' } }
    setResponses([borrowRole, borrowRole])
    try {
      await svc.adjustLayoutDraft({ currentResume: companyOnlyResume, originalText: COMPANY_ONLY_TEXT, action: 'reformat' })
      fail('14b. 给空职务补出职务（借用求职意向的岗位名）应被拒绝')
    } catch (e) {
      if (errCode(e) !== 'AI_LAYOUT_ADJUST_INVALID_OUTPUT') fail(`14b. 期望 AI_LAYOUT_ADJUST_INVALID_OUTPUT，实际 ${errCode(e)}`)
    }
    assertStubHealthy()
    pass('14b. 空职务被补成原文别处的岗位名 → 拒绝')

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
    // 排版出站把引擎的 [手机号_N]、[邮箱_N] 换成这次请求的标记。号码仍不在，标记仍在。
    const layoutTokens = new Set(lastUserPrompt.match(layoutTokenPattern('g')) ?? [])
    if (layoutTokens.size < 2) {
      fail('9. 出站 prompt 未按可还原占位符形态遮盖联系方式')
    }
    pass('9. 去程：简历原始联系方式不出境，prompt 只含可还原占位符')

    if (result.resume.basic.phone !== baseResume.basic.phone) fail(`10. basic.phone 未还原为真值，实际 ${result.resume.basic.phone}`)
    if (result.resume.basic.email !== baseResume.basic.email) fail(`10. basic.email 未还原为真值，实际 ${result.resume.basic.email}`)
    // 模型自己写出来的文本里的占位符也必须被还原，否则用户简历上会印着 [手机号_1]
    if (!result.warnings.some((w) => w.includes(baseResume.basic.phone!))) {
      fail('10. 模型文本中的占位符未被还原为真值')
    }
    if (PLACEHOLDER_TOKEN.test(responseText) || layoutTokenPattern().test(responseText)) {
      fail('10. 产物残留遮盖占位符，用户会看到 [手机号_1] 这类文本')
    }
    pass('10. 回程：占位符在服务端还原为真值，产物无占位符残留')

    // 2026-11-12：简介、描述、技能、证书不再先截再查。完整文字留下；单字段超过 24000 才截并写明。
    {
      const desc700 = '负责门店货架整理与收银交接。'.repeat(50)
      const skill60 = '熟悉门店的收银对账。'.repeat(6)
      const cert70 = '食品从业人员健康证明'.repeat(7)
      if (desc700.length !== 700 || skill60.length !== 60 || cert70.length !== 70) {
        fail(`F3 排版夹具长度不对 ${desc700.length}/${skill60.length}/${cert70.length}`)
      }
      const current: GeneratedResume = {
        ...baseResume,
        experience: [{ ...baseResume.experience[0], description: desc700 }],
        skills: [...baseResume.skills, skill60],
        certificates: [...baseResume.certificates, cert70],
      }
      const original = `${ORIGINAL_TEXT}\n${desc700}\n${skill60}\n${cert70}`
      const keepLong: StubMutate = (resume) => {
        resume.experience[0] = { ...resume.experience[0], description: desc700 }
        if (!resume.skills.includes(skill60)) resume.skills.push(skill60)
        if (!resume.certificates.includes(cert70)) resume.certificates.push(cert70)
      }
      setResponses([keepLong])
      const keptLong = await svc.adjustLayoutDraft({ currentResume: current, originalText: original, action: 'reformat' })
      assertStubHealthy()
      if (keptLong.resume.experience[0].description !== desc700) {
        fail(`F3. 排版描述应完整保留 700 字，实际 ${keptLong.resume.experience[0].description.length} 字`)
      }
      if (!keptLong.resume.skills.includes(skill60)) fail('F3. 排版技能 60 字未完整保留')
      if (!keptLong.resume.certificates.includes(cert70)) fail('F3. 排版证书 70 字未完整保留')
      pass('F3. 排版调整描述 700 字、技能 60 字、证书 70 字完整保留（2026-11-12 起不再先截再查）')

      const note = '（内容过长，后面的部分请以原件为准）'
      setResponses([(resume) => { resume.summary = '整'.repeat(24001) }])
      const clipped = await svc.adjustLayoutDraft({ currentResume: baseResume, originalText: ORIGINAL_TEXT, action: 'reformat' })
      assertStubHealthy()
      if (clipped.resume.summary.length !== 24000 || !clipped.resume.summary.endsWith(note) || !clipped.resume.summary.startsWith('整')) {
        fail(`F3. 排版简介超过 24000 应截到 24000 并带说明，实际 ${clipped.resume.summary.length} 字`)
      }
      pass('F3. 排版调整单字段超过 24000 仍按 fitResumeToDocLimits 截断并写明内容过长')
    }

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
