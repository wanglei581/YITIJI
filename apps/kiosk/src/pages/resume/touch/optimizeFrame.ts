import { formatClock } from '../components/resume-deliver/resumeDecisions'
import { optimizeStatusCapsule } from '../components/resume-deliver/optimizeStateCopy'
import type { OptimizeViewState } from '../components/resume-deliver/constants'
import type { DraftSaveStatus } from '../components/resume-deliver/useResumeDraftAutosave'

export type OptimizePane = 'overview' | 'editor' | 'export'

/** 草稿保存状态：右侧状态行说整句，顶栏胶囊说短词。没登录就如实说不会保存。 */
export function saveInfoOf(loggedIn: boolean, status: DraftSaveStatus, savedAt?: string | null) {
  if (!loggedIn) return { text: '未登录，草稿不会保存', pill: '未保存', bad: false }
  if (status === 'failed') return { text: '保存失败，改动仅在当前页面有效，离机将丢失', pill: '保存失败', bad: true }
  if (status === 'saving') return { text: '正在保存草稿…', pill: '正在保存', bad: false }
  if (status === 'saved' && savedAt) return { text: `草稿已保存 ${formatClock(savedAt, true)}`, pill: '草稿已保存', bad: false }
  return { text: '未保存', pill: '未保存', bad: false }
}

/** 三屏各自的标题、眉题和顶栏胶囊（稿 optimize / resume-edit / resume-export）；没有建议稿时用状态态的说法。 */
export function frameTextOf(input: {
  view: OptimizeViewState
  pane: OptimizePane
  moduleCount: number
  exported: boolean
  save: { pill: string; bad: boolean }
}) {
  const { view, pane } = input
  if (view !== 'ready') return { title: '简历优化建议', eyebrow: undefined, status: optimizeStatusCapsule(view) }
  if (pane === 'export') {
    return { title: '要带走哪一种文件？', eyebrow: '导出与打印', status: { tone: 'unknown' as const, label: input.exported ? '已生成文件' : '还没有文件' } }
  }
  if (pane === 'editor') {
    return { title: '版式和模板，要怎么排？', eyebrow: '编辑', status: { tone: input.save.bad ? 'warn' as const : 'unknown' as const, label: input.save.pill } }
  }
  return {
    title: input.moduleCount > 0 ? `这份简历有 ${input.moduleCount} 处可以改` : '简历优化建议',
    eyebrow: 'AI 建议稿 · AI 生成，仅供参考，请自行核对',
    status: optimizeStatusCapsule(view),
  }
}
