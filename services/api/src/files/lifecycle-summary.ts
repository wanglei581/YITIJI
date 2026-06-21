import type {
  FileLifecycleSummaryResponse,
  FileRetentionPolicy,
  FileRetentionSetBy,
} from './file.types'

const DAY_MS = 24 * 60 * 60 * 1000

export interface FileLifecycleSummaryRow {
  id: string
  retentionPolicy: FileRetentionPolicy | null
  retentionSetBy: FileRetentionSetBy | null
  expiresAt: Date | null
  deletedAt: Date | null
}

function pushCount<T extends string>(
  counts: Map<T | null, number>,
  key: T | null,
): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function toCountItems<T extends string>(counts: Map<T | null, number>): Array<{ key: T | null; count: number }> {
  return [...counts.entries()].map(([key, count]) => ({ key, count }))
}

export function summarizeFileLifecycleRows(
  rows: FileLifecycleSummaryRow[],
  now = new Date(),
): FileLifecycleSummaryResponse {
  const activeRows = rows.filter((row) => row.deletedAt === null)
  const within7 = new Date(now.getTime() + 7 * DAY_MS)
  const within30 = new Date(now.getTime() + 30 * DAY_MS)
  const byRetentionPolicy = new Map<FileRetentionPolicy | null, number>()
  const byRetentionSetBy = new Map<FileRetentionSetBy | null, number>()

  let longTermCount = 0
  let expiringWithin7Days = 0
  let expiringWithin30Days = 0
  let expiredPendingCleanup = 0

  for (const row of activeRows) {
    pushCount(byRetentionPolicy, row.retentionPolicy)
    pushCount(byRetentionSetBy, row.retentionSetBy)

    if (row.retentionPolicy === 'long_term') longTermCount += 1
    if (!row.expiresAt) continue
    if (row.expiresAt.getTime() <= now.getTime()) {
      expiredPendingCleanup += 1
      continue
    }
    if (row.expiresAt.getTime() <= within7.getTime()) expiringWithin7Days += 1
    if (row.expiresAt.getTime() <= within30.getTime()) expiringWithin30Days += 1
  }

  return {
    totalActive: activeRows.length,
    longTermCount,
    expiringWithin7Days,
    expiringWithin30Days,
    expiredPendingCleanup,
    byRetentionPolicy: toCountItems(byRetentionPolicy),
    byRetentionSetBy: toCountItems(byRetentionSetBy),
    generatedAt: now.toISOString(),
  }
}
