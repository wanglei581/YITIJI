import { XIcon } from 'lucide-react'

export function PhoneVerificationGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="c-modal" role="dialog" aria-modal="true" aria-label="手机号本人验证">
      <div className="c-modal-card">
        <div className="c-modal-head">
          <div>
            <h3>手机号本人验证</h3>
            <p>这个账号是平台代为开通的，还没有登记使用人的手机号，暂时不能在这里自己验证。</p>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="稍后验证">
            <XIcon size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="c-modal-foot">
          请联系平台运营，提交盖章的《账号联系人确认函》（写明联系人姓名和手机号），由平台登记这个手机号。登记后回到登录页点「忘记密码」，用这个手机号收验证码、设置你自己的密码，验证就完成了。
        </div>
        <div className="c-modal-foot">
          在这之前，仍可用账号和密码登录、正常使用后台；手机号登录和自助找回密码暂时用不了。
        </div>
        <button type="button" className="c-cta ripple-host" onClick={onClose}>
          <span className="label">知道了，进入工作台</span>
        </button>
      </div>
    </div>
  )
}
