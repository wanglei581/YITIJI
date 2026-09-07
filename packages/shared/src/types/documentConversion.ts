export type DocumentConversionEngine = 'soffice' | 'gotenberg' | 'none'

export interface DocumentConversionCapabilities {
  wordToPdf: boolean
  engine: DocumentConversionEngine
  reason?: string
  cjkFonts: boolean
}

export interface DocumentConversionRequest {
  target: 'pdf'
}

export interface DocumentConversionResponse {
  fileId: string
  filename: string
  mimeType: 'application/pdf'
  sizeBytes: number
  pageCount: number
  signedUrl: string
  expiresAt: string
  printFileUrl: string
  engine: Exclude<DocumentConversionEngine, 'none'>
  warnings: string[]
}
