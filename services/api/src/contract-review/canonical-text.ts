/** Normalize only the properties that define contract-review evidence offsets. */
export function canonicalizePage(input: unknown): string {
  if (typeof input !== 'string') throw new Error('CONTRACT_CANONICAL_TEXT_INVALID')
  return input.normalize('NFC').replace(/\r\n?/g, '\n')
}

/** Locate an excerpt using JavaScript's native UTF-16 code-unit offsets. */
export function locateExcerpt(page: unknown, excerpt: unknown): {
  charStart: number
  charEnd: number
} {
  if (typeof page !== 'string' || typeof excerpt !== 'string') {
    throw new Error('CONTRACT_CANONICAL_TEXT_INVALID')
  }
  if (excerpt.length === 0) throw new Error('CONTRACT_EVIDENCE_NOT_FOUND')
  const charStart = page.indexOf(excerpt)
  if (charStart < 0) throw new Error('CONTRACT_EVIDENCE_NOT_FOUND')
  return { charStart, charEnd: charStart + excerpt.length }
}
