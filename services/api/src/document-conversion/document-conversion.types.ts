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

/**
 * 转换排队已满。与超时不同：超时是「开始了但太慢」，这条是「根本没轮到你」。
 * 分开是为了让调用方与运维看到的原因是真的 —— 混成 CONVERSION_FAILED 会让
 * 「机器过载」被误读成「这份文件有问题」。
 */
export class ConversionBusyError extends Error {
  constructor() {
    super('document conversion queue is full')
    this.name = 'ConversionBusyError'
  }
}

export class ConversionTimeoutError extends Error {
  constructor() {
    super('document conversion timed out')
    this.name = 'ConversionTimeoutError'
  }
}
