import { ExpandIcon, FileTextIcon } from 'lucide-react'
import { FileContentPreview } from '../../components/FileContentPreview'
import { ScanStatusPanel } from './ScanWorkbenchChrome'
import { SCAN_TYPE_LABELS, type ScanType } from './scanWorkbench'
import type { ScannedFile } from './scanResultModel'

/**
 * 结果页成功分支里的预览块：预览在上，文件名、格式大小页数、类型在下，再是预览说明，最后是「整屏查看」。
 *
 * 2026-11-02 K1a 从 `ScanResultPage.tsx` 整段搬来（理由：页面 512 行，往里再加屏上扫描的结果之前先按职责拆开）。
 * **只搬不改**：DOM 结构与类名一个没动（整屏预览层靠它在 `.sw-result` 里的位置把兄弟节点设为 inert，
 * 所以那一层仍由页面渲染在 `.sw-result` 的末尾，不挪进这里）。唯一的形变：
 * 「整屏查看」的 `onClick` 从页面里的 `setPreviewOpen(true)` 换成父级传进来的 `onOpenPreview`。
 */
export function ScanResultPreviewBlock({
  file,
  scanType,
  displayFormat,
  onOpenPreview,
}: {
  file: ScannedFile | undefined
  scanType: ScanType
  displayFormat: string
  onOpenPreview: () => void
}) {
  /* 稿 18「扫描完成」：预览在上，文件名、格式大小页数、类型在下，再是预览说明，最后是「整屏查看」。
      这块原来是「文件头在上、预览在下」，预览落进了左边 28% 的窄列（两列网格是给「左示意图 + 右预览」写的）。 */
  return (
    <div className="sw-preview">
      <div className="sw-pvstage">
        <div className="sw-pvdoc">
          {file ? (
            <FileContentPreview
              fileUrl={file.fileUrl}
              fileName={file.name}
              mimeType={file.mimeType}
              format={displayFormat}
              pdfFit="page"
            />
          ) : (
            <ScanStatusPanel tone="error" title="缺少扫描结果文件">
              <p>本页未收到真实扫描结果，不会生成占位文件。请重新开始扫描。</p>
            </ScanStatusPanel>
          )}
        </div>
      </div>
      <div className="sw-pvhead" data-testid="scan-workbench-file-brief">
        {file ? (
          <div className="sw-pvh-2">
            <b>{file.name}</b>
            <span className="sw-pvh-meta">
              {displayFormat}
              <span className="sep">·</span>
              {file.size}
              <span className="sep">·</span>
              {file.pages != null ? `${file.pages} 页` : '页数以文件为准'}
            </span>
          </div>
        ) : null}
        <div className="sw-pvh-1">
          <span className="sw-pvh-ic"><FileTextIcon size={24} aria-hidden /></span>
          <span className="sw-pvh-t">系统结果：已完成，并带回文件</span>
          <span className="sw-chip is-ok">{SCAN_TYPE_LABELS[scanType]}</span>
        </div>
      </div>
      <p className="sw-preview-cap">
        预览用的是结果里那条临时内容链接，不是另外再申请一条要登录的链接。打不开只证明这一次没打开，不改判扫描已完成，也不能据此判断文件是否仍可用。
      </p>
      {file ? (
        <button
          type="button"
          className="sw-pvh-open"
          data-testid="scan-result-preview-open"
          onClick={onOpenPreview}
        >
          <ExpandIcon size={24} aria-hidden />
          整屏查看
        </button>
      ) : null}
    </div>
  )
}
