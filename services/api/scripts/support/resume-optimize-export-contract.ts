import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ValidationPipe } from '@nestjs/common'
import { ResumeDraftPutDto } from '../../src/ai/dto/resume-draft.dto'
import { ResumeGenerateExportDto, ResumeLayoutAdjustDto } from '../../src/ai/dto/resume-generate.dto'
import type { GeneratedResume, ResumeReport } from '../../src/ai/interfaces/ai-provider.interface'
import { LlmResumeOptimizeService, type OptimizeResult } from '../../src/ai/resume/llm-resume-optimize.service'
import { fitResumeToDocLimits, RESUME_DOC_LIMITS } from '../../src/ai/resume/resume-doc-limits'
import { ResumeDocxService } from '../../src/ai/resume/resume-docx.service'
import { ResumePdfService } from '../../src/ai/resume/resume-pdf.service'
import { ResumeTextService } from '../../src/ai/resume/resume-text.service'
import { extractResumeExperienceCandidates } from '../../src/ai/resume/resume-structure'
import { extractPdfText, extractPdfTextItems, openUnpdfDocument, type PdfTextItem } from '../../src/common/pdf/pdfjs-document'

/**
 * W-OPT-EXPORT：优化接口吐出来的任何结果，原样交给导出 / 排版调整 / 存草稿都必须过校验，
 * 并且真的能印出来。
 *
 * 来由（2026-10-03 走查，bb49ea064）：补回的经历 role 为空、提示词第 9 条也让模型把 role 留空，
 * 而导出校验要求 role 非空 —— 只要有一条经历只写了公司，用户就拿不到优化版（5 次全 400）。
 * 当时的门禁只验了「补回了没有」，没验「补回之后导不导得出去」。这里把后半段补上：
 * 每个样本都走真实的优化编排（只替换模型传输）→ JSON 往返 → 与 main.ts 相同配置的
 * ValidationPipe → 真实 PDF 渲染 → 从 PDF 里读回文字。
 */
function pass(message: string) { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(message) }

// 与 src/main.ts 的全局管道同配置；下面第 0 条断言钉住这三项没有被改掉。
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
const squash = (value: string) => value.replace(/\s+/gu, '')

async function validate(metatype: new () => object, payload: unknown, label: string): Promise<void> {
  try {
    await pipe.transform(JSON.parse(JSON.stringify(payload)), { type: 'body', metatype })
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.()
    fail(`${label} 没过校验：${JSON.stringify(response).slice(0, 300)}`)
  }
}

/** 一份优化稿必须同时被三个接收端接受。 */
async function acceptedEverywhere(resume: GeneratedResume, label: string): Promise<void> {
  await validate(ResumeGenerateExportDto, { ...resume, taskId: 'opt-export-contract', format: 'pdf' }, `${label} → 导出`)
  await validate(ResumeLayoutAdjustDto, { resume, action: 'reformat' }, `${label} → 排版调整`)
  await validate(ResumeDraftPutDto, { resume }, `${label} → 存草稿`)
}

async function pdfText(resume: GeneratedResume): Promise<string> {
  const rendered = await new ResumePdfService().render(resume, { contentId: 'opt-export-contract' } as never)
  const pdf = await openUnpdfDocument(new Uint8Array(rendered.buffer))
  const { text } = await extractPdfText(pdf, { mergePages: true })
  return squash(Array.isArray(text) ? text.join('') : text)
}

// 走查用的四份虚构样本（文字层原样）。前三份没有任何栏目标题，是一体机上最常见的「一段话简历」。
const ZHOU_MIN = ['周敏', '女，23 岁。快递分拣。已经是会员，想把一页简历打出来。',
  '青岛崂山某配送服务有限公司 2024.07 至今 夜班分拣。', '手机 13800000614。青岛市示例路614号（虚构）。',
  '现居青岛市，本文件为虚构示例。'].join('\n')
const SHANGGUAN_YAN = ['上官燕', '女，29 岁。灵活就业，做过物业客服和活动执行。',
  '青岛小麦岛某物业服务有限公司 2022—2025 客服。', '手机 13800000627。青岛市示例路627号（虚构）。',
  '现居青岛市，本文件为虚构示例。'].join('\n')
const OUYANG_CHUNMEI = ['欧阳春梅', '女，54 岁。超市理货做了十几年，现在想转成仓管或收货。',
  '青岛金沙滩某商贸有限公司，2011 年到 2025 年，理货、收货都干过。', '2025 年 8 月岗位没了。',
  '照片见附件。女儿说微信里有证件照，这个 PDF 里没嵌进去。', '手机 13800000602。青岛市示例路602号（虚构）。',
  '现居青岛市，本文件为虚构示例。', '想打印的东西', '黑白 2 份就行。彩色不会弄。',
  '文件是女儿前天夜里发到微信的，她自己不大会从手机往外导。', '现居青岛市，本文件为虚构示例。'].join('\n')
const ZHUGE_XIAOYU = ['诸葛小雨', '个人信息', '性别：女 年龄：23 岁 政治面貌：共青团员',
  '手机：13800000616 邮箱：zhuge.xiaoyu@example.com', '现居：青岛市黄岛区', '求职意向', '行政专员 / 前台文员 期望城市：青岛',
  '教育经历', '示例·黄岛某高校 行政管理 本科 2022.09 - 2026.06', '主修课程：管理学原理、公文写作、办公自动化、人力资源管理',
  '实习经历', '青岛金沙滩某商贸有限公司 前台实习生 2025.07 - 2025.08', '负责来访登记和电话转接，每天接待来访约 30 人次。',
  '整理快递收发台账，两个月里没有出现漏登。', '示例·黄岛某高校学院办公室 学生助理 2024.03 - 2025.06',
  '协助老师整理学生档案，录入奖学金申请材料。', '校园经历', '学生会生活部 干事 2023.09 - 2024.06',
  '参与组织宿舍文化节，负责报名表收集和物资清点。', '技能证书', '计算机二级（MS Office）、普通话二级甲等、大学英语四级',
  '自我评价', '做事细心，习惯把每天的事项列成清单，愿意从基础岗位做起。'].join('\n')

const EMPTY_REPORT = { sections: [], suggestions: [] } as unknown as ResumeReport
const blank = (name: string) => ({
  basic: { name }, intention: { position: '' }, summary: '',
  education: [] as unknown[], experience: [] as unknown[], projects: [] as unknown[], skills: [] as string[], certificates: [] as string[],
})

export async function verifyOptimizeExportContract(): Promise<void> {
  const originalFetch = globalThis.fetch
  let queue: string[] = []
  globalThis.fetch = async () => {
    const content = queue.shift()
    if (content === undefined) throw new Error('W-OPT-EXPORT 桩队列耗尽')
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  const svc = new LlmResumeOptimizeService({
    getApiKey: () => 'stub-key',
    getConfig: () => ({ enabled: true, vendor: 'deepseek', model: 'stub', baseURL: 'https://api.deepseek.com/v1', forbiddenWords: [] }),
  } as never)
  /** 模型两次都给同一份回包：第一次缺条目会触发重试，第二次仍缺就走补回。 */
  const optimize = async (text: string, resume: Record<string, unknown>, report = EMPTY_REPORT): Promise<OptimizeResult> => {
    const reply = JSON.stringify({ resume, modules: [] })
    queue = [reply, reply]
    return svc.optimize(text, report)
  }

  try {
    {
      const main = readFileSync(resolve(__dirname, '../../src/main.ts'), 'utf8')
      for (const flag of ['whitelist: true', 'forbidNonWhitelisted: true', 'transform: true']) {
        if (!main.includes(flag)) fail(`W-OPT-EXPORT (0). main.ts 的全局校验管道不再含 ${flag}，本门禁的管道要跟着改`)
      }
      pass('W-OPT-EXPORT (0). 本门禁用的校验管道与 main.ts 全局管道同配置')
    }

    // ── 1. 挡发布的那一条：补回路径，原样导出必须过校验，PDF 里要有那条经历 ─────────────
    {
      const out = await optimize(ZHOU_MIN, blank('周敏'))
      const exp = out.optimizedResume.experience
      if (exp.length !== 1 || exp[0].role !== '') fail(`W-OPT-EXPORT (1). 夹具应补回一条职务为空的经历，实际 ${JSON.stringify(exp)}`)
      await acceptedEverywhere(out.optimizedResume, '补回出的优化稿（职务为空）')
      const text = await pdfText(out.optimizedResume)
      for (const piece of ['青岛崂山某配送服务有限公司', '2024.07至今', '夜班分拣']) {
        if (!text.includes(squash(piece))) fail(`W-OPT-EXPORT (1). 导出的 PDF 里找不到「${piece}」`)
      }
      if (text.includes('青岛崂山某配送服务有限公司·2024') || /有限公司·(?=夜班|$)/u.test(text)) {
        fail('W-OPT-EXPORT (1). 职务为空时 PDF 不能印出悬空的「 · 」')
      }
      pass('W-OPT-EXPORT (1). 补回出的优化稿（职务为空）三处都过校验，PDF 里有公司、时间段和描述，没有悬空分隔符')
    }

    // ── 2. 提示词第 9 条路径：模型自己把 role 留空，学校 / 项目名称也可能缺 ────────────────
    {
      const work = '负责校园服务内容整理和活动回访。'
      const source = ['林知夏', '教育经历', '青岛大学 新闻学 本科 2022.09-2026.06', '实习经历',
        '海川科技有限公司 2025年7月—2025年9月', work, '项目经历', '校园服务小程序 2025.03 - 2025.06', '项目成员',
        '整理同学反馈，维护服务说明。'].join('\n')
      const long = work.repeat(120).slice(0, 1900)
      const model = { ...blank('林知夏'),
        education: [{ major: '新闻学', degree: '本科' }],
        experience: [{ company: '海川科技有限公司', role: '', description: long }],
        projects: [{ role: '项目成员', description: '整理同学反馈，维护服务说明。' }],
      }
      const out = await optimize(source.replace(work, long), model)
      const r = out.optimizedResume
      if (!r.experience.some((e) => e.company === '海川科技有限公司' && e.role === '' && e.description === long)) {
        fail('W-OPT-EXPORT (2). 夹具应保留模型给出的「有公司无职务、1900 字描述」的经历')
      }
      if (!r.education.some((e) => e.school === '') || !r.projects.some((p) => p.name === '')) {
        fail('W-OPT-EXPORT (2). 夹具应含缺学校的学历和缺名称的项目')
      }
      await acceptedEverywhere(r, '模型按第 9 条留空的优化稿')
      const text = await pdfText(r)
      if (!text.includes(squash(long.slice(0, 200)))) fail('W-OPT-EXPORT (2). 1900 字描述没有印进 PDF')
      pass('W-OPT-EXPORT (2). 模型留空职务 / 缺学校 / 缺项目名称、描述 1900 字：三处都过校验并印出')
    }

    // ── 3. 同类隐患：补回的首行是一句超过 100 字的长话；技能一行很长；条目很多 ────────────
    {
      const sentence = `青岛胶州湾某食品加工有限公司 2019.03 - 2024.10 ${'在包装车间做过装箱、贴标、码垛和夜班质检，后来带过三个人的小组，'.repeat(4)}也帮着盘点。`
      if (sentence.length <= 100) fail('W-OPT-EXPORT (3). 夹具首行必须超过 100 字')
      const projectLine = `社区便民服务站志愿活动 2023.05 - 2023.09 ${'每个周末帮老人登记医保、打印材料、整理报名表，'.repeat(5)}一共去了十几次。`
      const skillLine = `办公软件：${'Word 排版、Excel 透视表与常用函数、PPT 汇报、WPS 表格、钉钉与企业微信日常使用、'.repeat(4)}五笔打字`
      const many = Array.from({ length: 24 }, (_, i) => `青岛市北某商贸有限公司第${i + 1}门店 20${String(i % 20).padStart(2, '0')}.01 - 20${String(i % 20).padStart(2, '0')}.12 理货员`)
      const source = ['孙海山', '工作经历', sentence, ...many, '项目经历', projectLine, '专业技能', skillLine].join('\n')
      if (!extractResumeExperienceCandidates(source).some((c) => c.line === sentence)) fail('W-OPT-EXPORT (3). 夹具长句必须被识别为经历候选')
      const out = await optimize(source, blank('孙海山'))
      const r = out.optimizedResume
      await acceptedEverywhere(r, '长首行 / 长技能行 / 25 条经历的优化稿')
      const all = squash(JSON.stringify(r))
      for (const piece of [sentence.slice(40, 120), projectLine.slice(30, 90), skillLine.slice(0, 60), '青岛市北某商贸有限公司第24门店', '青岛市北某商贸有限公司第1门店']) {
        if (!all.includes(squash(piece))) fail(`W-OPT-EXPORT (3). 收进上限时丢了内容：「${piece.slice(0, 30)}…」`)
      }
      if (r.experience.length > RESUME_DOC_LIMITS.experience || r.skills.some((s) => s.length > RESUME_DOC_LIMITS.skill)) {
        fail('W-OPT-EXPORT (3). 出口收口没有生效')
      }
      const text = await pdfText(r)
      if (!text.includes(squash(sentence.slice(40, 100))) || !text.includes('青岛市北某商贸有限公司第24门店')) {
        fail('W-OPT-EXPORT (3). 长句经历或第 24 条经历没有印进 PDF')
      }
      pass('W-OPT-EXPORT (3). 首行超 100 字、技能一行超 200 字、经历 25 条：不丢内容，三处都过校验并印出')
    }

    // ── 4. 教育经历只有学校没有专业 ────────────────────────────────────────────────────
    {
      const source = ['马桂兰', '教育经历', '青岛市城阳区某职业中学', '工作经历', '城阳某服装厂 2001年3月—2019年12月 缝纫工', '做过平车和锁边。'].join('\n')
      const out = await optimize(source, blank('马桂兰'))
      const r = out.optimizedResume
      if (r.education[0]?.school !== '青岛市城阳区某职业中学' || r.education[0]?.major !== undefined) fail('W-OPT-EXPORT (4). 只有学校的学历应原样补回，专业留空')
      if (r.experience[0]?.role !== '缝纫工' || r.experience[0]?.period !== '2001年3月—2019年12月') fail('W-OPT-EXPORT (4). 首行里原件写的职务与时间段应拆出来')
      await acceptedEverywhere(r, '只有学校没有专业的优化稿')
      const text = await pdfText(r)
      if (!text.includes('青岛市城阳区某职业中学') || !text.includes(squash('城阳某服装厂 · 缝纫工'))) fail('W-OPT-EXPORT (4). PDF 里应有学校与「公司 · 职务」')
      pass('W-OPT-EXPORT (4). 只有学校没有专业：原样补回并导出；首行里的职务与时间段拆到各自位置')
    }

    // ── 5–8. 走查坐实的四条确定性缺陷，用走查的样本复现 ───────────────────────────────────
    {
      if (!extractResumeExperienceCandidates(ZHOU_MIN).some((c) => c.line.includes('2024.07 至今'))) {
        fail('W-OPT-EXPORT (5). 「2024.07 至今」必须被识别成时间段')
      }
      for (const line of ['某公司 2021.09-至今 客服', '某公司 2023年3月至今', '某公司 2020.1~现在 店员', '某公司 2019 年到 2022 年 保洁']) {
        if (extractResumeExperienceCandidates(`张三\n工作经历\n${line}`).length !== 1) fail(`W-OPT-EXPORT (5). 时间段写法没认出来：${line}`)
      }
      pass('W-OPT-EXPORT (5). 「2024.07 至今」及同类写法都识别成时间段，在职经历不再丢')
    }
    {
      for (const [name, source, phone] of [['周敏', ZHOU_MIN, '13800000614'], ['上官燕', SHANGGUAN_YAN, '13800000627'], ['欧阳春梅', OUYANG_CHUNMEI, '13800000602']] as const) {
        const out = await optimize(source, blank(name))
        const described = out.optimizedResume.experience.map((e) => `${e.company}\n${e.description}`).join('\n')
        if (described.includes(phone) || described.includes('示例路') || described.includes('现居青岛市')) {
          fail(`W-OPT-EXPORT (6). ${name}：联系方式 / 住址 / 页脚被并进了经历：${described.slice(0, 160)}`)
        }
        if (out.optimizedResume.experience.length !== 1) fail(`W-OPT-EXPORT (6). ${name}：应只有一条经历，实际 ${out.optimizedResume.experience.length}`)
      }
      const zhuge = await optimize(ZHUGE_XIAOYU, { ...blank('诸葛小雨'), summary: '做事细心，愿意从基础岗位做起。', skills: ['计算机二级（MS Office）'] })
      const texts = [...zhuge.optimizedResume.experience, ...zhuge.optimizedResume.projects].map((e) => e.description).join('\n')
      for (const title of ['技能证书', '校园经历', '自我评价']) {
        if (texts.split('\n').some((line) => line.trim() === title)) fail(`W-OPT-EXPORT (6). 下一栏标题「${title}」被并进了描述`)
      }
      pass('W-OPT-EXPORT (6). 补回的经历到联系方式 / 住址 / 下一栏标题为止，手机号不进描述')
    }
    {
      const zhou = await optimize(ZHOU_MIN, blank('周敏'))
      if (!zhou.optimizedResume.summary.includes('快递分拣')) fail('W-OPT-EXPORT (7). 没有栏目标题的自述句没有补回')
      const ouyang = await optimize(OUYANG_CHUNMEI, blank('欧阳春梅'))
      if (!ouyang.optimizedResume.summary.includes('想转成仓管或收货')) fail('W-OPT-EXPORT (7). 自述里的求职岗位没有补回')
      const zhuge = await optimize(ZHUGE_XIAOYU, { ...blank('诸葛小雨'), summary: '做事细心，愿意从基础岗位做起。', skills: ['计算机二级（MS Office）'] })
      if (!zhuge.optimizedResume.intention.position.includes('行政专员')) fail('W-OPT-EXPORT (7). 「求职意向」栏下的岗位没有补回')
      // 联系方式行之后的自我介绍（没有栏目标题）不能被当成杂句丢掉；联系方式本身仍不进简介和经历。
      const tailIntro = ['郝建民', '青岛李沧某物流有限公司 2018.03 - 2024.09 叉车司机', '负责仓库装卸和盘点。',
        '电话 13853219907，住李沧区示例路 9 号。', '本人干活踏实，持有叉车证，能上夜班，想找一份离家近的仓库工作。'].join('\n')
      const hao = await optimize(tailIntro, blank('郝建民'))
      if (!hao.optimizedResume.summary.includes('本人干活踏实，持有叉车证，能上夜班，想找一份离家近的仓库工作。')) {
        fail('W-OPT-EXPORT (7). 联系方式之后的自我介绍被丢掉了')
      }
      if (hao.optimizedResume.summary.includes('13853219907') || hao.optimizedResume.experience[0]?.description !== '负责仓库装卸和盘点。') {
        fail(`W-OPT-EXPORT (7). 联系方式进了简介，或经历描述不对：${JSON.stringify(hao.optimizedResume.experience)}`)
      }
      await acceptedEverywhere(hao.optimizedResume, '联系方式之后有自我介绍')
      // 有栏目标题的写法同样保留。
      const headed = await optimize(tailIntro.replace('本人干活踏实', '自我评价\n本人干活踏实'), blank('郝建民'))
      if (!headed.optimizedResume.summary.includes('本人干活踏实')) fail('W-OPT-EXPORT (7). 联系方式之后「自我评价」栏的内容被丢掉了')
      // 「技能证书」这种合并栏目下的内容，模型没写技能时也要补回，不能跟着标题一起丢。
      const noSkills = await optimize(ZHUGE_XIAOYU, { ...blank('诸葛小雨'), summary: '做事细心，愿意从基础岗位做起。' })
      if (!noSkills.optimizedResume.skills.join('、').includes('普通话二级甲等')) fail('W-OPT-EXPORT (7). 「技能证书」栏下的内容没有补回')
      // 模型已经写了个人简介时不再把自述原文叠一遍。
      const written = await optimize(ZHOU_MIN, { ...blank('周敏'), summary: '从事快递分拣工作。' })
      if (written.optimizedResume.summary !== '从事快递分拣工作。') fail('W-OPT-EXPORT (7). 模型已写个人简介时不应再叠加自述原文')
      await acceptedEverywhere(zhou.optimizedResume, '周敏')
      await acceptedEverywhere(ouyang.optimizedResume, '欧阳春梅')
      await acceptedEverywhere(zhuge.optimizedResume, '诸葛小雨')
      pass('W-OPT-EXPORT (7). 无标题自述句、自述里的求职岗位、「求职意向」栏都补回；模型已写简介时不重复')
    }
    {
      // 走查时模型把第二段实习和校园经历并进了第一段的描述。
      const merged = { ...blank('诸葛小雨'), summary: '做事细心，愿意从基础岗位做起。', skills: ['计算机二级（MS Office）'],
        intention: { position: '行政专员' },
        education: [{ school: '示例·黄岛某高校', major: '行政管理', degree: '本科', period: '2022.09 - 2026.06' }],
        experience: [{ company: '青岛金沙滩某商贸有限公司', role: '前台实习生', period: '2025.07 - 2025.08',
          description: ['· 负责来访登记和电话转接，每天接待来访约 30 人次。', '· 整理快递收发台账，两个月里没有出现漏登。',
            '· 示例·黄岛某高校学院办公室 学生助理 2024.03 - 2025.06', '· 协助老师整理学生档案，录入奖学金申请材料。',
            '· 校园经历', '· 学生会生活部 干事 2023.09 - 2024.06', '· 参与组织宿舍文化节，负责报名表收集和物资清点。'].join('\n') }],
      }
      const out = await optimize(ZHUGE_XIAOYU, merged)
      const r = out.optimizedResume
      const whole = JSON.stringify(r)
      for (const once of ['协助老师整理学生档案', '参与组织宿舍文化节', '学生会生活部']) {
        if (whole.split(once).length - 1 !== 1) fail(`W-OPT-EXPORT (8). 「${once}」应恰好出现一次，实际 ${whole.split(once).length - 1} 次`)
      }
      if (r.experience.length !== 2 || r.projects.length !== 1 || r.experience[0].description.split('\n').length !== 2) {
        fail(`W-OPT-EXPORT (8). 应拆回两段实习加一段校园经历，实际 ${r.experience.length}/${r.projects.length}：${r.experience[0].description}`)
      }
      await acceptedEverywhere(r, '模型合并经历后的优化稿')
      pass('W-OPT-EXPORT (8). 模型把两段经历并成一段时，补回后每段只出现一次')
    }

    // ── 9. 出口收口本身：任意超限输入收进上限、内容不丢 ───────────────────────────────────
    {
      const L = RESUME_DOC_LIMITS
      const fat: GeneratedResume = {
        basic: { name: '某'.repeat(L.name + 10) }, intention: { position: '' }, summary: '简介。',
        education: Array.from({ length: L.education + 3 }, (_, i) => ({ school: `第${i}所学校`, major: '专业'.repeat(40), degree: '学位'.repeat(15), period: '时间'.repeat(30) })),
        experience: Array.from({ length: L.experience + 5 }, (_, i) => ({ company: `第${i}家公司${'长'.repeat(i === 0 ? 120 : 0)}`, role: '职'.repeat(i === 1 ? 80 : 2), description: `第${i}段描述` })),
        projects: Array.from({ length: L.projects + 2 }, (_, i) => ({ name: `第${i}个项目`, role: undefined, description: `第${i}个项目的描述` })),
        skills: Array.from({ length: L.skills + 4 }, (_, i) => `技能${i}`),
        certificates: ['证'.repeat(L.certificate + 50)],
      } as unknown as GeneratedResume
      const fitted = fitResumeToDocLimits(fat)
      await acceptedEverywhere(fitted, '超限样本收口后')
      const all = JSON.stringify(fitted)
      for (const piece of [`第${L.experience + 4}段描述`, `第${L.projects + 1}个项目的描述`, `技能${L.skills + 3}`, `第${L.education + 2}所学校`, '长'.repeat(120), '职'.repeat(80)]) {
        if (!all.includes(piece)) fail(`W-OPT-EXPORT (9). 收口丢了内容：${piece.slice(0, 20)}`)
      }
      if ((all.match(/证/gu) ?? []).length !== L.certificate + 50) fail('W-OPT-EXPORT (9). 超长证书拆条时丢字')
      pass('W-OPT-EXPORT (9). 超限的标题 / 职务 / 条目数 / 技能证书都收进上限，内容一字不丢，三处都过校验')
    }

    // ── 10. Word 与文本导出同样不印悬空分隔符 ─────────────────────────────────────────
    {
      const out = await optimize(ZHOU_MIN, blank('周敏'))
      const text = new ResumeTextService()
      const rendered = [
        (text as unknown as { renderTxt?: (r: GeneratedResume) => string }).renderTxt?.(out.optimizedResume),
        (text as unknown as { renderMarkdown?: (r: GeneratedResume) => string }).renderMarkdown?.(out.optimizedResume),
      ].filter((value): value is string => typeof value === 'string')
      if (rendered.length === 0) fail('W-OPT-EXPORT (10). 文本导出方法名变了，本条断言要跟着改')
      for (const body of rendered) {
        if (/·\s*(?:（|\*\*|$)/mu.test(body) || !body.includes('青岛崂山某配送服务有限公司')) fail(`W-OPT-EXPORT (10). 文本导出有悬空分隔符或丢了公司：${body.slice(0, 200)}`)
      }
      const docx = await new ResumeDocxService().render(out.optimizedResume as never, { contentId: 'opt-export-contract' })
      if (!docx || !(docx as { buffer?: Buffer }).buffer?.length) fail('W-OPT-EXPORT (10). Word 导出失败')
      pass('W-OPT-EXPORT (10). 文本 / Markdown / Word 导出职务为空的经历：不留悬空分隔符')
    }

    // ── 11. 标题过长时 PDF 里文字不能叠在一起（R-1 / R-2，走查样本 6）───────────────────────
    {
      // 样本 6：时间段写在行首，后面是一句 97 字的话。补回时这句话不能当公司标题。
      const sentence = '一直在胶州城郊的一个物流仓库里干活，开始跟着老师傅卸车码垛，后来考了证开叉车，旺季的时候一个晚上要倒四十多托货，中间还替班长盯过半年夜班的出库单。'
      const s6 = ['郭鹏', '男，41 岁。想找叉车或者仓库的活。', `2019 年 3 月到 2024 年 12 月 ${sentence}`,
        '每个月底跟着盘一次库，五年多下来没出过大的差错。', '手机 13800000613。'].join('\n')
      // 诊断报告把这一行摘成工作经历（走查时正是这样；没有报告锚点时这行不带「公司」字样，不会被认成经历）。
      const s6Report = { sections: [], suggestions: [], contentBlocks: [
        { key: 'experience', label: '工作经历', lines: [`2019 年 3 月到 2024 年 12 月 ${sentence}`.slice(0, 40)] },
      ] } as unknown as ResumeReport
      const guo = await optimize(s6, blank('郭鹏'), s6Report)
      const exp = guo.optimizedResume.experience
      if (exp.length !== 1 || exp[0].company !== '' || exp[0].period !== '2019 年 3 月到 2024 年 12 月' || !exp[0].description.startsWith(sentence)) {
        fail(`W-OPT-EXPORT (11). 样本 6：整句应进描述、单位留空、时间段单独放，实际 ${JSON.stringify(exp)}`)
      }
      await acceptedEverywhere(guo.optimizedResume, '样本 6')
      // 项目经历同理：首行是一句短话（不到 100 字、带句读），也不当项目名称。
      const projectSentence = '社区便民服务站 2023.05 - 2023.09 每周末帮老人登记医保、打印材料。'
      const proj = await optimize(['冯晓梅', '项目经历', projectSentence, '一共去了十几次。'].join('\n'), blank('冯晓梅'))
      const restored = proj.optimizedResume.projects[0]
      if (restored?.name !== '' || !restored.description.startsWith(projectSentence)) {
        fail(`W-OPT-EXPORT (11). 像句子的项目首行不应当项目名称：${JSON.stringify(proj.optimizedResume.projects)}`)
      }
      if ((await overlaps(guo.optimizedResume)).length) fail(`W-OPT-EXPORT (11). 样本 6 的 PDF 有文字重叠：${JSON.stringify(await overlaps(guo.optimizedResume))}`)

      // 用户在页面上自己把单位、职务改得很长时，排版同样不能叠字（6 月起的老问题，公司加职务超过约 27 字就会触发）。
      const longCompany = '青岛西海岸新区某某国际物流供应链管理服务有限公司胶州湾保税港区第三分公司'
      const longRole = '仓储主管兼夜班叉车调度及出库单据复核负责人'
      const cases: Array<[string, string, string]> = [
        ['超长单位', longCompany, '叉车工'],
        ['超长职务', '某物流公司', longRole],
        ['超长单位加职务', longCompany, longRole],
      ]
      for (const columns of [1, 2] as const) {
        for (const [label, company, role] of cases) {
          const resume = { ...guo.optimizedResume, experience: [
            { company, role, period: '2019.03 - 2024.12', description: '负责装卸、码垛与夜班出库；每月底参与盘库，五年没有出过大的差错。' },
            { company: '胶州某超市', role: '理货员', period: '2016.05 - 2019.02', description: '负责货架补货与临期商品下架。' },
          ] }
          await acceptedEverywhere(resume, label)
          const hits = await overlaps(resume, columns)
          if (hits.length) fail(`W-OPT-EXPORT (11). ${label}（${columns} 栏）的 PDF 文字重叠：${JSON.stringify(hits.slice(0, 2))}`)
        }
      }
      pass('W-OPT-EXPORT (11). 样本 6 整句进描述；超长单位 / 职务 / 两者都长，单栏与双栏 PDF 文字框按坐标都不重叠')
    }
  } finally {
    globalThis.fetch = originalFetch
  }
}

/**
 * 按坐标找 PDF 里互相压住的两段文字：横向有重叠、纵向基线差小于字高的八成。
 * 同一行相邻的文字横向不重叠，相邻两行纵向相差至少一个行高，都不会误报。
 */
async function overlaps(resume: GeneratedResume, columns: 1 | 2 = 1): Promise<string[]> {
  const rendered = await new ResumePdfService().render(resume, { layout: { columns }, contentId: 'opt-export-contract' } as never)
  const { items } = await extractPdfTextItems(await openUnpdfDocument(new Uint8Array(rendered.buffer)))
  const hits: string[] = []
  for (const page of items) {
    const boxes = page.filter((item: PdfTextItem) => item.str.trim() && item.width > 0)
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
        const height = Math.min(a.height || a.fontSize, b.height || b.fontSize)
        if (xOverlap > 1 && Math.abs(a.y - b.y) < height * 0.8) hits.push(`「${a.str.slice(0, 12)}」×「${b.str.slice(0, 12)}」`)
      }
    }
  }
  return hits
}
