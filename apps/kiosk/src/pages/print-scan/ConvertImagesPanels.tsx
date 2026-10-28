import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  EyeIcon,
  InfoIcon,
  PlusIcon,
  RotateCwIcon,
  SmartphoneIcon,
  TrashIcon,
  UsbIcon,
  XIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { QxTouchPrimary } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { PhoneArt, UsbArt } from './ToolArt'
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
        {breathe ? <span className="i2p-dot" aria-hidden /> : <InfoIcon size={27} />}
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

export function Rules() {
  return (
    <div className="i2p-pgrp" data-testid="img2pdf-rules">
      <h4>这里的规矩</h4>
      <ul className="i2p-plan">
        <li><span className="i2p-sq" /><span>只收 JPG / PNG；单张不超过 10 MB，也不超过 2500 万像素。</span></li>
        <li><span className="i2p-sq" /><span>一次最多 20 张；合计不超过 40 MB，也不超过 2 亿像素。</span></li>
        <li><span className="i2p-sq" /><span>每张图片占一页，按 A4 排版；生成的 PDF 不超过 15 MB。</span></li>
        <li><span className="i2p-sq" /><span>顺序按你排的来，删掉一张后序号立刻重排。</span></li>
      </ul>
    </div>
  )
}

export function Retention({ loggedIn }: { loggedIn: boolean }) {
  return (
    <div className="i2p-pgrp" data-testid="img2pdf-retention" data-auth={loggedIn ? 'in' : 'out'}>
      <h4>生成之后放哪</h4>
      <div className="i2p-band-p">
        {loggedIn
          ? <>转换生成的 PDF 会进<b>「我的文档」</b>，默认保存约 24 小时，可以在那一页手动延长保存期限。</>
          : <><b>登录后再转换，才会存进「我的文档」</b>；不登录也能转换、直接打印，但转好之后再登录也存不进去。这是公用终端，也<b>不会下载到本机</b>。</>}
      </div>
      <div className="i2p-band-p">打印用的临时链接 <b>30 分钟内有效</b>，过期后回到这一页重新取一次。</div>
    </div>
  )
}

export function AddRow({
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
  const localLabel = '本机上传一张'
  return (
    <div className="i2p-addrow">
      {!kiosk && <button
        type="button"
        className="i2p-add"
        data-testid="img2pdf-add-local"
        disabled={disabled}
        aria-label={disabled ? `本机上传一张（${reason}）` : localLabel}
        onClick={onPickLocal}
      >
        <PlusIcon size={26} />
        本机上传一张
      </button>}
      <button
        type="button"
        className="i2p-add"
        data-testid="img2pdf-add-phone"
        disabled={disabled}
        aria-label={disabled ? `手机扫码上传一张（${reason}）` : '手机扫码上传一张'}
        onClick={onShowQr}
      >
        <SmartphoneIcon size={26} />
        手机扫码上传一张
      </button>
      <button
        type="button"
        className="i2p-add"
        data-testid="img2pdf-add-usb"
        disabled={disabled}
        aria-label={disabled ? `U 盘导入图片（${reason}）` : 'U 盘导入图片'}
        onClick={onOpenUsb}
      >
        <UsbIcon size={26} />
        U 盘导入图片
      </button>
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
    <div className="i2p-lwrap qx-grow" data-testid="img2pdf-list" data-count={images.length}>
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
              <span className="i2p-idx">{index + 1}</span>
              <span className="i2p-ithumb">
                <img src={img.fileAccessUrl} alt={`${img.name} 缩略图`} />
              </span>
              <span className="i2p-imeta">
                <b>{img.name}</b>
                <span>{img.size} · {img.source === 'qr' ? '手机扫码上传' : '本机上传'}</span>
              </span>
            </button>
            <button
              type="button"
              className="i2p-ibtn"
              aria-label={`完整查看第 ${index + 1} 张：${img.name}`}
              onClick={() => onPreview(index)}
            >
              <EyeIcon size={26} />
            </button>
          </div>
        ))}
      </div>
      <div
        className="i2p-ordline"
        data-testid="img2pdf-order"
        data-order={names.join(' | ')}
        data-sent-payload={names.join(' | ')}
      >
        <b>提交顺序</b>
        下面这个顺序<b>就是</b>提交给系统的顺序，也是 PDF 的页序：第 1 页 {names[0]}
        {names.length > 1 ? `，最后一项是第 ${names.length} 页 ${names[names.length - 1]}` : ''}
        （共 {names.length} 项）。
      </div>
    </div>
  )
}

export function SelBar({
  selected,
  count,
  onMove,
  onRemove,
}: {
  selected: number | null
  count: number
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
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
    <>
      <div className="i2p-selbar" data-testid="img2pdf-selbar" data-sel={has ? String(selected) : ''}>
        <button type="button" className="i2p-selbtn" data-testid="img2pdf-up" disabled={up} onClick={() => onMove(-1)} aria-label="上移">
          <ArrowUpIcon size={24} />上移
        </button>
        <button type="button" className="i2p-selbtn" data-testid="img2pdf-down" disabled={down} onClick={() => onMove(1)} aria-label="下移">
          <ArrowDownIcon size={24} />下移
        </button>
        <button type="button" className="i2p-selbtn" data-testid="img2pdf-rot" disabled aria-label="旋转 90°" aria-describedby="rotreason">
          <RotateCwIcon size={24} />旋转 90°
        </button>
        <button type="button" className="i2p-selbtn del" data-testid="img2pdf-del" disabled={!has} onClick={onRemove} aria-label="移除">
          <TrashIcon size={24} />移除
        </button>
      </div>
      {reason ? <div className="i2p-rotnote" id="selreason" data-testid="img2pdf-selreason">{reason}</div> : null}
      <div className="i2p-rotnote" id="rotreason" data-testid="img2pdf-rotnote">
        旋转 90° <b>当前不可用</b>：格式转换还不能旋转，这一步也还没接上。按钮保持禁用，不会制造“已经旋转但导出没变化”的假操作。
      </div>
    </>
  )
}

export function UsbGap() {
  return (
    <>
      <Band kind="warn" title="U 盘图片导入尚未接到转换列表" breathe chips={['目标来源：U 盘', '当前：还没接进这一页', '不读取、不上传']}>
        <div className="i2p-band-p">这台机器可以从 U 盘导入文件去打印，但<b>图片转 PDF 这一页现在只接了本机上传和手机扫码上传</b>。</div>
      </Band>
      <div className="i2p-sec-label"><span className="no">01</span><span className="t">这一页接了哪些来源</span><span className="hint">三个入口，接进这一页的是 2 个</span></div>
      <div className="i2p-grid3" data-testid="img2pdf-sources">
        <div className="i2p-pgrp i2p-ub-src" data-wired="yes">
          <span className="i2p-ub-ic"><PlusIcon size={30} /></span>
          <span className="i2p-ub-n">本机上传一张</span>
          <span className="i2p-chip ok">已接进这一页</span>
          <div className="i2p-ub-d">在这台机器上选文件，一次一张；<b>拿到系统确认</b>之后它才成为列表里的一页。</div>
          <div className="i2p-ub-to"><CheckIcon size={22} /><span>进「待合并图片」列表</span></div>
        </div>
        <div className="i2p-pgrp i2p-ub-src" data-wired="yes">
          <span className="i2p-ub-ic"><SmartphoneIcon size={30} /></span>
          <span className="i2p-ub-n">手机扫码上传一张</span>
          <span className="i2p-chip ok">已接进这一页</span>
          <div className="i2p-ub-d">扫码在手机上选图，传完<b>回到这一页</b>接着排顺序，页序还是你自己定。</div>
          <div className="i2p-ub-to"><CheckIcon size={22} /><span>进「待合并图片」列表</span></div>
        </div>
        <div className="i2p-pgrp i2p-ub-src off" data-wired="no" data-testid="img2pdf-src-usb">
          <span className="i2p-ub-ic"><UsbIcon size={30} /></span>
          <span className="i2p-ub-n">U 盘导入图片</span>
          <span className="i2p-chip warn">还没接进这一页</span>
          <div className="i2p-ub-d">U 盘里的图片还不能按你排好的顺序回到这个列表，所以这里<b>不放一个会把文件带错流程的按钮</b>。</div>
          <div className="i2p-ub-to"><XIcon size={22} /><span>到不了「待合并图片」列表</span></div>
        </div>
      </div>
      <div className="i2p-sec-label"><span className="no">02</span><span className="t">U 盘里的图片，现在能走这两条</span><span className="hint">两条都不会自动回到这个列表</span></div>
      <div className="qx-card i2p-ub-ways" data-testid="img2pdf-usb-ways">
        <div className="i2p-ub-way">
          <div className="i2p-ub-wh"><b>要拼成一份 PDF</b><span>图片得先落到手机或这台机器上</span></div>
          <div className="i2p-ub-flow" role="img" aria-label="路线一：U 盘里的图片先拷到手机或本机，再在这一页上传">
            <span className="i2p-ub-node"><b>U 盘</b><i>图片现在在这里</i></span>
            <span className="i2p-ub-node"><b>拷到手机或本机</b><i>这一步你自己做</i></span>
            <span className="i2p-ub-node"><b>在这一页上传</b><i>本机或手机扫码</i></span>
            <span className="i2p-ub-node on"><b>进「待合并图片」列表</b><i>到这里才排得出页序</i></span>
          </div>
          <div className="i2p-ub-note">拷进来之后<b>就和本机上传的那些图片一样</b>：一张一页，顺序还是你自己排。</div>
        </div>
        <div className="i2p-ub-way">
          <div className="i2p-ub-wh"><b>只想把原图打出来</b><span>那是打印流程，不是这一页</span></div>
          <div className="i2p-ub-flow" role="img" aria-label="路线二：U 盘导入打印不会回到图片转 PDF 列表">
            <span className="i2p-ub-node"><b>U 盘</b><i>图片现在在这里</i></span>
            <span className="i2p-ub-node"><b>通用「U 盘导入打印」</b><i>在「打印扫描」里</i></span>
            <span className="i2p-ub-node"><b>那边的打印流程</b><i>另一条闭环</i></span>
            <span className="i2p-ub-cut"><XIcon size={22} />不回到这个列表</span>
          </div>
          <div className="i2p-ub-note">那条路<b>不会自动回到图片转 PDF 的待合并列表</b>，也就排不出页序；要拼成一份 PDF，还是得走上面那条。</div>
        </div>
      </div>
    </>
  )
}

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
          <span className="go" aria-hidden="true"><QxTouchIcon name="chevR" size={28} strokeWidth={2.2} /></span>
        </button>
        {kiosk ? null : (
          <button type="button" className="fs-act" data-testid="img2pdf-add-local" onClick={onPickLocal}>
            <span className="vis" aria-hidden="true"><PlusIcon size={48} /></span>
            <span className="tx">
              <h3>本机上传一张</h3>
              <p>在这台电脑上选 JPG 或 PNG，一次一张。一体机不打开系统文件框。</p>
            </span>
            <span className="go" aria-hidden="true"><QxTouchIcon name="chevR" size={28} strokeWidth={2.2} /></span>
          </button>
        )}
        <button type="button" className="fs-act off" disabled data-testid="img2pdf-src-usb" aria-disabled="true">
          <span className="vis" aria-hidden="true"><UsbArt /></span>
          <span className="tx">
            <span className="sx-chip">暂未开通</span>
            <h3>U 盘导入</h3>
            <p>从 U 盘加图片，本机暂未开通。</p>
          </span>
          <span className="go" aria-hidden="true"><QxTouchIcon name="chevR" size={28} strokeWidth={2.2} /></span>
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

export function ErrorBand({ error, images }: { error: ConvertError; images: SelectedImage[] }) {
  if (error.kind === 'format') {
    return (
      <Band kind="warn" title="这一张格式不收" chips={['仅 JPG / PNG', '本机就挡下了', '没有进列表']}>
        <div className="i2p-band-p">只收 <b>JPG / PNG</b>。刚才那张是 {error.rejected?.name ?? '不支持的格式'}，<b>本机在上传前就挡下了</b>，没有发给系统。</div>
        <div className="i2p-band-p">{error.message}</div>
      </Band>
    )
  }
  if (error.kind === 'too-large') {
    return (
      <Band kind="warn" title="这一张超过单张上限" chips={['单张 ≤ 10 MB', '本机就挡下了', '没有进列表']}>
        <div className="i2p-band-p">单张<b>不超过 {formatBytes(MAX_SINGLE_IMAGE_BYTES)}</b>。{error.rejected ? <>刚才那张 <b>{error.rejected.detail}</b>，</> : null}本机在上传前就挡下了。</div>
      </Band>
    )
  }
  if (error.kind === 'upload-failed') {
    return (
      <Band kind="error" title="这一张没传上去" chips={['没有拿到确认', '没有进列表', '已有顺序不受影响']}>
        <div className="i2p-band-p">上传这一张的时候<b>没有拿到系统的确认</b>。这一张<b>没有进列表</b>；已经在列表里的图片和它们的顺序都没受影响。</div>
        <div className="i2p-band-p">{error.message}</div>
      </Band>
    )
  }
  if (error.kind === 'source-unavailable') {
    return (
      <Band kind="error" title="系统取不到其中一张" chips={['系统：部分图片不存在或已失效', '列表和顺序保留', '没有生成任何 PDF']}>
        <div className="i2p-band-p">系统回的是同一句话：<b>「部分图片不存在或已失效」</b>。本页<b>不替它猜具体原因</b>。</div>
        <div className="i2p-band-p">这 {images.length} 张和你排的顺序<b>都还在</b>。把失效的那一张移除再补传一张，或者直接重试一次。</div>
      </Band>
    )
  }
  if (error.kind === 'source-expired') {
    return (
      <Band kind="warn" title="有图片的访问链接过期了" chips={['临时链接有有效期', '列表和顺序保留', '重新传这一张即可']}>
        <div className="i2p-band-p">未登录时，每张图片带的是<b>有有效期的临时访问链接</b>。系统回的仍然是<b>「部分图片不存在或已失效」</b>；本页判断成「过期」，靠的是<b>本机自己持有的那条链接已经到期</b>，不是系统这么说的。</div>
      </Band>
    )
  }
  if (error.kind === 'total-too-large') {
    return (
      <Band kind="warn" title="这一批加起来太大了" chips={[`合计 ${formatBytes(totalBytesOf(images))} / ${formatBytes(MAX_TOTAL_INPUT_BYTES)}`, '一张都没转', '列表和顺序保留']}>
        <div className="i2p-band-p">单张都没超 10 MB，但合计超过了一次转换的 <b>40 MB</b> 上限，所以系统<b>一张都没转</b>。</div>
        <div className="i2p-band-p">{error.message}</div>
      </Band>
    )
  }
  if (error.kind === 'dimensions') {
    return (
      <Band kind="error" title="有图片的像素超出上限" chips={['单张 ≤ 2500 万像素', '整批未转换', '列表和顺序保留']}>
        <div className="i2p-band-p">同一种失败也用在「图片文件已损坏或格式不匹配」上；本页只转述系统返回的结果，<b>不替它断定是坏文件</b>。</div>
        <div className="i2p-band-p">{error.message}</div>
      </Band>
    )
  }
  if (error.kind === 'output-too-large') {
    return (
      <Band kind="warn" title="合出来的 PDF 太大了" chips={[`输出上限 ${formatBytes(MAX_OUTPUT_BYTES)}`, '没有留下这份 PDF', '列表和顺序保留']}>
        <div className="i2p-band-p">输入没超限，但合成后的 PDF 超过了 15 MB，系统因此判定失败，<b>没有留下这份 PDF</b>。你的图片和顺序都还在：分两批合成通常就能过。</div>
        <div className="i2p-band-p">{error.message}</div>
      </Band>
    )
  }
  if (error.kind === 'in-progress') {
    return (
      <Band kind="lock" title="上一次用同一标记的生成还在进行" chips={['系统：正在进行中', '不发起新的生成', '用同一标记再查']}>
        <div className="i2p-band-p">系统回的是 <b>「上一次生成仍在进行中，请稍候重试」</b>。这时候<b>不发起新的生成</b>。正确做法是拿同一个标记<b>再查一次</b>。</div>
      </Band>
    )
  }
  if (error.kind === 'result-unknown') {
    return (
      <Band kind="warn" title="这一次的结果不知道" chips={['结果未知', '不发起新的生成', '用同一标记查询']}>
        <div className="i2p-band-p">请求发出去了，但<b>结果没有送到这台机器</b>。所以现在有两种可能：系统已经做完了，或者根本没做成。</div>
        <div className="i2p-band-p">在弄清楚之前，<b>不能直接再发一次</b>。正确做法是拿<b>同一个标记</b>去查这一次的结果。</div>
      </Band>
    )
  }
  if (error.kind === 'known-failed') {
    return (
      <Band kind="error" title="这一次明确失败了" chips={['系统已明确失败', '没有生成 PDF', '列表和顺序保留']}>
        <div className="i2p-band-p">{error.message}</div>
        <div className="i2p-band-p">你排好的图片和顺序<b>都还在</b>，不用重新传。明确失败之后，可以再用这个标识原样提交一次。</div>
      </Band>
    )
  }
  if (error.kind === 'conflict') {
    return (
      <Band kind="error" title="这个标识已经用在另一批图片上了" chips={['系统已拒绝', '没有生成任何 PDF', '不自动替你决定']}>
        <div className="i2p-band-p">系统拒绝了：<b>「该请求标识已用于另一批图片，请更换标识重试」</b>。本页<b>就停在这里</b>：不自动换标识、不自动改回旧顺序。</div>
      </Band>
    )
  }
  if (error.kind === 'capability') {
    return (
      <Band kind="error" title="本机暂未开放格式转换" chips={['能力未配置或不可用']}>
        <div className="i2p-band-p">{error.message}</div>
      </Band>
    )
  }
  return (
    <Band kind="error" title="转换暂未完成">
      <div className="i2p-band-p">{error.message}</div>
    </Band>
  )
}


/** 一个正文里的整行按钮（稿里次出口都是这个样子，不挤进底栏）。 */
function ActionRow({ title, desc, onClick, disabled }: { title: string; desc?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="fs-row" disabled={disabled} onClick={onClick}>
      <span><b>{title}</b>{desc ? <small>{desc}</small> : null}</span>
    </button>
  )
}

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
  if (error?.kind === 'known-failed' || error?.kind === 'source-unavailable' || error?.kind === 'source-expired' || error?.kind === 'total-too-large' || error?.kind === 'dimensions' || error?.kind === 'output-too-large' || error?.kind === 'capability') {
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
