import { CheckIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

export interface MemberAgreementProps {
  agreed: boolean
  onAgreedChange: (agreed: boolean) => void
}

export function MemberAgreement({ agreed, onAgreedChange }: MemberAgreementProps) {
  return (
    <>
      <div className={`k-agree${agreed ? ' checked' : ''}`}>
        <button
          type="button"
          className="k-agree-check"
          onClick={() => onAgreedChange(!agreed)}
          role="checkbox"
          aria-checked={agreed}
        >
          <span className="box">
            <CheckIcon size={18} aria-hidden="true" />
          </span>
          <span>我已阅读并同意</span>
        </button>
        <span className="k-agree-docs">
          <Link className="doclink" to="/legal/terms">
            《用户服务协议》
          </Link>
          <span>与</span>
          <Link className="doclink" to="/legal/privacy">
            《隐私政策》
          </Link>
        </span>
      </div>
      {!agreed && <p className="k-agree-hint">勾选协议后可获取验证码并登录</p>}
    </>
  )
}
