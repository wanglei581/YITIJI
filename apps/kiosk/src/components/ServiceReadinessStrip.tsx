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

/**
 * 服务中心的在线服务条（青序流光 16-service-hubs 的 .notice 行）。
 * 样式在 components/qingxu/service-hub/service-hub-qx.css。
 */
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
      className="qx-hub-notice service-readiness"
      data-readiness={status}
      role="status"
      aria-live="polite"
    >
      <Icon className="qx-hub-notice-ic" aria-hidden="true" />
      <span className="qx-hub-notice-copy">
        <b>{copy.title}</b>
        <span>{copy.detail}</span>
      </span>
      {status === 'unavailable' && (
        <button type="button" onClick={onRetry} className="qx-hub-notice-retry">
          <RefreshCwIcon size={20} aria-hidden="true" />
          重新检测
        </button>
      )}
    </div>
  )
}
