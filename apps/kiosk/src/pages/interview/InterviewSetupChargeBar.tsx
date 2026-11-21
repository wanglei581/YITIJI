import { PAY_BACK, formatYuan } from '../pay/payServiceModel'
import './styles/interview-pay.css'

/** 稿 pay-1113.js 329 行：iv-3 收费说明条，金额取终端生效价。 */
export function InterviewSetupChargeBar({ priceCents }: { priceCents: number }) {
  const yuan = formatYuan(priceCents)
  return (
    <div className="qxt-iv-paybar" data-testid="interview-charge-bar">
      <b>这一次 {yuan}</b>
      <span>
        AI 模拟面试。先确认年满 14 周岁，再付款。付好了才开始练。没练成可免费再试一次；再不成，钱{PAY_BACK}。
      </span>
    </div>
  )
}
