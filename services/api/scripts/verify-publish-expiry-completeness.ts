// verify-publish-expiry-completeness.ts
// 发布路径两道闸门:①「不复活过期内容」 ②「来源不可追溯不得上线」
//
// 事故背景(两条都指向同一个形态:一条无法追溯 / 早已失效的内容被推上公开终端):
//
//   ① BulkPublishPreviewResult.excluded.expired 原先统计 publishStatus === 'expired'。
//      **全仓没有任何代码把 publishStatus 写成 'expired'** —— 相反,
//      verify-job-validity-expiry.ts §8 专门断言不得写库(有效期只允许读取时派生)。
//      于是这个统计对岗位 / 招聘会 / 政策**恒为 0**,运营在预览页永远看到
//      「已过期 0 条」;与此同时候选池只筛 publishStatus,不看日期,
//      真正过期的岗位(validThrough 已过)和已结束的招聘会(endAt 已过)照发不误。
//      —— 统计说排除了 0 条,实际一条没排除,两头都不报警。
//
//   ② publishJobSource / publishFairSource 只校验 reviewStatus='approved'
//      与来源机构内容信任,**不校验合规必填字段是否为空**。
//      CLAUDE.md §10 要求外部岗位/招聘会必须带 source_org_id / external_id /
//      source_name / source_url / sync_time,且岗位详情必须能展示来源机构、
//      同步时间、外部ID、外部投递链接。sourceUrl='' 的岗位一旦发布,
//      前台就是一张没有任何来源出处的残缺卡片。
//
// 本脚本必须证明的事:
//   1. 过期岗位 / 已结束招聘会**不进**批量候选池
//   2. excluded.expired **如实**反映被排除的条数(不再恒 0)
//   3. 缺有效期(validThrough=null)**不算**过期 —— 不得误杀在招岗位
//   4. 显式提交过期 id 也发布不了,且逐条给出可读原因
//   5. 合规必填字段为空 → 明确拒绝 + 指名缺哪个字段
//   6. 被拒后字段**保持为空** —— 不得为任何字段编造默认值
//   7. 单条路径与批量路径对同一条给出**相同**的错误码(行为等价)
//
// 用内存假 Prisma + 真实 JobsAdminService / BulkPublishService,不连库、不起 HTTP。
// 假 Prisma 对**无法识别的 where 操作符直接抛错**,避免断言静默退化成恒真。
//
// Run: node -r @swc-node/register scripts/verify-publish-expiry-completeness.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JobsAdminService } from '../src/jobs/jobs-admin.service'
import { PoliciesService } from '../src/policies/policies.service'
import { BulkPublishService } from '../src/bulk-publish/bulk-publish.service'
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

// 服务端用真实 new Date() 判有效期,所以固定夹具取「远早于/远晚于今天」的两端,
// 不受运行日期影响。
//
// 2026-09-02 修正:原值 2026-07-01 / 2026-12-31 本身就是定时炸弹——FUTURE 一过新年
// 就会让 j-future 变成「已过期」。取端点到 2000 / 2099,这条门禁才真的与运行日期无关。
const PAST = new Date('2000-01-01T00:00:00Z')
const FUTURE = new Date('2099-12-31T00:00:00Z')

// ── 内存假 Prisma ─────────────────────────────────────────────────────────────

interface Row {
  id: string
  [k: string]: unknown
}

/** 已知的 where 操作符。出现之外的键一律抛错,不静默放行。 */
const KNOWN_OPS = new Set(['in', 'notIn', 'not', 'gte', 'lte', 'gt', 'lt', 'equals'])

function matchLeaf(val: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>
    for (const op of Object.keys(c)) {
      if (!KNOWN_OPS.has(op)) {
        throw new Error(`假 Prisma 不认识 where 操作符 "${op}" —— 拒绝静默放行,请先支持它再断言`)
      }
    }
    if ('in' in c && !(c.in as unknown[]).includes(val)) return false
    if ('notIn' in c && (c.notIn as unknown[]).includes(val)) return false
    if ('not' in c && val === c.not) return false
    if ('equals' in c && val !== c.equals) return false
    // 日期比较：SQL 里 NULL 参与任何比较结果都是 UNKNOWN（即不命中），
    // 假 Prisma 必须复刻这条语义，否则 validThrough=null 的岗位会被误判成过期。
    const cmp = (op: 'gte' | 'lte' | 'gt' | 'lt', ok: (d: number) => boolean): boolean => {
      if (!(op in c)) return true
      if (!(val instanceof Date)) return false
      return ok(val.getTime() - (c[op] as Date).getTime())
    }
    if (!cmp('gte', (d) => d >= 0)) return false
    if (!cmp('lte', (d) => d <= 0)) return false
    if (!cmp('gt', (d) => d > 0)) return false
    if (!cmp('lt', (d) => d < 0)) return false
    return true
  }
  // 标量相等。Prisma 里 `field: null` 表示 IS NULL；假行用 undefined 表示同一件事。
  if (cond === null) return val === null || val === undefined
  return val === cond
}

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') {
      const clauses = (Array.isArray(cond) ? cond : [cond]) as Record<string, unknown>[]
      if (!clauses.every((c) => matches(row, c))) return false
      continue
    }
    if (key === 'OR') {
      const clauses = (Array.isArray(cond) ? cond : [cond]) as Record<string, unknown>[]
      if (!clauses.some((c) => matches(row, c))) return false
      continue
    }
    if (key === 'NOT') {
      const clauses = (Array.isArray(cond) ? cond : [cond]) as Record<string, unknown>[]
      if (clauses.some((c) => matches(row, c))) return false
      continue
    }
    if (!matchLeaf(row[key], cond)) return false
  }
  return true
}

function makeTable(seed: Row[]) {
  const rows = seed.map((r) => ({ ...r }))
  return {
    rows,
    findMany: async (args: Record<string, unknown> = {}) => {
      // select 必须真的校验:真 Prisma 对不存在的列会抛
      // 「Invalid `prisma.jobFair.findMany()` invocation」。
      // 既有两个假 Prisma 都**完全忽略 select**,于是
      // 「按 JobFair 上并不存在的 name 列取标题」这种错在门禁里永远看不见,
      // 在生产上却是 500。这里复刻真库行为。
      const select = args.select as Record<string, unknown> | undefined
      if (select) {
        for (const [col, want] of Object.entries(select)) {
          if (want !== true) continue
          if (rows.length > 0 && !(col in rows[0])) {
            throw new Error(`假 Prisma: select 了该模型不存在的列 "${col}" —— 真 Prisma 会抛 Invalid invocation`)
          }
        }
      }
      let out = rows.filter((r) => matches(r, args.where as Record<string, unknown>))
      const orderBy = args.orderBy as { syncTime?: string; id?: string }[] | undefined
      if (orderBy) {
        out = [...out].sort((a, b) => {
          for (const o of orderBy) {
            if (o.syncTime) {
              const d = (a.syncTime as Date).getTime() - (b.syncTime as Date).getTime()
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

const ORG = 'org-a'

/** 合规字段齐全的岗位行;opts 覆盖用于制造「过期」「缺字段」等形态。 */
function jobRow(id: string, opts: Partial<Row> = {}): Row {
  return {
    id,
    title: `岗位 ${id}`,
    company: '示例公司',
    city: '青岛',
    salary: null,
    tagsJson: null,
    description: null,
    requirements: null,
    sourceId: null,
    sourceOrgId: ORG,
    externalId: `ext-${id}`,
    sourceName: '来源机构A',
    sourceUrl: 'https://example.org/job',
    reviewStatus: 'approved',
    publishStatus: 'draft',
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
    validThrough: null,
    syncTime: new Date('2026-06-01T00:00:00Z'),
    ...opts,
  }
}

/**
 * 合规字段齐全的招聘会行。
 *
 * 刻意**不含** `name` 字段 —— JobFair 模型上根本没有这一列(只有 title)。
 * 既有夹具给假行补了个 name,把「批量发布按不存在的列取招聘会标题」这个
 * 生产 500 一直掩盖着。夹具必须和真 schema 一致,否则门禁只是在自说自话。
 */
function fairRow(id: string, opts: Partial<Row> = {}): Row {
  return {
    id,
    title: `招聘会 ${id}`,
    sourceOrgId: ORG,
    externalId: `ext-${id}`,
    sourceName: '来源机构A',
    sourceUrl: 'https://example.org/fair',
    checkinUrl: null,
    theme: 'general',
    venue: '示例会场',
    city: '青岛',
    address: null,
    description: null,
    reviewStatus: 'approved',
    publishStatus: 'draft',
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
    // 默认必须用 PAST/FUTURE,不能写死具体日期。原来写死 2026-09-01 01:00Z~09:00Z,
    // 于是 2026-09-01 09:00Z 之后 f-ok / f-nourl 全部变「已结束」,这条门禁对任何人恒红
    // (本文件 5 条断言同时挂:excluded.expired 由 1 变 3、候选里没了 f-ok、标题断言取空、
    // 批量发布 0、落库仍为 draft)。需要「已结束」的夹具在调用处显式覆盖 endAt,如 f-ended。
    startAt: PAST,
    endAt: FUTURE,
    syncTime: new Date('2026-06-01T00:00:00Z'),
    ...opts,
  }
}

const auditWrites: { action: string; targetId: string | null | undefined }[] = []

const fakeAudit = {
  write: async (args: { action: string; targetId?: string | null }) => {
    auditWrites.push({ action: args.action, targetId: args.targetId })
    return 'audit-id'
  },
} as unknown as AuditService

const user: AuthedUser = { userId: 'admin-1', role: 'admin' } as AuthedUser

function buildFixture() {
  auditWrites.length = 0
  const job = makeTable([
    // 有效期形态
    jobRow('j-ok'),                                   // 无有效期 → 不算过期
    jobRow('j-future', { validThrough: FUTURE }),     // 未过期
    jobRow('j-expired', { validThrough: PAST }),      // 已过期
    // 字段完整性形态（其余字段齐全，只缺一项）
    jobRow('j-nourl', { sourceUrl: '' }),
    jobRow('j-nocompany', { company: '' }),
    jobRow('j-nocity', { city: '   ' }),
    jobRow('j-noext', { externalId: '' }),
    jobRow('j-badurl', { sourceUrl: '待补充' }),
  ])
  const jobFair = makeTable([
    fairRow('f-ok'),                                                    // 未结束
    fairRow('f-ended', { endAt: PAST, startAt: PAST }), // 已结束（用 PAST 而非字面量：字面量会随运行日期改变含义）
    fairRow('f-nourl', { sourceUrl: '' }),
  ])
  const policyPost = makeTable([])
  const organization = makeTable([
    { id: ORG, name: '来源机构A', contentTrustStatus: 'active', archivedAt: null },
  ])
  const prisma = { job, jobFair, policyPost, organization } as unknown as PrismaService

  const adminSvc = new JobsAdminService(prisma, fakeAudit)
  const policiesSvc = new PoliciesService(prisma, fakeAudit)
  const jobsFacade = {
    publishJobSource: (id: string, action: 'publish' | 'unpublish', u: AuthedUser) =>
      adminSvc.publishJobSource(id, action, u),
    publishFairSource: (id: string, action: 'publish' | 'unpublish', u: AuthedUser) =>
      adminSvc.publishFairSource(id, action, u),
  } as unknown as JobsService

  const bulk = new BulkPublishService(prisma, jobsFacade, policiesSvc)
  return { bulk, adminSvc, job, jobFair }
}

/** 取单条路径抛出的 { error: { code, message } }。 */
async function catchError(fn: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await fn()
    return { code: '', message: '' }
  } catch (e) {
    const resp = (e as { getResponse?: () => unknown }).getResponse?.() as
      | { error?: { code?: string; message?: string } }
      | undefined
    return { code: resp?.error?.code ?? '', message: resp?.error?.message ?? '' }
  }
}

async function main() {
  // ── ① 过期岗位不进候选池 ──────────────────────────────────────────────────
  console.log('\n[1] 岗位:已过有效期的不进批量候选池')
  {
    const { bulk } = buildFixture()
    const pv = await bulk.previewBulkPublish({ kind: 'job' })
    const ids = pv.items.map((i) => i.id)

    assert('已过期岗位(j-expired)不在候选中', !ids.includes('j-expired'), `候选=${JSON.stringify(ids)}`)
    assert('未过期岗位(j-future)仍在候选中', ids.includes('j-future'), `候选=${JSON.stringify(ids)}`)
    assert(
      '缺有效期岗位(j-ok)仍在候选中 —— 来源未提供有效期不等于失效,不得误杀',
      ids.includes('j-ok'),
      `候选=${JSON.stringify(ids)}`,
    )
    assert('eligibleTotal 不把过期条目算进去', !ids.includes('j-expired') && pv.eligibleTotal === ids.length,
      `eligibleTotal=${pv.eligibleTotal} items=${ids.length}`)
  }

  // ── ② excluded.expired 如实计数 ───────────────────────────────────────────
  console.log('\n[2] 统计如实:excluded.expired 反映真实排除条数(不再恒 0)')
  {
    const { bulk } = buildFixture()
    const pv = await bulk.previewBulkPublish({ kind: 'job' })
    assert('岗位 excluded.expired = 1(j-expired)', pv.excluded.expired === 1, `实际 ${pv.excluded.expired}`)

    const fv = await bulk.previewBulkPublish({ kind: 'fair' })
    assert('招聘会 excluded.expired = 1(f-ended)', fv.excluded.expired === 1, `实际 ${fv.excluded.expired}`)
  }

  // ── ③ 招聘会:已结束的不进候选池 ───────────────────────────────────────────
  console.log('\n[3] 招聘会:已结束(endAt 已过)的不进批量候选池')
  {
    const { bulk } = buildFixture()
    const fv = await bulk.previewBulkPublish({ kind: 'fair' })
    const ids = fv.items.map((i) => i.id)
    assert('已结束招聘会(f-ended)不在候选中', !ids.includes('f-ended'), `候选=${JSON.stringify(ids)}`)
    assert('未结束招聘会(f-ok)仍在候选中', ids.includes('f-ok'), `候选=${JSON.stringify(ids)}`)
    // JobFair 上没有 name 列,标题只能取 title。取错列在真 Prisma 上是 500,
    // 在忽略 select 的假 Prisma 上却看不出来 —— 所以这里同时断言「标题真的取到了」。
    assert(
      '招聘会候选带得出真实标题(按 JobFair 真实存在的列取)',
      fv.items.find((i) => i.id === 'f-ok')?.title === '招聘会 f-ok',
      `实际 ${JSON.stringify(fv.items.find((i) => i.id === 'f-ok')?.title)}`,
    )
  }

  // ── ④ 显式提交过期 id 也发布不了 ──────────────────────────────────────────
  console.log('\n[4] 显式提交过期 id:仍被拒,且逐条给出可读原因')
  {
    const { bulk, job } = buildFixture()
    const res = await bulk.executeBulkPublish('job', ['j-ok', 'j-expired'], user)

    const expired = res.results.find((r) => r.id === 'j-expired')!
    assert('过期条目计入失败而非成功', expired.status === 'failed', `实际 ${expired.status}`)
    assert('过期条目带 errorCode', typeof expired.errorCode === 'string' && expired.errorCode.length > 0)
    assert(
      '过期条目的失败原因可读且点明「过期」',
      typeof expired.errorMessage === 'string' && expired.errorMessage.includes('过期'),
      `实际 ${expired.errorMessage}`,
    )
    assert(
      '过期条目的发布状态未被改动(没被推上前台)',
      job.rows.find((r) => r.id === 'j-expired')!.publishStatus === 'draft',
      `实际 ${job.rows.find((r) => r.id === 'j-expired')!.publishStatus}`,
    )
    assert('同一批里未过期的 j-ok 正常发布', res.results.find((r) => r.id === 'j-ok')!.status === 'published')
    assert('计数与明细自洽', res.publishedCount === 1 && res.failedCount === 1,
      `published=${res.publishedCount} failed=${res.failedCount}`)
  }

  // ── ⑤ 合规必填字段为空 → 明确拒绝 + 指名字段 ──────────────────────────────
  console.log('\n[5] 字段完整性:缺合规必填字段的岗位不得发布,且指名缺哪个')
  {
    const { adminSvc, job } = buildFixture()

    const noUrl = await catchError(() => adminSvc.publishJobSource('j-nourl', 'publish', user))
    assert('缺 sourceUrl 被拒绝', noUrl.code === 'PUBLISH_INCOMPLETE_FIELDS', `实际 ${noUrl.code || '(未拒绝)'}`)
    assert('拒绝原因点名「来源链接」', noUrl.message.includes('来源链接'), `实际 ${noUrl.message}`)

    const noCompany = await catchError(() => adminSvc.publishJobSource('j-nocompany', 'publish', user))
    assert('缺 company 被拒绝', noCompany.code === 'PUBLISH_INCOMPLETE_FIELDS', `实际 ${noCompany.code || '(未拒绝)'}`)
    assert('拒绝原因点名「公司名称」', noCompany.message.includes('公司名称'), `实际 ${noCompany.message}`)

    const noCity = await catchError(() => adminSvc.publishJobSource('j-nocity', 'publish', user))
    assert('纯空白 city 也算缺失(trim 后为空)', noCity.code === 'PUBLISH_INCOMPLETE_FIELDS', `实际 ${noCity.code || '(未拒绝)'}`)

    const noExt = await catchError(() => adminSvc.publishJobSource('j-noext', 'publish', user))
    assert('缺 externalId 被拒绝(CLAUDE.md §10 外部ID)', noExt.code === 'PUBLISH_INCOMPLETE_FIELDS', `实际 ${noExt.code || '(未拒绝)'}`)

    const badUrl = await catchError(() => adminSvc.publishJobSource('j-badurl', 'publish', user))
    assert('非 http/https 的 sourceUrl 被拒绝(不可追溯)', badUrl.code === 'PUBLISH_INCOMPLETE_FIELDS', `实际 ${badUrl.code || '(未拒绝)'}`)

    for (const id of ['j-nourl', 'j-nocompany', 'j-nocity', 'j-noext', 'j-badurl']) {
      assert(`${id} 未被发布`, job.rows.find((r) => r.id === id)!.publishStatus === 'draft')
    }
  }

  // ── ⑥ 绝不编造默认值 ──────────────────────────────────────────────────────
  console.log('\n[6] 红线:拒绝之后字段保持原样,不得为任何字段填默认值')
  {
    const { adminSvc, job } = buildFixture()
    await catchError(() => adminSvc.publishJobSource('j-nourl', 'publish', user))
    await catchError(() => adminSvc.publishJobSource('j-nocompany', 'publish', user))

    assert('j-nourl.sourceUrl 仍为空(未被塞默认链接)', job.rows.find((r) => r.id === 'j-nourl')!.sourceUrl === '',
      `实际 ${JSON.stringify(job.rows.find((r) => r.id === 'j-nourl')!.sourceUrl)}`)
    assert('j-nocompany.company 仍为空(未被塞默认公司名)', job.rows.find((r) => r.id === 'j-nocompany')!.company === '',
      `实际 ${JSON.stringify(job.rows.find((r) => r.id === 'j-nocompany')!.company)}`)
    assert('被拒条目未写发布审计', !auditWrites.some((a) => a.action === 'job.publish'))
  }

  // ── ⑦ 招聘会同一道闸门 ────────────────────────────────────────────────────
  console.log('\n[7] 招聘会:同一道字段完整性闸门')
  {
    const { adminSvc, jobFair } = buildFixture()
    const noUrl = await catchError(() => adminSvc.publishFairSource('f-nourl', 'publish', user))
    assert('招聘会缺 sourceUrl 被拒绝', noUrl.code === 'PUBLISH_INCOMPLETE_FIELDS', `实际 ${noUrl.code || '(未拒绝)'}`)
    assert('招聘会拒绝原因点名「来源链接」', noUrl.message.includes('来源链接'), `实际 ${noUrl.message}`)
    assert('f-nourl 未被发布', jobFair.rows.find((r) => r.id === 'f-nourl')!.publishStatus === 'draft')
  }

  // ── ⑧ 单条与批量行为等价 ──────────────────────────────────────────────────
  console.log('\n[8] 单条路径与批量路径对同一条给出相同错误码')
  {
    const { bulk, adminSvc } = buildFixture()
    const single = await catchError(() => adminSvc.publishJobSource('j-nourl', 'publish', user))
    const res = await bulk.executeBulkPublish('job', ['j-nourl'], user)
    const bulkCode = res.results[0]?.errorCode ?? ''

    assert('单条路径拒绝并给 PUBLISH_INCOMPLETE_FIELDS', single.code === 'PUBLISH_INCOMPLETE_FIELDS', `实际 ${single.code || '(未拒绝)'}`)
    assert('批量路径对同一条返回完全相同的错误码', bulkCode === single.code, `single=${single.code} bulk=${bulkCode}`)
    assert('批量路径也带可读原因', (res.results[0]?.errorMessage ?? '').includes('来源链接'), `实际 ${res.results[0]?.errorMessage}`)
  }

  // ── ⑨ 完整且未过期的条目仍能正常发布(闸门不误杀) ──────────────────────────
  console.log('\n[9] 反向:字段齐全且未过期的条目仍能正常发布')
  {
    const { bulk, job, jobFair } = buildFixture()
    const res = await bulk.executeBulkPublish('job', ['j-ok', 'j-future'], user)
    assert('两条合格岗位都发布成功', res.publishedCount === 2 && res.failedCount === 0,
      `published=${res.publishedCount} failed=${res.failedCount}`)
    assert('j-ok 已落库为 published', job.rows.find((r) => r.id === 'j-ok')!.publishStatus === 'published')

    const fres = await bulk.executeBulkPublish('fair', ['f-ok'], user)
    assert('合格招聘会发布成功', fres.publishedCount === 1, `实际 ${fres.publishedCount}`)
    assert('f-ok 已落库为 published', jobFair.rows.find((r) => r.id === 'f-ok')!.publishStatus === 'published')
  }

  // ── ⑩ 下架路径不被闸门挡住 ────────────────────────────────────────────────
  console.log('\n[10] 红线:下架(unpublish)永远放行 —— 否则问题内容撤不下来')
  {
    const { adminSvc, job } = buildFixture()
    // 先把一条不合规内容手工置为已发布(模拟闸门上线前的存量数据)
    job.rows.find((r) => r.id === 'j-nourl')!.publishStatus = 'published'
    const err = await catchError(() => adminSvc.publishJobSource('j-nourl', 'unpublish', user))
    assert('缺字段的存量已发布内容仍可下架', err.code === '', `实际被拒:${err.code} ${err.message}`)
    assert('下架已落库', job.rows.find((r) => r.id === 'j-nourl')!.publishStatus === 'unpublished')
  }

  // ── ⑪ 源码层:不得再用恒为 0 的判据统计过期 ────────────────────────────────
  console.log('\n[11] 源码层:excluded.expired 不得再按 publishStatus=\'expired\' 统计')
  {
    const src = readFileSync(join(__dirname, '../src/bulk-publish/bulk-publish.service.ts'), 'utf8')
    const code = src
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
      .join('\n')
    assert(
      "批量发布不再按 publishStatus:'expired' 统计过期(该值全仓从不落库,恒为 0)",
      !/publishStatus\s*:\s*['"]expired['"]/.test(code),
      "仍存在 publishStatus: 'expired' 判据",
    )
  }

  // ── summary ──────────────────────────────────────────────────────────────
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('verify-publish-expiry-completeness crashed:', e)
  process.exit(1)
})
