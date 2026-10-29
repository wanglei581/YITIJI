// 材料检查（打印第 2 步）正文。版式照第 5 版稿 pii：预检说明条、文档小样、逐处「保留 / 遮挡」、
// 计数与两句解释、「按风险建议处理 / 全部保留」。检查中、没做成、格式不能打、打开密码、OCR 没覆盖
// 这些稿里没画的态沿用同一组件语言，一样不丢。
import { QxTouchCallout } from '../../../components/qingxu/touch/QxTouchCallout'
import { QxTouchIcon } from '../../../components/qingxu/touch/QxTouchIcon'
import { ENCRYPTED_PDF_UNLOCK_STEPS } from './printPreviewKind'
import { FileThumbCard } from './FileThumbCard'
import { PrintIcon } from '../art/PrintIcon'
import { PrintFillArt } from '../art/PrintFillArt'
import type { PrintFileState } from '../printMaterialSession'
import { useSupportContact } from '../../../hooks/useSupportContact'
import { preferUnattended, printProblemLine } from '../../../copy/unattendedCopy'

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
  /** 稿顶部那条预检说明（格式、大小、页数、图片清晰度已检查 · 不做 AI 判断）。 */
  precheckLine: string
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
  const support = useSupportContact()
  const errorText = props.error
    ? preferUnattended(props.error, `材料检查没做成。${printProblemLine(support)}`)
    : null
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
  const steps = [
    { label: '文件体检', active: props.stage === 'inspection', done: Boolean(props.inspection) },
    { label: 'A4 规范化评估', active: props.stage === 'normalize_a4', done: Boolean(props.normalization) },
    { label: '隐私片段检查', active: props.stage === 'pii_scan', done: reviewReady },
  ]

  return (
    <div className="pdk-check" data-w2-page="print-material-check" data-qx-state={props.stage} data-encrypted={props.encryptedPdf ? 'true' : undefined}>
      <div className="qxt-howto" data-feature="文件预检">
        <PrintIcon name="shield" size={34} />
        <span>{props.precheckLine}</span>
      </div>
      {props.stage === 'error' ? (
        // 没做成时不去取文件内容画小样，但这一份文件的名字仍要在屏上，别让人以为文件没了。
        <div className="pdk-doc pdk-doc-sm" data-testid="print-check-file-line">
          <div className="qpd-preview-meta pdk-doc-meta" aria-label="当前文件">
            <strong title={props.file.name}>{props.file.name}</strong>
            <span>{props.file.pages === null ? '页数待识别' : `共 ${props.file.pages} 页`} · {props.file.size}</span>
          </div>
        </div>
      ) : (
        <FileThumbCard file={props.file} token={props.token} onEncrypted={props.onEncryptedPdf} />
      )}

      {props.isWorking || props.stage === 'idle' ? (
        <>
          <div className="pdk-live qpd-working" role="status" aria-live="polite">
            <span className="fs-spin" aria-hidden="true" />
            <div>
              <b>{workingTitle}</b>
              <small>结果返回前不说“没问题”，也不会自动放行。</small>
            </div>
          </div>
          <ol className="qxt-steps pdk-steps" aria-label="材料检查进度">
            {steps.map((step, index) => (
              <li className="qxt-step" key={step.label} data-state={step.done ? 'done' : step.active ? 'now' : 'wait'}>
                <span className="qxt-step-n">{index + 1}</span>
                <b>{step.label}</b>
                <small>{step.done ? '已完成' : step.active ? '进行中' : '等待中'}</small>
              </li>
            ))}
          </ol>
          <p className="pdk-opt">会依次读取文件格式、页数和个人信息片段。文件还在本次办理里，检查没有完成前不能继续。</p>
        </>
      ) : null}

      {props.stage === 'error' ? (
        <>
          <div className="qxt-reason-box" role="alert">
            <h2><QxTouchIcon name="alert" size={30} strokeWidth={2} />材料检查未完成</h2>
            <p className="qxt-reason">{errorText ?? '检查结果未知，请重新检查。隐私预检不可跳过。'}</p>
          </div>
          <section className="pdk-facts">
            <h3>现在的事实</h3>
            <ul>
              <li>当前文件：{props.file.name || '还没有文件名'}。文件还在本次办理里。</li>
              <li>检查结果未知，屏幕上不出现任何检查结论。</li>
              <li>没检查完不能继续。</li>
            </ul>
          </section>
          <section className="pdk-facts">
            <h3>两条路</h3>
            <div className="pdk-batch">
              <div>
                <p><b>重试：</b>还是这一份再查一次，不重复收费。</p>
                <button className="qxt-btn qxt-btn-sec" type="button" onClick={props.onRetry}>重试检查</button>
              </div>
              <div>
                <p><b>返回选文件：</b>重新选择要打印的材料。</p>
                <button className="qxt-btn qxt-btn-sec" type="button" onClick={props.onBack}>返回选文件</button>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {props.stage === 'review' ? (
        <>
          {props.error ? (
            <div className="qxt-reason-box" role="alert">
              <h2><QxTouchIcon name="alert" size={30} strokeWidth={2} />遮挡处理未完成</h2>
              <p className="qxt-reason">{errorText}</p>
            </div>
          ) : null}
          {props.findings.length === 0 || props.privacyModeWarning || props.privacyModeNotice || props.demoMode ? (
            <section className="pdk-result" data-warning={props.privacyModeWarning ? 'true' : undefined}>
              <QxTouchIcon name={props.privacyModeWarning ? 'alert' : 'check'} size={34} strokeWidth={2.2} />
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
              {props.demoMode ? <span className="pdk-demo">流程演示</span> : null}
            </section>
          ) : null}

          {props.privacyModeWarning && !props.encryptedPdf ? (
            <button className="qxt-btn qxt-btn-sec pdk-retry-scan" type="button" onClick={props.onRetry}>
              重新检查隐私内容
            </button>
          ) : null}

          {props.findings.length === 0 && !props.privacyModeWarning ? (
            <div className="pdk-clean qpd-clean" data-tone={props.requiresFormatReview ? 'error' : 'info'}>
              <QxTouchIcon name={props.requiresFormatReview ? 'alert' : 'check'} size={34} strokeWidth={2.2} />
              <div>
                <div className="pdk-clean-t">{props.requiresFormatReview ? '当前文件不能直接打印' : '没有待处理的隐私片段'}</div>
                <p>{props.requiresFormatReview ? '返回上传页重新选择文件。' : props.privacyModeNotice ? '本次未做内容扫描；下一步仍需逐页核对预览和打印参数。' : '下一步请逐页核对预览和打印参数。'}</p>
              </div>
            </div>
          ) : props.findings.length > 0 ? (
            <>
              <div className="pdk-finds">
                {props.findings.map((finding) => (
                  <article className="pdk-find" key={finding.id} data-risk={finding.risk}>
                    <div className="pdk-find-tx">
                      <b className="qpd-finding-snippet">{finding.pageNumber === null ? '页码未知' : `第 ${finding.pageNumber} 页`} · {finding.maskedSnippet}</b>
                      <small className="qpd-finding-decision">
                        {finding.selected === 'keep'
                          ? '已选保留 · 这一处会原样印在纸上'
                          : finding.selected === 'redact'
                            ? '已选遮挡 · 另生成涂黑这一处的打印文件，原文件不变'
                            : '还没决定 · 请选择保留或遮挡，下一步可以逐页核对'}
                      </small>
                      <em className="pdk-find-tag">{finding.label} · {RISK_LABEL[finding.risk]}</em>
                    </div>
                    <div className="pdk-find-acts">
                      {(['keep', 'redact'] as const).map((action) => (
                        <button
                          key={action}
                          type="button"
                          className="pdk-choice"
                          data-selected={finding.selected === action ? 'true' : undefined}
                          data-action={action}
                          aria-pressed={finding.selected === action}
                          onClick={() => props.onDecision(finding.id, action)}
                        >
                          {action === 'redact' ? '遮挡' : '保留'}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
              <p className="pdk-count qpd-decision-counts">已决定 {decidedCount} / {props.findings.length} · 保留 {keptCount} 处 · 遮挡 {redactedCount} 处</p>
              <p className="pdk-opt qpd-decision-status">{remaining > 0 ? `还有 ${remaining} 处等你决定` : '每一处都已决定，可以继续核对遮挡结果。'}</p>
              <p className="pdk-opt"><b>保留：</b>这一处原样印在纸上。</p>
              <p className="pdk-opt"><b>遮挡：</b>另生成一份把这一处涂黑的文件，打印用这一份；你上传的原文件不变。下一步可以逐页核对遮挡结果。</p>
              <div className="pdk-batch pdk-batch-btns">
                <button className="qxt-btn qxt-btn-sec" type="button" onClick={props.onApplySuggested}>按风险建议处理</button>
                <button className="qxt-btn qxt-btn-sec" type="button" onClick={props.onKeepAll}>全部保留</button>
              </div>
            </>
          ) : null}

          {props.inspection || (props.normalization && !props.encryptedPdf) ? (
            <div className="qpd-summary-grid pdk-summaries" data-single={props.encryptedPdf ? 'true' : undefined}>
              {props.inspection ? (
                <Summary
                  title="文件体检"
                  detail={props.inspection.pageLabel}
                  state={props.encryptedPdf ? '打不开' : props.inspection.canPrint === true ? '可继续' : props.requiresFormatReview ? '需重新上传' : '请核对文件'}
                  warning={Boolean(props.encryptedPdf) || props.requiresFormatReview}
                  messages={props.inspection.messages}
                />
              ) : null}
              {props.normalization && !props.encryptedPdf ? (
                <Summary
                  title="A4 版式评估"
                  detail={`目标纸张：${props.normalization.targetPaperSize}`}
                  state={props.normalization.canNormalize === true ? '已完成评估' : '请核对版式'}
                  warning={props.normalization.canNormalize !== true}
                  messages={props.normalization.messages}
                />
              ) : null}
            </div>
          ) : null}
          {props.encryptedPdf ? null : (
            <QxTouchCallout kind="fine">
              {props.privacyModeWarning
                ? '这次没有完整检查文件，请自行核对原件并确认检查说明。'
                : props.privacyModeNotice
                  ? '按本页检查说明继续人工核对原件。'
                  : remaining > 0
                    ? '每一处都要由你选择保留或遮挡，选完才能继续。报价由下一步的系统给出，在那之前不产生任何费用。'
                    : '确认版面、份数和页范围，再看这台机器的能力与状态。报价由下一步的系统给出，在那之前不产生任何费用。'}
            </QxTouchCallout>
          )}
          {props.encryptedPdf ? (
            <ol className="qxt-steps qxt-steps-big pdk-unlock" aria-label="怎么去掉打开密码">
              {ENCRYPTED_PDF_UNLOCK_STEPS.map((step, index) => (
                <li className="qxt-step" key={step.title}>
                  <span className="qxt-step-n">{index + 1}</span>
                  <b>{step.title}</b>
                  <small>{step.body}</small>
                </li>
              ))}
            </ol>
          ) : null}
          <p className="pdk-privacy">
            <PrintIcon name="shield" size={26} />扫描件或图片可能交给第三方识别文字。上面只显示部分字符，请结合文件预览核对。
          </p>
        </>
      ) : null}
      {/* 检查中、没做成、没有可处理项时内容不够高：用一块纸张小样吃掉剩下的高度。 */}
      <PrintFillArt name="stack" />
    </div>
  )
}
