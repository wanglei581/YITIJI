// 【停放，2026-09-29，next-tasks 3.15】源码保留，不注册、不打包：本文件不被任何页面 import。
// 管理员对招聘会的「审核通过 / 拒绝 / 发布 / 下架」原本写在 fair-sources/index.tsx 的操作列里。
// 托管 a 下本平台不代审、不代发招聘内容，前端不论托管开关一律不给这组按钮；
// 服务端对这些接口目前仍只在托管关闭时回 403（本批不改服务端）。
// b 版本恢复时由 fair-sources/index.tsx 引入 FairSourceReviewActions，放回操作列「查看」之后，
// 并把页头批量发布（components/BulkPublishButton.tsx，同样停放）挂回去。是否删除本文件等产品负责人确认。
//
// 渲染条件与后端契约的对应关系由 apps/admin/scripts/verify-source-publish-actions.mjs 在
// ReviewStatus × PublishStatus 全矩阵上求值（2026-08-16「下架后发布不出来」事故的回归），改守卫前先看那里。
import { useState } from 'react'
import type { AdminFairSourceRecord } from '../../services/api'
import { approveFairSource, publishFairSource, rejectFairSource, unpublishFairSource } from '../../services/api'
import { userMessageOf } from '../../services/api/userErrorMessage'

export function FairSourceReviewActions({
  row,
  onReload,
  onError,
}: {
  row: AdminFairSourceRecord
  onReload: () => void
  /** 失败原因交给页面顶部的错误条展示；null 表示清空 */
  onError: (message: string | null) => void
}) {
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const handleApprove = () => {
    onError(null)
    void approveFairSource(row.id)
      .then(() => onReload())
      .catch((e) => onError(userMessageOf(e, '审核通过失败，请查看原因后重试')))
  }

  const handleReject = () => {
    if (!rejectReason.trim()) return
    onError(null)
    void rejectFairSource(row.id, rejectReason.trim())
      .then(() => {
        setRejecting(false)
        setRejectReason('')
        onReload()
      })
      .catch((e) => onError(userMessageOf(e, '驳回失败，请稍后重试')))
  }

  const handlePublish = () => {
    onError(null)
    void publishFairSource(row.id)
      .then(() => onReload())
      .catch((e) => onError(userMessageOf(e, '发布失败，请查看原因后重试')))
  }

  const handleUnpublish = () => {
    if (!window.confirm(`确认下架「${row.name}」？下架后一体机不再展示该招聘会。`)) return
    onError(null)
    void unpublishFairSource(row.id)
      .then(() => onReload())
      .catch((e) => onError(userMessageOf(e, '下架失败，请稍后重试')))
  }

  if (rejecting) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          className="h-7 w-40 rounded border border-error/30 px-2 text-xs focus:border-red-400 focus:outline-none"
          placeholder="拒绝原因(必填)"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
        <button
          type="button"
          onClick={handleReject}
          disabled={!rejectReason.trim()}
          className="rounded bg-error px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          确认
        </button>
        <button
          type="button"
          onClick={() => { setRejecting(false); setRejectReason('') }}
          className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
        >
          取消
        </button>
      </div>
    )
  }

  return (
    <>
      {(row.reviewStatus === 'pending' || row.reviewStatus === 'reviewing') && (
        <>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs font-medium text-success-fg hover:bg-success-bg"
            onClick={handleApprove}
          >
            审核通过
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs font-medium text-error-fg hover:bg-error-bg"
            onClick={() => { setRejecting(true); setRejectReason('') }}
          >
            拒绝
          </button>
        </>
      )}
      {row.reviewStatus === 'approved' && row.publishStatus !== 'published' && (
        <button
          type="button"
          className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
          onClick={handlePublish}
        >
          发布
        </button>
      )}
      {row.publishStatus === 'published' && (
        <button
          type="button"
          className="rounded px-2 py-1 text-xs font-medium text-warning-fg hover:bg-warning-bg"
          onClick={handleUnpublish}
        >
          下架
        </button>
      )}
    </>
  )
}
