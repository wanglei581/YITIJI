import type { GeneratedResume, ResumeGenerateInput, ResumeOptimizeModule } from '@ai-job-print/shared'
import { findFactAdditions } from './factAdditionsRule'

export type FactKind = 'school' | 'company' | 'period' | 'certificate' | 'phone'

export interface ConfirmableFact {
  id: string
  kind: FactKind
  label: string
  value: string
}

export function extractConfirmableFacts(resume: GeneratedResume): ConfirmableFact[] {
  const facts: ConfirmableFact[] = []
  resume.education.forEach((item, i) => {
    if (item.school.trim()) facts.push({ id: `school-${i}`, kind: 'school', label: '学校', value: item.school })
    if (item.period?.trim()) facts.push({ id: `edu-period-${i}`, kind: 'period', label: '教育时间段', value: item.period })
  })
  resume.experience.forEach((item, i) => {
    if (item.company.trim()) facts.push({ id: `company-${i}`, kind: 'company', label: '公司', value: item.company })
    if (item.period?.trim()) facts.push({ id: `exp-period-${i}`, kind: 'period', label: '工作时间段', value: item.period })
  })
  resume.certificates.forEach((item, i) => {
    if (item.trim()) facts.push({ id: `cert-${i}`, kind: 'certificate', label: '证书', value: item })
  })
  if (resume.basic.phone?.trim()) {
    facts.push({ id: 'phone', kind: 'phone', label: '电话', value: resume.basic.phone })
  }
  return facts
}

/**
 * 「待本人确认」那一行下面对人说的话（走查 I-21：「待本人确认：负责、1500、0.5%」普通人读不懂）。
 * 这几处是 AI 整理时新写进去的数和职责词，本机无从判断真假，只有本人知道，所以要本人核对。预览页、导出前核对弹层、
 * 优化页编辑屏三处共用这一句。
 */
export const UNCONFIRMED_WHY = 'AI 整理时新写进了这几处，你原来的内容里没有。请核对是不是你的实际情况；不是，就改掉或删掉再导出。'

/** 逐条对照共用的机械规则：after 有、before 无的数字与职责词。返回给人看的片段。 */
export function detectUnconfirmedTextAdditions(afterText: string, beforeText: string): string[] {
  const hits: string[] = []
  for (const item of findFactAdditions(afterText, beforeText)) {
    if (!hits.includes(item.text)) hits.push(item.text)
  }
  return hits
}

function collectBeforeText(
  modules: ResumeOptimizeModule[] | undefined,
  originalInput: ResumeGenerateInput | undefined,
): string {
  if (modules && modules.length > 0) return modules.map((m) => m.before).join('\n')
  if (!originalInput) return ''
  return JSON.stringify(originalInput)
}

/**
 * 描述要多像才在「公司/学校/项目名 + 职务/专业/角色」对不上之后认成同一条。
 * 字二元组 Dice：2 × 重合组数 / 两组总数，空格不参与。
 * 「负责日常工作」和「负责日常运营」实算 0.60，只是套话像，配上会把另一条里 AI 的数字豁免掉。
 * 「周更 2 篇」和「每周更新 2 篇」实算 0.50，改几个字也可能只有一半像。
 * 0.72 高于这两类。低于它就不配，这条里的数字一律待确认。
 */
const DESCRIPTION_MATCH_MIN = 0.72

type EntrySection = 'education' | 'experience' | 'projects'

interface EntryRef {
  name: string
  role: string
  description: string
  source: object
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, '')
}

function stableId(source: object): string | null {
  if (!('id' in source)) return null
  const id = (source as { id?: unknown }).id
  if (typeof id !== 'string') return null
  const trimmed = id.trim()
  return trimmed ? trimmed : null
}

function educationRefs(resume: GeneratedResume): EntryRef[] {
  return resume.education.map((item) => ({
    name: item.school,
    role: item.major ?? '',
    description: item.description ?? '',
    source: item,
  }))
}

function experienceRefs(resume: GeneratedResume): EntryRef[] {
  return resume.experience.map((item) => ({
    name: item.company,
    role: item.role,
    description: item.description ?? '',
    source: item,
  }))
}

function projectRefs(resume: GeneratedResume): EntryRef[] {
  return resume.projects.map((item) => ({
    name: item.name,
    role: item.role ?? '',
    description: item.description ?? '',
    source: item,
  }))
}

function sectionRefs(section: EntrySection, resume: GeneratedResume): EntryRef[] {
  if (section === 'education') return educationRefs(resume)
  if (section === 'experience') return experienceRefs(resume)
  return projectRefs(resume)
}

/** 公司/学校/项目名为空时不算稳定身份，避免两条空标题被当成同一条。 */
function nameKey(entry: EntryRef): string | null {
  const name = normalizeLabel(entry.name)
  if (!name) return null
  return `${name}\u0001${normalizeLabel(entry.role)}`
}

/**
 * 没有 id、名称键又不止一条时，在名称键后加上同名第几段。
 * 序号按传入的这一份列表数。核对和记令牌都传生成稿，本人把两段对调也不改序号。
 */
function sameNameOrdinals(entries: EntryRef[]): Array<number | null> {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    if (stableId(entry.source)) continue
    const key = nameKey(entry)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  return entries.map((entry) => {
    if (stableId(entry.source)) return null
    const key = nameKey(entry)
    if (!key || (counts.get(key) ?? 0) < 2) return null
    const next = (seen.get(key) ?? 0) + 1
    seen.set(key, next)
    return next
  })
}

function entryPath(section: EntrySection, entry: EntryRef, sameNameOrdinal: number | null): string {
  const id = stableId(entry.source)
  const suffix = sameNameOrdinal === null ? '' : `:同名${sameNameOrdinal}`
  const body = id ? `id:${id}` : `name:${nameKey(entry) ?? ''}${suffix}`
  return `${section}:${body}.description`.replace(/\t/g, ' ')
}

function skillPath(value: string): string {
  return `skill:${encodeURIComponent(value)}`
}

function charBigramCounts(text: string): Map<string, number> {
  const normalized = text.replace(/\s+/g, '')
  const counts = new Map<string, number>()
  if (normalized.length < 2) return counts
  for (let i = 0; i < normalized.length - 1; i += 1) {
    const gram = normalized.slice(i, i + 2)
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  return counts
}

function diceSimilarity(left: string, right: string): number {
  const a = charBigramCounts(left)
  const b = charBigramCounts(right)
  let aTotal = 0
  let bTotal = 0
  let overlap = 0
  for (const count of a.values()) aTotal += count
  for (const count of b.values()) bTotal += count
  if (aTotal === 0 || bTotal === 0) return 0
  for (const [gram, count] of a) overlap += Math.min(count, b.get(gram) ?? 0)
  return (2 * overlap) / (aTotal + bTotal)
}

function indexBuckets(entries: EntryRef[], indexes: number[]): Map<string, number[]> {
  const buckets = new Map<string, number[]>()
  for (const index of indexes) {
    const key = nameKey(entries[index])
    if (!key) continue
    const list = buckets.get(key) ?? []
    list.push(index)
    buckets.set(key, list)
  }
  return buckets
}

/**
 * 先按条目对齐，再比字段。下标会在删除、对调后错位。
 * 有 id 用 id；否则公司/学校/项目名 + 职务/专业/角色；还对不上就按描述相似度。
 * 配不上的当前条目 previous 为 null，里面的数字稍后一律当 AI 新加的。
 */
function pairEntries(current: EntryRef[], previous: EntryRef[]): Array<{ current: EntryRef; previous: EntryRef | null }> {
  const prevFree = previous.map(() => true)
  const assigned: Array<EntryRef | null> = current.map(() => null)
  const claim = (currentIndex: number, previousIndex: number) => {
    assigned[currentIndex] = previous[previousIndex]
    prevFree[previousIndex] = false
  }
  const freeCurrent = () => current.map((_, index) => index).filter((index) => assigned[index] === null)
  const freePrevious = () => previous.map((_, index) => index).filter((index) => prevFree[index])

  const idsOf = (entries: EntryRef[], indexes: number[]) => {
    const buckets = new Map<string, number[]>()
    for (const index of indexes) {
      const id = stableId(entries[index].source)
      if (!id) continue
      const list = buckets.get(id) ?? []
      list.push(index)
      buckets.set(id, list)
    }
    return buckets
  }
  const currentIds = idsOf(current, current.map((_, index) => index))
  const previousIds = idsOf(previous, previous.map((_, index) => index))
  for (const [id, currentList] of currentIds) {
    const previousList = previousIds.get(id)
    if (!previousList || currentList.length !== 1 || previousList.length !== 1) continue
    claim(currentList[0], previousList[0])
  }

  const claimUniqueNames = () => {
    const currentNames = indexBuckets(current, freeCurrent())
    const previousNames = indexBuckets(previous, freePrevious())
    for (const [key, currentList] of currentNames) {
      const previousList = previousNames.get(key)
      if (!previousList || currentList.length !== 1 || previousList.length !== 1) continue
      claim(currentList[0], previousList[0])
    }
  }
  claimUniqueNames()

  const candidates: Array<{ score: number; currentIndex: number; previousIndex: number }> = []
  for (const currentIndex of freeCurrent()) {
    for (const previousIndex of freePrevious()) {
      const score = diceSimilarity(current[currentIndex].description, previous[previousIndex].description)
      if (score < DESCRIPTION_MATCH_MIN) continue
      candidates.push({ score, currentIndex, previousIndex })
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.currentIndex - b.currentIndex || a.previousIndex - b.previousIndex)
  for (const candidate of candidates) {
    if (assigned[candidate.currentIndex] !== null || !prevFree[candidate.previousIndex]) continue
    claim(candidate.currentIndex, candidate.previousIndex)
  }

  const currentLeft = indexBuckets(current, freeCurrent())
  const previousLeft = indexBuckets(previous, freePrevious())
  for (const [key, currentList] of currentLeft) {
    const previousList = previousLeft.get(key)
    if (!previousList) continue
    const count = Math.min(currentList.length, previousList.length)
    for (let i = 0; i < count; i += 1) claim(currentList[i], previousList[i])
  }

  return current.map((entry, index) => ({ current: entry, previous: assigned[index] }))
}

interface AlignedField {
  path: string
  currentText: string
  previousText: string
  matched: boolean
}

function alignSection(section: EntrySection, current: GeneratedResume, previous: GeneratedResume): AlignedField[] {
  const currentRefs = sectionRefs(section, current)
  const previousRefs = sectionRefs(section, previous)
  const previousOrdinals = sameNameOrdinals(previousRefs)
  return pairEntries(currentRefs, previousRefs).map((pair) => {
    const previousIndex = pair.previous ? previousRefs.indexOf(pair.previous) : -1
    const ordinal = previousIndex >= 0 ? (previousOrdinals[previousIndex] ?? null) : null
    return {
      // 用当前名称时，本人把这一条改成另一条的名字，两条路径会撞在一起，AI 的数被豁免。
      path: entryPath(section, pair.previous ?? pair.current, ordinal),
      currentText: pair.current.description,
      previousText: pair.previous?.description ?? '',
      matched: pair.previous !== null,
    }
  })
}

const ENTRY_SECTIONS: EntrySection[] = ['education', 'experience', 'projects']

function factFieldTexts(resume: GeneratedResume): string[] {
  return [
    resume.summary ?? '',
    ...resume.education.map((item) => item.description ?? ''),
    ...resume.experience.map((item) => item.description ?? ''),
    ...resume.projects.map((item) => item.description ?? ''),
    ...resume.skills.map((item) => item ?? ''),
  ]
}

/** 编辑发生时记下的本人新增：field:路径 + tab + key。页面原样累积这串字，比较时不再从片段反解。 */
function userEditToken(path: string, key: string): string {
  return `field:${path}\t${key}`
}

function parseUserEditToken(token: string): { path: string; key: string } | null {
  if (!token.startsWith('field:')) return null
  const tab = token.indexOf('\t')
  if (tab <= 'field:'.length) return null
  const path = token.slice('field:'.length, tab)
  const key = token.slice(tab + 1)
  if (!path || !key) return null
  return { path, key }
}

/** 机械对照：after 里有、before/原文里没有的数字与职责词。技能栏里新写的数也要本人确认。 */
export function detectUnconfirmedAdditions(
  resume: GeneratedResume,
  modules?: ResumeOptimizeModule[],
  originalInput?: ResumeGenerateInput,
): string[] {
  const beforeText = collectBeforeText(modules, originalInput)
  const hits: string[] = []
  for (const text of factFieldTexts(resume)) {
    for (const addition of detectUnconfirmedTextAdditions(text, beforeText)) {
      if (!hits.includes(addition)) hits.push(addition)
    }
  }
  return hits
}

function keysInField(text: string, beforeText: string): Set<string> {
  const keys = new Set<string>()
  for (const item of findFactAdditions(text, beforeText)) keys.add(item.key)
  return keys
}

function userKeyMap(userAdditions: string[]): Map<string, Set<string>> {
  const userKeys = new Map<string, Set<string>>()
  for (const token of userAdditions) {
    const parsed = parseUserEditToken(token)
    if (!parsed) continue
    const set = userKeys.get(parsed.path) ?? new Set<string>()
    set.add(parsed.key)
    userKeys.set(parsed.path, set)
  }
  return userKeys
}

/**
 * 仍留在当前稿里、且能对上生成稿同一条的新增事实。
 * 经历、教育、项目先按条目对齐，再按「这条的身份 + key」豁免，不按下标。
 * 配上生成稿的条目，路径整条用生成稿那一条的名称、职务和同名序号，不用当前名称。
 * 同名同职务又没有 id 时，序号是生成稿里的同名第几段。本人换序、改名都不改这条路径。
 * 配不上的条目里，相对原文多出来的数字和职责词一律待确认。
 * 技能里的数字，只有本人写进去、而且 AI 版技能里没有，才免确认。
 * 这一项别的字改过、数字仍是 AI 版技能里的，照样待确认。
 * 返回给人看的片段，同一片段只留一行。
 */
export function detectGeneratedUnconfirmedAdditions(
  resume: GeneratedResume,
  generated: GeneratedResume,
  input?: ResumeGenerateInput,
  userAdditions: string[] = [],
): string[] {
  const beforeText = collectBeforeText(undefined, input)
  const userKeys = userKeyMap(userAdditions)
  const hits: string[] = []
  const push = (text: string) => {
    if (!hits.includes(text)) hits.push(text)
  }
  const consider = (path: string, currentText: string, generatedText: string, matched: boolean) => {
    const fromUser = userKeys.get(path) ?? new Set<string>()
    if (!matched) {
      for (const item of findFactAdditions(currentText, beforeText)) push(item.text)
      return
    }
    const fromGenerated = keysInField(generatedText, beforeText)
    for (const item of findFactAdditions(currentText, beforeText)) {
      if (!fromGenerated.has(item.key) || fromUser.has(item.key)) continue
      push(item.text)
    }
  }
  consider('summary', resume.summary ?? '', generated.summary ?? '', true)
  for (const section of ENTRY_SECTIONS) {
    for (const field of alignSection(section, resume, generated)) {
      consider(field.path, field.currentText, field.previousText, field.matched)
    }
  }
  const generatedSkillKeys = new Set<string>()
  for (const skill of generated.skills) {
    for (const key of keysInField(skill ?? '', beforeText)) generatedSkillKeys.add(key)
  }
  const generatedSkillTexts = new Set(generated.skills)
  for (const skill of resume.skills) {
    const text = skill ?? ''
    if (generatedSkillTexts.has(text)) {
      consider(skillPath(text), text, text, true)
      continue
    }
    const fromUser = userKeys.get(skillPath(text)) ?? new Set<string>()
    for (const item of findFactAdditions(text, beforeText)) {
      if (!generatedSkillKeys.has(item.key) || fromUser.has(item.key)) continue
      push(item.text)
    }
  }
  return hits
}

/**
 * 记录预览中本人新增的事实。按对齐后的条目记路径和 key，不按下标。
 * anchor 必须是生成稿：名称、职务和同名序号都按它记，和核对用的是同一套。
 * 技能里 AI 版已经有的数字不记成本人写的。
 */
export function detectUserResumeEdits(
  before: GeneratedResume,
  after: GeneratedResume,
  anchor: GeneratedResume,
): string[] {
  const tokens: string[] = []
  const seen = new Set<string>()
  const push = (path: string, key: string) => {
    const token = userEditToken(path, key)
    if (seen.has(token)) return
    seen.add(token)
    tokens.push(token)
  }
  for (const item of findFactAdditions(after.summary ?? '', before.summary ?? '')) push('summary', item.key)
  for (const section of ENTRY_SECTIONS) {
    const anchored = alignSection(section, after, anchor)
    const changed = anchor === before ? anchored : alignSection(section, after, before)
    for (let index = 0; index < anchored.length; index += 1) {
      const pathField = anchored[index]
      const diffField = changed[index]
      if (!pathField || !diffField || !pathField.matched || !diffField.matched) continue
      for (const item of findFactAdditions(diffField.currentText, diffField.previousText)) push(pathField.path, item.key)
    }
  }
  const beforeSkillKeys = new Set<string>()
  for (const skill of before.skills) {
    for (const key of keysInField(skill ?? '', '')) beforeSkillKeys.add(key)
  }
  const beforeSkills = new Set(before.skills)
  for (const skill of after.skills) {
    const text = skill ?? ''
    if (beforeSkills.has(text)) continue
    for (const item of findFactAdditions(text, '')) {
      if (beforeSkillKeys.has(item.key)) continue
      push(skillPath(text), item.key)
    }
  }
  return tokens
}
