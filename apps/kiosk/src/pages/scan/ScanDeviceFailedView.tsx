import type { ReactNode } from 'react'
import type { NavigateOptions } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { PhoneHelpLine } from '../print-scan/phoneHelp'
import { DocStackArt } from '../print-scan/ToolArt'
import { ScanPaperArt } from './ScanPaperArt'
import { ScanWorkbenchShell } from './ScanWorkbenchChrome'
import { revokeLiveScanSession } from './scanSessionRevoke'
import { type ScanStage } from './scanWorkbenchModel'
import { beginDeviceScanSameSettings, type ScanOutcome } from './scanWorkbenchSession'
import './styles/scan-device-qx.css'
import './styles/scan-device-errors.css'

const AGAIN = '照原设置再扫一次'
const AGAIN_DETAIL = '把原件重新放好，可以照原设置再扫一次。'
const AGAIN_WAY = '回到放纸设置，材料和设置照上次填好'
const NO_FILE_DETAIL = '同一份结果里没有带可用的文件信息（结果里允许不带文件，这不是出错）。'
  + '这份文件此刻还在不在系统里，本机没有依据判断。这次扫描到此结束。'

/**
 * 屏上扫描中断后的结果屏（稿 cs-scan-failed，11/08 产品负责人定第 2 条）。面板扫描的失败屏（ScanResultFailedView）
 * 一个字不动；走哪一屏由 ScanResultPage 按本机登记的 deviceFlow 分。
 *
 * 11/09 产品负责人定（四项按推荐）：
 * - 出路「照原设置再扫一次」（主）和「返回首页」，没有文件那种只留前一张：回放纸设置，材料和放纸设置照上一场预填，
 *   按「开始扫描」才建一场普通新会话（beginDeviceScanSameSettings）。屏上扫描建会话带不了重扫授权
 *   （服务端对 startMode=device 带 retryOfScanTaskId 一律 400），所以不写「同一份材料」。
 * - 删掉原因卡「同一张纸原样再扫…（两小时内）」和出路卡「这是一次普通新会话，不是免查重的重扫…」：屏上扫描每次拼出的
 *   PDF 字节都不同（终端程序 pdfkit 默认写 CreationDate），服务端同字节去重拦不到，那两句说的事不会发生。
 * - 原因卡单栏居中、大插画在上（scan-device-errors.css），稿跟着程序补。
 */
export function ScanDeviceFailedView({
  outcome,
  shownReason,
  leaveScanFlow,
  onGoStage,
}: {
  outcome: ScanOutcome
  shownReason: string | null
  leaveScanFlow: (destination: string, options?: NavigateOptions) => void
  onGoStage?: (stage: ScanStage) => void
}) {
  const { getToken } = useAuth()
  const isNoFile = outcome === 'completed-no-file'
  const isExpired = outcome === 'expired'
  const title = isNoFile ? '已完成 · 结果里没有文件' : isExpired ? '等待超时' : '扫描未完成'
  const reason = isNoFile
    ? '系统说已完成，但这次结果里没有可用文件'
    : isExpired ? '等待超时，这次没有拿到文件。' : shownReason ?? '这次扫描没有完成。'
  /** 这一场照「再扫一份」那样结束（先撤销，结果还在时是空操作），再带着上一场的材料和放纸设置回放纸设置。 */
  const again = (): void => {
    revokeLiveScanSession(getToken())
    onGoStage?.(beginDeviceScanSameSettings())
  }
  const card = (label: string, detail: string, art: ReactNode, onClick: () => void, testId: string) => (
    <button type="button" key={label} className="cs-way" data-testid={testId} onClick={onClick}>
      <span className="vis" aria-hidden="true">{art}</span>
      <span className="tx"><h3>{label}</h3><p>{detail}</p></span>
      <span className="arrow" aria-hidden="true"><QxTouchIcon name="arrowR" size={30} strokeWidth={2.4} /></span>
    </button>
  )
  const ways = isNoFile ? 1 : 2
  return (
    <ScanWorkbenchShell
      page="scan-result"
      state={isNoFile ? 'completed-no-file' : isExpired ? 'wait-timeout' : 'failed'}
      title={title}
      subtitle="本次没有生成可用的扫描文件"
      status={{ tone: 'warn', label: isNoFile ? title : isExpired ? '等待超时 · 没有文件' : '扫描未完成' }}
      bandEyebrow="屏上扫描"
      bandRail={null}
      bandBack={false}
      dock={{
        askLabel: '问小青：扫描失败怎么办',
        left: { label: '返回打印扫描', leaveTo: '/print-scan' },
        primary: { label: AGAIN, onClick: again, testId: 'scan-device-failed-primary' },
      }}
    >
      <div className={`cs-sfail cs-err cs-err${ways}${ways === 1 ? ' cs-solo' : ''}`} data-testid="scan-device-failed">
        <div className="cs-why" role="alert">
          <span className="vis" aria-hidden="true">
            <ScanPaperArt />
            <i className="warn"><QxTouchIcon name="alert" size={34} strokeWidth={2.4} /></i>
          </span>
          <div><b>{reason}</b><p>{isNoFile ? NO_FILE_DETAIL : AGAIN_DETAIL}</p></div>
        </div>
        <div className="cs-ways">
          {card(AGAIN, AGAIN_WAY, <ScanPaperArt />, again, 'scan-device-failed-again')}
          {isNoFile ? null : card('返回首页', '结束这次等待', <DocStackArt />, () => leaveScanFlow('/'), 'scan-device-failed-home')}
        </div>
        <PhoneHelpLine />
      </div>
    </ScanWorkbenchShell>
  )
}
