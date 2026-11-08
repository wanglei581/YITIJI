import { useLocation } from 'react-router-dom'
import { ScanSettingsSessionFacts, ScanSettingsStatusView } from './ScanSettingsStatusView'
import { liveSessionStillValid } from './scanSettingsModel'
import {
  ScanPanelMock,
  ScanWorkbenchShell,
} from './ScanWorkbenchChrome'
import { type ScanType } from './scanWorkbench'
import { type ScanStage } from './scanWorkbenchModel'
import { readScanWorkbenchSession } from './scanWorkbenchSession'
import { useScanSessionCreate } from './useScanSessionCreate'
import { useScanSettingsActions } from './useScanSettingsActions'
import { useScanSettingsDeliveryAck } from './useScanSettingsDeliveryAck'
import { useScanSettingsExpiry } from './useScanSettingsExpiry'
import { useScanSettingsState } from './useScanSettingsState'

function isScanType(value: unknown): value is ScanType {
  return value === 'resume' || value === 'id' || value === 'document'
}

interface LocationState {
  scanType?: unknown
}

/**
 * 设置页（扫描指引）：只做装配与渲染。
 *
 * 2026-11-02 K1a 起，这一场的状态位与引用在 `useScanSettingsState`，创建会话在 `useScanSessionCreate`，
 * 投递确认在 `useScanSettingsDeliveryAck`，到期倒计时在 `useScanSettingsExpiry`，按钮处理函数在
 * `useScanSettingsActions`；它们的判据与注释都是拆分前的原文。本页只负责读路由 state 与本机登记、
 * 按拆分前同一个顺序把这些 hook 调起来、再据结果渲染。
 */
export function ScanSettingsPage({ onGoStage }: { onGoStage?: (stage: ScanStage) => void } = {}) {
  const location = useLocation()
  const state = (location.state ?? {}) as LocationState
  const stored = readScanWorkbenchSession()
  const storedType = stored?.scanType
  const storedLive = stored?.live
  const scanType = isScanType(state.scanType)
    ? state.scanType
    : isScanType(storedType)
      ? storedType
      : null
  const restoredLive = liveSessionStillValid(storedLive) ? storedLive : null

  const session = useScanSettingsState({ stored, scanType, restoredLive })
  const {
    phase,
    failure,
    instructions,
    starting,
    scanTaskId,
    expiresAt,
    countdown,
    quietPeriodRemaining,
    quietPeriodBlocked,
    controlToken,
    rescanRequested,
    plainRestartChosen,
    rescanRefusedByServer,
    rescanRetryable,
    replayingLostCreate,
    ackState,
    ackRefused,
    liveNotDurable,
    terminalSession,
    cleanupHolding,
    rescanCredentialsLost,
    restoredFromStorageRef,
  } = session

  useScanSessionCreate({ ...session, scanType })
  useScanSettingsDeliveryAck(session)
  useScanSettingsExpiry(session)
  const {
    handleSafeReturn,
    handlePlainRestart,
    handleQuietPeriodRetry,
    handleAckRetry,
    handleRescanRetry,
    handleConfirm,
  } = useScanSettingsActions({ ...session, scanType, stored, onGoStage })

  /* 「可以去面板操作了」的判据是两件事同时成立，不是一件：服务端回了一个可用的
   * 会话（phase success + 四样字段齐全），**并且**它已经拿到投递授权（ackState acked）。
   * 少了后半句，用户会照着指引去按开始，而那一刻服务端还不肯把文件投给这一场。 */
  if (ackState !== 'acked' || phase !== 'success' || !scanType || !scanTaskId || !controlToken || !instructions || !expiresAt) {
    // 这一整块只读值、不碰 ref/effect/请求，所以整份交出去（ScanSettingsStatusView）。
    return <ScanSettingsStatusView {...{
      phase, ackState, scanType, terminalSession, failure, replayingLostCreate,
      rescanRetryable, rescanCredentialsLost, rescanRefusedByServer, ackRefused, liveNotDurable,
      cleanupHolding, quietPeriodRemaining, quietPeriodBlocked,
      handleSafeReturn, handlePlainRestart, handleRescanRetry, handleAckRetry, handleQuietPeriodRetry,
    }} />
  }

  return (
    <ScanWorkbenchShell
      page="scan-settings"
      state="panel-instruction"
      title="扫描指引"
      /* 「扫描任务已创建」单独包一层：门禁与用例按这一整句精确匹配它来判断「会话真的建成了」。 */
      subtitle={<><span>扫描任务已创建</span>，请只按系统给出的这一次操作说明来做。</>}
      status={{ tone: 'ok', label: '第 2 步 · 去面板操作' }}
      dock={{
        left: { label: '返回（取消任务）', onClick: handleSafeReturn },
        primary: {
          label: starting ? '正在进入等待…' : '我已操作，开始等待',
          onClick: handleConfirm,
          disabled: starting,
        },
      }}
    >
      <ScanSettingsSessionFacts
        scanType={scanType} countdown={countdown}
        rescanRequested={rescanRequested} plainRestartChosen={plainRestartChosen}
        restoredFromStorage={restoredFromStorageRef.current}
      />
      {scanType === 'id' ? <p role="note">在打印机屏幕上把文件格式选成 JPG（图片）再开始。</p> : null}
      <ScanPanelMock instructions={instructions.map((instruction) => instruction)} />
    </ScanWorkbenchShell>
  )
}
