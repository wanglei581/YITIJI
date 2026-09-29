/**
 * 「这份文件打印前要不要过材料检查（隐私检查）」—— 唯一判断函数（1.8 P-1，2026-09-29）。
 *
 * 为什么单独成文件、不放进 pii-scan-gate.ts：
 *   这是纯函数（不碰数据库），同时被两处调用 —— 建单闸门 pii-scan-gate.ts（小程序单件、材料包、
 *   到机码、一体机建单）与「我的文档」列表 member-assets.service.ts 的 materialCheckRequired 字段。
 *   放进 pii-scan-gate.ts 会让「我的文档」去依赖一个带 Nest 异常与数据库查询的闸门模块；
 *   两处各写一份又会出现「列表说不用查、建单却被拦」的漂移。门禁 verify:derivation-kind
 *   对同一批文件逐一比对两处结论。
 *
 * 规则（按规格，不按旧行为）：
 *   1. 用途不在 PII_SCAN_REQUIRED_PURPOSES 里的，不查（与闸门原有口径一致）。
 *   2. 原件（assetCategory=original 或其他非派生值）要查。
 *   3. 派生件（derived / optimized）只豁免两类：
 *        ai_generated  —— AI / 系统生成件，内容由本机生成，不是用户手里的材料；
 *        pii_redaction —— 隐私遮挡产物，本身就是隐私检查的结果。
 *      format_conversion（图片 / Office 转 PDF）与 signature（签名合成）内容就是用户材料，
 *      与原件同样要查（例：身份证照片转成 PDF）。
 *   4. 派生件 derivationKind 为空（本列上线前的存量行）或值不认识：失败关闭，一律要查；
 *      唯一例外是用途本身只可能由 AI / 系统生成（LEGACY_AI_GENERATED_PURPOSES）。
 *      该清单与规则 1 的用途清单没有交集 —— 也就是说，今天闸门管的用途里，存量派生件全部要查。
 */

export const DERIVATION_KINDS = ['format_conversion', 'signature', 'pii_redaction', 'ai_generated'] as const
export type DerivationKind = (typeof DERIVATION_KINDS)[number]

/** 打印前需要隐私检查的用途。pii-scan-gate.ts 从这里再导出，保持原导出名不变。 */
export const PII_SCAN_REQUIRED_PURPOSES = new Set(['resume_upload', 'resume_scan', 'print_doc', 'id_scan'])

/** 派生件里免查的来源：只有这两类。 */
export const MATERIAL_CHECK_EXEMPT_DERIVATION_KINDS: ReadonlySet<string> = new Set<DerivationKind>(['ai_generated', 'pii_redaction'])

/**
 * 存量派生件（derivationKind 为空）里，能仅凭用途认定是 AI / 系统生成的用途。
 * 这些用途的文件只由服务端生成：三个用途都不在任何用户上传 DTO 的用途白名单里，
 * FilesService.upload 还对前两个直接拒收（FILE_PURPOSE_SERVER_GENERATED_ONLY）。
 */
export const LEGACY_AI_GENERATED_PURPOSES: ReadonlySet<string> = new Set([
  'contract_review_report',
  'member_data_export',
  'self_assessment_report',
])

const DERIVED_CATEGORIES: ReadonlySet<string> = new Set(['derived', 'optimized'])

export interface MaterialCheckSubject {
  purpose: string
  assetCategory: string | null | undefined
  derivationKind: string | null | undefined
}

export function isDerivationKind(value: unknown): value is DerivationKind {
  return typeof value === 'string' && (DERIVATION_KINDS as readonly string[]).includes(value)
}

export function materialCheckRequired(file: MaterialCheckSubject): boolean {
  if (!PII_SCAN_REQUIRED_PURPOSES.has(file.purpose)) return false
  if (!DERIVED_CATEGORIES.has(file.assetCategory ?? 'original')) return true
  const kind = file.derivationKind ?? null
  if (kind === null) return !LEGACY_AI_GENERATED_PURPOSES.has(file.purpose)
  if (!isDerivationKind(kind)) return true
  return !MATERIAL_CHECK_EXEMPT_DERIVATION_KINDS.has(kind)
}
