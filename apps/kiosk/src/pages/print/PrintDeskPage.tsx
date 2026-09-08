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
  readPrintMaterialSession,
  type MaterialCheckSummary,
  type PrintFileState,
  type PrintMaterialSource,
} from './printMaterialSession'

interface LocationState {
  file?: PrintFileState
  materialCheck?: MaterialCheckSummary
  source?: PrintMaterialSource
}

/**
 * 青序流光 13-print-desk：材料检查（第 2 步）与预览参数（第 3 步）同页分阶段。
 * 阶段切换只 replace `?step=`，不推新的历史条目。
 * 首屏从 sessionStorage 复水，看门狗 reload 后仍停在用户原来的阶段。
 */
export function PrintDeskPage() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const locationState = location.state as LocationState | null
  const requested = parsePrintDeskStep(searchParams.get('step'))
  const session = readPrintMaterialSession()
  const file = session?.file ?? locationState?.file
  const materialCheck = session?.materialCheck ?? locationState?.materialCheck
  const previewAuthorized = isPrintDeskPreviewAuthorized(materialCheck, file)
  const view = useMemo(
    () => resolvePrintDeskView({ requested, previewAuthorized }),
    [requested, previewAuthorized],
  )

  useEffect(() => {
    if (requested === view) return
    if (requested === 'preview' && view === 'preview') return
    if (requested == null) {
      setSearchParams({ step: view }, { replace: true })
    }
  }, [requested, view, setSearchParams])

  const go = (step: PrintDeskStep) => {
    setSearchParams({ step }, { replace: true })
  }

  return (
    <div data-print-desk="" data-print-desk-step={view} style={{ display: 'contents' }}>
      {view === 'preview' ? (
        <PrintPreviewPage onBackToCheck={() => go('check')} />
      ) : (
        <PrintMaterialCheckPage onAdvanceToPreview={() => go('preview')} />
      )}
    </div>
  )
}
