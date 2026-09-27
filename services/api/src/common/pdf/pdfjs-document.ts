// PDF.js 打开参数。unpdf 1.6.2 自带 PDF.js 5.6.205，这里只取同版本
// pdfjs-dist 的 cmaps/ 与 standard_fonts/，不加载它的 PDF.js 构建，避免两套运行时。
//
// Node 侧用文件系统路径，且目录必须以 "/" 结尾：PDF.js 把 cMapUrl 和文件名直接
// 拼起来交给 fs.readFile。file:// 字符串（中文路径还会被百分号编码）读不到文件。

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const nodeRequire = createRequire(__filename)

export interface PdfjsPresetDataOptions {
  cMapUrl: string
  cMapPacked: true
  standardFontDataUrl: string
}

interface UnpdfOpenApi {
  getDocumentProxy(data: Uint8Array, options?: PdfjsPresetDataOptions): Promise<unknown>
}

let cached: PdfjsPresetDataOptions | null = null

function slashDirectory(dir: string): string {
  const normalized = dir.split(path.sep).join('/')
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

/** 与 unpdf 内置 PDF.js 5.6.205 匹配的预置 CMap 和标准 14 字体目录。 */
export function pdfjsPresetDataOptions(): PdfjsPresetDataOptions {
  if (cached) return cached
  const packageJson = nodeRequire.resolve('pdfjs-dist/package.json')
  const root = path.dirname(packageJson)
  const cmaps = path.join(root, 'cmaps')
  const fonts = path.join(root, 'standard_fonts')
  const cmapProbe = path.join(cmaps, 'UniGB-UCS2-H.bcmap')
  const fontProbe = path.join(fonts, 'FoxitSerif.pfb')
  if (!existsSync(cmapProbe) || !existsSync(fontProbe)) {
    throw new Error(`PDF.js 5.6.205 preset data missing (cmap=${cmapProbe}, font=${fontProbe})`)
  }
  cached = {
    cMapUrl: slashDirectory(cmaps),
    cMapPacked: true,
    standardFontDataUrl: slashDirectory(fonts),
  }
  return cached
}

/** 用预置 CMap 打开 PDF，供 extractText / getTextContent 使用。 */
export function openUnpdfDocument<T = unknown>(data: Uint8Array): Promise<T> {
  const unpdf = nodeRequire('unpdf') as UnpdfOpenApi
  return unpdf.getDocumentProxy(data, pdfjsPresetDataOptions()) as Promise<T>
}
