import type { ResumeExportPricing } from '@ai-job-print/shared'
import { FREE_PRICING_COPY } from './constants'

export function ResumePricingBar(props: {
  pricing: ResumeExportPricing | null
  loading: boolean
  blockedReason: string | null
}) {
  if (props.loading && !props.pricing) {
    return <p className="qx-rd-price" role="status">正在读取导出价格…</p>
  }
  if (!props.pricing) {
    return (
      <p className="qx-rd-price" data-tone="bad" role="status">
        {props.blockedReason ?? '导出价格未读取到，导出暂不可用'}
      </p>
    )
  }
  if (props.pricing.mode === 'free') {
    return (
      <p className="qx-rd-price" data-tone="ok" role="status">
        {props.pricing.label || FREE_PRICING_COPY}
      </p>
    )
  }
  if (props.pricing.mode === 'unavailable') {
    return (
      <p className="qx-rd-price" data-tone="bad" role="status">
        {props.pricing.label}
        {props.blockedReason && props.blockedReason !== props.pricing.label ? ` · ${props.blockedReason}` : ''}
      </p>
    )
  }
  const available = props.pricing.benefit?.available
  return (
    <div className="qx-rd-price" data-tone={props.blockedReason ? 'bad' : 'warn'} role="status">
      <p>{props.pricing.label}</p>
      <p>
        {typeof available === 'number'
          ? `可用权益 ${available} 次`
          : '登录后显示可用权益次数'}
      </p>
      {props.blockedReason ? <p id="resume-export-blocked-reason">{props.blockedReason}</p> : null}
    </div>
  )
}
