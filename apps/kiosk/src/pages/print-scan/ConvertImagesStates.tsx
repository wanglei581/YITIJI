import { PlusIcon } from 'lucide-react'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { PhoneArt, UsbArt } from './ToolArt'
import { PhoneHelpLine } from './phoneHelp'
import { Fact } from './ConvertImagesPanels'
import {
  MAX_IMAGES,
  formatBytes,
  totalBytesOf,
  type ConvertError,
  type SelectedImage,
} from './convert-images-model'

function names(images: SelectedImage[]): string {
  return images.map((img) => img.name).join('、')
}

function GoMark() {
  return <span className="go" aria-hidden="true"><QxTouchIcon name="chevR" size={28} strokeWidth={2.2} /></span>
}

/** 还没有图片：手机扫码卡、（非一体机）本机上传卡、停用的 U 盘卡。 */
export function EmptyBody({
  kiosk,
  onPickLocal,
  onShowQr,
  onOpenUsb,
}: {
  kiosk: boolean
  onPickLocal: () => void
  onShowQr: () => void
  onOpenUsb: () => void
}) {
  return (
    <>
      <p className="fs-lead">还没有图片。用手机扫码传上来之后，才能合成。</p>
      <div className="fs-pair">
        <button type="button" className="fs-act" data-testid="img2pdf-add-phone" onClick={onShowQr}>
          <span className="vis" aria-hidden="true"><PhoneArt /></span>
          <span className="tx">
            <h3>手机扫码传图片</h3>
            <p>在手机上选 JPG 或 PNG。传到这台机器之后，才会出现在列表里。</p>
          </span>
          <GoMark />
        </button>
        {kiosk ? null : (
          <button type="button" className="fs-act" data-testid="img2pdf-add-local" onClick={onPickLocal}>
            <span className="vis" aria-hidden="true"><PlusIcon size={48} /></span>
            <span className="tx">
              <h3>本机上传一张</h3>
              <p>在这台电脑上选 JPG 或 PNG，一次一张。一体机不打开系统文件框。</p>
            </span>
            <GoMark />
          </button>
        )}
        <button type="button" className="fs-act off" disabled data-testid="img2pdf-src-usb" aria-disabled="true">
          <span className="vis" aria-hidden="true"><UsbArt /></span>
          <span className="tx">
            <span className="sx-chip">暂未开通</span>
            <h3>U 盘导入</h3>
            <p>从 U 盘加图片，本机暂未开通。</p>
          </span>
          <GoMark />
        </button>
      </div>
      <button type="button" className="fs-row" data-testid="img2pdf-add-usb" onClick={onOpenUsb}>
        看看 U 盘图片现在能怎么办
      </button>
      <p className="fine">最多 20 张，单张不超过 10MB，只收 JPG、PNG。</p>
      <p className="fine">
        合计不超过 40MB，成品不超过 15MB。单张不超过 2500 万像素，合计不超过 2 亿像素。一次最多 {MAX_IMAGES} 张。旋转 90° 当前不可用。
      </p>
    </>
  )
}

/** 正在接收这一张（本机上传一次一张）。 */
export function UploadingBody() {
  return (
    <div className="fs-facts">
      <Fact wide title={<><span className="i2p-dot" aria-hidden />正在接收这一张</>}>
        系统还没把这一张放进列表。取消只停这一张，不假装已经收到。
      </Fact>
      <div className="fs-pairgrid">
        <Fact title="还没进列表">传到这台机器之后，才会出现在列表里；没确认成功之前，也不会改变已经排好的顺序。</Fact>
        <Fact title="没有进度条">系统不回传上传进度百分比，所以这里不画进度条，也不写「还需几秒」。</Fact>
      </div>
      <Fact wide title="格式">只收 JPG、PNG。单张不超过 10MB，不超过 2500 万像素。取消只停这一张，已经在列表里的不动。</Fact>
    </div>
  )
}

/** 正在合成 / 正在用同一个标记再查：一次性请求，系统不回传进度。 */
export function WorkingBody({ recheck, images }: { recheck: boolean; images: SelectedImage[] }) {
  return (
    <div className="fs-facts">
      <Fact wide title={<><span className="i2p-dot" aria-hidden />{recheck ? '正在用同一个标记再查一次' : '正在合成 PDF'}</>}>
        {recheck
          ? '拿同一个标记去问系统这一次的结果。没有另起一次，也没有换标记，所以不会多出第二份 PDF。'
          : '请求已经发出去了，按你排好的顺序合成一份 PDF，一张图一页。'}
        当前 {images.length} 张，合计 {formatBytes(totalBytesOf(images))}。
      </Fact>
      <div className="fs-pairgrid">
        <Fact title="等这一次的结果">合成好了，这一页才会换成结果。系统不回传中间进度，所以没有百分比，也没有进度条。</Fact>
        <Fact title="页数">合成后每张一页，页数等于张数，不写死纸型。</Fact>
      </div>
      <Fact wide title="成品">成品不超过 15MB。超过就停在出错说明，不给一份假 PDF。</Fact>
    </div>
  )
}

/** 这个标识已经用在另一批图片上：停在这里，由用户决定换标识还是恢复旧顺序。 */
export function ConflictBody({ images, previous }: { images: SelectedImage[]; previous: string[] | null }) {
  return (
    <div className="fs-facts">
      <Fact wide title="这个标识已经用在另一批图片上了">
        系统拒绝了：「该请求标识已用于另一批图片，请更换标识重试」。本页就停在这里：不自动换标识、不自动改回旧顺序。
      </Fact>
      <Fact wide title="当前顺序">{names(images) || '没有图片'}</Fact>
      <Fact wide title="上一次的顺序">{previous && previous.length > 0 ? previous.join('、') : '没有记下上一次'}</Fact>
      <div className="fs-pairgrid">
        <Fact title="换一个新标识">换过之后按当前顺序继续。</Fact>
        <Fact title="恢复上一次的顺序">按冲突前的顺序放回，不重新上传。</Fact>
      </div>
    </div>
  )
}

/** 这一次的结果没有确认（含「上一次还在进行」）：用同一个标记再查，不另起一次。 */
export function UnknownBody({ images, error }: { images: SelectedImage[]; error: ConvertError }) {
  const inProgress = error.kind === 'in-progress'
  return (
    <>
      <div className="fs-facts">
        <Fact wide title={inProgress ? '上一次用同一标记的生成还在进行' : '这一次的结果不知道'}>
          {inProgress
            ? '系统回的是「上一次生成仍在进行中，请稍候重试」。这时候不发起新的生成，拿同一个标记再查一次。'
            : '请求发出去了，但结果没有送到这台机器，所以现在有两种可能：系统已经做完了，或者根本没做成。在弄清楚之前，不能直接再发一次，要拿同一个标记去查这一次的结果。'}
        </Fact>
        <div className="fs-pairgrid">
          <Fact title="同一标记">用上一次的标记再查，不另起一次合成。</Fact>
          <Fact title="不改判成功">没确认之前，不写成 PDF 已经合成。</Fact>
        </div>
        <Fact wide title="列表还在">
          {images.length > 0 ? `共 ${images.length} 张，顺序不变：${names(images)}` : '这次没有图片'}
        </Fact>
      </div>
      <PhoneHelpLine />
    </>
  )
}

/** 本机没开放格式转换（含这台机器还没登记）：整页说明，出路是回打印扫描。 */
export function ClosedBody({ error }: { error: ConvertError }) {
  return (
    <>
      <div className="fs-facts">
        <Fact wide title="本机暂未开放格式转换">{error.message}</Fact>
        <div className="fs-pairgrid">
          <Fact title="暂未开通">打不开转换。已经在手机里的文件，可以回到打印扫描用别的方式办。</Fact>
          <Fact title="上限仍在">开通之后也是最多 20 张，只收 JPG、PNG。</Fact>
          <Fact title="大小">单张 10MB，合计 40MB，成品 15MB。</Fact>
          <Fact title="像素">单张不超过 2500 万像素，合计不超过 2 亿像素。</Fact>
        </div>
      </div>
      <PhoneHelpLine />
    </>
  )
}
