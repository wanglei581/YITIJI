#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../../..')
const matrixPath = resolve(here, 'COVERAGE-MATRIX.md')
const manifestPath = resolve(repoRoot, 'apps/kiosk/tests/visual/route-manifest.ts')

const matrix = await readFile(matrixPath, 'utf8')
const manifest = await readFile(manifestPath, 'utf8')

function expandIds(value) {
  return value
    .split(/[、,]/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const match = part.match(/^(\d{3})(?:--(\d{3}))?$/u)
      assert.ok(match, `invalid route id token: ${part}`)
      const start = Number(match[1])
      const end = Number(match[2] ?? match[1])
      assert.ok(end >= start, `descending route id range: ${part}`)
      return Array.from({ length: end - start + 1 }, (_, index) => start + index)
    })
}

const routeRows = [...matrix.matchAll(/^\| (\d{3}) \| `([^`]+)` \|/gmu)].map((match) => ({
  id: Number(match[1]),
  route: match[2],
}))

assert.equal(routeRows.length, 106, 'coverage matrix must contain 106 route rows')
assert.deepEqual(
  routeRows.map(({ id }) => id),
  Array.from({ length: 106 }, (_, index) => index + 1),
  'coverage matrix ids must be continuous from 001 through 106',
)
assert.equal(new Set(routeRows.map(({ route }) => route)).size, 106, 'coverage matrix routes must be unique')

const manifestBlock = manifest.match(/productionRoutePatterns\s*=\s*\[([\s\S]*?)\]\s*as const/u)
assert.ok(manifestBlock, 'unable to locate productionRoutePatterns in route manifest')
const manifestRoutes = [...manifestBlock[1].matchAll(/'([^']+)'/gu)].map((match) => match[1])

assert.equal(manifestRoutes.length, 106, 'production route manifest must contain 106 routes')
assert.equal(new Set(manifestRoutes).size, 106, 'production route manifest routes must be unique')
assert.deepEqual(
  routeRows.map(({ route }) => route),
  manifestRoutes,
  'coverage matrix route order and values must match the production route manifest',
)

const classRows = [...matrix.matchAll(
  /^\| `(AI-(?:DIRECT|CONTEXT|EXPLAIN|NONE))`（(\d+)） \| ([^|]+) \|/gmu,
)].map((match) => ({
  mode: match[1],
  declaredCount: Number(match[2]),
  ids: expandIds(match[3].trim()),
}))

assert.equal(classRows.length, 4, 'coverage matrix must declare exactly four AI classes')
assert.deepEqual(
  classRows.map(({ mode }) => mode).sort(),
  ['AI-CONTEXT', 'AI-DIRECT', 'AI-EXPLAIN', 'AI-NONE'],
  'coverage matrix AI classes must be the four approved modes',
)

const owners = new Map()
for (const { mode, declaredCount, ids } of classRows) {
  assert.equal(ids.length, declaredCount, `${mode} declared count must match its expanded ids`)
  assert.equal(new Set(ids).size, ids.length, `${mode} must not repeat a route id internally`)
  for (const id of ids) {
    assert.ok(id >= 1 && id <= 106, `${mode} contains out-of-range route id ${id}`)
    const modes = owners.get(id) ?? []
    modes.push(mode)
    owners.set(id, modes)
  }
}

const duplicates = [...owners.entries()].filter(([, modes]) => modes.length > 1)
const missing = Array.from({ length: 106 }, (_, index) => index + 1).filter((id) => !owners.has(id))

assert.deepEqual(duplicates, [], `route ids must not cross AI classes: ${JSON.stringify(duplicates)}`)
assert.deepEqual(missing, [], `every route id must have one AI class: ${missing.join(', ')}`)
assert.equal(owners.size, 106, 'AI classification must cover 106 unique route ids')

console.log('PASS AI route classification')
console.log(`routes=${routeRows.length} classes=${classRows.map(({ mode, ids }) => `${mode}:${ids.length}`).join(',')}`)
