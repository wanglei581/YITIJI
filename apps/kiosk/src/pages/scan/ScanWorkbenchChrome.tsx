import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { type LucideIcon } from 'lucide-react'
import { AiDownNote } from '../print-scan/AiDownNote'
import { askDraftOf } from '../print-scan/askDraft'
import { UsbArt } from '../print-scan/ToolArt'
import { QxTouchBand } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock, type QxTouchPrimary } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { useAuth } from '../../auth/useAuth'
import { rememberAssistantDraft } from '../../services/assistantDraft'
import { revokeLiveScanSession } from './scanSessionRevoke'
import { clearScanWorkbenchSession } from './scanWorkbenchSession'
import { MaterialThumb } from './ScanGuideArt'
import { SCAN_MATERIALS, type ScanMaterial } from './scanMaterials'
import {
  type ScanWorkbenchState,
} from './scanWorkbench'
import '../print-scan/styles/tool-touch.css'
import { ScanPaperArt } from './ScanPaperArt'
import './styles/scan-workbench-qx.css'
import './styles/scan-workbench-compact-qx.css'
import './styles/scan-fs.css'

const SCAN_RAIL = ['选类型', '扫描指引', '等回传', '扫描完成'] as const
export const SCAN_DEVICE_RAIL = ['扫什么', '怎么扫', '放纸设置', '扫描', '拿走文件'] as const

const SCAN_RAIL_NOW: Record<ScanWorkbenchShellProps['page'], number> = {
  'scan-start': 0,
  'scan-settings': 1,
  'scan-progress': 2,
  'scan-result': 3,
  'scan-how': 1,
  'scan-set': 2,
  'scan-off': 1,
  'scan-run': 3,
  'scan-more': 3,
  'scan-make': 3,
  'scan-done': 4,
  'scan-unknown': 3,
}

const SCAN_EYEBROW: Record<ScanWorkbenchShellProps['page'], string> = {
  'scan-start': '材料扫描',
  'scan-settings': '扫描指引',
  'scan-progress': '等回传',
  'scan-result': '扫描完成',
  'scan-how': '屏上扫描',
  'scan-set': '屏上扫描',
  'scan-off': '屏上扫描',
  'scan-run': '屏上扫描',
  'scan-more': '屏上扫描',
  'scan-make': '屏上扫描',
  'scan-done': '扫描完成',
  'scan-unknown': '屏上扫描',
}

/** 底栏「问小青」的本屏问句，逐态照稿 18（label 与带去顾问页的 draft 是同一句）。 */
function scanAskLabel(page: ScanWorkbenchShellProps['page'], state: ScanWorkbenchState): string {
  if (page === 'scan-run') return '问小青：一直扫不完怎么办'
  if (page === 'scan-more') return '问小青：下一页怎么放'
  if (page === 'scan-make') return '问小青：文件还没出来'
  if (page === 'scan-done') return '问小青：扫描件怎么用'
  if (page === 'scan-unknown') return '问小青：这一步还没有结果'
  if (state === 'usb-panel') return '问小青：U 盘扫描怎么走'
  if (state === 'loading' || state === 'blocked' || state === 'unknown') return '问小青：扫描没开放怎么办'
  if (state === 'create-loading') return '问小青：任务还没建好'
  if (state === 'create-failed' || state === 'invalid' || state === 'cleanup-holding') return '问小青：扫描任务没建好'
  if (state === 'expired') return '问小青：扫描过期了怎么办'
  if (state === 'awaiting-ack') return page === 'scan-progress' ? '问小青：授权还没好' : '问小青：为什么还不能扫'
  if (state === 'failed' || state === 'completed-no-file' || state === 'wait-timeout') return '问小青：扫描失败怎么办'
  if (page === 'scan-how') return '问小青：两种扫法怎么选'
  if (page === 'scan-set') return '问小青：纸怎么放'
  if (page === 'scan-off' || page === 'scan-settings') return '问小青：面板上怎么扫'
  if (page === 'scan-progress') return '问小青：一直等不到怎么办'
  if (page === 'scan-result') return '问小青：扫描件接下来呢'
  return '问小青：扫描和复印有什么不同'
}

function bandTone(tone: 'ok' | 'warn' | 'bad' | 'unknown'): 'ok' | 'warn' | 'unknown' {
  if (tone === 'ok') return 'ok'
  if (tone === 'warn' || tone === 'bad') return 'warn'
  return 'unknown'
}

/** 底栏左边的次按钮。不传时是「返回」，走 leaveScanFlow('/print-scan')。 */
export type ScanDockLeft = {
  label: string
  /** 二选一：leaveTo 走 leaveScanFlow（撤服务端任务、清本机登记再走人），onClick 是页内动作。 */
  leaveTo?: string
  onClick?: () => void
  icon?: 'back' | 'refresh'
  disabled?: boolean
}

/**
 * 底栏三槽：左边次按钮、中间问小青、右边主按钮，照稿 18 和共享底栏一个样子。
 * 主按钮不传就不画（等回传那一屏的「取消扫描」「立即检查」放在正文里，稿就是这么排的）。
 */
export type ScanDock = {
  left?: ScanDockLeft
  /** 为真时不画底栏左边的返回。进行中的屏上扫描用它，避免误触离开。 */
  omitLeft?: boolean
  /** 页面自己画的左槽，例如玻璃台那一屏的停止。 */
  leftNode?: ReactNode
  /** 问小青和主按钮之间的次操作，例如停止扫描。 */
  secondary?: ReactNode
  primary?: QxTouchPrimary
}

export type ScanWorkbenchPageId =
  | 'scan-start'
  | 'scan-settings'
  | 'scan-progress'
  | 'scan-result'
  | 'scan-how'
  | 'scan-set'
  | 'scan-off'
  | 'scan-run'
  | 'scan-more'
  | 'scan-make'
  | 'scan-done'
  | 'scan-unknown'

type ScanWorkbenchShellProps = {
  page: ScanWorkbenchPageId
  state: ScanWorkbenchState
  title: string
  subtitle: ReactNode
  status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  dock?: ScanDock
  layout?: 'stack' | 'spread'
  /** 不传则用这一页的默认眉题。 */
  bandEyebrow?: string
  /** 不传则用面板四步。传 null 表示这一屏不画路径线（未开通屏）。 */
  bandRail?: { labels: readonly string[]; now: number } | null
  bandBackLabel?: string
  /** 为假时藏起顶栏返回。屏上扫描进行中默认藏，避免当成停止。 */
  bandBack?: boolean
  /** 不传则离开整条扫描流程，回到打印扫描。 */
  onBandBack?: () => void
  children: ReactNode
}

export function ScanWorkbenchShell({
  page,
  state,
  title,
  subtitle,
  status,
  dock,
  layout = 'stack',
  bandEyebrow,
  bandRail,
  bandBackLabel,
  bandBack = true,
  onBandBack,
  children,
}: {
  page: ScanWorkbenchPageId
  state: ScanWorkbenchState
  title: string
  subtitle: ReactNode
  status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  dock?: ScanDock
  /**
   * 稿 18 的两种排法：`stack` 最后一块吃余量（选类型 / 面板指引 / 结果预览）；
   * `spread` 给「状态屏」用 —— 卡片按内容收住，余量摊进版块之间，
   * 不在正文底下留一整片空白，也不靠拉伸说明卡去填高度。
   */
  layout?: 'stack' | 'spread'
  bandEyebrow?: string
  bandRail?: { labels: readonly string[]; now: number } | null
  bandBackLabel?: string
  bandBack?: boolean
  onBandBack?: () => void
  children: ReactNode
}) {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const askLabel = scanAskLabel(page, state)
  const rail = bandRail === null ? undefined : (bandRail ?? { labels: SCAN_RAIL, now: SCAN_RAIL_NOW[page] })
  /* 带去顾问页的草稿：不带按钮上的「问小青：」前缀，是一句自然问句（B1）。 */
  const askDraft = askDraftOf(askLabel)
  /**
   * 离开整条扫描流程。四个阶段、四个出口（顶栏返回 + 底栏三项主导航）共用这一条。
   *
   * 2026-09-13 起「离开」要连服务端一起收掉。此前这里只是 navigate：本机不再显示
   * 这场扫描，服务端那个任务却还停在 waiting 等文件 —— 下一位用户走到面板前按下
   * 扫描，文件会被投递给已经离开的这一位。撤销发不出去（断网 / 已终态）也不拦着走人。
   *
   * 底栏三项当天只做了 `navigate(...)`：顶栏返回收得干干净净，而按「首页 / AI 顾问 /
   * 我的」离开的用户，服务端任务和本机登记**两样都留在原地**——同一屏上两个出口
   * 两种命运。所以出口有几个不重要，离开的语义只能有一份：一律
   * 撤服务端 → 清本机登记 → 走人，只有落点不同。
   */
  const leaveScanFlow = (destination: string): void => {
    revokeLiveScanSession(getToken())
    clearScanWorkbenchSession()
    navigate(destination)
  }
  const leftSpec: ScanDockLeft = dock?.left ?? { label: '返回', leaveTo: '/print-scan' }
  return (
    <QxTouchScreen
      className="scan-touch"
      legacyFrame
      testId={`scan-workbench-state-${state}`}
      stateId={state}
      bodyClassName="qxt-body-tight"
      band={
        <QxTouchBand
          kind="compact"
          back={bandBack}
          backLabel={bandBackLabel ?? '返回打印扫描'}
          onBack={onBandBack ?? (() => leaveScanFlow('/print-scan'))}
          eyebrow={bandEyebrow ?? SCAN_EYEBROW[page]}
          title={title}
          sub={subtitle}
          seal={null}
          status={{ text: status.label, tone: bandTone(status.tone) }}
          rail={rail}
        />
      }
      dock={
        <QxTouchDock
          back={false}
          left={dock?.omitLeft ? undefined : (dock?.leftNode ?? (
            <button
              type="button"
              className="qxt-btn qxt-btn-sec"
              disabled={leftSpec.disabled}
              onClick={() => {
                if (leftSpec.leaveTo) leaveScanFlow(leftSpec.leaveTo)
                else leftSpec.onClick?.()
              }}
            >
              <QxTouchIcon name={leftSpec.icon === 'refresh' ? 'refresh' : 'chevL'} size={30} strokeWidth={2.4} />
              {leftSpec.label}
            </button>
          ))}
          secondary={dock?.secondary}
          ask={{
            label: askLabel,
            draft: askDraft,
            voice: true,
            /* 问小青也是「离开整条扫描流程」：先记草稿，再走 leaveScanFlow 撤服务端、清本机登记，
             * 最后返回 false 让底栏不再自己 navigate。 */
            beforeAsk: () => {
              rememberAssistantDraft(askDraft)
              leaveScanFlow('/assistant')
              return false
            },
          }}
          primary={dock?.primary}
        />
      }
      nav={
        /* 底栏三项也是「离开整条扫描流程」，不是页内切换：走同一条 leaveScanFlow，
         *  只有落点不同。任何一个改回裸 navigate，这一屏就又会留下孤儿任务。 */
        <QxTouchNav
          onHome={() => leaveScanFlow('/')}
          onAdvisor={() => leaveScanFlow('/assistant')}
          onProfile={() => leaveScanFlow('/profile')}
        />
      }
    >
      <div
        className="sw-page qxt-scan-scroll"
        data-w2-page={page}
        data-qx-page="scan-workbench"
        data-state={state}
        data-layout={layout}
      >
        <AiDownNote />
        {children}
      </div>
    </QxTouchScreen>
  )
}

export function ScanTypeCards({
  selected,
  onPick,
}: {
  /** null = 还没选（进来不预选，走查 I-16）。 */
  selected: ScanMaterial | null
  onPick: (material: ScanMaterial) => void
}) {
  return (
    <div className="fs-types" role="radiogroup" aria-label="扫什么">
      {SCAN_MATERIALS.map((option) => {
        const on = selected === option.material
        const base = `scan-type-${option.material}`
        /* 单选卡的读屏名只取标题；说明与角标进 aria-describedby。
           不再同时写 aria-pressed（radio 上是非法组合）和盖住整张卡的 aria-label（B2）。 */
        return (
          <button
            key={option.material}
            type="button"
            className="fs-type"
            role="radio"
            aria-checked={on}
            aria-labelledby={`${base}-title`}
            aria-describedby={`${base}-desc ${base}-more`}
            data-testid={`scan-workbench-type-${option.material}`}
            onClick={() => onPick(option.material)}
          >
            <span className="vis" aria-hidden="true"><MaterialThumb material={option.material} /></span>
            <span className="tx">
              <b id={`${base}-title`}>{option.label}</b>
              <span id={`${base}-desc`} className="fs-sub">{option.desc}</span>
              <span id={`${base}-more`} className="fs-sub">
                {option.more}
                {option.chip ? <span className="sx-chips"><span className="sx-chip is-warn">{option.chip}</span></span> : null}
              </span>
            </span>
            <span className="cs-mark" aria-hidden="true"><QxTouchIcon name="check" size={30} strokeWidth={3} /></span>
          </button>
        )
      })}
    </div>
  )
}

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

export function ScanPanelMock({ instructions }: { instructions: string[] }) {
  const count = instructions.length
  return (
    <>
      <div className="sx-steps" data-testid="scan-workbench-instructions">
        {instructions.map((instruction, index) => (
          <div key={`${instruction}-${index}`} className="fs-step">
            <span className="n">{index + 1}</span>
            <b>面板步骤 {index + 1}</b>
            <span className="d">{instruction}</span>
          </div>
        ))}
      </div>
      <div className="fs-scanhero">
        <div className="vis" aria-hidden="true"><ScanPaperArt /></div>
        <p>按上面{count <= 10 ? CN_NUM[count] : count}步，在打印机面板上操作。扫完可以取回原件。</p>
      </div>
    </>
  )
}

/**
 * 状态屏（没建好、没开放、读取中、U 盘、没扫成……）上多出来的高度只给这一块示意小样，不撑空卡
 * （稿 RULES 第 3 条：卡片按内容定高，多出来的地方放实物小样）。只作示意，不代表任何真实进度。
 */
export function ScanSample({ art = 'scan' }: { art?: 'scan' | 'usb' }) {
  const Art = art === 'usb' ? UsbArt : ScanPaperArt
  return (
    <div className="sx-sample" data-testid="scan-sample" aria-hidden="true">
      <Art />
    </div>
  )
}

export function ScanStatusPanel({
  tone,
  icon: Icon,
  title,
  children,
  chips,
  breathe,
}: {
  tone: 'info' | 'error' | 'warn' | 'lock'
  icon?: LucideIcon
  title: string
  children: ReactNode
  chips?: readonly { label: string; tone?: 'ok' | 'warn' }[]
  breathe?: boolean
}) {
  return (
    <div className="sw-state sw-state-hero" data-kind={tone} data-testid="scan-workbench-fallback">
      <div className="sw-state-h">
        {breathe ? <span className="sw-dot breathe" aria-hidden="true" /> : Icon ? <Icon size={28} aria-hidden /> : null}
        {title}
      </div>
      <div className="sw-state-p">{children}</div>
      {chips && chips.length > 0 ? (
        <div className="sw-meta">
          {chips.map((chip) => (
            <span key={chip.label} className={`sw-chip${chip.tone ? ` is-${chip.tone}` : ''}`}>{chip.label}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
