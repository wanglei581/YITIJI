import { strict as assert } from 'assert'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  summarizeFileLifecycleRows,
  type FileLifecycleSummaryRow,
} from '../src/files/lifecycle-summary'

const now = new Date('2026-06-22T00:00:00.000Z')
const rows: FileLifecycleSummaryRow[] = [
  {
    id: 'active-3m',
    retentionPolicy: 'months_3',
    retentionSetBy: 'system',
    expiresAt: new Date('2026-06-25T00:00:00.000Z'),
    deletedAt: null,
  },
  {
    id: 'active-6m',
    retentionPolicy: 'months_6',
    retentionSetBy: 'user',
    expiresAt: new Date('2026-07-10T00:00:00.000Z'),
    deletedAt: null,
  },
  {
    id: 'long-term',
    retentionPolicy: 'long_term',
    retentionSetBy: 'user',
    expiresAt: null,
    deletedAt: null,
  },
  {
    id: 'expired',
    retentionPolicy: 'system_short',
    retentionSetBy: 'system',
    expiresAt: new Date('2026-06-20T00:00:00.000Z'),
    deletedAt: null,
  },
  {
    id: 'deleted-long-term',
    retentionPolicy: 'long_term',
    retentionSetBy: 'user',
    expiresAt: null,
    deletedAt: new Date('2026-06-21T00:00:00.000Z'),
  },
]

function countOf<T extends string>(items: Array<{ key: T | null; count: number }>, key: T | null): number {
  return items.find((item) => item.key === key)?.count ?? 0
}

const summary = summarizeFileLifecycleRows(rows, now)

assert.equal(summary.totalActive, 4, 'deleted rows must not count as active')
assert.equal(summary.longTermCount, 1, 'only active long_term rows count as long-term')
assert.equal(summary.expiringWithin7Days, 1, 'only rows expiring in the next 7 days count')
assert.equal(summary.expiringWithin30Days, 2, '30-day window includes 7-day rows and later rows')
assert.equal(summary.expiredPendingCleanup, 1, 'expired but not deleted rows count as pending cleanup')
assert.equal(countOf(summary.byRetentionPolicy, 'months_3'), 1)
assert.equal(countOf(summary.byRetentionPolicy, 'months_6'), 1)
assert.equal(countOf(summary.byRetentionPolicy, 'long_term'), 1)
assert.equal(countOf(summary.byRetentionPolicy, 'system_short'), 1)
assert.equal(countOf(summary.byRetentionSetBy, 'system'), 2)
assert.equal(countOf(summary.byRetentionSetBy, 'user'), 2)
assert.equal(summary.generatedAt, now.toISOString())

const serviceSource = readFileSync(join(__dirname, '../src/files/files.service.ts'), 'utf8')
assert.match(serviceSource, /where:\s*\{\s*deletedAt:\s*null\s*\}/, 'lifecycleSummary must filter soft-deleted rows in the database query')

console.log('verify:file-lifecycle-summary passed')
