// ============================================================
// PrintScanFeatureInfoPage — /print-scan/feature/:key
//
// 视觉真值：docs/design/kiosk-redesign-2026-08-v2/10-print-hub.html
//   state: feature-id-photo | feature-not-found（稿里有）
//          feature-copy（2.0 稿里没有：R4，2026-09-29 产品负责人拍板复印走打印机面板；
//                        11/02 起照补稿 docs/design/kiosk-touch-2026-11-copyscan 的 cs-copy-guide、cs-copy-guide-more）
// 证件照当前只有说明 + 两条真实替代路径，不做排版 / 换底 / 成品生成。
// 复印只有「怎么在打印机面板上复印」的图文说明（两个视图），不经过本机下单，不宣称复印结果。
// ============================================================

import { Fragment, useId, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import { FilesIcon, PointerIcon, PrinterIcon, ShieldIcon, SlidersHorizontalIcon, Undo2Icon } from 'lucide-react'
import { QxTouchIcon, type QxTouchIconName } from '../../components/qingxu/touch/QxTouchIcon'
import { ScanPaperArt } from '../scan/ScanPaperArt'
import {
  COPY_GUIDE_CASES, COPY_GUIDE_CASES_ROUTE, COPY_GUIDE_CASES_VIEW, COPY_GUIDE_KEY, COPY_GUIDE_LEGAL,
  COPY_GUIDE_ROUTE, COPY_GUIDE_STEPS, HUB_PILL,
  type CopyGuideCase, type CopyGuideStep, type HubFeatureState,
} from './printHubContent'
import {
  PrintHubRecordNotes,
  PrintHubTruth,
  PrintHubEmphasis,
  type QxPrintQuickLinkView,
} from './components/QxPrintHubView'
import { PhoneHelpLine } from './phoneHelp'
import { useXiaoqingAvailability } from './useXiaoqingAvailability'
import { toolBandStatus } from './toolBand'
import { FsRow } from './FsRow'
import { DocStackArt, IdCardArt } from './ToolArt'
import { TouchToolScreen } from './TouchToolScreen'
import './styles/print-hub-qx.css'

const PHOTO_FALLBACK = '/print/upload?source=document&category=photo'
const SCAN_FALLBACK = '/scan'
/** 复印说明页的主按钮：有电子版要打，走「文档打印」同一个入口。 */
const DOC_PRINT_ENTRY = '/print/upload?source=document'

const RECORD_LINKS: readonly (QxPrintQuickLinkView & { to: string })[] = [
  { key: 'documents', icon: FilesIcon, title: '我的文档', description: '已上传 / 生成的文件', to: '/me/documents' },
  { key: 'print-orders', icon: PrinterIcon, title: '打印订单', description: '任务状态与到机码', to: '/me/print-orders' },
]

function featureState(key: string | undefined): HubFeatureState {
  if (key === 'id-photo') return 'feature-id-photo'
  if (key === COPY_GUIDE_KEY) return 'feature-copy'
  return 'feature-not-found'
}

// ── 复印说明：配图与两个视图（样式在 print-hub-qx.css 末尾，.qx-copy-guide-） ───────────
// 画法照补稿 docs/design/kiosk-touch-2026-11-copyscan。只画手册核实过的：玻璃、进纸器、打印机面板主屏、出纸口、双面的两张纸；
// 不画设置屏、开始键的位置，也不画身份证、票据在玻璃上的位置和翻面（手册没写）。不出现品牌名、型号；颜色走令牌，不写裸色值。

/** 玻璃：一页纸字朝下，对齐左上角（绿色角标）。 */
function GlassArt() {
  return (
    <svg className="qx-copy-guide-svg" viewBox="0 0 150 150" aria-hidden="true">
      <rect x="8" y="22" width="134" height="108" rx="14" fill="var(--sx-art-base)" />
      <rect x="20" y="34" width="110" height="84" rx="8" fill="var(--qxt-art-track)" stroke="var(--sx-art-top)" strokeWidth="2" />
      <rect x="30" y="46" width="52" height="64" rx="3" fill="var(--sx-art-sheet)" stroke="var(--sx-art-base)" strokeWidth="2" />
      {[[56, 34], [68, 26], [80, 34], [92, 22]].map(([y, w]) => (
        <rect key={y} x="38" y={y} width={w} height="5" rx="2" fill="var(--sx-art-line)" />
      ))}
      <path d="M22 62V36h26" fill="none" stroke="var(--qx-teal)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="14" y="132" width="122" height="6" rx="3" fill="var(--sx-art-top)" />
    </svg>
  )
}

/** 进纸器：一叠纸字朝上放进口里，箭头向下。 */
function FeederArt() {
  return (
    <svg className="qx-copy-guide-svg" viewBox="0 0 150 150" aria-hidden="true">
      <rect x="8" y="82" width="134" height="50" rx="12" fill="var(--sx-art-base)" />
      <path d="M26 82 36 20H116L124 82Z" fill="var(--qxt-art-track)" stroke="var(--sx-art-top)" strokeWidth="2" />
      <rect x="48" y="26" width="58" height="38" rx="3" fill="var(--sx-art-sheet)" stroke="var(--sx-art-base)" strokeWidth="2" transform="rotate(-4 77 45)" />
      <rect x="44" y="22" width="58" height="38" rx="3" fill="var(--sx-art-sheet)" stroke="var(--sx-art-base)" strokeWidth="2" />
      <rect x="52" y="31" width="34" height="5" rx="2" fill="var(--sx-art-line)" />
      <rect x="52" y="42" width="26" height="5" rx="2" fill="var(--sx-art-line)" />
      <path d="M126 22v22M118 36l8 8 8-8" fill="none" stroke="var(--qx-teal)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="20" y="70" width="110" height="18" rx="8" fill="var(--sx-art-top)" />
      <rect x="30" y="104" width="90" height="6" rx="3" fill="var(--qx-emerald)" />
    </svg>
  )
}

/** 出纸口：托盘里三张纸，样子同补稿 cs-copy-done。 */
function TrayArt() {
  const sheet = (dy: number, rotate: number) => (
    <g key={dy} transform={`translate(0 ${dy}) rotate(${rotate} 310 276)`}>
      <rect x="150" y="276" width="320" height="118" rx="6" fill="var(--sx-art-sheet)" stroke="var(--qxt-art-edge)" strokeWidth="3" />
      {[306, 328, 350].map((y) => <rect key={y} x="178" y={y} width="202" height="8" rx="4" fill="var(--sx-art-line)" />)}
    </g>
  )
  return (
    <svg className="qx-copy-guide-svg" viewBox="0 0 620 600" aria-hidden="true">
      <rect x="70" y="40" width="480" height="70" rx="18" fill="var(--qxt-art-track)" stroke="var(--sx-art-base)" strokeWidth="2" />
      <rect x="60" y="100" width="500" height="380" rx="30" fill="var(--qxt-art-track)" stroke="var(--sx-art-base)" strokeWidth="2" />
      <rect x="420" y="128" width="112" height="64" rx="12" fill="var(--sx-art-ink)" />
      <rect x="432" y="140" width="62" height="40" rx="6" fill="var(--qx-teal)" />
      <circle cx="512" cy="160" r="8" fill="var(--qx-emerald)" />
      <rect x="130" y="250" width="360" height="22" rx="11" fill="var(--sx-art-ink)" />
      <rect x="150" y="256" width="320" height="10" rx="5" fill="var(--qx-emerald)" opacity="0.35" />
      <path d="M110 440h400l-30 70H140z" fill="var(--sx-art-base)" stroke="var(--sx-art-top)" strokeWidth="2" />
      <rect x="90" y="505" width="440" height="22" rx="11" fill="var(--sx-art-top)" />
      {[[124, -2], [120, 1.5], [116, 0]].map(([dy, rotate]) => sheet(dy, rotate))}
    </svg>
  )
}

/** 双面：第一面印完，原件从进纸器出口出来，照原样放回进纸口。两张纸上同一个字母在同一个角，表示朝向不变。 */
function FlipArt() {
  const sheet = (x: number) => (
    <g transform={`translate(${x} 14)`}>
      <rect width="112" height="156" rx="10" fill="var(--sx-art-sheet)" stroke="var(--sx-art-top)" strokeWidth="2.5" />
      <text x="16" y="62" fontSize="56" fontWeight="800" fill="var(--qx-teal)">A</text>
      {[[84, 72], [104, 58], [124, 72]].map(([y, w]) => <rect key={y} x="16" y={y} width={w} height="7" rx="3" fill="var(--sx-art-line)" />)}
    </g>
  )
  return (
    <svg className="qx-copy-guide-svg qx-copy-guide-flip" width="496" height="244" viewBox="0 0 460 226" role="img" aria-label="第一面印完，原件从进纸器出口出来，照原样放回进纸口，不翻面、不转方向；两张纸上的字母 A 在同一个角">
      {sheet(8)}
      {sheet(340)}
      <path d="M142 92H318M296 70l24 22-24 22" fill="none" stroke="var(--qx-teal)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <text x="230" y="62" textAnchor="middle" fontSize="24" fontWeight="700" fill="var(--qxt-teal-ink)">原样放回</text>
      {[[230, 140, '不翻面、不转方向'], [64, 204, '第一面印完'], [396, 204, '放回进纸口']].map(([x, y, label]) => (
        <text key={label} x={x} y={y} textAnchor="middle" fontSize="22" fill="var(--qxt-ink-2)">{label}</text>
      ))}
    </svg>
  )
}

const PANEL_BUTTONS: readonly { key: 'copy' | 'scan' | 'id' | 'bill'; icon: QxTouchIconName; lines: readonly string[] }[] = [
  { key: 'copy', icon: 'copy', lines: ['复印'] },
  { key: 'scan', icon: 'scan', lines: ['扫描'] },
  { key: 'id', icon: 'idcard', lines: ['身份证', '复印'] },
  { key: 'bill', icon: 'receipt', lines: ['票据', '复印'] },
]

/**
 * 打印机面板主屏：触摸屏上一排四个按钮、最下面一条状态栏；触摸屏左边竖排三个实体键（返回、主页、说明）。
 * lit='all'：第 2 步，突出「复印」，身份证复印、票据复印次级突出，主页键描边；
 * lit='id' / 'bill'：第二视图，只突出对应那一个按钮。
 */
function PanelArt({ lit, compact }: { lit: 'all' | 'id' | 'bill'; compact?: boolean }) {
  return (
    <div
      className="qx-copy-guide-panel"
      data-size={compact ? 'md' : undefined} role="img"
      aria-label="打印机触摸屏主屏：一排四个按钮，复印、扫描、身份证复印、票据复印；触摸屏左边三个实体键"
    >
      <div className="qx-copy-guide-keys">
        <span className="qx-copy-guide-key"><Undo2Icon size={30} strokeWidth={2.2} /></span>
        <span className="qx-copy-guide-key" data-lit={lit === 'all' ? 'home' : undefined}><QxTouchIcon name="home" size={30} strokeWidth={2.2} /></span>
        <span className="qx-copy-guide-key"><QxTouchIcon name="help" size={30} strokeWidth={2.2} /></span>
      </div>
      <div className="qx-copy-guide-scr">
        <div className="qx-copy-guide-btns">
          {PANEL_BUTTONS.map((button) => {
            const on = lit === 'all' ? button.key === 'copy' : button.key === lit
            const sub = lit === 'all' && (button.key === 'id' || button.key === 'bill')
            return (
              <span key={button.key} className="qx-copy-guide-b" data-tone={on ? 'on' : sub ? 'sub' : undefined}>
                <QxTouchIcon name={button.icon} size={compact ? 40 : 42} strokeWidth={2} />
                <span className="qx-copy-guide-lab">
                  {button.lines.map((line, index) => <Fragment key={line}>{index > 0 ? <br /> : null}{line}</Fragment>)}
                </span>
                {on ? <PointerIcon className="qx-copy-guide-tap" size={40} strokeWidth={1.8} /> : null}
              </span>
            )
          })}
        </div>
        <div className="qx-copy-guide-bar"><i />就绪</div>
      </div>
    </div>
  )
}

/** 两条提醒：不得复印伪造的证件、印章、票据；复印件和原件一起带走。big 为真时第一条放大（第二视图，正好在说身份证、票据之后）。 */
function CopyGuideNotes({ big }: { big?: boolean }) {
  const legalLines = COPY_GUIDE_LEGAL.match(/[^。]+。/g) ?? [COPY_GUIDE_LEGAL]
  return (
    <div className="qx-copy-guide-notes">
      {big ? (
        <div className="qx-copy-guide-big" data-disclaimer="true" data-testid="print-hub-copy-legal">
          <ShieldIcon size={52} strokeWidth={1.8} aria-hidden="true" />
          <span>{legalLines.map((line) => <span key={line} className="qx-copy-guide-line">{line}</span>)}</span>
        </div>
      ) : (
        <div className="qxt-remind" data-disclaimer="true" data-testid="print-hub-copy-legal">
          <ShieldIcon size={34} strokeWidth={2} aria-hidden="true" />
          <span>{COPY_GUIDE_LEGAL}</span>
        </div>
      )}
      <div className="qxt-remind qx-copy-guide-take" data-testid="print-hub-copy-take-original">
        <QxTouchIcon name="call" size={34} strokeWidth={2} />
        <div className="qx-copy-guide-taketx">
          <span>复印件和原件一起带走。原件还在玻璃上或进纸口里，请务必取回。</span>
          <PhoneHelpLine />
        </div>
      </div>
    </div>
  )
}

const ROW_ART: Record<NonNullable<CopyGuideStep['art']>, ReactNode> = {
  settings: <span className="qx-copy-guide-well"><SlidersHorizontalIcon size={48} strokeWidth={1.8} aria-hidden="true" /></span>,
  tap: <span className="qx-copy-guide-well"><PointerIcon size={48} strokeWidth={1.8} aria-hidden="true" /></span>,
  tray: <span className="qx-copy-guide-tray"><TrayArt /></span>,
}

/** 整卡步骤的外框：序号圆章 + 标题，正文各步自己放。 */
function StepCard({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="qx-copy-guide-card" data-step={n}>
      <span className="qx-copy-guide-n" aria-hidden="true">{n}</span>
      <div className="qx-copy-guide-m">
        <h2 className="qx-copy-guide-h">{title}</h2>
        {children}
      </div>
    </li>
  )
}

/** 第一视图：五步配图。第 1、2 步是整卡，第 3–5 步并成一张卡里的三行。 */
function CopyStepsView() {
  const navigate = useNavigate()
  const titleId = useId()
  const descId = useId()
  const firstRow = COPY_GUIDE_STEPS.findIndex((step) => !step.places && !step.picks)
  return (
    <>
      <ol className="qx-copy-guide-steps" data-testid="print-hub-copy-steps">
        {COPY_GUIDE_STEPS.map((step, index) => {
          const n = index + 1
          if (step.places) {
            return (
              <StepCard key={step.title} n={n} title={step.title}>
                <div className="qx-copy-guide-two">
                  {step.places.map((place) => (
                    <div key={place.art} className="qx-copy-guide-pick">
                      <span className="qx-copy-guide-vis" aria-hidden="true">{place.art === 'feeder' ? <FeederArt /> : <GlassArt />}</span>
                      <p className="qx-copy-guide-p"><b>{place.lead}</b>{place.text}</p>
                    </div>
                  ))}
                </div>
                {step.tip ? <p className="qx-copy-guide-warn"><QxTouchIcon name="alert" size={28} strokeWidth={2} /><span>{step.tip}</span></p> : null}
              </StepCard>
            )
          }
          if (step.picks) {
            return (
              <StepCard key={step.title} n={n} title={step.title}>
                {step.tip ? <p className="qx-copy-guide-p qx-copy-guide-hint"><QxTouchIcon name="home" size={28} strokeWidth={2} /><span>{step.tip}</span></p> : null}
                <div className="qx-copy-guide-sp">
                  <PanelArt lit="all" />
                  <div className="qx-copy-guide-tx">
                    {step.picks.map((pick) => (
                      <p key={pick.button} className="qx-copy-guide-p"><b>{pick.lead}</b>点<b>{pick.button}</b></p>
                    ))}
                    <button
                      type="button" className="qx-copy-guide-more" data-testid="print-hub-copy-cases-entry"
                      aria-labelledby={titleId} aria-describedby={descId} onClick={() => navigate(COPY_GUIDE_CASES_ROUTE)}
                    >
                      <QxTouchIcon name="idcard" size={40} strokeWidth={2} />
                      <span className="qx-copy-guide-moretx">
                        <b id={titleId}>这几种原件这样复印</b>
                        <small id={descId}>身份证、发票、双面</small>
                      </span>
                      <QxTouchIcon name="chevR" size={28} strokeWidth={2.4} />
                    </button>
                  </div>
                </div>
              </StepCard>
            )
          }
          return (
            <li
              key={step.title}
              className="qx-copy-guide-row"
              data-step={n}
              data-pos={index === firstRow ? 'first' : index === COPY_GUIDE_STEPS.length - 1 ? 'last' : 'mid'}
            >
              <span className="qx-copy-guide-n" aria-hidden="true">{n}</span>
              <div className="qx-copy-guide-m">
                <h2 className="qx-copy-guide-h">{step.title}</h2>
                <p className="qx-copy-guide-p">{step.body}</p>
              </div>
              <span className="qx-copy-guide-art">{step.art ? ROW_ART[step.art] : null}</span>
            </li>
          )
        })}
      </ol>
      <CopyGuideNotes />
    </>
  )
}

const CASE_MARKS = ['「身份证复印」', '「票据复印」', '「双面复印」', '「复印」'] as const
const CASE_NOWRAP = '需要时改设置'

/** 屏上按钮名加粗；「需要时改设置」不许断在字中间（补稿的 .nw）。 */
function CaseBody({ text }: { text: string }) {
  const [head, tail] = text.split(CASE_NOWRAP)
  if (tail === undefined) return <PrintHubEmphasis text={text} marks={CASE_MARKS} />
  return <><PrintHubEmphasis text={head} marks={CASE_MARKS} /><span className="qx-copy-guide-nw">{CASE_NOWRAP}</span><PrintHubEmphasis text={tail} marks={CASE_MARKS} /></>
}

/** 第二视图：身份证、发票收据、正反两面都有字，各一张图一段话一条小提示。小青接不上时正文多一行提示，法律提醒缩成细条（补稿同）。 */
function CopyCasesView() {
  const aiDown = useXiaoqingAvailability() === 'unavailable'
  const art = (key: CopyGuideCase['key']) => (key === 'id-card' ? <PanelArt lit="id" compact /> : key === 'receipt' ? <PanelArt lit="bill" compact /> : <FlipArt />)
  return (
    <>
      <div className="qx-copy-guide-kinds">
        {COPY_GUIDE_CASES.map((item) => (
          <section
            key={item.key}
            className="qx-copy-guide-kind"
            data-testid={`print-hub-copy-case-${item.key}`}
            data-pending={item.pending || undefined}
          >
            <div className="qx-copy-guide-pic">{art(item.key)}</div>
            <div className="qx-copy-guide-ktx">
              <h2 className="qx-copy-guide-kh">{item.title}</h2>
              <p className="qx-copy-guide-p"><CaseBody text={item.body} /></p>
              <p className="qx-copy-guide-pill" data-tone={item.key === 'duplex' ? 'clay' : undefined}>
                <QxTouchIcon name={item.key === 'duplex' ? 'clock' : 'eye'} size={28} strokeWidth={2} />
                <span>{item.note}</span>
              </p>
            </div>
          </section>
        ))}
      </div>
      <CopyGuideNotes big={!aiDown} />
    </>
  )
}

/** /print-scan/feature/copy：同一路由两个视图，?view=cases 是第二视图，它的返回回到第一视图。 */
function CopyGuide({ pill }: { pill: ReturnType<typeof toolBandStatus> }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const cases = params.get('view') === COPY_GUIDE_CASES_VIEW
  return (
    <TouchToolScreen
      eyebrow="复印"
      status={pill}
      askLabel="问小青：复印要注意什么"
      primary={{ label: '去打印文件', onClick: () => navigate(DOC_PRINT_ENTRY), testId: 'print-hub-primary' }}
      title={cases ? '这几种原件这样复印' : '怎么在打印机上复印'}
      sub={cases
        ? '身份证、发票收据、正反两面都有字，各有一点不同。'
        : '复印不用在这台屏幕上下单，也不会出现在「我的打印订单」里。照下面五步做就行。'}
      backLabel={cases ? '返回' : undefined}
      onBack={() => (cases ? navigate(COPY_GUIDE_ROUTE, { replace: true }) : navigate('/print-scan'))}
    >
      <div
        className="qx-scroll ph-page sx-page qx-copy-guide-page"
        data-w2-page="print-scan-feature"
        data-qx-page="print-hub"
        data-state="feature-copy"
        data-view={cases ? COPY_GUIDE_CASES_VIEW : 'steps'}
        data-testid="print-hub-state-feature-copy"
      >
        {cases ? <CopyCasesView /> : <CopyStepsView />}
      </div>
    </TouchToolScreen>
  )
}

export function PrintScanFeatureInfoPage() {
  const navigate = useNavigate()
  const { key } = useParams<{ key: string }>()
  const hubState = featureState(key)
  const found = hubState !== 'feature-not-found'
  const pill = toolBandStatus(HUB_PILL[hubState])

  if (!found) {
    return (
      <TouchToolScreen
        eyebrow="打印扫描"
        title="这个能力名我不认识"
        sub="地址里的能力名对不上现有说明"
        status={pill}
        onBack={() => navigate('/print-scan')}
        askLabel="问小青：这个功能是什么"
        primary={{ label: '返回打印扫描', onClick: () => navigate('/print-scan'), testId: 'print-hub-primary' }}
      >
        <div
          className="qx-scroll ph-page sx-page"
          data-w2-page="print-scan-feature"
          data-qx-page="print-hub"
          data-state="feature-not-found"
          data-testid="print-hub-state-feature-not-found"
        >
          <div className="fs-facts">
            <div className="fs-fact wide" data-testid="print-hub-fallback">
              <b>没有这项能力说明</b>
              <span>这个名字不在复印、证件照这些说明里。本页不编一套步骤。多半是旧二维码或旧链接。</span>
            </div>
            <div className="fs-pairgrid">
              <div className="fs-fact">
                <b>复印</b>
                <span>复印的说明在「怎么在打印机上复印」。</span>
              </div>
              <div className="fs-fact">
                <b>证件照</b>
                <span>证件照这一页写的是尚未开放，和两条替代路径。</span>
              </div>
              <div className="fs-fact">
                <b>下一步</b>
                <span>回到打印扫描，从那里选已经有的功能。</span>
              </div>
            </div>
          </div>
          <FsRow title="看证件照说明" desc="证件照这一页写的是尚未开放，和两条替代路径" onClick={() => navigate('/print-scan/feature/id-photo')} />
          <PrintHubRecordNotes
            links={RECORD_LINKS}
            onOpen={(linkKey) => {
              if (linkKey === COPY_GUIDE_KEY) {
                navigate(COPY_GUIDE_ROUTE)
                return
              }
              const link = RECORD_LINKS.find((item) => item.key === linkKey)
              if (link) navigate(link.to)
            }}
          />
          <footer className="ph-foot">
            <PrintHubTruth />
            <PhoneHelpLine />
          </footer>
        </div>
      </TouchToolScreen>
    )
  }

  if (hubState === 'feature-copy') return <CopyGuide pill={pill} />

  return (
    <TouchToolScreen
      eyebrow="证件照"
      title="证件照：本机尚未开放"
      sub="现在不能裁切、换底色或排版，也不会生成证件照成品"
      status={pill}
      onBack={() => navigate('/print-scan')}
      askLabel="问小青：证件照怎么办"
      primary={{ label: '先用照片打印', onClick: () => navigate(PHOTO_FALLBACK), testId: 'print-hub-primary' }}
    >
      <div
        className="qx-scroll ph-page sx-page"
        data-w2-page="print-scan-feature"
        data-qx-page="print-hub"
        data-state="feature-id-photo"
        data-testid="print-hub-state-feature-id-photo"
      >
        <div className="fs-idhead" data-testid="print-hub-idphoto-unavailable">
          <div className="vis" aria-hidden="true"><IdCardArt /></div>
          <div>
            <h2>本机暂未开放证件照</h2>
            <p>已经有电子版可以按照片打印；只有纸质的，先在打印机上扫描。裁切、换底色和排版都不在这台机器上做。</p>
          </div>
        </div>
        <div className="fs-pair">
          <button type="button" className="fs-act" data-testid="print-hub-idphoto-fallback" onClick={() => navigate(PHOTO_FALLBACK)}>
            <span className="vis" aria-hidden="true"><DocStackArt /></span>
            <span className="tx"><h3>已经有证件照文件</h3><p>传到这台机器，按普通照片打印。尺寸和底色以你手上的原图为准。</p></span>
            <span className="go" aria-hidden="true"><QxTouchIcon name="chevR" size={28} strokeWidth={2.2} /></span>
          </button>
          <button type="button" className="fs-act" data-testid="print-hub-idphoto-scan" onClick={() => navigate(SCAN_FALLBACK)}>
            <span className="vis" aria-hidden="true"><ScanPaperArt /></span>
            <span className="tx"><h3>只有纸质照片</h3><p>在打印机面板上扫描，回到这台机器取电子版。扫描不做裁切和换底色。</p></span>
            <span className="go" aria-hidden="true"><QxTouchIcon name="chevR" size={28} strokeWidth={2.2} /></span>
          </button>
        </div>
        <div className="fs-plan">
          <div className="hd"><b>以后会做</b><span className="sx-chip">规划，不是承诺</span></div>
          <ol>
            <li>选常见规格与底色（一寸 / 二寸 / 小一寸）。</li>
            <li>按纸张规格自动排版，确认张数后进入打印流程。</li>
            <li>证件照属敏感文件，按短期留存策略清理。</li>
          </ol>
          <p className="fs-p" data-disclaimer="true">{COMPLIANCE_COPY.KIOSK_PRINT_SCAN_SENSITIVE}</p>
        </div>
        <footer className="ph-foot">
          <PrintHubTruth />
          <PhoneHelpLine />
        </footer>
      </div>
    </TouchToolScreen>
  )
}
