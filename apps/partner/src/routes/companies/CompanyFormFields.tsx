import type { Dispatch, SetStateAction } from 'react'
import { COMPANY_TYPES, COMPANY_INDUSTRIES, PROVINCES, citiesOf, districtsOf, isMunicipality, type CompanyType, type CompanyIndustry } from '@ai-job-print/shared'
import type { PartnerCompanyRecord } from '../../services/api/partnerCompanies'

const INDUSTRY_OPTIONS = Object.entries(COMPANY_INDUSTRIES) as [CompanyIndustry, string][]
const COMPANY_TYPE_OPTIONS = Object.entries(COMPANY_TYPES) as [CompanyType, string][]

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">
        {label}
        {required && <span className="ml-0.5 text-error-fg">*</span>}
      </span>
      {children}
    </label>
  )
}

export interface CompanyFormState {
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

interface Props {
  form: CompanyFormState
  setForm: Dispatch<SetStateAction<CompanyFormState>>
  formError: string | null
  editing: PartnerCompanyRecord | 'new' | null
  companyScope: string
}

export function CompanyFormFields({ form, setForm, formError, editing, companyScope }: Props) {
  const municipal = form.province ? isMunicipality(form.province) : false
  const cityOptions = form.province && !municipal ? citiesOf(form.province) : []
  const districtOptions = form.province && (municipal || form.city)
    ? districtsOf(form.province, municipal ? '市辖区' : form.city)
    : []
  const showProvinceOriginal = Boolean(form.province && !PROVINCES.includes(form.province))
  const showCityOriginal = Boolean(form.city && !cityOptions.includes(form.city))
  const showDistrictOriginal = Boolean(form.district && !districtOptions.includes(form.district))
  return (
<div lang="zh-CN" className="space-y-4">
          {formError && <p className="rounded-lg bg-error-bg px-3 py-2 text-xs text-error-fg">{formError}</p>}
          <p className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning-fg">
            {editing === 'new'
              ? '提交后该企业资料进入待审核+草稿状态;审核发布入口尚未开放（平台不代审、不代发）,开放并发布前终端不展示。'
              : '保存后该企业资料将回到待审核+草稿状态;审核发布入口尚未开放（平台不代审、不代发）,开放并发布前终端不展示该企业。外部编号与来源机构不可修改。'}
          </p>
          {companyScope === 'fair_associated' && (
            <p className="rounded-lg border border-info/20 bg-info-bg px-3 py-2 text-xs text-info-fg">
              招聘会主办方只能维护本机构招聘会已录入的参展企业，企业名称须与参展名单一致。
            </p>
          )}
          {companyScope === 'own_enterprise' && (
            <p className="rounded-lg border border-info/20 bg-info-bg px-3 py-2 text-xs text-info-fg">
              企业来源方只能维护本企业资料，名称须与机构名称一致。
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="外部编号" required={editing === 'new'}>
              <input
                className={`${inputCls} ${editing !== 'new' ? 'bg-neutral-50 text-neutral-400' : ''}`}
                value={form.externalId}
                disabled={editing !== 'new'}
                placeholder="来源系统中的企业唯一编号"
                onChange={(e) => setForm((f) => ({ ...f, externalId: e.target.value }))}
              />
            </Field>
            <Field label="企业名称(2-80字)" required>
              <input
                className={`${inputCls} ${companyScope === 'own_enterprise' ? 'bg-neutral-50 text-neutral-400' : ''}`}
                value={form.name}
                disabled={companyScope === 'own_enterprise'}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
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
            <Field label="关联本机构岗位外部编号(逗号分隔)">
              <input className={inputCls} placeholder="如 UNI-2026-JOB-0041,UNI-2026-JOB-0042" value={form.jobExternalIds} onChange={(e) => setForm((f) => ({ ...f, jobExternalIds: e.target.value }))} />
            </Field>
            <label className="flex items-center gap-2 pb-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                checked={form.fairParticipant}
                disabled={companyScope === 'fair_associated'}
                onChange={(e) => setForm((f) => ({ ...f, fairParticipant: e.target.checked }))}
              />
              招聘会参展企业
            </label>
          </div>
          <p className="text-xs text-neutral-400">
            岗位关联仅按本机构岗位的外部编号做展示性关联，跨机构编号不会生效。企业资料仅作为第三方来源信息展示，本系统不接收简历、不参与招聘闭环。
          </p>
        </div>
  )
}
