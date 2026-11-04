import { BadRequestException } from '@nestjs/common'
import {
  BRAND_FILING_TEXT_MAX_LENGTH,
  BRAND_FILING_URL_HOSTS,
  BRAND_FILING_URL_MAX_LENGTH,
  BRAND_MARK_LENGTH,
  BRAND_NAME_MAX_LENGTH,
} from './branding.types'

/**
 * 品牌文字与备案链接的校验。统一口径：
 *   - 返回 null = 清除（回到默认）；返回字符串 = 校验通过后要存的值；校验不过抛 400。
 *   - 省略（undefined）由调用方处理成「不改」，不进这里。
 */

function invalid(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}

/** 控制字符、零宽字符、双向控制字符：用来伪装品牌名或把页面标题改得不可读，一律不收。 */
// eslint-disable-next-line no-control-regex -- 本来就是要匹配控制字符
const UNSAFE_TEXT = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u

/** 按 Unicode 码点数字数，一个 emoji 算 1 个。 */
export function charCount(text: string): number {
  return Array.from(text).length
}

function cleanText(value: unknown, code: string, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw invalid(code, `${label}需为文字`)
  const text = value.trim()
  if (text === '') return null
  if (UNSAFE_TEXT.test(text)) throw invalid(code, `${label}含有不可见或控制字符`)
  return text
}

/** 品牌名：1–12 个字。 */
export function normalizeBrandName(value: unknown): string | null {
  const text = cleanText(value, 'BRAND_NAME_INVALID', '品牌名')
  if (text === null) return null
  if (charCount(text) > BRAND_NAME_MAX_LENGTH) {
    throw invalid('BRAND_NAME_INVALID', `品牌名需为 1–${BRAND_NAME_MAX_LENGTH} 个字`)
  }
  return text
}

/** 字标：恰好 1 个字（不是空白）。 */
export function normalizeBrandMark(value: unknown): string | null {
  const text = cleanText(value, 'BRAND_MARK_INVALID', '字标')
  if (text === null) return null
  if (charCount(text) !== BRAND_MARK_LENGTH) {
    throw invalid('BRAND_MARK_INVALID', `字标需恰好 ${BRAND_MARK_LENGTH} 个字`)
  }
  return text
}

/** 备案号：去首尾空白后非空，不超过 64 个字；纯空白 = 清除（回默认）。 */
export function normalizeFilingText(value: unknown, label: string): string | null {
  const text = cleanText(value, 'BRAND_FILING_INVALID', label)
  if (text === null) return null
  if (charCount(text) > BRAND_FILING_TEXT_MAX_LENGTH) {
    throw invalid('BRAND_FILING_INVALID', `${label}不超过 ${BRAND_FILING_TEXT_MAX_LENGTH} 个字`)
  }
  return text
}

const FILING_URL_HOSTS: ReadonlySet<string> = new Set(BRAND_FILING_URL_HOSTS)

/**
 * 备案查询链接：只许 https，主机精确等于官方备案域名之一；
 * 不许带账号口令（https://官方域名@恶意域名/ 这类）、不许带端口。
 * 存的是 URL 解析后的规范写法，保证「校验的就是存的」。
 */
export function normalizeFilingUrl(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw invalid('BRAND_FILING_URL_INVALID', `${label}需为链接`)
  const text = value.trim()
  if (text === '') return null
  if (text.length > BRAND_FILING_URL_MAX_LENGTH) {
    throw invalid('BRAND_FILING_URL_INVALID', `${label}不超过 ${BRAND_FILING_URL_MAX_LENGTH} 个字符`)
  }
  if (UNSAFE_TEXT.test(text) || /\s/u.test(text)) {
    throw invalid('BRAND_FILING_URL_INVALID', `${label}含有空白或控制字符`)
  }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw invalid('BRAND_FILING_URL_INVALID', `${label}不是有效链接`)
  }
  if (url.protocol !== 'https:') {
    throw invalid('BRAND_FILING_URL_INVALID', `${label}只允许 https 链接`)
  }
  if (url.username !== '' || url.password !== '' || url.port !== '') {
    throw invalid('BRAND_FILING_URL_INVALID', `${label}不能带账号口令或端口`)
  }
  if (!FILING_URL_HOSTS.has(url.hostname)) {
    throw invalid(
      'BRAND_FILING_URL_INVALID',
      `${label}只允许官方备案网站（${BRAND_FILING_URL_HOSTS.join('、')}）`,
    )
  }
  return url.href
}

/** Logo 编号的形状。 */
export function normalizeLogoAssetId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw invalid('BRAND_LOGO_NOT_FOUND', 'Logo 编号需为文字')
  const text = value.trim()
  return text === '' ? null : text
}
