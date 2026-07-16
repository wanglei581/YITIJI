/**
 * 会员账户状态 schema / migration / Guard 静态门禁。
 *
 * Run: pnpm --filter @ai-job-print/api verify:member-account-status
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../../..')
let failures = 0

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8')
}

function mustContain(source: string, markers: readonly string[], label: string): void {
  for (const marker of markers) {
    if (source.includes(marker)) {
      console.log(`  PASS ${label}: ${marker}`)
      continue
    }
    failures += 1
    console.error(`  FAIL ${label} 缺少: ${marker}`)
  }
}

function modelBlock(schema: string, modelName: string): string {
  const startMarker = `model ${modelName} {`
  const start = schema.indexOf(startMarker)
  if (start === -1) return ''
  const nextModel = schema.indexOf('\nmodel ', start + startMarker.length)
  return schema.slice(start, nextModel === -1 ? schema.length : nextModel)
}

const sqliteEndUser = modelBlock(read('services/api/prisma/schema.prisma'), 'EndUser')
const postgresEndUser = modelBlock(read('services/api/prisma/postgres/schema.prisma'), 'EndUser')
const guard = read('services/api/src/common/guards/end-user-auth.guard.ts')
const schemaMarkers = [
  'status          String    @default("active")',
  'statusChangedAt DateTime?',
  'closingRequestedAt DateTime?',
  'anonymizedAt DateTime?',
  '@@index([status])',
] as const

console.log('\n=== 会员账户状态门禁 ===')
mustContain(sqliteEndUser, schemaMarkers, 'SQLite EndUser schema')
mustContain(postgresEndUser, schemaMarkers, 'PostgreSQL EndUser schema')
mustContain(guard, ['select: { enabled: true, status: true }', "user.status !== 'active'"], 'EndUserAuthGuard')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — 会员账户状态契约尚未完整落地\n`)
  process.exitCode = 1
} else {
  console.log('\n✅ ALL PASS — 会员账户状态契约已完整落地\n')
}
