import { useEffect, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ClipboardListIcon,
  FileTextIcon,
  InfoIcon,
  PrinterIcon,
  QrCodeIcon,
  ScaleIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'
import { AUDIENCE_CHIPS, type AudienceKey, type TabKey } from './shared'

export type SourceQrTarget = {
  title: string
  url: string
  sourceKind: string
  sourceDetail: string
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/** 来源二维码：点哪一条就展示哪一条的来源，不做泛化码。 */
export function OfficialEntryQrOverlay({ target, onClose }: { target: SourceQrTarget; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !cardRef.current) return
      const items = [...cardRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea')]
        .filter((node) => !node.hasAttribute('disabled'))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      returnFocus?.focus()
    }
  }, [])

  const host = hostOf(target.url)
  // 稿 48 的来源二维码弹层：标题一行，左边码、右边逐行核对信息，下面一句核对提醒，底部整行「关闭二维码」。
  // 完整来源链接留在右边最后一行：用户照着核对目标域名，不另开网页。
  return (
    <div className="rq-qr-layer" onClick={onClose}>
      <div
        ref={cardRef}
        className="rq-qr-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rq-qr-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="rq-qr-title"><QrCodeIcon aria-hidden="true" />扫码打开来源链接</h2>
        <div className="rq-qr-mid">
          <div className="rq-qr-code"><SourceUrlQr value={target.url} size={300} /></div>
          <dl className="rq-qr-meta">
            <div><dt>本次对象</dt><dd>{target.title}</dd></div>
            <div><dt>来源类型</dt><dd>{target.sourceKind}</dd></div>
            <div><dt>来源说明</dt><dd>{target.sourceDetail}</dd></div>
            <div><dt>目标域名</dt><dd>{host || '无法识别域名'}</dd></div>
            <div><dt>来源链接</dt><dd className="rq-qr-url">{target.url}</dd></div>
          </dl>
        </div>
        <p className="rq-qr-note">
          本系统<b>没有核验过</b>这个链接的官方性，也不代替你办理。请先核对机构和目标域名，确认无误再用手机扫码。
        </p>
        <button ref={closeRef} type="button" className="qx-btn rq-qr-close" data-variant="primary" onClick={onClose}>
          <XIcon aria-hidden="true" />
          关闭二维码
        </button>
      </div>
    </div>
  )
}

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'policy', label: '就业政策', icon: FileTextIcon },
  { key: 'eligibility', label: '条件核对', icon: ScaleIcon },
  { key: 'social', label: '社保指南', icon: ShieldCheckIcon },
  { key: 'register', label: '就业登记', icon: ClipboardListIcon },
  { key: 'notice', label: '政策公告', icon: ScrollTextIcon },
]

export function TabBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <div className="rq-tabs" role="group" aria-label="政策服务任务分区" data-testid="renshi-tabbar">
      {TABS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          className="rq-tab"
          data-testid={`renshi-tab-${key}`}
          aria-pressed={active === key}
          onClick={() => onChange(key)}
        >
          <Icon aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  )
}

export function AudienceFilter({ value, onChange }: { value: AudienceKey; onChange: (k: AudienceKey) => void }) {
  return (
    <div className="rq-aud">
      {/* 稿 48 这里只有一排身份筛选：「先选你的情况」那一行说明不上屏，筛选的用途写在组的无障碍名里。 */}
      <div className="rq-chips" role="group" aria-label="按身份筛选政策事项，通用事项始终展示">
        {AUDIENCE_CHIPS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className="rq-chip"
            aria-pressed={value === key}
            onClick={() => onChange(key)}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function DetailList({ title, items, layout }: { title: string; items: string[]; layout: 'list' | 'cols' | 'steps' }) {
  return (
    <section className={layout === 'cols' ? 'rq-dsec rq-dsec-cols' : 'rq-dsec'}>
      <p className="rq-dsec-h">{title}</p>
      <ul>
        {items.map((text, index) => (
          <li key={`${title}-${index}`}>
            {layout === 'steps' ? <span className="rq-sn">{index + 1}</span> : <CheckCircle2Icon aria-hidden="true" />}
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function EligibilityStepBar({ step }: { step: 1 | 2 }) {
  const steps = ['选你的情况', '看逐条结果']
  return (
    <ol className="k8-elig-steps">
      {steps.map((label, index) => (
        <li key={label} className="k8-elig-step" aria-current={step === index + 1 ? 'step' : undefined}>
          <span className="k8-elig-step-n">{index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  )
}

export function SourceLine({ text }: { text: string }) {
  return <p className="rq-srcline"><InfoIcon aria-hidden="true" /><span>{text}</span></p>
}

function factText(value?: string | null): string {
  const text = value?.trim()
  return text ? text : '—'
}

function factDate(value?: string | null): string {
  const text = value?.trim()
  if (!text) return '—'
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text
}

/**
 * 展开条上的来源小块：来源机构、同步时间、发布日期。缺值写「—」，不拿别的字段填。
 * 发布方的外部编号是系统之间对账用的，用户用不上，不上屏（kiosk-runtime-engineering-words-2026-09-28）。
 */
export function SourceFacts({
  sourceName,
  syncTime,
  publishedOn,
  dateLabel = '发布日期',
}: {
  sourceName?: string | null
  syncTime?: string | null
  publishedOn?: string | null
  dateLabel?: string
}) {
  const cells: [string, string, boolean][] = [
    ['来源机构', factText(sourceName), true],
    ['同步时间', factDate(syncTime), false],
    [dateLabel, factDate(publishedOn), false],
  ]
  return (
    <div className="rq-facts">
      {cells.map(([label, value, slate]) => (
        <span key={label} className={slate ? 'rq-fact rq-fact-slate' : 'rq-fact'}>
          {label} <b>{value}</b>
        </span>
      ))}
    </div>
  )
}

export function CollapsedChevron() {
  return <ChevronDownIcon className="rq-caret" aria-hidden="true" />
}

export interface DeadEndExit {
  key: string
  icon: LucideIcon
  title: string
  desc: string
  onClick: () => void
}

/**
 * 读取中 / 读取失败 / 没有内容 / 做不了这几屏（稿 48 的 deadend）：
 * 状态卡 → 「现在可以做什么」一列出口 → 一句就地说明。出口都不依赖这一次读取，
 * 最后一条固定是上传自备材料打印（只处理用户自己带来的文件，本机随时可用）。
 */
export function RqDeadEnd({
  tone,
  icon: Icon,
  title,
  children,
  exitsHint,
  exits,
  uploadDesc,
  note,
  noteTone = 'info',
  testId,
}: {
  tone: 'info' | 'error' | 'empty' | 'warn'
  icon: LucideIcon
  title: string
  children: ReactNode
  exitsHint: string
  exits: DeadEndExit[]
  uploadDesc: string
  note: ReactNode
  noteTone?: 'info' | 'warn'
  testId?: string
}) {
  const navigate = useNavigate()
  return (
    <div className="rq-deadend">
      <div className="rq-state rq-state-lg" data-kind={tone} data-testid={testId}>
        <b className="rq-state-h">
          <span className="rq-state-ic" aria-hidden="true"><Icon /></span>
          {title}
        </b>
        <p>{children}</p>
      </div>
      <section className="rq-sec rq-exits" aria-label="现在可以做什么">
        <header className="rq-grp rq-grp-plain">
          <b>现在可以做什么</b>
          <span>{exitsHint}</span>
        </header>
        <div className="rq-strip rq-strip-stack">
          {exits.map(({ key, icon: ExitIcon, title: exitTitle, desc, onClick }) => (
            <button key={key} type="button" className="rq-exit" onClick={onClick}>
              <ExitIcon aria-hidden="true" />
              <span><b>{exitTitle}</b><small>{desc}</small></span>
            </button>
          ))}
          <button type="button" className="rq-exit" onClick={() => navigate('/print/upload')}>
            <PrinterIcon aria-hidden="true" />
            <span><b>上传自备材料打印</b><small>{uploadDesc}</small></span>
          </button>
        </div>
      </section>
      <p className={noteTone === 'warn' ? 'rq-note rq-note-warn' : 'rq-note'}>{note}</p>
    </div>
  )
}
