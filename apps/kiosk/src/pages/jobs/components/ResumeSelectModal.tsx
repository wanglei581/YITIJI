import { useEffect, useMemo, useState } from 'react'
import { Button, EmptyState, KioskModal } from '@ai-job-print/ui'
import type { MemberResumeItem } from '@ai-job-print/shared'
import { CheckCircle2Icon, FileSearchIcon, Loader2Icon } from 'lucide-react'
import { getMyResumes } from '../../../services/api/memberAssets'

export function ResumeSelectModal({
  open,
  token,
  onClose,
  onSelect,
  onUpload,
}: {
  open: boolean
  token: string | null
  onClose: () => void
  onSelect: (resume: MemberResumeItem) => void
  onUpload: () => void
}) {
  const [items, setItems] = useState<MemberResumeItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !token) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getMyResumes(token, { pageSize: 50 })
      .then((page) => {
        if (!cancelled) setItems(page.items)
      })
      .catch(() => {
        if (!cancelled) setError('简历列表读取失败，请稍后重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, token])

  const usable = useMemo(
    () => items.filter((item) => item.kind === 'parse' && item.status === 'completed'),
    [items],
  )

  return (
    <KioskModal
      open={open}
      onClose={onClose}
      title="选择用于分析的简历"
      description="仅展示本人已完成诊断的简历元数据，不展示简历原文。"
      className="max-h-[86vh] w-[34rem] max-w-full"
      actions={(
        <>
          <Button size="lg" variant="secondary" className="h-12 flex-1" onClick={onClose}>取消</Button>
          <Button size="lg" className="h-12 flex-1" onClick={() => { onClose(); onUpload() }}>去上传简历</Button>
        </>
      )}
    >
        <div className="mt-4 min-h-[12rem] overflow-y-auto">
          {loading ? (
            <div className="flex min-h-[12rem] items-center justify-center gap-2 text-sm text-neutral-400">
              <Loader2Icon className="h-5 w-5 animate-spin" aria-hidden="true" />
              正在读取本人简历…
            </div>
          ) : error ? (
            <p className="rounded-xl bg-error-bg px-4 py-3 text-sm text-error-fg">{error}</p>
          ) : usable.length === 0 ? (
            <EmptyState
              icon={FileSearchIcon}
              title="暂无可用于岗位 AI 的简历"
              description="请先上传简历并完成诊断，再回到岗位信息使用 AI 推荐和匹配参考。"
              className="py-8"
            />
          ) : (
            <div className="space-y-2">
              {usable.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item)}
                  className="flex min-h-[64px] w-full items-center gap-3 rounded-xl border border-neutral-100 bg-white px-4 py-3 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/40"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                    <FileSearchIcon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-neutral-900">上传诊断简历</span>
                    <span className="mt-0.5 block truncate text-xs text-neutral-400">
                      任务 {item.taskId.slice(0, 8)} · {new Date(item.createdAt).toLocaleString('zh-CN')}
                    </span>
                  </span>
                  <CheckCircle2Icon className="h-5 w-5 shrink-0 text-primary-500" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>

    </KioskModal>
  )
}
