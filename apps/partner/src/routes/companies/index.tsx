import { CompanyFormFields, type CompanyFormState } from './CompanyFormFields'
import { CompaniesTable } from './CompaniesTable'
// ============================================================
// Partner 企业资料管理（feature/company-profiles）
//
// 合规定位：本页是来源机构维护「企业展示资料」的数据后台，不是企业 HR 后台。
// 只维护展示信息与本机构岗位的展示性关联；不涉及任何求职者数据。
// 新增/编辑一律回 pending+draft；3.15 起管理员侧审核发布停放，审核发布入口尚未开放，开放前终端不展示。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { Button, Drawer, LoadingState } from '@ai-job-print/ui'
import { FRONTEND_HINT, Page, withFrontendHint } from '../Page'
import { Building2Icon, PlusIcon, RefreshCwIcon } from 'lucide-react'
import { ConfirmActionDialog } from '../../components/ConfirmActionDialog'
import {
  isMunicipality,
  resolveRegionSelection,
} from '@ai-job-print/shared'
import type { ReviewStatus } from '../../services/api'
import {
  partnerCompaniesService,
  type PartnerCompanyRecord,
  type ImportCompanyItem,
  type UpdatePartnerCompanyInput,
  type CompanyFieldsInput,
} from '../../services/api/partnerCompanies'
import { useCapability, usePartnerCapabilities } from '../../services/capabilities'
import { getOrgProfile } from '../../services/api/orgSelf'
import { userMessageOf } from '../../services/api/userErrorMessage'

// ─── Display maps ─────────────────────────────────────────────────────────────

const REVIEW_FILTERS = ['全部', '待审核', '审核中', '已通过', '已拒绝'] as const
const REVIEW_FILTER_MAP: Record<string, ReviewStatus | null> = {
  全部: null, 待审核: 'pending', 审核中: 'reviewing', 已通过: 'approved', 已拒绝: 'rejected',
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
  if (isNew && !form.externalId.trim()) return '外部编号为必填项'
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

function errMsg(e: unknown, fallback: string): string {
  return userMessageOf(e, fallback)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CompaniesPage() {
  const canManage = useCapability('canManageCompanies')
  const { capabilities } = usePartnerCapabilities()
  const companyScope = capabilities?.companyManageScope ?? 'unrestricted'
  const [orgName, setOrgName] = useState<string>('')
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
  const [noticeIsError, setNoticeIsError] = useState(false)
  const [confirmUnpublish, setConfirmUnpublish] = useState<PartnerCompanyRecord | null>(null)
  const [unpublishing, setUnpublishing] = useState(false)

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
    getOrgProfile().then((profile) => setOrgName(profile.name)).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (editing === 'new' && companyScope === 'own_enterprise' && orgName) {
      setForm((f) => (f.name === orgName ? f : { ...f, name: orgName }))
    }
  }, [editing, companyScope, orgName])

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
    setForm({
      ...EMPTY_FORM,
      fairParticipant: companyScope === 'fair_associated',
      name: companyScope === 'own_enterprise' ? orgName : '',
    })
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
        setNoticeIsError(false)
        setNotice(
          result.updated > 0
            ? '该外部编号已存在,本次提交已更新原企业资料并回到待审核+草稿状态;审核发布入口尚未开放（平台不代审、不代发）。'
            : '企业资料已录入,进入待审核+草稿状态;审核发布入口尚未开放（平台不代审、不代发）,开放并发布前终端不展示。',
        )
      } else if (editing) {
        const payload: UpdatePartnerCompanyInput = buildFields(form, initialForm)
        const jobIds = splitList(form.jobExternalIds)
        if (jobIds.length > 0) payload.jobExternalIds = jobIds
        await partnerCompaniesService.updatePartnerCompany(editing.id, payload)
        setNoticeIsError(false)
        setNotice('修改已保存。该企业资料已回到待审核+草稿状态;审核发布入口尚未开放（平台不代审、不代发）,开放并发布前终端不展示该企业。')
      }
      setEditing(null)
      load()
    } catch (e) {
      setFormError(errMsg(e, '企业资料没有保存，请检查后重试'))
      setNoticeIsError(true)
    } finally {
      setSaving(false)
    }
  }

  // P1-A④ 下架本机构已发布企业(镜像岗位/招聘会/政策):只改 publishStatus,不触发重审。
  const handleUnpublish = async (company: PartnerCompanyRecord) => {
    setUnpublishing(true)
    setConfirmUnpublish(null)
    try {
      const updated = await partnerCompaniesService.unpublishPartnerCompany(company.id)
      if (updated) setCompanies((prev) => prev.map((c) => (c.id === company.id ? updated : c)))
      else load()
      setNoticeIsError(false)
      setNotice('企业资料已下架，终端将不再展示。如需重新上架，请用「编辑」重新提交；审核发布入口尚未开放（平台不代审、不代发），开放前不能重新上架。')
    } catch (e) {
      setNoticeIsError(true)
      setNotice(errMsg(e, '企业资料下架失败，请稍后重试'))
      load()
    } finally {
      setUnpublishing(false)
    }
  }

  if (loading) {
    return (
      <Page title="企业资料管理" subtitle={withFrontendHint('加载中...', FRONTEND_HINT.companies)}>
        <div className="flex h-48 items-center justify-center">
          <LoadingState text="加载中…" className="py-12" />
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="企业资料管理" subtitle={withFrontendHint('加载失败', FRONTEND_HINT.companies)}>
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <Building2Icon className="h-10 w-10 text-neutral-200" />
          <p className="text-sm text-neutral-400">加载失败，请稍后重试</p>
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
      subtitle={withFrontendHint(`共 ${companies.length} 家企业 · 仅维护本机构来源的企业展示资料`, FRONTEND_HINT.companies)}
      actions={
        <Button
          size="sm"
          variant="primary"
          className="flex items-center gap-1.5"
          onClick={openNew}
          disabled={!canManage}
          title={canManage ? undefined : '本机构类型不支持维护企业展示资料'}
        >
          <PlusIcon className="h-4 w-4" />
          新增企业
        </Button>
      }
    >
      {notice && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
          noticeIsError
            ? 'border-error/30 bg-error-bg text-error-fg'
            : 'border-success/30 bg-success-bg text-success-fg'
        }`}>
          {notice}
        </div>
      )}

      <div className="mb-4 rounded-lg border border-info/20 bg-info-bg px-4 py-3 text-sm text-info-fg">
        企业资料新增/编辑后将回到待审核+草稿状态；审核发布入口尚未开放（平台不代审、不代发），开放并发布前终端不展示。
      </div>

      {/* 审核状态筛选 */}
      <div className="mb-4 flex items-center gap-2">
        <span className="w-14 text-xs text-neutral-400">审核状态</span>
        <div className="flex gap-2">
          {REVIEW_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setReviewFilter(f)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                reviewFilter === f ? 'border-primary-600 bg-primary-600 text-white' : 'border-neutral-900/10 bg-surface text-neutral-700 hover:border-primary-600/40'
              }`}
            >
              {f}
              <span className="ml-1 text-xs opacity-70">{reviewCounts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      <CompaniesTable hasAny={companies.length > 0} rows={filtered} openEdit={openEdit} setConfirmUnpublish={setConfirmUnpublish} />

      <p className="mt-3 text-xs text-neutral-400">
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
            <button onClick={() => setEditing(null)} disabled={saving} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">取消</button>
            <button onClick={save} disabled={saving || !canSave} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? '保存中…' : editing === 'new' ? '提交审核' : '保存并重新提审'}
            </button>
          </div>
        }
      >
        <CompanyFormFields form={form} setForm={setForm} formError={formError} editing={editing} companyScope={companyScope} />
      </Drawer>

      <ConfirmActionDialog
        open={confirmUnpublish !== null}
        title="确认下架企业"
        description={confirmUnpublish
          ? `下架后终端将不再展示「${confirmUnpublish.name}」。已发布内容立即对求职者不可见。`
          : ''}
        confirmLabel="确认下架"
        busy={unpublishing}
        onCancel={() => setConfirmUnpublish(null)}
        onConfirm={() => confirmUnpublish && void handleUnpublish(confirmUnpublish)}
      />
    </Page>
  )
}
