import { useSearchParams } from 'react-router-dom'
import { Page } from '../Page'
import TerminalsPage from '../terminals'
import PrintersPage from '../printers'
import PeripheralsPage from '../peripherals'
import { CableIcon, MonitorIcon, PrinterIcon } from 'lucide-react'

const TABS = [
  { key: 'terminals',   label: '终端',     icon: MonitorIcon },
  { key: 'printers',    label: '打印机',   icon: PrinterIcon },
  { key: 'peripherals', label: '外设',     icon: CableIcon   },
] as const

type TabKey = (typeof TABS)[number]['key']

const isTabKey = (v: string | null): v is TabKey =>
  v !== null && (TABS as readonly { key: string }[]).some((t) => t.key === v)

export default function DevicesPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const active: TabKey = isTabKey(raw) ? raw : 'terminals'

  const setActive = (key: TabKey) => {
    setParams({ tab: key }, { replace: true })
  }

  return (
    <Page title="设备管理" subtitle="终端 / 打印机 / 外设统一管理 · 状态每 30 秒由 Terminal Agent 心跳上报">
      {/* 原型下划线式 Tab */}
      <div className="mb-4 flex gap-1 border-b-[1.6px] border-neutral-900/[0.06]">
        {TABS.map(({ key, label, icon: Icon }) => {
          const selected = key === active
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              className={[
                'relative flex items-center gap-1.5 px-4 pb-3 pt-2.5 text-sm font-bold transition-colors',
                selected ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-700',
              ].join(' ')}
              aria-pressed={selected}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 -bottom-[1.6px] h-[3px] rounded-sm bg-primary-600"
                />
              )}
            </button>
          )
        })}
      </div>

      {active === 'terminals'   && <TerminalsPage />}
      {active === 'printers'    && <PrintersPage />}
      {active === 'peripherals' && <PeripheralsPage />}
    </Page>
  )
}
