import { spawn } from 'child_process'
import { warn } from '../logger'
import { POWERSHELL_STDIN_UTF8 } from './wql-literal'

export type PrinterQueueSpooler = 'running' | 'stopped' | 'other' | 'unknown'
export type PrinterQueuePortKind = 'usb' | 'network' | 'wsd' | 'other' | 'unknown'

/** 只读。portName 仅在 usb 且端口名是 USB### / DOT4_### 时出现，不含地址。 */
export interface PrinterQueueDiagnostics {
  spooler: PrinterQueueSpooler
  portKind: PrinterQueuePortKind
  portName?: string
}

type PowerShellRunner = (script: string, stdin?: string) => Promise<string | null>

const USB_PORT_NAME = /^(USB|DOT4_)\d{1,3}$/
const SPOOLER_VALUES: ReadonlySet<string> = new Set(['running', 'stopped', 'other', 'unknown'])
const PORT_KIND_VALUES: ReadonlySet<string> = new Set(['usb', 'network', 'wsd', 'other', 'unknown'])

function runPowerShell(script: string, stdin?: string, timeoutMs = 5_000): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(null)
      return
    }

    const child = spawn('powershell', ['-NonInteractive', '-NoProfile', '-Command', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // 读掉 stderr。管道写满会把 PowerShell 卡到超时；内容不使用。
    child.stderr?.resume()
    let stdout = ''
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      child.kill()
      warn(`printer-queue-diagnostics: PowerShell timed out after ${timeoutMs}ms`)
      finish(null)
    }, timeoutMs)

    child.stdin.end(stdin ?? '', 'utf8')
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.on('close', (code) => finish(code === 0 ? (stdout.trim() || null) : null))
    child.on('error', () => finish(null))
  })
}

/**
 * 打印机名只从 stdin 读。标准输出只有一行 spooler|portKind|portName。
 * PrinterHostAddress 只用来判断有没有，绝不写进这一行。
 * 失败、超时都由调用方收成 unknown，不抛错，也不拦打印。
 */
export const PRINTER_QUEUE_SCRIPT = [
  `${POWERSHELL_STDIN_UTF8};`,
  '$name = [Console]::In.ReadLine();',
  "$spooler = 'unknown';",
  'try {',
  '  $svc = Get-Service -Name Spooler -ErrorAction Stop;',
  '  $status = [string]$svc.Status;',
  "  if ($status -eq 'Running') { $spooler = 'running' }",
  "  elseif ($status -eq 'Stopped') { $spooler = 'stopped' }",
  "  else { $spooler = 'other' }",
  '} catch {',
  "  $spooler = 'unknown'",
  '};',
  "if ($spooler -ne 'running') { \"$spooler|unknown|\"; exit 0 };",
  "$portKind = 'unknown';",
  "$portName = '';",
  'try {',
  '  $printer = Get-Printer -Name ([WildcardPattern]::Escape($name)) -ErrorAction Stop | Select-Object -First 1;',
  '  $rawPort = [string]$printer.PortName;',
  '  $printerPort = $null;',
  '  if (-not [string]::IsNullOrWhiteSpace($rawPort)) {',
  '    $printerPort = Get-PrinterPort -Name $rawPort -ErrorAction SilentlyContinue',
  '  };',
  '  $hasPrinterHostAddress = $false;',
  '  if ($null -ne $printerPort -and -not [string]::IsNullOrWhiteSpace([string]$printerPort.PrinterHostAddress)) {',
  '    $hasPrinterHostAddress = $true',
  '  };',
  "  if ($rawPort -cmatch '^(USB|DOT4_)\\d{1,3}$') {",
  "    $portKind = 'usb';",
  '    $portName = $rawPort',
  '  } elseif ($hasPrinterHostAddress) {',
  "    $portKind = 'network'",
  "  } elseif ($rawPort -like 'WSD-*') {",
  "    $portKind = 'wsd'",
  '  } elseif (-not [string]::IsNullOrWhiteSpace($rawPort)) {',
  "    $portKind = 'other'",
  '  } else {',
  "    $portKind = 'unknown'",
  '  }',
  '} catch {',
  "  $portKind = 'unknown';",
  "  $portName = ''",
  '};',
  '"$spooler|$portKind|$portName"',
].join('\n')

export function parsePrinterQueueLine(line: string | null): PrinterQueueDiagnostics {
  const unknown: PrinterQueueDiagnostics = { spooler: 'unknown', portKind: 'unknown' }
  if (!line) return unknown
  const parts = line.trim().split('|')
  if (parts.length !== 3) return unknown
  const spooler = SPOOLER_VALUES.has(parts[0] ?? '') ? parts[0] as PrinterQueueSpooler : 'unknown'
  const portKind = PORT_KIND_VALUES.has(parts[1] ?? '') ? parts[1] as PrinterQueuePortKind : 'unknown'
  const candidate = parts[2] ?? ''
  if (portKind === 'usb' && USB_PORT_NAME.test(candidate)) {
    return { spooler, portKind, portName: candidate }
  }
  return { spooler, portKind }
}

export async function collectPrinterQueueDiagnostics(
  printerName: string,
  run: PowerShellRunner = runPowerShell,
): Promise<PrinterQueueDiagnostics> {
  try {
    return parsePrinterQueueLine(await run(PRINTER_QUEUE_SCRIPT, printerName))
  } catch {
    return { spooler: 'unknown', portKind: 'unknown' }
  }
}
