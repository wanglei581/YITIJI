import assert from 'node:assert/strict'
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

  const diagnostics = await collectNetworkDiagnostics('Pantum CM2800ADN Series', async (script, stdin) => {
    assert.equal(stdin === undefined, script.includes('Get-NetAdapter'))
    return stdin === undefined ? 'connected' : 'reachable'
  })
  assert.deepEqual(diagnostics, { wiredNetworkStatus: 'connected', printerNetworkStatus: 'reachable' })
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
