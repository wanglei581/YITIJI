import {
  AlertTriangleIcon,
  CheckCircleIcon,
  InfoIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
} from 'lucide-react'

import { FilePreviewPanel } from './PrintPreviewPanel'
import { MaterialCheckReview, PrivacyVendorNote } from './MaterialCheckReview'
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
  /** 用户点了「重试检查」之后的这一轮：只换说法，不改流程。 */
  retrying?: boolean
  /** 预览认出打开密码。为真时不再把「重新检查」当成出路。 */
  encryptedPdf?: boolean
  onEncryptedPdf?: () => void
  onRetry: () => void
  onBack: () => void
  onApplySuggested: () => void
  onKeepAll: () => void
  onDecision: (findingId: string, action: 'keep' | 'redact') => void
}

function Step({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <li data-state={done ? 'done' : active ? 'active' : 'pending'}>
      <span aria-hidden="true">
        {done ? <CheckCircleIcon /> : active ? <LoaderCircleIcon /> : <ShieldCheckIcon />}
      </span>
      <b>{label}</b>
      <small>{done ? '已查完' : active ? '正在查' : '排队中'}</small>
    </li>
  )
}

export function MaterialCheckPresentation(props: MaterialCheckPresentationProps) {
  const reviewReady = props.stage === 'review' || props.stage === 'submitting' || props.stage === 'done'
  const redactedCount = props.findings.filter((finding) => finding.selected === 'redact').length
  const workingTitle = props.retrying && props.stage !== 'submitting'
    ? '正在重新检查'
    : props.stage === 'inspection' || props.stage === 'idle'
      ? '正在检查文件格式、大小与页数'
      : props.stage === 'normalize_a4'
        ? '正在评估 A4 版式'
        : props.stage === 'submitting'
          ? '正在保存选择并生成遮挡文件'
          : '正在检查隐私片段'

  return (
    <div className="qpd-check-grid" data-w2-page="print-material-check" data-qx-state={props.stage} data-encrypted={props.encryptedPdf ? 'true' : undefined}>
      <aside className="qpd-check-left">
        <FilePreviewPanel file={props.file} token={props.token} onEncrypted={props.onEncryptedPdf}>
          {props.encryptedPdf ? null : (
            <span className="qpd-print-file">打印文件：<b>{redactedCount > 0 ? '继续后改用涂黑的那一份' : '你上传的这一份'}</b></span>
          )}
        </FilePreviewPanel>
        {props.encryptedPdf ? null : (
          <section className="qpd-options-note">
            <h3><InfoIcon aria-hidden="true" />两个选项分别是什么意思</h3>
            <ul>
              <li><b>保留：</b>这一处原样印在纸上。</li>
              <li><b>遮挡：</b>另生成一份把这一处涂黑的文件，打印用这一份；你上传的原文件不变。下一步可以逐页核对遮挡结果。</li>
            </ul>
          </section>
        )}
      </aside>

      <section className="qpd-check-right" aria-live="polite">
        {props.isWorking || props.stage === 'idle' ? (
          <div className="qpd-review">
            <div className="qpd-verdict" data-tone="info">
              <span className="qpd-verdict-ic"><LoaderCircleIcon aria-hidden="true" /></span>
              <h2>{workingTitle}</h2>
              <p>
                {props.stage === 'submitting'
                  ? '按你选的遮挡另生成一份用于打印的文件，你上传的原件不改。完成前不能进入预览。'
                  : props.retrying
                    ? <>用的还是刚才那一份文件，<b>不会重复收费</b>。结果回来之前，屏幕上不会出现任何结论。</>
                    : <>系统在读这份文件：格式、页数，以及有没有身份证号、手机号、邮箱、地址这类可识别片段。<b>结果没回来之前，屏幕上不会出现任何结论</b>，也不会自动放行。</>}
              </p>
            </div>
            <section className="qpd-verdict-body">
              <div>
                <h3>这一步在查什么</h3>
                <ol className="qpd-steps" aria-label="材料检查进度">
                  <Step label="文件体检：格式、大小与页数" active={props.stage === 'inspection' || props.stage === 'idle'} done={Boolean(props.inspection)} />
                  <Step label="A4 规范化评估" active={props.stage === 'normalize_a4'} done={Boolean(props.normalization)} />
                  <Step label="隐私片段检查" active={props.stage === 'pii_scan'} done={reviewReady} />
                </ol>
              </div>
              <ul className="qpd-dots">
                <li>查得慢不代表文件有问题，只代表这一步还没跑完。</li>
                <li>文件还在本次办理里，检查没有完成前<b>不能继续</b>。</li>
              </ul>
              <PrivacyVendorNote />
            </section>
          </div>
        ) : null}

        {props.stage === 'error' ? (
          <div className="qpd-review">
            <div className="qpd-verdict" data-tone="error" role="alert">
              <span className="qpd-verdict-ic"><AlertTriangleIcon aria-hidden="true" /></span>
              <h2>材料检查没做成</h2>
              <p>{props.error ?? '检查结果未知，请重新检查。隐私预检不可跳过。'}</p>
              <p>这份文件有没有可识别片段，<b>现在是未知</b>。查不出来就说未知，不会因此说「没问题」。</p>
            </div>
            <section className="qpd-verdict-body">
              <div>
                <h3>现在的事实</h3>
                <ul className="qpd-dots">
                  <li>文件<b>还在</b>本次办理里。</li>
                  <li>检查结果未知，屏幕上不出现任何检查结论。</li>
                  <li><b>没检查完不能继续打印。</b></li>
                </ul>
              </div>
              <div>
                <h3>两条路都能走</h3>
                <ul className="qpd-dots">
                  <li><b>重试：</b>还是这一份，再查一次，不重复收费。</li>
                  <li><b>返回选文件：</b>重新选择要打印的材料。</li>
                </ul>
                <div className="qpd-two-actions">
                  <button className="qx-btn" data-variant="primary" type="button" onClick={props.onRetry}>重试检查</button>
                  <button className="qx-btn" data-variant="ghost" type="button" onClick={props.onBack}>返回选文件</button>
                </div>
              </div>
              <PrivacyVendorNote />
            </section>
          </div>
        ) : null}

        {props.stage === 'review' ? <MaterialCheckReview {...props} /> : null}
      </section>
    </div>
  )
}
