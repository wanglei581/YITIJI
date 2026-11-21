import { useEffect, useState } from 'react'
import { FolderIcon, PrinterIcon, SparklesIcon } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useSupportContactSnapshot } from '../../hooks/useSupportContact'
import { getMyDocuments } from '../../services/api/memberAssets'
import { formatYuan } from '../pay/payServiceModel'
import { scanGuestWays } from './scanGuestWays'
import { scanResultDocumentsNote, type ScanDocumentsCheck } from './scanResultDocumentsNote'
import { SCAN_TYPE_LABELS, type ScanType } from './scanWorkbench'
import type { ScannedFile } from './scanResultModel'

/**
 * 结果页成功分支里的三个去向：AI 简历识别、拿去打印、前往我的文档（游客时是灰着的「本次不进入我的文档」）。
 *
 * 2026-11-02 K1a 从 `ScanResultPage.tsx` 整段搬来（理由：页面 512 行，往里再加屏上扫描的结果之前先按职责拆开）。
 * **只搬不改**：三个按钮的启用条件与 DOM 都是拆分前的原文；点击后怎么离开由 `useScanResultExits` 负责。
 * 唯一的文案改动是游客那段说明：2026-11-02 改成说清「请在本次操作内完成打印或识别」；
 * 2026-11-08 设计窗口答复游客「扫码带走」不做，改成先一句「不进『我的文档』」，再列三条带走的办法
 * （当场打印 / 存 U 盘 / 下次先登录再扫），句子在 scanGuestWays，屏上扫描完成屏共用。每条一行小字，字号行距照这张卡原样。
 * **不放登录按钮**：游客一登录，这次扫描就会被登录那一步清掉，按钮同样会让人以为现在登录就能存进去；
 * 「先登录」是放在扫之前的「怎么扫」那一屏的事，不在这里。那颗灰着的出口和三个按钮的启用条件保持原样。
 */
export function ScanResultExitRow({
  file,
  scanType,
  isLoggedIn,
  aiEnabled,
  printEnabled,
  paidAmountCents,
  handleResumeAI,
  handlePrint,
  handleDocuments,
}: {
  file: ScannedFile | undefined
  scanType: ScanType
  isLoggedIn: boolean
  aiEnabled: boolean
  printEnabled: boolean
  paidAmountCents?: number | null
  handleResumeAI: () => void
  handlePrint: () => void
  handleDocuments: () => void
}) {
  // 只读本会话已有的服务联系方式（运行时根负责去读），游客页面自己不新发请求。
  const contact = useSupportContactSnapshot()
  const { getToken } = useAuth()
  const fileId = file?.fileId ?? ''
  const [check, setCheck] = useState<ScanDocumentsCheck>('checking')
  useEffect(() => {
    if (!isLoggedIn || !fileId) {
      setCheck('checking')
      return undefined
    }
    let stale = false
    setCheck('checking')
    void getMyDocuments(getToken(), { pageSize: 50 })
      .then((page) => {
        if (!stale) setCheck(page.items.some((item) => item.id === fileId) ? 'found' : 'missing')
      })
      .catch(() => {
        if (!stale) setCheck('failed')
      })
    return () => {
      stale = true
    }
  }, [fileId, getToken, isLoggedIn])
  const documentsNote = scanResultDocumentsNote({ loggedIn: isLoggedIn, check, contact })
  return (
    <div className="sw-actrow" data-testid="scan-workbench-exits">
      <button
        type="button"
        className={`sw-exit${aiEnabled ? '' : ' is-off'}`}
        disabled={!aiEnabled}
        onClick={handleResumeAI}
      >
        <span className="sw-exit-ic">
          <SparklesIcon size={20} aria-hidden />
        </span>
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
        <span className="sw-exit-ic">
          <PrinterIcon size={20} aria-hidden />
        </span>
        <span className="sw-exit-body">
          <span className="sw-exit-title">拿去打印</span>
          {paidAmountCents != null ? (
            <small data-testid="scan-result-paid-copy">
              先检查文件和个人信息。打印另按页计价，到核对价格再看。扫描这一次已经付过{' '}
              <span className="fs-pay-keep">{formatYuan(paidAmountCents)}</span>。
            </small>
          ) : (
            <small>先检查文件和个人信息，再选打印参数。金额由系统报价决定，本页不给价格。</small>
          )}
        </span>
      </button>
      <button
        type="button"
        className={`sw-exit${file && isLoggedIn ? '' : ' is-off'}`}
        disabled={!file || !isLoggedIn}
        onClick={handleDocuments}
      >
        <span className="sw-exit-ic">
          <FolderIcon size={20} aria-hidden />
        </span>
        <span className="sw-exit-body">
          <span className="sw-exit-title">
            {isLoggedIn ? '前往我的文档' : '本次不进入我的文档'}
            {isLoggedIn ? null : <span className="sw-offtag">暂不放行</span>}
          </span>
          {isLoggedIn ? (
            <small>{documentsNote}</small>
          ) : (
            <>
              <small data-testid="scan-guest-ways">{documentsNote}</small>
              {scanGuestWays(contact).map((way, index) => (
                <small key={way.key} data-guest-way={way.key}>{`${index + 1}. ${way.text}`}</small>
              ))}
            </>
          )}
        </span>
      </button>
    </div>
  )
}
