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
    <Page title="设备管理" subtitle="终端、打印机与外设的集中视图">
      <div className="mb-5 inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
        {TABS.map(({ key, label, icon: Icon }) => {
          const selected = key === active
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              className={[
                'flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                selected
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-600 hover:bg-gray-50',
              ].join(' ')}
              aria-pressed={selected}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
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
