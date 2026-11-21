import { formatYuan } from '@ai-job-print/shared'
import { Card, StatusBadge } from '@ai-job-print/ui'
import { CheckIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  adminVirtualPayService,
  type VirtualPayServiceKind,
  type VirtualPaySettingsResponse,
} from '../../../services/api/adminVirtualPay'
import {
  VPAY_SERVICE_KINDS,
  vpayRuntimeLabel,
  vpayServiceLabel,
} from './virtualPayLabels'

interface GoodsDraft {
  productId: string
  yuan: string
}

export function VirtualPaySettingsCard() {
  const [settings, setSettings] = useState<VirtualPaySettingsResponse | null>(null)
  const [drafts, setDrafts] = useState<Record<string, GoodsDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [savingSwitch, setSavingSwitch] = useState(false)
  const [savingKind, setSavingKind] = useState<string | null>(null)

  const syncDrafts = useCallback((data: VirtualPaySettingsResponse) => {
    const next: Record<string, GoodsDraft> = {}
    for (const kind of VPAY_SERVICE_KINDS) {
      const item = data.goods[kind]
      next[kind] = {
        productId: item?.productId ?? '',
        yuan: item?.priceCents != null ? (item.priceCents / 100).toFixed(2) : '',
      }
    }
    setDrafts(next)
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      const data = await adminVirtualPayService.getSettings()
      setSettings(data)
      syncDrafts(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取小程序虚拟支付配置失败')
    }
  }, [syncDrafts])

  useEffect(() => {
    void load()
  }, [load])

  const onToggleSwitch = async () => {
    if (!settings) return
    const next = !settings.enabled
    if (next) {
      if (!window.confirm('确认打开小程序虚拟支付开关？打开后且「向个人收费总开关」同时开启时，小程序端才会开放购买，操作记入审计。')) {
        return
      }
    } else if (!window.confirm('确认关闭小程序虚拟支付开关？关闭后小程序不再新下单，已购可用权益仍可继续核销，操作记入审计。')) {
      return
    }
    setSavingSwitch(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await adminVirtualPayService.setEnabled(next, next ? true : undefined)
      setSettings(saved)
      setNotice(next ? '已打开小程序虚拟支付开关。' : '已关闭小程序虚拟支付开关。')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存开关失败')
    } finally {
      setSavingSwitch(false)
    }
  }

  const onSaveGoods = async (kind: VirtualPayServiceKind) => {
    const draft = drafts[kind]
    if (!draft) return
    const productId = draft.productId.trim()
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(productId)) {
      setError('道具编号只允许 1 到 20 位字母、数字、下划线或连字符')
      return
    }
    const parsed = Number(draft.yuan)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('道具单价必须大于 0 元')
      return
    }
    const priceCents = Math.round(parsed * 100)
    const label = vpayServiceLabel(kind)
    if (
      !window.confirm(
        `确认保存「${label}」虚拟支付道具配置？\n道具编号：${productId}\n单价：${formatYuan(priceCents / 100)}\n请确保与微信公众平台后台已发布道具完全一致，操作记入审计。`,
      )
    ) {
      return
    }
    setSavingKind(kind)
    setError(null)
    setNotice(null)
    try {
      const saved = await adminVirtualPayService.setGoods(kind, {
        productId,
        priceCents,
        confirm: true,
      })
      setSettings(saved)
      syncDrafts(saved)
      setNotice(`已保存「${label}」道具配置。`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存道具配置失败')
    } finally {
      setSavingKind(null)
    }
  }

  const runtime = vpayRuntimeLabel(settings?.runtime)

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-neutral-900">小程序虚拟支付开关与道具配置</h2>
          <p className="mt-1 text-xs text-neutral-500">
            默认关闭；必须与「向个人收费总开关」同时开启，且服务端环境变量配齐后，小程序才允许新下单。价格与道具编号仅保存在平台设置中。
          </p>
        </div>
        {settings ? (
          <div className="flex items-center gap-2">
            <StatusBadge status={settings.enabled ? 'success' : 'default'} label={settings.enabled ? '开关已开' : '开关已关'} />
            <StatusBadge status={runtime.ready ? 'success' : 'warning'} label={runtime.ready ? '参数已就绪' : '参数未就绪'} />
          </div>
        ) : null}
      </div>

      {error ? <p className="mt-3 rounded-md bg-error-bg px-3 py-2 text-sm text-error-fg" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">{notice}</p> : null}

      {!settings ? (
        <p className="mt-3 text-sm text-neutral-500">正在读取配置…</p>
      ) : (
        <div className="mt-3 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 text-sm">
            <div className="space-y-1 text-neutral-700">
              <div>
                当前状态：虚拟支付开关<strong>{settings.enabled ? '开着' : '关着'}</strong>，
                向个人收费总开关<strong>{settings.personalChargeEnabled ? '开着' : '关着'}</strong>，
                当前<strong>{settings.canSell ? '允许小程序下单' : '不可新下单'}</strong>。
              </div>
              <div className="text-xs text-neutral-500">运行环境状态：{runtime.text}</div>
            </div>
            <button
              type="button"
              disabled={savingSwitch}
              onClick={() => void onToggleSwitch()}
              className="rounded-md bg-primary-600 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              {savingSwitch ? '保存中…' : settings.enabled ? '关闭小程序虚拟支付' : '打开小程序虚拟支付'}
            </button>
          </div>

          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-neutral-900/10 bg-neutral-50/80 text-left text-[11.5px] text-neutral-500">
                <th className="w-[18%] px-3 py-2 font-bold">服务项</th>
                <th className="w-[14%] px-3 py-2 font-bold">配置状态</th>
                <th className="w-[28%] px-3 py-2 font-bold">微信道具编号</th>
                <th className="w-[22%] px-3 py-2 font-bold">单价（元）</th>
                <th className="w-[18%] px-3 py-2 text-right font-bold">操作</th>
              </tr>
            </thead>
            <tbody>
              {VPAY_SERVICE_KINDS.map((kind) => {
                const item = settings.goods[kind]
                const draft = drafts[kind] ?? { productId: '', yuan: '' }
                const busy = savingKind === kind
                const label = vpayServiceLabel(kind)
                return (
                  <tr key={kind} className="border-b border-neutral-100">
                    <td className="px-3 py-2.5 font-medium text-neutral-900">{label}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={item?.configured ? 'success' : 'default'} label={item?.configured ? '已配置' : '未配置'} />
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        type="text"
                        maxLength={20}
                        aria-label={`${label}道具编号`}
                        placeholder="请输入微信已发布道具编号"
                        value={draft.productId}
                        disabled={busy}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [kind]: { ...draft, productId: e.target.value } }))
                        }
                        className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 font-mono text-xs"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        aria-label={`${label}单价`}
                        placeholder="例如 1.00"
                        value={draft.yuan}
                        disabled={busy}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [kind]: { ...draft, yuan: e.target.value } }))
                        }
                        className="w-full max-w-32 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onSaveGoods(kind)}
                        className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                      >
                        <CheckIcon className="h-3.5 w-3.5" /> {busy ? '保存中…' : '保存道具'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
