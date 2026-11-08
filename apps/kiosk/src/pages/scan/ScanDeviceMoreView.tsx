import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { GlassArt } from './ScanGuideArt'
import { SCAN_DEVICE_RAIL, ScanWorkbenchShell } from './ScanWorkbenchChrome'
import { ScanDeviceArmNote, ScanDeviceStopButton } from './ScanDeviceStopButton'
import { ScanSheetArt, ScanStackArt } from './ScanSheetArt'

interface MoreStop {
  armed: boolean
  busy: boolean
  disabled: boolean
  onPress: () => void
}

/** 玻璃台这一页已经扫好。再扫一页和扫完了都只打本机，不自己宣布完成。 */
export function ScanDeviceMoreView({
  pages,
  maxPages,
  armed,
  busy,
  stop,
  onNext,
  onFinish,
}: {
  pages: number | null
  maxPages: number | null
  armed: boolean
  busy: boolean
  stop: MoreStop
  onNext: () => void
  onFinish: () => void
}) {
  const full = maxPages != null && pages != null && pages >= maxPages
  const received = pages != null ? `已收到 ${pages} 页` : '这一页已扫好'
  const remind = maxPages != null
    ? `最多 ${maxPages} 页；10 分钟内没操作会自动结束`
    : '10 分钟内没操作会自动结束'
  return (
    <ScanWorkbenchShell
      page="scan-more"
      state="polling"
      title="这一页扫好了，还有下一页吗？"
      subtitle={null}
      status={{ tone: 'ok', label: received }}
      bandEyebrow="屏上扫描 · 玻璃台"
      bandRail={{ labels: SCAN_DEVICE_RAIL, now: 3 }}
      bandBack={false}
      dock={{
        leftNode: (
          <ScanDeviceStopButton
            label="停止扫描"
            short
            armed={stop.armed}
            busy={stop.busy}
            disabled={stop.disabled}
            onPress={stop.onPress}
          />
        ),
        primary: {
          label: '扫完了',
          testId: 'scan-device-finish',
          disabled: busy || stop.busy,
          onClick: onFinish,
        },
      }}
    >
      <div className="cs-flow cs-more" data-testid="scan-device-more">
        <div className="cs-strip">
          <MoreThumbs pages={pages} />
          <p>
            {received}
            {maxPages != null ? <small>最多 {maxPages} 页</small> : null}
          </p>
        </div>
        <div className="cs-ways">
          <button type="button" className="cs-way" data-testid="scan-device-next" disabled={full || busy || stop.busy} onClick={onNext}>
            <span className="vis" aria-hidden="true"><GlassArt /></span>
            <span className="tx">
              <h3>再扫一页</h3>
              <p>{full && maxPages != null ? `已经到 ${maxPages} 页，不能再加了` : '先把下一页放上玻璃台，字朝下，对齐左上角'}</p>
            </span>
            <span className="arrow" aria-hidden="true"><QxTouchIcon name="arrowR" size={30} strokeWidth={2.4} /></span>
          </button>
          <button type="button" className="cs-way" disabled={busy || stop.busy} onClick={onFinish}>
            <span className="vis" aria-hidden="true"><ScanStackArt /></span>
            <span className="tx">
              <h3>扫完了，生成文件</h3>
              <p>{pages != null ? `把已收到的 ${pages} 页合成一个 PDF` : '把已经扫到的页合成一个 PDF'}</p>
            </span>
            <span className="arrow" aria-hidden="true"><QxTouchIcon name="arrowR" size={30} strokeWidth={2.4} /></span>
          </button>
        </div>
        <ScanDeviceArmNote armed={armed} />
        <div className="cs-remind">
          <QxTouchIcon name="clock" size={34} strokeWidth={2} />
          <span>{remind}</span>
        </div>
      </div>
    </ScanWorkbenchShell>
  )
}

function MoreThumbs({ pages }: { pages: number | null }) {
  if (pages == null) return null
  const shown = Math.min(pages, 3)
  const from = pages - shown
  return (
    <div className="cs-thumbs" aria-hidden="true">
      {Array.from({ length: shown }, (_, index) => (
        <span className="cs-pg" key={from + index}>
          <ScanSheetArt width={210} height={297} />
          <i><QxTouchIcon name="check" size={26} strokeWidth={3.4} /></i>
        </span>
      ))}
      <span className="cs-pg next">
        <span className="cs-plus" aria-hidden="true">+</span>
        <span>下一页</span>
      </span>
    </div>
  )
}
