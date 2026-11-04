/** 材料检查、预览两页共用的「这一页没有待处理的文件」空态（稿 st-empty）。付款之前，这一步确实没有订单、没有扣费。 */

import { PrintMissResume } from './PrintMissResume'

export function PrintEmptyDesk({
  marker,
  problem,
  onPickFile,
}: {
  marker: 'print-material-check' | 'print-preview'
  problem: string | null
  onPickFile: () => void
}) {
  return (
    <div className="pdt-empty" data-w2-page={marker} data-qx-state="missing-context">
      <p className="pdt-current-file"><strong>当前文件：无</strong></p>
      {problem ? <p data-print-handoff-problem="true">{problem}</p> : null}
      <PrintMissResume orderMayExist={false} onUpload={onPickFile} note="这一页本身不保存文件" />
    </div>
  )
}
