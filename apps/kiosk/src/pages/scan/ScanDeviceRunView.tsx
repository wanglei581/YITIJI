import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { SCAN_DEVICE_RAIL, ScanWorkbenchShell } from './ScanWorkbenchChrome'
import { ScanDeviceArmNote, ScanDeviceStopButton } from './ScanDeviceStopButton'
import { ScanSheetArt } from './ScanSheetArt'

interface RunStop {
  armed: boolean
  busy: boolean
  disabled: boolean
  onPress: () => void
}

function Step({
  n,
  title,
  state,
  detail,
  current,
}: {
  n: number
  title: string
  state: string
  detail: string
  current?: boolean
}) {
  const cls = current ? 'now' : state === '完成' ? 'on' : ''
  return (
    <div className={`s ${cls}`.trim()}>
      <span className="n">{n}</span>
      <b>{title}</b>
      <em>{current ? <i className="cs-dot" /> : null}{state}</em>
      <small>{detail}</small>
    </div>
  )
}

/** 正在扫描，或还在等扫描仪回报已经开始。页数只来自云端整页。 */
export function ScanDeviceRunView({
  pages,
  scannerStarted,
  armed,
  stop,
}: {
  pages: number | null
  scannerStarted: boolean
  armed: boolean
  stop: RunStop
}) {
  const waiting = !scannerStarted
  return (
    <ScanWorkbenchShell
      page="scan-run"
      state="polling"
      title={waiting ? '已把扫描请求交给这台机器' : '正在扫描'}
      subtitle={waiting ? '还在等扫描仪回报已经开始。先别动原件。' : '先别动原件，扫描仪正在工作。'}
      status={{ tone: waiting ? 'warn' : 'ok', label: waiting ? '等待扫描仪' : '扫描中' }}
      bandEyebrow="屏上扫描"
      bandRail={{ labels: SCAN_DEVICE_RAIL, now: 3 }}
      bandBack={false}
      dock={{
        omitLeft: true,
        secondary: <ScanDeviceStopButton label="停止扫描" armed={stop.armed} busy={stop.busy} disabled={stop.disabled} onPress={stop.onPress} />,
      }}
    >
      <ScanDeviceRunContent pages={pages} scannerStarted={scannerStarted} armed={armed} />
    </ScanWorkbenchShell>
  )
}

/** 同一套整页进度与插画，复印只替换末步用途。 */
export function ScanDeviceRunContent({ pages, scannerStarted, armed, copy = false, preparing = false }: {
  pages: number | null; scannerStarted: boolean; armed: boolean; copy?: boolean; preparing?: boolean
}) {
  const waiting = !scannerStarted
  const thirdTitle = pages != null ? `已收到 ${pages} 页` : '正在扫描'
  return (
      <div className="cs-flow cs-run" data-testid="scan-device-run">
        <div className="cs-steps">
          <Step n={1} title="已收到" state="完成" detail="这台机器收到了扫描请求" />
          <Step n={2} title="扫描仪已开始" state={scannerStarted ? '完成' : '未开始'} detail="扫描仪回报已经开始扫" />
          <Step
            n={3}
            title={waiting ? '正在扫描' : thirdTitle}
            state={preparing ? '完成' : scannerStarted ? '进行中' : '未开始'}
            detail={pages != null ? '每扫完一整页才加一' : '先别动原件'}
            current={scannerStarted && !preparing}
          />
          <Step n={4} title={copy ? '整理成预览' : '生成文件并传回'} state={preparing ? '进行中' : '未开始'} current={preparing} detail={copy ? '扫完后准备给你核对' : '扫完后合成一个 PDF'} />
        </div>
        <div className={`cs-hero${pages == null ? ' none' : ''}${preparing ? ' preparing' : ''}`}>
          <div className="cs-hrow">
            <div className="cs-reader" aria-hidden="true">
              <ScanSheetArt width={pages == null ? 520 : 440} height={pages == null ? 736 : 622} />
              <span className="scanline" />
            </div>
            <div className="cs-side">
              {pages == null ? (
                <>
                  <div className="cs-spin" aria-hidden="true" />
                  <b className="cs-big">{waiting ? '等待扫描仪' : '正在扫描'}</b>
                </>
              ) : (
                <>
                  <div className="cs-count" data-testid="scan-device-page-count"><b>{pages}</b><span>页</span></div>
                  <p className="cs-cap">已收到</p>
                </>
              )}
            </div>
          </div>
          {pages != null ? <PageThumbs pages={pages} nextLabel={preparing ? '整理成预览' : '扫描中'} /> : null}
        </div>
        <ScanDeviceArmNote armed={armed} />
        <p className="cs-fine">每扫完一整页才加一；扫描仪不报就不显示页数</p>
      </div>
  )
}

function PageThumbs({ pages, nextLabel = '扫描中' }: { pages: number; nextLabel?: string }) {
  const shown = Math.min(pages, 5)
  const from = pages - shown
  return (
    <div className="cs-thumbs" aria-hidden="true">
      {Array.from({ length: shown }, (_, index) => (
        <span className="cs-pg" key={from + index}>
          <ScanSheetArt width={86} height={122} />
          <i><QxTouchIcon name="check" size={20} strokeWidth={3.4} /></i>
        </span>
      ))}
      <span className="cs-pg next">{nextLabel}</span>
    </div>
  )
}
