import { useNavigate } from 'react-router-dom'
import { ChevronRightIcon, InfoIcon, PrinterIcon } from 'lucide-react'
import { BTN_PRINT } from './shared'
import { REGISTER_ITEMS } from './builtinData'

// ─── Panel: 就业登记（内置办事指引；线下办理，无线上预约入口时不渲染占位按钮）───

export function RegisterPanel() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-xs text-neutral-400">
        <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
        内置办事指引 · 办理地点与材料以当地就业服务机构公布为准
      </p>

      {REGISTER_ITEMS.map((item) => {
        const Icon = item.icon
        return (
          <div key={item.key} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${item.iconBg}`}>
                <Icon className={`h-6 w-6 ${item.iconColor}`} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold text-neutral-900">{item.title}</p>
                <p className="mt-1 text-sm text-neutral-500">{item.purpose}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl bg-neutral-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">办理地点</p>
                <p className="mt-1.5 text-sm font-medium text-neutral-700">{item.location}</p>
              </div>
              <div className="rounded-xl bg-neutral-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">所需材料</p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {item.materials.map((m, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-neutral-700">
                      <ChevronRightIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden="true" />
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2.5">
              <button type="button" onClick={() => navigate('/print/upload')} className={BTN_PRINT}>
                <PrinterIcon className="h-4 w-4" aria-hidden="true" />
                打印材料清单
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
