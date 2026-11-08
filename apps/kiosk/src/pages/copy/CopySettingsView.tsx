import type { CopySettings } from '../../services/api/copyJobs'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { FeederArt, GlassArt } from '../scan/ScanGuideArt'
import { stepCopyCount } from './copySession'

export function CopySettingsView({ settings, color, duplex, locked, notice, onPick }: {
  settings: CopySettings; color: boolean; duplex: boolean; locked: boolean; notice: string | null
  onPick: (settings: CopySettings) => void
}) {
  const choose = (patch: Partial<CopySettings>) => onPick({ ...settings, ...patch })
  return <div className="cc-settings">
    <h2 className="cc-section">原件放哪？</h2>
    <div className="cc-sources">
      {(['flatbed', 'feeder'] as const).map((source) => <button type="button" key={source} className="cc-source" disabled={locked}
        aria-pressed={settings.source === source} onClick={() => choose({ source })}>
        <span className="vis">{source === 'flatbed' ? <GlassArt /> : <FeederArt />}</span>
        <b>{source === 'flatbed' ? '玻璃台' : '进纸器'}</b>
        <span>{source === 'flatbed' ? '一次一页，适合证件、书本' : '一叠最多 50 页，只扫单面'}</span>
        <span className="muted">{source === 'flatbed' ? '字朝下，对齐左上角' : '字朝上'}</span>
        {settings.source === source ? <span className="cc-tick"><QxTouchIcon name="check" size={26} strokeWidth={3} /></span> : null}
      </button>)}
    </div>
    <div className="cc-params">
      <div className="cc-row"><b>份数</b><div className="cc-step">
        {([-10, -1] as const).map((delta) => <button type="button" key={delta} aria-label={delta === -10 ? '少十份' : '少一份'}
          disabled={locked || settings.copies <= 1} onClick={() => choose({ copies: stepCopyCount(settings.copies, delta) })}>{delta === -10 ? '−10' : '−'}</button>)}
        <output data-testid="copy-count">{settings.copies}<small>份</small></output>
        {([1, 10] as const).map((delta) => <button type="button" key={delta} aria-label={delta === 10 ? '多十份' : '多一份'}
          disabled={locked || settings.copies >= 99} onClick={() => choose({ copies: stepCopyCount(settings.copies, delta) })}>{delta === 10 ? '+10' : '+'}</button>)}
        <span className="cc-cap">1–99 份</span>
      </div></div>
      <div className="cc-row"><b>颜色</b><div className="cc-segment" role="group" aria-label="颜色">
        <button type="button" disabled={locked} aria-pressed={settings.colorMode === 'black_white'} onClick={() => choose({ colorMode: 'black_white' })}>黑白</button>
        <button type="button" disabled={locked || !color} aria-pressed={settings.colorMode === 'color'} onClick={() => choose({ colorMode: 'color' })}>彩色{!color ? <small>本机暂未开通</small> : null}</button>
      </div></div>
      <div className="cc-row"><b>单双面</b><div className="cc-segment" role="group" aria-label="单双面">
        <button type="button" disabled={locked} aria-pressed={settings.duplex === 'simplex'} onClick={() => choose({ duplex: 'simplex' })}>单面</button>
        <button type="button" disabled={locked || !duplex} aria-pressed={settings.duplex !== 'simplex'} onClick={() => choose({ duplex: 'duplex_long_edge' })}>双面{!duplex ? <small>本机暂未开通</small> : null}</button>
      </div></div>
    </div>
    <p className="cc-fine">原件几页，扫完才知道；扫完会给你核对</p>
    {notice ? <p role="status" className="cc-note">{notice}</p> : null}
  </div>
}
