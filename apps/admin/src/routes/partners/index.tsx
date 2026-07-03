import { useCallback, useEffect, useState } from 'react'
import type { PartnerType, SceneTemplate } from '@ai-job-print/shared'
import {
  MODULE_LABELS,
  PARTNER_TYPE_LABELS,
  SCENE_DEFAULT_MODULES,
  SCENE_TEMPLATE_LABELS,
} from '@ai-job-print/shared'
import { Card, Drawer, EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { Building2Icon, KeyRoundIcon, PlusIcon, SmartphoneIcon, UserPlusIcon } from 'lucide-react'
import { Page } from '../Page'
import { Pagination, useTableState } from '../components/DataTable'
import {
  orgsAdminService,
  type AdminOrgAccount,
  type AdminOrgDetail,
  type AdminOrgListItem,
  type CreateOrgInput,
  type UpdateOrgInput,
} from '../../services/api/orgsAdmin'

// ─── 展示常量 ─────────────────────────────────────────────────────────────────

const PARTNER_TYPE_STYLES: Record<string, string> = {
  school_employment_center:  'bg-info-bg text-info-fg',
  public_employment_service: 'bg-success-bg text-success-fg',
  licensed_hr_agency:        'bg-purple-50 text-purple-600',
  fair_organizer:            'bg-warning-bg text-warning-fg',
  enterprise_source:         'bg-neutral-100 text-neutral-600',
}

const SCENE_TEMPLATE_STYLES: Record<string, string> = {
  school:               'bg-info-bg text-info',
  public_employment:    'bg-teal-50 text-teal-600',
  licensed_hr_service:  'bg-purple-50 text-purple-500',
}

const STATUS_FILTERS = ['全部', '合作中', '已停用'] as const

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

function InlineError({ message }: { message: string | null }) {
  if (!message) return null
  return <p className="rounded-lg bg-error-bg px-3 py-2 text-xs text-error-fg">{message}</p>
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string') {
    return (e as Error).message
  }
  return '操作失败,请重试'
}

/** 两步确认按钮(停用机构/账号等影响登录的操作,防误点)。 */
function TwoStepButton({
  label,
  confirmLabel,
  className,
  confirmClassName,
  onConfirm,
  disabled,
}: {
  label: string
  confirmLabel: string
  className: string
  confirmClassName: string
  onConfirm: () => void
  disabled?: boolean
}) {
  const [arming, setArming] = useState(false)
  useEffect(() => {
    if (!arming) return
    const t = setTimeout(() => setArming(false), 5000)
    return () => clearTimeout(t)
  }, [arming])
  return (
    <button
      disabled={disabled}
      onClick={() => {
        if (arming) {
          setArming(false)
          onConfirm()
        } else {
          setArming(true)
        }
      }}
      className={`rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${arming ? confirmClassName : className}`}
    >
      {arming ? confirmLabel : label}
    </button>
  )
}

/** 启用模块多选(招聘闭环模块不在选项里,服务端同样硬拒绝)。 */
function ModulesPicker({ value, onChange }: { value: string[]; onChange: (modules: string[]) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {Object.entries(MODULE_LABELS).map(([key, label]) => (
        <label key={key} className="flex items-center gap-2 rounded-lg border border-neutral-100 px-2.5 py-1.5 text-xs text-neutral-700">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-neutral-300"
            checked={value.includes(key)}
            onChange={(e) => onChange(e.target.checked ? [...value, key] : value.filter((m) => m !== key))}
          />
          {label}
        </label>
      ))}
    </div>
  )
}

// ─── 新增机构抽屉 ─────────────────────────────────────────────────────────────

const EMPTY_CREATE: CreateOrgInput = { name: '', type: 'public_employment_service' }

function CreateOrgDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
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

  const pickScene = (scene: string) => {
    setForm((f) => ({
      ...f,
      sceneTemplate: scene || undefined,
      // 选场景模板时回填默认模块(可再手动调整)
      enabledModules: scene ? [...SCENE_DEFAULT_MODULES[scene as SceneTemplate]] : f.enabledModules,
    }))
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
          <select className={inputCls} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
            {Object.entries(PARTNER_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
        <Field label="场景模板(选择后回填默认模块)">
          <select className={inputCls} value={form.sceneTemplate ?? ''} onChange={(e) => pickScene(e.target.value)}>
            <option value="">暂不设置</option>
            {Object.entries(SCENE_TEMPLATE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="启用模块">
          <ModulesPicker value={form.enabledModules ?? []} onChange={(modules) => setForm((f) => ({ ...f, enabledModules: modules }))} />
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

// ─── 机构详情抽屉(档案编辑 + 账号管理)──────────────────────────────────────

function OrgDetailDrawer({
  orgId,
  open,
  onClose,
  onChanged,
}: {
  orgId: string | null
  open: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<AdminOrgDetail | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [form, setForm] = useState<UpdateOrgInput>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 账号管理状态
  const [showNewAccount, setShowNewAccount] = useState(false)
  const [newAccount, setNewAccount] = useState({ username: '', password: '', name: '', phone: '' })
  const [resetTarget, setResetTarget] = useState<AdminOrgAccount | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [accountBusy, setAccountBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setState('loading')
    try {
      const d = await orgsAdminService.getOrgDetail(orgId)
      setDetail(d)
      setForm({
        name: d.name,
        type: d.type,
        contact: d.contact ?? '',
        contactPhone: d.contactPhone ?? '',
        sceneTemplate: d.sceneTemplate ?? undefined,
        enabledModules: d.enabledModules,
      })
      setState('ready')
    } catch {
      setState('error')
    }
  }, [orgId])

  useEffect(() => {
    if (open) {
      setError(null)
      setShowNewAccount(false)
      setResetTarget(null)
      void load()
    }
  }, [open, load])

  const saveProfile = async () => {
    if (!orgId) return
    setSaving(true)
    setError(null)
    try {
      await orgsAdminService.updateOrg(orgId, {
        ...form,
        name: form.name?.trim(),
        contact: form.contact?.trim() ?? '',
        contactPhone: form.contactPhone?.trim() ?? '',
      })
      onChanged()
      await load()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const addAccount = async () => {
    if (!orgId) return
    setSaving(true)
    setError(null)
    try {
      await orgsAdminService.createAccount(orgId, {
        username: newAccount.username.trim(),
        password: newAccount.password,
        name: newAccount.name.trim(),
        phone: newAccount.phone,
      })
      setShowNewAccount(false)
      setNewAccount({ username: '', password: '', name: '', phone: '' })
      await load()
      onChanged()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleAccount = async (account: AdminOrgAccount) => {
    if (!orgId) return
    setAccountBusy(account.id)
    try {
      await orgsAdminService.setAccountStatus(orgId, account.id, account.enabled ? 'disable' : 'enable')
      await load()
    } finally {
      setAccountBusy(null)
    }
  }

  const doResetPassword = async () => {
    if (!orgId || !resetTarget) return
    setSaving(true)
    setError(null)
    try {
      await orgsAdminService.resetAccountPassword(orgId, resetTarget.id, resetPassword)
      setResetTarget(null)
      setResetPassword('')
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={detail ? `机构详情 — ${detail.name}` : '机构详情'} size="lg">
      {state === 'loading' && <LoadingState className="py-16" />}
      {state === 'error' && <ErrorState className="py-16" onRetry={() => void load()} />}
      {state === 'ready' && detail && (
        <div className="space-y-5">
          <InlineError message={error} />

          {/* 数据概览 */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: '登录账号', value: detail.counts.accounts },
              { label: '数据源', value: detail.counts.sources },
              { label: '岗位', value: detail.counts.jobs },
              { label: '招聘会', value: detail.counts.fairs },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg bg-neutral-50 p-3 text-center">
                <p className="text-lg font-bold text-neutral-800">{value}</p>
                <p className="text-xs text-neutral-500">{label}</p>
              </div>
            ))}
          </div>

          {/* 档案编辑 */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-neutral-800">机构档案</p>
            <Field label="机构名称" required>
              <input className={inputCls} value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="机构类型">
                <select className={inputCls} value={form.type ?? ''} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                  {Object.entries(PARTNER_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="场景模板">
                <select
                  className={inputCls}
                  value={form.sceneTemplate ?? ''}
                  onChange={(e) => {
                    const scene = e.target.value
                    setForm((f) => ({
                      ...f,
                      sceneTemplate: scene || undefined,
                      enabledModules: scene ? [...SCENE_DEFAULT_MODULES[scene as SceneTemplate]] : f.enabledModules,
                    }))
                  }}
                >
                  <option value="">未设置</option>
                  {Object.entries(SCENE_TEMPLATE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="联系人">
                <input className={inputCls} value={form.contact ?? ''} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} />
              </Field>
              <Field label="联系电话">
                <input className={inputCls} value={form.contactPhone ?? ''} onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))} />
              </Field>
            </div>
            <Field label="启用模块">
              <ModulesPicker value={form.enabledModules ?? []} onChange={(modules) => setForm((f) => ({ ...f, enabledModules: modules }))} />
            </Field>
            <div className="flex justify-end">
              <button
                onClick={saveProfile}
                disabled={saving || !form.name?.trim()}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存档案'}
              </button>
            </div>
          </div>

          {/* 账号管理 */}
          <div className="space-y-3 border-t border-neutral-100 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-neutral-800">机构后台账号</p>
              <button
                onClick={() => setShowNewAccount((v) => !v)}
                className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
              >
                <UserPlusIcon className="h-3.5 w-3.5" />
                新增账号
              </button>
            </div>

            {showNewAccount && (
              <div className="space-y-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="登录用户名" required>
                    <input className={inputCls} placeholder="字母数字及 _.-" value={newAccount.username} onChange={(e) => setNewAccount((a) => ({ ...a, username: e.target.value }))} />
                  </Field>
                <Field label="账号姓名" required>
                  <input className={inputCls} value={newAccount.name} onChange={(e) => setNewAccount((a) => ({ ...a, name: e.target.value }))} />
                </Field>
              </div>
              <Field label="登录手机号" required>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={newAccount.phone}
                  onChange={(e) => setNewAccount((a) => ({ ...a, phone: e.target.value.replace(/\D/g, '').slice(0, 11) }))}
                />
              </Field>
              <Field label="初始密码(至少 8 位)" required>
                  <input type="password" autoComplete="new-password" className={inputCls} value={newAccount.password} onChange={(e) => setNewAccount((a) => ({ ...a, password: e.target.value }))} />
                </Field>
                <div className="flex justify-end">
                  <button
                    onClick={addAccount}
                    disabled={
                      saving ||
                      newAccount.username.trim().length < 3 ||
                      newAccount.password.length < 8 ||
                      !newAccount.name.trim() ||
                      !/^1[3-9]\d{9}$/.test(newAccount.phone)
                    }
                    className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    创建账号
                  </button>
                </div>
              </div>
            )}

            {detail.accounts.length === 0 ? (
              <p className="rounded-lg bg-neutral-50 py-6 text-center text-xs text-neutral-400">该机构暂无后台账号</p>
            ) : (
              <div className="divide-y divide-neutral-900/[0.06] rounded-lg border border-neutral-100">
                {detail.accounts.map((account) => (
                  <div key={account.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-neutral-800">{account.name}</p>
                      <p className="font-mono text-xs text-neutral-400">{account.username}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-neutral-500">
                        <SmartphoneIcon className="h-3.5 w-3.5" />
                        {account.phoneMasked ?? '未绑定手机号'}
                      </p>
                    </div>
                    <StatusBadge dot status={account.enabled ? 'success' : 'default'} label={account.enabled ? '启用' : '已停用'} />
                    <StatusBadge dot status={account.phoneVerifiedAt ? 'success' : 'warning'} label={account.phoneVerifiedAt ? '手机号已验证' : '待验证'} />
                    {!account.phoneVerifiedAt && account.phoneMasked && (
                      <span className="max-w-[130px] text-xs leading-5 text-neutral-400">
                        账号本人登录后验证
                      </span>
                    )}
                    <button
                      onClick={() => { setResetTarget(account); setResetPassword('') }}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                    >
                      <KeyRoundIcon className="h-3.5 w-3.5" />
                      重置密码
                    </button>
                    <TwoStepButton
                      label={account.enabled ? '停用' : '启用'}
                      confirmLabel={account.enabled ? '确认停用?' : '确认启用?'}
                      className={account.enabled ? 'text-warning-fg hover:bg-warning-bg' : 'text-success-fg hover:bg-success-bg'}
                      confirmClassName={account.enabled ? 'bg-warning text-white' : 'bg-success text-white'}
                      onConfirm={() => void toggleAccount(account)}
                      disabled={accountBusy === account.id}
                    />
                  </div>
                ))}
              </div>
            )}

            {resetTarget && (
              <div className="space-y-3 rounded-lg border border-warning/20 bg-warning-bg p-3">
                <p className="text-xs font-medium text-warning-fg">重置「{resetTarget.name}({resetTarget.username})」的登录密码</p>
                <input
                  type="password"
                  autoComplete="new-password"
                  className={inputCls}
                  placeholder="新密码(至少 8 位)"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setResetTarget(null)} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-surface">取消</button>
                  <button
                    onClick={doResetPassword}
                    disabled={saving || resetPassword.length < 8}
                    className="rounded-lg bg-warning px-3 py-1.5 text-xs font-medium text-white hover:bg-warning/90 disabled:opacity-50"
                  >
                    确认重置
                  </button>
                </div>
                <p className="text-xs text-warning-fg">新密码仅单向提交,系统不回显;请线下安全告知。</p>
              </div>
            )}

          </div>

          <p className="text-xs text-neutral-400">
            机构信息编辑、账号操作均记录审计日志。停用机构后:机构账号无法登录、数据导入接口拒绝;已发布数据不自动下架,如需下架请到岗位/招聘会信息源逐条操作。
          </p>
        </div>
      )}
    </Drawer>
  )
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export default function PartnersPage() {
  const [orgs, setOrgs] = useState<AdminOrgListItem[]>([])
  const [listState, setListState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('全部')
  const [typeFilter, setTypeFilter] = useState<PartnerType | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [detailOrgId, setDetailOrgId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)

  const load = useCallback(async () => {
    setListState('loading')
    try {
      setOrgs(await orgsAdminService.listOrgs())
      setListState('ready')
    } catch {
      setListState('error')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggleOrg = async (org: AdminOrgListItem) => {
    setBusyId(org.id)
    try {
      await orgsAdminService.setOrgStatus(org.id, org.enabled ? 'disable' : 'enable')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const filtered = orgs.filter((o) => {
    const matchStatus =
      statusFilter === '全部' || (statusFilter === '合作中' ? o.enabled : !o.enabled)
    const matchType = typeFilter === null || o.type === typeFilter
    return matchStatus && matchType
  })

  const searched = search.trim()
    ? filtered.filter((o) => o.name.includes(search) || (o.contact ?? '').includes(search))
    : filtered

  const total = searched.length
  const paginated = searched.slice((page - 1) * pageSize, page * pageSize)

  const statusCounts = {
    全部: orgs.length,
    合作中: orgs.filter((o) => o.enabled).length,
    已停用: orgs.filter((o) => !o.enabled).length,
  }

  const TYPE_FILTERS: Array<{ label: string; value: PartnerType | null }> = [
    { label: '全部类型', value: null },
    ...Object.entries(PARTNER_TYPE_LABELS).map(([value, label]) => ({ label, value: value as PartnerType })),
  ]

  return (
    <Page
      title="合作机构管理"
      subtitle={`共 ${orgs.length} 家合作机构 — 机构档案 · 授权启停 · 后台账号`}
      actions={
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          <PlusIcon className="h-4 w-4" />
          新增机构
        </button>
      }
    >
      {listState === 'loading' && <LoadingState className="py-24" />}
      {listState === 'error' && <ErrorState className="py-24" onRetry={() => void load()} />}

      {listState === 'ready' && (
        <>
          {/* 双行筛选 */}
          <div className="mb-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs text-neutral-400">合作状态</span>
              <div className="flex gap-2">
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f}
                    onClick={() => { setStatusFilter(f); setPage(1) }}
                    className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                      statusFilter === f ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-900/10 bg-surface text-neutral-700 hover:border-primary-600/40'
                    }`}
                  >
                    {f}
                    <span className="ml-1 text-xs opacity-70">{statusCounts[f]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs text-neutral-400">机构类型</span>
              <div className="flex flex-wrap gap-2">
                {TYPE_FILTERS.map((f) => (
                  <button
                    key={f.label}
                    onClick={() => { setTypeFilter(f.value); setPage(1) }}
                    className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                      typeFilter === f.value ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-900/10 bg-surface text-neutral-700 hover:border-primary-600/40'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative mt-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索机构名称、联系人..."
                className="h-8 w-64 rounded-lg border border-neutral-200 bg-surface pl-8 pr-3 text-xs text-neutral-700 placeholder-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200"
              />
              <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
            </div>
          </div>

          {/* 表格 */}
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {['机构名称', '机构类型', '场景模板', '启用模块', '联系人', '状态', '账号', '数据源', '岗位', '招聘会', '加入时间', '操作'].map((h) => (
                      <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900/[0.06]">
                  {paginated.length === 0 ? (
                    <tr>
                      <td colSpan={12}>
                        <EmptyState
                          title={search ? '未找到匹配的机构' : '暂无合作机构'}
                          description={search ? '请尝试其他关键词' : '点击右上角"新增机构"录入第一家合作机构'}
                          icon={Building2Icon}
                          className="py-12"
                        />
                      </td>
                    </tr>
                  ) : (
                    paginated.map((o) => (
                      <tr key={o.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-3 font-medium text-neutral-800">{o.name}</td>
                        <td className="px-4 py-3">
                          <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${PARTNER_TYPE_STYLES[o.type] ?? 'bg-neutral-100 text-neutral-600'}`}>
                            {PARTNER_TYPE_LABELS[o.type as PartnerType] ?? o.type}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {o.sceneTemplate ? (
                            <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${SCENE_TEMPLATE_STYLES[o.sceneTemplate] ?? 'bg-neutral-100 text-neutral-500'}`}>
                              {SCENE_TEMPLATE_LABELS[o.sceneTemplate as SceneTemplate] ?? o.sceneTemplate}
                            </span>
                          ) : (
                            <span className="text-xs text-neutral-400">未设置</span>
                          )}
                        </td>
                        <td className="max-w-56 px-4 py-3">
                          <span className="line-clamp-2 text-xs text-neutral-500">
                            {o.enabledModules.length > 0
                              ? o.enabledModules.map((m) => MODULE_LABELS[m as keyof typeof MODULE_LABELS] ?? m).join(' · ')
                              : '—'}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-neutral-700">
                          {o.contact ?? '—'}
                          {o.contactPhone && <span className="ml-1.5 font-mono text-xs text-neutral-400">{o.contactPhone}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge dot status={o.enabled ? 'success' : 'error'} label={o.enabled ? '合作中' : '已停用'} />
                        </td>
                        <td className="px-4 py-3 text-center text-neutral-700">{o.counts.accounts}</td>
                        <td className="px-4 py-3 text-center text-neutral-700">{o.counts.sources}</td>
                        <td className="px-4 py-3 text-center text-neutral-700">{o.counts.jobs}</td>
                        <td className="px-4 py-3 text-center text-neutral-700">{o.counts.fairs}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-400">{o.createdAt.slice(0, 10)}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setDetailOrgId(o.id)}
                              className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                            >
                              详情/账号
                            </button>
                            <TwoStepButton
                              label={o.enabled ? '停用' : '启用'}
                              confirmLabel={o.enabled ? '确认停用?' : '确认启用?'}
                              className={o.enabled ? 'text-warning-fg hover:bg-warning-bg' : 'text-success-fg hover:bg-success-bg'}
                              confirmClassName={o.enabled ? 'bg-warning text-white' : 'bg-success text-white'}
                              onConfirm={() => void toggleOrg(o)}
                              disabled={busyId === o.id}
                            />
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination total={total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1) }} />
          </Card>

          <p className="mt-3 text-xs text-neutral-400">
            合作机构是外部岗位/招聘会/政策数据的来源方。停用机构 = 该机构账号禁止登录 + 数据导入接口拒绝(已发布数据需到信息源逐条下架)。所有操作记录审计日志;不存在企业招聘端,不接收求职者简历。
          </p>
        </>
      )}

      <CreateOrgDrawer open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => void load()} />
      <OrgDetailDrawer
        orgId={detailOrgId}
        open={detailOrgId !== null}
        onClose={() => setDetailOrgId(null)}
        onChanged={() => void load()}
      />
    </Page>
  )
}
