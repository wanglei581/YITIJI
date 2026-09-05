import type { CSSProperties } from 'react'
import { ShieldAlertIcon } from 'lucide-react'

export const JOB_ANTI_FRAUD_TITLE = '防骗提示'
export const JOB_ANTI_FRAUD_BODY =
  '正规招聘不会以任何名义向求职者收取费用，包括培训费、工装费、体检费、内推费、保证金或押金。如遇收费、保证录用、快速转正等承诺，请提高警惕，可拨打 12333 向当地人力资源社会保障部门咨询。'
export const JOB_ANTI_FRAUD_DISCLAIMER =
  '本页信息来自第三方或官方来源，本系统不审核岗位是否真实招人，也不接收简历。'

export function JobAntiFraudNotice() {
  return (
    <aside
      className="jf-notice job-anti-fraud shrink-0"
      data-job-anti-fraud="true"
      role="note"
      style={{
        '--accent': 'var(--clay)',
        '--accent-deep': 'var(--clay-deep)',
        '--accent-soft': 'var(--clay-soft)',
      } as CSSProperties}
    >
      <ShieldAlertIcon aria-hidden="true" />
      <p>
        <b className="text-[var(--ink)]">{JOB_ANTI_FRAUD_TITLE}</b>
        <span className="mt-1 block">{JOB_ANTI_FRAUD_BODY}</span>
        <span className="mt-1 block">{JOB_ANTI_FRAUD_DISCLAIMER}</span>
      </p>
    </aside>
  )
}
