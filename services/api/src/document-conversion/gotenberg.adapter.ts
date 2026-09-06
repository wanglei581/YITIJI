import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { ConversionEngineAdapter } from './document-conversion.types'

const PROBE_TIMEOUT_MS = 5_000

export class GotenbergConversionAdapter implements ConversionEngineAdapter {
  readonly engine = 'gotenberg' as const

  constructor(private readonly baseUrl: string) {}

  async probe(): Promise<{ available: boolean; reason?: string }> {
    if (!this.baseUrl) {
      return { available: false, reason: '服务端未配置 GOTENBERG_URL' }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const response = await fetch(new URL('/health', this.baseUrl), { signal: controller.signal })
      if (!response.ok) {
        return { available: false, reason: `Gotenberg 健康检查失败 (${response.status})` }
      }
      return {
        available: false,
        reason: 'Gotenberg 适配器骨架已连接，容器内 CJK 字体验证未完成，暂不开放转换',
      }
    } catch {
      return { available: false, reason: 'Gotenberg 健康检查失败' }
    } finally {
      clearTimeout(timer)
    }
  }

  async convert(inputPath: string, outputDir: string, signal: AbortSignal): Promise<string> {
    const form = new FormData()
    const input = await readFile(inputPath)
    form.append('files', new Blob([input]), basename(inputPath))
    const response = await fetch(new URL('/forms/libreoffice/convert', this.baseUrl), {
      method: 'POST',
      body: form,
      signal,
    })
    if (!response.ok) throw new Error(`GOTENBERG_HTTP_${response.status}`)
    const outputPath = `${outputDir}/source.pdf`
    const pdf = Buffer.from(await response.arrayBuffer())
    await writeFile(outputPath, pdf)
    return outputPath
  }
}
