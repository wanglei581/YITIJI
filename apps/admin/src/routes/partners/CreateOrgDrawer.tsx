import { sceneFieldsForType, errMsg } from './orgFormState'
import { useEffect, useState } from 'react'
import { PARTNER_TYPE_LABELS } from '@ai-job-print/shared'
import { Drawer } from '@ai-job-print/ui'
import { orgsAdminService, type CreateOrgInput } from '../../services/api/orgsAdmin'
import { inputCls, Field, InlineError, ModulesPicker, SceneTemplateReadonly } from './orgFormParts'
import { createOrgTypeOptions } from './orgTypeOptions'

const EMPTY_CREATE: CreateOrgInput = {
  name: '',
  type: 'public_employment_service',
  // ⚠️ 必须带上场景与模块：服务端要求 type 与 sceneTemplate 严格配对，
  // 此前默认为空导致「打开抽屉直接保存」必被拒（ORG_TYPE_MATRIX_VIOLATION）。
  ...sceneFieldsForType('public_employment_service'),
}

export function CreateOrgDrawer({ open, onClose, onCreated, showRecruitment }: { open: boolean; onClose: () => void; onCreated: () => void; showRecruitment: boolean }) {
  const [form, setForm] = useState<CreateOrgInput>(EMPTY_CREATE)
  const [withAccount, setWithAccount] = useState(false)
  const [account, setAccount] = useState({ username: '', password: '', name: '', phone: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(EMPTY_CREATE)
      setWithAccount(false)
      setAccount({ username: '', password: '', name: '', phone: '' })
      setError(null)
    }
  }, [open])

  // 机构类型变更 → 场景模板与默认模块随之切换（场景不可单独选择）
  const pickType = (type: string) => {
    setForm((f) => ({ ...f, type, ...sceneFieldsForType(type) }))
  }

  const canSave =
    form.name.trim().length > 0 &&
    (!withAccount ||
      (account.username.trim().length >= 3 &&
        account.password.length >= 8 &&
        account.name.trim().length > 0 &&
        /^1[3-9]\d{9}$/.test(account.phone)))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await orgsAdminService.createOrg({
        ...form,
        name: form.name.trim(),
        contact: form.contact?.trim() || undefined,
        contactPhone: form.contactPhone?.trim() || undefined,
        account: withAccount
          ? {
              username: account.username.trim(),
              password: account.password,
              name: account.name.trim(),
              phone: account.phone,
            }
          : undefined,
      })
      onCreated()
      onClose()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="新增合作机构" size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">取消</button>
          <button onClick={save} disabled={saving || !canSave} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? '创建中…' : '创建机构'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <InlineError message={error} />
        <Field label="机构名称" required>
          <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="机构类型" required>
          {/* 3.15：企业数据来源、招聘会主办方已停放，新建时不给这两类（服务端同样拒绝 ORG_TYPE_PARKED） */}
          <select className={inputCls} value={form.type} onChange={(e) => pickType(e.target.value)}>
            {createOrgTypeOptions(PARTNER_TYPE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="联系人">
            <input className={inputCls} value={form.contact ?? ''} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} />
          </Field>
          <Field label="联系电话">
            <input className={inputCls} value={form.contactPhone ?? ''} onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))} />
          </Field>
        </div>
        <SceneTemplateReadonly sceneTemplate={form.sceneTemplate ?? null} />
        <Field label="启用模块">
          <ModulesPicker showRecruitment={showRecruitment} value={form.enabledModules ?? []} onChange={(modules) => setForm((f) => ({ ...f, enabledModules: modules }))} />
        </Field>

        <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
            <input type="checkbox" className="h-4 w-4 rounded border-neutral-300" checked={withAccount} onChange={(e) => setWithAccount(e.target.checked)} />
            同时开通机构后台登录账号
          </label>
          {withAccount && (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="登录用户名" required>
                  <input className={inputCls} placeholder="字母数字及 _.-" value={account.username} onChange={(e) => setAccount((a) => ({ ...a, username: e.target.value }))} />
                </Field>
                <Field label="账号姓名" required>
                  <input className={inputCls} value={account.name} onChange={(e) => setAccount((a) => ({ ...a, name: e.target.value }))} />
                </Field>
              </div>
              <Field label="登录手机号" required>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={account.phone}
                  onChange={(e) => setAccount((a) => ({ ...a, phone: e.target.value.replace(/\D/g, '').slice(0, 11) }))}
                />
              </Field>
              <Field label="初始密码(至少 8 位)" required>
                <input type="password" autoComplete="new-password" className={inputCls} value={account.password} onChange={(e) => setAccount((a) => ({ ...a, password: e.target.value }))} />
              </Field>
              <p className="text-xs text-neutral-400">密码仅单向提交加密保存,创建后系统不再回显;请线下安全告知机构并提示首次登录后修改。</p>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  )
}

