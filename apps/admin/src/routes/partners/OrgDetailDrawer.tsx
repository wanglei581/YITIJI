import { sceneFieldsForType } from './orgFormState'
import { useCallback, useEffect, useState } from 'react'
import { PARTNER_TYPE_LABELS } from '@ai-job-print/shared'
import { Drawer, LoadingState, ErrorState } from '@ai-job-print/ui'
import { orgsAdminService, type AdminOrgDetail, type UpdateOrgInput } from '../../services/api/orgsAdmin'
import { inputCls, Field, InlineError, ModulesPicker, SceneTemplateReadonly } from './orgFormParts'
import { PartnerAccountManager } from './PartnerAccountManager'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { OrgContentTrustPanel } from './OrgContentTrustPanel'
import { OrgCircuitBreakPanel } from './OrgCircuitBreakPanel'
import { OrgOfficialChannelSections } from './OrgOfficialChannelSections'
import { OrgQualificationSection } from './OrgQualificationSection'
import { editOrgTypeOptions, isParkedOrgType } from './orgTypeOptions'

export function OrgDetailDrawer({
  orgId,
  open,
  showRecruitment,
  onClose,
  onChanged,
}: {
  orgId: string | null
  open: boolean
  showRecruitment: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<AdminOrgDetail | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [form, setForm] = useState<UpdateOrgInput>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profileSaved, setProfileSaved] = useState(false)

  const load = useCallback(async (showLoading = true) => {
    if (!orgId) return
    if (showLoading) setState('loading')
    try {
      const d = await orgsAdminService.getOrgDetail(orgId)
      setDetail(d)
      setForm({
        name: d.name,
        type: d.type,
        contact: d.contact ?? '',
        contactPhone: d.contactPhone ?? '',
        sceneTemplate: d.sceneTemplate,
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
      setProfileSaved(false)
      void load()
    }
  }, [open, load])

  const saveProfile = async () => {
    if (!orgId) return
    setSaving(true)
    setError(null)
    setProfileSaved(false)
    try {
      await orgsAdminService.updateOrg(orgId, {
        ...form,
        name: form.name?.trim(),
        contact: form.contact?.trim() ?? '',
        contactPhone: form.contactPhone?.trim() ?? '',
      })
      setProfileSaved(true)
      onChanged()
      await load()
    } catch (e) {
      setError(userMessageOf(e, '保存失败，请稍后重试'))
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
          <div className={`grid gap-2 ${showRecruitment ? 'grid-cols-4' : 'grid-cols-2'}`}>
            {[
              { label: '登录账号', value: detail.counts.accounts },
              { label: '数据源', value: detail.counts.sources },
              ...(showRecruitment
                ? [
                    { label: '岗位', value: detail.counts.jobs },
                    { label: '招聘会', value: detail.counts.fairs },
                  ]
                : []),
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
                {/* 3.15：存量停放类型保留当前值可原样保存，但不能改成另一类停放类型 */}
                <select
                  className={inputCls}
                  value={form.type ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value, ...sceneFieldsForType(e.target.value) }))}
                >
                  {editOrgTypeOptions(PARTNER_TYPE_LABELS, detail.type).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {isParkedOrgType(detail.type) && (
                  <span className="mt-1 block text-xs text-neutral-500">这一类已停放：可以保留原类型编辑其它信息，或改成其它类型；不能新建或改成已停放的类型。</span>
                )}
              </Field>
              <SceneTemplateReadonly sceneTemplate={form.sceneTemplate ?? null} />
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
              <ModulesPicker showRecruitment={showRecruitment} value={form.enabledModules ?? []} onChange={(modules) => setForm((f) => ({ ...f, enabledModules: modules }))} />
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
            {profileSaved && !error && (
              <p className="text-xs text-success-fg" role="status">机构档案已保存</p>
            )}
          </div>

          {/* 内容可信:发布闸门的人工入口。放在档案之后、账号之前 ——
              它决定这家机构的内容能不能对公众可见,比账号管理更靠前。 */}
          <OrgContentTrustPanel
            orgId={orgId ?? detail.id}
            onChanged={() => {
              onChanged()
              void load(false)
            }}
          />

          {/* 3.14 官方域名（入驻核验）+ 官方渠道（只读与紧急下架），与招聘内容托管开关无关 */}
          <OrgOfficialChannelSections orgId={orgId ?? detail.id} orgName={detail.name} />

          {/* 3.15 资质核验：从线下机构页（随整页停放）迁来，按机构 id 直接读，只读 + 取证留痕 */}
          <OrgQualificationSection organizationId={orgId ?? detail.id} />

          <PartnerAccountManager
            orgId={orgId ?? detail.id}
            accounts={detail.accounts}
            onReload={() => load(false)}
            onChanged={onChanged}
          />

          <OrgCircuitBreakPanel
            orgId={orgId ?? detail.id}
            orgName={detail.name}
            onChanged={() => {
              onChanged()
              void load(false)
            }}
          />

          <p className="text-xs text-neutral-400">
            机构信息编辑、账号操作均记录审计日志。停用机构后:机构账号无法登录、数据导入接口拒绝;已发布数据不自动下架,如需下架请到各信息源页逐条紧急下架,紧急情况可用上方「按机构熔断」。
          </p>
        </div>
      )}
    </Drawer>
  )
}

