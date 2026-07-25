/**
 * OfflineAgencies 分页 query 必须收成 number，避免 Prisma take 收到 string 导致 500。
 *
 * 根因复现（预生产 2026-07-25）：
 *   GET /kiosk/offline-agencies              → 200
 *   GET /kiosk/offline-agencies?pageSize=5   → 500 INTERNAL_SERVER_ERROR
 *
 * Run: pnpm --filter @ai-job-print/api verify:offline-agencies-page
 */
import { resolveOfflineListPage } from '../src/offline-agencies/offline-agencies.service'

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function assert(condition: boolean, message: string): void {
  if (!condition) fail(message)
  pass(message)
}

function main(): void {
  console.log('\n=== OfflineAgencies pageSize coercion ===')

  const defaults = resolveOfflineListPage({})
  assert(defaults.page === 1 && defaults.pageSize === 20, 'empty query → page=1 pageSize=20')

  const fromStrings = resolveOfflineListPage({ page: '1', pageSize: '5' })
  assert(
    fromStrings.page === 1 &&
      fromStrings.pageSize === 5 &&
      typeof fromStrings.page === 'number' &&
      typeof fromStrings.pageSize === 'number',
    'string page/pageSize → integers (Prisma take-safe)',
  )

  const fromNumbers = resolveOfflineListPage({ page: 2, pageSize: 10 })
  assert(fromNumbers.page === 2 && fromNumbers.pageSize === 10, 'numeric page/pageSize preserved')

  const capped = resolveOfflineListPage({ pageSize: '999' })
  assert(capped.pageSize === 100, 'pageSize capped at 100')

  const invalid = resolveOfflineListPage({ page: 'nope', pageSize: '-3' })
  assert(invalid.page === 1 && invalid.pageSize === 20, 'invalid values fall back to defaults')

  const floored = resolveOfflineListPage({ page: '2.9', pageSize: '7.2' })
  assert(floored.page === 2 && floored.pageSize === 7, 'floats are floored')

  console.log('\nAll offline-agencies page checks passed.\n')
}

main()
