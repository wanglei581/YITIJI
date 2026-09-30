// 服务端打开 PDF 的唯一入口：文字层抽取、逐页渲染、只读页数，都从这里拿文档；
// 服务端用哪一份 PDF.js 引擎，也只在这里决定。
//
// 引擎：pdfjs-dist 6.3.289 的 legacy 构建（PDFJS_ENGINE_SPECIFIER）。unpdf 1.6.2 自带打包的
// PDF.js 5.6.205 落在 CVE-2026-16633 / GHSA-hq66-cqwq-w95j 受影响范围（≥5.6.83 <6.2.108），
// 而且依赖审计看不见它（它打包在 unpdf 包内，不是独立的 pdfjs-dist 条目）。这里用 unpdf 的
// definePDFJSModule 把 unpdf 的引擎换成 6.3.289，unpdf 的 extractText 等内部路径与本文件的
// 直接打开共用同一份引擎；进程里不再求值 unpdf 自带的那份。必须用 legacy 构建：标准构建用到
// Map#getOrInsertComputed 等 Node 22 没有的新 API，legacy 构建自带补丁。
//
// 顺序是硬约束：unpdf 任何函数在 definePDFJSModule 完成前被调用，都会先把自带的 5.6.205
// 装进来；两份 PDF.js 都往 globalThis.pdfjsWorker 写各自的 worker，后装的会让先装的那份在
// 下一次打开时报 "API version does not match the Worker version"。所以本仓一律经
// ensurePdfjsEngine()（进程内只执行一次）之后才碰 unpdf；src 里除本文件外不许直接引用
// unpdf 的引擎接口或 pdfjs-dist（门禁 verify:pdfjs-engine 静态核对）。
//
// 加载方式：services/api 是 CommonJS（tsc 与 @swc-node/register 都是），这里用 require 加载
// .mjs —— Node ≥ 22.12 起 require(esm) 默认可用（根 package.json engines 为 >=22.13 <23），
// legacy pdf.mjs 没有顶层 await，满足 require(esm) 的条件。worker：PDF.js 在 Node 下强制
// 关闭 Web Worker、改用主线程「假 worker」（PDFWorker 的 isNodeJS 分支），不起 worker 线程，
// 与此前 unpdf 自带引擎的做法相同。
//
// 安全选项 PDFJS_HARDENED_OPTIONS 在引擎外壳的 getDocument 里展开在参数最后，调用方和 unpdf
// 内部传什么都覆盖不掉。每次真正交给 PDF.js getDocument 的参数（不含文件字节）发到
// diagnostics_channel PDFJS_GET_DOCUMENT_CHANNEL；没有订阅者时不做任何事。
//
// 数据目录：CMap / 标准 14 字体 / wasm 解码器都取自同一个 pdfjs-dist。wasm 目录不能省：
// 6.x 把 JBIG2、CCITT 传真压缩（黑白扫描件最常见的两种编码）和 JPEG2000 的解码都改成了
// wasm（jbig2.wasm / openjpeg.wasm），不给 wasmUrl 这类扫描件会渲染成空白、OCR 读不到字。
// Node 侧用文件系统路径，且目录必须以 "/" 结尾：PDF.js 把目录和文件名直接拼起来交给
// fs.readFile。file:// 字符串（中文路径还会被百分号编码）读不到文件。
//
// 释放：PDF.js 6 删掉了 PDFDocumentProxy#destroy（改由 loadingTask.destroy() 释放）；本仓调用方
// 统一以 doc.destroy() 释放（合同审查还把它当作文档有效的判据），由本入口给打开的文档补回同名方法。

import { channel } from 'node:diagnostics_channel'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const nodeRequire = createRequire(__filename)

/** 服务端唯一的 PDF.js 引擎入口模块。 */
export const PDFJS_ENGINE_SPECIFIER = 'pdfjs-dist/legacy/build/pdf.mjs'
/** GHSA-hq66-cqwq-w95j 的修复版本；低于它的引擎拒绝启用（fail-closed）。 */
export const PDFJS_MIN_SAFE_VERSION = '6.2.108'

export interface PdfjsPresetDataOptions {
  cMapUrl: string
  cMapPacked: true
  standardFontDataUrl: string
  wasmUrl: string
}

/**
 * 服务端每次打开 PDF 都强制带上的选项（在引擎外壳里展开在最后，谁也覆盖不掉）。
 *
 * - enableScripting:false —— PDF.js 的脚本引擎开关（GHSA-hq66-cqwq-w95j 的前提条件是它为 true）。
 *   注意 getDocument 本身并不读这个参数：读它的只有浏览器端的注释层与脚本沙箱，服务端从不加载
 *   这两样。这里写死 false 是把「服务端不跑 PDF 里的脚本」写成一条可被门禁核对的约束。
 * - isEvalSupported:false —— 5.x 用它关掉 PostScript（Type 4）函数的 new Function 编译；
 *   6.3.289 已删除这个选项（PostScript 函数改为解释执行 / 编译成 wasm，不再 new Function），
 *   传入无副作用，保留是为了引擎一旦回退到 6 以下仍然生效。
 * - enableXfa:false —— 不解析 XFA 表单；与 PDF.js 默认值相同，钉死是为了不让将来的调用方
 *   在不可信文件上把它打开。
 */
export const PDFJS_HARDENED_OPTIONS = Object.freeze({
  enableScripting: false,
  isEvalSupported: false,
  enableXfa: false,
} as const)

/** diagnostics_channel 名称：每次 getDocument 前发布一次实际参数（不含文件字节）。 */
export const PDFJS_GET_DOCUMENT_CHANNEL = 'ai-job-print:pdfjs.getDocument'

export interface PdfjsGetDocumentEvent {
  engineVersion: string
  enableScripting: unknown
  isEvalSupported: unknown
  enableXfa: unknown
  cMapUrl: unknown
  standardFontDataUrl: unknown
  wasmUrl: unknown
}

interface PdfjsLoadingTask {
  promise: Promise<unknown>
  destroy(): Promise<void>
}

interface PdfjsModule {
  version: string
  getDocument(params: Record<string, unknown>): PdfjsLoadingTask
}

/** unpdf.extractTextItems 的一项。坐标原点在页面左下角。 */
export interface PdfTextItem {
  str: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  hasEOL: boolean
}

interface UnpdfApi {
  definePDFJSModule(pdfjs: () => Promise<unknown>): Promise<void>
  getResolvedPDFJS(): Promise<PdfjsModule>
  extractText(
    pdf: unknown,
    options?: { mergePages?: boolean },
  ): Promise<{ totalPages: number; text: string | string[] }>
  extractTextItems(pdf: unknown): Promise<{ totalPages: number; items: PdfTextItem[][] }>
}

const getDocumentChannel = channel(PDFJS_GET_DOCUMENT_CHANNEL)

let cached: PdfjsPresetDataOptions | null = null
let enginePromise: Promise<PdfjsModule> | null = null

function slashDirectory(dir: string): string {
  const normalized = dir.split(path.sep).join('/')
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

/** 预置 CMap、标准 14 字体与 wasm 解码器目录（与引擎同一个 pdfjs-dist 包）。 */
export function pdfjsPresetDataOptions(): PdfjsPresetDataOptions {
  if (cached) return cached
  const packageJson = nodeRequire.resolve('pdfjs-dist/package.json')
  const root = path.dirname(packageJson)
  const cmaps = path.join(root, 'cmaps')
  const fonts = path.join(root, 'standard_fonts')
  const wasm = path.join(root, 'wasm')
  const probes = [
    path.join(cmaps, 'UniGB-UCS2-H.bcmap'),
    path.join(fonts, 'FoxitSerif.pfb'),
    path.join(wasm, 'jbig2.wasm'),
    path.join(wasm, 'openjpeg.wasm'),
  ]
  const missing = probes.filter((probe) => !existsSync(probe))
  if (missing.length > 0) {
    throw new Error(`PDF.js preset data missing (${missing.join(', ')})`)
  }
  cached = {
    cMapUrl: slashDirectory(cmaps),
    cMapPacked: true,
    standardFontDataUrl: slashDirectory(fonts),
    wasmUrl: slashDirectory(wasm),
  }
  return cached
}

/** 语义版本比较（只看 主.次.修订 三段数字）；解析不了一律当作不满足。 */
export function isPdfjsVersionAtLeast(version: unknown, minimum: string): boolean {
  const parse = (value: unknown): number[] | null => {
    const match = typeof value === 'string' ? /^(\d+)\.(\d+)\.(\d+)/.exec(value) : null
    return match ? match.slice(1, 4).map(Number) : null
  }
  const actual = parse(version)
  const floor = parse(minimum)
  if (!actual || !floor) return false
  for (let i = 0; i < 3; i += 1) {
    if (actual[i]! !== floor[i]!) return actual[i]! > floor[i]!
  }
  return true
}

function hardenedGetDocument(real: PdfjsModule, params: Record<string, unknown>): PdfjsLoadingTask {
  const effective: Record<string, unknown> = { ...params, ...PDFJS_HARDENED_OPTIONS }
  if (getDocumentChannel.hasSubscribers) {
    const event: PdfjsGetDocumentEvent = {
      engineVersion: real.version,
      enableScripting: effective['enableScripting'],
      isEvalSupported: effective['isEvalSupported'],
      enableXfa: effective['enableXfa'],
      cMapUrl: effective['cMapUrl'],
      standardFontDataUrl: effective['standardFontDataUrl'],
      wasmUrl: effective['wasmUrl'],
    }
    getDocumentChannel.publish(event)
  }
  return real.getDocument(effective)
}

async function loadPinnedEngine(): Promise<PdfjsModule> {
  const real = nodeRequire(PDFJS_ENGINE_SPECIFIER) as PdfjsModule
  if (!isPdfjsVersionAtLeast(real.version, PDFJS_MIN_SAFE_VERSION)) {
    throw new Error(`PDF.js engine ${String(real.version)} is below ${PDFJS_MIN_SAFE_VERSION}; refusing to open PDFs`)
  }
  // 外壳：模块其余导出原样透传（unpdf 还会用 OPS 等），只有 getDocument 换成强制安全选项的版本。
  const facade: PdfjsModule = Object.freeze({
    ...(real as unknown as Record<string, unknown>),
    getDocument: (params: Record<string, unknown>) => hardenedGetDocument(real, params),
  }) as unknown as PdfjsModule
  const unpdf = nodeRequire('unpdf') as UnpdfApi
  await unpdf.definePDFJSModule(async () => facade)
  const resolved = await unpdf.getResolvedPDFJS()
  if (resolved.getDocument !== facade.getDocument) {
    throw new Error('unpdf did not adopt the pinned PDF.js engine')
  }
  return facade
}

/**
 * 进程内只加载一次引擎并交给 unpdf；之后所有打开都复用它。失败结果同样被缓存
 * （引擎缺失 / 版本过低都不是重试能恢复的），调用方按「解析器不可用」处理。
 */
export function ensurePdfjsEngine(): Promise<PdfjsModule> {
  enginePromise ??= loadPinnedEngine()
  return enginePromise
}

async function openHardened<T>(data: Uint8Array, extra: Record<string, unknown>): Promise<T> {
  const pdfjs = await ensurePdfjsEngine()
  const task = pdfjs.getDocument({ ...pdfjsPresetDataOptions(), ...extra, data })
  const doc = (await task.promise) as { destroy?: unknown }
  if (typeof doc.destroy !== 'function') {
    Object.defineProperty(doc, 'destroy', {
      configurable: true,
      writable: true,
      value: () => task.destroy(),
    })
  }
  return doc as T
}

/**
 * 打开 PDF 供 extractText / getTextContent 使用。
 * useSystemFonts:true 沿用此前 unpdf.getDocumentProxy 的默认值（文字层结果与改动前一致）。
 */
export function openUnpdfDocument<T = unknown>(data: Uint8Array): Promise<T> {
  return openHardened<T>(data, { useSystemFonts: true })
}

/**
 * 打开 PDF 供逐页渲染或只读页数使用（不带 useSystemFonts：Node 下 PDF.js 默认 false，
 * 未嵌入的标准 14 字体从 standardFontDataUrl 读真字形，渲染结果才有字）。
 */
export function openPdfjsDocument<T = unknown>(
  data: Uint8Array,
  extra: { CanvasFactory?: unknown } = {},
): Promise<T> {
  return openHardened<T>(data, extra)
}

/**
 * unpdf.extractText 的唯一调用口：先确保引擎已换好，再交给 unpdf。
 * 每次调用时现取 require('unpdf').extractText（不在模块加载时解构），
 * 门禁对 unpdf 导出对象上的 extractText 打点计数才看得见真实调用。
 */
export async function extractPdfText(
  pdf: unknown,
  options: { mergePages?: boolean } = {},
): Promise<{ totalPages: number; text: string | string[] }> {
  await ensurePdfjsEngine()
  const unpdf = nodeRequire('unpdf') as UnpdfApi
  return unpdf.extractText(pdf, options)
}

/**
 * 逐页文字项（str / x / y / hasEOL）。与 extractPdfText 一样现取 unpdf，
 * 简历抽取用它自己断行；合同等仍走 extractPdfText。
 */
export async function extractPdfTextItems(
  pdf: unknown,
): Promise<{ totalPages: number; items: PdfTextItem[][] }> {
  await ensurePdfjsEngine()
  const unpdf = nodeRequire('unpdf') as UnpdfApi
  return unpdf.extractTextItems(pdf)
}
