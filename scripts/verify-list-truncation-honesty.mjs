#!/usr/bin/env node
/**
 * List honesty gate: visible API list methods with a literal `take >= 50` must
 * return a real `total` or declare `truncated`. The narrowly scoped ignores
 * below document private/internal pools that never form an API list response.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const sourceRoot = join(root, 'services/api/src')
const ignoredMethods = new Map([
  ['services/api/src/ai/ai-log.service.ts:loadRecentEntries', 'private rolling usage window'],
  ['services/api/src/ai/resume/fair-visit-plan.service.ts:loadLocalRecords', 'private AI context input'],
  ['services/api/src/job-ai/job-ai.service.ts:findCandidateJobs', 'internal AI ranking candidate pool'],
  ['services/api/src/member-print-orders/member-print-order-create.service.ts:listCloud', 'separate protected print-order lane'],
])

const files = []
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.name.endsWith('.service.ts')) files.push(path)
  }
}
walk(sourceRoot)

const failures = []
const checked = []
for (const file of files) {
  const relative = file.slice(root.length + 1)
  const text = readFileSync(file, 'utf8')
  const methods = [...text.matchAll(/^  (?:(?:private|public|protected) )?(?:async )?([A-Za-z0-9_]+)\s*\(/gm)]
  for (const [index, match] of methods.entries()) {
    const start = match.index
    const end = methods[index + 1]?.index ?? text.length
    const body = text.slice(start, end)
    const takes = [...body.matchAll(/\btake:\s*([\d_]+)/g)]
      .map((take) => Number(take[1].replaceAll('_', '')))
      .filter((take) => take >= 50)
    if (takes.length === 0) continue
    const key = `${relative}:${match[1]}`
    if (ignoredMethods.has(key)) continue
    checked.push(`${relative}:${match[1]} (${takes.join(', ')})`)
    const returnsHonestCount = /\breturn\s*\{[\s\S]{0,8000}\b(?:total|truncated|[A-Za-z]+Total|[A-Za-z]+Truncated)\s*(?:[:,}\n])/.test(body)
    if (!returnsHonestCount) {
      failures.push(`${relative}:${match[1]} has take ${takes.join(', ')} but returns neither total nor truncated`)
    }
  }
}

if (checked.length === 0) {
  console.error('FAIL: no visible capped list methods were checked; gate scope is broken')
  process.exit(1)
}
if (failures.length > 0) {
  console.error('FAIL: list truncation honesty violations')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`PASS: ${checked.length} capped API list methods return total or truncated`)
for (const item of checked) console.log(`  - ${item}`)
