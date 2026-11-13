import { useState, type ReactNode } from 'react'
import { helpNeededLine, type PublicSupportContact } from '../../../copy/unattendedCopy'
import type { PaymentFact } from '../printProgressModel'
import { CONTACT_ENTRY_LABEL } from './printContactEntry'

/** 进度页的补充说明。静默或异常时展开处理方法，不据此判定打印成败。 */
export function PrintProgressHelp({ quiet, abnormal, payment, support, onHelp, onContact, children }: {
  quiet: boolean
  abnormal: boolean
  payment: PaymentFact
  support: PublicSupportContact
  onHelp: () => void
  onContact?: () => void
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(quiet || abnormal)
  return (
    <div className="pfp-guidance">
      <div className="pfp-help-controls">
        <button type="button" className="pfp-faq-toggle" aria-expanded={expanded} aria-controls="print-progress-faq" onClick={() => setExpanded(!expanded)}>
          遇到这些情况怎么办
        </button>
        <details className="pfp-privacy">
          <summary>你的文件，走完就清 · 打印期间不会清空</summary>
          <div className="pfp-privacy-body">
            <p>全部打完、你拿走之后，才开始这次办理清空计时。倒计时不是催你走，你可以核对完再离开。</p>
            {children}
          </div>
        </details>
        <button type="button" className="qxt-btn qxt-btn-sec pff-help-btn" data-testid="print-fulfill-primary" onClick={onHelp}>使用帮助</button>
      </div>
      {expanded ? (
        <ul className="pfp-help-faq" id="print-progress-faq" aria-label="常见情况处理">
          <li><b>打印机缺纸 / 卡纸</b>：别硬拉纸；设备报告后，结果页会说明原因。</li>
          <li><b>长时间没有新进度</b>：先看出纸口；久未取得结果时，本页会另行提示。</li>
          <li><b>文件校验未通过</b>：上传可能中断或文件已变化，需返回重新上传。</li>
          <li>{payment === 'paid'
            ? <><b>已支付但打印失败</b>：订单与支付记录都在；退款以订单记录为准，本机不承诺自动退款。</>
            : <><b>打印失败</b>：订单记录保留。</>}</li>
          <li><b>没出全或有疑问</b>：别硬拉纸，可查看使用帮助或拨打服务电话。</li>
        </ul>
      ) : null}
      <div className="pfp-support" data-testid="print-fulfill-fallback">
        {!quiet ? <p>{helpNeededLine(support)}。</p> : null}
        {onContact ? <button type="button" className="pfp-contact" onClick={onContact}>{CONTACT_ENTRY_LABEL}</button> : null}
      </div>
    </div>
  )
}
