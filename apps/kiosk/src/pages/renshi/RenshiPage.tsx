import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import { useComingSoonNotice } from '../../components/ComingSoonNotice'
import { getPublishedPolicies, type PolicyPostView } from '../../services/api/policies'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { useFavorites } from '../../favorites/useFavorites'
import { useAuth } from '../../auth/useAuth'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { isValidSourceUrl } from '../../lib/url'
import {
  ArrowUpRightIcon,
  BadgeCheckIcon,
  BookOpenIcon,
  BriefcaseIcon,
  Building2Icon,
  CheckCircle2Icon,
  ChevronRightIcon,
  ClipboardListIcon,
  FileTextIcon,
  GraduationCapIcon,
  HeartHandshakeIcon,
  HeartIcon,
  HelpCircleIcon,
  InfoIcon,
  ListChecksIcon,
  MessageCircleQuestionIcon,
  PrinterIcon,
  QrCodeIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  UsersIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type TabKey = 'policy' | 'social' | 'register' | 'notice'
const VALID_TABS = new Set<TabKey>(['policy', 'social', 'register', 'notice'])

function getInitialTab(searchParams: URLSearchParams): TabKey {
  const tab = searchParams.get('tab')
  return tab && VALID_TABS.has(tab as TabKey) ? (tab as TabKey) : 'policy'
}

/** 政策匹配筛选：身份分组。'all' 显示全部；'general' 为通用事项（任何身份都展示）。 */
type AudienceKey = 'all' | 'graduate' | 'flexible' | 'startup' | 'hardship'

const AUDIENCE_CHIPS: { key: AudienceKey; label: string; icon: LucideIcon }[] = [
  { key: 'all', label: '全部', icon: UsersIcon },
  { key: 'graduate', label: '高校毕业生', icon: GraduationCapIcon },
  { key: 'flexible', label: '灵活就业', icon: BriefcaseIcon },
  { key: 'startup', label: '创业人员', icon: Building2Icon },
  { key: 'hardship', label: '困难群体', icon: HeartHandshakeIcon },
]

/** 统一政策事项模型：内置办事指引模板 + 后端发布政策（kind=policy_guide）合并后的展示形态。 */
type TagTone = 'amber' | 'slate'
interface PolicyItem {
  id: string
  /** 命中的身份分组；'general' = 通用（任何身份都展示）。 */
  audiences: string[]
  tagLabel: string
  tagTone: TagTone
  title: string
  summary: string
  /** 内置模板的结构化内容；后端发布项可能仅有 content。 */
  conditions?: string[]
  materials?: string[]
  steps?: string[]
  content?: string
  officialUrl?: string
  sourceName: string
  updatedAt?: string
}

// ── 内置办事指引模板（综合整理自公开政策口径；办理以官方平台为准）────────────────
// 合规：仅信息说明 / 材料清单 / 办理路径 / 官方入口，不代申请、不承诺到账。

const BUILTIN_GUIDES: PolicyItem[] = [
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

/** 后端发布政策 → 统一展示模型。审核发布内容为准，内置模板为补充。 */
function fromPublished(p: PolicyPostView): PolicyItem {
  const known = ['graduate', 'flexible', 'startup', 'hardship']
  const audiences = p.audience && known.includes(p.audience) ? [p.audience] : ['general']
  return {
    id: p.id,
    audiences,
    tagLabel: '政策发布',
    tagTone: 'slate',
    title: p.title,
    summary: p.summary ?? '',
    content: p.content,
    officialUrl: p.externalUrl,
    sourceName: p.sourceName,
    updatedAt: p.publishedDate ?? p.syncTime?.slice(0, 10),
  }
}

const matchAudience = (item: PolicyItem, sel: AudienceKey) =>
  sel === 'all' || item.audiences.includes(sel) || item.audiences.includes('general')

// ── 社保指南（内置办事指引）────────────────────────────────────────────────────

interface SocialGuide {
  key: string
  icon: LucideIcon
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

// ── 就业登记（内置办事指引）────────────────────────────────────────────────────

interface RegisterItem {
  key: string
  icon: LucideIcon
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
    iconColor: 'text-amber-700',
    title: '人事档案转移',
    purpose: '档案迁移至新工作单位或人才中心托管',
    location: '人才服务中心档案窗口（需预约）',
    materials: ['居民身份证原件', '接收单位档案接收函（盖章）', '原存档机构出具的档案清单'],
  },
]

/** 公告标签展示元信息（数据本体来自后端 PolicyPost kind=notice）。 */
const CATEGORY_META: Record<string, { label: string; color: string }> = {
  policy: { label: '政策', color: 'bg-amber-100 text-amber-800' },
  announcement: { label: '公告', color: 'bg-green-100 text-green-700' },
  notice: { label: '通知', color: 'bg-blue-100 text-blue-700' },
  recruitment: { label: '招募', color: 'bg-orange-100 text-orange-700' },
}

const TAG_TONE: Record<TagTone, string> = {
  amber: 'bg-amber-100 text-amber-800',
  slate: 'bg-slate-100 text-slate-600',
}

// 复用按钮样式：金/amber 仅做轻底色描边，不大面积铺色（visual-design-spec §15.6）。
const BTN_OFFICIAL =
  'flex min-h-[48px] items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-800 hover:bg-amber-100'
const BTN_PRINT =
  'flex min-h-[48px] items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50'

// ── Sub-components ─────────────────────────────────────────────────────────────

// 官方入口二维码弹层：承载政策事项的真实 officialUrl；info-only。
// 打开即记一条 external_open 跳转记录（仅记录打开入口动作，不记录办理结果）。
function OfficialEntryQrOverlay({ title, url, onClose }: { title: string; url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-[22rem] max-w-full rounded-2xl bg-white p-7 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label="关闭"
          className="absolute right-4 top-4 flex h-12 w-12 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
        >
          <XIcon className="h-5 w-5" />
        </button>
        <p className="text-center text-base font-semibold text-gray-800">扫码打开官方入口</p>
        <p className="mt-1 truncate text-center text-xs text-gray-400">{title}</p>
        <div className="mt-5 flex justify-center"><SourceUrlQr value={url} size={196} /></div>
        <p className="mt-3 break-all rounded-lg bg-gray-50 px-3 py-2 text-center text-[11px] text-gray-500">{url}</p>
        <p className="mt-4 text-xs leading-relaxed text-gray-500">
          请使用手机扫码前往官方平台办理。办理结果以官方平台为准，本系统仅提供信息入口和材料服务。
        </p>
      </div>
    </div>
  )
}

function TabBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  const tabs: { key: TabKey; label: string; icon: LucideIcon }[] = [
    { key: 'policy', label: '就业政策', icon: FileTextIcon },
    { key: 'social', label: '社保指南', icon: ShieldCheckIcon },
    { key: 'register', label: '就业登记', icon: ClipboardListIcon },
    { key: 'notice', label: '政策公告', icon: ScrollTextIcon },
  ]

  return (
    <div className="flex gap-1 rounded-xl border border-gray-200 bg-gray-100 p-1">
      {tabs.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={active === key}
          className={[
            'flex min-h-[52px] flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm transition-colors',
            active === key
              ? 'bg-white font-semibold text-amber-800 shadow-sm'
              : 'font-medium text-gray-500 hover:text-gray-700',
          ].join(' ')}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  )
}

/** 政策匹配筛选条：选身份即筛选下方「就业政策」事项。 */
function AudienceFilter({ value, onChange }: { value: AudienceKey; onChange: (k: AudienceKey) => void }) {
  return (
    <div>
      <p className="text-base font-semibold text-gray-900">先选你的情况</p>
      <p className="mt-0.5 text-xs text-gray-500">选择身份后，下方自动筛出更相关的政策事项；通用事项始终展示。</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {AUDIENCE_CHIPS.map(({ key, label, icon: Icon }) => {
          const activeChip = value === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-pressed={activeChip}
              className={[
                'flex min-h-[48px] min-w-[120px] flex-1 items-center justify-center gap-2 rounded-xl border px-4 text-sm transition-colors',
                activeChip
                  ? 'border-amber-300 bg-amber-50 font-semibold text-amber-800'
                  : 'border-gray-200 bg-white font-medium text-gray-600 hover:border-gray-300',
              ].join(' ')}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DetailList({ icon: Icon, iconColor, title, items, ordered }: {
  icon: LucideIcon
  iconColor: string
  title: string
  items: string[]
  ordered?: boolean
}) {
  return (
    <section className="rounded-xl bg-gray-50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Icon className={`h-4 w-4 ${iconColor}`} aria-hidden="true" />
        {title}
      </p>
      <ul className="mt-2.5 flex flex-col gap-2">
        {items.map((text, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-gray-600">
            {ordered ? (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">
                {i + 1}
              </span>
            ) : (
              <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
            )}
            {text}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ─── Panel: 就业政策（政策匹配 + 内置模板 + 后端发布合并）──────────────────────

function PolicyPanel({
  items,
  audience,
  onAudienceChange,
  sourceLine,
  onOpened,
  onOfficialEntry,
}: {
  items: PolicyItem[]
  audience: AudienceKey
  onAudienceChange: (k: AudienceKey) => void
  sourceLine: string | null
  onOpened: (item: PolicyItem) => void
  onOfficialEntry: (item: PolicyItem) => void
}) {
  const navigate = useNavigate()
  const [openId, setOpenId] = useState<string | null>(null)
  const { isFavorite, toggle: toggleFavorite } = useFavorites()

  const visible = useMemo(() => items.filter((it) => matchAudience(it, audience)), [items, audience])

  const toggleItem = (item: PolicyItem) => {
    const opening = openId !== item.id
    setOpenId(opening ? item.id : null)
    if (opening) onOpened(item)
  }

  return (
    <div className="flex flex-col gap-4">
      <AudienceFilter value={audience} onChange={onAudienceChange} />

      {sourceLine && (
        <p className="flex items-center gap-2 text-xs text-gray-400">
          <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {sourceLine}
        </p>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={FileTextIcon}
          title="暂无匹配的政策事项"
          description="可切换上方身份或选择「全部」查看；政策内容由合作机构发布、管理员审核后展示。"
          className="py-12"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((item) => {
            const itemOpen = openId === item.id
            const hasStructured = Boolean(item.conditions || item.materials || item.steps)
            const hasOfficial = Boolean(item.officialUrl && isValidSourceUrl(item.officialUrl))
            const fav = isFavorite('policy', item.id)
            return (
              <article key={item.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TAG_TONE[item.tagTone]}`}>
                    {item.tagLabel}
                  </span>
                  {item.updatedAt && <span className="ml-auto text-xs text-gray-400">更新 {item.updatedAt}</span>}
                </div>
                <p className="mt-2 text-lg font-semibold leading-snug text-gray-900">{item.title}</p>
                {item.summary && (
                  <p className={['mt-1 text-sm leading-relaxed text-gray-500', itemOpen ? '' : 'line-clamp-2'].join(' ')}>
                    {item.summary}
                  </p>
                )}
                <p className="mt-1.5 text-xs text-gray-400">来源：{item.sourceName}</p>

                {itemOpen && (
                  <div className="mt-3 flex flex-col gap-3">
                    {hasStructured ? (
                      <>
                        {item.conditions && (
                          <DetailList icon={BadgeCheckIcon} iconColor="text-emerald-600" title="先看是否符合" items={item.conditions} />
                        )}
                        {item.materials && (
                          <DetailList icon={ListChecksIcon} iconColor="text-amber-700" title="需要准备材料" items={item.materials} />
                        )}
                        {item.steps && (
                          <DetailList icon={ChevronRightIcon} iconColor="text-amber-700" title="建议办理路径" items={item.steps} ordered />
                        )}
                      </>
                    ) : (
                      item.content && (
                        <div className="rounded-xl bg-gray-50 px-4 py-3">
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{item.content}</p>
                        </div>
                      )
                    )}

                    <div className="flex flex-wrap gap-2.5">
                      <button type="button" onClick={() => navigate('/print/upload')} className={BTN_PRINT}>
                        <PrinterIcon className="h-4 w-4" aria-hidden="true" />
                        打印材料清单
                      </button>
                      {hasOfficial && (
                        <button type="button" onClick={() => onOfficialEntry(item)} className={BTN_OFFICIAL}>
                          <QrCodeIcon className="h-4 w-4" aria-hidden="true" />
                          扫码打开官方入口
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">办理结果以官方平台为准，本系统仅提供信息说明、材料清单与打印辅助。</p>
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
                  <button
                    type="button"
                    onClick={() => toggleItem(item)}
                    className="flex min-h-[48px] items-center gap-1 rounded-lg px-2 text-sm font-medium text-gray-600 hover:text-amber-800"
                  >
                    {itemOpen ? '收起' : '查看条件 / 材料'}
                    <ChevronRightIcon
                      className={['h-4 w-4 transition-transform', itemOpen ? 'rotate-90' : ''].join(' ')}
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleFavorite({ type: 'policy', id: item.id, title: item.title })}
                    aria-label={fav ? '取消收藏' : '收藏政策'}
                    className={[
                      'ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors',
                      fav ? 'bg-rose-50 text-rose-500' : 'text-gray-300 hover:text-rose-400',
                    ].join(' ')}
                  >
                    <HeartIcon className={fav ? 'h-5 w-5 fill-current' : 'h-5 w-5'} aria-hidden="true" />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {SOCIAL_GUIDES.map((guide) => {
          const Icon = guide.icon
          return (
            <div key={guide.key} className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${guide.iconBg}`}>
                  <Icon className={`h-6 w-6 ${guide.iconColor}`} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold text-gray-900">{guide.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-gray-500">{guide.desc}</p>
                </div>
              </div>

              <ol className="mt-4 flex flex-col gap-2">
                {guide.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">
                      {i + 1}
                    </span>
                    <span className="text-sm text-gray-600">{step}</span>
                  </li>
                ))}
              </ol>

              <div className="mt-4">
                {guide.entryLabel.includes('扫码') ? (
                  <button type="button" onClick={() => onComingSoon(guide.entryLabel)} className={`w-full justify-center ${BTN_OFFICIAL}`}>
                    <QrCodeIcon className="h-4 w-4" aria-hidden="true" />
                    {guide.entryLabel}
                  </button>
                ) : (
                  <button type="button" onClick={() => navigate('/print/upload')} className={`w-full justify-center ${BTN_PRINT}`}>
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
          <div key={item.key} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${item.iconBg}`}>
                <Icon className={`h-6 w-6 ${item.iconColor}`} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold text-gray-900">{item.title}</p>
                <p className="mt-1 text-sm text-gray-500">{item.purpose}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl bg-gray-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">办理地点</p>
                <p className="mt-1.5 text-sm font-medium text-gray-700">{item.location}</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-4 py-3">
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

            <div className="mt-4 flex flex-wrap gap-2.5">
              <button type="button" onClick={() => navigate('/print/upload')} className={BTN_PRINT}>
                <PrinterIcon className="h-4 w-4" aria-hidden="true" />
                打印材料清单
              </button>
              <button type="button" onClick={() => onComingSoon('扫码预约')} className={BTN_OFFICIAL}>
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

// ─── Panel: 政策公告（真实数据）──────────────────────────────────────────────

function NoticePanel({
  notices,
  sourceLine,
  onOpened,
  onOfficialEntry,
}: {
  notices: PolicyPostView[]
  sourceLine: string | null
  onOpened: (policy: PolicyPostView) => void
  onOfficialEntry: (policy: PolicyPostView) => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (notices.length === 0) {
    return (
      <EmptyState
        icon={ScrollTextIcon}
        title="暂无政策公告"
        description="公告由合作机构发布、管理员审核后展示，敬请关注"
        className="py-16"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {sourceLine && (
        <p className="flex items-center gap-2 text-xs text-gray-400">
          <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {sourceLine}
        </p>
      )}

      {notices.map((notice) => {
        const meta = (notice.category && CATEGORY_META[notice.category]) || CATEGORY_META.notice
        const isOpen = expandedId === notice.id
        const hasDetail = Boolean(notice.content || notice.externalUrl)
        return (
          <div key={notice.id} className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-50">
                <FileTextIcon className="h-5 w-5 text-gray-500" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.color}`}>{meta.label}</span>
                  <span className="text-xs text-gray-400">{notice.sourceName}</span>
                </div>
                <p className="mt-1.5 text-base font-medium leading-snug text-gray-800">{notice.title}</p>
                {notice.summary && <p className="mt-1 text-sm text-gray-500">{notice.summary}</p>}
                {notice.publishedDate && <p className="mt-1 text-xs text-gray-400">发布时间：{notice.publishedDate}</p>}
              </div>
              {hasDetail && (
                <button
                  type="button"
                  onClick={() => {
                    setExpandedId(isOpen ? null : notice.id)
                    if (!isOpen) onOpened(notice)
                  }}
                  className="flex min-h-[48px] shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm font-medium text-gray-600 hover:bg-gray-100"
                >
                  {isOpen ? '收起' : '查看详情'}
                  <ChevronRightIcon
                    className={['h-3.5 w-3.5 transition-transform', isOpen ? 'rotate-90' : ''].join(' ')}
                    aria-hidden="true"
                  />
                </button>
              )}
            </div>

            {isOpen && (
              <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3">
                {notice.content && (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{notice.content}</p>
                )}
                {notice.externalUrl && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
                    <ArrowUpRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    官方入口：{notice.externalUrl}（请通过官方渠道访问办理）
                  </p>
                )}
                {notice.externalUrl && isValidSourceUrl(notice.externalUrl) && (
                  <button type="button" onClick={() => onOfficialEntry(notice)} className={`mt-3 ${BTN_OFFICIAL}`}>
                    <QrCodeIcon className="h-4 w-4" aria-hidden="true" />
                    扫码打开官方入口
                  </button>
                )}
                <p className="mt-2 text-xs text-gray-400">以上内容仅作展示说明，具体政策以官方发布为准。</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── 常用材料打印包 ─────────────────────────────────────────────────────────────

function PrintPackBanner() {
  const navigate = useNavigate()
  const packs = [
    { label: '失业登记申请表', pages: '1页', icon: ScrollTextIcon },
    { label: '就业登记申请表', pages: '1页', icon: UserCheckIcon },
    { label: '社保查询操作指引', pages: '2页', icon: ShieldCheckIcon },
    { label: '创业担保贷款材料清单', pages: '1页', icon: ClipboardListIcon },
  ]

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-5">
      <div className="mb-4 flex items-center gap-2">
        <PrinterIcon className="h-4 w-4 text-amber-700" aria-hidden="true" />
        <span className="text-sm font-semibold text-amber-900">常用材料打印包</span>
        <span className="ml-auto text-xs text-amber-700/80">只打印清单与指引，不上传或代办高敏材料</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {packs.map(({ label, pages, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => navigate('/print/upload')}
            className="flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-lg border border-amber-100 bg-white px-3 py-4 text-center hover:bg-amber-50 active:bg-amber-100"
          >
            <Icon className="h-5 w-5 text-amber-700" aria-hidden="true" />
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
  const [audience, setAudience] = useState<AudienceKey>('all')
  const { notify, overlay } = useComingSoonNotice()
  const { getToken } = useAuth()

  // P1 浏览/跳转记录：fire-and-forget，失败不影响浏览与官方入口打开；匿名不上报。
  const [qrEntry, setQrEntry] = useState<{ title: string; url: string } | null>(null)
  const handlePolicyItemOpened = (item: PolicyItem) => {
    recordBrowse(getToken(), 'policy', item.id)
  }
  const handlePolicyItemEntry = (item: PolicyItem) => {
    if (!item.officialUrl) return
    recordExternalJump(getToken(), 'policy', item.id, 'external_open')
    setQrEntry({ title: item.title, url: item.officialUrl })
  }
  const handleNoticeOpened = (policy: PolicyPostView) => {
    recordBrowse(getToken(), 'policy', policy.id)
  }
  const handleNoticeEntry = (policy: PolicyPostView) => {
    if (!policy.externalUrl) return
    recordExternalJump(getToken(), 'policy', policy.id, 'external_open')
    setQrEntry({ title: policy.title, url: policy.externalUrl })
  }

  // 政策内容（阶段1D 接真）：一次拉取，前端按 kind 拆分。
  const [policies, setPolicies] = useState<PolicyPostView[]>([])
  const [policyState, setPolicyState] = useState<'loading' | 'error' | 'ready'>('loading')

  const loadPolicies = () => {
    setPolicyState('loading')
    getPublishedPolicies()
      .then((rows) => {
        setPolicies(rows)
        setPolicyState('ready')
      })
      .catch(() => setPolicyState('error'))
  }

  useEffect(() => { loadPolicies() }, [])

  // 同一路由内 search params 变化时同步首页深链 Tab，非法值回退「就业政策」。
  useEffect(() => {
    setActiveTab(getInitialTab(searchParams))
  }, [searchParams])

  const notices = policies.filter((p) => p.kind === 'notice')

  // 混合数据源：后端发布政策（审核为准）在前，内置办事指引模板在后。
  const policyItems = useMemo<PolicyItem[]>(
    () => [...policies.filter((p) => p.kind === 'policy_guide').map(fromPublished), ...BUILTIN_GUIDES],
    [policies],
  )

  /** 数据来源说明：取真实来源机构名 + 最近同步时间，绝不硬编码机构名。 */
  const sourceLine = (() => {
    if (policies.length === 0) return '政策事项含内置办事指引模板；标注「政策发布」的为合作机构发布、管理员审核内容'
    const names = [...new Set(policies.map((p) => p.sourceName))].slice(0, 2).join('、')
    const latest = policies.map((p) => p.syncTime).sort().at(-1)?.slice(0, 10) ?? ''
    return `数据来源：${names} · 更新于 ${latest} · 含内置办事指引模板 · 仅供参考`
  })()

  const renderPolicyTab = () => {
    if (policyState === 'loading') return <LoadingState className="py-16" />
    if (policyState === 'error') return <ErrorState className="py-16" onRetry={loadPolicies} />
    return (
      <PolicyPanel
        items={policyItems}
        audience={audience}
        onAudienceChange={setAudience}
        sourceLine={sourceLine}
        onOpened={handlePolicyItemOpened}
        onOfficialEntry={handlePolicyItemEntry}
      />
    )
  }

  const renderNoticeTab = () => {
    if (policyState === 'loading') return <LoadingState className="py-16" />
    if (policyState === 'error') return <ErrorState className="py-16" onRetry={loadPolicies} />
    return <NoticePanel notices={notices} sourceLine={sourceLine} onOpened={handleNoticeOpened} onOfficialEntry={handleNoticeEntry} />
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      {overlay}
      {qrEntry && <OfficialEntryQrOverlay title={qrEntry.title} url={qrEntry.url} onClose={() => setQrEntry(null)} />}
      <PageHeader title="政策服务" subtitle="就业政策 · 补贴指引 · 社保 · 就业登记 · 政策公告" />

      {/* 合规边界：仅信息指引 + 直达 AI 助手政策问答 */}
      <div className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
        <ShieldCheckIcon className="h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">仅信息指引 · 不代办</p>
          <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
            只做政策说明、材料清单、官方入口与打印辅助；不代申请、不承诺补贴到账，不保存身份证 / 银行卡 / 社保等材料。
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/assistant')}
          className="flex min-h-[48px] shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-800 hover:bg-amber-100"
        >
          <MessageCircleQuestionIcon className="h-4 w-4" aria-hidden="true" />
          问 AI 助手
        </button>
      </div>

      {/* Tab 导航 */}
      <TabBar active={activeTab} onChange={setActiveTab} />

      {/* Tab 面板 */}
      {activeTab === 'policy' && renderPolicyTab()}
      {activeTab === 'notice' && renderNoticeTab()}
      {activeTab === 'social' && <SocialPanel onComingSoon={notify} />}
      {activeTab === 'register' && <RegisterPanel onComingSoon={notify} />}

      {/* 常用材料打印包 */}
      <PrintPackBanner />

      {/* 合规页脚 */}
      <p className="pb-2 text-center text-xs leading-relaxed text-gray-400">
        政策与公告内容仅作展示说明，具体以官方发布为准。如需办理具体业务，请前往对应窗口或扫码访问官方平台。
      </p>
    </div>
  )
}
