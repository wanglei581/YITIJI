// ============================================================
// 到机码面板（方案②：到机码就是取件码，不再单列取件凭证）。
//
// 诚实红线：只在后端返回 pickupCode 时由父组件渲染本面板；
// 可见性门控在服务端，前端绝不依据 payStatus 等字段自行推断或生成码。
// 续打句只读 reprintAllowed / reprintRemaining：真值写出剩余次数，
// 次数用尽写出不能再打；其余情况不加句，也不另写次数以外的保证。
// ============================================================

import type { MemberPrintOrderItem } from '@ai-job-print/shared'
import { KIcon } from '../../../../components/kiosk-icon'

function resumeNotice(reprintAllowed?: boolean, reprintRemaining?: number | null): string | null {
  if (reprintAllowed === true && typeof reprintRemaining === 'number') {
    return `没打完？回到出纸失败的那台机器上再输一次这个到机码就能接着打（还能续打 ${reprintRemaining} 次）。`
  }
  if (reprintAllowed === false && reprintRemaining === 0) {
    return '这单已经接着打过 2 次，不能再打了。'
  }
  return null
}

export function PickupCodePanel({
  code,
  reprintAllowed,
  reprintRemaining,
}: { code: string } & Pick<MemberPrintOrderItem, 'reprintAllowed' | 'reprintRemaining'>) {
  const notice = resumeNotice(reprintAllowed, reprintRemaining)
  return (
    <div className="me-pickup-panel">
      <p>
        <KIcon name="ticket" />
        到机码
      </p>
      <strong aria-label={`到机码 ${code}`}>
        {code}
      </strong>
      <span>在一体机的到机码页输入，用来取件。订单完成或退款后，这里不再显示。</span>
      {notice ? <span>{notice}</span> : null}
    </div>
  )
}
