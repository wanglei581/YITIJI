import { useCallback, useEffect, useState } from 'react'
import { Card, Drawer, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { GhostButton } from '../../../components/form'
import { JOB_CATEGORY_LABELS, PUBLISH_BADGE, REVIEW_BADGE, detailToForm, fmtDateTime } from './shared'
import { companiesAdminService, type AdminCompanyDetail } from '../../../services/api/companiesAdmin'
import { CompanyFormFields } from './CompanyFormFields'

/**
 * 企业详情抽屉（只读）。
 *
 * 3.15 起本平台不代审、不代发、不代改企业资料：保存展示信息、审核发布、关联 / 移除岗位
 * 不论托管开关一律停放，完整可写版本在同目录 CompanyDetailDrawerEditor.tsx（不被 import）。
 * 处置入口只有列表行上的「紧急下架」。
 */
export function CompanyDetailDrawer({
  companyId,
  onClose,
}: {
  companyId: string | null
  onClose: () => void
}) {
  const [detail, setDetail] = useState<AdminCompanyDetail | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')

  const load = useCallback(async (id: string) => {
    setState('loading')
    try {
      setDetail(await companiesAdminService.getCompany(id))
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])

  useEffect(() => {
    if (companyId) void load(companyId)
  }, [companyId, load])

  return (
    <Drawer
      open={companyId !== null}
      onClose={onClose}
      title={detail?.name ?? '企业详情'}
      size="lg"
      footer={
        state === 'ready' ? (
          <div className="flex justify-end">
            <GhostButton onClick={onClose}>关闭</GhostButton>
          </div>
        ) : undefined
      }
    >
      {state === 'loading' && <LoadingState className="py-24" />}
      {state === 'error' && companyId && <ErrorState className="py-24" onRetry={() => void load(companyId)} />}
      {state === 'ready' && detail && (
        <div className="space-y-4">
          {/* 来源信息（合规：可溯源，不可修改） */}
          <Card className="p-4">
            <p className="mb-2 text-sm font-medium text-neutral-700">来源信息（不可修改，保持数据可溯源）</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-500">
              <p>来源机构：{detail.sourceName}</p>
              <p>外部编号：{detail.externalId}</p>
              <p>同步时间：{fmtDateTime(detail.syncTime)}</p>
              <p>最近更新：{fmtDateTime(detail.updatedAt)}</p>
            </div>
          </Card>

          {/* 审核与发布状态（只读） */}
          <Card className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-neutral-700">审核与发布状态</p>
              <StatusBadge dot status={REVIEW_BADGE[detail.reviewStatus]?.status ?? 'default'} label={REVIEW_BADGE[detail.reviewStatus]?.label ?? detail.reviewStatus} />
              <StatusBadge dot status={PUBLISH_BADGE[detail.publishStatus]?.status ?? 'default'} label={PUBLISH_BADGE[detail.publishStatus]?.label ?? detail.publishStatus} />
            </div>
            {detail.reviewStatus === 'rejected' && detail.rejectReason && (
              <p className="rounded-lg bg-error-bg px-3 py-2 text-xs text-error-fg">拒绝原因：{detail.rejectReason}</p>
            )}
            <p className="text-xs text-neutral-500">本平台不代审、不代发企业资料；如有违法违规内容，请用列表中的「紧急下架」。</p>
          </Card>

          {/* 展示信息：fieldset 统一禁用，内容照常可读，但不能改 */}
          <Card className="space-y-4 p-4">
            <p className="text-sm font-medium text-neutral-700">展示信息</p>
            <fieldset disabled className="min-w-0">
              <CompanyFormFields form={detailToForm(detail)} onChange={() => undefined} />
            </fieldset>
          </Card>

          {/* 关联岗位（只读） */}
          <Card className="space-y-3 p-4">
            <p className="text-sm font-medium text-neutral-700">关联岗位（{detail.linkedJobsTotal}）</p>
            {detail.linkedJobs.length === 0 ? (
              <p className="rounded-lg bg-neutral-50 px-3 py-3 text-center text-xs text-neutral-400">暂无关联岗位</p>
            ) : (
              <>
                {detail.linkedJobsTotal > detail.linkedJobs.length && (
                  <p className="text-xs text-warning-fg">仅显示最近 {detail.linkedJobs.length} 条</p>
                )}
                <ul className="divide-y divide-neutral-900/[0.06] rounded-lg border border-neutral-100">
                  {detail.linkedJobs.map((j) => (
                    <li key={j.id} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-neutral-800">{j.title}</p>
                        <p className="text-xs text-neutral-400">
                          {j.city || '—'} · {j.category ? JOB_CATEGORY_LABELS[j.category] ?? j.category : '—'}
                        </p>
                      </div>
                      <StatusBadge dot status={PUBLISH_BADGE[j.publishStatus]?.status ?? 'default'} label={PUBLISH_BADGE[j.publishStatus]?.label ?? j.publishStatus} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <p className="text-xs text-neutral-400">
            企业展示仅作为来源企业与岗位的导览信息；系统不接收求职者简历，求职者通过既有「去来源平台投递 / 扫码投递」入口跳转外部来源平台。紧急下架记录审计日志。
          </p>
        </div>
      )}
    </Drawer>
  )
}
