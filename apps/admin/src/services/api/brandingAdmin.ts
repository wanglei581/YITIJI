import {
  formatCount, BRAND_FILING_TEXT_MAX_LENGTH, BRAND_FILING_URL_HOSTS, BRAND_FILING_URL_MAX_LENGTH,
  BRAND_MARK_LENGTH, BRAND_NAME_MAX_LENGTH, BRAND_LOGO_MAX_PIXELS, BRAND_LOGO_RATIO_MIN, BRAND_LOGO_RATIO_MAX, DEFAULT_BRAND_MARK, DEFAULT_BRAND_NAME, DEFAULT_BRANDING_FILING,
  type AdminBranding, type BrandLogoUploadResult, type OrgBrandOverride, type UpdateBrandingInput,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'
import { userMessageOf } from './userErrorMessage'

export function brandingError(error: unknown, fallback: string): string {
  if (error instanceof ApiHttpError && /[\u3400-\u9fff]/u.test(error.message)) return error.message
  return userMessageOf(error, fallback)
}

// eslint-disable-next-line no-control-regex -- 与服务端一致，拒绝不可见控制字符
const unsafeText = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u
export function validateBrand(name: string, mark: string): string | null {
  if (unsafeText.test(name.trim()) || unsafeText.test(mark.trim())) return '品牌名和字标不能含不可见或控制字符'
  if ([...name.trim()].length > BRAND_NAME_MAX_LENGTH) return `品牌名不超过 ${formatCount(BRAND_NAME_MAX_LENGTH)} 个字`
  if (mark.trim() && [...mark.trim()].length !== BRAND_MARK_LENGTH) return `字标须为 ${formatCount(BRAND_MARK_LENGTH)} 个字`
  return null
}

export function validateFiling(value: string, isUrl: boolean): string | null {
  const text = value.trim()
  if (!text) return null
  if (unsafeText.test(text) || (isUrl && /\s/u.test(text))) return '备案内容不能含空白或控制字符'
  if ((isUrl ? text.length : [...text].length) > (isUrl ? BRAND_FILING_URL_MAX_LENGTH : BRAND_FILING_TEXT_MAX_LENGTH)) return '备案内容太长，请检查'
  if (isUrl) {
    try {
      const url = new URL(text)
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
          (BRAND_FILING_URL_HOSTS as readonly string[]).includes(url.hostname)) return null
    } catch { /* invalid URL */ }
    return '备案查询链接须使用官方备案网站的安全链接'
  }
  return null
}

export function logoPreviewUrl(url: string | null): string | null {
  if (!url) return null
  if (url.startsWith('data:')) return url
  return new URL(url, new URL(API_BASE_URL, window.location.origin).origin).href
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers: { ...authHeader(), ...init?.headers } })
  if (res.status === 401) redirectToLogin()
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } }
    throw new ApiHttpError(body.error?.code ?? 'BRANDING_ERROR', body.error?.message ?? '操作失败，请稍后重试', res.status)
  }
  return ((await res.json()) as { data: T }).data
}

let store: AdminBranding = {
  brandName: null, brandMark: null, brandLogoAssetId: null, logoUrl: null,
  filing: { icp: null, icpUrl: null, police: null, policeUrl: null },
  defaults: { brandName: DEFAULT_BRAND_NAME, brandMark: DEFAULT_BRAND_MARK, filing: { ...DEFAULT_BRANDING_FILING } },
}
const previews = new Map<string, string>()
const orgBrands = new Map<string, OrgBrandOverride>()
const emptyOrgBrand = (): OrgBrandOverride => ({ brandName: null, brandMark: null, brandLogoAssetId: null, brandLogoUrl: null })
export const brandingAdmin = {
  async get(): Promise<AdminBranding> {
    return API_MODE === 'http' ? request('/admin/branding') : structuredClone(store)
  },
  async save(input: UpdateBrandingInput): Promise<AdminBranding> {
    if (API_MODE === 'http') return request('/admin/branding', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    store = { ...store, ...input, filing: { ...store.filing, ...input.filing }, logoUrl: input.brandLogoAssetId === undefined ? store.logoUrl : previews.get(input.brandLogoAssetId ?? '') ?? null }
    return structuredClone(store)
  },
  async upload(file: File): Promise<BrandLogoUploadResult> {
    if (API_MODE === 'http') {
      const body = new FormData(); body.append('file', file)
      return request('/admin/branding/logo', { method: 'POST', body })
    }
    const logoUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file)
    })
    const image = new Image(); image.src = logoUrl
    await image.decode()
    if (image.naturalWidth > BRAND_LOGO_MAX_PIXELS || image.naturalHeight > BRAND_LOGO_MAX_PIXELS || image.naturalWidth / image.naturalHeight < BRAND_LOGO_RATIO_MIN || image.naturalWidth / image.naturalHeight > BRAND_LOGO_RATIO_MAX) throw new ApiHttpError('BRAND_LOGO_INVALID', '图片尺寸或比例不符合要求', 400)
    const assetId = `mock-${crypto.randomUUID()}`; previews.set(assetId, logoUrl)
    return { assetId, logoUrl, mimeType: file.type as BrandLogoUploadResult['mimeType'], width: image.naturalWidth, height: image.naturalHeight, sizeBytes: file.size }
  },
  getMockOrg(id: string): OrgBrandOverride { return { ...(orgBrands.get(id) ?? emptyOrgBrand()) } },
  saveMockOrg(id: string, input: Pick<OrgBrandOverride, 'brandName' | 'brandMark' | 'brandLogoAssetId'>): void {
    orgBrands.set(id, { ...input, brandLogoUrl: previews.get(input.brandLogoAssetId ?? '') ?? null })
  },
}
