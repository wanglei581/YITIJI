// ============================================================
// publish-completeness.ts — 发布闸门:来源必须可追溯
//
// 事故形态(与 content-trust.ts 同源,只是缺的东西不同):
//   未授权来源的岗位被推上生产公网。那次缺的是「机构有没有过核验」;
//   这次缺的是「这条内容本身还能不能追回源头」。
//
//   publishJobSource / publishFairSource 在此之前只校验两件事:
//     ① reviewStatus === 'approved'   ② 来源机构 contentTrustStatus 可信
//   **完全不看字段是否为空**。而 Prisma 里这些列虽然是 NOT NULL,
//   空字符串照样存得进去 —— 例如 jobs-excel.service.ts 的确认导入写的是
//     sourceUrl: mapped.sourceUrl ?? '',  title/company/city: ?? ''
//   `?? ''` 只挡 undefined/null,一个空单元格映射过来本来就是 ''。
//   于是一条 sourceUrl='' 的岗位可以一路发布到一体机前台:
//   求职者看到一张没有公司名、没有地点、点不出任何来源出处的残缺卡片,
//   运营事后也无从判断它到底是从哪来的。
//
// 判据依据 CLAUDE.md §10:
//   「所有外部岗位和招聘会数据必须包含 source_org_id / external_id /
//     source_name / source_url / sync_time / review_status / publish_status」
//   「岗位详情必须展示:来源机构 / 同步时间 / 外部ID / 外部投递链接」
//   review_status / publish_status 不在本文件校验 —— 它们是状态机自己的字段,
//   由 publish 动作本身写入,不可能为空。
//
// 三条实现红线:
//   1. **只拒绝,不修补**。任何字段都不许填默认值 —— 伪造一个 sourceUrl
//      比留空危险得多:留空至少看得出数据有问题,伪造会让一条无法追溯的岗位
//      看起来完全正常。这条由 verify:publish-expiry-completeness §6 断言。
//   2. **只拦 publish,不拦 unpublish**。与 content-trust 同理:
//      闸门上线前的存量不合规内容必须还能被撤下来,否则闸门反而锁死了处置动作。
//   3. **错误必须指名道姓**。运营看到的是「缺少必填字段:公司名称、来源链接」,
//      不是一句「发布失败」—— 否则他只能挨个猜。
// ============================================================

import { BadRequestException } from '@nestjs/common'

export interface PublishRequiredField {
  /** 数据库列名 */
  key: string
  /** 展示给运营的中文字段名 */
  label: string
  /** 'url' = 除了非空,还必须是 http/https 开头的可追溯链接 */
  format?: 'url'
}

/**
 * 岗位发布必填字段。
 *
 * 前 5 项是 CLAUDE.md §10 的来源可追溯集合;
 * 后 3 项(职位名称/公司名称/工作城市)是岗位卡片的最小可读集合 ——
 * 缺任意一项,前台就是一张残缺卡片。与 Excel 导入的 JOB_REQUIRED_FIELDS
 * (src/jobs/excel-template.ts)口径一致,发布闸门是导入校验的兜底而非替代:
 * 导入路径不止 Excel 一条(webhook / API 拉取 / 人工建),闸门必须在最后一道关。
 */
export const JOB_PUBLISH_REQUIRED_FIELDS: readonly PublishRequiredField[] = [
  { key: 'sourceOrgId', label: '来源机构' },
  { key: 'externalId', label: '外部ID' },
  { key: 'sourceName', label: '来源名称' },
  { key: 'sourceUrl', label: '来源链接', format: 'url' },
  { key: 'syncTime', label: '同步时间' },
  { key: 'title', label: '职位名称' },
  { key: 'company', label: '公司名称' },
  { key: 'city', label: '工作城市' },
]

/** 招聘会发布必填字段。时间/地点缺失的招聘会对求职者没有任何可执行信息。 */
export const FAIR_PUBLISH_REQUIRED_FIELDS: readonly PublishRequiredField[] = [
  { key: 'sourceOrgId', label: '来源机构' },
  { key: 'externalId', label: '外部ID' },
  { key: 'sourceName', label: '来源名称' },
  { key: 'sourceUrl', label: '来源链接', format: 'url' },
  { key: 'syncTime', label: '同步时间' },
  { key: 'title', label: '招聘会名称' },
  { key: 'venue', label: '举办地点' },
  { key: 'city', label: '城市' },
  { key: 'startAt', label: '开始时间' },
  { key: 'endAt', label: '结束时间' },
]

/**
 * 空值判定。
 * 纯空白串按空处理 —— '   ' 在页面上和 '' 一样什么都看不到。
 * Invalid Date 也按空处理:一个存不出来的时间等于没有时间。
 */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (value instanceof Date) return Number.isNaN(value.getTime())
  if (typeof value === 'string') return value.trim().length === 0
  return false
}

/**
 * 发布前的字段完整性闸门,fail-closed。
 *
 * @param contentType 用于拼错误文案的内容类型名(「岗位」/「招聘会」)
 * @param row         待发布行(单条发布路径已 findUnique 拿到)
 * @param fields      该内容类型的必填字段表
 * @throws BadRequestException PUBLISH_INCOMPLETE_FIELDS
 */
export function assertPublishFieldsComplete(
  contentType: string,
  row: Record<string, unknown>,
  fields: readonly PublishRequiredField[],
): void {
  const missing: string[] = []
  const malformed: string[] = []

  for (const field of fields) {
    const value = row[field.key]
    if (isBlank(value)) {
      missing.push(field.label)
      continue
    }
    if (field.format === 'url' && !/^https?:\/\//i.test(String(value).trim())) {
      malformed.push(field.label)
    }
  }

  if (missing.length === 0 && malformed.length === 0) return

  const reasons: string[] = []
  if (missing.length > 0) reasons.push(`缺少必填字段:${missing.join('、')}`)
  if (malformed.length > 0) {
    reasons.push(`${malformed.join('、')}不是 http/https 开头的可追溯链接`)
  }

  throw new BadRequestException({
    error: {
      code: 'PUBLISH_INCOMPLETE_FIELDS',
      message:
        `${contentType}来源信息不完整,不得发布(${reasons.join(';')})。` +
        '请在来源数据中补全后重新同步或人工修正 —— 系统不会为任何字段填充默认值。',
    },
  })
}
