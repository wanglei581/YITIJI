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
import { ChevronRightIcon, HeadphonesIcon } from 'lucide-react'
import './help-service-desk.css'

interface QA {
  q: string
  a: string
  /** 分组标签（与 FILTER_KEYS 中的 label 对应） */
  category: string
  categoryKey: string
  /** 可选的相关功能页跳转入口 */
  link?: { label: string; route: string }
}

const ALL_FAQ: QA[] = [
  {
    categoryKey: 'account', category: '登录与账号',
    q: '一定要登录才能使用吗？',
    a: '不需要。大部分服务可以游客身份直接使用。使用手机验证码登录后，本次服务记录（简历记录、文档、打印订单、收藏等）会关联到你的账号，仅本人可见。',
    link: { label: '去登录', route: '/login' },
  },
  {
    categoryKey: 'privacy', category: '隐私与留存',
    q: '我上传的简历会被泄露或推送给企业吗？',
    a: '不会。简历内容仅用于你本次发起的 AI 分析，不进入任何「简历库」，不推送给任何企业或第三方招聘方。',
  },
  {
    categoryKey: 'account', category: '登录与账号',
    q: '为什么离开或刷新后又变回游客了？',
    a: '本终端是公共设备，登录态只保存在当前会话内存中。页面刷新、离开或闲置超时会自动退出登录并清除会话信息，这是公共终端的正常保护行为。',
  },
  {
    categoryKey: 'account', category: '登录与账号',
    q: '怎么切换成另一个账号？',
    a: '在「我的 → 账号设置」中退出当前账号，再用另一个手机号重新登录即可。本终端不做多角色身份切换。',
    link: { label: '账号设置', route: '/me/settings' },
  },
  {
    categoryKey: 'resume', category: 'AI简历服务',
    q: 'AI 简历服务能做什么？',
    a: 'AI 可以对你提供的简历做诊断、优化建议与生成参考，仅供你本人修改简历时参考。AI 输出可能存在偏差，请在使用前核对关键信息。',
    link: { label: '开始使用', route: '/resume/source' },
  },
  {
    categoryKey: 'resume', category: 'AI简历服务',
    q: 'AI 会保证我面试或录用成功吗？',
    a: '不会。本平台不作出任何面试、录用或通过率承诺，也不参与企业后续招聘流程。',
  },
  {
    categoryKey: 'print', category: '打印与扫描',
    q: '怎么打印文件？',
    a: '在「文档打印」上传文件，核对打印参数与现场公示价目后确认输出。打印任务一经确认开始输出，纸张耗材即发生消耗，请在确认前核对参数。',
    link: { label: '文档打印', route: '/print/upload' },
  },
  {
    categoryKey: 'print', category: '打印与扫描',
    q: '扫描的文件保存在哪里？',
    a: '扫描结果仅用于本次打印或保存到本次会话记录，敏感文件设置短期有效期，到期自动删除。',
    link: { label: '扫描文件', route: '/scan/start' },
  },
  {
    categoryKey: 'policy', category: '政策服务',
    q: '政策服务能帮我申请补贴吗？',
    a: '政策服务只提供政策说明、材料清单、官方入口与打印辅助，不代申请、不承诺资金发放或审核结果，也不保存身份证 / 银行卡 / 社保等材料。具体办理与结果以官方平台为准。',
    link: { label: '政策服务', route: '/renshi?tab=policy' },
  },
  {
    categoryKey: 'jobs', category: '岗位与招聘会',
    q: '可以在这里办理岗位申请吗？',
    a: '本终端不是网络招聘平台，不办理岗位申请。岗位与招聘会信息均来自第三方/官方来源，相关申请与报名请通过页面提供的来源平台入口自行办理。',
    link: { label: '岗位信息', route: '/jobs' },
  },
  {
    categoryKey: 'records', category: '我的记录',
    q: '在哪里查看我的文档和订单？',
    a: '登录后在「我的」页可查看本人的文档、打印订单、收藏与浏览/跳转记录，所有记录仅本人可见。',
    link: { label: '我的文档', route: '/me/documents' },
  },
  {
    categoryKey: 'privacy', category: '隐私与留存',
    q: '文件会保存多久？',
    a: '证件照、身份证复印件、未登录上传文件等高敏或匿名文件短期保存；登录后原始简历和求职材料默认保存 90 天，可在「我的文档」延长至 180 天；AI 优化成果物可在本人确认后长期保存，也可随时删除。详见隐私政策。',
    link: { label: '隐私政策', route: '/legal/privacy' },
  },
]

const FILTER_KEYS = [
  { key: 'all', label: '全部' },
  { key: 'account', label: '登录与账号' },
  { key: 'resume', label: 'AI简历服务' },
  { key: 'print', label: '打印与扫描' },
  { key: 'policy', label: '政策服务' },
  { key: 'jobs', label: '岗位与招聘会' },
  { key: 'records', label: '我的记录' },
  { key: 'privacy', label: '隐私与留存' },
] as const

function QaRow({ item, answerId, onNavigate }: { item: QA; answerId: string; onNavigate: (route: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`k1-help-row${open ? ' is-open' : ''}`}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-controls={answerId}
        className="k1-help-toggle flex w-full items-start gap-3 p-[15px_18px] text-left">
        <span className="k1-help-question-mark" aria-hidden="true">问</span>
        <span className="min-w-0 flex-1"><span className="k1-help-category">{item.category}</span><strong>{item.q}</strong></span>
        <ChevronRightIcon className={`k1-help-chevron shrink-0 transition-transform${open ? ' rotate-90' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div id={answerId} className="k1-help-answer">
          <p>{item.a}</p>
          {item.link && (
            <button type="button" onClick={() => onNavigate(item.link!.route)} className="k1-help-link flex items-center gap-2">
              {item.link.label}<ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function FaqRow({ item, index, onNavigate }: { item: QA; index: number; onNavigate: (route: string) => void }) {
  const [open, setOpen] = useState(false)
  const answerId = `help-answer-${item.categoryKey}-${index}`
  return (
    <div className={`k1-help-row${open ? ' is-open' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={answerId}
        className="k1-help-toggle flex w-full items-start gap-3 p-[15px_18px] text-left"
      >
        <span className="k1-help-question-mark" aria-hidden="true">问</span>
        <span className="min-w-0 flex-1">
          <span className="k1-help-category">{item.category}</span>
          <strong>{item.q}</strong>
        </span>
        <ChevronRightIcon
          className={`k1-help-chevron shrink-0 transition-transform${open ? ' rotate-90' : ''}`}
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
              className="k1-help-link flex items-center gap-2"
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
  const [activeFilter, setActiveFilter] = useState<string>('all')

  const handleNavigate = (route: string) => {
    if (route === '/login') {
      navigate('/login', { state: { from: '/help' } })
      return
    }
    navigate(route)
  }

  const visibleFaq = activeFilter === 'all'
    ? ALL_FAQ
    : ALL_FAQ.filter((item) => item.categoryKey === activeFilter)

  return (
    <div className="service-desk k1-help-center flex h-full flex-col px-6 pt-6">
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

      {/* 分类过滤 chips */}
      <div className="k1-help-filters">
        {FILTER_KEYS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={activeFilter === key ? 'is-active' : ''}
            onClick={() => setActiveFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="k1-help-scroll mt-4 flex-1 overflow-y-auto pb-8">
        <div className="flex flex-col gap-4">

          {/* FAQ 列表 — 2列网格，展开项占满宽度 */}
          <div className="k1-help-faq-list" aria-label="常见问题">
            {[{ key: activeFilter === 'all' ? 'all' : activeFilter, items: visibleFaq }].map(section => (
              section.items.map((item, itemIndex) => (
                <QaRow key={item.q} item={item} answerId={`help-answer-${section.key}-${itemIndex}`} onNavigate={handleNavigate} />
              ))
            ))}
          </div>

          {/* 联系现场工作人员 */}
          <div className="k1-help-contact">
            <span>
              <HeadphonesIcon aria-hidden="true" />
            </span>
            <div>
              <h2>联系现场工作人员</h2>
              <p>如需更多帮助，请前往大厅服务台联系现场工作人员；设备故障请勿自行拆卸或拉扯纸张。</p>
            </div>
            <aside>
              <small>现场服务时间</small>
              <strong>以大厅现场公示为准</strong>
            </aside>
          </div>

          <p className="k1-help-footer">
            本终端仅提供信息与打印辅助服务，办理结果以官方/来源平台为准。
          </p>
        </div>
      </div>
    </div>
  )
}
