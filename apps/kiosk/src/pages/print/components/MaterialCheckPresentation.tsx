import {
  AlertCircleIcon,
  CheckCircleIcon,
  EyeOffIcon,
  FileCheckIcon,
  FileTextIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
} from 'lucide-react'

export type MaterialCheckStage =
  | 'idle' | 'inspection' | 'normalize_a4' | 'pii_scan'
  | 'review' | 'submitting' | 'done' | 'error'

export interface MaterialFindingPresentation {
  id: string
  label: string
  maskedSnippet: string
  suggestion: string
  risk: 'high' | 'medium' | 'low'
  selected: 'pending' | 'keep' | 'redact'
}

export interface MaterialCheckPresentationProps {
  stage: MaterialCheckStage
  file: { name: string; size: string; pages: number | null }
  error: string | null
  inspection: { pageLabel: string; canPrint: boolean | null; messages: readonly string[] } | null
  normalization: { targetPaperSize: string; canNormalize: boolean | null; messages: readonly string[] } | null
  privacyModeWarning: string | null
  demoMode: boolean
  findings: readonly MaterialFindingPresentation[]
  requiresFormatReview: boolean
  isWorking: boolean
  onRetry: () => void
  onApplySuggested: () => void
  onKeepAll: () => void
  onDecision: (findingId: string, action: 'keep' | 'redact') => void
}

const RISK_LABEL = { high: '高风险', medium: '中风险', low: '低风险' } as const

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
  const workingTitle = props.stage === 'inspection'
    ? '正在检查文件格式、大小与页数'
    : props.stage === 'normalize_a4'
      ? '正在评估 A4 版式'
      : props.stage === 'submitting'
        ? '正在保存选择并生成遮挡文件'
        : '正在检查隐私片段'

  return (
    <div className="qpd-check-grid" data-w2-page="print-material-check" data-qx-state={props.stage}>
      <aside className="qpd-check-left">
        <div className="qpd-file-sheet" aria-label="待检查文件">
          <FileTextIcon aria-hidden="true" />
          <strong>{props.file.name}</strong>
          <span>{props.file.size}</span>
          <span>{props.file.pages === null ? '页数识别中' : `${props.file.pages} 页`}</span>
        </div>

        <ol className="qpd-steps" aria-label="材料检查进度">
          <Step label="文件体检" active={props.stage === 'inspection'} done={Boolean(props.inspection)} />
          <Step label="A4 规范化评估" active={props.stage === 'normalize_a4'} done={Boolean(props.normalization)} />
          <Step label="隐私片段检查" active={props.stage === 'pii_scan'} done={reviewReady} />
        </ol>

        <div className="qpd-privacy-note">
          <ShieldCheckIcon aria-hidden="true" />
          <p>文字版文档直接读取文字层；扫描件或图片可能通过第三方 OCR 识别。这里只显示脱敏片段，不展示完整原文。</p>
        </div>
      </aside>

      <section className="qpd-check-right" aria-live="polite">
        {props.isWorking ? (
          <div className="qx-state qpd-working" data-tone="info">
            <span className="qx-state-ic"><LoaderCircleIcon aria-hidden="true" /></span>
            <div>
              <div className="qx-state-t">{workingTitle}</div>
              <p className="qx-state-d">结果返回前不说“没问题”，也不会自动放行。</p>
            </div>
          </div>
        ) : null}

        {props.stage === 'error' ? (
          <div className="qx-state qpd-error" data-tone="error">
            <span className="qx-state-ic"><AlertCircleIcon aria-hidden="true" /></span>
            <div>
              <h2 className="qx-state-t">材料检查未完成</h2>
              <p className="qx-state-d">{props.error ?? '检查结果未知，请重新检查。隐私预检不可跳过。'}</p>
              <button className="qx-btn" data-variant="danger" type="button" onClick={props.onRetry}>重试检查</button>
            </div>
          </div>
        ) : null}

        {props.stage === 'review' ? (
          <div className="qpd-review">
            <section className="qpd-result" data-warning={props.privacyModeWarning ? 'true' : undefined}>
              {props.privacyModeWarning ? <AlertCircleIcon aria-hidden="true" /> : <FileCheckIcon aria-hidden="true" />}
              <div>
                <h2>{props.privacyModeWarning ?? (props.findings.length > 0 ? `发现 ${props.findings.length} 个需确认片段` : '检查完成，请自行再核对')}</h2>
                <p>
                  {props.privacyModeWarning
                    ? '扫描结果不完整，页面不会把它说成“没有隐私信息”。'
                    : props.findings.length > 0
                      ? '逐项选择保留或遮挡。全部决定并完成真实遮挡处理后，才能进入打印参数。'
                      : '规则没有检出片段不等于文件一定没有隐私，请结合预览自行确认。'}
                </p>
              </div>
              {props.demoMode ? <span>流程演示</span> : null}
            </section>

            {props.privacyModeWarning ? (
              <button className="qx-btn qpd-retry-scan" data-variant="danger" type="button" onClick={props.onRetry}>
                重新检查隐私内容
              </button>
            ) : null}

            <div className="qpd-summary-grid">
              {props.inspection ? (
                <Summary
                  title="文件体检"
                  detail={props.inspection.pageLabel}
                  state={props.requiresFormatReview ? '需重新上传' : '可继续'}
                  warning={props.requiresFormatReview}
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

            {props.findings.length === 0 ? (
              <div className="qx-state qpd-clean" data-tone={props.requiresFormatReview ? 'error' : 'info'}>
                <span className="qx-state-ic">{props.requiresFormatReview ? <AlertCircleIcon /> : <CheckCircleIcon />}</span>
                <div>
                  <div className="qx-state-t">{props.requiresFormatReview ? '当前文件不能直接打印' : '没有待处理的隐私片段'}</div>
                  <p className="qx-state-d">{props.requiresFormatReview ? '返回上传页重新选择文件。' : '预检已经真实完成；下一步仍需逐页核对预览和打印参数。'}</p>
                </div>
              </div>
            ) : (
              <>
                <div className="qpd-batch">
                  <div><strong>逐条裁决</strong><span>遮挡会生成派生文件；生成结果以后端返回为准。</span></div>
                  <div>
                    <button className="qx-btn" type="button" onClick={props.onApplySuggested}>按风险建议处理</button>
                    <button className="qx-btn" data-variant="ghost" type="button" onClick={props.onKeepAll}>全部保留</button>
                  </div>
                </div>
                <div className="qpd-findings">
                  {props.findings.map((finding) => (
                    <article className="qpd-finding" key={finding.id} data-risk={finding.risk}>
                      <EyeOffIcon aria-hidden="true" />
                      <div className="qpd-finding-main">
                        <header><strong>{finding.label}</strong><span>{RISK_LABEL[finding.risk]}</span></header>
                        <dl>
                          <div><dt>片段</dt><dd>{finding.maskedSnippet}</dd></div>
                          <div><dt>建议</dt><dd>{finding.suggestion}</dd></div>
                        </dl>
                        <div className="qpd-decisions">
                          {(['redact', 'keep'] as const).map((action) => (
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
              </>
            )}
          </div>
        ) : null}
      </section>
    </div>
  )
}
