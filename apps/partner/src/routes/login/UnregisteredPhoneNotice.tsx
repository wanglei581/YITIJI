import { XIcon } from 'lucide-react'

/**
 * 平台代开、还没登记手机号，且登录回包明确不能在这里自己验证时的指路。
 * 沿用「账号已登录」弹窗和「进入工作台」；有手机号的弹窗仍在 index.tsx，一字不改。
 * 两句是合规四 2026-10-10 定稿，须逐字保留。
 */
export function UnregisteredPhoneNotice({ onClose }: { onClose: () => void }) {
  return (
    <div className="c-modal" role="dialog" aria-modal="true" aria-label="账号已登录">
      <div className="c-modal-card">
        <div className="c-modal-head">
          <div>
            <h3>账号已登录</h3>
            <p>这个账号是平台代为开通的，暂时不能在这里自己验证手机号。</p>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="关闭提示并进入工作台">
            <XIcon size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="c-modal-foot">
          平台登记了你的手机号之后，回到登录页点「忘记密码」，用这个手机号收验证码、设置你自己的密码，验证就完成了。还没有登记，或者收不到验证码的，请联系平台运营，提交盖章的《账号联系人确认函》（写明联系人姓名和手机号）。
        </div>
        <button type="button" className="c-cta ripple-host" onClick={onClose}>
          <span className="label">进入工作台</span>
        </button>
      </div>
    </div>
  )
}
