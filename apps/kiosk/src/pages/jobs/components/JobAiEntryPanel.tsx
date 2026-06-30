import { Button, Card } from '@ai-job-print/ui'
import { FileSearchIcon, Loader2Icon, SparklesIcon, ShieldCheckIcon } from 'lucide-react'

export function JobAiEntryPanel({
  title,
  clearLabel = '退出 AI 推荐',
  loading,
  hasResult,
  onStart,
  onClear,
}: {
  title: string
  clearLabel?: string
  loading: boolean
  hasResult: boolean
  onStart: () => void
  onClear: () => void
}) {
  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
            <SparklesIcon className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-500">
              基于本人已完成诊断的简历和已发布真实岗位生成参考建议。
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-400">
              <span className="inline-flex items-center gap-1">
                <ShieldCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
                不向企业共享简历
              </span>
              <span className="inline-flex items-center gap-1">
                <FileSearchIcon className="h-3.5 w-3.5" aria-hidden="true" />
                仅作求职准备参考
              </span>
            </div>
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-[1.25fr_1fr] lg:w-[26rem]">
          <Button size="lg" className="h-12 whitespace-nowrap px-3 text-sm" disabled={loading} onClick={onStart}>
            {loading ? <Loader2Icon className="mr-1.5 h-5 w-5 animate-spin" aria-hidden="true" /> : null}
            简历智能推荐
          </Button>
          <Button size="lg" variant="secondary" className="h-12 whitespace-nowrap px-3 text-sm" disabled={loading || !hasResult} onClick={onClear}>
            {clearLabel}
          </Button>
        </div>
      </div>
    </Card>
  )
}
