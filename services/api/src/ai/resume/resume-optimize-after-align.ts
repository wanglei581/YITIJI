import type { ResumeOptimizeModule } from '../interfaces/ai-provider.interface'

/**
 * 一体机能否一键换上，只看优化稿某个字符串字段是否 includes(after)
 * （apps/kiosk/.../resumeDecisions.ts 的 resumeContainsText）。
 * 这里在最终返回的稿上做同一判断：对不上时，只把 after 改成稿里唯一一处
 * 仅差首尾空白或全半角标点的原文。多处相似不改，也不改稿本身。
 */
export interface OptimizeAfterDraft {
  optimizedResume: unknown
  modules: ResumeOptimizeModule[]
}

export interface OptimizeAfterMatchStats {
  total: number
  /** 返回前 after 已经能被 includes 找到。 */
  verbatim: number
  /** 唯一一处空白或标点差异，after 已改成稿里的原文。 */
  normalized: number
  /** 仍对不上，一体机继续显示只能手改。 */
  unmatched: number
}

const PUNCT_ASCII = (code: number): boolean =>
  (code >= 0x21 && code <= 0x2f)
  || (code >= 0x3a && code <= 0x40)
  || (code >= 0x5b && code <= 0x60)
  || (code >= 0x7b && code <= 0x7e)

/** 全角标点折成半角。只折标点，不折字母和数字。中文句号「。」按全角句号处理。 */
function foldChar(ch: string): string {
  const code = ch.codePointAt(0) ?? 0
  if (code >= 0xff01 && code <= 0xff5e) {
    const ascii = code - 0xfee0
    if (PUNCT_ASCII(ascii)) return String.fromCodePoint(ascii)
  }
  if (ch === '。') return '.'
  return ch
}

/** 与一体机 resumeContainsText 同一走法：只看字符串字段，不跨字段拼接。 */
export function resumeFieldIncludes(resume: unknown, text: string): boolean {
  if (!text) return false
  if (typeof resume === 'string') return resume.includes(text)
  if (Array.isArray(resume)) return resume.some((value) => resumeFieldIncludes(value, text))
  if (resume && typeof resume === 'object') {
    return Object.values(resume as Record<string, unknown>).some((value) => resumeFieldIncludes(value, text))
  }
  return false
}

function collectStrings(resume: unknown, out: string[] = []): string[] {
  if (typeof resume === 'string') {
    out.push(resume)
    return out
  }
  if (Array.isArray(resume)) {
    for (const value of resume) collectStrings(value, out)
    return out
  }
  if (resume && typeof resume === 'object') {
    for (const value of Object.values(resume as Record<string, unknown>)) collectStrings(value, out)
  }
  return out
}

/** 在一个字段里找与 core 仅差全半角标点的不重叠片段，返回字段里的原文。 */
function foldedHits(field: string, core: string): string[] {
  const source = [...field]
  const folded = source.map(foldChar)
  const needle = [...core].map(foldChar)
  const step = needle.length
  if (step === 0) return []
  const hits: string[] = []
  for (let index = 0; index + step <= folded.length;) {
    let same = true
    for (let offset = 0; offset < step; offset += 1) {
      if (folded[index + offset] !== needle[offset]) {
        same = false
        break
      }
    }
    if (!same) {
      index += 1
      continue
    }
    hits.push(source.slice(index, index + step).join(''))
    index += step
  }
  return hits
}

function uniqueFoldedHit(resume: unknown, core: string): string | undefined {
  const hits: string[] = []
  for (const field of collectStrings(resume)) hits.push(...foldedHits(field, core))
  // 只接受唯一一处。多处相似时不改 after。
  return hits.length === 1 ? hits[0] : undefined
}

export function alignOptimizeModuleAfter<T extends OptimizeAfterDraft>(draft: T): {
  result: T
  stats: OptimizeAfterMatchStats
} {
  const stats: OptimizeAfterMatchStats = { total: draft.modules.length, verbatim: 0, normalized: 0, unmatched: 0 }
  const modules = draft.modules.map((module) => {
    const after = module.after ?? ''
    const core = after.trim()
    if (!after || !core) {
      stats.unmatched += 1
      return module
    }
    if (resumeFieldIncludes(draft.optimizedResume, after)) {
      stats.verbatim += 1
      return module
    }
    const hit = uniqueFoldedHit(draft.optimizedResume, core)
    if (hit === undefined) {
      stats.unmatched += 1
      return module
    }
    stats.normalized += 1
    return { ...module, after: hit }
  })
  return { result: { ...draft, modules }, stats }
}
