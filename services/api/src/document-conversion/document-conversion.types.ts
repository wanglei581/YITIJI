import type { FileRequester } from '../files/files.service'

export const WORD_MIME_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const

export type DocumentConversionEngine = 'soffice' | 'gotenberg' | 'none'

export interface DocumentConversionCapabilities {
  wordToPdf: boolean
  engine: DocumentConversionEngine
  reason?: string
  cjkFonts: boolean
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

export interface StoredConversionResult extends DocumentConversionResponse {
  sha256: string
}

export interface ConversionEngineAdapter {
  readonly engine: Exclude<DocumentConversionEngine, 'none'>
  probe(): Promise<{ available: boolean; reason?: string }>
  convert(inputPath: string, outputDir: string, signal: AbortSignal): Promise<string>
}

export type ConversionRequester = FileRequester

export const DOCUMENT_CONVERSION_ADAPTER = Symbol('DOCUMENT_CONVERSION_ADAPTER')
export const DOCUMENT_CONVERSION_FONT_PROBE = Symbol('DOCUMENT_CONVERSION_FONT_PROBE')

export class ConversionTimeoutError extends Error {
  constructor() {
    super('document conversion timed out')
    this.name = 'ConversionTimeoutError'
  }
}

