import type { CSSProperties, ReactNode } from 'react'
import { QxTouchCallout } from './QxTouchCallout'
import { QxTouchChip, type QxTouchChipTone } from './QxTouchChip'
import { QxTouchIcon, type QxTouchIconName } from './QxTouchIcon'
import { QxTouchSlab, type QxTouchSlabProps } from './QxTouchSlab'
import { QxTouchTask, type QxTouchTaskProps } from './QxTouchTask'
import { QxTouchTile, type QxTouchTileProps } from './QxTouchTile'

function Section({ title, hint }: { title: string; hint?: string }) {
  return <div className="qxt-sec">{title}{hint ? <small>{hint}</small> : null}</div>
}

function Steps({
  items,
  columns,
  big = false,
}: {
  items: readonly { title: ReactNode; detail?: ReactNode }[]
  columns?: number
  big?: boolean
}) {
  return (
    <div className={`qxt-steps${big ? ' qxt-steps-big' : ''}`} style={{ gridTemplateColumns: `repeat(${columns ?? (big ? 1 : items.length)}, minmax(0, 1fr))` }}>
      {items.map((item, index) => (
        <div className="qxt-step" key={index}>
          <span className="qxt-step-n">{index + 1}</span>
          <b>{item.title}</b>
          {item.detail ? <small>{item.detail}</small> : null}
        </div>
      ))}
    </div>
  )
}

export function QxTouchStateLoading({
  tasks,
  fine,
  toolsTitle,
  tools,
}: {
  tasks: readonly QxTouchTaskProps[]
  fine: string
  toolsTitle: string
  tools: readonly QxTouchTileProps[]
}) {
  return (
    <>
      <div className="qxt-grid2">
        {tasks.map((task, index) => <QxTouchTask key={task.title} index={index} {...task} />)}
      </div>
      <p className="qxt-fine qxt-fine-tight">{fine}</p>
      <Section title={toolsTitle} />
      <div className="qxt-tools">
        {tools.map((tile, index) => <QxTouchTile key={tile.title} layout="stack" index={tasks.length + index} {...tile} />)}
      </div>
    </>
  )
}

export function QxTouchStateEmpty({
  howto,
  stepsTitle,
  steps,
  slabs,
  fine,
}: {
  howto: string
  stepsTitle: string
  steps: readonly string[]
  slabs: readonly QxTouchSlabProps[]
  fine: string
}) {
  return (
    <>
      <QxTouchCallout kind="howto">{howto}</QxTouchCallout>
      <Section title={stepsTitle} />
      <Steps items={steps.map((title) => ({ title }))} />
      {slabs.map((slab, index) => <QxTouchSlab key={slab.title} row index={index + 2} {...slab} />)}
      <QxTouchCallout kind="fine">{fine}</QxTouchCallout>
    </>
  )
}

export function QxTouchStateError({
  file,
  reasonTitle,
  reason,
  slabs,
  remind,
}: {
  file: { badge: string; name: ReactNode; meta: string; chip: string; chipTone?: QxTouchChipTone }
  reasonTitle: string
  reason: string
  slabs: readonly QxTouchSlabProps[]
  remind: string
}) {
  return (
    <>
      <div className="qxt-file qxt-rise">
        <span className="qxt-file-badge">{file.badge}</span>
        <div>
          <b>{file.name}</b>
          <small>{file.meta}</small>
        </div>
        <QxTouchChip tone={file.chipTone ?? 'cin'}>{file.chip}</QxTouchChip>
      </div>
      <div className="qxt-reason-box qxt-rise" style={{ '--i': 1 } as CSSProperties}>
        <h4><QxTouchIcon name="alert" size={30} strokeWidth={2} />{reasonTitle}</h4>
        <p className="qxt-reason">{reason}</p>
      </div>
      {slabs.map((slab, index) => <QxTouchSlab key={slab.title} row index={index + 2} {...slab} />)}
      <QxTouchCallout kind="remind" icon="call">{remind}</QxTouchCallout>
    </>
  )
}

export function QxTouchStateUnavailable({
  primaryTitle,
  primaryHint,
  primary,
  secondaryTitle,
  secondaryHint,
  secondary,
  remind,
}: {
  primaryTitle: string
  primaryHint?: string
  primary: readonly QxTouchTileProps[]
  secondaryTitle: string
  secondaryHint?: string
  secondary: readonly QxTouchTileProps[]
  remind: string
}) {
  return (
    <>
      <Section title={primaryTitle} hint={primaryHint} />
      <div className="qxt-grid2">
        {primary.map((tile, index) => <QxTouchTile key={tile.title} index={index} {...tile} />)}
      </div>
      <Section title={secondaryTitle} hint={secondaryHint} />
      <div className="qxt-grid2">
        {secondary.map((tile, index) => <QxTouchTile key={tile.title} index={primary.length + index} {...tile} />)}
      </div>
      <QxTouchCallout kind="remind" icon="call">{remind}</QxTouchCallout>
    </>
  )
}

export function QxTouchStateDeviceOff({
  tasks,
  laterTitle,
  later,
  remind,
}: {
  tasks: readonly QxTouchTaskProps[]
  laterTitle: string
  later: readonly QxTouchTileProps[]
  remind: string
}) {
  return (
    <>
      <div className="qxt-grid2">
        {tasks.map((task, index) => <QxTouchTask key={task.title} index={index} {...task} />)}
      </div>
      <Section title={laterTitle} />
      <div className="qxt-grid2">
        {later.map((tile, index) => <QxTouchTile key={tile.title} index={tasks.length + index} {...tile} />)}
      </div>
      <QxTouchCallout kind="remind" icon="alert">{remind}</QxTouchCallout>
    </>
  )
}

export function QxTouchStateUnconfirmed({
  steps,
  summary,
  exits,
  row,
  fine,
}: {
  steps: readonly { title: ReactNode; detail: ReactNode }[]
  summary: readonly { label: string; value: ReactNode }[]
  exits: readonly { label: string; onClick: () => void }[]
  row: { icon: QxTouchIconName; title: string; onClick: () => void }
  fine: string
}) {
  return (
    <>
      <Steps items={steps} big />
      <div className="qxt-sum">
        {summary.map((item) => (
          <div className="qxt-sum-r" key={item.label}>
            <span>{item.label}</span>
            <b>{item.value}</b>
            <span />
          </div>
        ))}
      </div>
      <div className="qxt-exits">
        {exits.map((exit) => (
          <button key={exit.label} type="button" className="qxt-btn qxt-btn-sec qxt-btn-exit" onClick={exit.onClick}>
            {exit.label}
          </button>
        ))}
      </div>
      <button type="button" className="qxt-rowlink" onClick={row.onClick}>
        <QxTouchIcon name={row.icon} size={32} strokeWidth={2} />
        <span><b>{row.title}</b></span>
        <span className="qxt-chev"><QxTouchIcon name="chevR" size={28} strokeWidth={2.2} /></span>
      </button>
      <QxTouchCallout kind="fine">{fine}</QxTouchCallout>
    </>
  )
}

export function QxTouchStateAiDown({
  howto,
  exitsTitle,
  exits,
  checksTitle,
  checksNote,
  checks,
}: {
  howto: string
  exitsTitle: string
  exits: readonly QxTouchSlabProps[]
  checksTitle: string
  checksNote: string
  checks: readonly string[]
}) {
  return (
    <>
      <QxTouchCallout kind="howto" icon="alert">{howto}</QxTouchCallout>
      <Section title={exitsTitle} />
      <div className="qxt-exit-col">
        {exits.map((slab, index) => (
          <QxTouchSlab key={slab.title} index={index + 1} {...slab} row compact takeStyle="plain" />
        ))}
      </div>
      <div className="qxt-olist qxt-rise" style={{ '--i': exits.length + 1 } as CSSProperties}>
        <div className="qxt-olist-t">{checksTitle}<span className="qxt-ck">{checksNote}</span></div>
        {checks.map((text, index) => (
          <div className="qxt-check" key={text}><i>{index + 1}</i><span>{text}</span></div>
        ))}
      </div>
    </>
  )
}
