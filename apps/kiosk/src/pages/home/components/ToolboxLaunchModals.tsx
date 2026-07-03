import { Button } from '@ai-job-print/ui'
import type { KioskAppPlacement, KioskToolboxItem } from '@ai-job-print/shared'
import { ExternalLinkIcon, ShieldAlertIcon, XIcon } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import {
  recordToolboxLaunchEvent,
  recordToolboxLaunchEventBeforeUnload,
} from '../../../services/api/toolboxLaunchEvents'

function targetLabel(rawTarget: string | null | undefined): string | null {
  const target = rawTarget?.trim()
  if (!target) return null
  const candidate = /^https?:\/\//i.test(target) ? target : `https://${target}`
  try {
    const url = new URL(candidate)
    return url.hostname || target.split('?')[0]!.slice(0, 80)
  } catch {
    return target.split('?')[0]!.slice(0, 80)
  }
}

function ModalShell({
  children,
  onClose,
  width = 'w-[min(420px,100%)]',
}: {
  children: ReactNode
  onClose: () => void
  width?: string
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/45 px-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`${width} rounded-[28px] bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.3)]`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export function QrLaunchModal({
  item,
  placement,
  onClose,
}: {
  item: KioskToolboxItem | null
  placement: KioskAppPlacement
  onClose: () => void
}) {
  useEffect(() => {
    if (!item) return
    recordToolboxLaunchEvent({ itemKey: item.key, action: 'show_qr', placement })
  }, [item, placement])

  if (!item) return null
  const label = targetLabel(item.qrTargetUrl)
  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-2xl font-extrabold text-neutral-900">{item.title}</p>
          <p className="mt-1 text-sm font-semibold text-neutral-500">{item.description || '请扫码继续办理'}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
          aria-label="关闭"
        >
          <XIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-6 flex justify-center rounded-[24px] bg-neutral-50 p-5">
        <img src={item.qrImageUrl ?? ''} alt={`${item.title}二维码`} className="h-64 w-64 rounded-2xl object-contain" />
      </div>
      <div className="mt-4 rounded-2xl border border-warning/20 bg-warning-bg px-4 py-3 text-sm font-semibold leading-relaxed text-warning-fg">
        {label ? (
          <p>运营方声明目标：{label}</p>
        ) : (
          <p>请确认二维码来源可信后再继续办理。</p>
        )}
        <p className="mt-1 text-xs font-medium text-warning-fg">
          请优先在本人手机上完成第三方服务操作。本终端不记录你在第三方页面的办理结果。
        </p>
      </div>
    </ModalShell>
  )
}

export function ExternalLaunchModal({
  item,
  placement,
  onClose,
}: {
  item: KioskToolboxItem | null
  placement: KioskAppPlacement
  onClose: () => void
}) {
  useEffect(() => {
    if (!item?.externalUrl) return
    recordToolboxLaunchEvent({ itemKey: item.key, action: 'open_external_notice', placement })
  }, [item, placement])

  if (!item?.externalUrl) return null
  const label = targetLabel(item.externalUrl) ?? '第三方服务'
  const closeWithCancel = () => {
    recordToolboxLaunchEvent({ itemKey: item.key, action: 'cancel_external', placement })
    onClose()
  }
  const openExternal = () => {
    recordToolboxLaunchEventBeforeUnload({ itemKey: item.key, action: 'open_external_confirmed', placement })
    window.location.assign(item.externalUrl!)
  }

  return (
    <ModalShell onClose={closeWithCancel} width="w-[min(520px,100%)]">
      <div className="flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-warning-bg text-warning-fg">
          <ShieldAlertIcon className="h-7 w-7" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-extrabold leading-tight text-neutral-900">即将进入第三方服务</p>
          <p className="mt-2 text-sm font-semibold leading-relaxed text-neutral-500">
            {item.title} 由外部服务方提供，目标域名：{label}
          </p>
        </div>
        <button
          type="button"
          onClick={closeWithCancel}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
          aria-label="关闭"
        >
          <XIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-5 rounded-2xl border border-warning/20 bg-warning-bg px-4 py-3 text-sm font-semibold leading-relaxed text-warning-fg">
        <p>本系统不收集你在第三方页面输入的信息，也不记录第三方办理结果。</p>
        <p className="mt-1 text-xs font-medium text-warning-fg">
          如需输入账号、验证码、身份证号或支付信息，建议改用本人手机办理。
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Button type="button" variant="secondary" className="h-14 rounded-2xl text-base font-bold" onClick={closeWithCancel}>
          返回首页
        </Button>
        <Button type="button" className="h-14 rounded-2xl text-base font-bold" onClick={openExternal}>
          继续打开
          <ExternalLinkIcon className="ml-2 h-5 w-5" aria-hidden="true" />
        </Button>
      </div>
    </ModalShell>
  )
}
