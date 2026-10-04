import assert from 'node:assert/strict'
import test from 'node:test'
import type { SaveScreensaverConfigInput } from '@ai-job-print/shared'
import { SCREENSAVER_IDLE_DEFAULT_SEC, SCREENSAVER_IDLE_MAX_SEC, SCREENSAVER_IDLE_MIN_SEC } from './assetUploadRules.ts'
import { saveScreensaverTerminalForm } from './terminalConfigState.ts'

test('saving enabled without a playlist applies the server disabled state to the form', async () => {
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
  }, 'KSK-001', true, String(SCREENSAVER_IDLE_MIN_SEC + 1), '')

  assert.deepEqual(captured, {
    enabled: true,
    idleTimeoutSec: SCREENSAVER_IDLE_MIN_SEC + 1,
    playlistId: null,
  })
  assert.deepEqual(state, {
    enabled: false,
    timeout: '30',
    playlistId: '',
  })
})

test('idle timeout outside the allowed range is not submitted', async () => {
  for (const timeout of [String(SCREENSAVER_IDLE_MIN_SEC - 1), String(SCREENSAVER_IDLE_MAX_SEC + 1), '0', 'abc']) {
    let called = false
    await assert.rejects(
      () => saveScreensaverTerminalForm(async () => {
        called = true
        throw new Error('should not run')
      }, 'KSK-001', true, timeout, 'pl'),
      /等待时长请填/,
    )
    assert.equal(called, false, timeout)
  }
})

test('blank idle timeout submits the default, and the ends of the range are kept', async () => {
  const seen: number[] = []
  const save = async (terminalId: string, input: SaveScreensaverConfigInput) => {
    seen.push(input.idleTimeoutSec)
    return {
      terminalId,
      enabled: input.enabled,
      idleTimeoutSec: input.idleTimeoutSec,
      playlistId: input.playlistId,
      playlistName: null,
      updatedAt: '2026-09-06T00:00:00.000Z',
    }
  }
  await saveScreensaverTerminalForm(save, 'KSK-001', false, '', 'pl')
  await saveScreensaverTerminalForm(save, 'KSK-001', true, String(SCREENSAVER_IDLE_MIN_SEC), 'pl')
  await saveScreensaverTerminalForm(save, 'KSK-001', true, String(SCREENSAVER_IDLE_MAX_SEC), 'pl')
  assert.deepEqual(seen, [SCREENSAVER_IDLE_DEFAULT_SEC, SCREENSAVER_IDLE_MIN_SEC, SCREENSAVER_IDLE_MAX_SEC])
})
