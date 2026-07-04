// ============================================================
// 电子取件凭证面板（C5 P0b）。
//
// 诚实红线：只在后端返回 pickupCode 时由父组件渲染本面板；
// 可见性门控（仅 paid 且未退款、任务非终态）在服务端 pickupCodeVisibleFor，
// 前端绝不依据 payStatus 等字段自行推断或生成取件码。
// ============================================================

import { KIcon } from '../../../../components/kiosk-icon'

export function PickupCodePanel({ code }: { code: string }) {
  return (
    <div className="me-pickup-panel">
      <p>
        <KIcon name="ticket" />
        取件码 · 凭此码现场取件
      </p>
      <strong aria-label={`取件码 ${code}`}>
        {code}
      </strong>
      <span>请向现场工作人员出示；订单完成或退款后取件码自动失效</span>
    </div>
  )
}
