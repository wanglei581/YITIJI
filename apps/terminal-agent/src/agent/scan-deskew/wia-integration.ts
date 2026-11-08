import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import { log } from '../../logger'
import { assertScanTaskDir } from '../scan-device/scan-temp-dir'
import { buildDeskewScript, DESKEW_SOURCE, DESKEW_MAX_ANGLE } from './script'
import { WIA_DESKEW_PAGE_SOURCE } from './wia-page-source'

export interface WiaDeskewWiring { script: string; cleanup(): void }

/** Called only after WIA parameter validation. Setup errors keep the original script byte-for-byte. */
export function prepareWiaDeskew(
  script: string,
  input: { enabled?: boolean; taskDir: string; root: string },
): WiaDeskewWiring {
  const original = { script, cleanup: () => undefined }
  if (input.enabled !== true) return original
  const token = randomBytes(8).toString('hex')
  const prefix = `deskew-${token}`
  const assets = path.join(input.taskDir, `${prefix}assets`)
  const cleanup = (): void => {
    try {
      for (const name of fs.readdirSync(input.taskDir)) {
        if (name.startsWith(prefix)) {
          try { fs.rmSync(path.join(input.taskDir, name), { recursive: true, force: true }) } catch { /* retry with A2 purge */ }
        }
      }
    } catch { /* A2 owns whole-task purge, its retry queue, and deletion audit. */ }
  }
  try {
    assertScanTaskDir(input.taskDir, input.root)
    // Same path whitelist as the WIA prologue; no interpolated user filename or shell syntax.
    if (!/^[A-Za-z0-9 _.:\\/()-]{1,260}$/.test(assets)) throw new Error('path')
    for (const dir of [input.root, input.taskDir]) {
      const stat = fs.lstatSync(dir)
      if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(dir) !== path.resolve(dir)) throw new Error('directory')
    }
    fs.mkdirSync(assets, { mode: 0o700 })
    const data = Buffer.from(JSON.stringify({ runDir: 'WIA_RUN_DIR', extension: '.bmp' })).toString('base64')
    const worker = buildDeskewScript('WIA_RUN_DIR', '.bmp').replace(data, 'WIA_DESKEW_DATA')
    for (const [name, content] of Object.entries({ 'page.ps1': WIA_DESKEW_PAGE_SOURCE, 'worker.txt': worker, 'processor.cs': DESKEW_SOURCE })) {
      fs.writeFileSync(path.join(assets, name), content, { flag: 'wx', mode: 0o600 })
    }
    const before = '      SaveJpeg $img $dest\n      $len = (Get-Item -LiteralPath $dest).Length'
    const after = [
      '      try {',
      `        $DeskewAssets = '${assets}'`,
      `        $DeskewRunPrefix = '${prefix}'`,
      "        . (Join-Path $DeskewAssets 'page.ps1')",
      '        SaveDeskewWiaPage $img $dest',
      '      } catch { SaveJpeg $img $dest }',
      '      $len = (Get-Item -LiteralPath $dest).Length',
      "      if ($len -le 0) { throw 'empty' }",
    ].join('\n')
    if (script.split(before).length !== 2) throw new Error('WIA_contract')
    return { script: script.replace(before, after), cleanup }
  } catch {
    cleanup()
    return original
  }
}

/** Consume only the two-field deskew protocol. Never echo untrusted stdout to logs. */
export function logWiaDeskewLine(line: string, write: (message: string) => void = log): boolean {
  try {
    const value: unknown = JSON.parse(line)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    if (Object.keys(record).sort().join(',') !== 'angleDeg,corrected' || typeof record.corrected !== 'boolean') return false
    const angle = record.angleDeg
    if (angle !== null && (typeof angle !== 'number' || !Number.isFinite(angle) || Math.abs(angle) > DESKEW_MAX_ANGLE)) return false
    try { write(JSON.stringify({ angleDeg: angle, corrected: record.corrected })) } catch { /* optional */ }
    return true
  } catch { return false }
}
