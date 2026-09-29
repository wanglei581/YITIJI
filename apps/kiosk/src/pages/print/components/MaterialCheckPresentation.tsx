import {
  AlertCircleIcon,
  CheckCircleIcon,
  CreditCardIcon,
  IdCardIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  UserIcon,
  FileCheckIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
} from 'lucide-react'

import { FilePreviewPanel } from './PrintPreviewPanel'
import type { PrintFileState } from '../printMaterialSession'

export type MaterialCheckStage =
  | 'idle' | 'inspection' | 'normalize_a4' | 'pii_scan'
  | 'review' | 'submitting' | 'done' | 'error'

export interface MaterialFindingPresentation {
  id: string
  type: string
  pageNumber: number | null
  label: string
  maskedSnippet: string
  suggestion: string
  risk: 'high' | 'medium' | 'low'
  selected: 'pending' | 'keep' | 'redact'
}

export interface MaterialCheckPresentationProps {
  stage: MaterialCheckStage
  file: PrintFileState
  token: string | null
  error: string | null
  inspection: { pageLabel: string; canPrint: boolean | null; messages: readonly string[] } | null
  normalization: { targetPaperSize: string; canNormalize: boolean | null; messages: readonly string[] } | null
  privacyModeWarning: string | null
  /** 非警告性质的扫描说明（如历史 skipped_non_document）：不阻断、不给重试按钮，但也不说成已真实扫描。 */
  privacyModeNotice?: string | null
  demoMode: boolean
  findings: readonly MaterialFindingPresentation[]
  requiresFormatReview: boolean
  isWorking: boolean
  /** 预览认出打开密码。为真时不再把「重新检查」当成出路。 */
  encryptedPdf?: boolean
  onEncryptedPdf?: () => void
  onRetry: () => void
  onBack: () => void
  onApplySuggested: () => void
  onKeepAll: () => void
  onDecision: (findingId: string, action: 'keep' | 'redact') => void
}

const RISK_LABEL = { high: '高风险', medium: '中风险', low: '低风险' } as const

function FindingIcon({ type }: { type: string }) {
  const Icon = type.includes('id') ? IdCardIcon : type.includes('address') ? MapPinIcon
    : type === 'phone' ? PhoneIcon : type === 'email' ? MailIcon : type.includes('bank') ? CreditCardIcon : UserIcon
  return <Icon aria-hidden="true" />
}

function Step({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <li data-state={done ? 'done' : active ? 'active' : 'pending'}>
      <span aria-hidden="true">
        {done ? <CheckCircleIcon /> : active ? <LoaderCircleIcon /> : <ShieldCheckIcon />}
      </span>
      <b>{label}</b>
    </li>
  )
}

function Summary({
  title,
  detail,
  state,
  warning,
  messages,
}: {
  title: string
  detail: string
  state: string
  warning: boolean
  messages: readonly string[]
}) {
  return (
    <section className="qpd-summary" data-warning={warning ? 'true' : undefined}>
      <div>
        <strong>{title}</strong>
        <span>{state}</span>
      </div>
      <p>{detail}</p>
      {messages.length > 0 ? <ul>{messages.map((message) => <li key={message}>{message}</li>)}</ul> : null}
    </section>
  )
}

export function MaterialCheckPresentation(props: MaterialCheckPresentationProps) {
  const reviewReady = props.stage === 'review' || props.stage === 'submitting' || props.stage === 'done'
  const keptCount = props.findings.filter((finding) => finding.selected === 'keep').length
  const redactedCount = props.findings.filter((finding) => finding.selected === 'redact').length
  const decidedCount = keptCount + redactedCount
  const remaining = props.findings.length - decidedCount
  const workingTitle = props.stage === 'inspection' || props.stage === 'idle'
    ? '正在检查文件格式、大小与页数'
    : props.stage === 'normalize_a4'
      ? '正在评估 A4 版式'
      : props.stage === 'submitting'
        ? '正在保存选择并生成遮挡文件'
        : '正在检查隐私片段'

  return (
    <div className="qpd-check-grid" data-w2-page="print-material-check" data-qx-state={props.stage}>
      <aside className="qpd-check-left">
        <FilePreviewPanel file={props.file} token={props.token} onEncrypted={props.onEncryptedPdf} />
        <section className="qpd-options-note">
          <h3>两个选项分别是什么意思</h3>
          <p><b>保留：</b>这一处原样印在纸上。</p>
          <p><b>遮挡：</b>另生成一份把这一处涂黑的文件，打印用这一份；你上传的原文件不变。下一步可以逐页核对遮挡结果。</p>
        </section>
        <div className="qpd-privacy-note">
          <ShieldCheckIcon aria-hidden="true" />
          <p>扫描件或图片可能交给第三方识别文字。右侧只显示部分字符，请结合文件预览核对。</p>
        </div>
      </aside>

      <section className="qpd-check-right" aria-live="polite">
        {props.isWorking || props.stage === 'idle' ? (
          <div className="qpd-review">
            <div className="qx-state qpd-working" data-tone="info">
            <span className="qx-state-ic"><LoaderCircleIcon aria-hidden="true" /></span>
            <div>
              <div className="qx-state-t">{workingTitle}</div>
              <p className="qx-state-d">结果返回前不说“没问题”，也不会自动放行。</p>
            </div>
          </div>
          <ol className="qpd-steps" aria-label="材料检查进度">
          <Step label="文件体检" active={props.stage === 'inspection'} done={Boolean(props.inspection)} />
          <Step label="A4 规范化评估" active={props.stage === 'normalize_a4'} done={Boolean(props.normalization)} />
          <Step label="隐私片段检查" active={props.stage === 'pii_scan'} done={reviewReady} />
        </ol>
          <section className="qpd-options-note"><h3>检查完成后再决定</h3><p>会依次读取文件格式、页数和个人信息片段。文件还在本次办理里，检查没有完成前不能继续。</p></section>
          </div>
        ) : null}

        {props.stage === 'error' ? (
          <div className="qpd-review">
            <div className="qx-state qpd-error" data-tone="error" role="alert">
              <span className="qx-state-ic"><AlertCircleIcon aria-hidden="true" /></span>
              <div><h2 className="qx-state-t">材料检查未完成</h2><p className="qx-state-d">{props.error ?? '检查结果未知，请重新检查。隐私预检不可跳过。'}</p></div>
            </div>
            <section className="qpd-options-note"><h3>现在的事实</h3><ul><li>文件还在本次办理里。</li><li>检查结果未知，屏幕上不出现任何检查结论。</li><li>没检查完不能继续。</li></ul></section>
            <section className="qpd-options-note"><h3>两条路</h3><p><b>重试：</b>还是这一份再查一次，不重复收费。</p><button className="qx-btn" data-variant="primary" type="button" onClick={props.onRetry}>重试检查</button><p><b>返回选文件：</b>重新选择要打印的材料。</p><button className="qx-btn" data-variant="ghost" type="button" onClick={props.onBack}>返回选文件</button></section>
          </div>
        ) : null}

        {props.stage === 'review' ? (
          <div className="qpd-review">
            {props.error ? (
              <div className="qx-state" data-tone="error" role="alert">
                <span className="qx-state-ic"><AlertCircleIcon aria-hidden="true" /></span>
                <div>
                  <div className="qx-state-t">遮挡处理未完成</div>
                  <p className="qx-state-d">{props.error}</p>
                </div>
              </div>
            ) : null}
            {props.findings.length === 0 || props.privacyModeWarning || props.privacyModeNotice || props.demoMode ? <section className="qpd-result" data-warning={props.privacyModeWarning ? 'true' : undefined}>
              {props.privacyModeWarning ? <AlertCircleIcon aria-hidden="true" /> : <FileCheckIcon aria-hidden="true" />}
              <div>
                <h2>{props.privacyModeWarning ?? props.privacyModeNotice ?? (props.findings.length > 0 ? `发现 ${props.findings.length} 个需确认片段` : '检查完成，请自行再核对')}</h2>
                <p>
                  {props.encryptedPdf
                    ? '预览打不开，也不能按这一份继续。请去掉密码后重新选择文件。'
                    : props.privacyModeWarning
                    ? '扫描结果不完整，页面不会把它说成“没有隐私信息”。'
                    : props.privacyModeNotice
                      ? '本次没有做内容扫描，页面不会把它说成“没有隐私信息”，请结合预览自行确认。'
                    : props.findings.length > 0
                      ? '逐项选择保留或遮挡。全部决定并完成真实遮挡处理后，才能进入打印参数。'
                      : '规则没有检出片段不等于文件一定没有隐私，请结合预览自行确认。'}
                </p>
              </div>
              {props.demoMode ? <span>流程演示</span> : null}
            </section> : null}

            {props.privacyModeWarning && !props.encryptedPdf ? (
              <button className="qx-btn qpd-retry-scan" data-variant="danger" type="button" onClick={props.onRetry}>
                重新检查隐私内容
              </button>
            ) : null}


            {props.findings.length === 0 && !props.privacyModeWarning ? (
              <div className="qx-state qpd-clean" data-tone={props.requiresFormatReview ? 'error' : 'info'}>
                <span className="qx-state-ic">{props.requiresFormatReview ? <AlertCircleIcon /> : <CheckCircleIcon />}</span>
                <div>
                  <div className="qx-state-t">{props.requiresFormatReview ? '当前文件不能直接打印' : '没有待处理的隐私片段'}</div>
                  <p className="qx-state-d">{props.requiresFormatReview ? '返回上传页重新选择文件。' : props.privacyModeNotice ? '本次未做内容扫描；下一步仍需逐页核对预览和打印参数。' : '下一步请逐页核对预览和打印参数。'}</p>
                </div>
              </div>
            ) : props.findings.length > 0 ? (
              <>
                <div className="qpd-findings-heading"><span>01</span><h2>有 {props.findings.length} 处要你决定</h2></div>
                <div className="qpd-batch">
                  <div>
                    <button className="qx-btn" type="button" onClick={props.onApplySuggested}>按风险建议处理</button>
                    <button className="qx-btn" data-variant="ghost" type="button" onClick={props.onKeepAll}>全部保留</button>
                  </div>
                </div>
                <div className="qpd-findings">
                  {props.findings.map((finding) => (
                    <article className="qpd-finding" key={finding.id} data-risk={finding.risk}>
                      <FindingIcon type={finding.type} />
                      <div className="qpd-finding-main">
                        <header><strong>{finding.label}</strong><span>{RISK_LABEL[finding.risk]}</span></header>
                        <p className="qpd-finding-snippet">{finding.pageNumber === null ? '页码未知' : `第 ${finding.pageNumber} 页`} · {finding.maskedSnippet}</p>
                        <p className="qpd-finding-decision"><b>{finding.selected === 'keep' ? '已选保留。' : finding.selected === 'redact' ? '已选遮挡。' : '还没决定。'}</b>{finding.selected === 'keep' ? '这一处会原样印在纸上。' : finding.selected === 'redact' ? '另生成涂黑这一处的打印文件，原文件不变。' : '请选择保留或遮挡，下一步可以逐页核对。'}</p>
                        <p className="qpd-param-note">{finding.suggestion}</p>
                        <div className="qpd-decisions">
                          {(['keep', 'redact'] as const).map((action) => (
                            <button
                              key={action}
                              type="button"
                              data-selected={finding.selected === action ? 'true' : undefined}
                              data-action={action}
                              aria-pressed={finding.selected === action}
                              onClick={() => props.onDecision(finding.id, action)}
                            >
                              {action === 'redact' ? '遮挡' : '保留'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="qpd-decision-counts"><span>已决定 {decidedCount} / {props.findings.length}</span><span>保留 {keptCount} 处</span><span>遮挡 {redactedCount} 处</span></div>
                <p className="qpd-decision-status">{remaining > 0 ? `还有 ${remaining} 处等你决定` : '每一处都已决定，可以继续核对遮挡结果。'}</p>
              </>
            ) : null}
            <div className="qpd-summary-grid">
              {props.inspection ? (
                <Summary
                  title="文件体检"
                  detail={props.inspection.pageLabel}
                  state={props.encryptedPdf ? '打不开' : props.inspection.canPrint === true ? '可继续' : props.requiresFormatReview ? '需重新上传' : '请核对文件'}
                  warning={Boolean(props.encryptedPdf) || props.requiresFormatReview}
                  messages={props.inspection.messages}
                />
              ) : null}
              {props.normalization ? (
                <Summary
                  title="A4 版式评估"
                  detail={`目标纸张：${props.normalization.targetPaperSize}`}
                  state={props.normalization.canNormalize === true ? '已完成评估' : '请核对版式'}
                  warning={props.normalization.canNormalize !== true}
                  messages={props.normalization.messages}
                />
              ) : null}
            </div>

          </div>
        ) : null}
      </section>
    </div>
  )
}
