/**
 * 简历文字里的「部首字符」换回常用字（真机实操 F-24，2026-10-11）。
 *
 * 起因：线上 AI 简历优化对一份规规矩矩的 PDF 连着六次都被防编造校验判作废。原因不是模型编造：
 * 那份 PDF 的文字层里「青、大、心、车」等 21 种字存的是外形相同的部首字符（Unicode 康熙部首、
 * 部首补充两段），模型按常用字写学校、学历、公司、证书，逐字比全都「不在原文」。
 *
 * 覆盖：
 *   1. 对照表：条数、校验值、每一条的形状；康熙部首 214 条与 Node 自带的 NFKC 逐条相同（独立来源）；
 *      真机上见到的那 21 个字逐个对上；只动这两段编码，别的字符一个不动
 *   2. 事实串比对：原文带部首字符时，按常用字写的学校、学历、公司、证书找得到；
 *      原文里没有的学校、公司、学历照样找不到（只换编码，不放宽规则）
 *   3. 抽取：识别出来的文字带部首字符时，交出去的简历文字已经是常用字；日志只记个数
 *   4. 简历优化整条链（假模型）：库里旧文字带部首字符、模型按常用字写，不再被判作废；
 *      真编造照样作废；每一条作废规则的名字都进了日志，日志里没有任何简历内容；
 *      模型输出或旧报告摘录里的部首字符，不会让同一段经历出现两次，也不会把经历丢掉
 *
 * 不触网、不碰库（fetch 换成假实现）。
 * 运行：pnpm --filter @ai-job-print/api verify:resume-radical-fold
 */
import { createHash } from 'node:crypto'
import { Logger } from '@nestjs/common'
import {
  CJK_RADICAL_TABLE_SIZE,
  cjkRadicalTableEntries,
  countCjkRadicals,
  foldCjkRadicals,
} from '../src/common/text/cjk-radical-fold'
import { makeFactMatcher, matchResumeFacts, normalizeResumeFactText } from '../src/ai/resume/resume-fact-match'
import { ResumeExtractionService } from '../src/ai/resume/resume-extraction.service'
import { LlmResumeOptimizeService } from '../src/ai/resume/llm-resume-optimize.service'
import type { ResumeReport } from '../src/ai/interfaces/ai-provider.interface'

let passCount = 0
let failCount = 0
function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string) { failCount += 1; console.error(`  FAIL ${msg}`) }
function check(ok: boolean, msg: string) { if (ok) pass(msg); else fail(msg) }

// 把日志收下来：既用来核对「规则名进了日志」，也用来核对「日志里没有简历内容」。
const logLines: string[] = []
const collect = (message: unknown) => { logLines.push(typeof message === 'string' ? message : JSON.stringify(message)) }
Logger.overrideLogger({ log: collect, warn: collect, error: collect, debug: collect, verbose: collect, fatal: collect })

/** 真机那份 PDF 文字层里见到的 21 个部首字符，和它们各自对应的常用字。 */
const SEEN_ON_DEVICE: ReadonlyArray<[radical: string, unified: string]> = [
  ['⻘', '青'], ['⼤', '大'], ['⼯', '工'], ['⽇', '日'], ['⽉', '月'], ['⼀', '一'], ['⽤', '用'],
  ['⾦', '金'], ['⼊', '入'], ['⻅', '见'], ['⼼', '心'], ['⼩', '小'], ['⻋', '车'], ['⼿', '手'],
  ['⼗', '十'], ['⽆', '无'], ['⾃', '自'], ['⽌', '止'], ['⽴', '立'], ['⽅', '方'], ['⻓', '长'],
]
const TO_RADICAL = new Map(SEEN_ON_DEVICE.map(([radical, unified]) => [unified, radical]))
/** 把常用字写的文本改成「文字层带部首字符」的样子（只换真机上见过的那 21 个字）。 */
const withRadicals = (text: string) => Array.from(text).map((ch) => TO_RADICAL.get(ch) ?? ch).join('')

const inRadicalBlocks = (ch: string) => {
  const cp = ch.codePointAt(0) ?? 0
  return cp >= 0x2e80 && cp <= 0x2fdf
}

// ─── 1. 对照表 ───────────────────────────────────────────────────────────────

/** 进表内容的校验值，字面量抄在门禁里，不引用被测模块导出的常量。 */
const EXPECTED_CJK_RADICAL_TABLE_SHA256 = 'cb5090b73386fa7b7f26f241ae77bd03af86875539fc98e833a1288d7db74fa4'
/** 源数组里不进表的 14 个部首：13 个对应字在基本平面之外，再加上 U+2E95。 */
const DROPPED_RADICALS = [
  '\u2E87', '\u2E91', '\u2E95', '\u2EAA', '\u2EAE', '\u2EB5', '\u2EB7', '\u2EB8',
  '\u2EBD', '\u2EC7', '\u2ECA', '\u2ED5', '\u2EDE', '\u2EE1',
]

function tableChecks(): void {
  const entries = cjkRadicalTableEntries()
  check(entries.length === 314 && CJK_RADICAL_TABLE_SIZE === 314, `对照表 314 条（源数组 328 对里，对应字超出基本平面的 13 条和 U+2E95 不进表），实际 ${entries.length}`)
  const digest = createHash('sha256').update(entries.map(([radical, unified]) => radical + unified).join(''), 'utf8').digest('hex')
  check(digest === EXPECTED_CJK_RADICAL_TABLE_SHA256, '对照表内容和门禁里另抄的校验值一致（没有被手改过单个字）')
  const outsideBmp = entries.filter(([, unified]) => unified.length !== 1 || (unified.codePointAt(0) ?? 0) > 0xFFFF)
  check(outsideBmp.length === 0, `表里没有任何一条的对应字在基本平面之外（超出的 ${outsideBmp.length} 条）`)
  check(DROPPED_RADICALS.length === 14 && DROPPED_RADICALS.every((ch) => foldCjkRadicals(ch) === ch && !entries.some(([radical]) => radical === ch)),
    '被拿掉的 14 个部首不在表里，遇到时原样保留')

  const badShape = entries.filter(([radical, unified]) =>
    Array.from(radical).length !== 1 || Array.from(unified).length !== 1 || !inRadicalBlocks(radical) || inRadicalBlocks(unified) || !/^\p{Script=Han}$/u.test(unified))
  check(badShape.length === 0, `每一条都是「一个部首字符 → 一个不在这两段里的汉字」（不合的 ${badShape.length} 条）`)

  // 独立来源：康熙部首这 214 个字符，Unicode 的 NFKC 归一本来就会换成常用字，Node 自带。
  const kangxi = entries.filter(([radical]) => (radical.codePointAt(0) ?? 0) >= 0x2f00)
  const kangxiMismatch = kangxi.filter(([radical, unified]) => radical.normalize('NFKC') !== unified)
  check(kangxi.length === 214, `康熙部首 214 条都在表里，实际 ${kangxi.length}`)
  check(kangxiMismatch.length === 0, `康熙部首 214 条与 Node 自带 NFKC 的结果逐条相同（不同的 ${kangxiMismatch.length} 条）`)
  const everyKangxi: string[] = []
  for (let cp = 0x2f00; cp <= 0x2fd5; cp += 1) everyKangxi.push(String.fromCodePoint(cp))
  check(everyKangxi.every((ch) => foldCjkRadicals(ch) === ch.normalize('NFKC') && foldCjkRadicals(ch) !== ch), '康熙部首整段 U+2F00–U+2FD5 逐个换成了 NFKC 给出的那个字')
  // 部首补充这一段 NFKC 基本不管，只有两个字符例外，正好拿来做第二处独立对照。
  check('⺟'.normalize('NFKC') === '母' && foldCjkRadicals('⺟') === '母' && '⻳'.normalize('NFKC') === '龟' && foldCjkRadicals('⻳') === '龟',
    '部首补充里 NFKC 也管的两个字符（母、龟）与 NFKC 结果相同')
  check('⻘'.normalize('NFKC') === '⻘', '阳性对照：部首补充里的「青」NFKC 不会换（所以不能只靠 NFKC，要有对照表）')

  const wrong = SEEN_ON_DEVICE.filter(([radical, unified]) => radical === unified || foldCjkRadicals(radical) !== unified)
  check(wrong.length === 0, `真机上见到的 21 个部首字符逐个换成了对应的常用字（不对的 ${wrong.length} 个）`)
  check(SEEN_ON_DEVICE.every(([radical]) => inRadicalBlocks(radical)) && SEEN_ON_DEVICE.every(([, unified]) => !inRadicalBlocks(unified)),
    '阳性对照：这 21 对里左边确实是部首字符、右边确实是常用字（不是同一个字写了两遍）')

  // 只动这两段编码。
  const untouched = '，。；：、（）《》“”１２３ＡＢｃ＠ 　豈〇㇀⿰⺀abc ABC 123 😀\n\t'
  check(foldCjkRadicals(untouched) === untouched, '全角标点、全角数字字母、兼容区汉字、笔画、结构描述符、U+2E80、英文数字、表情、空白都原样不动')
  const compat = '\uF900'
  check(foldCjkRadicals(compat) === compat && compat !== '\u8C48', '兼容区汉字（U+F900）原样不动；这不是普通字「豈」')
  check(countCjkRadicals('\u2E80') === 0 && countCjkRadicals(DROPPED_RADICALS.join('')) === 0 && countCjkRadicals('\u2ED8\u2F24') === 2,
    '个数只数对照表里真会被换掉的字符，不数整个码点区间')
  const plain = '青岛职业技术学院 · 物流管理（大专）'
  check(foldCjkRadicals(plain) === plain && countCjkRadicals(plain) === 0, '本来就是常用字的文本原样返回')
  const mixed = withRadicals(plain)
  check(mixed !== plain && countCjkRadicals(mixed) === 2, '阳性对照：造出来的样本里确实有部首字符（青、大各一个）')
  check(foldCjkRadicals(mixed) === plain && foldCjkRadicals(foldCjkRadicals(mixed)) === plain, '带部首字符的文本换回常用字，再换一次不变')
  check(foldCjkRadicals('') === '' && foldCjkRadicals(undefined as never) === '', '空串、非字符串不报错')
}

// ─── 2. 事实串比对 ───────────────────────────────────────────────────────────

const RESUME_PLAIN = [
  '李明远',
  '求职意向：仓储物流专员 · 期望城市：青岛',
  '教育经历',
  '青岛职业技术学院 · 物流管理（大专） 2020.09 – 2023.06',
  '主修课程：仓储与配送管理、运输管理实务、供应链基础',
  '工作经历',
  '青岛海润物流有限公司 · 仓储专员 2023.07 – 2025.08',
  '负责快消品仓约 1200 个库位的日常收货、上架、拣货和发货，日均处理出库单 180 单左右。',
  '每月参与一次全仓盘点，配合主管把账实差异从 0.8% 降到 0.3% 以内。',
  '城阳分拣中心 · 分拣员（实习） 2022.11 – 2023.02',
  '夜班负责小件分拣和装车扫描，熟悉手持终端的收发货操作。',
  '技能与证书',
  '熟练使用 Excel、手持终端。',
  '叉车证（N1，2023 年取得）；物流服务师（四级）；C1 驾照。',
  '自我评价',
  '做事细，账和货对不上会一直查到对上为止。',
].join('\n')
/** 文字层带部首字符的同一份简历：修复之前，库里存下的就是这个样子。 */
const RESUME_RADICAL = withRadicals(RESUME_PLAIN)

const FACTS_IN_RESUME = ['青岛职业技术学院', '物流管理', '大专', '青岛海润物流有限公司', '城阳分拣中心', '叉车证（N1，2023 年取得）', '物流服务师（四级）', 'C1 驾照']
const FACTS_NOT_IN_RESUME = ['青岛大学', '本科', '青岛海润供应链有限公司', '高级物流师', '城阳转运中心']

function matchChecks(): void {
  check(countCjkRadicals(RESUME_RADICAL) >= 15 && !RESUME_RADICAL.includes('青岛') && !RESUME_RADICAL.includes('大专') && !RESUME_RADICAL.includes('中心') && !RESUME_RADICAL.includes('叉车证'),
    '阳性对照：带部首字符的那份里，按常用字逐字搜「青岛」「大专」「中心」「叉车证」确实搜不到')
  const inRadical = makeFactMatcher(RESUME_RADICAL)
  const inPlain = makeFactMatcher(RESUME_PLAIN)
  const missed = FACTS_IN_RESUME.filter((fact) => !inRadical(fact))
  check(missed.length === 0, `原文带部首字符：按常用字写的学校、专业、学历、公司、证书都找得到（找不到的：${missed.join('、') || '无'}）`)
  check(FACTS_IN_RESUME.every((fact) => inPlain(fact)), '原文本来就是常用字：同样都找得到（没有变差）')
  check(FACTS_IN_RESUME.every((fact) => makeFactMatcher(RESUME_PLAIN)(withRadicals(fact))), '反过来，模型照抄了部首字符、原文是常用字，也找得到')
  const leaked = FACTS_NOT_IN_RESUME.filter((fact) => inRadical(fact) || inPlain(fact))
  check(leaked.length === 0, `原文里没有的学校、学历、公司、证书照样找不到（只换编码，不放宽规则；误放的：${leaked.join('、') || '无'}）`)
  check(normalizeResumeFactText(RESUME_RADICAL) === normalizeResumeFactText(RESUME_PLAIN), '两份文本归一之后完全相同')

  const facts = matchResumeFacts({
    education: [{ school: '青岛职业技术学院' }, { school: '青岛大学' }],
    experience: [{ company: '青岛海润物流有限公司' }],
    certificates: ['叉车证（N1，2023 年取得）'],
  }, RESUME_RADICAL)
  const byValue = new Map(facts.map((fact) => [fact.value, fact.foundInOriginal]))
  check(byValue.get('青岛职业技术学院') === true && byValue.get('青岛海润物流有限公司') === true && byValue.get('叉车证（N1，2023 年取得）') === true && byValue.get('青岛大学') === false,
    '事实核对墙同一口径：原文带部首字符时三项真事实都对得上，编出来的学校对不上')
}

// ─── 3. 抽取 ─────────────────────────────────────────────────────────────────

async function extractionChecks(): Promise<void> {
  // 用图片识别这条路把一段带部首字符的文字送进抽取服务（文件和识别都是桩，走的是真实的抽取服务）。
  let recognized = RESUME_RADICAL
  const files = { readContentForEndUser: async () => ({ buffer: Buffer.from('not-a-real-image'), mimeType: 'image/png', filename: 'resume.png', purpose: 'resume_upload' }) }
  const ocr = { recognize: async () => ({ ok: true, text: recognized, confidence: 'high' as const }) }
  const service = new ResumeExtractionService(files as never, ocr as never)

  logLines.length = 0
  const fromRadical = await service.extractResumeText({ fileId: 'file_radical', endUserId: null })
  check(fromRadical.ok === true && typeof fromRadical.text === 'string' && fromRadical.text.includes('青岛职业技术学院') && fromRadical.text.includes('物流管理（大专）') && fromRadical.text.includes('叉车证'),
    '识别出来的文字带部首字符：交出去的简历文字里是常用字写的学校、学历、证书')
  check(fromRadical.ok === true && countCjkRadicals(fromRadical.text ?? '') === 0, '交出去的简历文字里一个部首字符都没有')
  check(fromRadical.ok === true && fromRadical.text === foldCjkRadicals(RESUME_RADICAL) && (fromRadical.text ?? '').includes('，') && (fromRadical.text ?? '').includes('（'),
    '除了这些字符，别的一个没动（全角逗号、全角括号都在）')
  const okLine = logLines.find((line) => line.includes('extract.ok')) ?? ''
  check(okLine.includes('"radicalChars"') && new RegExp(`"radicalChars":${countCjkRadicals(RESUME_RADICAL)}\\b`).test(okLine), '日志记下了换掉的部首字符个数')
  check(!logLines.some((line) => line.includes('李明远') || line.includes('职业技术学院') || line.includes('海润')), '日志里没有简历内容')

  recognized = RESUME_PLAIN
  logLines.length = 0
  const fromPlain = await service.extractResumeText({ fileId: 'file_plain', endUserId: null })
  check(fromPlain.ok === true && fromPlain.text === fromRadical.text, '本来就是常用字的文字：结果和上面一样')
  check(logLines.some((line) => line.includes('extract.ok')) && !logLines.some((line) => line.includes('radicalChars')), '没有部首字符时日志里不带这个字段')
}

// ─── 4. 简历优化整条链（假模型） ─────────────────────────────────────────────

const REPORT: ResumeReport = {
  sections: [
    { key: 'basic', label: '基础信息完整度', score: 8, maxScore: 10 },
    { key: 'experience', label: '经历表达清晰度', score: 6, maxScore: 10 },
  ] as ResumeReport['sections'],
  suggestions: ['经历描述建议动词开头并量化成果'],
}

/** 一个老老实实的模型会怎么写：事实字段照原文、都用常用字。 */
function faithfulOutput(): Record<string, unknown> {
  return {
    resume: {
      basic: { name: '李明远', phone: '', email: '', city: '青岛' },
      intention: { position: '仓储物流专员', city: '青岛' },
      summary: '两年仓库一线经验，做事细致。',
      education: [{ school: '青岛职业技术学院', major: '物流管理', degree: '大专', period: '2020.09 – 2023.06', description: '主修仓储与配送管理、运输管理实务、供应链基础。' }],
      experience: [
        { company: '青岛海润物流有限公司', role: '仓储专员', period: '2023.07 – 2025.08', description: '负责约 1200 个库位的日常收货、上架、拣货和发货，日均处理出库单 180 单左右；每月参与全仓盘点，把账实差异从 0.8% 降到 0.3% 以内。' },
        { company: '城阳分拣中心', role: '分拣员（实习）', period: '2022.11 – 2023.02', description: '夜班负责小件分拣和装车扫描，熟悉手持终端的收发货操作。' },
      ],
      projects: [],
      skills: ['Excel', '手持终端'],
      certificates: ['叉车证（N1，2023 年取得）', '物流服务师（四级）', 'C1 驾照'],
    },
    modules: [{ title: '工作经历', before: '负责快消品仓约 1200 个库位的日常收货、上架、拣货和发货', after: '负责约 1200 个库位的收、上、拣、发全流程' }],
  }
}

type Mutate = (output: Record<string, unknown>) => void
const resumeOf = (output: Record<string, unknown>) => output['resume'] as Record<string, unknown>
const firstOf = (output: Record<string, unknown>, key: string) => (resumeOf(output)[key] as Array<Record<string, unknown>>)[0]!

async function optimizeChecks(): Promise<void> {
  const config = {
    vendor: 'deepseek', model: 'stub', baseURL: 'http://127.0.0.1/v1', systemPrompt: '', roleScope: '',
    forbiddenWords: [] as string[], temperature: 0.3, enabled: true,
  }
  const service = new LlmResumeOptimizeService({ getApiKey: () => 'verify-key', getConfig: () => config, isReady: () => true } as never)
  let reply = ''
  let calls = 0
  const prompts: string[] = []
  const savedFetch = globalThis.fetch
  ;(globalThis as { fetch: unknown }).fetch = async (_url: string, init: RequestInit) => {
    calls += 1
    prompts.push(String(init.body))
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ choices: [{ message: { content: reply } }] }) } as Response
  }
  const run = async (originalText: string, mutate?: Mutate, raw?: string, report: ResumeReport = REPORT) => {
    const output = faithfulOutput()
    mutate?.(output)
    reply = raw ?? JSON.stringify(output)
    calls = 0
    prompts.length = 0
    logLines.length = 0
    try {
      const result = await service.optimize(originalText, report)
      return { result, code: '', calls, rules: rulesInLog() }
    } catch (error) {
      const response = (error as { getResponse?: () => unknown }).getResponse?.() as { error?: { code?: string } } | undefined
      return { result: undefined, code: response?.error?.code ?? 'UNKNOWN', calls, rules: rulesInLog() }
    }
  }
  const rulesInLog = () => logLines.flatMap((line) => /resume optimize: invalid output \(attempt \d\/2\) rule=(\w+)/.exec(line)?.[1] ?? [])

  try {
    // 库里旧文字带部首字符、模型按常用字写：不再被判作废。
    const fixed = await run(RESUME_RADICAL)
    const resume = fixed.result?.optimizedResume
    check(!!resume && fixed.code === '', `原文带部首字符、模型照原文按常用字写：拿到了优化稿（错误码：${fixed.code || '无'}）`)
    check(!!resume && resume.education[0]?.school === '青岛职业技术学院' && resume.education[0]?.degree === '大专'
      && resume.experience.some((item) => item.company === '青岛海润物流有限公司') && resume.experience.some((item) => item.company === '城阳分拣中心')
      && resume.certificates.includes('叉车证（N1，2023 年取得）'),
    '优化稿里学校、学历、两家单位、叉车证都在')
    const FACT_RULES = ['education_school', 'education_major', 'education_degree', 'experience_company', 'project_name', 'certificate']
    check(!fixed.rules.some((rule) => FACT_RULES.includes(rule)), `没有任何一次是被「事实不在原文」判作废的（日志里的规则：${fixed.rules.join('、') || '无'}）`)
    check(prompts.length >= 1 && prompts.every((body) => body.includes('青岛职业技术学院') && !/[\u2E80-\u2FDF]/u.test(body)),
      '送给模型的简历原文已经是常用字，一个部首字符都没有')
    check(!!fixed.result && fixed.result.modules.length === 1, '新旧对比那一条的「优化前」片段在带部首字符的原文里也对得上，没有被丢掉')

    const plain = await run(RESUME_PLAIN)
    check(!!plain.result && plain.code === '' && plain.result.optimizedResume.education[0]?.school === '青岛职业技术学院', '原文本来就是常用字：照常拿到优化稿（没有变差）')

    // 模型把「青」写成部首字符：事实校验认得出，但覆盖回配必须也认得出，否则会再补一条。
    const radicalModel = await run(RESUME_RADICAL, undefined, JSON.stringify(faithfulOutput()).replaceAll('青', '\u2ED8'))
    const radicalResume = radicalModel.result?.optimizedResume
    const radicalSchools = radicalResume?.education.map((item) => item.school) ?? []
    const radicalCompanies = radicalResume?.experience.map((item) => item.company) ?? []
    const radicalCerts = radicalResume?.certificates ?? []
    check(!!radicalResume && radicalModel.code === '', `模型输出里「青」是部首字符：拿到了优化稿（错误码：${radicalModel.code || '无'}）`)
    check(radicalSchools.length === 1 && radicalSchools[0] === '青岛职业技术学院'
      && radicalCompanies.length === 2
      && radicalCompanies.filter((item) => item === '青岛海润物流有限公司').length === 1
      && radicalCompanies.filter((item) => item === '城阳分拣中心').length === 1
      && radicalCerts.length === 3
      && radicalCerts.filter((item) => item === '叉车证（N1，2023 年取得）').length === 1
      && radicalCerts.filter((item) => item === '物流服务师（四级）').length === 1
      && radicalCerts.filter((item) => item === 'C1 驾照').length === 1,
    '学校、公司、证书每一项在结果里只出现一次')

    // 覆盖锚点只有 contentBlocks[].lines。这段没有栏目标题，单位名也不含「公司 / 中心」，
    // 认不出经历就靠报告摘录。摘录和原文都带部首字符；模型没写这段，但写了非空简介。
    const anchorPlain = [
      '李明',
      '青岛服务部 2020.09 – 2023.06',
      '负责来访接待登记。',
      '青岛海润物流有限公司 仓储专员 2023.07 – 2025.08',
      '负责日常收货。',
    ].join('\n')
    const anchorReport: ResumeReport = {
      sections: REPORT.sections,
      suggestions: [],
      contentBlocks: [{ key: 'experience', label: '工作经历', lines: [withRadicals('青岛服务部 2020.09 – 2023.06')] }],
    }
    const anchorOutput = {
      resume: {
        basic: { name: '李明', phone: '', email: '', city: '' },
        intention: { position: '', city: '' },
        summary: '做事细致。',
        education: [],
        experience: [{ company: '青岛海润物流有限公司', role: '仓储专员', period: '2023.07 – 2025.08', description: '负责日常收货。' }],
        projects: [], skills: [], certificates: [],
      },
      modules: [],
    }
    const anchored = await run(withRadicals(anchorPlain), undefined, JSON.stringify(anchorOutput), anchorReport)
    const anchoredCompanies = anchored.result?.optimizedResume.experience.map((item) => item.company) ?? []
    check(!!anchored.result && anchored.code === '', `诊断摘录带部首字符：拿到了优化稿（错误码：${anchored.code || '无'}）`)
    check(anchoredCompanies.filter((item) => item.includes('青岛服务部')).length === 1
      && anchoredCompanies.filter((item) => item.includes('青岛海润物流有限公司')).length === 1,
    '原文里的每段经历都在（服务部靠摘录锚点保住，没有因为简介非空被丢掉）')

    const omitted = await run(RESUME_RADICAL, (output) => {
      const experience = resumeOf(output)['experience'] as Array<Record<string, unknown>>
      resumeOf(output)['experience'] = experience.filter((item) => item['company'] !== '城阳分拣中心')
    })
    const omittedCompanies = omitted.result?.optimizedResume.experience.map((item) => item.company) ?? []
    check(!!omitted.result && omitted.code === '' && omitted.rules.includes('missing_entries'),
      `漏了城阳分拣中心：日志有 missing_entries（实际：${omitted.rules.join('、') || '无'}），并且拿到了优化稿`)
    check(omittedCompanies.filter((item) => item.includes('城阳分拣中心')).length === 1
      && omittedCompanies.filter((item) => item.includes('青岛海润物流有限公司')).length === 1,
    '漏掉的那段经历被补回，另一段没有因此多出一条')

    // 真编造照样作废，而且日志说得出是哪条规则；每点一次仍是两次调用。
    const cases: Array<[label: string, rule: string, mutate: Mutate | undefined, raw?: string]> = [
      ['模型回的不是 JSON', 'not_json', undefined, '好的，这是优化后的简历'],
      ['JSON 里没有 resume', 'no_resume_object', undefined, JSON.stringify({ modules: [] })],
      ['编了一所原文没有的学校', 'education_school', (o) => { firstOf(o, 'education')['school'] = '青岛大学' }],
      ['把专业改了', 'education_major', (o) => { firstOf(o, 'education')['major'] = '供应链管理' }],
      ['把大专写成本科', 'education_degree', (o) => { firstOf(o, 'education')['degree'] = '本科' }],
      ['编了一家原文没有的公司', 'experience_company', (o) => { firstOf(o, 'experience')['company'] = '青岛海润供应链有限公司' }],
      ['给实习起了个原文没有的项目名', 'project_name', (o) => { resumeOf(o)['projects'] = [{ name: '双十一分拣保障项目', role: '', description: '连续 12 天无错分。' }] }],
      ['证书换了个说法', 'certificate', (o) => { resumeOf(o)['certificates'] = ['叉车操作证'] }],
      ['描述里写了承诺类的话', 'guard_term', (o) => { firstOf(o, 'experience')['description'] = ['入职后', '保', '录用', '转正。'].join('') }],
      ['单条描述超过 2000 字', 'desc_too_long', (o) => { firstOf(o, 'experience')['description'] = '负责仓库日常工作。'.repeat(240) }],
    ]
    for (const [label, rule, mutate, raw] of cases) {
      const rejected = await run(RESUME_RADICAL, mutate, raw)
      check(rejected.result === undefined && rejected.code === 'AI_OPTIMIZE_INVALID_OUTPUT' && rejected.calls === 2,
        `${label}：照样判作废（错误码 ${rejected.code}，调模型 ${rejected.calls} 次）`)
      check(rejected.rules.length === 2 && rejected.rules.every((item) => item === rule), `${label}：两次的日志都写明规则 ${rule}（实际：${rejected.rules.join('、') || '无'}）`)
      check(!logLines.some((line) => ['李明远', '青岛', '海润', '物流', '叉车', '大专', '本科', '供应链', '双十一', '转正'].some((word) => line.includes(word))),
        `${label}：日志里只有规则名，没有简历内容和模型输出`)
    }
  } finally {
    ;(globalThis as { fetch: unknown }).fetch = savedFetch
  }
}

async function main(): Promise<void> {
  console.log('\n=== 简历文字里的部首字符换回常用字 ===')
  tableChecks()
  matchChecks()
  await extractionChecks()
  await optimizeChecks()
  console.log(`\nverify:resume-radical-fold ${failCount === 0 ? '通过' : '未通过'}：PASS ${passCount} / FAIL ${failCount}`)
  if (failCount > 0) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
