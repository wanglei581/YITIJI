// 优化页底栏主按钮、返回与问小青配置：从 ResumeOptimizePage 拆出，行为不变。
import type { ResumeGenerateExportResponse } from '@ai-job-print/shared'
import { LICENSE_NO_NEW_TASK_REASON } from '../../../../copy/unattendedCopy'
import type { QxTouchPrimary } from '../../../../components/qingxu/touch/QxTouchDock'
import type { OptimizePane } from '../../touch/optimizeFrame'
import type { OptimizeViewState } from './constants'

const OPTIMIZE_AI_DRAFT = '我想把简历中的一句经历换个改法。请先让我提供原句，只整理真实内容，不添加数字或成果。'
const EDIT_AI_DRAFT = '我想知道这份简历的版式、模板和主色怎么选更清楚。请只讲排版，不要改动我的内容。'
const EXPORT_AI_DRAFT = '我想知道这份简历导出成 PDF、Word、TXT 还是 Markdown 更合适。请只讲格式的区别，不要改动我的内容。'

export interface OptimizeDockInput {
  view: OptimizeViewState
  pane: OptimizePane
  editorOpen: boolean
  showOverview: boolean
  hasAssembled: boolean
  hasModules: boolean
  aiDown: boolean
  viewOnly: boolean
  leaveDirty: boolean
  exporting: boolean
  exported: ResumeGenerateExportResponse | null
  canPrint: boolean
  exportBlocked: boolean
  titleBlocked: boolean
  factsValid: boolean
  printNavigating: boolean
  retryable: boolean
  retryLabel?: string
  onRequestLeaveToAssistant: (draft: string) => void
  onOpenCompare: () => void
  onRequestResumeExport: () => void
  onRunResumeExport: () => void
  onPrint: () => void
  onOpenPreview: () => void
  onBackToEditor: () => void
  onBackToOverview: () => void
  onBackToReport: () => void
  onRetry: () => void
  onManualGenerate: () => void
  onReupload: () => void
}

export function buildOptimizeDockControls(input: OptimizeDockInput) {
  const askFor = (label: string, text: string) => ({
    label,
    draft: text,
    beforeAsk: () => {
      if (!input.leaveDirty) return true
      input.onRequestLeaveToAssistant(text)
      return false
    },
  })

  const ask = input.aiDown
    ? { label: input.pane === 'export' ? '小青暂时不可用，先自行选择格式' : '小青暂时不可用，先手动编辑', disabled: true as const }
    : input.pane === 'export'
      ? askFor('问小青：导出成哪种', EXPORT_AI_DRAFT)
      : input.pane === 'editor' && input.view === 'ready'
        ? askFor('问小青：版式怎么排', EDIT_AI_DRAFT)
        : askFor('问小青：这句还能怎么改 →', OPTIMIZE_AI_DRAFT)

  const dockPrimary: QxTouchPrimary | undefined = !input.editorOpen ? undefined
    : input.pane === 'overview' && input.showOverview
      ? { label: '逐条看（从第 1 条）', onClick: input.onOpenCompare, testId: 'resume-optimize-primary' }
      : input.pane === 'editor' && input.hasAssembled
        ? { label: '去导出', onClick: input.onRequestResumeExport, ariaDisabled: input.titleBlocked, testId: 'resume-optimize-to-export' }
        : input.pane === 'export' && input.hasAssembled
          ? input.exporting
            ? { label: '正在生成文件…', onClick: () => undefined, disabled: true, noArrow: true as const }
            : !input.exported
              ? { label: '导出', onClick: input.onRunResumeExport, ariaDisabled: input.exportBlocked || input.titleBlocked || !input.factsValid, testId: 'resume-optimize-export' }
              : input.canPrint
                ? { label: '去打印这一份', onClick: input.onPrint, ariaDisabled: input.printNavigating || input.titleBlocked, testId: 'resume-optimize-print' }
                : { label: '扫码带走', onClick: input.onOpenPreview, ariaDisabled: !input.exported.signedUrl }
          : undefined

  const back = input.view === 'ready' && input.pane === 'export'
    ? { label: '返回编辑', onBack: input.onBackToEditor }
    : input.view === 'ready' && input.pane === 'editor' && input.hasModules
      ? { label: '返回建议总览', onBack: input.onBackToOverview }
      : { label: '返回诊断报告', onBack: input.onBackToReport }

  const retryLabel = input.retryLabel ?? '重试'
  const statePrimary: QxTouchPrimary | undefined = input.view === 'ready' || input.view === 'loading' ? undefined
    : input.retryable ? { label: retryLabel, onClick: input.onRetry }
    : input.aiDown ? { label: '手动填写简历', onClick: input.onManualGenerate } : { label: '重新上传简历', onClick: input.onReupload }

  const rawPrimary = dockPrimary ?? statePrimary
  const primary = input.viewOnly && rawPrimary && rawPrimary.label !== retryLabel && rawPrimary.label !== '扫码带走'
    ? { ...rawPrimary, disabled: true, ariaDisabled: undefined, title: LICENSE_NO_NEW_TASK_REASON }
    : rawPrimary

  return { ask, back, statePrimary, primary }
}
