import {
  BookOpenIcon,
  ClipboardListIcon,
  HelpCircleIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  type LucideIcon,
} from 'lucide-react'
import type { PolicyItem } from './shared'

// ── 内置办事指引模板（综合整理自公开政策口径；办理以官方平台为准）────────────────
// 合规：仅信息说明 / 材料清单 / 办理路径 / 官方入口，不代申请、不承诺到账。

export const BUILTIN_GUIDES: PolicyItem[] = [
  {
    id: 'builtin-job-subsidy',
    audiences: ['graduate', 'hardship'],
    tagLabel: '补贴指引',
    tagTone: 'amber',
    title: '一次性求职创业补贴',
    summary: '面向毕业学年内有就业意愿、积极求职且符合困难条件的毕业生，先判断是否符合，再按官方/学校入口准备材料。',
    conditions: ['毕业学年学生或当地政策规定的高校毕业生', '有就业创业意愿，且符合困难家庭、残疾、助学贷款等条件之一', '以学校或官方平台发布的申报周期为准'],
    materials: ['身份证明', '学生身份或毕业信息证明', '困难类型证明材料', '本人银行卡或学校要求的账户信息'],
    steps: ['阅读本地政策口径与申报时间', '按学校或官方平台要求准备材料', '通过官方入口或学校渠道提交', '等待官方审核结果'],
    officialUrl: 'https://gjzwfw.www.gov.cn/col/col1110/',
    sourceName: '综合整理 · 国家政务服务平台口径',
    updatedAt: '2026-06-10',
  },
  {
    id: 'builtin-flexible-social',
    audiences: ['flexible'],
    tagLabel: '补贴指引',
    tagTone: 'amber',
    title: '灵活就业社保补贴',
    summary: '说明灵活就业登记、社保缴纳与补贴申请材料和官方入口，适合自由职业、零工和离校未就业群体查询。',
    conditions: ['已按当地要求完成就业或失业登记', '以灵活就业人员身份缴纳社会保险', '符合毕业年限、就业困难认定或当地补贴对象范围'],
    materials: ['身份证明', '就业 / 失业登记信息', '灵活就业承诺或证明', '社保缴费记录', '本人银行卡'],
    steps: ['先完成就业 / 失业登记', '确认社保缴费记录', '准备并核对材料清单', '扫码进入官方平台申请或查询'],
    officialUrl: 'https://hrss.qingdao.gov.cn/',
    sourceName: '综合整理 · 本地就业创业专区口径',
    updatedAt: '2026-06-06',
  },
  {
    id: 'builtin-housing-talent',
    audiences: ['graduate'],
    tagLabel: '住房安家',
    tagTone: 'amber',
    title: '高校毕业生住房 / 安家政策',
    summary: '聚合住房补贴、安家费、青年人才保障房等常见事项，帮助先判断是否值得进一步查询。',
    conditions: ['学历、毕业年限、就业地与社保缴纳状态符合当地政策', '政策可能按批次、公示与年度预算执行', '最终资格以官方平台审核为准'],
    materials: ['身份证明', '毕业证 / 学位证', '劳动合同或就业证明', '社保缴纳证明', '住房或租赁相关材料（按当地要求）'],
    steps: ['确认所在城市与毕业时间', '查看官方事项说明', '准备学历与就业材料', '扫码进入官方入口办理或查询'],
    officialUrl: 'https://hrsswb.qingdao.gov.cn/qddbbl/pages/gx.html',
    sourceName: '综合整理 · 人才服务入口口径',
    updatedAt: '2026-06-08',
  },
  {
    id: 'builtin-skill-training',
    audiences: ['general'],
    tagLabel: '技能提升',
    tagTone: 'slate',
    title: '职业技能培训 / 技能提升补贴',
    summary: '了解补贴性培训、技能评价证书、申领期限与官方查询入口，适合所有求职者。',
    conditions: ['参加人社部门认可的培训或评价项目', '取得符合政策要求的证书或结果', '在规定期限内通过官方渠道申请'],
    materials: ['身份证明', '培训或评价证明', '职业资格 / 技能等级证书', '社保或就业状态材料（按政策要求）'],
    steps: ['查询本地培训目录', '确认培训机构与补贴标准', '完成培训 / 评价', '通过官方平台申领或查询'],
    officialUrl: 'https://www.12333.gov.cn/job/?channel=12333',
    sourceName: '综合整理 · 人社培训补贴口径',
    updatedAt: '2026-05-26',
  },
  {
    id: 'builtin-startup-loan',
    audiences: ['startup', 'graduate'],
    tagLabel: '创业扶持',
    tagTone: 'amber',
    title: '创业担保贷款 / 创业补贴',
    summary: '适合准备创业或已注册初创主体的用户，查看贷款、一次性创业资助、场租等材料要求。',
    conditions: ['创业主体、注册年限、社保缴纳与吸纳就业情况符合当地政策', '贷款与补贴以官方审批、银行授信和财政资金安排为准', '不得理解为本平台发放补贴或贷款'],
    materials: ['身份证明', '营业执照或创业主体材料', '社保缴费记录', '场地租赁或经营材料', '银行账户信息（按官方要求）'],
    steps: ['确认创业主体与政策类型', '准备经营与社保材料', '扫码进入官方入口', '线下或线上按官方流程提交'],
    officialUrl: 'https://hrss.qingdao.gov.cn/',
    sourceName: '综合整理 · 就业创业补贴清单口径',
    updatedAt: '2026-05-20',
  },
]

// ── 社保指南（内置办事指引）────────────────────────────────────────────────────

export interface SocialGuide {
  key: string
  icon: LucideIcon
  iconBg: string
  iconColor: string
  title: string
  desc: string
  steps: string[]
  entryLabel: string
}

export const SOCIAL_GUIDES: SocialGuide[] = [
  {
    key: 'query',
    icon: ShieldCheckIcon,
    iconBg: 'bg-primary-50',
    iconColor: 'text-primary-600',
    title: '参保信息查询',
    desc: '查询社保参保状态、缴费年限、账户余额',
    steps: ['手机扫码进入官方平台', '实名认证（首次需要）', '选择"参保证明"或"缴费记录"', '在线查看或下载'],
    entryLabel: '扫码查询',
  },
  {
    key: 'proof',
    icon: ClipboardListIcon,
    iconBg: 'bg-success-bg',
    iconColor: 'text-success-fg',
    title: '参保证明打印',
    desc: '打印参保证明、缴纳记录用于贷款、落户等',
    steps: ['携带身份证原件', '前往就业服务大厅 A 区', '3号综合服务窗口提交申请', '当场出具盖章证明'],
    entryLabel: '打印申请材料',
  },
  {
    key: 'medical',
    icon: HelpCircleIcon,
    iconBg: 'bg-info-bg',
    iconColor: 'text-info',
    title: '医保异地就医备案',
    desc: '跨省/跨市就医前需完成备案方可报销',
    steps: ['下载"国家医保服务平台"App', '登录后选择"异地就医备案"', '填写就医地和就诊医院信息', '提交审核（1个工作日内）'],
    entryLabel: '扫码备案',
  },
  {
    key: 'card',
    icon: UserCheckIcon,
    iconBg: 'bg-plum-soft',
    iconColor: 'text-plum',
    title: '社保卡办理/补换',
    desc: '首次申领、挂失补办、换新社保卡',
    steps: ['携带身份证前往合作银行', '填写社保卡申请表', '工作人员采集信息', '15个工作日内领取或邮寄'],
    entryLabel: '打印申请表',
  },
]

// ── 就业登记（内置办事指引）────────────────────────────────────────────────────

export interface RegisterItem {
  key: string
  icon: LucideIcon
  iconBg: string
  iconColor: string
  title: string
  purpose: string
  location: string
  materials: string[]
}

export const REGISTER_ITEMS: RegisterItem[] = [
  {
    key: 'unemployment',
    icon: ScrollTextIcon,
    iconBg: 'bg-error-bg',
    iconColor: 'text-error-fg',
    title: '失业登记',
    purpose: '领取失业保险金、享受就业援助服务的前提',
    location: '户籍所在地（或常住地）就业服务大厅',
    materials: ['居民身份证原件及复印件', '户口本（或居住证）', '解除/终止劳动合同证明', '本人银行卡', '1寸白底证件照 2 张'],
  },
  {
    key: 'employment',
    icon: UserCheckIcon,
    iconBg: 'bg-success-bg',
    iconColor: 'text-success-fg',
    title: '就业创业登记',
    purpose: '享受就业扶持政策、计入社会保障就业档案',
    location: '就业服务大厅综合受理窗口',
    materials: ['居民身份证原件及复印件', '劳动合同（就业）或营业执照（创业）', '1寸证件照 1 张（如变更信息）'],
  },
  {
    key: 'archive',
    icon: BookOpenIcon,
    iconBg: 'bg-warning-bg',
    iconColor: 'text-warning-fg',
    title: '人事档案转移',
    purpose: '档案迁移至新工作单位或人才中心托管',
    location: '人才服务中心档案窗口（需预约）',
    materials: ['居民身份证原件', '接收单位档案接收函（盖章）', '原存档机构出具的档案清单'],
  },
]
