import type { ReactNode } from 'react'
import type { UsbImportGate } from '../../../hooks/useUsbImportGate'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../../upload/components/UploadSessionQrPanel'
import { ResumeLocalScreen, type LocalChannelPhase } from './ResumeLocalScreen'
import { ResumeUsbImportPanel, type ResumeUsbImportedFile } from './ResumeUsbImportPanel'
import { ResumeUsbReady, ResumeUsbScreen } from './ResumeUsbScreen'
import type { UsbChannelPhase } from './resumeChannelCopy'
import type { UploadedResumeFile } from './resumeSourceModel'

/** 三条通道的整屏。选中才挂上，离开就卸掉，手机扫码仍用冻结面板。 */
export function ResumeSourceChannels(props: {
  screen: string
  channelScreen: null | 'usb' | 'phone' | 'local'
  heldFile: UploadedResumeFile | null
  localPhase: LocalChannelPhase
  uploading: boolean
  pendingName: string | null
  error: string | null
  wordOpen: boolean
  usbGate: UsbImportGate
  helpLine: string
  onPhoneUploaded: (file: PhoneUploadedFile) => void
  onPhoneBusy: (busy: boolean) => void
  onUsbUploaded: (file: ResumeUsbImportedFile) => void
  onUsbBusy: (busy: boolean) => void
  onUsbPhase: (phase: UsbChannelPhase) => void
  onOpenPicker: () => void
  onUsePhone: () => void
  onContinue: () => void
  onLeave: () => void
}): ReactNode {
  const { screen, channelScreen } = props
  if (screen !== 'source' || !channelScreen) return null
  if (channelScreen === 'phone') {
    return (
      <div className="resume-source-phone-session qx-rt-phone">
        <UploadSessionQrPanel onUploaded={props.onPhoneUploaded} onBusyChange={props.onPhoneBusy} busyWhen="received" />
      </div>
    )
  }
  if (channelScreen === 'local') {
    return (
      <ResumeLocalScreen
        phase={props.localPhase}
        uploading={props.uploading}
        pendingName={props.pendingName}
        error={props.error}
        readyName={props.heldFile?.name ?? null}
        readySize={props.heldFile?.size ?? null}
        wordOpen={props.wordOpen}
        onOpenPicker={props.onOpenPicker}
        onUsePhone={props.onUsePhone}
        onContinue={props.onContinue}
      />
    )
  }
  if (props.heldFile) return <ResumeUsbReady name={props.heldFile.name} size={props.heldFile.size} onContinue={props.onContinue} />
  return (
    <div className="qx-rt-usb">
      <ResumeUsbImportPanel
        layout="screen"
        gate={props.usbGate}
        onUploaded={props.onUsbUploaded}
        onBusyChange={props.onUsbBusy}
        onPhase={props.onUsbPhase}
        renderScreen={(model) => (
          <ResumeUsbScreen {...model} helpLine={props.helpLine} onLeave={props.onLeave} onUsePhone={props.onUsePhone} />
        )}
      />
    </div>
  )
}
