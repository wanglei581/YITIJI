import type { AgentConfig } from '../types'
import { bindScanDevicePrintFinishedProbe, type ScanDeviceRuntime } from '../scan-device/scan-device-runner'
import { createCopyRuntime } from './copy-runtime'
import type { CopyRuntime } from './copy-types'

/** 入口只接线；A2 的打印后探测与复印的生命周期在这里一起收束。 */
export function copyRuntimeForConfig(config: AgentConfig, scan?: ScanDeviceRuntime): CopyRuntime | undefined {
  if (scan) bindScanDevicePrintFinishedProbe(() => { void scan.probe() })
  // 即使后来关掉功能，也要清掉上次进程留下的复印页；运行器和 HTTP 仍拒绝新操作。
  return createCopyRuntime(config)
}
