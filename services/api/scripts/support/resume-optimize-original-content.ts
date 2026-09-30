import { LlmResumeOptimizeService } from '../../src/ai/resume/llm-resume-optimize.service'
import type { ResumeReport } from '../../src/ai/interfaces/ai-provider.interface'

const PLACEHOLDER_TOKEN = /\[(?:劳动者|用人单位|身份证|手机号|银行卡|邮箱|详细地址|统一社会信用代码)_\d+\]/u
type StubEntry = { kind: 'raw'; content: string }
const rawReply = (content: string): StubEntry => ({ kind: 'raw', content })
let responseQueue: StubEntry[] = []
let llmCallCount = 0
let sentMessages: Array<Array<{ role?: string; content?: string }>> = []
function setResponses(entries: StubEntry[]) { responseQueue = entries.slice(); llmCallCount = 0; sentMessages = [] }
function pass(message: string) { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(message) }

/** W-OPT-LOSS：仅替换 fetch 传输，真实优化编排、解析、遮盖与回填照常执行。 */
export async function verifyOriginalContent(): Promise<void> {
  const originalFetch = globalThis.fetch
  const cfg = {
    getApiKey: () => 'stub-key',
    getConfig: () => ({ enabled: true, vendor: 'deepseek', model: 'stub',
      baseURL: 'https://api.deepseek.com/v1', forbiddenWords: [] }),
  }
  const svc = new LlmResumeOptimizeService(cfg as never)
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role?: string; content?: string }> }
    sentMessages.push(body.messages)
    llmCallCount++
    const entry = responseQueue.shift()
    if (!entry || entry.kind !== 'raw') throw new Error('W-OPT-LOSS 桩队列耗尽或类型错误')
    return new Response(JSON.stringify({ choices: [{ message: { content: entry.content } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  const schoolLine = '青岛大学 新闻学 本科 2022.09-2026.06'
  const companyLine = '海川科技有限公司 2025年7月—2025年9月 产品运营实习生'
  const work = '负责校园服务内容整理和活动回访。'
  const source = ['林知夏', '教育经历', schoolLine, '实习经历', companyLine, work,
    '项目经历', '校园服务小程序 2025.03 - 2025.06', '整理同学反馈，维护服务说明。',
    '专业技能', 'Excel 数据整理', '证书', '大学英语六级'].join('\n')
  const report = { sections: [], suggestions: [], contentBlocks: [
    { key: 'education', label: '教育经历', lines: [schoolLine] },
    { key: 'experience', label: '工作经历', lines: [companyLine, work] },
  ] } as unknown as ResumeReport
  const complete = () => ({
    basic: { name: '林知夏' }, intention: { position: '' }, summary: '',
    education: [{ school: '青岛大学', major: '新闻学', degree: '本科' }],
    experience: [{ company: '海川科技有限公司', role: '产品运营实习生', description: work }],
    projects: [{ name: '校园服务小程序', description: '整理同学反馈，维护服务说明。' }],
    skills: ['Excel 数据整理'], certificates: ['大学英语六级'],
  })
  const reply = (resume: Record<string, unknown>) => rawReply(JSON.stringify({ resume, modules: [] }))
  const run = async (text: string, replies: StubEntry[], diagnosis = report) => {
    setResponses(replies)
    const result = await svc.optimize(text, diagnosis)
    return result
  }
  const omitEducation = () => ({ ...complete(), education: [] })
  try {
    {
      const out = await run(source, [reply(complete())])
      if (Number(llmCallCount) !== 1 || out.modules.some((m) => m.title.includes('保持原文'))
        || out.optimizedResume.education.length !== 1 || out.optimizedResume.experience.length !== 1
        || out.optimizedResume.projects.length !== 1 || out.optimizedResume.skills.length !== 1
        || out.optimizedResume.certificates.length !== 1) fail('W-OPT-LOSS (f). 完整输出不得误触发补回')
      pass('W-OPT-LOSS (f). 完整输出一次成功，不新增保持原文条目')
    }
    {
      // 标题后面只有杂句、前面没有同类事实条目：杂句不能变成一条「工作经历」去触发重试或被补回。
      const junk = ['周禾青', '工作经历', '照片见附件，证件照在微信里。', '教育经历', schoolLine].join('\n')
      const onlySchool = { sections: [], suggestions: [], contentBlocks: [
        { key: 'education', label: '教育经历', lines: [schoolLine] },
      ] } as unknown as ResumeReport
      const out = await run(junk, [reply({ ...complete(), basic: { name: '周禾青' }, experience: [], projects: [], skills: [], certificates: [] })], onlySchool)
      if (Number(llmCallCount) !== 1 || out.optimizedResume.experience.length !== 0
        || out.modules.some((m) => m.title.includes('保持原文'))) {
        fail('W-OPT-LOSS (h). 标题后的杂句不得新建经历条目、触发重试或被补回')
      }
      pass('W-OPT-LOSS (h). 标题后只有杂句时不新建条目，一次成功')
    }
    {
      const out = await run(source, [reply(omitEducation()), reply(complete())])
      if (Number(llmCallCount) !== 2 || !sentMessages[1]?.some((m) => m.role === 'system'
        && m.content?.includes('教育经历') && m.content.includes(schoolLine))) {
        fail('W-OPT-LOSS (a). 第二次重试必须明确点名教育经历和原文行')
      }
      if (out.modules.some((m) => m.title.includes('保持原文'))) fail('W-OPT-LOSS (a). 重试补齐后不得再补原文')
      pass('W-OPT-LOSS (a). 第二次提示点名教育经历及原文行，重试补齐')
    }
    {
      const out = await run(source, [reply(omitEducation()), reply(omitEducation())])
      if (Number(llmCallCount) !== 2 || out.optimizedResume.education[0]?.school !== schoolLine
        || !out.modules.some((m) => m.title === '教育经历（保持原文）' && m.before === schoolLine
          && m.after === '这一段没有改动，保留原文')) fail('W-OPT-LOSS (b). 两次漏教育必须原样补回并说明')
      pass('W-OPT-LOSS (b). 两次漏教育，原文整行与保持原文模块均保留')
    }
    {
      const out = await run(source, [reply(omitEducation()), rawReply('坏 JSON')])
      if (Number(llmCallCount) !== 2 || out.optimizedResume.education[0]?.school !== schoolLine) {
        fail('W-OPT-LOSS 回退. 首次合法缺教育、重试坏 JSON，必须成功返回首次结果并补教育')
      }
      pass('W-OPT-LOSS 回退. 首次合法缺教育、重试坏 JSON，结果 completed 且教育原样补回')
    }
    {
      const revised = { ...complete(), skills: ['使用 Excel 整理数据'], certificates: ['六级'] }
      const out = await run(source, [reply(revised)])
      if (Number(llmCallCount) !== 1 || out.optimizedResume.skills.length !== 1
        || out.modules.some((m) => m.title.includes('保持原文'))) fail('W-OPT-LOSS 整段. 技能改写和非空证书不得补重复')
      pass('W-OPT-LOSS 整段. 技能改写、证书非空，一次完成且无原文重复')
    }
    {
      const a = '晨岚科技有限公司 2020.01 - 2022.12'
      const b = '海川科技有限公司 2023.01 - 2025.12'
      const project = '校园服务小程序 2025.03 - 2025.06'
      const text = ['林知夏', '教育经历', schoolLine, '工作经历', a, '整理材料。', b, work,
        '项目经历', project, '整理同学反馈，维护服务说明。'].join('\n')
      const output = { ...complete(), projects: [], skills: [], certificates: [] }
      const modules = [
        { title: '教育优化', before: schoolLine, after: '保留教育事实' },
        { title: '经历优化', before: b, after: '整理校园服务内容' },
      ]
      const response = rawReply(JSON.stringify({ resume: output, modules }))
      const out = await run(text, [response, response], { sections: [], suggestions: [] } as unknown as ResumeReport)
      if (out.optimizedResume.experience.map((e) => e.company).join('|') !== `${a}|海川科技有限公司`
        || out.modules.map((m) => m.before).join('|') !== [schoolLine, a + '\n整理材料。', b, project + '\n整理同学反馈，维护服务说明。'].join('|')
        || out.modules.filter((m) => m.title.includes('保持原文')).map((m) => m.title).join('|') !== '工作经历（保持原文）|项目经历（保持原文）'
        || out.modules.filter((m) => m.title.includes('保持原文')).some((m) => m.after !== '这一段没有改动，保留原文')) {
        fail('W-OPT-LOSS 顺序. 补回经历 A 必须在 B 前，modules 按教育、A、B、项目排序')
      }
      pass('W-OPT-LOSS 顺序. experience 为 A、B；保持原文模块为 A、项目，插在模型模块之间或之后')
    }
    {
      const withoutRole = complete()
      withoutRole.experience[0].role = ''
      const out = await run(source, [reply(withoutRole), reply(withoutRole)])
      if (Number(llmCallCount) !== 1 || out.optimizedResume.experience[0]?.company !== '海川科技有限公司'
        || out.optimizedResume.experience[0]?.role !== '' || out.modules.length !== 0) {
        fail('W-OPT-LOSS (c). 公司无职务应直接保留，不靠原文补回')
      }
      pass('W-OPT-LOSS (c). 有公司无职务直接保留，role 为空串')
    }
    {
      const description = '负责校园服务内容整理和活动回访。'.repeat(100).slice(0, 1500)
      const output = complete()
      output.experience[0].description = description
      const text = source.replace(work, description)
      const out = await run(text, [reply(output)])
      if (out.optimizedResume.experience[0]?.description !== description) fail('W-OPT-LOSS (d). 1500 字描述不得截断')
      const invalid = complete()
      invalid.experience[0].description = description + description
      const retry = await run(text, [reply(invalid), reply(output)])
      if (Number(llmCallCount) !== 2 || retry.optimizedResume.experience[0]?.description !== description) {
        fail('W-OPT-LOSS (d+). 超过 2000 字须判非法重试，不能截断冒充成功')
      }
      pass('W-OPT-LOSS (d). 1500 字完整保留，超过 2000 字判非法重试')
    }
    {
      const prefix = source + '\n自我评价\n'
      const padding = '参与校园服务信息整理。'.repeat(1300)
      const tail = '\n证书\n普通话水平测试二级甲等\n项目经历\n社区服务资料归档 2026.07 - 2026.08\n整理纸质材料，完成目录归档。'
      const text = prefix + padding.slice(0, 13000 - prefix.length - tail.length) + tail
      if (text.length !== 13000) fail('W-OPT-LOSS (e). 超长夹具必须精确 13000 字')
      const out = await run(text, [reply(complete())])
      if (JSON.stringify(sentMessages).includes('普通话水平测试二级甲等')) fail('W-OPT-LOSS (e). 长尾不应送模型')
      if (!out.optimizedResume.certificates.includes('普通话水平测试二级甲等')
        || !out.optimizedResume.projects.some((p) => p.name === '社区服务资料归档 2026.07 - 2026.08'
          && p.description === '整理纸质材料，完成目录归档。')
        || !JSON.stringify(out.optimizedResume).includes(padding.slice(0, 13000 - prefix.length - tail.length))
        || !out.optimizedResume.summary.includes('简历过长，未送 AI 优化')
        || !out.modules.some((m) => m.after === '这一段没有改动，保留原文')) {
        fail('W-OPT-LOSS (e). 13000 字长尾与跨上限原文行须补回并说明未送 AI')
      }
      pass('W-OPT-LOSS (e). 精确 13000 字，跨界原文行、长尾证书及项目原样补回')
    }
    {
      const phoneLine = schoolLine + ' 联系电话 13853124680'
      const text = source.replace(schoolLine, phoneLine)
      const omitted = { ...complete(), education: [], experience: [], projects: [], skills: [], certificates: [] }
      const out = await run(text, [reply(omitted), reply(omitted)])
      const strings = [
        ...out.optimizedResume.education.flatMap((v) => [v.school, v.description ?? '']),
        ...out.optimizedResume.experience.flatMap((v) => [v.company, v.role, v.description]),
        ...out.optimizedResume.projects.flatMap((v) => [v.name, v.description]),
        ...out.optimizedResume.skills, ...out.optimizedResume.certificates,
      ]
      if (out.optimizedResume.education[0]?.school !== phoneLine || strings.some((v) => v && !text.includes(v))
        || PLACEHOLDER_TOKEN.test(JSON.stringify(out.optimizedResume))) fail('W-OPT-LOSS (g). 补回须逐字来自原文且还原联系方式')
      const second = JSON.stringify(sentMessages[1])
      if (second.includes('13853124680') || !second.includes('[手机号_')) fail('W-OPT-LOSS (g). 重试遗漏提示必须遮盖 PII')
      if (out.optimizedResume.experience[0]?.company !== companyLine || out.optimizedResume.experience[0]?.description !== work
        || out.optimizedResume.projects[0]?.name !== '校园服务小程序 2025.03 - 2025.06'
        || out.optimizedResume.projects[0]?.description !== '整理同学反馈，维护服务说明。'
        || out.optimizedResume.skills[0] !== 'Excel 数据整理' || out.optimizedResume.certificates[0] !== '大学英语六级') {
        fail('W-OPT-LOSS (g). 五数组及块后续描述必须全部原样补回')
      }
      pass('W-OPT-LOSS (g). 五数组补回均为原文，不添字，重试遮盖与回程还原正常')
    }
    {
      const text = '赵明远\n工作经历\n青岛智造有限公司 2020.09 - 2024.06\n维护仓储系统。\n海岳物流有限公司 2024.07—至今\n负责收货安排。'
      const partial = { ...complete(), education: [], projects: [], skills: [], certificates: [],
        experience: [{ company: '青岛智造有限公司', role: '', description: '维护仓储系统。' }] }
      const out = await run(text, [reply(partial), reply(partial)], { sections: [], suggestions: [] } as unknown as ResumeReport)
      if (out.optimizedResume.experience.length !== 2
        || out.optimizedResume.experience[1]?.company !== '海岳物流有限公司 2024.07—至今'
        || out.optimizedResume.experience[1]?.description !== '负责收货安排。') fail('W-OPT-LOSS 条目. 漏经历应只补漏项与描述')
      pass('W-OPT-LOSS 条目. 两段少一条，重试后只补漏项及后续描述')
    }
    {
      const line = '青岛大学 新闻学 本科 2022.09-2026.06 主修新闻采访与写作，参与校园新闻采编。'
      const text = '林知夏\n' + line
      const empty = { ...complete(), education: [], experience: [], projects: [], skills: [], certificates: [] }
      const diagnosis = { sections: [], suggestions: [], contentBlocks: [
        { key: 'education', label: '教育经历', lines: [line.slice(0, 30)] },
      ] } as unknown as ResumeReport
      const out = await run(text, [reply(empty), reply(empty)], diagnosis)
      if (out.optimizedResume.education[0]?.school !== line) fail('W-OPT-LOSS 锚点. 无标题的报告摘录必须回配完整原文行')
      pass('W-OPT-LOSS 锚点. 无标题、被截短的报告摘录回配完整教育原文')
    }
    {
      const output = complete()
      const incomplete = { ...output,
        education: [{ major: '新闻学', description: '' }],
        projects: [{ role: '项目成员', description: '整理同学反馈，维护服务说明。' }],
      }
      const text = source.replace('整理同学反馈，维护服务说明。', '项目成员\n整理同学反馈，维护服务说明。')
      const out = await run(text, [reply(incomplete)])
      if (out.optimizedResume.education[0]?.school !== '' || out.optimizedResume.education[0]?.major !== '新闻学'
        || out.optimizedResume.projects[0]?.name !== '' || out.optimizedResume.projects[0]?.role !== '项目成员') {
        fail('W-OPT-LOSS 缺字段. 教育缺学校、项目缺名但有原文事实的条目不能静默跳过')
      }
      pass('W-OPT-LOSS 缺字段. 教育和项目缺主字段仍保留已有原文事实')
    }
  } finally {
    globalThis.fetch = originalFetch
  }
}

