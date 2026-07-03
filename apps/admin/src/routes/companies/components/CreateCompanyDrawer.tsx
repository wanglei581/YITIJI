import { useEffect, useState } from 'react'
import { Drawer } from '@ai-job-print/ui'
import { Field, GhostButton, InlineError, PrimaryButton } from '../../../components/form'
import { EMPTY_FORM, errMsg, formToFields, inputCls, stripNulls, validateForm, type CompanyFormState } from './shared'
import { companiesAdminService } from '../../../services/api/companiesAdmin'
import { orgsAdminService, type AdminOrgListItem } from '../../../services/api/orgsAdmin'
import { CompanyFormFields } from './CompanyFormFields'

export function CreateCompanyDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [orgs, setOrgs] = useState<AdminOrgListItem[]>([])
  const [orgsState, setOrgsState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [sourceOrgId, setSourceOrgId] = useState('')
  const [externalId, setExternalId] = useState('')
  const [form, setForm] = useState<CompanyFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSourceOrgId('')
    setExternalId('')
    setForm(EMPTY_FORM)
    setError(null)
    setOrgsState('loading')
    orgsAdminService.listOrgs()
      .then((rows) => {
        setOrgs(rows.filter((o) => o.enabled))
        setOrgsState('ready')
      })
      .catch(() => setOrgsState('error'))
  }, [open])

  const create = async () => {
    const invalid = !sourceOrgId.trim()
      ? '请选择来源机构'
      : !externalId.trim()
        ? '请填写外部编号'
        : validateForm(form)
    if (invalid) {
      setError(invalid)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created = await companiesAdminService.createCompany({
        ...stripNulls(formToFields(form)),
        sourceOrgId: sourceOrgId.trim(),
        externalId: externalId.trim(),
        name: form.name.trim(),
      })
      onCreated(created.id)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="新增企业"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <GhostButton onClick={onClose} disabled={saving}>取消</GhostButton>
          <PrimaryButton onClick={() => void create()} disabled={saving || !sourceOrgId.trim() || !externalId.trim() || !form.name.trim()}>
            {saving ? '创建中…' : '创建（待审核）'}
          </PrimaryButton>
        </div>
      }
    >
      <div className="space-y-4">
        <InlineError message={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="来源机构" required hint="企业必须挂在真实来源机构下，保持数据可溯源">
            {orgsState === 'error' ? (
              <input
                className={inputCls}
                placeholder="机构列表加载失败，请直接填写机构 ID"
                value={sourceOrgId}
                onChange={(e) => setSourceOrgId(e.target.value)}
              />
            ) : (
              <select className={inputCls} value={sourceOrgId} onChange={(e) => setSourceOrgId(e.target.value)} disabled={orgsState === 'loading'}>
                <option value="">{orgsState === 'loading' ? '加载机构中…' : '请选择来源机构'}</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="外部编号" required hint="来源机构侧的企业唯一标识">
            <input className={inputCls} value={externalId} onChange={(e) => setExternalId(e.target.value)} />
          </Field>
        </div>
        <CompanyFormFields form={form} onChange={setForm} />
        <p className="text-xs text-neutral-400">新建企业默认为「待审核 + 草稿」，审核通过并发布后才在一体机展示。</p>
      </div>
    </Drawer>
  )
}
