import { CheckCircleIcon, ShieldIcon, StampIcon } from 'lucide-react'
import type { SignStampPosition, SignStampSize } from '@ai-job-print/shared'
import { AUTHORIZATION_LABEL, POSITIONS, SIZES } from './constants'
import type { ComposePhase, ComposeResult, PickedFile, StatusCopy, ViewMode } from './signStampModel'
import { isLockedPhase } from './signStampModel'
import { SignStampPreview } from './SignStampPreview'
import { SignStampStatus } from './SignStampStatus'

function posLabel(position: SignStampPosition): string {
  return POSITIONS.find((item) => item.key === position)?.label ?? position
}
function sizeLabel(size: SignStampSize): string {
  return SIZES.find((item) => item.key === size)?.label ?? size
}

export function SignStampWorkbench({
  status,
  document,
  pages,
  stamp,
  result,
  page,
  position,
  size,
  placeErr,
  authorized,
  phase,
  viewPage,
  viewMode,
  zoom,
  pan,
  outErr,
  locked,
  onPage,
  onPosition,
  onSize,
  onAuthorize,
  onViewPage,
  onViewMode,
  onZoom,
  onPreviewError,
}: {
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
}) {
  const pageCount = pages ?? 1
  const done = phase === 'completed' || phase === 'recovered'
  const burned = done && Boolean(result)
  const disableParams = locked || done

  return (
    <>
      <div className="ss-status">
        <SignStampStatus copy={status} />
      </div>
      <div className="ss-work">
        <SignStampPreview
          document={document}
          pages={pages}
          stamp={stamp}
          result={result}
          viewPage={viewPage}
          viewMode={viewMode}
          zoom={zoom}
          pan={pan}
          position={position}
          size={size}
          placePage={page}
          burned={burned}
          outErr={outErr}
          onViewPage={onViewPage}
          onViewMode={onViewMode}
          onZoom={onZoom}
          onPreviewError={onPreviewError}
        />
        <section className="ss-ctrlcol" aria-label="叠加参数">
          {done && result ? (
            <>
              <div className="ss-grp">
                <h3>
                  <CheckCircleIcon size={24} />
                  这份派生 PDF
                </h3>
                <div className="ss-kv" data-testid="sign-stamp-output">
                  <div>
                    <span>文件名</span>
                    <b>{result.name}</b>
                  </div>
                  <div>
                    <span>页数</span>
                    <b>{result.pages} 页 · 同原文档</b>
                  </div>
                  <div>
                    <span>大小</span>
                    <b>{stampSize(result.sizeBytes)}</b>
                  </div>
                  <div>
                    <span>身份</span>
                    <b>新文件 · 原件未改写</b>
                  </div>
                  <div>
                    <span>预览链接</span>
                    <b>{outErr === 'expired' ? '已过期 · 30 分钟有效' : '有效期 30 分钟'}</b>
                  </div>
                </div>
                <p className="note">交接的就是这份派生 PDF，标识不进地址栏。图片排版，不是电子签名。</p>
              </div>
              <div className="ss-grp">
                <h3>这一次用的输入</h3>
                <div className="ss-kv" data-testid="sign-stamp-used-inputs">
                  <div>
                    <span>原文档</span>
                    <b>{document?.name ?? '—'}</b>
                  </div>
                  <div>
                    <span>签名图</span>
                    <b>{stamp?.name ?? '—'}</b>
                  </div>
                  <div>
                    <span>位置</span>
                    <b>
                      第 {page} 页 · {posLabel(position)} · {sizeLabel(size)}
                    </b>
                  </div>
                  <div>
                    <span>授权</span>
                    <b>已确认</b>
                  </div>
                </div>
              </div>
              <div className="ss-grp">
                <h3>
                  <StampIcon size={24} />
                  想再叠一处
                </h3>
                <div className="ss-kv" data-testid="sign-stamp-next-round">
                  <div>
                    <span>原文档</span>
                    <b>换成这份派生 PDF</b>
                  </div>
                  <div>
                    <span>签名图</span>
                    <b>清空 · 要重新传</b>
                  </div>
                  <div>
                    <span>授权</span>
                    <b>复位 · 要重新确认</b>
                  </div>
                  <div>
                    <span>页数</span>
                    <b>保留 {result.pages} 页</b>
                  </div>
                </div>
                <p className="note">签名图不留存，沿用不了上一张。</p>
              </div>
            </>
          ) : (
            <>
              {isLockedPhase(phase) && (
                <p className="ss-reason lockline" id="sign-stamp-lock-reason" data-testid="sign-stamp-lock-reason">
                  {phase === 'result-unknown'
                    ? '结果还没确认，参数已锁定：改一个字节就是另一次请求，可能真的生成两份。'
                    : '正在提交这一次合成，参数与再次提交都已锁定，避免生成两份。'}
                </p>
              )}
              <div className="ss-grp">
                <h3>
                  放第几页
                  <span className="r">共 {pageCount} 页</span>
                </h3>
                <div className="ss-pages">
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="ss-pgbtn"
                      data-testid={`sign-stamp-page-${n}`}
                      aria-pressed={n === page}
                      aria-label={`放在第 ${n} 页`}
                      disabled={disableParams}
                      onClick={() => {
                        onPage(n)
                        onViewPage(n)
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {placeErr ? (
                  <div className="note ss-reason" data-testid="sign-stamp-page-reason">
                    {placeErr}
                  </div>
                ) : null}
              </div>
              <div className="ss-grp">
                <h3>放哪个位置</h3>
                <div className="ss-nine">
                  {POSITIONS.map((pos) => (
                    <button
                      key={pos.key}
                      type="button"
                      data-testid={`sign-stamp-pos-${pos.key}`}
                      aria-pressed={pos.key === position}
                      aria-label={`放到${pos.label}`}
                      disabled={disableParams}
                      onClick={() => onPosition(pos.key)}
                    >
                      {pos.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ss-grp">
                <h3>
                  多大
                  <span className="r">占页宽 15% / 25% / 35%</span>
                </h3>
                <div className="ss-sizes">
                  {SIZES.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      data-testid={`sign-stamp-size-${item.key}`}
                      aria-pressed={item.key === size}
                      aria-label={`大小${item.label}`}
                      disabled={disableParams}
                      onClick={() => onSize(item.key)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="ss-sum" data-testid="sign-stamp-summary">
                  第 {page} 页 · {posLabel(position)} · {sizeLabel(size)}
                </div>
              </div>
              {!isLockedPhase(phase) && phase === 'idle' ? (
                <div className="ss-grp">
                  <h3>
                    <ShieldIcon size={24} />
                    确认授权
                  </h3>
                  <button
                    type="button"
                    className="ss-consent"
                    role="checkbox"
                    data-testid="sign-stamp-authorize"
                    aria-checked={authorized}
                    aria-label={AUTHORIZATION_LABEL}
                    onClick={onAuthorize}
                  >
                    <span className="box" aria-hidden>
                      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.4">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    </span>
                    <span className="ct">
                      <b>{authorized ? '已确认：' : '请先确认：'}</b>
                      {AUTHORIZATION_LABEL}。
                    </span>
                  </button>
                  <p className="note">
                    勾选只表示你有这张图的使用权，不是签署协议，不产生法律凭证。伪造印章或冒用他人签名违法，责任自负。换图后要重新确认。
                  </p>
                </div>
              ) : (
                <div className="ss-grp">
                  <h3>
                    本次提交保留了什么
                    <span className="r">不用重传</span>
                  </h3>
                  <div className="ss-kv" data-testid="sign-stamp-retained">
                    <div>
                      <span>原文档</span>
                      <b>{document ? `${document.name} · ${pageCount} 页` : '—'}</b>
                    </div>
                    <div>
                      <span>签名图</span>
                      <b>{stamp ? `${stamp.name} · 本次会话` : '—'}</b>
                    </div>
                    <div>
                      <span>授权</span>
                      <b>{authorized ? '已确认' : '未确认'}</b>
                    </div>
                    <div>
                      <span>请求标识</span>
                      <b>已绑定 · 不上屏</b>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
      <div className="ss-aside">
        <div className="ss-acol">
          <h4>{done ? '接下来' : phase !== 'idle' ? '这一次的边界' : '三份文件分开'}</h4>
          <ul className="ss-plan">
            {done ? (
              <>
                <li>
                  <span className="sq" aria-hidden />
                  <span>去材料检查核对隐私与可打印性，那之后才谈报价。</span>
                </li>
                <li>
                  <span className="sq" aria-hidden />
                  <span>也可以拿它再叠一处。</span>
                </li>
                <li>
                  <span className="sq" aria-hidden />
                  <span>再叠要重新传签名图。</span>
                </li>
              </>
            ) : phase !== 'idle' ? (
              <>
                <li>
                  <span className="sq" aria-hidden />
                  <span>一次性请求，没有进度也没有阶段。</span>
                </li>
                <li>
                  <span className="sq" aria-hidden />
                  <span>结果未确认只许同请求同参数重试。</span>
                </li>
                <li>
                  <span className="sq" aria-hidden />
                  <span>审计失败会报错，但派生文件可能已存在。</span>
                </li>
              </>
            ) : (
              <>
                <li>
                  <span className="sq" aria-hidden />
                  <span>原 PDF：永不改写。</span>
                </li>
                <li>
                  <span className="sq" aria-hidden />
                  <span>签名图：只能这次新传，约 1 小时，不进我的文档。</span>
                </li>
                <li>
                  <span className="sq" aria-hidden />
                  <span>派生 PDF：每次都是新文件。</span>
                </li>
              </>
            )}
          </ul>
        </div>
        <div className="ss-acol" data-disclaimer="true">
          <h4>不会做什么</h4>
          <ul className="ss-plan">
            {done ? (
              <>
                <li>
                  <span className="sq" aria-hidden />
                  <span>不代表材料已生效。</span>
                </li>
                <li>
                  <span className="sq" aria-hidden />
                  <span>不下单、不出纸、不显示金额。</span>
                </li>
              </>
            ) : (
              <>
                <li>
                  <span className="sq" aria-hidden />
                  <span>不画进度条，也不自动重试。</span>
                </li>
                <li>
                  <span className="sq" aria-hidden />
                  <span>不覆盖原 PDF。不判断该签在哪。不做防篡改，不发证书。</span>
                </li>
              </>
            )}
          </ul>
        </div>
      </div>
    </>
  )
}

function stampSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
