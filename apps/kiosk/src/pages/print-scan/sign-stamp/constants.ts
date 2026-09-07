import type { SignStampPosition, SignStampSize } from '@ai-job-print/shared'

/** 授权勾选文案；改动必须同步后端 AUTHORIZATION_NOTICE_VERSION（print-sign.service.ts） */
export const AUTHORIZATION_LABEL =
  '我确认本人拥有该签名/印章图片的使用授权，仅用于本人材料的版式整理'

export const MAX_DOC_BYTES = 15 * 1024 * 1024
export const MAX_STAMP_BYTES = 10 * 1024 * 1024
export const MAX_DOC_PAGES = 30

export const POSITIONS: { key: SignStampPosition; label: string }[] = [
  { key: 'top-left', label: '左上' },
  { key: 'top-center', label: '上' },
  { key: 'top-right', label: '右上' },
  { key: 'middle-left', label: '左' },
  { key: 'center', label: '中' },
  { key: 'middle-right', label: '右' },
  { key: 'bottom-left', label: '左下' },
  { key: 'bottom-center', label: '下' },
  { key: 'bottom-right', label: '右下' },
]

export const SIZES: { key: SignStampSize; label: string }[] = [
  { key: 'small', label: '小' },
  { key: 'medium', label: '中' },
  { key: 'large', label: '大' },
]

export const SIZE_FACTOR: Record<SignStampSize, number> = {
  small: 0.15,
  medium: 0.25,
  large: 0.35,
}
export const MARGIN_RATIO = 0.04
export const PAGE_W = 840
export const PAGE_H = 1188
export const ZOOMS = [1, 1.35, 1.75, 2.25, 2.9] as const

export const FROM_WHITELIST = {
  hub: { path: '/print-scan', label: '返回打印扫描' },
  home: { path: '/', label: '返回首页' },
  docs: { path: '/me/documents', label: '返回我的文档' },
} as const
export type SignStampFrom = keyof typeof FROM_WHITELIST

export const SIGN_STAMP_STATES = [
  'auth-unknown',
  'login-required',
  'login-expired',
  'context-missing',
  'terminal-missing',
  'capability-loading',
  'capability-disabled',
  'capability-maintenance',
  'capability-error',
  'pick-document',
  'document-local-uploading',
  'document-phone-entry',
  'document-inspecting',
  'document-ready',
  'document-format-rejected',
  'document-too-large',
  'document-encrypted',
  'document-corrupt',
  'document-digital-signature',
  'document-too-many-pages',
  'document-source-expired',
  'document-source-forbidden',
  'pick-stamp',
  'stamp-local-uploading',
  'stamp-phone-entry',
  'stamp-ready',
  'stamp-format-rejected',
  'stamp-too-large',
  'stamp-pixels-too-large',
  'stamp-corrupt',
  'stamp-encoding-unsupported',
  'stamp-source-expired',
  'placement-default',
  'placement-page2',
  'placement-last-page',
  'placement-top-left-small',
  'placement-center-medium',
  'placement-bottom-right-large',
  'placement-invalid-page',
  'preview-fit-page',
  'preview-fit-width',
  'preview-zoomed',
  'preview-panned-corner',
  'preview-rotated-source-page',
  'authorization-required',
  'ready-to-compose',
  'composing',
  'rate-limited',
  'conversion-in-progress',
  'known-failed',
  'result-unknown',
  'retrying-same-request',
  'recovered-completed',
  'idempotency-conflict',
  'completed',
  'output-preview-page2',
  'output-preview-last',
  'output-preview-zoomed',
  'output-preview-failed',
  'output-expired',
  'output-too-large',
  'add-another-ready',
  'return-source-unknown',
] as const

export type SignStampStateId = (typeof SIGN_STAMP_STATES)[number]

export const SIGN_STAMP_STATE_SET = new Set<string>(SIGN_STAMP_STATES)

export const FX = {
  doc: { name: '就业协议书-示例.pdf', size: '1.8 MB', pages: 6 },
  stamp: { name: '签名-示例.png', size: '240 KB', w: 900, h: 360 },
  out: { name: '就业协议书-示例-签章合成.pdf', size: '2.1 MB', pages: 6 },
} as const

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function makeIdempotencyKey(): string {
  const rand = Math.random().toString(36).slice(2, 12)
  return `sign-${Date.now()}-${rand}`
}

export function placementFingerprint(
  docId: string,
  stampId: string,
  page: number,
  position: SignStampPosition,
  size: SignStampSize,
): string {
  return `${docId}|${stampId}|${page}|${position}|${size}`
}
