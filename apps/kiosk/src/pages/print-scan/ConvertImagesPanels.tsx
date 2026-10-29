import { EyeIcon, InfoIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { QxTouchPrimary } from '../../components/qingxu/touch/QxTouchDock'
import { FsRow } from './FsRow'
import { PhoneHelpLine } from './phoneHelp'
import { DocStackArt, PhoneArt, UsbArt } from './ToolArt'
import {
  MAX_IMAGES,
  MAX_OUTPUT_BYTES,
  MAX_SINGLE_IMAGE_BYTES,
  MAX_TOTAL_INPUT_BYTES,
  formatBytes,
  totalBytesOf,
  type ConvertError,
  type ConvertPhase,
  type SelectedImage,
} from './convert-images-model'

/** 一块状态卡（完成、出错……）：标题 + 正文 + 可选的几枚标签，按种类换底色。 */
export function Band({
  kind,
  title,
  children,
  breathe,
  chips,
}: {
  kind: 'info' | 'warn' | 'error' | 'lock'
  title: string
  children: ReactNode
  breathe?: boolean
  chips?: string[]
}) {
  return (
    <div className="i2p-band" data-kind={kind} data-testid="img2pdf-band">
      <div className="i2p-band-h">
        {breathe ? <span className="i2p-dot" aria-hidden /> : <InfoIcon size={27} aria-hidden />}
        {title}
      </div>
      {children}
      {chips && chips.length > 0 ? (
        <div className="i2p-meta">
          {chips.map((chip) => (
            <span key={chip} className="i2p-chip">{chip}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** 说明格：一个标题加一句话（稿的 .fs-fact）。 */
export function Fact({ title, children, wide }: { title: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`fs-fact${wide ? ' wide' : ''}`}>
      <b>{title}</b>
      <span>{children}</span>
    </div>
  )
}

/** U 盘图片还没接到转换列表：说清现在能走哪两条（稿 18「U 盘图片还没接到这里」）。 */
export function UsbBody({ kiosk }: { kiosk: boolean }) {
  return (
    <>
      <div className="fs-facts" data-testid="img2pdf-usb-ways">
        <Fact wide title="尚未接到转换列表">
          U 盘图片导入尚未接到转换列表。{kiosk ? '一体机这里不打开本机文件框。' : '这一页现在只接了本机上传和手机扫码上传。'}
        </Fact>
        <div className="fs-pairgrid">
          <Fact title={kiosk ? '改用手机' : '改用本机或手机'}>
            {kiosk ? '这台机器没有本机文件框。请回到手机扫码，传 JPG 或 PNG。' : '在这台设备上选图，或回到手机扫码，传 JPG 或 PNG。'}
          </Fact>
          <Fact title="现在能用的">手机扫码上传一张 JPG 或 PNG。传到这台机器之后，才会出现在列表里。</Fact>
          <Fact title="要拼成一份 PDF">图片得先落到手机或这台机器上，再在这一页上传。拷进来之后，就和别的图片一样：一张一页，顺序你自己排。</Fact>
          <Fact title="只想把原图打出来">那是打印流程，不是这一页：走「打印扫描」里的 U 盘导入打印。那条路不会回到这个列表，也排不出页序。</Fact>
        </div>
        <Fact wide title="还没加进来">U 盘里的图片不会出现在这个列表里。</Fact>
      </div>
      <PhoneHelpLine />
    </>
  )
}

/** 一块示意小样：多出来的高度给它，不撑空卡。art 是示意图，只作示意；带 facts 时右边讲这份文件。 */
export function Sample({
  art,
  facts,
}: {
  art: 'doc' | 'phone' | 'usb'
  facts?: { title: string; lines: string[] }
}) {
  const Art = art === 'phone' ? PhoneArt : art === 'usb' ? UsbArt : DocStackArt
  return (
    <div className={`i2p-sample${facts ? '' : ' is-art-only'}`} data-testid="img2pdf-sample">
      <span className="vis" aria-hidden="true"><Art /></span>
      {facts ? (
        <span className="tx">
          <b>{facts.title}</b>
          {facts.lines.map((line) => <span key={line}>{line}</span>)}
        </span>
      ) : null}
    </div>
  )
}

export function ImageList({
  images,
  selected,
  onSelect,
  onPreview,
}: {
  images: SelectedImage[]
  selected: number | null
  onSelect: (index: number) => void
  onPreview: (index: number) => void
}) {
  const names = images.map((img) => img.name)
  const total = totalBytesOf(images)
  return (
    <div className="i2p-list" data-testid="img2pdf-list" data-count={images.length}>
      <div className="i2p-lhead">
        <span>待合并图片</span>
        <span className="sub" data-testid="img2pdf-counts">
          {images.length} / {MAX_IMAGES} 张 · 合计 {formatBytes(total)} / {formatBytes(MAX_TOTAL_INPUT_BYTES)}
        </span>
      </div>
      <div
        className="i2p-lrows"
        data-testid="img2pdf-scroll"
        tabIndex={0}
        aria-label="待合并图片列表，可上下滚动"
      >
        {images.map((img, index) => (
          <div key={img.fileId} className="i2p-irow" data-testid={`img2pdf-row-${index}`} data-name={img.name}>
            <button
              type="button"
              className="i2p-ipick"
              aria-pressed={selected === index}
              aria-label={`选中第 ${index + 1} 张：${img.name}`}
              onClick={() => onSelect(index)}
            >
              <span className="i2p-ithumb">
                <img src={img.fileAccessUrl} alt={`${img.name} 缩略图`} />
              </span>
              <span className="i2p-imeta">
                <b>{img.name}</b>
                <span>{img.size} · 第 {index + 1} 张 / 共 {images.length} 张 · {img.source === 'qr' ? '手机扫码上传' : '本机上传'}</span>
              </span>
            </button>
            <button
              type="button"
              className="i2p-ibtn"
              aria-label={`完整查看第 ${index + 1} 张：${img.name}`}
              onClick={() => onPreview(index)}
            >
              <EyeIcon size={28} aria-hidden />
            </button>
          </div>
        ))}
      </div>
      <p
        className="fs-p"
        data-testid="img2pdf-order"
        data-order={names.join(' | ')}
        data-sent-payload={names.join(' | ')}
      >
        列表顺序就是提交给系统的顺序，也是 PDF 的页序，一张图一页。
      </p>
      <p className="fs-p">单张 10MB，合计 40MB，成品 15MB。单张 2500 万像素，合计 2 亿像素。只收 JPG、PNG。</p>
      <p className="fs-p">旋转 90° 当前不可用：格式转换还不能旋转，这一步也还没接上。</p>
    </div>
  )
}

/** 上一张 / 下一张：只移动「选中」，不改顺序。列表很长时用它一张张走，不用滚。 */
export function StepRow({
  selected,
  count,
  disabled,
  onStep,
}: {
  selected: number | null
  count: number
  disabled: boolean
  onStep: (direction: -1 | 1) => void
}) {
  const prevOff = disabled || selected === null || selected <= 0
  const nextOff = disabled || count === 0 || (selected !== null && selected >= count - 1)
  return (
    <div className="fs-2">
      <FsRow title="上一张" desc="选中前一张" disabled={prevOff} onClick={() => onStep(-1)} testId="img2pdf-prev" />
      <FsRow title="下一张" desc="选中后一张" disabled={nextOff} onClick={() => onStep(1)} testId="img2pdf-next" />
    </div>
  )
}

/** 添加图片的入口：手机扫码、U 盘（没接线，点进去看说明）；非一体机再多一行本机上传。 */
export function AddRows({
  disabled,
  reason,
  kiosk,
  onPickLocal,
  onShowQr,
  onOpenUsb,
}: {
  disabled: boolean
  reason: string
  kiosk: boolean
  onPickLocal: () => void
  onShowQr: () => void
  onOpenUsb: () => void
}) {
  return (
    <>
      {kiosk ? null : (
        <FsRow
          title="本机上传一张"
          desc={disabled ? reason : '在这台设备上选 JPG 或 PNG，一次一张'}
          disabled={disabled}
          onClick={onPickLocal}
          testId="img2pdf-add-local"
        />
      )}
      <div className="fs-2">
        <FsRow
          title="手机扫码上传一张"
          desc={disabled ? reason : '手机上选 JPG 或 PNG'}
          disabled={disabled}
          onClick={onShowQr}
          testId="img2pdf-add-phone"
        />
        <FsRow
          title="从 U 盘加图片"
          desc={disabled ? reason : '尚未接到列表'}
          disabled={disabled}
          onClick={onOpenUsb}
          testId="img2pdf-add-usb"
        />
      </div>
    </>
  )
}

/** 更多设置：选中一张之后的上移、下移、移除、查看，和停用着的旋转。 */
export function MoreSettings({
  selected,
  count,
  removeArmed,
  onMove,
  onRemove,
  onView,
}: {
  selected: number | null
  count: number
  removeArmed: boolean
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  onView: () => void
}) {
  const has = selected !== null
  const up = !has || selected === 0
  const down = !has || selected === count - 1
  const reason = !has
    ? '先在上面选中一张图片，再排序或移除。'
    : up
      ? '第 1 张已经在最前面，没有可以上移的位置。'
      : down
        ? `第 ${count} 张已经在最后，没有可以下移的位置。`
        : ''
  return (
    <div className="i2p-more" data-testid="img2pdf-selbar" data-sel={has ? String(selected) : ''}>
      <div className="i2p-more-grid">
        <FsRow title="上移" disabled={up} onClick={() => onMove(-1)} testId="img2pdf-up" />
        <FsRow title="下移" disabled={down} onClick={() => onMove(1)} testId="img2pdf-down" />
        <FsRow
          title={removeArmed ? '再点一次确认移除' : '移除'}
          desc={removeArmed ? '再按一次才从列表拿掉' : '从这次列表移除'}
          disabled={!has}
          onClick={onRemove}
          testId="img2pdf-del"
        />
        <FsRow title="查看" desc="看大图" disabled={!has} onClick={onView} testId="img2pdf-view" />
        <FsRow title="旋转 90°" desc="当前不可用" disabled onClick={() => undefined} testId="img2pdf-rot" />
      </div>
      {reason ? <p className="fs-p" id="selreason" data-testid="img2pdf-selreason">{reason}</p> : null}
    </div>
  )
}

/** 一次转换没成的各种原因，照实转述。正文里只有一处写这句原因（用例按整句找它）。 */
export function ErrorNote({ error, images }: { error: ConvertError; images: SelectedImage[] }) {
  const warn = (title: string, children: ReactNode, kind: 'warn' | 'error' = 'warn') => (
    <Band kind={kind} title={title}>{children}</Band>
  )
  const p = (children: ReactNode) => <p className="i2p-band-p">{children}</p>
  switch (error.kind) {
    case 'format':
      return warn('这一张格式不收', (
        <>
          {p(<>只收 <b>JPG / PNG</b>。刚才那张是 {error.rejected?.name ?? '不支持的格式'}，<b>本机在上传前就挡下了</b>，没有发给系统，也没有进列表。</>)}
          {p(error.message)}
        </>
      ))
    case 'too-large':
      return warn('这一张超过单张上限', (
        <>
          {p(<>单张<b>不超过 {formatBytes(MAX_SINGLE_IMAGE_BYTES)}</b>。{error.rejected ? <>刚才那张 <b>{error.rejected.detail}</b>，</> : null}本机在上传前就挡下了，没有进列表。</>)}
        </>
      ))
    case 'upload-failed':
      return warn('这一张没传上去', (
        <>
          {p(<>上传这一张的时候<b>没有拿到系统的确认</b>。这一张<b>没有进列表</b>；已经在列表里的图片和它们的顺序都没受影响。</>)}
          {p(error.message)}
        </>
      ), 'error')
    case 'source-unavailable':
      return warn('系统取不到其中一张', (
        <>
          {p(<>系统回的是同一句话：<b>「部分图片不存在或已失效」</b>。本页<b>不替它猜具体原因</b>。</>)}
          {p(<>这 {images.length} 张和你排的顺序<b>都还在</b>。把失效的那一张移除再补传一张，或者直接重试一次。</>)}
        </>
      ), 'error')
    case 'source-expired':
      return warn('有图片的访问链接过期了', (
        <>
          {p(<>未登录时，每张图片带的是<b>有有效期的临时访问链接</b>。系统回的仍然是<b>「部分图片不存在或已失效」</b>；本页判断成「过期」，靠的是<b>本机自己持有的那条链接已经到期</b>，不是系统这么说的。列表和顺序保留，重新传这一张即可。</>)}
        </>
      ))
    case 'total-too-large':
      return warn('这一批加起来太大了', (
        <>
          {p(<>单张都没超 10 MB，但合计 {formatBytes(totalBytesOf(images))}，超过了一次转换的 <b>40 MB</b> 上限，所以系统<b>一张都没转</b>。列表和顺序保留。</>)}
          {p(error.message)}
        </>
      ))
    case 'dimensions':
      return warn('有图片的像素超出上限', (
        <>
          {p(<>单张不超过 2500 万像素，整批未转换，列表和顺序保留。同一种失败也用在「图片文件已损坏或格式不匹配」上；本页只转述系统返回的结果，<b>不替它断定是坏文件</b>。</>)}
          {p(error.message)}
        </>
      ), 'error')
    case 'output-too-large':
      return warn('合出来的 PDF 太大了', (
        <>
          {p(<>输入没超限，但合成后的 PDF 超过了 {formatBytes(MAX_OUTPUT_BYTES)}，系统因此判定失败，<b>没有留下这份 PDF</b>。你的图片和顺序都还在：分两批合成通常就能过。</>)}
          {p(error.message)}
        </>
      ))
    case 'known-failed':
      return warn('这一次明确失败了', (
        <>
          {p(error.message)}
          {p(<>你排好的图片和顺序<b>都还在</b>，不用重新传。明确失败之后，可以再用这个标识原样提交一次。</>)}
        </>
      ), 'error')
    default:
      return warn('转换暂未完成', p(error.message), 'error')
  }
}

/** 一个正文里的整行按钮（稿里次出口都是这个样子，不挤进底栏）。 */
const ActionRow = FsRow

export type ConvertDockSpec = {
  /** 底栏右边的主按钮。没有就不画。 */
  primary?: QxTouchPrimary
  /** 次出口：放在正文底部。 */
  rows?: ReactNode
}

/**
 * 底栏三槽照稿：左边固定是「返回打印扫描」，中间问小青，右边主按钮；
 * 其余次出口都是正文里的整行按钮。按阶段给出主按钮与次出口。
 */
export function convertDockSpec(props: {
  phase: ConvertPhase
  imageCount: number
  error: ConvertError | null
  generating: boolean
  rechecking: boolean
  uploading: boolean
  hasEndUser: boolean | undefined
  kiosk: boolean
  onConvert: () => void
  onRecheck: () => void
  onNewKey: () => void
  onRestoreOrder: () => void
  onPrint: () => void
  onLogin: () => void
  onDocuments: () => void
  onCancelUpload: () => void
  onCloseUsb: () => void
  onPickLocal: () => void
  onBack: () => void
}): ConvertDockSpec {
  const { phase, imageCount, error, generating, rechecking, uploading, hasEndUser, kiosk } = props
  const primary = (p: Omit<QxTouchPrimary, 'testId'>): QxTouchPrimary => ({ ...p, testId: 'img2pdf-primary' })

  if (phase === 'empty') {
    return { primary: primary({ label: '至少加一张图再合成', onClick: () => undefined, disabled: true, noArrow: true }) }
  }
  if (phase === 'usb') {
    /* 一体机没有本机文件框：U 盘没接线时说「回到手机扫码」，不去开文件框（稿注）。 */
    return {
      rows: kiosk
        ? <ActionRow title="回到手机扫码" desc="继续用手机加图片" onClick={props.onCloseUsb} />
        : <ActionRow title="改用本机上传" desc="在这台设备上选 JPG 或 PNG" onClick={props.onCloseUsb} />,
    }
  }
  if (phase === 'uploading') {
    return { rows: <ActionRow title="取消这一张" desc="回到加图片" onClick={props.onCancelUpload} /> }
  }
  if (phase === 'converting') {
    return { primary: primary({ label: '合成完成后可继续', onClick: () => undefined, disabled: true, noArrow: true }) }
  }
  if (phase === 'completed') {
    return {
      primary: primary({ label: '拿这份 PDF 去打印', onClick: props.onPrint }),
      rows: typeof hasEndUser === 'boolean'
        ? hasEndUser
          ? <ActionRow title="查看我的文档" desc="登录后可以去我的文档" onClick={props.onDocuments} />
          : <ActionRow title="先登录再转换" desc="这是完成之后的登录入口，合成本身不用先登录" onClick={props.onLogin} />
        : null,
    }
  }
  if (phase === 'conflict') {
    return {
      rows: (
        <div className="fs-2">
          <ActionRow title="换一个新标识重新提交" desc="按当前顺序继续" onClick={props.onNewKey} />
          <ActionRow title="恢复上一次的顺序" desc="按冲突前的顺序放回" onClick={props.onRestoreOrder} />
        </div>
      ),
    }
  }
  if (error?.kind === 'in-progress' || error?.kind === 'result-unknown' || phase === 'rechecking') {
    return {
      primary: primary({
        label: rechecking ? '正在查询…' : error?.kind === 'result-unknown' ? '用同一个标记查这一次的结果' : '用同一个标记再查一次',
        onClick: props.onRecheck,
        disabled: rechecking,
      }),
    }
  }
  if (error?.kind === 'capability') {
    /* 本机没开放格式转换：重试也没用，出路是回打印扫描（稿「图片转 PDF：本机暂未开通」）。 */
    return { primary: primary({ label: '返回打印扫描', onClick: props.onBack }) }
  }
  if (error?.kind === 'known-failed' || error?.kind === 'source-unavailable' || error?.kind === 'source-expired' || error?.kind === 'total-too-large' || error?.kind === 'dimensions' || error?.kind === 'output-too-large') {
    return {
      primary: primary({ label: generating ? '正在生成…' : '改完之后重试合成', onClick: props.onConvert, disabled: generating }),
    }
  }
  if (error?.kind === 'format' || error?.kind === 'too-large' || error?.kind === 'upload-failed') {
    return {
      primary: primary({ label: '换一张再传', onClick: props.onPickLocal }),
      rows: <ActionRow title={`先用现有 ${imageCount} 张合成`} desc="不再等这一张" onClick={props.onConvert} disabled={imageCount === 0} />,
    }
  }
  return {
    primary: primary({
      label: generating ? '正在生成…' : `合成 ${imageCount} 张为一份 PDF`,
      onClick: props.onConvert,
      disabled: generating || uploading || imageCount === 0,
      noArrow: generating,
    }),
  }
}
