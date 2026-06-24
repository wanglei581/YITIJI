import { useCallback, useEffect, useState } from 'react'
import { Card, Drawer, EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import {
  COMPANY_INDUSTRIES,
  COMPANY_TYPES,
  PROVINCES,
  citiesOf,
  districtsOf,
  isMunicipality,
  resolveRegionSelection,
} from '@ai-job-print/shared'
import {
  Building2Icon,
  LinkIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react'
import { Page } from '../Page'
import {
  companiesAdminService,
  type AdminCompanyDetail,
  type AdminCompanyListItem,
  type CompanyFieldsInput,
  type CompanyLinkableJob,
  type CompanyListFilters,
} from '../../services/api/companiesAdmin'
import { orgsAdminService, type AdminOrgListItem } from '../../services/api/orgsAdmin'

// ============================================================
// 企业展示管理（CompanyProfile）
//
// 合规定位（长期红线）：企业展示 = 来源企业与岗位导览，不是招聘平台。
// 只管理展示信息与岗位关联；不收简历、无平台内投递、
// 无候选人 / 简历筛查 / 面试 / Offer 任何能力。
// ============================================================

// ─── 展示常量 ─────────────────────────────────────────────────────────────────

const REVIEW_BADGE: Record<string, { status: 'success' | 'warning' | 'error' | 'info' | 'default'; label: string }> = {
  pending:   { status: 'warning', label: '待审核' },
  reviewing: { status: 'info',    label: '审核中' },
  approved:  { status: 'success', label: '已通过' },
  rejected:  { status: 'error',   label: '已拒绝' },
}

const PUBLISH_BADGE: Record<string, { status: 'success' | 'warning' | 'error' | 'info' | 'default'; label: string }> = {
  draft:       { status: 'default', label: '草稿' },
  published:   { status: 'success', label: '已发布' },
  unpublished: { status: 'warning', label: '已下架' },
  expired:     { status: 'default', label: '已过期' },
}

const REVIEW_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '全部审核状态' },
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已拒绝' },
]

const PUBLISH_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '全部发布状态' },
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'unpublished', label: '已下架' },
]

/** Job.category → 中文（与岗位模块口径一致）。 */
const JOB_CATEGORY_LABELS: Record<string, string> = {
  fulltime: '社招',
  campus: '校招',
  intern: '实习',
  parttime: '兼职',
}

function companyTypeLabel(value: string | null): string {
  if (!value) return '—'
  return (COMPANY_TYPES as Record<string, string>)[value] ?? value
}

function industryLabel(value: string | null): string {
  if (!value) return '—'
  return (COMPANY_INDUSTRIES as Record<string, string>)[value] ?? value
}

function regionLabel(c: { province: string | null; city: string | null; district: string | null }): string {
  const parts = [c.province, c.city, c.district].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : '—'
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string') {
    return (e as Error).message
  }
  return '操作失败，请重试'
}

// ─── 通用小组件 ───────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}
    </label>
  )
}

function PrimaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function GhostButton({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-sm text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary-600' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  )
}

function InlineError({ message }: { message: string | null }) {
  if (!message) return null
  return <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{message}</p>
}

function InlineSuccess({ message }: { message: string | null }) {
  if (!message) return null
  return <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">{message}</p>
}

/** 两步删除按钮：第一次点击进入确认态，5 秒内再点执行。 */
function DangerDeleteButton({ onConfirm, busy, confirmText = '确认移除?' }: { onConfirm: () => void; busy?: boolean; confirmText?: string }) {
  const [arming, setArming] = useState(false)
  useEffect(() => {
    if (!arming) return
    const t = setTimeout(() => setArming(false), 5000)
    return () => clearTimeout(t)
  }, [arming])
  return (
    <button
      disabled={busy}
      onClick={() => {
        if (arming) {
          setArming(false)
          onConfirm()
        } else {
          setArming(true)
        }
      }}
      className={`rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
        arming ? 'bg-red-600 text-white hover:bg-red-700' : 'text-red-500 hover:bg-red-50'
      }`}
    >
      {arming ? confirmText : <Trash2Icon className="h-3.5 w-3.5" />}
    </button>
  )
}

// ─── 表单状态与字段（编辑 / 新增共用）─────────────────────────────────────────

interface CompanyFormState {
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

const EMPTY_FORM: CompanyFormState = {
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

function detailToForm(d: AdminCompanyDetail): CompanyFormState {
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
function validateForm(form: CompanyFormState): string | null {
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
function formToFields(form: CompanyFormState): CompanyFieldsInput {
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
function stripNulls(fields: CompanyFieldsInput): CompanyFieldsInput {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null)) as CompanyFieldsInput
}

function CompanyFormFields({ form, onChange }: { form: CompanyFormState; onChange: (next: CompanyFormState) => void }) {
  const set = (patch: Partial<CompanyFormState>) => onChange({ ...form, ...patch })
  const municipal = form.province ? isMunicipality(form.province) : false
  const cityOptions = form.province && !municipal ? citiesOf(form.province) : []
  const districtOptions = form.province && (municipal || form.city)
    ? districtsOf(form.province, municipal ? '市辖区' : form.city)
    : []
  const showProvinceOriginal = Boolean(form.province && !PROVINCES.includes(form.province))
  const showCityOriginal = Boolean(form.city && !cityOptions.includes(form.city))
  const showDistrictOriginal = Boolean(form.district && !districtOptions.includes(form.district))
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="企业名称" required>
          <input className={inputCls} value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="注册全称">
          <input className={inputCls} value={form.legalName} onChange={(e) => set({ legalName: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="企业类型">
          <select className={inputCls} value={form.companyType} onChange={(e) => set({ companyType: e.target.value })}>
            <option value="">未设置</option>
            {Object.entries(COMPANY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="行业">
          <select className={inputCls} value={form.industry} onChange={(e) => set({ industry: e.target.value })}>
            <option value="">未设置</option>
            {Object.entries(COMPANY_INDUSTRIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="人员规模">
          <input className={inputCls} placeholder="如 500-2000 人" value={form.scale} onChange={(e) => set({ scale: e.target.value })} />
        </Field>
        <Field label="成立日期" hint="留空表示不修改">
          <input type="date" className={inputCls} value={form.foundedAt} onChange={(e) => set({ foundedAt: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="省份">
          <select
            className={inputCls}
            value={form.province}
            onChange={(e) => set({ province: e.target.value, city: '', district: '' })}
          >
            <option value="">未设置</option>
            {showProvinceOriginal && <option value={form.province}>{form.province}（原值）</option>}
            {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="城市">
          <select
            className={inputCls}
            value={form.city}
            disabled={!form.province || municipal}
            onChange={(e) => set({ city: e.target.value, district: '' })}
          >
            <option value="">{municipal ? '直辖市' : '未设置'}</option>
            {showCityOriginal && <option value={form.city}>{form.city}（原值）</option>}
            {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="区/县">
          <select
            className={inputCls}
            value={form.district}
            disabled={!form.province || (!municipal && !form.city)}
            onChange={(e) => set({ district: e.target.value })}
          >
            <option value="">未设置</option>
            {showDistrictOriginal && <option value={form.district}>{form.district}（原值）</option>}
            {districtOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="详细地址">
          <input className={inputCls} value={form.address} onChange={(e) => set({ address: e.target.value })} />
        </Field>
        <Field label="招聘会展位号">
          <input className={inputCls} placeholder="如 A12" value={form.boothNo} onChange={(e) => set({ boothNo: e.target.value })} />
        </Field>
      </div>
      <Field label="企业简介" hint="最多 2000 字">
        <textarea className={`${inputCls} h-24 resize-none`} value={form.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="荣誉标签（逗号分隔，≤10 个）">
          <input className={inputCls} placeholder="如 高新技术企业,省级专精特新" value={form.honorTags} onChange={(e) => set({ honorTags: e.target.value })} />
        </Field>
        <Field label="展示标签（逗号分隔，≤10 个）">
          <input className={inputCls} placeholder="如 五险一金,带薪年假" value={form.tags} onChange={(e) => set({ tags: e.target.value })} />
        </Field>
      </div>
      <Field label="Logo 图片地址">
        <input className={inputCls} placeholder="https://…" value={form.logoUrl} onChange={(e) => set({ logoUrl: e.target.value })} />
      </Field>
      <Field label="封面图片地址">
        <input className={inputCls} placeholder="https://…" value={form.coverImageUrl} onChange={(e) => set({ coverImageUrl: e.target.value })} />
      </Field>
      <Field label="宣传视频地址">
        <input className={inputCls} placeholder="https://…" value={form.promoVideoUrl} onChange={(e) => set({ promoVideoUrl: e.target.value })} />
      </Field>
      <Field label="来源页面链接" hint="用户从企业详情跳转外部来源平台时使用">
        <input className={inputCls} placeholder="https://…" value={form.sourceUrl} onChange={(e) => set({ sourceUrl: e.target.value })} />
      </Field>
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
        <p className="mb-2 text-xs font-medium text-gray-600">详情页指标开关（关闭或无数据的指标不在一体机展示）</p>
        <div className="grid grid-cols-2 gap-2">
          <Switch checked={form.showOpenJobCount} onChange={(v) => set({ showOpenJobCount: v })} label="展示来源岗位数" />
          <Switch checked={form.showCity} onChange={(v) => set({ showCity: v })} label="展示所在城市" />
          <Switch checked={form.showEmployeeScale} onChange={(v) => set({ showEmployeeScale: v })} label="展示人员规模" />
          <Switch checked={form.showBoothNo} onChange={(v) => set({ showBoothNo: v })} label="展示展位号" />
        </div>
      </div>
      <Switch checked={form.fairParticipant} onChange={(v) => set({ fairParticipant: v })} label="招聘会参展企业" />
    </div>
  )
}

// ─── 审核 / 发布操作区 ────────────────────────────────────────────────────────

function ReviewPublishSection({ detail, onMutated }: { detail: AdminCompanyDetail; onMutated: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const run = async (op: () => Promise<void>, okText: string) => {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await op()
      setSuccess(okText)
      setRejecting(false)
      setRejectReason('')
      onMutated()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const canPublish = detail.reviewStatus === 'approved' && detail.publishStatus !== 'published'
  const canUnpublish = detail.publishStatus === 'published'

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-gray-700">审核与发布</p>
        <StatusBadge status={REVIEW_BADGE[detail.reviewStatus]?.status ?? 'default'} label={REVIEW_BADGE[detail.reviewStatus]?.label ?? detail.reviewStatus} />
        <StatusBadge status={PUBLISH_BADGE[detail.publishStatus]?.status ?? 'default'} label={PUBLISH_BADGE[detail.publishStatus]?.label ?? detail.publishStatus} />
      </div>
      {detail.reviewStatus === 'rejected' && detail.rejectReason && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">拒绝原因：{detail.rejectReason}</p>
      )}
      <InlineError message={error} />
      <InlineSuccess message={success} />
      <div className="flex flex-wrap items-center gap-2">
        {detail.reviewStatus !== 'approved' && (
          <PrimaryButton
            disabled={busy}
            onClick={() => void run(() => companiesAdminService.reviewCompany(detail.id, 'approve'), '已通过审核')}
          >
            通过审核
          </PrimaryButton>
        )}
        {detail.reviewStatus !== 'rejected' && (
          <GhostButton disabled={busy} onClick={() => setRejecting((v) => !v)}>拒绝…</GhostButton>
        )}
        {canPublish && (
          <PrimaryButton
            disabled={busy}
            onClick={() => void run(() => companiesAdminService.publishCompany(detail.id, true), '已发布，一体机「找企业」可见')}
          >
            发布
          </PrimaryButton>
        )}
        {canUnpublish && (
          <GhostButton
            disabled={busy}
            onClick={() => void run(() => companiesAdminService.publishCompany(detail.id, false), '已下架，一体机不再展示')}
          >
            下架
          </GhostButton>
        )}
        {detail.reviewStatus !== 'approved' && detail.publishStatus !== 'published' && (
          <span className="text-xs text-gray-400">审核通过后才能发布</span>
        )}
      </div>
      {rejecting && (
        <div className="space-y-2 rounded-lg border border-red-100 bg-red-50/50 p-3">
          <Field label="拒绝原因" required>
            <textarea
              className={`${inputCls} h-16 resize-none`}
              placeholder="必填，将记录在审核日志中"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <GhostButton disabled={busy} onClick={() => setRejecting(false)}>取消</GhostButton>
            <button
              disabled={busy || !rejectReason.trim()}
              onClick={() => void run(() => companiesAdminService.reviewCompany(detail.id, 'reject', rejectReason.trim()), '已拒绝，企业回到草稿状态')}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              确认拒绝
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── 关联岗位管理 ─────────────────────────────────────────────────────────────

function LinkedJobsSection({ detail, onMutated }: { detail: AdminCompanyDetail; onMutated: () => void }) {
  const [keyword, setKeyword] = useState('')
  const [linkable, setLinkable] = useState<CompanyLinkableJob[]>([])
  const [searchState, setSearchState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const search = useCallback(async (kw: string) => {
    setSearchState('loading')
    try {
      const rows = await companiesAdminService.listLinkableJobs(detail.id, kw)
      setLinkable(rows)
      setSelected(new Set())
      setSearchState('ready')
    } catch {
      setSearchState('error')
    }
  }, [detail.id])

  useEffect(() => { void search('') }, [search])

  const toggle = (jobId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }

  const link = async () => {
    if (selected.size === 0) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await companiesAdminService.linkJobs(detail.id, Array.from(selected))
      setSuccess(
        result.rejected.length > 0
          ? `已关联 ${result.linked} 个岗位；${result.rejected.length} 个岗位不符合条件（须同来源机构且已审核发布）被跳过`
          : `已关联 ${result.linked} 个岗位`,
      )
      onMutated()
      await search(keyword)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const unlink = async (jobId: string) => {
    setBusyJobId(jobId)
    setError(null)
    setSuccess(null)
    try {
      await companiesAdminService.unlinkJob(detail.id, jobId)
      setSuccess('已移除关联')
      onMutated()
      await search(keyword)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusyJobId(null)
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <p className="text-sm font-medium text-gray-700">关联岗位（{detail.linkedJobs.length}）</p>
      <InlineError message={error} />
      <InlineSuccess message={success} />

      {/* 已关联岗位 */}
      {detail.linkedJobs.length === 0 ? (
        <p className="rounded-lg bg-gray-50 px-3 py-3 text-center text-xs text-gray-400">暂无关联岗位，可在下方搜索同来源机构的已发布岗位进行关联</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
          {detail.linkedJobs.map((j) => (
            <li key={j.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-800">{j.title}</p>
                <p className="text-xs text-gray-400">
                  {j.city || '—'} · {j.category ? JOB_CATEGORY_LABELS[j.category] ?? j.category : '—'}
                </p>
              </div>
              <StatusBadge status={PUBLISH_BADGE[j.publishStatus]?.status ?? 'default'} label={PUBLISH_BADGE[j.publishStatus]?.label ?? j.publishStatus} />
              <DangerDeleteButton onConfirm={() => void unlink(j.id)} busy={busyJobId === j.id} />
            </li>
          ))}
        </ul>
      )}

      {/* 可关联岗位搜索 */}
      <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
        <p className="text-xs font-medium text-gray-600">添加关联（仅同来源机构、已审核发布的岗位可关联）</p>
        <div className="flex gap-2">
          <input
            className={inputCls}
            placeholder="按岗位名称搜索"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void search(keyword) }}
          />
          <button
            onClick={() => void search(keyword)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            <SearchIcon className="h-4 w-4" />
            搜索
          </button>
        </div>
        {searchState === 'loading' && <LoadingState className="py-6" />}
        {searchState === 'error' && <ErrorState className="py-6" onRetry={() => void search(keyword)} />}
        {searchState === 'ready' && linkable.length === 0 && (
          <p className="py-4 text-center text-xs text-gray-400">没有可关联的岗位</p>
        )}
        {searchState === 'ready' && linkable.length > 0 && (
          <>
            <ul className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-100 bg-white">
              {linkable.map((j) => (
                <li key={j.id}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300"
                      checked={selected.has(j.id)}
                      onChange={() => toggle(j.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-gray-800">{j.title}</p>
                      <p className="text-xs text-gray-400">
                        {j.city || '—'} · {j.category ? JOB_CATEGORY_LABELS[j.category] ?? j.category : '—'}
                        {j.companyProfileId ? ' · 已关联其他企业，关联后将转移' : ''}
                      </p>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <button
                disabled={busy || selected.size === 0}
                onClick={() => void link()}
                className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <LinkIcon className="h-3.5 w-3.5" />
                {busy ? '关联中…' : `关联所选（${selected.size}）`}
              </button>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

// ─── 详情抽屉 ─────────────────────────────────────────────────────────────────

function CompanyDetailDrawer({
  companyId,
  onClose,
  onChanged,
}: {
  companyId: string | null
  onClose: () => void
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<AdminCompanyDetail | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [form, setForm] = useState<CompanyFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)

  const load = useCallback(async (id: string, resetForm: boolean) => {
    if (resetForm) setState('loading')
    try {
      const d = await companiesAdminService.getCompany(id)
      setDetail(d)
      if (resetForm) {
        setForm(detailToForm(d))
        setSaveError(null)
        setSaveSuccess(null)
      }
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])

  useEffect(() => {
    if (companyId) void load(companyId, true)
  }, [companyId, load])

  /** 审核/发布/岗位关联变更后：刷新详情（保留正在编辑的表单内容）+ 通知列表刷新。 */
  const mutated = useCallback(() => {
    if (companyId) void load(companyId, false)
    onChanged()
  }, [companyId, load, onChanged])

  const save = async () => {
    if (!detail) return
    const invalid = validateForm(form)
    if (invalid) {
      setSaveError(invalid)
      setSaveSuccess(null)
      return
    }
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(null)
    try {
      const updated = await companiesAdminService.updateCompany(detail.id, formToFields(form))
      setDetail(updated)
      setForm(detailToForm(updated))
      setSaveSuccess('保存成功')
      onChanged()
    } catch (e) {
      setSaveError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={companyId !== null}
      onClose={onClose}
      title={detail?.name ?? '企业详情'}
      size="lg"
      footer={
        state === 'ready' ? (
          <div className="flex justify-end gap-2">
            <GhostButton onClick={onClose} disabled={saving}>关闭</GhostButton>
            <PrimaryButton onClick={() => void save()} disabled={saving || !form.name.trim()}>
              {saving ? '保存中…' : '保存展示信息'}
            </PrimaryButton>
          </div>
        ) : undefined
      }
    >
      {state === 'loading' && <LoadingState className="py-24" />}
      {state === 'error' && companyId && <ErrorState className="py-24" onRetry={() => void load(companyId, true)} />}
      {state === 'ready' && detail && (
        <div className="space-y-4">
          {/* 来源信息（合规：可溯源，不可修改） */}
          <Card className="p-4">
            <p className="mb-2 text-sm font-medium text-gray-700">来源信息（不可修改，保持数据可溯源）</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
              <p>来源机构：{detail.sourceName}</p>
              <p>外部编号：{detail.externalId}</p>
              <p>同步时间：{fmtDateTime(detail.syncTime)}</p>
              <p>最近更新：{fmtDateTime(detail.updatedAt)}</p>
            </div>
          </Card>

          <ReviewPublishSection detail={detail} onMutated={mutated} />

          {/* 展示信息编辑 */}
          <Card className="space-y-4 p-4">
            <p className="text-sm font-medium text-gray-700">展示信息</p>
            <InlineError message={saveError} />
            <InlineSuccess message={saveSuccess} />
            <CompanyFormFields form={form} onChange={setForm} />
          </Card>

          <LinkedJobsSection detail={detail} onMutated={mutated} />

          <p className="text-xs text-gray-400">
            企业展示仅作为来源企业与岗位的导览信息；系统不接收求职者简历，求职者通过既有「去来源平台投递 / 扫码投递」入口跳转外部来源平台。所有修改操作均记录审计日志。
          </p>
        </div>
      )}
    </Drawer>
  )
}

// ─── 新增企业抽屉 ─────────────────────────────────────────────────────────────

function CreateCompanyDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [orgs, setOrgs] = useState<AdminOrgListItem[]>([])
  const [orgsState, setOrgsState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [sourceOrgId, setSourceOrgId] = useState('')
  const [externalId, setExternalId] = useState('')
  const [form, setForm] = useState<CompanyFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSourceOrgId('')
    setExternalId('')
    setForm(EMPTY_FORM)
    setError(null)
    setOrgsState('loading')
    orgsAdminService.listOrgs()
      .then((rows) => {
        setOrgs(rows.filter((o) => o.enabled))
        setOrgsState('ready')
      })
      .catch(() => setOrgsState('error'))
  }, [open])

  const create = async () => {
    const invalid = !sourceOrgId.trim()
      ? '请选择来源机构'
      : !externalId.trim()
        ? '请填写外部编号'
        : validateForm(form)
    if (invalid) {
      setError(invalid)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created = await companiesAdminService.createCompany({
        ...stripNulls(formToFields(form)),
        sourceOrgId: sourceOrgId.trim(),
        externalId: externalId.trim(),
        name: form.name.trim(),
      })
      onCreated(created.id)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="新增企业"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <GhostButton onClick={onClose} disabled={saving}>取消</GhostButton>
          <PrimaryButton onClick={() => void create()} disabled={saving || !sourceOrgId.trim() || !externalId.trim() || !form.name.trim()}>
            {saving ? '创建中…' : '创建（待审核）'}
          </PrimaryButton>
        </div>
      }
    >
      <div className="space-y-4">
        <InlineError message={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="来源机构" required hint="企业必须挂在真实来源机构下，保持数据可溯源">
            {orgsState === 'error' ? (
              <input
                className={inputCls}
                placeholder="机构列表加载失败，请直接填写机构 ID"
                value={sourceOrgId}
                onChange={(e) => setSourceOrgId(e.target.value)}
              />
            ) : (
              <select className={inputCls} value={sourceOrgId} onChange={(e) => setSourceOrgId(e.target.value)} disabled={orgsState === 'loading'}>
                <option value="">{orgsState === 'loading' ? '加载机构中…' : '请选择来源机构'}</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="外部编号" required hint="来源机构侧的企业唯一标识">
            <input className={inputCls} value={externalId} onChange={(e) => setExternalId(e.target.value)} />
          </Field>
        </div>
        <CompanyFormFields form={form} onChange={setForm} />
        <p className="text-xs text-gray-400">新建企业默认为「待审核 + 草稿」，审核通过并发布后才在一体机展示。</p>
      </div>
    </Drawer>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function CompaniesPage() {
  const [reviewStatus, setReviewStatus] = useState('')
  const [publishStatus, setPublishStatus] = useState('')
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [rows, setRows] = useState<AdminCompanyListItem[]>([])
  const [listState, setListState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const loadList = useCallback(async () => {
    setListState('loading')
    const filters: CompanyListFilters = {
      reviewStatus: reviewStatus || undefined,
      publishStatus: publishStatus || undefined,
      keyword: keyword || undefined,
    }
    try {
      const data = await companiesAdminService.listCompanies(filters)
      setRows(data)
      setListState('ready')
    } catch {
      setListState('error')
    }
  }, [reviewStatus, publishStatus, keyword])

  useEffect(() => { void loadList() }, [loadList])

  /** 抽屉内操作成功后刷新列表（不打断抽屉）。 */
  const refreshList = useCallback(() => { void loadList() }, [loadList])

  const hasFilter = Boolean(reviewStatus || publishStatus || keyword)

  return (
    <Page
      title="企业展示管理"
      subtitle="来源企业展示信息运营 — 审核 · 发布 · 展示资料 · 岗位关联（仅信息展示，不参与招聘闭环）"
      actions={
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          <PlusIcon className="h-4 w-4" />
          新增企业
        </button>
      }
    >
      {/* 筛选条 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className={`${inputCls} w-auto`} value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
          {REVIEW_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={publishStatus} onChange={(e) => setPublishStatus(e.target.value)}>
          {PUBLISH_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="flex flex-1 gap-2 sm:max-w-sm">
          <input
            className={inputCls}
            placeholder="按企业名称搜索"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setKeyword(keywordInput.trim()) }}
          />
          <button
            onClick={() => setKeyword(keywordInput.trim())}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            <SearchIcon className="h-4 w-4" />
            搜索
          </button>
        </div>
      </div>

      {listState === 'loading' && <LoadingState className="py-24" />}
      {listState === 'error' && <ErrorState className="py-24" onRetry={() => void loadList()} />}
      {listState === 'ready' && rows.length === 0 && (
        <EmptyState
          className="py-24"
          title={hasFilter ? '没有符合筛选条件的企业' : '暂无企业数据'}
          description={
            hasFilter
              ? '调整筛选条件或关键词后重试。'
              : '企业由合作机构导入或管理员手工新增，审核通过并发布后在一体机「找企业」展示。'
          }
        />
      )}

      {listState === 'ready' && rows.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50">
                <tr>
                  {['企业名称', '来源机构', '地区', '行业', '类型', '审核状态', '发布状态', '关联岗位', '操作'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setSelectedId(c.id)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Building2Icon className="h-4 w-4 shrink-0 text-gray-400" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-800">{c.name}</p>
                          {c.fairParticipant && <p className="text-xs text-gray-400">招聘会参展</p>}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{c.sourceName}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{regionLabel(c)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{industryLabel(c.industry)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{companyTypeLabel(c.companyType)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={REVIEW_BADGE[c.reviewStatus]?.status ?? 'default'} label={REVIEW_BADGE[c.reviewStatus]?.label ?? c.reviewStatus} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={PUBLISH_BADGE[c.publishStatus]?.status ?? 'default'} label={PUBLISH_BADGE[c.publishStatus]?.label ?? c.publishStatus} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{c.linkedJobCount}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedId(c.id)
                        }}
                        className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                      >
                        管理
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="mt-6 text-xs text-gray-400">
        企业展示模块仅提供来源企业信息与岗位导览：展示来源机构提供并经审核的企业资料；系统不接收求职者简历，不参与招聘闭环。
      </p>

      <CompanyDetailDrawer
        companyId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={refreshList}
      />

      <CreateCompanyDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false)
          refreshList()
          setSelectedId(id)
        }}
      />
    </Page>
  )
}
