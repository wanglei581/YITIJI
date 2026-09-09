import type { DomShot } from './collect'

export type RouteRow = DomShot & {
  pattern: string
  requestUrl: string
  requestPathname: string
  screenshot: string
  captureError: string | null
}
