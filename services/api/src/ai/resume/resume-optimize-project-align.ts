import type { GeneratedResume } from '../interfaces/ai-provider.interface'
import { optimizeAfterNearlySame } from './resume-optimize-after-align'
import { omittedColumnText, sequentialIndexColumn, stripClearLeadingIndex, stripNumberedColumn, withoutLeadingIndex } from './resume-optimize-list-align'
import { BULLET_RE, RESTORED_ROLE_MAX, RESTORED_TITLE_MAX, isTitleLike } from './resume-restored-text'
import { normalizeResumeStructureText, splitResumeDateRange } from './resume-structure'

type ProjectBaselineEntry = { key: string; overflow: boolean; lines: string[] }
type AlignModule = { before: string; after: string }

const PROJECT_LABEL_RE = /^(?:项目名称|项目角色|担任角色|项目描述|项目职责|项目成果|职责|成果)\s*[:：]\s*/u
const SUPPLEMENT_RE = /^(?:[（(][^）)]*[）)]|【[^】]*】|\[[^\]]*\])$/u

function projectLineKey(line: string): string {
  return normalizeResumeStructureText(line.replace(BULLET_RE, ''))
}

function projectBody(line: string): string {
  let text = line.replace(BULLET_RE, '').trim()
  while (PROJECT_LABEL_RE.test(text)) text = text.replace(PROJECT_LABEL_RE, '').trim()
  return text
}

function parseProjectTitle(title: string, keepLabels = false): { name: string; role: string } {
  const text = projectBody(title)
  if (/[|丨]/u.test(text)) {
    let name = ''
    let role = ''
    for (const col of text.split(/\s*[|丨]\s*/u).map((part) => part.trim()).filter(Boolean)) {
      // 栏里的「时间：」「角色：」先去掉。去掉日期后只剩括号补充（「（实习）」「【毕业设计】」「[V2.0]」），或整栏就是括号补充时，不当名称或角色。
      const body = projectBody(col).replace(/^(?:角色|职务|时间|日期|周期|项目时间)\s*[:：]\s*/u, '').trim()
      const dated = splitResumeDateRange(body)
      // 「项目周期：日期」「起止时间：日期」这类栏：日期前是「栏名：」时，栏名不当名称或角色。
      const labelled = !keepLabels && dated ? /[:：]\s*$/u.test(body.slice(0, body.indexOf(dated.period))) : false
      const cleaned = dated ? [labelled ? '' : dated.before, dated.after].filter(Boolean).join(' ').trim() : body
      if (!cleaned || SUPPLEMENT_RE.test(cleaned)) continue
      if (!name) name = cleaned
      else if (!role) role = cleaned
    }
    return { name, role }
  }
  const parts = splitResumeDateRange(text)
  const rest = (parts ? [parts.before, parts.after].filter(Boolean).join(' ') : text).trim()
  // 括号补充（毕业设计、课程设计、版本、端、期次）留在名称里。角色只认「角色：」和标题末尾的角色词。
  return { name: rest, role: '' }
}

function shortModelName(modelName: string): boolean {
  const chars = [...modelName]
  if (chars.length <= 2) return true
  return chars.length <= 4 && chars.every((ch) => (ch.codePointAt(0) ?? 0) < 128)
}

function separateTrailingRole(namePart: string, modelName: string): { name: string; role: string } {
  const tokens = namePart.split(/\s+/u).filter(Boolean)
  // 模型给的短名（「AI」「CRM」）只在标题只有「短名 + 一段」时不拆尾部角色；「CRM 客户管理系统 负责人」这种三段写法照样拆出角色。
  if (tokens.length < 2 || !modelName || (shortModelName(modelName) && tokens.length < 3)) return { name: namePart, role: '' }
  const role = tokens[tokens.length - 1] ?? ''
  // 末尾整段是括号补充（「 （毕业设计）」「 (V2.0)」「 【毕业设计】」「 [V2.0]」）时不当角色，留在名称里。
  if (SUPPLEMENT_RE.test(role)) return { name: namePart, role: '' }
  const name = tokens.slice(0, -1).join(' ')
  const nameMatches = name === modelName || (modelName.length >= 2 && name.startsWith(modelName) && name.length > modelName.length)
  if (!nameMatches || !isTitleLike(role, RESTORED_ROLE_MAX) || splitResumeDateRange(role) || splitResumeDateRange(name)) {
    return { name: namePart, role: '' }
  }
  return { name, role }
}

/** 全角半角圆括号、方头与方括号各自开合数相等。 */
function bracketsPaired(text: string): boolean {
  const count = (re: RegExp) => (text.match(re) ?? []).length
  return count(/[（(]/gu) === count(/[）)]/gu) && count(/[【[]/gu) === count(/[】\]]/gu)
}

function safeProjectName(name: string, role: string): boolean {
  if (!isTitleLike(name, RESTORED_TITLE_MAX) || splitResumeDateRange(name)) return false
  if (/[|丨：:]/u.test(name)) return false
  // 括号没配对（「智慧商城系统（时间」）是标题被日期切开的半截，不拿来补全名称。
  if (!bracketsPaired(name)) return false
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
  // 原稿描述成套编号时比对用的是剥掉编号的原句；module.before 常照抄带编号的原句，两种写法都认，原样在前。
  const befores = module.before.split(/\n/u).flatMap((line) => {
    const body = projectBody(line)
    const bare = projectBody(withoutLeadingIndex(line))
    return bare && bare !== body ? [body, bare] : [body]
  }).filter(Boolean)
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

/** 「（1）」「(2)」成套递增。点号分类器认不出这种括号，单独看。 */
function bracketNumberedColumn(lines: string[]): boolean {
  const filled = lines.map((line) => line.trim()).filter(Boolean)
  if (filled.length < 2) return false
  return filled.every((line, index) => {
    const match = /^[（(]\s*(\d{1,2})\s*[）)]/u.exec(line)
    return Number(match?.[1]) === index + 1
  })
}

/** 原稿描述被认成整栏编号（剥过至少一行，或是「（1）（2）」）时，模型行上的「1.」「（2）」才可以按编号剥。 */
function numberedSourceColumn(lines: string[]): boolean {
  if (bracketNumberedColumn(lines) || sequentialIndexColumn(lines)) return true
  const stripped = stripNumberedColumn(lines)
  return lines.some((line, index) => (stripped[index] ?? line) !== line)
}

const NUMBERED_LINE_RE = /^\s*(?:\d{1,2}\s*[.．、)）]|[（(]\s*\d{1,2}\s*[）)])/u

/** 与批量检查同一套写法：全角点号、顿号、右括号都看成半角点，行首「（1）」看成「1.」。 */
function numberedLineCanon(text: string): string {
  return text.trim().replace(/[．、)）]/gu, '.').replace(/^[（(]\s*(\d{1,2})\s*[）)]/u, '$1.')
}

/** 这一行的正文来自原稿描述或 module 改写。对不上的（模型另加的一句）不留。 */
function groundedDescriptionLine(line: string, originals: string[], modules: AlignModule[]): boolean {
  const body = projectBody(line)
  // 「2.5倍」「2.10倍」「1.0版本」仍带编号，又和原稿任何一行都不是同一句时，不能靠较短正文算作已落地。
  if (NUMBERED_LINE_RE.test(body)) {
    const canon = numberedLineCanon(body)
    if (!originals.some((raw) => numberedLineCanon(projectBody(raw)) === canon)) return false
  }
  const key = projectLineKey(body)
  if (!key) return false
  const pools: string[] = []
  for (const raw of originals) {
    const rawBody = projectBody(raw)
    const bare = projectBody(withoutLeadingIndex(raw))
    for (const text of bare !== rawBody ? [rawBody, bare] : [rawBody]) {
      const pool = projectLineKey(text)
      if (pool) pools.push(pool)
    }
  }
  for (const module of modules) {
    const whole = projectLineKey(module.after ?? '')
    if (whole) pools.push(whole)
    for (const part of afterLines(module)) {
      const pool = projectLineKey(projectBody(part))
      if (pool) pools.push(pool)
    }
  }
  return pools.some((pool) => pool === key || pool.includes(key) || key.includes(pool))
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
    const [title, ...rawRest] = entry.lines
    if (!title) continue
    const rest = stripNumberedColumn(rawRest)
    const pick = (name: string): number => {
      const nameKey = projectLineKey(name)
      if (!nameKey) return -1
      let found = -1
      let bestScore = 0
      resume.projects.forEach((item, index) => {
        if (used.has(index)) return
        const itemKey = projectLineKey(item.name)
        if (!itemKey || (!nameKey.includes(itemKey) && !itemKey.includes(nameKey))) return
        const score = (itemKey === nameKey ? 10000 : 0) + Math.min(itemKey.length, nameKey.length)
        if (score > bestScore) { found = index; bestScore = score }
      })
      return found
    }
    let parsed = parseProjectTitle(title)
    let best = pick(parsed.name)
    // 「名称：日期 | 角色」：首栏冒号前是项目名、不是栏名。按栏名丢掉后配不上任何模型项目时，留下冒号前那段再配一次。
    if (best < 0) {
      const keptLabels = parseProjectTitle(title, true)
      const retry = pick(keptLabels.name)
      if (retry >= 0) { parsed = keptLabels; best = retry }
    }
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
    const rawDescription = item.description ?? ''
    const rawRows = rawDescription.split('\n')
    // 先按整栏剥（「1.5倍」打头且后面是 2. 3. 时仍剥成「5倍」）。只有原稿描述是成套编号时，才逐行剥明确编号，并丢掉对不上原稿或改写的句子。普通散文改写（Kk）不走这一步。
    const columnStripped = stripNumberedColumn(rawRows)
    const preparedRows = numberedSourceColumn(rawRest)
      ? columnStripped
        .map((line) => stripClearLeadingIndex(line))
        .filter((line) => !line.trim() || groundedDescriptionLine(line, rawRest, modules))
      : columnStripped
    const description = preparedRows.join('\n')
    if (description !== rawDescription) item.description = description
    const role = item.role?.trim() ?? ''
    const uncovered = rest.filter((line) => {
      const text = projectBody(line)
      return text && !descriptionCovers(line, description, role, modules)
    })
    if (uncovered.length === 0) continue
    const modelLines = description.split('\n').map((line) => line.trim()).filter(Boolean)
    const taken = new Set<number>()
    const out: string[] = []
    for (let lineIndex = 0; lineIndex < rest.length; lineIndex += 1) {
      const line = rest[lineIndex] ?? ''
      const rawLine = rawRest[lineIndex] ?? line
      const text = projectBody(line)
      if (!text) continue
      if (role && projectLineKey(role) === projectLineKey(text)) continue
      if (!descriptionCovers(line, description, role, modules)) {
        // 编号后紧跟 1–3 位数字的漏交句原样补回；四位年份和普通编号仍用剥过的正文。
        out.push(projectBody(omittedColumnText(rawLine, line)))
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
        // 跨行 module 的改写前一行已经放过一次，这一行不再放，避免改写印两遍。
        if (coveredModule) {
          for (const part of afterLines(coveredModule)) {
            const body = projectBody(part)
            if (!out.some((row) => projectLineKey(row) === projectLineKey(body) || optimizeAfterNearlySame(row, body))) out.push(body)
          }
        }
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
