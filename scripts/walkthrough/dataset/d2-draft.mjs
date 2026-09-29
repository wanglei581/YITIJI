// D1 的 policies.md / channels.md 等不到时使用。全部标「示例」，不写金额，不借用真实机构背书。
import { ORGS } from './d2-catalog.mjs'

function block({ org, title, mark, kind, audience, category, date, path, summary, paragraphs }) {
  const orgRow = ORGS.find((item) => item.key === org)
  const lines = [
    `### ${title}`,
    `- 标注：${mark}`,
    `- 类型：${kind}`,
  ]
  if (audience) lines.push(`- 人群：${audience}`)
  if (category) lines.push(`- 标签：${category}`)
  lines.push(`- 展示日期：${date}`)
  lines.push(`- 来源：https://${orgRow.domain}${path}`)
  lines.push(`- 摘要：${summary}`)
  lines.push('- 正文：')
  lines.push('示例。本条不是青岛市任何行政机关或高校发布的文件，不代表任何真实机构。')
  lines.push('')
  for (const paragraph of paragraphs) lines.push(paragraph)
  lines.push('')
  return lines.join('\n')
}

const POLICIES = [
  block({
    org: 'shinan', title: '示例·市南区公共就业服务大厅办事指引', mark: '发布', kind: '公告', category: '公告',
    date: '2026-09-01', path: '/policies/hall-guide',
    summary: '示例。服务大厅一楼窗口能办哪些事、要带什么材料。不涉及金额。',
    paragraphs: ['一、可咨询事项：就业登记指路、档案存放地查询、表格领取。', '二、请携带本人身份证件原件。代办需带委托书。', '三、窗口只核验材料是否齐，不在本页承诺办理结果。'],
  }),
  block({
    org: 'shinan', title: '示例·灵活就业人员参保登记材料说明', mark: '发布', kind: '政策扶持', audience: '灵活就业人员',
    date: '2026-08-15', path: '/policies/flexible-register',
    summary: '示例。说明灵活就业人员办理参保登记时常见的材料，不列缴费标准。',
    paragraphs: ['一、通常需要身份证件、近期免冠照片。', '二、是否受理、按什么标准办理，以参保地窗口当时的规定为准。', '三、本条不列任何数额，也不代为办理。'],
  }),
  block({
    org: 'shinan', title: '示例·市南区2024年春风行动服务安排（已过期）', mark: '已过期', kind: '公告', category: '公告',
    date: '2024-02-20', path: '/policies/spring-2024',
    summary: '示例。2024 年 2 月的现场服务安排，服务时段已经结束。',
    paragraphs: ['一、该安排对应的服务时段是 2024 年 2 月，现已结束。', '二、保留这条只为让管理员按「已过期」走紧急下架核对。', '三、现行服务时间请看仍在有效期内的办事指引。'],
  }),
  block({
    org: 'shinan', title: '示例·市南区就业服务热线使用说明（待审核）', mark: '待审核', kind: '公告', category: '通知',
    date: '2026-09-20', path: '/policies/hotline',
    summary: '示例。热线只做指路，这条故意留在待审核，不发布。',
    paragraphs: ['一、热线只回答窗口位置和材料种类。', '二、本条尚未经本机构审核，不应出现在一体机上。'],
  }),
  block({
    org: 'laoshan', title: '示例·崂山区零工求职登记须知', mark: '发布', kind: '公告', category: '公告',
    date: '2026-09-01', path: '/policies/gig-register',
    summary: '示例。早市时段来零工之家登记求职时要准备什么。',
    paragraphs: ['一、早 7 点到 9 点人多，建议先在咨询台取号。', '二、可带纸质简历，没有简历也可以先做求职登记。', '三、本页不提供岗位投递，也不收取任何费用。'],
  }),
  block({
    org: 'laoshan', title: '示例·零工参加工伤保险的办理指路', mark: '发布', kind: '政策扶持', audience: '灵活就业人员',
    date: '2026-07-01', path: '/policies/injury',
    summary: '示例。只说明去哪个窗口问工伤保险，不列标准、不代办。',
    paragraphs: ['一、请到参保地社保窗口咨询本人是否在可办理范围内。', '二、常见材料是身份证件和用工情况说明。', '三、能否办理、按什么标准，以窗口解释为准。本条不写数额。'],
  }),
  block({
    org: 'laoshan', title: '示例·零工之家早市服务时间调整（准备下架）', mark: '准备下架', kind: '公告', category: '通知',
    date: '2026-06-01', path: '/policies/hours-old',
    summary: '示例。旧的早市时间说明，准备由平台紧急下架。',
    paragraphs: ['一、这条写的是已经不用的早市时间。', '二、新的时间以咨询台当周告示为准。', '三、标注「准备下架」，供管理员走紧急下架。'],
  }),
  block({
    org: 'laoshan', title: '示例·家政服务零工技能培训开班通知（待审核）', mark: '待审核', kind: '公告', category: '招募',
    date: '2026-09-18', path: '/policies/housekeeping-class',
    summary: '示例。开班通知还在起草，留在待审核。',
    paragraphs: ['一、培训地点和名额都还没定。', '二、本条只提交审核，不发布到一体机。'],
  }),
  block({
    org: 'huangdao', title: '示例·高校毕业生档案转递指引', mark: '发布', kind: '政策扶持', audience: '应届高校毕业生',
    date: '2026-09-01', path: '/policies/archive',
    summary: '示例。离校时档案转到哪里、要问就业中心哪一个窗口。',
    paragraphs: ['一、档案转递单由学校就业中心开具。', '二、请核对接收入和接收地址是否写全。', '三、本条不代替学校的正式通知。'],
  }),
  block({
    org: 'huangdao', title: '示例·离校未就业毕业生实名登记说明', mark: '发布', kind: '政策扶持', audience: '应届高校毕业生',
    date: '2026-08-01', path: '/policies/unemployed-register',
    summary: '示例。说明实名登记要填哪些栏，不涉及待遇。',
    paragraphs: ['一、登记内容一般包括姓名、专业、联系电话、目前去向。', '二、登记只用于学校掌握离校去向，不是投递简历。', '三、电话请用本人正在使用的号码。'],
  }),
  block({
    org: 'huangdao', title: '示例·2025年秋季校园招聘服务安排（已过期）', mark: '已过期', kind: '公告', category: '公告',
    date: '2025-09-01', path: '/policies/autumn-2025',
    summary: '示例。2025 年秋季的场次安排已经结束。',
    paragraphs: ['一、文中的日期是 2025 年 9 月，活动已结束。', '二、今年的场次以就业中心当月通知为准。', '三、本条标注「已过期」。'],
  }),
  block({
    org: 'huangdao', title: '示例·职业指导预约方式', mark: '发布', kind: '公告', category: '通知',
    date: '2026-09-10', path: '/policies/career-advice',
    summary: '示例。怎么预约一次职业指导谈话。',
    paragraphs: ['一、在就业中心前台登记姓名和方便的时间段。', '二、每次谈话约 20 分钟，请带上自己的简历草稿。', '三、谈话记录只留给本人，不转给用人单位。'],
  }),
  block({
    org: 'chengyang', title: '示例·社区就业服务站办事须知', mark: '发布', kind: '公告', category: '公告',
    date: '2026-09-01', path: '/policies/station-guide',
    summary: '示例。社区服务站下午人多，打印和咨询怎么排队。',
    paragraphs: ['一、下午 2 点到 4 点是打印高峰，先取号。', '二、帮家属取打印件时，请带取件码和本人身份证件。', '三、网络不稳定时，工作人员会请你稍后再试，不会显示已经打印成功。'],
  }),
  block({
    org: 'chengyang', title: '示例·退役军人适应性培训报名说明', mark: '发布', kind: '政策扶持', audience: '通用',
    date: '2026-08-20', path: '/policies/veteran-training',
    summary: '示例。报名要带退役证明的哪一页，不列培训待遇。',
    paragraphs: ['一、请携带身份证件和退役证明原件到社区窗口报名。', '二、名额和开班时间由组织培训的单位另行通知。', '三、本条不写任何待遇标准。'],
  }),
  block({
    org: 'chengyang', title: '示例·社区打印帮办时段说明（准备下架）', mark: '准备下架', kind: '公告', category: '通知',
    date: '2026-05-01', path: '/policies/print-help-old',
    summary: '示例。旧的帮办时段已经改了，准备下架。',
    paragraphs: ['一、这条写的帮办时段已经不用。', '二、现行时段看办事须知。', '三、标注「准备下架」。'],
  }),
  block({
    org: 'chengyang', title: '示例·就业困难人员认定材料清单', mark: '发布', kind: '政策扶持', audience: '困难群体就业援助',
    date: '2026-09-05', path: '/policies/hardship-docs',
    summary: '示例。只列常见材料名称，是否认定由窗口决定。',
    paragraphs: ['一、常见材料：身份证件、失业登记回执、家庭情况说明。', '二、缺哪一项以窗口当次告知为准。', '三、本条不判断是否符合认定条件，也不写金额。'],
  }),
]

export function draftPoliciesMarkdown() {
  const parts = ['# 示例政策草案', '', '> D1 未交付时由 D2 按 PERSONAS.md 起草。全部为「示例」，不含金额，不代表任何真实机构。', '']
  for (const org of ORGS) {
    parts.push(`## ${org.name}`, '')
    for (const policy of POLICIES) {
      if (policy.includes(`### 示例·`) && policy.includes(`https://${org.domain}`)) parts.push(policy)
    }
  }
  // 上面的过滤不稳，直接按块重拼。
  return [
    '# 示例政策草案',
    '',
    '> D1 未交付时由 D2 按 PERSONAS.md 起草。全部为「示例」，不含金额，不代表任何真实机构。',
    '',
    ...ORGS.flatMap((org) => [`## ${org.name}`, '', ...POLICIES.filter((item) => item.includes(`https://${org.domain}/`)), '']),
  ].join('\n')
}

export function draftChannelsMarkdown() {
  const lines = ['# 示例官方渠道', '', '> 链接都在 example.com 子域上，并标明示例。界面没有单独的小程序类型，小程序入口用 https 链接。', '']
  const items = {
    shinan: [
      ['示例·市南就业网', `https://shinan.example.com/`, '1'],
      ['示例·市南就业公众号', `https://mp.shinan.example.com/official`, '2'],
    ],
    laoshan: [
      ['示例·崂山零工之家网', `https://laoshan.example.com/`, '1'],
      ['示例·崂山零工公众号', `https://mp.laoshan.example.com/official`, '2'],
    ],
    huangdao: [
      ['示例·黄岛就业指导网', `https://huangdao.example.com/`, '1'],
      ['示例·黄岛就业公众号', `https://mp.huangdao.example.com/official`, '2'],
    ],
    chengyang: [
      ['示例·城阳社区服务网', `https://chengyang.example.com/`, '1'],
      ['示例·城阳社区公众号', `https://mp.chengyang.example.com/official`, '2'],
    ],
  }
  for (const org of ORGS) {
    lines.push(`## ${org.name}`, '')
    for (const [name, url, order] of items[org.key]) {
      lines.push(`- 名称：${name}`, `  链接：${url}`, `  排序：${order}`, '')
    }
  }
  return lines.join('\n')
}
