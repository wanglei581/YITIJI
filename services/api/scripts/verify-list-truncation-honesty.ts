import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const SRC = join(__dirname, '..', 'src')

const INTERNAL_BOUNDED_QUERIES: Record<string, string> = {
  'ai/ai-log.service.ts#loadRecentEntries': '30-day provider usage aggregation input; public getLogs has real total/offset pagination',
  'ai/resume/fair-visit-plan.service.ts#loadLocalRecords': 'private evidence candidates reduced to 12 names; never returned as a list endpoint',
  'job-ai/job-ai.service.ts#findCandidateJobs': 'private ranking candidate pool reduced to requested result limit; not a list endpoint',
}

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'generated' || entry.name === '__tests__') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await sourceFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

function enclosingMethod(source: string, offset: number): { name: string; body: string } | null {
  const lines = source.split('\n')
  const lineIndex = source.slice(0, offset).split('\n').length - 1
  const methodStart = /^(?:  )(?:private\s+|public\s+|protected\s+)?(?:async\s+)?([A-Za-z0-9_]+)\s*\(/
  let start = -1
  let name = ''
  for (let i = lineIndex; i >= 0; i -= 1) {
    const match = lines[i]!.match(methodStart)
    if (match) {
      start = i
      name = match[1]!
      break
    }
  }
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (methodStart.test(lines[i]!)) {
      end = i
      break
    }
  }
  return { name, body: lines.slice(start, end).join('\n') }
}

async function main(): Promise<void> {
  const failures: string[] = []
  let checked = 0
  const usedExclusions = new Set<string>()

  for (const file of await sourceFiles(SRC)) {
    const rel = relative(SRC, file)
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(/\btake\s*:\s*([0-9][0-9_]*)/g)) {
      const take = Number(match[1]!.replaceAll('_', ''))
      if (take < 50 || match.index === undefined) continue
      const method = enclosingMethod(source, match.index)
      assert.ok(method, `cannot resolve enclosing method for ${rel}:${match.index}`)
      checked += 1
      const key = `${rel}#${method.name}`
      if (INTERNAL_BOUNDED_QUERIES[key]) {
        usedExclusions.add(key)
        continue
      }
      if (!/\b(total|truncated)\b/.test(method.body)) {
        failures.push(`${key} uses take:${take} without total/truncated`)
      }
    }
  }

  for (const [key, reason] of Object.entries(INTERNAL_BOUNDED_QUERIES)) {
    if (!reason.trim()) failures.push(`${key} exclusion has no reason`)
    if (!usedExclusions.has(key)) failures.push(`${key} exclusion is stale or method name drifted`)
  }

  if (failures.length > 0) {
    console.error(failures.join('\n'))
    process.exit(1)
  }
  console.log(`PASS ${checked} fixed take>=50 queries are honest; ${usedExclusions.size} internal bounded queries documented`)
}

void main()
