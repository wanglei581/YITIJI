import type { GeneratedResume } from '../interfaces/ai-provider.interface'
import { optimizeAfterNearlySame } from './resume-optimize-after-align'
import { BULLET_RE, RESTORED_ROLE_MAX, RESTORED_TITLE_MAX, isTitleLike } from './resume-restored-text'
import { normalizeResumeStructureText, splitResumeDateRange } from './resume-structure'

type ProjectBaselineEntry = { key: string; overflow: boolean; lines: string[] }
type AlignModule = { before: string; after: string }

const PROJECT_LABEL_RE = /^(?:项目名称|项目角色|担任角色|项目描述|项目职责|项目成果|职责|成果)\s*[:：]\s*/u

function projectLineKey(line: string): string {
  return normalizeResumeStructureText(line.replace(BULLET_RE, ''))
}

function projectBody(line: string): string {
  let text = line.replace(BULLET_RE, '').trim()
  while (PROJECT_LABEL_RE.test(text)) text = text.replace(PROJECT_LABEL_RE, '').trim()
  return text
}

function isPhaseMark(text: string): boolean {
  const value = text.trim()
  if (/^(?:第?[0-9一二三四五六七八九十]{1,3}期)$/u.test(value)) return true
  if (/^phase\s*[0-9ivxlcdm]+$/iu.test(value)) return true
  return /^[IVXLCDMⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]{1,6}期?$/iu.test(value)
}

function parseProjectTitle(title: string): { name: string; role: string } {
  const text = projectBody(title)
  if (/[|丨]/u.test(text)) {
    let name = ''
    let role = ''
    for (const col of text.split(/\s*[|丨]\s*/u).map((part) => part.trim()).filter(Boolean)) {
      const dated = splitResumeDateRange(projectBody(col))
      const cleaned = dated ? [dated.before, dated.after].filter(Boolean).join(' ').trim() : projectBody(col)
      if (!cleaned) continue
      if (!name) name = cleaned
      else if (!role) role = cleaned
    }
    return { name, role }
  }
  const parts = splitResumeDateRange(text)
  const rest = (parts ? [parts.before, parts.after].filter(Boolean).join(' ') : text).trim()
  const paren = /^(.+?)[（(]([^）)]+)[）)]$/u.exec(rest)
  if (paren) {
    const inside = paren[2]?.trim() ?? ''
    if (inside && !isPhaseMark(inside)) return { name: paren[1]?.trim() ?? rest, role: inside }
    return { name: rest, role: '' }
  }
  return { name: rest, role: '' }
}

function shortModelName(modelName: string): boolean {
  const chars = [...modelName]
  if (chars.length <= 2) return true
  return chars.length <= 4 && chars.every((ch) => (ch.codePointAt(0) ?? 0) < 128)
}

function separateTrailingRole(namePart: string, modelName: string): { name: string; role: string } {
  const tokens = namePart.split(/\s+/u).filter(Boolean)
  if (tokens.length < 2 || !modelName || shortModelName(modelName)) return { name: namePart, role: '' }
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

function splitSentences(text: string): string[] {
  return text.split(/[。；;]/u).map((part) => part.trim()).filter(Boolean)
}

function textNear(leftRaw: string, rightRaw: string): boolean {
  const left = projectBody(leftRaw)
  const right = projectBody(rightRaw)
  if (!left || !right) return false
  const leftKey = projectLineKey(left)
  const rightKey = projectLineKey(right)
  if (leftKey && rightKey && (leftKey === rightKey || leftKey.includes(rightKey) || rightKey.includes(leftKey))) return true
  if (optimizeAfterNearlySame(left, right)) return true
  const leftParts = splitSentences(left)
  const rightParts = splitSentences(right)
  if (leftParts.length < 2 && rightParts.length < 2) return false
  return leftParts.some((part) => rightParts.some((other) => {
    const partKey = projectLineKey(part)
    const otherKey = projectLineKey(other)
    return Boolean((partKey && otherKey && (partKey === otherKey || partKey.includes(otherKey) || otherKey.includes(partKey))) || optimizeAfterNearlySame(part, other))
  }))
}

function afterLines(module: AlignModule): string[] {
  return module.after.split(/\n/u).map((line) => line.trim()).filter(Boolean)
}

function moduleCoversLine(text: string, module: AlignModule, description: string): boolean {
  const parts = afterLines(module)
  if (parts.length === 0) return false
  const descRows = description.split('\n').map((line) => line.trim()).filter(Boolean)
  if (!parts.every((part) => descRows.some((row) => textNear(row, part)))) return false
  const key = projectLineKey(text)
  const befores = module.before.split(/\n/u).map((line) => projectBody(line)).filter(Boolean)
  const source = befores.find((before) => {
    const beforeKey = projectLineKey(before)
    return beforeKey === key || (beforeKey.length > 0 && key.includes(beforeKey))
  })
  if (!source) return false
  if (projectLineKey(source) === key) return true
  const rest = text.replace(source, '').replace(/^[\s,，、;；:：]+/u, '').trim()
  const descKey = projectLineKey(descRows.map((row) => projectBody(row)).join(''))
  return !rest || descKey.includes(projectLineKey(rest))
}

function descriptionCovers(line: string, description: string, role: string, modules: AlignModule[]): boolean {
  const text = projectBody(line)
  const key = projectLineKey(text)
  if (!key) return true
  if (role && projectLineKey(role) === key) return true
  const descRows = description.split('\n').map((row) => row.trim()).filter(Boolean)
  if (descRows.some((row) => {
    const body = projectBody(row)
    const bodyKey = projectLineKey(body)
    if (bodyKey === key || (bodyKey && bodyKey.includes(key))) return true
    if (optimizeAfterNearlySame(body, text)) return true
    const sentences = splitSentences(body)
    return sentences.length > 1 && sentences.some((sentence) => {
      const sentenceKey = projectLineKey(sentence)
      return sentenceKey === key || (sentenceKey && sentenceKey.includes(key)) || optimizeAfterNearlySame(sentence, text)
    })
  })) return true
  return modules.some((module) => moduleCoversLine(text, module, description))
}

/**
 * 原稿每一段项目：名称只在模型名称是原名前缀、且原名里不含日期和角色时补全。
 * 标题行里的角色只在 role 为空时补上。原稿没写角色时不从描述推断。
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
      if (!descriptionCovers(line, description, role, modules)) {
        out.push(text)
        continue
      }
      const multi = modules.filter((module) => moduleCoversLine(text, module, description) && afterLines(module).length > 1)
      const indexes = multi.length > 0
        ? modelLines.flatMap((row, index) => (
          !taken.has(index) && multi.some((module) => afterLines(module).some((part) => textNear(row, part))) ? [index] : []
        ))
        : []
      const chosen = indexes.length > 0 ? indexes : modelLines.flatMap((row, index) => {
        if (taken.has(index) || indexes.length > 0) return []
        const body = projectBody(row)
        const bodyKey = projectLineKey(body)
        const direct = bodyKey === projectLineKey(text) || (bodyKey && bodyKey.includes(projectLineKey(text))) || optimizeAfterNearlySame(body, text)
        const byAfter = modules.some((module) => moduleCoversLine(text, module, description) && afterLines(module).some((part) => textNear(row, part)))
        return direct || byAfter ? [index] : []
      }).slice(0, 1)
      if (chosen.length === 0) {
        const coveredModule = modules.find((module) => moduleCoversLine(text, module, description))
        if (coveredModule) for (const part of afterLines(coveredModule)) out.push(projectBody(part))
        continue
      }
      for (const index of chosen) {
        taken.add(index)
        out.push(projectBody(modelLines[index] ?? text))
      }
    }
    item.description = out.filter(Boolean).join('\n')
  }
}
