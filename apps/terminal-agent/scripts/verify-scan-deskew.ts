/** Linux/Mac safe: real private temp files, fake child/clock, no PowerShell or hardware. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { runScanDeskew, type DeskewDeps } from '../src/agent/scan-deskew/runner'
import { buildDeskewScript, deskewCommand, DESKEW_TIMEOUT_MS, DESKEW_SOURCE } from '../src/agent/scan-deskew/script'
import { parseConfigText } from '../src/agent/config-manager'
import { THRESHOLDS_SOURCE } from '../src/agent/scan-deskew/thresholds-source'

/** Gate-only numerical mirror of estimator-source.ts; never imported by production. */
const limits: Record<string, number> = Object.fromEntries(
  [...THRESHOLDS_SOURCE.matchAll(/\b(\w+)\s*=\s*([\d.]+)\s*[,;]/g)].map((m) => [m[1], Number(m[2])]),
)
type Point = { x: number; y: number }
type ModelEstimate = { corrected: boolean; angle: number; reason: string; metrics: Record<string, number> }

/** Font-free glyphs, bilinear inverse rasterization; identical NumericalPage in Windows gate. */
function glyphPage(angle: number, physicalScale = 1, kind = 'text'): Uint8Array {
  const width = 900, height = 1200, gray = new Uint8Array(width * height)
  function pixel(x: number, y: number): number {
    if (x < 0 || x >= width || y < 0 || y >= height || kind === 'blank') return 255
    if (kind === 'dense') return x >= 60 && x < 840 && y >= 60 && y < 1140 ? 80 : 255
    if (kind === 'table' && x >= 80 && x <= 820 && y >= 80 && y <= 1080 && ((x - 80) % 148 === 0 || (y - 80) % 100 === 0)) return 0
    const row = Math.floor((y - 100) / 65), col = Math.floor((x - 100) / 10)
    const gx = x - 100 - col * 10, gy = y - 100 - row * 65
    return row >= 0 && row < 15 && col >= 0 && col < 60 && gx < 6 && gy < 10 && (gx < 2 || gy < 2 || (gy >= 4 && gy < 6) || (col % 2 === 0 && gx >= 4)) ? 0 : 255
  }
  const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x - width / 2, dy = y - height / 2
    const sx = (cos * dx + sin * dy + width / 2) / physicalScale
    const sy = (-sin * dx + cos * dy + height / 2) / physicalScale
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy
    gray[y * width + x] = Math.trunc(pixel(ix, iy) * (1 - fx) * (1 - fy) + pixel(ix + 1, iy) * fx * (1 - fy) + pixel(ix, iy + 1) * (1 - fx) * fy + pixel(ix + 1, iy + 1) * fx * fy)
  }
  return gray
}

function analyze(gray: Uint8Array, width: number, height: number, stride = width): ModelEstimate {
  const L = limits, metrics: Record<string, number> = {}
  const result = (reason: string, angle = 0): ModelEstimate => ({ corrected: reason === 'accepted', angle, reason, metrics })
  if (width < L.MinDimension || height < L.MinDimension || width > L.LongEdge || height > L.LongEdge || stride < width || stride * height > gray.length) return result('dimensions')
  const left = Math.trunc(width * L.Border), top = Math.trunc(height * L.Border)
  const right = width - left, bottom = height - top
  let edgeSum = 0, edgeCount = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x < left || x >= right || y < top || y >= bottom) { edgeSum += gray[y * stride + x]; edgeCount++ }
  }
  const background = metrics.background = edgeSum / edgeCount
  if (background < L.MinBackground) return result('background')
  const ink = new Uint8Array(width * height)
  let count = 0
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    if (gray[y * stride + x] < background - L.InkContrast) { ink[y * width + x] = 1; count++ }
  }
  const fraction = metrics.inkFraction = count / ((right - left) * (bottom - top))
  if (fraction < L.MinInk || fraction > L.MaxInk) return result('foreground_fraction')
  const points: Point[] = [], queue = new Int32Array(count)
  let glyphs = 0
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const first = y * width + x
    if (!ink[first]) continue
    let head = 0, tail = 1, minX = x, maxX = x, minY = y, maxY = y
    queue[0] = first; ink[first] = 0
    while (head < tail) {
      const p = queue[head++], px = p % width, py = Math.trunc(p / width)
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx, ny = py + dy
        if (nx < left || nx >= right || ny < top || ny >= bottom) continue
        const n = ny * width + nx
        if (ink[n]) { ink[n] = 0; queue[tail++] = n }
      }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1, ratio = w / h
    if (w >= (right - left) * L.MaxLineWidth || h >= (bottom - top) * L.MaxLineHeight) return result('large_component')
    if (tail < L.MinGlyphArea || w > width * L.MaxGlyphWidth || h > height * L.MaxGlyphHeight || tail > width * height * L.MaxGlyphArea || ratio < L.MinGlyphRatio || ratio > L.MaxGlyphRatio) continue
    glyphs++
    for (let i = 0; i < tail; i++) points.push({ x: queue[i] % width, y: Math.trunc(queue[i] / width) })
  }
  metrics.glyphs = glyphs; metrics.keptInk = points.length / count
  if (glyphs < L.MinGlyphs) return result('glyph_count')
  if (points.length < count * L.MinKeptInk) return result('kept_ink')
  function score(ps: Point[], angle: number): number {
    if (!ps.length) return 0
    const rows = new Float64Array(height * 2), slope = Math.tan(angle * Math.PI / 180)
    for (const p of ps) {
      const row = p.y - slope * (p.x - width / 2) + height / 2, r = Math.floor(row), part = row - r
      if (r < 0 || r + 1 >= rows.length) continue
      rows[r] += 1 - part; rows[r + 1] += part
    }
    let sum = 0
    for (const v of rows) sum += v * v
    return sum / (ps.length * ps.length) - 1 / rows.length
  }
  function search(ps: Point[]): number {
    let peak = -1, angle = 0
    for (let a = -L.MaxAngle; a <= L.MaxAngle + 0.00001; a += L.CoarseStep) {
      const s = score(ps, a)
      if (s > peak) { peak = s; angle = a }
    }
    const coarse = angle
    for (let a = Math.max(-L.MaxAngle, coarse - L.CoarseStep); a <= Math.min(L.MaxAngle, coarse + L.CoarseStep) + 0.00001; a += L.FineStep) {
      const s = score(ps, a)
      if (s > peak) { peak = s; angle = a }
    }
    return Math.round(angle * 10000) / 10000
  }
  const angle = search(points), best = score(points, angle), zero = score(points, 0)
  let second = 0
  for (let a = -L.MaxAngle; a <= L.MaxAngle + 0.00001; a += L.FineStep) {
    if (Math.abs(a - angle) >= L.PeakDistance - 0.00001) second = Math.max(second, score(points, a))
  }
  metrics.best = best; metrics.zeroGain = best / zero - 1; metrics.peakGain = best / second - 1
  if (Math.abs(angle) < L.MinAngle - 0.00001) return result('absolute_angle', angle)
  if (Math.abs(angle) > L.MaxAngle - L.BoundaryMargin + 0.00001) return result('boundary_margin', angle)
  if (!Number.isFinite(best) || best <= 0) return result('invalid_score', angle)
  if (best < zero * (1 + L.ZeroGain)) return result('zero_gain', angle)
  if (best < second * (1 + L.PeakGain)) return result('peak_gain', angle)
  const upper = points.filter((p) => p.y < Math.trunc(height / 2)), lower = points.filter((p) => p.y >= Math.trunc(height / 2))
  if (!upper.length || !lower.length) return result('empty_half', angle)
  metrics.upper = search(upper); metrics.lower = search(lower)
  if (Math.abs(metrics.upper - metrics.lower) > L.HalfAgreement + 0.00001) return result('half_agreement', angle)
  const rows = new Int32Array(height * 2), slope = Math.tan(angle * Math.PI / 180)
  for (const p of points) rows[Math.trunc(p.y - slope * (p.x - width / 2) + height / 2)]++
  const bands: Point[][] = []
  let start = -1, last = -1
  for (let y = 0; y <= rows.length; y++) {
    if (y < rows.length && rows[y] >= width * L.MinRowInk) { if (start < 0) start = y; last = y }
    if (start < 0 || (y < rows.length && y - last <= L.BandGap)) continue
    const band = points.filter((p) => { const row = p.y - slope * (p.x - width / 2) + height / 2; return row >= start && row < last + 1 })
    let minX = width, maxX = 0
    for (const p of band) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x) }
    if (last - start + 1 >= L.MinBandHeight && maxX - minX >= width * (1 - 2 * L.Border) * L.MinBandWidth) bands.push(band)
    start = -1
  }
  metrics.bands = bands.length
  if (bands.length < L.MinBands) return result('band_count_or_width', angle)
  for (let i = 0; i < L.MinBands; i++) {
    const a = search(bands[Math.trunc(i * (bands.length - 1) / (L.MinBands - 1))])
    metrics[`band${i}`] = a
    if (Math.abs(a - angle) > L.BandAgreement + 0.00001) return result('band_agreement', angle)
  }
  return result('accepted', angle)
}

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deskew-gate-')))
const taskDir = path.join(root, 'task-1')
fs.mkdirSync(taskDir)
const filePath = path.join(taskDir, 'private-person-name.jpg')
const original = Buffer.from('original must be preserved')
fs.writeFileSync(filePath, original)
const passed: string[] = []
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn(); passed.push(name); console.log(`PASS ${name}`)
}
function harness() {
  const child = Object.assign(new EventEmitter(), { pid: 1729 }) as ChildProcess
  const logs: string[] = [], kills: number[] = []
  let now = 0
  let calls = 0, timer: (() => void) | undefined, clearCount = 0
  const deps: Partial<DeskewDeps> = {
    root, platform: 'win32', now: () => now,
    spawnProcess(command, args, options) {
      calls++
      assert.match(command, /WindowsPowerShell.*powershell\.exe$/)
      assert.equal(options.shell, false); assert.equal(options.stdio, 'ignore')
      assert.equal(options.windowsHide, true)
      assert.equal(args.at(-2), '-EncodedCommand')
      assert.equal(fs.readFileSync(path.join(runDir(), 'processor.cs'), 'utf8'), DESKEW_SOURCE)
      return child
    },
    killTree: async (pid) => { kills.push(pid); return true },
    setTimer(callback, ms) { assert.equal(ms, DESKEW_TIMEOUT_MS); timer = callback; return 1 as unknown as NodeJS.Timeout },
    clearTimer() { clearCount++ },
    log(message) { logs.push(message) },
  }
  return { deps, child, logs, kills, calls: () => calls, timeout: () => timer!(), clears: () => clearCount, advance: (ms: number) => { now += ms } }
}
const request = { filePath, taskDir, scanAutoDeskewEnabled: true }
function runDir(): string {
  return path.join(taskDir, fs.readdirSync(taskDir).filter((n) => n.startsWith('deskew-')).at(-1)!)
}
function output(dir: string, bytes: Buffer, patch: Record<string, unknown> = {}) {
  fs.writeFileSync(path.join(dir, 'output.jpg'), bytes)
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({
    corrected: true, angleDeg: 1, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...patch,
  }))
}
function clearRuns() {
  for (const name of fs.readdirSync(taskDir)) if (name.startsWith('deskew-')) fs.rmSync(path.join(taskDir, name), { recursive: true })
}
async function main() {
  await check('numerical C# mirror / fixed thresholds / exhaustive synthetic matrix', () => {
    const angles = [-limits.MaxAngle, -4, -3, -2, -1, -limits.MinAngle, 0, limits.MinAngle, 1, 2, 3, 4,
      limits.MaxAngle, -limits.MaxAngle - limits.CoarseStep, limits.MaxAngle + limits.CoarseStep, -12, 12]
    const errors: string[] = []
    const summaries: string[] = []
    for (const kind of ['text', 'blank', 'dense', 'table', 'legacy-dpi']) {
      let expected = 0, actual = 0, falseCorrections = 0
      for (const angle of kind === 'legacy-dpi' ? [-4] : angles) {
        const eligible = kind === 'text' && Math.abs(angle) >= 1 && Math.abs(angle) < limits.MaxAngle - limits.BoundaryMargin
        const mustStay = kind !== 'text' || angle === 0 || Math.abs(angle) >= limits.MaxAngle - limits.BoundaryMargin
        const r = analyze(glyphPage(angle, kind === 'legacy-dpi' ? 96 / limits.DefaultDpi : 1, kind), 900, 1200)
        if (eligible) { expected++; if (r.corrected) actual++; else errors.push(`${kind} ${angle} fell back: ${r.reason}`) }
        if (r.corrected && (mustStay || Math.abs(r.angle - angle) > limits.HalfAgreement)) {
          falseCorrections++; errors.push(`${kind} ${angle} false correction`)
        }
        if (kind === 'legacy-dpi') {
          if (r.reason !== 'foreground_fraction') errors.push('legacy physical scaling no longer reproduces foreground rejection')
        }
        console.log(`MODEL ${kind} inputAngle=${angle} format=gray corrected=${r.corrected} estimated=${r.angle} reason=${r.reason} metrics=${JSON.stringify(r.metrics)}`)
      }
      if (kind === 'text' && expected !== 8) errors.push('missing positive controls')
      summaries.push(`MODEL SUMMARY ${kind} expected=${expected} corrected=${actual} falseCorrections=${falseCorrections}`)
    }
    for (const row of summaries) console.log(row)
    assert.deepEqual(errors, [], 'all numerical samples run before judgment; this is not a System.Drawing/codec test')
  })
  await check('config default / invalid false; only literal true enables; heartbeat allowlist', () => {
    const base = { apiBaseUrl: 'https://example.test', terminalCode: 'T', printerName: 'P', agentVersion: '0.4.19' }
    for (const value of [undefined, null, 'true', 1, {}, [], false, true]) {
      assert.equal(parseConfigText(JSON.stringify({ ...base, scanAutoDeskewEnabled: value })).scanAutoDeskewEnabled, value === true)
    }
    const index = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8')
    const callback = index.slice(index.indexOf('onConfigUpdate: (patch)'), index.indexOf('onObservation: (observation)'))
    assert.doesNotMatch(callback, /scanAutoDeskewEnabled|Object\.assign|\.\.\.patch/)
    assert.match(callback, /patch\.heartbeatIntervalMs/); assert.match(callback, /patch\.claimIntervalMs/)
  })
  await check('encoded script contract / private paths / closed validated output / no diagnostics', () => {
    const script = buildDeskewScript('C:\\private\\task\\deskew-abcdef', '.jpg')
    const args = deskewCommand(script)
    assert.equal(Buffer.from(args.at(-1)!, 'base64').toString('utf16le'), script)
    assert.ok(args.join(' ').length < 32767, 'Windows command-line limit; C# travels via private source file')
    for (const token of ['OutputEncoding', 'UTF8Encoding($false)', 'scan-device', 'private_acl', 'ReparsePoint', 'Get-FileHash', 'result.json', 'exit 1', 'Remove-Item', 'Add-Type']) assert.ok(script.includes(token), token)
    assert.ok(!script.includes('C:\\private')); assert.equal(DESKEW_TIMEOUT_MS, 2000)
    assert.match(DESKEW_SOURCE, /FileMode.CreateNew/); assert.match(DESKEW_SOURCE, /Image.FromFile\(output\)/)
    assert.doesNotMatch(DESKEW_SOURCE, /\$"|\?\.|=>|\bnameof\s*\(|\b(?:record|async|dynamic)\b/, 'C# 5 syntax guard')
    const workflow = fs.readFileSync(path.join(__dirname, '../../../.github/workflows/windows-agent-installer.yml'), 'utf8')
    assert.ok(workflow.includes('shell: powershell'))
    assert.ok(workflow.indexOf('Verify scan deskew C# and synthetic images') < workflow.indexOf('Exercise EXE install, repair, and uninstall'))
    assert.ok(workflow.includes('-File apps/terminal-agent/scripts/verify-scan-deskew-windows.ps1'))
    const windowsGate = fs.readFileSync(path.join(__dirname, 'verify-scan-deskew-windows.ps1'), 'utf8')
    const tests = windowsGate.split("$tests = @'")[1].split("'@")[0]
    assert.doesNotMatch(tests, /\$"|\?\.|=>|\bnameof\s*\(|\b(?:record|async|dynamic)\b/, 'gate must also compile as C# 5')
    assert.match(tests, /if \(!condition\) sampleErrors.Add\(message\);/, 'sample failures must accumulate')
    assert.equal((tests.match(/throw new Exception/g) || []).length, 1, 'only the final aggregate may throw')
    assert.ok(tests.indexOf('SUMMARY class') < tests.indexOf('throw new Exception'), 'summary precedes nonzero exit')
    assert.match(tests, /sample.SetResolution\(page.HorizontalResolution, page.VerticalResolution\)/)
    assert.match(tests, /page.Width, page.Height, GraphicsUnit.Pixel/)
    assert.match(tests, /Numerical\(angles, summary\)/, 'Windows reruns the same font-free controls as the TS model')
    assert.match(tests, /InputMarkers\(sample, decodedInput, format\)/, 'check markers after fixture encoding, before processing')
    assert.match(tests, /Preserved\(sample, rotated, result.AngleDeg, format\)/, 'use the encoded marker color for every output check')
    assert.match(tests, /MarkerControls\(directory\)/, 'Windows must reject each erased corner/edge marker')
    assert.doesNotMatch(script, /Write-(Host|Output|Warning|Error)|Start-Transcript/)
    assert.match(fs.readFileSync(path.join(__dirname, '../src/agent/scan-deskew/runner.ts'), 'utf8'), /\['\/PID', String\(pid\), '\/T', '\/F'\]/)
  })
  await check('BMP8 marker grayscale model / old false negative / erased and wrong colors reject', () => {
    const gate = fs.readFileSync(path.join(__dirname, 'verify-scan-deskew-windows.ps1'), 'utf8')
    const tolerance = Number(gate.match(/const int MarkerTolerance = (\d+);/)?.[1])
    assert.equal(tolerance, 20)
    assert.ok(gate.includes('int gray = (255 * 114 + 255 * 299) / 1000;'))
    assert.ok(gate.includes('format == "bmp8" ? Color.FromArgb(gray, gray, gray) : Color.Magenta'))
    assert.match(gate, /Math.Abs\(c.R - expected.R\) <= MarkerTolerance && Math.Abs\(c.G - expected.G\) <= MarkerTolerance &&\s*Math.Abs\(c.B - expected.B\) <= MarkerTolerance/)
    const magenta = [255, 0, 255], gray = Math.trunc((magenta[2] * 114 + magenta[1] * 587 + magenta[0] * 299) / 1000)
    const decoded = [gray, gray, gray]
    const legacy = (c: number[]) => c[0] > 150 && c[2] > 150 && c[1] < 120
    const grayscale = (c: number[]) => c.every((channel) => Math.abs(channel - gray) <= tolerance)
    assert.equal(gray, 105); assert.equal(legacy(magenta), true); assert.equal(legacy(decoded), false)
    assert.equal(grayscale(decoded), true)
    for (const wrong of [[255, 255, 255], [0, 0, 0], magenta, [150, 150, 150]]) assert.equal(grayscale(wrong), false)
    for (const delta of [-tolerance, tolerance]) assert.equal(grayscale(decoded.map((c) => c + delta)), true)
    for (const delta of [-tolerance - 1, tolerance + 1]) assert.equal(grayscale(decoded.map((c) => c + delta)), false)
    console.log(`PROBE BMP8 marker sourceRGB=${magenta} decodedRGB=${decoded} legacyMatch=${legacy(decoded)} grayMatch=${grayscale(decoded)} (color model only; codecs require Windows)`)
  })
  await check('disabled never spawns and preserves original for absent / false / invalid', async () => {
    for (const value of [undefined, false, 'true', 1, null]) {
      const h = harness()
      const pending = runScanDeskew({ ...request, scanAutoDeskewEnabled: value as boolean }, h.deps)
      assert.equal(h.calls(), 0, 'disabled must not start a process before returning')
      const result = await pending
      assert.equal(result.filePath, filePath); assert.equal(result.corrected, false); assert.equal(result.reason, 'disabled')
      assert.equal(h.calls(), 0)
    }
  })
  await check('spawn exception returns original without throwing', async () => {
    const h = harness()
    h.deps.spawnProcess = () => { throw new Error(`sensitive ${filePath}`) }
    const result = await runScanDeskew(request, h.deps)
    assert.equal(result.filePath, filePath); assert.equal(result.corrected, false); assert.equal(result.reason, 'exception')
    assert.equal(h.logs.length, 1); assert.deepEqual(JSON.parse(h.logs[0]), { angleDeg: null, corrected: false })
  })
  await check('timeout kills entire child tree; ignores late success; kill rejection contained', async () => {
    for (const rejects of [false, true]) {
      const h = harness()
      if (rejects) h.deps.killTree = async (pid) => { h.kills.push(pid); throw new Error('kill') }
      const pending = runScanDeskew(request, h.deps)
      const dir = runDir(); output(dir, Buffer.from('partial'))
      h.timeout(); h.child.emit('close', 0)
      const result = await pending
      assert.equal(result.filePath, filePath); assert.equal(result.reason, 'timeout')
      assert.deepEqual(h.kills, [1729]); assert.equal(h.clears(), 1)
      assert.equal(fs.existsSync(dir), rejects, 'confirmed tree termination cleans partial output; unconfirmed stays isolated')
      clearRuns()
    }
  })
  await check('close at deadline cannot beat the timeout callback', async () => {
    const h = harness(), pending = runScanDeskew(request, h.deps)
    h.advance(DESKEW_TIMEOUT_MS); h.child.emit('close', 0)
    assert.equal((await pending).reason, 'timeout'); assert.deepEqual(h.kills, [1729]); clearRuns()
  })
  await check('nonzero / child error return original even with output', async () => {
    for (const error of [false, true]) {
      const h = harness(), pending = runScanDeskew(request, h.deps)
      output(runDir(), Buffer.from('corrupt'))
      if (error) h.child.emit('error', new Error(filePath)); else h.child.emit('close', 9)
      const result = await pending
      assert.equal(result.filePath, filePath); assert.equal(result.reason, 'process_failed')
      assert.deepEqual(h.kills, [1729]); clearRuns()
    }
  })
  await check('missing / empty / damaged / hash mismatch / malformed status use original', async () => {
    for (const kind of ['missing', 'empty', 'damaged', 'hash', 'json', 'zero-angle', 'out-of-range']) {
      const h = harness(), pending = runScanDeskew(request, h.deps), dir = runDir()
      if (kind !== 'missing') output(dir, kind === 'empty' ? Buffer.alloc(0) : Buffer.from('not a jpeg'), kind === 'hash' ? { sha256: 'wrong' } : {})
      if (['hash', 'zero-angle', 'out-of-range'].includes(kind)) output(dir, Buffer.from('ffd8ffe00000ffd9', 'hex'), kind === 'hash' ? { sha256: 'wrong' } : { angleDeg: kind === 'zero-angle' ? 0 : 90 })
      if (kind === 'json') fs.writeFileSync(path.join(dir, 'result.json'), '{')
      h.child.emit('close', 0)
      const result = await pending
      assert.equal(result.filePath, filePath); assert.equal(result.corrected, false)
    }
  })
  await check('success uses independent output; logs exactly angle and corrected', async () => {
    const h = harness(), pending = runScanDeskew(request, h.deps), dir = runDir()
    // The child contract guarantees full System.Drawing decode; this fake tests Node integrity only.
    output(dir, Buffer.from('ffd8ffe00000ffd9', 'hex'))
    h.child.emit('close', 0)
    const result = await pending
    assert.equal(result.corrected, true); assert.equal(result.filePath, path.join(dir, 'output.jpg'))
    assert.deepEqual(fs.readFileSync(filePath), original)
    assert.equal(h.logs.length, 1)
    assert.deepEqual(JSON.parse(h.logs[0]), { angleDeg: 1, corrected: true })
    for (const forbidden of [filePath, path.basename(filePath), original.toString(), 'sha256']) assert.ok(!h.logs[0].includes(forbidden))
    assert.deepEqual(fs.readdirSync(dir), ['output.jpg']); clearRuns()
  })
  await check('path escape / symlink / unsupported reject before spawn; logger errors contained', async () => {
    const h = harness()
    assert.equal((await runScanDeskew({ ...request, taskDir: root }, h.deps)).filePath, filePath)
    assert.equal((await runScanDeskew({ ...request, filePath: path.join(taskDir, 'x.pdf') }, h.deps)).reason, 'unsupported')
    const link = path.join(taskDir, 'link.jpg'); fs.symlinkSync(filePath, link)
    assert.equal((await runScanDeskew({ ...request, filePath: link }, h.deps)).corrected, false)
    assert.equal(h.calls(), 0)
    await runScanDeskew({ ...request, scanAutoDeskewEnabled: false }, { ...h.deps, log: () => { throw new Error('log') } })
  })
  console.log(`scan-deskew: ${passed.length} groups passed (no PowerShell / no hardware)`)
}
const watchdog = setTimeout(() => { console.error('FAIL deskew gate did not finish'); process.exit(1) }, 30000)
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => { clearTimeout(watchdog); fs.rmSync(root, { recursive: true, force: true }) })
