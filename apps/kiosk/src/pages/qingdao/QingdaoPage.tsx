import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@ai-job-print/ui'
import {
  ArrowUpRightIcon,
  BookOpenIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarIcon,
  ChevronRightIcon,
  FileTextIcon,
  GraduationCapIcon,
  InfoIcon,
  MapPinIcon,
  NewspaperIcon,
  PrinterIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  UsersIcon,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type TabKey = 'employment' | 'policy' | 'university' | 'park' | 'news'

// ── Mock data: 青岛就业 ────────────────────────────────────────────────────────

interface LocalJobFair {
  id: string
  title: string
  date: string
  venue: string
  city: string
  companyCount: number
  jobCount: number
  source: string
  sourceUrl: string
}

const LOCAL_FAIRS: LocalJobFair[] = [
  {
    id: 'lf1',
    title: '2026 青岛市春季大型综合招聘会',
    date: '2026-06-15',
    venue: '青岛国际博览中心 1 号馆',
    city: '青岛',
    companyCount: 320,
    jobCount: 6800,
    source: '青岛市人力资源和社会保障局',
    sourceUrl: '#',
  },
  {
    id: 'lf2',
    title: '崂山区 2026 年第二季度专场招聘会',
    date: '2026-06-20',
    venue: '崂山区人力资源服务中心',
    city: '青岛·崂山区',
    companyCount: 85,
    jobCount: 1200,
    source: '崂山区就业服务中心',
    sourceUrl: '#',
  },
  {
    id: 'lf3',
    title: '高新区智能制造专场双选会',
    date: '2026-06-28',
    venue: '青岛高新区创业中心报告厅',
    city: '青岛·城阳区',
    companyCount: 60,
    jobCount: 900,
    source: '青岛高新技术产业开发区管委会',
    sourceUrl: '#',
  },
]

interface KeyCompany {
  id: string
  name: string
  industry: string
  openPositions: number
  city: string
  source: string
  sourceUrl: string
}

const KEY_COMPANIES: KeyCompany[] = [
  { id: 'c1', name: '海尔集团',     industry: '智慧家电 / 物联网', openPositions: 142, city: '青岛', source: '智联招聘',   sourceUrl: '#' },
  { id: 'c2', name: '海信集团',     industry: '电子信息 / 智慧城市', openPositions: 98,  city: '青岛', source: '前程无忧',   sourceUrl: '#' },
  { id: 'c3', name: '青岛啤酒',     industry: '食品饮料 / 制造业',  openPositions: 37,  city: '青岛', source: '青岛市人社局', sourceUrl: '#' },
  { id: 'c4', name: '百洋医药',     industry: '医药健康 / 零售',    openPositions: 54,  city: '青岛', source: '猎聘网',     sourceUrl: '#' },
  { id: 'c5', name: '中车青岛四方', industry: '轨道交通 / 制造',    openPositions: 76,  city: '青岛', source: '前程无忧',   sourceUrl: '#' },
]

// ── Mock data: 青岛政策 ────────────────────────────────────────────────────────

interface PolicyItem {
  key: string
  category: '就业补贴' | '人才政策' | '社保档案'
  icon: typeof BriefcaseIcon
  iconBg: string
  iconColor: string
  title: string
  tag: string
  tagColor: string
  items: { label: string; desc: string }[]
}

const QINGDAO_POLICIES: PolicyItem[] = [
  {
    key: 'subsidy',
    category: '就业补贴',
    icon: UsersIcon,
    iconBg: 'bg-blue-50', iconColor: 'text-blue-600',
    title: '就业补贴政策',
    tag: '应届生/困难群体',
    tagColor: 'bg-blue-100 text-blue-700',
    items: [
      { label: '高校毕业生就业补贴', desc: '毕业年度内在青就业并签订1年以上劳动合同，可申请一次性就业补贴2000元/人' },
      { label: '灵活就业社保补贴', desc: '就业困难人员灵活就业后，可享受社保补贴，补贴比例最高2/3，最长3年' },
      { label: '见习补贴', desc: '参加青岛市就业见习基地见习的高校毕业生，按当地最低工资标准给予见习补贴' },
    ],
  },
  {
    key: 'talent',
    category: '人才政策',
    icon: GraduationCapIcon,
    iconBg: 'bg-purple-50', iconColor: 'text-purple-600',
    title: '人才引进与落户政策',
    tag: '人才引进',
    tagColor: 'bg-purple-100 text-purple-700',
    items: [
      { label: '"青岛英才"计划', desc: '全球顶尖人才、国家级重点人才，可申请最高500万元安家补贴和科研经费' },
      { label: '全日制本科落户', desc: '全日制本科及以上学历，35周岁以下，可在青岛先落户后就业' },
      { label: '高层次人才住房补贴', desc: '引进高层次人才可享租房补贴（博士后6000元/月，博士3000元/月，硕士1500元/月）' },
    ],
  },
  {
    key: 'social',
    category: '社保档案',
    icon: ShieldCheckIcon,
    iconBg: 'bg-green-50', iconColor: 'text-green-600',
    title: '社保·档案·落户服务',
    tag: '民生服务',
    tagColor: 'bg-green-100 text-green-700',
    items: [
      { label: '人事档案托管', desc: '非国有单位就业人员，可将档案委托至青岛市人才市场托管，免收托管费用' },
      { label: '社保关系转移', desc: '跨统筹区就业时，持社保转移接续凭证，前往参保地社保经办机构办理转移' },
      { label: '积分制落户申请', desc: '符合条件的来青务工人员，可通过积分制申请青岛户籍，分值达到60分即可申请' },
    ],
  },
]

// ── Mock data: 青岛高校 ────────────────────────────────────────────────────────

interface UniversityItem {
  id: string
  name: string
  type: string
  specialty: string
  website: string
  careerOffice: string
  upcomingEvents: number
}

const UNIVERSITIES: UniversityItem[] = [
  { id: 'u1', name: '中国海洋大学',     type: '双一流 / 985',  specialty: '海洋 / 水产 / 信息技术', website: 'career.ouc.edu.cn',    careerOffice: '就业指导处',   upcomingEvents: 3 },
  { id: 'u2', name: '青岛大学',         type: '省属重点',      specialty: '医学 / 纺织 / 理工',      website: 'career.qdu.edu.cn',    careerOffice: '毕业生就业处', upcomingEvents: 2 },
  { id: 'u3', name: '中国石油大学（华东）', type: '双一流 / 211',  specialty: '石油 / 地质 / 工程',  website: 'career.upc.edu.cn',    careerOffice: '就业指导中心', upcomingEvents: 4 },
  { id: 'u4', name: '青岛科技大学',     type: '省属',          specialty: '化工 / 材料 / 机械',      website: 'career.qust.edu.cn',   careerOffice: '学生就业服务中心', upcomingEvents: 1 },
  { id: 'u5', name: '青岛理工大学',     type: '省属',          specialty: '建工 / 环境 / 计算机',    website: 'career.qtech.edu.cn',  careerOffice: '就业指导处',   upcomingEvents: 2 },
  { id: 'u6', name: '山东科技大学',     type: '省属',          specialty: '矿业 / 地测 / 信息工程',  website: 'career.sdust.edu.cn',  careerOffice: '毕业生就业办', upcomingEvents: 1 },
]

// ── Mock data: 青岛园区 ────────────────────────────────────────────────────────

interface ParkItem {
  id: string
  name: string
  zone: string
  focus: string
  companies: number
  openPositions: number
  highlight: string
  source: string
}

const PARKS: ParkItem[] = [
  {
    id: 'p1',
    name: '青岛高新技术产业开发区',
    zone: '城阳区',
    focus: '智能制造 · 生物医药 · 软件与信息服务',
    companies: 3200,
    openPositions: 4500,
    highlight: '国家级高新区，世界 500 强投资企业超 60 家',
    source: '青岛高新区管委会',
  },
  {
    id: 'p2',
    name: '崂山软件产业基地',
    zone: '崂山区',
    focus: '软件开发 · 大数据 · 人工智能',
    companies: 820,
    openPositions: 1800,
    highlight: '国家软件产业基地，青岛数字经济核心承载区',
    source: '崂山区科技和工业信息化局',
  },
  {
    id: 'p3',
    name: '西海岸新区（国家级）',
    zone: '黄岛区',
    focus: '航运物流 · 新能源 · 海洋经济',
    companies: 5600,
    openPositions: 9200,
    highlight: '国家级新区，2025年度引进重点项目超200个',
    source: '西海岸新区管委会',
  },
  {
    id: 'p4',
    name: '蓝谷高新区',
    zone: '即墨区',
    focus: '海洋科技 · 新材料 · 智能装备',
    companies: 420,
    openPositions: 780,
    highlight: '海洋科技创新高地，依托中科院海洋研究所',
    source: '即墨区人力资源和社会保障局',
  },
]

// ── Mock data: 青岛资讯 ────────────────────────────────────────────────────────

interface NewsItem {
  id: string
  title: string
  date: string
  source: string
  tag: '政策' | '公告' | '资讯' | '活动' | '通知'
  tagColor: string
  excerpt: string
}

const NEWS_ITEMS: NewsItem[] = [
  {
    id: 'news1',
    title: '青岛市 2026 年第二季度重点产业人才需求发布',
    date: '2026-05-28',
    source: '青岛市人力资源和社会保障局',
    tag: '资讯',
    tagColor: 'bg-blue-100 text-blue-700',
    excerpt: '本季度制造业、软件服务业、海洋经济三大领域人才需求量同比上升 18%，高端技术类岗位缺口明显。',
  },
  {
    id: 'news2',
    title: '关于开展 2026 年"青春筑梦"高校毕业生就业专项行动的通知',
    date: '2026-05-22',
    source: '青岛市就业服务中心',
    tag: '通知',
    tagColor: 'bg-purple-100 text-purple-700',
    excerpt: '专项行动涵盖就业援助、政策宣讲、招聘对接三项内容，覆盖全市 15 所高校，6 月起正式启动。',
  },
  {
    id: 'news3',
    title: '2026 年青岛市人才政策"黄金 30 条"正式发布',
    date: '2026-05-18',
    source: '青岛市委组织部',
    tag: '政策',
    tagColor: 'bg-green-100 text-green-700',
    excerpt: '新版人才政策提升安家补贴、研发奖励、住房保障力度，并新增创业失败容错机制及配偶就业协助服务。',
  },
  {
    id: 'news4',
    title: '青岛西海岸新区 2026 年"百企万岗"引才活动启动',
    date: '2026-05-14',
    source: '西海岸新区管委会',
    tag: '活动',
    tagColor: 'bg-orange-100 text-orange-700',
    excerpt: '活动面向应届毕业生和社会技能人才，100 余家园区企业共提供超过 10000 个优质岗位，可在线预约面谈。',
  },
  {
    id: 'news5',
    title: '青岛市职业技能提升培训补贴申请指南（2026 版）',
    date: '2026-05-08',
    source: '青岛市人力资源和社会保障局',
    tag: '政策',
    tagColor: 'bg-green-100 text-green-700',
    excerpt: '参加政府补贴目录内培训的劳动者，培训结束取得资格证书后可申请最高 3000 元培训补贴。',
  },
  {
    id: 'news6',
    title: '崂山区 2026 年"智慧招聘月"活动安排公告',
    date: '2026-04-30',
    source: '崂山区就业服务中心',
    tag: '公告',
    tagColor: 'bg-gray-100 text-gray-700',
    excerpt: '六月全月每周五下午 13:30—17:00 在崂山人力资源大厦举办专场招聘，涵盖软件、金融、生物医疗三类岗位。',
  },
]

// ── Sub-components ─────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  const tabs: { key: TabKey; label: string; icon: typeof BriefcaseIcon }[] = [
    { key: 'employment', label: '青岛就业', icon: BriefcaseIcon },
    { key: 'policy',     label: '青岛政策', icon: FileTextIcon },
    { key: 'university', label: '青岛高校', icon: GraduationCapIcon },
    { key: 'park',       label: '青岛园区', icon: Building2Icon },
    { key: 'news',       label: '青岛资讯', icon: NewspaperIcon },
  ]

  return (
    <div className="flex gap-1.5 rounded-xl border border-gray-200 bg-white p-1.5 shadow-sm">
      {tabs.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={[
            'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-3.5 text-sm font-medium transition-colors',
            active === key
              ? 'bg-teal-600 text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-100',
          ].join(' ')}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">{label}</span>
          <span className="sm:hidden">{label.replace('青岛', '')}</span>
        </button>
      ))}
    </div>
  )
}

// ─── Panel: 青岛就业 ──────────────────────────────────────────────────────────

function EmploymentPanel() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-6">
      <p className="flex items-center gap-2 text-xs text-gray-400">
        <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
        岗位与招聘会信息来源于合作机构及官方平台，本系统不参与招聘闭环。同步时间：2026-05-28
      </p>

      {/* 近期招聘会 */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <CalendarIcon className="h-5 w-5 text-teal-600" aria-hidden="true" />
          <h3 className="text-base font-semibold text-gray-800">近期招聘会</h3>
        </div>
        <div className="flex flex-col gap-3">
          {LOCAL_FAIRS.map((fair) => (
            <div key={fair.id} className="rounded-xl border border-gray-200 bg-white px-6 py-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold leading-snug text-gray-900">{fair.title}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <CalendarIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      {fair.date}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPinIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      {fair.venue}
                    </span>
                    <span>{fair.companyCount} 家企业 · {fair.jobCount.toLocaleString()} 个岗位</span>
                  </div>
                  <p className="mt-1.5 text-xs text-gray-400">来源：{fair.source}</p>
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => navigate('/job-fairs')}
                    className="flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-medium text-teal-700 hover:bg-teal-100"
                  >
                    查看招聘会
                    <ChevronRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
                  >
                    <QrCodeIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    扫码预约
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 重点企业岗位 */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <BriefcaseIcon className="h-5 w-5 text-teal-600" aria-hidden="true" />
          <h3 className="text-base font-semibold text-gray-800">重点企业岗位</h3>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {KEY_COMPANIES.map((co) => (
            <div key={co.id} className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-base font-bold text-teal-700">
                {co.name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-gray-900">{co.name}</p>
                <p className="mt-0.5 text-xs text-gray-500">{co.industry}</p>
                <p className="mt-0.5 text-xs text-teal-600">在招岗位 {co.openPositions} 个 · 来源：{co.source}</p>
              </div>
              <div className="flex shrink-0 flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => navigate('/jobs')}
                  className="flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-700 hover:bg-teal-100"
                >
                  查看岗位
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100"
                >
                  <ArrowUpRightIcon className="h-3 w-3" aria-hidden="true" />
                  去来源平台投递
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 校园招聘专区 */}
      <div className="rounded-xl border border-teal-200 bg-teal-50 px-6 py-5">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-100">
            <GraduationCapIcon className="h-6 w-6 text-teal-600" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-gray-900">应届毕业生专属通道</p>
            <p className="mt-0.5 text-sm text-gray-600">校园招聘岗位、见习基地、毕业生就业服务一站汇聚</p>
          </div>
          <button
            type="button"
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-teal-300 bg-white px-4 py-3 text-sm font-semibold text-teal-700 hover:bg-teal-50"
          >
            查看详情
            <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Panel: 青岛政策 ──────────────────────────────────────────────────────────

function PolicyPanel() {
  const [expanded, setExpanded] = useState<string | null>('subsidy')
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-xs text-gray-400">
        <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
        来源：青岛市人力资源和社会保障局 · 市委组织部 · 同步时间：2026-05-22
      </p>

      {QINGDAO_POLICIES.map((group) => {
        const Icon = group.icon
        const isOpen = expanded === group.key
        return (
          <div key={group.key} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : group.key)}
              className="flex w-full items-center gap-4 px-6 py-5 text-left"
            >
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${group.iconBg}`}>
                <Icon className={`h-6 w-6 ${group.iconColor}`} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold text-gray-900">{group.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${group.tagColor}`}>
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
                    <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-400" />
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

// ─── Panel: 青岛高校 ──────────────────────────────────────────────────────────

function UniversityPanel() {
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-xs text-gray-400">
        <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
        信息来源于各高校就业服务中心官方发布，本系统仅作入口展示。同步时间：2026-05-25
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {UNIVERSITIES.map((univ) => (
          <div key={univ.id} className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-base font-bold text-teal-700">
                {univ.name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-gray-900">{univ.name}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{univ.type}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-1.5">
              <p className="text-xs text-gray-500">
                <span className="font-medium text-gray-700">优势学科：</span>{univ.specialty}
              </p>
              <p className="text-xs text-gray-500">
                <span className="font-medium text-gray-700">就业服务：</span>{univ.careerOffice}
              </p>
              <p className="text-xs text-gray-500">
                <span className="font-medium text-gray-700">近期活动：</span>
                <span className="text-teal-600">{univ.upcomingEvents} 场校招</span>
              </p>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 py-2.5 text-sm font-medium text-teal-700 hover:bg-teal-100"
              >
                <QrCodeIcon className="h-4 w-4" aria-hidden="true" />
                扫码进入官网
              </button>
              <button
                type="button"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                查看校招活动
                <ChevronRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 毕业生服务提示 */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
        <div className="flex items-start gap-3">
          <BookOpenIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-amber-800">毕业生服务提示</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-700">
              档案、学位证、就业协议等材料可在本终端扫描存档并打印。有疑问可咨询 AI 助手或前往各高校就业服务大厅。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Panel: 青岛园区 ──────────────────────────────────────────────────────────

function ParkPanel() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-xs text-gray-400">
        <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
        园区信息来源于各管委会官方发布，岗位数据来源于合作招聘平台。同步时间：2026-05-26
      </p>

      {PARKS.map((park) => (
        <div key={park.id} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-50">
              <Building2Icon className="h-6 w-6 text-teal-600" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold text-gray-900">{park.name}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-gray-500">
                <MapPinIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {park.zone}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg bg-gray-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">重点产业</p>
              <p className="mt-1.5 text-sm text-gray-700">{park.focus}</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">园区企业</p>
              <p className="mt-1.5 text-sm font-semibold text-gray-800">{park.companies.toLocaleString()} 家</p>
            </div>
            <div className="rounded-lg bg-teal-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-600">在招岗位</p>
              <p className="mt-1.5 text-sm font-semibold text-teal-700">{park.openPositions.toLocaleString()} 个</p>
            </div>
          </div>

          <p className="mt-3 text-xs text-gray-500">{park.highlight}</p>
          <p className="mt-0.5 text-xs text-gray-400">信息来源：{park.source}</p>

          <div className="mt-4 flex gap-2.5">
            <button
              type="button"
              onClick={() => navigate('/jobs')}
              className="flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-700 hover:bg-teal-100"
            >
              查看岗位
              <ChevronRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              <QrCodeIcon className="h-3.5 w-3.5" aria-hidden="true" />
              查看来源
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Panel: 青岛资讯 ──────────────────────────────────────────────────────────

function NewsPanel() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-xs text-gray-400">
        <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
        来源：市人力资源和社会保障局 / 各区市官方渠道 · 同步时间：2026-05-28
      </p>

      {NEWS_ITEMS.map((news) => (
        <div
          key={news.id}
          className="rounded-xl border border-gray-200 bg-white px-6 py-5 shadow-sm"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-50">
              <NewspaperIcon className="h-5 w-5 text-gray-500" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${news.tagColor}`}>
                  {news.tag}
                </span>
                <span className="text-xs text-gray-400">{news.source}</span>
                <span className="text-xs text-gray-400">{news.date}</span>
              </div>
              <p className="mt-1.5 text-base font-semibold leading-snug text-gray-800">{news.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-500">{news.excerpt}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <button
                type="button"
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
        </div>
      ))}
    </div>
  )
}

// ── QingdaoPage ────────────────────────────────────────────────────────────────

export function QingdaoPage() {
  const [searchParams] = useSearchParams()
  const initialTab = (searchParams.get('tab') as TabKey | null) ?? 'employment'
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab)

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="AI 在青岛"
        subtitle="青岛就业 · 政策服务 · 高校资源 · 园区岗位 · 城市资讯"
      />

      {/* Compliance attribution banner */}
      <div className="flex items-center gap-3 rounded-xl border border-teal-100 bg-teal-50 px-5 py-3.5">
        <ShieldCheckIcon className="h-5 w-5 shrink-0 text-teal-600" aria-hidden="true" />
        <p className="text-sm text-teal-700">
          本专区信息来源于青岛市政府及合作机构官方渠道，仅作展示与入口引导。
          本系统不参与招聘、不接收简历、不代理办理任何政务事项。
        </p>
      </div>

      {/* Tab navigation */}
      <TabBar active={activeTab} onChange={setActiveTab} />

      {/* Tab panels */}
      {activeTab === 'employment' && <EmploymentPanel />}
      {activeTab === 'policy'     && <PolicyPanel />}
      {activeTab === 'university' && <UniversityPanel />}
      {activeTab === 'park'       && <ParkPanel />}
      {activeTab === 'news'       && <NewsPanel />}

      {/* Compliance footer */}
      <p className="pb-2 text-center text-xs text-gray-400">
        所有岗位及招聘会信息来源于第三方合作平台，本终端不代理投递。
        政策信息以官方最新发布为准，具体业务请前往对应窗口或扫码访问官方平台。
      </p>
    </div>
  )
}
