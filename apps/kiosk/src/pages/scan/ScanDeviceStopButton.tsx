interface ScanDeviceStopButtonProps {
  label: string
  short?: boolean
  armed: boolean
  busy: boolean
  disabled?: boolean
  onPress: () => void
}

function StopMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

/** 停止要按两次。第一下只改文案，六秒不按就自己收回。 */
export function ScanDeviceStopButton({
  label,
  short = false,
  armed,
  busy,
  disabled = false,
  onPress,
}: ScanDeviceStopButtonProps) {
  const text = busy ? '正在停止' : armed ? (short ? '再点确认停止' : '再点一次确认停止') : label
  return (
    <button
      type="button"
      className={`qxt-btn cs-stop${armed ? ' armed' : ''}`}
      data-testid="scan-device-stop"
      disabled={disabled || busy}
      onClick={onPress}
    >
      <StopMark />
      {text}
    </button>
  )
}

export function ScanDeviceArmNote({ armed }: { armed: boolean }) {
  if (!armed) return null
  return (
    <p className="cs-warn" role="status" data-testid="scan-device-arm-note">
      再按一次才会停止，已扫的页会从这台机器删除。
    </p>
  )
}
