import type { GeneratedResume } from '../interfaces/ai-provider.interface'
import { optimizeAfterNearlySame } from './resume-optimize-after-align'
import { BULLET_RE, RESTORED_ROLE_MAX, RESTORED_TITLE_MAX, isTitleLike } from './resume-restored-text'
import { normalizeResumeStructureText, splitResumeDateRange } from './resume-structure'

type ProjectBaselineEntry = { key: string; overflow: boolean; lines: string[] }
type AlignModule = { before: string; after: string }

/** 只去掉技能、证书栏目标题。词表与 resume-optimize-coverage 的 HEADINGS 里这两栏一致。 */
const LIST_HEADING_RE = /^(专业技能|技能证书|技能与证书|技能特长|技能)(?=$|[\s:：])|^(证书资质|证书|资格证书|获奖情况)(?=$|[\s:：])/u
const LEADING_INDEX_RE = /^(?:\d{1,2}\s*[、.．]|[一二三四五六七八九十]{1,3}\s*[、.．]|[（(]\s*\d{1,2}\s*[）)]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])\s*/u
const BRACKET_TITLE_RE = /^【[^】]{0,20}】\s*/u
const PROJECT_LABEL_RE = /^(?:项目名称|项目角色|担任角色|项目描述|项目职责|项目成果|职责|成果)\s*[:：]\s*/u

export interface AlignOriginalListOptions {
  modules?: AlignModule[]
  /** 已经落在别的栏里的小项（技能对齐时传入证书），不再补进这一栏。 */
  coveredElsewhere?: string[]
}

/** 短的一边至少 2 字，且不短于长的一边的一半，才算同一小项的改写。 */
export function similarListAtom(left: string, right: string): boolean {
  if (!left || !right || left === right) return left === right && left.length > 0
  const shorter = Math.min(left.length, right.length)
  const longer = Math.max(left.length, right.length)
  return shorter >= 2 && shorter / longer >= 0.5 && (left.includes(right) || right.includes(left))
}

/** 技能、证书比对前去掉行首项目符号、栏目标题、【】标题和行首编号。 */
export function strippedListLine(line: string): string {
  let text = line.trim().replace(BULLET_RE, '').trim()
  if (LIST_HEADING_RE.test(text)) text = text.replace(LIST_HEADING_RE, '').replace(/^[\s:：]+/u, '').trim()
  text = text.replace(BRACKET_TITLE_RE, '').trim()
  while (LEADING_INDEX_RE.test(text)) text = text.replace(LEADING_INDEX_RE, '').trim()
  return text
}

/** 括号里的顿号、分号不拆。`; / 和 及 与` 以及原来的顿号逗号只在括号外当分隔。 */
function splitAtoms(text: string): string[] {
  const masked = text.replace(/（[^）]*）|\([^)]*\)/gu, (chunk) => ' '.repeat([...chunk].length))
  const chars = [...text]
  const maskedChars = [...masked]
  const parts: string[] = []
  let start = 0
  for (let i = 0; i < chars.length; i += 1) {
    const ch = maskedChars[i] ?? ''
    if (!/[、，,；;/和及与]/u.test(ch)) continue
    const piece = chars.slice(start, i).join('').trim()
    if (piece) parts.push(piece)
    start = i + 1
  }
  const tail = chars.slice(start).join('').trim()
  if (tail) parts.push(tail)
  return parts.filter(Boolean)
}

function lineCoveredByModule(line: string, modules: AlignModule[]): boolean {
  const key = normalizeResumeStructureText(strippedListLine(line))
  if (!key) return false
  return modules.some((module) => {
    const after = module.after?.trim() ?? ''
    if (!after) return false
    const whole = normalizeResumeStructureText(strippedListLine(module.before)) === key
    const oneLine = module.before.split(/\n/u).some((beforeLine) => normalizeResumeStructureText(strippedListLine(beforeLine)) === key)
    return whole || oneLine
  })
}

function moduleAfterInModel(line: string, modules: AlignModule[], modelDisplays: string[]): string | null {
  if (!lineCoveredByModule(line, modules)) return null
  const key = normalizeResumeStructureText(strippedListLine(line))
  for (const module of modules) {
    const after = module.after?.trim() ?? ''
    if (!after) continue
    const covers = normalizeResumeStructureText(strippedListLine(module.before)) === key
      || module.before.split(/\n/u).some((beforeLine) => normalizeResumeStructureText(strippedListLine(beforeLine)) === key)
    if (!covers) continue
    const found = modelDisplays.find((display) => normalizeResumeStructureText(display) === normalizeResumeStructureText(strippedListLine(after))
      || normalizeResumeStructureText(display) === normalizeResumeStructureText(after))
    if (found) return found
  }
  return null
}

/**
 * 按原稿顺序对齐技能或证书。
 * 有 module 撑腰、且 after 在模型列表里的整行，用改写，不拆原行。
 * 没有 module、又和任何原稿项都不相似的模型项不进成品。
 * 比对前剥行首编号和【】标题；括号里不拆。先全局逐字配对，再在剩下的里做相似配对，
 * 相似配对不许抢走后面原稿项的逐字匹配。
 */
export function alignOriginalList(
  lines: string[],
  model: string[],
  max: number,
  options?: AlignOriginalListOptions,
): { list: string[]; missing: string[] } {
  const norm = normalizeResumeStructureText
  const modules = options?.modules ?? []
  const covered = new Set<string>()
  for (const raw of options?.coveredElsewhere ?? []) {
    const display = strippedListLine(raw)
    if (!display) continue
    covered.add(norm(display))
    for (const atom of splitAtoms(display)) covered.add(norm(atom))
  }
  const originals = lines.map((line) => line.trim()).filter(Boolean)
  type Atom = { display: string; key: string; used: boolean }
  type Item = { display: string; key: string; atoms: Atom[]; used: boolean }
  const pool: Item[] = model.map((raw) => {
    const display = strippedListLine(raw)
    const atoms = splitAtoms(display).map((part) => ({ display: part, key: norm(part), used: false }))
    return { display, key: norm(display), atoms, used: false }
  }).filter((item) => item.display)
  const list: string[] = []
  const missing: string[] = []
  const push = (text: string, wasMissing = false) => {
    const key = norm(text)
    if (!key || covered.has(key)) return
    list.push(text)
    if (wasMissing) missing.push(text)
  }
  const takeExact = (key: string): string | null => {
    for (const item of pool) {
      if (item.used) continue
      const atom = item.atoms.find((part) => !part.used && part.key === key)
      if (!atom) continue
      atom.used = true
      if (item.atoms.every((part) => part.used)) item.used = true
      return atom.display
    }
    return null
  }
  const canTakeAll = (keys: string[]): boolean => {
    const used = new Set<string>()
    return keys.every((key) => {
      for (const item of pool) {
        if (item.used) continue
        const index = item.atoms.findIndex((part, atomIndex) => !part.used && part.key === key && !used.has(`${pool.indexOf(item)}:${atomIndex}`))
        if (index < 0) continue
        used.add(`${pool.indexOf(item)}:${index}`)
        return true
      }
      return false
    })
  }

  type Slot = { display: string; key: string; out: string | null }
  const rows: Slot[][] = []
  for (const line of originals) {
    const rewritten = moduleAfterInModel(line, modules, pool.filter((item) => !item.used).map((item) => item.display))
    if (rewritten) {
      const hit = pool.find((item) => !item.used && item.display === rewritten)
      if (hit) { hit.used = true; hit.atoms.forEach((atom) => { atom.used = true }) }
      rows.push([{ display: rewritten, key: norm(rewritten), out: rewritten }])
      continue
    }
    const display = strippedListLine(line)
    if (!display) continue
    const whole = pool.find((item) => !item.used && item.key === norm(display))
    if (whole) {
      whole.used = true
      whole.atoms.forEach((atom) => { atom.used = true })
      rows.push([{ display: whole.display, key: whole.key, out: whole.display }])
      continue
    }
    rows.push(splitAtoms(display).map((part) => ({ display: part, key: norm(part), out: null })))
  }

  const open = rows.flatMap((row) => row.filter((slot) => slot.out === null))
  for (const slot of open) {
    const hit = takeExact(slot.key)
    if (hit) slot.out = hit
  }
  for (const slot of open) {
    if (slot.out !== null || !/\s/u.test(slot.display)) continue
    const pieces = slot.display.split(/\s+/u).map((part) => part.trim()).filter(Boolean)
    if (pieces.length < 2) continue
    const keys = pieces.map((part) => norm(part))
    if (!canTakeAll(keys)) continue
    const displays: string[] = []
    let taken = true
    for (const key of keys) {
      const hit = takeExact(key)
      if (!hit) { taken = false; break }
      displays.push(hit)
    }
    if (!taken) continue
    slot.out = displays.join('\u0001')
  }
  const reserved = new Set(open.filter((slot) => slot.out === null).map((slot) => slot.key))
  for (const slot of open) {
    if (slot.out !== null) continue
    let bestItem: Item | null = null
    let bestIndex = -1
    let bestGap = Number.POSITIVE_INFINITY
    for (const item of pool) {
      if (item.used) continue
      for (let partIndex = 0; partIndex < item.atoms.length; partIndex += 1) {
        const part = item.atoms[partIndex]
        if (!part || part.used || part.key === slot.key || reserved.has(part.key)) continue
        if (!slot.key.includes(part.key) || !similarListAtom(slot.key, part.key)) continue
        const gap = Math.abs(part.key.length - slot.key.length)
        if (gap < bestGap) { bestItem = item; bestIndex = partIndex; bestGap = gap }
      }
    }
    if (!bestItem || bestIndex < 0) continue
    const part = bestItem.atoms[bestIndex]
    if (!part) continue
    part.used = true
    if (bestItem.atoms.every((candidate) => candidate.used)) bestItem.used = true
    slot.out = part.display
    reserved.delete(slot.key)
  }
  for (const row of rows) {
    for (const slot of row) {
      const value = slot.out ?? slot.display
      const wasMissing = slot.out === null
      for (const piece of value.split('\u0001')) push(piece, wasMissing)
    }
  }
  return { list: list.length > max ? list.slice(0, max) : list, missing }
}

function projectLineKey(line: string): string {
  return normalizeResumeStructureText(line.replace(BULLET_RE, ''))
}

function projectBody(line: string): string {
  let text = line.replace(BULLET_RE, '').trim()
  while (PROJECT_LABEL_RE.test(text)) text = text.replace(PROJECT_LABEL_RE, '').trim()
  return text
}

function parseProjectTitle(title: string): { name: string; role: string } {
  const text = projectBody(title)
  if (/[|丨]/u.test(text)) {
    let name = ''
    let role = ''
    for (const col of text.split(/\s*[|丨]\s*/u).map((part) => part.trim()).filter(Boolean)) {
      if (splitResumeDateRange(col)) continue
      const cleaned = projectBody(col)
      if (!name) name = cleaned
      else if (!role) role = cleaned
    }
    return { name, role }
  }
  const parts = splitResumeDateRange(text)
  const rest = (parts ? [parts.before, parts.after].filter(Boolean).join(' ') : text).trim()
  const paren = /^(.+?)[（(]([^）)]+)[）)]$/u.exec(rest)
  if (paren) return { name: paren[1]?.trim() ?? rest, role: paren[2]?.trim() ?? '' }
  return { name: rest, role: '' }
}

function separateTrailingRole(namePart: string, modelName: string): { name: string; role: string } {
  const tokens = namePart.split(/\s+/u).filter(Boolean)
  if (tokens.length < 2 || !modelName) return { name: namePart, role: '' }
  const role = tokens[tokens.length - 1] ?? ''
  const name = tokens.slice(0, -1).join(' ')
  const nameMatches = name === modelName || (modelName.length >= 2 && name.startsWith(modelName) && name.length > modelName.length)
  if (!nameMatches || !isTitleLike(role, RESTORED_ROLE_MAX) || splitResumeDateRange(role) || splitResumeDateRange(name)) {
    return { name: namePart, role: '' }
  }
  return { name, role }
}

function safeProjectName(name: string, role: string): boolean {
  if (!isTitleLike(name, RESTORED_TITLE_MAX) || splitResumeDateRange(name)) return false
  if (/[|丨：:]/u.test(name)) return false
  if (role && name.includes(role)) return false
  return true
}

function descriptionCovers(line: string, description: string, role: string, modules: AlignModule[]): boolean {
  const text = projectBody(line)
  const key = projectLineKey(text)
  if (!key) return true
  if (role && projectLineKey(role) === key) return true
  const descKey = projectLineKey(description)
  if (descKey.includes(key)) return true
  return modules.some((module) => {
    const after = module.after?.trim() ?? ''
    if (!after) return false
    const afterIn = descKey.includes(projectLineKey(after))
      || description.split('\n').some((row) => optimizeAfterNearlySame(row, after))
    if (!afterIn) return false
    const befores = module.before.split(/\n/u).map((row) => row.trim()).filter(Boolean)
    const source = befores.find((before) => {
      const beforeKey = projectLineKey(before)
      return beforeKey === key || (beforeKey.length > 0 && key.includes(beforeKey))
    })
    if (!source) return false
    if (projectLineKey(source) === key) return true
    const rest = text.replace(source, '').replace(/^[\s,，、;；:：]+/u, '').trim()
    return !rest || descKey.includes(projectLineKey(rest))
  })
}

/**
 * 原稿每一段项目：名称只在模型名称是原名前缀、且原名里不含日期和角色时补全。
 * 标题行里的角色只在 role 为空时补上，不把「名称 角色」整段写进 role。
 * 描述只补模型真没交、也没有 module 撑腰的句子，并按原稿行序插回。
 */
export function ensureProjectOriginalLines(
  resume: GeneratedResume,
  baseline: ProjectBaselineEntry[],
  modules: AlignModule[],
): void {
  const used = new Set<number>()
  for (const entry of baseline) {
    if (entry.key !== 'projects' || entry.overflow) continue
    const [title, ...rest] = entry.lines
    if (!title) continue
    const parsed = parseProjectTitle(title)
    const nameKey = projectLineKey(parsed.name)
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
    const modelName = item.name?.trim() || ''
    const separated = separateTrailingRole(parsed.name, modelName)
    const roleFromTitle = parsed.role || separated.role
    const namePart = separated.role ? separated.name : parsed.name
    if (
      modelName
      && namePart.startsWith(modelName)
      && modelName !== namePart
      && safeProjectName(namePart, item.role?.trim() || roleFromTitle)
    ) item.name = namePart
    if (!item.role?.trim() && roleFromTitle && isTitleLike(roleFromTitle, RESTORED_ROLE_MAX)) item.role = roleFromTitle
    const bodies = rest.map(projectBody).filter(Boolean)
    if (!item.role?.trim() && bodies.length > 1) {
      const first = bodies[0] ?? ''
      const later = bodies.slice(1).some((text) => !isTitleLike(text, RESTORED_ROLE_MAX))
      if (first && later && isTitleLike(first, RESTORED_ROLE_MAX) && !splitResumeDateRange(first)) item.role = first
    }
    const description = item.description ?? ''
    const role = item.role?.trim() ?? ''
    const uncovered = rest.filter((line) => {
      const text = projectBody(line)
      return text && !descriptionCovers(line, description, role, modules)
    })
    if (uncovered.length === 0) continue
    const modelLines = description.split('\n').map((line) => line.trim()).filter(Boolean)
    const taken = new Set<number>()
    const out: string[] = []
    for (const line of rest) {
      const text = projectBody(line)
      if (!text) continue
      if (role && projectLineKey(role) === projectLineKey(text)) continue
      if (descriptionCovers(line, description, role, modules)) {
        const index = modelLines.findIndex((row, rowIndex) => !taken.has(rowIndex) && (
          projectLineKey(row) === projectLineKey(text)
          || projectLineKey(row).includes(projectLineKey(text))
          || optimizeAfterNearlySame(row, text)
          || modules.some((module) => projectLineKey(text).includes(projectLineKey(module.before))
            && (projectLineKey(row).includes(projectLineKey(module.after)) || optimizeAfterNearlySame(row, module.after)))
        ))
        if (index >= 0) { out.push(modelLines[index] ?? text); taken.add(index) }
        continue
      }
      out.push(text)
    }
    item.description = out.filter(Boolean).join('\n')
  }
}
