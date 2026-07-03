import { COMPANY_INDUSTRIES, COMPANY_TYPES, isMunicipality, resolveRegionSelection } from '@ai-job-print/shared'
import { type AdminCompanyDetail, type CompanyFieldsInput } from '../../../services/api/companiesAdmin'

// companies 路由内多个子组件与主页共享的展示常量、标签工具与表单逻辑。
// 由 routes/companies/index.tsx 抽出,取值与行为零变化。

// ─── 展示常量 ─────────────────────────────────────────────────────────────────

export const REVIEW_BADGE: Record<string, { status: 'success' | 'warning' | 'error' | 'info' | 'default'; label: string }> = {
  pending:   { status: 'warning', label: '待审核' },
  reviewing: { status: 'info',    label: '审核中' },
  approved:  { status: 'success', label: '已通过' },
  rejected:  { status: 'error',   label: '已拒绝' },
}

export const PUBLISH_BADGE: Record<string, { status: 'success' | 'warning' | 'error' | 'info' | 'default'; label: string }> = {
  draft:       { status: 'default', label: '草稿' },
  published:   { status: 'success', label: '已发布' },
  unpublished: { status: 'warning', label: '已下架' },
  expired:     { status: 'default', label: '已过期' },
}

export const REVIEW_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '全部审核状态' },
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已拒绝' },
]

export const PUBLISH_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '全部发布状态' },
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'unpublished', label: '已下架' },
]

/** Job.category → 中文（与岗位模块口径一致）。 */
export const JOB_CATEGORY_LABELS: Record<string, string> = {
  fulltime: '社招',
  campus: '校招',
  intern: '实习',
  parttime: '兼职',
}

export function companyTypeLabel(value: string | null): string {
  if (!value) return '—'
  return (COMPANY_TYPES as Record<string, string>)[value] ?? value
}

export function industryLabel(value: string | null): string {
  if (!value) return '—'
  return (COMPANY_INDUSTRIES as Record<string, string>)[value] ?? value
}

export function regionLabel(c: { province: string | null; city: string | null; district: string | null }): string {
  const parts = [c.province, c.city, c.district].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : '—'
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string') {
    return (e as Error).message
  }
  return '操作失败，请重试'
}

export const inputCls =
  'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

// ─── 表单状态与字段（编辑 / 新增共用）─────────────────────────────────────────

export interface CompanyFormState {
  name: string
  legalName: string
  companyType: string
  industry: string
  scale: string
  foundedAt: string // YYYY-MM-DD
  province: string
  city: string
  district: string
  address: string
  boothNo: string
  description: string
  honorTags: string
  tags: string
  logoUrl: string
  coverImageUrl: string
  promoVideoUrl: string
  sourceUrl: string
  fairParticipant: boolean
  showOpenJobCount: boolean
  showCity: boolean
  showEmployeeScale: boolean
  showBoothNo: boolean
}

export const EMPTY_FORM: CompanyFormState = {
  name: '', legalName: '', companyType: '', industry: '', scale: '', foundedAt: '',
  province: '', city: '', district: '', address: '', boothNo: '', description: '',
  honorTags: '', tags: '', logoUrl: '', coverImageUrl: '', promoVideoUrl: '', sourceUrl: '',
  fairParticipant: false,
  showOpenJobCount: true, showCity: true, showEmployeeScale: true, showBoothNo: true,
}

function cityForSubmit(form: Pick<CompanyFormState, 'province' | 'city'>): string {
  // 直辖市前端跳过「市辖区」层级，落库统一用省级市名便于公开筛选按省+区命中。
  return form.province && isMunicipality(form.province) ? form.province : form.city
}

function validateRegion(form: Pick<CompanyFormState, 'province' | 'city' | 'district'>): string | null {
  if (!form.province) {
    return form.city || form.district ? '请选择省份' : null
  }
  return null
}

export function detailToForm(d: AdminCompanyDetail): CompanyFormState {
  const region = resolveRegionSelection({
    province: d.province ?? '',
    city: d.city ?? '',
    district: d.district ?? '',
  })
  const province = region.province ?? ''
  return {
    name: d.name,
    legalName: d.legalName ?? '',
    companyType: d.companyType ?? '',
    industry: d.industry ?? '',
    scale: d.scale ?? '',
    foundedAt: d.foundedAt ? d.foundedAt.slice(0, 10) : '',
    province,
    city: province && isMunicipality(province) ? '' : region.city ?? '',
    district: region.district ?? '',
    address: d.address ?? '',
    boothNo: d.boothNo ?? '',
    description: d.description ?? '',
    honorTags: d.honorTags.join(','),
    tags: d.tags.join(','),
    logoUrl: d.logoUrl ?? '',
    coverImageUrl: d.coverImageUrl ?? '',
    promoVideoUrl: d.promoVideoUrl ?? '',
    sourceUrl: d.sourceUrl ?? '',
    fairParticipant: d.fairParticipant,
    showOpenJobCount: d.showOpenJobCount,
    showCity: d.showCity,
    showEmployeeScale: d.showEmployeeScale,
    showBoothNo: d.showBoothNo,
  }
}

function splitTags(raw: string): string[] {
  return Array.from(new Set(raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean)))
}

/** 提交前的客户端校验，返回错误文案或 null。 */
export function validateForm(form: CompanyFormState): string | null {
  if (form.name.trim().length < 2 || form.name.trim().length > 80) return '企业名称长度需为 2-80 个字符'
  const urlFields: [string, string][] = [
    ['Logo 图片地址', form.logoUrl], ['封面图片地址', form.coverImageUrl],
    ['宣传视频地址', form.promoVideoUrl], ['来源页面链接', form.sourceUrl],
  ]
  for (const [label, value] of urlFields) {
    if (value.trim() && !/^https?:\/\//.test(value.trim())) return `${label}必须以 http:// 或 https:// 开头`
  }
  if (form.description.length > 2000) return '企业简介不能超过 2000 字'
  if (splitTags(form.honorTags).length > 10) return '荣誉标签最多 10 个'
  if (splitTags(form.tags).length > 10) return '展示标签最多 10 个'
  const regionError = validateRegion(form)
  if (regionError) return regionError
  return null
}

/** 表单 → PATCH 载荷：空字符串字段传 null 表示清空（foundedAt 例外：留空 = 不修改）。 */
export function formToFields(form: CompanyFormState): CompanyFieldsInput {
  const strOrNull = (s: string) => (s.trim() ? s.trim() : null)
  const city = cityForSubmit(form)
  return {
    name: form.name.trim(),
    legalName: strOrNull(form.legalName),
    companyType: strOrNull(form.companyType),
    industry: strOrNull(form.industry),
    scale: strOrNull(form.scale),
    ...(form.foundedAt ? { foundedAt: form.foundedAt } : {}),
    province: strOrNull(form.province),
    city: strOrNull(city),
    district: strOrNull(form.district),
    address: strOrNull(form.address),
    boothNo: strOrNull(form.boothNo),
    description: strOrNull(form.description),
    honorTags: splitTags(form.honorTags),
    tags: splitTags(form.tags),
    logoUrl: strOrNull(form.logoUrl),
    coverImageUrl: strOrNull(form.coverImageUrl),
    promoVideoUrl: strOrNull(form.promoVideoUrl),
    sourceUrl: strOrNull(form.sourceUrl),
    fairParticipant: form.fairParticipant,
    showOpenJobCount: form.showOpenJobCount,
    showCity: form.showCity,
    showEmployeeScale: form.showEmployeeScale,
    showBoothNo: form.showBoothNo,
  }
}

/** 新增时不发送 null（后端创建空字段保持默认即可）。 */
export function stripNulls(fields: CompanyFieldsInput): CompanyFieldsInput {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null)) as CompanyFieldsInput
}
