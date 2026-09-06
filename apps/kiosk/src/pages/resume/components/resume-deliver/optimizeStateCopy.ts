import type { OptimizeViewState } from './constants'

export function optimizeStateTitle(view: OptimizeViewState): string {
  if (view === 'loading') return '正在生成优化建议'
  if (view === 'empty') return '这次没有优化建议'
  if (view === 'read-error') return '优化结果读取失败'
  if (view === 'optimize-failed') return '这次没有生成出来'
  if (view === 'unavailable') return '简历优化当前不可用'
  if (view === 'illegal') return '地址无效'
  return '请先上传简历完成诊断'
}

export function optimizeStateDescription(view: OptimizeViewState, failMsg: string | null): string {
  if (view === 'loading') return '正在读取优化结果，读回来之前不展示任何简历内容。'
  if (view === 'illegal') return '查询参数无法识别，已按失败关闭处理，不回显原始地址。'
  if (view === 'unavailable') return failMsg ?? '能力未接通。可打印原件或返回上传。'
  return failMsg ?? '优化建议基于诊断结果生成。回到 AI 简历服务上传简历并完成诊断后，再进入本页。'
}
