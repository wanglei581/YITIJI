/** 练面试页内唯一的滚动容器：设置、报告、技巧、记录是 .interview-flow__scroll，作答是 .interview-session__content，服务台是 .qxt-ivhub。 */
export const INTERVIEW_SCROLLER_SELECTOR = '.interview-flow__scroll, .interview-session__content, .qxt-ivhub'

export function findInterviewScroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.qxt-body-iv :is(${INTERVIEW_SCROLLER_SELECTOR})`)
}

/** 切视图（设置步骤、报告主视图与更多）后回到顶，打在真正在滚的那一层。 */
export function scrollInterviewToTop(): void {
  findInterviewScroller()?.scrollTo(0, 0)
}
