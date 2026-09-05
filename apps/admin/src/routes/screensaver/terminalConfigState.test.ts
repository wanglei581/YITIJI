import assert from 'node:assert/strict'
import test from 'node:test'
import type { SaveScreensaverConfigInput } from '@ai-job-print/shared'
import { saveScreensaverTerminalForm } from './terminalConfigState.ts'

test('saving enabled without a playlist applies the server-clamped disabled state to the form', async () => {
  let captured: SaveScreensaverConfigInput | null = null
  const state = await saveScreensaverTerminalForm(async (terminalId, input) => {
    captured = input
    return {
      terminalId,
      enabled: false,
      idleTimeoutSec: 30,
      playlistId: null,
      playlistName: null,
      updatedAt: '2026-09-06T00:00:00.000Z',
    }
  }, 'KSK-001', true, '10', '')

  assert.deepEqual(captured, {
    enabled: true,
    idleTimeoutSec: 30,
    playlistId: null,
  })
  assert.deepEqual(state, {
    enabled: false,
    timeout: '30',
    playlistId: '',
  })
})
