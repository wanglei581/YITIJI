import { useNavigate } from 'react-router-dom'
import { InfoIcon, PrinterIcon, QrCodeIcon } from 'lucide-react'
import { isValidSourceUrl } from '../../lib/url'
import { BTN_OFFICIAL, BTN_PRINT } from './shared'
import { SOCIAL_GUIDES } from './builtinData'

// ─── Panel: 社保指南（内置办事指引；扫码入口均为真实官方平台）───────────────────

export function SocialPanel({ onOfficialEntry }: { onOfficialEntry: (title: string, url: string) => void }) {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-xs text-neutral-400">
        <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
        内置办事指引 · 整理自公开官方口径，具体流程与材料以官方平台为准
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {SOCIAL_GUIDES.map((guide) => {
          const Icon = guide.icon
          const hasOfficial = Boolean(guide.officialUrl && isValidSourceUrl(guide.officialUrl))
          return (
            <div key={guide.key} className="flex flex-col rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${guide.iconBg}`}>
                  <Icon className={`h-6 w-6 ${guide.iconColor}`} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold text-neutral-900">{guide.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-neutral-500">{guide.desc}</p>
                </div>
              </div>

              <ol className="mt-4 flex flex-col gap-2">
                {guide.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning/20 text-xs font-bold text-warning-fg">
                      {i + 1}
                    </span>
                    <span className="text-sm text-neutral-600">{step}</span>
                  </li>
                ))}
              </ol>

              <div className="mt-4">
                {guide.entryLabel.includes('扫码') ? (
                  hasOfficial && (
                    <button
                      type="button"
                      onClick={() => onOfficialEntry(guide.title, guide.officialUrl!)}
                      className={`w-full justify-center ${BTN_OFFICIAL}`}
                    >
                      <QrCodeIcon className="h-4 w-4" aria-hidden="true" />
                      {guide.entryLabel}
                    </button>
                  )
                ) : (
                  <button type="button" onClick={() => navigate('/print/upload')} className={`w-full justify-center ${BTN_PRINT}`}>
                    <PrinterIcon className="h-4 w-4" aria-hidden="true" />
                    {guide.entryLabel}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
