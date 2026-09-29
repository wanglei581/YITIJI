import { useEffect, useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { PrintMaterialCheckPage } from './PrintMaterialCheckPage'
import { PrintPreviewPage } from './PrintPreviewPage'
import {
  parsePrintDeskStep,
  resolvePrintDeskView,
  isPrintDeskPreviewAuthorized,
  type PrintDeskStep,
} from './printDeskModel'
import {
  printHandoffProblemText,
  readPrintHandoff,
  resolveRouteHandoff,
  type PrintHandoffRouteState,
} from './printHandoff'
import { usePrintHandoffOwner } from './usePrintHandoff'

/**
 * 青序流光 13-print-desk：材料检查（第 2 步）与预览参数（第 3 步）同页分阶段。
 * 阶段切换只 replace `?step=`，不推新的历史条目。
 *
 * 文件身份只认打印交接上下文（商用收口 P0-5）：跳转带来的临时状态里只有交接编号，
 * 文件、检查结论一律从上下文读；归属不符、过期、被替换时当场清掉并落空态，不退回任何「上一份」。
 * 看门狗 reload 后仍从上下文复水，停在用户原来的阶段。
 */
export function PrintDeskPage() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const owner = usePrintHandoffOwner()
  const requested = parsePrintDeskStep(searchParams.get('step'))
  // location.key 变了（换阶段、检查写回之后）就重读一次上下文。
  const resolved = useMemo(
    () => resolveRouteHandoff(readPrintHandoff(owner), location.state as PrintHandoffRouteState | null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- location.state 随 location.key 一起变
    [owner, location.key],
  )
  const handoff = resolved.status === 'ok' ? resolved.context : null
  const problem = printHandoffProblemText(resolved.status)
  const previewAuthorized = handoff
    ? handoff.checkPolicy === 'exempt' || isPrintDeskPreviewAuthorized(handoff.materialCheck, handoff.file)
    : false
  const view = useMemo(
    () => resolvePrintDeskView({ requested, previewAuthorized }),
    [requested, previewAuthorized],
  )

  useEffect(() => {
    if (requested === view) return
    // 两种情况都要把 URL 拉回真实阶段：
    //   1. 没带 ?step= 进来（首屏 / 复水），补上当前阶段
    //   2. 带了 ?step=preview 但检查还没过 —— resolvePrintDeskView 已经把界面按回
    //      check，URL 必须跟着改回来。留着 preview 会让 URL 和屏幕说两套话，
    //      现场排障时看日志会以为用户真的在预览。
    // 一律 replace：阶段纠正不是用户的一次导航，不该进历史。
    setSearchParams({ step: view }, { replace: true })
  }, [requested, view, setSearchParams])

  const go = (step: PrintDeskStep) => {
    setSearchParams({ step }, { replace: true })
  }

  return (
    <div data-print-desk="" data-print-desk-step={view} style={{ display: 'contents' }}>
      {view === 'preview' ? (
        <PrintPreviewPage key={`preview-${handoff?.contextId ?? 'none'}`} handoff={handoff} problem={problem} onBackToCheck={() => go('check')} />
      ) : (
        <PrintMaterialCheckPage key={`check-${handoff?.contextId ?? 'none'}`} handoff={handoff} problem={problem} onAdvanceToPreview={() => go('preview')} />
      )}
    </div>
  )
}
