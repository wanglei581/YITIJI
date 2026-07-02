import { COMPANY_INDUSTRIES, COMPANY_TYPES, PROVINCES, citiesOf, districtsOf, isMunicipality } from '@ai-job-print/shared'
import { Field, Switch } from '../../../components/form'
import { inputCls, type CompanyFormState } from './shared'

export function CompanyFormFields({ form, onChange }: { form: CompanyFormState; onChange: (next: CompanyFormState) => void }) {
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
