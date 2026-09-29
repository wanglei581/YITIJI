// PDF.js 打开参数。服务端解析仍用 unpdf 1.6.2 自带的 PDF.js 5.6.205；这里只取
// pdfjs-dist 的 cmaps/ 与 standard_fonts/，不加载它的 PDF.js 构建，避免两套运行时。
// pdfjs-dist 钉在 6.3.289（一体机预览要 ≥ 6.2.108，GHSA-hq66-cqwq-w95j）；这两个目录与
// 5.6.205 逐字节相同（只差一份许可证文本），所以换版本不改变服务端读到的任何数据。
// 该漏洞在 PDF.js 的脚本引擎，服务端只做 getDocument / 抽文字 / 渲染，不装载脚本沙箱；
// unpdf 出了带 ≥ 6.2.108 的版本后再把引擎一并升上去（next-tasks 有记录）。
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

/** 预置 CMap 和标准 14 字体目录（数据格式与 unpdf 内置的 PDF.js 5.6.205 一致）。 */
export function pdfjsPresetDataOptions(): PdfjsPresetDataOptions {
  if (cached) return cached
  const packageJson = nodeRequire.resolve('pdfjs-dist/package.json')
  const root = path.dirname(packageJson)
  const cmaps = path.join(root, 'cmaps')
  const fonts = path.join(root, 'standard_fonts')
  const cmapProbe = path.join(cmaps, 'UniGB-UCS2-H.bcmap')
  const fontProbe = path.join(fonts, 'FoxitSerif.pfb')
  if (!existsSync(cmapProbe) || !existsSync(fontProbe)) {
    throw new Error(`PDF.js preset data missing (cmap=${cmapProbe}, font=${fontProbe})`)
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
