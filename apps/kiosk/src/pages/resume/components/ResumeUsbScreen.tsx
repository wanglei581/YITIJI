import type { ReactNode } from 'react'
import { FileTextIcon, LoaderIcon, UsbIcon } from 'lucide-react'
import type { UsbFileListItem, UsbStatus } from '../../../services/files/usbImportApi'
import type { UsbChannelPhase } from './resumeChannelCopy'

interface ResumeUsbScreenProps {
  phase: UsbChannelPhase
  status: UsbStatus | null
  files: UsbFileListItem[] | null
  loading: boolean
  error: string | null
  importFault: { name: string; message: string } | null
  importingName: string | null
  helpLine: string
  onImport: (item: UsbFileListItem) => void
  onRedetect: () => void
  onLeave: () => void
  onUsePhone: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Track({ step }: { step: string }): ReactNode {
  return <p className="qx-rt-track"><span className="tx"><b>{step}</b></span></p>
}

/**
 * 稿 21 的 U 盘整屏。只画本机程序真能走到的态。
 * 「回到来源选择」只写在读盘没连上这一支：去掉它，离线用例必须红。
 */
export function ResumeUsbScreen({
  phase, status, files, loading, error, importFault, importingName, helpLine,
  onImport, onRedetect, onLeave, onUsePhone,
}: ResumeUsbScreenProps): ReactNode {
  if (phase === 'usb-agent-offline') {
    return (
      <section className="qx-rt-channel" aria-label="U盘简历文件" data-usb-state="error">
        <Track step="读 U 盘暂时没连上" />
        <div className="qx-rt-note" data-tone="error" role="alert">
          <b>读 U 盘暂时没连上</b>
          <span>U 盘导入是开通的，只是这会儿没连上这台机器的本机程序。{error}</span>
        </div>
        <ol className="qx-rt-steps" aria-label="可以怎么做">
          <li><i aria-hidden="true">1</i><strong>先重试一次连接</strong><em>刚重启的话，等几秒再试一次</em><span>可以重试</span></li>
          <li><i aria-hidden="true">2</i><strong>改用手机扫码</strong><em>手机扫码不读 U 盘，现在就能用</em><span>现在就能走</span></li>
          <li><i aria-hidden="true">3</i><strong>换一条通道</strong><em>另外两条都在来源页，不读 U 盘</em><span>现在就能走</span></li>
        </ol>
        <p className="qx-rt-hint" data-testid="resume-help-line">{helpLine}</p>
        <div className="qx-rt-channel-acts">
          <button type="button" className="qx-btn" data-variant="ghost" onClick={onLeave}>回到来源选择</button>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={onUsePhone}>改用手机扫码</button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={onRedetect}>重试读 U 盘</button>
        </div>
      </section>
    )
  }

  const drive = status?.driveLabel || '已检测到 U 盘'
  return (
    <section className="resume-usb-panel qx-rt-channel" aria-label="U盘简历文件" data-usb-state={phase === 'usb-importing' ? 'importing' : phase === 'usb-list' ? 'list' : phase === 'usb-empty' ? 'empty' : phase === 'usb-wait' ? 'wait' : 'error'}>
      {phase === 'usb-wait' ? (
        <>
          <Track step="第 1 步：插入 U 盘" />
          <div className="qx-rt-note" role="status">
            <UsbIcon className="h-6 w-6" aria-hidden="true" />
            <b>还没有检测到 U 盘</b>
            <span>插在这台机器上之后，文件列表会自动出现。每 2 秒看一次有没有盘。只看最外层，只列 PDF / JPG / PNG，单份不超过 10MB。</span>
          </div>
          <p className="qx-rt-hint">这台机器直接读 U 盘，不会弹出系统的选文件窗口。只读取你点的那一个文件。</p>
          <div className="qx-rt-channel-acts">
            <button type="button" className="qx-btn" data-variant="primary" disabled={loading} onClick={onRedetect}>我插好了，重新检测</button>
          </div>
        </>
      ) : null}
      {phase === 'usb-detecting' ? (
        <>
          <Track step="第 2 步：读取盘上的文件" />
          <div className="qx-rt-note" role="status">
            <LoaderIcon className="h-6 w-6 animate-spin" aria-hidden="true" />
            <b>正在读取 U 盘</b>
            <span>读盘没有可播报的中间步骤，所以这里不画进度条。读到了就出文件列表，读不到会写明原因。</span>
          </div>
        </>
      ) : null}
      {phase === 'usb-list' && files ? (
        <>
          <Track step={`第 3 步：从盘上选一份${status?.driveLabel ? `（${drive}）` : ''}`} />
          <h2 className="qx-rt-sec-h">U 盘最外层可用的简历文件 <small>{files.length} 份 · 只列 PDF / JPG / PNG 且不超过 10MB</small></h2>
          <div className="resume-usb-panel__list">
            {files.map((item) => (
              <button key={item.safeId} type="button" onClick={() => onImport(item)} className="resume-usb-panel__row">
                <FileTextIcon className="h-5 w-5" aria-hidden="true" />
                <span className="resume-usb-panel__name">{item.filename}</span>
                <span className="resume-usb-panel__size">{formatBytes(item.sizeBytes)}</span>
              </button>
            ))}
          </div>
          <p className="qx-rt-hint">点一份就开始导入。这一步没有先看再确认的中间页，盘上其余文件不会被读取。</p>
          <div className="qx-rt-channel-acts">
            <button type="button" className="qx-btn" data-variant="ghost" disabled={loading} onClick={onRedetect}>重新读一次 U 盘</button>
          </div>
        </>
      ) : null}
      {phase === 'usb-empty' ? (
        <>
          <Track step="第 3 步：盘上没有符合条件的文件" />
          <div className="qx-rt-note" data-tone="warn" role="status">
            <b>没有可用文件</b>
            <span>请确认 U 盘最外层有 PDF、JPG 或 PNG，并且单份不超过 10MB。子文件夹里的文件不会出现在这里。</span>
          </div>
          <div className="qx-rt-channel-acts">
            <button type="button" className="qx-btn" data-variant="ghost" onClick={onUsePhone}>改用手机扫码</button>
            <button type="button" className="qx-btn" data-variant="primary" disabled={loading} onClick={onRedetect}>重新检测 U 盘</button>
          </div>
        </>
      ) : null}
      {phase === 'usb-read-failed' ? (
        <>
          <Track step="第 3 步：读取失败，可以重来" />
          <div className="qx-rt-note" data-tone="error" role="alert">
            <b>U盘读取失败</b>
            <span>{error || '这一次没有拿到可用的文件列表。'}</span>
          </div>
          <p className="qx-rt-hint">没有任何文件被读取或上传。可以拔下来再插一次，也可以改用手机扫码。</p>
          <div className="qx-rt-channel-acts">
            <button type="button" className="qx-btn" data-variant="ghost" onClick={onUsePhone}>改用手机扫码</button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={onRedetect}>重新读一次 U 盘</button>
          </div>
        </>
      ) : null}
      {phase === 'usb-importing' ? (
        <>
          <Track step="第 5 步：导入中，请不要拔盘" />
          <div className="qx-rt-note" role="status">
            <LoaderIcon className="h-6 w-6 animate-spin" aria-hidden="true" />
            <b>正在导入</b>
            <span>{importingName || '这一份'}。没有可确认的百分比，也没有中止入口。离开这一页不会撤回已经发出的导入。</span>
          </div>
          <p className="qx-rt-hint">导入中 · 没有中止入口</p>
        </>
      ) : null}
      {phase === 'usb-import-failed' && importFault ? (
        <>
          <Track step="第 5 步：导入失败，回第 2 步重新读盘" />
          <div className="qx-rt-filecard">
            <span className="fx"><b>{importFault.name}</b><small>来自 U 盘</small></span>
            <span className="fb">导入失败</span>
          </div>
          <div className="qx-rt-note" data-tone="error" role="alert">
            <b>U盘文件导入失败，请重试</b>
            <span>{importFault.message}这一页不能把同一份原地再导一遍，要重新读一次盘再选。</span>
          </div>
          <div className="qx-rt-channel-acts">
            <button type="button" className="qx-btn" data-variant="primary" onClick={onRedetect}>重新读一次 U 盘，再选一份</button>
          </div>
        </>
      ) : null}
    </section>
  )
}

export function ResumeUsbReady({ name, size, onContinue }: { name: string; size: string; onContinue: () => void }): ReactNode {
  return (
    <section className="qx-rt-channel" aria-label="U盘简历文件" data-usb-state="ready">
      <Track step="第 6 步：已导入，可以拔盘" />
      <div className="qx-rt-filecard">
        <span className="fx"><b>{name}</b><small>{size} · 来自 U 盘</small></span>
        <span className="fb">已导入</span>
      </div>
      <p className="qx-rt-hint">系统已读完这一份，可以拔出 U 盘。本页没有安全弹出按钮。确认这次办理之前还没有发起解析。</p>
      <div className="qx-rt-channel-acts">
        <button type="button" className="qx-btn" data-variant="primary" onClick={onContinue}>继续：确认这次办理</button>
      </div>
    </section>
  )
}
