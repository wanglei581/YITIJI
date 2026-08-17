// verify-bulk-publish.ts
// 信息源批量发布门禁(岗位 / 招聘会 / 政策)。
//
// 必须证明的三件事(缺一不可):
//   ① pending / rejected 的条目**不会**被批量发布(合规红线,CLAUDE.md §18)
//   ② 部分失败时**逐条**可见(哪几条、为什么),不允许笼统成功/笼统失败
//   ③ 批量路径与单条路径走**同一条**校验 —— 行为等价 + 源码层无第二条写路径
//
// 用内存假 Prisma + 真实 JobsAdminService / PoliciesService 构造真实
// BulkPublishService,不连数据库、不起 HTTP,可在两个 CI job 里直接跑。
//
// Run: node -r @swc-node/register scripts/verify-bulk-publish.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JobsAdminService } from '../src/jobs/jobs-admin.service'
import { PoliciesService } from '../src/policies/policies.service'
import { BulkPublishService, BULK_PUBLISH_MAX_BATCH } from '../src/bulk-publish/bulk-publish.service'
import type { JobsService } from '../src/jobs/jobs.service'
import type { PrismaService } from '../src/prisma/prisma.service'
import type { AuditService } from '../src/audit/audit.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

// ── harness ──────────────────────────────────────────────────────────────────

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

// ── 内存假 Prisma ─────────────────────────────────────────────────────────────

interface Row {
  id: string
  title: string
  name?: string
  sourceOrgId: string
  sourceName: string
  reviewStatus: string
  publishStatus: string
  syncTime: Date
  [k: string]: unknown
}

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true
  for (const [key, cond] of Object.entries(where)) {
    const val = row[key]
    if (cond !== null && typeof cond === 'object') {
      const c = cond as Record<string, unknown>
      if ('in' in c && !(c.in as unknown[]).includes(val)) return false
      if ('not' in c && val === c.not) return false
      if ('gte' in c && !(val instanceof Date && val >= (c.gte as Date))) return false
      if ('lte' in c && !(val instanceof Date && val <= (c.lte as Date))) return false
    } else if (val !== cond) {
      return false
    }
  }
  return true
}

function makeTable(seed: Row[]) {
  const rows = seed.map((r) => ({ ...r }))
  return {
    rows,
    findMany: async (args: Record<string, unknown> = {}) => {
      let out = rows.filter((r) => matches(r, args.where as Record<string, unknown>))
      const orderBy = args.orderBy as { syncTime?: string; id?: string }[] | undefined
      if (orderBy) {
        out = [...out].sort((a, b) => {
          for (const o of orderBy) {
            if (o.syncTime) {
              const d = a.syncTime.getTime() - b.syncTime.getTime()
              if (d !== 0) return o.syncTime === 'asc' ? d : -d
            }
            if (o.id) {
              const d = a.id.localeCompare(b.id)
              if (d !== 0) return o.id === 'asc' ? d : -d
            }
          }
          return 0
        })
      }
      if (typeof args.take === 'number') out = out.slice(0, args.take)
      return out.map((r) => ({ ...r }))
    },
    count: async (args: Record<string, unknown> = {}) =>
      rows.filter((r) => matches(r, args.where as Record<string, unknown>)).length,
    findUnique: async (args: { where: { id: string } }) => {
      const hit = rows.find((r) => r.id === args.where.id)
      return hit ? { ...hit } : null
    },
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const hit = rows.find((r) => r.id === args.where.id)
      if (!hit) throw new Error('row not found')
      Object.assign(hit, args.data)
      return { ...hit }
    },
  }
}

function jobRow(id: string, reviewStatus: string, publishStatus: string, opts: Partial<Row> = {}): Row {
  return {
    id,
    title: `岗位 ${id}`,
    company: '示例公司',
    city: '深圳',
    salary: null,
    tagsJson: null,
    description: null,
    requirements: null,
    sourceId: null,
    sourceOrgId: opts.sourceOrgId ?? 'org-a',
    externalId: `ext-${id}`,
    sourceName: opts.sourceName ?? '来源机构A',
    sourceUrl: 'https://example.org',
    reviewStatus,
    publishStatus,
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
    syncTime: (opts.syncTime as Date) ?? new Date('2026-06-01T00:00:00Z'),
  }
}

const auditWrites: { action: string; targetType: string; targetId: string | null | undefined; payload: unknown }[] = []

const fakeAudit = {
  write: async (args: { action: string; targetType: string; targetId?: string | null; payload?: unknown }) => {
    auditWrites.push({
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
      payload: args.payload,
    })
    return 'audit-id'
  },
} as unknown as AuditService

const user: AuthedUser = { userId: 'admin-1', role: 'admin' } as AuthedUser

function buildFixture() {
  auditWrites.length = 0
  const job = makeTable([
    jobRow('j1', 'approved', 'draft'),
    jobRow('j2', 'approved', 'unpublished', { sourceOrgId: 'org-b', sourceName: '来源机构B' }),
    jobRow('j3', 'pending', 'draft'),
    jobRow('j4', 'rejected', 'draft'),
    jobRow('j5', 'approved', 'published'),
    jobRow('j6', 'approved', 'draft', { syncTime: new Date('2026-07-15T00:00:00Z') }),
  ])
  const jobFair = makeTable([])
  const policyPost = makeTable([])
  const prisma = { job, jobFair, policyPost } as unknown as PrismaService

  const adminSvc = new JobsAdminService(prisma, fakeAudit)
  const policiesSvc = new PoliciesService(prisma, fakeAudit)

  // 门面只是转发,和运行时 JobsService.publishJobSource 的委托完全一致
  const jobsFacade = {
    publishJobSource: (id: string, action: 'publish' | 'unpublish', u: AuthedUser) =>
      adminSvc.publishJobSource(id, action, u),
    publishFairSource: (id: string, action: 'publish' | 'unpublish', u: AuthedUser) =>
      adminSvc.publishFairSource(id, action, u),
  } as unknown as JobsService

  const bulk = new BulkPublishService(prisma, jobsFacade, policiesSvc)
  return { bulk, adminSvc, job }
}

async function main() {
  // ── ① 预览:只列已审核通过且未发布的条目 ──────────────────────────────────
  console.log('\n[1] 预览只列 approved + 未发布,pending/rejected 一律排除')
  {
    const { bulk } = buildFixture()
    const pv = await bulk.previewBulkPublish({ kind: 'job' })
    const ids = pv.items.map((i) => i.id).sort()

    assert('候选恰为 j1/j2/j6(approved + draft/unpublished)', JSON.stringify(ids) === JSON.stringify(['j1', 'j2', 'j6']), `实际 ${JSON.stringify(ids)}`)
    assert('pending(j3)不在候选中', !ids.includes('j3'))
    assert('rejected(j4)不在候选中', !ids.includes('j4'))
    assert('已发布(j5)不在候选中', !ids.includes('j5'))
    assert('eligibleTotal = 3', pv.eligibleTotal === 3, `实际 ${pv.eligibleTotal}`)
    assert('excluded.notApproved = 2(j3/j4)', pv.excluded.notApproved === 2, `实际 ${pv.excluded.notApproved}`)
    assert('excluded.alreadyPublished = 1(j5)', pv.excluded.alreadyPublished === 1, `实际 ${pv.excluded.alreadyPublished}`)
    assert('预览是只读的:未产生任何审计写入', auditWrites.length === 0, `实际 ${auditWrites.length}`)
  }

  // ── ② 筛选生效 ────────────────────────────────────────────────────────────
  console.log('\n[2] 筛选:按来源机构 / 按时间范围')
  {
    const { bulk } = buildFixture()
    const byOrg = await bulk.previewBulkPublish({ kind: 'job', sourceOrgId: 'org-b' })
    assert('按 sourceOrgId=org-b 只剩 j2', JSON.stringify(byOrg.items.map((i) => i.id)) === JSON.stringify(['j2']))

    const byTime = await bulk.previewBulkPublish({
      kind: 'job',
      syncTimeFrom: '2026-07-01T00:00:00.000Z',
      syncTimeTo: '2026-07-31T23:59:59.999Z',
    })
    assert('按 syncTime 7 月窗口只剩 j6', JSON.stringify(byTime.items.map((i) => i.id)) === JSON.stringify(['j6']))

    let rangeRejected = false
    try {
      await bulk.previewBulkPublish({ kind: 'job', syncTimeFrom: '2026-08-01T00:00:00Z', syncTimeTo: '2026-07-01T00:00:00Z' })
    } catch {
      rangeRejected = true
    }
    assert('起止时间颠倒被拒绝', rangeRejected)
  }

  // ── ③ pending / rejected 即使被显式提交也发布不了 ─────────────────────────
  console.log('\n[3] 合规红线:pending / rejected 显式提交也不会上线')
  {
    const { bulk, job } = buildFixture()
    const res = await bulk.executeBulkPublish('job', ['j1', 'j3', 'j4'], user)

    assert('成功 1 条(仅 j1)', res.publishedCount === 1, `实际 ${res.publishedCount}`)
    assert('失败 2 条(j3/j4)', res.failedCount === 2, `实际 ${res.failedCount}`)

    const j3 = job.rows.find((r) => r.id === 'j3')!
    const j4 = job.rows.find((r) => r.id === 'j4')!
    assert('j3(pending)发布状态未被改动', j3.publishStatus === 'draft', `实际 ${j3.publishStatus}`)
    assert('j4(rejected)发布状态未被改动', j4.publishStatus === 'draft', `实际 ${j4.publishStatus}`)
    assert('j3 审核状态未被批量动作改写', j3.reviewStatus === 'pending')
    assert('j4 审核状态未被批量动作改写', j4.reviewStatus === 'rejected')

    const j1 = job.rows.find((r) => r.id === 'j1')!
    assert('j1(approved)确实已发布', j1.publishStatus === 'published', `实际 ${j1.publishStatus}`)
  }

  // ── ④ 部分失败逐条可见 ────────────────────────────────────────────────────
  console.log('\n[4] 部分失败:逐条可见(是哪几条、为什么)')
  {
    const { bulk } = buildFixture()
    const res = await bulk.executeBulkPublish('job', ['j1', 'j3', 'j2', 'j4'], user)

    assert('顶层无 ok 字段(不返回笼统成功)', !('ok' in (res as unknown as Record<string, unknown>)))
    assert('results 覆盖全部 4 条', res.results.length === 4, `实际 ${res.results.length}`)
    assert('结果顺序与请求 ids 一致', JSON.stringify(res.results.map((r) => r.id)) === JSON.stringify(['j1', 'j3', 'j2', 'j4']))

    const fails = res.results.filter((r) => r.status === 'failed')
    assert('失败明细恰为 j3/j4', JSON.stringify(fails.map((f) => f.id)) === JSON.stringify(['j3', 'j4']))
    assert('每条失败都带 errorCode', fails.every((f) => typeof f.errorCode === 'string' && f.errorCode.length > 0))
    assert(
      '失败原因是 PUBLISH_REQUIRES_APPROVAL',
      fails.every((f) => f.errorCode === 'PUBLISH_REQUIRES_APPROVAL'),
      JSON.stringify(fails.map((f) => f.errorCode)),
    )
    assert('每条失败都带可读 message', fails.every((f) => typeof f.errorMessage === 'string' && f.errorMessage.length > 0))
    assert('每条失败都带标题(可定位是哪一条)', fails.every((f) => typeof f.title === 'string' && f.title.length > 0))
    assert('计数与明细自洽', res.publishedCount + res.failedCount === res.results.length)
    assert('publishedCount 与明细一致', res.publishedCount === res.results.filter((r) => r.status === 'published').length)
  }

  // ── ⑤ 逐条审计 ────────────────────────────────────────────────────────────
  console.log('\n[5] 逐条审计:能追到具体是哪些条目')
  {
    const { bulk } = buildFixture()
    await bulk.executeBulkPublish('job', ['j1', 'j2', 'j3'], user)

    const pubAudits = auditWrites.filter((a) => a.action === 'job.publish')
    assert('成功的 2 条各写 1 条审计', pubAudits.length === 2, `实际 ${pubAudits.length}`)
    assert(
      '审计 targetId 指向具体条目 j1/j2',
      JSON.stringify(pubAudits.map((a) => a.targetId).sort()) === JSON.stringify(['j1', 'j2']),
      JSON.stringify(pubAudits.map((a) => a.targetId)),
    )
    assert('失败条目(j3)未写发布审计', !pubAudits.some((a) => a.targetId === 'j3'))
    assert('审计走既有 job.publish 通道(未新起 action)', pubAudits.every((a) => a.targetType === 'job'))
    assert(
      '审计 payload 含发布前后状态',
      pubAudits.every((a) => {
        const p = a.payload as Record<string, unknown>
        return p && 'fromPublishStatus' in p && 'toPublishStatus' in p
      }),
    )
  }

  // ── ⑥ 批量与单条走同一条校验 ──────────────────────────────────────────────
  console.log('\n[6] 批量路径与单条路径同一条校验(行为等价)')
  {
    const { bulk, adminSvc } = buildFixture()

    // 单条路径直接调用
    let singleCode = ''
    try {
      await adminSvc.publishJobSource('j3', 'publish', user)
    } catch (e) {
      const resp = (e as { getResponse?: () => unknown }).getResponse?.() as { error?: { code?: string } }
      singleCode = resp?.error?.code ?? ''
    }

    // 批量路径同一个 id
    const res = await bulk.executeBulkPublish('job', ['j3'], user)
    const bulkCode = res.results[0]?.errorCode ?? ''

    assert('单条路径拒绝 pending 并返回 PUBLISH_REQUIRES_APPROVAL', singleCode === 'PUBLISH_REQUIRES_APPROVAL', `实际 ${singleCode}`)
    assert('批量路径对同一条返回完全相同的错误码', bulkCode === singleCode, `single=${singleCode} bulk=${bulkCode}`)

    // 不存在的 id 两条路径也应一致地失败
    const missing = await bulk.executeBulkPublish('job', ['no-such-id'], user)
    assert('不存在的 id 计入失败而非成功', missing.failedCount === 1 && missing.publishedCount === 0)
  }

  // ── ⑦ 上限 / 分批 ─────────────────────────────────────────────────────────
  console.log('\n[7] 单轮上限与空输入防护')
  {
    const { bulk } = buildFixture()

    let tooLarge = ''
    try {
      await bulk.executeBulkPublish('job', Array.from({ length: BULK_PUBLISH_MAX_BATCH + 1 }, (_, i) => `x${i}`), user)
    } catch (e) {
      const resp = (e as { getResponse?: () => unknown }).getResponse?.() as { error?: { code?: string } }
      tooLarge = resp?.error?.code ?? ''
    }
    assert(`超过 ${BULK_PUBLISH_MAX_BATCH} 条被拒绝(BULK_BATCH_TOO_LARGE)`, tooLarge === 'BULK_BATCH_TOO_LARGE', `实际 ${tooLarge}`)

    let empty = ''
    try {
      await bulk.executeBulkPublish('job', [], user)
    } catch (e) {
      const resp = (e as { getResponse?: () => unknown }).getResponse?.() as { error?: { code?: string } }
      empty = resp?.error?.code ?? ''
    }
    assert('空 id 列表被拒绝(BULK_IDS_REQUIRED)', empty === 'BULK_IDS_REQUIRED', `实际 ${empty}`)

    assert('preview 的 batchLimit 与服务端上限一致', (await bulk.previewBulkPublish({ kind: 'job' })).batchLimit === BULK_PUBLISH_MAX_BATCH)
  }

  // ── ⑧ 源码层:不存在第二条写路径 ──────────────────────────────────────────
  console.log('\n[8] 源码层:批量服务内不得自建发布写路径')
  {
    const src = readFileSync(join(__dirname, '../src/bulk-publish/bulk-publish.service.ts'), 'utf8')
    const code = src
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
      .join('\n')

    assert('未直接调用 prisma 的 update(没有绕开单条方法写状态)', !/\.update\s*\(/.test(code), '发现 .update( 调用')
    assert('未直接调用 updateMany(没有批量硬改状态)', !/updateMany/.test(code))
    // 只读 where/select/orderBy/take;一旦出现 data:{} 就说明开始自己写库了。
    // (注:preview 里合法出现 publishStatus:'published' 是**统计已发布条数的读**,
    //  所以这里不能按字面量判,要按「有没有写入负载」判。)
    assert('未向 prisma 传 data:(批量服务完全只读,写入只发生在单条方法内)', !/\bdata:\s*\{/.test(code), '发现 data: 写入负载')
    assert('确实调用了单条发布方法 publishJobSource', /publishJobSource/.test(code))
    assert('确实调用了单条发布方法 publishFairSource', /publishFairSource/.test(code))
    assert('确实调用了单条发布方法 publishPolicy', /publishPolicy/.test(code))
    assert('未自行写审计(审计由单条方法负责,不重复记账)', !/audit\.write/.test(code))
  }

  // ── ⑨ Kiosk 过滤条件未被改动 ──────────────────────────────────────────────
  console.log('\n[9] 红线:Kiosk 可见性过滤条件未被放宽')
  {
    const kioskSrc = readFileSync(join(__dirname, '../src/jobs/jobs-kiosk.service.ts'), 'utf8')
    assert(
      'Kiosk 岗位查询仍要求 approved + published',
      /reviewStatus:\s*['"]approved['"]/.test(kioskSrc) && /publishStatus:\s*['"]published['"]/.test(kioskSrc),
    )
    const policySrc = readFileSync(join(__dirname, '../src/policies/policies.service.ts'), 'utf8')
    assert(
      '政策公开查询仍要求 approved + published',
      /reviewStatus:\s*['"]approved['"]/.test(policySrc) && /publishStatus:\s*['"]published['"]/.test(policySrc),
    )
  }

  // ── summary ──────────────────────────────────────────────────────────────
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('verify-bulk-publish crashed:', e)
  process.exit(1)
})
