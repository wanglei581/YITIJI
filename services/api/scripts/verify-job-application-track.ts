// verify-job-application-track.ts
//
// 我的求职进度门禁：**它必须一直是「用户自填的记事本」，不能长成招聘闭环**。
//
// 为什么有这道门禁：
//   compliance-boundary.md §4.4A 授权记录用户本人自填的求职进度，判定原则是
//   「合法性由**谁写的**决定，不由字段名决定」。这个区分全靠代码结构维持 ——
//   同一张表，只要多出一条第三方写入路径、或者多出一个企业侧读接口、或者多出
//   一个按企业聚合的统计，它立刻从个人记事本变成需要人力资源服务许可证的
//   招聘闭环数据。靠注释和自觉守不住，必须由门禁守。
//
// 必须同时证明的事（缺一不可）：
//   ① channel / statusSource 由服务端恒定写入，前端传不进来，改状态也不改来源
//   ② resumeFileId / consentId 无证期恒为 null，且源码层无任何写入路径
//   ③ 无第三方回流入口：全仓没有 admin / partner / webhook 路径读写本表
//   ④ 无对外读取入口：控制器只在 me/ 命名空间，且受 EndUserAuthGuard 保护
//   ⑤ 展示快照由服务端从「已审核已发布」岗位派生，前端传值一律不算数
//   ⑥ 未发布 / 不存在的岗位被拒绝
//   ⑦ 越权不可能：读、改、删都只命中本人的行
//   ⑧ 不存在按岗位 / 企业 / 来源机构聚合投递的方法（重建候选人漏斗）
//   ⑨ 没有给 Favorite / BrowseLog / ExternalJumpLog 扩状态字段
//   ⑩ 用户可见文案带「本终端不参与投递」的诚实声明（禁词覆盖交给 verify:compliance-copy，
//     本门禁刻意不自造第二份禁词清单，理由见 checkUserFacingCopy）
//   ⑪ 两份 schema 都有模型；⑫ 已纳入个人信息导出
//
// 纯内存假 Prisma + 真实 service，不连数据库、不起 HTTP。
//
// Run: node -r @swc-node/register scripts/verify-job-application-track.ts

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { JobApplicationsService } from '../src/job-applications/job-applications.service'
import {
  SELF_REPORTED_CHANNEL,
  SELF_REPORTED_STATUS_SOURCE,
} from '../src/job-applications/job-application.types'
import type { PrismaService } from '../src/prisma/prisma.service'

const API_ROOT = join(__dirname, '..')
const REPO_ROOT = join(API_ROOT, '..', '..')

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

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf-8')
}

function errorOf(e: unknown): { code: string; message: string } {
  const resp = (e as { getResponse?: () => unknown })?.getResponse?.()
  const err = (resp as { error?: Record<string, unknown> })?.error
  return { code: String(err?.['code'] ?? ''), message: String(err?.['message'] ?? '') }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'generated' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

// ── 内存假 Prisma ────────────────────────────────────────────────────────────

type Row = Record<string, unknown> & { id: string }

const JOBS: Row[] = [
  {
    id: 'job-live',
    company: '示例科技有限公司',
    title: '前端开发工程师',
    sourceName: '来源机构A',
    reviewStatus: 'approved',
    publishStatus: 'published',
  },
  {
    id: 'job-draft',
    company: '未发布公司',
    title: '未发布岗位',
    sourceName: '来源机构B',
    reviewStatus: 'approved',
    publishStatus: 'draft',
  },
]

let seq = 0
let rows: Row[] = []

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v)
}

function makeFakePrisma(): PrismaService {
  return {
    job: {
      async findFirst(args: { where: Record<string, unknown> }) {
        return JOBS.find((j) => matches(j, args.where)) ?? null
      },
    },
    jobApplication: {
      async count(args: { where: Record<string, unknown> }) {
        return rows.filter((r) => matches(r, args.where)).length
      },
      async findMany(args: { where: Record<string, unknown> }) {
        return rows.filter((r) => matches(r, args.where))
      },
      async findFirst(args: { where: Record<string, unknown> }) {
        return rows.find((r) => matches(r, args.where)) ?? null
      },
      async create(args: { data: Record<string, unknown> }) {
        seq += 1
        const now = new Date()
        const row: Row = { id: `ja-${seq}`, createdAt: now, updatedAt: now, ...args.data }
        rows.push(row)
        return row
      },
      async update(args: { where: { id: string }; data: Record<string, unknown> }) {
        const row = rows.find((r) => r.id === args.where.id)
        if (!row) throw new Error('not found')
        Object.assign(row, args.data, { updatedAt: new Date() })
        return row
      },
      async deleteMany(args: { where: Record<string, unknown> }) {
        const before = rows.length
        rows = rows.filter((r) => !matches(r, args.where))
        return { count: before - rows.length }
      },
      async groupBy(args: { where: Record<string, unknown> }) {
        const hit = rows.filter((r) => matches(r, args.where))
        const by = new Map<string, number>()
        for (const r of hit) by.set(String(r['status']), (by.get(String(r['status'])) ?? 0) + 1)
        return [...by].map(([status, n]) => ({ status, _count: { _all: n } }))
      },
    },
  } as unknown as PrismaService
}

const PAGE = { cursor: null, pageSize: 20 }
const ME = 'enduser-me'
const OTHER = 'enduser-other'

// ── ①②⑤⑥ 服务端恒定字段与派生快照 ─────────────────────────────────────────

async function checkServerControlledFields(): Promise<void> {
  console.log('\n[1] 渠道 / 状态来源由服务端恒定写入，快照由服务端派生')
  rows = []
  const svc = new JobApplicationsService(makeFakePrisma())

  const created = await svc.create(ME, { jobId: 'job-live' })
  assert(`channel 恒为 ${SELF_REPORTED_CHANNEL}`, created.channel === SELF_REPORTED_CHANNEL, created.channel)
  assert(`statusSource 恒为 ${SELF_REPORTED_STATUS_SOURCE}`,
    created.statusSource === SELF_REPORTED_STATUS_SOURCE, created.statusSource)
  assert('公司名由服务端从已发布岗位派生', created.companyName === '示例科技有限公司', created.companyName)
  assert('岗位名由服务端派生', created.positionTitle === '前端开发工程师', created.positionTitle)
  assert('来源名由服务端派生', created.sourceName === '来源机构A', String(created.sourceName))
  assert('默认状态为 intention', created.status === 'intention', created.status)

  // 前端即使塞了快照字段（DTO 白名单之外，正常会被 400；这里直连 service 模拟绕过），
  // 关联岗位时仍以服务端派生为准，绝不采信。
  const forged = await svc.create(ME, {
    jobId: 'job-live',
    companyName: '伪造公司',
    positionTitle: '伪造岗位',
  } as never)
  assert('关联岗位时前端传的公司名被忽略', forged.companyName === '示例科技有限公司', forged.companyName)
  assert('关联岗位时前端传的岗位名被忽略', forged.positionTitle === '前端开发工程师', forged.positionTitle)

  // 未发布岗位必须拒绝
  let thrown: unknown = null
  try {
    await svc.create(ME, { jobId: 'job-draft' })
  } catch (e) {
    thrown = e
  }
  assert('未发布岗位被拒绝', thrown !== null)
  assert('未发布岗位错误码为 JOB_APPLICATION_JOB_NOT_FOUND',
    thrown !== null && errorOf(thrown).code === 'JOB_APPLICATION_JOB_NOT_FOUND')

  thrown = null
  try {
    await svc.create(ME, { jobId: 'job-nonexistent' })
  } catch (e) {
    thrown = e
  }
  assert('不存在的岗位被拒绝', thrown !== null)

  // 手填条目：公司名与岗位名必填
  thrown = null
  try {
    await svc.create(ME, { companyName: '只有公司' })
  } catch (e) {
    thrown = e
  }
  assert('手填条目缺岗位名被拒绝', thrown !== null && errorOf(thrown).code === 'JOB_APPLICATION_MISSING_FIELDS')

  const manual = await svc.create(ME, { companyName: '站外公司', positionTitle: '站外岗位' })
  assert('手填条目 jobId 为 null', manual.jobId === null)
  assert('手填条目同样恒定 statusSource', manual.statusSource === SELF_REPORTED_STATUS_SOURCE)

  // 改状态不改状态来源 —— 状态来源只有拿证接入企业反馈时才会出现第二种取值
  const advanced = await svc.update(ME, created.id, { status: 'interviewing' })
  assert('改状态后 status 生效', advanced.status === 'interviewing')
  assert('改状态后 statusSource 仍为用户自填',
    advanced.statusSource === SELF_REPORTED_STATUS_SOURCE, advanced.statusSource)

  // 已关联岗位的快照不可被用户改写
  thrown = null
  try {
    await svc.update(ME, created.id, { companyName: '改成别的公司' })
  } catch (e) {
    thrown = e
  }
  assert('已关联岗位的快照拒绝用户改写',
    thrown !== null && errorOf(thrown).code === 'JOB_APPLICATION_SNAPSHOT_READONLY')

  // 手填条目允许用户自己改
  const manualEdited = await svc.update(ME, manual.id, { companyName: '改名后的站外公司' })
  assert('手填条目允许用户改公司名', manualEdited.companyName === '改名后的站外公司')
}

// ── ② resumeFileId / consentId 恒 null ──────────────────────────────────────

async function checkEmptySlots(): Promise<void> {
  console.log('\n[2] 简历 / 单独同意槽位：恒为 null 且无写入路径')
  rows = []
  const svc = new JobApplicationsService(makeFakePrisma())
  await svc.create(ME, { jobId: 'job-live' })
  await svc.create(ME, { companyName: 'A', positionTitle: 'B' })

  const written = rows.every((r) => r['resumeFileId'] === undefined && r['consentId'] === undefined)
  assert('create 从不写入 resumeFileId / consentId', written)

  // 源码层：service 里不得出现对这两个字段的赋值
  const svcSrc = read('services/api/src/job-applications/job-applications.service.ts')
  const code = svcSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert('service 源码无 resumeFileId 赋值', !/resumeFileId\s*[:=]/.test(code))
  assert('service 源码无 consentId 赋值', !/consentId\s*[:=]/.test(code))

  // DTO 层：两个字段不得出现在任何入参 DTO 里（全局 forbidNonWhitelisted 才拦得住）
  for (const dto of ['create-job-application.dto.ts', 'update-job-application.dto.ts']) {
    const src = read(`services/api/src/job-applications/dto/${dto}`)
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert(`${dto} 不含 channel 字段`, !/\bchannel\b/.test(body))
    assert(`${dto} 不含 statusSource 字段`, !/\bstatusSource\b/.test(body))
    assert(`${dto} 不含 resumeFileId 字段`, !/\bresumeFileId\b/.test(body))
    assert(`${dto} 不含 consentId 字段`, !/\bconsentId\b/.test(body))
  }
}

// ── ⑦ 越权不可能 ────────────────────────────────────────────────────────────

async function checkOwnership(): Promise<void> {
  console.log('\n[3] 越权：读 / 改 / 删都只命中本人的行')
  rows = []
  const svc = new JobApplicationsService(makeFakePrisma())
  const mine = await svc.create(ME, { companyName: '我的公司', positionTitle: '我的岗位' })
  await svc.create(OTHER, { companyName: '别人的公司', positionTitle: '别人的岗位' })

  const myList = await svc.list(ME, PAGE)
  assert('列表只返回本人的记录', myList.items.length === 1 && myList.items[0].companyName === '我的公司')
  assert('列表 total 只统计本人', myList.total === 1, String(myList.total))

  let thrown: unknown = null
  try {
    await svc.update(OTHER, mine.id, { status: 'applied' })
  } catch (e) {
    thrown = e
  }
  assert('改他人记录被拒绝', thrown !== null && errorOf(thrown).code === 'JOB_APPLICATION_NOT_FOUND')

  const del = await svc.remove(OTHER, mine.id)
  assert('删他人记录不生效（removed=false）', del.removed === false)
  assert('他人记录仍在', rows.some((r) => r.id === mine.id))

  const mineDel = await svc.remove(ME, mine.id)
  assert('删本人记录生效', mineDel.removed === true)

  const otherList = await svc.list(OTHER, PAGE)
  assert('他人列表只看得到他人自己的记录',
    otherList.items.length === 1 && otherList.items[0].companyName === '别人的公司')
}

// ── ③④⑧ 仓库层结构约束 ─────────────────────────────────────────────────────

function checkRepoStructure(): void {
  console.log('\n[4] 仓库层：无第三方回流、无对外读取、无按企业聚合')

  const files = walk(join(API_ROOT, 'src'))
  const OWN_DIR = 'src/job-applications/'
  const ALLOWED_OUTSIDE = new Set([
    'src/app.module.ts',
    'src/prisma/prisma.service.ts',
    // 个人信息导出（PIPL 权利）必须能读到本表，这是 §4.4A 明确允许的用途。
    'src/member-privacy/member-data-export.mapper.ts',
  ])

  const touchers: string[] = []
  for (const full of files) {
    const rel = relative(API_ROOT, full).split('\\').join('/')
    if (rel.startsWith(OWN_DIR) || ALLOWED_OUTSIDE.has(rel)) continue
    if (/jobApplication\b/.test(readFileSync(full, 'utf-8'))) touchers.push(rel)
  }
  assert('本表只被自身模块、导出链路与 Prisma 委托触及', touchers.length === 0, touchers.join(', '))

  // 控制器必须只在 me/ 命名空间，且受 EndUserAuthGuard 保护
  const ctrl = read('services/api/src/job-applications/job-applications.controller.ts')
  assert('控制器路由前缀为 me/job-applications', /@Controller\('me\/job-applications'\)/.test(ctrl))
  assert('控制器受 EndUserAuthGuard 保护', /@UseGuards\(EndUserAuthGuard\)/.test(ctrl))
  assert('控制器不含 @Roles（没有 admin / partner 入口）', !/@Roles\(/.test(ctrl))

  // 不得出现任何回流 / 同步 / 企业侧命名的端点。
  // 只扫**路由路径字面量**，不整文件正则 —— 'sync' 会命中 'async'，那种写法既误报
  // 又会逼后来的人把断言删掉，比没有断言更糟。
  const routePaths = [...ctrl.matchAll(/@(?:Get|Post|Patch|Put|Delete)\(\s*'([^']*)'/g)].map((m) => m[1])
  const banned = ['webhook', 'callback', 'sync', 'employer', 'recruiter', 'candidate', 'admin', 'partner']
  for (const word of banned) {
    const hit = routePaths.filter((r) => r.toLowerCase().includes(word))
    assert(`路由中无 ${word} 相关入口`, hit.length === 0, hit.join(', '))
  }
  assert('已扫到路由路径（断言不是空跑）', routePaths.length > 0 || /@Get\(\)/.test(ctrl))

  // service 不得有按岗位 / 企业聚合的分组（重建候选人漏斗）
  const svcSrc = read('services/api/src/job-applications/job-applications.service.ts')
  // 本波 service 里**一个聚合都没有**：看板数量由前端从本人完整列表算，服务端不做
  // 分组统计。这条断言因此是负向的 —— 将来谁加了 groupBy，必须证明它不是按岗位 /
  // 企业 / 来源分组（那是候选人漏斗），且必须带 endUserId 约束。
  const groupBys = [...svcSrc.matchAll(/by:\s*\[([^\]]*)\]/g)].map((m) => m[1])
  const badGroup = groupBys.filter((g) => /jobId|companyName|sourceName/.test(g))
  assert('没有按岗位 / 企业 / 来源聚合的 groupBy', badGroup.length === 0, badGroup.join(' | '))
  for (const g of groupBys) {
    assert(`groupBy(${g.trim()}) 必须带 endUserId 约束`, /where:\s*\{\s*endUserId/.test(svcSrc))
  }
  // 服务端不提供任何对外统计端点（含只读计数）——统计面是漏斗的入口。
  assert('控制器不暴露统计 / 聚合端点',
    !/@Get\(\s*'(summary|stats|count|funnel)'/.test(ctrl))
}

// ── ⑨ 三张表未被扩状态字段 ──────────────────────────────────────────────────

function checkNoStatusLeakIntoOtherTables(): void {
  console.log('\n[5] Favorite / BrowseLog / ExternalJumpLog 未被扩出投递状态字段')
  const schema = read('services/api/prisma/schema.prisma')
  for (const model of ['Favorite', 'BrowseLog', 'ExternalJumpLog']) {
    const m = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`))
    assert(`${model} 模型存在`, m !== null)
    if (!m) continue
    const block = m[0]
    for (const field of ['applicationStatus', 'statusSource', 'appliedAt', 'jobApplicationId']) {
      assert(`${model} 未新增 ${field}`, !new RegExp(`\\b${field}\\b`).test(block))
    }
  }
}

// ── ⑩ 用户可见文案 ──────────────────────────────────────────────────────────

function checkUserFacingCopy(): void {
  console.log('\n[6] 用户可见文案：无禁词，且带诚实声明')
  // 求职进度不是独立页，是 /me/activity 的第三个 Tab（与「外部跳转记录」同页）。
  // 断言钉在这个文件上，顺带保证将来没人把它拆成新页而绕开本门禁。
  const page = read('apps/kiosk/src/pages/profile/me/MyActivityPage.tsx')
  const detail = read('apps/kiosk/src/pages/jobs/JobDetailPage.tsx')

  // 刻意**不**在这里自己实现禁词检查。
  //
  // 实测教训：本门禁最初照抄了一份禁词清单，结果把「在岗位详情页去来源平台投递后」
  // 判成违规 —— 它命中「平台投递」，但那是合规白名单文案「去来源平台投递」的一部分。
  // 唯一正确的判定在 scripts/verify-compliance-copy.mjs：它按 SSOT 的豁免标记
  // （前向回看窗口内出现「来源 / 外部 / 第三方 / 官方 / 站外」即为指向站外的合规用法）
  // 判定，并且已经全量扫 apps/kiosk/src。再抄一份只会得到第 47 份互相矛盾的清单
  // —— 那正是 verify-compliance-copy 文件头记录的、它自己被建立起来要解决的问题。
  //
  // 所以这里只断言**本能力特有**的诚实声明，禁词覆盖交给那一条。
  assert('求职进度 Tab 带「本终端不参与投递」诚实声明', page.includes('本终端不参与投递'))
  assert('求职进度 Tab 声明不掌握来源平台结果', page.includes('不掌握来源平台的处理结果'))
  assert('求职进度 Tab 声明不提供给企业或来源机构',
    page.includes('不会把这些记录提供给企业或来源机构'))
  // 前两个 Tab 原有的边界声明不得被这次合并冲掉。
  assert('浏览 / 跳转 Tab 保留原边界声明',
    page.includes('投递 / 预约结果以来源平台为准，本系统不记录'))
  assert('求职进度并入 /me/activity，未另建独立页',
    !/MyJobApplicationsPage/.test(read('apps/kiosk/src/routes/index.tsx')))
  assert('入口文案主语是用户（记录一次投递）', detail.includes('记录一次投递'))

  // 状态可达性：UI 只给一个「改为下一档」按钮，那张 NEXT_STATUS 表必须是覆盖全部
  // 五个状态的**单一循环**，否则有状态永远点不到。
  // 实测教训：初版写成 offered → intention 且 rejected 只出不进，「已拒绝」永远
  // 到不了 —— 用户被拒了记不进去，而五个 Tab 里那一个恒为空。类型系统抓不到这个。
  const cycleBody = page.match(/const NEXT_STATUS[^=]*=\s*\{([\s\S]*?)\}/)
  assert('UI 存在 NEXT_STATUS 状态推进表', cycleBody !== null)
  if (cycleBody) {
    const edges = new Map<string, string>()
    for (const m of cycleBody[1].matchAll(/(\w+)\s*:\s*'(\w+)'/g)) edges.set(m[1], m[2])
    const all = ['intention', 'applied', 'interviewing', 'offered', 'rejected']
    assert('推进表覆盖全部五个状态', all.every((k) => edges.has(k)),
      all.filter((k) => !edges.has(k)).join(', '))
    // 从任一状态出发走满 5 步，必须访问到全部五个状态（即单一循环，无不可达点）。
    const visited = new Set<string>()
    let cur = 'intention'
    for (let i = 0; i < all.length; i += 1) {
      visited.add(cur)
      cur = edges.get(cur) ?? cur
    }
    const unreachable = all.filter((k) => !visited.has(k))
    assert('每个状态都能通过点击到达（无不可达状态）',
      unreachable.length === 0, `不可达: ${unreachable.join(', ')}`)
    assert('推进表回到起点（单一循环）', cur === 'intention', `走满 5 步落在 ${cur}`)
  }
  assert('岗位详情页保留原边界声明', detail.includes('本终端不接收简历、不参与招聘流程'))
}

// ── ⑪⑫ schema 与导出 ───────────────────────────────────────────────────────

function checkSchemasAndExport(): void {
  console.log('\n[7] 两份 schema 有模型；已纳入个人信息导出')
  for (const [label, rel] of [
    ['SQLite', 'services/api/prisma/schema.prisma'],
    ['PostgreSQL', 'services/api/prisma/postgres/schema.prisma'],
  ] as const) {
    const m = read(rel).match(/model JobApplication \{[\s\S]*?\n\}/)
    assert(`${label}: 存在 model JobApplication`, m !== null)
    if (!m) continue
    for (const field of ['channel', 'statusSource', 'resumeFileId', 'consentId', 'endUserId']) {
      assert(`${label}: 含字段 ${field}`, new RegExp(`\\b${field}\\b`).test(m[0]))
    }
    assert(`${label}: 账号注销级联删除（onDelete: Cascade）`, /onDelete:\s*Cascade/.test(m[0]))
  }

  const mapper = read('services/api/src/member-privacy/member-data-export.mapper.ts')
  assert('个人信息导出包含 jobApplications 段', /jobApplications/.test(mapper))
  // 去注释再扫：注释里正是在解释「这两个字段刻意不进导出」，连注释一起扫会把说明判成违规。
  const mapperCode = mapper.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert('导出 select 不含 resumeFileId', !/resumeFileId/.test(mapperCode))
  assert('导出 select 不含 consentId', !/consentId/.test(mapperCode))
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('我的求职进度门禁 verify:job-application-track')

  await checkServerControlledFields()
  await checkEmptySlots()
  await checkOwnership()
  checkRepoStructure()
  checkNoStatusLeakIntoOtherTables()
  checkUserFacingCopy()
  checkSchemasAndExport()

  console.log(`\n结果: ${passed} PASS / ${failed} FAIL`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
