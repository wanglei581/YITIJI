import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { partnerOfficialChannelsService } from '../../services/api/officialChannels'
import { isAbsoluteHttpUrl } from '../../lib/httpUrl'
import { AUDIENCE_LABELS, CATEGORY_LABELS } from './policyLabels'
import { HANDLING_FIELDS, type PolicyFormState } from './policyFormModel'

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">
        {label}{required && <span className="ml-0.5 text-error-fg">*</span>}
      </span>
      {children}
    </label>
  )
}

export function PolicyFormFields({ form, setForm, recruitmentOpen, editingRecruitmentLocked }: {
  form: PolicyFormState
  setForm: Dispatch<SetStateAction<PolicyFormState>>
  recruitmentOpen: boolean
  editingRecruitmentLocked: boolean
}) {
  const [domains, setDomains] = useState<string[] | null>(null)
  const [domainState, setDomainState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    let cancelled = false
    void partnerOfficialChannelsService.list().then((result) => {
      if (!cancelled) {
        setDomains(result.verifiedDomains)
        setDomainState(result.verifiedDomains === null ? 'error' : 'ready')
      }
    }).catch(() => { if (!cancelled) setDomainState('error') })
    return () => { cancelled = true }
  }, [])

  const change = (key: keyof PolicyFormState, value: string) => setForm((previous) => ({ ...previous, [key]: value }))
  const categoryChoices = Object.entries(CATEGORY_LABELS).filter(([key]) => recruitmentOpen || key !== 'recruitment')
  const urlError = form.externalUrl.trim() && (!isAbsoluteHttpUrl(form.externalUrl) || new URL(form.externalUrl.trim()).protocol !== 'https:')
  return (
    <>
      <Field label="内容类型" required>
        <select className={inputCls} value={form.kind} onChange={(e) => change('kind', e.target.value)}>
          <option value="notice">{recruitmentOpen ? '政策公告(公告/通知/招募,展示在公告列表)' : '政策公告(公告/通知,展示在公告列表)'}</option>
          <option value="policy_guide">政策扶持条目(按人群分组展示)</option>
        </select>
      </Field>
      <Field label="标题" required>
        <input className={inputCls} maxLength={200} value={form.title} onChange={(e) => change('title', e.target.value)} />
        <span className="mt-1 block text-right text-xs text-neutral-400">{form.title.length}/200 字</span>
      </Field>
      {form.kind === 'policy_guide' ? (
        <Field label="适用人群" required>
          <select className={inputCls} value={form.audience} onChange={(e) => change('audience', e.target.value)}>
            {Object.entries(AUDIENCE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </Field>
      ) : (
        <Field label="公告标签" required>
          {editingRecruitmentLocked ? <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">招募</p> : (
            <select className={inputCls} value={form.category} onChange={(e) => change('category', e.target.value)}>
              {categoryChoices.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          )}
        </Field>
      )}
      <Field label="摘要(一体机列表展示)">
        <textarea className={`${inputCls} h-16 resize-none`} maxLength={500} value={form.summary} onChange={(e) => change('summary', e.target.value)} />
      </Field>
      {form.kind === 'policy_guide' && HANDLING_FIELDS.map(([key, label]) => (
        <Field key={key} label={label} required>
          <textarea className={`${inputCls} h-24 resize-y`} required maxLength={2000} value={form[key]} onChange={(e) => change(key, e.target.value)} />
          <span className="mt-1 block text-xs text-neutral-500">每行写一项，照原文写，不写承诺性的话</span>
          <span className="mt-1 block text-right text-xs text-neutral-400">{form[key].length}/2000 字</span>
        </Field>
      ))}
      <Field label="政策原文摘录或补充说明（可选）">
        <textarea className={`${inputCls} h-32 resize-none`} maxLength={10000} value={form.content} onChange={(e) => change('content', e.target.value)} />
      </Field>
      <Field label="原文链接" required={form.kind === 'policy_guide'}>
        <input className={inputCls} required={form.kind === 'policy_guide'} placeholder="https://…" value={form.externalUrl} onChange={(e) => change('externalUrl', e.target.value)} />
        <span className="mt-1 block text-xs text-neutral-500">
          {domainState === 'loading' ? '正在读取本机构登记的官方网站…'
            : domainState === 'error' ? '本机构登记的官方网站暂时没读到，请稍后重试；发布时以服务端核对为准'
              : domains?.length ? `须是本机构登记的官方网站上的地址：${domains.join('、')}`
                : '本机构还没有登记官方网站，发布前请联系平台管理员登记'}
        </span>
        {urlError && <span className="mt-1 block text-xs text-error-fg">请填写以 https:// 开头的有效原文链接</span>}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="外部编号（可选）">
          <input className={inputCls} value={form.externalId} onChange={(e) => change('externalId', e.target.value)} />
        </Field>
        <Field label="展示日期">
          <input lang="zh-CN" type="date" className={inputCls} value={form.publishedDate} onChange={(e) => change('publishedDate', e.target.value)} />
        </Field>
      </div>
    </>
  )
}
