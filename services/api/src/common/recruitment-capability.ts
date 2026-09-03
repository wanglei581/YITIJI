// ============================================================
// 招聘闭环能力闸门 —— 平台自身许可证 fail-closed
//
// ## 这个文件解锁了什么
//
// 什么都没有。本波（第 1 刀）只交付**判据**，判据下游没有接任何业务代码：
// 全仓没有一处调用 `assertRecruitmentClosureLicensed`。闸门打开后系统行为
// 不发生任何变化。它存在的唯一目的，是把「将来怎么开」钉死在一处。
//
// ## 为什么是闸门，不是开关
//
// 直觉做法是加一个 `RECRUITMENT_CLOSURE_ENABLED` 环境变量或一个管理员能点的
// boolean，默认关闭，拿证后打开。这个项目里有一起实测事故说明它为什么不行 ——
// 见 `content-trust.ts` 文件头：`Organization.contentTrustStatus` 五个字段早就
// 建好了，schema 注释写着「回填后再切门禁」，但那句「再切门禁」从未在发布路径
// 发生。治理清单逐字裁定「未授权不进入生产」的机构，其岗位仍被推上了生产公网 ——
// 因为闸门根本没装在门上，靠的是**人不点那个按钮**。
//
// 所以这里的判据不是「有人把某个值改成了 true」，而是「**存在一条经过核验、
// 当前处于有效期内的许可证记录**」。管理员能做的是上传并核验一份真实许可证，
// 不是打开一个开关；许可证到期，能力自动失效，无需任何人做任何操作。
//
// ## 判据（五个条件，缺一即拒）
//
//   qualificationType === 'hr_service_license'
//   && status === 'approved'
//   && validFrom != null && validFrom <= now
//   && validUntil != null && now < validUntil
//   && archivedAt == null
//
// fail-closed 的含义是「未知即拒绝」：没有记录、pending、rejected、revoked、
// 有效期为空、尚未生效、已过期、已归档 —— 一律拒绝。
//
// ## 有效期为空为什么判拒（与 Job.validThrough 方向相反）
//
// `job-validity.ts` 对 `validThrough = null` 刻意放行：岗位缺有效期是**数据质量
// 问题**，按缺失即过期会误杀大批仍在招的岗位。这里方向相反 —— 许可证缺有效期是
// **无法证明该许可当前有效**。同一个 null，在「展示第三方信息」上的代价是漏展示
// 一条岗位，在「是否具备行政许可」上的代价是无证经营。不要照搬前者的写法。
//
// ## 本文件的三条自我约束（由 verify:recruitment-capability-gate 断言）
//
//   1. 不读取任何 `process.env` —— 判据不接受环境变量作为组成部分，杜绝后门。
//   2. 不导出任何「设置 / 打开 / 切换」能力的函数 —— 只导出判定，不导出赋值。
//   3. `now` 由调用方注入而非内部取 —— 判定是纯函数，可被穷举验证，
//      也让「到期自动失效」这条能被时间边界用例证明，而不是靠人相信。
// ============================================================

import { BadRequestException } from '@nestjs/common'

/** 人力资源服务许可证。当前唯一被判据识别的资质类型。 */
export const HR_SERVICE_LICENSE = 'hr_service_license'

/** 唯一放行的核验状态。任何其它取值（含 null）都不放行。 */
export const PLATFORM_QUALIFICATION_APPROVED = 'approved'

/** 能力未解锁时的错误码。前端、运营话术、门禁都认这个串。 */
export const RECRUITMENT_CAPABILITY_DENIED_CODE = 'RECRUITMENT_CAPABILITY_NOT_LICENSED'

/**
 * 受本闸门管控的能力键。
 *
 * 只列**许可证解锁类**能力。`compliance-boundary.md §二` 的八条禁令里另有一类是
 * **永久边界**（候选人筛选 / 面试邀约 / Offer 管理 / 主动推荐候选人）—— 那些与许可证
 * 无关，是产品定位选择，拿证后同样不做，因此**不得**出现在本清单里。
 * 往这里加键之前先确认它属于前者。
 */
export const LICENSE_GATED_CAPABILITIES = [
  /** 平台内投递：我方收取求职者简历并转交用人单位。 */
  'platform_application_delivery',
  /** 用人单位侧收件：企业账号读取投递到本平台的简历。 */
  'employer_inbox',
] as const

export type LicenseGatedCapability = (typeof LICENSE_GATED_CAPABILITIES)[number]

/** 判据只需要资质记录的这 5 个字段，调用方 select 时按这个取即可。 */
export interface PlatformQualificationFacts {
  id: string
  qualificationType: string
  status: string
  validFrom: Date | null
  validUntil: Date | null
  archivedAt: Date | null
}

/** 判据只用到 platformQualification 表的一个只读方法，便于验证脚本用内存假 Prisma 驱动。 */
export interface PlatformQualificationReader {
  platformQualification: {
    findMany(args: {
      where: { qualificationType: string; status: string; archivedAt: null }
      select: {
        id: true
        qualificationType: true
        status: true
        validFrom: true
        validUntil: true
        archivedAt: true
      }
    }): Promise<PlatformQualificationFacts[]>
  }
}

export type QualificationDenial =
  | 'wrong_type'
  | 'not_approved'
  | 'archived'
  | 'valid_from_missing'
  | 'not_yet_effective'
  | 'valid_until_missing'
  | 'expired'

/**
 * 单条资质记录的纯判定：可用返回 null，不可用返回拒绝原因。
 *
 * 没有任何 I/O，也不自己取当前时间 —— 验证脚本可以对它做穷举，
 * 包括 `validFrom === now`（放行）与 `validUntil === now`（拒绝）这两个边界。
 * 有效期是**半开区间** `[validFrom, validUntil)`：失效日当天零点起即不可用。
 */
export function qualificationDenial(
  q: PlatformQualificationFacts,
  now: Date,
): QualificationDenial | null {
  if (q.qualificationType !== HR_SERVICE_LICENSE) return 'wrong_type'
  if (q.status !== PLATFORM_QUALIFICATION_APPROVED) return 'not_approved'
  if (q.archivedAt != null) return 'archived'
  if (q.validFrom == null) return 'valid_from_missing'
  if (q.validFrom.getTime() > now.getTime()) return 'not_yet_effective'
  if (q.validUntil == null) return 'valid_until_missing'
  if (now.getTime() >= q.validUntil.getTime()) return 'expired'
  return null
}

/**
 * 集合层判定：候选记录里**存在**任意一条通过判定，即视为已取得许可。
 * 空数组返回 false —— 这就是 fail-closed 的默认态，也是本波的实际运行态。
 */
export function isRecruitmentClosureLicensed(
  rows: readonly PlatformQualificationFacts[],
  now: Date,
): boolean {
  return rows.some((q) => qualificationDenial(q, now) === null)
}

/**
 * 人类可读的拒绝原因：说清**为什么不可用**和**该怎么办**。
 * 运营看到这句话应该不需要再问工程师。
 */
export function recruitmentCapabilityDenialMessage(
  capability: LicenseGatedCapability,
  rows: readonly PlatformQualificationFacts[],
  now: Date,
): string {
  const head = `能力「${capability}」需要平台已取得并核验人力资源服务许可证，当前不可用。`
  const howTo =
    '解锁方式不是打开开关，而是由管理员上传真实许可证并完成双人核验，' +
    '记录状态为 approved 且当前时间处于有效期内时能力自动可用；许可证到期后同样自动失效。'

  if (rows.length === 0) {
    return `${head}原因：系统中没有任何人力资源服务许可证记录（fail-closed，未知即拒绝）。${howTo}`
  }

  // 只报最接近可用的那一条，避免把无关记录的状态一起倒给运营。
  const order: QualificationDenial[] = [
    'expired',
    'not_yet_effective',
    'valid_until_missing',
    'valid_from_missing',
    'not_approved',
    'archived',
    'wrong_type',
  ]
  const denials = rows.map((q) => qualificationDenial(q, now)).filter((d): d is QualificationDenial => d !== null)
  const closest = order.find((d) => denials.includes(d)) ?? 'wrong_type'

  const reason: Record<QualificationDenial, string> = {
    wrong_type: '现有记录都不是人力资源服务许可证',
    not_approved: '许可证记录尚未通过核验（状态不是 approved）',
    archived: '许可证记录已归档',
    valid_from_missing: '许可证记录缺生效日期，无法证明当前有效',
    not_yet_effective: '许可证尚未生效',
    valid_until_missing: '许可证记录缺失效日期，无法证明尚未过期',
    expired: '许可证已过期',
  }

  return `${head}原因：${reason[closest]}。${howTo}`
}

/**
 * 能力闸门本体。**任何**属于 LICENSE_GATED_CAPABILITIES 的写入路径都必须先过这里，
 * 并且必须在路径入口处求值 —— 不是在界面层判断，也不是在列表页过滤。
 *
 * 与 content-trust 同样刻意写成「拿 prisma 的普通函数」而不是可注入的 Nest service：
 * 少一层 DI 就少一种「构造时忘了传、闸门静默变成 undefined」的绕过方式。
 *
 * @param now 由调用方注入。生产调用方传 `new Date()`；注入而非内部取，是为了让
 *            「到期即失效」可被验证脚本证明，而不是靠人相信。
 */
export async function assertRecruitmentClosureLicensed(
  prisma: PlatformQualificationReader,
  capability: LicenseGatedCapability,
  now: Date,
): Promise<void> {
  const rows = await prisma.platformQualification.findMany({
    where: {
      qualificationType: HR_SERVICE_LICENSE,
      status: PLATFORM_QUALIFICATION_APPROVED,
      archivedAt: null,
    },
    select: {
      id: true,
      qualificationType: true,
      status: true,
      validFrom: true,
      validUntil: true,
      archivedAt: true,
    },
  })

  if (isRecruitmentClosureLicensed(rows, now)) return

  throw new BadRequestException({
    error: {
      code: RECRUITMENT_CAPABILITY_DENIED_CODE,
      message: recruitmentCapabilityDenialMessage(capability, rows, now),
      details: {
        capability,
        qualificationType: HR_SERVICE_LICENSE,
        // 只回条数，不回许可证号 / 签发机关等资质明细。
        candidateRecordCount: rows.length,
      },
    },
  })
}
