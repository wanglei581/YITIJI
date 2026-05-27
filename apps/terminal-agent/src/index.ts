import fs from 'fs'
import path from 'path'
import { Command } from 'commander'
import { DEFAULT_PRINTER, SUPPORTED_EXTENSIONS } from './config'
import { log, err, warn, section } from './logger'
import { listPrinters, checkPrinterExists } from './printer/printer-status'
import { printWithPowerShell } from './printer/print-with-powershell'
import { printWithPdfToPrinter } from './printer/print-with-pdf-to-printer'
import { PrintResult } from './printer/types'

const program = new Command()

program
  .name('terminal-agent')
  .description('Phase 8.0 local print spike — Pantum CM2820ADN')
  .version('0.1.0')

// ── list-printers ────────────────────────────────────────────────────────────

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

// ── print ────────────────────────────────────────────────────────────────────

program
  .command('print')
  .description('Send a file to a printer (spike: validates both print methods)')
  .requiredOption('--file <path>', 'Absolute path to the file to print')
  .option('--printer <name>', 'Printer name', DEFAULT_PRINTER)
  .option(
    '--method <a|b|both>',
    'a = PowerShell, b = pdf-to-printer, both = try A then B',
    'both',
  )
  .action(async (opts: { file: string; printer: string; method: string }) => {
    const { file, printer, method } = opts

    section(`Print Spike — ${new Date().toISOString()}`)
    log(`File    : ${file}`)
    log(`Printer : ${printer}`)
    log(`Method  : ${method}`)

    // ── Pre-flight checks ─────────────────────────────────────────────────

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

    // ── Run method(s) ─────────────────────────────────────────────────────

    const results: PrintResult[] = []

    if (method === 'a' || method === 'both') {
      section('Method A — PowerShell Start-Process -Verb PrintTo')
      const r = printWithPowerShell(file, printer)
      results.push(r)
      printResultSummary(r)
    }

    if (method === 'b' || (method === 'both')) {
      section('Method B — pdf-to-printer (SumatraPDF)')
      const r = await printWithPdfToPrinter(file, printer)
      results.push(r)
      printResultSummary(r)
    }

    // ── Overall verdict ───────────────────────────────────────────────────

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
        warn(`  ✗  ${r.method}  — ${r.errorCode ?? 'UNKNOWN'}  ${r.errorMessage ?? ''}`)
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
