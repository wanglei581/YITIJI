import type { ConvertImagesResponse } from '@ai-job-print/shared'
import { EyeIcon } from 'lucide-react'
import type { ChangeEvent, ReactNode, Ref } from 'react'
import { PdfCanvasPreview } from '../../components/PdfCanvasPreview'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'
import {
  MAX_IMAGES,
  advisorCopy,
  formatBytes,
  outputFileName,
  type ConvertError,
  type ConvertPhase,
  type ConvertPreview,
  type SelectedImage,
} from './convert-images-model'
import {
  AddRow,
  Band,
  ConvertImagesCta,
  EmptyBody,
  ErrorBand,
  ImageList,
  Retention,
  Rules,
  SelBar,
  UsbGap,
} from './ConvertImagesPanels'

/** 只拆顾问文案里写死的 em / b。用户文件名不走这里。 */
function renderMarks(text: string): ReactNode {
  const parts = text.split(/(<\/?(?:em|b)>)/)
  const out: ReactNode[] = []
  let tag: 'em' | 'b' | null = null
  parts.forEach((part, index) => {
    if (part === '<em>' || part === '<b>') {
      tag = part === '<em>' ? 'em' : 'b'
      return
    }
    if (part === '</em>' || part === '</b>') {
      tag = null
      return
    }
    if (!part) return
    if (tag === 'em') out.push(<em key={index}>{part}</em>)
    else if (tag === 'b') out.push(<b key={index}>{part}</b>)
    else out.push(part)
  })
  return out
}

interface ConvertImagesViewProps {
  loggedIn: boolean
  /** 仅 `?example=1` 时为真。示例条不给真实用户。 */
  example: boolean
  /** 转换响应的真信号；缺省（尚未转换 / 旧响应）时完成态两句都不说。 */
  hasEndUser: boolean | undefined
  kiosk: boolean
  phase: ConvertPhase
  images: SelectedImage[]
  selected: number | null
  uploading: boolean
  generating: boolean
  rechecking: boolean
  showQr: boolean
  error: ConvertError | null
  result: ConvertImagesResponse | null
  recovered: boolean
  requestKey: string | null
  preview: ConvertPreview | null
  previewFailed: boolean
  inputRef: Ref<HTMLInputElement>
  atLimit: boolean
  onPickLocal: () => void
  onLocalFile: (event: ChangeEvent<HTMLInputElement>) => void
  onShowQr: () => void
  onPhoneUploaded: (file: PhoneUploadedFile) => void
  onQrBusy: (busy: boolean) => void
  onOpenUsb: () => void
  onCloseUsb: () => void
  onSelect: (index: number) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  onPreviewInput: (index: number) => void
  onPreviewOutput: (index: number) => void
  onClosePreview: () => void
  onPreviewError: () => void
  onCancelUpload: () => void
  onConvert: () => void
  onRecheck: () => void
  onNewKey: () => void
  onRestoreOrder: () => void
  onPrint: () => void
  onLogin: () => void
  onDocuments: () => void
  onBack: () => void
}

function ReqPanel({ count, note }: { count: number; note?: ReactNode }) {
  return (
    <div className="i2p-pgrp" data-testid="img2pdf-req">
      <h4>同一批只算一次</h4>
      <div className="i2p-kv">
        <div><span>重试、再查</span><b data-testid="img2pdf-reqid">还算同一次</b></div>
        <div><span>顺序一变</span><b>就算新的一批</b></div>
        <div><span>这批图片</span><b>{count} 张，按上面的顺序</b></div>
      </div>
      <div className="i2p-band-p">
        系统认这一批图，只看<b>有哪几张、谁先谁后</b>。
        {note ?? <>同一批图片、同一个顺序，<b>始终算同一次</b>：重试、断线重连、找回结果都按这一次算，系统不会因此多生成一份。</>}
      </div>
    </div>
  )
}

export function ConvertImagesView(props: ConvertImagesViewProps) {
  const {
    loggedIn, example, hasEndUser, kiosk, phase, images, selected, uploading, generating, rechecking,
    showQr, error, result, recovered, requestKey, preview, previewFailed, inputRef, atLimit,
  } = props
  const advisor = advisorCopy(phase, images.length, error, hasEndUser)
  const busy = uploading || generating || rechecking
  const orderLocked = phase === 'converting' || phase === 'rechecking' || phase === 'completed'
    || error?.kind === 'known-failed' || error?.kind === 'in-progress' || error?.kind === 'result-unknown'
  const saved = phase === 'completed' ? hasEndUser === true : loggedIn
  const section = phase === 'completed'
    ? { title: '这份 PDF 的每一页', hint: `${images.length} 页 · 点开可逐页看完整` }
    : phase === 'converting'
      ? { title: '正在合成的就是这个顺序', hint: `${images.length} / ${MAX_IMAGES} 张 · 顺序不变` }
      : error?.kind === 'known-failed' || error?.kind === 'in-progress' || error?.kind === 'result-unknown'
        ? { title: '图片和顺序都保留着', hint: `${images.length} / ${MAX_IMAGES} 张 · 顺序不变` }
        : phase === 'uploading' && images.length > 0
          ? { title: '已经在列表里的还在', hint: `${images.length} / ${MAX_IMAGES} 张` }
          : atLimit
            ? { title: '已经到上限', hint: `${images.length} / ${MAX_IMAGES} 张 · 一张一页` }
            : { title: '排好顺序', hint: `${images.length} / ${MAX_IMAGES} 张 · 一张一页` }
  const addDisabled = busy || atLimit
  const addReason = uploading ? '这一张还在上传' : atLimit ? '已达 20 张上限' : generating ? '正在合成' : '请稍候'

  return (
    <div className="i2p-page" data-w2-page="print-scan-convert" data-state={phase}>
      <section className="i2p-xq">
        <div className="i2p-xq-row">
          <div className="i2p-xq-face" aria-hidden>青</div>
          <div>
            <div className="i2p-xq-eyebrow">图片转 PDF</div>
            <div className="i2p-xq-ask">{renderMarks(advisor.ask)}</div>
            <div className="i2p-xq-doing">{renderMarks(advisor.doing)}</div>
          </div>
        </div>
      </section>

      {example && phase !== 'empty' ? (
        <div className="i2p-fxbar" role="note" data-testid="img2pdf-fixture">
          <span className="i2p-fx-b">示例</span>
          <span>这一屏是示例：图片、文件名和转换结果都是示例，<b>不是哪位用户的文件</b>。</span>
        </div>
      ) : null}

      <div className="i2p-scroll qx-grow">
        {phase === 'usb' ? <UsbGap /> : null}

        {phase === 'empty' ? (
          <EmptyBody kiosk={kiosk} onPickLocal={props.onPickLocal} onShowQr={props.onShowQr} onOpenUsb={props.onOpenUsb} />
        ) : null}

        {phase === 'uploading' ? (
          <Band kind="info" title="正在上传这一张" breathe chips={['一次一张', '没有进度回传', '结果未确认前不合成']}>
            <div className="i2p-band-p">本机一次上传一张。<b>系统不回传上传进度百分比</b>，所以不画进度条，也不写「还需几秒」。传成功之后它才会出现在下面的列表里。</div>
            <div className="i2p-band-p">这一张没确认成功之前，不会进列表，也不会改变已经排好的顺序。</div>
          </Band>
        ) : null}

        {phase === 'converting' ? (
          <Band kind="info" title="正在合成 PDF" breathe chips={['已交给系统', '无进度回传', '结果回来才算完成']}>
            <div className="i2p-band-p">这一批<b>已经交给系统了</b>，按你排好的顺序合成一份 PDF，一张图一页。</div>
            <div className="i2p-band-p">合成要一次做完，<b>系统不回传中间进度</b>，所以这里没有百分比、没有进度条，也没有「还需几秒」。结果回来之前，这一屏不会自己变。</div>
          </Band>
        ) : null}

        {phase === 'rechecking' ? (
          <Band kind="info" title="正在再查刚才那一次" breathe chips={['还是刚才那一次', '没有重新提交', '不会自动变完成']}>
            <div className="i2p-band-p">正在问<b>刚才那一次</b>的结果。<b>没有当作新的一次再交</b>，所以不会多出第二份 PDF。</div>
            <div className="i2p-band-p">这一屏<b>不会自己变成完成</b>：没有百分比，也没有计时器。</div>
          </Band>
        ) : null}

        {phase === 'completed' && result ? (
          <Band
            kind="info"
            title={recovered ? '刚才那一次的结果找回来了' : 'PDF 已生成'}
            chips={[
              '系统已返回结果',
              '一张图一页 · A4',
              ...(typeof hasEndUser === 'boolean'
                ? [hasEndUser ? '已进我的文档 · 约 24 小时' : '未登录 · 不进我的文档']
                : []),
            ]}
          >
            <div className="i2p-band-p">
              合成结果回来了：<b>{outputFileName(result.pages)}，共 {result.pages} 页</b>，页序与你排的顺序一致。
              {hasEndUser === false ? (
                <>
                  <b>你现在没登录，这份 PDF 不会进「我的文档」，转好之后再登录也存不进去。</b>
                  不登录也能直接打印这份；想存进「我的文档」，要先登录，再回到这一页重新添加图片转换。
                </>
              ) : null}
              {recovered ? ' 没有生成第二份，只是重新签发了一条新的临时打印链接。' : null}
            </div>
          </Band>
        ) : null}

        {error && phase !== 'completed' && phase !== 'converting' && phase !== 'usb' ? (
          <ErrorBand error={error} images={images} />
        ) : null}

        {phase !== 'empty' && phase !== 'usb' && images.length > 0 ? (
          <>
            <div className="i2p-sec-label">
              <span className="no">01</span>
              <span className="t">{section.title}</span>
              <span className="hint">{section.hint}</span>
            </div>
            <ImageList
              images={images}
              mode={phase === 'completed' ? 'output' : 'edit'}
              selected={orderLocked ? null : selected}
              onSelect={orderLocked ? () => undefined : props.onSelect}
              onPreview={phase === 'completed' ? props.onPreviewOutput : props.onPreviewInput}
            />
            {phase === 'completed' ? (
              <div className="i2p-selbar">
                <button type="button" className="i2p-selbtn" data-testid="img2pdf-preview-open" onClick={() => props.onPreviewOutput(0)}>
                  <EyeIcon size={24} />逐页完整查看这份 PDF
                </button>
              </div>
            ) : orderLocked ? null : (
              <>
                {phase === 'uploading' ? null : (
                  <SelBar selected={selected} count={images.length} onMove={props.onMove} onRemove={props.onRemove} />
                )}
                <AddRow disabled={addDisabled} reason={addReason} kiosk={kiosk} onPickLocal={props.onPickLocal} onShowQr={props.onShowQr} onOpenUsb={props.onOpenUsb} />
              </>
            )}
          </>
        ) : null}

        {phase === 'uploading' && images.length === 0 ? (
          <div className="qx-card">
            <div className="i2p-band-p">列表里还没有别的图片。<b>这一张传成功之后会成为第 1 页</b>；没成功就什么都不会加进来。</div>
          </div>
        ) : null}

        {showQr ? (
          <UploadSessionQrPanel
            purpose="print_doc"
            title="手机扫码添加图片"
            description="手机扫码上传一张图片，确认后自动加入待合并列表；可重复扫码继续添加。"
            confirmLabel="确认加入待合并列表"
            onUploaded={props.onPhoneUploaded}
            onBusyChange={props.onQrBusy}
          />
        ) : null}

        {phase !== 'empty' && phase !== 'usb' ? (
          <div className="i2p-grid2">
            {phase === 'uploading' ? (
              <Rules />
            ) : phase === 'completed' && result ? (
              <div className="i2p-pgrp" data-testid="img2pdf-outfacts">
                <h4>这份文件</h4>
                <div className="i2p-kv">
                  <div><span>文件名</span><b>{outputFileName(result.pages)}</b></div>
                  <div><span>怎么认</span><b data-testid="img2pdf-fileid">看文件名和页数</b></div>
                  <div><span>页数</span><b>{result.pages} 页（每张图一页）</b></div>
                  <div><span>大小</span><b>{formatBytes(result.sizeBytes)}（上限 15 MB）</b></div>
                  <div><span>排版</span><b>A4，一张图一页，不裁切</b></div>
                  <div><span>打印链接</span><b>临时下载链接，30 分钟内有效</b></div>
                </div>
              </div>
            ) : phase === 'converting' || error?.kind === 'known-failed' ? (
              <ReqPanel
                count={images.length}
                note={error?.kind === 'known-failed'
                  ? <>明确失败之后，刚才那一次<b>不再占着</b>，所以<b>原样重试</b>是安全的，不会被当成重复提交挡回来。</>
                  : <>离开这一页<b>不会取消</b>这次合成；回来之后<b>再查刚才那一次</b>就行，不要另起一次新的。</>}
              />
            ) : (
              <Retention saved={saved} />
            )}
            {phase === 'uploading' ? (
              <ReqPanel count={images.length} note={<>这一批还没提交；你点「合成」那一下，才算正式交了这一次。</>} />
            ) : phase === 'completed' && !recovered ? (
              <Retention saved={saved} />
            ) : phase === 'converting' || error?.kind === 'known-failed' ? (
              <Rules />
            ) : requestKey ? (
              <ReqPanel count={images.length} />
            ) : (
              <Rules />
            )}
          </div>
        ) : null}
      </div>

      <div className="i2p-actions">
        <ConvertImagesCta
          phase={phase}
          imageCount={images.length}
          error={error}
          generating={generating}
          rechecking={rechecking}
          uploading={uploading}
          hasEndUser={hasEndUser}
          onBack={props.onBack}
          onConvert={props.onConvert}
          onRecheck={props.onRecheck}
          onNewKey={props.onNewKey}
          onRestoreOrder={props.onRestoreOrder}
          onPrint={props.onPrint}
          onLogin={props.onLogin}
          onDocuments={props.onDocuments}
          onCancelUpload={props.onCancelUpload}
          onCloseUsb={props.onCloseUsb}
          onPickLocal={props.onPickLocal}
        />
      </div>

      <div className="i2p-truth" data-testid="img2pdf-truth">
        <div><b>顺序</b>列表顺序就是提交顺序，也是 PDF 的页序：一张图一页，按 A4 排版，不裁切、不拼版。</div>
        <div><b>进度</b>合成需要一点时间，做完才会告诉你。这里不显示百分比。</div>
        <div>
          <b>留存</b>
          {saved
            ? '登录后 PDF 进「我的文档」，默认约 24 小时可延长。'
            : '未登录时 PDF 不会进入「我的文档」，也不下载到这台公用机器。'}
        </div>
      </div>

      {!kiosk && (
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="sr-only"
          onChange={props.onLocalFile}
        />
      )}

      {preview ? (
        <div className="i2p-pv" role="dialog" aria-modal="true" data-testid="img2pdf-preview">
          <div className="i2p-pv-box">
            <div className="i2p-pv-head">
              <div className="qx-grow">
                <div className="i2p-pv-t">
                  {preview.kind === 'output'
                    ? `第 ${preview.index + 1} 页`
                    : images[preview.index]?.name ?? '预览'}
                </div>
                <div className="i2p-pv-s">
                  {preview.kind === 'output'
                    ? '显示的是合成后的 PDF，不是示意图。'
                    : '显示的是你加进来的原图。'}
                </div>
              </div>
              <button type="button" className="qx-btn" data-variant="primary" onClick={props.onClosePreview}>关闭</button>
            </div>
            <div className="i2p-pv-view">
              {previewFailed ? (
                <div className="i2p-pv-fail">
                  预览取不到。只是看不了这一眼：文件在、页数在、打印链接也在。
                </div>
              ) : preview.kind === 'input' && images[preview.index] ? (
                <img
                  src={images[preview.index]!.fileAccessUrl}
                  alt={`${images[preview.index]!.name} 完整预览`}
                  onError={props.onPreviewError}
                />
              ) : result ? (
                <PdfCanvasPreview
                  src={result.printFileUrl}
                  title="合成 PDF 预览"
                  page={preview.index + 1}
                  fit="page"
                  showPager={false}
                  onError={props.onPreviewError}
                  className="h-full max-h-full w-full"
                />
              ) : (
                <div className="i2p-pv-fail">还没有可预览的文件。</div>
              )}
            </div>
            <div className="i2p-pv-bar">
              {preview.kind === 'output' && result && result.pages > 1 ? (
                <>
                  <button
                    type="button"
                    className="qx-btn"
                    data-variant="ghost"
                    disabled={preview.index <= 0}
                    onClick={() => props.onPreviewOutput(preview.index - 1)}
                  >
                    上一页
                  </button>
                  <span className="qx-grow" style={{ textAlign: 'center', fontWeight: 700 }}>
                    第 {preview.index + 1} 页 / 共 {result.pages} 页
                  </span>
                  <button
                    type="button"
                    className="qx-btn"
                    data-variant="ghost"
                    disabled={preview.index >= result.pages - 1}
                    onClick={() => props.onPreviewOutput(preview.index + 1)}
                  >
                    下一页
                  </button>
                </>
              ) : (
                <span className="qx-grow" />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

