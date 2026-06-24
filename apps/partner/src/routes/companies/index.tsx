// ============================================================
// Partner 企业资料管理（feature/company-profiles）
//
// 合规定位：本页是来源机构维护「企业展示资料」的数据后台，不是企业 HR 后台。
// 只维护展示信息与本机构岗位的展示性关联；不涉及任何求职者数据。
// 新增/编辑一律回 pending+draft，须管理员重新审核发布后终端才展示。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Drawer, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { Building2Icon, PlusIcon, RefreshCwIcon } from 'lucide-react'
import {
  COMPANY_TYPES,
  COMPANY_INDUSTRIES,
  PROVINCES,
  citiesOf,
  districtsOf,
  isMunicipality,
  resolveRegionSelection,
} from '@ai-job-print/shared'
import type { CompanyType, CompanyIndustry } from '@ai-job-print/shared'
import type { ReviewStatus, PublishStatus } from '../../services/api'
import {
  partnerCompaniesService,
  type PartnerCompanyRecord,
  type ImportCompanyItem,
  type UpdatePartnerCompanyInput,
  type CompanyFieldsInput,
} from '../../services/api/partnerCompanies'

// ─── Display maps ─────────────────────────────────────────────────────────────

const REVIEW_MAP: Record<ReviewStatus, { badge: 'warning' | 'info' | 'success' | 'error'; label: string }> = {
  pending:   { badge: 'warning', label: '待审核' },
  reviewing: { badge: 'info',    label: '审核中' },
  approved:  { badge: 'success', label: '已通过' },
  rejected:  { badge: 'error',   label: '已拒绝' },
}

const PUBLISH_MAP: Record<PublishStatus, { dot: string; label: string }> = {
  draft:       { dot: 'bg-orange-400', label: '草稿' },
  published:   { dot: 'bg-green-500',  label: '已发布' },
  unpublished: { dot: 'bg-gray-300',   label: '已下架' },
  expired:     { dot: 'bg-gray-300',   label: '已过期' },
}

const REVIEW_FILTERS = ['全部', '待审核', '审核中', '已通过', '已拒绝'] as const
const REVIEW_FILTER_MAP: Record<string, ReviewStatus | null> = {
  全部: null, 待审核: 'pending', 审核中: 'reviewing', 已通过: 'approved', 已拒绝: 'rejected',
}

const INDUSTRY_OPTIONS = Object.entries(COMPANY_INDUSTRIES) as [CompanyIndustry, string][]
const COMPANY_TYPE_OPTIONS = Object.entries(COMPANY_TYPES) as [CompanyType, string][]

function industryLabel(v: string | null): string {
  if (!v) return ''
  return (COMPANY_INDUSTRIES as Record<string, string>)[v] ?? v
}

function companyTypeLabel(v: string | null): string {
  if (!v) return ''
  return (COMPANY_TYPES as Record<string, string>)[v] ?? v
}

function regionText(c: PartnerCompanyRecord): string {
  return [c.province, c.city, c.district].filter(Boolean).join(' / ')
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ─── Form ─────────────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  )
}

interface CompanyFormState {
  externalId: string
  name: string
  legalName: string
  industry: '' | CompanyIndustry
  companyType: '' | CompanyType
  scale: string
  foundedAt: string
  province: string
  city: string
  district: string
  address: string
  boothNo: string
  description: string
  logoUrl: string
  coverImageUrl: string
  promoVideoUrl: string
  sourceUrl: string
  honorTags: string
  tags: string
  fairParticipant: boolean
  jobExternalIds: string
}

const EMPTY_FORM: CompanyFormState = {
  externalId: '', name: '', legalName: '', industry: '', companyType: '', scale: '', foundedAt: '',
  province: '', city: '', district: '', address: '', boothNo: '', description: '',
  logoUrl: '', coverImageUrl: '', promoVideoUrl: '', sourceUrl: '',
  honorTags: '', tags: '', fairParticipant: false, jobExternalIds: '',
}

function cityForSubmit(form: Pick<CompanyFormState, 'province' | 'city'>): string {
  // 直辖市前端跳过「市辖区」层级，落库统一用省级市名便于公开筛选按省+区命中。
  return form.province && isMunicipality(form.province) ? form.province : form.city
}

function normalizeRegionForSubmit(form: CompanyFormState): CompanyFormState {
  return { ...form, city: cityForSubmit(form) }
}

function validateRegion(form: Pick<CompanyFormState, 'province' | 'city' | 'district'>): string | null {
  if (!form.province) {
    return form.city || form.district ? '请选择省份' : null
  }
  return null
}

/** 逗号（中英文）分隔输入 → 字符串数组。 */
function splitList(s: string): string[] {
  return s.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s)
}

/** 表单校验；返回错误文案或 null。 */
function validateForm(form: CompanyFormState, isNew: boolean): string | null {
  if (isNew && !form.externalId.trim()) return '外部编号(externalId)为必填项'
  const name = form.name.trim()
  if (isNew && !name) return '企业名称为必填项'
  if (name && (name.length < 2 || name.length > 80)) return '企业名称长度须为 2-80 个字符'
  if (form.description.length > 2000) return '企业简介不能超过 2000 字'
  const regionError = validateRegion(form)
  if (regionError) return regionError
  for (const [label, v] of [
    ['Logo 链接', form.logoUrl], ['封面图链接', form.coverImageUrl],
    ['宣传视频链接', form.promoVideoUrl], ['来源链接', form.sourceUrl],
  ] as const) {
    if (v.trim() && !isHttpUrl(v.trim())) return `${label}必须是 http/https 开头的完整 URL`
  }
  return null
}

/**
 * 表单 → 展示字段 payload。
 * - 新增：所有非空字段全部提交。
 * - 编辑：只提交与初始值不同的字段（后端 PATCH 只更新出现过的字段，未提交的保持原值）；
 *   文本字段改回空串视为「不修改」，本期 UI 不支持清空文本字段（标签数组可清空）。
 */
function buildFields(form: CompanyFormState, initial: CompanyFormState | null): CompanyFieldsInput {
  const submitForm = normalizeRegionForSubmit(form)
  const initialForm = initial ? normalizeRegionForSubmit(initial) : null
  const changed = (k: keyof CompanyFormState) => initialForm === null || submitForm[k] !== initialForm[k]
  const out: CompanyFieldsInput = {}
  const text = (k: 'name' | 'legalName' | 'scale' | 'foundedAt' | 'province' | 'city' | 'district' | 'address' | 'boothNo' | 'description' | 'logoUrl' | 'coverImageUrl' | 'promoVideoUrl' | 'sourceUrl') => {
    const v = submitForm[k].trim()
    if (v && changed(k)) out[k] = v
  }
  text('name'); text('legalName'); text('scale'); text('foundedAt')
  text('province'); text('city'); text('district'); text('address'); text('boothNo')
  text('description'); text('logoUrl'); text('coverImageUrl'); text('promoVideoUrl'); text('sourceUrl')
  if (submitForm.industry && changed('industry')) out.industry = submitForm.industry
  if (submitForm.companyType && changed('companyType')) out.companyType = submitForm.companyType
  if (changed('fairParticipant')) out.fairParticipant = submitForm.fairParticipant
  if (changed('honorTags')) out.honorTags = splitList(submitForm.honorTags)
  if (changed('tags')) out.tags = splitList(submitForm.tags)
  return out
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string') return (e as Error).message
  return '操作失败,请重试'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<PartnerCompanyRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reviewFilter, setReviewFilter] = useState('全部')
  // 新增/编辑抽屉
  const [editing, setEditing] = useState<PartnerCompanyRecord | 'new' | null>(null)
  const [form, setForm] = useState<CompanyFormState>(EMPTY_FORM)
  const [initialForm, setInitialForm] = useState<CompanyFormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    partnerCompaniesService.getPartnerCompanies()
      .then(setCompanies)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(t)
  }, [notice])

  const filtered = companies.filter(
    (c) => reviewFilter === '全部' || c.reviewStatus === REVIEW_FILTER_MAP[reviewFilter],
  )

  const reviewCounts: Record<(typeof REVIEW_FILTERS)[number], number> = {
    全部:   companies.length,
    待审核: companies.filter((c) => c.reviewStatus === 'pending').length,
    审核中: companies.filter((c) => c.reviewStatus === 'reviewing').length,
    已通过: companies.filter((c) => c.reviewStatus === 'approved').length,
    已拒绝: companies.filter((c) => c.reviewStatus === 'rejected').length,
  }

  const openNew = () => {
    setForm(EMPTY_FORM)
    setInitialForm(null)
    setFormError(null)
    setEditing('new')
  }

  const openEdit = (c: PartnerCompanyRecord) => {
    // 列表行只含摘要字段;简介/链接等详情字段留空表示「不修改」(PATCH 不提交即保持原值)
    const region = resolveRegionSelection({
      province: c.province ?? '',
      city: c.city ?? '',
      district: c.district ?? '',
    })
    const province = region.province ?? ''
    const f: CompanyFormState = {
      ...EMPTY_FORM,
      externalId: c.externalId,
      name: c.name,
      industry: c.industry ?? '',
      companyType: c.companyType ?? '',
      province,
      city: province && isMunicipality(province) ? '' : region.city ?? '',
      district: region.district ?? '',
      fairParticipant: c.fairParticipant,
    }
    setForm(f)
    setInitialForm(f)
    setFormError(null)
    setEditing(c)
  }

  const canSave = editing === 'new'
    ? Boolean(form.externalId.trim() && form.name.trim())
    : Boolean(form.name.trim())
  const municipal = form.province ? isMunicipality(form.province) : false
  const cityOptions = form.province && !municipal ? citiesOf(form.province) : []
  const districtOptions = form.province && (municipal || form.city)
    ? districtsOf(form.province, municipal ? '市辖区' : form.city)
    : []
  const showProvinceOriginal = Boolean(form.province && !PROVINCES.includes(form.province))
  const showCityOriginal = Boolean(form.city && !cityOptions.includes(form.city))
  const showDistrictOriginal = Boolean(form.district && !districtOptions.includes(form.district))

  const save = async () => {
    const invalid = validateForm(form, editing === 'new')
    if (invalid) {
      setFormError(invalid)
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      if (editing === 'new') {
        const item: ImportCompanyItem = {
          ...buildFields(form, null),
          externalId: form.externalId.trim(),
          name: form.name.trim(),
        }
        const jobIds = splitList(form.jobExternalIds)
        if (jobIds.length > 0) item.jobExternalIds = jobIds
        const result = await partnerCompaniesService.importPartnerCompanies([item])
        setNotice(
          result.updated > 0
            ? '该外部编号已存在,本次提交已更新原企业资料并回到待审核+草稿状态,须管理员重新审核发布。'
            : '企业资料已录入,进入待审核+草稿状态;管理员审核通过并发布后,终端才会展示。',
        )
      } else if (editing) {
        const payload: UpdatePartnerCompanyInput = buildFields(form, initialForm)
        const jobIds = splitList(form.jobExternalIds)
        if (jobIds.length > 0) payload.jobExternalIds = jobIds
        await partnerCompaniesService.updatePartnerCompany(editing.id, payload)
        setNotice('修改已保存。该企业资料已回到待审核+草稿状态,管理员重新审核发布前,终端不展示该企业。')
      }
      setEditing(null)
      load()
    } catch (e) {
      setFormError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  // P1-A④ 下架本机构已发布企业(镜像岗位/招聘会/政策):只改 publishStatus,不触发重审。
  const handleUnpublish = async (id: string) => {
    try {
      const updated = await partnerCompaniesService.unpublishPartnerCompany(id)
      if (updated) setCompanies((prev) => prev.map((c) => (c.id === id ? updated : c)))
      else load()
      setNotice('企业资料已下架，终端将不再展示。如需重新上架，请用「编辑」重新提交并由管理员审核发布。')
    } catch {
      // 下架失败 → 重新拉取列表，保证 UI 与后端一致
      load()
    }
  }

  if (loading) {
    return (
      <Page title="企业资料管理" subtitle="加载中...">
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-gray-400">加载中...</p>
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="企业资料管理" subtitle="加载失败">
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <Building2Icon className="h-10 w-10 text-gray-200" />
          <p className="text-sm text-gray-400">加载失败，请稍后重试</p>
          <Button size="sm" variant="secondary" className="flex items-center gap-1.5" onClick={load}>
            <RefreshCwIcon className="h-4 w-4" />
            重试
          </Button>
        </div>
      </Page>
    )
  }

  return (
    <Page
      title="企业资料管理"
      subtitle={`共 ${companies.length} 家企业 · 仅维护本机构来源的企业展示资料`}
      actions={
        <Button size="sm" variant="primary" className="flex items-center gap-1.5" onClick={openNew}>
          <PlusIcon className="h-4 w-4" />
          新增企业
        </Button>
      }
    >
      {notice && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {notice}
        </div>
      )}

      <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
        企业资料新增/编辑后将回到待审核+草稿状态，须管理员重新审核发布后，终端才会展示。
      </div>

      {/* 审核状态筛选 */}
      <div className="mb-4 flex items-center gap-2">
        <span className="w-14 text-xs text-gray-400">审核状态</span>
        <div className="flex gap-2">
          {REVIEW_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setReviewFilter(f)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                reviewFilter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f}
              <span className="ml-1 text-xs opacity-70">{reviewCounts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['外部编号', '企业名称', '行业', '企业类型', '地区', '招聘会参展', '关联岗位数', '同步时间', '审核状态', '发布状态', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-sm text-gray-400">
                    <Building2Icon className="mx-auto mb-2 h-8 w-8 text-gray-200" />
                    {companies.length === 0
                      ? '暂无企业资料,点击右上角「新增企业」录入本机构来源的企业展示信息'
                      : '当前筛选条件下无企业'}
                  </td>
                </tr>
              ) : (
                filtered.map((c) => {
                  const review = REVIEW_MAP[c.reviewStatus]
                  const publish = PUBLISH_MAP[c.publishStatus]
                  return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-400">{c.externalId}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{industryLabel(c.industry) || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{companyTypeLabel(c.companyType) || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{regionText(c) || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{c.fairParticipant ? '参展' : '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{c.linkedJobCount}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{fmtTime(c.syncTime)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={review.badge} label={review.label} />
                        {c.reviewStatus === 'rejected' && c.rejectReason && (
                          <p className="mt-1 max-w-[200px] text-xs text-red-500" title={c.rejectReason}>
                            原因:{c.rejectReason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                          <span className={`h-1.5 w-1.5 rounded-full ${publish.dot}`} aria-hidden="true" />
                          {publish.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                            onClick={() => openEdit(c)}
                          >
                            编辑
                          </button>
                          {c.publishStatus === 'published' && (
                            <button
                              className="rounded px-2 py-1 text-xs font-medium text-orange-500 hover:bg-orange-50"
                              onClick={() => void handleUnpublish(c.id)}
                            >
                              下架
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-xs text-gray-400">
        本后台仅维护来源机构的企业展示资料和本机构岗位的展示性关联，不在本系统内接收求职者简历，不参与招聘闭环。求职者一律通过「去来源平台投递/扫码投递」跳转外部渠道。
      </p>

      {/* 新增/编辑抽屉 */}
      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? '新增企业(导入单条)' : '编辑企业资料'}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(null)} disabled={saving} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">取消</button>
            <button onClick={save} disabled={saving || !canSave} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? '保存中…' : editing === 'new' ? '提交审核' : '保存并重新提审'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {formError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{formError}</p>}
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {editing === 'new'
              ? '提交后该企业资料进入待审核+草稿状态;管理员审核通过并发布后,终端才会展示。'
              : '保存后该企业资料将回到待审核+草稿状态;管理员重新审核发布前,终端不展示该企业。外部编号与来源机构不可修改。'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="外部编号(externalId)" required={editing === 'new'}>
              <input
                className={`${inputCls} ${editing !== 'new' ? 'bg-gray-50 text-gray-400' : ''}`}
                value={form.externalId}
                disabled={editing !== 'new'}
                placeholder="来源系统中的企业唯一编号"
                onChange={(e) => setForm((f) => ({ ...f, externalId: e.target.value }))}
              />
            </Field>
            <Field label="企业名称(2-80字)" required>
              <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="注册全称">
              <input className={inputCls} value={form.legalName} onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))} />
            </Field>
            <Field label="人员规模(展示文本)">
              <input className={inputCls} placeholder="如 500-999人" value={form.scale} onChange={(e) => setForm((f) => ({ ...f, scale: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="行业">
              <select className={inputCls} value={form.industry} onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value as CompanyFormState['industry'] }))}>
                <option value="">未指定</option>
                {INDUSTRY_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </Field>
            <Field label="企业类型">
              <select className={inputCls} value={form.companyType} onChange={(e) => setForm((f) => ({ ...f, companyType: e.target.value as CompanyFormState['companyType'] }))}>
                <option value="">未指定</option>
                {COMPANY_TYPE_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="省份">
              <select className={inputCls} value={form.province} onChange={(e) => setForm((f) => ({ ...f, province: e.currentTarget.value, city: '', district: '' }))}>
                <option value="">未指定</option>
                {showProvinceOriginal && <option value={form.province}>{form.province}（原值）</option>}
                {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="城市">
              <select
                className={inputCls}
                value={form.city}
                disabled={!form.province || municipal}
                onChange={(e) => setForm((f) => ({ ...f, city: e.currentTarget.value, district: '' }))}
              >
                <option value="">{municipal ? '直辖市' : '未指定'}</option>
                {showCityOriginal && <option value={form.city}>{form.city}（原值）</option>}
                {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="区县">
              <select
                className={inputCls}
                value={form.district}
                disabled={!form.province || (!municipal && !form.city)}
                onChange={(e) => setForm((f) => ({ ...f, district: e.currentTarget.value }))}
              >
                <option value="">未指定</option>
                {showDistrictOriginal && <option value={form.district}>{form.district}（原值）</option>}
                {districtOptions.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="详细地址">
              <input className={inputCls} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </Field>
            <Field label="成立日期">
              <input type="date" className={inputCls} value={form.foundedAt} onChange={(e) => setForm((f) => ({ ...f, foundedAt: e.target.value }))} />
            </Field>
          </div>
          <Field label="企业简介(≤2000字)">
            <textarea className={`${inputCls} h-24 resize-none`} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Logo 链接">
              <input className={inputCls} placeholder="https://…" value={form.logoUrl} onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))} />
            </Field>
            <Field label="封面图链接">
              <input className={inputCls} placeholder="https://…" value={form.coverImageUrl} onChange={(e) => setForm((f) => ({ ...f, coverImageUrl: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="宣传视频链接">
              <input className={inputCls} placeholder="https://…" value={form.promoVideoUrl} onChange={(e) => setForm((f) => ({ ...f, promoVideoUrl: e.target.value }))} />
            </Field>
            <Field label="来源链接(企业在来源平台的页面)">
              <input className={inputCls} placeholder="https://…" value={form.sourceUrl} onChange={(e) => setForm((f) => ({ ...f, sourceUrl: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="荣誉标签(逗号分隔,≤10个)">
              <input className={inputCls} placeholder="如 省级专精特新" value={form.honorTags} onChange={(e) => setForm((f) => ({ ...f, honorTags: e.target.value }))} />
            </Field>
            <Field label="标签(逗号分隔,≤10个)">
              <input className={inputCls} placeholder="如 五险一金,带薪年假" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 items-end gap-3">
            <Field label="关联本机构岗位外部ID(逗号分隔)">
              <input className={inputCls} placeholder="如 UNI-2026-JOB-0041,UNI-2026-JOB-0042" value={form.jobExternalIds} onChange={(e) => setForm((f) => ({ ...f, jobExternalIds: e.target.value }))} />
            </Field>
            <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                checked={form.fairParticipant}
                onChange={(e) => setForm((f) => ({ ...f, fairParticipant: e.target.checked }))}
              />
              招聘会参展企业
            </label>
          </div>
          <p className="text-xs text-gray-400">
            岗位关联仅按本机构岗位的外部ID做展示性关联，跨机构ID不会生效。企业资料仅作为第三方来源信息展示，本系统不接收简历、不参与招聘闭环。
          </p>
        </div>
      </Drawer>
    </Page>
  )
}
