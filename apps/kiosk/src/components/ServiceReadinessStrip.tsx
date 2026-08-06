import { AlertTriangleIcon, CheckCircle2Icon, LoaderCircleIcon, RefreshCwIcon } from 'lucide-react'
import type { ApiReadinessStatus } from '../hooks/useApiReadiness'

interface ServiceReadinessStripProps {
  status: ApiReadinessStatus
  onRetry: () => void
}

const STATUS_COPY: Record<ApiReadinessStatus, { title: string; detail: string }> = {
  checking: {
    title: '正在确认在线服务',
    detail: '检查完成前，需要在线处理的入口暂不开放',
  },
  ready: {
    title: '在线服务已连接',
    detail: '具体能力、设备和权益仍会在办理过程中再次确认',
  },
  unavailable: {
    title: '在线服务暂不可用',
    detail: '已暂停需要在线处理的入口，请稍后重新检测',
  },
}

export function ServiceReadinessStrip({ status, onRetry }: ServiceReadinessStripProps) {
  const copy = STATUS_COPY[status]
  const Icon =
    status === 'ready'
      ? CheckCircle2Icon
      : status === 'unavailable'
        ? AlertTriangleIcon
        : LoaderCircleIcon

  return (
    <div
      className="service-hub__rail service-readiness"
      data-readiness={status}
      role="status"
      aria-live="polite"
    >
      <Icon className="service-readiness__icon" aria-hidden="true" />
      <span className="service-readiness__copy">
        <b>{copy.title}</b>
        <span>{copy.detail}</span>
      </span>
      {status === 'unavailable' && (
        <button type="button" onClick={onRetry} className="service-readiness__retry">
          <RefreshCwIcon aria-hidden="true" />
          重新检测
        </button>
      )}
    </div>
  )
}
