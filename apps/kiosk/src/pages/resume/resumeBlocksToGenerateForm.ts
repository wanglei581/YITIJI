import type { ResumeContentBlock } from '@ai-job-print/shared'
import {
  EMPTY_EDU,
  EMPTY_EXP,
  EMPTY_PROJ,
  LIMITS,
  TEXT_LIMITS,
  clampListText,
  clampText,
  emptyForm,
  type GenerateFormSnapshot,
  type HistorySeg,
} from './components/resumeGenerateModel'

/**
 * 诊断内容块摘自送模型前遮盖过的文本。占位写法是 `[类别_序号]`。
 * 出处：services/api/src/common/pii/pii-masker.ts 第 573 行 placeholderFor
 * （`` `[${candidate.category}_${next}]` ``），类别见同文件第 59 行 MaskCategory。
 * 诊断入口 services/api/src/ai/resume/llm-resume.service.ts 第 223 行调用
 * maskUserTextForLlmText；同一写法的 token 正则见
 * services/api/src/common/pii/llm-input-mask.ts 第 71–72 行 PLACEHOLDER_TOKEN。
 */
export const DIAGNOSIS_MASK_PLACEHOLDER =
  /\[(?:劳动者|用人单位|身份证|手机号|银行卡|邮箱|详细地址|统一社会信用代码)_\d+\]/u

/** 优化失败后带入表单时顶上的那一句。全仓库只写在这里。 */
export const CARRIED_NOTE = '已带入从你简历里读到的部分内容，请逐项核对、补全'

export interface ResumeBlocksCarry {
  form: GenerateFormSnapshot
  seg: HistorySeg
}

function keptLines(blocks: readonly ResumeContentBlock[] | null | undefined, key: ResumeContentBlock['key']): string[] {
  const block = blocks?.find((item) => item.key === key)
  if (!block || !Array.isArray(block.lines)) return []
  const lines: string[] = []
  for (const raw of block.lines) {
    if (typeof raw !== 'string') continue
    const line = raw.trim()
    if (!line || DIAGNOSIS_MASK_PLACEHOLDER.test(line)) continue
    lines.push(line)
  }
  return lines
}

/**
 * 按提交时的切法（逗号、顿号、换行，同 resumeGenerateModel 的 splitList）数条目，只留前 max 条。
 * 留下的部分逐字不变：一句话里带顿号也照原样显示，提交时怎么切和原来一样。
 */
function keepFirstListItems(text: string, max: number): string {
  let count = 0
  let current = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === ',' || ch === '，' || ch === '、' || ch === '\n') {
      if (current.trim()) {
        count += 1
        if (count >= max) return text.slice(0, i)
      }
      current = ''
      continue
    }
    current += ch
  }
  return text
}

/**
 * 从诊断内容块搬进「从零生成」表单。
 * 只搬教育 / 工作 / 项目的长文本，以及技能、自我评价。
 * 姓名、城市、手机号、邮箱、意向岗位等小格一律留空。
 *
 * 在校情况、做了什么、项目内容的入参上限是 1000
 * （services/api/src/ai/dto/resume-generate.dto.ts：
 * ResumeGenEducationDto 第 84 行、ResumeGenExperienceDto 第 103 行、
 * ResumeGenProjectDto 第 114 行）。
 * 内容块最多 6 行、每行 80 字，换行连起来最长 6×80+5=485，到不了 1000，
 * 所以保留下来的行全部用换行连起来，不从行中间截，也不按行丢。
 * 五块一样都没带出东西时返回 null。
 */
export function resumeBlocksToGenerateForm(
  blocks: readonly ResumeContentBlock[] | null | undefined,
): ResumeBlocksCarry | null {
  const educationText = keptLines(blocks, 'education').join('\n')
  const experienceText = keptLines(blocks, 'experience').join('\n')
  const projectText = keptLines(blocks, 'project').join('\n')
  // 提交时技能只取前 LIMITS.skills 条（splitList）；这里按同样的切法截到同样条数，屏上看到的就是会提交的。
  const skillsText = clampListText(keepFirstListItems(keptLines(blocks, 'skill').join('\n'), LIMITS.skills), TEXT_LIMITS.skill)
  const selfIntro = clampText(keptLines(blocks, 'selfintro').join('\n'), TEXT_LIMITS.selfIntro)
  if (!educationText && !experienceText && !projectText && !skillsText && !selfIntro) return null

  const form = emptyForm()
  if (educationText) form.education = [{ ...EMPTY_EDU, description: educationText }]
  if (experienceText) form.experience = [{ ...EMPTY_EXP, description: experienceText }]
  if (projectText) form.projects = [{ ...EMPTY_PROJ, description: projectText }]
  form.skillsText = skillsText
  form.selfIntro = selfIntro
  const seg: HistorySeg = experienceText ? 'exp' : educationText ? 'edu' : projectText ? 'proj' : 'exp'
  return { form, seg }
}
