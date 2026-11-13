import type { GeneratedResume } from '../interfaces/ai-provider.interface'
import { normalizeResumeStructureText, splitResumeDateRange } from './resume-structure'

type ProjectBaselineEntry = { key: string; overflow: boolean; lines: string[] }

/** 与覆盖补回里的标题、职务上限一致：超过或带句读就不当名称、角色。 */
const RESTORED_TITLE_MAX = 40
const RESTORED_ROLE_MAX = 20
const BULLET_RE = /^[\s·•●▪■◆*\-–—]+/u
const LIST_ATOM_SPLIT = /[、，,；]/u
/** 只去掉技能、证书栏目标题。词表与 resume-optimize-coverage 的 HEADINGS 里这两栏一致。 */
const LIST_HEADING_RE = /^(专业技能|技能证书|技能与证书|技能特长|技能|证书资质|证书|资格证书|获奖情况)(?=$|[\s:：])/u

function isTitleLike(text: string, max: number): boolean {
  return text.length > 0 && text.length <= max && !/[，。；,;!！?？\n]/u.test(text)
}

/** 技能、证书比对前去掉行首项目符号和同一行上的栏目标题。 */
export function strippedListLine(line: string): string {
  let text = line.trim().replace(BULLET_RE, '').trim()
  if (LIST_HEADING_RE.test(text)) text = text.replace(LIST_HEADING_RE, '').replace(/^[\s:：]+/u, '').trim()
  return text
}

function listAtoms(line: string): string[] {
  const text = strippedListLine(line)
  if (!text) return []
  return text.split(LIST_ATOM_SPLIT).map((part) => part.trim()).filter(Boolean)
}

/** 短的一边至少 2 字，且不短于长的一边的一半，才算同一小项的改写。 */
export function similarListAtom(left: string, right: string): boolean {
  if (!left || !right || left === right) return left === right && left.length > 0
  const shorter = Math.min(left.length, right.length)
  const longer = Math.max(left.length, right.length)
  return shorter >= 2 && shorter / longer >= 0.5 && (left.includes(right) || right.includes(left))
}

/**
 * 按原稿顺序对齐技能或证书，只补模型真没交的小项。
 * 先去掉行首项目符号和同行栏目标题，再按「、，,；」拆开、归一化后比。
 * 模型把一行拆成几项、或把几项并成一项，都按小项对上，不把整行再补一遍。
 * 条数相同但内容不相似时不当作改写：原稿的小项补回原位，模型编的不留。
 * 不到导出上限不截。
 */
export function alignOriginalList(lines: string[], model: string[], max: number): { list: string[]; missing: string[] } {
  const norm = normalizeResumeStructureText
  const originals = lines.map((line) => line.trim()).filter(Boolean)
  const pool = model.map((raw) => {
    const cleaned = strippedListLine(raw)
    const atoms = listAtoms(raw)
    return { cleaned, n: norm(cleaned), atoms, atomUsed: atoms.map(() => false), used: false }
  }).filter((item) => item.cleaned)
  const list: string[] = []
  const missing: string[] = []
  const takeAtom = (atom: string): string | null => {
    const key = norm(atom)
    if (!key) return null
    for (const item of pool) {
      if (item.used) continue
      const index = item.atoms.findIndex((part, i) => !item.atomUsed[i] && norm(part) === key)
      if (index < 0) continue
      item.atomUsed[index] = true
      if (item.atomUsed.every(Boolean)) item.used = true
      return item.atoms[index] ?? atom
    }
    let bestItem: (typeof pool)[number] | null = null
    let bestIndex = -1
    let bestGap = Number.POSITIVE_INFINITY
    for (const item of pool) {
      if (item.used) continue
      for (let index = 0; index < item.atoms.length; index += 1) {
        if (item.atomUsed[index]) continue
        const partKey = norm(item.atoms[index] ?? '')
        if (!similarListAtom(partKey, key)) continue
        const gap = Math.abs(partKey.length - key.length)
        if (gap < bestGap) {
          bestItem = item
          bestIndex = index
          bestGap = gap
        }
      }
    }
    if (!bestItem || bestIndex < 0) return null
    bestItem.atomUsed[bestIndex] = true
    if (bestItem.atomUsed.every(Boolean)) bestItem.used = true
    return bestItem.atoms[bestIndex] ?? atom
  }
  for (const line of originals) {
    const cleaned = strippedListLine(line)
    if (!cleaned) continue
    const whole = pool.find((item) => !item.used && item.n === norm(cleaned))
    if (whole) {
      whole.used = true
      whole.atomUsed.fill(true)
      list.push(whole.cleaned)
      continue
    }
    for (const atom of listAtoms(line)) {
      const hit = takeAtom(atom)
      if (hit) list.push(hit)
      else {
        missing.push(atom)
        list.push(atom)
      }
    }
  }
  return { list: list.length > max ? list.slice(0, max) : list, missing }
}

function projectLineKey(line: string): string {
  return normalizeResumeStructureText(line.replace(BULLET_RE, ''))
}

/**
 * 原稿每一段项目：名称按原名补回被缩短的那一截，标题行里的角色只在 role 为空时补上。
 * 描述只补模型真没交的句子。去掉行首符号、归一化后能对上的，或已被某条 module
 * 的 before→after 改写且改写还在描述里的，都算覆盖，不再把原句接一遍。
 */
export function ensureProjectOriginalLines(
  resume: GeneratedResume,
  baseline: ProjectBaselineEntry[],
  modules: Array<{ before: string; after: string }>,
): void {
  const used = new Set<number>()
  for (const entry of baseline) {
    if (entry.key !== 'projects' || entry.overflow) continue
    const [title, ...rest] = entry.lines
    if (!title) continue
    const parts = splitResumeDateRange(title)
    const namePart = strippedListLine(parts?.before || title)
    const rolePart = (parts?.after ?? '').trim()
    const nameKey = projectLineKey(namePart)
    if (!nameKey) continue
    let best = -1
    let bestScore = 0
    resume.projects.forEach((item, index) => {
      if (used.has(index)) return
      const itemKey = projectLineKey(item.name)
      if (!itemKey || (!nameKey.includes(itemKey) && !itemKey.includes(nameKey))) return
      const score = (itemKey === nameKey ? 10000 : 0) + Math.min(itemKey.length, nameKey.length)
      if (score > bestScore) { best = index; bestScore = score }
    })
    if (best < 0) continue
    used.add(best)
    const item = resume.projects[best]!
    const itemKey = projectLineKey(item.name)
    if (itemKey && nameKey.includes(itemKey) && itemKey !== nameKey && isTitleLike(namePart, RESTORED_TITLE_MAX)) {
      item.name = namePart
    }
    if (!item.role?.trim() && rolePart && isTitleLike(rolePart, RESTORED_ROLE_MAX)) item.role = rolePart
    const description = item.description ?? ''
    const descKey = projectLineKey(description)
    const covered = (line: string): boolean => {
      const lineKey = projectLineKey(line)
      if (!lineKey) return true
      if (descKey.includes(lineKey)) return true
      if (item.role && projectLineKey(item.role) === lineKey) return true
      return modules.some((module) => {
        const afterKey = projectLineKey(module.after)
        if (!afterKey || !descKey.includes(afterKey)) return false
        return module.before.split(/\n/u).some((beforeLine) => {
          const beforeKey = projectLineKey(beforeLine)
          return beforeKey === lineKey || similarListAtom(beforeKey, lineKey)
        })
      })
    }
    const extra = rest
      .map((line) => line.replace(BULLET_RE, '').trim())
      .filter((line) => line && !covered(line))
    if (extra.length === 0) continue
    item.description = [item.description, ...extra].filter(Boolean).join('\n')
  }
}
