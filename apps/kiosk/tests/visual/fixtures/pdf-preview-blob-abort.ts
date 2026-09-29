import type { Request } from '@playwright/test'

/**
 * PdfCanvasPreview 先 fetch PDF.js 的 worker 和本体，再各自包成 blob: 模块导入。
 * 导入还没读完时整页跳走或重载，Chromium 会把这个 blob 脚本请求记成 net::ERR_ABORTED。
 * 本机快时几乎碰不到，CI 机器慢时常见（2026-09-28 的 W2 两条用例就是这样红的）。
 *
 * 它不是页面缺陷：blob 是本页内存里的对象，不走网络；新页面里 PDF.js 会整套重新导入，
 * 每次都是新 URL。走网络的脚本被中止，或 blob 模块因别的原因失败（例如 URL 被提前撤销，
 * 报的是 ERR_FILE_NOT_FOUND），这里都不放过，照样记错。
 */
export function isAbortedPdfjsBlobImport(request: Request): boolean {
  return request.resourceType() === 'script'
    && request.url().startsWith('blob:')
    && request.failure()?.errorText === 'net::ERR_ABORTED'
}
