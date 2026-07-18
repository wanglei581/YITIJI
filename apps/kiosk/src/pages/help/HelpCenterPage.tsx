// ============================================================
// 帮助中心 — /help（静态信息页）。
//
// 诚实化与合规：
// - 只描述本终端已上线的能力（登录、AI 简历、打印扫描、政策服务、招聘会/岗位来源入口、
//   我的记录、隐私与文件留存），不承诺尚未实现的功能（套餐、支付、凭证、消息通知）。
// - 不出现平台办理招聘闭环、来源平台办理结果、资金发放结果、面试或录用承诺等措辞。
// - 招聘与政策只作第三方/官方来源信息入口，办理结果以来源平台为准。
// 底部 Tab（首页 / AI助手 / 我的）由 KioskLayout 提供，本页不改动。
// ============================================================

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, PageHeader } from '@ai-job-print/ui'
import './help-service-desk.css'
import {
  BriefcaseIcon,
  ChevronRightIcon,
  FilesIcon,
  HeadphonesIcon,
  LandmarkIcon,
  LogInIcon,
  PrinterIcon,
  ShieldCheckIcon,
  SparklesIcon,
  type LucideIcon,
} from 'lucide-react'

interface QA {
  q: string
  a: string
  pin?: boolean
  /** 可选的相关功能页跳转入口 */
  link?: { label: string; route: string }
}

interface HelpSection {
  key: string
  icon: LucideIcon
  iconBg: string
  iconColor: string
  title: string
  items: QA[]
}

const SECTIONS: HelpSection[] = [
  {
    key: 'account',
    icon: LogInIcon,
    iconBg: 'bg-primary-50',
    iconColor: 'text-primary-600',
    title: '登录与账号',
    items: [
      {
        q: '一定要登录才能使用吗？',
        a: '不需要。大部分服务可以游客身份直接使用。使用手机验证码登录后，本次服务记录（简历记录、文档、打印订单、收藏等）会关联到你的账号，仅本人可见。',
        link: { label: '去登录', route: '/login' },
      },
      {
        q: '为什么离开或刷新后又变回游客了？',
        a: '本终端是公共设备，登录态只保存在当前会话内存中。页面刷新、离开或闲置超时会自动退出登录并清除会话信息，这是公共终端的正常保护行为。',
      },
      {
        q: '怎么切换成另一个账号？',
        a: '在「我的 → 账号设置」中退出当前账号，再用另一个手机号重新登录即可。本终端不做多角色身份切换。',
        link: { label: '账号设置', route: '/me/settings' },
      },
    ],
  },
  {
    key: 'resume',
    icon: SparklesIcon,
    iconBg: 'bg-plum-soft',
    iconColor: 'text-plum',
    title: 'AI 简历服务',
    items: [
      {
        q: 'AI 简历服务能做什么？',
        a: 'AI 可以对你提供的简历做诊断、优化建议与生成参考，仅供你本人修改简历时参考。AI 输出可能存在偏差，请在使用前核对关键信息。',
        link: { label: '开始使用', route: '/resume/source' },
      },
      {
        q: 'AI 会保证我面试或录用成功吗？',
        a: '不会。本平台不作出任何面试、录用或通过率承诺，也不参与企业后续招聘流程。',
      },
    ],
  },
  {
    key: 'print',
    icon: PrinterIcon,
    iconBg: 'bg-warning-bg',
    iconColor: 'text-warning-fg',
    title: '文档打印与扫描',
    items: [
      {
        q: '怎么打印文件？',
        a: '在「文档打印」上传文件，核对打印参数与现场公示价目后确认输出。打印任务一经确认开始输出，纸张耗材即发生消耗，请在确认前核对参数。',
        link: { label: '文档打印', route: '/print/upload' },
      },
      {
        q: '扫描的文件保存在哪里？',
        a: '扫描结果仅用于本次打印或保存到本次会话记录，敏感文件设置短期有效期，到期自动删除。',
        link: { label: '扫描文件', route: '/scan/start' },
      },
    ],
  },
  {
    key: 'policy',
    icon: LandmarkIcon,
    iconBg: 'bg-success-bg',
    iconColor: 'text-success-fg',
    title: '政策服务',
    items: [
      {
        q: '政策服务能帮我申请补贴吗？',
        a: '政策服务只提供政策说明、材料清单、官方入口与打印辅助，不代申请、不承诺资金发放或审核结果，也不保存身份证 / 银行卡 / 社保等材料。具体办理与结果以官方平台为准。',
        link: { label: '政策服务', route: '/renshi?tab=policy' },
      },
    ],
  },
  {
    key: 'jobs',
    icon: BriefcaseIcon,
    iconBg: 'bg-info-bg',
    iconColor: 'text-info',
    title: '招聘会与岗位信息',
    items: [
      {
        q: '可以在这里办理岗位申请吗？',
        a: '本终端不是网络招聘平台，不办理岗位申请。岗位与招聘会信息均来自第三方/官方来源，相关申请与报名请通过页面提供的来源平台入口自行办理。',
        link: { label: '岗位信息', route: '/jobs' },
      },
    ],
  },
  {
    key: 'records',
    icon: FilesIcon,
    iconBg: 'bg-plum-soft',
    iconColor: 'text-plum',
    title: '我的记录',
    items: [
      {
        q: '在哪里查看我的文档和订单？',
        a: '登录后在「我的」页可查看本人的文档、打印订单、收藏与浏览/跳转记录，所有记录仅本人可见。',
        link: { label: '我的文档', route: '/me/documents' },
      },
    ],
  },
  {
    key: 'privacy',
    icon: ShieldCheckIcon,
    iconBg: 'bg-info-bg',
    iconColor: 'text-info',
    title: '隐私与文件留存',
    items: [
      {
        q: '我上传的简历会被泄露或推送给企业吗？',
        a: '不会。简历内容仅用于你本次发起的 AI 分析，不进入任何「简历库」，不推送给任何企业或第三方招聘方。',
        pin: true,
      },
      {
        q: '文件会保存多久？',
        a: '证件照、身份证复印件、未登录上传文件等高敏或匿名文件短期保存；登录后原始简历和求职材料默认保存 90 天，可在「我的文档」延长至 180 天；AI 优化成果物可在本人确认后长期保存，也可随时删除。详见隐私政策。',
        link: { label: '隐私政策', route: '/legal/privacy' },
      },
    ],
  },
]

function QaRow({ item, answerId, onNavigate }) => void }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`k1-help-row${open ? ' is-open' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={answerId}
        className="k1-help-toggle flex min-h-[56px] w-full items-start gap-4 text-left"
      >
        <span className="k1-help-question-mark" aria-hidden="true">问</span>
        <span className="min-w-0 flex-1">
          <span className="k1-help-category">{category}</span>
          <strong>{item.q}</strong>
        </span>
        <ChevronRightIcon
          className={['k1-help-chevron h-4 w-4 shrink-0 text-neutral-400 transition-transform', open ? 'rotate-90' : ''].join(' ')}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id={answerId} className="k1-help-answer">
          <p>{item.a}</p>
          {item.link && (
            <button
              type="button"
              onClick={() => onNavigate(item.link!.route)}
              className="k1-help-link mt-3 flex min-h-[44px] items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 text-sm font-semibold text-primary-600 hover:bg-neutral-50 active:bg-neutral-100"
            >
              {item.link.label}
              <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function HelpCenterPage() {
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState('all')
  const handleNavigate = (route: string) => {
    if (route === '/login') {
      navigate('/login', { state: { from: '/help' } })
      return
    }
    navigate(route)
  }

  const allItems = SECTIONS.flatMap((section) => section.items.map((item, itemIndex) => ({ section, item })))
  const privacyLead = allItems.find(({ item }) => item.pin)
  const pinnedItems = [allItems[0], privacyLead].filter((entry, index, entries) => entry && entries.indexOf(entry) === index) as { section: HelpSection; item: QA }[]
  const orderedItems = activeSection === 'all'
    ? [...pinnedItems, ...allItems.filter((entry) => !pinnedItems.includes(entry))]
    : allItems.filter(({ section }) => section.key === activeSection)

  return (
    <div className="service-desk k1-help-center flex h-full min-h-0 flex-col px-12 py-5">
      <div className="k1-help-topbar">
        <PageHeader
          title="帮助中心"
          subtitle="常见问题与使用说明"
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate('/profile')}>
              返回我的
            </Button>
          }
        />
      </div>

      <div className="k1-help-filters" role="group" aria-label="帮助问题分类">
        <button type="button" aria-pressed={activeSection === 'all'} className={activeSection === 'all' ? 'is-active' : ''} onClick={() => setActiveSection('all')}>全部</button>
        {SECTIONS.map((section) => (
          <button key={section.key} type="button" aria-pressed={activeSection === section.key} className={activeSection === section.key ? 'is-active' : ''} onClick={() => setActiveSection(section.key)}>
            {section.title}
          </button>
        ))}
      </div>

      <div className="k1-help-scroll mt-4 min-h-0 flex-1 overflow-y-auto pb-4">
        <div className="k1-help-faq-list">
          {orderedItems.map(({ section, item }, index) => (
            <QaRow key={item.q} item={item} answerId={`help-answer-${section.key}-${itemIndex}`}
              category={section.title}
              answerId={`help-answer-${section.key}-${section.items.indexOf(item)}`}
              defaultOpen={activeSection === 'all' && index < 2}
              onNavigate={handleNavigate}
            />
          ))}
        </div>
      </div>

      <section className="k1-help-contact">
        <span><HeadphonesIcon aria-hidden="true" /></span>
        <div>
          <h2>联系现场工作人员</h2>
          <p>如需更多帮助，请前往大厅服务台联系现场工作人员；设备故障请勿自行拆卸或拉扯纸张。</p>
        </div>
        <aside><small>现场服务时间</small><strong>以大厅现场公示为准</strong></aside>
      </section>

      <p className="k1-help-footer">本终端仅提供信息与打印辅助服务，办理结果以官方 / 来源平台为准。</p>
    </div>
  )
}
