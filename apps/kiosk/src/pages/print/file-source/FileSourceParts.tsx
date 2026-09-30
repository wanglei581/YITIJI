// 选择文件来源 · 版式积木（稿 12-file-source 的 card / list / tail / qr-wrap）
//
// 只管排版，不管状态：每一块写什么由各通道的 body 决定，而且只写运行页确实做得到的事。
import type { ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { ClockIcon, SmartphoneIcon } from 'lucide-react'
import type { UploadTab } from './fileSourceModel'
import { ChannelGrid, FileSourceNote, FileSourceSteps } from './FileSourceBits'

const CHANNEL_NAME: Record<UploadTab, string> = {
  file: '本机选文件',
  qr: '手机扫码上传',
  usb: 'U 盘导入',
}

/** 稿 .sec.grow > .card：吸收本屏余量的主卡片，里面几组内容平分余量。 */
export function GrowCard({ children, spread, list, testId }: { children: ReactNode; spread?: boolean; list?: boolean; testId?: string }) {
  return (
    <section className="fs-sec qx-grow">
      <div className={`qx-card fs-gcard${spread ? ' spread' : ''}${list ? ' list' : ''}`} data-testid={testId}>{children}</div>
    </section>
  )
}

/** 稿 listCard：标题 + 提示 + 若干行 + 说明。 */
export function ListCard({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <GrowCard testId="file-source-list" list>
      <div className="fs-sec-h fs-gcard-h">
        <span className="t">{title}</span>
        <span className="hint">{hint}</span>
      </div>
      <div className="fs-gcard-body">{children}</div>
    </GrowCard>
  )
}

/** 稿 tailCard：标题 + 一句说明 + 三步 + 一句收尾。 */
export function TailCard({
  title,
  body,
  stepsTitle,
  steps,
  foot,
}: {
  title: string
  body: ReactNode
  stepsTitle: string
  steps: ReactNode[]
  foot: ReactNode
}) {
  return (
    <GrowCard>
      <div>
        <div className="fs-sec-h fs-gcard-h"><span className="t">{title}</span></div>
        <FileSourceNote>{body}</FileSourceNote>
      </div>
      <FileSourceSteps title={stepsTitle} items={steps} row />
      <FileSourceNote>{foot}</FileSourceNote>
    </GrowCard>
  )
}

/** 稿 spread 卡：一个小标题 + 几条说明（可再跟一段三步和一句收尾）。 */
export function NotesCard({
  title,
  notes,
  twoCol,
  after,
}: {
  title: string
  notes: ReactNode[]
  twoCol?: boolean
  after?: ReactNode
}) {
  return (
    <GrowCard spread>
      <div>
        <div className="fs-sec-h fs-gcard-h"><span className="t">{title}</span></div>
        <div className={`fs-notes${twoCol ? ' two' : ''}`}>
          {notes.map((note, index) => <FileSourceNote key={index}>{note}</FileSourceNote>)}
        </div>
      </div>
      {after}
    </GrowCard>
  )
}

export function EmptyBox({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="fs-empty">
      {icon ? <span className="fs-empty-ic">{icon}</span> : null}
      <span>{children}</span>
    </div>
  )
}

/** 稿 switchRow：手里没有文件时给「换一条通道也行」。 */
export function SwitchRow({
  keys,
  active,
  usbMode,
  onSelect,
}: {
  keys: UploadTab[]
  active: UploadTab
  usbMode: 'ok' | 'unavailable' | 'offline'
  onSelect: (key: UploadTab) => void
}) {
  return (
    <section className="fs-sec" data-testid="file-source-switch">
      <div className="fs-sec-h">
        <span className="no">02</span>
        <span className="t">换一条通道也行</span>
        <span className="hint">当前：{CHANNEL_NAME[active]}</span>
      </div>
      <ChannelGrid keys={keys} active={active} usbMode={usbMode} onSelect={onSelect} />
    </section>
  )
}

/** 稿 statusCard 下面的一段正文。 */
export function StatusP({ children }: { children: ReactNode }) {
  return <div className="fs-status-p">{children}</div>
}

export type QrKind = 'live' | 'dim' | 'blank'

/**
 * 稿 qr-wrap：左边码，右边标题 + 说明 + 两枚事实胶囊。
 * 码只画系统给出的真实链接；还没有链接就画空框（不画占位码），过期的画灰并盖一条「已失效」。
 */
export function PhoneQrCard({
  kind,
  qrUrl,
  title,
  expiresLabel,
  children,
}: {
  kind: QrKind
  qrUrl: string | null
  title: string
  expiresLabel?: string
  children: ReactNode
}) {
  const showCode = kind !== 'blank' && Boolean(qrUrl)
  return (
    <GrowCard>
      <div className="fs-qr-wrap">
        {showCode ? (
          <div className={`fs-qr${kind === 'dim' ? ' dim' : ''}`} data-testid="file-source-qr">
            <QRCodeSVG
              value={qrUrl ?? ''}
              size={396}
              level="M"
              marginSize={1}
              role="img"
              aria-label={kind === 'dim' ? '已失效的上传二维码' : '手机上传二维码'}
            />
            {kind === 'dim' ? <div className="fs-qr-mask">这张码已失效</div> : null}
          </div>
        ) : (
          <div className="fs-qr blank" role="img" aria-label="还没有上传二维码" data-testid="file-source-qr">
            <SmartphoneIcon size={72} strokeWidth={1.6} aria-hidden="true" />
            <span className="fs-qb-t">码还没出来</span>
            <span className="fs-qb-s">拿到系统给出的一次性链接之后<br />这里才会出现二维码</span>
          </div>
        )}
        <div className="fs-qr-side">
          <div>
            <h3>{title}</h3>
            {children}
          </div>
          <div className="fs-chips">
            {kind === 'blank' ? (
              <span className="fs-chip"><ClockIcon size={22} aria-hidden="true" />有效期以实际结果为准</span>
            ) : (
              <span className="fs-chip"><SmartphoneIcon size={22} aria-hidden="true" />单份 ≤ 10MB</span>
            )}
            <span className="fs-chip">PDF / JPG / PNG</span>
            {kind === 'live' && expiresLabel ? <span className="fs-chip">有效期还剩 {expiresLabel}</span> : null}
          </div>
        </div>
      </div>
    </GrowCard>
  )
}
