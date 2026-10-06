import type { OptimizeViewState } from './constants'
import { errorCodeOf, userMessageOf } from '../../../../services/api/userErrorMessage'
import { helpNeededLine } from '../../../../copy/unattendedCopy'

/** 仅优化稿导出的字段校验提示；不修改其他调用方的公共错误文案。 */
export function optimizeExportErrorMessage(error: unknown): string {
  if (errorCodeOf(error) !== 'VALIDATION_FAILED') return userMessageOf(error, '导出失败，请稍后重试')
  const message = error instanceof Error ? error.message : ''
  const field = message.match(/^(basic\.(?:name|phone|email|city)|intention\.(?:position|city|jobType|salary)|summary|(?:education|experience|projects)(?:\.\d+|\[\d+\])\.(?:school|major|degree|period|description|company|role|name)|skills|certificates)\b/)?.[1]?.replace(/\[(\d+)\]/g, '.$1')
  if (field?.startsWith('intention.')) {
    const label = { position: '求职意向', city: '意向城市', jobType: '工作类型', salary: '期望薪资' }[field.slice(10) as 'position' | 'city' | 'jobType' | 'salary']
    return `${label}未被当前服务接受。求职意向可以留空。${helpNeededLine()}。也可以先导出修改清单。`
  }
  const labels: Record<string, string> = {
    'basic.name': '姓名', 'basic.phone': '电话', 'basic.email': '邮箱', 'basic.city': '所在城市',
    summary: '个人简介', skills: '技能', certificates: '证书',
    school: '学校', major: '专业', degree: '学历', period: '时间', description: '描述',
    company: '公司', role: '职务', name: '名称',
  }
  const listField = field?.match(/^(education|experience|projects)\.(\d+)\.(\w+)$/)
  const sections: Record<string, string> = { education: '教育经历', experience: '工作经历', projects: '项目经历' }
  const label = listField
    ? `${sections[listField[1] ?? '']}第 ${Number(listField[2]) + 1} 条的${labels[listField[3] ?? '']}`
    : field ? labels[field] : undefined
  if (!label) return `简历中有内容不符合导出要求，服务未说明具体项目。${helpNeededLine()}。也可以先导出修改清单。`
  const maxLength = message.match(/shorter than or equal to (\d+) characters/)?.[1]
  const section = listField?.[1]
  const key = listField?.[3]
  // 经历的公司、职务和教育的学校、专业可以在优化页改。项目标题、学历、时间段仍不能改。
  const editable = field === 'summary' || field === 'skills' || field === 'certificates' || key === 'description'
    || (section === 'experience' && (key === 'company' || key === 'role'))
    || (section === 'education' && (key === 'school' || key === 'major'))
  if (!editable) {
    const reason = message.includes('should not be empty') ? '还没填写' : maxLength ? `超过 ${maxLength} 字` : '格式不符合导出要求'
    return `${label}${reason}。这一项不能在本页修改，请核对原简历后重新上传并诊断。仍失败时，${helpNeededLine()}。也可以先导出修改清单。`
  }
  if (message.includes('should not be empty')) return `${label}还没填写，请在编辑区补上后再导出。`
  if (maxLength) return `${label}太长了，请在编辑区缩短到 ${maxLength} 字以内后再导出。`
  return `${label}的格式不符合导出要求，请在编辑区检查这一项后再导出。仍失败时，${helpNeededLine()}。`
}

export function optimizeStateTitle(view: OptimizeViewState): string {
  if (view === 'loading') return '正在生成优化建议'
  if (view === 'empty') return '这次没有优化建议'
  if (view === 'read-error') return '优化结果读取失败'
  if (view === 'optimize-failed') return '这次没有生成出来'
  if (view === 'unavailable') return '简历优化当前不可用'
  if (view === 'illegal') return '地址无效'
  return '请先上传简历完成诊断'
}

/**
 * 右上角胶囊。AI 停用不再写成「等待优化建议」（W-131）。
 * 其余状态维持原来的短标签：胶囊不照抄正文标题，屏上同一句不出现两次。
 */
export function optimizeStatusCapsule(view: OptimizeViewState): { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string } {
  if (view === 'ready') return { tone: 'ok', label: '逐条确认' }
  if (view === 'unavailable') return { tone: 'bad', label: 'AI 暂时用不了' }
  return { tone: 'unknown', label: '等待优化建议' }
}

export function optimizeStateDescription(view: OptimizeViewState, failMsg: string | null): string {
  if (view === 'loading') return '正在读取优化结果，读回来之前不展示任何简历内容。'
  if (view === 'illegal') return '这个地址暂时无法打开，请从诊断报告或我的简历重新进入。'
  if (view === 'unavailable') return failMsg ?? '暂时无法生成优化建议，可以先手动整理或返回上传。'
  return failMsg ?? '优化建议基于诊断结果生成。回到 AI 简历服务上传简历并完成诊断后，再进入本页。'
}
