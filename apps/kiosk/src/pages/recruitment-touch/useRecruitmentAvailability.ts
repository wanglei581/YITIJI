import { useApiReadiness } from '../../hooks/useApiReadiness'
import { useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'
import { unavailableReason, type CapabilityKind, type HubAvailability } from '../service-hubs/serviceHubModel'

/** 与服务台同一套 fail-closed：检查中和不可用都不放行。没有设备入口时不探测打印机。 */
export function useRecruitmentAvailability(deviceAware: boolean): {
  availability: HubAvailability
  apiStatus: 'checking' | 'ready' | 'unavailable'
  retryApi: () => void
} {
  const { status: apiStatus, retry: retryApi } = useApiReadiness()
  const device = useTerminalDeviceStatus(deviceAware)
  const availability: HubAvailability = {
    apiDown: apiStatus === 'unavailable',
    apiChecking: apiStatus === 'checking',
    deviceOff: deviceAware && (device.kind === 'offline' || device.kind === 'error'),
    deviceChecking: deviceAware && device.loading,
  }
  return { availability, apiStatus, retryApi }
}

export function doorReason(
  kind: CapabilityKind,
  route: string,
  availability: HubAvailability,
): string | null {
  return unavailableReason(kind, route, availability)
}
