// 三档结果的文案表。
//
// 稿 46 的原则：档位是服务端唯一给出的事实，所以三档之间必须在
// 「关注重点、风险提示、下一步顺序」上真的不同 —— 否则三档就等于一档。
// 除此之外一律是真实返回内容或诚实槽位：不写分数、百分比、通过率或录用结论。

import type { JobFitResponse } from '@ai-job-print/shared'

export type JobFitLevelKey = 'high' | 'mid' | 'low'

/** 下一步建议里可以去的站内既有去处。 */
export type JobFitStepTarget = 'actions' | 'optimize' | 'materials' | 'jobs' | 'pick'

export interface JobFitLevelSpec {
  /** 三档梯子上高亮的那一格，也是判定卡上的大字。 */
  label: string
  title: string
  subtitle: string
  pill: string
  focus: string
  lead: string
  risk: string
  steps: Array<{ target: JobFitStepTarget; title: string; desc: string }>
  note: string
}

export const JOB_FIT_LEVELS: readonly string[] = ['较高', '中等', '偏低']

export const JOB_FIT_LEVEL_KEY: Record<NonNullable<JobFitResponse['fitLevel']>, JobFitLevelKey> = {
  reference_high: 'high',
  reference_medium: 'mid',
  reference_low: 'low',
}

export const JOB_FIT_RESULT_SPEC: Record<JobFitLevelKey, JobFitLevelSpec> = {
  high: {
    label: '较高',
    title: '这次匹配，准备程度较高',
    subtitle: '方向基本对得上。重点转到怎么把已经匹配的经历讲清楚，具体依据与差距由服务端逐条返回。',
    pill: '匹配参考已返回 · 较高',
    focus: '把已经对得上的经历讲清楚、讲具体',
    lead: '较高说明目标方向和你现在这份材料基本对得上。接下来把对应的经历、成果和能出示的材料准备到当面能讲清楚。',
    risk: '较高不等于稳：面试仍会追细节，先把能佐证的材料备齐。',
    steps: [
      { target: 'actions', title: '查看行动清单', desc: '把返回的依据变成一条条能做的准备。' },
      { target: 'optimize', title: '去简历优化', desc: '把对得上的经历排到更靠前、写得更具体。' },
      { target: 'materials', title: '整理佐证材料', desc: '把已有的成果、证书、作品整理成能当面出示的形式。' },
    ],
    note: '参考只描述准备程度，不代表企业的真实评价。',
  },
  mid: {
    label: '中等',
    title: '有对得上的部分，也有明显缺口',
    subtitle: '按服务端逐条返回的依据与差距，自己判断先补哪几项。',
    pill: '匹配参考已返回 · 中等',
    focus: '先补差距里最影响判断的那几项',
    lead: '中等说明这份材料和目标岗位有一部分对得上，也有明显缺口。具体缺哪几项、各自重要到什么程度，以服务端逐条返回的差距为准。',
    risk: '中等不代表补齐就能通过：企业是否录用与本页无关，本页只描述当前材料的准备程度。',
    steps: [
      { target: 'optimize', title: '去简历优化', desc: '按目标岗位重排内容，把缺口位置补写清楚。' },
      { target: 'actions', title: '查看行动清单', desc: '返回的差距会按重要程度排成可执行的准备。' },
      { target: 'materials', title: '整理证明材料', desc: '已有的成果、证书、作品在材料工坊排版打印；本机不出具任何资质。' },
    ],
    note: '参考只描述准备程度，不代表企业的真实评价；补到什么程度由你自己判断。',
  },
  low: {
    label: '偏低',
    title: '差距还比较多，先把底子补上',
    subtitle: '按现在这份材料，和这个目标差距比较多。补材料或换目标都行。',
    pill: '匹配参考已返回 · 偏低',
    focus: '先补基础材料，或换一个更接近的目标',
    lead: '偏低说明按现在这份材料，和这个目标的差距比较多。两条路都成立：把简历内容补完整，或者在同类岗位里挑一个门槛更接近的再看一次。',
    risk: '偏低不代表不能投；它只描述现在这份材料的准备程度。',
    steps: [
      { target: 'pick', title: '换一个更接近的目标', desc: '在同类岗位里挑一个门槛更接近的，再看一次参考。' },
      { target: 'jobs', title: '先看岗位要求', desc: '直接看来源平台写的要求，自己对一遍。' },
      { target: 'actions', title: '查看行动清单', desc: '想继续冲这个目标，就按差距一条条补。' },
    ],
    note: '偏低不代表不能投；这里只描述当前材料的准备程度。',
  },
}
