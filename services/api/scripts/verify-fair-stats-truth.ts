// verify-fair-stats-truth.ts
// TDD verify: FairLiveStatsDTO + FairStatsDto truthfulness
// RED → five fields must be number | null; getFairStats must return null for unprovenFields
// Run: node -r @swc-node/register scripts/verify-fair-stats-truth.ts

import type { FairLiveStatsDTO } from '../../../packages/shared/src/types/fairDto'
import type { FairStatsDto } from '../src/jobs/jobs-shared'

// ── helpers ──────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

// ── Section 1: FairLiveStatsDTO type-level checks ────────────────────────────
// We construct a value that satisfies FairLiveStatsDTO with null for the five
// unproven fields and verify TS allows it (compile-time) + runtime shape.

console.log('\n[1] FairLiveStatsDTO — null-capable fields')

const liveStats: FairLiveStatsDTO = {
  fairId: 'fair-001',
  fairName: '测试招聘会',
  totalCompanies: 10,
  checkedInCompanies: null,   // must allow null
  totalPositions: 50,
  totalHeadcount: 100,
  browseCount: null,          // must allow null
  scanCount: null,            // must allow null
  printCount: null,           // must allow null
  checkinCount: null,         // must allow null
  zoneBreakdown: [],
  lastUpdated: new Date().toISOString(),
  seekerIntent: [],
  industryDistribution: [],
  dataSourceLabel: '主办方录入数据 · 非实时',
  isMockData: false,
}

assert('checkedInCompanies accepts null', liveStats.checkedInCompanies === null)
assert('browseCount accepts null', liveStats.browseCount === null)
assert('scanCount accepts null', liveStats.scanCount === null)
assert('printCount accepts null', liveStats.printCount === null)
assert('checkinCount accepts null', liveStats.checkinCount === null)
assert('totalCompanies still number', typeof liveStats.totalCompanies === 'number')
assert('totalPositions still number', typeof liveStats.totalPositions === 'number')
assert('totalHeadcount still number', typeof liveStats.totalHeadcount === 'number')

// also verify that number values are still accepted (not forced null)
const liveStatsWithNumbers: FairLiveStatsDTO = {
  ...liveStats,
  checkedInCompanies: 5,
  browseCount: 100,
  scanCount: 20,
  printCount: 10,
  checkinCount: 5,
}
assert('checkedInCompanies accepts number', typeof liveStatsWithNumbers.checkedInCompanies === 'number')
assert('browseCount accepts number', typeof liveStatsWithNumbers.browseCount === 'number')

// ── Section 2: FairStatsDto type-level checks ─────────────────────────────────

console.log('\n[2] FairStatsDto — null-capable fields')

const internalDto: FairStatsDto = {
  fairId: 'fair-001',
  fairName: '测试招聘会',
  totalCompanies: 10,
  checkedInCompanies: null,   // must allow null
  totalPositions: 50,
  totalHeadcount: 100,
  browseCount: null,          // must allow null
  scanCount: null,            // must allow null
  printCount: null,           // must allow null
  checkinCount: null,         // must allow null
  zoneBreakdown: [],
  lastUpdated: new Date().toISOString(),
  seekerIntent: [],
  industryDistribution: [],
  dataSourceLabel: '主办方录入数据 · 非实时',
  isMockData: false,
}

assert('FairStatsDto.checkedInCompanies accepts null', internalDto.checkedInCompanies === null)
assert('FairStatsDto.browseCount accepts null', internalDto.browseCount === null)
assert('FairStatsDto.scanCount accepts null', internalDto.scanCount === null)
assert('FairStatsDto.printCount accepts null', internalDto.printCount === null)
assert('FairStatsDto.checkinCount accepts null', internalDto.checkinCount === null)

// ── Section 3: getFairStats stub contract ─────────────────────────────────────
// We import and call the service with a stub prisma — no real DB connection.
// NOTE: the type-only fixture objects above (liveStats, internalDto) are compile-time
// fixtures only. True union/type enforcement for API responses is provided by the
// API and Kiosk typecheck steps, not by this runtime script.

console.log('\n[3] getFairStats — null-for-unproven fields + correct metadata')

async function main(): Promise<void> {
  const { JobsKioskService } = await import('../src/jobs/jobs-kiosk.service')

  const now = new Date()
  const updatedAt = new Date(now.getTime() - 60_000)

  // Minimal stub: prisma.jobFair.findFirst returns a fake fair.
  // viewCount is intentionally set to 99 to verify it is NOT remapped to browseCount.
  const stubPrisma = {
    jobFair: {
      findFirst: async () => ({
        id: 'fair-stub',
        title: '测试招聘会 Stub',
        sourceOrgId: 'org-1',
        externalId: 'EXT-1',
        sourceName: 'TestOrg',
        sourceUrl: 'https://example.com',
        checkinUrl: null,
        theme: '2026',
        startAt: new Date(now.getTime() - 3600_000),
        endAt: new Date(now.getTime() + 3600_000),
        venue: '测试会场',
        city: '广州',
        address: null,
        mapImageUrl: null,
        description: null,
        coverImageUrl: null,
        companyCount: 3,
        jobCount: 10,
        viewCount: 99,
        reviewStatus: 'approved',
        publishStatus: 'published',
        reviewedBy: null,
        reviewedAt: null,
        rejectReason: null,
        syncTime: now,
        latitude: null,
        longitude: null,
        trafficInfo: null,
        expectedAttendance: 500,
        seekerIntentJson: JSON.stringify([{ label: '技术', percent: 60 }, { label: '产品', percent: 40 }]),
        updatedAt,
        companies: [
          {
            id: 'c1', industry: 'internet',
            positions: [{ id: 'p1', headcount: 2 }, { id: 'p2', headcount: 3 }],
          },
          {
            id: 'c2', industry: 'finance',
            positions: [{ id: 'p3', headcount: 1 }],
          },
        ],
        _count: { companies: 2 },
      }),
    },
  } as never

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new (JobsKioskService as any)(stubPrisma)
  const result: { data: FairStatsDto | null } = await svc.getFairStats('fair-stub')
  const d = result.data!

  assert('data is not null', d !== null)
  assert('checkedInCompanies === null', d.checkedInCompanies === null,
    `got ${d.checkedInCompanies}`)
  assert('browseCount === null', d.browseCount === null,
    `got ${d.browseCount}`)
  assert('scanCount === null', d.scanCount === null,
    `got ${d.scanCount}`)
  assert('printCount === null', d.printCount === null,
    `got ${d.printCount}`)
  assert('checkinCount === null', d.checkinCount === null,
    `got ${d.checkinCount}`)
  assert('zoneBreakdown is empty array', Array.isArray(d.zoneBreakdown) && d.zoneBreakdown.length === 0,
    `got length ${d.zoneBreakdown.length}`)
  assert('totalCompanies is number', typeof d.totalCompanies === 'number')
  assert('totalPositions is number', typeof d.totalPositions === 'number')
  assert('totalHeadcount is number', typeof d.totalHeadcount === 'number')
  assert('isMockData === false', d.isMockData === false, `got ${d.isMockData}`)
  assert(
    'dataSourceLabel === "主办方录入数据 · 非实时"',
    d.dataSourceLabel === '主办方录入数据 · 非实时',
    `got "${d.dataSourceLabel}"`,
  )
  assert(
    'lastUpdated === updatedAt.toISOString()',
    d.lastUpdated === updatedAt.toISOString(),
    `got "${d.lastUpdated}"`,
  )
  assert(
    'browseCount !== 99 (not remapped from viewCount)',
    d.browseCount !== 99,
    `got ${d.browseCount}`,
  )
  assert('seekerIntent is array', Array.isArray(d.seekerIntent))
  assert('industryDistribution is array', Array.isArray(d.industryDistribution))
}

main().then(() => {
  summarize()
}).catch((err: unknown) => {
  console.error('Section 3 failed:', err)
  failed++
  summarize()
})

function summarize(): void {
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`PASS: ${passed}  FAIL: ${failed}  TOTAL: ${passed + failed}`)
  if (failed > 0) {
    console.error('\n❌ verify:fair-stats-truth FAILED')
    process.exit(1)
  } else {
    console.log('\n✅ verify:fair-stats-truth PASSED')
  }
}
