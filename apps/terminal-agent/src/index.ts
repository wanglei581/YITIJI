import fs from 'fs'
import path from 'path'
import { Command } from 'commander'
import { DEFAULT_PRINTER, SUPPORTED_EXTENSIONS } from './config'
import { log, err, warn, section } from './logger'
import { listPrinters, checkPrinterExists } from './printer/printer-status'
import { printWithPowerShell } from './printer/print-with-powershell'
import { printWithPdfToPrinter } from './printer/print-with-pdf-to-printer'
import { print as printUnified } from './printer/print'
import { PrintResult } from './printer/types'
// Phase 8.1B agent modules
import { loadConfig } from './agent/config-manager'
import { registerOrLoad } from './agent/registration'
import { startHeartbeat } from './agent/heartbeat'
import { startTaskRunner } from './agent/task-runner'
import type { AgentConfig } from './agent/types'
// Phase 8.1C additions
import { acquireLock, releaseLock } from './agent/instance-lock'
import { openDatabase, type AgentDatabase } from './agent/db'
import { startOfflineRetry } from './agent/offline-queue'

const program = new Command()

program
  .name('terminal-agent')
  .description('Phase 8.1C agent — register / heartbeat / claim / print / status / service')
  .version('0.3.0')

// ── agent (Phase 8.1C) ────────────────────────────────────────────────────────

program
  .command('agent')
  .description(
    'Phase 8.1C: single-instance lock → SQLite → load config → register → heartbeat + claim loops',
  )
  .action(async () => {
    section(`Agent — Phase 8.1C — ${new Date().toISOString()}`)

    // ── Safety-net: release lock on any exit (including process.exit()) ───
    process.on('exit', releaseLock)

    // ── Step 1: Single-instance lock ──────────────────────────────────────
    acquireLock()

    // ── Step 2: Open SQLite (task state + offline PATCH queue) ────────────
    const db: AgentDatabase = openDatabase()

    // ── Step 3: Load config (includes Phase 8.1B → 8.1C migration) ───────
    let config: AgentConfig
    try {
      config = loadConfig()
    } catch (e) {
      err(`Failed to load agent config: ${e instanceof Error ? e.message : String(e)}`)
      process.exit(1)
    }
    log(`config loaded — terminal="${config.terminalCode}"  api=${config.apiBaseUrl}`)

    // ── Step 4: Register or load existing credentials ─────────────────────
    try {
      config = await registerOrLoad(config)
    } catch (e) {
      err(`${e instanceof Error ? e.message : String(e)}`)
      err('Cannot continue without terminalId and agentToken. Fix config and restart.')
      process.exit(1)
    }
    log(`agent ready — terminalId=${config.terminalId!}`)

    // ── Step 5: Start heartbeat ───────────────────────────────────────────
    const heartbeatTimer = startHeartbeat({
      config,
      onConfigUpdate: (patch) => {
        if (patch.heartbeatIntervalMs) config.heartbeatIntervalMs = patch.heartbeatIntervalMs
        if (patch.claimIntervalMs) config.claimIntervalMs = patch.claimIntervalMs
      },
    })

    // ── Step 6: Start claim / print loop ──────────────────────────────────
    const claimTimer = startTaskRunner({ config, db })

    // ── Step 7: Start offline PATCH retry loop ────────────────────────────
    const offlineRetryTimer = startOfflineRetry(config, db)

    log('Agent running. Press Ctrl+C to stop.')

    // ── Graceful shutdown ─────────────────────────────────────────────────
    const shutdown = (signal: string) => {
      log(`Agent: received ${signal}, shutting down...`)
      clearInterval(heartbeatTimer)
      clearInterval(claimTimer)
      clearInterval(offlineRetryTimer)
      releaseLock()
      process.exit(0)
    }
    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('uncaughtException', (e) => {
      err(`uncaughtException: ${e.message}\n${e.stack ?? ''}`)
      process.exit(1)
    })
    process.on('unhandledRejection', (reason) => {
      err(`unhandledRejection: ${String(reason)}`)
      process.exit(1)
    })
  })

// ── install-service (Windows only) ───────────────────────────────────────────

program
  .command('install-service')
  .description('Install AIJobPrintAgent as a Windows service (auto-start on boot)')
  .action(() => {
    if (process.platform !== 'win32') {
      err('install-service is only supported on Windows.')
      process.exit(1)
    }
    try {
      // Dynamically require node-windows to avoid import errors on non-Windows
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const { Service } = require('node-windows') as { Service: any }
      const svc = new Service({
        name: 'AIJobPrintAgent',
        description: 'AI求职打印服务终端 — Windows Terminal Agent',
        script: __filename, // absolute path to this compiled JS file
        // node-windows passes scriptOptions as the argument string to the script.
        // Use 'agent' so the service launches: node index.js agent
        // (not args:[], which sets node.exe options, not script subcommands)
        scriptOptions: 'agent',
      })
      svc.on('install', () => {
        log('Service installed — starting AIJobPrintAgent...')
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        svc.start()
        log('AIJobPrintAgent service started. View in Services (services.msc).')
        process.exit(0)
      })
      svc.on('error', (e: unknown) => {
        err(`install-service error: ${String(e)}`)
        process.exit(1)
      })
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      svc.install()
    } catch (e) {
      err(`install-service failed: ${e instanceof Error ? e.message : String(e)}`)
      process.exit(1)
    }
  })

// ── uninstall-service (Windows only) ─────────────────────────────────────────

program
  .command('uninstall-service')
  .description('Uninstall the AIJobPrintAgent Windows service')
  .action(() => {
    if (process.platform !== 'win32') {
      err('uninstall-service is only supported on Windows.')
      process.exit(1)
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const { Service } = require('node-windows') as { Service: any }
      const svc = new Service({
        name: 'AIJobPrintAgent',
        script: __filename,
      })
      svc.on('uninstall', () => {
        log('AIJobPrintAgent service uninstalled.')
        process.exit(0)
      })
      svc.on('error', (e: unknown) => {
        err(`uninstall-service error: ${String(e)}`)
        process.exit(1)
      })
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      svc.uninstall()
    } catch (e) {
      err(`uninstall-service failed: ${e instanceof Error ? e.message : String(e)}`)
      process.exit(1)
    }
  })

// ── list-printers ─────────────────────────────────────────────────────────────

program
  .command('list-printers')
  .description('List all printers installed on this Windows machine')
  .action(() => {
    section('Installed Printers')
    const printers = listPrinters()
    if (printers.length === 0) {
      warn('No printers found (or PowerShell unavailable on this platform)')
      return
    }
    printers.forEach((p) => {
      log(`  ${p.name.padEnd(40)} status: ${p.status}`)
    })
    log(`Total: ${printers.length} printer(s)`)
  })

// ── print ─────────────────────────────────────────────────────────────────────

program
  .command('print')
  .description('Send a file to a printer (spike: validates both print methods)')
  .requiredOption('--file <path>', 'Absolute path to the file to print')
  .option('--printer <name>', 'Printer name', DEFAULT_PRINTER)
  .option(
    '--method <auto|a|b|both>',
    'auto = production path (unified print() via pdfkit+Method B); a = PowerShell; b = pdf-to-printer; both = spike A+B',
    'auto',
  )
  .action(async (opts: { file: string; printer: string; method: string }) => {
    const { file, printer, method } = opts

    section(`Print — ${new Date().toISOString()}`)
    log(`File    : ${file}`)
    log(`Printer : ${printer}`)
    log(`Method  : ${method}`)
    if (method === 'both') {
      warn('⚠️  both mode sends the file to the printer TWICE (once per method).')
      warn('   Use only for spike verification. Do NOT use as default in production.')
    }

    if (!fs.existsSync(file)) {
      err(`FILE_NOT_FOUND: ${file}`)
      process.exit(1)
    }

    const ext = path.extname(file).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      err(`UNSUPPORTED_FILE_TYPE: ${ext} — supported: ${[...SUPPORTED_EXTENSIONS].join(', ')}`)
      process.exit(1)
    }

    log(`File size: ${(fs.statSync(file).size / 1024).toFixed(1)} KB`)

    if (!checkPrinterExists(printer)) {
      err(`PRINTER_NOT_FOUND: "${printer}"`)
      log('Available printers:')
      listPrinters().forEach((p) => log(`  • ${p.name} [${p.status}]`))
      process.exit(1)
    }

    log(`Printer "${printer}" found ✓`)

    if (method === 'auto') {
      section('Print [auto] — unified print() (Phase 8.1A)')
      const r = await printUnified(file, printer)
      printResultSummary(r)
      section('Result')
      if (r.success) {
        log(`✓ PRINT SUCCESS [auto]  printer=${r.printer}  file=${r.file}  duration=${r.durationMs}ms`)
      } else {
        err(`✗ PRINT FAILED [auto]  errorCode=${r.errorCode ?? 'UNKNOWN'}  ${r.errorMessage ?? ''}`)
        process.exit(2)
      }
      return
    }

    const results: PrintResult[] = []

    if (method === 'a' || method === 'both') {
      section('Method A — PowerShell Start-Process -Verb PrintTo')
      const r = printWithPowerShell(file, printer)
      results.push(r)
      printResultSummary(r)
    }

    if (method === 'b' || method === 'both') {
      section('Method B — pdf-to-printer (SumatraPDF)')
      const r = await printWithPdfToPrinter(file, printer)
      results.push(r)
      printResultSummary(r)
    }

    section('Spike Result')
    const passed = results.filter((r) => r.success)
    const failed = results.filter((r) => !r.success)

    if (passed.length > 0) {
      log(`PASSED (${passed.length}/${results.length} method(s)):`)
      passed.forEach((r) => log(`  ✓  ${r.method}  — ${r.durationMs} ms`))
    }
    if (failed.length > 0) {
      warn(`FAILED (${failed.length}/${results.length} method(s)):`)
      failed.forEach((r) =>
        warn(`  ✗  ${r.method}  — ${r.errorCode ?? 'UNKNOWN'}  ${r.errorMessage ?? ''}`),
      )
    }

    if (passed.length === 0) {
      err('All print methods failed. See error codes above.')
      process.exit(2)
    }
  })

// ── helpers ───────────────────────────────────────────────────────────────────

function printResultSummary(r: PrintResult): void {
  if (r.success) {
    log(`✓ SUCCESS`)
    log(`  Method   : ${r.method}`)
    log(`  Printer  : ${r.printer}`)
    log(`  File     : ${r.file}`)
    log(`  Duration : ${r.durationMs} ms`)
    if (r.rawOutput) log(`  Output   : ${r.rawOutput.slice(0, 200)}`)
  } else {
    err(`✗ FAILED`)
    err(`  Method     : ${r.method}`)
    err(`  ErrorCode  : ${r.errorCode ?? 'UNKNOWN'}`)
    err(`  Message    : ${r.errorMessage ?? '(none)'}`)
    if (r.rawOutput) err(`  RawOutput  : ${r.rawOutput.slice(0, 200)}`)
  }
}

program.parse(process.argv)
