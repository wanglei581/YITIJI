// 把 pdfjs-dist 的 cmaps/、standard_fonts/ 与 wasm/ 作为静态文件发布，和预览用的 PDF.js 同一个包、同一版本。
// PDF.js 本体与 worker 由 PdfCanvasPreview 以 ?url 引用、运行时 fetch，这里只管数据文件。
// 开发服务器直接从该目录取；生产构建用 emitFile 写进 dist，文件名不带 hash。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'

const nodeRequire = createRequire(import.meta.url)

const PRESET_DIRS = [
  { urlName: 'cmaps', dirName: 'cmaps' },
  { urlName: 'standard_fonts', dirName: 'standard_fonts' },
  // JBIG2 / JPX 解码器。wasm 用 fetch 取；只有 wasm 起不来时 PDF.js 才 import 同目录的 *_nowasm_fallback.js。
  { urlName: 'wasm', dirName: 'wasm' },
] as const

// 开发服务器的类型：fallback 脚本要按 JS 发，否则模块导入因 MIME 被拒；其余都是二进制。
function contentTypeFor(file: string): string {
  if (file.endsWith('.js') || file.endsWith('.mjs')) return 'text/javascript'
  if (file.endsWith('.wasm')) return 'application/wasm'
  return 'application/octet-stream'
}

function pdfjsPackageRoot(): string {
  return path.dirname(nodeRequire.resolve('pdfjs-dist/package.json'))
}

function mountPath(base: string, urlName: string): string {
  const prefix = !base || base === './' ? '/' : base
  const withSlash = prefix.endsWith('/') ? prefix : `${prefix}/`
  return `${withSlash}pdfjs/${urlName}`
}

function serveDirectory(root: string) {
  const rootResolved = path.resolve(root)
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const rawPath = (req.url ?? '/').split('?')[0] ?? '/'
    let rel = ''
    try {
      rel = decodeURIComponent(rawPath)
    } catch {
      res.statusCode = 400
      res.end()
      return
    }
    if (rel.startsWith('/')) rel = rel.slice(1)
    if (!rel || rel.includes('\0') || rel.split('/').some((part) => part === '..' || part === '.')) {
      res.statusCode = 400
      res.end()
      return
    }
    const file = path.resolve(rootResolved, rel)
    const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep
    if (!file.startsWith(prefix) || !existsSync(file) || !statSync(file).isFile()) {
      next()
      return
    }
    res.statusCode = 200
    res.setHeader('Content-Type', contentTypeFor(file))
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.end(readFileSync(file))
  }
}

function attachDevMiddleware(
  server: { config: { base: string }; middlewares: Connect.Server },
  packageRoot: string,
): void {
  for (const dir of PRESET_DIRS) {
    server.middlewares.use(
      mountPath(server.config.base, dir.urlName),
      serveDirectory(path.join(packageRoot, dir.dirName)),
    )
  }
}

export function pdfjsPresetAssets(): Plugin {
  const packageRoot = pdfjsPackageRoot()
  return {
    name: 'pdfjs-cmap-assets',
    configureServer(server) {
      attachDevMiddleware(server, packageRoot)
    },
    configurePreviewServer(server) {
      attachDevMiddleware(server, packageRoot)
    },
    generateBundle() {
      const totals: string[] = []
      for (const dir of PRESET_DIRS) {
        const abs = path.join(packageRoot, dir.dirName)
        let bytes = 0
        let files = 0
        for (const name of readdirSync(abs)) {
          const filePath = path.join(abs, name)
          if (!statSync(filePath).isFile()) continue
          const source = readFileSync(filePath)
          bytes += source.length
          files += 1
          this.emitFile({
            type: 'asset',
            fileName: `pdfjs/${dir.dirName}/${name}`,
            source,
          })
        }
        totals.push(`${dir.dirName} ${files} files ${bytes} bytes`)
      }
      const license = path.join(packageRoot, 'LICENSE')
      if (existsSync(license)) {
        this.emitFile({
          type: 'asset',
          fileName: 'pdfjs/LICENSE',
          source: readFileSync(license),
        })
      }
      console.log(`[kiosk] PDF.js preset data: ${totals.join('; ')}`)
    },
  }
}
