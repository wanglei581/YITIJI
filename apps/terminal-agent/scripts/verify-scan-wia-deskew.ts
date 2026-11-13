/** Generated-script contracts + real temp files/fake WIA process. PowerShell runs in Windows gate. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { prepareWiaDeskew, logWiaDeskewLine } from '../src/agent/scan-deskew/wia-integration'
import { WIA_DESKEW_PAGE_SOURCE } from '../src/agent/scan-deskew/wia-page-source'
import { buildWiaScanScript, encodeWiaCommand } from '../src/agent/scan-device/wia-script'
import { startWiaScan } from '../src/agent/scan-device/wia-runner'

function ordered(text: string, parts: string[]): void {
  let at = 0
  for (const part of parts) {
    const next = text.indexOf(part, at)
    assert.ok(next >= at, `missing/out of order: ${part}`)
    at = next + part.length
  }
}

export async function verifyWiaDeskew(): Promise<void> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wia-deskew-')))
  const taskDir = path.join(root, 'taskA')
  fs.mkdirSync(taskDir)
  const params = { deviceName: '', source: 'flatbed' as const, color: 'gray' as const, dpi: 300, maxPages: 1,
    startIndex: 1, outDir: taskDir, cancelFlagPath: path.join(taskDir, 'cancel.flag') }
  const original = buildWiaScanScript(params, { root })
  try {
    // Frozen pre-S4b WIA bytes (the original generator is deliberately untouched).
    const winDir = 'C:\\ProgramData\\AIJobPrintAgent\\scan-device\\s4b'
    const snapshot = buildWiaScanScript({ ...params, outDir: winDir, cancelFlagPath: `${winDir}\\cancel.flag` },
      { root: path.win32.dirname(winDir), pathImpl: path.win32 })
    assert.equal(createHash('sha256').update(snapshot).digest('hex'), '3482cd9bd4abbabd79d0877fcac337a11488838ce5dde3af802d13f077e21582')
    for (const enabled of [undefined, false, null, 'true', 1, {}]) {
      const wired = prepareWiaDeskew(original, { enabled: enabled as boolean, taskDir, root })
      assert.equal(wired.script, original, 'off/invalid must keep every WIA script byte')
      assert.deepEqual(fs.readdirSync(taskDir), [], 'off must not stage BMP or subprocess assets')
      wired.cleanup()
    }
    const wired = prepareWiaDeskew(original, { enabled: true, taskDir, root })
    assert.notEqual(wired.script, original, 'enabled wiring must exist')
    assert.ok(encodeWiaCommand(wired.script).length < 28000)
    ordered(wired.script, ['$img = $item.Transfer($bmpFormat)', 'SaveDeskewWiaPage $img $dest',
      'catch { SaveJpeg $img $dest }', '$len = (Get-Item -LiteralPath $dest).Length', "throw 'empty'", 'Emit (\'{"page":'])
    ordered(WIA_DESKEW_PAGE_SOURCE, ['$img.SaveFile($inputFile)', '[Diagnostics.Process]::Start($start)',
      'AssertDeskewFile $manifestFile', 'AssertDeskewFile $outputFile', 'Copy-Item -LiteralPath $outputFile -Destination $dest',
      '} catch {', 'StopDeskewWorker $child', 'SaveJpeg $img $dest', "throw 'empty'", '} finally {',
      'Remove-Item -LiteralPath $inputFile,$outputFile', 'Remove-Item -LiteralPath $run -Recurse', 'Emit ('])
    assert.match(WIA_DESKEW_PAGE_SOURCE, /ElapsedMilliseconds -ge 2000 -or \(Test-Path -LiteralPath \$CancelFlag\)/)
    assert.match(WIA_DESKEW_PAGE_SOURCE, /\$child.ExitCode -ne 0/)
    assert.match(WIA_DESKEW_PAGE_SOURCE, /\/PID ' \+ \$child.Id \+ ' \/T \/F'/)
    assert.doesNotMatch(WIA_DESKEW_PAGE_SOURCE, /\$PID\b|WIA\.DeviceManager|Write-(Host|Output|Error|Warning)|Start-Transcript/)
    for (const contract of ['ReparsePoint', '104857600', 'IsNaN', 'IsInfinity', 'Get-FileHash', '$bytes[$bytes.Length - 1] -ne 217']) {
      assert.ok(WIA_DESKEW_PAGE_SOURCE.includes(contract), contract)
    }
    const assets = path.join(taskDir, fs.readdirSync(taskDir)[0]!)
    const worker = fs.readFileSync(path.join(assets, 'worker.txt'), 'utf8')
    assert.ok(worker.includes('WIA_DESKEW_DATA'))
    assert.ok(worker.includes('[ScanDeskew.ImageProcessor]::Process($inputFile, $outputFile)'))
    // A2's forced-stop path may skip PowerShell finally: Node removes this batch's leftovers too.
    const prefix = path.basename(assets).replace(/assets$/, '')
    const leftover = path.join(taskDir, `${prefix}dead`)
    fs.mkdirSync(leftover); fs.writeFileSync(path.join(leftover, 'input.bmp'), 'private')
    wired.cleanup()
    assert.deepEqual(fs.readdirSync(taskDir), [])
    assert.equal(prepareWiaDeskew(original, { enabled: true, taskDir: path.join(root, 'missing'), root }).script, original)

    const logs: string[] = []
    assert.equal(logWiaDeskewLine('{"angleDeg":1,"corrected":true}', (s) => logs.push(s)), true)
    assert.equal(logWiaDeskewLine('{"angleDeg":null,"corrected":false}', (s) => logs.push(s)), true)
    for (const record of [{ angleDeg: 1, corrected: true, path: 'private' }, { angleDeg: 90, corrected: true },
      { angleDeg: 'private', corrected: false }, { page: 1 }]) {
      assert.equal(logWiaDeskewLine(JSON.stringify(record), (s) => logs.push(s)), false)
    }
    assert.deepEqual(logs.map((s) => Object.keys(JSON.parse(s))), [['angleDeg', 'corrected'], ['angleDeg', 'corrected']])
    const scheduler = fs.readFileSync(path.join(__dirname, '../src/agent/scan-device/scan-device-runner.ts'), 'utf8')
    assert.match(scheduler, /startScan: \(request\) => startWiaScan\(\{ \.\.\.request, scanAutoDeskewEnabled: config.scanAutoDeskewEnabled === true \}\)/)
    const runner = fs.readFileSync(path.join(__dirname, '../src/agent/scan-device/wia-runner.ts'), 'utf8')
    assert.match(runner, /enabled: request.scanAutoDeskewEnabled/)
    assert.match(runner, /\.finally\(deskew.cleanup\)/)
    const workflow = fs.readFileSync(path.join(__dirname, '../../../.github/workflows/windows-agent-installer.yml'), 'utf8')
    ordered(workflow, ['pnpm verify:scan-wia-deskew-windows', '- name: Build candidate upgrade fixture'])
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'))
    assert.equal(manifest.scripts['verify:scan-wia-deskew-windows'], 'ts-node scripts/verify-scan-wia-deskew-windows.ts')

    for (const enabled of [false, true]) for (const end of ['done', 'failure', 'abort', 'spawnFailure']) {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), pid: 1234 })
      let spawnedScript = ''
      let pages = 0
      const scan = startWiaScan({ source: 'flatbed', color: 'gray', outDir: taskDir, scanAutoDeskewEnabled: enabled,
        onPage: () => { pages++ } }, { root,
        spawnProcess: (_cmd, args) => {
          spawnedScript = Buffer.from(args.at(-1)!, 'base64').toString('utf16le')
          if (end === 'spawnFailure') throw Object.assign(new Error('injected'), { code: 'ENOENT' })
          return child as unknown as ChildProcess
        } })
      assert.equal(spawnedScript === original, !enabled, 'WIA runner must actually pass the selected script')
      if (end === 'abort') scan.abort()
      else if (end === 'done') {
        fs.writeFileSync(path.join(taskDir, 'page-001.jpg'), 'original-or-validated-jpeg')
        child.stdout.emit('data', Buffer.from('{"page":1,"file":"page-001.jpg","bytes":26,"via":"wia"}\n{"ok":true,"pages":1}\n'))
      } else child.stdout.emit('data', Buffer.from('{"ok":false,"pages":0,"code":"wia_error"}\n'))
      child.emit('close', 0)
      const result = await scan.result
      assert.equal(result.ok, end === 'done'); assert.equal(pages, end === 'done' ? 1 : 0)
      assert.equal(fs.readdirSync(taskDir).some((n) => n.startsWith('deskew-')), false)
      fs.rmSync(path.join(taskDir, 'page-001.jpg'), { force: true })
      fs.rmSync(params.cancelFlagPath, { force: true })
    }
    console.log('PASS WIA deskew wiring: off-byte snapshot, Transfer/BMP/worker/fallback/validation/cleanup/notify, failures/timeouts/output contracts, private cleanup, two-field logs, runner done/failure/abort')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}
