// ============================================================
// 电子取件凭证面板（C5 P0b）。
//
// 诚实红线：只在后端返回 pickupCode 时由父组件渲染本面板；
// 可见性门控（仅 paid 且未退款、任务非终态）在服务端 pickupCodeVisibleFor，
// 前端绝不依据 payStatus 等字段自行推断或生成取件码。
// ============================================================

import { TicketIcon } from 'lucide-react'

export function PickupCodePanel({ code }: { code: string }) {
  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50 p-4 text-center">
      <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-primary-700">
        <TicketIcon className="h-4 w-4" aria-hidden="true" />
        取件码 · 凭此码现场取件
      </p>
      <p className="mt-2 font-mono text-3xl font-bold tracking-[0.3em] text-primary-700" aria-label={`取件码 ${code}`}>
        {code}
      </p>
      <p className="mt-2 text-xs text-neutral-500">请向现场工作人员出示；订单完成或退款后取件码自动失效</p>
    </div>
  )
}
