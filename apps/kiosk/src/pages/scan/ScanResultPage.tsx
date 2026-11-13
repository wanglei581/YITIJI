import { useCallback, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { formatLabelFromMime } from './scanOutputFormat'
import { ScanDeviceFailedView } from './ScanDeviceFailedView'
import { ScanResultExitRow } from './ScanResultExitRow'
import { ScanResultFailedView } from './ScanResultFailedView'
import { ScanResultPreviewBlock } from './ScanResultPreviewBlock'
import { ScanResultPreviewViewer } from './ScanResultPreviewViewer'
import { ScanWorkbenchShell } from './ScanWorkbenchChrome'
import { deriveOutcome, type ScanResultState } from './scanResultModel'
import { scanShownText } from './scanShownText'
import { type ScanStage } from './scanWorkbenchModel'
import { readScanWorkbenchSession } from './scanWorkbenchSession'
import { useScanResultExits } from './useScanResultExits'
import { useScanResultRescan } from './useScanResultRescan'

/**
 * 结果页：只做装配与渲染。
 *
 * 2026-11-02 K1a 起，类型与结果判定在 `scanResultModel`，重扫授权在 `useScanResultRescan`，
 * 出口在 `useScanResultExits`，「没拿到文件」视图在 `ScanResultFailedView`，成功分支的预览块与
 * 三个去向在 `ScanResultPreviewBlock` / `ScanResultExitRow`；它们的判据与注释都是拆分前的原文。
 * 本页负责读路由 state 与本机登记、合并出这一屏的结果、挑走哪个视图、并持有整屏预览的开关。
 * 2026-11-09 起屏上扫描来的「没拿到文件」走 `ScanDeviceFailedView`（稿 cs-scan-failed），面板扫描的那一屏不变。
 */
export function ScanResultPage({ onGoStage }: { onGoStage?: (stage: ScanStage) => void } = {}) {
  const location = useLocation()
  const { isLoggedIn } = useAuth()
  const stored = readScanWorkbenchSession()
  const locationState = (location.state ?? {}) as ScanResultState
  const state: ScanResultState = {
    ...locationState,
    scanType: stored?.scanType ?? locationState.scanType,
    source: stored?.extras?.source ?? locationState.source,
    pageMode: stored?.extras?.pageMode ?? locationState.pageMode,
    color: stored?.extras?.color ?? locationState.color,
    dpi: stored?.extras?.dpi ?? locationState.dpi,
    success: stored?.result?.success ?? locationState.success,
    reason: stored?.result?.reason ?? locationState.reason,
    outcome: stored?.result?.outcome ?? locationState.outcome,
    file: stored?.result?.file ?? locationState.file,
  }
  const scanType = state.scanType ?? 'document'
  const success = state.success === true
  const reason = state.reason
  const formatFailure = scanType === 'id' && Boolean(reason?.includes('文件格式不符合证件扫描要求'))
  const shownReason = reason ? scanShownText(reason, '扫描任务未能完成。请返回重试。') : null
  const file = state.file
  const outcome = deriveOutcome(state)
  // 刚结束那一场的凭证还留在本机登记里（finishWithResult 刻意不抹 live）。
  // 这里只读，不改：它是「向服务端取用那枚一次性重扫授权」的唯一来源。
  const priorScanTaskId = stored?.live?.scanTaskId ?? null
  const priorControlToken = stored?.live?.controlToken ?? null
  // 整屏预览只是这一屏的视图状态：不进地址、不进历史、不落存储。
  const [previewOpen, setPreviewOpen] = useState(false)
  const closePreview = useCallback(() => setPreviewOpen(false), [])

  const { rescanAuthorized, safeRescanLost, handleRetry, handlePlainRestart } = useScanResultRescan({
    state, scanType, outcome, priorScanTaskId, priorControlToken, onGoStage,
  })
  const { leaveScanFlow, handlePrint, handleDocuments, handleResumeAI } = useScanResultExits({ file, scanType })

  const displayFormat = formatLabelFromMime(file?.mimeType)

  if (outcome === 'completed-no-file' || (!success && outcome !== 'completed')) {
    /* 11/08 产品负责人定第 2 条：屏上扫描中断后换成屏上扫描自己的结果屏（稿 cs-scan-failed），面板扫描照旧。
     * 判据是本机登记里的 deviceFlow：只有屏上扫描建会话那一处写 true（useScanDeviceStart），改用面板扫描
     * （scanDeviceRecovery）和任何一次生命周期终结（live: undefined、清场）都会把它清掉；它和结果快照
     * 同在 sessionStorage，看门狗整页重载之后照样读得到。路由 state 里没有这一位，伪造地址进不来。 */
    if (stored?.deviceFlow === true) {
      return (
        <ScanDeviceFailedView
          outcome={outcome}
          shownReason={shownReason}
          leaveScanFlow={leaveScanFlow}
          onGoStage={onGoStage}
        />
      )
    }
    return (
      <ScanResultFailedView
        outcome={outcome}
        formatFailure={formatFailure}
        shownReason={shownReason}
        rescanAuthorized={rescanAuthorized}
        safeRescanLost={safeRescanLost}
        handleRetry={handleRetry}
        handlePlainRestart={handlePlainRestart}
        leaveScanFlow={leaveScanFlow}
      />
    )
  }

  const aiEnabled = scanType === 'resume' && Boolean(file)
  const printEnabled = Boolean(file)

  return (
    <ScanWorkbenchShell
      page="scan-result"
      state="completed"
      title="扫描完成"
      subtitle="请核对文件信息，选择下一步操作"
      status={{ tone: 'ok', label: '系统已返回完成，并带回文件' }}
      /* 成功页上的「重新扫描」本来就没有安全重扫可言：上一场已经建档，服务端那条
         两小时去重只管「取过件但没建档成功」的字节。所以它是一次普通新会话，
         走显式的那一条，不碰重扫授权。名字照稿 18 的出口名：「拿去打印」先去材料检查
         （原件要先过隐私检查），不能再叫「直接打印」。 */
      dock={{
        left: { label: '重新扫描', onClick: handlePlainRestart, icon: 'refresh' },
        primary: { label: '拿去打印', onClick: handlePrint, disabled: !printEnabled },
      }}
    >
      <div className="sw-result qx-grow">
        <ScanResultPreviewBlock
          file={file}
          scanType={scanType}
          displayFormat={displayFormat}
          onOpenPreview={() => setPreviewOpen(true)}
        />
        <ScanResultExitRow
          file={file}
          scanType={scanType}
          isLoggedIn={isLoggedIn}
          aiEnabled={aiEnabled}
          printEnabled={printEnabled}
          handleResumeAI={handleResumeAI}
          handlePrint={handlePrint}
          handleDocuments={handleDocuments}
        />
        <p className="fs-p fs-foot">还没选下一步的临时文件，会按保存规则清理。扫完请取回原件。</p>
        {previewOpen && file ? (
          <ScanResultPreviewViewer file={file} formatLabel={displayFormat} onClose={closePreview} />
        ) : null}
      </div>
    </ScanWorkbenchShell>
  )
}
