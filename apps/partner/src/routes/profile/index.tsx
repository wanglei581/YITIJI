import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { PARTNER_TYPE_LABELS, type PartnerType } from '@ai-job-print/shared'
import { Button, Card, StatusBadge, LoadingState, ErrorState, EmptyState } from '@ai-job-print/ui'
import { Page } from '../Page'
import { Building2Icon, PencilIcon } from 'lucide-react'
import { ApiHttpError } from '../../services/api/client'
import { getPartnerProfile, updatePartnerProfile, type PartnerProfile } from '../../services/api'

// 资料缺失（无机构 / 未初始化）对应的后端错误码。
const NO_PROFILE_CODES = new Set(['PARTNER_PROFILE_NOT_FOUND', 'PARTNER_ORG_REQUIRED'])

interface FormState {
  name: string
  contactName: string
  contactPhone: string
  creditCode: string
  contactEmail: string
  address: string
  description: string
  websiteUrl: string
}
type FormErrors = Partial<Record<keyof FormState, string>>

function toForm(p: PartnerProfile): FormState {
  return {
    name: p.name ?? '',
    contactName: p.contactName ?? '',
    contactPhone: p.contactPhone ?? '',
    creditCode: p.creditCode ?? '',
    contactEmail: p.contactEmail ?? '',
    address: p.address ?? '',
    description: p.description ?? '',
    websiteUrl: p.websiteUrl ?? '',
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_RE = /^https?:\/\/.+/

function validate(f: FormState): FormErrors {
  const e: FormErrors = {}
  if (!f.name.trim()) e.name = '机构名称必填'
  else if (f.name.trim().length > 100) e.name = '机构名称不超过 100 字'
  if (!f.contactName.trim()) e.contactName = '联系人必填'
  else if (f.contactName.trim().length > 50) e.contactName = '联系人不超过 50 字'
  if (!f.contactPhone.trim()) e.contactPhone = '联系电话必填'
  else if (f.contactPhone.trim().length > 30) e.contactPhone = '联系电话不超过 30 字'
  if (f.contactEmail.trim() && !EMAIL_RE.test(f.contactEmail.trim())) e.contactEmail = '邮箱格式不正确'
  if (f.websiteUrl.trim() && !URL_RE.test(f.websiteUrl.trim())) e.websiteUrl = '官网链接需以 http:// 或 https:// 开头'
  if (f.description.trim().length > 500) e.description = '机构简介不超过 500 字'
  if (f.creditCode.trim().length > 64) e.creditCode = '统一社会信用代码过长'
  return e
}

function typeLabel(t: string): string {
  return PARTNER_TYPE_LABELS[t as PartnerType] ?? t
}
function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<PartnerProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [noProfile, setNoProfile] = useState(false)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setNoProfile(false)
    try {
      const p = await getPartnerProfile()
      setProfile(p)
      setForm(toForm(p))
    } catch (e) {
      if (e instanceof ApiHttpError && NO_PROFILE_CODES.has(e.code)) setNoProfile(true)
      else setLoadError(e instanceof Error ? e.message : '加载机构资料失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const enterEdit = () => {
    if (profile) setForm(toForm(profile))
    setErrors({})
    setNotice(null)
    setEditing(true)
  }
  const cancel = () => {
    if (profile) setForm(toForm(profile))
    setErrors({})
    setNotice(null)
    setEditing(false)
  }
  const setField = (k: keyof FormState, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f))

  const save = async () => {
    if (!form || saving) return
    const errs = validate(form)
    setErrors(errs)
    if (Object.keys(errs).length > 0) {
      setNotice({ kind: 'err', text: '请修正表单中标红的字段后再保存' })
      return
    }
    setSaving(true)
    setNotice(null)
    try {
      const updated = await updatePartnerProfile({
        name: form.name.trim(),
        contactName: form.contactName.trim(),
        contactPhone: form.contactPhone.trim(),
        creditCode: form.creditCode.trim() || undefined,
        contactEmail: form.contactEmail.trim() || undefined,
        address: form.address.trim() || undefined,
        description: form.description.trim() || undefined,
        websiteUrl: form.websiteUrl.trim() || undefined,
      })
      setProfile(updated)
      setForm(toForm(updated))
      setEditing(false)
      setNotice({ kind: 'ok', text: '机构资料已保存' })
    } catch (e) {
      setNotice({ kind: 'err', text: e instanceof Error ? e.message : '保存失败，请重试' })
    } finally {
      setSaving(false)
    }
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────────────

  if (loading) {
    return <Page title="机构资料" subtitle="机构基础信息维护"><LoadingState text="加载机构资料中…" className="py-16" /></Page>
  }
  if (noProfile) {
    return (
      <Page title="机构资料" subtitle="机构基础信息维护">
        <EmptyState
          icon={Building2Icon}
          title="暂无机构资料"
          description="请完善机构资料后再进行岗位或招聘会信息管理。"
        />
      </Page>
    )
  }
  if (loadError || !profile || !form) {
    return (
      <Page title="机构资料" subtitle="机构基础信息维护">
        <ErrorState title="加载机构资料失败" message={loadError ?? '未知错误'} onRetry={() => void load()} />
      </Page>
    )
  }

  return (
    <Page
      title="机构资料"
      subtitle="机构基础信息维护"
      actions={
        !editing ? (
          <Button size="sm" variant="outline" className="flex items-center gap-1.5" onClick={enterEdit}>
            <PencilIcon className="h-4 w-4" />
            编辑资料
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={cancel} disabled={saving}>取消</Button>
            <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        )
      }
    >
      {notice && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
          notice.kind === 'ok' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {notice.text}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 机构基础信息 */}
        <Card className="p-6">
          <SectionTitle icon={<Building2Icon className="h-5 w-5 text-blue-600" />} title="机构基础信息" />
          <div className="space-y-4">
            <Field label="机构名称" required editing={editing} value={form.name} error={errors.name} onChange={(v) => setField('name', v)} display={profile.name} />
            <ReadRow label="机构类型" value={typeLabel(profile.type)} hint="（由平台管理员维护）" />
            <Field label="统一社会信用代码" editing={editing} value={form.creditCode} error={errors.creditCode} onChange={(v) => setField('creditCode', v)} display={profile.creditCode} placeholder="选填" mono />
          </div>
        </Card>

        {/* 联系人信息 */}
        <Card className="p-6">
          <SectionTitle title="联系人信息" />
          <div className="space-y-4">
            <Field label="联系人" required editing={editing} value={form.contactName} error={errors.contactName} onChange={(v) => setField('contactName', v)} display={profile.contactName} />
            <Field label="联系电话" required editing={editing} value={form.contactPhone} error={errors.contactPhone} onChange={(v) => setField('contactPhone', v)} display={profile.contactPhone} />
            <Field label="联系邮箱" editing={editing} value={form.contactEmail} error={errors.contactEmail} onChange={(v) => setField('contactEmail', v)} display={profile.contactEmail} placeholder="选填" />
          </div>
        </Card>

        {/* 资质 / 状态信息 */}
        <Card className="p-6 lg:col-span-2">
          <SectionTitle title="资质 / 状态信息" />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="机构地址" editing={editing} value={form.address} error={errors.address} onChange={(v) => setField('address', v)} display={profile.address} placeholder="选填" />
            <Field label="官网 / 来源链接" editing={editing} value={form.websiteUrl} error={errors.websiteUrl} onChange={(v) => setField('websiteUrl', v)} display={profile.websiteUrl} placeholder="选填，如 https://example.gov.cn" />
            <div className="md:col-span-2">
              <Field label="机构简介" editing={editing} value={form.description} error={errors.description} onChange={(v) => setField('description', v)} display={profile.description} placeholder="选填，不超过 500 字" multiline />
            </div>
            <ReadRow label="合作状态" value={<StatusBadge status={profile.enabled ? 'success' : 'default'} label={profile.enabled ? '合作中' : '已停用'} />} hint="（由平台管理员维护）" />
            <ReadRow label="创建时间" value={fmtDate(profile.createdAt)} />
          </div>
        </Card>
      </div>

      <p className="mt-4 text-xs text-gray-400">
        机构类型与合作状态由平台管理员维护；本页仅维护机构基础信息与联系方式，不涉及岗位 / 招聘会数据与任何招聘环节。
      </p>
    </Page>
  )
}

// ─── 小组件 ─────────────────────────────────────────────────────────────────────

function SectionTitle({ icon, title }: { icon?: ReactNode; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      {icon}
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
    </div>
  )
}

function ReadRow({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="text-sm">
      <p className="mb-1 text-xs text-gray-400">{label}{hint && <span className="ml-1 text-gray-300">{hint}</span>}</p>
      <div className="text-gray-800">{value || <span className="text-gray-300">—</span>}</div>
    </div>
  )
}

interface FieldProps {
  label: string
  editing: boolean
  value: string
  display: string | null
  onChange: (v: string) => void
  required?: boolean
  error?: string
  placeholder?: string
  mono?: boolean
  multiline?: boolean
}
function Field(p: FieldProps) {
  return (
    <div className="text-sm">
      <p className="mb-1 text-xs text-gray-400">
        {p.label}{p.required && <span className="ml-0.5 text-red-500">*</span>}
      </p>
      {p.editing ? (
        <>
          {p.multiline ? (
            <textarea
              value={p.value}
              onChange={(e) => p.onChange(e.target.value)}
              placeholder={p.placeholder}
              rows={3}
              className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-1 ${
                p.error ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : 'border-gray-200 focus:border-primary-300 focus:ring-primary-200'
              }`}
            />
          ) : (
            <input
              type="text"
              value={p.value}
              onChange={(e) => p.onChange(e.target.value)}
              placeholder={p.placeholder}
              className={`h-9 w-full rounded-lg border bg-white px-3 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-1 ${p.mono ? 'font-mono' : ''} ${
                p.error ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : 'border-gray-200 focus:border-primary-300 focus:ring-primary-200'
              }`}
            />
          )}
          {p.error && <p className="mt-1 text-xs text-red-500">{p.error}</p>}
        </>
      ) : (
        <div className={`text-gray-800 ${p.mono ? 'font-mono text-xs' : ''}`}>
          {p.display || <span className="text-gray-300">未填写</span>}
        </div>
      )}
    </div>
  )
}
