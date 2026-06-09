import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@ai-job-print/ui'
import { useComingSoonNotice } from '../../components/ComingSoonNotice'
import {
  ArrowUpRightIcon,
  BookOpenIcon,
  Building2Icon,
  ChevronRightIcon,
  ClipboardListIcon,
  FileTextIcon,
  GraduationCapIcon,
  HeartHandshakeIcon,
  HelpCircleIcon,
  InfoIcon,
  PrinterIcon,
  QrCodeIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  UsersIcon,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type TabKey = 'policy' | 'social' | 'register' | 'notice'
const VALID_TABS = new Set<TabKey>(['policy', 'social', 'register', 'notice'])

function getInitialTab(searchParams: URLSearchParams): TabKey {
  const tab = searchParams.get('tab')
  return tab && VALID_TABS.has(tab as TabKey) ? (tab as TabKey) : 'policy'
}

// ── Mock data ──────────────────────────────────────────────────────────────────

interface PolicyGroup {
  key: string
  icon: typeof GraduationCapIcon
  iconBg: string
  iconColor: string
  title: string
  tag: string
  items: { label: string; desc: string }[]
}

const POLICY_GROUPS: PolicyGroup[] = [
  {
    key: 'graduate',
    icon: GraduationCapIcon,
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    title: '应届高校毕业生',
    tag: '重点群体',
    items: [
      { label: '高校毕业生就业补贴', desc: '毕业年度内灵活就业或自主创业，可申请就业补贴，标准 2000 元/人' },
      { label: '离校未就业登记服务', desc: '毕业半年内未就业可在户籍地或居住地办理实名登记，享受就业援助' },
      { label: '创业担保贷款', desc: '在校及毕业5年内大学生，可申请最高 20 万元创业担保贷款，财政全额贴息' },
    ],
  },
  {
    key: 'migrant',
    icon: UsersIcon,
    iconBg: 'bg-green-50',
    iconColor: 'text-green-600',
    title: '返乡务工人员',
    tag: '农村劳动力',
    items: [
      { label: '返乡创业补贴', desc: '返乡创业并正常经营1年以上，可申请一次性补贴 5000—20000 元' },
      { label: '职业技能培训补贴', desc: '参加政府补贴培训取得证书，报销培训费用，按证书等级不同最高 2000 元' },
      { label: '异地就业交通补贴', desc: '跨省务工农村劳动力，可申请一次性交通补贴，标准 500 元/人' },
    ],
  },
  {
    key: 'hardship',
    icon: HeartHandshakeIcon,
    iconBg: 'bg-orange-50',
    iconColor: 'text-orange-600',
    title: '困难群体就业援助',
    tag: '优先保障',
    items: [
      { label: '公益性岗位安置', desc: '就业困难人员（含零就业家庭、低保家庭等）可申请公益性岗位安置，优先安排' },
      { label: '灵活就业社保补贴', desc: '就业困难人员灵活就业后，可享受3年内社保补贴，比例最高 2/3' },
      { label: '岗位拓展援助', desc: '登记失业超过3个月可获专属就业援助专员一对一跟踪帮扶服务' },
    ],
  },
  {
    key: 'startup',
    icon: Building2Icon,
    iconBg: 'bg-purple-50',
    iconColor: 'text-purple-600',
    title: '创业扶持',
    tag: '创业支持',
    items: [
      { label: '创业场地补贴', desc: '在认定创业孵化基地内创业，可享受1—3年租金减免，最高减免50%' },
      { label: '创业导师服务', desc: '免费配对创业导师，提供注册、融资、运营等全链条辅导，每年不少于4次' },
      { label: '创业带动就业奖励', desc: '创业项目稳定带动就业满1年，按实际带动人数给予1000 元/人奖励' },
    ],
  },
]

interface SocialGuide {
  key: string
  icon: typeof ShieldCheckIcon
  iconBg: string
  iconColor: string
  title: string
  desc: string
  steps: string[]
  entryLabel: string
}

const SOCIAL_GUIDES: SocialGuide[] = [
  {
    key: 'query',
    icon: ShieldCheckIcon,
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    title: '参保信息查询',
    desc: '查询社保参保状态、缴费年限、账户余额',
    steps: ['手机扫码进入官方平台', '实名认证（首次需要）', '选择"参保证明"或"缴费记录"', '在线查看或下载'],
    entryLabel: '扫码查询',
  },
  {
    key: 'proof',
    icon: ClipboardListIcon,
    iconBg: 'bg-green-50',
    iconColor: 'text-green-600',
    title: '参保证明打印',
    desc: '打印参保证明、缴纳记录用于贷款、落户等',
    steps: ['携带身份证原件', '前往就业服务大厅 A 区', '3号综合服务窗口提交申请', '当场出具盖章证明'],
    entryLabel: '打印申请材料',
  },
  {
    key: 'medical',
    icon: HelpCircleIcon,
    iconBg: 'bg-cyan-50',
    iconColor: 'text-cyan-600',
    title: '医保异地就医备案',
    desc: '跨省/跨市就医前需完成备案方可报销',
    steps: ['下载"国家医保服务平台"App', '登录后选择"异地就医备案"', '填写就医地和就诊医院信息', '提交审核（1个工作日内）'],
    entryLabel: '扫码备案',
  },
  {
    key: 'card',
    icon: UserCheckIcon,
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
    title: '社保卡办理/补换',
    desc: '首次申领、挂失补办、换新社保卡',
    steps: ['携带身份证前往合作银行', '填写社保卡申请表', '工作人员采集信息', '15个工作日内领取或邮寄'],
    entryLabel: '打印申请表',
  },
]

interface RegisterItem {
  key: string
  icon: typeof FileTextIcon
  iconBg: string
  iconColor: string
  title: string
  purpose: string
  location: string
  materials: string[]
}

const REGISTER_ITEMS: RegisterItem[] = [
  {
    key: 'unemployment',
    icon: ScrollTextIcon,
    iconBg: 'bg-red-50',
    iconColor: 'text-red-600',
    title: '失业登记',
    purpose: '领取失业保险金、享受就业援助服务的前提',
    location: '户籍所在地（或常住地）就业服务大厅',
    materials: ['居民身份证原件及复印件', '户口本（或居住证）', '解除/终止劳动合同证明', '本人银行卡', '1寸白底证件照 2 张'],
  },
  {
    key: 'employment',
    icon: UserCheckIcon,
    iconBg: 'bg-green-50',
    iconColor: 'text-green-600',
    title: '就业创业登记',
    purpose: '享受就业扶持政策、计入社会保障就业档案',
    location: '就业服务大厅综合受理窗口',
    materials: ['居民身份证原件及复印件', '劳动合同（就业）或营业执照（创业）', '1寸证件照 1 张（如变更信息）'],
  },
  {
    key: 'archive',
    icon: BookOpenIcon,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    title: '人事档案转移',
    purpose: '档案迁移至新工作单位或人才中心托管',
    location: '人才服务中心档案窗口（需预约）',
    materials: ['居民身份证原件', '接收单位档案接收函（盖章）', '原存档机构出具的档案清单'],
  },
]

interface Notice {
  id: string
  title: string
  date: string
  source: string
  tag: '政策' | '公告' | '通知' | '招募'
  tagColor: string
}

const NOTICES: Notice[] = [
  {
    id: 'n1',
    title: '关于 2026 年高校毕业生就业创业补贴申请工作的通知',
    date: '2026-05-20',
    source: '市人力资源和社会保障局',
    tag: '通知',
    tagColor: 'bg-blue-100 text-blue-700',
  },
  {
    id: 'n2',
    title: '2026 年第二批职业技能提升培训补贴发放公告',
    date: '2026-05-15',
    source: '市就业服务中心',
    tag: '公告',
    tagColor: 'bg-green-100 text-green-700',
  },
  {
    id: 'n3',
    title: '返乡创业担保贷款贴息申请截止日期提醒（2026年上半年）',
    date: '2026-05-10',
    source: '市人力资源和社会保障局',
    tag: '政策',
    tagColor: 'bg-purple-100 text-purple-700',
  },
  {
    id: 'n4',
    title: '2026 年第二季度公益性岗位开发招募公告',
    date: '2026-04-28',
    source: '市就业服务中心',
    tag: '招募',
    tagColor: 'bg-orange-100 text-orange-700',
  },
  {
    id: 'n5',
    title: '困难群体灵活就业社会保险补贴申请指南（2026 年修订版）',
    date: '2026-04-15',
    source: '市人力资源和社会保障局',
    tag: '政策',
    tagColor: 'bg-purple-100 text-purple-700',
  },
  {
    id: 'n6',
    title: '关于开展农村劳动力转移就业春风行动暨专项招聘会的通知',
    date: '2026-04-01',
    source: '市人力资源和社会保障局',
    tag: '通知',
    tagColor: 'bg-blue-100 text-blue-700',
  },
]

// ── Sub-components ─────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  const tabs: { key: TabKey; label: string; icon: typeof FileTextIcon }[] = [
    { key: 'policy',   label: '就业政策', icon: FileTextIcon },
    { key: 'social',   label: '社保指南', icon: ShieldCheckIcon },
    { key: 'register', label: '就业登记', icon: ClipboardListIcon },
    { key: 'notice',   label: '政策公告', icon: ScrollTextIcon },
  ]

  return (
    <div className="flex gap-2 rounded-xl border border-gray-200 bg-white p-1.5 shadow-sm">
      {tabs.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={[
            'flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-base font-medium transition-colors',
            active === key
              ? 'bg-primary-600 text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-100',
          ].join(' ')}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  )
}

// ─── 招聘服务入口卡（招聘会 / 校园招聘会）──────────────────────────────────────

function ZoneEntryCard({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  subtitle,
  onClick,
}: {
  icon: typeof Building2Icon
  iconBg: string
  iconColor: string
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[88px] items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-primary-200 hover:bg-primary-50/40 active:bg-primary-100"
    >
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
        <Icon className={`h-6 w-6 ${iconColor}`} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-gray-900">{title}</p>
        <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
      </div>
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-300" aria-hidden="true" />
    </button>
  )
}

// ─── Panel: 就业政策 ─────────────────────────────────────────────────────────

function PolicyPanel() {
  const [expanded, setExpanded] = useState<string | null>('graduate')
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-xs text-gray-400">
        <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
        数据来源：市人力资源和社会保障局 · 同步时间：2026-05-20
      </p>

      {POLICY_GROUPS.map((group) => {
        const Icon = group.icon
        const isOpen = expanded === group.key
        return (
          <div key={group.key} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            {/* Group header */}
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : group.key)}
              className="flex w-full items-center gap-4 px-6 py-5 text-left"
            >
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${group.iconBg}`}>
                <Icon className={`h-6 w-6 ${group.iconColor}`} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold text-gray-900">{group.title}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    {group.tag}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-gray-500">{group.items.length} 项政策支持</p>
              </div>
              <ChevronRightIcon
                className={['h-5 w-5 text-gray-400 transition-transform', isOpen ? 'rotate-90' : ''].join(' ')}
                aria-hidden="true"
              />
            </button>

            {/* Items */}
            {isOpen && (
              <div className="border-t border-gray-100">
                {group.items.map((item, i) => (
                  <div
                    key={i}
                    className={[
                      'flex items-start gap-4 px-6 py-4',
                      i < group.items.length - 1 ? 'border-b border-gray-50' : '',
                    ].join(' ')}
                  >
                    <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold text-gray-800">{item.label}</p>
                      <p className="mt-1 text-sm leading-relaxed text-gray-500">{item.desc}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/print/upload')}
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
                    >
                      <PrinterIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      打印
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Panel: 社保指南 ─────────────────────────────────────────────────────────

function SocialPanel({ onComingSoon }: { onComingSoon: (action: string) => void }) {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-xs text-gray-400">
        <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
        数据来源：国家社会保险公共服务平台 · 同步时间：2026-05-18
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {SOCIAL_GUIDES.map((guide) => {
          const Icon = guide.icon
          return (
            <div key={guide.key} className="flex flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-start gap-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${guide.iconBg}`}>
                  <Icon className={`h-6 w-6 ${guide.iconColor}`} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold text-gray-900">{guide.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-gray-500">{guide.desc}</p>
                </div>
              </div>

              {/* Steps */}
              <ol className="mt-5 flex flex-col gap-2">
                {guide.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-bold text-primary-600">
                      {i + 1}
                    </span>
                    <span className="text-sm text-gray-600">{step}</span>
                  </li>
                ))}
              </ol>

              {/* Action */}
              <div className="mt-5 flex gap-2.5">
                {guide.entryLabel.includes('扫码') ? (
                  <button
                    type="button"
                    onClick={() => onComingSoon(guide.entryLabel)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-primary-200 bg-primary-50 py-3 text-sm font-semibold text-primary-700 hover:bg-primary-100"
                  >
                    <QrCodeIcon className="h-4 w-4" aria-hidden="true" />
                    {guide.entryLabel}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => navigate('/print/upload')}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-gray-50 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-100"
                  >
                    <PrinterIcon className="h-4 w-4" aria-hidden="true" />
                    {guide.entryLabel}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Panel: 就业登记 ─────────────────────────────────────────────────────────

function RegisterPanel({ onComingSoon }: { onComingSoon: (action: string) => void }) {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-xs text-gray-400">
        <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
        数据来源：市就业服务中心 · 同步时间：2026-05-10
      </p>

      {REGISTER_ITEMS.map((item) => {
        const Icon = item.icon
        return (
          <div key={item.key} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${item.iconBg}`}>
                <Icon className={`h-6 w-6 ${item.iconColor}`} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold text-gray-900">{item.title}</p>
                <p className="mt-1 text-sm text-gray-500">{item.purpose}</p>
              </div>
            </div>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              {/* Location */}
              <div className="rounded-lg bg-gray-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">办理地点</p>
                <p className="mt-1.5 text-sm font-medium text-gray-700">{item.location}</p>
              </div>

              {/* Materials */}
              <div className="rounded-lg bg-gray-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">所需材料</p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {item.materials.map((m, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <ChevronRightIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={() => navigate('/print/upload')}
                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                <PrinterIcon className="h-4 w-4" aria-hidden="true" />
                打印材料清单
              </button>
              <button
                type="button"
                onClick={() => onComingSoon('扫码预约')}
                className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-3 text-sm font-medium text-primary-700 hover:bg-primary-100"
              >
                <QrCodeIcon className="h-4 w-4" aria-hidden="true" />
                扫码预约
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Panel: 政策公告 ─────────────────────────────────────────────────────────

function NoticePanel({ onComingSoon }: { onComingSoon: (action: string) => void }) {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-xs text-gray-400">
        <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
        数据来源：市人力资源和社会保障局官方发布 · 同步时间：2026-05-20
      </p>

      {NOTICES.map((notice) => (
        <div
          key={notice.id}
          className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white px-6 py-5 shadow-sm"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-50">
            <FileTextIcon className="h-5 w-5 text-gray-500" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${notice.tagColor}`}>
                {notice.tag}
              </span>
              <span className="text-xs text-gray-400">{notice.source}</span>
            </div>
            <p className="mt-1.5 text-base font-medium leading-snug text-gray-800">{notice.title}</p>
            <p className="mt-1 text-xs text-gray-400">发布时间：{notice.date}</p>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <button
              type="button"
              onClick={() => onComingSoon('查看详情')}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              查看详情
              <ArrowUpRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => navigate('/print/upload')}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              <PrinterIcon className="h-3.5 w-3.5" aria-hidden="true" />
              打印
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Print pack ───────────────────────────────────────────────────────────────

function PrintPackBanner() {
  const navigate = useNavigate()
  const packs = [
    { label: '失业登记申请表', pages: '1页', icon: ScrollTextIcon },
    { label: '就业登记申请表', pages: '1页', icon: UserCheckIcon },
    { label: '社保查询操作指引', pages: '2页', icon: ShieldCheckIcon },
    { label: '创业担保贷款材料清单', pages: '1页', icon: ClipboardListIcon },
  ]

  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50 px-6 py-5">
      <div className="mb-4 flex items-center gap-2">
        <PrinterIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
        <span className="text-sm font-semibold text-primary-800">常用材料打印包</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {packs.map(({ label, pages, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => navigate('/print/upload')}
            className="flex flex-col items-center gap-2 rounded-lg border border-primary-100 bg-white px-3 py-4 text-center hover:bg-primary-50 active:bg-primary-100"
          >
            <Icon className="h-5 w-5 text-primary-600" aria-hidden="true" />
            <span className="text-sm font-medium leading-snug text-gray-800">{label}</span>
            <span className="text-xs text-gray-400">{pages}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function RenshiPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<TabKey>(() => getInitialTab(searchParams))
  const { notify, overlay } = useComingSoonNotice()

  // 同一路由内 search params 变化时同步首页深链 Tab，非法值回退「就业政策」。
  useEffect(() => {
    setActiveTab(getInitialTab(searchParams))
  }, [searchParams])

  return (
    <div className="flex flex-col gap-6 p-6">
      {overlay}
      <PageHeader
        title="人社专区"
        subtitle="招聘会 · 校园招聘 · 就业政策 · 社保指南 · 政策公告"
      />

      {/* 招聘服务入口（固定收纳于人社专区，不再单独漂在首页） */}
      <div className="grid grid-cols-2 gap-4">
        <ZoneEntryCard
          icon={Building2Icon}
          iconBg="bg-orange-50"
          iconColor="text-orange-600"
          title="招聘会"
          subtitle="现场招聘会信息 · 状态 · 导览"
          onClick={() => navigate('/job-fairs')}
        />
        <ZoneEntryCard
          icon={GraduationCapIcon}
          iconBg="bg-cyan-50"
          iconColor="text-cyan-700"
          title="校园招聘会"
          subtitle="应届校招 · 校园双选会 · 材料"
          onClick={() => navigate('/campus')}
        />
      </div>

      {/* Source attribution banner */}
      <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-5 py-3.5">
        <ShieldCheckIcon className="h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
        <p className="text-sm text-blue-700">
          本专区信息来源于市人力资源和社会保障局及国家相关平台，仅作展示说明，
          具体政策以官方发布为准。
        </p>
      </div>

      {/* Tab navigation */}
      <TabBar active={activeTab} onChange={setActiveTab} />

      {/* Tab panels */}
      {activeTab === 'policy'   && <PolicyPanel />}
      {activeTab === 'social'   && <SocialPanel onComingSoon={notify} />}
      {activeTab === 'register' && <RegisterPanel onComingSoon={notify} />}
      {activeTab === 'notice'   && <NoticePanel onComingSoon={notify} />}

      {/* Print pack always visible at bottom */}
      <PrintPackBanner />

      {/* Compliance footer */}
      <p className="pb-2 text-center text-xs text-gray-400">
        所有岗位信息来源于第三方平台，本终端不直接代理投递或收取简历。
        如需办理具体业务，请前往对应窗口或扫码访问官方平台。
      </p>
    </div>
  )
}
