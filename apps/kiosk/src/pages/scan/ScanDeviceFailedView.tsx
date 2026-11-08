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
import { beginDeviceScanAgain, type ScanOutcome } from './scanWorkbenchSession'
import './styles/scan-device-qx.css'
import './styles/scan-device-errors.css'

const SAME_PAPER = '同一张纸原样再扫，系统可能按重复件拒收（两小时内）。'
const NO_FILE_DETAIL = '同一份结果里没有带可用的文件信息（结果里允许不带文件，这不是出错）。'
  + '这份文件此刻还在不在系统里，本机没有依据判断。这次扫描到此结束。'

/**
 * 屏上扫描中断后的结果屏（稿 cs-scan-failed，11/08 产品负责人定第 2 条）。原因卡一律照 11/09 第三轮
 * ?fail=nofile 的单栏居中排：这一屏最多两张出路卡，比稿默认少一张，左图右字会在卡里留出大块空白（scan-device-errors.css）。
 * 面板扫描的失败屏（ScanResultFailedView）一个字不动；走哪一屏由 ScanResultPage 按本机登记的 deviceFlow 分。
 *
 * ## 为什么没有「重试扫描（同一份材料）」
 *
 * 稿上这颗按钮回放纸设置（cs-scan-set），意思是带着上一场的安全重扫授权再扫一遍。屏上扫描做不到：
 * 服务端 `resolveScanStartParams` 对 startMode=device 带 retryOfScanTaskId 一律 400
 * `SCAN_DEVICE_RETRY_UNSUPPORTED`（services/api/src/scan-tasks/scan-device-protocol.ts），
 * 本机 `useScanDeviceStart` 建会话也不带那一对重扫头。回放纸设置只能建一场普通新会话，
 * 写成「同一份材料」就是假话。所以照稿上拿不到凭据时的排法：重新开始一次扫描、返回首页，
 * 主按钮是「重新开始一次扫描」；同一张纸可能被按重复件拒收这句照写，让人自己换材料或改用面板。
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
  /** 稿里的 again：清掉这一场回「扫什么」，不预选材料，是一场普通新会话（同完成屏「再扫一份」）。 */
  const again = (): void => {
    revokeLiveScanSession(getToken())
    beginDeviceScanAgain()
    onGoStage?.('start')
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
        primary: { label: '重新开始一次扫描', onClick: again, testId: 'scan-device-failed-primary' },
      }}
    >
      <div className={`cs-sfail cs-err cs-err${ways}${ways === 1 ? ' cs-solo' : ''}`} data-testid="scan-device-failed">
        <div className="cs-why" role="alert">
          <span className="vis" aria-hidden="true">
            <ScanPaperArt />
            <i className="warn"><QxTouchIcon name="alert" size={34} strokeWidth={2.4} /></i>
          </span>
          <div><b>{reason}</b><p>{isNoFile ? NO_FILE_DETAIL : SAME_PAPER}</p></div>
        </div>
        <div className="cs-ways">
          {card('重新开始一次扫描', '这是一次普通新会话，不是免查重的重扫。不自动重扫。', <ScanPaperArt />, again, 'scan-device-failed-again')}
          {isNoFile ? null : card('返回首页', '结束这次等待', <DocStackArt />, () => leaveScanFlow('/'), 'scan-device-failed-home')}
        </div>
        <PhoneHelpLine />
      </div>
    </ScanWorkbenchShell>
  )
}
