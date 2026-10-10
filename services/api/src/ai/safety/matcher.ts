import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeForSafety } from './normalize'
import { SAFETY_CATEGORIES, type SafetyCategory } from './refusal'

export interface LexiconRow {
  category: string
  term: string
  kind: string
  enabled: boolean
}

interface ActiveTerm {
  category: string
  term: string
  normalized: string
}

interface SeedFile {
  block: Record<string, string[]>
  allow: Record<string, string[]>
}

let blocks: ActiveTerm[] = []
let allows: ActiveTerm[] = []

function loadSeed(): SeedFile {
  const candidates = [
    join(__dirname, 'lexicon.seed.json'),
    join(process.cwd(), 'src/ai/safety/lexicon.seed.json'),
    join(process.cwd(), 'dist/ai/safety/lexicon.seed.json'),
  ]
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as SeedFile
    } catch {
      /* 下一个候选路径 */
    }
  }
  throw new Error('AI_SAFETY_LEXICON_SEED_MISSING')
}

function remember(map: Map<string, ActiveTerm>, category: string, term: string): void {
  const trimmed = term.trim()
  const normalized = normalizeForSafety(trimmed)
  if (normalized.length < 2) return
  const key = `${category}\n${normalized}`
  if (!map.has(key)) map.set(key, { category, term: trimmed, normalized })
}

function compile(blockMap: Map<string, ActiveTerm>, allowMap: Map<string, ActiveTerm>): void {
  blocks = [...blockMap.values()].sort((a, b) => b.normalized.length - a.normalized.length || a.category.localeCompare(b.category))
  allows = [...allowMap.values()].sort((a, b) => b.normalized.length - a.normalized.length)
}

/** 空表 = 种子。enabled=false 按归一化键删掉种子，避免删过的词在重启后又回来。 */
export function applyLexiconRows(rows: readonly LexiconRow[]): void {
  const seed = loadSeed()
  const blockMap = new Map<string, ActiveTerm>()
  const allowMap = new Map<string, ActiveTerm>()
  for (const [category, terms] of Object.entries(seed.block)) {
    for (const term of terms) remember(blockMap, category, term)
  }
  for (const [category, terms] of Object.entries(seed.allow)) {
    for (const term of terms) remember(allowMap, category, term)
  }
  for (const row of rows) {
    const target = row.kind === 'allow' ? allowMap : row.kind === 'block' ? blockMap : null
    if (!target) continue
    const normalized = normalizeForSafety(row.term)
    if (normalized.length < 2) continue
    const key = `${row.category}\n${normalized}`
    if (row.enabled) target.set(key, { category: row.category, term: row.term.trim(), normalized })
    else target.delete(key)
  }
  compile(blockMap, allowMap)
}

export function resetLexiconToSeed(): void {
  applyLexiconRows([])
}

resetLexiconToSeed()

/** 白名单整段先剔除，再按最长拦截词做子串匹配。不返回命中词。 */
export function matchLexicon(text: string): { category: string } | null {
  let normalized = normalizeForSafety(text)
  if (!normalized) return null
  for (const allow of allows) {
    if (allow.normalized) normalized = normalized.split(allow.normalized).join('')
  }
  for (const block of blocks) {
    if (normalized.includes(block.normalized)) return { category: block.category }
  }
  return null
}

export function blockDisplayTerms(): string[] {
  return blocks.map((item) => item.term)
}

export function lexiconView(): { categories: Array<{ category: SafetyCategory; block: string[]; allow: string[] }> } {
  return {
    categories: SAFETY_CATEGORIES.map((category) => ({
      category,
      block: blocks.filter((item) => item.category === category).map((item) => item.term),
      allow: allows.filter((item) => item.category === category).map((item) => item.term),
    })),
  }
}
