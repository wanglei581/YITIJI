import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { makePrintParams } from '@ai-job-print/shared'
import {
  FileTextIcon,
  FolderIcon,
  HeadphonesIcon,
  HomeIcon,
  PrinterIcon,
  RotateCcwIcon,
  SparklesIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { FileContentPreview } from '../../components/FileContentPreview'
import { formatLabelFromMime } from './scanOutputFormat'
import {
  ScanCta,
  ScanNoteCard,
  ScanPlan,
  ScanStatusPanel,
  ScanWorkbenchShell,
} from './ScanWorkbenchChrome'
import { SCAN_TYPE_LABELS, type ScanType } from './scanWorkbench'
import { type ScanStage } from './scanWorkbenchModel'
import { revokeLiveScanSession } from './scanSessionRevoke'
import {
  armScanRescanAuthority,
  beginScanRescan,
  clearScanRescanAuthority,
  clearScanWorkbenchSession,
  hasScanRescanAuthority,
  readScanWorkbenchSession,
  type ScanOutcome,
} from './scanWorkbenchSession'

interface ScannedFile {
  fileId: string
  fileUrl: string
  name: string
  size: string
  pages: number | null
  format: string
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
  outcome?: ScanOutcome
  file?: ScannedFile
}

const CONTROL_FIELDS = new Set(['success', 'reason', 'simulateFailure', 'failReason', 'file', 'outcome'])

function deriveOutcome(state: ScanResultState): ScanOutcome {
  if (state.outcome) return state.outcome
  if (state.success === true && state.file) return 'completed'
  if (state.reason?.includes('未拿到文件')) return 'completed-no-file'
  if (state.reason?.includes('超时') || state.reason?.includes('过期')) return 'expired'
  return 'failed'
}

export function ScanResultPage({ onGoStage }: { onGoStage?: (stage: ScanStage) => void } = {}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isLoggedIn, getToken } = useAuth()
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
  const file = state.file
  const outcome = deriveOutcome(state)
  // 刚结束那一场的凭证还留在本机登记里（finishWithResult 刻意不抹 live）。
  // 这里只读，不改：它是「向服务端取用那枚一次性重扫授权」的唯一来源。
  const priorScanTaskId = stored?.live?.scanTaskId ?? null
  const priorControlToken = stored?.live?.controlToken ?? null
  const [rescanAuthorized, setRescanAuthorized] = useState(false)

  /* ── 这一场结束了：要不要留一枚安全重扫授权 ────────────────────────────
   *
   * 服务端只在任务**已经取到文件**（matched，内容 hash 已落 lastAttemptHash）之后
   * 才落到 failed / cancelled / expired 的那几条路径上铸授权。前端能看见的对应终态
   * 就是 failed 和 expired —— 只有这两种登记。
   *
   * 另外两种终态必须**反过来**：completed 和「完成但没带文件」的任务服务端已经建了档
   * （fileId 非空），按契约根本不会有授权，所以这里显式扔掉。
   *
   * 说清这一句的性质，免得下一个人误判它的分量：它是**纵深**，不是当前唯一的防线。
   * 今天走到成功终态之前必然先经过一次创建，而创建那一步是一次性取用
   * （`takeScanRescanAuthority`），槽位那时已经空了；离开这一屏的几个出口也各自
   * 清场。它守的是那些前提被改坏的将来 —— 比如 `deriveOutcome` 的兜底分支被调整、
   * 或者哪天成功终态不再必须经过一次创建。
   *
   * 登记本身不代表授权真的存在（本机看不见服务端有没有铸）。它只是「可以去取用一次」，
   * 取不取得到由服务端 403 说了算，页面不替它下结论。 */
  useEffect(() => {
    if (outcome !== 'failed' && outcome !== 'expired') {
      clearScanRescanAuthority()
      setRescanAuthorized(false)
      return
    }
    if (priorScanTaskId && priorControlToken) {
      armScanRescanAuthority({ priorScanTaskId, priorControlToken, scanType })
    }
    setRescanAuthorized(hasScanRescanAuthority(scanType))
  }, [outcome, priorScanTaskId, priorControlToken, scanType])

  const handleRetry = () => {
    const retryState = Object.fromEntries(
      Object.entries(state).filter(([k]) => !CONTROL_FIELDS.has(k)),
    )
    // 结束这一场并把那枚一次性安全重扫授权移交给下一场。
    // 三步（取出 / 推进代次 / 按新代次重新登记）必须原子，所以整段收在
    // scanWorkbenchSession 里 —— 在这里先 patch 再取，授权会被自己清掉，
    // 「重试扫描」就静默退化成一个会撞同字节去重的普通新会话。
    beginScanRescan({
      scanType,
      extras: {
        source: state.source,
        pageMode: state.pageMode,
        color: state.color,
        dpi: state.dpi,
      },
    })
    if (onGoStage) {
      onGoStage('settings')
      return
    }
    navigate('/scan?stage=settings', { state: retryState })
  }

  /**
   * 离开整条扫描流程 —— 结果页 ctabar / 底部那几个出口。
   *
   * 语义必须和 `ScanWorkbenchChrome` 的 `leaveScanFlow` 一模一样（顶栏返回、底栏三项
   * 走的是那一条）。此前这几个出口只是裸 `navigate`，同一屏上就成了两种命运：从顶栏
   * 走的人本机登记被清干净，从这里走的人把 live 登记（含刚结束那一场的 controlToken
   * 明文）和那枚一次性重扫授权**一起留在原地**，下一位用户走到这台机器前就继承了 ——
   * 授权会被他拿去对一个不属于他的任务发重扫请求，登记里那份凭证则一直躺到下次清场。
   *
   * 撤销那一句对已终态的任务是 no-op：`revokeLiveScanSession` 见到结果快照就不发 DELETE
   * （scanSessionRevoke 的 hasResult 分支）。留着它是为了「离开的语义只有一份」——
   * 结果页也可能在只有 live、还没写进结果快照的那一帧被按下出口。
   */
  const leaveScanFlow = (destination: string): void => {
    revokeLiveScanSession(getToken())
    clearScanWorkbenchSession()
    navigate(destination)
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

  const handleDocuments = () => {
    if (!file || !isLoggedIn) return
    navigate('/me/documents')
  }

  const displayFormat = formatLabelFromMime(file?.mimeType)

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

  if (outcome === 'completed-no-file' || (!success && outcome !== 'completed')) {
    const isNoFile = outcome === 'completed-no-file'
    const isExpired = outcome === 'expired'
    return (
      <ScanWorkbenchShell
        page="scan-result"
        state={isNoFile ? 'completed-no-file' : 'failed'}
        title={isNoFile ? '已完成 · 回执里没有文件' : isExpired ? '会话已过期' : '扫描未完成'}
        subtitle="本次没有生成可用的扫描文件"
        status={{ tone: isNoFile || isExpired ? 'warn' : 'bad', label: isNoFile ? '已完成 · 回执里没有文件' : isExpired ? '会话已过期' : '扫描未完成' }}
        ctabar={
          <ScanCta>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => leaveScanFlow('/print-scan')}>
              返回打印扫描
            </button>
            {isNoFile ? (
              <button type="button" className="qx-btn" data-variant="ghost" onClick={() => leaveScanFlow('/help')}>
                <HeadphonesIcon aria-hidden />
                联系工作人员
              </button>
            ) : (
              <button type="button" className="qx-btn" data-variant="ghost" onClick={() => leaveScanFlow('/')}>
                返回首页
              </button>
            )}
            <button type="button" className="qx-btn" data-variant="primary" onClick={handleRetry}>
              {rescanAuthorized ? '重试扫描（同一份材料）' : '重试扫描'}
            </button>
          </ScanCta>
        }
      >
        <ScanStatusPanel
          tone={isNoFile ? 'warn' : 'error'}
          title={isNoFile ? '服务端说已完成，但这次回执里没有可用文件' : isExpired ? '扫描超时，会话已过期' : '扫描失败'}
          chips={[
            { label: isNoFile ? 'status completed' : isExpired ? '服务端确认过期' : '服务端确认失败', tone: isNoFile ? 'ok' : 'warn' },
            { label: '本次会话没有文件', tone: 'warn' },
          ]}
        >
          {isNoFile ? (
            <>
              <p>服务端确认<b>这次扫描已经完成</b>，可是同一份回执里<b>没有带可用的文件信息</b>（file 为 null，这在状态合同里是允许的取值，不是服务端出错）。</p>
              <p>这份文件此刻还在不在服务端，<b>本机没有依据判断</b>。页面不替服务端说它还在，不说它已被删掉，也不承诺能找回来。</p>
            </>
          ) : (
            <p>{reason ?? '扫描任务未能完成，请重试或联系工作人员'}</p>
          )}
        </ScanStatusPanel>
        <div className="sw-grid2">
          <ScanNoteCard title="现在能做什么" foot="重扫是另建一个会话，不是接着这一次。">
            <ScanPlan items={[
              '点右下角重试扫描：那是另一次任务。',
              '重扫之前把纸取回来抚平、订书钉取掉。',
              /* 服务端对「取过件但没建档成功」的同一份字节有两小时去重（它挡的是把上一位的
               * 扫描件误挂到下一位头上）。所以这句必须按手里有没有那份凭据分开说。
               *
               * 措辞上有一条不能越过：**本机不知道服务端到底铸没铸过那枚授权**。服务端只在
               * 任务已经取到文件（matched + 内容 hash 已落 lastAttemptHash）之后落到
               * failed / cancelled / expired 时才铸；而本机在一个还停在 waiting 的任务上
               * 放弃轮询，也会走到这一屏 —— 那种情况根本没有授权，凭据照样在手里。
               * 所以这里只能说「会带着凭据去申请」，不能说「服务端已经放行」。
               * 真正有资格说「已放行」的是设置页：那一行只在创建成功之后才出现，
               * 而带着重扫两半的创建能成功，等于服务端已经把授权消费掉了。 */
              rescanAuthorized
                ? '这一次会带上上一场的凭据去申请安全重扫放行：服务端认了，同一份材料照原样再扫一遍就行；不认会在下一页当场说明，不会悄悄按普通重扫处理。'
                : '本机没有可用的安全重扫凭据：同一张纸原样再扫，服务端可能按重复件拒收（两小时内），换一次扫描或找工作人员。',
              isNoFile ? '这个编号问不出文件，反复点也是同一句回执。' : '同一份材料连续失败两次，就找工作人员。',
            ]} />
          </ScanNoteCard>
          <ScanNoteCard title="本机不会替服务端补话">
            <ScanPlan items={[
              '不猜纸张或机器故障原因，本机收不到这些事件。',
              '不自动重扫，避免同一份材料出两份。',
              '不说「稍后会好」，也不按等待时长改判结果。',
            ]} />
          </ScanNoteCard>
        </div>
      </ScanWorkbenchShell>
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
      status={{ tone: 'ok', label: '服务端已回完成并带回文件' }}
      ctabar={
        <ScanCta reason="未选择去向的临时文件会按服务端策略清理；本页不会伪造“已保存”">
          <button type="button" className="qx-btn" data-variant="ghost" onClick={handleRetry}>
            <RotateCcwIcon aria-hidden />
            重新扫描
          </button>
          <button type="button" className="qx-btn" data-variant="primary" disabled={!printEnabled} onClick={handlePrint}>
            直接打印
          </button>
        </ScanCta>
      }
    >
      <div className="sw-result qx-grow">
        <div className="sw-preview">
          <div className="sw-pvhead" data-testid="scan-workbench-file-brief">
            <div className="sw-pvh-1">
              <span className="sw-pvh-ic"><FileTextIcon size={24} aria-hidden /></span>
              <span className="sw-pvh-t">服务端回执：已完成，并带回文件</span>
              <span className="sw-chip is-ok">{SCAN_TYPE_LABELS[scanType]}</span>
            </div>
            {file ? (
              <div className="sw-pvh-2">
                <b>{file.name}</b>
                <span className="sep">·</span>
                <span>{displayFormat}</span>
                <span className="sep">·</span>
                <span>{file.size}</span>
                <span className="sep">·</span>
                <span>{file.pages != null ? `${file.pages} 页` : '页数以文件为准'}</span>
              </div>
            ) : null}
          </div>
          <div className="sw-pvstage">
            {file ? (
              <FileContentPreview
                fileUrl={file.fileUrl}
                fileName={file.name}
                mimeType={file.mimeType}
                format={displayFormat}
              />
            ) : (
              <ScanStatusPanel tone="error" title="缺少扫描结果文件">
                <p>本页未收到真实扫描结果，不会生成占位文件。请重新开始扫描。</p>
              </ScanStatusPanel>
            )}
          </div>
          <p className="sw-preview-cap">
            预览走回执里那条签名内容链接（<b>/files/:id/content</b>，只验 HMAC），本页不调用要登录的预览签发接口。打不开只证明这一次没打开，不改判扫描已完成，也不能据此判断文件是否仍可用。
          </p>
        </div>
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
            <span className="sw-exit-title">直接打印</span>
            <small>按默认参数进入确认打印，可再修改。金额由服务端报价决定，本页不给价格。</small>
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
                : '未登录扫描件不会进入「我的文档」，请在本次操作内完成打印或识别'}
            </small>
          </span>
        </button>
      </div>
      <button type="button" className="sw-exit sw-home-exit" onClick={() => leaveScanFlow('/')}>
        <span className="sw-exit-ic"><HomeIcon size={20} aria-hidden /></span>
        <span className="sw-exit-body">
          <span className="sw-exit-title">返回首页</span>
          <small>结束本次扫描，回到功能大厅</small>
        </span>
      </button>
      </div>
    </ScanWorkbenchShell>
  )
}
