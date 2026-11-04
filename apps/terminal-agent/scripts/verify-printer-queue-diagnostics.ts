import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { __resetUnauthorizedForTests, __setUnauthorizedMarkerPathForTests, isUnauthorized } from '../src/agent/auth-state'
import {
  __printerQueueFieldRetrySuppressedUntilForTests,
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
const QUEUE_FIELD_FALLBACK_WARN =
  'heartbeat: 带打印队列字段的心跳被拒（400），去掉这些字段后重发成功；1 小时内不带'

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

  let mode: 'ok' | 'bad-once' | 'bad-always' | 'unauthorized' | 'bad-then-401' = 'ok'
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
      if (mode === 'bad-then-401') return { status: phaseHits === 1 ? 400 : 401 }
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
      let queueReads = 0
      let printerReads = 0
      const readQueueProbe = options.readPrinterQueueDiagnostics
      const readPrinterProbe = options.readPrinterStatusAndRaw
      assert.ok(readQueueProbe && readPrinterProbe)
      options.readPrinterQueueDiagnostics = async (printerName) => {
        queueReads += 1
        return readQueueProbe(printerName)
      }
      options.readPrinterStatusAndRaw = async (printerName) => {
        printerReads += 1
        return readPrinterProbe(printerName)
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
      assert.equal(warnText.split(QUEUE_FIELD_FALLBACK_WARN).length - 1, 1, 'warn once after the clean retry')

      phaseHits = 0
      mode = 'ok'
      clock = t0 + HOUR_MS - 1
      const withinStart = requests.length
      const queueReadsBeforeWithin = queueReads
      const printerReadsBeforeWithin = printerReads
      assert.equal(await sendHeartbeat(options), true)
      assert.equal(requests.length, withinStart + 1, 'within one hour there is no extra retry')
      const within = requests[withinStart]
      assert.ok(within)
      assertQueueKeys(within, false, 'within one hour the next heartbeat omits queue fields')
      assert.equal(queueReads, queueReadsBeforeWithin, 'within one hour readQueue is not called')
      assert.equal(printerReads, printerReadsBeforeWithin + 1, 'within one hour readPrinter still runs')

      mode = 'bad-always'
      phaseHits = 0
      failureCounter.count = 0
      const bareStart = requests.length
      const queueReadsBeforeBare = queueReads
      assert.equal(await sendHeartbeat(options), false, '400 without queue fields does not retry')
      assert.equal(requests.length, bareStart + 1, '400 without queue fields is a single request')
      const bare = requests[bareStart]
      assert.ok(bare)
      assertQueueKeys(bare, false, '400 without queue fields')
      assert.equal(failureCounter.count, 1, '400 without queue fields increments the counter once')
      assert.equal(queueReads, queueReadsBeforeBare, '400 without queue fields still skips readQueue')
      mode = 'ok'

      phaseHits = 0
      clock = t0 + HOUR_MS
      const afterStart = requests.length
      const queueReadsBeforeAfter = queueReads
      assert.equal(await sendHeartbeat(options), true)
      assert.equal(requests.length, afterStart + 1, 'after one hour there is no extra retry')
      assert.equal(queueReads, queueReadsBeforeAfter + 1, 'after one hour readQueue runs again')
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
      const alwaysWarnChunks: string[] = []
      const alwaysOriginalWrite = process.stdout.write.bind(process.stdout)
      process.stdout.write = ((chunk: string | Uint8Array) => {
        alwaysWarnChunks.push(String(chunk))
        return true
      }) as typeof process.stdout.write
      let alwaysFailed = true
      try {
        alwaysFailed = await sendHeartbeat(options)
      } finally {
        process.stdout.write = alwaysOriginalWrite
      }
      assert.equal(alwaysFailed, false, 'a second 400 is a normal failure')
      assert.equal(requests.length, alwaysStart + 2, '400 is resent once and then stops')
      const alwaysFirst = requests[alwaysStart]
      const alwaysSecond = requests[alwaysStart + 1]
      assert.ok(alwaysFirst && alwaysSecond)
      assertQueueKeys(alwaysFirst, true, 'always-400 first request keeps queue fields')
      assertQueueKeys(alwaysSecond, false, 'always-400 retry drops queue fields')
      assert.deepEqual(observations, [false], 'failed retry notifies once')
      assert.equal(failureCounter.count, 1, 'failed retry increments the counter once')
      assert.equal(
        alwaysWarnChunks.join('').includes(QUEUE_FIELD_FALLBACK_WARN),
        false,
        'failed retry must not warn that queue fields will be omitted',
      )
      assert.equal(__printerQueueFieldRetrySuppressedUntilForTests(), 0, 'failed retry does not start suppression')

      phaseHits = 0
      failureCounter.count = 0
      const stillStart = requests.length
      assert.equal(await sendHeartbeat(options), false, 'next heartbeat after 400→400 still fails')
      const stillFirst = requests[stillStart]
      assert.ok(stillFirst)
      assert.equal(stillFirst.printerQueueName, 'Configured Queue', '400→400 后下一次心跳仍带队列名')
      assert.equal(requests.length, stillStart + 2, '400→400 后下一次心跳仍会重发')
      assert.equal(failureCounter.count, 1, 'the next 400→400 still increments the counter once')

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

      __resetPrinterQueueFieldRetryForTests()
      __resetUnauthorizedForTests(true)
      mode = 'bad-then-401'
      phaseHits = 0
      clock = t0 + (4 * HOUR_MS)
      observations.length = 0
      failureCounter.count = 0
      const authRetryStart = requests.length
      assert.equal(__printerQueueFieldRetrySuppressedUntilForTests(), 0)
      assert.equal(await sendHeartbeat(options), false, '400 then 401 is a failure')
      assert.equal(requests.length, authRetryStart + 2, '400 then 401 resends once')
      const authFirst = requests[authRetryStart]
      const authSecond = requests[authRetryStart + 1]
      assert.ok(authFirst && authSecond)
      assertQueueKeys(authFirst, true, '400 then 401 first request keeps queue fields')
      assertQueueKeys(authSecond, false, '400 then 401 retry drops queue fields')
      assert.equal(isUnauthorized(), true, '400 then 401 calls markUnauthorized')
      assert.equal(failureCounter.count, 1, '400 then 401 increments the counter once')
      assert.equal(
        __printerQueueFieldRetrySuppressedUntilForTests(),
        0,
        '400 then 401 does not suppress queue fields',
      )
    })
  } finally {
    __resetUnauthorizedForTests(true)
    __resetPrinterQueueFieldRetryForTests()
    if (previousProgramData === undefined) delete process.env.PROGRAMDATA
    else process.env.PROGRAMDATA = previousProgramData
    fs.rmSync(markerDir, { recursive: true, force: true })
  }
}

/** 与后端打印队列名门禁同一张表，一字不差。接受的原样出现，拒绝的不带队列名。 */
const ACCEPTED_QUEUE_NAMES = [
  'Pantum CM2800ADN Series',
  'Pantum CM2800ADN Series (副本 1)',
  '奔图 CM2820 打印机',
  'Printer v1.2.3',
  'a'.repeat(128),
  '😀'.repeat(64),
] as const

const REJECTED_QUEUE_NAMES = [
  '',
  'a'.repeat(129),
  '😀'.repeat(65),
  'bad\nname',
  'bad\u007fname',
  'bad\u0085name',
  'bad\u009fname',
  '\\\\192.168.1.5\\Pantum',
  '\\\\PRINTSRV\\Pantum',
  'http://192.168.1.5:631/ipp/print',
  'ipp://printer.local/ipp',
  'Pantum 192.168.1.5',
  '192.168.001.005',
] as const

async function verifyQueueNameContract(): Promise<void> {
  __resetUnauthorizedForTests(true)
  __resetPrinterQueueFieldRetryForTests()
  const config: AgentConfig = {
    apiBaseUrl: 'http://127.0.0.1',
    terminalCode: 'VERIFY-PRINTER-QUEUE',
    agentVersion: 'verify-only',
    terminalId: 'terminal-printer-queue',
    agentToken: 'test-only-agent-token',
    printerName: 'Configured Queue',
  }
  await withHeartbeatServer(() => ({ status: 200 }), async (baseUrl, requests) => {
    for (const name of ACCEPTED_QUEUE_NAMES) {
      const before = requests.length
      assert.equal(await sendHeartbeat({
        ...queueProbes(),
        config: { ...config, apiBaseUrl: baseUrl, printerName: name },
        now: () => 1_700_000_000_000,
      }), true, `accepted queue name heartbeat: ${JSON.stringify(name)}`)
      assert.equal(requests.length, before + 1, `accepted queue name is one request: ${JSON.stringify(name)}`)
      const body = requests[before]
      assert.ok(body)
      assert.equal(body.printerQueueName, name, `accepted queue name is reported as-is: ${JSON.stringify(name)}`)
    }
    for (const name of REJECTED_QUEUE_NAMES) {
      const before = requests.length
      assert.equal(await sendHeartbeat({
        ...queueProbes(),
        config: { ...config, apiBaseUrl: baseUrl, printerName: name },
        now: () => 1_700_000_000_000,
      }), true, `rejected queue name heartbeat: ${JSON.stringify(name)}`)
      assert.equal(requests.length, before + 1, `rejected queue name is one request: ${JSON.stringify(name)}`)
      const body = requests[before]
      assert.ok(body)
      assert.equal(
        Object.prototype.hasOwnProperty.call(body, 'printerQueueName'),
        false,
        `rejected queue name omits printerQueueName: ${JSON.stringify(name)}`,
      )
      assert.equal(body.printerQueuePortKind, 'usb', `rejected queue name keeps port kind: ${JSON.stringify(name)}`)
      assert.equal(body.printerQueueSpooler, 'running', `rejected queue name keeps spooler: ${JSON.stringify(name)}`)
    }
  })
}

interface HeldHeartbeat {
  body: HeartbeatPayload
  respond: (status: number) => void
}

async function waitForHeld(inbox: HeldHeartbeat[], count: number): Promise<void> {
  const started = Date.now()
  while (inbox.length < count) {
    if (Date.now() - started > 5_000) {
      throw new Error(`timed out waiting for ${count} heartbeat requests, saw ${inbox.length}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function withHeldHeartbeatServer(
  run: (baseUrl: string, inbox: HeldHeartbeat[]) => Promise<void>,
): Promise<void> {
  const inbox: HeldHeartbeat[] = []
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
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as HeartbeatPayload
        inbox.push({
          body,
          respond: (status: number) => {
            response.writeHead(status, { 'content-type': 'application/json' })
            response.end(JSON.stringify(
              status === 200
                ? { acknowledged: true }
                : { error: { code: status === 401 ? 'AUTH_TOKEN_INVALID' : 'BAD_REQUEST' } },
            ))
          },
        })
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
    await run(`http://127.0.0.1:${address.port}`, inbox)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function verifyConcurrentQueueFallback(): Promise<void> {
  __resetUnauthorizedForTests(true)
  __resetPrinterQueueFieldRetryForTests()
  const earlySuccess = 2_000
  const lateSuccess = 5_000
  let nowValue = 1_000
  await withHeldHeartbeatServer(async (baseUrl, inbox) => {
    const options: HeartbeatOptions = {
      ...queueProbes(),
      config: {
        apiBaseUrl: baseUrl,
        terminalCode: 'VERIFY-PRINTER-QUEUE',
        agentVersion: 'verify-only',
        terminalId: 'terminal-printer-queue',
        agentToken: 'test-only-agent-token',
        printerName: 'Configured Queue',
      },
      now: () => nowValue,
    }
    const first = sendHeartbeat(options)
    await waitForHeld(inbox, 1)
    const second = sendHeartbeat(options)
    await waitForHeld(inbox, 2)
    const earlier = inbox[0]
    const later = inbox[1]
    assert.ok(earlier && later)
    assert.equal(earlier.body.printerQueueName, 'Configured Queue', 'earlier heartbeat sends the queue name')
    assert.equal(later.body.printerQueueName, 'Configured Queue', 'later heartbeat sends the queue name')

    later.respond(400)
    await waitForHeld(inbox, 3)
    const laterRetry = inbox[2]
    assert.ok(laterRetry)
    assert.equal(
      Object.prototype.hasOwnProperty.call(laterRetry.body, 'printerQueueName'),
      false,
      'later heartbeat retries without queue fields',
    )

    earlier.respond(400)
    await waitForHeld(inbox, 4)
    const earlierRetry = inbox[3]
    assert.ok(earlierRetry)
    assert.equal(
      Object.prototype.hasOwnProperty.call(earlierRetry.body, 'printerQueueName'),
      false,
      'earlier heartbeat retries without queue fields',
    )

    nowValue = lateSuccess
    laterRetry.respond(200)
    assert.equal(await second, true, 'later-sent heartbeat retry succeeds first')
    const laterDeadline = lateSuccess + HOUR_MS
    assert.equal(__printerQueueFieldRetrySuppressedUntilForTests(), laterDeadline)

    nowValue = earlySuccess
    earlierRetry.respond(200)
    assert.equal(await first, true, 'earlier-sent heartbeat retry succeeds later')
    assert.equal(
      __printerQueueFieldRetrySuppressedUntilForTests(),
      laterDeadline,
      '并发两次重发成功，截止时间取较晚的那个，不被写回更早',
    )
  })
  __resetUnauthorizedForTests(true)
  __resetPrinterQueueFieldRetryForTests()
}

async function main(): Promise<void> {
  verifyParse()
  verifyScriptText()
  verifyRawStatus()
  await verifyCollect()
  await verifyHeartbeatAssembly()
  await verifyConcurrentQueueFallback()
  await verifyQueueNameContract()
  console.log('ALL PASS: printer queue diagnostics stay enum-only and drop raw values that miss the contract')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
