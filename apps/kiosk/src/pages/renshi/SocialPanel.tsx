import { useNavigate } from 'react-router-dom'
import { PrinterIcon, QrCodeIcon } from 'lucide-react'
import { isValidSourceUrl } from '../../lib/url'
import { SOCIAL_GUIDES } from './builtinData'
import type { SourceQrTarget } from './components'

const SRC_RULE = '来源入口由发布方提供，本系统未核验其官方性；扫码前请核对机构和目标域名。'

export function SocialPanel({ onOfficialEntry }: { onOfficialEntry: (target: SourceQrTarget) => void }) {
  const navigate = useNavigate()

  return (
    <div className="rq-social">
      <div className="rq-grid">
        {SOCIAL_GUIDES.map((guide) => {
          const Icon = guide.icon
          const hasOfficial = Boolean(guide.officialUrl && isValidSourceUrl(guide.officialUrl))
          return (
            <article key={guide.key} className="rq-blk">
              <header className="rq-blk-h">
                <Icon aria-hidden="true" />
                <b>{guide.title}</b>
              </header>
              <p className="rq-item-sub">{guide.desc}</p>
              <ol className="rq-steps-mini">
                {guide.steps.map((step, index) => (
                  <li key={step}><span>{index + 1}</span>{step}</li>
                ))}
              </ol>
              {guide.entryLabel.includes('扫码') ? (
                hasOfficial && (
                  <button
                    type="button"
                    className="rq-exit"
                    onClick={() => onOfficialEntry({
                      title: guide.title,
                      url: guide.officialUrl!,
                      sourceKind: '本机整理的社保指引',
                      sourceDetail: guide.title,
                    })}
                  >
                    <QrCodeIcon aria-hidden="true" />
                    <span><b>{guide.entryLabel}</b><small>先核对机构和目标域名</small></span>
                  </button>
                )
              ) : (
                <>
                  {guide.offlineNote ? <p className="rq-note rq-note-warn">{guide.offlineNote}</p> : null}
                  <button type="button" className="rq-exit" onClick={() => navigate('/print/upload')}>
                    <PrinterIcon aria-hidden="true" />
                    <span><b>{guide.entryLabel}</b><small>本机只打印你自己带来的文件</small></span>
                  </button>
                </>
              )}
            </article>
          )
        })}
      </div>
      <p className="rq-note">{SRC_RULE}</p>
    </div>
  )
}
