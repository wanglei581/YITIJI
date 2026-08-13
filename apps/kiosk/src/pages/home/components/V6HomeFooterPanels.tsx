import type { ExternalJobFairDTO } from '@ai-job-print/shared'
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  CircleAlertIcon,
  MapPinIcon,
  PrinterIcon,
  RotateCwIcon,
  ScanLineIcon,
  WifiIcon,
} from 'lucide-react'
import type { TerminalDeviceStatusView } from '../../../hooks/useTerminalDeviceStatus'
import type { HomeV6ActionId } from '../homeV6Domains'
import type { HomeJobFairHighlightState } from '../hooks/useHomeJobFairHighlight'

interface V6HomeFooterPanelsProps {
  jobFair: HomeJobFairHighlightState & { retry: () => void }
  device: TerminalDeviceStatusView
  onAction: (actionId: HomeV6ActionId) => void
  onOpenFair: (fairId: string) => void
}

function fairTime(fair: ExternalJobFairDTO): string {
  const start = new Date(fair.startTime)
  if (Number.isNaN(start.getTime())) return '时间以来源页面为准'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(start)
}

function JobFairPanel({
  state,
  onOpenFair,
  onBrowse,
}: {
  state: V6HomeFooterPanelsProps['jobFair']
  onOpenFair: (fairId: string) => void
  onBrowse: () => void
}) {
  return (
    <article
      className="v6-home-footer-panel v6-home-footer-panel--fair"
      data-home-job-fair-panel
      data-panel-state={state.status}
      aria-labelledby="v6-home-fair-title"
    >
      {state.status === 'ready' ? (
        <>
          <img src="/assets/kiosk-home-hero-job-fair.png" alt="" aria-hidden="true" />
          <div className="v6-home-footer-panel__scrim" aria-hidden="true" />
          <div className="v6-home-footer-panel__content">
            <span className="v6-home-footer-panel__eyebrow">
              {state.fair.status === 'ongoing' ? '正在进行' : '即将开始'} · 现场示意
            </span>
            <h2 id="v6-home-fair-title">{state.fair.name}</h2>
            <p>
              <CalendarDaysIcon aria-hidden="true" /> {fairTime(state.fair)}
            </p>
            <p>
              <MapPinIcon aria-hidden="true" /> {state.fair.venue || '地点以来源页面为准'}
            </p>
            <button type="button" onClick={() => onOpenFair(state.fair.id)}>
              查看招聘会 <ArrowRightIcon aria-hidden="true" />
            </button>
          </div>
        </>
      ) : (
        <div className="v6-home-footer-panel__fallback">
          <span className="v6-home-footer-panel__icon"><CalendarDaysIcon aria-hidden="true" /></span>
          <div>
            <span className="v6-home-footer-panel__eyebrow">招聘会与活动</span>
            <h2 id="v6-home-fair-title">
              {state.status === 'loading'
                ? '正在读取已发布场次'
                : state.status === 'error'
                  ? '暂时无法获取招聘会信息'
                  : '暂无进行中或即将开始的招聘会'}
            </h2>
            <p>
              {state.status === 'loading'
                ? '只展示已审核并正式发布的真实场次。'
                : state.status === 'error'
                  ? '没有使用缓存或示例数据，请稍后重试。'
                  : '可进入招聘会服务查看后续已审核发布场次。'}
            </p>
          </div>
          {state.status === 'error' ? (
            <button type="button" onClick={state.retry}>
              <RotateCwIcon aria-hidden="true" /> 重新加载
            </button>
          ) : state.status === 'empty' ? (
            <button type="button" onClick={onBrowse}>
              查看招聘会服务 <ArrowRightIcon aria-hidden="true" />
            </button>
          ) : null}
        </div>
      )}
    </article>
  )
}

function DevicePanel({
  device,
  onOpenPrint,
}: {
  device: TerminalDeviceStatusView
  onOpenPrint: () => void
}) {
  const paperText = device.printer.errorCode === 'paperEmpty' ? '打印机报告缺纸' : '未单独上报'
  return (
    <article
      className="v6-home-footer-panel v6-home-footer-panel--device"
      data-home-device-panel
      data-panel-state={device.loading ? 'loading' : device.kind}
      aria-labelledby="v6-home-device-title"
      aria-live="polite"
    >
      <header>
        <span className={`v6-home-device-dot${device.printerReady ? ' is-ready' : ''}`} aria-hidden="true" />
        <div>
          <span className="v6-home-footer-panel__eyebrow">本机状态</span>
          <h2 id="v6-home-device-title">{device.loading ? '正在检查本机服务' : device.printerLabel}</h2>
        </div>
      </header>
      <dl>
        <div><dt><PrinterIcon aria-hidden="true" />纸张</dt><dd>{paperText}</dd></div>
        <div><dt><CircleAlertIcon aria-hidden="true" />碳粉</dt><dd>未单独上报</dd></div>
        <div><dt><ScanLineIcon aria-hidden="true" />扫描仪</dt><dd>未单独上报</dd></div>
        <div><dt><WifiIcon aria-hidden="true" />服务连接</dt><dd>{device.loading ? '检测中' : device.networkLabel}</dd></div>
      </dl>
      <button type="button" onClick={onOpenPrint}>
        进入打印扫描 <ArrowRightIcon aria-hidden="true" />
      </button>
    </article>
  )
}

export function V6HomeFooterPanels({ jobFair, device, onAction, onOpenFair }: V6HomeFooterPanelsProps) {
  return (
    <section className="v6-home-footer-panels" aria-label="招聘会与本机状态">
      <JobFairPanel state={jobFair} onOpenFair={onOpenFair} onBrowse={() => onAction('fairs-hub')} />
      <DevicePanel device={device} onOpenPrint={() => onAction('print-hub')} />
    </section>
  )
}
