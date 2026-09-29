import { useEffect, useId, useRef, useState } from 'react'
import { Button, Card } from '@ai-job-print/ui'
import { AlertCircleIcon, CheckCircle2Icon, InfoIcon, XIcon } from 'lucide-react'
import {
  officialChannelErrorMessage,
  partnerOfficialChannelsService,
  type OfficialChannelPartnerItem,
  type UpdateOfficialChannelInput,
} from '../../services/api/officialChannels'
import {
  OFFICIAL_CHANNEL_NAME_MAX,
  OFFICIAL_CHANNEL_ORDER_MAX,
  OFFICIAL_CHANNEL_URL_MAX,
  canonicalChannelUrl,
  channelUrlHint,
  checkChannelUrl,
} from './officialChannelRules'

/** 调用方按 mode + 渠道 id 给弹窗换 key：换了编辑对象就整个重建，表单从新对象重新取初值。 */
export type OfficialChannelDialogTarget =
  | { mode: 'create'; nextOrder: number }
  | { mode: 'edit'; channel: OfficialChannelPartnerItem }

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none disabled:bg-neutral-50'

const HINT_TONE = {
  ok: 'text-success-fg',
  warn: 'text-warning-fg',
  muted: 'text-neutral-500',
} as const

function parseOrder(raw: string): number | null {
  if (!/^\d{1,3}$/.test(raw.trim())) return null
  const value = Number(raw.trim())
  return value <= OFFICIAL_CHANNEL_ORDER_MAX ? value : null
}

/**
 * 添加 / 编辑本机构官方渠道（3.14）。
 *
 * 链接预检只做说明、不拦提交：规则以服务端为准，服务端拒绝时把它的中文原因原样放在弹窗里，
 * 弹窗不关、不显示「已保存」。只有服务端返回了保存后的渠道，才交给列表并关闭弹窗。
 * 编辑时只提交改过的字段（服务端只在链接真的变了时才重验域名）。
 */
export function OfficialChannelDialog({
  target,
  domains,
  onClose,
  onSaved,
}: {
  target: OfficialChannelDialogTarget
  domains: readonly string[]
  onClose: () => void
  onSaved: (item: OfficialChannelPartnerItem) => void
}) {
  const titleId = useId()
  const editing = target.mode === 'edit' ? target.channel : null
  const [name, setName] = useState(editing?.name ?? '')
  const [url, setUrl] = useState(editing?.url ?? '')
  const [order, setOrder] = useState(String(editing ? editing.displayOrder : target.mode === 'create' ? target.nextOrder : 0))
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Escape 关弹窗；保存进行中不关，免得结果回来时弹窗已经没了。
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    if (saving) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving])

  const trimmedName = name.trim()
  const nameOk = trimmedName.length > 0 && trimmedName.length <= OFFICIAL_CHANNEL_NAME_MAX
  const urlOk = url.trim().length > 0 && url.trim().length <= OFFICIAL_CHANNEL_URL_MAX
  const orderValue = parseOrder(order)
  const hint = channelUrlHint(checkChannelUrl(url, domains), domains)

  const changes: UpdateOfficialChannelInput = {}
  if (editing) {
    if (trimmedName !== editing.name) changes.name = trimmedName
    if (canonicalChannelUrl(url) !== editing.url) changes.url = url.trim()
    if (orderValue !== null && orderValue !== editing.displayOrder) changes.displayOrder = orderValue
  }
  const unchanged = editing !== null && Object.keys(changes).length === 0
  const canSubmit = nameOk && urlOk && orderValue !== null && !unchanged && !saving

  const submit = async () => {
    if (!canSubmit || orderValue === null) return
    setSaving(true)
    setError(null)
    try {
      const saved = editing
        ? await partnerOfficialChannelsService.update(editing.id, changes)
        : await partnerOfficialChannelsService.create({
            name: trimmedName,
            url: url.trim(),
            displayOrder: orderValue,
            enabled,
          })
      onSaved(saved)
    } catch (e) {
      setError(officialChannelErrorMessage(e, '保存没有成功，渠道未改变，请稍后重试'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}
    >
      <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 id={titleId} className="text-base font-semibold text-neutral-900">
            {editing ? '编辑官方渠道' : '添加官方渠道'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭"
            className="flex h-10 w-10 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 disabled:opacity-50"
          >
            <XIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 flex items-baseline justify-between text-neutral-600">
              <span>渠道名称<span className="ml-0.5 text-error-fg">*</span></span>
              <span className={`text-xs tabular-nums ${trimmedName.length > OFFICIAL_CHANNEL_NAME_MAX ? 'text-error-fg' : 'text-neutral-400'}`}>
                {trimmedName.length} / {OFFICIAL_CHANNEL_NAME_MAX}
              </span>
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              placeholder="例如：学校就业信息网"
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-neutral-500">一体机上显示在二维码旁边，写清是哪个网站或账号。</span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-neutral-600">
              链接<span className="ml-0.5 text-error-fg">*</span>
            </span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={saving}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://"
              className={`${inputCls} font-mono`}
            />
            <span className={`mt-1 flex items-start gap-1.5 text-xs ${HINT_TONE[hint.tone]}`} data-testid="channel-url-hint">
              {hint.tone === 'ok'
                ? <CheckCircle2Icon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                : hint.tone === 'warn'
                  ? <AlertCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  : <InfoIcon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              <span>{hint.text}</span>
            </span>
          </label>

          <div className="rounded-lg bg-neutral-50 px-3 py-2.5 text-xs leading-relaxed text-neutral-500">
            <p className="font-medium text-neutral-600">链接规则（保存时由平台校验）</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>只能是 https:// 开头的链接，不能带账号信息或端口号；</li>
              <li>域名必须是已登记的官方域名或它的子域名：{domains.join('、') || '（尚未登记）'}；</li>
              <li>链接里如果有跳转到其他网站的参数，跳转目标也必须在这些域名内；</li>
              <li>商业招聘网站不能设为本机构官方渠道。</li>
            </ul>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-neutral-600">排序</span>
            <input
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              disabled={saving}
              inputMode="numeric"
              className={`${inputCls} w-32`}
            />
            <span className={`mt-1 block text-xs ${orderValue === null ? 'text-error-fg' : 'text-neutral-500'}`}>
              {orderValue === null ? `请填 0 到 ${OFFICIAL_CHANNEL_ORDER_MAX} 的整数` : '数字越小越靠前'}
            </span>
          </label>

          {!editing && (
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-neutral-300"
                checked={enabled}
                disabled={saving}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              保存后立即启用（在本机构终端显示）
            </label>
          )}

          {error && (
            <p className="rounded-lg bg-error-bg px-3 py-2 text-sm text-error-fg" role="alert">
              <span className="font-semibold">没有保存：</span>
              {error}
            </p>
          )}
          {unchanged && <p className="text-xs text-neutral-400">还没有改动。</p>}

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button size="sm" onClick={() => void submit()} disabled={!canSubmit}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
