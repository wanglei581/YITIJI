import { CheckIcon, CircleAlertIcon } from 'lucide-react'
import type { LegalDocKind } from './LegalDocsModal'

// 登录页的小零件：从 ./index.tsx 拆出（该页已近 800 行），行为不变。

export function ErrorBar({ message }: { message: string }) {
  return (
    <div className="c-error" role="alert">
      <CircleAlertIcon size={16} aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}

export function LoadingDots() {
  return (
    <span className="load">
      <i />
      <i />
      <i />
    </span>
  )
}

export function AgreementRow({
  agreed,
  onToggle,
  onOpenDoc,
}: {
  agreed: boolean
  onToggle: () => void
  onOpenDoc: (doc: LegalDocKind) => void
}) {
  return (
    <button type="button" className={`c-agree${agreed ? ' checked' : ''}`} onClick={onToggle} role="checkbox" aria-checked={agreed}>
      <span className="box">
        <CheckIcon size={13} aria-hidden="true" />
      </span>
      <span>
        我已阅读并同意
        <span
          className="doclink"
          role="link"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onOpenDoc('terms')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onOpenDoc('terms')
          }}
        >
          《用户服务协议》
        </span>
        和
        <span
          className="doclink"
          role="link"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onOpenDoc('privacy')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onOpenDoc('privacy')
          }}
        >
          《隐私政策》
        </span>
      </span>
    </button>
  )
}
