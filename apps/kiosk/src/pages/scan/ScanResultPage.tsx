import { useNavigate, useLocation } from 'react-router-dom'
import { Button, KioskActionBar, KioskPageFrame, KioskPageHeader, KioskStatePanel } from '@ai-job-print/ui'
import { makePrintParams } from '@ai-job-print/shared'
import {
  CheckIcon,
  FileTextIcon,
  FolderIcon,
  HomeIcon,
  PrinterIcon,
  RotateCcwIcon,
  SparklesIcon,
} from 'lucide-react'
import './styles/scan-fusion.css'

type ScanType = 'resume' | 'id' | 'document'

interface ScannedFile {
  fileId: string
  fileUrl: string
  name: string
  size: string
  pages: number | null
  format: 'PDF'
  mimeType?: string
}

interface ScanResultState {
  scanType?: ScanType
  source?: string
  pageMode?: string
  color?: string
  dpi?: number
  success?: boolean
  reason?: string
  file?: ScannedFile
}

const CONTROL_FIELDS = new Set(['success', 'reason', 'simulateFailure', 'failReason', 'file'])

const SCAN_TYPE_LABELS: Record<ScanType, string> = {
  resume: '简历扫描',
  id: '证件扫描',
  document: '普通文档',
}

export function ScanResultPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as ScanResultState
  const scanType = state.scanType ?? 'document'
  const success = state.success === true
  const reason = state.reason
  const file = state.file

  const handleRetry = () => {
    const retryState = Object.fromEntries(
      Object.entries(state).filter(([k]) => !CONTROL_FIELDS.has(k)),
    )
    navigate('/scan/settings', { state: retryState })
  }

  const handlePrint = () => {
    if (!file) return
    navigate('/print/confirm', {
      state: {
        file: { fileId: file.fileId, fileUrl: file.fileUrl, name: file.name, size: file.size, pages: file.pages, mimeType: file.mimeType },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
      },
    })
  }

  const handleSave = () => {
    if (!file) return
    navigate('/me/documents')
  }

  const handleResumeAI = () => {
    if (!file) return
    navigate('/resume/parse', {
      state: {
        source: 'scan',
        // ResumeParsePage 只读顶层 state.fileId 发起解析请求，file 内的 fileId/fileUrl
        // 仅用于展示；与 ResumeSourcePage 的既有上传流程保持同一 state 契约。
        fileId: file.fileId,
        file: { fileId: file.fileId, fileUrl: file.fileUrl, name: file.name, size: file.size, format: file.format },
      },
    })
  }

  if (!success) {
    return (
      <KioskPageFrame className="w2-scan-page">
        <div data-w2-page="scan-result" className="w2-scan-shell">
          <KioskPageHeader title="扫描未完成" description="本次没有生成可用的扫描文件" onBack={() => navigate('/scan/start')} backLabel="返回扫描首页" />
          <section className="w2-scan-content w2-scan-result-state">
            <KioskStatePanel
              tone="error"
              title="扫描失败"
              description={reason ?? '扫描任务未能完成，请重试或联系工作人员'}
              actions={<><Button variant="secondary" size="lg" onClick={() => navigate('/')}>返回首页</Button><Button size="lg" onClick={handleRetry}>重试扫描</Button></>}
            />
          </section>
        </div>
      </KioskPageFrame>
    )
  }

  return (
    <KioskPageFrame className="w2-scan-page">
      <div data-w2-page="scan-result" className="w2-scan-shell">
      <KioskPageHeader title="扫描完成" description="请核对文件信息，选择下一步操作" aside={<span className="w2-scan-status-chip is-ready"><span />扫描已完成</span>} />

      <div className="w2-scan-steps" aria-label="扫描流程">
        {['选择类型', '扫描指引', '扫描中', '完成'].map((label, index) => (
          <div key={label} className={index < 3 ? 'is-done' : 'is-active'}><span><CheckIcon /></span>{label}</div>
        ))}
      </div>

      <section className="w2-scan-content w2-scan-result-content">
        {file ? (
          <section className="w2-scan-file-card">
            <span className="w2-scan-file-icon"><FileTextIcon /></span>
            <div><p>{SCAN_TYPE_LABELS[scanType]}</p><h2>{file.name}</h2><div className="w2-scan-chips"><small>{file.size}</small><small data-tone="ok">{file.format}</small><small>{file.pages != null ? `${file.pages} 页` : '页数以文件为准'}</small><small data-tone="warn">临时文件 · 设有效期</small></div></div>
          </section>
        ) : (
          <KioskStatePanel compact tone="error" title="缺少扫描结果文件" description="本页未收到真实扫描结果，不会生成占位文件。请重新开始扫描。" />
        )}

        <section className="w2-scan-result-actions">
          <h2>选择下一步操作</h2>
          <div>
            <button
              type="button"
              disabled={scanType !== 'resume' || !file}
              onClick={handleResumeAI}
              className="is-primary"
            >
              <SparklesIcon /><span><b>AI 简历识别</b><small>识别扫描件内容，进入简历诊断与优化</small></span>
            </button>
            <button type="button" disabled={!file} onClick={handlePrint}>
              <PrinterIcon /><span><b>直接打印</b><small>按默认参数进入确认打印，可再修改</small></span>
            </button>
            <button type="button" disabled={!file} onClick={handleSave}>
              <FolderIcon /><span><b>保存到我的文档</b><small>前往我的文档查看与管理已保存文件</small></span>
            </button>
            <button type="button" onClick={() => navigate('/')}>
              <HomeIcon /><span><b>返回首页</b><small>结束本次扫描，回到功能大厅</small></span>
            </button>
          </div>
        </section>
      </section>

      <KioskActionBar leading={<span className="w2-scan-action-note">未选择去向的临时文件会按服务端策略清理</span>}>
        <Button variant="secondary" size="lg" onClick={handleRetry}>
          <RotateCcwIcon />重新扫描
        </Button>
      </KioskActionBar>
      </div>
    </KioskPageFrame>
  )
}
