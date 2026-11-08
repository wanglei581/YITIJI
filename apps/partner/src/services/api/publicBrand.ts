import { useEffect, useState } from 'react'
import { BRAND_NAME_MAX_LENGTH, DEFAULT_BRAND_MARK, DEFAULT_BRAND_NAME, type PublicBrand } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'

const DEFAULT_BRAND: PublicBrand = { brandName: DEFAULT_BRAND_NAME, brandMark: DEFAULT_BRAND_MARK, logoUrl: null }
let cached: Promise<PublicBrand> | undefined

function validBrand(value: unknown): value is PublicBrand {
  if (!value || typeof value !== 'object') return false
  const brand = value as Record<string, unknown>
  return typeof brand.brandName === 'string' && Array.from(brand.brandName).length >= 1
    && Array.from(brand.brandName).length <= BRAND_NAME_MAX_LENGTH
    && typeof brand.brandMark === 'string' && Array.from(brand.brandMark).length === 1
    && (brand.logoUrl === null || (typeof brand.logoUrl === 'string' && brand.logoUrl.startsWith('/api/v1/public/brand-logo/')))
}

export function loadPublicBrand(): Promise<PublicBrand> {
  if (!cached) {
    cached = API_MODE === 'mock' ? Promise.resolve(DEFAULT_BRAND) : fetch(`${API_BASE_URL}/public/brand`)
      .then(async (response) => {
        if (!response.ok) return DEFAULT_BRAND
        const body: unknown = await response.json()
        if (!body || typeof body !== 'object') return DEFAULT_BRAND
        const envelope = body as Record<string, unknown>
        return envelope.success === true && validBrand(envelope.data) ? envelope.data : DEFAULT_BRAND
      }).catch(() => DEFAULT_BRAND)
  }
  return cached
}

export function usePublicBrand(): PublicBrand {
  const [brand, setBrand] = useState<PublicBrand>(DEFAULT_BRAND)
  useEffect(() => {
    let mounted = true
    void loadPublicBrand().then((value) => { if (mounted) setBrand(value) })
    return () => { mounted = false }
  }, [])
  return brand
}

export function logoPreviewUrl(url: string | null): string | null {
  if (!url) return null
  return new URL(url, new URL(API_BASE_URL, window.location.origin).origin).href
}
