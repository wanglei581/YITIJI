import type { ConvertImagesResponse } from '@ai-job-print/shared'
import { useState, type ChangeEvent, type ReactNode, type Ref } from 'react'
import { PdfCanvasPreview } from '../../components/PdfCanvasPreview'
import { QxTouchOverlay } from '../../components/qingxu/touch/QxTouchOverlay'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'
import {
  MAX_OUTPUT_BYTES,
  formatBytes,
  outputFileName,
  totalBytesOf,
  type ConvertError,
  type ConvertPhase,
  type ConvertPreview,
  type SelectedImage,
} from './convert-images-model'
import {
  AddRows,
  Band,
  ErrorNote,
  ImageList,
  MoreSettings,
  Sample,
  StepRow,
  UsbBody,
} from './ConvertImagesPanels'
import {
  ClosedBody,
  ConflictBody,
  EmptyBody,
  UnknownBody,
  UploadingBody,
  WorkingBody,
} from './ConvertImagesStates'
import { FsRow } from './FsRow'

/** 留存说明：登录与否决定这份 PDF 会不会进「我的文档」。转换前说的是规矩（会不会进），完成态另按响应里的 hasEndUser 说。 */
function retentionLine(loggedIn: boolean): string {
  return loggedIn
    ? '登录后 PDF 进「我的文档」，默认约 24 小时可延长。'
    : '未登录时 PDF 不会进入「我的文档」，也不下载到这台公用机器。'
}

interface ConvertImagesViewProps {
  /** 次出口整行按钮（取消这一张、先登录再转换……）。稿里它们在正文里，不在底栏。 */
  extraRows?: ReactNode
  loggedIn: boolean
  /** 转换响应的真信号；缺省（尚未转换 / 旧响应）时完成态两句都不说。 */
  hasEndUser: boolean | undefined
  kiosk: boolean
  phase: ConvertPhase
  images: SelectedImage[]
  selected: number | null
  uploading: boolean
  generating: boolean
  rechecking: boolean
  error: ConvertError | null
  result: ConvertImagesResponse | null
  recovered: boolean
  /** 冲突屏上「上一次的顺序」：上一次提交的图片名，没记下就是 null。 */
  previousOrder: string[] | null
  preview: ConvertPreview | null
  previewFailed: boolean
  inputRef: Ref<HTMLInputElement>
  atLimit: boolean
  onPickLocal: () => void
  onLocalFile: (event: ChangeEvent<HTMLInputElement>) => void
  onShowQr: () => void
  onOpenUsb: () => void
  onSelect: (index: number) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  onPreviewInput: (index: number) => void
  onPreviewOutput: (index: number) => void
  onClosePreview: () => void
  onPreviewError: () => void
}

/**
 * 手机扫码加图片的层（稿 18：二维码是层，不是正文里的内联小卡）。
 * 层里仍是原来的扫码面板：手机传上来之后，要在这里点「确认加入待合并列表」才进列表，这一步确认不省。
 * 关掉层只是不看这个码，列表和顺序都不动。
 */
export function ConvertQrLayer({
  onClose,
  onUploaded,
  onBusyChange,
}: {
  onClose: () => void
  onUploaded: (file: PhoneUploadedFile) => void
  onBusyChange: (busy: boolean) => void
}) {
  return (
    <div className="i2p-qr-layer" data-testid="img2pdf-qr-layer">
      <QxTouchOverlay
        kind="dialog"
        title="用手机加一张图片"
        onClose={onClose}
        actions={<button type="button" className="qxt-btn qxt-btn-sec" data-testid="img2pdf-qr-close" onClick={onClose}>关闭</button>}
      >
        <UploadSessionQrPanel
          purpose="print_doc"
          title="手机扫码添加图片"
          description="手机扫码上传一张图片，确认后自动加入待合并列表；可重复扫码继续添加。"
          confirmLabel="确认加入待合并列表"
          onUploaded={onUploaded}
          onBusyChange={onBusyChange}
        />
      </QxTouchOverlay>
    </div>
  )
}

export function ConvertImagesView(props: ConvertImagesViewProps) {
  const {
    loggedIn, hasEndUser, kiosk, phase, images, selected, uploading, generating, rechecking,
    error, result, recovered, previousOrder, preview, previewFailed, inputRef, atLimit,
  } = props
  const busy = uploading || generating || rechecking
  const addDisabled = busy || atLimit
  const addReason = uploading ? '这一张还在上传' : atLimit ? '已达 20 张上限' : generating ? '正在合成' : '请稍候'
  const [moreOpen, setMoreOpen] = useState(false)
  // 「再点一次确认移除」：记下是对哪一张点的第一下，换选中的那一张就自然解除。
  const [armedFor, setArmedFor] = useState<number | null>(null)
  const removeArmed = armedFor !== null && armedFor === selected

  const lock = error?.kind === 'result-unknown' || error?.kind === 'in-progress'
  const closed = error?.kind === 'capability'

  // 上一张 / 下一张只移动选中，不取消选中，也不越过两头。
  const stepSelect = (direction: -1 | 1) => {
    const next = selected === null ? (direction === 1 ? 0 : images.length - 1) : selected + direction
    if (next < 0 || next >= images.length || next === selected) return
    props.onSelect(next)
  }

  const remove = () => {
    if (selected === null) return
    if (!removeArmed) {
      setArmedFor(selected)
      return
    }
    setArmedFor(null)
    props.onRemove()
  }

  const body = (() => {
    if (phase === 'usb') return { main: <UsbBody kiosk={kiosk} />, art: 'usb' as const }
    if (phase === 'uploading') return { main: <UploadingBody />, art: 'phone' as const }
    if (phase === 'converting' || phase === 'rechecking') {
      return { main: <WorkingBody recheck={phase === 'rechecking'} images={images} />, art: 'doc' as const }
    }
    if (phase === 'conflict') {
      return { main: <ConflictBody images={images} previous={previousOrder} />, art: 'doc' as const }
    }
    if (phase === 'completed' && result) {
      return {
        main: (
          <>
            <Band
              kind="info"
              title={recovered ? '用同一个标记把结果找回来了' : 'PDF 已生成'}
              chips={[
                '系统已返回结果',
                '一张图一页 · A4',
                ...(typeof hasEndUser === 'boolean'
                  ? [hasEndUser ? '已进我的文档 · 约 24 小时' : '未登录 · 不进我的文档']
                  : []),
              ]}
            >
              <p className="i2p-band-p">
                系统返回了合成结果：<b>{outputFileName(result.pages)}，共 {result.pages} 页</b>，页序与你排的顺序一致。
                {hasEndUser === false ? (
                  <>
                    <b>你现在没登录，这份 PDF 不会进「我的文档」，转好之后再登录也存不进去。</b>
                    不登录也能直接打印这份；想存进「我的文档」，要先登录，再回到这一页重新添加图片转换。
                  </>
                ) : null}
                {recovered ? ' 没有生成第二份，只是重新签发了一条新的临时打印链接。' : null}
              </p>
            </Band>
            <div className="i2p-outcard" data-testid="img2pdf-outfacts">
              <div className="i2p-kv">
                <div><span>文件名</span><b>{outputFileName(result.pages)}</b></div>
                <div><span>页数</span><b>{result.pages} 页（每张图一页）</b></div>
                <div><span>大小</span><b>{formatBytes(result.sizeBytes)}（上限 {formatBytes(MAX_OUTPUT_BYTES)}）</b></div>
                <div><span>打印链接</span><b>临时链接，30 分钟内有效</b></div>
                {images.length > 0 ? <div><span>文件从哪来</span><b>{images.map((img) => img.name).join('、')}</b></div> : null}
              </div>
              <FsRow
                title="逐页完整查看这份 PDF"
                desc="看合成后的每一页"
                testId="img2pdf-preview-open"
                onClick={() => props.onPreviewOutput(0)}
              />
            </div>
          </>
        ),
        art: 'doc' as const,
      }
    }
    if (phase === 'edit' && lock && error) return { main: <UnknownBody images={images} error={error} />, art: 'doc' as const }
    if (phase === 'edit' && closed && error) return { main: <ClosedBody error={error} />, art: 'doc' as const }
    if (phase === 'empty') {
      return {
        main: (
          <>
            {error ? <ErrorNote error={error} images={images} /> : null}
            <EmptyBody kiosk={kiosk} onPickLocal={props.onPickLocal} onShowQr={props.onShowQr} onOpenUsb={props.onOpenUsb} />
          </>
        ),
        art: null,
      }
    }
    // 编辑：待合并的列表、上一张 / 下一张、添加图片、更多设置。
    return {
      main: (
        <>
          {error ? <ErrorNote error={error} images={images} /> : null}
          <ImageList images={images} selected={selected} onSelect={props.onSelect} onPreview={props.onPreviewInput} />
          <StepRow
            selected={selected}
            count={images.length}
            disabled={busy}
            onStep={stepSelect}
          />
          <AddRows
            disabled={addDisabled}
            reason={addReason}
            kiosk={kiosk}
            onPickLocal={props.onPickLocal}
            onShowQr={props.onShowQr}
            onOpenUsb={props.onOpenUsb}
          />
          <FsRow
            title={moreOpen ? '收起更多设置' : '更多设置'}
            desc="上移、下移、移除、查看、旋转"
            testId="img2pdf-more"
            onClick={() => setMoreOpen((open) => !open)}
          />
          {moreOpen ? (
            <MoreSettings
              selected={selected}
              count={images.length}
              removeArmed={removeArmed}
              onMove={props.onMove}
              onRemove={remove}
              onView={() => { if (selected !== null) props.onPreviewInput(selected) }}
            />
          ) : null}
        </>
      ),
      art: 'edit' as const,
    }
  })()

  const sample = body.art === 'edit' ? (
    <Sample
      art="doc"
      facts={{
        title: '合成之后的 PDF',
        lines: [
          outputFileName(images.length),
          `${images.length} 页，一张图一页，按 A4 排版`,
          `合计 ${formatBytes(totalBytesOf(images))}，成品不超过 ${formatBytes(MAX_OUTPUT_BYTES)}`,
          retentionLine(loggedIn),
        ],
      }}
    />
  ) : body.art ? <Sample art={body.art} /> : null

  return (
    <div className="i2p-page" data-w2-page="print-scan-convert" data-qx-page="img2pdf" data-state={phase}>
      <div className="i2p-scroll qx-grow">
        {body.main}
        {props.extraRows}
        {sample}
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
              <button type="button" className="qxt-btn qxt-btn-pri" onClick={props.onClosePreview}>关闭</button>
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
                    className="qxt-btn qxt-btn-sec"
                    disabled={preview.index <= 0}
                    onClick={() => props.onPreviewOutput(preview.index - 1)}
                  >
                    上一页
                  </button>
                  <span className="qx-grow" style={{ textAlign: 'center', fontWeight: 700, fontSize: 22 }}>
                    第 {preview.index + 1} 页 / 共 {result.pages} 页
                  </span>
                  <button
                    type="button"
                    className="qxt-btn qxt-btn-sec"
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
