/**
 * 招聘会公开列表结构性完整性验证。
 *
 * 起因(实测,72 场招聘会 / 62 场已发布):
 *   - 列表按 startAt 升序 → 第一页 20 条 100% 是已结束的;
 *   - status 筛选跑在分页「之后」(内存 filter) → ?status=upcoming 返回
 *     data:[] 但 total:62 —— 接口自相矛盾,页面显示「共 0 场」;
 *   - 端点根本没有 keyword 参数 → 搜索只在「当前已加载的那一页」本地过滤,
 *     第 3 页才出现的招聘会永远搜不到。
 *
 * 覆盖(全部按夹具/接口自身推导,不写死条数):
 *   A. status 下推到 where —— 返回行状态全部命中,且 total 随筛选变化。
 *   B. total 自洽 —— 各 status 的 total 之和 = 不筛选时的 total。
 *   C. total 真实可达 —— 小 pageSize 翻完全部页,拿到的去重条数正好 = total
 *      (不多不少,即不静默截断、不重复、不虚报)。
 *   D. 默认排序 —— 未结束场次足够多时,第一页不得出现已结束场次。
 *   E. keyword 服务端全表检索 —— 默认排序下落在第一页之外的条目也能搜到。
 *   F. 发布闸门 —— 未发布(approved+draft / pending+draft)在以上任何查询中都不得出现。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:fair-list-integrity
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'

import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { JobsService } from '../src/jobs/jobs.service'
import { JobQualityService } from '../src/job-ai/job-quality.service'
import { JobsKioskService } from '../src/jobs/jobs-kiosk.service'
import { JobsAdminService } from '../src/jobs/jobs-admin.service'
import { JobsPartnerService } from '../src/jobs/jobs-partner.service'
import { JobsExcelService } from '../src/jobs/jobs-excel.service'
import { FAIR_STATUS_VALUES, type FairStatus } from '../src/jobs/jobs-shared'
import { cleanFairVerifyResidue } from './lib/verify-fair-residue'

const RESIDUE_TAG = 'vresidfairlistintegrity'

/** 翻页用的小页长:必须小于夹具数量,才能真正跨过分页边界。 */
const PAGE_SIZE = 5

let passed = 0
function pass(m: string): void { passed++; console.log(`  PASS ${m}`) }
function fail(m: string): never { throw new Error(`FAIL ${m}`) }

const DAY = 86_400_000
const HOUR = 3_600_000

async function cleanup(prisma: PrismaService): Promise<void> {
  await cleanFairVerifyResidue(prisma, RESIDUE_TAG)
}

type Svc = JobsService
type FairQuery = NonNullable<Parameters<Svc['getPublishedFairs']>[0]>

/** 翻完所有页,返回按顺序拼接的 id 列表 + 接口自报 total。 */
async function drainAllPages(
  svc: Svc,
  query: Omit<FairQuery, 'page' | 'pageSize'>,
  pageSize = PAGE_SIZE,
): Promise<{ ids: string[]; total: number; statuses: FairStatus[] }> {
  const ids: string[] = []
  const statuses: FairStatus[] = []
  let total = 0
  // 上限保护:即使接口分页坏掉也不会无限循环。
  const maxPages = 500
  for (let page = 1; page <= maxPages; page++) {
    const res = await svc.getPublishedFairs({ ...query, page, pageSize } as FairQuery)
    total = res.pagination.total
    if (res.data.length === 0) break
    ids.push(...res.data.map((f) => f.id))
    statuses.push(...res.data.map((f) => f.status as FairStatus))
    if (ids.length > total + pageSize) break // 明显超发,交给断言报错
  }
  return { ids, total, statuses }
}

async function main(): Promise<void> {
  console.log('\n=== 招聘会公开列表结构性完整性验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const _audit = new AuditService(prisma)
  const _jobQuality = new JobQualityService(prisma)
  const _kiosk = new JobsKioskService(prisma)
  const _admin = new JobsAdminService(prisma, _audit)
  const _partner = new JobsPartnerService(prisma, _audit, _jobQuality)
  const _excel = new JobsExcelService(prisma, _audit, _jobQuality)
  const svc = new JobsService(_kiosk, _admin, _partner, _excel)

  await cleanup(prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const orgId = `org_vfli_${RESIDUE_TAG}_${suffix}`
  // 只可能出现在夹具里的检索词(真实数据不会命中)。
  const DEEP_KEYWORD = `深页检索标记${suffix}`

  try {
    await prisma.organization.create({
      data: { id: orgId, name: `验证机构_${suffix}`, type: 'fair_organizer' },
    })

    const now = Date.now()
    let seq = 0
    const mkFair = (opts: {
      label: string
      startOffsetMs: number
      durationMs?: number
      published?: boolean
      reviewStatus?: string
      title?: string
    }) => {
      const dur = opts.durationMs ?? 4 * HOUR
      const published = opts.published ?? true
      return prisma.jobFair.create({
        data: {
          sourceOrgId: orgId,
          externalId: `VFLI-${opts.label}-${suffix}-${seq++}`,
          sourceName: '验证来源',
          sourceUrl: 'https://example.org/fairs',
          title: opts.title ?? `验证招聘会_${opts.label}_${suffix}`,
          theme: 'general',
          startAt: new Date(now + opts.startOffsetMs),
          endAt: new Date(now + opts.startOffsetMs + dur),
          venue: '验证会展中心',
          city: '验证市',
          reviewStatus: opts.reviewStatus ?? (published ? 'approved' : 'approved'),
          publishStatus: published ? 'published' : 'draft',
        },
      })
    }

    // ── 夹具:跨过分页边界,三种状态齐全 ──────────────────────────────────
    const UPCOMING_N = 12
    const ONGOING_N = 3
    const ENDED_N = 12

    const upcoming = []
    for (let i = 0; i < UPCOMING_N; i++) {
      upcoming.push(await mkFair({ label: `upcoming${i}`, startOffsetMs: (i + 1) * DAY }))
    }
    const ongoing = []
    for (let i = 0; i < ONGOING_N; i++) {
      // 已开始未结束
      ongoing.push(await mkFair({ label: `ongoing${i}`, startOffsetMs: -1 * HOUR - i * 60_000, durationMs: 6 * HOUR }))
    }
    const ended = []
    for (let i = 0; i < ENDED_N; i++) {
      ended.push(await mkFair({ label: `ended${i}`, startOffsetMs: -(i + 2) * DAY }))
    }

    // 关键词夹具:startAt 放到很远的未来 → 默认排序(未结束升序)里排在最后,
    // 必然落在第一页之外;只有服务端全表检索才搜得到。
    const deepFair = await mkFair({
      label: 'deepkeyword',
      startOffsetMs: 3650 * DAY,
      title: `${DEEP_KEYWORD}专场招聘会`,
    })

    // 未发布夹具:两种未发布形态都不得泄漏。
    const hiddenApproved = await mkFair({ label: 'hidden-approved', startOffsetMs: 2 * DAY, published: false })
    const hiddenPending = await mkFair({
      label: 'hidden-pending', startOffsetMs: 3 * DAY, published: false, reviewStatus: 'pending',
    })
    const hiddenIds = new Set([hiddenApproved.id, hiddenPending.id])

    const fixtureVisibleIds = new Set(
      [...upcoming, ...ongoing, ...ended, deepFair].map((f) => f.id),
    )

    // ── C(先跑):不筛选时 total 真实可达 ───────────────────────────────
    const all = await drainAllPages(svc, {})
    const uniqueAll = new Set(all.ids)
    if (all.ids.length !== uniqueAll.size) {
      fail(`C. 翻页出现重复条目:累计 ${all.ids.length} 条,去重后 ${uniqueAll.size} 条`)
    }
    if (uniqueAll.size !== all.total) {
      fail(`C. total 与真实可翻到的条数不符:total=${all.total},实际翻到 ${uniqueAll.size} 条`)
    }
    pass(`C. 不筛选:翻完 ${uniqueAll.size} 条,与 total 一致(无重复/无遗漏/无虚报)`)

    // 夹具必须全部可见,否则后面的断言没有意义。
    for (const id of fixtureVisibleIds) {
      if (!uniqueAll.has(id)) fail(`夹具未出现在公开列表中(id=${id}),验证前提不成立`)
    }
    pass(`C2. ${fixtureVisibleIds.size} 条已发布夹具全部可见`)

    // ── A + B:status 下推 + total 自洽 ────────────────────────────────
    let statusTotalSum = 0
    const perStatus = new Map<FairStatus, { ids: string[]; total: number }>()
    for (const status of FAIR_STATUS_VALUES) {
      const res = await drainAllPages(svc, { status })
      perStatus.set(status, { ids: res.ids, total: res.total })
      statusTotalSum += res.total

      const wrong = res.statuses.filter((s) => s !== status)
      if (wrong.length > 0) {
        fail(`A. status=${status} 返回了状态不符的行:${[...new Set(wrong)].join('/')}`)
      }
      const uniq = new Set(res.ids)
      if (uniq.size !== res.total) {
        fail(`A. status=${status} 的 total 与可翻到的条数不符:total=${res.total},实际 ${uniq.size}`)
      }
      if (res.total === 0) {
        fail(`A. status=${status} 返回 0 条,但夹具保证每种状态都有数据`)
      }
      pass(`A. status=${status}:${res.total} 条,状态全部命中且 total 可翻到`)
    }

    if (statusTotalSum !== all.total) {
      fail(`B. 各状态 total 之和 ${statusTotalSum} ≠ 不筛选 total ${all.total}(筛选未下推或计数虚假)`)
    }
    pass(`B. 各状态 total 之和 = 不筛选 total(${all.total}),三种状态构成精确划分`)

    // ── D:默认排序不得让已结束场次占据第一页 ───────────────────────────
    const activeTotal = (perStatus.get('upcoming')?.total ?? 0) + (perStatus.get('ongoing')?.total ?? 0)
    if (activeTotal < PAGE_SIZE) {
      fail(`D. 前提不成立:未结束场次仅 ${activeTotal} 条,不足一页(${PAGE_SIZE})`)
    }
    const firstPage = await svc.getPublishedFairs({ page: 1, pageSize: PAGE_SIZE } as FairQuery)
    const endedOnFirstPage = firstPage.data.filter((f) => f.status === 'ended')
    if (endedOnFirstPage.length > 0) {
      fail(
        `D. 第一页出现 ${endedOnFirstPage.length} 条已结束场次,而库中还有 ${activeTotal} 条未结束场次未展示`,
      )
    }
    pass(`D. 默认排序:第一页 ${firstPage.data.length} 条全部为未结束场次(库中未结束 ${activeTotal} 条)`)

    // ── E:keyword 服务端全表检索 ──────────────────────────────────────
    const deepIndex = all.ids.indexOf(deepFair.id)
    if (deepIndex < 0) fail('E. 前提不成立:深页夹具不在公开列表中')
    if (deepIndex < PAGE_SIZE) {
      fail(`E. 前提不成立:深页夹具落在第一页(位序 ${deepIndex + 1}),无法证明是全表检索`)
    }
    const searched = await svc.getPublishedFairs({
      keyword: DEEP_KEYWORD, page: 1, pageSize: PAGE_SIZE,
    } as FairQuery)
    if (!searched.data.some((f) => f.id === deepFair.id)) {
      fail(`E. 关键词检索没搜到默认排序第 ${Math.floor(deepIndex / PAGE_SIZE) + 1} 页的条目(搜索没下推到数据库)`)
    }
    if (searched.pagination.total !== 1) {
      fail(`E. 关键词 total 应为 1,实际 ${searched.pagination.total}`)
    }
    pass(
      `E. keyword 全表检索:命中默认排序第 ${Math.floor(deepIndex / PAGE_SIZE) + 1} 页(位序 ${deepIndex + 1})的条目,total=1`,
    )

    // keyword 与 status 组合后 total 仍然真实
    const combo = await drainAllPages(svc, { keyword: DEEP_KEYWORD, status: 'upcoming' })
    if (new Set(combo.ids).size !== combo.total) {
      fail(`E2. keyword+status 组合的 total 与可翻到条数不符:total=${combo.total},实际 ${new Set(combo.ids).size}`)
    }
    pass(`E2. keyword + status 组合:total=${combo.total} 且可翻到`)

    // ── F:发布闸门(改完必须重验) ──────────────────────────────────────
    const leakScopes: { label: string; ids: string[] }[] = [
      { label: '不筛选', ids: all.ids },
      ...FAIR_STATUS_VALUES.map((s) => ({ label: `status=${s}`, ids: perStatus.get(s)?.ids ?? [] })),
    ]
    // 未发布夹具的标题里也带 suffix,用它做关键词搜一次,专门试探闸门。
    const probe = await drainAllPages(svc, { keyword: suffix })
    leakScopes.push({ label: 'keyword 搜夹具后缀', ids: probe.ids })

    for (const scope of leakScopes) {
      const leaked = scope.ids.filter((id) => hiddenIds.has(id))
      if (leaked.length > 0) {
        fail(`F. ${scope.label}:泄漏了 ${leaked.length} 条未发布招聘会`)
      }
    }
    pass(`F. 发布闸门:${leakScopes.length} 类查询下未发布招聘会 0 泄漏`)

    // 反向确认闸门探针确实有效(能搜到已发布的同批夹具)
    if (!probe.ids.some((id) => fixtureVisibleIds.has(id))) {
      fail('F2. 闸门探针没搜到任何已发布夹具,说明探针本身失效')
    }
    pass(`F2. 闸门探针有效:同一关键词搜到 ${probe.ids.filter((id) => fixtureVisibleIds.has(id)).length} 条已发布夹具`)

    console.log(`\n=== 全部通过(${passed} 项) ===\n`)
  } finally {
    await cleanup(prisma)
    await prisma.onModuleDestroy()
  }
}

main().catch(async (e) => {
  console.error(e)
  process.exit(1)
})
