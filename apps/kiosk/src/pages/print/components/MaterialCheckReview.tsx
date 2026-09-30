import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CreditCardIcon,
  FileCheckIcon,
  IdCardIcon,
  InfoIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  ShieldCheckIcon,
  UserIcon,
} from 'lucide-react'

import { ENCRYPTED_PDF_UNLOCK_STEPS } from './printPreviewKind'
import type { MaterialCheckPresentationProps } from './MaterialCheckPresentation'

/** 稿 13 材料检查「查完」这一屏：结论卡 + 逐条决定 / 这一轮的结论。只换版式，判定仍由页面传入。 */

function FindingIcon({ type }: { type: string }) {
  const Icon = type.includes('id') ? IdCardIcon : type.includes('address') ? MapPinIcon
    : type === 'phone' ? PhoneIcon : type === 'email' ? MailIcon : type.includes('bank') ? CreditCardIcon : UserIcon
  return <Icon aria-hidden="true" />
}

export function PrivacyVendorNote() {
  return (
    <p className="qpd-privacy-note">
      <ShieldCheckIcon aria-hidden="true" />
      <span>扫描件或图片可能交给第三方识别文字。片段只显示部分字符，请结合左侧文件预览核对。</span>
    </p>
  )
}

function inspectionState(props: MaterialCheckPresentationProps): string {
  if (props.encryptedPdf) return '打不开'
  if (props.inspection?.canPrint === true) return '可继续'
  return props.requiresFormatReview ? '需重新上传' : '请核对文件'
}

function normalizationText(props: MaterialCheckPresentationProps): string | null {
  if (!props.normalization || props.encryptedPdf) return null
  return props.normalization.canNormalize === true
    ? `评估完成，可以按 ${props.normalization.targetPaperSize} 出纸`
    : `请核对版式（目标纸张 ${props.normalization.targetPaperSize}）`
}

function checkMessages(props: MaterialCheckPresentationProps): string[] {
  return [...new Set([...(props.inspection?.messages ?? []), ...(props.normalization?.messages ?? [])])]
}

function Verdict(props: MaterialCheckPresentationProps) {
  const tone = props.encryptedPdf || props.requiresFormatReview ? 'error' : props.privacyModeWarning ? 'warn' : 'ok'
  const Icon = tone === 'error' ? AlertTriangleIcon : tone === 'warn' ? AlertCircleIcon : props.privacyModeNotice ? FileCheckIcon : ShieldCheckIcon
  return (
    <section className="qpd-verdict" data-tone={tone} data-warning={props.privacyModeWarning ? 'true' : undefined}>
      <span className="qpd-verdict-ic"><Icon aria-hidden="true" /></span>
      <h2>
        {props.encryptedPdf
          ? '这份 PDF 打不开'
          : props.privacyModeWarning
            ?? (props.requiresFormatReview ? '当前文件不能直接打印' : props.privacyModeNotice ?? '没有查到需要你决定的片段')}
      </h2>
      <p>
        {props.encryptedPdf
          ? '预览打不开，也不能按这一份继续。请去掉密码后重新选择文件。'
          : props.privacyModeWarning
            ? '扫描结果不完整，页面不会把它说成“没有隐私信息”。'
            : props.requiresFormatReview
              ? '文件体检判定它不能直接打印。返回上传页重新选择文件。'
              : props.privacyModeNotice
                ? '本次没有做内容扫描，页面不会把它说成“没有隐私信息”，请结合预览自行确认。'
                : <>没匹配到身份证号、手机号、邮箱、地址这类片段。<b>这只说明规则没命中，不等于文件里一定没有隐私内容</b> —— 你自己再看一眼更稳妥。</>}
      </p>
      {props.privacyModeWarning && !props.encryptedPdf ? (
        <button className="qx-btn qpd-retry-scan" data-variant="danger" type="button" onClick={props.onRetry}>
          重新检查隐私内容
        </button>
      ) : null}
      {props.demoMode ? <span className="qpd-demo-tag">流程演示</span> : null}
    </section>
  )
}

function Conclusions(props: MaterialCheckPresentationProps) {
  const normalization = normalizationText(props)
  const hit = props.encryptedPdf ? '没法检查' : props.privacyModeWarning ? '没查全' : props.privacyModeNotice ? '本次未做内容扫描' : '未命中'
  return (
    <section className="qpd-verdict-body">
      <div className="qpd-summary">
        <h3>这一轮的结论</h3>
        <ul className="qpd-dots">
          <li>可识别片段：<b>{hit}</b>。</li>
          {props.inspection ? <li>文件体检：{props.inspection.pageLabel}，<b>{inspectionState(props)}</b>。</li> : null}
          {normalization ? <li>A4 版式：{normalization}。</li> : null}
          {checkMessages(props).map((message) => <li key={message}>{message}</li>)}
          {props.encryptedPdf || props.requiresFormatReview ? null : (
            <li>打印将使用<b>你上传的这一份原文件</b>，本页没有另外生成文件。</li>
          )}
        </ul>
      </div>
      {props.encryptedPdf ? (
        <div aria-label="怎么去掉打开密码" role="group">
          <h3>怎么去掉打开密码</h3>
          <ol className="qpd-num">
            {ENCRYPTED_PDF_UNLOCK_STEPS.map((step, index) => (
              <li key={step.title}><span>{index + 1}</span><div><b>{step.title}</b><p>{step.body}</p></div></li>
            ))}
          </ol>
        </div>
      ) : (
        <div>
          <h3>下一步做什么</h3>
          <ul className="qpd-dots">
            {props.requiresFormatReview ? (
              <li>返回上传页，重新选一份 PDF、JPG 或 PNG。</li>
            ) : props.privacyModeWarning ? (
              <>
                <li>逐页看一遍左侧预览，确认没查到的页面里没有要遮挡的内容。</li>
                <li>确认后按原件继续，<b>本机不会生成遮挡文件</b>。</li>
              </>
            ) : (
              <>
                <li>确认版面、份数和页范围，再看一眼这台机器的能力和状态。</li>
                <li>价格在下一步核对，<b>确认之前不会收费</b>。</li>
              </>
            )}
          </ul>
        </div>
      )}
      {props.encryptedPdf ? null : <PrivacyVendorNote />}
    </section>
  )
}

function Findings(props: MaterialCheckPresentationProps) {
  const total = props.findings.length
  const keptCount = props.findings.filter((finding) => finding.selected === 'keep').length
  const redactedCount = props.findings.filter((finding) => finding.selected === 'redact').length
  const remaining = total - keptCount - redactedCount
  const heading = remaining === total
    ? `有 ${total} 处要你决定`
    : remaining > 0
      ? `还剩 ${remaining} 处要你决定`
      : total === 1 ? '这一处已决定' : `${total} 处都决定完了`
  const normalization = normalizationText(props)
  return (
    <>
      <div className="qpd-findings-heading">
        <span>01</span><h2>{heading}</h2><small>逐条选，选完才能继续</small>
        {props.demoMode ? <span className="qpd-demo-tag">流程演示</span> : null}
      </div>
      <section className="qpd-findings-card">
        <div className="qpd-batch">
          <button className="qx-btn" data-variant="ghost" type="button" onClick={props.onApplySuggested}>按风险建议处理</button>
          <button className="qx-btn" data-variant="ghost" type="button" onClick={props.onKeepAll}>全部保留</button>
        </div>
        <div className="qpd-findings">
          {props.findings.map((finding) => (
            <article className="qpd-finding" key={finding.id} data-risk={finding.risk}>
              <span className="qpd-finding-ic"><FindingIcon type={finding.type} /></span>
              <div className="qpd-finding-main">
                <header><strong>{finding.label}</strong><span>{finding.suggestion}</span></header>
                <p className="qpd-finding-snippet">{finding.pageNumber === null ? '页码未知' : `第 ${finding.pageNumber} 页`} · {finding.maskedSnippet}</p>
                <p className="qpd-finding-decision">
                  {finding.selected === 'keep'
                    ? '已选保留：这一处原样印在纸上。'
                    : finding.selected === 'redact'
                      ? '已选遮挡：打印时用涂黑后的文件，原文件不变。'
                      : '还没决定。'}
                </p>
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
        <div className="qpd-decision-counts"><span>已决定 {keptCount + redactedCount} / {total}</span><span>保留 {keptCount} 处</span><span>遮挡 {redactedCount} 处</span></div>
        <p className="qpd-decision-status" data-done={remaining === 0 ? 'true' : undefined}>
          {remaining > 0 ? `还有 ${remaining} 处等你决定` : total === 1 ? '这一处已决定，可以继续核对遮挡结果。' : `${total} 处都决定完了，可以继续核对遮挡结果。`}
        </p>
      </section>
      <section className="qpd-next-card">
        <h3><InfoIcon aria-hidden="true" />下一步预览</h3>
        <p>选了遮挡的，下一步预览里会显示涂黑后的样子，可以逐页核对。</p>
        {props.inspection ? (
          <p className="qpd-summary qpd-facts-line">
            文件体检：{props.inspection.pageLabel} · {inspectionState(props)}{normalization ? `；A4 版式：${normalization}` : ''}
            {checkMessages(props).map((message) => `；${message}`).join('')}
          </p>
        ) : null}
        <PrivacyVendorNote />
      </section>
    </>
  )
}

export function MaterialCheckReview(props: MaterialCheckPresentationProps) {
  const hasFindings = props.findings.length > 0
  return (
    <div className="qpd-review" data-review={hasFindings ? 'findings' : 'verdict'}>
      {props.error ? (
        <div className="qx-state" data-tone="error" role="alert">
          <span className="qx-state-ic"><AlertCircleIcon aria-hidden="true" /></span>
          <div>
            <div className="qx-state-t">遮挡处理未完成</div>
            <p className="qx-state-d">{props.error}</p>
          </div>
        </div>
      ) : null}
      {!hasFindings || props.privacyModeWarning || props.encryptedPdf ? <Verdict {...props} /> : null}
      {hasFindings && !props.encryptedPdf ? <Findings {...props} /> : <Conclusions {...props} />}
    </div>
  )
}
