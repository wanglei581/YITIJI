import { useEffect, useState } from 'react'
import { Drawer } from '@ai-job-print/ui'
import { Field, GhostButton, PrimaryButton } from '../../components/form'
import {
  offlineAgenciesAdminService,
  ORG_TYPE_LABELS,
  type AdminOfflineAgencyDetail,
  type OfflineAgencyInput,
  type OfflineAgencyOrgType,
} from '../../services/api/offlineAgenciesAdmin'

// ─── 共用样式 ─────────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

// ─── 表单状态 ─────────────────────────────────────────────────────────────────

interface FormState {
  name: string
  orgType: string
  address: string
  contactName: string
  contactPhone: string
  description: string
  licenseNo: string
  website: string
  logoUrl: string
}

const EMPTY_FORM: FormState = {
  name: '', orgType: 'other', address: '', contactName: '',
  contactPhone: '', description: '', licenseNo: '', website: '', logoUrl: '',
}

function detailToForm(d: AdminOfflineAgencyDetail): FormState {
  return {
    name: d.name,
    orgType: d.orgType,
    address: d.address ?? '',
    contactName: d.contactName ?? '',
    contactPhone: d.contactPhone ?? '',
    description: d.description ?? '',
    licenseNo: d.licenseNo ?? '',
    website: d.website ?? '',
    logoUrl: d.logoUrl ?? '',
  }
}

function validateForm(f: FormState): string | null {
  if (!f.name.trim() || f.name.trim().length < 2 || f.name.trim().length > 80) {
    return '机构名称长度需为 2–80 个字符'
  }
  if (!f.orgType) return '请选择机构类型'
  if (f.website.trim() && !/^https?:\/\//.test(f.website.trim())) {
    return '官网链接必须以 http:// 或 https:// 开头'
  }
  if (f.logoUrl.trim() && !/^https?:\/\//.test(f.logoUrl.trim())) {
    return 'Logo 图片地址必须以 http:// 或 https:// 开头'
  }
  if (f.description.length > 2000) return '机构简介不能超过 2000 字'
  return null
}

function formToInput(f: FormState): OfflineAgencyInput {
  const s = (v: string) => (v.trim() ? v.trim() : null)
  return {
    name: f.name.trim(),
    orgType: f.orgType as OfflineAgencyOrgType,
    address: s(f.address),
    contactName: s(f.contactName),
    contactPhone: s(f.contactPhone),
    description: s(f.description),
    licenseNo: s(f.licenseNo),
    website: s(f.website),
    logoUrl: s(f.logoUrl),
  }
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface AgencyFormProps {
  open: boolean
  editing: AdminOfflineAgencyDetail | null // null = 新建
  onClose: () => void
  onSaved: () => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgencyForm({ open, editing, onClose, onSaved }: AgencyFormProps) {
  const [form, setForm]     = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)

  // 打开时初始化表单
  useEffect(() => {
    if (open) {
      setForm(editing ? detailToForm(editing) : EMPTY_FORM)
      setError(null)
    }
  }, [open, editing])

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const handleSubmit = async () => {
    const err = validateForm(form)
    if (err) { setError(err); return }
    setBusy(true)
    setError(null)
    try {
      const input = formToInput(form)
      if (editing) {
        await offlineAgenciesAdminService.updateAgency(editing.id, input)
      } else {
        await offlineAgenciesAdminService.createAgency(input)
      }
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? '编辑机构' : '新建线下招聘机构'}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <GhostButton disabled={busy} onClick={onClose}>取消</GhostButton>
          <PrimaryButton disabled={busy} onClick={() => void handleSubmit()}>
            {busy ? '保存中…' : editing ? '保存' : '创建'}
          </PrimaryButton>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <Field label="机构名称" required>
          <input className={inputCls} placeholder="如：XX 招聘服务有限公司" value={form.name} onChange={set('name')} />
        </Field>

        <Field label="机构类型" required>
          <select className={inputCls} value={form.orgType} onChange={set('orgType')}>
            {(Object.entries(ORG_TYPE_LABELS) as [OfflineAgencyOrgType, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>

        <Field label="地址">
          <input className={inputCls} placeholder="如：北京市朝阳区 XX 路 XX 号" value={form.address} onChange={set('address')} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="联系人">
            <input className={inputCls} placeholder="联系人姓名" value={form.contactName} onChange={set('contactName')} />
          </Field>
          <Field label="联系电话">
            <input className={inputCls} placeholder="手机或固话" value={form.contactPhone} onChange={set('contactPhone')} />
          </Field>
        </div>

        <Field label="营业执照号">
          <input className={inputCls} placeholder="统一社会信用代码（可选）" value={form.licenseNo} onChange={set('licenseNo')} />
        </Field>

        <Field label="官网链接" hint="以 http:// 或 https:// 开头">
          <input className={inputCls} placeholder="https://" value={form.website} onChange={set('website')} />
        </Field>

        <Field label="Logo 图片地址" hint="以 http:// 或 https:// 开头">
          <input className={inputCls} placeholder="https://" value={form.logoUrl} onChange={set('logoUrl')} />
        </Field>

        <Field label="机构简介" hint={`${form.description.length}/2000`}>
          <textarea
            className={`${inputCls} h-24 resize-none`}
            placeholder="简要介绍机构背景、服务范围等"
            value={form.description}
            onChange={set('description')}
          />
        </Field>

        <p className="text-xs text-neutral-400">
          线下机构仅作信息展示用途，不参与平台内简历投递或招聘闭环。
        </p>
      </div>
    </Drawer>
  )
}
