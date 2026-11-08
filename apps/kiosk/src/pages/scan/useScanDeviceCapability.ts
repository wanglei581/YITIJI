// 屏上扫描能力。读法与彩色 / 双面相同：没取到就按未验证，不能先当成能用。
// scan_device 在默认拒绝名单里，拉取成功但没有配置行 = 未开通。

import { useEffect, useState } from 'react'
import {
  loadConfiguredCapabilities,
  resolveCapabilityOverride,
} from '../../services/api/printScanCapabilities'

export interface ScanDeviceCapability {
  loading: boolean
  /** 拉取失败或被跳过。不许说成「已经确认没开通」。 */
  unknown: boolean
  allowed: boolean
}

const INITIAL: ScanDeviceCapability = { loading: true, unknown: false, allowed: false }

export function useScanDeviceCapability(): ScanDeviceCapability {
  const [state, setState] = useState<ScanDeviceCapability>(INITIAL)

  useEffect(() => {
    let cancelled = false
    void loadConfiguredCapabilities().then((result) => {
      if (cancelled) return
      if (result.status !== 'ok') {
        setState({ loading: false, unknown: true, allowed: false })
        return
      }
      const row = resolveCapabilityOverride(result, 'scan_device')
      setState({
        loading: false,
        unknown: false,
        allowed: row?.status === 'available',
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
