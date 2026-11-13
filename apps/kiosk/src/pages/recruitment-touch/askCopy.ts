// 本包「问小青」卡（RtAskCard）的文案：线下机构三页共用一套，参展企业详情一套。
// 只写文案，不碰组件与接口；draft 是带到顾问页输入框里的那句话，用户在顾问页自己决定发不发。

export const OFFLINE_AGENCY_ASK = {
  testId: 'offline-agency-ai',
  title: '整理到店要问的问题',
  desc: '按你说的整理咨询问题和材料清单。不核验机构资质，也不生成机构或岗位信息。',
  draft: '到店要带什么？帮我整理要问的问题和材料清单',
  fallback: '不靠 AI 也能问清楚：岗位要求、材料清单、收费公示，到店当面确认这三项。',
} as const

export const FAIR_COMPANY_ASK = {
  testId: 'fair-company-ai',
  title: '到展位先问哪几句',
  desc: '按这家企业的现场岗位清单，整理到展位要问的问题。不代投递、不预约、不签到，也不生成企业信息。',
  draft: '这家企业的现场岗位，到展位该问哪几句？',
  fallback: '不靠 AI 也能问：岗位要求、到岗时间、后续联系方式，到展位当面问这三项。',
} as const

/** 在固定问句后面追加本屏已显示的对象名（机构、岗位、企业），让小青知道问的是哪一个；没有对象就原样返回。 */
export function askDraftWith(base: string, ...subjects: Array<string | null | undefined>): string {
  const names = subjects.map((name) => (name ?? '').trim()).filter(Boolean)
  return names.length > 0 ? `${base}（${names.join('，')}）` : base
}
