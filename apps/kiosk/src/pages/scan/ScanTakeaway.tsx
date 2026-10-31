import { useMemo } from 'react'
import { SmartphoneIcon } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { QxTouchOverlay } from '../../components/qingxu/touch/QxTouchOverlay'
import { formatRemainingSeconds, useRemainingSeconds } from '../../hooks/useCountdown'
import { PhoneHelpLine } from '../print-scan/phoneHelp'
import type { ScanType } from './scanWorkbench'
import { takeawayUrlOf } from './scanTakeawayUrl'
import './styles/scan-takeaway-qx.css'

/**
 * 游客扫完拿不到电子版（走查 I-15）：扫描件事后补不进账号（没有 claim 接口，登录时本机还会先收掉上一位的扫描，
 * 见 kioskClearScope），结果页原来只有「拿去打印」。这里补上「扫码带走」—— 用结果里那条短时内容链接
 * （服务端签发，当前 30 分钟，剩余时间读链接里的 expires）出二维码，与简历导出的「扫码带走」同一套做法，不新增接口。
 *
 * 证件扫描不给：证件是高敏感材料，公共屏幕上不放它的下载码（链接在有效期内谁拍到谁就能下）。要电子版请先登录再扫一次，
 * 扫出来直接在「我的文档」里。要放开只改这一张表。
 */
export const TAKEAWAY_ALLOWED: Readonly<Record<ScanType, boolean>> = { resume: true, id: false, document: true }

/** 结果页「去向」里的一行：扫码带走电子版（证件扫描时是停用态并说明原因）。 */
export function ScanTakeawayExit({ scanType, onOpen }: { scanType: ScanType; onOpen: () => void }) {
  const allowed = TAKEAWAY_ALLOWED[scanType]
  return (
    <button
      type="button"
      className={`sw-exit${allowed ? '' : ' is-off'}`}
      disabled={!allowed}
      onClick={onOpen}
      data-testid="scan-takeaway-open"
    >
      <span className="sw-exit-ic"><SmartphoneIcon size={20} aria-hidden /></span>
      <span className="sw-exit-body">
        <span className="sw-exit-title">
          {allowed ? '扫码带走电子版' : '证件扫描不提供扫码带走'}
          {allowed ? null : <span className="sw-offtag">暂不放行</span>}
        </span>
        <small>
          {allowed
            ? '用手机扫码保存这份扫描件。链接短时有效，只在你自己的手机上打开。'
            : '证件是敏感材料，公共屏幕上不放它的下载码。要电子版：先登录，再重新扫一次。'}
        </small>
      </span>
    </button>
  )
}

/** 扫码带走的层。看的是回执里那条临时链接；本层不另取文件、不存任何东西，关掉就没了。 */
export function ScanTakeawayLayer({ fileName, fileUrl, onClose }: { fileName: string; fileUrl: string; onClose: () => void }) {
  const link = useMemo(() => takeawayUrlOf(fileUrl, window.location.origin), [fileUrl])
  const expiresAt = link?.expiresAt ?? null
  const remaining = useRemainingSeconds(expiresAt)
  const expired = expiresAt !== null && remaining === 0
  return (
    <div className="sw-take-layer" data-testid="scan-takeaway-layer">
      <QxTouchOverlay
        kind="dialog"
        title="扫码带走这份扫描件"
        onClose={onClose}
        actions={<button type="button" className="qxt-btn qxt-btn-sec" data-testid="scan-takeaway-close" onClick={onClose}>关闭</button>}
      >
        <div className="sw-take-body">
          {!link ? (
            <p className="sw-take-expired" role="status" data-testid="scan-takeaway-unavailable">
              下载链接不可用。请重新扫描这一份，或先登录再扫，存进「我的文档」。
            </p>
          ) : expired ? (
            <p className="sw-take-expired" role="status" data-testid="scan-takeaway-expired">
              这个二维码已过期。请重新扫描这一份，或先登录再扫，存进「我的文档」。
            </p>
          ) : (
            // data-qr-origin / data-qr-path 只给用例核「码里是完整地址、指向内容端点」，不带查询串（签名不进 DOM 属性）。
            <div className="sw-take-qr" data-testid="scan-takeaway-qr" data-qr-origin={new URL(link.url).origin} data-qr-path={new URL(link.url).pathname}>
              <QRCodeSVG value={link.url} size={300} level="M" marginSize={1} />
            </div>
          )}
          <p className="sw-take-name">{fileName}</p>
          <p className="sw-take-note">
            {!link
              ? '没有有效的短时下载链接，不能生成二维码。'
              : expired
              ? '过期之后手机打不开这份文件。'
              : expiresAt !== null && remaining >= 0
                ? `用手机扫码保存。剩余 ${formatRemainingSeconds(remaining)}，只在你自己的手机上打开。`
                : '用手机扫码保存。链接短时有效，只在你自己的手机上打开。'}
          </p>
          {!link || expired ? null : <p className="sw-take-note">保存好之后点「关闭」，这个码就收起来了。</p>}
          <PhoneHelpLine />
        </div>
      </QxTouchOverlay>
    </div>
  )
}
