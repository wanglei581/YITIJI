// 文件页数识别（materials 体检 + print-jobs 计费页数共用）。
//
// 两条路径，优先级明确：
//   1. resolvePdfPageCount()：pdf.js 真解析页树，**权威**。压缩对象流（/Type /ObjStm）、
//      交叉引用流、增量更新都能正确读出；文件结构损坏时明确抛错而不是猜一个数。
//   2. countPdfPages()：纯字节正则扫描，**兜底**。无依赖、同步、极快，但只能看见未压缩
//      的明文页对象。
//
// 为什么必须以 pdf.js 为准（2026-08-17 真实文件走查实测）：
//   - Word / Chrome「打印为 PDF」/ LaTeX / pdf-lib 等现代生产者默认把页对象写进压缩对象流，
//     正则扫描一个都看不到 → 返回 null → 体检显示「暂未识别 PDF 页数」、A4 规范化评估
//     直接判不可用、PrintPageCountService fail-closed 抛 PRINT_PAGE_COUNT_UNAVAILABLE，
//     结果是**这类 PDF 根本下不了单、印不出来**。实测 pdf-lib 30 页文档：正则 null，pdf.js 30。
//   - 反过来，被截断/损坏的 PDF 正则仍会数出一个「看起来合理」的页数并一路带到计费。
//     实测 3 页 PDF 截半：正则给 2 页且体检报「PDF 页数已完成基础识别」零告警；
//     pdf.js 明确 InvalidPDFException。计费页数按 2 页收钱是错的。
//
// 边界：pdf.js 解析在最坏情况下会花时间/内存，故只在需要权威页数处调用；调用方必须
// 处理 null（fail-closed），不得回退到「按 1 页算」。

/**
 * PDF 轻量页数识别（兜底路径）：统计 `/Type /Page`（叶子页；`\b` 排除页树根 `/Type /Pages`）。
 *
 * 只对**未压缩**的页对象有效。识别不到返回 null（由调用方决定 fail-closed）。
 * 新代码请优先用 {@link resolvePdfPageCount}。
 */
export function countPdfPages(buffer: Buffer): number | null {
  const text = buffer.toString('latin1')
  const matches = text.match(/\/Type\s*\/Page\b/g)
  if (!matches?.length) return null
  return matches.length
}

/** 合法页数上限；超出视为解析结果不可信（与前端 pageCountFromInspection 的 2000 上限一致）。 */
const MAX_PLAUSIBLE_PAGES = 2000

/**
 * pdf.js 解析结果三态。区分「文件本身不可信」与「解析器不可用」是本模块的关键：
 * 前者绝不能回落到字节扫描（那会把损坏文件猜成一个看似合理的页数，一路带进计费），
 * 后者才允许回落（否则解析器一出问题所有 PDF 都印不了）。
 */
type ParserOutcome =
  | { kind: 'pages'; pages: number }
  | { kind: 'invalid_document' }
  | { kind: 'parser_unavailable' }

/**
 * PDF 页数权威识别。
 *
 * - pdf.js 读出页数 → 用它。
 * - pdf.js 判定文件不可解析（结构损坏 / 加密 / 根本不是 PDF）→ 返回 null，**不回落**。
 * - pdf.js 自身不可用（模块缺失等基础设施问题）→ 回落到 {@link countPdfPages} 字节扫描。
 *
 * @returns 页数；得不到可信结果时返回 null（调用方 fail-closed）。
 */
export async function resolvePdfPageCount(buffer: Buffer): Promise<number | null> {
  const outcome = await countPdfPagesByParser(buffer)
  if (outcome.kind === 'pages') return outcome.pages
  if (outcome.kind === 'invalid_document') return null
  const scanned = countPdfPages(buffer)
  if (scanned === null || scanned <= 0 || scanned > MAX_PLAUSIBLE_PAGES) return null
  return scanned
}

/** pdf.js 对「这份文件有问题」抛出的异常名；用于与解析器自身故障区分。 */
const DOCUMENT_LEVEL_PDFJS_ERRORS = new Set([
  'InvalidPDFException',
  'PasswordException',
  'MissingPDFException',
  'UnexpectedResponseException',
])

/**
 * 用 unpdf 内置的 pdf.js 只读页数，不渲染、不注入 CanvasFactory
 * （拿 numPages 不需要 canvas，避免把原生画布依赖引进计费链路）。
 *
 * isEvalSupported:false —— 禁止 pdfjs 对不可信 PDF 内嵌函数走 eval 路径。
 */
async function countPdfPagesByParser(buffer: Buffer): Promise<ParserOutcome> {
  let getDocument: (params: Record<string, unknown>) => {
    promise: Promise<{ numPages: number; destroy(): Promise<void> }>
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getResolvedPDFJS } = require('unpdf') as {
      getResolvedPDFJS(): Promise<{
        getDocument(params: Record<string, unknown>): {
          promise: Promise<{ numPages: number; destroy(): Promise<void> }>
        }
      }>
    }
    const pdfjs = await getResolvedPDFJS()
    getDocument = pdfjs.getDocument.bind(pdfjs)
  } catch {
    return { kind: 'parser_unavailable' }
  }

  let doc: { numPages: number; destroy(): Promise<void> } | undefined
  try {
    doc = await getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise
    const pages = doc.numPages
    if (!Number.isInteger(pages) || pages <= 0 || pages > MAX_PLAUSIBLE_PAGES) {
      return { kind: 'invalid_document' }
    }
    return { kind: 'pages', pages }
  } catch (error) {
    // 文档级异常 → 文件本身不可信，fail-closed；其余（解析器内部故障）才允许回落。
    const name = (error as { name?: unknown })?.name
    return typeof name === 'string' && DOCUMENT_LEVEL_PDFJS_ERRORS.has(name)
      ? { kind: 'invalid_document' }
      : { kind: 'parser_unavailable' }
  } finally {
    await doc?.destroy().catch(() => undefined)
  }
}

/** 单页图片 MIME 白名单（png/jpeg/webp）；用于"图片按 1 页"计。 */
export function isSinglePageImage(mimeType: string): boolean {
  return mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp'
}
