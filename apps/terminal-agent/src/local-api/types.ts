import type { MemberUser } from './wire'

export interface LocalQrCreateRequest {
  deviceId?: string
  deviceLabel?: string
  returnTo?: string
}

export interface LocalQrCreateResponse {
  ticketId: string
  qrUrl: string
  expiresInSeconds: number
  returnTo: string
}

export interface LocalQrClaimRequest {
  ticketId?: string
}

export interface LocalQrClaimResponse {
  token: string
  user: MemberUser
}

export interface LocalApiError {
  code: string
  message: string
}
