import { Button, Card } from '@ai-job-print/ui'
import { AlertCircleIcon, ShieldCheckIcon, SparklesIcon, XIcon } from 'lucide-react'

export function JobAiConsentModal({
  open,
  loading,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean
  loading?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" role="dialog" aria-modal="true">
      <Card className="relative w-[30rem] max-w-full p-6">
        <button
          type="button"
          onClick={onCancel}
          aria-label="关闭"
          className="absolute right-4 top-4 rounded-full p-1 text-neutral-400 hover:bg-neutral-100"
        >
          <XIcon className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
          <SparklesIcon className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-neutral-900">开启岗位 AI 辅助</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          本系统会基于你的本人简历和岗位来源字段生成岗位解读、匹配参考和准备建议，结果仅供求职参考，不代表录用结果。
        </p>

        <div className="mt-4 space-y-2 rounded-xl bg-neutral-50 px-4 py-3">
          <ConsentLine text="分析结果只展示给当前登录的求职者本人。" />
          <ConsentLine text="绝不向企业共享或推荐您的简历。" />
          <ConsentLine text="不会提供平台内投递、企业端筛选流程或录用承诺。" />
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-error-bg px-4 py-3 text-sm text-error-fg">
            <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button size="lg" variant="secondary" className="h-12" disabled={loading} onClick={onCancel}>
            取消
          </Button>
          <Button size="lg" className="h-12" disabled={loading} onClick={onConfirm}>
            <ShieldCheckIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />
            同意并继续
          </Button>
        </div>
      </Card>
    </div>
  )
}

function ConsentLine({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-xs leading-relaxed text-neutral-500">
      <ShieldCheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-500" aria-hidden="true" />
      <span>{text}</span>
    </div>
  )
}
