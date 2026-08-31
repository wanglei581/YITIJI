import { spawn } from 'child_process'
import { warn } from '../logger'

export type WiredNetworkStatus = 'connected' | 'disconnected' | 'unknown'
export type PrinterNetworkStatus = 'reachable' | 'unreachable' | 'not_network_printer' | 'unknown'

export interface NetworkDiagnostics {
  wiredNetworkStatus: WiredNetworkStatus
  printerNetworkStatus: PrinterNetworkStatus
}

type PowerShellRunner = (script: string, stdin?: string) => Promise<string | null>

function runPowerShell(script: string, stdin?: string, timeoutMs = 5_000): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(null)
      return
    }

    const child = spawn('powershell', ['-NonInteractive', '-NoProfile', '-Command', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
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
      warn(`network-diagnostics: PowerShell timed out after ${timeoutMs}ms`)
      finish(null)
    }, timeoutMs)

    child.stdin.end(stdin ?? '', 'utf8')
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.on('close', (code) => finish(code === 0 ? (stdout.trim() || null) : null))
    child.on('error', () => finish(null))
  })
}

export function normalizeWiredNetworkStatus(value: string | null): WiredNetworkStatus {
  if (value === 'connected' || value === 'disconnected') return value
  return 'unknown'
}

export function normalizePrinterNetworkStatus(value: string | null): PrinterNetworkStatus {
  if (value === 'reachable' || value === 'unreachable' || value === 'not_network_printer') return value
  return 'unknown'
}

const WIRED_ADAPTER_SCRIPT = [
  '$adapters = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object {',
  "  $_.MediaType -eq '802.3' -or $_.InterfaceDescription -notmatch 'Wireless|Wi-Fi|WLAN|802\\.11'",
  '});',
  "if ($adapters.Count -eq 0) { 'unknown' }",
  "elseif (@($adapters | Where-Object { $_.Status -eq 'Up' }).Count -gt 0) { 'connected' }",
  "else { 'disconnected' }",
].join(' ')

// Printer name is received through stdin. The script intentionally returns only an enum:
// it never returns the printer host, port, SSID, gateway, interface name, or any credential.
const PRINTER_NETWORK_SCRIPT = [
  '$name = [Console]::In.ReadLine();',
  '$printer = Get-Printer -Name $name -ErrorAction SilentlyContinue;',
  "if ($null -eq $printer) { 'unknown'; exit }",
  '$port = Get-PrinterPort -Name $printer.PortName -ErrorAction SilentlyContinue;',
  "if ($null -eq $port) { 'unknown'; exit }",
  '$printerHostAddress = [string]$port.PrinterHostAddress;',
  "if ([string]::IsNullOrWhiteSpace($printerHostAddress)) { 'not_network_printer'; exit }",
  '$portNumber = [int]$port.PortNumber;',
  'if ($portNumber -lt 1) { $portNumber = 9100 }',
  '$client = New-Object System.Net.Sockets.TcpClient;',
  'try {',
  '  $result = $client.BeginConnect($printerHostAddress, $portNumber, $null, $null);',
  "  if (-not $result.AsyncWaitHandle.WaitOne(3000)) { 'unreachable' }",
  "  else { $client.EndConnect($result); 'reachable' }",
  '} catch {',
  "  'unreachable'",
  '} finally {',
  '  $client.Close()',
  '}',
].join(' ')

/**
 * Produces only safe link-state enums. It is best-effort and must never block printing:
 * `unknown` means the operator should inspect the host, not that the printer is offline.
 */
export async function collectNetworkDiagnostics(
  printerName: string,
  run: PowerShellRunner = runPowerShell,
): Promise<NetworkDiagnostics> {
  try {
    const [wired, printer] = await Promise.all([
      run(WIRED_ADAPTER_SCRIPT),
      run(PRINTER_NETWORK_SCRIPT, printerName),
    ])
    return {
      wiredNetworkStatus: normalizeWiredNetworkStatus(wired),
      printerNetworkStatus: normalizePrinterNetworkStatus(printer),
    }
  } catch {
    return { wiredNetworkStatus: 'unknown', printerNetworkStatus: 'unknown' }
  }
}
