import { Button, Card } from '@ai-job-print/ui'

interface ResumeAiConsentDialogProps {
  busy: boolean
  error: string | null
  guest: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** 简历类 AI（诊断 / 优化 / 生成）首次确认。会员入库，游客只记本机会话。 */
export function ResumeAiConsentDialog({
  busy,
  error,
  guest,
  onCancel,
  onConfirm,
}: ResumeAiConsentDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resume-ai-consent-title"
    >
      <Card className="w-[32rem] max-w-full p-6 shadow-xl">
        <h2 id="resume-ai-consent-title" className="text-lg font-semibold text-neutral-900">
          确认使用简历 AI
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-neutral-600">
          诊断、优化和生成会把你上传或填写的简历内容发送到服务端大模型进行分析。
        </p>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          结果只给你本人看，不会发送给企业或合作机构，也不进入平台候选人简历库。
        </p>
        <p className="mt-2 text-sm leading-relaxed text-neutral-500">
          {guest
            ? '本次确认只在本机这次使用期间有效，不会写入账号。'
            : '授权保存在你的会员账号中，可随时在隐私设置撤回。'}
        </p>
        {error && (
          <p className="mt-4 rounded-xl bg-error-bg px-4 py-3 text-sm text-error-fg" aria-live="polite">
            {error}
          </p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button size="lg" variant="secondary" className="min-h-14" disabled={busy} onClick={onCancel}>
            暂不使用
          </Button>
          <Button size="lg" className="min-h-14" disabled={busy} onClick={onConfirm}>
            {busy ? '正在确认…' : '同意并继续'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
