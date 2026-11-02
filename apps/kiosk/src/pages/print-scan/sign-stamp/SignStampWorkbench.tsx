import { useState } from 'react'
import type { SignStampPosition, SignStampSize } from '@ai-job-print/shared'
import { FsRow } from '../FsRow'
import { PhoneHelpLine } from '../phoneHelp'
import { AUTHORIZATION_LABEL, POSITIONS, SIZES, ZOOMS } from './constants'
import type { ComposePhase, ComposeResult, PickedFile, StatusCopy, ViewMode } from './signStampModel'
import { Fact, Sample } from './SignStampBits'
import { SignStampPreview } from './SignStampPreview'
import { SignStampStatus } from './SignStampStatus'

function posLabel(position: SignStampPosition): string {
  return POSITIONS.find((item) => item.key === position)?.label ?? position
}
function sizeLabel(size: SignStampSize): string {
  return SIZES.find((item) => item.key === size)?.label ?? size
}
function stampSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 这一屏是哪一种：放置（含正在提交）、结果、结果没确认（锁定，只说明与再查）。 */
export type SignWorkLayout = 'place' | 'result' | 'outcome'

export interface SignStampWorkbenchProps {
  layout: SignWorkLayout
  /** 状态卡：放置屏只在出了状况时才画（默认态靠步骤条和摘要说话）。 */
  showCard: boolean
  status: StatusCopy
  document: PickedFile | null
  pages: number | null
  stamp: PickedFile | null
  result: ComposeResult | null
  page: number
  position: SignStampPosition
  size: SignStampSize
  placeErr: string | null
  authorized: boolean
  phase: ComposePhase
  viewPage: number
  viewMode: ViewMode
  zoom: number
  pan: 'br' | null
  outErr: 'render' | 'expired' | null
  locked: boolean
  onPage: (page: number) => void
  onPosition: (position: SignStampPosition) => void
  onSize: (size: SignStampSize) => void
  onAuthorize: () => void
  onViewPage: (page: number) => void
  onViewMode: (mode: ViewMode) => void
  onZoom: (zoom: number) => void
  onPreviewError: () => void
}

/** 更多设置里「怎么看这一页」的四个按钮：适整页、适宽、缩小、放大（改的只是看的样子，不改放哪）。 */
function ViewButtons({
  viewMode,
  zoom,
  onViewMode,
  onZoom,
}: Pick<SignStampWorkbenchProps, 'viewMode' | 'zoom' | 'onViewMode' | 'onZoom'>) {
  const percent = viewMode === 'width' ? 162 : viewMode === 'zoom' ? Math.round((ZOOMS[zoom] ?? 1) * 100) : 100
  return (
    <>
      <p className="fs-h">
        怎么看这一页
        <small data-testid="sign-stamp-pv-zoomlabel">
          {viewMode === 'width' ? '适宽' : viewMode === 'zoom' ? '放大' : '适整页'} · {percent}%
        </small>
      </p>
      <div className="ss-views">
        <button type="button" className="ss-opt" data-testid="sign-stamp-pv-fit-page" aria-pressed={viewMode === 'page'} onClick={() => onViewMode('page')}>适整页</button>
        <button type="button" className="ss-opt" data-testid="sign-stamp-pv-fit-width" aria-pressed={viewMode === 'width'} onClick={() => onViewMode('width')}>适宽</button>
        <button
          type="button"
          className="ss-opt"
          data-testid="sign-stamp-pv-zoom-out"
          disabled={viewMode !== 'zoom' || zoom <= 0}
          onClick={() => {
            const next = Math.max(0, zoom - 1)
            onZoom(next)
            if (next === 0) onViewMode('page')
          }}
        >
          缩小
        </button>
        <button
          type="button"
          className="ss-opt"
          data-testid="sign-stamp-pv-zoom-in"
          disabled={viewMode === 'zoom' && zoom >= ZOOMS.length - 1}
          onClick={() => {
            onViewMode('zoom')
            onZoom(Math.min(ZOOMS.length - 1, viewMode === 'zoom' ? zoom + 1 : 2))
          }}
        >
          放大
        </button>
      </div>
    </>
  )
}

/** 更多设置：页码、九宫格、大小、怎么看。按钮一律 ≥72 高；换页要连着预览一起翻。 */
function SettingsPanel(props: SignStampWorkbenchProps & { goPage: (n: number) => void; disabled: boolean; placing: boolean }) {
  const { page, pages, position, size, placeErr, disabled, placing, goPage } = props
  const count = pages ?? 1
  return (
    <div className="ss-panel" data-testid="sign-stamp-settings">
      <p className="fs-h">
        {placing ? '放第几页' : '看第几页'}
        <small>共 {count} 页</small>
      </p>
      <div className="ss-pages">
        {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className="ss-opt"
            data-testid={`sign-stamp-page-${n}`}
            aria-pressed={n === (placing ? page : props.viewPage)}
            aria-label={placing ? `放在第 ${n} 页` : `看第 ${n} 页`}
            disabled={disabled}
            onClick={() => goPage(n)}
          >
            {n}
          </button>
        ))}
      </div>
      {placeErr ? <p className="fs-p" data-testid="sign-stamp-page-reason">{placeErr}</p> : null}
      {placing ? (
        <>
          <p className="fs-h">放哪个位置</p>
          <div className="ss-nine">
            {POSITIONS.map((pos) => (
              <button
                key={pos.key}
                type="button"
                className="ss-opt"
                data-testid={`sign-stamp-pos-${pos.key}`}
                aria-pressed={pos.key === position}
                aria-label={`放到${pos.label}`}
                disabled={disabled}
                onClick={() => props.onPosition(pos.key)}
              >
                {pos.label}
              </button>
            ))}
          </div>
          <p className="fs-h">多大<small>占页宽 15% / 25% / 35%</small></p>
          <div className="ss-sizes">
            {SIZES.map((item) => (
              <button
                key={item.key}
                type="button"
                className="ss-opt"
                data-testid={`sign-stamp-size-${item.key}`}
                aria-pressed={item.key === size}
                aria-label={`大小${item.label}`}
                disabled={disabled}
                onClick={() => props.onSize(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <ViewButtons viewMode={props.viewMode} zoom={props.zoom} onViewMode={props.onViewMode} onZoom={props.onZoom} />
    </div>
  )
}

function PreviewWell(props: SignStampWorkbenchProps & { burned: boolean }) {
  return (
    <div className="ss-stage">
      <SignStampPreview
        document={props.document}
        stamp={props.stamp}
        result={props.result}
        viewPage={props.viewPage}
        viewMode={props.viewMode}
        zoom={props.zoom}
        pan={props.pan}
        position={props.position}
        size={props.size}
        placePage={props.page}
        burned={props.burned}
        outErr={props.outErr}
        onPreviewError={props.onPreviewError}
      />
    </div>
  )
}

/** 上一页 / 下一页：两个整行按钮并排，走到头就停用。 */
function PageNav({ current, count, disabled, onGo }: { current: number; count: number; disabled: boolean; onGo: (n: number) => void }) {
  return (
    <div className="fs-2">
      <FsRow title="上一页" disabled={disabled || current <= 1} onClick={() => onGo(current - 1)} testId="sign-stamp-pv-prev" />
      <FsRow title="下一页" disabled={disabled || current >= count} onClick={() => onGo(current + 1)} testId="sign-stamp-pv-next" />
    </div>
  )
}

export function SignStampWorkbench(props: SignStampWorkbenchProps) {
  const { layout, showCard, status, document, pages, stamp, result, page, position, size, authorized, phase, locked } = props
  const [moreOpen, setMoreOpen] = useState(false)
  const pageCount = pages ?? 1
  const goPlacePage = (n: number) => {
    props.onPage(n)
    props.onViewPage(n)
  }

  if (layout === 'outcome') {
    return (
      <>
        <SignStampStatus copy={status} />
        <div className="fs-facts">
          <Fact wide title="不另起一次">用同一个标记再查，不重新生成。页码、位置和大小已锁定：改一点就是另一次，可能真的生成两份。</Fact>
          <div className="fs-pairgrid">
            <Fact title="原 PDF">原 PDF：永不改写。没确认之前不写成新文件已经生成。</Fact>
            <Fact title="来源">{document?.name ?? '这次上传的 PDF'} · {stamp?.name ?? '手写签名图'}。</Fact>
          </div>
        </div>
        <PhoneHelpLine />
        <Sample />
      </>
    )
  }

  if (layout === 'result' && result) {
    const settingsProps = { ...props, goPage: props.onViewPage, disabled: false, placing: false }
    return (
      <>
        <SignStampStatus copy={status} />
        <div className="ss-outcard" data-testid="sign-stamp-output">
          <h3>这份生成的新 PDF</h3>
          <div className="ss-kv">
            <div><span>文件名</span><b>{result.name}</b></div>
            <div><span>页数</span><b>{result.pages} 页 · 同原文档</b></div>
            <div><span>大小</span><b>{stampSize(result.sizeBytes)}</b></div>
            <div><span>身份</span><b>新文件 · 原件未改写</b></div>
            <div><span>预览链接</span><b>{props.outErr === 'expired' ? '已过期 · 30 分钟有效' : '有效期 30 分钟'}</b></div>
          </div>
          <div className="ss-kv" data-testid="sign-stamp-used-inputs">
            <div><span>原文档</span><b>{document?.name ?? '—'}</b></div>
            <div><span>签名图</span><b>{stamp?.name ?? '—'}</b></div>
            <div><span>位置</span><b>第 {page} 页 · {posLabel(position)} · {sizeLabel(size)}</b></div>
            <div><span>授权</span><b>已确认</b></div>
          </div>
        </div>
        <PreviewWell {...props} burned />
        <PageNav current={props.viewPage} count={result.pages} disabled={false} onGo={props.onViewPage} />
        <FsRow
          title={moreOpen ? '收起更多设置' : '更多设置'}
          desc="适整页、适宽、放大、翻到第几页"
          testId="sign-stamp-more"
          onClick={() => setMoreOpen((open) => !open)}
        />
        {moreOpen ? <SettingsPanel {...settingsProps} /> : null}
        <p className="fs-p" data-testid="sign-stamp-next-round">
          交出去的就是这份生成的新 PDF，标记不放进地址栏。想再叠一处：原文档换成这份新 PDF，签名图要重新传，授权要重新确认（保留 {result.pages} 页）。去材料检查核对隐私与可打印性，那之后才谈报价；不代表材料已生效，不下单、不出纸、不显示金额。
        </p>
      </>
    )
  }

  // 放置（含正在提交 / 提交后出了状况）
  const settingsProps = { ...props, goPage: goPlacePage, disabled: locked, placing: true }
  return (
    <>
      {showCard ? <SignStampStatus copy={status} /> : null}
      <p className="fs-p" data-testid="sign-stamp-summary">
        第 {page} 页 / 共 {pageCount} 页 · {posLabel(position)} · {sizeLabel(size)}
      </p>
      {locked ? (
        <p className="fs-help" id="sign-stamp-lock-reason" data-testid="sign-stamp-lock-reason">
          {phase === 'result-unknown'
            ? '结果还没确认，页码、位置和大小已锁定：改一点就是另一次，可能真的生成两份。'
            : '正在提交这一次合成，页码、位置和大小已锁定，也不能再次提交，避免生成两份。'}
        </p>
      ) : null}
      {moreOpen ? <SettingsPanel {...settingsProps} /> : <PreviewWell {...props} burned={false} />}
      <PageNav current={page} count={pageCount} disabled={locked} onGo={goPlacePage} />
      <FsRow
        title={moreOpen ? '收起更多设置' : '更多设置'}
        desc="页码、九宫格、大小、适宽和放大"
        testId="sign-stamp-more"
        onClick={() => setMoreOpen((open) => !open)}
      />
      {phase === 'idle' ? (
        <>
          <button
            type="button"
            role="checkbox"
            className="fs-row ss-auth"
            data-testid="sign-stamp-authorize"
            aria-checked={authorized}
            aria-label={AUTHORIZATION_LABEL}
            onClick={props.onAuthorize}
          >
            <span className="box" aria-hidden>
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.6">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <span className="ct">
              <b>{authorized ? '已确认：' : '请先确认：'}</b>
              {AUTHORIZATION_LABEL}。
            </span>
          </button>
          <p className="fs-p">勾选只表示你有这张图的使用权，不是签署协议，不产生法律凭证。伪造印章或冒用他人签名违法，责任自负。换图后要重新确认。</p>
        </>
      ) : (
        <Fact wide title="本次提交保留了什么">
          原文档 {document ? `${document.name} · ${pageCount} 页` : '—'}；签名图 {stamp ? `${stamp.name} · 这一次` : '—'}；授权 {authorized ? '已确认' : '未确认'}；标记已绑定，不显示编号。不用重传。
        </Fact>
      )}
      <p className="fs-p">原 PDF：永不改写。签名图大约 1 小时后清除，不进「我的文档」。不画进度条，也不自动重试。</p>
    </>
  )
}
