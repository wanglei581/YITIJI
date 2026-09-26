// 简历对照结果页的「下一步建议」。
//
// 2026-09-26（next-tasks 3.14）起服务端不再返回 fitLevel，结果页不再分档：
// 此前按「较高 / 中等 / 偏低」三档各写一套标题、风险提示与下一步顺序，现在只剩
// 一套与档位无关的去处。三条都是站内既有流程，不外跳、不新增页面。

/** 下一步建议里可以去的站内既有去处。 */
export type JobFitStepTarget = 'actions' | 'optimize' | 'materials'

export const JOB_FIT_NEXT_STEPS: ReadonlyArray<{ target: JobFitStepTarget; title: string; desc: string }> = [
  { target: 'actions', title: '查看行动清单', desc: '把简历里还没体现的要求，变成一条条能做的准备。' },
  { target: 'optimize', title: '去简历优化', desc: '按这份岗位要求重排内容，把缺的地方补写清楚。' },
  { target: 'materials', title: '整理佐证材料', desc: '已有的成果、证书、作品在材料工坊排版打印；本机不出具任何资质。' },
]
