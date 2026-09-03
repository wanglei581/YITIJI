import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  collectNetworkDiagnostics,
  normalizePrinterNetworkStatus,
  normalizeWiredNetworkStatus,
} from '../src/agent/network-diagnostics'

async function main(): Promise<void> {
  assert.equal(normalizeWiredNetworkStatus('connected'), 'connected')
  assert.equal(normalizeWiredNetworkStatus('disconnected'), 'disconnected')
  assert.equal(normalizeWiredNetworkStatus('adapter-name-or-ip'), 'unknown')
  assert.equal(normalizePrinterNetworkStatus('reachable'), 'reachable')
  assert.equal(normalizePrinterNetworkStatus('not_network_printer'), 'not_network_printer')
  assert.equal(normalizePrinterNetworkStatus('192.168.50.2'), 'unknown')

  const source = fs.readFileSync(
    path.join(__dirname, '../src/agent/network-diagnostics.ts'),
    'utf8',
  )
  assert.doesNotMatch(source, /\$host\b/i, 'PowerShell $Host is a built-in read-only variable')
  assert.match(source, /\$printerHostAddress\b/)
  assert.match(source, /if \(\$null -eq \$port\) \{ 'unknown'; exit \}/)

  const diagnostics = await collectNetworkDiagnostics('Pantum CM2800ADN Series', async (script, stdin) => {
    assert.equal(stdin === undefined, script.includes('Get-NetAdapter'))
    return stdin === undefined ? 'connected' : 'reachable'
  })
  assert.deepEqual(diagnostics, { wiredNetworkStatus: 'connected', printerNetworkStatus: 'reachable' })
  const usbDiagnostics = await collectNetworkDiagnostics(
    'Pantum CM2800ADN Series',
    async (_script, stdin) => stdin === undefined ? 'connected' : 'not_network_printer',
  )
  assert.deepEqual(usbDiagnostics, {
    wiredNetworkStatus: 'connected',
    printerNetworkStatus: 'not_network_printer',
  })
  const fallback = await collectNetworkDiagnostics('Pantum CM2800ADN Series', async () => {
    throw new Error('simulated diagnostic failure')
  })
  assert.deepEqual(fallback, { wiredNetworkStatus: 'unknown', printerNetworkStatus: 'unknown' })
  console.log('ALL PASS: terminal network diagnostics stay enum-only and preserve no network identifiers')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
