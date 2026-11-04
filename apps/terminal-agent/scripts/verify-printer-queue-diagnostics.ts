import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  collectPrinterQueueDiagnostics,
  parsePrinterQueueLine,
  PRINTER_QUEUE_SCRIPT,
} from '../src/agent/printer-queue-diagnostics'
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

async function main(): Promise<void> {
  verifyParse()
  verifyScriptText()
  verifyRawStatus()
  await verifyCollect()
  console.log('ALL PASS: printer queue diagnostics stay enum-only and drop raw values that miss the contract')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
