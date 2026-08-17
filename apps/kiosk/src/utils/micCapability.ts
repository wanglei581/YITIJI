// ============================================================
// 麦克风能力探测 —— 测「设备在不在」，不是测「API 在不在」。
//
// 修复前：`!!navigator.mediaDevices?.getUserMedia` 只说明浏览器实现了这个
// 方法，在一台没插麦克风的机器上恒为 true。界面因此默认进语音模式并显示
// 「语音回答可用」，用户点录音才抛 NotFoundError，又被统一文案说成
// 「请检查浏览器权限」—— 把「没有设备」误报成「权限问题」，用户会去翻
// 浏览器设置，而那里什么都查不出来。
//
// 真机实测依据（Chrome 141 / macOS，http://localhost 安全上下文）：
//   · 有真实麦克风 + 未授权 → enumerateDevices() 仍返回 kind:'audioinput'
//     的条目，只是 label / deviceId 被置空。所以「有没有音频输入设备」
//     不需要先申请权限就能判断。
//   · navigator.permissions.query({name:'microphone'}) 返回
//     'granted' | 'denied' | 'prompt'，用来把「有设备但被拒权限」单独分出来。
//   · 权限被拒时 getUserMedia 抛 NotAllowedError（不是 NotFoundError）。
//   · 非安全上下文下 navigator.mediaDevices 整个是 undefined。
//
// 探测是运行时的，不是构建期的：用户可能后插一个 USB 麦克风，
// 所以对外还提供 devicechange 订阅与手动重探。
// ============================================================

/** 语音入口的能力门禁状态。四态互斥，禁止合并。 */
export type MicCapabilityState =
  /** 存在音频输入设备且权限未被拒绝 —— 可以进语音模式。 */
  | 'available'
  /** 枚举成功，但一个音频输入设备都没有 —— 本机没有麦克风。 */
  | 'no-device'
  /** 有设备，但浏览器已拒绝本站麦克风权限。 */
  | 'permission-denied'
  /** 非安全上下文或老浏览器：根本没有 mediaDevices 采集能力。 */
  | 'unsupported'

/** 录音真正失败时的归因（比能力探测多两种运行期故障）。 */
export type MicFailureState = MicCapabilityState | 'busy' | 'timeout' | 'unknown'

/** 状态胶囊文案（顶部 StatusPill）。只有 available 才允许说「可用」。 */
export const MIC_STATUS_LABEL: Record<MicCapabilityState, string> = {
  available: '语音回答可用',
  'no-device': '本机没有麦克风',
  'permission-denied': '麦克风权限未开启',
  unsupported: '浏览器不支持麦克风',
}

/**
 * 常显原因 + 可执行的下一步。
 * 一体机没有 hover，原因不能塞进 title，必须常驻在页面上（见 CLAUDE.md §9）。
 */
export const MIC_REASON: Record<MicCapabilityState, string | null> = {
  available: null,
  'no-device':
    '本机没有麦克风，请用文字作答。如果刚插入 USB 麦克风，点「重新检测麦克风」即可启用语音。',
  'permission-denied':
    '麦克风权限未开启：浏览器已拒绝本站使用麦克风。请在地址栏的权限图标里允许麦克风后点「重新检测麦克风」，或直接用文字作答。',
  unsupported:
    '当前浏览器环境不支持麦克风采集（需要 HTTPS 或 localhost），请用文字作答。',
}

/** 录音失败时的归因文案。与上面的能力文案分开，避免把无设备说成权限问题。 */
export const MIC_FAILURE_REASON: Record<MicFailureState, string> = {
  available: '麦克风调用失败，可重新录音或改用文字输入',
  'no-device': '本机没有麦克风，请用文字作答',
  'permission-denied':
    '麦克风权限未开启：请在地址栏的权限图标里允许麦克风后重试，或改用文字输入',
  unsupported: '当前浏览器环境不支持麦克风采集，请用文字作答',
  busy: '麦克风被其他程序占用，请关闭占用程序后重试，或改用文字输入',
  timeout: '麦克风权限请求超时，请重试或改用文字输入',
  unknown: '麦克风调用失败，可重新录音或改用文字输入',
}

function getMediaDevices(): MediaDevices | null {
  if (typeof navigator === 'undefined') return null
  const md = navigator.mediaDevices
  // getUserMedia 与 enumerateDevices 缺一不可：前者采集，后者判断设备存在。
  if (!md || typeof md.getUserMedia !== 'function' || typeof md.enumerateDevices !== 'function') {
    return null
  }
  return md
}

/** 查询麦克风权限。Firefox 等不支持该 name 时返回 null（当作「未被拒绝」）。 */
async function queryMicPermission(): Promise<PermissionState | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return status.state
  } catch {
    // 不支持 'microphone' 这个 name 会抛 TypeError —— 不代表权限有问题。
    return null
  }
}

/**
 * 运行时探测麦克风能力。不申请权限、不打开音轨，因此不会弹权限框。
 */
export async function detectMicCapability(): Promise<MicCapabilityState> {
  const md = getMediaDevices()
  if (!md) return 'unsupported'

  let hasAudioInput: boolean
  try {
    const devices = await md.enumerateDevices()
    hasAudioInput = devices.some((d) => d.kind === 'audioinput')
  } catch {
    // 枚举失败 → 无法证明「没有设备」。不谎报没有麦克风，放行让用户尝试，
    // 真失败时由 classifyMicError 给出准确归因。
    return 'available'
  }

  if (!hasAudioInput) return 'no-device'
  return (await queryMicPermission()) === 'denied' ? 'permission-denied' : 'available'
}

/**
 * 把 getUserMedia / 录音器抛出的异常归因到具体故障，供文案分流。
 * 关键点：NotFoundError 是「没有设备」，NotAllowedError 才是「权限问题」。
 */
export function classifyMicError(error: unknown): MicFailureState {
  const name = typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name: unknown }).name)
    : ''
  const message = error instanceof Error ? error.message : String(error ?? '')

  if (message.includes('MIC_PERMISSION_TIMEOUT')) return 'timeout'
  // 设备不存在 / 约束匹配不到任何设备
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'no-device'
  }
  // 用户或策略拒绝；SecurityError 出现在非安全上下文
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'permission-denied'
  }
  // 设备存在但被别的程序独占 / 硬件读取失败
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'busy'
  }
  return 'unknown'
}

/**
 * 订阅设备热插拔。用户后插 USB 麦克风时重新探测，语音入口自动恢复。
 * 返回退订函数；环境不支持时返回 noop。
 */
export function subscribeMicDeviceChange(onChange: () => void): () => void {
  const md = getMediaDevices()
  if (!md || typeof md.addEventListener !== 'function') return () => undefined
  md.addEventListener('devicechange', onChange)
  return () => md.removeEventListener('devicechange', onChange)
}
