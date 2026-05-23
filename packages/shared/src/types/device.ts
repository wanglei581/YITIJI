export type DeviceStatus = 'online' | 'offline' | 'error' | 'maintenance' | 'idle' | 'busy'

export interface Device {
  id: string
  name: string
  type: 'printer' | 'scanner' | 'kiosk'
  status: DeviceStatus
  location?: string
  lastHeartbeatAt?: string
}

export interface PrinterStatus {
  isOnline: boolean
  hasPaper: boolean
  tonerLevels: {
    black: number
    cyan: number
    magenta: number
    yellow: number
  }
  errorCode?: string
}
