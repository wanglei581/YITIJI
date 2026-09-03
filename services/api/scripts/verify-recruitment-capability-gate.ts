// verify-recruitment-capability-gate.ts
//
// 招聘闭环能力闸门门禁：**未取得并核验人力资源服务许可证，能力一律不可用**。
//
// 为什么有这道门禁：
//   产品决策是「招聘闭环拿证后启用」。落地成代码时最省事的做法是一个默认关闭的
//   开关。这个项目已经实测过那条路的代价 —— 见 src/common/content-trust.ts 文件头：
//   `Organization.contentTrustStatus` 五个字段早就建好，注释写着「回填后再切门禁」，
//   而那句「再切门禁」从未在发布路径发生，于是被裁定「未授权不进入生产」的机构内容
//   仍然被推上了生产公网。字段建好不等于闸门装上，靠的是人不点那个按钮。
//
// 必须同时证明的事（缺一不可）：
//   ① 默认态是拒绝：没有任何许可证记录时能力不可用（fail-closed）
//   ② 七种拒绝原因逐一成立，且判定函数的返回值域被穷举覆盖
//   ③ 已核验且在有效期内时能力**可用** —— 只验拒绝等于可能把能力焊死了
//   ④ 有效期是半开区间：生效日当刻放行，失效日当刻拒绝
//   ⑤ 到期自动失效：同一条记录不做任何写操作，仅时间推进即从可用变不可用
//   ⑥ 判据模块不读 process.env —— 没有环境变量后门
//   ⑦ 判据模块不导出任何「设置 / 打开 / 切换」能力的函数 —— 它不是一个开关
//   ⑧ 全仓只有这一处判据，没有第二个地方自己判「能不能做招聘闭环」
//   ⑨ 本波下游为空：闸门零调用点 —— 这是「第 1 刀运行时零行为变化」的机器证明
//   ⑩ 受管控能力清单只含**许可证解锁类**，不含永久边界类（筛选/邀约/Offer/推荐）
//   ⑪ 两份 schema 都有 PlatformQualification 模型，且判据依赖的字段齐全
//
// 纯内存假 Prisma，不连数据库、不起 HTTP，两个 CI job 都能直接跑。
//
// Run: node -r @swc-node/register scripts/verify-recruitment-capability-gate.ts

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import {
  HR_SERVICE_LICENSE,
  LICENSE_GATED_CAPABILITIES,
  PLATFORM_QUALIFICATION_APPROVED,
  RECRUITMENT_CAPABILITY_DENIED_CODE,
  assertRecruitmentClosureLicensed,
  isRecruitmentClosureLicensed,
  qualificationDenial,
  recruitmentCapabilityDenialMessage,
  type PlatformQualificationFacts,
  type PlatformQualificationReader,
  type QualificationDenial,
} from '../src/common/recruitment-capability'

// ── harness ──────────────────────────────────────────────────────────────────

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

/** 捕获 Nest 异常里的 { error: { code, message, details } }。 */
function errorOf(e: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  const resp = (e as { getResponse?: () => unknown })?.getResponse?.()
  const err = (resp as { error?: Record<string, unknown> })?.error
  return {
    code: String(err?.['code'] ?? ''),
    message: String(err?.['message'] ?? ''),
    details: err?.['details'] as Record<string, unknown> | undefined,
  }
}

/** 内存假 Prisma：只实现闸门用到的那一个只读方法，并按 where 条件真实过滤。 */
function fakePrisma(rows: PlatformQualificationFacts[]): PlatformQualificationReader {
  return {
    platformQualification: {
      async findMany(args) {
        return rows.filter(
          (r) =>
            r.qualificationType === args.where.qualificationType &&
            r.status === args.where.status &&
            r.archivedAt === null,
        )
      },
    },
  }
}

// time-bomb-ok-file: 时间从参数注入，不读真实时钟。src/common/recruitment-capability.ts
// 的每个判定函数都以 `now: Date` 为显式参数（这是刻意设计：让「许可证到期自动失效」
// 能被时间边界用例证明），本文件所有断言都把下面这个 NOW 常量传进去。
// 因此 2027-01-01 之类的夹具日期只与 NOW 比较，相对关系不随运行日期改变。
// （由 verify:fixture-time-bombs 要求具名声明）
const NOW = new Date('2026-09-02T00:00:00.000Z')
const d = (iso: string): Date => new Date(iso)

function licenseRow(over: Partial<PlatformQualificationFacts> = {}): PlatformQualificationFacts {
  return {
    id: 'pq-1',
    qualificationType: HR_SERVICE_LICENSE,
    status: PLATFORM_QUALIFICATION_APPROVED,
    validFrom: d('2026-01-01T00:00:00.000Z'),
    validUntil: d('2029-01-01T00:00:00.000Z'),
    archivedAt: null,
    ...over,
  }
}

/** 递归收集 .ts 源文件。 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'generated' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

// ── ① 默认态是拒绝 ───────────────────────────────────────────────────────────

async function checkFailClosedDefault(): Promise<void> {
  console.log('\n[1] 默认态：没有许可证记录时能力不可用')

  assert('空集合 → isRecruitmentClosureLicensed = false', !isRecruitmentClosureLicensed([], NOW))

  for (const capability of LICENSE_GATED_CAPABILITIES) {
    let thrown: unknown = null
    try {
      await assertRecruitmentClosureLicensed(fakePrisma([]), capability, NOW)
    } catch (e) {
      thrown = e
    }
    assert(`空库：能力 ${capability} 被闸门拒绝`, thrown !== null)
    if (thrown) {
      const err = errorOf(thrown)
      assert(`空库：${capability} 错误码为 ${RECRUITMENT_CAPABILITY_DENIED_CODE}`,
        err.code === RECRUITMENT_CAPABILITY_DENIED_CODE, err.code)
      assert(`空库：${capability} 拒绝理由说明了 fail-closed`, err.message.includes('fail-closed'))
      assert(`空库：${capability} details 不泄露资质明细`,
        err.details != null && !('licenseNumber' in err.details) && !('issuerName' in err.details))
    }
  }
}

// ── ② 七种拒绝原因逐一成立 ───────────────────────────────────────────────────

async function checkEveryDenialReason(): Promise<void> {
  console.log('\n[2] 七种拒绝原因逐一成立（判定值域穷举）')

  const cases: { label: string; row: PlatformQualificationFacts; expect: QualificationDenial }[] = [
    { label: '类型不是人力资源服务许可证', row: licenseRow({ qualificationType: 'business_license' }), expect: 'wrong_type' },
    { label: '状态 pending（未核验）', row: licenseRow({ status: 'pending' }), expect: 'not_approved' },
    { label: '状态 revoked（已吊销）', row: licenseRow({ status: 'revoked' }), expect: 'not_approved' },
    { label: '已归档', row: licenseRow({ archivedAt: d('2026-08-01T00:00:00.000Z') }), expect: 'archived' },
    { label: '缺生效日期', row: licenseRow({ validFrom: null }), expect: 'valid_from_missing' },
    { label: '尚未生效', row: licenseRow({ validFrom: d('2027-01-01T00:00:00.000Z') }), expect: 'not_yet_effective' },
    { label: '缺失效日期', row: licenseRow({ validUntil: null }), expect: 'valid_until_missing' },
    { label: '已过期', row: licenseRow({ validUntil: d('2026-08-01T00:00:00.000Z') }), expect: 'expired' },
  ]

  const seen = new Set<QualificationDenial>()
  for (const c of cases) {
    const got = qualificationDenial(c.row, NOW)
    assert(`${c.label} → ${c.expect}`, got === c.expect, `实际 ${got}`)
    assert(`${c.label} 不被集合判定放行`, !isRecruitmentClosureLicensed([c.row], NOW))
    if (got) seen.add(got)
  }

  const allDenials: QualificationDenial[] = [
    'wrong_type', 'not_approved', 'archived',
    'valid_from_missing', 'not_yet_effective', 'valid_until_missing', 'expired',
  ]
  const missing = allDenials.filter((x) => !seen.has(x))
  assert('QualificationDenial 值域被用例全覆盖', missing.length === 0, `未覆盖 ${missing.join(', ')}`)

  // 拒绝理由要说清怎么办，且明确「不是开关」。
  const msg = recruitmentCapabilityDenialMessage(
    LICENSE_GATED_CAPABILITIES[0], [licenseRow({ validUntil: d('2026-08-01T00:00:00.000Z') })], NOW)
  assert('拒绝理由点名「已过期」', msg.includes('已过期'))
  assert('拒绝理由说明解锁方式不是打开开关', msg.includes('不是打开开关'))
}

// ── ③ 不能焊死：合规记录必须放行 ─────────────────────────────────────────────

async function checkUnlockable(): Promise<void> {
  console.log('\n[3] 闸门可解锁：已核验且在有效期内时能力可用')

  assert('合规记录 → isRecruitmentClosureLicensed = true',
    isRecruitmentClosureLicensed([licenseRow()], NOW))

  for (const capability of LICENSE_GATED_CAPABILITIES) {
    let thrown: unknown = null
    try {
      await assertRecruitmentClosureLicensed(fakePrisma([licenseRow()]), capability, NOW)
    } catch (e) {
      thrown = e
    }
    assert(`合规记录：能力 ${capability} 放行`, thrown === null,
      thrown ? errorOf(thrown).message : undefined)
  }

  // 一堆坏记录里混一条好记录 —— 应当放行（判据是「存在」，不是「全部」）。
  const mixed = [
    licenseRow({ id: 'bad-1', status: 'pending' }),
    licenseRow({ id: 'bad-2', validUntil: d('2026-08-01T00:00:00.000Z') }),
    licenseRow({ id: 'good' }),
  ]
  assert('多条记录中存在一条有效即放行', isRecruitmentClosureLicensed(mixed, NOW))
}

// ── ④ 有效期是半开区间 ───────────────────────────────────────────────────────

async function checkBoundaries(): Promise<void> {
  console.log('\n[4] 有效期半开区间 [validFrom, validUntil)')

  assert('生效日当刻：放行',
    qualificationDenial(licenseRow({ validFrom: NOW }), NOW) === null)
  assert('生效日前 1 毫秒：拒绝',
    qualificationDenial(licenseRow({ validFrom: new Date(NOW.getTime() + 1) }), NOW) === 'not_yet_effective')
  assert('失效日当刻：拒绝',
    qualificationDenial(licenseRow({ validUntil: NOW }), NOW) === 'expired')
  assert('失效日前 1 毫秒：放行',
    qualificationDenial(licenseRow({ validUntil: new Date(NOW.getTime() + 1) }), NOW) === null)
}

// ── ⑤ 到期自动失效 ───────────────────────────────────────────────────────────

async function checkAutoExpiry(): Promise<void> {
  console.log('\n[5] 到期自动失效：不做任何写操作，仅时间推进即失效')

  const row = licenseRow({ validUntil: d('2026-12-31T00:00:00.000Z') })
  const before = d('2026-12-30T23:59:59.000Z')
  const after = d('2026-12-31T00:00:00.001Z')

  assert('到期前：可用', isRecruitmentClosureLicensed([row], before))
  assert('到期后：不可用（同一条记录，未做任何写操作）', !isRecruitmentClosureLicensed([row], after))

  let thrown: unknown = null
  try {
    await assertRecruitmentClosureLicensed(fakePrisma([row]), LICENSE_GATED_CAPABILITIES[0], after)
  } catch (e) {
    thrown = e
  }
  assert('到期后闸门抛出拒绝', thrown !== null)
  assert('到期后拒绝理由为「已过期」', thrown !== null && errorOf(thrown).message.includes('已过期'))
}

// ── ⑥⑦ 判据模块的自我约束 ───────────────────────────────────────────────────

function checkModuleSelfConstraints(): void {
  console.log('\n[6] 判据模块：无环境变量后门，不是开关')

  const rel = 'services/api/src/common/recruitment-capability.ts'
  const src = read(rel)
  // 去掉注释再扫，避免把本文件里解释「不读 env」的说明文字当成违规。
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  assert('模块不读取 process.env', !/process\.env/.test(code))
  assert('模块不引用任何 *_ENABLED 环境变量名', !/[A-Z_]+_ENABLED/.test(code))

  const exported = [...src.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1])
  const setters = exported.filter((n) => /^(set|enable|disable|toggle|open|unlock|grant)/i.test(n))
  assert('模块不导出任何设置 / 打开 / 切换能力的函数',
    setters.length === 0, setters.join(', '))
  assert('模块导出了判定函数', exported.includes('qualificationDenial') && exported.includes('isRecruitmentClosureLicensed'))

  // now 必须是入参而不是模块内部取 —— 否则「到期自动失效」无法被证明。
  assert('判定不在模块内部取当前时间（now 由调用方注入）', !/new Date\(\)|Date\.now\(\)/.test(code))
}

// ── ⑧⑨ 仓库层：唯一判据，且本波零调用点 ─────────────────────────────────────

function checkRepoInventory(): void {
  console.log('\n[7] 仓库层：唯一判据，本波下游为空')

  const moduleRel = 'src/common/recruitment-capability.ts'
  const files = walk(join(API_ROOT, 'src'))

  const callers: string[] = []
  for (const full of files) {
    const rel = relative(API_ROOT, full).split('\\').join('/')
    if (rel === moduleRel) continue
    const src = readFileSync(full, 'utf-8')
    if (/assertRecruitmentClosureLicensed|isRecruitmentClosureLicensed|qualificationDenial/.test(src)) {
      callers.push(rel)
    }
  }
  assert('第 1 刀承诺：闸门零调用点，运行时行为不变',
    callers.length === 0, callers.join(', '))

  // 没有第二处自己判「能不能做招聘闭环」的地方：任何读 platformQualification 的
  // 源文件都必须是判据模块本身，否则就是绕过判据直接查表。
  const directReaders: string[] = []
  for (const full of files) {
    const rel = relative(API_ROOT, full).split('\\').join('/')
    if (rel === moduleRel) continue
    if (/platformQualification/.test(readFileSync(full, 'utf-8'))) directReaders.push(rel)
  }
  assert('没有绕过判据直接查 platformQualification 的源文件',
    directReaders.length === 0, directReaders.join(', '))
}

// ── ⑩ 能力清单只含许可证解锁类 ───────────────────────────────────────────────

function checkCapabilityList(): void {
  console.log('\n[8] 受管控能力清单：只含许可证解锁类')

  // 这四类与许可证无关，是产品定位选择，拿证后同样不做（见分期方案 §7）。
  // 它们一旦出现在清单里，等于暗示「拿证就能做」，与长期边界矛盾。
  const permanentlyOutOfScope = ['candidate_screening', 'interview_invitation', 'offer_management', 'candidate_recommendation']
  const leaked = LICENSE_GATED_CAPABILITIES.filter((c) =>
    permanentlyOutOfScope.some((p) => String(c).includes(p)))
  assert('清单不含永久边界类能力（筛选 / 邀约 / Offer / 推荐）',
    leaked.length === 0, leaked.join(', '))
  assert('清单非空且每项都是非空字符串',
    LICENSE_GATED_CAPABILITIES.length > 0 && LICENSE_GATED_CAPABILITIES.every((c) => typeof c === 'string' && c.length > 0))
}

// ── ⑪ 两份 schema 都有模型且字段齐全 ────────────────────────────────────────

function checkSchemas(): void {
  console.log('\n[9] 两份 schema 都有 PlatformQualification 且字段齐全')

  const required = ['qualificationType', 'status', 'validFrom', 'validUntil', 'archivedAt']
  for (const [label, rel] of [
    ['SQLite', 'services/api/prisma/schema.prisma'],
    ['PostgreSQL', 'services/api/prisma/postgres/schema.prisma'],
  ] as const) {
    const schema = read(rel)
    const m = schema.match(/model PlatformQualification \{[\s\S]*?\n\}/)
    assert(`${label}: 存在 model PlatformQualification`, m !== null)
    if (!m) continue
    const block = m[0]
    for (const field of required) {
      assert(`${label}: 含判据字段 ${field}`, new RegExp(`\\b${field}\\b`).test(block))
    }
    // 复用 QualificationRecord 会把平台自身塞进机构维度 —— 分表的理由，钉死在门禁里。
    assert(`${label}: 不挂 organizationId（平台自身不是一条来源机构）`,
      !/\borganizationId\b/.test(block))
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('招聘闭环能力闸门门禁 verify:recruitment-capability-gate')

  await checkFailClosedDefault()
  await checkEveryDenialReason()
  await checkUnlockable()
  await checkBoundaries()
  await checkAutoExpiry()
  checkModuleSelfConstraints()
  checkRepoInventory()
  checkCapabilityList()
  checkSchemas()

  console.log(`\n结果: ${passed} PASS / ${failed} FAIL`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
