import type { KioskIconName } from '../../components/kiosk-icon'

export interface ServiceTile {
  title: string
  description?: string
  icon: KioskIconName
  to?: string
  state?: Record<string, unknown>
  disabled?: boolean
}

export type Accent = 'teal' | 'clay' | 'slate' | 'wheat' | 'plum' | 'tool'

export interface ServiceGroup {
  id: string
  title: string
  subtitle: string
  icon: KioskIconName
  accent: Accent
  layout: 'featured' | 'paired' | 'standard' | 'wide'
  span2?: boolean
  cols2?: boolean
  badge?: { icon: KioskIconName; label: string }
  tiles: ServiceTile[]
  /** 组标题点击目标；未设置时沿用原逻辑（跳到第一个可用子项）。 */
  titleTo?: string
}

export const SERVICE_GROUPS: ServiceGroup[] = [
  {
    id: 'resume',
    title: 'AI简历服务',
    subtitle: '诊断、优化、打印，一次完成',
    icon: 'resume',
    accent: 'teal',
    layout: 'featured',
    span2: true,
    badge: { icon: 'star', label: '推荐先做' },
    tiles: [
      // intent 分流:同一上传链路,按入口语义展示不同标题/说明/引导(视觉与分组结构不变)
      { title: 'AI简历诊断', description: '上传后查看结构与表达建议', icon: 'doc-check', to: '/resume/source?intent=diagnose' },
      { title: 'AI简历优化', description: '基于目标岗位优化表达', icon: 'sparkle', to: '/resume/source?intent=optimize' },
      { title: '简历素材库', description: '选择模板与素材参考', icon: 'book', to: '/resume/templates' },
      { title: '职业规划', description: '梳理职业方向与行动建议', icon: 'compass', to: '/resume/career-plan' },
      { title: '简历打印', description: '生成后在本机打印', icon: 'printer', to: '/print/upload?source=resume' },
      { title: '求职材料', description: '整理求职材料与清单', icon: 'briefcase', to: '/resume/materials' },
    ],
  },
  {
    id: 'jobs',
    title: '岗位信息',
    subtitle: '第三方来源岗位，去来源平台投递',
    icon: 'briefcase',
    accent: 'clay',
    layout: 'paired',
    tiles: [
      { title: '全职岗位', description: '第三方来源全职信息', icon: 'briefcase', to: '/jobs?category=fulltime' },
      { title: '实习岗位', description: '第三方来源实习信息', icon: 'campus', to: '/jobs?category=intern' },
      { title: '兼职信息', description: '第三方来源兼职信息', icon: 'clock', to: '/jobs?category=parttime' },
      { title: '全部岗位', description: '按分类查看全部来源岗位', icon: 'files', to: '/jobs' },
      { title: '找企业', description: '查看企业信息与职位来源', icon: 'shield', to: '/companies' },
      // 2026-07-11：按 IA 整合审计 §3⑧ 拍板执行——复用既有「岗位匹配参考」（2D）能力，不新增独立路由/页面。
      { title: '岗位大师', description: '岗位匹配参考与优化方向', icon: 'star', to: '/resume/job-fit' },
    ],
  },
  {
    id: 'job-fairs',
    title: '招聘会',
    subtitle: '查看场次信息，去来源平台预约',
    icon: 'pin',
    accent: 'wheat',
    layout: 'paired',
    tiles: [
      { title: '社会招聘会', description: '查看社会招聘会场次', icon: 'pin', to: '/job-fairs' },
      { title: '校园招聘会', description: '查看校园招聘会安排', icon: 'campus', to: '/campus' },
      { title: '扫码签到', description: '现场扫码签到指引', icon: 'qr', to: '/job-fairs/checkin' },
    ],
  },
  {
    id: 'print-scan',
    title: '打印扫描',
    subtitle: '上传或扫描，本机直接出纸',
    icon: 'printer',
    accent: 'slate',
    layout: 'standard',
    titleTo: '/print-scan',
    tiles: [
      { title: '文档打印', description: '上传文档后本机打印', icon: 'printer', to: '/print/upload?source=document' },
      { title: '证件复印', description: '待设备能力开放', icon: 'files', disabled: Boolean(true) },
      { title: '纸质扫描', description: '扫描纸质文件后保存', icon: 'scan', to: '/scan/start' },
      // 2026-07-12：「云打印」磁贴按正式取舍决策删除（能力归位文档打印+手机扫码上传；
      // 远程提交·到店取件记入商用二期候选），见 docs/reviews/2026-07-12-cloud-print-decision.md
      { title: '格式转换', description: '常用文件格式转换', icon: 'swap', to: '/print-scan/convert' },
      { title: '证件照打印', description: '待设备能力开放', icon: 'user', disabled: Boolean(true) },
    ],
  },
  {
    id: 'interview',
    title: 'AI面试训练',
    subtitle: '模拟练习，仅供参考',
    icon: 'headset',
    accent: 'plum',
    layout: 'standard',
    tiles: [
      { title: '模拟面试', description: 'AI 模拟问答练习', icon: 'mic', to: '/interview/setup' },
      { title: '面试技巧', description: '常见面试技巧参考', icon: 'bulb', to: '/interview/tips' },
      { title: '面试报告', description: '查看已生成的训练报告', icon: 'doc-check', to: '/interview/reports' },
    ],
  },
  {
    id: 'policy',
    // 合规:补贴类只做政策说明/材料清单/官方入口/申请指引(info-only),
    // 不出现"快申/申请"等暗示平台内办理的表述。
    title: '政策服务',
    subtitle: '政策查询与办事材料指引',
    icon: 'policy',
    accent: 'wheat',
    layout: 'wide',
    span2: true,
    tiles: [
      // 「就业政策」Tab 内含补贴指引内容；「社保指南」与 tab=social 一一对应，避免同义重复入口。
      { title: '就业政策', description: '就业政策与官方口径', icon: 'policy', to: '/renshi?tab=policy' },
      { title: '社保指南', description: '社保办事材料参考', icon: 'ticket', to: '/renshi?tab=social' },
      { title: '档案 / 登记', description: '档案登记材料指引', icon: 'files', to: '/renshi?tab=register' },
    ],
  },
]

export const SUB_ACCENT: Record<Accent, string> = {
  teal: '',
  clay: 'clay',
  slate: 'slate',
  wheat: 'wheat',
  plum: 'plum',
  tool: '',
}
