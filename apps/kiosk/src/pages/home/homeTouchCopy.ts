import type { HomeJobFairHighlightState } from './hooks/useHomeJobFairHighlight'
import type { HomeJobHighlightState } from './hooks/useHomeJobHighlight'

export function greetingWord(date: Date): string {
  const hour = date.getHours()
  if (hour < 6) return '夜深了'
  if (hour < 11) return '上午好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function capabilityMark(
  status: string,
  configVersion: string,
  ready: boolean,
): 'loading' | 'on' | 'off' | 'unknown' {
  if (status === 'loading') return 'loading'
  if (status === 'ready' && configVersion) return ready ? 'on' : 'off'
  return 'unknown'
}

/**
 * 社会招聘磁贴。全量 total 只给 hook 判断成败，这里不写成「N 个在招」。
 * error 与 empty 的说明必须不同。
 */
export function jobCopy(state: HomeJobHighlightState): { description: string; badge: string } {
  if (state.status === 'ready') return { description: '全职、兼职岗位和社会招聘会', badge: '已读取' }
  if (state.status === 'loading') return { description: '正在读取', badge: '读取中' }
  if (state.status === 'error') return { description: '暂时无法获取岗位数量', badge: '读取失败' }
  return { description: '全职、兼职岗位和社会招聘会', badge: '暂无岗位' }
}

/** 与 CampusPage 的校园场次规则一致：theme 优先，否则名称、主办方、简介、来源。 */
const CAMPUS_RE = /校园|校招|高校|大学|学院|应届|毕业生|双选|研究生|校企/

export function isCampusFair(fair: {
  theme?: string | null
  name?: string | null
  organizer?: string | null
  description?: string | null
  sourceName?: string | null
}): boolean {
  return (
    fair.theme === 'campus'
    || fair.theme === 'campus_corp'
    || CAMPUS_RE.test(`${fair.name ?? ''} ${fair.organizer ?? ''} ${fair.description ?? ''} ${fair.sourceName ?? ''}`)
  )
}

const CAMPUS_BASE = '校园招聘会、校招和实习岗位'

export function campusCopy(state: HomeJobFairHighlightState): { description: string; badge: string } {
  if (state.status === 'loading') return { description: '正在读取', badge: '读取中' }
  if (state.status === 'error') return { description: '没有使用缓存或示例数据，请稍后重试。', badge: '读取失败' }
  if (state.status === 'empty') return { description: CAMPUS_BASE, badge: '暂无场次' }
  const name = isCampusFair(state.fair) ? state.fair.name : ''
  return { description: name ? `${CAMPUS_BASE} · ${name}` : CAMPUS_BASE, badge: state.fair.status === 'ongoing' ? '正在进行' : '即将开始' }
}
