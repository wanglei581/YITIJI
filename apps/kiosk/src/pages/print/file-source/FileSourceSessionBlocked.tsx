import { QxAppNavbar } from '../../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../../components/qingxu/QxPageFrame'
import { FileSourceStatus } from './FileSourceBits'

/** 本机会话 failed 时占住原来源选择的主区域。不出来源、不出码、不接文件。 */
export function FileSourceSessionBlocked({
  pageTitle,
  pageSubtitle,
  terminalLabel,
  status,
  onBack,
  onHome,
  onAdvisor,
  onProfile,
}: {
  pageTitle: string
  pageSubtitle: string
  terminalLabel: string
  status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  onBack: () => void
  onHome: () => void
  onAdvisor: () => void
  onProfile: () => void
}) {
  return (
    <QxPageFrame
      title={pageTitle}
      subtitle={pageSubtitle}
      terminalLabel={terminalLabel}
      status={status}
      back={{ label: '返回打印扫描', onBack }}
      navbar={<QxAppNavbar onHome={onHome} onAdvisor={onAdvisor} onProfile={onProfile} />}
    >
      <div
        className="qx-scroll fs-page"
        data-w2-page="print-upload"
        data-qx-screen="file-source"
        data-state="session-failed"
        data-testid="file-source-state-session-failed"
      >
        <section className="fs-sec qx-grow fs-session-block">
          <div className="qx-card fs-file-work">
            <FileSourceStatus kind="warn" title="这台机器现在下不了打印单">
              机器会自己再试，恢复后这里会自动变回可用。你可以等一会儿，或稍后再来。
            </FileSourceStatus>
            <button type="button" className="qx-btn" data-variant="primary" onClick={onHome}>
              返回首页
            </button>
          </div>
        </section>
      </div>
    </QxPageFrame>
  )
}
