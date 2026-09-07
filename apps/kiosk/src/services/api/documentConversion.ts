import { useEffect, useState } from 'react'
import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'
import { notifySessionIfInvalid } from './throwHttpError'

export type DocumentConversionEngine = 'soffice' | 'gotenberg' | 'none'

export interface DocumentConversionCapabilities {
  wordToPdf: boolean
  engine: DocumentConversionEngine
  reason?: string
  cjkFonts: boolean
}

export interface DocumentConversionResult {
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

interface ResponseEnvelope<T> {
  data?: T
  error?: { code?: string; message?: string }
}

export const WORD_CONVERSION_UNAVAILABLE_COPY = 'Word 转换暂未开放，请另存为 PDF 上传'
export const WORD_CONVERSION_DISCLOSURE = '由转换引擎生成，复杂版式可能有偏差，请预览核对'
export const WORD_EXTENSIONS = ['doc', 'docx'] as const
export const WORD_MIME_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const

const CLOSED_CAPABILITIES: DocumentConversionCapabilities = {
  wordToPdf: false,
  engine: 'none',
  cjkFonts: false,
  reason: '正在确认 Word 转换能力',
}
const CAPABILITIES_TTL_MS = 60_000

let cachedCapabilities: { value: DocumentConversionCapabilities; expiresAt: number } | null = null
let capabilitiesRequest: Promise<DocumentConversionCapabilities> | null = null

function currentCachedCapabilities(): DocumentConversionCapabilities | null {
  return cachedCapabilities && cachedCapabilities.expiresAt > Date.now() ? cachedCapabilities.value : null
}

function headersWithToken(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function readPayload<T>(res: Response): Promise<ResponseEnvelope<T> | null> {
  try {
    return (await res.json()) as ResponseEnvelope<T>
  } catch {
    return null
  }
}

function errorFrom(res: Response, payload: ResponseEnvelope<unknown> | null, fallback: string): ApiHttpError {
  return new ApiHttpError(
    payload?.error?.code ?? 'UNKNOWN_ERROR',
    payload?.error?.message ?? fallback,
    res.status,
  )
}

export function isWordDocument(input: { fileName?: string | null; mimeType?: string | null; format?: string | null }): boolean {
  const mimeType = input.mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  const format = input.format?.trim().replace(/^\./, '').toLowerCase() ?? ''
  const extension = input.fileName?.trim().toLowerCase().match(/\.([^.]+)$/)?.[1] ?? ''
  return WORD_MIME_TYPES.includes(mimeType as (typeof WORD_MIME_TYPES)[number])
    || WORD_EXTENSIONS.includes(format as (typeof WORD_EXTENSIONS)[number])
    || WORD_EXTENSIONS.includes(extension as (typeof WORD_EXTENSIONS)[number])
}

export async function getDocumentConversionCapabilities(options: { force?: boolean } = {}): Promise<DocumentConversionCapabilities> {
  const now = Date.now()
  if (!options.force && cachedCapabilities && cachedCapabilities.expiresAt > now) return cachedCapabilities.value
  if (!options.force && capabilitiesRequest) return capabilitiesRequest

  capabilitiesRequest = (async () => {
    let res: Response
    try {
      res = await fetch(`${API_BASE_URL}/document-conversion/capabilities`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
      })
    } catch {
      throw new ApiHttpError('NETWORK_ERROR', '无法确认 Word 转换能力，请检查网络后重试', 0)
    }

    const payload = await readPayload<DocumentConversionCapabilities>(res)
    if (!res.ok) throw errorFrom(res, payload, `能力查询失败（${res.status}）`)
    if (!payload?.data || typeof payload.data.wordToPdf !== 'boolean') {
      throw new ApiHttpError('INVALID_CAPABILITIES', 'Word 转换能力返回数据无效', res.status)
    }

    cachedCapabilities = { value: payload.data, expiresAt: Date.now() + CAPABILITIES_TTL_MS }
    return payload.data
  })()

  try {
    return await capabilitiesRequest
  } finally {
    capabilitiesRequest = null
  }
}

export function useDocumentConversionCapabilities(): {
  capabilities: DocumentConversionCapabilities
  loading: boolean
} {
  const [capabilities, setCapabilities] = useState<DocumentConversionCapabilities>(
    currentCachedCapabilities() ?? CLOSED_CAPABILITIES,
  )
  const [loading, setLoading] = useState(!currentCachedCapabilities())

  useEffect(() => {
    let active = true
    void getDocumentConversionCapabilities()
      .then((next) => {
        if (active) setCapabilities(next)
      })
      .catch((error: unknown) => {
        if (!active) return
        setCapabilities({
          ...CLOSED_CAPABILITIES,
          reason: error instanceof Error ? error.message : '无法确认 Word 转换能力',
        })
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  return { capabilities, loading }
}

export async function convertDocumentToPdf(fileId: string, token?: string | null): Promise<DocumentConversionResult> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/files/${encodeURIComponent(fileId)}/convert`, {
      method: 'POST',
      headers: { ...headersWithToken(token), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ target: 'pdf' }),
    })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', 'Word 转 PDF 请求未送达服务器，请检查网络后重试', 0)
  }

  const payload = await readPayload<DocumentConversionResult>(res)
  if (!res.ok) {
    const error = errorFrom(res, payload, `Word 转 PDF 失败（${res.status}）`)
    notifySessionIfInvalid(res.status, error.code, token)
    throw error
  }
  if (!payload?.data?.signedUrl) {
    throw new ApiHttpError('CONVERSION_FAILED', 'Word 转 PDF 未返回可预览文件', res.status)
  }
  return payload.data
}
