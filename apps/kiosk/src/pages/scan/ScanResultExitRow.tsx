import { FolderIcon, PrinterIcon, SparklesIcon } from 'lucide-react'
import { SCAN_TYPE_LABELS, type ScanType } from './scanWorkbench'
import type { ScannedFile } from './scanResultModel'

/**
 * 结果页成功分支里的三个去向：AI 简历识别、拿去打印、前往我的文档（游客时是灰着的「本次不进入我的文档」）。
 *
 * 2026-11-02 K1a 从 `ScanResultPage.tsx` 整段搬来（理由：页面 512 行，往里再加屏上扫描的结果之前先按职责拆开）。
 * **只搬不改**：三个按钮的启用条件与 DOM 都是拆分前的原文；点击后怎么离开由 `useScanResultExits` 负责。
 * 唯一的文案改动是游客那句说明（产品负责人 2026-11-02 拍板，照触屏版补稿 cs-scan-done 的原话）：
 * 走查 I-15 那一版会让人以为现在登录就能把这份存进账号，现在改成说清「请在本次操作内完成打印或识别」，
 * 带走电子版的办法是「下次先扫码登录再扫」或「用 U 盘」（那条这台机器暂未开通，所以如实写出来）。
 * **不放登录按钮**：游客一登录，这次扫描就会被登录那一步清掉，按钮同样会让人以为现在登录就能存进去；
 * 「先登录」是放在扫之前的「怎么扫」那一屏的事，不在这里。那颗灰着的出口保持原样。
 */
export function ScanResultExitRow({
  file,
  scanType,
  isLoggedIn,
  aiEnabled,
  printEnabled,
  handleResumeAI,
  handlePrint,
  handleDocuments,
}: {
  file: ScannedFile | undefined
  scanType: ScanType
  isLoggedIn: boolean
  aiEnabled: boolean
  printEnabled: boolean
  handleResumeAI: () => void
  handlePrint: () => void
  handleDocuments: () => void
}) {
  return (
    <div className="sw-actrow" data-testid="scan-workbench-exits">
      <button
        type="button"
        className={`sw-exit${aiEnabled ? '' : ' is-off'}`}
        disabled={!aiEnabled}
        onClick={handleResumeAI}
      >
        <span className="sw-exit-ic"><SparklesIcon size={20} aria-hidden /></span>
        <span className="sw-exit-body">
          <span className="sw-exit-title">
            AI 简历识别
            {aiEnabled ? null : <span className="sw-offtag">暂不放行</span>}
          </span>
          <small>
            {scanType === 'resume'
              ? '识别扫描件内容，进入简历诊断与优化'
              : `AI 简历识别只对简历扫描开放；这次扫的是「${SCAN_TYPE_LABELS[scanType]}」。`}
          </small>
        </span>
      </button>
      <button type="button" className="sw-exit" disabled={!printEnabled} onClick={handlePrint}>
        <span className="sw-exit-ic"><PrinterIcon size={20} aria-hidden /></span>
        <span className="sw-exit-body">
          <span className="sw-exit-title">拿去打印</span>
          <small>先检查文件和个人信息，再选打印参数。金额由系统报价决定，本页不给价格。</small>
        </span>
      </button>
      <button
        type="button"
        className={`sw-exit${file && isLoggedIn ? '' : ' is-off'}`}
        disabled={!file || !isLoggedIn}
        onClick={handleDocuments}
      >
        <span className="sw-exit-ic"><FolderIcon size={20} aria-hidden /></span>
        <span className="sw-exit-body">
          <span className="sw-exit-title">
            {isLoggedIn ? '前往我的文档' : '本次不进入我的文档'}
            {isLoggedIn ? null : <span className="sw-offtag">暂不放行</span>}
          </span>
          <small>
            {isLoggedIn
              ? '在「我的文档」查看与管理本次扫描件'
              : '未登录扫描件不会进入「我的文档」，请在本次操作内完成打印或识别。要带走电子版，下次先扫码登录再扫。用 U 盘带走：在打印机面板上选「扫描到 U 盘」，这台机器暂未开通。'}
          </small>
        </span>
      </button>
    </div>
  )
}
