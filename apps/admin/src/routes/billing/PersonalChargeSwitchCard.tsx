import { formatYuan, TERMINAL_CHARGE_SERVICE_KEYS, TERMINAL_CHARGE_SERVICE_LABELS } from '@ai-job-print/shared'
import { Card } from '@ai-job-print/ui'
import { useCallback, useEffect, useState } from 'react'
import { chargeListKind, KIOSK_PAY_SCREEN_NOTE } from '../../lib/kioskPayScreenNote'
import {
  adminBillingService,
  type PersonalChargeOverview,
  type PersonalChargeTerminalRow,
} from '../../services/api/adminBilling'

function yuan(cents: number): string {
  return formatYuan(cents / 100)
}

function ChargeTerminalLine({ terminal }: { terminal: PersonalChargeTerminalRow }) {
  return (
    <li>
      <span className="font-mono">{terminal.terminalCode}</span>
      {' '}{terminal.displayName || '未命名'}{' '}{terminal.locationLabel || '未设置点位'}
      <span className="mt-0.5 block text-xs text-neutral-600">
        {TERMINAL_CHARGE_SERVICE_KEYS.map((key) => `${TERMINAL_CHARGE_SERVICE_LABELS[key]} ${yuan(terminal.prices[key] ?? 0)}`).join('；')}
      </span>
    </li>
  )
}

function ChargeTerminalLists({ terminals }: { terminals: PersonalChargeTerminalRow[] }) {
  const printing = terminals.filter((terminal) => chargeListKind(terminal.prices) === 'print')
  const serviceOnly = terminals.filter((terminal) => chargeListKind(terminal.prices) === 'service_only')
  return (
    <div className="mt-1 space-y-3">
      <section aria-label="打印在收费">
        <p className="font-medium">打印在收费</p>
        {printing.length === 0 ? <p className="mt-1 text-neutral-500">现在没有。</p> : (
          <ul className="mt-1 space-y-2">{printing.map((terminal) => <ChargeTerminalLine key={terminal.terminalCode} terminal={terminal} />)}</ul>
        )}
      </section>
      {serviceOnly.length === 0 ? null : (
        <section aria-label="AI / 扫描服务在收费">
          <p className="font-medium">AI / 扫描服务在收费</p>
          <p className="mt-0.5 text-xs text-neutral-500">{KIOSK_PAY_SCREEN_NOTE}</p>
          <ul className="mt-1 space-y-2">{serviceOnly.map((terminal) => <ChargeTerminalLine key={terminal.terminalCode} terminal={terminal} />)}</ul>
        </section>
      )}
    </div>
  )
}

const PERSONAL_CHARGE_PREREQUISITES = [
  '打印要出版主管部门书面答复或印刷经营许可证',
  '每个点位的分支机构登记',
  'AI 要通信管理局书面答复',
  '小程序虚拟支付已接入',
  '再问青岛人社第十八条',
  '所有收费要律师定稿的收费与退款条款',
  '自助开票',
  '自动退款',
]

export function PersonalChargeSwitchCard() {
  const [overview, setOverview] = useState<PersonalChargeOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setOverview(await adminBillingService.getPersonalCharge())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '总开关读取失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onToggle = async () => {
    if (!overview) return
    const next = !overview.enabled
    if (next) {
      const count = overview.terminals.length
      if (!window.confirm(`确认打开向个人收费？打开后有 ${count} 台机器会开始向用户收费。`)) return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await adminBillingService.setPersonalCharge(next, next ? true : undefined)
      setOverview(saved)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '总开关保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="mb-4 p-4">
      <h2 className="text-[15px] font-bold text-neutral-900">向个人收费总开关</h2>
      {error ? <p className="mt-2 text-sm text-error-fg" role="alert">{error}</p> : null}
      {!overview ? <p className="mt-2 text-sm text-neutral-500">正在读取…</p> : (
        <div className="mt-2 space-y-3 text-sm text-neutral-800">
          <p>现在{overview.enabled ? '开着' : '关着'}。关着时，即使某台机器配了价，用户这边仍是 0 元。</p>
          <button
            type="button"
            disabled={saving}
            onClick={() => void onToggle()}
            className="min-h-12 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? '保存中…' : overview.enabled ? '关闭向个人收费' : '打开向个人收费'}
          </button>
          <div>
            <p className="font-medium">打开后会开始向用户收费的机器</p>
            {overview.terminals.length === 0 ? (
              <p className="mt-1 text-neutral-500">现在没有。要同时是向用户收费、不是公共就业点位、并且至少有一个价大于 0。</p>
            ) : (
              <ChargeTerminalLists terminals={overview.terminals} />
            )}
          </div>
          <div>
            <p className="font-medium">打开前要备齐</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-neutral-600">
              {PERSONAL_CHARGE_PREREQUISITES.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>
      )}
    </Card>
  )
}
