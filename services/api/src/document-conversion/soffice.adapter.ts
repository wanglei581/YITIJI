import { access, mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ConversionEngineAdapter } from './document-conversion.types'

const PROBE_TIMEOUT_MS = 5_000

export class SofficeConversionAdapter implements ConversionEngineAdapter {
  readonly engine = 'soffice' as const

  constructor(private readonly executable: string) {}

  async probe(): Promise<{ available: boolean; reason?: string }> {
    if (!this.executable) {
      return { available: false, reason: '服务端未配置 SOFFICE_PATH' }
    }
    try {
      await access(resolve(this.executable))
      await runProcess(this.executable, ['--version'], PROBE_TIMEOUT_MS)
      return { available: true }
    } catch {
      return { available: false, reason: '服务端转换引擎探测失败，请检查 SOFFICE_PATH' }
    }
  }

  async convert(inputPath: string, outputDir: string, signal: AbortSignal): Promise<string> {
    const profileDir = join(outputDir, 'lo-profile')
    await mkdir(join(profileDir, 'user'), { recursive: true })
    await writeFile(
      join(profileDir, 'user', 'registrymodifications.xcu'),
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<oor:items xmlns:oor="http://openoffice.org/2001/registry">' +
        '<item oor:path="/org.openoffice.Office.Common/Security/Scripting">' +
        '<prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>' +
        '</item></oor:items>',
      'utf8',
    )

    await runProcess(
      this.executable,
      [
        `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
        '--headless',
        '--norestore',
        '--nologo',
        '--nolockcheck',
        '--nodefault',
        '--convert-to',
        'pdf',
        '--outdir',
        outputDir,
        inputPath,
      ],
      0,
      signal,
    )

    const dot = inputPath.lastIndexOf('.')
    const base = dot > inputPath.lastIndexOf('/') ? inputPath.slice(inputPath.lastIndexOf('/') + 1, dot) : 'source'
    return join(outputDir, `${base}.pdf`)
  }
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (externalSignal?.aborted) {
      reject(new Error('SOFFICE_ABORTED'))
      return
    }
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        HOME: process.env['HOME'] ?? '/tmp',
        http_proxy: 'http://127.0.0.1:9',
        https_proxy: 'http://127.0.0.1:9',
        HTTP_PROXY: 'http://127.0.0.1:9',
        HTTPS_PROXY: 'http://127.0.0.1:9',
        ALL_PROXY: 'http://127.0.0.1:9',
        NO_PROXY: '',
        no_proxy: '',
        SAL_DISABLE_CUPS: '1',
      },
    })
    let stderr = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      externalSignal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolvePromise()
    }
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4_096) stderr += chunk.toString('utf8')
    })
    const abort = (): void => {
      child.kill('SIGKILL')
      finish(new Error('SOFFICE_ABORTED'))
    }
    externalSignal?.addEventListener('abort', abort, { once: true })
    const timer = timeoutMs > 0 ? setTimeout(abort, timeoutMs) : undefined
    child.once('error', (error) => finish(error))
    child.once('exit', (code) => {
      if (code === 0) finish()
      else finish(new Error(`SOFFICE_EXIT_${String(code)}:${stderr.slice(0, 256)}`))
    })
  })
}
