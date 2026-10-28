/**
 * verify:license（上半）—— 授权状态推导与契约，不连数据库、不起服务。
 *
 *   1. 契约：shared 与 API 本地副本一致；License 模型没有任何与岗位 / 招聘会 / 浏览 / 投递挂钩的列（红线）；
 *      两套 Prisma schema 一致；迁移里的 CHECK 兜底在。
 *   2. 状态推导（唯一一个函数）逐态、逐边界：none 不管控；required 下 ok / grace / expired / suspended / unlicensed；
 *      未来生效的不算当前；到期当刻、宽限最后一毫秒、宽限 0 天；首尾相接的续期不断档；暂停 > 宽限；台数口径。
 *   3. 机构后台写操作的拦截规则：对真实路由表做派生扫描——/partner/ 下每一个写接口要么被拦、要么在登记表里并写明理由；
 *      登记表**逐条**是 (方法, 路由, 处理函数)，没有前缀通配；逐条核对登记的处理函数与真实路由的装饰器一致，
 *      「下架 / 删除 / 归档」类要真的叫这个名字、「只算不存」类要真的叫预览 / 预检；登记表没有过期条目；
 *      机构的写接口不许落在 /partner/ 之外（拦截器管不到）。
 *   2b. 北京时间的含到期日口径：startsOn / endsOn → 存库起止时刻、periodText、边界毫秒（到期日当天 23:59:59.999 北京仍在期内）。
 *   4. 管控点的位置：只拦新会话签发（换票、续期），不拦 createBootTicket / 已签发会话校验 / 终端心跳与上报。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:license
 */
import 'reflect-metadata'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { ROLES_KEY } from '../src/common/decorators/roles.decorator'
import { normalizeCreditCode } from '../src/licenses/credit-code'
import { checkPeriod, dayEnd, dayStart, licenseDay, period } from '../src/licenses/license-input'
import {
  DAY_MS,
  bindingQuota,
  continuousCoverageEnd,
  graceEndsAt,
  kioskLicenseState,
  licensePhase,
  resolveOrgLicense,
  type LicenseWindow,
} from '../src/licenses/license-state'
import { beijingDateOf, beijingDayStart, inclusiveDayText, lastDayOf, periodText } from '../src/licenses/license-time'
import * as local from '../src/licenses/license.types'
import {
  PARTNER_WRITE_EXEMPTIONS,
  findPartnerWriteExemption,
  normalizeRoutePath,
  partnerWriteIsBlocked,
} from '../src/licenses/partner-write-policy'
import * as shared from '../../../packages/shared/src/types/license'
import { Checker } from './support/branding-license-support'

const API_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(API_ROOT, '../..')
const c = new Checker()

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function interfaceFields(source: string, name: string): string[] {
  const match = source.match(new RegExp(`export interface ${name}(?: extends [A-Za-z]+)? \\{([\\s\\S]*?)\\n\\}`))
  if (!match) return []
  return [...(match[1] ?? '').matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]!).sort()
}

/** 迁移只许建表、加列、建索引：去掉注释与外键的 ON DELETE / ON UPDATE 子句后，不得出现 DROP / DELETE / UPDATE / RENAME。 */
function isAdditive(sql: string): boolean {
  const code = sql.replace(/--.*$/gm, '').replace(/\bON (DELETE|UPDATE) (CASCADE|RESTRICT|SET NULL|NO ACTION)\b/gi, '')
  return !/\b(DROP|DELETE|UPDATE|RENAME|TRUNCATE)\b/i.test(code)
}

function modelFields(schema: string, model: string): string[] {
  const start = schema.indexOf(`model ${model} {`)
  const end = schema.indexOf('\n}', start)
  const body = schema.slice(start, end)
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[a-zA-Z]\w*\s+\S+/.test(line) && !line.startsWith('//') && !line.startsWith('@@') && !line.startsWith('model '))
    .map((line) => line.split(/\s+/)[0]!)
}

// ── 夹具：一条授权 ─────────────────────────────────────────────────────────

const T0 = Date.parse('2026-11-01T00:00:00.000Z')
let seq = 0
function lic(over: Partial<LicenseWindow> & { startDays?: number; endDays?: number } = {}): LicenseWindow {
  seq += 1
  return {
    id: over.id ?? `L${String(seq).padStart(2, '0')}`,
    status: over.status ?? 'active',
    startsAt: over.startsAt ?? new Date(T0 + (over.startDays ?? 0) * DAY_MS),
    endsAt: over.endsAt ?? new Date(T0 + (over.endDays ?? 30) * DAY_MS),
    graceDays: over.graceDays ?? 7,
    terminalQuota: over.terminalQuota ?? 5,
    createdAt: over.createdAt ?? new Date(T0 - 1000 * (100 - seq)),
  }
}
const at = (ms: number) => new Date(ms)
const resolveAt = (mode: string, licenses: LicenseWindow[], ms: number) => resolveOrgLicense({ mode, licenses, now: at(ms) })

function assertContract(): void {
  console.log('\n[1] 契约与红线')
  for (const name of [
    'LICENSE_MODES', 'LICENSE_STATUSES', 'ORG_LICENSE_STATES', 'LICENSE_PHASES',
    'LICENSE_DEFAULT_GRACE_DAYS', 'LICENSE_MAX_GRACE_DAYS', 'LICENSE_MAX_TERMINAL_QUOTA', 'LICENSE_WARN_DAYS',
    'LICENSE_REASON_MIN_LENGTH', 'LICENSE_REASON_MAX_LENGTH', 'LICENSE_TICKET_NO_MAX_LENGTH', 'LICENSE_TICKET_NO_PATTERN', 'LICENSE_CONTRACT_NO_MAX_LENGTH',
  ] as const) {
    c.equal(`shared 与 API 副本一致：${name}`, (local as Record<string, unknown>)[name], (shared as Record<string, unknown>)[name])
  }
  const sharedSource = read(join(REPO_ROOT, 'packages/shared/src/types/license.ts'))
  const localSource = read(join(API_ROOT, 'src/licenses/license.types.ts'))
  const interfaces = [
    'LicenseView', 'OrgLicenseOverview', 'OrgLicenseDetail', 'LicenseMutationResult', 'LicenseAttention', 'PartnerLicenseView',
    'CreateLicenseInput', 'UpdateLicenseInput', 'RenewLicenseInput', 'LicenseStatusChangeInput', 'LicenseResumeInput', 'SetLicenseModeInput',
  ]
  for (const name of interfaces) {
    const a = interfaceFields(sharedSource, name)
    c.check(`shared 与 API 副本字段一致：${name}`, a.length > 0 && JSON.stringify(a) === JSON.stringify(interfaceFields(localSource, name)), `${a}`)
  }
  // 两条界面线按这份契约做界面：字段清单钉死成显式数组，谁改了字段，这里先红。
  const pinned: Record<string, string[]> = {
    CreateLicenseInput: ['contractNo', 'creditCode', 'endsOn', 'graceDays', 'licenseeName', 'note', 'startsOn', 'terminalQuota'],
    UpdateLicenseInput: ['contractNo', 'creditCode', 'endsOn', 'graceDays', 'licenseeName', 'note', 'reason', 'startsOn', 'terminalQuota', 'version'],
    RenewLicenseInput: ['contractNo', 'creditCode', 'endsOn', 'graceDays', 'licenseeName', 'note', 'startsOn', 'terminalQuota'],
    LicenseStatusChangeInput: ['approvalTicketNo', 'reason', 'version'],
    LicenseResumeInput: ['reason', 'version'],
    SetLicenseModeInput: ['confirmLockout', 'licenseMode', 'reason'],
    LicenseView: [
      'contractNo', 'createdAt', 'createdBy', 'creditCode', 'endsAt', 'endsOn', 'graceDays', 'graceEndsAt', 'graceEndsOn', 'id', 'licenseeName', 'note',
      'orgId', 'periodText', 'phase', 'startsAt', 'startsOn', 'status', 'statusChangedAt', 'statusChangedBy', 'statusReason', 'statusTicketNo',
      'terminalQuota', 'updatedAt', 'updatedBy', 'version',
    ],
    OrgLicenseOverview: [
      'coveredUntil', 'coveredUntilOn', 'current', 'daysLeft', 'licenseMode', 'managed', 'orgId', 'orgName', 'overQuota', 'state',
      'terminalQuota', 'terminalsBound', 'upcoming', 'usable',
    ],
  }
  for (const [name, expected] of Object.entries(pinned)) {
    c.equal(`接口字段钉死：${name}`, interfaceFields(sharedSource, name), expected)
  }
  c.check('请求体里没有 startsAt / endsAt / ticketNo（旧字段全部退场）',
    !['CreateLicenseInput', 'UpdateLicenseInput', 'RenewLicenseInput', 'LicenseStatusChangeInput', 'LicenseResumeInput', 'SetLicenseModeInput']
      .some((name) => interfaceFields(sharedSource, name).some((field) => ['startsAt', 'endsAt', 'ticketNo'].includes(field))))
  c.check('PartnerLicenseView 的 current / upcoming 都带 startsOn / endsOn / periodText / graceEndsOn',
    (sharedSource.match(/startsOn: string\n\s+endsOn: string\n\s+periodText: string/g) ?? []).length === 2 && (sharedSource.match(/graceEndsOn: string \| null/g) ?? []).length >= 3)
  c.equal('授权方式只有 none / required', [...local.LICENSE_MODES], ['none', 'required'])
  c.equal('机构状态五态', [...local.ORG_LICENSE_STATES], ['ok', 'grace', 'expired', 'suspended', 'unlicensed'])
  c.equal('默认宽限 7 天、上限 30 天、台数上限 10000', [local.LICENSE_DEFAULT_GRACE_DAYS, local.LICENSE_MAX_GRACE_DAYS, local.LICENSE_MAX_TERMINAL_QUOTA], [7, 30, 10000])
  c.equal('到期前提醒 30 / 7 / 1 天', [...local.LICENSE_WARN_DAYS], [30, 7, 1])
  c.equal('理由 2–200 字；工单号 1–64 位且只许字母数字 - _ /；合同编号 1–64 位', [
    local.LICENSE_REASON_MIN_LENGTH, local.LICENSE_REASON_MAX_LENGTH, local.LICENSE_TICKET_NO_MAX_LENGTH, local.LICENSE_TICKET_NO_PATTERN, local.LICENSE_CONTRACT_NO_MAX_LENGTH,
  ], [2, 200, 64, '^[A-Za-z0-9_/-]+$', 64])

  const schema = read(join(API_ROOT, 'prisma/schema.prisma'))
  const pgSchema = read(join(API_ROOT, 'prisma/postgres/schema.prisma'))
  const fields = modelFields(schema, 'License')
  c.equal('License 表的列固定（授权主体、期限、台数、状态、审计）', fields, [
    'id', 'orgId', 'org', 'licenseeName', 'creditCode', 'contractNo', 'startsAt', 'endsAt', 'terminalQuota', 'graceDays', 'status',
    'note', 'statusReason', 'statusTicketNo', 'statusChangedAt', 'statusChangedBy', 'createdBy', 'updatedBy', 'version', 'createdAt', 'updatedAt',
  ])
  // 红线：授权只按期限与终端台数，不得与岗位、招聘会、浏览、投递、入职挂钩（CLAUDE.md §1）
  const FORBIDDEN = /job|fair|resume|apply|appl[iy]|deliver|browse|view|click|candidate|offer|interview|hire|recruit|headcount|position|岗位|招聘|投递|入职|浏览/i
  const all = [
    ...fields,
    ...interfaceFields(sharedSource, 'LicenseView'), ...interfaceFields(sharedSource, 'CreateLicenseInput'),
    ...interfaceFields(sharedSource, 'UpdateLicenseInput'), ...interfaceFields(sharedSource, 'RenewLicenseInput'),
    ...interfaceFields(sharedSource, 'OrgLicenseOverview'), ...interfaceFields(sharedSource, 'PartnerLicenseView'),
  ]
  c.check('红线：授权的列与接口字段里没有任何与岗位 / 招聘会 / 浏览 / 投递 / 入职挂钩的名字', !all.some((name) => FORBIDDEN.test(name)), all.filter((n) => FORBIDDEN.test(n)).join(','))
  c.check('License 与 Organization.licenseMode 在 PG schema 里逐字同步', pgSchema.includes(schema.slice(schema.indexOf('model License {'), schema.indexOf('\n}', schema.indexOf('model License {')))))
  c.check('Organization 带 licenseMode，默认 none', /licenseMode String @default\("none"\)/.test(schema))
  for (const [label, dir] of [['SQLite', 'prisma/migrations'], ['PostgreSQL', 'prisma/postgres/migrations']] as const) {
    const sql = read(join(API_ROOT, dir, '20261028230100_license/migration.sql'))
    c.check(`${label} 迁移：licenseMode 默认 none 且有 CHECK（已有机构全部不管控）`,
      /"licenseMode" TEXT NOT NULL DEFAULT 'none'/.test(sql) && /"licenseMode" IN \('none', 'required'\)/.test(sql))
    c.check(`${label} 迁移：License 的状态 / 台数 / 宽限 / 期限 CHECK 兜底`,
      /"status" IN \('active', 'suspended', 'revoked'\)/.test(sql) && /"terminalQuota" >= 1 AND "terminalQuota" <= 10000/.test(sql) &&
      /"graceDays" >= 0 AND "graceDays" <= 30/.test(sql) && /"endsAt" > "startsAt"/.test(sql))
    c.check(`${label} 迁移：License.version 默认 1 且有 CHECK >= 1（乐观版本）`, /"version" INTEGER NOT NULL DEFAULT 1/.test(sql) && /CHECK \("version" >= 1\)/.test(sql))
    c.check(`${label} 迁移：纯加性（没有 DROP / DELETE / UPDATE / 改列）`, isAdditive(sql))
    const branding = read(join(API_ROOT, dir, '20261028230000_organization_branding/migration.sql'))
    c.check(`${label} 迁移：贴牌迁移纯加性`, isAdditive(branding))
  }
  const dirs = readdirSync(join(API_ROOT, 'prisma/migrations')).filter((d) => /^\d{14}_/.test(d)).sort()
  c.check('迁移目录时间戳晚于两个后台线占用的 20261028120000', ['20261028230000_organization_branding', '20261028230100_license'].every((d) => d > '20261028120000' && dirs.includes(d)))
}

function assertDerivation(): void {
  console.log('\n[2] 状态推导')
  const A = lic({ startDays: 0, endDays: 30, graceDays: 7 })
  c.equal('none：不管控，哪怕授权早过期', [resolveAt('none', [lic({ startDays: -400, endDays: -300 })], T0).managed, resolveAt('none', [], T0).usable, resolveAt('none', [], T0).state], [false, true, 'ok'])
  c.equal('未知的授权方式按 none 处理', resolveAt('weird', [], T0).managed, false)
  c.equal('required + 没有授权 → unlicensed、不可用', [resolveAt('required', [], T0).state, resolveAt('required', [], T0).usable], ['unlicensed', false])
  c.equal('required + 只有吊销的 → unlicensed', resolveAt('required', [lic({ status: 'revoked' })], T0 + DAY_MS).state, 'unlicensed')
  const pending = lic({ startDays: 10, endDays: 40 })
  const onlyPending = resolveAt('required', [pending], T0)
  c.equal('required + 只有待生效 → unlicensed，但 upcoming 有值（未来生效的不算当前）', [onlyPending.state, onlyPending.upcoming?.id, onlyPending.current], ['unlicensed', pending.id, null])
  c.equal('在期内 → ok、可用', [resolveAt('required', [A], T0 + 5 * DAY_MS).state, resolveAt('required', [A], T0 + 5 * DAY_MS).usable], ['ok', true])
  c.equal('起点当刻含：startsAt → ok', resolveAt('required', [A], T0).state, 'ok')
  c.equal('起点前 1 毫秒 → unlicensed', resolveAt('required', [A], T0 - 1).state, 'unlicensed')
  c.equal('到期前 1 毫秒 → ok', resolveAt('required', [A], T0 + 30 * DAY_MS - 1).state, 'ok')
  c.equal('到期当刻（不含）→ grace、仍可用', [resolveAt('required', [A], T0 + 30 * DAY_MS).state, resolveAt('required', [A], T0 + 30 * DAY_MS).usable], ['grace', true])
  c.equal('宽限最后 1 毫秒 → grace', resolveAt('required', [A], T0 + 37 * DAY_MS - 1).state, 'grace')
  c.equal('宽限结束当刻 → expired、不可用', [resolveAt('required', [A], T0 + 37 * DAY_MS).state, resolveAt('required', [A], T0 + 37 * DAY_MS).usable], ['expired', false])
  c.equal('宽限 0 天：到期当刻就 expired', resolveAt('required', [lic({ graceDays: 0 })], T0 + 30 * DAY_MS).state, 'expired')
  c.equal('宽限 30 天：到期后第 29 天仍 grace', resolveAt('required', [lic({ graceDays: 30 })], T0 + 59 * DAY_MS).state, 'grace')
  c.equal('graceEndsAt = 到期 + 宽限天数', graceEndsAt(A).getTime(), T0 + 37 * DAY_MS)
  c.equal('ok 的剩余天数向上取整', [resolveAt('required', [A], T0 + 5 * DAY_MS).daysLeft, resolveAt('required', [A], T0 + 5 * DAY_MS + 1).daysLeft], [25, 25])
  c.equal('grace 的剩余天数 = 距宽限结束', resolveAt('required', [A], T0 + 33 * DAY_MS).daysLeft, 4)
  c.equal('expired / unlicensed 没有剩余天数', [resolveAt('required', [A], T0 + 40 * DAY_MS).daysLeft, resolveAt('required', [], T0).daysLeft], [null, null])
  // 暂停
  const S = lic({ status: 'suspended' })
  c.equal('暂停 → suspended、不可用', [resolveAt('required', [S], T0 + 5 * DAY_MS).state, resolveAt('required', [S], T0 + 5 * DAY_MS).usable], ['suspended', false])
  c.equal('暂停的授权在到期后的宽限期内仍是 suspended', resolveAt('required', [S], T0 + 33 * DAY_MS).state, 'suspended')
  c.equal('暂停的授权整个窗口（含宽限）过了 → expired', resolveAt('required', [S], T0 + 37 * DAY_MS).state, 'expired')
  const nextActive = lic({ startDays: 30, endDays: 60 })
  c.equal('优先级 suspended > grace：续期被暂停时不能靠上一条的宽限期继续用', resolveAt('required', [lic({ startDays: 0, endDays: 30 }), lic({ startDays: 30, endDays: 60, status: 'suspended' })], T0 + 31 * DAY_MS).state, 'suspended')
  c.equal('续期无缝：旧的 30 天到期、新的 30 天起，到期当刻是 ok', resolveAt('required', [A, nextActive], T0 + 30 * DAY_MS).state, 'ok')
  c.equal('续期无缝：认定的是新那条', resolveAt('required', [A, nextActive], T0 + 30 * DAY_MS).current?.id, nextActive.id)
  c.equal('续期之前认定旧的，新的是 upcoming', [resolveAt('required', [A, nextActive], T0 + 10 * DAY_MS).current?.id, resolveAt('required', [A, nextActive], T0 + 10 * DAY_MS).upcoming?.id], [A.id, nextActive.id])
  c.equal('coveredUntil 把首尾相接的续期串起来', resolveAt('required', [A, nextActive], T0 + 10 * DAY_MS).coveredUntil?.getTime(), T0 + 60 * DAY_MS)
  c.equal('续期留了缝（旧到期、新的隔一天才起）→ 缝里先 grace', resolveAt('required', [A, lic({ startDays: 31, endDays: 60 })], T0 + 30 * DAY_MS + 1).state, 'grace')
  c.equal('缝比宽限还长 → 缝里 expired，新的起点到了又 ok', [
    resolveAt('required', [lic({ endDays: 30, graceDays: 2 }), lic({ startDays: 40, endDays: 70 })], T0 + 35 * DAY_MS).state,
    resolveAt('required', [lic({ endDays: 30, graceDays: 2 }), lic({ startDays: 40, endDays: 70 })], T0 + 40 * DAY_MS).state,
  ], ['expired', 'ok'])
  c.equal('coveredUntil 遇到被暂停的后续授权就断', continuousCoverageEnd([A, lic({ startDays: 30, endDays: 60, status: 'suspended' })], A.endsAt).getTime(), T0 + 30 * DAY_MS)
  c.equal('重叠数据的兜底：取到期最晚的那条', resolveAt('required', [lic({ endDays: 20, id: 'short' }), lic({ endDays: 50, id: 'long' })], T0 + DAY_MS).current?.id, 'long')
  c.equal('单条授权展示阶段', [
    licensePhase(A, at(T0 - 1)), licensePhase(A, at(T0 + DAY_MS)), licensePhase(A, at(T0 + 31 * DAY_MS)), licensePhase(A, at(T0 + 38 * DAY_MS)),
    licensePhase(lic({ status: 'suspended' }), at(T0 + DAY_MS)), licensePhase(lic({ status: 'revoked' }), at(T0 + DAY_MS)),
  ], ['pending', 'active', 'grace', 'expired', 'suspended', 'revoked'])
  c.equal('一体机只看能不能用：ok / grace / inactive', [
    kioskLicenseState(resolveAt('none', [], T0)), kioskLicenseState(resolveAt('required', [A], T0 + DAY_MS)), kioskLicenseState(resolveAt('required', [A], T0 + 31 * DAY_MS)),
    kioskLicenseState(resolveAt('required', [A], T0 + 40 * DAY_MS)), kioskLicenseState(resolveAt('required', [S], T0 + DAY_MS)), kioskLicenseState(resolveAt('required', [], T0)),
  ], ['ok', 'ok', 'grace', 'inactive', 'inactive', 'inactive'])
  // 台数口径：只管「新增绑定」
  const q = (mode: string, licenses: LicenseWindow[], ms: number) => bindingQuota(resolveAt(mode, licenses, ms))
  c.equal('不管控 → 不限台数', q('none', [], T0), { allowed: true, quota: null })
  c.equal('ok → 认定那条的台数', q('required', [lic({ terminalQuota: 3 })], T0 + DAY_MS), { allowed: true, quota: 3 })
  c.equal('grace 仍按台数放行（照常服务）', q('required', [lic({ terminalQuota: 3 })], T0 + 31 * DAY_MS), { allowed: true, quota: 3 })
  c.equal('suspended → 不许新增绑定', q('required', [S], T0 + DAY_MS), { allowed: false, reason: 'suspended' })
  c.equal('expired 且没有待生效 → 不许', q('required', [A], T0 + 40 * DAY_MS), { allowed: false, reason: 'expired' })
  c.equal('unlicensed → 不许', q('required', [], T0), { allowed: false, reason: 'unlicensed' })
  c.equal('提前装机：没有当前授权但有待生效的 → 按待生效那条的台数', q('required', [lic({ startDays: 10, endDays: 40, terminalQuota: 7 })], T0), { allowed: true, quota: 7 })
  c.equal('暂停时即使有待生效的也不许', q('required', [S, lic({ startDays: 40, endDays: 70, terminalQuota: 7 })], T0 + DAY_MS), { allowed: false, reason: 'suspended' })
  // 审查返工 #2：被暂停的待生效授权不算 upcoming，不能用来提前绑定终端
  const futureSuspended = lic({ startDays: 10, endDays: 40, terminalQuota: 7, status: 'suspended' })
  const onlyFutureSuspended = resolveAt('required', [futureSuspended], T0)
  c.equal('只有被暂停的未来授权：unlicensed，upcoming 为空', [onlyFutureSuspended.state, onlyFutureSuspended.upcoming], ['unlicensed', null])
  c.equal('反向用例：先录入未来授权再暂停，不能提前绑定（原 bug：仍按 7 台放行）', q('required', [futureSuspended], T0), { allowed: false, reason: 'unlicensed' })
  c.equal('已过期 + 被暂停的未来授权 → 仍按「已过期」拒绝', q('required', [A, lic({ startDays: 60, endDays: 90, terminalQuota: 9, status: 'suspended' })], T0 + 40 * DAY_MS), { allowed: false, reason: 'expired' })
  c.equal('正向对照：同一条授权是 active 时可以提前绑定（按它的 7 台）', q('required', [lic({ startDays: 10, endDays: 40, terminalQuota: 7 })], T0), { allowed: true, quota: 7 })
  c.equal('恢复后（status 回到 active）又算 upcoming', q('required', [{ ...futureSuspended, status: 'active' }], T0), { allowed: true, quota: 7 })
  const earlySuspended = lic({ startDays: 10, endDays: 20, status: 'suspended', id: 'early-s' })
  const laterActive = lic({ startDays: 20, endDays: 50, terminalQuota: 4, id: 'later-a' })
  c.equal('upcoming 跳过被暂停的，取下一条 active', [resolveAt('required', [earlySuspended, laterActive], T0).upcoming?.id, q('required', [earlySuspended, laterActive], T0)], ['later-a', { allowed: true, quota: 4 }])
  c.equal('被吊销的未来授权同样不算', q('required', [lic({ startDays: 10, endDays: 40, status: 'revoked' })], T0), { allowed: false, reason: 'unlicensed' })
  // 信用代码
  for (const ok of ['91330100799655058B', '91440300708461136T', '  91330100799655058b  ']) {
    c.check(`信用代码通过：${ok.trim()}`, normalizeCreditCode(ok) === ok.trim().toUpperCase())
  }
  for (const bad of ['91330100799655058C', '9133010079965505', '91330100799655058BB', '91330100799655O58B', '', null, 12345678901234567, '91330100799655058B ！']) {
    c.check(`信用代码被拒：${String(bad)}`, normalizeCreditCode(bad) === null)
  }
}

function assertBeijingDays(): void {
  console.log('\n[2b] 北京时间、含到期日的期限')
  c.equal('2026-11-01 的北京 0 点 = 2026-10-31T16:00:00Z', beijingDayStart('2026-11-01')?.toISOString(), '2026-10-31T16:00:00.000Z')
  for (const bad of ['2027-02-30', '2027-13-01', '2027-00-10', '2027-1-1', '2027-10-31T00:00:00+08:00', '', '2027/10/31', ' 2027-10-31', '2027-10-31 ', '２０２７-10-31', '2027-02-29', '2100-02-29']) {
    c.check(`日期被拒：${JSON.stringify(bad)}`, beijingDayStart(bad) === null)
  }
  for (const good of ['2028-02-29', '2000-02-29', '2026-12-31', '2027-01-01']) {
    c.check(`日期通过：${good}`, beijingDayStart(good) !== null)
  }
  c.equal('licenseDay 去首尾空白后通过', licenseDay(' 2027-10-31 ', 'X', '到期日'), '2027-10-31')
  for (const bad of ['1999-12-31', '2101-01-01', '2027-10-31T00:00:00+08:00', null, 20271031]) {
    c.check(`licenseDay 被拒：${String(bad)}`, (() => { try { licenseDay(bad, 'X', '到期日'); return false } catch { return true } })())
  }
  c.equal('beijingDateOf：北京 23:59:59.999 还是当天', beijingDateOf(new Date('2026-10-31T15:59:59.999Z')), '2026-10-31')
  c.equal('beijingDateOf：北京 0 点整进入次日', beijingDateOf(new Date('2026-10-31T16:00:00.000Z')), '2026-11-01')
  c.equal('lastDayOf：排他终点（次日 0 点）→ 含当天的最后一天', lastDayOf(new Date('2027-10-31T16:00:00.000Z')), '2027-10-31')
  const one = period('2026-11-01', '2027-10-31')
  c.equal('录入 2026-11-01 至 2027-10-31 → 存 [2026-10-31T16:00Z, 2027-10-31T16:00Z)', [one.startsAt.toISOString(), one.endsAt.toISOString()], ['2026-10-31T16:00:00.000Z', '2027-10-31T16:00:00.000Z'])
  c.equal('periodText 与总指挥给的样例逐字相同', periodText(one.startsAt, one.endsAt), '2026-11-01 至 2027-10-31（北京时间，含当天）')
  c.equal('inclusiveDayText', inclusiveDayText('2027-10-31'), '2027-10-31（北京时间，含当天）')
  const sameDay = period('2026-11-01', '2026-11-01')
  c.equal('生效日 = 到期日：正好一天', sameDay.endsAt.getTime() - sameDay.startsAt.getTime(), DAY_MS)
  for (const [label, a, b] of [['到期日早于生效日', '2026-11-02', '2026-11-01'], ['超过 10 年', '2026-11-01', '2037-01-01']] as const) {
    c.check(`期限被拒：${label}`, (() => { try { period(a, b); return false } catch (e) { return (e as { getResponse?: () => { error?: { code?: string } } }).getResponse?.().error?.code === 'LICENSE_PERIOD_INVALID' } })())
  }
  c.check('恰好 10 年（含闰年天数上限内）通过', (() => { try { period('2026-11-01', '2036-10-31'); return true } catch { return false } })())
  c.check('checkPeriod：起止同一时刻被拒', (() => { try { checkPeriod(dayStart('2026-11-01'), dayStart('2026-11-01')); return false } catch { return true } })())
  c.equal('dayEnd = 次日北京 0 点', dayEnd('2027-10-31').toISOString(), '2027-10-31T16:00:00.000Z')
  // 边界毫秒：合同写「到 11 月 30 日」，30 日整天都在期内，12 月 1 日 0 点才进宽限
  const nov = { id: 'nov', status: 'active' as const, ...period('2026-11-01', '2026-11-30'), graceDays: 7, terminalQuota: 3, createdAt: new Date(0) }
  const stateAt = (iso: string) => resolveOrgLicense({ mode: 'required', licenses: [nov], now: new Date(iso) })
  c.equal('11 月 30 日中午（北京）→ 仍在期内', stateAt('2026-11-30T04:00:00.000Z').state, 'ok')
  c.equal('11 月 30 日 23:59:59.999（北京）→ 仍在期内', stateAt('2026-11-30T15:59:59.999Z').state, 'ok')
  c.equal('12 月 1 日 0 点整（北京）→ 进入宽限', stateAt('2026-11-30T16:00:00.000Z').state, 'grace')
  c.equal('宽限 7 天的最后一天是 12 月 7 日（含当天）：12 月 7 日 23:59:59.999 仍 grace', stateAt('2026-12-07T15:59:59.999Z').state, 'grace')
  c.equal('12 月 8 日 0 点整（北京）→ 已过期', stateAt('2026-12-07T16:00:00.000Z').state, 'expired')
  c.equal('宽限最后一天 = 12 月 7 日', lastDayOf(graceEndsAt(nov)), '2026-12-07')
  c.equal('生效日当天 0 点整（北京）就生效；前 1 毫秒还没有', [stateAt('2026-10-31T16:00:00.000Z').state, stateAt('2026-10-31T15:59:59.999Z').state], ['ok', 'unlicensed'])
}

// ── 派生扫描：真实路由表 ─────────────────────────────────────────────────────

const METHOD_NAMES: Record<number, string> = { 0: 'GET', 1: 'POST', 2: 'PUT', 3: 'DELETE', 4: 'PATCH' }

interface Route {
  file: string
  method: string
  path: string
  roles: string[]
  /** 「控制器类名.处理函数名」，与拦截器运行时核对的写法一致。 */
  handler: string
}

function controllerFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'generated' || entry === 'node_modules' || entry === '__tests__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) controllerFiles(full, out)
    else if (entry.endsWith('.controller.ts')) out.push(full)
  }
  return out
}

function joinPath(...parts: string[]): string {
  const joined = parts.filter(Boolean).join('/').replace(/\/+/g, '/')
  return '/' + joined.replace(/^\/|\/$/g, '')
}

function partnerRoutes(): { routes: Route[]; unloadable: string[] } {
  const routes: Route[] = []
  const unloadable: string[] = []
  for (const file of controllerFiles(join(API_ROOT, 'src'))) {
    const source = read(file)
    if (!/'partner'/.test(source)) continue
    let mod: Record<string, unknown>
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require(file) as Record<string, unknown>
    } catch (error) {
      unloadable.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue
      const prefix = Reflect.getMetadata(PATH_METADATA, exported)
      if (prefix === undefined) continue
      const classRoles = (Reflect.getMetadata(ROLES_KEY, exported) as string[] | undefined) ?? []
      for (const name of Object.getOwnPropertyNames(exported.prototype)) {
        const handler = (exported.prototype as Record<string, unknown>)[name]
        if (typeof handler !== 'function') continue
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined
        if (method === undefined) continue
        const roles = (Reflect.getMetadata(ROLES_KEY, handler) as string[] | undefined) ?? classRoles
        if (!roles.includes('partner')) continue
        const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | string[]
        for (const p of Array.isArray(sub) ? sub : [sub]) {
          for (const cp of Array.isArray(prefix) ? prefix : [prefix]) {
            routes.push({ file: file.slice(API_ROOT.length + 1), method: METHOD_NAMES[method] ?? String(method), path: joinPath(String(cp), String(p)), roles, handler: `${(exported as { name: string }).name}.${name}` })
          }
        }
      }
    }
  }
  return { routes, unloadable }
}

function assertRouteTable(): void {
  console.log('\n[3] 机构后台写接口的拦截规则（真实路由表派生扫描）')
  const { routes, unloadable } = partnerRoutes()
  c.check('带 partner 角色的控制器都能加载', unloadable.length === 0, unloadable.join(' | '))
  const writes = routes.filter((r) => r.method !== 'GET')
  c.check(`扫到机构角色的写接口（${writes.length} 个，覆盖政策 / 官方渠道 / 资料 / 报障 / 智慧校园等）`, writes.length >= 25)
  const outside = writes.filter((r) => !normalizeRoutePath(r.path).startsWith('/partner/') && !/^\/auth\//.test(r.path))
  c.check('机构角色的写接口都在 /partner/ 之下（拦截器管得到；auth 登录与改密除外）', outside.length === 0, outside.map((r) => `${r.method} ${r.path}`).join(', '))
  const isBlocked = (r: Route) => partnerWriteIsBlocked(r.method, r.path, r.handler)
  const blocked = writes.filter(isBlocked)
  const exempt = writes.filter((r) => normalizeRoutePath(r.path).startsWith('/partner/') && !isBlocked(r))
  const mustBlock: Array<[string, string]> = [
    ['POST', '/partner/policies'], ['PATCH', '/partner/policies/:id'], ['PUT', '/partner/policies/:id/eligibility-rules'],
    ['PATCH', '/partner/policies/:id/review'], ['PATCH', '/partner/policies/:id/release'],
    ['POST', '/partner/official-channels'], ['PATCH', '/partner/official-channels/:id'],
  ]
  for (const [method, path] of mustBlock) {
    c.check(`授权不可用时被拦：${method} ${path}`, blocked.some((r) => r.method === method && normalizeRoutePath(r.path) === normalizeRoutePath(path)))
  }
  for (const route of blocked.filter((r) => /partner\/(jobs|fairs|companies|excel|data-sources)/.test(r.path))) {
    c.check(`私有化部署版的写接口同样默认被拦：${route.method} ${route.path}`, isBlocked(route))
  }
  // 登记表逐条核对：方法、路由模板、处理函数与真实装饰器三者一致，且恰好一条真实路由
  c.check('登记表没有前缀通配、没有「所有方法」', PARTNER_WRITE_EXEMPTIONS.every((e) => !e.path.includes('*') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(e.method)))
  c.equal('登记表没有重复的 (方法, 路由)', new Set(PARTNER_WRITE_EXEMPTIONS.map((e) => `${e.method} ${e.path}`)).size, PARTNER_WRITE_EXEMPTIONS.length)
  for (const e of PARTNER_WRITE_EXEMPTIONS) {
    const hits = writes.filter((r) => r.method === e.method && normalizeRoutePath(r.path) === e.path)
    c.equal(`登记 ${e.method} ${e.path} → 真实路由恰好一条，处理函数是 ${e.handler}`, hits.map((r) => r.handler), [e.handler])
    c.check(`  登记的是 partner 角色的路由、理由写明：${e.handler}`, hits.every((r) => r.roles.includes('partner')) && e.reason.length >= 6)
    if (e.kind === 'withdraw') {
      c.check(`  撤回类（${e.handler}）：只用 DELETE / PATCH，处理函数名是下架 / 删除 / 归档`, ['DELETE', 'PATCH'].includes(e.method) && /\.(unpublish|delete|archive)/i.test(e.handler))
    }
    if (e.kind === 'compute') {
      c.check(`  只算不存类（${e.handler}）：POST，处理函数名是预览 / 预检`, e.method === 'POST' && /\.(preview|preflight)/i.test(e.handler))
    }
  }
  c.equal('真实路由里被放行的，恰好就是登记表的那些（一条不多一条不少）', exempt.map((r) => `${r.method} ${normalizeRoutePath(r.path)} ${r.handler}`).sort(),
    PARTNER_WRITE_EXEMPTIONS.map((e) => `${e.method} ${e.path} ${e.handler}`).sort())
  // 前缀通配退场：首单前缀下没登记的写接口必须被拦，登记过的处理函数换了名字也必须被拦
  c.check('首单前缀下以后新增的写接口默认被拦（旧版 /partner/first-order/* 会自动放行）', partnerWriteIsBlocked('POST', '/api/v1/partner/first-order/brand-new-write', 'PartnerFirstOrderController.brandNewWrite'))
  c.check('登记的路由换成别的处理函数：豁免立刻失效', partnerWriteIsBlocked('PATCH', '/partner/policies/:id/publish', 'PoliciesController.publishAnything') &&
    !partnerWriteIsBlocked('PATCH', '/partner/policies/:id/publish', 'PoliciesController.unpublishPartnerPolicy'))
  c.check('方法对不上也不放行：PUT 同一路由', partnerWriteIsBlocked('PUT', '/partner/policies/:id/publish', 'PoliciesController.unpublishPartnerPolicy'))
  c.check('findPartnerWriteExemption 只在三者全对上时返回登记项', !!findPartnerWriteExemption('DELETE', '/partner/policies/:x', 'PoliciesController.deletePartnerPolicy') && !findPartnerWriteExemption('DELETE', '/partner/policies/:x/y', 'PoliciesController.deletePartnerPolicy'))
  // 豁免路由的实际语义：下架那条路由只能下架
  const policiesController = read(join(API_ROOT, 'src/policies/policies.controller.ts'))
  const policiesService = read(join(API_ROOT, 'src/policies/policies.service.ts'))
  const routeBody = (source: string, route: string): string => {
    const rest = source.slice(source.indexOf(route) + route.length)
    const next = rest.search(/\n  @(Get|Post|Put|Patch|Delete)\(/)
    return next < 0 ? rest : rest.slice(0, next)
  }
  c.check("PATCH /partner/policies/:id/publish 的处理函数只调下架：不调 publishPolicy、不接发布参数", /unpublishPartnerPolicy\(id, user\)/.test(routeBody(policiesController, "@Patch('partner/policies/:id/publish')")) && !/publishPolicy\(/.test(routeBody(policiesController, "@Patch('partner/policies/:id/publish')")))
  const unpublishBody = policiesService.slice(policiesService.indexOf('async unpublishPartnerPolicy'), policiesService.indexOf('async deletePartnerPolicy'))
  c.check('下架服务函数只把状态写成 unpublished，从不写 published', /publishStatus: 'unpublished'/.test(unpublishBody) && !/publishStatus: 'published'/.test(unpublishBody))
  c.check('发布走 /release（授权不可用时被拦），不在 /publish 路由上', blocked.some((r) => r.method === 'PATCH' && normalizeRoutePath(r.path) === '/partner/policies/:p/release'))
  const interceptor = read(join(API_ROOT, 'src/licenses/partner-license-write.interceptor.ts'))
  c.check('拦截器把「控制器类名.处理函数名」交给登记表核对', /getClass\(\)\.name/.test(interceptor) && /getHandler\(\)\.name/.test(interceptor) && /partnerWriteIsBlocked\(req\.method, template, handler\)/.test(interceptor))
  c.check('查看与导出（GET）永远不拦', !partnerWriteIsBlocked('GET', '/api/v1/partner/policies') && !partnerWriteIsBlocked('GET', '/partner/stats') && !partnerWriteIsBlocked('HEAD', '/partner/x'))
  c.check('管理员、一体机、会员、公开接口不在 /partner/ 之下，不受影响', !partnerWriteIsBlocked('POST', '/api/v1/admin/orgs') && !partnerWriteIsBlocked('PUT', '/api/v1/terminals/x/heartbeat') && !partnerWriteIsBlocked('POST', '/api/v1/member/x'))
  c.check('路由模板规范化：去前缀、参数统一', normalizeRoutePath('/api/v1/partner/policies/:policyId/publish?x=1') === '/partner/policies/:p/publish')
}

function assertGatePlacement(): void {
  console.log('\n[4] 管控点的位置')
  const session = read(join(API_ROOT, 'src/terminals/terminal-session.service.ts'))
  const body = (name: string, next: string) => session.slice(session.indexOf(`async ${name}`), session.indexOf(next))
  c.check('换票（exchangeBootTicket）与续期（refresh）都按「签发」检查授权', /assertCurrent\(payload, \{ issuing: true \}\)/.test(body('exchangeBootTicket', 'async refresh')) && /assertCurrent\(payload, \{ issuing: true \}\)/.test(body('refresh', 'async validate')))
  c.check('校验已签发的会话（validate）不检查授权：已签发的会话照常到自然过期', /assertCurrent\(payload, \{ issuing: false \}\)/.test(body('validate', 'private async issue')))
  c.check('createBootTicket 不检查授权（Agent 心跳 / 上报链路不受影响）', !/assertCurrent|assertOrgMaySignSessions/.test(body('createBootTicket', 'async exchangeBootTicket')))
  const gateUsers: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'generated' || entry === 'node_modules' || entry === '__tests__') continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.ts') && /licenses\/license-gate|assertOrgMaySignSessions|assertCanBindTerminal|withOrgTerminalQuota/.test(read(full))) gateUsers.push(full.slice(join(API_ROOT, 'src').length + 1))
    }
  }
  walk(join(API_ROOT, 'src'))
  const outside = gateUsers.filter((f) => !f.startsWith('licenses/') && !f.startsWith('branding/'))
  c.equal('license-gate 只被这三处调用（会话签发、改绑终端、预创建终端）', outside.sort(), [
    'terminals/terminal-org-assignment.ts', 'terminals/terminal-session.service.ts', 'terminals/terminals-admin.service.ts',
  ])
  for (const file of ['terminals/terminals.service.ts', 'terminals/terminals-agent.service.ts', 'terminals/terminal-identity.guard.ts']) {
    c.check(`${file} 不碰授权（心跳、上报、身份校验不拦）`, existsSync(join(API_ROOT, 'src', file)) && !/license/i.test(read(join(API_ROOT, 'src', file))))
  }
  const assignment = read(join(API_ROOT, 'src/terminals/terminal-org-assignment.ts'))
  c.check('改绑只在「绑到新机构」时检查台数，解绑与改绑到不管控的机构不受限', /orgId !== null && orgId !== oldOrgId\) await assertCanBindTerminal/.test(assignment))
  const moduleSource = read(join(API_ROOT, 'src/licenses/license.module.ts'))
  c.check('LicenseModule 把写操作拦截器注册成全局 APP_INTERCEPTOR', /provide: APP_INTERCEPTOR, useExisting: PartnerLicenseWriteInterceptor/.test(moduleSource))
  const appModule = read(join(API_ROOT, 'src/app.module.ts'))
  c.check('AppModule 注册 LicenseModule', /import \{ LicenseModule \}/.test(appModule) && /^\s+LicenseModule,$/m.test(appModule))
  const alerts = read(join(API_ROOT, 'src/licenses/license-expiry-alert.service.ts'))
  c.check('到期告警复用管理员告警通道（deliverOpsAlert），每天北京时间 9 点跑', /deliverOpsAlert/.test(alerts) && /@Cron\('0 9 \* \* \*'.*Asia\/Shanghai/.test(alerts))
}

assertContract()
assertDerivation()
assertBeijingDays()
assertRouteTable()
assertGatePlacement()
c.finish('verify:license（状态与契约）')
