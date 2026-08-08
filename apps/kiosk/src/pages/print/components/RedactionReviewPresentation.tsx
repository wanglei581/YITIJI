/**
 * 隐私遮挡 第 3 / 4 步:强制预览 + 人眼确认。
 *
 * 这一步是本功能唯一真正的安全阀(决策文档 §3.3 / §四):
 * 机器复检只能发现「盖错位置」,发现不了「压根没检出」—— 同一个检测器扫两遍,
 * 系统性漏检两遍都漏。所以必须有人眼这一道。
 *
 * 因此本组件刻意不提供:
 * - 跳过预览的入口(没有 skip / 稍后再看 / 直接打印按钮)
 * - 可折叠或默认收起的预览容器(预览区始终展开渲染)
 * - 未勾选确认时可用的继续按钮
 *
 * 「本机做不到」的状态(claim=not_supported / 未知)不走确认,走三条真实出路;
 * 其中「不做遮挡直接打印」需要单独的明确确认,且文案直说纸上是完整信息。
 */
import { Button, Card, KioskActionBar } from '@ai-job-print/ui'
import { AlertTriangleIcon, CheckCircleIcon, EyeIcon, FileWarningIcon, InfoIcon } from 'lucide-react'
import type { PiiRedactionCopy, PiiRedactionPageGroup } from '../piiRedaction'

export interface RedactionFailedItemPresentation {
  id: string
  label: string
  pageLabel: string
}

export interface RedactionReviewPresentationProps {
  /** 全部结论文案来自 piiRedactionCopy(claim),本组件不自行拼装任何遮挡结论。 */
  copy: PiiRedactionCopy
  fileName: string
  /** 遮挡后派生件的可嵌入地址;null = 拿不到,fail-closed 不允许确认。 */
  previewUrl: string | null
  previewKind: 'pdf' | 'image' | 'unavailable'
  previewUnavailableReason: string | null
  pageGroups: readonly PiiRedactionPageGroup[]
  failedItems: readonly RedactionFailedItemPresentation[]
  keptCount: number
  reverifyNote: string
  confirmed: boolean
  onConfirmedChange: (next: boolean) => void
  /** 「不做遮挡直接打印」的单独确认。 */
  acknowledgedUnredacted: boolean
  onAcknowledgedChange: (next: boolean) => void
  isWorking: boolean
  onBack: () => void
  onContinue: () => void
  onPrintOriginal: () => void
}

function ToneIcon({ tone }: { tone: PiiRedactionCopy['tone'] }) {
  if (tone === 'success') return <CheckCircleIcon aria-hidden="true" />
  if (tone === 'warning') return <AlertTriangleIcon aria-hidden="true" />
  return <FileWarningIcon aria-hidden="true" />
}

function PageGroupList({ groups }: { groups: readonly PiiRedactionPageGroup[] }) {
  if (groups.length === 0) return null
  return (
    <Card className="w2-redact-index">
      <h3>逐页对照 · 请按页码核对</h3>
      <p>本机没有把黑条位置画在预览上，只能告诉你哪一页有什么，请自己在预览里翻到对应页看一眼。</p>
      <ul>
        {groups.map((group) => (
          <li key={group.pageNumber ?? 'unknown'}>
            <b>{group.pageNumber ? `第 ${group.pageNumber} 页` : '页码未知'}</b>
            <span>
              {group.redacted.length > 0 && <em data-kind="redacted">盖住 {group.redacted.join('、')}</em>}
              {group.failed.length > 0 && <em data-kind="failed">未盖住 {group.failed.join('、')}</em>}
              {group.kept.length > 0 && <em data-kind="kept">按你的选择保留 {group.kept.join('、')}</em>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function RedactionReviewPresentation(props: RedactionReviewPresentationProps) {
  const { copy } = props
  const previewBlocked = props.previewKind === 'unavailable'
  const canConfirm = copy.requiresPreviewConfirm && !previewBlocked && Boolean(copy.confirmLabel)
  const canContinue = canConfirm && props.confirmed && !props.isWorking

  return (
    <div className="w2-redact-page" data-w2-page="print-redaction-review">
      <section className="w2-redact-result" data-tone={copy.tone}>
        <ToneIcon tone={copy.tone} />
        <div>
          <h2>{copy.title}</h2>
          <p>{copy.detail}</p>
        </div>
      </section>

      {copy.showFallbackOptions ? (
        <div className="w2-redact-fallback">
          <Card className="w2-redact-options">
            <h3>可以这样继续</h3>
            <ol>
              <li>用手机把证件号涂掉或打码，改好后重新上传</li>
              <li>换一份文字版简历（Word 导出或在线简历导出的 PDF）再试一次</li>
              <li>不做遮挡直接打印 —— 打印出来的纸上会是完整信息</li>
            </ol>
          </Card>
          <Card className="w2-redact-ack">
            <label>
              <input
                type="checkbox"
                checked={props.acknowledgedUnredacted}
                onChange={(event) => props.onAcknowledgedChange(event.target.checked)}
              />
              <span>我知道这份文件没有被遮挡，打印出来的纸上会包含完整的证件号 / 手机号等信息，我仍然要打印。</span>
            </label>
            <Button
              variant="secondary"
              disabled={!props.acknowledgedUnredacted || props.isWorking}
              onClick={props.onPrintOriginal}
            >
              不做遮挡，继续打印原件
            </Button>
          </Card>
        </div>
      ) : (
        <div className="w2-redact-grid">
          {/* 预览区始终展开渲染:没有折叠开关,也没有跳过入口。 */}
          <div className="w2-redact-preview">
            <div className="w2-redact-preview-head">
              <EyeIcon aria-hidden="true" />
              <b>遮挡后的文件 · 原尺寸预览</b>
              <span>{props.fileName}</span>
            </div>
            <div className="w2-redact-preview-frame">
              {props.previewKind === 'pdf' && props.previewUrl && (
                <iframe title="遮挡后文件预览" src={props.previewUrl} />
              )}
              {props.previewKind === 'image' && props.previewUrl && (
                <img src={props.previewUrl} alt="遮挡后文件预览" />
              )}
              {previewBlocked && (
                <div className="w2-redact-preview-blocked">
                  <FileWarningIcon aria-hidden="true" />
                  <b>无法显示遮挡后的文件</b>
                  <p>
                    {props.previewUnavailableReason
                      ?? '本机没有拿到遮挡后文件的预览地址。看不到就没法核对，因此这一步不能确认。'}
                  </p>
                  <p>请返回重新选择，或改用上面的其他方式处理。</p>
                </div>
              )}
            </div>
          </div>

          <div className="w2-redact-side">
            <PageGroupList groups={props.pageGroups} />

            {props.failedItems.length > 0 && (
              <Card className="w2-redact-failed">
                <h3>
                  <AlertTriangleIcon aria-hidden="true" />
                  这 {props.failedItems.length} 处没能定位，仍是原样
                </h3>
                <p>本机在文件里找不到它们的位置，所以没有盖住。它们会原样出现在打印出来的纸上。</p>
                <ul>
                  {props.failedItems.map((item) => (
                    <li key={item.id}>
                      <b>{item.label}</b>
                      <span>{item.pageLabel}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {props.keptCount > 0 && (
              <Card className="w2-redact-kept">
                <InfoIcon aria-hidden="true" />
                <p>另有 {props.keptCount} 处是你自己选择保留的，本机没有动它们。</p>
              </Card>
            )}

            <Card className="w2-redact-reverify">
              <h3>机器复检说明</h3>
              <p>{props.reverifyNote}</p>
            </Card>
          </div>
        </div>
      )}

      {canConfirm && (
        <Card className="w2-redact-confirm">
          <label>
            <input
              type="checkbox"
              checked={props.confirmed}
              onChange={(event) => props.onConfirmedChange(event.target.checked)}
            />
            <span>{copy.confirmLabel}</span>
          </label>
        </Card>
      )}

      <KioskActionBar className="w2-redact-actions">
        <Button variant="secondary" disabled={props.isWorking} onClick={props.onBack}>
          返回重新选择
        </Button>
        {!copy.showFallbackOptions && (
          <Button disabled={!canContinue} onClick={props.onContinue}>
            {previewBlocked ? '无法核对，不能继续' : props.confirmed ? copy.continueLabel : '请先勾选上面的确认'}
          </Button>
        )}
      </KioskActionBar>
    </div>
  )
}
