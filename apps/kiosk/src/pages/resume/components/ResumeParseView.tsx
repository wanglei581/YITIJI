import type { ReactNode } from 'react'
import { CheckIcon, SparklesIcon, XCircleIcon } from 'lucide-react'
import { Button, Card } from '@ai-job-print/ui'
import { QxAiHelp, QxStepActions } from '../../../components/qingxu/QxAiHelp'
import { QxPageFrame } from '../../../components/qingxu/QxPageFrame'
import { resumeProcessCopy } from '../resumeUserCopy'
import { ResumeAiConsentDialog } from './ResumeAiConsentDialog'
import { ResumeTriageHero } from './ResumeTriageHero'
import { ResumeWithoutAi } from './ResumeWithoutAi'
import {
  frameCopy,
  ResumeParseUnknownNote,
  type ParseView,
  type ShownTerminal,
} from '../ResumeParseOutcomeNote'

const STEPS = [
  { key: 'reading', label: '读取上传文件', hint: '核对格式和页数' },
  { key: 'ocr', label: '识别可解析文字', hint: '识别图片和扫描件里的文字' },
  { key: 'extracting', label: '提取简历结构', hint: '认出教育、经历、技能这些部分' },
  { key: 'diagnosing', label: '生成诊断报告', hint: '六个评分方面、风险说法和先看哪一条' },
]

type Recheck = 'idle' | 'checking' | 'not-ready' | 'error' | 'replay' | 'not-found'

/** 解析页的画面。提交、再查、失败后跳转仍在 ResumeParsePage。 */
export function ResumeParseView(props: {
  intentOptimize: boolean
  fileId: string
  fileName: string
  fileSize: string | null
  sourceLabel: string
  outcome: 'failed' | 'unknown' | null
  terminal: ShownTerminal | null
  pendingTask: boolean
  recheck: Recheck
  blockNote: string | null
  storageBlocked: boolean
  confirmFresh: 0 | 1 | 2
  loggedIn: boolean
  guestNotice: boolean
  consentChecking: boolean
  consentNeedsPrompt: boolean
  consentBusy: boolean
  consentError: string | null
  consentGuest: boolean
  dimensions: string[]
  helpLine: string
  showDev: boolean
  onLeaveToSource: () => void
  onStepBack: () => void
  onRecheck: () => void
  onReplay: () => void
  onOpenFresh: () => void
  onConfirmStep: () => void
  onBeginFresh: () => void
  onCancelFresh: () => void
  onDevFail: () => void
  onConsentCancel: () => void
  onConsentConfirm: () => void
  onPrint: () => void
  onGenerate: () => void
  onHomeSource: () => void
}): ReactNode {
  const view: ParseView = !props.fileId
    ? 'missing-file'
    : props.consentChecking
      ? 'consent-checking'
      : props.consentNeedsPrompt
        ? 'consent-needed'
        : props.outcome ?? 'waiting'
  const copy = frameCopy(view, props.terminal)
  const failed = props.outcome !== null
  const help = <p className="qx-rt-hint" data-testid="resume-help-line">{props.helpLine}</p>
  const frame = (body: ReactNode, ctabar?: ReactNode) => (
    <QxPageFrame
      title="AI 解析"
      subtitle="读懂简历，带走诊断报告"
      status={copy.status}
      terminalLabel="AI 简历服务"
      back={{ label: '返回简历来源', onBack: props.onLeaveToSource }}
      ctabar={<><QxStepActions><QxAiHelp label="问小青：解析没完成怎么办 →" draft="我的简历解析还没有完成，请说明等待、复查和重新提交有什么区别，不要替我重新提交。" /></QxStepActions>{ctabar}</>}
    >
      <section
        data-kiosk-domain="resume"
        data-kiosk-screen="resume-parse"
        data-state={view}
        data-recheck={props.recheck === 'checking' ? 'checking' : undefined}
        className="qx-resume-triage"
        data-takeaway="简历诊断报告"
      >
        <ResumeTriageHero
          eyebrow={props.intentOptimize ? 'AI 简历优化' : 'AI 简历诊断'}
          ask={copy.ask}
          doing={copy.doing}
          flag={copy.flag}
          warn={copy.warn}
          rail={copy.rail}
        />
        {body}
      </section>
    </QxPageFrame>
  )

  if (!props.fileId) {
    return frame(
      <div className="qx-rt-wait">
        <section className="qx-rt-fail" data-tone="warn">
          <h2 className="qx-rt-fail-t"><XCircleIcon size={24} aria-hidden="true" />未找到简历文件</h2>
          <p>请回到来源选择，把简历交进来后，再开始 AI 诊断。这一步不会自动挑一份文件，也不会凭空开始解析。</p>
        </section>
        <ResumeWithoutAi onGenerate={props.onGenerate} onPrint={props.onPrint} />
        {help}
      </div>,
      <button type="button" className="qx-btn" data-variant="primary" onClick={props.onHomeSource}>回到来源选择</button>,
    )
  }

  if (props.consentChecking || props.consentNeedsPrompt) {
    return (
      <>
        {frame(
          <p className="qx-rt-note" role="status">
            {props.consentChecking ? '正在确认授权状态…' : '使用简历 AI 前需要先确认授权'}
          </p>,
        )}
        {props.consentNeedsPrompt && (
          <ResumeAiConsentDialog
            busy={props.consentBusy}
            error={props.consentError}
            guest={props.consentGuest}
            onCancel={props.onConsentCancel}
            onConfirm={props.onConsentConfirm}
          />
        )}
      </>
    )
  }

  const waitingTitle = props.outcome === 'failed'
    ? '解析出错'
    : props.outcome === 'unknown'
      ? (props.terminal?.mode === 'charged'
        ? props.terminal.copy.title
        : props.terminal?.mode === 'file_changed'
          ? '这份文件已停止使用'
          : props.terminal?.mode === 'blocked'
            ? '不能继续这次解析'
            : (props.pendingTask ? '解析还没出最终结果' : '没等到解析结果'))
      : '正在等待最终解析结果…'

  return (
    <>
      {frame(
        <>
          <div className="qx-rt-wait">
            <section className="qx-card qx-rt-wait-card" data-live={failed ? undefined : 'true'}>
              <span className="qx-rt-ring" data-tone={props.outcome === 'failed' ? 'bad' : props.outcome === 'unknown' ? 'warn' : undefined} aria-hidden="true">
                {failed ? <XCircleIcon size={44} /> : <SparklesIcon size={44} />}
              </span>
              <h2 className="qx-rt-wait-t" role="status" aria-live="polite">{waitingTitle}</h2>
              {!failed && (
                <div className="qx-rt-chips">
                  <span>{props.fileName}</span>
                  {props.fileSize && <span>{props.fileSize} · {props.sourceLabel}</span>}
                  <span>这次要看的内容，不是进度</span>
                </div>
              )}
            </section>
            {props.outcome === 'unknown' && (
              <ResumeParseUnknownNote
                terminal={props.terminal}
                pendingTask={props.pendingTask}
                recheck={props.recheck}
                blockNote={props.blockNote}
                storageBlocked={props.storageBlocked}
                confirmFresh={props.confirmFresh}
                loggedIn={props.loggedIn}
                onFresh={props.onOpenFresh}
              />
            )}
            {props.recheck === 'checking' && (
              <p className="qx-rt-note" role="status">正在查刚才这一次。这是核对，不是又提交一次。</p>
            )}
            <p className="qx-rt-note" role="note">
              <b>说明</b>下面列出这次要看的内容，不代表实时进度。结果回来后会自动打开报告。
            </p>
            {props.guestNotice && (
              <p className="qx-rt-note" role="note" data-testid="resume-ai-guest-notice">
                未登录使用简历 AI：本次结果只在这次办理中可见，离场即清，不进入任何账号；AI 建议仅供参考，不替你投递。
              </p>
            )}
            <ol className="qx-rt-steps" aria-label="这次要看的内容">
              {STEPS.map((step, idx) => (
                <li key={step.key}>
                  <i aria-hidden="true">{idx + 1}</i>
                  <strong>{step.label}</strong>
                  <em>{step.hint}</em>
                  <span>要看的内容</span>
                </li>
              ))}
            </ol>
            {!failed && (
              <section className="qx-card">
                <p className="qx-rt-wait-d"><b>报告将评估的维度</b></p>
                <div className="qx-rt-dim-grid">
                  {props.dimensions.map((item) => <span key={item} className="qx-rt-dim">{item}</span>)}
                </div>
              </section>
            )}
            {!props.terminal && (
              <p className="qx-rt-note" data-tone="warn">识别不清或解析失败时会说明下一步怎么做。诊断结果由 AI 生成，仅供参考。</p>
            )}
            {help}
          </div>
          {props.showDev && !failed && (
            <button type="button" onClick={props.onDevFail} className="qx-rt-dev resume-parse-dev">[DEV] 模拟失败</button>
          )}
        </>,
        <>
          <p className="why">
            <CheckIcon size={18} aria-hidden="true" style={{ display: 'inline', marginRight: 6, verticalAlign: '-3px' }} />
            返回只是停止本机等待，不会撤回已经提交的解析；简历原文不会发送给企业，也不进入平台候选人简历库。
          </p>
          {props.outcome === 'unknown' ? (
            <>
              <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onLeaveToSource}>返回简历来源</button>
              {props.terminal?.mode === 'blocked' ? (
                <button type="button" className="qx-btn" data-variant="primary" disabled>暂不能开始新的一次</button>
              ) : props.terminal?.mode === 'file_changed' ? (
                <button type="button" className="qx-btn" data-variant="primary" data-testid="resume-parse-reupload" onClick={props.onLeaveToSource}>重新上传简历</button>
              ) : props.terminal?.mode === 'charged' ? (
                <button type="button" className="qx-btn" data-variant="primary" data-testid="resume-parse-new-attempt" onClick={props.onOpenFresh}>重新解析（新的一次）</button>
              ) : props.pendingTask && !props.storageBlocked && props.recheck !== 'replay' && props.recheck !== 'not-found' ? (
                <button type="button" className="qx-btn" data-variant="primary" disabled={props.recheck === 'checking'} onClick={props.onRecheck}>
                  {props.recheck === 'checking' ? '正在查刚才这一次' : '再查刚才这一次的结果'}
                </button>
              ) : (
                <button type="button" className="qx-btn" data-variant="primary" data-testid="resume-parse-replay" onClick={props.onReplay}>原样再试一次</button>
              )}
            </>
          ) : (
            <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onStepBack}>
              <XCircleIcon size={20} aria-hidden="true" />
              返回上一步
            </button>
          )}
        </>,
      )}
      {props.confirmFresh > 0 && (
        <div className="resume-r1-dialog fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" role="dialog" aria-modal="true" aria-labelledby="resume-parse-fresh-title">
          <Card className="w-[32rem] max-w-full p-6 shadow-xl">
            <h2 id="resume-parse-fresh-title" className="text-lg font-semibold text-neutral-900">
              {props.confirmFresh === 1 ? '重新提交是新的一次' : '再次确认'}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600" data-testid="resume-parse-fresh-copy">
              {props.confirmFresh === 1
                ? (props.terminal?.mode === 'charged'
                  ? resumeProcessCopy(props.terminal.copy.confirm)
                  : '刚才那次解析可能已经完成。重新提交会再调用一次 AI，生成新的一次解析，不会取消或覆盖刚才那次；如果刚才那次其实已经完成，就等于重复解析了一次。')
                : props.terminal?.mode === 'charged'
                  ? '将清除本机这一次已结束的解析标识，并开始新的一次 AI 解析。'
                  : '将清除本机这一次未完成的解析标识，并开始新的一次 AI 解析。'}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Button size="lg" variant="secondary" className="min-h-14" onClick={props.onCancelFresh}>先不提交</Button>
              {props.confirmFresh === 1 ? (
                <Button size="lg" className="min-h-14" onClick={props.onConfirmStep}>继续确认</Button>
              ) : (
                <Button size="lg" className="min-h-14" onClick={props.onBeginFresh}>开始新的一次</Button>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  )
}
