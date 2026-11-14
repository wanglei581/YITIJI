import { BULLET_RE } from './resume-restored-text'
import { normalizeResumeStructureText } from './resume-structure'

type AlignModule = { before: string; after: string }

/** 只去掉技能、证书栏目标题。词表与 resume-optimize-coverage 的 HEADINGS 里这两栏一致。 */
const LIST_HEADING_RE = /^(专业技能|技能证书|技能与证书|技能特长|技能)(?=$|[\s:：])|^(证书资质|证书|资格证书|获奖情况)(?=$|[\s:：])/u
const LEADING_INDEX_RE = /^(?:\d{1,2}\s*[、.．)）]|[一二三四五六七八九十]{1,3}\s*[、.．]|[（(]\s*\d{1,2}\s*[）)]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])\s*/u
const BRACKET_TITLE_RE = /^【[^】]{0,20}】\s*/u
const RESTORE_SEP = new Set(['、', '，', ',', '；'])
const COMPARE_SEP = new Set(['、', '，', ',', '；', ';', '/', '和', '及', '与'])

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

/** 技能、证书比对前去掉行首项目符号、栏目标题、【】标题和行首编号。编号和【】谁先谁后都剥。 */
export function strippedListLine(line: string): string {
  let text = line.trim().replace(BULLET_RE, '').trim()
  for (let guard = 0; guard < 8; guard += 1) {
    if (LIST_HEADING_RE.test(text)) {
      text = text.replace(LIST_HEADING_RE, '').replace(/^[\s:：]+/u, '').trim()
      continue
    }
    if (LEADING_INDEX_RE.test(text)) {
      text = text.replace(LEADING_INDEX_RE, '').trim()
      continue
    }
    if (BRACKET_TITLE_RE.test(text)) {
      text = text.replace(BRACKET_TITLE_RE, '').trim()
      continue
    }
    break
  }
  return text
}

/** 全角半角括号都配对。没闭合的后半段不当分隔，避免拆出「PPT)」。 */
function maskParens(text: string): string {
  const chars = [...text]
  let depth = 0
  return chars.map((ch) => {
    if (ch === '（' || ch === '(') {
      depth += 1
      return ' '
    }
    if ((ch === '）' || ch === ')') && depth > 0) {
      depth -= 1
      return ' '
    }
    return depth > 0 ? ' ' : ch
  }).join('')
}

function splitOutside(text: string, sep: Set<string>): string[] {
  const chars = [...text]
  const masked = [...maskParens(text)]
  const parts: string[] = []
  let start = 0
  for (let i = 0; i < chars.length; i += 1) {
    if (!sep.has(masked[i] ?? '')) continue
    const piece = chars.slice(start, i).join('').trim()
    if (piece) parts.push(piece)
    start = i + 1
  }
  const tail = chars.slice(start).join('').trim()
  if (tail) parts.push(tail)
  return parts
}

/** 补回只按顿号、逗号和中文分号拆。`; / 和 及 与` 不改原稿样子。 */
function splitRestore(text: string): string[] {
  const parts = splitOutside(text, RESTORE_SEP)
  return parts.length > 0 ? parts : []
}

/** 比对键多用 `; / 和 及 与`。不按空格拆，避免「Python」抢走「Python 爬虫」。 */
function splitCompare(text: string): string[] {
  const parts = splitOutside(text, COMPARE_SEP)
  return parts.length > 0 ? parts : [text.trim()].filter(Boolean)
}

function stripParenText(text: string): string {
  let depth = 0
  let out = ''
  for (const ch of text) {
    if (ch === '（' || ch === '(') { depth += 1; continue }
    if ((ch === '）' || ch === ')') && depth > 0) { depth -= 1; continue }
    if (depth === 0) out += ch
  }
  return out.trim()
}

function lineCoveredByModule(line: string, module: AlignModule): boolean {
  const key = normalizeResumeStructureText(strippedListLine(line))
  if (!key) return false
  const before = module.before ?? ''
  if (normalizeResumeStructureText(strippedListLine(before)) === key) return true
  return before.split(/\n/u).some((beforeLine) => normalizeResumeStructureText(strippedListLine(beforeLine)) === key)
}

/**
 * 按原稿顺序对齐技能或证书。
 * `; / 空格 和 及 与` 只参与比对。一整行一个小项都没配上时，按原稿整行补回。
 * 有 module 撑腰、且 after 在模型列表里的行用改写；这条 module 用过之后，后一行不再补原稿。
 */
export function alignOriginalList(
  lines: string[],
  model: string[],
  max: number,
  options?: AlignOriginalListOptions,
): { list: string[]; missing: string[] } {
  const norm = normalizeResumeStructureText
  const modules = (options?.modules ?? []).map((module) => ({ module, used: false }))
  const covered = new Set<string>()
  const remember = (raw: string) => {
    const display = strippedListLine(raw)
    if (!display) return
    covered.add(norm(display))
    const bare = stripParenText(display)
    if (bare) covered.add(norm(bare))
    for (const atom of splitCompare(display)) covered.add(norm(atom))
  }
  for (const raw of options?.coveredElsewhere ?? []) remember(raw)
  const coveredText = (text: string): boolean => {
    const key = norm(text)
    if (!key) return true
    if (covered.has(key)) return true
    const bare = stripParenText(text)
    if (bare && covered.has(norm(bare))) return true
    const atoms = splitCompare(text).map((part) => norm(part)).filter(Boolean)
    if (atoms.length > 1 && atoms.every((part) => covered.has(part))) return true
    const spaces = text.split(/\s+/u).map((part) => norm(part.trim())).filter(Boolean)
    return spaces.length > 1 && spaces.every((part) => covered.has(part))
  }
  const originals = lines.map((line) => line.trim()).filter(Boolean)
  type Atom = { display: string; key: string; used: boolean }
  type Item = { display: string; key: string; atoms: Atom[]; used: boolean }
  const pool: Item[] = model.map((raw) => {
    const display = strippedListLine(raw)
    const atoms = splitCompare(display).map((part) => ({ display: part, key: norm(part), used: false }))
    return { display, key: norm(display), atoms, used: false }
  }).filter((item) => item.display)
  const list: string[] = []
  const missing: string[] = []
  const push = (text: string, wasMissing = false) => {
    const display = text.trim()
    if (!display || coveredText(display)) return
    list.push(display)
    if (wasMissing) missing.push(display)
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
  const claimWhole = (item: Item) => {
    item.used = true
    item.atoms.forEach((atom) => { atom.used = true })
  }
  const moduleHit = (line: string): { index: number; display: string } | null => {
    for (let index = 0; index < modules.length; index += 1) {
      const state = modules[index]
      if (!state || state.used || !lineCoveredByModule(line, state.module)) continue
      const after = state.module.after?.trim() ?? ''
      if (!after) continue
      const found = pool.find((item) => !item.used && (item.key === norm(strippedListLine(after)) || item.key === norm(after)))
      if (!found) continue
      return { index, display: found.display }
    }
    return null
  }

  type Slot = { display: string; key: string; out: string | null }
  const rows: Array<{ whole: string; slots: Slot[] }> = []
  for (const line of originals) {
    const usedOnly = modules.some((state) => state.used && lineCoveredByModule(line, state.module))
    const hit = moduleHit(line)
    if (usedOnly && !hit) continue
    if (hit) {
      const state = modules[hit.index]
      if (state) state.used = true
      const found = pool.find((item) => !item.used && item.display === hit.display)
      if (found) claimWhole(found)
      rows.push({ whole: hit.display, slots: [{ display: hit.display, key: norm(hit.display), out: hit.display }] })
      continue
    }
    const display = strippedListLine(line)
    if (!display) continue
    const whole = pool.find((item) => !item.used && item.key === norm(display))
    if (whole) {
      claimWhole(whole)
      rows.push({ whole: display, slots: [{ display: whole.display, key: whole.key, out: whole.display }] })
      continue
    }
    const segments = splitRestore(display)
    const slots = (segments.length > 0 ? segments : [display]).map((part) => {
      const item = pool.find((candidate) => !candidate.used && candidate.key === norm(part))
      if (item) {
        claimWhole(item)
        return { display: part, key: norm(part), out: item.display }
      }
      return { display: part, key: norm(part), out: null }
    })
    rows.push({ whole: display, slots })
  }

  const open = rows.flatMap((row) => row.slots.filter((slot) => slot.out === null))
  for (const slot of open) {
    const hit = takeExact(slot.key)
    if (hit) slot.out = hit
  }
  // 比对小项：按 `; / 和 及 与` 拆开、每段再剥行首编号（「2.」）。小项要么全部配上（逐字或相似），要么一个都不认，
  // 整段按原稿补回——不许只配上一半、把另一半丢掉。
  const piecesOf = (text: string) => splitCompare(text).map((part) => strippedListLine(part)).filter(Boolean)
  for (const slot of open) {
    if (slot.out !== null) continue
    const keys = piecesOf(slot.display).map((part) => norm(part)).filter(Boolean)
    if (keys.length < 2 || !canTakeAll(keys)) continue
    const displays: string[] = []
    let taken = true
    for (const key of keys) {
      const hit = takeExact(key)
      if (!hit) { taken = false; break }
      displays.push(hit)
    }
    if (taken) slot.out = displays.join('\u0001')
  }
  const pieceReserved = new Set(open.filter((slot) => slot.out === null).flatMap((slot) => [slot.key, ...piecesOf(slot.display).map((part) => norm(part))]))
  for (const slot of open) {
    if (slot.out !== null) continue
    const pieces = piecesOf(slot.display)
    if (pieces.length < 2) continue
    const taken: Array<{ item: Item; atom: Atom; itemWasUsed: boolean }> = []
    const displays: string[] = []
    const own = new Set(pieces.map((part) => norm(part)))
    for (const piece of pieces) {
      const key = norm(piece)
      let found: { item: Item; atom: Atom } | null = null
      for (const item of pool) {
        if (item.used) continue
        const atom = item.atoms.find((part) => !part.used && part.key === key)
        if (atom) { found = { item, atom }; break }
      }
      if (!found) {
        let bestGap = Number.POSITIVE_INFINITY
        for (const item of pool) {
          if (item.used) continue
          for (const atom of item.atoms) {
            if (atom.used || (pieceReserved.has(atom.key) && !own.has(atom.key))) continue
            if (!key.includes(atom.key) || !similarListAtom(key, atom.key)) continue
            const gap = Math.abs(atom.key.length - key.length)
            if (gap < bestGap) { found = { item, atom }; bestGap = gap }
          }
        }
      }
      if (!found) break
      taken.push({ item: found.item, atom: found.atom, itemWasUsed: found.item.used })
      found.atom.used = true
      if (found.item.atoms.every((part) => part.used)) found.item.used = true
      displays.push(found.atom.display)
    }
    if (displays.length === pieces.length) {
      slot.out = displays.join('\u0001')
      continue
    }
    for (const step of taken.reverse()) {
      step.atom.used = false
      step.item.used = step.itemWasUsed
    }
  }
  for (const slot of open) {
    if (slot.out !== null || !/\s/u.test(slot.display)) continue
    const pieces = slot.display.split(/\s+/u).map((part) => strippedListLine(part.trim())).filter(Boolean)
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
    if (taken) slot.out = displays.join('\u0001')
  }
  const reserved = new Set(open.filter((slot) => slot.out === null).map((slot) => slot.key))
  for (const row of rows) {
    if (row.slots.length < 2) continue
    for (const slot of row.slots) {
      if (slot.out !== null || piecesOf(slot.display).length > 1) continue
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
  }
  for (const row of rows) {
    if (row.slots.every((slot) => slot.out === null)) {
      push(row.whole, true)
      continue
    }
    for (const slot of row.slots) {
      // 部分漏交时，补回的那项去掉「2.」「2）」这类编号；整行一个都没配上仍走上面的原稿整行。
      const value = slot.out ?? strippedListLine(slot.display)
      const wasMissing = slot.out === null
      for (const piece of value.split('\u0001')) push(piece, wasMissing)
    }
  }
  return { list: list.length > max ? list.slice(0, max) : list, missing }
}
