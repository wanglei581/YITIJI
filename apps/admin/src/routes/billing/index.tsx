// Admin 计费管理 + 本地对账页（W-C part2b-2）。
//
// 两块：
//   1. 价目配置：改价/启停（唯一合法改价路径，改价即时全端生效 + 服务端审计）。
//   2. 本地对账：账本交叉核对汇总 + 差异清单（只读，人工核查）。
//
// 合规：无任何支付凭证字段；改价前二次确认；停用价目会使对应报价 fail-closed，
// 页面明示此语义（非「免费」）。
import { useCallback, useEffect, useState } from 'react'
import { Card, EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { CheckIcon, RefreshCwIcon, XIcon } from 'lucide-react'
import { Page } from '../Page'
import {
  adminBillingService,
  type AdminPriceConfigItem,
  type ReconciliationReport,
} from '../../services/api/adminBilling'

const SERVICE_LABELS: Record<string, string> = {
  print_bw_page: '黑白打印（每页）',
  print_color_page: '彩色打印（每页）',
  print_duplex_surcharge: '双面附加',
}

const DISCREPANCY_LABELS: Record<string, string> = {
  PAID_WITHOUT_SUCCESS_ATTEMPT: '已支付但缺成功支付流水',
  REFUND_AMOUNT_MISMATCH: '退款额账实不符',
  ORDER_REFUNDED_WITHOUT_REFUND_ROW: '订单已退款但无退款记录',
  REFUND_SUCCESS_ORDER_NOT_REFUNDED: '有成功退款但订单未退款',
  STUCK_REFUNDING: '退款中超时未收敛',
}

function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}

function PriceConfigSection() {
  const [items, setItems] = useState<AdminPriceConfigItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [descriptionEditing, setDescriptionEditing] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await adminBillingService.listPriceConfig()
      setItems(res.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载价目失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const savePrice = useCallback(
    async (serviceKey: string) => {
      const yuanStr = editing[serviceKey]
      if (yuanStr === undefined) return
      const parsed = Number(yuanStr)
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError('单价必须为 ≥0 的数字')
        return
      }
      const unitCents = Math.round(parsed * 100)
      if (!window.confirm(`确认将「${SERVICE_LABELS[serviceKey] ?? serviceKey}」单价改为 ¥${(unitCents / 100).toFixed(2)}？改价即时对全端生效并记入审计。`)) return
      setSaving(serviceKey)
      setError(null)
      try {
        await adminBillingService.updatePriceConfig(serviceKey, { unitCents })
        setEditing((prev) => {
          const next = { ...prev }
          delete next[serviceKey]
          return next
        })
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : '改价失败')
      } finally {
        setSaving(null)
      }
    },
    [editing, load],
  )

  const saveDescription = useCallback(
    async (item: AdminPriceConfigItem) => {
      const nextDescription = descriptionEditing[item.serviceKey]
      const currentDescription = item.description ?? ''
      if (nextDescription === undefined || nextDescription === currentDescription) return
      if (nextDescription.length > 200) {
        setError('价目说明不能超过 200 个字符')
        return
      }
      const oldLabel = currentDescription || '（空）'
      const newLabel = nextDescription || '（空）'
      if (!window.confirm(
        `确认更新「${SERVICE_LABELS[item.serviceKey] ?? item.serviceKey}」说明？\n旧说明：${oldLabel}\n新说明：${newLabel}\n只更新说明，不修改单价与启停状态，操作记入审计。`,
      )) return
      setSaving(item.serviceKey)
      setError(null)
      try {
        await adminBillingService.updatePriceConfig(item.serviceKey, { description: nextDescription })
        await load()
        setDescriptionEditing((prev) => {
          const next = { ...prev }
          delete next[item.serviceKey]
          return next
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : '说明更新失败')
      } finally {
        setSaving(null)
      }
    },
    [descriptionEditing, load],
  )

  const toggleActive = useCallback(
    async (item: AdminPriceConfigItem) => {
      const nextActive = !item.active
      const warn = nextActive
        ? '启用后该项恢复计价。'
        : '停用后该项对应的打印报价会失败（不可下单），并非「免费」。确认停用？'
      if (!window.confirm(warn)) return
      setSaving(item.serviceKey)
      setError(null)
      try {
        await adminBillingService.updatePriceConfig(item.serviceKey, { active: nextActive })
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : '启停失败')
      } finally {
        setSaving(null)
      }
    },
    [load],
  )

  if (error && !items) return <ErrorState message={error} onRetry={() => void load()} />
  if (!items) return <LoadingState />

  return (
    <Card className="p-0">
      {error && <div className="border-b border-error/20 bg-error-bg px-5 py-3 text-sm text-error-fg">{error}</div>}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-900/10 bg-neutral-50/80 text-left text-[11.5px] text-neutral-500">
            <th className="px-5 py-2.5 font-bold tracking-[0.04em]">价目项</th>
            <th className="px-5 py-2.5 font-bold tracking-[0.04em]">单价（元）</th>
            <th className="px-5 py-2.5 font-bold tracking-[0.04em]">说明</th>
            <th className="px-5 py-2.5 font-bold tracking-[0.04em]">状态</th>
            <th className="px-5 py-2.5 font-bold tracking-[0.04em]">更新时间</th>
            <th className="px-5 py-2.5 text-right font-bold tracking-[0.04em]">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const editVal = editing[item.serviceKey]
            const descriptionEditVal = descriptionEditing[item.serviceKey]
            const currentDescription = item.description ?? ''
            const descriptionChanged = descriptionEditVal !== undefined && descriptionEditVal !== currentDescription
            const busy = saving === item.serviceKey
            return (
              <tr key={item.serviceKey} className="border-b border-neutral-50">
                <td className="px-5 py-3">
                  <div className="font-medium text-neutral-900">{SERVICE_LABELS[item.serviceKey] ?? item.serviceKey}</div>
                  <div className="text-xs text-neutral-400">{item.serviceKey}</div>
                </td>
                <td className="px-5 py-3">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editVal ?? (item.unitCents / 100).toFixed(2)}
                    disabled={busy}
                    onChange={(e) => setEditing((prev) => ({ ...prev, [item.serviceKey]: e.target.value }))}
                    className="w-28 rounded-md border border-neutral-200 px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-5 py-3">
                  <input
                    type="text"
                    maxLength={200}
                    aria-label={`${SERVICE_LABELS[item.serviceKey] ?? item.serviceKey}说明`}
                    value={descriptionEditVal ?? currentDescription}
                    disabled={busy}
                    onChange={(e) => setDescriptionEditing((prev) => ({
                      ...prev,
                      [item.serviceKey]: e.target.value,
                    }))}
                    className="w-full min-w-72 rounded-md border border-neutral-200 px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-5 py-3">
                  <StatusBadge status={item.active ? 'success' : 'default'} label={item.active ? '启用' : '停用'} />
                </td>
                <td className="px-5 py-3 text-xs text-neutral-400">{new Date(item.updatedAt).toLocaleString('zh-CN')}</td>
                <td className="px-5 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    {descriptionChanged && (
                      <button
                        onClick={() => void saveDescription(item)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                      >
                        <CheckIcon className="h-3.5 w-3.5" /> 保存说明
                      </button>
                    )}
                    {editVal !== undefined && (
                      <button
                        onClick={() => void savePrice(item.serviceKey)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                      >
                        <CheckIcon className="h-3.5 w-3.5" /> 保存改价
                      </button>
                    )}
                    <button
                      onClick={() => void toggleActive(item)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 disabled:opacity-50"
                    >
                      {item.active ? <XIcon className="h-3.5 w-3.5" /> : <CheckIcon className="h-3.5 w-3.5" />}
                      {item.active ? '停用' : '启用'}
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}

function ReconciliationSection() {
  const [report, setReport] = useState<ReconciliationReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setReport(await adminBillingService.reconciliation())
    } catch (e) {
      setError(e instanceof Error ? e.message : '对账失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (error && !report) return <ErrorState message={error} onRetry={() => void load()} />
  if (!report) return <LoadingState />

  const s = report.summary
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 disabled:opacity-50"
        >
          <RefreshCwIcon className={['h-4 w-4', loading ? 'animate-spin' : ''].join(' ')} /> 刷新
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['应收合计', yuan(s.grossPaidCents), `${s.paidOrderCount} 单`],
          ['退款合计', yuan(s.refundedCents), `${s.refundedOrderCount} 单`],
          ['净额', yuan(s.netCents), '应收 − 退款'],
          ['退款中', String(s.refundingCount), '待收敛'],
        ].map(([label, value, hint]) => (
          <Card key={label} className="p-4">
            <div className="text-xs text-neutral-500">{label}</div>
            <div className="mt-1 text-xl font-bold text-neutral-900">{value}</div>
            <div className="mt-0.5 text-xs text-neutral-400">{hint}</div>
          </Card>
        ))}
      </div>

      <Card className="p-0">
        <div className="border-b border-neutral-100 px-5 py-3 text-sm font-medium text-neutral-700">
          账本差异（{report.discrepancies.length}）
        </div>
        {report.discrepancies.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState title="账本自洽" description="未发现账本差异；渠道账单 diff 需在部署期用真实商户账单核对。" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-900/10 bg-neutral-50/80 text-left text-[11.5px] text-neutral-500">
                <th className="px-5 py-2.5 font-bold tracking-[0.04em]">差异类型</th>
                <th className="px-5 py-2.5 font-bold tracking-[0.04em]">订单号</th>
                <th className="px-5 py-2.5 font-bold tracking-[0.04em]">明细</th>
              </tr>
            </thead>
            <tbody>
              {report.discrepancies.map((d, i) => (
                <tr key={`${d.orderId}-${i}`} className="border-b border-neutral-50">
                  <td className="px-5 py-3">
                    <StatusBadge status="warning" label={DISCREPANCY_LABELS[d.code] ?? d.code} />
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-neutral-600">{d.orderNo}</td>
                  <td className="px-5 py-3 text-xs text-neutral-500">{JSON.stringify(d.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {(report.attention.latePaid.length > 0 || report.attention.reconciled.length > 0) && (
        <Card className="p-5 text-sm text-neutral-500">
          需复核（非错误）：迟到入账 {report.attention.latePaid.length} 单 · 主动查单入账 {report.attention.reconciled.length} 单。
        </Card>
      )}
    </div>
  )
}

export default function BillingPage() {
  const [tab, setTab] = useState<'price' | 'reconciliation'>('price')
  return (
    <Page title="计费与对账" subtitle="打印价目管理（唯一合法改价路径，改价即时生效并记审计）与本地账本对账">
      <div className="mb-4 flex gap-2">
        {(
          [
            ['price', '价目配置'],
            ['reconciliation', '本地对账'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={[
              'rounded-md px-4 py-2 text-sm font-medium',
              tab === key ? 'bg-primary-600 text-white' : 'border border-neutral-200 text-neutral-600',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'price' ? <PriceConfigSection /> : <ReconciliationSection />}
    </Page>
  )
}
