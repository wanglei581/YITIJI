import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpenIcon, FlagIcon, GiftIcon, PrinterIcon, SparklesIcon } from 'lucide-react'
import { QxAiHelp } from '../../components/qingxu/QxAiHelp'
import { helpNeededLine } from '../../copy/unattendedCopy'
import { useSupportContact } from '../../hooks/useSupportContact'
import { AI_DRAFT } from './activityModel'

export function ActivityLead() {
  return (
    <section className="act-lead">
      <p>权益记在你的账号上。名称、能不能用、还剩多少，都以实际记录为准；收费以活动说明和现场公示为准。</p>
      <ol className="act-facts">
        <li><b>已有权益</b>只在登录后显示，没有就是没有</li>
        <li><b>活动</b>先看条件再领取，小青不替你判定资格</li>
        <li><b>补贴</b>只给说明和官方入口，机器不代办</li>
        <li><b>打印</b>没有权益也能打，价格看现场公示</li>
        <li><b>带走</b>领到的记进台账，暂不能抵扣</li>
        <li><b>问小青</b>规则看不懂，用下面的按钮问</li>
      </ol>
    </section>
  )
}

export function ActivityTabs() {
  const navigate = useNavigate()
  return (
    <div className="act-tabs">
      <button type="button" className="act-tab" data-testid="tab-benefits" onClick={() => navigate('/me/benefits')}>
        <GiftIcon size={24} aria-hidden />我的权益
      </button>
      <button type="button" className="act-tab" data-testid="tab-activities" aria-current="page" onClick={() => navigate('/activities')}>
        <FlagIcon size={24} aria-hidden />可参加的活动
      </button>
    </div>
  )
}

export function LedgerRules() {
  return (
    <section className="act-card">
      <div className="act-blk-h">
        资格、抵扣与收费由谁说了算
        <span className="hint">与本机是否有权益无关</span>
      </div>
      <div className="act-rules">
        <span className="act-rule"><i />是否符合条件：由系统按主办方的官方规则逐条比对后返回，本机与小青都<b>不替你判定资格</b>。</span>
        <span className="act-rule"><i />能不能抵扣：<b>抵扣功能尚未开放</b>，领到的权益先记在台账里；开放后以使用时的实际结果为准。</span>
        <span className="act-rule" data-no="true"><i />是否收费、收多少：以活动说明与现场公示价为准；补贴类只给说明与官方入口，<b>本机不代办</b>。</span>
      </div>
    </section>
  )
}

const ALT_ROWS = [
  { icon: PrinterIcon, title: '打印与扫描', desc: '实际价格以现场公示与系统报价为准。', to: '/print-scan', tid: 'print' },
  { icon: SparklesIcon, title: 'AI 简历服务', desc: '诊断、优化、生成与材料工坊。', to: '/resume-service', tid: 'resume' },
  { icon: BookOpenIcon, title: '就业政策与补贴指引', desc: '政策原文与官方申请入口，本机不代办。', to: '/renshi', tid: 'policy' },
] as const

export function ServiceAlts({ screen }: { screen: 'activities' | 'activity' }) {
  const navigate = useNavigate()
  return (
    <div className="act-alt">
      <div className="act-alt-h">没有权益也照常可用的服务</div>
      {ALT_ROWS.map((row) => (
        <button
          type="button"
          key={row.to}
          className="act-alt-row"
          data-testid={`${screen}-alt-${row.tid}`}
          onClick={() => navigate(row.to)}
        >
          <span className="act-alt-ic"><row.icon size={26} aria-hidden /></span>
          <span className="act-alt-tx">
            <span className="act-alt-t">{row.title}</span>
            <span className="act-alt-d">{row.desc}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

export function StateBlock({
  tone,
  title,
  testId,
  children,
  actions,
}: {
  tone: 'info' | 'error' | 'warn'
  title: string
  testId: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="act-state" data-kind={tone} data-testid={testId}>
      <div className="act-state-h">{title}</div>
      <p className="act-state-p">{children}</p>
      {actions ? <div className="act-state-acts">{actions}</div> : null}
    </div>
  )
}

export function AskQing({ testId }: { testId: string }) {
  return <QxAiHelp label="问小青" draft={AI_DRAFT} testId={testId} />
}

export function HelpLine() {
  const contact = useSupportContact()
  return <>{helpNeededLine(contact)}</>
}

export function TruthBar() {
  const navigate = useNavigate()
  return (
    <div className="act-truth">
      <p>
        <b>权益只对应本机服务与打印，不等于政府补贴到账。</b>
        补贴类只提供说明、材料清单与官方申请入口；本机不代办、不收取额外费用。
      </p>
      <button type="button" onClick={() => navigate('/help')}>遇到问题</button>
    </div>
  )
}

/** 底栏两层：上面只放按钮，说明和底注各占一行。长句不进按钮的 flex 行。 */
export function ActivityCtaStack({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <div className="act-cta-stack">
      <div className="act-cta-row">{children}</div>
      {note ? <p className="act-cta-note">{note}</p> : null}
      <TruthBar />
    </div>
  )
}
