import { Button, Card, KioskActionBar, KioskStatePanel } from '@ai-job-print/ui'
import {
  AlertCircleIcon,
  CheckCircleIcon,
  EyeOffIcon,
  FileTextIcon,
  LoaderIcon,
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
  canContinue: boolean
  isWorking: boolean
  redactedCount: number
  onRetry: () => void
  onBack: () => void
  onApplySuggested: () => void
  onKeepAll: () => void
  onDecision: (findingId: string, action: 'keep' | 'redact') => void
  onContinue: () => void
}

const RISK_LABEL = { high: '高风险', medium: '中风险', low: '低风险' } as const

function CheckStep({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="w2-material-step" data-state={done ? 'done' : active ? 'active' : 'pending'}>
      <span aria-hidden="true">
        {done ? <CheckCircleIcon /> : active ? <LoaderIcon className="animate-spin" /> : <ShieldCheckIcon />}
      </span>
      <b>{label}</b>
    </div>
  )
}

function SummaryCard({
  title,
  description,
  badge,
  warning,
  messages,
}: {
  title: string
  description: string
  badge: string
  warning: boolean
  messages: readonly string[]
}) {
  return (
    <section className="w2-material-summary">
      <div>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span data-warning={warning ? 'true' : undefined}>{badge}</span>
      </div>
      {messages.length > 0 && (
        <ul>{messages.map((message) => <li key={message}>{message}</li>)}</ul>
      )}
    </section>
  )
}

export function MaterialCheckPresentation(props: MaterialCheckPresentationProps) {
  const allDecided = props.findings.every((finding) => finding.selected !== 'pending')
  const workingTitle = props.stage === 'inspection'
    ? '正在检查文件格式'
    : props.stage === 'normalize_a4'
      ? '正在评估 A4 规范化'
      : props.stage === 'submitting'
        ? '正在保存隐私选择'
        : '正在检查隐私片段'

  return (
    <div className="w2-material-page" data-w2-page="print-material-check">
      <div className="w2-material-grid">
        <aside className="w2-material-aside">
          <Card className="w2-material-file">
            <FileTextIcon aria-hidden="true" />
            <div>
              <strong>{props.file.name}</strong>
              <span>{props.file.size} · {props.file.pages === null ? '页数识别中' : `${props.file.pages} 页`}</span>
            </div>
          </Card>
          <CheckStep label="文件体检" active={props.stage === 'inspection'} done={Boolean(props.inspection)} />
          <CheckStep label="A4 规范化评估" active={props.stage === 'normalize_a4'} done={Boolean(props.normalization)} />
          <CheckStep label="隐私片段检查" active={props.stage === 'pii_scan'} done={props.stage === 'review' || props.stage === 'submitting' || props.stage === 'done'} />
          <p className="w2-material-privacy-note">
            文档文字层可本地读取；扫描件 / 图片可能通过第三方 OCR 服务识别文字后立即丢弃原文。页面只展示隐私片段，不展示完整原文。
          </p>
        </aside>

        <section className="w2-material-main">
          {props.isWorking && (
            <KioskStatePanel tone="loading" title={workingTitle} description="请稍候，检查完成后需要您确认" />
          )}
          {props.stage === 'error' && (
            <KioskStatePanel
              tone="error"
              title="材料检查未完成"
              description={props.error ?? '请重新检查'}
              actions={<Button onClick={props.onRetry}>重试检查</Button>}
            />
          )}
          {props.stage === 'review' && (
            <div className="w2-material-review">
              <section className="w2-material-result" data-warning={props.privacyModeWarning ? 'true' : undefined}>
                {props.privacyModeWarning ? <AlertCircleIcon /> : <CheckCircleIcon />}
                <div>
                  <h2>{props.privacyModeWarning ?? '检查完成'}</h2>
                  <p>
                    {props.privacyModeWarning
                      ? '如文件包含隐私信息，请打印前自行确认'
                      : props.findings.length > 0
                        ? `发现 ${props.findings.length} 个需确认片段，请逐项选择保留或遮挡`
                        : '未发现需要确认的隐私片段'}
                  </p>
                </div>
                {props.demoMode && <span>流程演示</span>}
              </section>

              {props.inspection && (
                <SummaryCard
                  title="文件体检摘要"
                  description={props.inspection.pageLabel}
                  badge={props.requiresFormatReview ? '需重新上传' : '可继续打印'}
                  warning={props.requiresFormatReview}
                  messages={props.inspection.messages}
                />
              )}
              {props.normalization && (
                <SummaryCard
                  title="A4 规范化摘要"
                  description={`目标纸张：${props.normalization.targetPaperSize} · 当前版本仍使用原文件打印`}
                  badge={props.normalization.canNormalize ? '已完成评估' : props.normalization.canNormalize === false ? '需核对版式' : '评估信息不完整'}
                  warning={props.normalization.canNormalize !== true}
                  messages={props.normalization.messages}
                />
              )}

              {props.findings.length > 0 && (
                <p className="w2-material-redaction-note">
                  当前版本会记录你的保留/遮挡选择并完成遮挡评估，但尚不生成遮挡后文件；进入确认页前会再次提示，打印仍使用原文件。
                </p>
              )}

              {props.findings.length === 0 ? (
                <KioskStatePanel
                  tone={props.requiresFormatReview ? 'error' : props.privacyModeWarning ? 'permission' : 'success'}
                  title={props.requiresFormatReview ? '请重新上传文件后继续' : props.privacyModeWarning ? '隐私内容未能完整扫描' : '可以继续设置打印参数'}
                  description={props.requiresFormatReview
                    ? '材料体检提示当前文件暂不可继续打印，请返回上传页重新选择文件'
                    : props.privacyModeWarning ?? '后续请继续核对打印参数'}
                />
              ) : (
                <div className="w2-material-findings">
                  <Card className="w2-material-batch">
                    <div><strong>批量处理</strong><span>可先按建议处理，再逐项微调</span></div>
                    <div>
                      <Button variant="secondary" onClick={props.onApplySuggested}>按建议处理</Button>
                      <Button variant="secondary" onClick={props.onKeepAll}>全部保留</Button>
                    </div>
                  </Card>
                  {props.findings.map((finding) => (
                    <Card className="w2-material-finding" key={finding.id}>
                      <EyeOffIcon aria-hidden="true" />
                      <div>
                        <header><strong>{finding.label}</strong><span data-risk={finding.risk}>{RISK_LABEL[finding.risk]}</span></header>
                        <dl>
                          <dt>片段</dt><dd>{finding.maskedSnippet}</dd>
                          <dt>建议</dt><dd>{finding.suggestion}</dd>
                        </dl>
                        <div className="w2-material-decisions">
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
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {props.error && props.stage === 'review' && <p className="w2-material-inline-error">{props.error}</p>}
      <KioskActionBar className="w2-material-actions">
        <Button variant="secondary" disabled={props.isWorking} onClick={props.onBack}>返回上传</Button>
        <Button disabled={!props.canContinue} onClick={props.onContinue}>
          {props.stage === 'submitting'
            ? '保存选择中…'
            : props.requiresFormatReview
              ? '请重新上传文件'
              : props.findings.length > 0 && !allDecided
                ? '请先完成全部选择'
                : `继续打印设置${props.findings.length > 0 ? ` · 遮挡 ${props.redactedCount} 项` : ''}`}
        </Button>
      </KioskActionBar>
    </div>
  )
}
