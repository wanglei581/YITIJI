// 从零生成预览页的纯视图文案与只读底栏拦截：从 ResumeGeneratePreviewPage 拆出，行为不变。
import { cloneElement, isValidElement, type ReactNode } from 'react'
import type { ResumeExportFormat } from '@ai-job-print/shared'
import { LICENSE_NO_NEW_TASK_REASON } from '../../../../copy/unattendedCopy'
import { ASKS, type ResumeAsk } from '../../touch/resumeAsks'
import type { GeneratePreviewViewState } from './constants'

export const GENERATE_EXPORT_VIEWS = new Set<GeneratePreviewViewState>([
  'export-chooser',
  'export-exporting',
  'export-failed',
  'export-ready',
  'export-url-expired',
  'export-print-unavailable',
])

export const GENERATE_FORMAT_NAME: Record<ResumeExportFormat, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  txt: 'TXT',
  md: 'MD',
}

const NEW_TASK_CTA = new Set([
  'resume-generate-preview-cta-export',
  'resume-generate-preview-cta-print',
  'resume-generate-preview-cta-confirm-export',
])

/** 底栏里只停用打印、导出。返回、离开、再读一次保持可点。 */
export function holdExportPrint(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map((child) => holdExportPrint(child))
  if (!isValidElement(node)) return node
  const props = node.props as { 'data-testid'?: unknown; children?: ReactNode }
  const testId = props['data-testid']
  if (typeof testId === 'string' && NEW_TASK_CTA.has(testId)) {
    return cloneElement(node, {
      disabled: true,
      title: LICENSE_NO_NEW_TASK_REASON,
      'aria-disabled': undefined,
      onClick: () => undefined,
    })
  }
  const children = props.children
  if (children == null || typeof children === 'string' || typeof children === 'number') return node
  return cloneElement(node, undefined, holdExportPrint(children))
}

export function readDeliverPhase(state: unknown): 'preview' | 'export' | null {
  if (!state || typeof state !== 'object') return null
  const value = (state as { deliverPhase?: unknown }).deliverPhase
  return value === 'export' || value === 'preview' ? value : null
}

export function buildGeneratePreviewCopy(input: {
  view: GeneratePreviewViewState
  exportScreen: GeneratePreviewViewState
  onExportScreen: boolean
  showWorkspace: boolean
}) {
  const { view, exportScreen, onExportScreen, showWorkspace } = input

  const emptyCopy = view === 'preview-failed'
    ? { title: '这条记录没读回来', description: '可能已过留存期、不是本人，或者网络不通。不拿别的结果凑数。' }
    : view === 'preview-no-result'
      ? { title: '没有可看的结果', description: '预览要有一次已经完成的生成。这次进来没带结果，不会拿示例冒充你的简历。' }
      : view === 'illegal'
        ? { title: '认不出这个页面状态', description: '地址里的状态没有登记。这一页不猜你想去哪一步，也不把原始参数显示出来。' }
        : view === 'preview-loading'
          ? { title: '正在读取生成结果…', description: '读回来之前，这一页不显示任何简历内容。' }
          : { title: '生成结果已清除', description: '公共设备不保留个人信息。刷新、返回或待机之后，这一份要重新填写。' }

  const emptyNext = view === 'preview-failed'
    ? { ask: '换条路继续', doing: '可以再读一次，或者回去重填一遍。' }
    : view === 'preview-no-result'
      ? { ask: '先完成一次生成', doing: '回去填写，生成之后再到这里逐段核对。' }
      : view === 'illegal'
        ? { ask: '从简历服务重新进来', doing: '回到简历服务，再点一次「从零生成简历」。' }
        : view === 'preview-loading'
          ? { ask: '稍等一下', doing: '结果读回来后，就能逐段核对。' }
          : { ask: '需要重新生成', doing: '回去重新填写，就能再生成一份预览。' }

  const statusLabel = onExportScreen
    ? (exportScreen === 'export-exporting' ? '正在生成文件' : exportScreen === 'export-failed' ? '这次没导出' : exportScreen === 'export-ready' ? '文件已好' : exportScreen === 'export-url-expired' ? '下载链接过期' : exportScreen === 'export-print-unavailable' ? '暂时不能打印' : '选格式')
    : (view === 'preview-loading' ? '正在读回这次结果' : view === 'preview-failed' ? '这次没读回来' : view === 'illegal' ? '认不出这一页' : showWorkspace ? '核对这一次的结果' : '预览')

  const advisor = onExportScreen
    ? { eyebrow: '导出', ask: exportScreen === 'export-chooser' ? '要哪种格式？' : exportScreen === 'export-exporting' ? '正在生成文件' : exportScreen === 'export-failed' ? '文件没生成出来' : exportScreen === 'export-ready' ? '文件好了' : exportScreen === 'export-url-expired' ? '扫码取件这条过期了' : '这一份暂时进不了打印', doing: exportScreen === 'export-chooser' ? '四种都能导出。页数、版式和打印目前只有 PDF 有。' : '核对过的内容还在。这一步只出文件，不改描述。' }
    : showWorkspace
      ? { eyebrow: '预览', ask: '生成好了，你核一遍', doing: '事实和你填的逐字一致。被润色过的段落会标明供参考。' }
      : { eyebrow: '预览', ask: emptyNext.ask, doing: emptyNext.doing }

  // 底栏「问小青」：每个状态一句自己的问题（稿 gen-preview 各状态）；稿里 ask 为 false 的「认不出」状态不画。
  const previewAsk: ResumeAsk | null = onExportScreen
    ? (exportScreen === 'export-exporting' ? ASKS.exportBusy
      : exportScreen === 'export-failed' ? ASKS.exportFailed
        : exportScreen === 'export-ready' ? ASKS.exportReady
          : exportScreen === 'export-url-expired' ? ASKS.exportExpired
            : exportScreen === 'export-print-unavailable' ? ASKS.exportNoPrint
              : ASKS.exportChooser)
    : view === 'illegal' ? null
      : view === 'preview-failed' ? ASKS.previewFailed
        : view === 'preview-no-result' ? ASKS.previewNone
          : view === 'session-lost' ? ASKS.previewLost
            : ASKS.previewReady

  return { emptyCopy, statusLabel, advisor, previewAsk }
}
