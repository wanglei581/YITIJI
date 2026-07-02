import { useCallback, useEffect, useState } from 'react'
import { Card, Drawer, ErrorState, LoadingState } from '@ai-job-print/ui'
import { GhostButton, InlineError, InlineSuccess, PrimaryButton } from '../../../components/form'
import { EMPTY_FORM, detailToForm, errMsg, fmtDateTime, formToFields, validateForm, type CompanyFormState } from './shared'
import { companiesAdminService, type AdminCompanyDetail } from '../../../services/api/companiesAdmin'
import { CompanyFormFields } from './CompanyFormFields'
import { LinkedJobsSection } from './LinkedJobsSection'
import { ReviewPublishSection } from './ReviewPublishSection'

export function CompanyDetailDrawer({
  companyId,
  onClose,
  onChanged,
}: {
  companyId: string | null
  onClose: () => void
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<AdminCompanyDetail | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [form, setForm] = useState<CompanyFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)

  const load = useCallback(async (id: string, resetForm: boolean) => {
    if (resetForm) setState('loading')
    try {
      const d = await companiesAdminService.getCompany(id)
      setDetail(d)
      if (resetForm) {
        setForm(detailToForm(d))
        setSaveError(null)
        setSaveSuccess(null)
      }
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])

  useEffect(() => {
    if (companyId) void load(companyId, true)
  }, [companyId, load])

  /** 审核/发布/岗位关联变更后：刷新详情（保留正在编辑的表单内容）+ 通知列表刷新。 */
  const mutated = useCallback(() => {
    if (companyId) void load(companyId, false)
    onChanged()
  }, [companyId, load, onChanged])

  const save = async () => {
    if (!detail) return
    const invalid = validateForm(form)
    if (invalid) {
      setSaveError(invalid)
      setSaveSuccess(null)
      return
    }
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(null)
    try {
      const updated = await companiesAdminService.updateCompany(detail.id, formToFields(form))
      setDetail(updated)
      setForm(detailToForm(updated))
      setSaveSuccess('保存成功')
      onChanged()
    } catch (e) {
      setSaveError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={companyId !== null}
      onClose={onClose}
      title={detail?.name ?? '企业详情'}
      size="lg"
      footer={
        state === 'ready' ? (
          <div className="flex justify-end gap-2">
            <GhostButton onClick={onClose} disabled={saving}>关闭</GhostButton>
            <PrimaryButton onClick={() => void save()} disabled={saving || !form.name.trim()}>
              {saving ? '保存中…' : '保存展示信息'}
            </PrimaryButton>
          </div>
        ) : undefined
      }
    >
      {state === 'loading' && <LoadingState className="py-24" />}
      {state === 'error' && companyId && <ErrorState className="py-24" onRetry={() => void load(companyId, true)} />}
      {state === 'ready' && detail && (
        <div className="space-y-4">
          {/* 来源信息（合规：可溯源，不可修改） */}
          <Card className="p-4">
            <p className="mb-2 text-sm font-medium text-gray-700">来源信息（不可修改，保持数据可溯源）</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
              <p>来源机构：{detail.sourceName}</p>
              <p>外部编号：{detail.externalId}</p>
              <p>同步时间：{fmtDateTime(detail.syncTime)}</p>
              <p>最近更新：{fmtDateTime(detail.updatedAt)}</p>
            </div>
          </Card>

          <ReviewPublishSection detail={detail} onMutated={mutated} />

          {/* 展示信息编辑 */}
          <Card className="space-y-4 p-4">
            <p className="text-sm font-medium text-gray-700">展示信息</p>
            <InlineError message={saveError} />
            <InlineSuccess message={saveSuccess} />
            <CompanyFormFields form={form} onChange={setForm} />
          </Card>

          <LinkedJobsSection detail={detail} onMutated={mutated} />

          <p className="text-xs text-gray-400">
            企业展示仅作为来源企业与岗位的导览信息；系统不接收求职者简历，求职者通过既有「去来源平台投递 / 扫码投递」入口跳转外部来源平台。所有修改操作均记录审计日志。
          </p>
        </div>
      )}
    </Drawer>
  )
}
