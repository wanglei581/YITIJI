// ============================================================
// 电子取件凭证面板（C5 P0b）。
//
// 诚实红线：只在后端返回 pickupCode 时由父组件渲染本面板；
// 可见性门控（仅 paid 且未退款、任务非终态）在服务端 pickupCodeVisibleFor，
// 前端绝不依据 payStatus 等字段自行推断或生成取件码。
// ============================================================

import { KIcon } from '../../../../components/kiosk-icon'

export function PickupCodePanel({ code, hint }: { code: string; hint?: string | null }) {
  return (
    <div className="me-pickup-panel">
      <p>
        <KIcon name="ticket" />
        到机码 · 取件和接着打都用它
      </p>
      <strong aria-label={`到机码 ${code}`}>
        {code}
      </strong>
      {hint ? <span>{hint}</span> : null}
    </div>
  )
}
