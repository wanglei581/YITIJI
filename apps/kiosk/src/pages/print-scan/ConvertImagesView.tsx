import type { ConvertImagesResponse } from '@ai-job-print/shared'
import { EyeIcon } from 'lucide-react'
import type { ChangeEvent, Ref } from 'react'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'
import {
  MAX_IMAGES,
  MAX_OUTPUT_BYTES,
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
  EmptyBody,
  ErrorBand,
  ImageList,
  Retention,
  Rules,
  SelBar,
  UsbGap,
} from './ConvertImagesPanels'

interface ConvertImagesViewProps {
  loggedIn: boolean
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
  onHelp: () => void
  onBack: () => void
}

export function ConvertImagesView(props: ConvertImagesViewProps) {
  const {
    loggedIn, kiosk, phase, images, selected, uploading, generating, rechecking,
    showQr, error, result, recovered, requestKey, preview, previewFailed, inputRef, atLimit,
  } = props
  const advisor = advisorCopy(phase, images.length, error)
  const busy = uploading || generating || rechecking
  const addDisabled = busy || atLimit
  const addReason = uploading ? '这一张还在上传' : atLimit ? '已达 20 张上限' : generating ? '正在合成' : '请稍候'

  return (
    <div className="i2p-page" data-w2-page="print-scan-convert" data-state={phase}>
      <section className="i2p-xq">
        <div className="i2p-xq-row">
          <div className="i2p-xq-face" aria-hidden>青</div>
          <div>
            <div className="i2p-xq-eyebrow">IMAGES TO PDF</div>
            <div className="i2p-xq-ask">{advisor.ask}</div>
            <div className="i2p-xq-doing">{advisor.doing}</div>
          </div>
        </div>
      </section>

      <div className="i2p-scroll qx-grow">
        {phase === 'usb' ? <UsbGap /> : null}

        {phase === 'empty' ? (
          <EmptyBody kiosk={kiosk} onPickLocal={props.onPickLocal} onShowQr={props.onShowQr} onOpenUsb={props.onOpenUsb} />
        ) : null}

        {phase === 'uploading' ? (
          <Band kind="info" title="正在上传这一张" breathe chips={['一次一张', '没有进度回传', '结果未确认前不合成']}>
            <div className="i2p-band-p">本机一次上传一张。<b>服务端不回传上传进度百分比</b>，所以这里不画进度条，也不写「还需几秒」。传成功之后它才会出现在下面的列表里。</div>
            <div className="i2p-band-p">这一张没确认成功之前，不会进列表，也不会改变已经排好的顺序。</div>
          </Band>
        ) : null}

        {phase === 'converting' ? (
          <Band kind="info" title="正在合成 PDF" breathe chips={['一次性请求', '无进度回传', '结果回来才算完成']}>
            <div className="i2p-band-p">请求<b>已经发出去了</b>，按你排好的顺序合成一份 PDF，一张图一页。</div>
            <div className="i2p-band-p">这是一次性请求，<b>服务端不回传中间进度</b>，所以这里没有百分比、没有进度条。结果回来之前，这一屏不会自己变。</div>
          </Band>
        ) : null}

        {phase === 'rechecking' ? (
          <Band kind="info" title="正在用同一个标识再查一次" breathe chips={['同一请求标识', '没有新建请求', '不会自动变完成']}>
            <div className="i2p-band-p">正在拿同一个请求标识去问服务端这一次的结果。<b>没有新建请求</b>，也没有换标识，所以不会多出第二份 PDF。</div>
          </Band>
        ) : null}

        {phase === 'completed' && result ? (
          <Band kind="info" title={recovered ? '用同一个标识把结果找回来了' : 'PDF 已生成'} chips={['服务端已返回结果', '一张图一页 · A4', loggedIn ? '已进我的文档 · 约 24 小时' : '未登录 · 不进我的文档']}>
            <div className="i2p-band-p">
              服务端返回了合成结果：<b>{outputFileName(result.pages)}，共 {result.pages} 页</b>，页序与你排的顺序一致。
              {loggedIn ? null : <b>你现在没登录，这份 PDF 不会进「我的文档」</b>}
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
              <span className="t">{phase === 'completed' ? '这份 PDF 的每一页' : atLimit ? '已经到上限' : '排好顺序'}</span>
              <span className="hint">{images.length} / {MAX_IMAGES} 张 · 一张一页</span>
            </div>
            <ImageList
              images={images}
              selected={phase === 'completed' ? null : selected}
              onSelect={phase === 'completed' ? () => undefined : props.onSelect}
              onPreview={phase === 'completed' ? props.onPreviewOutput : props.onPreviewInput}
            />
            {phase === 'completed' ? (
              <div className="i2p-selbar">
                <button type="button" className="i2p-selbtn" data-testid="img2pdf-preview-open" onClick={() => props.onPreviewOutput(0)}>
                  <EyeIcon size={24} />逐页完整查看这份 PDF
                </button>
              </div>
            ) : (
              <>
                <SelBar selected={selected} count={images.length} onMove={props.onMove} onRemove={props.onRemove} />
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
            {phase === 'completed' && result ? (
              <div className="i2p-pgrp" data-testid="img2pdf-outfacts">
                <h4>这份文件</h4>
                <div className="i2p-kv">
                  <div><span>文件名</span><b>{outputFileName(result.pages)}</b></div>
                  <div><span>文件标识</span><b data-testid="img2pdf-fileid">{result.fileId}</b></div>
                  <div><span>页数</span><b>{result.pages} 页（每张图一页）</b></div>
                  <div><span>大小</span><b>{formatBytes(result.sizeBytes)}（上限 {formatBytes(MAX_OUTPUT_BYTES)}）</b></div>
                  <div><span>校验值</span><b>{result.fileMd5.slice(0, 12)}…（服务端返回的前 12 位）</b></div>
                  <div><span>打印链接</span><b>临时签名链接，30 分钟内有效</b></div>
                </div>
              </div>
            ) : (
              <Retention loggedIn={loggedIn} />
            )}
            {phase === 'completed' && !recovered ? (
              <Retention loggedIn={loggedIn} />
            ) : requestKey ? (
              <div className="i2p-pgrp" data-testid="img2pdf-req">
                <h4>本次请求标识</h4>
                <div className="i2p-kv">
                  <div><span>请求标识</span><b data-testid="img2pdf-reqid">{requestKey}</b></div>
                  <div><span>这批图片</span><b>{images.length} 张，按上面的顺序</b></div>
                </div>
                <div className="i2p-band-p">同一批图片、同一个顺序，<b>始终用这一个标识</b>：重试、断线重连、恢复结果都靠它，服务端不会因此多生成一份。</div>
              </div>
            ) : (
              <Rules />
            )}
          </div>
        ) : null}
      </div>

      <div className="i2p-truth" data-testid="img2pdf-truth">
        <div><b>顺序</b>列表顺序就是提交顺序，也是 PDF 的页序：一张图一页，按 A4 排版，不裁切、不拼版。</div>
        <div><b>进度</b>合成是一次性请求，服务端不回传进度，所以不画百分比，也不用计时器假装做完了。</div>
        <div>
          <b>留存</b>
          {loggedIn
            ? '登录后 PDF 进「我的文档」，默认约 24 小时可延长。'
            : '未登录时 PDF 不会进入「我的文档」，也不下载到这台公用机器。'}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="sr-only"
        onChange={props.onLocalFile}
      />

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
                <iframe title="合成 PDF 预览" src={result.printFileUrl} onError={props.onPreviewError} />
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

