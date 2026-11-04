import { useEffect, useState } from 'react'
import { FileContentPreview } from '../../components/FileContentPreview'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { useAuth } from '../../auth/useAuth'
import { whenMiniapp } from '../../copy/unattendedCopy'
import { useSupportContact } from '../../hooks/useSupportContact'
import { getMyDocuments } from '../../services/api/memberAssets'
import { SCAN_DEVICE_RAIL, ScanWorkbenchShell } from './ScanWorkbenchChrome'
import { ScanResultPreviewViewer } from './ScanResultPreviewViewer'
import { SCAN_MATERIALS } from './scanMaterials'
import { type ScanStage } from './scanWorkbenchModel'
import { revokeLiveScanSession } from './scanSessionRevoke'
import { beginDeviceScanAgain, readScanWorkbenchSession } from './scanWorkbenchSession'
import { useScanResultExits } from './useScanResultExits'
import './styles/scan-device-flow.css'
import './styles/scan-device-done.css'

/** 与 K1a 结果页游客句逐字相同。登录但还没证明文件归本人时，这句也不出现。 */
const GUEST_SENTENCE = '未登录扫描件不会进入「我的文档」，请在本次操作内完成打印或识别。要带走电子版，下次先扫码登录再扫。用 U 盘带走：在打印机面板上选「扫描到 U 盘」，这台机器暂未开通。'

type Owner = 'guest' | 'checking' | 'owned' | 'unproven'

/** 屏上扫描完成。文件卡用真实预览，不把示意纸页当成扫到的那一页。 */
export function ScanDeviceDonePage({ onGoStage }: { onGoStage?: (stage: ScanStage) => void } = {}) {
  const { isLoggedIn, getToken } = useAuth()
  const contact = useSupportContact(isLoggedIn)
  const session = readScanWorkbenchSession()
  const file = session?.result?.success === true ? session.result.file : undefined
  const fileId = file?.fileId ?? ''
  const material = session?.material ?? null
  const scanType = session?.scanType ?? 'document'
  const exits = useScanResultExits({ file, scanType })
  const [previewOpen, setPreviewOpen] = useState(false)
  const [owner, setOwner] = useState<Owner>(isLoggedIn ? 'checking' : 'guest')

  useEffect(() => {
    if (!isLoggedIn || !fileId) {
      setOwner(isLoggedIn ? 'unproven' : 'guest')
      return undefined
    }
    let stale = false
    setOwner('checking')
    void getMyDocuments(getToken(), { pageSize: 50 }).then((page) => {
      if (stale) return
      setOwner(page.items.some((item) => item.id === fileId) ? 'owned' : 'unproven')
    }).catch(() => {
      if (!stale) setOwner('unproven')
    })
    return () => { stale = true }
  }, [fileId, getToken, isLoggedIn])

  if (!file) return null

  const chip = SCAN_MATERIALS.find((item) => item.material === material)?.label ?? ''
  const pages = typeof file.pages === 'number' && Number.isInteger(file.pages) && file.pages >= 1 ? file.pages : null
  const meta = [file.format, file.size, pages != null ? `${pages} 页` : null].filter(Boolean).join(' · ')
  const resume = scanType === 'resume'
  const saved = owner === 'owned'
    ? `这份扫描件已存进「我的文档」${whenMiniapp(contact, '，手机上打开职易达小程序也能看到')}`
    : ''

  const again = (): void => {
    revokeLiveScanSession(getToken())
    beginDeviceScanAgain()
    onGoStage?.('start')
  }

  return (
    <ScanWorkbenchShell
      page="scan-done"
      state="completed"
      title="扫描完成，文件已传回"
      subtitle="先核对文件，再选下一步。"
      status={{ tone: 'ok', label: '文件已传回' }}
      bandEyebrow="扫描完成"
      bandRail={{ labels: SCAN_DEVICE_RAIL, now: 4 }}
      bandBack={false}
      dock={{
        omitLeft: true,
        primary: { label: '拿去打印', onClick: exits.handlePrint },
      }}
    >
      <div className="cs-flow cs-done" data-testid="scan-device-done" data-owner={owner}>
        <div className="cs-file">
          <div className="cs-fhead">
            <span className="ft">{file.format || '文件'}</span>
            <div className="tx">
              <b>{file.name}</b>
              <span className="meta" data-testid={pages != null ? 'scan-device-page-count' : undefined}>{meta}</span>
            </div>
            <span className="chips">
              {chip ? <span className="cs-chip">{chip}</span> : null}
              {material === 'id' ? <span className="cs-chip clay">敏感文件 · 自动清理</span> : null}
            </span>
          </div>
          <div className="cs-fpages">
            <FileContentPreview
              fileUrl={file.fileUrl}
              fileName={file.name}
              mimeType={file.mimeType}
              format={file.format}
              pdfFit="page"
            />
          </div>
          <button type="button" className="cs-open" data-testid="scan-device-preview-open" onClick={() => setPreviewOpen(true)}>
            整屏查看
          </button>
          <p className="cs-fine">页数和方向请自己核一下</p>
        </div>
        {owner === 'guest' ? <p className="cs-warn" role="note">{GUEST_SENTENCE}</p> : null}
        {saved ? <div className="cs-saved" role="status">{saved}</div> : null}
        <div className="cs-rows">
          <button type="button" className="cs-row" onClick={exits.handlePrint}>
            <span className="ic"><QxTouchIcon name="printer" size={36} strokeWidth={2} /></span>
            <span className="tx"><b>拿去打印</b><small>先检查文件和个人信息，再打印</small></span>
            <QxTouchIcon name="chevR" size={28} strokeWidth={2.4} />
          </button>
          <button type="button" className="cs-row" disabled={!resume} onClick={exits.handleResumeAI}>
            <span className="ic"><QxTouchIcon name="sparkle" size={36} strokeWidth={2} /></span>
            <span className="tx">
              <b>AI 简历识别</b>
              <small>
                {resume
                  ? '识别扫描件内容，进入简历诊断与优化'
                  : `AI 简历识别只对简历扫描开放；这次扫的是「${chip || '这份材料'}」。`}
              </small>
            </span>
          </button>
          {saved ? (
            <button type="button" className="cs-row" onClick={exits.handleDocuments}>
              <span className="ic"><QxTouchIcon name="folder" size={36} strokeWidth={2} /></span>
              <span className="tx"><b>前往我的文档</b><small>在「我的文档」里看和管理这份扫描件</small></span>
              <QxTouchIcon name="chevR" size={28} strokeWidth={2.4} />
            </button>
          ) : null}
          <button type="button" className="cs-row" data-testid="scan-device-again" onClick={again}>
            <span className="ic"><QxTouchIcon name="refresh" size={36} strokeWidth={2} /></span>
            <span className="tx"><b>再扫一份</b><small>回到第一步，重新选材料</small></span>
            <QxTouchIcon name="chevR" size={28} strokeWidth={2.4} />
          </button>
        </div>
        <div className="cs-remind">
          <QxTouchIcon name="file" size={34} strokeWidth={2} />
          <span>原件还在玻璃台或进纸器里，请取走</span>
        </div>
        {previewOpen ? (
          <ScanResultPreviewViewer
            file={{ name: file.name, fileUrl: file.fileUrl, size: file.size, pages: file.pages, mimeType: file.mimeType }}
            formatLabel={file.format}
            onClose={() => setPreviewOpen(false)}
          />
        ) : null}
      </div>
    </ScanWorkbenchShell>
  )
}
