import { type ReactNode, useId, useState } from 'react'
import {
  AlertTriangleIcon,
  BuildingIcon,
  InfoIcon,
  MessageSquareIcon,
  PrinterIcon,
  ScanLineIcon,
  type LucideIcon,
} from 'lucide-react'
import { SourceUrlQr } from '../../SourceUrlQr'

export function DirSec({
  no,
  title,
  hint,
  grow,
  children,
}: {
  no?: string
  title?: string
  hint?: string
  grow?: boolean
  children: ReactNode
}) {
  return (
    <section className={`dw-sec${grow ? ' grow qx-grow' : ''}`}>
      {title ? (
        <div className="dw-sec-h">
          {no ? <span className="no">{no}</span> : null}
          <span className="t">{title}</span>
          {hint ? <span className="hint">{hint}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function DirState({
  tone,
  testId,
  title,
  children,
}: {
  tone: 'empty' | 'error' | 'info'
  testId: string
  title: ReactNode
  children: ReactNode
}) {
  const Icon = tone === 'error' ? AlertTriangleIcon : tone === 'empty' ? BuildingIcon : InfoIcon
  return (
    <div className="qx-state" data-tone={tone} data-testid={testId}>
      <span className="qx-state-ic"><Icon size={28} aria-hidden /></span>
      <div>
        <div className="qx-state-t">{title}</div>
        <div className="qx-state-d">{children}</div>
      </div>
    </div>
  )
}

export function DirKv({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="dw-kv">
      {rows.map(([label, value]) => (
        <div key={label}><span>{label}</span><b>{value || '来源平台未提供'}</b></div>
      ))}
    </div>
  )
}

export function DirTiles({ items }: { items: Array<{ label: string; value: ReactNode; accent?: boolean }> }) {
  return (
    <div className="dw-tiles">
      {items.map((item) => (
        <div key={item.label} className={`dw-tile${item.accent ? ' accent' : ''}`}>
          <div className="tv">{item.value}</div>
          <div className="tl">{item.label}</div>
        </div>
      ))}
    </div>
  )
}

export function DirSteps({ items }: { items: string[] }) {
  return (
    <ol className="dw-steps">
      {items.map((item, index) => (
        <li key={item}><span className="sn">{index + 1}</span><span>{item}</span></li>
      ))}
    </ol>
  )
}

export function DirNote({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <div className={`dw-noteline${warn ? ' warn' : ''}`}>
      <InfoIcon size={23} aria-hidden />
      <span>{children}</span>
    </div>
  )
}

export function DirStripItem({
  icon: Icon,
  tone = 'teal',
  title,
  desc,
  onClick,
}: {
  icon: LucideIcon
  tone?: 'teal' | 'slate' | 'wheat'
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button type="button" className="dw-stripitem" onClick={onClick}>
      <span className={`si-ic ${tone}`}><Icon size={26} aria-hidden /></span>
      <span className="si-tx"><b>{title}</b><span>{desc}</span></span>
    </button>
  )
}

export function DirStrip({ children }: { children: ReactNode }) {
  return <div className="dw-strip">{children}</div>
}

export function DirExitList({ children }: { children: ReactNode }) {
  return <div className="dw-exitlist">{children}</div>
}

export function DirMiss({ items }: { items: string[] }) {
  return (
    <ul className="dw-miss">
      {items.map((item) => (
        <li key={item}><span className="mk">!</span><span>{item}</span></li>
      ))}
    </ul>
  )
}

export function DirQrHero({
  title,
  address,
  url,
  steps,
  reason,
}: {
  title: string
  address: ReactNode
  url: string
  steps: string[]
  reason: string
}) {
  return (
    <div className="dw-blk dw-qrhero">
      <div className="dw-qrhead">
        <h4>{title}</h4>
        <span className="dw-qraddr">目标地址：{address}</span>
      </div>
      <div className="dw-qrbox" data-testid="directory-qr-slot">
        <SourceUrlQr value={url} size={420} />
      </div>
      <div className="dw-qrfoot">
        <DirSteps items={steps} />
        <div className="dw-reason">{reason}</div>
      </div>
    </div>
  )
}

export const OFFLINE_PREP_ITEMS = [
  { icon: PrinterIcon, title: '打印自备材料', desc: '登记表、复印件、自带简历，A4 黑白', to: '/print/upload' },
  { icon: ScanLineIcon, title: '纸质材料扫成 PDF', desc: '在奔图面板上扫，文件回本机取', to: '/scan/start' },
] as const

type AiStep = 'need-input' | 'resume-missing' | 'goal' | 'unavailable'

const AI_COPY = {
  'offline-agency': {
    title: '整理到店要问的问题',
    desc: '按你选的简历或填的方向，整理咨询问题和材料清单。不核验机构资质，也不生成机构或岗位信息。',
    run: '整理咨询问题',
    goalLabel: '求职方向',
    goalHolder: '例如：仓储物流 · 佛山南海',
    needReason: '还没选简历、也没填方向：不会自动读你的文件，也不会先生成内容。',
    goalReason: '方向还没填：填一两个词就能整理。',
    failBody: '本机没有连上 AI 服务，因此不会给你一份编出来的问题清单。',
    fallback: '不靠 AI 也能问清楚：岗位要求、材料清单、收费公示，到店当面确认这三项。',
  },
  'company-directory': {
    title: '按本人简历排出先看哪几家',
    desc: '用你选的简历对比岗位已返回的字段，给出比较依据和先后顺序。不打匹配百分比，也不改企业和岗位事实。',
    run: '按岗位字段排序',
    goalLabel: '求职方向',
    goalHolder: '例如：机械设计 · 3 年 · 珠海',
    needReason: '还没选简历、也没填方向：不会自动读你的文件，也不会先生成排序。',
    goalReason: '方向还没填：填一两个词就能给比较依据。',
    failBody: '本机没有连上 AI 服务，因此不会给你一份编出来的排序。',
    fallback: '不靠 AI 也能筛：地区、行业、来源三组条件照常可用，企业和岗位照常可看。',
  },
  'fair-company': {
    title: '到展位先问哪几句',
    desc: '按现场岗位清单和你填的方向，整理到展位要问的问题。不代投递、不预约、不签到，也不生成企业信息。',
    run: '整理展位提问',
    goalLabel: '求职方向',
    goalHolder: '例如：电气维修 · 应届',
    needReason: '还没选简历、也没填方向：不会自动读你的文件，也不会先生成提问。',
    goalReason: '方向还没填：填一两个词就能整理。',
    failBody: '本机没有连上 AI 服务，因此不会给你一份编出来的提问清单。',
    fallback: '不靠 AI 也能问：岗位要求、到岗时间、后续联系方式，到展位当面问这三项。',
  },
  'online-platform': {
    title: '整理可核对的搜索词',
    desc: '按你选的简历或填的方向，给出岗位名称、技能和地区搜索词，自己在平台里搜。不比较平台优劣，也不替你投递。',
    run: '生成搜索词',
    goalLabel: '求职方向',
    goalHolder: '例如：数控编程 · 中山',
    needReason: '还没选简历、也没填方向：不会自动读你的文件，也不会先生成搜索词。',
    goalReason: '方向还没填：填一两个词就能给搜索词。',
    failBody: '本机没有连上 AI 服务，因此不会给你一组编出来的搜索词。',
    fallback: '不靠 AI 也能搜：岗位名称 + 地区先搜一轮，再按经验年限和学历收窄。',
  },
} as const

export function DirAiAssist({
  screen,
  onProfile,
  onAssistant,
}: {
  screen: keyof typeof AI_COPY
  onProfile: () => void
  onAssistant: () => void
}) {
  const copy = AI_COPY[screen]
  const reasonId = useId()
  const [step, setStep] = useState<AiStep>('need-input')
  const [goal, setGoal] = useState('')
  const canRun = step === 'goal' && goal.trim().length > 0

  return (
    <div className="dw-ai" data-testid={`${screen}-ai`} data-ai-step={step}>
      <span className="dw-ai-ic"><MessageSquareIcon size={26} aria-hidden /></span>
      <div className="dw-ai-main">
        <div className="dw-ai-line">
          <b className="dw-ai-t">{copy.title}</b>
          <span className="dw-ai-ops">
            {step === 'unavailable' ? (
              <button type="button" className="dw-chip" onClick={() => { setStep('need-input'); setGoal('') }}>重新选输入</button>
            ) : (
              <>
                <button type="button" className={`dw-chip${step === 'resume-missing' ? ' on' : ''}`} onClick={() => setStep('resume-missing')}>用本人简历</button>
                <button type="button" className={`dw-chip${step === 'goal' ? ' on' : ''}`} onClick={() => setStep('goal')}>填写求职方向</button>
              </>
            )}
            <button
              type="button"
              className="dw-ai-run"
              aria-disabled={!canRun || undefined}
              aria-describedby={!canRun ? reasonId : undefined}
              onClick={() => { if (canRun) setStep('unavailable') }}
            >
              {copy.run}
            </button>
          </span>
        </div>
        {step === 'unavailable' ? (
          <>
            <div className="dw-ai-fail" data-testid={`${screen}-ai-unavailable`}>
              <b>小青这次没接上</b>
              <span>{copy.failBody}</span>
            </div>
            <span className="dw-ai-note">{copy.fallback}</span>
            <button type="button" className="dw-chip" onClick={onAssistant}>去问小青</button>
          </>
        ) : step === 'resume-missing' ? (
          <>
            <div className="dw-ai-fail">
              <b>本机没有读到可用的本人简历</b>
              <span>可以去「我的简历」选一份，或直接填写求职方向。</span>
            </div>
            <button type="button" className="dw-chip" onClick={onProfile}>去我的简历</button>
            <span className="dw-reason" id={reasonId}>{copy.needReason}</span>
          </>
        ) : step === 'goal' ? (
          <>
            <div className="dw-ai-field">
              <label htmlFor={`${screen}-ai-goal`}>{copy.goalLabel}</label>
              <input
                id={`${screen}-ai-goal`}
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder={copy.goalHolder}
                autoComplete="off"
              />
            </div>
            <span className="dw-ai-note" id={reasonId}>{canRun ? '只用于这一次整理，不写入你的记录；离开本页即清除。' : copy.goalReason}</span>
          </>
        ) : (
          <>
            <span className="dw-ai-d">{copy.desc}</span>
            <span className="dw-reason" id={reasonId}>{copy.needReason}</span>
          </>
        )}
      </div>
    </div>
  )
}

export function isHttpErrorStatus(error: string | null | undefined, status: number): boolean {
  return typeof error === 'string' && error.includes(`（${status}）`)
}
