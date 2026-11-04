import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { __resetUnauthorizedForTests, __setUnauthorizedMarkerPathForTests } from '../src/agent/auth-state'
import {
  __resetPrinterQueueFieldRetryForTests,
  sendHeartbeat,
  type HeartbeatOptions,
} from '../src/agent/heartbeat'
import {
  collectPrinterQueueDiagnostics,
  parsePrinterQueueLine,
  PRINTER_QUEUE_SCRIPT,
} from '../src/agent/printer-queue-diagnostics'
import type { AgentConfig, HeartbeatPayload } from '../src/agent/types'
import { selectPrinterQueueRawStatus } from '../src/agent/wmi'
import { POWERSHELL_STDIN_UTF8 } from '../src/agent/wql-literal'

function assertNoPortName(
  line: string | null,
  message: string,
): void {
  const parsed = parsePrinterQueueLine(line)
  assert.equal('portName' in parsed, false, message)
  return
}

function verifyParse(): void {
  const usb = parsePrinterQueueLine('running|usb|USB001')
  assert.equal(usb.spooler, 'running')
  assert.equal(usb.portKind, 'usb')
  assert.equal(usb.portName, 'USB001', 'USB001 must be kept')

  const network = parsePrinterQueueLine('running|network|')
  assert.equal(network.spooler, 'running')
  assert.equal(network.portKind, 'network')
  assertNoPortName('running|network|', 'empty network port must not keep a port name')

  assert.equal(parsePrinterQueueLine('running|usb|192.168.50.2').portKind, 'usb')
  assertNoPortName('running|usb|192.168.50.2', 'non-usb-shaped port name must be dropped')
  assertNoPortName('running|usb|IP_192.168.50.2', 'IP-labelled port name must be dropped')
  assertNoPortName('running|network|192.168.50.2', 'network port name must be dropped')
  assertNoPortName('running|network|USB001', 'network kind must drop the port name even if it looks like USB')
  assertNoPortName('running|wsd|WSD-1', 'wsd port name must be dropped')

  for (const bad of ['乱串', '', null] as const) {
    const parsed = parsePrinterQueueLine(bad)
    assert.equal(parsed.spooler, 'unknown', `garbage ${JSON.stringify(bad)} spooler`)
    assert.equal(parsed.portKind, 'unknown', `garbage ${JSON.stringify(bad)} portKind`)
    assert.equal('portName' in parsed, false)
  }

  const stopped = parsePrinterQueueLine('stopped|unknown|')
  assert.equal(stopped.spooler, 'stopped', 'stopped spooler must stay stopped')
  assert.equal(stopped.portKind, 'unknown')
  assert.equal('portName' in stopped, false)
}

function verifyScriptText(): void {
  assert.ok(PRINTER_QUEUE_SCRIPT.startsWith(POWERSHELL_STDIN_UTF8), 'script must start with the stdin UTF-8 switch')
  assert.match(PRINTER_QUEUE_SCRIPT, /\[Console\]::In\.ReadLine\(\)/, 'printer name must be read from stdin')
  assert.match(PRINTER_QUEUE_SCRIPT, /Get-Service -Name Spooler/)
  assert.match(PRINTER_QUEUE_SCRIPT, /Get-Printer -Name \$name/)
  assert.match(PRINTER_QUEUE_SCRIPT, /Get-PrinterPort -Name/)
  assert.match(PRINTER_QUEUE_SCRIPT, /\$printerPort\.PrinterHostAddress/, 'host address is only a presence check')
  assert.doesNotMatch(PRINTER_QUEUE_SCRIPT, /Write-Output \$port\b/)
  assert.doesNotMatch(PRINTER_QUEUE_SCRIPT, /PortNumber/)
  assert.doesNotMatch(PRINTER_QUEUE_SCRIPT, /ssid/i)
  assert.doesNotMatch(PRINTER_QUEUE_SCRIPT, /password/i)
  assert.doesNotMatch(PRINTER_QUEUE_SCRIPT, /gateway/i)

  const outputLines = PRINTER_QUEUE_SCRIPT.split('\n').filter((line) => line.includes('"$'))
  assert.ok(outputLines.length > 0, 'script must emit a classified line')
  for (const line of outputLines) {
    assert.doesNotMatch(line, /PrinterHostAddress/, 'script must not output PrinterHostAddress')
    assert.doesNotMatch(line, /\$rawPort\b/, 'script must not output the raw port')
    assert.doesNotMatch(line, /\$printerPort\b/, 'script must not output the port object')
  }

  const source = fs.readFileSync(path.join(__dirname, '../src/agent/printer-queue-diagnostics.ts'), 'utf8')
  assert.match(source, /timeoutMs = 5_000/)
  assert.ok(source.split('\n').length <= 180, 'printer-queue-diagnostics.ts must stay within 180 lines')
}

function verifyRawStatus(): void {
  assert.equal(selectPrinterQueueRawStatus('3,0,False,0,0'), '3,0,False,0,0')
  assert.equal(selectPrinterQueueRawStatus('3,,False,,'), '3,,False,,')
  assert.equal(selectPrinterQueueRawStatus('query_failed'), 'query_failed')
  assert.equal(selectPrinterQueueRawStatus('not_found'), 'not_found')
  assert.equal(selectPrinterQueueRawStatus('abc'), undefined)
  assert.equal(selectPrinterQueueRawStatus('3,0,False,0,0\n'), undefined, 'newline must not be reported')
  assert.equal(selectPrinterQueueRawStatus(null), undefined)

  const wmi = fs.readFileSync(path.join(__dirname, '../src/agent/wmi.ts'), 'utf8')
  assert.match(wmi, /selectPrinterQueueRawStatus\(output\)/)
  assert.match(wmi, /queryWin32PrinterLine\(printerName\)/)
  assert.match(wmi, /wmi: configured printerName not found via Win32_Printer — reporting error/)
}

async function verifyCollect(): Promise<void> {
  const read = await collectPrinterQueueDiagnostics('Configured Queue', async (script, stdin) => {
    assert.equal(script, PRINTER_QUEUE_SCRIPT)
    assert.equal(stdin, 'Configured Queue')
    return 'running|usb|USB001'
  })
  assert.deepEqual(read, { spooler: 'running', portKind: 'usb', portName: 'USB001' })

  const crashed = await collectPrinterQueueDiagnostics('Configured Queue', async () => {
    throw new Error('simulated diagnostic failure')
  })
  assert.deepEqual(crashed, { spooler: 'unknown', portKind: 'unknown' })
  assert.equal('portName' in crashed, false)

  if (process.platform !== 'win32') {
    const local = await collectPrinterQueueDiagnostics('Configured Queue')
    assert.deepEqual(local, { spooler: 'unknown', portKind: 'unknown' })
    assert.equal('portName' in local, false, 'non-Windows must not include a port name')
  }
}

const QUEUE_KEYS = [
  'printerQueueName',
  'printerQueuePortKind',
  'printerQueuePortName',
  'printerQueueRawStatus',
  'printerQueueSpooler',
] as const

const HOUR_MS = 60 * 60 * 1000

function assertQueueKeys(body: HeartbeatPayload, present: boolean, label: string): void {
  for (const key of QUEUE_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(body, key), present, `${label} ${key}`)
  }
}

function queueProbes(): Pick<
  HeartbeatOptions,
  'readPrinterStatusAndRaw' | 'readDiskFreeGB' | 'readNetworkDiagnostics' | 'readPrinterQueueDiagnostics'
> {
  return {
    readPrinterStatusAndRaw: async () => ({ status: 'ready', rawStatus: '3,0,False,0,0' }),
    readDiskFreeGB: async () => -1,
    readNetworkDiagnostics: async () => ({
      wiredNetworkStatus: 'unknown',
      printerNetworkStatus: 'unknown',
    }),
    readPrinterQueueDiagnostics: async () => ({
      spooler: 'running',
      portKind: 'usb',
      portName: 'USB001',
    }),
  }
}

async function withHeartbeatServer(
  decide: () => { status: number },
  run: (baseUrl: string, requests: HeartbeatPayload[]) => Promise<void>,
): Promise<void> {
  const requests: HeartbeatPayload[] = []
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      if (request.method === 'GET' && request.url?.endsWith('/release-observation-plan')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ plan: null }))
        return
      }
      if (request.method === 'PUT' && request.url?.endsWith('/heartbeat')) {
        requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as HeartbeatPayload)
        const result = decide()
        response.writeHead(result.status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(
          result.status === 200
            ? { acknowledged: true }
            : { error: { code: result.status === 401 ? 'AUTH_TOKEN_INVALID' : 'BAD_REQUEST' } },
        ))
        return
      }
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 'NOT_FOUND' } }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  try {
    await run(`http://127.0.0.1:${address.port}`, requests)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function verifyHeartbeatAssembly(): Promise<void> {
  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printer-queue-heartbeat-'))
  const previousProgramData = process.env.PROGRAMDATA
  process.env.PROGRAMDATA = markerDir
  __setUnauthorizedMarkerPathForTests(path.join(markerDir, 'agent.unauthorized'))
  __resetUnauthorizedForTests(true)
  __resetPrinterQueueFieldRetryForTests()

  const heartbeatSource = fs.readFileSync(path.join(__dirname, '../src/agent/heartbeat.ts'), 'utf8')
  const parallelAt = heartbeatSource.indexOf('await Promise.all([')
  const parallelEnd = heartbeatSource.indexOf('])', parallelAt)
  const parallelBlock = heartbeatSource.slice(parallelAt, parallelEnd)
  assert.ok(parallelAt > 0, 'heartbeat probes stay inside Promise.all')
  assert.match(parallelBlock, /readPrinter\(/)
  assert.match(parallelBlock, /readDisk\(/)
  assert.match(parallelBlock, /readNetwork\(/)
  assert.match(parallelBlock, /readQueue\(/)

  let mode: 'ok' | 'bad-once' | 'bad-always' | 'unauthorized' = 'ok'
  let phaseHits = 0
  const t0 = 1_700_000_000_000
  const config: AgentConfig = {
    apiBaseUrl: 'http://127.0.0.1',
    terminalCode: 'VERIFY-PRINTER-QUEUE',
    agentVersion: 'verify-only',
    terminalId: 'terminal-printer-queue',
    agentToken: 'test-only-agent-token',
    printerName: 'Configured Queue',
  }

  try {
    await withHeartbeatServer(() => {
      phaseHits += 1
      if (mode === 'unauthorized') return { status: 401 }
      if (mode === 'bad-always') return { status: 400 }
      if (mode === 'bad-once' && phaseHits === 1) return { status: 400 }
      return { status: 200 }
    }, async (baseUrl, requests) => {
      const failureCounter = { count: 0 }
      const observations: boolean[] = []
      let clock = t0
      const options: HeartbeatOptions = {
        ...queueProbes(),
        config: { ...config, apiBaseUrl: baseUrl },
        failureCounter,
        now: () => clock,
        onObservation: (observation) => { observations.push(observation.connected) },
      }

      phaseHits = 0
      observations.length = 0
      assert.equal(await sendHeartbeat(options), true)
      assert.equal(requests.length, 1, 'a normal heartbeat is one request')
      const first = requests[0]
      assert.ok(first)
      assert.equal(first.printerStatus, 'ready')
      assert.equal(first.printerQueueName, 'Configured Queue')
      assert.equal(first.printerQueuePortKind, 'usb')
      assert.equal(first.printerQueuePortName, 'USB001')
      assert.equal(first.printerQueueRawStatus, '3,0,False,0,0')
      assert.equal(first.printerQueueSpooler, 'running')
      assert.deepEqual(observations, [true], 'success notifies once')
      assert.equal(failureCounter.count, 0)

      mode = 'bad-once'
      phaseHits = 0
      clock = t0
      observations.length = 0
      failureCounter.count = 0
      const warnChunks: string[] = []
      const originalWrite = process.stdout.write.bind(process.stdout)
      process.stdout.write = ((chunk: string | Uint8Array) => {
        warnChunks.push(String(chunk))
        return true
      }) as typeof process.stdout.write
      let retryOk = false
      try {
        retryOk = await sendHeartbeat(options)
      } finally {
        process.stdout.write = originalWrite
      }
      assert.equal(retryOk, true, '400 then a clean retry is success')
      assert.equal(requests.length, 3, '400 resends exactly once')
      const rejected = requests[1]
      const retried = requests[2]
      assert.ok(rejected && retried)
      assertQueueKeys(rejected, true, 'first 400 request keeps queue fields')
      assertQueueKeys(retried, false, 'retry after 400 drops queue fields')
      assert.deepEqual(observations, [true], '400 retry notifies once')
      assert.equal(failureCounter.count, 0, 'successful retry resets the failure counter')
      const warnText = warnChunks.join('')
      assert.equal(warnText.split('后端还不认打印队列字段').length - 1, 1, 'warn once per rejection')

      phaseHits = 0
      mode = 'ok'
      clock = t0 + HOUR_MS - 1
      const withinStart = requests.length
      assert.equal(await sendHeartbeat(options), true)
      assert.equal(requests.length, withinStart + 1, 'within one hour there is no extra retry')
      const within = requests[withinStart]
      assert.ok(within)
      assertQueueKeys(within, false, 'within one hour the next heartbeat omits queue fields')

      phaseHits = 0
      clock = t0 + HOUR_MS
      const afterStart = requests.length
      assert.equal(await sendHeartbeat(options), true)
      assert.equal(requests.length, afterStart + 1, 'after one hour there is no extra retry')
      const after = requests[afterStart]
      assert.ok(after)
      assert.equal(after.printerQueueName, 'Configured Queue')
      assert.equal(after.printerQueuePortKind, 'usb')
      assert.equal(after.printerQueuePortName, 'USB001')
      assert.equal(after.printerQueueRawStatus, '3,0,False,0,0')
      assert.equal(after.printerQueueSpooler, 'running')

      phaseHits = 0
      const unsafeStart = requests.length
      assert.equal(await sendHeartbeat({
        ...options,
        config: { ...options.config, printerName: 'bad\nname' },
      }), true)
      const unsafe = requests[unsafeStart]
      assert.ok(unsafe)
      assert.equal(Object.prototype.hasOwnProperty.call(unsafe, 'printerQueueName'), false, 'control characters omit the queue name')
      assert.equal(unsafe.printerQueuePortKind, 'usb')
      assert.equal(requests.length, unsafeStart + 1)

      __resetPrinterQueueFieldRetryForTests()
      mode = 'bad-always'
      phaseHits = 0
      clock = t0 + (2 * HOUR_MS)
      observations.length = 0
      failureCounter.count = 0
      const alwaysStart = requests.length
      assert.equal(await sendHeartbeat(options), false, 'a second 400 is a normal failure')
      assert.equal(requests.length, alwaysStart + 2, '400 is resent once and then stops')
      const alwaysFirst = requests[alwaysStart]
      const alwaysSecond = requests[alwaysStart + 1]
      assert.ok(alwaysFirst && alwaysSecond)
      assertQueueKeys(alwaysFirst, true, 'always-400 first request keeps queue fields')
      assertQueueKeys(alwaysSecond, false, 'always-400 retry drops queue fields')
      assert.deepEqual(observations, [false], 'failed retry notifies once')
      assert.equal(failureCounter.count, 1, 'failed retry increments the counter once')

      mode = 'unauthorized'
      phaseHits = 0
      clock = t0 + (3 * HOUR_MS) + 1
      observations.length = 0
      failureCounter.count = 0
      const unauthorizedStart = requests.length
      assert.equal(await sendHeartbeat(options), false, '401 is a failure')
      assert.equal(requests.length, unauthorizedStart + 1, '401 must not resend')
      const unauthorized = requests[unauthorizedStart]
      assert.ok(unauthorized)
      assert.equal(unauthorized.printerQueueName, 'Configured Queue')
      assert.equal(unauthorized.printerQueuePortKind, 'usb')
      assert.equal(unauthorized.printerQueuePortName, 'USB001')
      assert.equal(unauthorized.printerQueueRawStatus, '3,0,False,0,0')
      assert.equal(unauthorized.printerQueueSpooler, 'running')
      assert.deepEqual(observations, [false], '401 notifies once')
      assert.equal(failureCounter.count, 1)
    })
  } finally {
    __resetUnauthorizedForTests(true)
    __resetPrinterQueueFieldRetryForTests()
    if (previousProgramData === undefined) delete process.env.PROGRAMDATA
    else process.env.PROGRAMDATA = previousProgramData
    fs.rmSync(markerDir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  verifyParse()
  verifyScriptText()
  verifyRawStatus()
  await verifyCollect()
  await verifyHeartbeatAssembly()
  console.log('ALL PASS: printer queue diagnostics stay enum-only and drop raw values that miss the contract')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
