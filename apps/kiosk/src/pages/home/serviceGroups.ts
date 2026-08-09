// 首页入口数据源
//
// ── 第一段：V3 意图台首页（2026-08-09 试点，唯一在渲染的数据） ──
// 真值：docs/design/kiosk-ai-os-v3-2026-08/phase2-home-pilot-plan.md §3。
// 每张服务卡 = 主入口（服务中心页）+ 小功能直点子入口（全部为已存在的真实路由，
// 见 docs/design/kiosk-ai-os-v3-2026-08/closed-loop-map.md §七 映射表）。
//
// ── 第二段：SERVICE_GROUPS（legacy，当前不渲染） ──
// 自 SvcGrid 时代起即为死数据（closed-loop-map §七 盘点结论），但被
// verify-print-entry-source-split / verify-jobfair-checkin / verify-jobfair-ui /
// verify-jobfair-commercial-closure / verify-job-material-library-ui /
// verify-renshi-policy-ui / verify-home-narrow-visual-balance 等门禁作为
// 合同锚点引用。按「不许删门禁」原则原样保留，物理清理随既立项的
// 死代码清收任务与对应门禁改造一并执行，不在本试点范围内。
import type { KioskIconName } from '../../components/kiosk-icon'

/** V3 首页服务卡的小功能直点子入口（触控 ≥48px 由 home-v3.css 保证）。 */
export interface HomeCardSub {
  label: string
  to: string
}

/** V3 首页服务卡（身份色 + 主入口 + 子入口）。 */
export interface HomeServiceCardDef {
  id: 'print-scan' | 'resume' | 'jobs' | 'fairs' | 'interview' | 'policy'
  /** 服务身份色（vivid.css --cat-*，只用于入口识别，不承载状态语义）。 */
  cat: 'print' | 'resume' | 'job' | 'fair' | 'interview' | 'policy'
  /** ProtoIcon 键名。 */
  icon: string
  title: string
  desc: string
  /** 主入口：对应服务中心页路由。 */
  to: string
  /** lg 双列大卡 / sm 四列紧凑卡。 */
  size: 'lg' | 'sm'
  subs: HomeCardSub[]
}

export const HOME_SERVICE_CARDS: HomeServiceCardDef[] = [
  {
    id: 'print-scan',
    cat: 'print',
    icon: 'group-print',
    title: '打印扫描',
    desc: '上传或扫描原件，本机直接出纸',
    to: '/print-scan',
    size: 'lg',
    subs: [
      { label: '上传打印', to: '/print/upload' },
      { label: '扫描原件', to: '/scan/start' },
      { label: '图片转PDF', to: '/print-scan/convert' },
      { label: '签章', to: '/print-scan/sign' },
    ],
  },
  {
    id: 'resume',
    cat: 'resume',
    icon: 'group-resume',
    title: 'AI简历服务',
    desc: '诊断、优化、生成与导出打印',
    to: '/resume-service',
    size: 'lg',
    subs: [
      { label: '简历诊断', to: '/resume/source?intent=diagnose' },
      { label: '简历生成', to: '/resume/generate' },
      { label: '岗位匹配', to: '/resume/job-fit' },
      { label: '素材模板', to: '/resume/templates' },
      { label: '职业规划', to: '/resume/career-plan' },
    ],
  },
  {
    id: 'jobs',
    cat: 'job',
    icon: 'group-jobs',
    title: '岗位信息',
    desc: '第三方来源岗位，去来源平台投递',
    to: '/jobs-service',
    size: 'sm',
    subs: [
      { label: '岗位列表', to: '/jobs' },
      { label: '找企业', to: '/companies' },
      { label: '线下机构', to: '/offline-agencies' },
    ],
  },
  {
    id: 'fairs',
    cat: 'fair',
    icon: 'group-fairs',
    title: '招聘会',
    desc: '场次信息，去来源平台预约',
    to: '/fairs-service',
    size: 'sm',
    subs: [
      // 「场次列表」不用施工清单里的「本周场次」：列表页展示全部场次，
      // 未按周过滤，按 CLAUDE.md §9 不伪造状态原则改为中性表述。
      { label: '场次列表', to: '/job-fairs' },
      { label: '校园招聘', to: '/campus' },
      { label: '现场签到', to: '/job-fairs/checkin' },
    ],
  },
  {
    id: 'interview',
    cat: 'interview',
    icon: 'group-interview',
    title: 'AI面试训练',
    desc: '模拟练习与训练报告，仅供参考',
    to: '/interview-service',
    size: 'sm',
    subs: [
      { label: '开始练习', to: '/interview/setup' },
      { label: '历史报告', to: '/interview/reports' },
    ],
  },
  {
    id: 'policy',
    cat: 'policy',
    icon: 'group-policy',
    title: '政策服务',
    desc: '官方政策查询与材料指引',
    to: '/policy-service',
    size: 'sm',
    subs: [
      // 施工清单只列「政策库 /renshi」；/renshi 即四 tab 政策库，
      // 按「小功能可直点」目标直接下钻到真实 tab，不新增路由。
      { label: '就业政策', to: '/renshi?tab=policy' },
      { label: '社保指南', to: '/renshi?tab=social' },
      { label: '档案登记', to: '/renshi?tab=register' },
    ],
  },
]

/* ────────────────────────────────────────────────────────────────
 * 以下为 legacy SERVICE_GROUPS（合同锚点，当前不渲染，见文件头说明）
 * ──────────────────────────────────────────────────────────────── */

export interface ServiceTile {
  title: string
  description?: string
  icon: KioskIconName
  to?: string
  state?: Record<string, unknown>
  disabled?: boolean
  emphasis?: 'primary'
}

export type Accent = 'teal' | 'clay' | 'slate' | 'wheat' | 'plum' | 'tool'

export interface ServiceGroup {
  id: string
  title: string
  subtitle: string
  icon: KioskIconName
  accent: Accent
  layout: 'wide' | 'half'
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
    icon: 'doc-check',
    accent: 'teal',
    layout: 'wide',
    span2: true,
    badge: { icon: 'star', label: '推荐先做' },
    tiles: [
      // intent 分流:同一上传链路,按入口语义展示不同标题/说明/引导(视觉与分组结构不变)
      { title: 'AI简历诊断', description: '上传后查看结构与表达建议', icon: 'doc-check', to: '/resume/source?intent=diagnose', emphasis: 'primary' },
      { title: 'AI简历优化', description: '基于目标岗位优化表达', icon: 'sparkle', to: '/resume/source?intent=optimize', emphasis: 'primary' },
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
    layout: 'half',
    tiles: [
      { title: '全职岗位', description: '第三方来源全职信息', icon: 'briefcase', to: '/jobs?category=fulltime' },
      { title: '实习岗位', description: '第三方来源实习信息', icon: 'campus', to: '/jobs?category=intern' },
      { title: '兼职信息', description: '第三方来源兼职信息', icon: 'clock', to: '/jobs?category=parttime' },
      { title: '全部岗位', description: '按分类查看全部来源岗位', icon: 'files', to: '/jobs', emphasis: 'primary' },
      { title: '找企业', description: '查看企业信息与职位来源', icon: 'shield', to: '/companies' },
      // 2026-07-11：按 IA 整合审计 §3⑧ 拍板执行——复用既有「岗位匹配参考」（2D）能力，不新增独立路由/页面。
      { title: '岗位大师', description: '岗位匹配参考与优化方向', icon: 'star', to: '/resume/job-fit' },
    ],
  },
  {
    id: 'job-fairs',
    title: '招聘会',
    subtitle: '查看场次信息，去来源平台预约',
    icon: 'fair',
    accent: 'wheat',
    layout: 'half',
    tiles: [
      { title: '社会招聘会', description: '查看社会招聘会场次', icon: 'pin', to: '/job-fairs', emphasis: 'primary' },
      { title: '校园招聘会', description: '查看校园招聘会安排', icon: 'campus', to: '/campus', emphasis: 'primary' },
      { title: '扫码签到', description: '现场扫码签到指引', icon: 'qr', to: '/job-fairs/checkin' },
    ],
  },
  {
    id: 'print-scan',
    title: '打印扫描',
    subtitle: '上传或扫描，本机直接出纸',
    icon: 'printer',
    accent: 'slate',
    layout: 'wide',
    titleTo: '/print-scan',
    tiles: [
      { title: '文档打印', description: '上传文档后本机打印', icon: 'printer', to: '/print/upload?source=document', emphasis: 'primary' },
      { title: '证件复印', description: '待设备能力开放', icon: 'files', disabled: Boolean(true) },
      { title: '纸质扫描', description: '面板扫描生成 PDF，本机自动接收', icon: 'scan', to: '/scan/start', emphasis: 'primary' },
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
    icon: 'mic',
    accent: 'plum',
    layout: 'half',
    tiles: [
      { title: '模拟面试', description: 'AI 模拟问答练习', icon: 'mic', to: '/interview/setup', emphasis: 'primary' },
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
    icon: 'files',
    accent: 'wheat',
    layout: 'half',
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
