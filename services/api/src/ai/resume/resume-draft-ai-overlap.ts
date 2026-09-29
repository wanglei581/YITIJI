/**
 * 简历「按原样导出」的正文核对（纯函数，不碰库）。
 *
 * 按原样导出（draft=true）不送模型、产物不带 AI 标识。它只许导出**用户自己写的字**：
 *   - 有生成任务时，正文一律取生成时留存的原始填写（inputAsDraftResume）；
 *   - 没有生成任务时，客户端正文里任何一段与比对范围内的 AI 结果逐字相同（规范化后），
 *     就不是「原样」，要拒绝（findAiOverlap）。
 *
 * 为什么单独成文件：ai.controller.ts（>800 行）与 ai.service.ts（>1000 行）按规模规则不得再加逻辑；
 * 这里全是可单测的纯函数，与取数的 ResumeDraftSourceService 分开，门禁可以直接变异。
 */
import type { GeneratedResume, ResumeGenerateInput } from '../interfaces/ai-provider.interface'

/**
 * 生成时的原始填写（AiResumeResult.kind），与 generate 结果同一 taskId、同一 TTL、同一归属。
 * 不进「AI 服务记录」列表；删除 generate 记录时一并删除。
 */
export const RESUME_GENERATE_INPUT_KIND = 'generate_input'

/**
 * 只比「足够长」的段落：规范化后不足 20 个汉字当量的一律不比。
 *
 * 理由：「熟练使用 Office」「本科学历」「沟通能力强」这类常见短句，AI 会写、真手填的人也会写，
 * 逐字相同并不说明是照抄 AI；按短句拒绝会误伤真手填的人，而 AI 挂掉时这条是他唯一的出纸路径。
 * 20 个汉字大约是一句完整的经历描述，碰巧与别人的 AI 结果整句相同的概率可以忽略。
 */
export const MIN_COMPARABLE_HAN_EQUIVALENT = 20

/**
 * 非汉字字符（字母、数字）折算成汉字当量的比例：每 3 个算 1 个汉字。
 * 一个汉字承载的信息量大约相当于 2–3 个英文字母；按 3 折算，「熟练使用 Microsoft Office、WPS」
 * 这类中英混排的常见短句不会因为字母多就被当成长段落。
 */
const NON_HAN_PER_HAN = 3

/** 去掉空白与标点符号、全角转半角（NFKC）、英文字母不分大小写。 */
export function normalizeDraftText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

/** 规范化文本的汉字当量长度。 */
export function hanEquivalentLength(normalized: string): number {
  let han = 0
  let other = 0
  for (const ch of normalized) {
    if (/\p{Script=Han}/u.test(ch)) han += 1
    else other += 1
  }
  return han + Math.floor(other / NON_HAN_PER_HAN)
}

/** 按换行切段并规范化，丢掉不够长的段。 */
export function comparableParagraphs(text: string | undefined | null): string[] {
  if (!text) return []
  return text
    .split(/\r?\n+/)
    .map(normalizeDraftText)
    .filter((p) => hanEquivalentLength(p) >= MIN_COMPARABLE_HAN_EQUIVALENT)
}

/** 一条可比对的 AI 结果：AI 写的段落 + 这次任务里用户自己的原话（AI 原样照抄的原话不算 AI 写的）。 */
export interface AiTextSource {
  paragraphs: string[]
  /** 用户原话逐栏规范化后以换行拼接；空串表示没有留存原话（迁移前的历史行）。 */
  ownText: string
}

/** 用户原话逐栏规范化后拼起来。按栏用换行隔开：AI 段落只有整段落在某一栏原话里才算照抄原话。 */
export function ownTextOf(texts: readonly (string | undefined | null)[]): string {
  return texts.map((t) => normalizeDraftText(t ?? '')).filter(Boolean).join('\n')
}

/** 生成结果里由模型改写的栏目：个人简介与各段描述。事实栏（学校、公司、证书等）由服务端逐字复制，不算。 */
export function aiParagraphsOfResume(resume: Partial<GeneratedResume> | undefined | null): string[] {
  if (!resume) return []
  return [
    ...comparableParagraphs(resume.summary),
    ...(resume.education ?? []).flatMap((e) => comparableParagraphs(e?.description)),
    ...(resume.experience ?? []).flatMap((e) => comparableParagraphs(e?.description)),
    ...(resume.projects ?? []).flatMap((p) => comparableParagraphs(p?.description)),
  ]
}

/** 生成时留存的原始填写里用户写的每一栏。 */
export function inputTexts(input: Partial<ResumeGenerateInput> | undefined | null): string[] {
  if (!input) return []
  return [
    input.selfIntro,
    ...Object.values(input.basic ?? {}),
    ...Object.values(input.intention ?? {}),
    ...(input.education ?? []).flatMap((e) => Object.values(e ?? {})),
    ...(input.experience ?? []).flatMap((e) => Object.values(e ?? {})),
    ...(input.projects ?? []).flatMap((p) => Object.values(p ?? {})),
    ...(input.skills ?? []),
    ...(input.certificates ?? []),
  ].filter((t): t is string => typeof t === 'string')
}

/** 客户端正文逐栏展开，带给用户看的栏目名（409 里指出是哪一栏，不回显内容）。 */
function draftFields(resume: GeneratedResume): Array<{ label: string; text: string }> {
  const fields: Array<{ label: string; text: string | undefined }> = [
    { label: '个人简介', text: resume.summary },
    ...Object.values(resume.basic ?? {}).map((text) => ({ label: '基本信息', text })),
    ...Object.values(resume.intention ?? {}).map((text) => ({ label: '求职意向', text })),
    ...(resume.education ?? []).flatMap((e, i) => Object.values(e ?? {}).map((text) => ({ label: `教育经历第 ${i + 1} 条`, text }))),
    ...(resume.experience ?? []).flatMap((e, i) => Object.values(e ?? {}).map((text) => ({ label: `工作经历第 ${i + 1} 条`, text }))),
    ...(resume.projects ?? []).flatMap((p, i) => Object.values(p ?? {}).map((text) => ({ label: `项目经历第 ${i + 1} 条`, text }))),
    ...(resume.skills ?? []).map((text) => ({ label: '技能', text })),
    ...(resume.certificates ?? []).map((text) => ({ label: '证书', text })),
  ]
  return fields.filter((f): f is { label: string; text: string } => typeof f.text === 'string' && f.text.length > 0)
}

/**
 * 找出客户端正文里照抄 AI 结果的栏目（返回栏目名，去重；空数组 = 没有照抄）。
 *
 * 两个方向都查，都只看够长的段：
 *   1. AI 的整段出现在正文里（含把几段拼成一段、前后加了别的字）；
 *   2. 正文的某一段是 AI 某一段的一部分（只抄了半段）。
 * 这段如果本来就是该任务里用户自己的原话（AI 原样照抄），不算。
 */
export function findAiOverlap(draft: GeneratedResume, sources: readonly AiTextSource[]): string[] {
  const fields = draftFields(draft).map((f) => ({ label: f.label, norm: normalizeDraftText(f.text), paragraphs: comparableParagraphs(f.text) }))
  const joined = fields.map((f) => f.norm).join('')
  const hits = new Set<string>()
  for (const source of sources) {
    const isOwn = (text: string) => source.ownText.length > 0 && source.ownText.includes(text)
    for (const ai of source.paragraphs) {
      if (isOwn(ai)) continue
      if (!joined.includes(ai)) {
        for (const f of fields) {
          if (f.paragraphs.some((p) => ai.includes(p) && !isOwn(p))) hits.add(f.label)
        }
        continue
      }
      const inField = fields.filter((f) => f.norm.includes(ai))
      if (inField.length > 0) inField.forEach((f) => hits.add(f.label))
      else hits.add('多个栏目拼接')
    }
  }
  return [...hits]
}

/** 原始填写折成导出形状：与一体机 / 小程序的草稿折法一致，个人简介取用户写的自我介绍原文。 */
export function inputAsDraftResume(input: ResumeGenerateInput): GeneratedResume {
  return {
    basic: input.basic,
    intention: input.intention,
    summary: input.selfIntro ?? '',
    education: input.education ?? [],
    experience: input.experience ?? [],
    projects: input.projects ?? [],
    skills: input.skills ?? [],
    certificates: input.certificates ?? [],
  }
}

/** 留存时只取会被渲染的栏目（白名单），不把请求里别的东西带进库。 */
export function pickRenderableInput(input: ResumeGenerateInput): ResumeGenerateInput {
  return {
    basic: input.basic,
    intention: input.intention,
    education: input.education,
    experience: input.experience,
    projects: input.projects,
    skills: input.skills,
    certificates: input.certificates,
    ...(input.selfIntro !== undefined ? { selfIntro: input.selfIntro } : {}),
  }
}
