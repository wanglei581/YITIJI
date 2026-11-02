// 选文件页「U 盘导入」选文件各态的正文（稿 usb）：根目录列表、选中、导入中、选择失效。
// 「这一份没导进来」「读不了 U 盘」两种出错在 FileSourceError.tsx 的出错板件里，不在这里。
// 只画传进来的状态，不发请求；读盘与导入在 PrintUploadPage / useUsbImportGate。

import { QxTouchCallout } from '../../../components/qingxu/touch/QxTouchCallout'
import type { FileSourceScreen } from './fileSourceModel'
import { FileRow } from './FileSourceBits'

export function UsbPickBoard({
  screen,
  files,
  selected,
  driveLabel,
  formatBytes,
  wordText,
  onSelect,
  onRescan,
}: {
  screen: FileSourceScreen
  files: { safeId: string; filename: string; sizeBytes: number }[] | null
  selected: { safeId: string; filename: string; sizeBytes: number } | null
  driveLabel: string | null
  formatBytes: (bytes: number) => string
  /** 稿 usb 页脚第一句：Word 能不能转。 */
  wordText: string
  onSelect: (safeId: string) => void
  onRescan: () => void
}) {
  const known = screen === 'usb-list' && files !== null
  return (
    <>
      {screen === 'usb-list' ? (
        <div className="fs-usb-head">
          <b>{known ? `U 盘根目录里能用的文件（${files.length} 个）` : '还没读到 U 盘里的文件。'}</b>
          <button type="button" className="fs-touch-btn" data-testid="file-source-refresh" onClick={onRescan}>重新检测</button>
        </div>
      ) : null}
      {known
        ? (
          <div className="fs-usb-list">
            {files.map((item) => {
              const ext = item.filename.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase()
              return (
                <FileRow
                  key={item.safeId}
                  name={item.filename}
                  meta={formatBytes(item.sizeBytes)}
                  tag=""
                  tagTone="pickable"
                  mark={ext || '文件'}
                  on={selected?.safeId === item.safeId}
                  onClick={() => onSelect(item.safeId)}
                  testId={`file-source-usb-file-${item.safeId}`}
                />
              )
            })}
          </div>
        )
        : null}
      {selected && screen !== 'usb-list' ? (
        <FileRow
          name={selected.filename}
          meta={`${formatBytes(selected.sizeBytes)}${driveLabel ? ` · ${driveLabel}` : ''}`}
          tag=""
          tagTone={screen === 'usb-importing' ? 'doing' : 'ok'}
          on={screen === 'usb-selected'}
          bad={screen === 'usb-safeid-expired'}
          dim={screen === 'usb-safeid-expired'}
          testId="file-source-selected-file"
        />
      ) : null}
      {screen === 'usb-importing' ? (
        <QxTouchCallout kind="remind" icon="usb">正在导入选中的文件，请暂时不要拔出 U 盘。系统确认保存之前，当前文件仍然是空的。这期间别拔 U 盘。</QxTouchCallout>
      ) : null}
      {screen === 'usb-selected' ? (
        <QxTouchCallout kind="remind" icon="usb">只导入这一份，U 盘上其它文件不会被读走。导入完成前它还不是当前文件。</QxTouchCallout>
      ) : null}
      {screen === 'usb-list' ? (
        <>
          <QxTouchCallout kind="remind" icon="usb">只读取你主动选择的文件。导入完成后可以直接拔出 U 盘。</QxTouchCallout>
          <QxTouchCallout kind="fine">{wordText} 读不出来可以换一个 USB 口，或者改用手机传。</QxTouchCallout>
        </>
      ) : null}
      {screen === 'usb-safeid-expired' ? (
        <QxTouchCallout kind="remind" icon="alert">当前文件仍然是空的。重新读一次 U 盘后，在新列表里再选一份。</QxTouchCallout>
      ) : null}
    </>
  )
}
