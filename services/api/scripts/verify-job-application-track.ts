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

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
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

  // 最关键的一条注入测试：直接给 service 喂 channel / statusSource。
  // DTO 白名单只挡得住 HTTP 入参，挡不住 service 被内部调用方喂值；而
  // 「恒为常量」如果只在不传的快乐路径上验，改成
  // `channel: input.channel ?? SELF_REPORTED_CHANNEL` 之后断言照样绿。
  // 无证期这两个值必须无视任何输入。
  const injected = await svc.create(ME, {
    jobId: 'job-live',
    channel: 'platform',
    statusSource: 'employer_feedback',
    resumeFileId: 'file-should-be-ignored',
    consentId: 'consent-should-be-ignored',
  } as never)
  assert('注入 channel=platform 被无视，仍为站外自报',
    injected.channel === SELF_REPORTED_CHANNEL, String(injected.channel))
  assert('注入 statusSource=employer_feedback 被无视，仍为用户自填',
    injected.statusSource === SELF_REPORTED_STATUS_SOURCE, String(injected.statusSource))
  const injectedRow = rows.find((r) => r.id === injected.id)
  assert('注入的 resumeFileId 未落库', injectedRow?.['resumeFileId'] === undefined)
  assert('注入的 consentId 未落库', injectedRow?.['consentId'] === undefined)

  // 同样喂给 update：改状态的路径也不能被顺带改掉来源。
  const afterUpdate = await svc.update(ME, injected.id, {
    status: 'applied',
    statusSource: 'employer_feedback',
    channel: 'platform',
  } as never)
  assert('update 注入 statusSource 被无视',
    afterUpdate.statusSource === SELF_REPORTED_STATUS_SOURCE, String(afterUpdate.statusSource))
  assert('update 注入 channel 被无视',
    afterUpdate.channel === SELF_REPORTED_CHANNEL, String(afterUpdate.channel))

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

  // 顺序很重要：必须在**两条都还在**的时候查他人列表。
  // 若先删掉本人那条再查，库里只剩一条，list 就算完全不按 endUserId 过滤也会绿。
  const otherList = await svc.list(OTHER, PAGE)
  assert('他人列表只看得到他人自己的记录（此时本人记录仍在库）',
    otherList.items.length === 1 && otherList.items[0].companyName === '别人的公司',
    JSON.stringify(otherList.items.map((i) => i.companyName)))
  assert('查他人列表时本人记录确实还在库（证明上一条不是空跑）',
    rows.some((r) => r.id === mine.id))

  const mineDel = await svc.remove(ME, mine.id)
  assert('删本人记录生效', mineDel.removed === true)
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

  // ── 自身目录：只许有这几个文件，且只许有一个控制器 ──────────────────────
  //
  // 早期版本对整个 src/job-applications/ 免检、只钉死 job-applications.controller.ts
  // 一份文件。于是在同目录新增 job-applications.admin.controller.ts 并挂进模块，
  // 就能对外读写甚至接第三方回流，而三条断言全绿 —— 那正是把记事本做成招聘闭环
  // 最自然的写法。改为枚举整个目录。
  const ownFiles = files
    .map((f) => relative(API_ROOT, f).split('\\').join('/'))
    .filter((r) => r.startsWith(OWN_DIR))
    .sort()
  const EXPECTED_OWN = [
    'src/job-applications/dto/create-job-application.dto.ts',
    'src/job-applications/dto/update-job-application.dto.ts',
    'src/job-applications/job-application.types.ts',
    'src/job-applications/job-applications.controller.ts',
    'src/job-applications/job-applications.module.ts',
    'src/job-applications/job-applications.service.ts',
  ]
  const unexpected = ownFiles.filter((r) => !EXPECTED_OWN.includes(r))
  assert('模块目录内没有计划外文件（新增控制器 / 服务必须先改本门禁）',
    unexpected.length === 0, unexpected.join(', '))
  const missing = EXPECTED_OWN.filter((r) => !ownFiles.includes(r))
  assert('模块目录内预期文件齐全（断言不是因为路径写错而空跑）',
    missing.length === 0, missing.join(', '))

  const mod = read('services/api/src/job-applications/job-applications.module.ts')
  const ctrlList = mod.match(/controllers:\s*\[([^\]]*)\]/)
  assert('模块只注册一个控制器',
    ctrlList !== null && ctrlList[1].split(',').filter((x) => x.trim()).length === 1,
    ctrlList?.[1] ?? '未找到 controllers 数组')

  // ── 控制器：命名空间、守卫、路由词表 ────────────────────────────────────
  const ctrl = read('services/api/src/job-applications/job-applications.controller.ts')
  assert('控制器路由前缀为 me/job-applications', /@Controller\('me\/job-applications'\)/.test(ctrl))
  assert('控制器受 EndUserAuthGuard 保护', /@UseGuards\(EndUserAuthGuard\)/.test(ctrl))
  assert('控制器不含 @Roles（没有 admin / partner 入口）', !/@Roles\(/.test(ctrl))

  // 路由词表：单双引号与反引号都认，@All 也认 —— 只认单引号 @Get 的话，
  // @Post("webhook") / @All('callback') 都能溜过去。
  const routeDecorators = [...ctrl.matchAll(/@(All|Get|Post|Patch|Put|Delete)\(\s*(['"`])([^'"`]*)\2/g)]
  const routePaths = routeDecorators.map((m) => m[3])
  const argless = [...ctrl.matchAll(/@(All|Get|Post|Patch|Put|Delete)\(\s*\)/g)].length
  // 每个路由方法都必须被上面两种形态之一覆盖，否则说明有写法没被扫到。
  const totalRouteDecorators = [...ctrl.matchAll(/@(All|Get|Post|Patch|Put|Delete)\(/g)].length
  assert('路由装饰器全部被扫描覆盖（无遗漏写法）',
    routePaths.length + argless === totalRouteDecorators,
    `扫到 ${routePaths.length} 带路径 + ${argless} 无参，总共 ${totalRouteDecorators}`)
  assert('控制器确实存在路由（断言不是空跑）', totalRouteDecorators > 0)

  const banned = ['webhook', 'callback', 'sync', 'employer', 'recruiter', 'candidate',
    'admin', 'partner', 'summary', 'stats', 'count', 'funnel', 'export', 'by-job', 'by-company']
  for (const word of banned) {
    const hit = routePaths.filter((r) => r.toLowerCase().includes(word))
    assert(`路由中无 ${word} 相关入口`, hit.length === 0, hit.join(', '))
  }

  // ── 核心不变量：对 JobApplication 的每一次查询都必须按人收窄 ─────────────
  //
  // 这条取代了原先「找 groupBy、看它是不是按企业分组」的写法。原写法有两个洞：
  // service 里一个 groupBy 都没有时它恒真；而 count({ where: { jobId } })、
  // findMany({ where: { companyName } }) 同样是候选人漏斗，却根本不叫 groupBy。
  // 与其枚举坏写法（永远列不全），不如断言好性质：**没有任何一次查询是跨用户的**。
  const QUERY_SCOPED = ['findMany', 'findFirst', 'findUnique', 'count', 'groupBy', 'aggregate',
    'updateMany', 'deleteMany', 'createMany', 'upsert']
  const ROW_SCOPED = ['update', 'delete']   // 单行、按唯一 id，靠前置归属校验
  const CREATE = ['create']

  const scanned: string[] = []
  for (const rel of [...EXPECTED_OWN, 'src/member-privacy/member-data-export.mapper.ts']) {
    const src = readFileSync(join(API_ROOT, rel), 'utf-8')
    for (const m of src.matchAll(/prisma\.jobApplication\.(\w+)\(/g)) {
      const method = m[1]
      const arg = balanced(src, m.index! + m[0].length - 1)
      const where = resolveClause(src, m.index!, arg, 'where')
      const data = resolveClause(src, m.index!, arg, 'data')
      const label = `${rel.split('/').pop()}:${method}`
      scanned.push(label)

      if (QUERY_SCOPED.includes(method)) {
        assert(`${label} 的 where 按 endUserId 收窄`, /\bendUserId\b/.test(where), where.slice(0, 90))
      } else if (CREATE.includes(method)) {
        assert(`${label} 的 data 写入 endUserId`, /\bendUserId\b/.test(data), data.slice(0, 90))
      } else if (ROW_SCOPED.includes(method)) {
        // 单行写：where 用唯一 id，归属靠同一函数体里的前置校验。
        const before = src.slice(Math.max(0, m.index! - 1600), m.index!)
        assert(`${label} 之前有按 endUserId 的归属校验`,
          /findFirst\(\{[\s\S]{0,120}?endUserId/.test(before))
      } else {
        assert(`${label} 是未登记的 Prisma 方法（必须先在门禁里裁定）`, false, method)
      }
    }
  }
  assert('确实扫到了查询调用（断言不是空跑）', scanned.length >= 6, scanned.join(', '))

  // ── 两个白名单文件：只许各自的用途，不许夹带 ────────────────────────────
  const prismaSvc = read('services/api/src/prisma/prisma.service.ts')
  const delegateOnly = prismaSvc.match(/get jobApplication\(\)\s*\{\s*return this\.client\.jobApplication\s*\}/)
  assert('prisma.service 只暴露 jobApplication 委托，不在其上做查询', delegateOnly !== null)
  assert('prisma.service 未对 jobApplication 直接发起调用',
    !/this\.client\.jobApplication\.\w+\(/.test(prismaSvc))

  const mapper = read('services/api/src/member-privacy/member-data-export.mapper.ts')
  const mapperCalls = [...mapper.matchAll(/prisma\.jobApplication\.(\w+)\(/g)].map((m) => m[1])
  assert('导出链路只读不写', mapperCalls.every((m) => m === 'findMany'), mapperCalls.join(', '))
}

/** 从 openIdx 处的 '(' 起取平衡括号内的文本。 */
function balanced(src: string, openIdx: number): string {
  let depth = 0
  for (let i = openIdx; i < src.length; i += 1) {
    const c = src[i]
    if (c === '(' || c === '{' || c === '[') depth += 1
    else if (c === ')' || c === '}' || c === ']') {
      depth -= 1
      if (depth === 0) return src.slice(openIdx + 1, i)
    }
  }
  return src.slice(openIdx + 1, Math.min(src.length, openIdx + 600))
}

/** 取对象字面量里某个键的值（平衡括号）。找不到返回空串。 */
function sliceKey(objText: string, key: string): string {
  const i = objText.search(new RegExp(`\\b${key}\\s*:`))
  if (i === -1) return ''
  const brace = objText.indexOf('{', i)
  if (brace === -1) return objText.slice(i, i + 160)
  return balanced(objText, brace)
}

/**
 * 取调用参数里某个子句的文本，**跟一层局部变量**。
 *
 * 三种写法都要认，否则会把合规代码判成违规：
 *   findMany({ where: { endUserId } })   直接字面量
 *   findMany({ where })                  简写，指向局部 const where = { endUserId }
 *   findMany({ where: scoped })          具名变量
 *
 * 只跟一层、且只在调用点之前的同文件范围内找 —— 再深就不是静态断言能保证的了，
 * 那时应该让写代码的人把 where 内联回调用点，而不是让门禁去猜。
 */
function resolveClause(src: string, callIdx: number, arg: string, key: string): string {
  const direct = sliceKey(arg, key)
  if (direct.trim()) return direct

  // 具名变量：`key: ident`
  const named = arg.match(new RegExp(`\\b${key}\\s*:\\s*([A-Za-z_$][\\w$]*)`))
  // 简写：`{ ..., key, ... }` —— key 后面直接跟逗号或右括号
  const shorthand = new RegExp(`(^|[,{\\s])${key}\\s*(,|$|\\})`).test(arg)
  const ident = named?.[1] ?? (shorthand ? key : null)
  if (!ident) return ''

  const before = src.slice(0, callIdx)
  const decl = before.lastIndexOf(`const ${ident} =`)
  if (decl === -1) return ''
  const brace = before.indexOf('{', decl)
  if (brace === -1) return ''
  return balanced(before, brace)
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
    for (const field of ['applicationStatus', 'statusSource', 'selfReportedAt', 'jobApplicationId']) {
      assert(`${model} 未新增 ${field}`, !new RegExp(`\\b${field}\\b`).test(block))
    }
  }
}

// ── ⑩ 用户可见文案 ──────────────────────────────────────────────────────────

function checkUserFacingCopy(): void {
  console.log('\n[6] 前端面：本波刻意不接 Kiosk 运行时')

  // 本波**只交付后端与判据**，Kiosk 运行时不接入。原因不是做不动，是那片是冻结区：
  //   - verify-fusion-w5 对 profileEntries.ts 逐字节冻结
  //   - verify-user-center-wave0 硬断言 Profile 恰好 22 个已接真目的地（Wave 0 产品决策）
  //   - verify-profile-inkpaper-home 断言 me-detail-inkpaper.css 的 import 集合封闭
  // 加第 23 个入口是改产品范围，需要产品负责人授权，不是工程侧能自行决定的。
  // 且负责人已定性当前运行时 UI 后续替换为新 UI（docs/design/kiosk-redesign-2026-08）。
  //
  // 因此这里断言的是「前端面确实是空的」—— 防的是有人以为已经接好了，
  // 或者在冻结区偷偷加入口而不走授权。前端接入时把本函数改成真实的文案断言。
  const kioskTouched = [
    'apps/kiosk/src/pages/profile/profileEntries.ts',
    'apps/kiosk/src/pages/profile/me/MyActivityPage.tsx',
    'apps/kiosk/src/pages/jobs/JobDetailPage.tsx',
  ]
  for (const rel of kioskTouched) {
    const src = read(rel)
    assert(`${rel.split('/').pop()} 未接入求职进度（冻结区保持原状）`,
      !/job-applications|JobApplication|求职进度/.test(src))
  }
  assert('Kiosk 尚无求职进度 API 客户端',
    !existsSync(join(REPO_ROOT, 'apps/kiosk/src/services/api/jobApplications.ts')))

  // 后端错误文案同样受合规约束：不得出现暗示平台参与投递的措辞。
  const svcSrc = read('services/api/src/job-applications/job-applications.service.ts')
  const messages = [...svcSrc.matchAll(/message:\s*'([^']*)'/g)].map((m) => m[1])
  assert('服务端错误文案已扫到（断言不是空跑）', messages.length >= 3, String(messages.length))
  for (const msg of messages) {
    assert(`错误文案「${msg.slice(0, 16)}…」不含平台投递措辞`,
      !/一键投递|立即投递|平台投递|投递简历|企业收简历|候选人管理/.test(msg))
  }
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
  // 只查「有没有这个字符串」锁不住任何东西：导出必须是按本人过滤的。
  // 具体的 where 收窄由 [4] 的查询不变量逐调用点断言，这里再钉一次形状。
  assert('导出对 jobApplication 的查询按 endUserId 过滤',
    /jobApplication\.findMany\(\{[\s\S]{0,120}?where:\s*\{\s*endUserId/.test(mapper))
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
