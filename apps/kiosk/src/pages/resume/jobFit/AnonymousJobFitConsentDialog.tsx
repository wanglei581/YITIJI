import { Button, Card } from '@ai-job-print/ui'

interface AnonymousJobFitConsentDialogProps {
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

/** 匿名用户在服务端 fail-closed 后自行决定是否允许一次岗位匹配分析。 */
export function AnonymousJobFitConsentDialog({
  busy,
  error,
  onCancel,
  onConfirm,
}: AnonymousJobFitConsentDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="job-fit-anonymous-consent-title"
    >
      <Card className="w-[30rem] max-w-full p-6 shadow-xl">
        <h2 id="job-fit-anonymous-consent-title" className="text-lg font-semibold text-neutral-900">
          确认岗位匹配授权
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-neutral-600">
          本次岗位匹配参考会使用本次简历诊断内容，帮助你准备简历和投递材料。
        </p>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          分析结果和授权状态按简历诊断到期策略保存；你可随时撤回后续分析授权。
        </p>
        <p className="mt-2 text-sm leading-relaxed text-neutral-500">
          分析结果仅供本人参考，不代表任何招聘结果，也不会向企业共享简历。
        </p>
        {error && <p className="mt-4 rounded-xl bg-error-bg px-4 py-3 text-sm text-error-fg" aria-live="polite">{error}</p>}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button size="lg" variant="secondary" className="h-12" disabled={busy} onClick={onCancel}>
            暂不授权
          </Button>
          <Button size="lg" className="h-12" disabled={busy} onClick={onConfirm}>
            {busy ? '授权并分析中…' : '同意并继续'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
