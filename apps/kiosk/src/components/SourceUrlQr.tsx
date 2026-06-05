// ============================================================
// SourceUrlQr — 来源平台投递二维码
//
// 渲染真实可扫码的二维码，内容必须是岗位的 sourceUrl（来源平台地址），
// 不是占位图。一体机 Kiosk 模式不直接跳出浏览器，用户用手机扫码到来源平台办理。
//
// 合规：本系统不接收简历、不参与招聘闭环，二维码只承载第三方/官方来源链接。
// ============================================================

import { QRCodeSVG } from 'qrcode.react'
import { isValidSourceUrl } from '../lib/url'

export function SourceUrlQr({
  value,
  size = 176,
}: {
  value: string | undefined | null
  size?: number
}) {
  if (!isValidSourceUrl(value)) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50 p-4 text-center text-xs text-neutral-400"
        style={{ width: size, height: size }}
      >
        <span>来源平台未提供有效链接</span>
        <span>请前往来源机构咨询投递方式</span>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <QRCodeSVG value={value} size={size} level="M" marginSize={0} />
    </div>
  )
}
